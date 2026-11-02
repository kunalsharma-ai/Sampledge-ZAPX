import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@zapx/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Database');
  /** Whether Postgres applies row-level security to this connection's role (see rlsStatus). */
  rls: 'enforced' | 'bypassed' | 'unknown' = 'unknown';

  async onModuleInit() {
    await this.$connect();
    try {
      const [role] = await this.$queryRaw<{ bypass: boolean }[]>`
        SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`;
      this.rls = role?.bypass ? 'bypassed' : 'enforced';
      if (this.rls === 'bypassed')
        this.log.warn(
          'The database role is a superuser or has BYPASSRLS, so row-level security is not applied. Use a plain role in production.',
        );
    } catch {
      this.rls = 'unknown';
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * A client whose every query runs in a transaction with app.tenant_id set, so the Postgres
   * row-level security policy on respondent data (Response) hides other tenants' rows even if an
   * application filter is missing. Use it for studio reads of respondent data. Each operation
   * is its own short transaction; it cannot be nested inside another interactive transaction.
   */
  forTenant(tenantId: string) {
    return this.$extends({
      query: {
        $allModels: {
          $allOperations: async ({ args, query }) => {
            const [, result] = await this.$transaction([
              this.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    });
  }
}
