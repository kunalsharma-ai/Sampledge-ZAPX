import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../config';
import { PrismaService } from './prisma.service';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

interface Row {
  hits: number;
  expires_in: number;
  blocked_for: number | null;
}

/**
 * Rate-limit counters in PostgreSQL (security review S4), so every API process counts against the
 * same limit: with the default in-memory store two tasks allowed twice the configured rate, and
 * autoscaling changed the real limit. Chosen with THROTTLE_STORE (default `database` in production).
 *
 * Fixed windows: the first hit opens a window of `ttl`; hits above `limit` block the key for
 * `blockDuration`. One upsert per request. If the database cannot be reached the request is counted
 * in this process instead (logged), so the limiter never becomes the reason the API is down.
 */
export class DbThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('RateLimit');
  private readonly fallback = new ThrottlerStorageService();
  private sweeper?: NodeJS.Timeout;
  private warned = 0;

  constructor(private readonly prisma: PrismaService) {}

  async sweep(): Promise<number> {
    try {
      return await this.prisma.$executeRaw`
        DELETE FROM "RateLimitBucket"
        WHERE "windowEnds" < now() - interval '1 minute' AND ("blockedUntil" IS NULL OR "blockedUntil" < now() - interval '1 minute')`;
    } catch {
      return 0;
    }
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const id = `${throttlerName}:${key}`;
    if (!this.sweeper) {
      // Every 5 minutes, remove counters whose window and block both ended (a minute of grace).
      this.sweeper = setInterval(() => void this.sweep(), 5 * 60_000);
      this.sweeper.unref();
    }
    try {
      // While blocked, hits are not counted; once a window or block has ended the count restarts.
      const [row] = await this.prisma.$queryRaw<Row[]>`
        INSERT INTO "RateLimitBucket" AS b ("key", "hits", "windowEnds", "blockedUntil")
        VALUES (${id}, 1, now() + make_interval(secs => ${ttl / 1000}), NULL)
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE
            WHEN b."blockedUntil" > now() THEN b."hits"
            WHEN b."windowEnds" <= now() OR b."blockedUntil" IS NOT NULL THEN 1
            ELSE b."hits" + 1 END,
          "windowEnds" = CASE
            WHEN b."blockedUntil" > now() THEN b."windowEnds"
            WHEN b."windowEnds" <= now() OR b."blockedUntil" IS NOT NULL THEN now() + make_interval(secs => ${ttl / 1000})
            ELSE b."windowEnds" END,
          "blockedUntil" = CASE WHEN b."blockedUntil" > now() THEN b."blockedUntil" ELSE NULL END
        RETURNING "hits",
          extract(epoch FROM ("windowEnds" - now()))::float8 AS expires_in,
          extract(epoch FROM ("blockedUntil" - now()))::float8 AS blocked_for`;
      let blockedFor = row!.blocked_for;
      if (blockedFor === null && row!.hits > limit) {
        const [b] = await this.prisma.$queryRaw<Array<{ blocked_for: number }>>`
          UPDATE "RateLimitBucket" SET "blockedUntil" = now() + make_interval(secs => ${blockDuration / 1000})
          WHERE "key" = ${id}
          RETURNING extract(epoch FROM ("blockedUntil" - now()))::float8 AS blocked_for`;
        blockedFor = b?.blocked_for ?? blockDuration / 1000;
      }
      return {
        totalHits: row!.hits,
        timeToExpire: Math.max(0, Math.ceil(row!.expires_in)),
        isBlocked: blockedFor !== null && blockedFor > 0,
        timeToBlockExpire: blockedFor !== null ? Math.max(0, Math.ceil(blockedFor)) : 0,
      };
    } catch (e) {
      if (Date.now() - this.warned > 60_000) {
        this.warned = Date.now();
        this.log.warn(`Shared rate-limit store unavailable, counting in this process: ${(e as Error).message}`);
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}

/** Which store the throttler uses: shared in the database, or per process. */
export function throttleStore(): 'database' | 'memory' {
  const c = config();
  return c.THROTTLE_STORE ?? (c.NODE_ENV === 'production' ? 'database' : 'memory');
}
