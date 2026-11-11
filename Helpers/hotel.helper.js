// Shared hotel logic: dates, pricing, availability and billing.
// Dates are always 'YYYY-MM-DD' strings so timezones can never move a booking by a day.

const BLOCKING = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];

class HotelError extends Error {
  constructor(message, status = 400, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// [from, to) as a list of dates, i.e. the nights of a stay
const nightsBetween = (from, to) => {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
};

const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const assertStay = (checkIn, checkOut) => {
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new HotelError('Check-in and check-out must be valid dates');
  if (checkOut <= checkIn) throw new HotelError('Check-out must be after check-in');
  if (nightsBetween(checkIn, checkOut).length > 365) throw new HotelError('A stay cannot be longer than 365 nights');
};

const getSettings = async (db) => {
  const [rows] = await db.query('SELECT * FROM HotelSetting WHERE id = 1');
  if (rows[0]) return rows[0];
  await db.query('INSERT INTO HotelSetting (id) VALUES (1)');
  const [created] = await db.query('SELECT * FROM HotelSetting WHERE id = 1');
  return created[0];
};

const gstForPrice = (price, settings) => (price <= settings.gstThreshold ? settings.roomGstLow : settings.roomGstHigh);

// nightly price = date-specific rate if one was set, otherwise the room type's base price
const priceNights = async (db, roomTypeId, dates, settings) => {
  if (!dates.length) return [];
  const [[type]] = await db.query('SELECT basePrice FROM RoomType WHERE id = ?', [roomTypeId]);
  if (!type) throw new HotelError('Room type not found', 404);
  const [rates] = await db.query('SELECT date, price FROM RoomRate WHERE roomTypeId = ? AND date >= ? AND date <= ?', [roomTypeId, dates[0], dates[dates.length - 1]]);
  const override = Object.fromEntries(rates.map((r) => [r.date, r.price]));
  return dates.map((date) => {
    const price = override[date] ?? type.basePrice;
    return { date, price, gstPercent: gstForPrice(price, settings) };
  });
};

// bookings that already hold this room during [checkIn, checkOut)
const findConflicts = async (db, roomId, checkIn, checkOut, excludeBookingId = 0) => {
  const [rows] = await db.query(
    `SELECT b.id, b.bookingNumber, b.checkIn, b.checkOut, b.status, c.name AS customerName
       FROM Booking b JOIN Customer c ON c.id = b.customerId
      WHERE b.roomId = ? AND b.status IN (?) AND b.checkIn < ? AND b.checkOut > ? AND b.id <> ?`,
    [roomId, BLOCKING, checkOut, checkIn, excludeBookingId]
  );
  return rows;
};

const describeConflict = (c) => `Room is already booked from ${c.checkIn} to ${c.checkOut} (${c.bookingNumber}, ${c.customerName})`;

// Everything a guest owes: room nights (less discount), extra charges, GST, minus what was paid.
const computeBill = ({ booking, nights, charges, payments }) => {
  const roomSubtotal = round2(nights.reduce((s, n) => s + n.price, 0));
  const discount = Math.min(booking.discount || 0, roomSubtotal);
  const factor = roomSubtotal ? (roomSubtotal - discount) / roomSubtotal : 1;

  const roomLines = nights.map((n) => {
    const taxable = round2(n.price * factor);
    return { kind: 'ROOM', date: n.date, description: 'Room tariff', quantity: 1, unitPrice: n.price, amount: n.price, taxable, gstPercent: n.gstPercent, tax: round2((taxable * n.gstPercent) / 100) };
  });
  // spreading a discount over nights leaves paisa differences; put them on the last night so the lines add up exactly
  const roomTaxable = round2(roomSubtotal - discount);
  const drift = round2(roomTaxable - roomLines.reduce((s, l) => s + l.taxable, 0));
  if (drift && roomLines.length) {
    const last = roomLines[roomLines.length - 1];
    last.taxable = round2(last.taxable + drift);
    last.tax = round2((last.taxable * last.gstPercent) / 100);
  }
  const chargeLines = charges.map((c) => {
    const amount = round2(c.quantity * c.unitPrice);
    return { kind: 'CHARGE', id: c.id, category: c.category, date: c.chargeDate, description: c.description, quantity: c.quantity, unitPrice: c.unitPrice, amount, taxable: amount, gstPercent: c.gstPercent, tax: round2((amount * c.gstPercent) / 100) };
  });

  const chargesSubtotal = round2(chargeLines.reduce((s, l) => s + l.amount, 0));
  const taxTotal = round2([...roomLines, ...chargeLines].reduce((s, l) => s + l.tax, 0));
  const total = round2(roomSubtotal - discount + chargesSubtotal + taxTotal);
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));

  const byRate = {};
  [...roomLines, ...chargeLines].forEach((l) => {
    const k = String(l.gstPercent);
    byRate[k] = byRate[k] || { percent: l.gstPercent, taxable: 0, tax: 0 };
    byRate[k].taxable = round2(byRate[k].taxable + l.taxable);
    byRate[k].tax = round2(byRate[k].tax + l.tax);
  });

  return { roomLines, chargeLines, roomSubtotal, discount, chargesSubtotal, taxTotal, total, paid, balance: round2(total - paid), gstBreakup: Object.values(byRate) };
};

// loads a booking with its customer, room, nights, charges, payments and live bill
const loadBooking = async (db, id) => {
  const [[booking]] = await db.query(
    `SELECT b.*, c.name AS customerName, c.type AS customerType, c.phone AS customerPhone, c.email AS customerEmail, c.companyName, c.gstin AS customerGstin, c.address AS customerAddress,
            r.roomNumber, r.roomTypeId, t.name AS roomTypeName
       FROM Booking b
       JOIN Customer c ON c.id = b.customerId
       JOIN Room r ON r.id = b.roomId
       JOIN RoomType t ON t.id = r.roomTypeId
      WHERE b.id = ?`,
    [id]
  );
  if (!booking) throw new HotelError('Booking not found', 404);
  const [nights] = await db.query('SELECT date, price, gstPercent FROM BookingNight WHERE bookingId = ? ORDER BY date', [id]);
  const [charges] = await db.query('SELECT * FROM Charge WHERE bookingId = ? ORDER BY chargeDate, id', [id]);
  const [payments] = await db.query('SELECT * FROM Payment WHERE bookingId = ? ORDER BY paidAt, id', [id]);
  const [[invoice]] = await db.query('SELECT * FROM Invoice WHERE bookingId = ?', [id]);
  const bill = computeBill({ booking, nights, charges, payments });
  return { ...booking, nights, charges, payments, invoice: invoice || null, bill };
};

// keeps the stored invoice totals equal to the live bill (used after payments / checkout)
const syncInvoice = async (db, bookingId) => {
  const full = await loadBooking(db, bookingId);
  if (!full.invoice) return full;
  const b = full.bill;
  await db.query('UPDATE Invoice SET roomSubtotal=?, chargesSubtotal=?, discount=?, taxTotal=?, total=?, paid=?, balance=? WHERE bookingId=?', [b.roomSubtotal, b.chargesSubtotal, b.discount, b.taxTotal, b.total, b.paid, b.balance, bookingId]);
  return loadBooking(db, bookingId);
};

// wraps a controller: async errors become JSON responses instead of crashing the process
const handler = (fn) => async (req, res) => {
  const Response = require('./response.helper');
  const Logger = require('./logger');
  try {
    // ids in the url must be whole numbers; anything else is simply not found
    for (const [key, value] of Object.entries(req.params)) {
      if (/id$/i.test(key) && !/^\d+$/.test(value)) throw new HotelError('Not found', 404);
    }
    await fn(req, res, req.dbConnection);
  } catch (error) {
    if (error instanceof HotelError) return Response.badRequest(res, { status: error.status, message: error.message, data: error.data });
    if (error?.code === 'ER_DUP_ENTRY') return Response.badRequest(res, { message: 'That value already exists' });
    if (error?.code === 'ER_ROW_IS_REFERENCED_2' || error?.code === 'ER_NO_REFERENCED_ROW_2') return Response.badRequest(res, { message: 'This record is linked to other records' });
    Logger.error(`${error.message} at hotel ${req.method} ${req.originalUrl}`);
    return Response.error(res, { message: error.message });
  }
};

// picks only allowed columns from the request body (never trust arbitrary keys)
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k] === '' ? null : body[k]]));

// validates the hotel profile fields shared by the Settings page and the setup wizard
const cleanSettings = (body) => {
  const data = pick(body, ['hotelName', 'address', 'phone', 'email', 'gstin', 'checkInTime', 'checkOutTime', 'roomGstLow', 'roomGstHigh', 'gstThreshold', 'bookingPrefix', 'invoicePrefix', 'logoPath', 'policy', 'upiId']);
  ['roomGstLow', 'roomGstHigh', 'gstThreshold'].forEach((k) => {
    if (data[k] !== undefined) data[k] = money(data[k], k);
  });
  if (data.roomGstLow > 100 || data.roomGstHigh > 100) throw new HotelError('GST cannot be more than 100%');
  ['bookingPrefix', 'invoicePrefix'].forEach((k) => {
    if (data[k] !== undefined && !/^[A-Za-z0-9]{1,8}$/.test(data[k] || '')) throw new HotelError(`${k} must be 1 to 8 letters or digits`);
  });
  if (data.gstin) {
    data.gstin = String(data.gstin).toUpperCase();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(data.gstin)) throw new HotelError('GSTIN is not valid');
  }
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) throw new HotelError('Email is not valid');
  if (data.upiId && !/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9]{2,}$/.test(data.upiId)) throw new HotelError('UPI id should look like name@bank');
  if (data.logoPath && !/^File\/[\w./-]+$/.test(String(data.logoPath).replace(/\\/g, '/'))) throw new HotelError('Logo path is not valid');
  if (data.logoPath) data.logoPath = String(data.logoPath).replace(/\\/g, '/');
  if (data.hotelName === null) data.hotelName = '';
  return data;
};

// column names come from fixed whitelists in the controllers, and are still quoted here
const insert = async (db, table, data) => {
  const cols = Object.keys(data);
  const [result] = await db.query(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(data));
  return result.insertId;
};

const update = async (db, table, data, id) => {
  const cols = Object.keys(data);
  if (!cols.length) return;
  await db.query(`UPDATE \`${table}\` SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...Object.values(data), id]);
};

const need = (body, fields) => {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) throw new HotelError(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`);
};

const money = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HotelError(`${name} must be a number that is zero or more`);
  return round2(n);
};

// loads the live bill of many bookings at once (for lists and dashboards)
const attachBills = async (db, bookings) => {
  if (!bookings.length) return bookings;
  const ids = bookings.map((b) => b.id);
  const [nights] = await db.query('SELECT bookingId, date, price, gstPercent FROM BookingNight WHERE bookingId IN (?) ORDER BY date', [ids]);
  const [charges] = await db.query('SELECT * FROM Charge WHERE bookingId IN (?)', [ids]);
  const [payments] = await db.query('SELECT bookingId, amount FROM Payment WHERE bookingId IN (?)', [ids]);
  const group = (rows) => rows.reduce((m, r) => ((m[r.bookingId] = m[r.bookingId] || []).push(r), m), {});
  const [n, c, p] = [group(nights), group(charges), group(payments)];
  return bookings.map((b) => {
    const bill = computeBill({ booking: b, nights: n[b.id] || [], charges: c[b.id] || [], payments: p[b.id] || [] });
    return { ...b, total: bill.total, paid: bill.paid, balance: bill.balance };
  });
};

module.exports = { insert, update, need, money, attachBills, cleanSettings, BLOCKING, HotelError, isYmd, addDays, nightsBetween, today, round2, assertStay, getSettings, gstForPrice, priceNights, findConflicts, describeConflict, computeBill, loadBooking, syncInvoice, handler, pick };
