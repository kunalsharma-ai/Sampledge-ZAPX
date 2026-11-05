import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@zapx/db';
import { sanitizeAppearance, validateAppearance, type Appearance } from '@zapx/quantum';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ALL_ROLES, CurrentUser, Roles } from '../auth/decorators';

/** Stored JSON is `{}` until something is saved; anything else is read tolerantly. */
function storedAppearance(json: unknown): Appearance | null {
  if (!json || typeof json !== 'object' || Object.keys(json).length === 0) return null;
  return sanitizeAppearance(json);
}

function checked(body: unknown): Appearance {
  const appearance = (body as { appearance?: unknown } | null)?.appearance;
  const issues = validateAppearance(appearance);
  if (issues.length)
    throw new BadRequestException({ message: 'Invalid appearance', issues: issues.map((message) => ({ path: 'appearance', message })) });
  return sanitizeAppearance(appearance);
}

/**
 * Quantum Design System appearance. Every member keeps their own appearance (theme, mode, density,
 * motion...) across devices; admins set the organization default used until a member picks their own.
 */
@Controller()
@Roles(...ALL_ROLES)
export class PreferencesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The member's own appearance (null when never saved) and the organization default (null when unset). */
  @Get('me/preferences')
  async get(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { preferences: true, tenant: { select: { appearanceDefaults: true } } },
    });
    const prefs = (u.preferences ?? {}) as { appearance?: unknown };
    return { appearance: storedAppearance(prefs.appearance), organizationDefault: storedAppearance(u.tenant.appearanceDefaults) };
  }

  @Put('me/preferences')
  async put(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (user.apiKeyId) throw new ForbiddenException('Appearance belongs to a signed-in member, not an API key');
    const appearance = checked(body);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { preferences: true } });
    const preferences = { ...((u.preferences ?? {}) as Record<string, unknown>), appearance };
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: preferences as unknown as Prisma.InputJsonValue } });
    return { appearance };
  }

  /** Forget the member's own choice so the organization default applies again. */
  @Delete('me/preferences/appearance')
  @HttpCode(204)
  async reset(@CurrentUser() user: AuthUser) {
    if (user.apiKeyId) throw new ForbiddenException('Appearance belongs to a signed-in member, not an API key');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { preferences: true } });
    const rest = { ...((u.preferences ?? {}) as Record<string, unknown>) };
    delete rest.appearance;
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: rest as Prisma.InputJsonValue } });
  }

  @Put('tenant/appearance')
  @Roles('ADMIN')
  async putDefault(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const appearance = checked(body);
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { appearanceDefaults: appearance as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record(user, 'tenant.appearance_default_set', 'tenant', user.tenantId, {
      preset: appearance.preset,
      mode: appearance.mode,
    });
    return { organizationDefault: appearance };
  }

  @Delete('tenant/appearance')
  @Roles('ADMIN')
  @HttpCode(204)
  async clearDefault(@CurrentUser() user: AuthUser) {
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { appearanceDefaults: {} } });
    await this.audit.record(user, 'tenant.appearance_default_cleared', 'tenant', user.tenantId);
  }

  // ---- Blueprint phase 5: workspace presets ------------------------------------------------------
  // Named appearances (theme, mode, per-area families...) an administrator saves for everyone to pick.

  private async presets(tenantId: string): Promise<WorkspacePreset[]> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { appearancePresets: true } });
    return (Array.isArray(t.appearancePresets) ? t.appearancePresets : []).flatMap((p) => {
      const o = p as Partial<WorkspacePreset> | null;
      return o && typeof o.id === 'string' && typeof o.name === 'string'
        ? [{ id: o.id, name: o.name, appearance: sanitizeAppearance(o.appearance), createdAt: String(o.createdAt ?? '') }]
        : [];
    });
  }

  @Get('tenant/appearance-presets')
  list(@CurrentUser() user: AuthUser) {
    return this.presets(user.tenantId);
  }

  @Post('tenant/appearance-presets')
  @Roles('ADMIN')
  async addPreset(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name.trim() : '';
    if (!name || name.length > 60) throw new BadRequestException('Give the preset a name (up to 60 characters)');
    const appearance = checked(body);
    const list = await this.presets(user.tenantId);
    if (list.length >= MAX_PRESETS) throw new BadRequestException(`An organization can keep ${MAX_PRESETS} presets; delete one first`);
    if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new BadRequestException('A preset with this name exists');
    const preset: WorkspacePreset = { id: randomUUID(), name, appearance, createdAt: new Date().toISOString() };
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { appearancePresets: [...list, preset] as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record(user, 'tenant.appearance_preset_add', 'tenant', user.tenantId, { name, preset: appearance.preset });
    return preset;
  }

  @Delete('tenant/appearance-presets/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  async deletePreset(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const list = await this.presets(user.tenantId);
    const gone = list.find((p) => p.id === id);
    if (!gone) throw new NotFoundException('Preset not found');
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { appearancePresets: list.filter((p) => p.id !== id) as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record(user, 'tenant.appearance_preset_delete', 'tenant', user.tenantId, { name: gone.name });
  }
}

const MAX_PRESETS = 20;
interface WorkspacePreset {
  id: string;
  name: string;
  appearance: Appearance;
  createdAt: string;
}
