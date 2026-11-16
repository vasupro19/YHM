// Owner's control: everyone closes their own cash drawer, and the owner sees one report per day.
const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit, nameOf } = require('../../Helpers/audit');
const { buildDayReport, summaryText } = require('../../Helpers/dayReport');
const { waNumber, money } = require('../../Helpers/messages');

const me = (req) => Number(req.query.auth_user_id) || 0;

// cash this person has taken that isn't in any closed drawer yet
const openCash = async (db, userId, lock = false) => {
  const [rows] = await db.query(
    `SELECT p.id, p.amount, p.paidAt, p.note, b.id AS bookingId, b.bookingNumber, c.name AS customerName
       FROM Payment p JOIN Booking b ON b.id = p.bookingId JOIN Customer c ON c.id = b.customerId
      WHERE p.method = 'CASH' AND p.cashCloseId IS NULL AND p.createdBy = ? ORDER BY p.paidAt${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  return rows;
};

const drawer = handler(async (req, res, db) => {
  const rows = await openCash(db, me(req));
  const [[last]] = await db.query('SELECT * FROM CashClose WHERE userId = ? ORDER BY closedAt DESC LIMIT 1', [me(req)]);
  const [recent] = await db.query('SELECT * FROM CashClose WHERE userId = ? ORDER BY closedAt DESC LIMIT 10', [me(req)]);
  Response.success(res, { data: { payments: rows, expected: H.round2(rows.reduce((s, p) => s + p.amount, 0)), lastClose: last || null, recent } });
});

const closeDrawer = handler(async (req, res, db) => {
  const counted = H.money(req.body.counted, 'Counted cash');
  const note = req.body.note ? String(req.body.note).slice(0, 500) : null;
  const userId = me(req);
  if (!userId) throw new HotelError('Sign in again to close your cash');
  const userName = await nameOf(userId);

  const close = await db.transaction(async (conn) => {
    const rows = await openCash(conn, userId, true);
    const expected = H.round2(rows.reduce((s, p) => s + p.amount, 0));
    const difference = H.round2(counted - expected);
    if (difference !== 0 && !note) throw new HotelError(`The count is ${money(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}. Add a note saying why.`);
    const id = await H.insert(conn, 'CashClose', { userId, userName, expected, counted, difference, paymentCount: rows.length, note });
    if (rows.length) await conn.query('UPDATE Payment SET cashCloseId = ? WHERE id IN (?)', [id, rows.map((r) => r.id)]);
    return { id, expected, counted, difference, paymentCount: rows.length };
  });

  const diff = close.difference === 0 ? 'matched' : `${money(Math.abs(close.difference))} ${close.difference < 0 ? 'short' : 'over'}`;
  await audit(req, db, 'CASH_CLOSED', 'CashClose', close.id, `Cash drawer closed: expected ${money(close.expected)}, counted ${money(close.counted)} (${diff})${note ? `. Note: ${note}` : ''}`);
  Response.success(res, { data: close, message: close.difference === 0 ? 'Cash closed. The count matched.' : `Cash closed, ${diff}.`, status: 201 });
});

const closes = handler(async (req, res, db) => {
  const { from, to } = req.query;
  if (!H.isYmd(from) || !H.isYmd(to)) throw new HotelError('Choose a valid date range');
  const [rows] = await db.query('SELECT * FROM CashClose WHERE closedAt >= ? AND closedAt < ? ORDER BY closedAt DESC', [from, H.addDays(to, 1)]);
  Response.success(res, { data: rows });
});

const dayReport = handler(async (req, res, db) => {
  const date = req.query.date || H.today();
  if (!H.isYmd(date)) throw new HotelError('Choose a valid date');
  const report = await buildDayReport(db, date);
  const settings = await H.getSettings(db);
  Response.success(res, { data: { ...report, text: summaryText(report), ownerPhone: waNumber(settings.ownerPhone || ''), ownerEmail: settings.ownerEmail || '' } });
});

module.exports = { drawer, closeDrawer, closes, dayReport };
