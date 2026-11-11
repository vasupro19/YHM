const Response = require('../Helpers/response.helper');
const { ADMIN_ROLE_ID } = require('../Constants/constant');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// a user's allowed screens, remembered for a few seconds so every request doesn't hit the database
const cache = new Map();
const TTL = 5000;

const menusOf = async (userId) => {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.urls;
  const rows = await prisma.userConfig.findMany({ where: { userId }, select: { menu: { select: { url: true } } } });
  const urls = rows.map((r) => r.menu.url);
  cache.set(userId, { at: Date.now(), urls });
  return urls;
};

// the screens behind the API: a request passes if the user may open ANY of the given screens
const requireMenu = (...urls) => async (req, res, next) => {
  try {
    if (Number(req.query.user_role) === ADMIN_ROLE_ID) return next();
    const allowed = await menusOf(Number(req.query.auth_user_id));
    if (urls.some((u) => allowed.includes(u))) return next();
    res.set('x-server-errortype', 'AccessDeniedException');
    return Response.unauthorized(res, { status: 403, message: "You don't have access to this." });
  } catch (error) {
    return Response.error(res, { message: error.message });
  }
};

// true when the signed-in user may open this screen (admins always may)
const canOpen = async (req, url) => {
  if (Number(req.query.user_role) === ADMIN_ROLE_ID) return true;
  return (await menusOf(Number(req.query.auth_user_id))).includes(url);
};

module.exports = { requireMenu, canOpen };
