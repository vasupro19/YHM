const { verifyToken, extractToken } = require("../Helpers/auth.helper");

const Response = require("../Helpers/response.helper");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function authorize(authRoles) {
  return async (req, res, next) => {
    try {
      const userRoles = req.query.user_role
        ? req.query.user_role.split(",")
        : [];

      if (!userRoles.length) {
        throw new Error("User roles not provided");
      }

      // Fetch user roles from Prisma
      const roles = await prisma.role.findMany({
        where: { id: { in: userRoles.map(Number) } }, // Assuming role IDs are numbers
        select: { role: true },
      });

      const rolesArray = roles.map((item) => item.role);

      // Check if user has at least one authorized role
      if (rolesArray.some((role) => authRoles.includes(role))) {
        req.query.auth_role = rolesArray;
        return next();
      }

      res.set("x-server-errortype", "AccessDeniedException");
      return Response.unauthorized(res, {
        message: "Access denied! User not authorized to access resource",
        status: 403,
      });
    } catch (error) {
      return Response.error(res, {
        message: error.message || "Authorization error",
        status: 500,
      });
    }
  };
}

// eslint-disable-next-line extractToken-> consistent-return For PostMan testing -> AccessToken
async function authJwt(req, res, next) {
  try {
    const token = await extractToken(req);
    const verify = await verifyToken(token, process.env.ACCESS_TOKEN_SECRET);
    req.query.auth_user_id = verify?.id;
    req.query.user_role = verify?.role;
    next();
  } catch (error) {
    if (error?.name) {
      res.set("x-server-errortype", "AccessTokenExpired");
      return Response.unauthorized(res, { message: error?.message || error });
    }
    res.set("x-server-errortype", "InternalServerError");
    return Response.error(res, { message: error?.message || error });
  }
}

module.exports = {
  authorize,
  authJwt,
};
