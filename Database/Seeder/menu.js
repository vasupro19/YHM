const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const data = [
  // ---- front desk ----
  { label: 'Calendar', icon: 'CalendarMonth', url: '/hotel/calendar', group: 'frontdesk' },
  { label: 'Bookings', icon: 'BookOnline', url: '/hotel/bookings', group: 'frontdesk' },
  { label: 'Guests', icon: 'People', url: '/hotel/customers', group: 'frontdesk' },
  // ---- property ----
  { label: 'Rooms', icon: 'Hotel', url: '/hotel/rooms', group: 'property' },
  { label: 'Room types & rates', icon: 'Sell', url: '/hotel/room-types', group: 'property' },
  // ---- people ----
  { label: 'Staff', icon: 'Badge', url: '/hotel/staff', group: 'people' },
  { label: 'Payroll', icon: 'Payments', url: '/hotel/payroll', group: 'people' },
  // ---- insights ----
  { label: 'Reports', icon: 'Assessment', url: '/hotel/reports', group: 'reports' },
  // ---- setup ----
  { label: 'Hotel settings', icon: 'Settings', url: '/hotel/settings', group: 'master' },
  { label: 'Activity log', icon: 'History', url: '/hotel/activity', group: 'master' },
  { label: 'Import data', icon: 'Upload', url: '/hotel/import', group: 'master' },
  { label: 'Role', icon: 'BlurOn', url: '/master/role', group: 'master' },
  { label: 'User', icon: 'BlurOn', url: '/master/user', group: 'master' },
  { label: 'Client', icon: 'BlurOn', url: '/master/client', group: 'master' }
];

// menus of the old task tool; they mean nothing for a hotel and are removed everywhere
const retired = ['/master/department', '/master/category', '/process/task'];

const init = async () => {
  try {
    console.log('🚀 Running Menu Seeder...');

    const gone = await prisma.menu.findMany({ where: { url: { in: retired } }, select: { id: true } });
    if (gone.length) {
      const ids = gone.map((m) => m.id);
      await prisma.userConfig.deleteMany({ where: { menuId: { in: ids } } });
      await prisma.menu.deleteMany({ where: { id: { in: ids } } });
      console.log(`🧹 Removed ${gone.length} unused menus`);
    }

    // safe to run again: menus are matched by url, so existing menu ids and user access are kept
    for (const item of data) {
      await prisma.menu.upsert({ where: { url: item.url }, update: { label: item.label, icon: item.icon, group: item.group }, create: item });
    }

    // every client account gets any menu it doesn't have yet (their staff are configured by the client)
    // the Client screen is for the platform admin only
    const adminOnly = await prisma.menu.findMany({ where: { url: '/master/client' }, select: { id: true } });
    const menus = await prisma.menu.findMany({ where: { url: { not: '/master/client' } }, select: { id: true } });
    const clientRole = await prisma.role.findFirst({ where: { name: 'CLIENT' } });
    const owners = clientRole ? await prisma.user.findMany({ where: { roleId: clientRole.id }, select: { id: true } }) : [];
    const adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
    const admins = adminRole ? await prisma.user.findMany({ where: { roleId: adminRole.id }, select: { id: true } }) : [];
    await prisma.userConfig.deleteMany({ where: { menuId: { in: adminOnly.map((m) => m.id) }, userId: { notIn: admins.map((a) => a.id) } } });
    for (const owner of owners) {
      const have = (await prisma.userConfig.findMany({ where: { userId: owner.id }, select: { menuId: true } })).map((c) => c.menuId);
      const missing = menus.filter((m) => !have.includes(m.id));
      if (missing.length) await prisma.userConfig.createMany({ data: missing.map((m) => ({ userId: owner.id, menuId: m.id })) });
    }

    console.log('✅ Menu seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding menu:', error.message);
    process.exit(1);
  }
};

init();
