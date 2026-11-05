import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { parseBody } from '../common/validation';
import { ALL_ROLES, CurrentUser, Roles } from '../auth/decorators';
import { CLIENT_HEADER, type AuthUser } from '../auth/auth.types';
import { SuperAdminService } from './super-admin.service';
import { EntitlementsService } from './entitlements.service';
import { PlatformAutomationService } from './platform-automation.service';
import { FEATURES, isSurface, type Surface } from './features';
import { ACTION_LABELS, TEMPLATES, TRIGGERS, automationSchema } from './platform-automation';
import {
  activitySchema,
  createOrgSchema,
  createUserSchema,
  featureChangeSchema,
  newPlanSchema,
  orgPatchSchema,
  overridesSchema,
  planSchema,
  suspendSchema,
  userPatchSchema,
} from './super-admin.schemas';

/** How often an open entitlements stream re-checks the database (changes made by other processes). */
const STREAM_CHECK_MS = 3_000;
const STREAM_PING_MS = 25_000;

const surfaceOf = (q: unknown, header: unknown): Surface => (isSurface(q) ? q : header === 'mobile' ? 'mobile' : 'web');

/**
 * What every signed-in member can ask about their own features (the web CRM and the mobile app use
 * these to show or hide screens). Reachable even when the organization is suspended.
 */
@Controller()
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /** The feature catalog: every key with its label, group and the surfaces it exists on. */
  @Get('features')
  @Roles(...ALL_ROLES)
  features() {
    return FEATURES.map(({ key, label, group, description, surfaces }) => ({ key, label, group, description, surfaces }));
  }

  /** The member's features for ?surface=web|mobile (default: the X-ZAPX-Client header, else web). ETag = version. */
  @Get('me/entitlements')
  @Roles(...ALL_ROLES)
  async mine(
    @CurrentUser() user: AuthUser,
    @Query('surface') surface: unknown,
    @Headers(CLIENT_HEADER) client: unknown,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ent = await this.entitlements.forUser(user.id, surfaceOf(surface, client));
    const etag = `"${ent.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
      res.status(304);
      return undefined;
    }
    return ent;
  }

  /** Server-sent events: "entitlements" with the same body as GET me/entitlements, whenever it changes. */
  @Get('me/entitlements/stream')
  @Roles(...ALL_ROLES)
  @SkipThrottle()
  async stream(
    @CurrentUser() user: AuthUser,
    @Query('surface') surface: unknown,
    @Headers(CLIENT_HEADER) client: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const s = surfaceOf(surface, client);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let last = '';
    let closed = false;
    const push = async () => {
      if (closed) return;
      try {
        const ent = await this.entitlements.forUser(user.id, s);
        if (ent.version === last || closed) return;
        last = ent.version;
        res.write(`event: entitlements\nid: ${ent.version}\ndata: ${JSON.stringify(ent)}\n\n`);
      } catch {
        // The member was deleted: end the stream.
        res.end();
      }
    };
    await push();
    const off = this.entitlements.onChange(() => void push());
    const check = setInterval(() => void push(), STREAM_CHECK_MS);
    const ping = setInterval(() => !closed && res.write(': ping\n\n'), STREAM_PING_MS);
    req.on('close', () => {
      closed = true;
      off();
      clearInterval(check);
      clearInterval(ping);
    });
  }
}

/**
 * The super admin console's API. The auth guard lets only a signed-in super admin (never an API key)
 * reach any route of this controller.
 */
@Controller('super')
export class SuperAdminController {
  constructor(
    private readonly svc: SuperAdminService,
    private readonly automation: PlatformAutomationService,
  ) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  // Plans
  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Post('plans')
  createPlan(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.createPlan(user, parseBody(newPlanSchema, body));
  }

  @Put('plans/:code')
  updatePlan(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: unknown) {
    return this.svc.updatePlan(user, code, parseBody(planSchema, body));
  }

  @Delete('plans/:code')
  @HttpCode(204)
  deletePlan(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.svc.deletePlan(user, code);
  }

  // Organizations
  @Get('organizations')
  organizations(@Query('q') q?: string, @Query('status') status?: string) {
    return this.svc.listOrganizations(q?.slice(0, 120), status?.slice(0, 20));
  }

  @Post('organizations')
  createOrganization(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.createOrganization(user, parseBody(createOrgSchema, body));
  }

  @Get('organizations/:id')
  organization(@Param('id') id: string) {
    return this.svc.organization(id);
  }

  @Patch('organizations/:id')
  updateOrganization(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.updateOrganization(user, id, parseBody(orgPatchSchema, body));
  }

  @Put('organizations/:id/features')
  setFeatures(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.setOrganizationFeatures(user, id, parseBody(overridesSchema, body));
  }

  @Patch('organizations/:id/features')
  setFeature(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.setOrganizationFeature(user, id, parseBody(featureChangeSchema, body));
  }

  @Post('organizations/:id/suspend')
  @HttpCode(204)
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.suspend(user, id, parseBody(suspendSchema, body ?? {}).reason);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(204)
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.reactivate(user, id);
  }

  @Post('organizations/:id/members')
  createMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.createUser(user, id, parseBody(createUserSchema, body));
  }

  // Members
  @Get('users')
  users(@Query('q') q?: string, @Query('tenantId') tenantId?: string) {
    return this.svc.listUsers(q?.slice(0, 120), tenantId?.slice(0, 64));
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.updateUser(user, id, parseBody(userPatchSchema, body));
  }

  @Post('users/:id/password-reset')
  resetLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.userResetLink(user, id);
  }

  // Activity and integrations
  @Get('activity')
  activity(@Query() query: unknown) {
    return this.svc.activity(parseBody(activitySchema, query));
  }

  @Get('integrations')
  integrations(@CurrentUser() user: AuthUser) {
    return this.svc.integrationsOverview(user);
  }

  // Automation
  @Get('automation/vocabulary')
  vocabulary() {
    return {
      triggers: Object.entries(TRIGGERS).map(([key, t]) => ({ key, ...t })),
      actions: Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label })),
      templates: TEMPLATES,
    };
  }

  @Get('automation/rules')
  rules() {
    return this.automation.list();
  }

  @Post('automation/rules')
  createRule(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.automation.create(user, parseBody(automationSchema, body));
  }

  @Patch('automation/rules/:id')
  updateRule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.automation.update(user, id, parseBody(automationSchema.partial(), body));
  }

  @Delete('automation/rules/:id')
  @HttpCode(204)
  deleteRule(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.remove(user, id);
  }

  @Get('automation/rules/:id/preview')
  preview(@Param('id') id: string) {
    return this.automation.preview(id);
  }

  /** Run every enabled rule (or one, with ?rule=) now instead of waiting for the schedule. */
  @Post('automation/run')
  @HttpCode(200)
  async runNow(@Query('rule') rule?: string) {
    return { fired: await this.automation.sweep(rule?.slice(0, 64)) };
  }

  @Get('automation/runs')
  runs(@Query('rule') rule?: string) {
    return this.automation.runs(rule?.slice(0, 64));
  }
}
