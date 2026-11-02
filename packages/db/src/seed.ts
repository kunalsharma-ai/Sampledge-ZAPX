/**
 * Development seed: one tenant with an admin user. Never run against production.
 *   SEED_EMAIL / SEED_PASSWORD override the defaults.
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
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
