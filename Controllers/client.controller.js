const Response = require('../Helpers/response.helper');
const Logger = require('../Helpers/logger');
const AuthHelper = require('../Helpers/auth.helper');
const DB = require('../Helpers/crud.helper');
const { createNewDatabase, runMigrationForDatabase } = require('../Helpers/db.helper');
const { generateUniqueId } = require('../Helpers/uniqueIdGenerator.helper');
const { ensureStandardRoles } = require('../Helpers/rolePresets.helper');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const controllerName = 'client.controller';

const createClient = async (req, res) => {
  try {
    const { name, email, phoneNumber, address, gst, pan, password } = req.body;

    const role = await prisma.role.findFirst({ where: { name: 'CLIENT' } });
    if (!role) {
      return Response.badRequest(res, {
        data: {},
        message: 'Role Note Found'
      });
    }

    // reject duplicates before a tenant database is created for them
    const emailTaken =
      (await prisma.client.findUnique({ where: { email } })) || (await prisma.user.findUnique({ where: { email } }));
    if (emailTaken) {
      return Response.badRequest(res, { data: {}, message: 'This email is already registered' });
    }

    // get database main db name
    const result = await prisma.$queryRaw`SELECT DATABASE() as dbName`;

    const code = `${result[0].dbName}_${generateUniqueId()}`;

    await createNewDatabase(code);
    await runMigrationForDatabase(code);

    // create client
    const client = await DB.create(prisma.client, {
      name,
      email,
      code,
      phoneNumber,
      address,
      gst,
      pan,
      roleId: role.id
    });

    await ensureStandardRoles(prisma, client.id);

    const passwordHash = await AuthHelper.generateHash(password);

    const clientUser = await DB.create(prisma.user, {
      name,
      email,
      phoneNumber,
      password: passwordHash,
      clientId: client.id,
      roleId: role.id,
      active: true
    });

    // a new client starts with every screen enabled; the admin can switch some off later
    const menus = await prisma.menu.findMany({ where: { url: { not: '/master/client' } }, select: { id: true } }); // Client screen is admin-only
    await prisma.userConfig.createMany({
      data: menus.map((m) => ({ userId: clientUser.id, menuId: m.id })),
      skipDuplicates: true
    });

    return Response.success(res, {
      data: {},
      message: 'Client created successfully'
    });
  } catch (error) {
    Logger.error(`${controllerName}:createClient - ${error.message}`);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

// get clients list
const getClients = async (req, res) => {
  try {
    const { auth_user_id, user_role, ...filters } = req.query;

    const clientList = await DB.findDetails(prisma.client, filters);

    return Response.success(res, {
      data: clientList,
      message: 'Clients found'
    });
  } catch (error) {
    Logger.error(`${error.message} at getClients function ${controllerName}`);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

// update client
const updateClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return Response.error(res, {
        message: 'Client Id is required'
      });
    }

    const updatePayload = { updatedAt: new Date() };
    ['name', 'phoneNumber', 'address', 'gst', 'pan'].forEach((key) => {
      if (req.body[key] !== undefined) updatePayload[key] = req.body[key];
    });

    await DB.update(prisma.client, { id: Number(id) }, updatePayload);

    return Response.success(res, {
      data: {},
      message: 'Client updated successfully'
    });
  } catch (error) {
    Logger.error(`${error.message} at updateClient function ${controllerName}`);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

module.exports = {
  createClient,
  getClients,
  updateClient
};
