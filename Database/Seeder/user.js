require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const AuthHelper = require('../../Helpers/auth.helper');

const prisma = new PrismaClient();

const init = async () => {
  try {
    console.log('Running Prisma Seeder!');

    const hashedPassword = await AuthHelper.generateHash('secret');

    const data = {
      name: 'Admin',
      email: 'admin@gmail.com',
      password: hashedPassword,
      roleId: 1
    };

    // the admin's screens are picked by address: menu ids differ from one database to another
    const adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
    if (!adminRole) throw new Error('Run the role seeder first');
    data.roleId = adminRole.id;
    const adminMenus = await prisma.menu.findMany({ where: { url: { in: ['/master/role', '/master/user', '/master/client'] } }, select: { id: true } });
    if (adminMenus.length !== 3) throw new Error('Run the menu seeder first');

    await prisma.user.deleteMany();
    await prisma.userConfig.deleteMany();
    console.log('User table cleared.');

    // Insert new user
    const admin = await prisma.user.create({ data });
    await prisma.userConfig.createMany({
      data: adminMenus.map((m) => ({ userId: admin.id, menuId: m.id })),
      skipDuplicates: true
    });
    console.log('Seeder record added!');

    console.log('DB seed complete');
  } catch (error) {
    console.error('Error seeding DB ::', error.message);
  } finally {
    await prisma.$disconnect();
    process.exit();
  }
};

init();
