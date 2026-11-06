import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { Response } from 'express';
import type { Role, User } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlanService } from '../plans/plan.service';
import { Public } from '../auth/decorators';
import { config } from '../config';
import { scopeFor } from '../users/users.controller';
import { ScimGuard, type ScimRequest } from './scim.guard';
import { SCIM_CONTENT_TYPE, ScimError, ScimExceptionFilter } from './scim.errors';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ROLES: Record<string, Role> = { admin: 'ADMIN', programmer: 'PROGRAMMER', viewer: 'VIEWER', interviewer: 'INTERVIEWER' };
const MAX_PAGE = 200;

interface ScimUserInput {
  userName?: unknown;
  externalId?: unknown;
  displayName?: unknown;
  name?: { formatted?: unknown; givenName?: unknown; familyName?: unknown };
  emails?: Array<{ value?: unknown; primary?: unknown }>;
  active?: unknown;
  roles?: Array<{ value?: unknown; primary?: unknown }> | unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
/** Identity providers send booleans as true/false or "True"/"False". */
const bool = (v: unknown) => (typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : undefined);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailOf(input: ScimUserInput): string | undefined {
  const primary = input.emails?.find((e) => bool(e.primary)) ?? input.emails?.[0];
  const candidate = (str(input.userName) ?? str(primary?.value))?.toLowerCase();
  return candidate && EMAIL.test(candidate) ? candidate : undefined;
}
function nameOf(input: ScimUserInput): string | undefined {
  const joined = [str(input.name?.givenName), str(input.name?.familyName)].filter(Boolean).join(' ');
  return (str(input.displayName) || str(input.name?.formatted) || joined || undefined)?.slice(0, 120);
}
function roleOf(roles: unknown): Role | undefined {
  if (!Array.isArray(roles) || !roles.length) return undefined;
  const r = (roles as Array<{ value?: unknown; primary?: unknown }>).find((x) => bool(x.primary)) ?? roles[0];
  const value = str((r as { value?: unknown })?.value)?.toLowerCase();
  if (!value) return undefined;
  const role = ROLES[value];
  if (!role) throw new ScimError(400, `Unknown role "${value}". Use admin, programmer, viewer or interviewer.`, 'invalidValue');
  return role;
}

/**
 * SCIM 2.0 user provisioning (RFC 7643/7644), Milestone 8. Lets an identity provider create, update
 * and deactivate SampCode members. Groups are not supported; the role comes from the user's `roles`.
 * Deleting a user disables them (history and audit stay attached to the account).
 */
@Public()
@UseGuards(ScimGuard)
@UseFilters(ScimExceptionFilter)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
@Controller('scim/v2')
export class ScimController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
  ) {}

  private base() {
    return `${config().STUDIO_URL.replace(/\/$/, '')}/api/scim/v2`;
  }

  private present(u: User) {
    const [givenName, ...rest] = u.name.split(' ');
    return {
      schemas: [USER_SCHEMA],
      id: u.id,
      ...(u.scimExternalId ? { externalId: u.scimExternalId } : {}),
      userName: u.email,
      displayName: u.name,
      name: { formatted: u.name, givenName, familyName: rest.join(' ') || undefined },
      emails: [{ value: u.email, type: 'work', primary: true }],
      active: !u.disabledAt,
      roles: [{ value: u.role.toLowerCase(), primary: true }],
      meta: { resourceType: 'User', created: u.createdAt.toISOString(), location: `${this.base()}/Users/${u.id}` },
    };
  }

  private send(res: Response, status: number, body: unknown) {
    res.status(status).type(SCIM_CONTENT_TYPE).send(JSON.stringify(body));
  }

  private async find(tenantId: string, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!u) throw new ScimError(404, 'User not found');
    return u;
  }

  private actor(tenantId: string) {
    return { tenantId, id: null };
  }

  // ---- Discovery ------------------------------------------------------------------------------

  @Get('ServiceProviderConfig')
  config(@Res() res: Response) {
    this.send(res, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://github.com/kunalsharma-ai/Sampledge-ZAPX/blob/main/docs/modules/sso-scim-plans.md',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_PAGE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        { type: 'oauthbearertoken', name: 'Bearer token', description: 'The SCIM token from SampCode settings', primary: true },
      ],
    });
  }

  @Get('ResourceTypes')
  resourceTypes(@Res() res: Response) {
    this.send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: USER_SCHEMA,
        },
      ],
    });
  }

  @Get('Schemas')
  schemas(@Res() res: Response) {
    const attr = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      type: 'string',
      multiValued: false,
      required: false,
      ...extra,
    });
    this.send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      Resources: [
        {
          id: USER_SCHEMA,
          name: 'User',
          attributes: [
            attr('userName', { required: true, uniqueness: 'server' }),
            attr('displayName'),
            attr('externalId'),
            attr('active', { type: 'boolean' }),
            attr('emails', { type: 'complex', multiValued: true }),
            attr('roles', { type: 'complex', multiValued: true, canonicalValues: Object.keys(ROLES) }),
          ],
        },
      ],
    });
  }

  // ---- Users ----------------------------------------------------------------------------------

  @Get('Users')
  async list(
    @Req() req: ScimRequest,
    @Res() res: Response,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndexRaw?: string,
    @Query('count') countRaw?: string,
  ) {
    const tenantId = req.scimTenantId!;
    const where: Record<string, unknown> = { tenantId };
    if (filter) {
      // Identity providers look users up with a single equality filter.
      const m = /^\s*(userName|externalId|emails(?:\.value)?|id)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
      if (!m) throw new ScimError(400, 'Only filters like userName eq "a@b.com" or externalId eq "x" are supported', 'invalidFilter');
      const [, attr, value] = m as unknown as [string, string, string];
      const key = attr.toLowerCase();
      if (key === 'externalid') where.scimExternalId = value;
      else if (key === 'id') where.id = value;
      else where.email = value.toLowerCase();
    }
    const startIndex = Math.max(1, Number(startIndexRaw) || 1);
    const count = Math.min(MAX_PAGE, Math.max(0, countRaw === undefined ? 100 : Number(countRaw) || 0));
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: startIndex - 1, take: count }),
    ]);
    this.send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map((u) => this.present(u)),
    });
  }

  @Get('Users/:id')
  async get(@Req() req: ScimRequest, @Res() res: Response, @Param('id') id: string) {
    this.send(res, 200, this.present(await this.find(req.scimTenantId!, id)));
  }

  @Post('Users')
  async create(@Req() req: ScimRequest, @Res() res: Response, @Body() body: ScimUserInput) {
    const tenantId = req.scimTenantId!;
    const email = emailOf(body ?? {});
    if (!email) throw new ScimError(400, 'userName must be an email address', 'invalidValue');
    const role = roleOf(body.roles) ?? 'VIEWER';
    const active = bool(body.active) ?? true;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ScimError(409, 'A user with this userName already exists', 'uniqueness');
    if (active) await this.plans.assertSeat(tenantId, role);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: nameOf(body) ?? email,
        role,
        projectScope: scopeFor(role, 'ALL'),
        scimExternalId: str(body.externalId) ?? null,
        disabledAt: active ? null : new Date(),
        // Provisioned members sign in with single sign-on; this password cannot be guessed or used.
        passwordHash: await hash(randomBytes(32).toString('base64url'), 10),
      },
    });
    await this.audit.record(this.actor(tenantId), 'scim.user_create', 'user', user.id, { email, role, active, via: 'scim' });
    this.send(res, 201, this.present(user));
  }

  @Put('Users/:id')
  async replace(@Req() req: ScimRequest, @Res() res: Response, @Param('id') id: string, @Body() body: ScimUserInput) {
    const before = await this.find(req.scimTenantId!, id);
    const email = emailOf(body ?? {});
    if (!email) throw new ScimError(400, 'userName must be an email address', 'invalidValue');
    const updated = await this.apply(before, {
      email,
      name: nameOf(body),
      role: roleOf(body.roles),
      active: bool(body.active),
      externalId: str(body.externalId),
    });
    this.send(res, 200, this.present(updated));
  }

  @Patch('Users/:id')
  async patch(
    @Req() req: ScimRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: { schemas?: string[]; Operations?: Array<{ op?: string; path?: string; value?: unknown }> },
  ) {
    const before = await this.find(req.scimTenantId!, id);
    if (!Array.isArray(body?.Operations) || (body.schemas && !body.schemas.includes(PATCH_SCHEMA))) {
      throw new ScimError(400, 'Send a PatchOp with Operations', 'invalidSyntax');
    }
    const change: Parameters<ScimController['apply']>[1] = {};
    for (const op of body.Operations) {
      const kind = String(op.op ?? '').toLowerCase();
      if (kind !== 'replace' && kind !== 'add' && kind !== 'remove') throw new ScimError(400, `Unsupported op "${op.op}"`, 'invalidSyntax');
      // Without a path the value is a partial user; with one, a single attribute.
      const values: Record<string, unknown> = op.path ? { [op.path]: op.value } : ((op.value as Record<string, unknown>) ?? {});
      for (const [rawPath, value] of Object.entries(values)) {
        const path = rawPath.toLowerCase();
        if (kind === 'remove' && path !== 'roles') throw new ScimError(400, `Cannot remove ${rawPath}`, 'mutability');
        if (path === 'active') change.active = bool(value);
        else if (path === 'username' || /^emails(\[.*\])?(\.value)?$/.test(path)) {
          const v = Array.isArray(value) ? str((value[0] as { value?: unknown })?.value) : str(value);
          if (!v || !EMAIL.test(v)) throw new ScimError(400, `${rawPath} must be an email address`, 'invalidValue');
          change.email = v.toLowerCase();
        } else if (path === 'displayname' || path === 'name.formatted') change.name = str(value)?.slice(0, 120);
        else if (path === 'name.givenname' || path === 'name.familyname') {
          const parts = { given: before.name.split(' ')[0] ?? '', family: before.name.split(' ').slice(1).join(' ') };
          if (path === 'name.givenname') parts.given = str(value) ?? '';
          else parts.family = str(value) ?? '';
          change.name = `${parts.given} ${parts.family}`.trim().slice(0, 120) || undefined;
        } else if (path === 'name' && value && typeof value === 'object') change.name = nameOf({ name: value as ScimUserInput['name'] });
        else if (path === 'externalid') change.externalId = str(value);
        else if (path === 'roles' || /^roles\[.*\](\.value)?$/.test(path)) {
          change.role = kind === 'remove' ? 'VIEWER' : roleOf(Array.isArray(value) ? value : [{ value }]);
        }
        // Other attributes (title, phone numbers, addresses...) are not stored and are ignored.
      }
    }
    this.send(res, 200, this.present(await this.apply(before, change)));
  }

  /** Deleting a user disables them; SampCode keeps the account so audit history stays attached. */
  @Delete('Users/:id')
  @HttpCode(204)
  async remove(@Req() req: ScimRequest, @Param('id') id: string) {
    const before = await this.find(req.scimTenantId!, id);
    await this.apply(before, { active: false });
  }

  private async apply(before: User, c: { email?: string; name?: string; role?: Role; active?: boolean; externalId?: string }) {
    const tenantId = before.tenantId;
    const role = c.role ?? before.role;
    const disabledAt = c.active === undefined ? before.disabledAt : c.active ? null : (before.disabledAt ?? new Date());
    if (c.email && c.email !== before.email && (await this.prisma.user.findUnique({ where: { email: c.email } }))) {
      throw new ScimError(409, 'A user with this userName already exists', 'uniqueness');
    }
    const kind = (r: Role) => (r === 'INTERVIEWER' ? 'i' : 's');
    if (!disabledAt && (before.disabledAt || kind(role) !== kind(before.role))) await this.plans.assertSeat(tenantId, role);
    const updated = await this.prisma.user.update({
      where: { id: before.id },
      data: {
        email: c.email ?? before.email,
        name: c.name ?? before.name,
        role,
        projectScope: scopeFor(role, before.projectScope),
        disabledAt,
        scimExternalId: c.externalId ?? before.scimExternalId,
      },
    });
    const changed: Record<string, unknown> = {};
    if (updated.email !== before.email) changed.email = { from: before.email, to: updated.email };
    if (updated.role !== before.role) changed.role = { from: before.role, to: updated.role };
    if (!!updated.disabledAt !== !!before.disabledAt) changed.active = !updated.disabledAt;
    if (updated.name !== before.name) changed.name = true;
    if (Object.keys(changed).length) {
      const action = 'active' in changed ? (changed.active ? 'scim.user_enable' : 'scim.user_disable') : 'scim.user_update';
      await this.audit.record(this.actor(tenantId), action, 'user', before.id, { ...changed, via: 'scim' });
    }
    return updated;
  }
}
