import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, RoleName } from './auth.types';

export const IS_PUBLIC = 'zapx:isPublic';
export const ROLES = 'zapx:roles';

/** Skip authentication (respondent-facing and login endpoints). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict an endpoint to the listed roles. */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES, roles);

/** Roles allowed to change surveys, projects and vendors. */
export const CAN_EDIT: RoleName[] = ['ADMIN', 'PROGRAMMER'];

/** Every role, including field interviewers (who can otherwise only reach endpoints that name them). */
export const ALL_ROLES: RoleName[] = ['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER'];

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
