const Logger = require('./logger');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const names = new Map();
const nameOf = async (id) => {
  if (!id) return null;
  if (!names.has(id)) names.set(id, (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name || null);
  return names.get(id);
};

// records who did what. Never blocks or breaks the action it describes.
const audit = async (req, db, action, entity, entityId, summary) => {
  try {
    const userId = Number(req.query.auth_user_id) || null;
    await db.query('INSERT INTO AuditLog (userId, userName, action, entity, entityId, summary) VALUES (?,?,?,?,?,?)', [userId, await nameOf(userId), action, entity, entityId || null, String(summary).slice(0, 480)]);
  } catch (error) {
    Logger.error(`audit failed: ${error.message}`);
  }
};

module.exports = { audit };
