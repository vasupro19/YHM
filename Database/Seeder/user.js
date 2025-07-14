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

    const userConfig = [
      {
        userId: 1,
        menuId: 1
      },
      {
        userId: 1,
        menuId: 2
      },
      {
        userId: 1,
        menuId: 3
      },
      {
        userId: 1,
        menuId: 4
      },
      {
        userId: 1,
        menuId: 5
      },
      {
        userId: 1,
        menuId: 6
      }
    ];

    await prisma.user.deleteMany();
    await prisma.userConfig.deleteMany();
    console.log('User table cleared.');

    // Insert new user
    await prisma.user.create({ data });
    await prisma.userConfig.createMany({
      data: userConfig,
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
