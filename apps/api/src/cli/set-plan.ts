/**
 * Operator command: set an organization's plan (Milestone 8). There is no billing integration, so a
 * person running ZAPX decides plans with this command, and it is recorded in the audit log.
 *
 *   node apps/api/dist/cli/set-plan.js <organization id | member email> <free|team|business|enterprise>
 */
import { PrismaClient } from '@zapx/db';
import { PLAN_CODES, PLANS, isPlanCode } from '../plans/plans';

async function main() {
  const [who, plan] = process.argv.slice(2);
  if (!who || !plan || !isPlanCode(plan)) {
    console.error(`Usage: set-plan <organization id | member email> <${PLAN_CODES.join('|')}>`);
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const tenant = who.includes('@')
      ? (await prisma.user.findUnique({ where: { email: who.toLowerCase() }, select: { tenant: true } }))?.tenant
      : await prisma.tenant.findUnique({ where: { id: who } });
    if (!tenant) {
      console.error(`No organization found for ${who}`);
      process.exit(1);
    }
    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenant.id }, data: { plan } }),
      prisma.auditEvent.create({
        data: {
          tenantId: tenant.id,
          actorId: null,
          action: 'plan.change',
          entityType: 'tenant',
          entityId: tenant.id,
          data: { from: tenant.plan, to: plan, via: 'cli' },
        },
      }),
    ]);
    process.stdout.write(`${tenant.name}: ${tenant.plan} -> ${plan} (${PLANS[plan].name})\n`);
    process.stdout.write('Existing members, surveys and data are kept. New members, live surveys and interviews follow the new limits.\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
