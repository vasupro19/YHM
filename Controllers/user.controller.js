const Response = require('../Helpers/response.helper');
const Logger = require('../Helpers/logger');
const AuthHelper = require('../Helpers/auth.helper');
const DB = require('../Helpers/crud.helper');
const { publicUser } = require('../Helpers/safeUser.helper');
const { applyRoleMenus } = require('../Helpers/rolePresets.helper');
const controllerName = 'user.controller';

const { PrismaClient } = require('@prisma/client');
const { ADMIN_ROLE_ID, CLIENT_ROLE_ID } = require('../Constants/constant');
const prisma = new PrismaClient();

// Create a new user
const createUser = async (req, res) => {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: req.body.email }
    });
    if (existingUser) {
      return Response.error(res, { message: 'Email already in use' });
    }

    const passwordHash = await AuthHelper.generateHash(req.body.password);
    const data = { ...req.body, password: passwordHash };

    // staff created by a client always belong to that client and can never be admin/client users
    if (Number(req.query.user_role) !== ADMIN_ROLE_ID) {
      const me = await DB.read(prisma.user, { id: Number(req.query.auth_user_id) });
      if ([ADMIN_ROLE_ID, CLIENT_ROLE_ID].includes(Number(data.roleId))) {
        return Response.badRequest(res, { message: 'You cannot create a user with this role' });
      }
      data.clientId = me.clientId;
    }

    const created = await DB.create(prisma.user, data);
    await applyRoleMenus(prisma, created);

    return Response.success(res, {
      data: {},
      message: 'User Created Successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at createUser function ' + controllerName);
    return Response.error(res, {
      message: error.message
    });
  }
};

// Get all users
const getUsers = async (req, res) => {
  try {
    const roleId = req.query.user_role;
    const logedInUserId = req.query.auth_user_id;

    delete req.query.auth_user_id;
    delete req.query.user_role;

    if (Number(roleId) === ADMIN_ROLE_ID) {
      req.query.roleId = { not: ADMIN_ROLE_ID };
    } else if (Number(roleId) === CLIENT_ROLE_ID) {
      req.query.roleId = { notIn: [ADMIN_ROLE_ID, CLIENT_ROLE_ID] };
      const user = await DB.read(prisma.user, { id: logedInUserId });
      req.query.clientId = user.clientId;
    }

    // only these filters may reach the database; never let the caller filter on password/token columns
    const allowedFilters = ['clientId', 'roleId', 'departmentId', 'active', 'email', 'name'];
    const where = {};
    Object.keys(req.query).forEach((key) => {
      if (allowedFilters.includes(key) || key === 'roleId') where[key] = req.query[key];
    });
    if (where.clientId !== undefined && typeof where.clientId !== 'object') where.clientId = Number(where.clientId);
    if (where.active !== undefined && typeof where.active !== 'object') where.active = where.active === 'true' || where.active === true;

    const userList = await DB.findDetails(prisma.user, where, ['role']);

    return Response.success(res, {
      data: userList.map(publicUser),
      message: 'Users Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getUsers function ' + controllerName);
    return Response.error(res, {
      message: error.message
    });
  }
};

// Update user information
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return Response.error(res, {
        message: 'User Id is required'
      });
    }

    const editable = ['name', 'email', 'phoneNumber', 'whatsAppNo', 'departmentId', 'roleId', 'active', 'password'];
    let data = { updatedAt: new Date() };
    editable.forEach((key) => {
      if (req.body[key] !== undefined && req.body[key] !== '') data[key] = req.body[key];
    });

    if (Number(req.query.user_role) !== ADMIN_ROLE_ID) {
      const me = await DB.read(prisma.user, { id: Number(req.query.auth_user_id) });
      const target = await DB.read(prisma.user, { id: parseInt(id) });
      if (!target || target.clientId !== me.clientId || [ADMIN_ROLE_ID, CLIENT_ROLE_ID].includes(target.roleId)) {
        return Response.unauthorized(res, { message: 'Access denied', status: 403 });
      }
      delete data.roleId;
      delete data.clientId;
    }

    if (data.password) {
      data.password = await AuthHelper.generateHash(data.password);
    }

    await DB.update(prisma.user, { id: parseInt(id) }, data);

    return Response.success(res, {
      data: {},
      message: 'User Updated Successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateUser function ' + controllerName);
    return Response.error(res, {
      message: error.message
    });
  }
};

// update the menu config of client
const updateMenuConfig = async (req, res) => {
  try {
    const { email, menuIds } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email }
    });

    if (!user) {
      return Response.error(res, { message: 'User Not Found' });
    }

    // a client can only change menu access of their own staff, and only to menus the client itself has
    if (Number(req.query.user_role) !== ADMIN_ROLE_ID) {
      const me = await DB.read(prisma.user, { id: Number(req.query.auth_user_id) });
      if (user.clientId !== me.clientId || user.id === me.id || [ADMIN_ROLE_ID, CLIENT_ROLE_ID].includes(user.roleId)) {
        return Response.unauthorized(res, { message: 'Access denied', status: 403 });
      }
      const mine = await DB.findDetails(prisma.userConfig, { userId: me.id });
      const allowed = mine.map((m) => m.menuId);
      if (!menuIds.every((id) => allowed.includes(Number(id)))) {
        return Response.unauthorized(res, { message: 'Access denied', status: 403 });
      }
    }

    await DB.remove(prisma.userConfig, { userId: user.id });

    await prisma.$transaction([
      prisma.userConfig.deleteMany({ where: { userId: user.id } }),
      prisma.userConfig.createMany({
        data: menuIds.map((menuId) => ({
          userId: user.id,
          menuId: Number(menuId)
        })),
        skipDuplicates: true
      })
    ]);

    return Response.success(res, {
      data: {},
      message: 'Menu Config Updated Successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateMenuConfig function ' + controllerName);
    return Response.error(res, {
      message: error.message
    });
  }
};

const getMenuConfig = async (req, res) => {
  try {
    const { auth_user_id, user_role, email } = req.query;

    const user = await DB.read(prisma.user, { email: email });

    if (!user) {
      return Response.error(res, { message: 'User Not Found' });
    }

    const menuConfig = await DB.findDetails(prisma.userConfig, {
      userId: user.id
    });

    return Response.success(res, {
      data: menuConfig,
      message: 'Menu Config Found'
    });
  } catch (error) {
    Logger.error(`${error.message} at getMenuConfig function ${controllerName}`);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

module.exports = {
  createUser,
  getUsers,
  updateUser,
  updateMenuConfig,
  getMenuConfig
};
