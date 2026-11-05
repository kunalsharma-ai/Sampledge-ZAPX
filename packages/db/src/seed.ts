/**
 * Development seed: one tenant with an admin user, and a super admin in the same (operator) tenant.
 * Never run against production.
 *   SEED_EMAIL / SEED_PASSWORD and SEED_SUPER_EMAIL / SEED_SUPER_PASSWORD override the defaults.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

async function main() {
  const prisma = new PrismaClient();
  const email = process.env.SEED_EMAIL ?? 'admin@zapx.local';
  const password = process.env.SEED_PASSWORD ?? 'zapx-admin-123';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed user ${email} already exists`);
  } else {
    const tenant = await prisma.tenant.create({ data: { name: 'Demo tenant' } });
    await prisma.user.create({
      data: { tenantId: tenant.id, email, name: 'Demo admin', role: 'ADMIN', passwordHash: await hash(password, 10) },
    });
    console.log(`Created ${email} / ${password}`);
  }
  const superEmail = process.env.SEED_SUPER_EMAIL ?? 'superadmin@zapx.local';
  const superPassword = process.env.SEED_SUPER_PASSWORD ?? 'zapx-super-123';
  if (await prisma.user.findUnique({ where: { email: superEmail } })) {
    console.log(`Seed super admin ${superEmail} already exists`);
  } else {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
    // The super admin belongs to the organization that runs the installation.
    if (!(await prisma.tenant.count({ where: { platformOperator: true } })))
      await prisma.tenant.update({ where: { id: admin.tenantId }, data: { platformOperator: true } });
    const operator = await prisma.tenant.findFirstOrThrow({ where: { platformOperator: true } });
    await prisma.user.create({
      data: {
        tenantId: operator.id,
        email: superEmail,
        name: 'Super admin',
        role: 'ADMIN',
        superAdmin: true,
        passwordHash: await hash(superPassword, 10),
      },
    });
    console.log(`Created super admin ${superEmail} / ${superPassword}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
