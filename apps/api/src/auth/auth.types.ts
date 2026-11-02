export type RoleName = 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
export type ProjectScopeName = 'ALL' | 'ASSIGNED';

export interface AuthUser {
  id: string;
  tenantId: string;
  role: RoleName;
  email: string;
  /** ALL: every project in the organization. ASSIGNED: only projects the member was added to. */
  projectScope: ProjectScopeName;
  /** Set when the request is authenticated with an organization API key (Milestone 6). */
  apiKeyId?: string;
}

export const AUTH_COOKIE = 'zapx_token';
/** Mutating requests authenticated by cookie must carry this header (CSRF protection). */
export const CSRF_HEADER = 'x-zapx-csrf';
/** Organization API keys look like zapx_<prefix>_<secret> and are sent as Bearer tokens. */
export const API_KEY_PREFIX = 'zapx_';

const RANK: Record<RoleName, number> = { INTERVIEWER: 0, VIEWER: 1, PROGRAMMER: 2, ADMIN: 3 };
/** The less powerful of two roles (an API key never exceeds its creator). */
export function lowerRole(a: RoleName, b: RoleName): RoleName {
  return RANK[a] <= RANK[b] ? a : b;
}
