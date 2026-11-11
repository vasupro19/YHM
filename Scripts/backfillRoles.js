// Adds the standard hotel roles to every existing client. Safe to run again.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { ensureStandardRoles } = require('../Helpers/rolePresets.helper');

(async () => {
  const prisma = new PrismaClient();
  const clients = await prisma.client.findMany({ select: { id: true, name: true } });
  for (const c of clients) {
    await ensureStandardRoles(prisma, c.id);
    console.log(`Roles ready for ${c.name}`);
  }
  await prisma.$disconnect();
})();
