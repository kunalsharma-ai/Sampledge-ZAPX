/**
 * Operator command (Milestone 13): apply database migrations, then exit. The ECS migration task runs
 * it before each release; it accepts DATABASE_URL or the DB_* parts (see database-url.ts).
 *
 *   node apps/api/dist/cli/migrate.js
 */
import '../database-url';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const prisma = resolve(root, 'packages/db/node_modules/.bin/prisma');
const r = spawnSync(prisma, ['migrate', 'deploy', '--schema', resolve(root, 'packages/db/prisma/schema.prisma')], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(r.status ?? 1);
