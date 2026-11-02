/**
 * Builds DATABASE_URL from its parts when it is not set (Milestone 13). On AWS the database password
 * lives in the RDS-managed secret and reaches the task as DB_USER and DB_PASSWORD, so no one has to
 * copy it into a connection string. Imported first by every entry point (API, worker, CLI).
 */
export function databaseUrlFromParts(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL || !env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD) return env.DATABASE_URL;
  const url = new URL('postgresql://localhost');
  url.hostname = env.DB_HOST;
  url.port = env.DB_PORT ?? '5432';
  url.username = encodeURIComponent(env.DB_USER);
  url.password = encodeURIComponent(env.DB_PASSWORD);
  url.pathname = `/${encodeURIComponent(env.DB_NAME ?? 'zapx')}`;
  if (env.DB_SSLMODE) url.searchParams.set('sslmode', env.DB_SSLMODE);
  if (env.DB_CONNECTION_LIMIT) url.searchParams.set('connection_limit', env.DB_CONNECTION_LIMIT);
  return url.toString();
}

const built = databaseUrlFromParts(process.env);
if (built) process.env.DATABASE_URL = built;
