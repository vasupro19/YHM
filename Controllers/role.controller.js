const Response = require('../Helpers/response.helper');
const DB = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const { sanitizeObject } = require('../Helpers/senitizeData.helper');
const controllerName = 'role.controller';

const { PrismaClient } = require('@prisma/client');
const { ADMIN_ROLE_ID } = require('../Constants/constant');
const prisma = new PrismaClient();

// create the role
const createRole = async (req, res) => {
  try {
    if (req.body.name.toLowerCase() === 'admin' || req.body.name.toLowerCase() === 'client') {
      return Response.badRequest(res, {
        message: 'This role is reserved'
      });
    }

    await DB.isUnique(prisma.role, { name: req.body.name.toUpperCase() });

    const role = await DB.create(prisma.role, {
      name: req.body.name.toUpperCase()
    });

    await DB.create(prisma.clientRoleMapping, {
      clientId: req.body.clientId,
      roleId: role.id
    });

    return Response.success(res, {
      data: {},
      message: 'Role Created SuccessFully'
    });
  } catch (error) {
    Logger.error(error.message + ' at createRole function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

// get role by different query parameters
const getRole = async (req, res) => {
  try {
    const { auth_user_id, user_role, ...query } = req.query;

    if (user_role !== ADMIN_ROLE_ID) {
      const user = await DB.read(prisma.user, { id: auth_user_id });
      const clientRoleMapping = await DB.findDetails(prisma.clientRoleMapping, {
        clientId: user.clientId
      });
      const roleIds = clientRoleMapping.map((mapping) => mapping.roleId);
      query.id = { in: roleIds };
    }

    const roles = await DB.findDetails(prisma.role, query);

    return Response.success(res, {
      data: roles,
      message: 'Role Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getRole function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

const getRoleForCreateClient = async (req, res) => {
  try {
    const { auth_user_id, user_role, ...query } = req.query;
    const role = await DB.findDetails(prisma.role, { name: 'CLIENT' });

    return Response.success(res, {
      data: role,
      message: 'Role Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getRoleForCreateClient function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};

// update role
const updateRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return Response.error(res, {
        message: 'Role Id is required'
      });
    }

    const updatePayload = sanitizeObject({
      ...req.body,
      updatedAt: new Date()
    });

    updatePayload.name = updatePayload.name.toUpperCase();

    await DB.update(prisma.role, { id: Number(id) }, updatePayload);

    return Response.success(res, {
      data: {},
      message: 'Role updated successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateRole function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

module.exports = {
  createRole,
  getRole,
  getRoleForCreateClient,
  updateRole
};
