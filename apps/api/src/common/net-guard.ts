/**
 * Server-side request forgery (SSRF) guard (Milestone 20).
 *
 * SampCode calls addresses that customers type in (vendor callbacks, webhooks, identity providers). Those
 * calls must never reach the cloud metadata service, the database or anything else on a private
 * network. Two things make a simple "look up the name, then fetch" check unsafe:
 *
 * - IPv6 spellings of IPv4 addresses: `http://[::ffff:127.0.0.1]/` is serialised by the URL parser
 *   as `[::ffff:7f00:1]`, which a dotted-quad pattern does not recognise.
 * - DNS rebinding: a name can resolve to a public address when it is checked and to 127.0.0.1 a
 *   millisecond later when the request connects.
 *
 * `isPrivateAddress` understands every IPv6 form that embeds an IPv4 address, and `guardedFetch`
 * checks the address at the moment the socket connects, so there is no gap between check and use.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from 'undici';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including the cloud metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo (embeds an arbitrary IPv4 address)
  ['2002::', 16], // 6to4 (embeds an arbitrary IPv4 address)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** The 16 bytes of an IPv6 address (any valid spelling, including a dotted IPv4 tail), or null. */
export function ipv6Bytes(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let a = address.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) {
    const p = dotted[1]!.split('.').map(Number);
    a = `${a.slice(0, -dotted[1]!.length)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const [head, tail] = a.includes('::') ? (a.split('::') as [string, string]) : [a, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g || '0', 16);
    return [n >> 8, n & 0xff];
  });
}

/** The IPv4 address an IPv6 address stands for (mapped, compatible or well-known NAT64), if any. */
export function embeddedIpv4(address: string): string | null {
  const b = ipv6Bytes(address);
  if (!b) return null;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4 = b.slice(12).join('.');
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4; // ::ffff:a.b.c.d (mapped)
  if (zeros(0, 12) && !zeros(12, 16)) return v4; // ::a.b.c.d (compatible, deprecated)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return v4; // 64:ff9b::/96 (NAT64)
  if (b[0] === 0 && b[1] === 0 && zeros(2, 8) && b[8] === 0xff && b[9] === 0xff && zeros(10, 12)) return v4; // ::ffff:0:a.b.c.d (translated)
  return null;
}

/** True unless the address is a public unicast address. Anything that is not an address counts as private. */
export function isPrivateAddress(address: string): boolean {
  const a = address.trim().replace(/^\[|\]$/g, '');
  const family = isIP(a);
  if (family === 4) return blocked.check(a, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(a);
    if (v4) return blocked.check(v4, 'ipv4');
    return blocked.check(a.replace(/%.*$/, ''), 'ipv6');
  }
  return true;
}

export class BlockedAddressError extends Error {
  readonly code = 'ZAPX_BLOCKED_ADDRESS';
  constructor(host: string) {
    super(`${host} resolves to a private address`);
    this.name = 'BlockedAddressError';
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for sockets that refuses private addresses. It is called by the socket itself, so the
 * address that is checked is the address that is connected to.
 */
export function publicOnlyLookup(hostname: string, options: { all?: boolean; family?: number } | undefined, cb: LookupCallback) {
  dnsLookup(hostname, { ...(options ?? {}), all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((x) => isPrivateAddress(x.address))) return cb(new BlockedAddressError(hostname), []);
    if (options?.all) return cb(null, list);
    return cb(null, list[0]!.address, list[0]!.family);
  });
}

let agent: Agent | undefined;
function publicAgent() {
  agent ??= new Agent({ connect: { lookup: publicOnlyLookup as never }, connections: 64 });
  return agent;
}

/** Throws BlockedAddressError when the URL names a private address literally (names are checked when connecting). */
export function assertPublicUrl(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new BlockedAddressError(host);
}

/** True when the error (or its cause) is a blocked address. */
export function isBlockedAddressError(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    if (x instanceof BlockedAddressError || (x as { code?: string }).code === 'ZAPX_BLOCKED_ADDRESS') return true;
  }
  return false;
}

/**
 * fetch() that can only reach public addresses: literal private addresses are refused before
 * sending, and names are re-checked by the socket at connect time (no DNS rebinding window).
 * With `allowPrivate` (development and tests only) it is the ordinary fetch.
 */
export async function guardedFetch(
  input: string | URL,
  init: UndiciRequestInit & { allowPrivate?: boolean } = {},
): Promise<UndiciResponse> {
  const { allowPrivate, ...rest } = init;
  const url = typeof input === 'string' ? new URL(input) : input;
  if (allowPrivate) return undiciFetch(url, rest);
  assertPublicUrl(url);
  return undiciFetch(url, { ...rest, dispatcher: publicAgent() });
}
