/**
 * Operator command: make a member the super admin of this installation (or remove it with --remove).
 * The member must belong to the organization that runs the installation (see set-operator); when no
 * organization is marked yet, the member's organization becomes the operator. Recorded in the audit log.
 *
 *   node apps/api/dist/cli/set-super-admin.js <member email> [--remove]
 */
import '../database-url';
import { PrismaClient } from '@zapx/db';

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => a.includes('@'))?.toLowerCase();
  const remove = args.includes('--remove');
  if (!email) {
    console.error('Usage: set-super-admin <member email> [--remove]');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
    if (!user) {
      console.error(`No member with the email ${email}`);
      process.exit(1);
    }
    if (!remove && !user.tenant.platformOperator) {
      if (await prisma.tenant.count({ where: { platformOperator: true } })) {
        console.error(`${email} is not in the organization that runs this installation. Run set-operator first if that should change.`);
        process.exit(1);
      }
      await prisma.tenant.update({ where: { id: user.tenantId }, data: { platformOperator: true } });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { superAdmin: !remove, ...(remove ? {} : { role: 'ADMIN', disabledAt: null }) } }),
      prisma.auditEvent.create({
        data: {
          tenantId: user.tenantId,
          actorId: null,
          action: remove ? 'super.super_admin_removed' : 'super.super_admin_set',
          entityType: 'user',
          entityId: user.id,
          data: { via: 'cli', email },
        },
      }),
    ]);
    process.stdout.write(`${email} is ${remove ? 'no longer' : 'now'} a super admin.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
