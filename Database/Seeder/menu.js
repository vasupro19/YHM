const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const data = [
  {
    label: 'Department',
    icon: 'BlurOn',
    url: '/master/department',
    group: 'master'
  },
  {
    label: 'Role',
    icon: 'BlurOn',
    url: '/master/role',
    group: 'master'
  },
  {
    label: 'Category',
    icon: 'BlurOn',
    url: '/master/category',
    group: 'master'
  },
  {
    label: 'User',
    icon: 'BlurOn',
    url: '/master/user',
    group: 'master'
  },
  {
    label: 'Client',
    icon: 'BlurOn',
    url: '/master/client',
    group: 'master'
  },
  {
    label: 'Task',
    icon: 'Memory',
    url: '/process/task',
    group: 'process'
  }
];

const init = async () => {
  try {
    console.log('🚀 Running Menu Seeder...');

    await prisma.menu.deleteMany();
    console.log('✅ Cleared existing menu data');

    await prisma.menu.createMany({
      data,
      skipDuplicates: true
    });

    console.log('✅ Menu seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding menu:', error.message);
    process.exit(1);
  }
};

init();
