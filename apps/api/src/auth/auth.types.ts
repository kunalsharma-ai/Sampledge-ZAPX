export type RoleName = 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';

export interface AuthUser {
  id: string;
  tenantId: string;
  role: RoleName;
  email: string;
}

export const AUTH_COOKIE = 'zapx_token';
/** Mutating requests authenticated by cookie must carry this header (CSRF protection). */
export const CSRF_HEADER = 'x-zapx-csrf';
