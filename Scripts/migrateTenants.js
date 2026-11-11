// Applies the tenant migrations (prisma/newDb/migrations) to every existing client database.
// usage: node Scripts/migrateTenants.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { runMigrationForDatabase } = require('../Helpers/db.helper');

(async () => {
  const prisma = new PrismaClient();
  const clients = await prisma.client.findMany({ select: { code: true, name: true } });
  for (const c of clients) {
    console.log(`Migrating ${c.name} (${c.code})`);
    await runMigrationForDatabase(c.code);
  }
  await prisma.$disconnect();
  console.log('Done');
})();
