import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@zapx/db';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { LocalSecretBox, type SecretBox } from './secret-box';
import { checkIntegration } from './integration-checks';
import {
  INTEGRATIONS,
  INTEGRATION_KEYS,
  integration,
  isIntegrationKey,
  secretHint,
  setStoredIntegrations,
  storedIntegration,
  type IntegrationKey,
  type StoredIntegration,
} from './integrations';

export interface SaveInput {
  enabled: boolean;
  /** Field values. For a secret, an empty or missing value keeps the saved one. */
  values: Record<string, string | undefined>;
  /** Fields to clear (fall back to the environment). */
  clear?: string[];
}

/**
 * Keeps every process's copy of the CRM integrations fresh, and lets the platform operator's
 * administrators read, change and test them. See ./integrations.ts.
 */
@Injectable()
export class IntegrationSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Integrations');
  private readonly box: SecretBox = new LocalSecretBox();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), config().INTEGRATIONS_REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-read the saved integrations. A row that cannot be opened (wrong SECRETS_KEY) keeps its secrets empty. */
  async refresh() {
    try {
      const rows = await this.prisma.platformIntegration.findMany();
      const next = new Map<IntegrationKey, StoredIntegration>();
      for (const r of rows) {
        if (!isIntegrationKey(r.key)) continue;
        let secrets: Record<string, string> = {};
        if (r.secretsSealed) {
          try {
            secrets = JSON.parse(this.box.open(r.secretsSealed)) as Record<string, string>;
          } catch {
            this.log.error(`The saved secrets of ${r.key} cannot be opened: was SECRETS_KEY changed? Enter them again in the CRM.`);
          }
        }
        const settings = (r.settings ?? {}) as Record<string, string>;
        next.set(r.key, { enabled: r.enabled, values: { ...settings, ...secrets }, updatedAt: r.updatedAt, updatedById: r.updatedById });
      }
      setStoredIntegrations(next);
    } catch (e) {
      this.log.warn(`Could not refresh integrations: ${(e as Error).message}`);
    }
  }

  // ---- Who may change them -------------------------------------------------------------------

  /**
   * Platform integrations belong to the organization that runs the installation. Until one is marked,
   * the oldest organization is (the first one created on a new installation).
   */
  async isOperator(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { platformOperator: true } });
    if (t?.platformOperator) return true;
    if (await this.prisma.tenant.count({ where: { platformOperator: true } })) return false;
    const oldest = await this.prisma.tenant.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    if (!oldest) return false;
    await this.prisma.tenant.update({ where: { id: oldest.id }, data: { platformOperator: true } });
    return oldest.id === tenantId;
  }

  private async operatorAdmin(user: AuthUser) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only administrators can see integrations');
    if (user.apiKeyId) throw new ForbiddenException('Integrations can only be changed when signed in, not with an API key');
    if (!(await this.isOperator(user.tenantId)))
      throw new ForbiddenException('Integrations are managed by the organization that runs this installation');
  }

  // ---- Read ----------------------------------------------------------------------------------

  private view(key: IntegrationKey) {
    const def = INTEGRATIONS[key];
    const eff = integration(key);
    const row = storedIntegration(key);
    const c = config();
    return {
      key,
      name: def.name,
      category: def.category,
      purpose: def.purpose,
      privacy: def.privacy,
      signupUrl: def.signupUrl,
      warning: def.warning ?? null,
      enabled: eff.enabled,
      switchedOn: eff.switchedOn,
      source: eff.source,
      missing: eff.missing,
      updatedAt: row?.updatedAt ?? null,
      callbacks: def.callbacks?.(c, eff.values) ?? [],
      fields: def.fields.map((f) => {
        const v = eff.values[f.name] ?? '';
        return {
          name: f.name,
          label: f.label,
          help: f.help ?? null,
          secret: !!f.secret,
          required: !!f.required,
          kind: f.kind ?? 'text',
          options: f.options ?? null,
          placeholder: f.placeholder ?? null,
          env: f.env,
          origin: eff.origins[f.name],
          // Secrets never leave the server: only whether one is set, and its last characters.
          value: f.secret ? null : v,
          isSet: !!v,
          hint: f.secret && v ? secretHint(v) : null,
        };
      }),
    };
  }

  async list(user: AuthUser) {
    await this.operatorAdmin(user);
    await this.refresh();
    return { integrations: INTEGRATION_KEYS.map((k) => this.view(k)) };
  }

  // ---- Change --------------------------------------------------------------------------------

  async save(user: AuthUser, key: string, input: SaveInput) {
    await this.operatorAdmin(user);
    if (!isIntegrationKey(key)) throw new NotFoundException('No such integration');
    const def = INTEGRATIONS[key];
    await this.refresh();
    const before = storedIntegration(key)?.values ?? {};
    const names = new Set(def.fields.map((f) => f.name));
    for (const n of [...Object.keys(input.values), ...(input.clear ?? [])])
      if (!names.has(n)) throw new BadRequestException(`${def.name} has no field "${n}"`);

    const issues: Array<{ path: string; message: string }> = [];
    const next: Record<string, string> = {};
    for (const f of def.fields) {
      const typed = input.values[f.name]?.trim();
      if (input.clear?.includes(f.name)) continue;
      if (typed) {
        const problem = f.check?.(typed);
        if (problem) issues.push({ path: f.name, message: `${f.label} ${problem}` });
        next[f.name] = typed;
      } else if (f.secret || typed === undefined) {
        // Secrets left empty keep the saved value; so does any field the request does not mention.
        if (before[f.name]) next[f.name] = before[f.name]!;
      }
    }
    if (issues.length) throw new BadRequestException({ message: 'Some values are not valid', issues });

    if (input.enabled) {
      const c = config();
      const missing = def.fields.filter((f) => f.required && !next[f.name] && !f.fromEnv(c) && !f.fallback?.(c));
      if (missing.length)
        throw new BadRequestException({
          message: `Fill in ${missing.map((f) => f.label).join(', ')} before turning ${def.name} on`,
          issues: missing.map((f) => ({ path: f.name, message: 'Required' })),
        });
    }

    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const f of def.fields) if (next[f.name]) (f.secret ? secrets : settings)[f.name] = next[f.name]!;
    const data = {
      enabled: input.enabled,
      settings: settings as Prisma.InputJsonValue,
      secretsSealed: Object.keys(secrets).length ? this.box.seal(JSON.stringify(secrets)) : null,
      updatedById: user.id,
    };
    const wasOn = integration(key).enabled;
    await this.prisma.platformIntegration.upsert({ where: { key }, create: { key, ...data }, update: data });

    // The audit log says what changed, never the secret values themselves.
    const changed = def.fields
      .filter((f) => (before[f.name] ?? '') !== (next[f.name] ?? ''))
      .map((f) => ({ field: f.name, ...(f.secret ? { secret: true } : { from: before[f.name] ?? null, to: next[f.name] ?? null }) }));
    await this.refresh();
    const after = integration(key);
    await this.audit.record(user, 'platform.integration_saved', 'integration', key, {
      enabledBefore: wasOn,
      enabledAfter: after.enabled,
      changed,
    });
    this.log.log(`${def.name} saved by ${user.id}: ${after.enabled ? 'on' : 'off'}, ${changed.length} field(s) changed`);
    return this.view(key);
  }

  /** Forget everything saved in the CRM for this integration: it runs from the environment again. */
  async reset(user: AuthUser, key: string) {
    await this.operatorAdmin(user);
    if (!isIntegrationKey(key)) throw new NotFoundException('No such integration');
    await this.prisma.platformIntegration.deleteMany({ where: { key } });
    await this.refresh();
    await this.audit.record(user, 'platform.integration_reset', 'integration', key, { enabledAfter: integration(key).enabled });
    return this.view(key);
  }

  /**
   * Test the connection with the saved settings, or with values typed but not saved yet (secrets left
   * empty use the saved ones). Nothing is stored; the attempt and its outcome are audited.
   */
  async test(user: AuthUser, key: string, typed: Record<string, string | undefined> = {}) {
    await this.operatorAdmin(user);
    if (!isIntegrationKey(key)) throw new NotFoundException('No such integration');
    const def = INTEGRATIONS[key];
    await this.refresh();
    const values = { ...integration(key).values };
    for (const f of def.fields) {
      const v = typed[f.name]?.trim();
      if (!v) continue;
      const problem = f.check?.(v);
      if (problem)
        throw new BadRequestException({
          message: 'Some values are not valid',
          issues: [{ path: f.name, message: `${f.label} ${problem}` }],
        });
      values[f.name] = v;
    }
    const missing = def.fields.filter((f) => f.required && !values[f.name]);
    const result = missing.length
      ? { ok: false, message: `Fill in ${missing.map((f) => f.label).join(', ')} first.` }
      : await checkIntegration(key, values);
    await this.audit.record(user, 'platform.integration_tested', 'integration', key, { ok: result.ok, message: result.message });
    return { ...result, testedAt: new Date() };
  }
}
