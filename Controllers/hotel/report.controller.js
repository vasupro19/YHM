const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { canOpen } = require('../../Middleware/menuAccess.middleware');

const dashboard = handler(async (req, res, db) => {
  const today = H.today();
  const monthStart = `${today.slice(0, 8)}01`;
  const week = H.nightsBetween(today, H.addDays(today, 7));

  const [[{ rooms }]] = await db.query('SELECT COUNT(*) AS rooms FROM Room WHERE outOfService = 0');
  const [[{ allRooms }]] = await db.query('SELECT COUNT(*) AS allRooms FROM Room');
  const setting = await H.getSettings(db);
  const base = `SELECT b.id, b.bookingNumber, b.checkIn, b.checkOut, b.status, b.discount, c.name AS customerName, r.roomNumber FROM Booking b JOIN Customer c ON c.id = b.customerId JOIN Room r ON r.id = b.roomId`;
  const [arrivals] = await db.query(`${base} WHERE b.status IN ('PENDING','CONFIRMED') AND b.checkIn = ? ORDER BY r.roomNumber`, [today]);
  const [departures] = await db.query(`${base} WHERE b.status = 'CHECKED_IN' AND b.checkOut <= ? ORDER BY r.roomNumber`, [today]);
  const [inHouse] = await db.query(`${base} WHERE b.status = 'CHECKED_IN' ORDER BY r.roomNumber`);
  const [pending] = await db.query(`SELECT COUNT(*) AS n FROM Booking WHERE status = 'PENDING'`);

  const [occ] = await db.query(
    `SELECT d.date, COUNT(b.id) AS occupied FROM (${week.map(() => 'SELECT ? AS date').join(' UNION ALL ')}) d
       LEFT JOIN Booking b ON b.status IN ('PENDING','CONFIRMED','CHECKED_IN') AND b.checkIn <= d.date AND b.checkOut > d.date
      GROUP BY d.date ORDER BY d.date`,
    week
  );
  const [hk] = await db.query('SELECT status, COUNT(*) AS n FROM Room WHERE outOfService = 0 GROUP BY status');
  const [[pay]] = await db.query('SELECT COALESCE(SUM(amount),0) AS total FROM Payment WHERE paidAt >= ?', [monthStart]);
  const [[roomRev]] = await db.query(`SELECT COALESCE(SUM(n.price),0) AS total FROM BookingNight n JOIN Booking b ON b.id = n.bookingId WHERE b.status NOT IN ('CANCELLED','NO_SHOW') AND n.date >= ? AND n.date <= ?`, [monthStart, today]);

  // money still owed by guests who are in the house or have left
  const [owing] = await db.query(`SELECT id, discount FROM Booking WHERE status IN ('CHECKED_IN','CHECKED_OUT') ORDER BY id DESC LIMIT 500`);
  const bills = await H.attachBills(db, owing);
  const outstanding = H.round2(bills.reduce((s, b) => s + Math.max(b.balance, 0), 0));

  // money figures are only for people who may open Reports
  const seesMoney = await canOpen(req, '/hotel/reports');
  const todayOcc = occ[0]?.occupied || 0;
  Response.success(res, {
    data: {
      today,
      needsSetup: !setting.onboardedAt && allRooms === 0,
      rooms,
      occupiedTonight: todayOcc,
      occupancyPercent: rooms ? Math.round((todayOcc / rooms) * 100) : 0,
      arrivals,
      departures,
      inHouseCount: inHouse.length,
      pendingBookings: pending[0].n,
      next7Days: occ.map((o) => ({ date: o.date, occupied: o.occupied, percent: rooms ? Math.round((o.occupied / rooms) * 100) : 0 })),
      housekeeping: Object.fromEntries(hk.map((h) => [h.status, h.n])),
      paymentsThisMonth: seesMoney ? pay.total : null,
      roomRevenueThisMonth: seesMoney ? roomRev.total : null,
      outstanding: seesMoney ? outstanding : null
    }
  });
});

// day-by-day occupancy and money for a date range (inclusive)
const report = handler(async (req, res, db) => {
  const { from, to } = req.query;
  if (!H.isYmd(from) || !H.isYmd(to) || to < from) throw new HotelError('Choose a valid date range');
  const days = H.nightsBetween(from, H.addDays(to, 1));
  if (days.length > 366) throw new HotelError('Choose a range of 366 days or fewer');

  const [[{ rooms }]] = await db.query('SELECT COUNT(*) AS rooms FROM Room WHERE outOfService = 0');
  const [nights] = await db.query(`SELECT n.date, COUNT(*) AS occupied, SUM(n.price) AS revenue FROM BookingNight n JOIN Booking b ON b.id = n.bookingId WHERE b.status NOT IN ('CANCELLED','NO_SHOW','PENDING') AND n.date >= ? AND n.date <= ? GROUP BY n.date`, [from, to]);
  const [charges] = await db.query('SELECT chargeDate AS date, SUM(quantity * unitPrice) AS amount FROM Charge c JOIN Booking b ON b.id = c.bookingId WHERE b.status NOT IN (\'CANCELLED\',\'NO_SHOW\') AND chargeDate >= ? AND chargeDate <= ? GROUP BY chargeDate', [from, to]);
  const [pays] = await db.query('SELECT DATE_FORMAT(paidAt, \'%Y-%m-%d\') AS date, SUM(amount) AS amount FROM Payment WHERE paidAt >= ? AND paidAt < ? GROUP BY DATE_FORMAT(paidAt, \'%Y-%m-%d\')', [from, H.addDays(to, 1)]);
  const [byCat] = await db.query('SELECT category, SUM(quantity * unitPrice) AS amount FROM Charge c JOIN Booking b ON b.id = c.bookingId WHERE b.status NOT IN (\'CANCELLED\',\'NO_SHOW\') AND chargeDate >= ? AND chargeDate <= ? GROUP BY category ORDER BY amount DESC', [from, to]);

  const idx = (rows, key) => Object.fromEntries(rows.map((r) => [r.date, r[key]]));
  const [N, C, P] = [nights, charges, pays];
  const occ = idx(N, 'occupied');
  const rev = idx(N, 'revenue');
  const chg = idx(C, 'amount');
  const rec = idx(P, 'amount');

  const rows = days.map((date) => ({
    date,
    occupied: occ[date] || 0,
    occupancyPercent: rooms ? Math.round(((occ[date] || 0) / rooms) * 100) : 0,
    roomRevenue: H.round2(rev[date] || 0),
    otherRevenue: H.round2(chg[date] || 0),
    paymentsReceived: H.round2(rec[date] || 0)
  }));
  const sum = (k) => H.round2(rows.reduce((s, r) => s + r[k], 0));
  const occupiedNights = rows.reduce((s, r) => s + r.occupied, 0);
  Response.success(res, {
    data: {
      rooms,
      rows,
      byCategory: byCat.map((c) => ({ category: c.category, amount: H.round2(c.amount) })),
      totals: {
        roomRevenue: sum('roomRevenue'),
        otherRevenue: sum('otherRevenue'),
        paymentsReceived: sum('paymentsReceived'),
        occupiedNights,
        occupancyPercent: rooms ? Math.round((occupiedNights / (rooms * days.length)) * 100) : 0,
        adr: occupiedNights ? H.round2(sum('roomRevenue') / occupiedNights) : 0,
        revpar: rooms ? H.round2(sum('roomRevenue') / (rooms * days.length)) : 0
      }
    }
  });
});

module.exports = { dashboard, report };
