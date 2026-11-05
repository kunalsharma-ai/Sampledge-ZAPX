/**
 * Operator command: choose the organization that runs this installation, whose administrators manage
 * Settings > Integrations. Normally not needed: the first organization created is the operator. Use it
 * to hand the installation over to another organization. Recorded in the audit log of both.
 *
 *   node apps/api/dist/cli/set-operator.js <organization id | member email>
 *
 * Prints the previous operator's id, so the change can be undone.
 */
import '../database-url';
import { PrismaClient } from '@zapx/db';

async function main() {
  const [who] = process.argv.slice(2);
  if (!who) {
    console.error('Usage: set-operator <organization id | member email>');
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
    const before = await prisma.tenant.findMany({ where: { platformOperator: true }, select: { id: true } });
    const audit = (tenantId: string, action: string) =>
      prisma.auditEvent.create({
        data: { tenantId, actorId: null, action, entityType: 'tenant', entityId: tenantId, data: { to: tenant.id, via: 'cli' } },
      });
    await prisma.$transaction([
      prisma.tenant.updateMany({ where: { platformOperator: true }, data: { platformOperator: false } }),
      prisma.tenant.update({ where: { id: tenant.id }, data: { platformOperator: true } }),
      ...before.filter((t) => t.id !== tenant.id).map((t) => audit(t.id, 'platform.operator_removed')),
      audit(tenant.id, 'platform.operator_set'),
    ]);
    process.stdout.write(`${tenant.name} (${tenant.id}) now runs this installation and manages Settings > Integrations.\n`);
    process.stdout.write(`previous=${before.map((t) => t.id).join(',')}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
