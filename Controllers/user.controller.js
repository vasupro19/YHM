const Response = require('../Helpers/response.helper');
const Logger = require('../Helpers/logger');
const AuthHelper = require('../Helpers/auth.helper');
const DB = require('../Helpers/crud.helper');
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

    await DB.create(prisma.user, { ...req.body, password: passwordHash });

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

    const userList = await DB.findDetails(prisma.user, req.query, ['role']);

    return Response.success(res, {
      data: userList,
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

    let data = { ...req.body, updatedAt: new Date() };

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
