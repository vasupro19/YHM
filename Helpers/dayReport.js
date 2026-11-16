// The owner's view of one day: what was sold, what came in, who holds the cash,
// and anything that looks like money slipping away (removed payments, rooms used without a booking …).
const H = require('./hotel.helper');
const { nameOf } = require('./audit');
const { money } = require('./messages');

const STAYED = ['CHECKED_IN', 'CHECKED_OUT'];

const buildDayReport = async (db, date) => {
  const next = H.addDays(date, 1);
  const settings = await H.getSettings(db);
  const [[{ rooms }]] = await db.query('SELECT COUNT(*) AS rooms FROM Room WHERE outOfService = 0');

  // rooms sold for the night of `date`
  const [[sold]] = await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(n.price),0) AS revenue FROM BookingNight n JOIN Booking b ON b.id = n.bookingId
      WHERE n.date = ? AND b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')`,
    [date]
  );
  const [[{ checkIns }]] = await db.query('SELECT COUNT(*) AS checkIns FROM Booking WHERE checkedInAt >= ? AND checkedInAt < ?', [date, next]);
  const [[{ checkOuts }]] = await db.query('SELECT COUNT(*) AS checkOuts FROM Booking WHERE checkedOutAt >= ? AND checkedOutAt < ?', [date, next]);
  const [newBookings] = await db.query('SELECT source, COUNT(*) AS n FROM Booking WHERE createdAt >= ? AND createdAt < ? GROUP BY source', [date, next]);
  const [charges] = await db.query(
    `SELECT c.category, SUM(c.quantity * c.unitPrice) AS amount FROM Charge c JOIN Booking b ON b.id = c.bookingId
      WHERE c.chargeDate = ? AND b.status NOT IN ('CANCELLED','NO_SHOW') GROUP BY c.category ORDER BY amount DESC`,
    [date]
  );

  // money received, by method and by the person who took it
  const [payments] = await db.query(
    `SELECT p.id, p.amount, p.method, p.createdBy, p.paidAt, p.cashCloseId, b.bookingNumber, b.id AS bookingId
       FROM Payment p JOIN Booking b ON b.id = p.bookingId WHERE p.paidAt >= ? AND p.paidAt < ? ORDER BY p.paidAt`,
    [date, next]
  );
  const byMethod = {};
  const byPerson = {};
  for (const p of payments) {
    byMethod[p.method] = H.round2((byMethod[p.method] || 0) + p.amount);
    const key = p.createdBy || 0;
    byPerson[key] = byPerson[key] || { userId: p.createdBy, name: (await nameOf(p.createdBy)) || 'Not recorded', total: 0, cash: 0, count: 0 };
    byPerson[key].total = H.round2(byPerson[key].total + p.amount);
    if (p.method === 'CASH') byPerson[key].cash = H.round2(byPerson[key].cash + p.amount);
    byPerson[key].count += 1;
  }
  const received = H.round2(payments.reduce((s, p) => s + p.amount, 0));

  const [closes] = await db.query('SELECT * FROM CashClose WHERE closedAt >= ? AND closedAt < ? ORDER BY closedAt', [date, next]);
  // cash taken (any day) that nobody has counted yet
  const [openCash] = await db.query(
    `SELECT createdBy, SUM(amount) AS amount, COUNT(*) AS n, MIN(paidAt) AS since FROM Payment
      WHERE method = 'CASH' AND cashCloseId IS NULL AND paidAt < ? GROUP BY createdBy`,
    [next]
  );
  const uncounted = [];
  for (const o of openCash) uncounted.push({ userId: o.createdBy, name: (await nameOf(o.createdBy)) || 'Not recorded', amount: H.round2(o.amount), count: o.n, since: o.since });

  // ---- things the owner should look at ----
  const alerts = [];
  const [log] = await db.query(
    `SELECT action, entity, entityId, summary, userName, createdAt FROM AuditLog
      WHERE createdAt >= ? AND createdAt < ? AND action IN ('PAYMENT_REMOVED','CHARGE_REMOVED','CANCEL','NOSHOW','HOUSEKEEPING') ORDER BY createdAt`,
    [date, next]
  );
  for (const l of log) {
    if (l.action === 'PAYMENT_REMOVED') alerts.push({ level: 'high', kind: 'PAYMENT_REMOVED', bookingId: l.entityId, text: `Payment deleted: ${l.summary}`, by: l.userName, at: l.createdAt });
    if (l.action === 'CHARGE_REMOVED') alerts.push({ level: 'medium', kind: 'CHARGE_REMOVED', bookingId: l.entityId, text: `Charge deleted: ${l.summary}`, by: l.userName, at: l.createdAt });
    if (l.action === 'CANCEL' || l.action === 'NOSHOW') alerts.push({ level: 'low', kind: l.action, bookingId: l.entityId, text: `Booking ${l.action === 'CANCEL' ? 'cancelled' : 'marked no-show'}: ${l.summary}`, by: l.userName, at: l.createdAt });
  }

  // a room marked dirty on a day nobody stayed in it may have been sold off the books
  const dirtied = log.filter((l) => l.action === 'HOUSEKEEPING' && /dirty/i.test(l.summary) && l.entityId);
  const seen = new Set();
  for (const d of dirtied) {
    if (seen.has(d.entityId)) continue;
    seen.add(d.entityId);
    const [[stay]] = await db.query(
      `SELECT id FROM Booking WHERE roomId = ? AND status IN (?) AND checkIn <= ? AND checkOut >= ? LIMIT 1`,
      [d.entityId, STAYED, date, H.addDays(date, -1)]
    );
    if (!stay) {
      const [[room]] = await db.query('SELECT roomNumber FROM Room WHERE id = ?', [d.entityId]);
      alerts.push({ level: 'high', kind: 'ROOM_WITHOUT_BOOKING', roomId: d.entityId, text: `Room ${room?.roomNumber || d.entityId} was marked dirty, but no guest was booked in it`, by: d.userName, at: d.createdAt });
    }
  }

  // discounts given on bookings made or changed today
  const [discounts] = await db.query(
    `SELECT b.id, b.bookingNumber, b.discount, c.name FROM Booking b JOIN Customer c ON c.id = b.customerId
      WHERE b.discount > 0 AND ((b.createdAt >= ? AND b.createdAt < ?) OR (b.updatedAt >= ? AND b.updatedAt < ?))`,
    [date, next, date, next]
  );
  for (const d of discounts) alerts.push({ level: 'low', kind: 'DISCOUNT', bookingId: d.id, text: `Discount of ${money(d.discount)} on ${d.bookingNumber} (${d.name})` });

  // guests who left today without paying in full
  const [left] = await db.query(
    `SELECT b.id, b.bookingNumber, b.discount, c.name FROM Booking b JOIN Customer c ON c.id = b.customerId
      WHERE b.status = 'CHECKED_OUT' AND b.checkedOutAt >= ? AND b.checkedOutAt < ?`,
    [date, next]
  );
  for (const b of await H.attachBills(db, left)) {
    if (b.balance > 0.5) alerts.push({ level: 'high', kind: 'LEFT_UNPAID', bookingId: b.id, text: `${b.name} checked out with ${money(b.balance)} unpaid (${b.bookingNumber})` });
  }

  for (const c of closes) {
    if (c.difference < -0.5) alerts.push({ level: 'high', kind: 'CASH_SHORT', text: `${c.userName || 'Someone'} closed the cash drawer ${money(-c.difference)} short` });
    else if (c.difference > 0.5) alerts.push({ level: 'low', kind: 'CASH_OVER', text: `${c.userName || 'Someone'} closed the cash drawer ${money(c.difference)} over` });
  }

  // foreign guests whose Form C is still to be filed (due within 24 hours of arrival)
  const [formC] = await db.query(
    `SELECT b.id, b.bookingNumber, c.name, b.checkedInAt FROM Booking b JOIN Customer c ON c.id = b.customerId
      WHERE b.status IN (?) AND b.formCSubmittedAt IS NULL AND c.nationality IS NOT NULL AND c.nationality <> '' AND LOWER(c.nationality) NOT IN ('indian','india')
        AND b.checkedInAt < ?`,
    [STAYED, next]
  );
  for (const f of formC) alerts.push({ level: 'high', kind: 'FORM_C_DUE', bookingId: f.id, text: `Form C not filed for ${f.name} (${f.bookingNumber})` });

  const rank = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);

  return {
    date,
    hotelName: settings.hotelName,
    rooms,
    roomsSold: sold.n,
    occupancyPercent: rooms ? Math.round((sold.n / rooms) * 100) : 0,
    roomRevenue: H.round2(sold.revenue),
    otherRevenue: H.round2(charges.reduce((s, c) => s + c.amount, 0)),
    charges: charges.map((c) => ({ category: c.category, amount: H.round2(c.amount) })),
    checkIns,
    checkOuts,
    newBookings: newBookings.reduce((s, r) => s + r.n, 0),
    newBookingsBySource: Object.fromEntries(newBookings.map((r) => [r.source, r.n])),
    received,
    byMethod,
    byPerson: Object.values(byPerson).sort((a, b) => b.total - a.total),
    payments,
    closes,
    uncounted,
    alerts
  };
};

// the same report as a short message for WhatsApp or email
const summaryText = (r) => {
  const d = new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const lines = [
    `${r.hotelName || 'Hotel'}: day report for ${d}`,
    '',
    `Rooms sold: ${r.roomsSold} of ${r.rooms} (${r.occupancyPercent}%)`,
    `Room revenue: ${money(r.roomRevenue)}${r.otherRevenue ? `, other sales: ${money(r.otherRevenue)}` : ''}`,
    `Check-ins: ${r.checkIns}, check-outs: ${r.checkOuts}, new bookings: ${r.newBookings}`,
    '',
    `Money received: ${money(r.received)}`
  ];
  const LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank transfer', OTHER: 'Other' };
  Object.entries(r.byMethod).forEach(([m, a]) => lines.push(`  ${LABEL[m] || m}: ${money(a)}`));
  if (r.byPerson.length) {
    lines.push('', 'Taken by:');
    r.byPerson.forEach((p) => lines.push(`  ${p.name}: ${money(p.total)}${p.cash ? ` (cash ${money(p.cash)})` : ''}`));
  }
  if (r.uncounted.length) {
    lines.push('', 'Cash not yet counted:');
    r.uncounted.forEach((u) => lines.push(`  ${u.name}: ${money(u.amount)}`));
  }
  if (r.alerts.length) {
    lines.push('', `Please check (${r.alerts.length}):`);
    r.alerts.slice(0, 12).forEach((a) => lines.push(`  ${a.level === 'high' ? '!! ' : '- '}${a.text}`));
    if (r.alerts.length > 12) lines.push(`  …and ${r.alerts.length - 12} more in the app`);
  } else {
    lines.push('', 'Nothing unusual today.');
  }
  return lines.join('\n');
};

module.exports = { buildDayReport, summaryText };
