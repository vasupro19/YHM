const { getDynamicConnectionForDatabase } = require("../Helpers/db.helper");
const Logger = require("../Helpers/logger");
const Response = require("../Helpers/response.helper");
const DB = require("../Helpers/crud.helper");
const { ADMIN_ROLE_ID } = require("../Constants/constant");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const dynamicDbConnectionMiddleware = async (req, res, next) => {
  let clientId = null;
  let dbName = null;

  if (req.query.clientId) {
    clientId = req.query.clientId;
    delete req.query.clientId;
  } else {
    clientId = req.body.clientId;
    delete req.body.clientId;
  }

  if (!clientId) {
    return Response.badRequest(res, {
      success: false,
      message: "clientId is required",
    });
  }

  try {
    const client = await DB.read(prisma.client, { id: Number(clientId) });

    // a non-admin user may only reach their own client's data
    if (Number(req.query.user_role) !== ADMIN_ROLE_ID) {
      const me = await DB.read(prisma.user, { id: Number(req.query.auth_user_id) });
      if (!me || me.clientId !== Number(clientId)) {
        return Response.unauthorized(res, { message: 'Access denied', status: 403 });
      }
    }

    dbName = client?.code;

    if (!dbName) {
      return Response.error(res, {
        data: {},
        message: `Client not found`,
      });
    }

    req.dbConnection = await getDynamicConnectionForDatabase(dbName);
    req.clientId = Number(clientId);
    next();
  } catch (error) {
    Logger.error(error.message + " Failed to initialize Prisma client for DB");
    return Response.error(res, {
      data: {},
      message: `Failed to initialize Prisma client for DB "${dbName}": ${error.message}`,
    });
  }
};

module.exports = dynamicDbConnectionMiddleware;
