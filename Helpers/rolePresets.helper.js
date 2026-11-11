const { ROLE_PRESETS } = require('../Constants/rolePresets');

// makes sure the standard hotel roles exist and are available to this client
const ensureStandardRoles = async (prisma, clientId) => {
  for (const name of Object.keys(ROLE_PRESETS)) {
    let role = await prisma.role.findFirst({ where: { name } });
    if (!role) role = await prisma.role.create({ data: { name } });
    const mapped = await prisma.clientRoleMapping.findFirst({ where: { clientId, roleId: role.id } });
    if (!mapped) await prisma.clientRoleMapping.create({ data: { clientId, roleId: role.id } });
  }
};

// gives a new staff login the screens that suit their role, limited to what their hotel itself has
const applyRoleMenus = async (prisma, user) => {
  const role = await prisma.role.findUnique({ where: { id: user.roleId } });
  const urls = ROLE_PRESETS[role?.name];
  if (!urls || !user.clientId) return;
  const owner = await prisma.user.findFirst({ where: { clientId: user.clientId, role: { name: 'CLIENT' } } });
  const ownerMenus = owner ? (await prisma.userConfig.findMany({ where: { userId: owner.id }, select: { menu: { select: { id: true, url: true } } } })).map((c) => c.menu) : [];
  const menus = ownerMenus.filter((m) => urls.includes(m.url));
  if (menus.length) await prisma.userConfig.createMany({ data: menus.map((m) => ({ userId: user.id, menuId: m.id })) });
};

module.exports = { ensureStandardRoles, applyRoleMenus };
