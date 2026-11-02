/**
 * Sends one callback request. Protects against SSRF: unless explicitly allowed (development and
 * tests), callbacks may only go to public addresses, and redirects are never followed.
 */
import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { HttpRequestSpec } from '@zapx/redirect-core';
import { config } from '../config';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? blocked.check(mapped[1]!, 'ipv4') : blocked.check(address, 'ipv6');
  }
  return true;
}

export interface DeliveryResult {
  httpStatus: number | null;
  error: string | null;
  ms: number;
  /** The request was refused before sending; retrying cannot help. */
  permanent?: boolean;
}

@Injectable()
export class HttpDelivery {
  async send(spec: HttpRequestSpec): Promise<DeliveryResult> {
    const started = Date.now();
    const cfg = config();
    try {
      const url = new URL(spec.url);
      if (!cfg.CALLBACK_ALLOW_PRIVATE_HOSTS) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
        if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
          return {
            httpStatus: null,
            error: 'blocked: callback host resolves to a private address',
            ms: Date.now() - started,
            permanent: true,
          };
        }
      }
      const res = await fetch(url, {
        method: spec.method,
        headers: { 'User-Agent': 'ZAPX-Callbacks/1', ...spec.headers },
        body: spec.body ?? undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(cfg.CALLBACK_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);
      return { httpStatus: res.status, error: res.ok ? null : `HTTP ${res.status}`, ms: Date.now() - started };
    } catch (e) {
      const err = e as Error;
      return {
        httpStatus: null,
        error: err.name === 'TimeoutError' ? 'timeout' : `network: ${err.message}`.slice(0, 300),
        ms: Date.now() - started,
      };
    }
  }
}
