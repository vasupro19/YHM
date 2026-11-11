const Response = require('../../Helpers/response.helper');
const { handler } = require('../../Helpers/hotel.helper');

const list = handler(async (req, res, db) => {
  const { entity, q } = req.query;
  const where = [];
  const values = [];
  if (entity) (where.push('entity = ?'), values.push(String(entity)));
  if (q) (where.push('(summary LIKE ? OR userName LIKE ?)'), values.push(`%${q}%`, `%${q}%`));
  const [rows] = await db.query(`SELECT * FROM AuditLog ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 300`, values);
  Response.success(res, { data: rows });
});

module.exports = { list };
