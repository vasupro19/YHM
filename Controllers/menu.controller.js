const Response = require('../Helpers/response.helper');
const DB = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'menu.controller';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// create menu
const createMenu = async (req, res) => {
  try {
    const data = { ...req.body };

    const createdMenu = await DB.create(prisma.menu, data);

    return Response.success(res, {
      data: createdMenu,
      message: 'Menu created successfully'
    });
  } catch (error) {
    Logger.error(`${error.message} at createMenu function in ${controllerName}`);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

// get menu by user config (based on auth_user_id)
const getUserMenu = async (req, res) => {
  try {
    const { auth_user_id, user_role, ...rest } = req.query;

    // Fetch all menus
    const menus = await DB.findDetails(prisma.menu, {});

    // Fetch user-specific menu access
    const userConfigs = await DB.findDetailsWithSelectedField(prisma.userConfig, {
      conditions: { userId: Number(auth_user_id) || 0 },
      projection: ['menuId']
    });

    const allowedMenuIds = userConfigs.map((uc) => uc.menuId);
    const filteredMenus = menus.filter((menu) => allowedMenuIds.includes(menu.id));

    return Response.success(res, {
      data: filteredMenus,
      message: 'Menu found'
    });
  } catch (error) {
    Logger.error(`${error.message} at getUserMenu function in ${controllerName}`);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

const getAllMenu = async (req, res) => {
  try {
    const menus = await DB.findDetails(prisma.menu, {});
    return Response.success(res, {
      data: menus,
      message: 'Menu found'
    });
  } catch (error) {
    Logger.error(`${error.message} at getAllMenu function in ${controllerName}`);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

// get menu list of client
const getClientMenuList = async (req, res) => {
  try {
    const clietnId = req.query.clientId;
    if (!clietnId) {
      return Response.badRequest(res, {
        data: [],
        message: 'clientId is required'
      });
    }

    const client = await DB.read(prisma.client, { id: Number(clietnId) });

    if (!client) {
      return Response.badRequest(res, {
        data: [],
        message: 'Client not found'
      });
    }

    const user = await DB.read(prisma.user, { email: client.email });

    const mapping = await DB.findDetails(prisma.userConfig, { userId: user.id }, ['menu']);

    const menus = mapping.map((m) => m.menu);

    return Response.success(res, {
      data: menus,
      message: 'Menu found'
    });
  } catch (error) {
    Logger.error(`${error.message} at getClientMenuList function in ${controllerName}`);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

module.exports = {
  createMenu,
  getUserMenu,
  getAllMenu,
  getClientMenuList
};
