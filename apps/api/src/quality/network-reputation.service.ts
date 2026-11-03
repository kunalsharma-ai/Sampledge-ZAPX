/**
 * Network reputation (Milestone 16): asks a provider whether a respondent's address belongs to a VPN,
 * proxy, Tor exit, privacy relay or data centre, and keeps only those words on the interview
 * (`Response.networkFlags`). The quality score turns them into the anonymous_network and
 * datacenter_network flags (review evidence, never a block at the door).
 *
 * - Off by default (NETWORK_REPUTATION=off): no address leaves ZAPX.
 * - The lookup runs after the interview has started and never delays or fails it; a slow or broken
 *   provider just means no flag.
 * - Private, loopback and link-local addresses are never sent.
 * - Answers are cached in memory for an hour, keyed by a hash of the address, so a busy network is
 *   looked up once.
 *
 * Provider: IPinfo privacy detection (`GET /{ip}/privacy`). Tested against a local stand-in only.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { config } from '../config';
import { integration } from '../platform/integrations';
import { PrismaService } from '../common/prisma.service';

export const NETWORK_KINDS = ['vpn', 'proxy', 'tor', 'relay', 'hosting'] as const;
export type NetworkKind = (typeof NETWORK_KINDS)[number];

export interface NetworkReputationProvider {
  readonly name: string;
  /** The kinds that apply to this address (empty: an ordinary network). Throws on failure. */
  lookup(ip: string, signal: AbortSignal): Promise<NetworkKind[]>;
}

/** IPinfo privacy detection: {vpn, proxy, tor, relay, hosting: boolean, service?: string}. */
export class IpinfoProvider implements NetworkReputationProvider {
  readonly name = 'ipinfo';
  constructor(
    private readonly token: string,
    private readonly base: string,
  ) {}

  async lookup(ip: string, signal: AbortSignal): Promise<NetworkKind[]> {
    const res = await fetch(`${this.base.replace(/\/$/, '')}/${encodeURIComponent(ip)}/privacy`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal,
    });
    if (!res.ok) throw new Error(`IPinfo answered ${res.status}`);
    const body = (await res.json()) as Partial<Record<NetworkKind, unknown>>;
    return NETWORK_KINDS.filter((k) => body[k] === true);
  }
}

/** True for addresses that are not on the public internet (never worth sending anywhere). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(v) === 6) {
    const l = v.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
  }
  return true;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 10_000;

@Injectable()
export class NetworkReputationService {
  private readonly log = new Logger('NetworkReputation');
  private readonly cache = new Map<string, { kinds: NetworkKind[]; at: number }>();
  private provider: NetworkReputationProvider | null | undefined;
  /** Lookups still running, by interview, so completion can wait for them. */
  private readonly pending = new Map<string, Promise<NetworkKind[] | null>>();

  constructor(private readonly prisma: PrismaService) {}

  /** For tests: use this provider instead of the configured one. */
  useProvider(p: NetworkReputationProvider | null) {
    this.provider = p;
    this.cache.clear();
  }

  /** Built from Settings > Integrations (or NETWORK_REPUTATION and IPINFO_TOKEN), rebuilt when they change. */
  private built?: { fingerprint: string; provider: NetworkReputationProvider | null };

  private current(): NetworkReputationProvider | null {
    if (this.provider !== undefined) return this.provider;
    const s = integration('ipinfo');
    if (this.built?.fingerprint !== s.fingerprint) {
      this.built = {
        fingerprint: s.fingerprint,
        provider: s.enabled ? new IpinfoProvider(s.values.token!, config().IPINFO_API_BASE) : null,
      };
      this.cache.clear();
    }
    return this.built.provider;
  }

  enabled() {
    return !!this.current();
  }

  /** Look the address up and store the answer on the interview. Never throws. */
  check(responseId: string, ip: string | undefined): Promise<NetworkKind[] | null> {
    const p = this.lookupAndStore(responseId, ip).finally(() => this.pending.delete(responseId));
    this.pending.set(responseId, p);
    return p;
  }

  /** The result of a lookup still running for this interview (null when none is running). */
  async settle(responseId: string): Promise<NetworkKind[] | null> {
    const p = this.pending.get(responseId);
    return p ? p : null;
  }

  private async lookupAndStore(responseId: string, ip: string | undefined): Promise<NetworkKind[] | null> {
    const provider = this.current();
    if (!provider || !ip || isPrivateAddress(ip)) return null;
    const key = createHash('sha256').update(ip).digest('base64url');
    const now = Date.now();
    let kinds = this.cache.get(key);
    if (!kinds || now - kinds.at > CACHE_TTL_MS) {
      try {
        const found = await provider.lookup(ip, AbortSignal.timeout(config().NETWORK_REPUTATION_TIMEOUT_MS));
        kinds = { kinds: found, at: now };
        if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, kinds);
      } catch (e) {
        this.log.warn(`${provider.name} lookup failed: ${(e as Error).message}`);
        return null;
      }
    }
    if (kinds.kinds.length) {
      await this.prisma.response.update({ where: { id: responseId }, data: { networkFlags: kinds.kinds } }).catch((e: Error) => {
        this.log.warn(`Could not store network flags: ${e.message}`);
      });
    }
    return kinds.kinds;
  }
}
