/**
 * Project-level access (Milestone 6). Every lookup of a project, survey or vendor on behalf of a
 * member goes through these filters, so a member with ASSIGNED scope sees only the projects they
 * were added to, and anything else looks like it does not exist (404, never 403, so ids are not
 * confirmed). Admins and members with ALL scope see the whole organization.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@zapx/db';
import type { AuthUser } from '../auth/auth.types';

export const isScoped = (user: Pick<AuthUser, 'role' | 'projectScope'>) => user.role !== 'ADMIN' && user.projectScope === 'ASSIGNED';

@Injectable()
export class AccessService {
  projects(user: AuthUser): Prisma.ProjectWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { members: { some: { userId: user.id } } } : {}) };
  }

  surveys(user: AuthUser): Prisma.SurveyWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { project: { members: { some: { userId: user.id } } } } : {}) };
  }

  vendors(user: AuthUser): Prisma.VendorWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { project: { members: { some: { userId: user.id } } } } : {}) };
  }
}
