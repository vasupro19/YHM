// Partner API: a travel agency (e.g. from Travelytics) that the hotel gave a key to can see live room
// availability and rates, and send booking requests. Requests arrive in YHM "on hold" for the hotel to confirm.
// Key format: yhm_c<clientId>_<48 hex>. Only its SHA-256 is stored.
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const Response = require('../Helpers/response.helper');
const Logger = require('../Helpers/logger');
const H = require('../Helpers/hotel.helper');
const { HotelError } = H;
const { getDynamicConnectionForDatabase } = require('../Helpers/db.helper');
const { audit } = require('../Helpers/audit');

const prisma = new PrismaClient();
const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const makeKey = (clientId) => `yhm_c${Number(clientId)}_${crypto.randomBytes(24).toString('hex')}`;

// resolves the key to the hotel's database and the agency link; 401 otherwise
const partnerAuth = async (req, res, next) => {
  try {
    const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-api-key'] || '').trim();
    const match = key.match(/^yhm_c(\d+)_[a-f0-9]{48}$/);
    if (!match) return Response.error(res, { status: 401, message: 'Missing or invalid hotel key' });
    const client = await prisma.client.findUnique({ where: { id: Number(match[1]) }, select: { code: true } });
    if (!client) return Response.error(res, { status: 401, message: 'Missing or invalid hotel key' });
    const db = await getDynamicConnectionForDatabase(client.code);
    const [[link]] = await db.query('SELECT * FROM AgentLink WHERE keyHash = ?', [hashKey(key)]);
    if (!link || !link.active) return Response.error(res, { status: 401, message: 'This hotel key is not valid or was turned off. Ask the hotel for a new one.' });
    db.query('UPDATE AgentLink SET lastUsedAt = ? WHERE id = ?', [new Date(), link.id]).catch(() => {});
    req.partner = { db, link };
    // audit() reads the acting user from here; partner requests have none
    req.query.auth_user_id = undefined;
    return next();
  } catch (error) {
    Logger.error(`partner auth: ${error.message}`);
    return Response.error(res, { status: 500, message: 'Something went wrong' });
  }
};

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res, req.partner.db, req.partner.link);
  } catch (error) {
    if (error instanceof HotelError) return Response.error(res, { status: error.status, message: error.message });
    Logger.error(`partner ${req.method} ${req.originalUrl}: ${error.message}`);
    return Response.error(res, { status: 500, message: 'Something went wrong' });
  }
};

const hotelInfo = wrap(async (req, res, db, link) => {
  const s = await H.getSettings(db);
  const [types] = await db.query(
    `SELECT t.id, t.name, t.description, t.maxAdults, t.maxChildren, t.basePrice, t.amenities, COUNT(r.id) AS rooms
       FROM RoomType t LEFT JOIN Room r ON r.roomTypeId = t.id AND r.outOfService = 0
      WHERE t.active = 1 GROUP BY t.id ORDER BY t.basePrice`
  );
  Response.success(res, {
    data: {
      hotel: { name: s.hotelName, address: s.address, phone: s.phone, email: s.email, checkInTime: s.checkInTime, checkOutTime: s.checkOutTime, policy: s.policy },
      agency: link.agencyName,
      roomTypes: types.map((t) => ({ ...t, rooms: Number(t.rooms) }))
    }
  });
});

// free rooms of each type for [checkIn, checkOut) with the nightly price and GST
const freeByType = async (db, checkIn, checkOut, settings) => {
  const [free] = await db.query(
    `SELECT r.id, r.roomTypeId FROM Room r JOIN RoomType t ON t.id = r.roomTypeId
      WHERE r.outOfService = 0 AND t.active = 1
        AND NOT EXISTS (SELECT 1 FROM Booking b WHERE b.roomId = r.id AND b.status IN (?) AND b.checkIn < ? AND b.checkOut > ?)
      ORDER BY r.roomNumber + 0, r.roomNumber`,
    [H.BLOCKING, checkOut, checkIn]
  );
  const [types] = await db.query('SELECT id, name, maxAdults, maxChildren FROM RoomType WHERE active = 1 ORDER BY basePrice');
  const dates = H.nightsBetween(checkIn, checkOut);
  const out = [];
  for (const t of types) {
    const nights = await H.priceNights(db, t.id, dates, settings);
    const roomTotal = H.round2(nights.reduce((s, n) => s + n.price, 0));
    const gst = H.round2(nights.reduce((s, n) => s + (n.price * n.gstPercent) / 100, 0));
    out.push({ roomTypeId: t.id, name: t.name, maxAdults: t.maxAdults, maxChildren: t.maxChildren, available: free.filter((r) => r.roomTypeId === t.id).length, nights, roomTotal, gst, total: H.round2(roomTotal + gst), freeRoomIds: free.filter((r) => r.roomTypeId === t.id).map((r) => r.id) });
  }
  return out;
};

const availability = wrap(async (req, res, db) => {
  const { checkIn, checkOut } = req.query;
  H.assertStay(checkIn, checkOut);
  if (checkIn < H.today()) throw new HotelError('Check-in date is in the past');
  const settings = await H.getSettings(db);
  const types = await freeByType(db, checkIn, checkOut, settings);
  Response.success(res, { data: { checkIn, checkOut, nights: H.nightsBetween(checkIn, checkOut).length, roomTypes: types.map(({ freeRoomIds, ...t }) => t) } });
});

const STATUS_FOR_AGENT = { PENDING: 'REQUESTED', CONFIRMED: 'CONFIRMED', CHECKED_IN: 'CHECKED_IN', CHECKED_OUT: 'CHECKED_OUT', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW' };
const publicBooking = (b) => ({ bookingNumber: b.bookingNumber, status: STATUS_FOR_AGENT[b.status] || b.status, checkIn: b.checkIn, checkOut: b.checkOut, roomTypeName: b.roomTypeName, rooms: 1, adults: b.adults, children: b.children, guestName: b.customerName, agentRef: b.agentRef, total: b.bill?.total });

// one request may ask for several rooms of a type: one YHM booking per room
const createBookings = wrap(async (req, res, db, link) => {
  const b = req.body || {};
  H.need(b, ['roomTypeId', 'checkIn', 'checkOut']);
  H.assertStay(b.checkIn, b.checkOut);
  if (b.checkIn < H.today()) throw new HotelError('Check-in date is in the past');
  const rooms = Math.max(1, Math.min(10, Number(b.rooms || 1)));
  const guest = b.guest || {};
  if (!String(guest.name || '').trim()) throw new HotelError('Guest name is required');
  const adults = Math.max(1, Number(b.adults || 1));
  const children = Math.max(0, Number(b.children || 0));
  const settings = await H.getSettings(db);
  const agentRef = b.agentRef ? String(b.agentRef).slice(0, 60) : null;
  const note = `Request from ${link.agencyName}${agentRef ? ` (their ref ${agentRef})` : ''}${b.notes ? `\n${String(b.notes).slice(0, 800)}` : ''}`;

  const ids = await db.transaction(async (conn) => {
    const [[type]] = await conn.query('SELECT id, name, maxAdults FROM RoomType WHERE id = ? AND active = 1', [Number(b.roomTypeId)]);
    if (!type) throw new HotelError('Room type not found', 404);
    // lock the candidate rooms, then re-check them inside the transaction
    const [candidates] = await conn.query('SELECT id FROM Room WHERE roomTypeId = ? AND outOfService = 0 ORDER BY roomNumber + 0, roomNumber FOR UPDATE', [type.id]);
    const freeIds = [];
    for (const r of candidates) {
      if (freeIds.length === rooms) break;
      // eslint-disable-next-line no-await-in-loop
      const conflicts = await H.findConflicts(conn, r.id, b.checkIn, b.checkOut);
      if (!conflicts.length) freeIds.push(r.id);
    }
    if (freeIds.length < rooms) throw new HotelError(`Only ${freeIds.length} ${type.name} room${freeIds.length === 1 ? '' : 's'} free for these dates`, 409);

    const customerId = await H.insert(conn, 'Customer', { type: 'INDIVIDUAL', name: String(guest.name).trim().slice(0, 120), phone: guest.phone ? String(guest.phone).slice(0, 20) : null, email: guest.email && /^\S+@\S+\.\S+$/.test(guest.email) ? guest.email : null, notes: `Sent by ${link.agencyName}` });
    const nights = await H.priceNights(conn, type.id, H.nightsBetween(b.checkIn, b.checkOut), settings);
    const roomTotal = H.round2(nights.reduce((s, n) => s + n.price, 0));
    const made = [];
    for (const roomId of freeIds) {
      // eslint-disable-next-line no-await-in-loop
      const id = await H.insert(conn, 'Booking', {
        bookingNumber: `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        customerId,
        roomId,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        adults: Math.ceil(adults / rooms),
        children: Math.ceil(children / rooms),
        status: 'PENDING',
        source: 'AGENT',
        roomTotal,
        discount: 0,
        notes: note,
        agentLinkId: link.id,
        agentRef
      });
      // eslint-disable-next-line no-await-in-loop
      await conn.query('INSERT INTO BookingNight (bookingId, date, price, gstPercent) VALUES ?', [nights.map((n) => [id, n.date, n.price, n.gstPercent])]);
      // eslint-disable-next-line no-await-in-loop
      await conn.query('UPDATE Booking SET bookingNumber = ? WHERE id = ?', [`${settings.bookingPrefix}-${String(id).padStart(5, '0')}`, id]);
      made.push(id);
    }
    return made;
  });

  const bookings = [];
  for (const id of ids) {
    const full = await H.loadBooking(db, id);
    bookings.push(publicBooking(full));
    await audit(req, db, 'AGENT_REQUEST', 'Booking', id, `${full.bookingNumber}: booking request from ${link.agencyName} for ${full.customerName}, room ${full.roomNumber}, ${full.checkIn} to ${full.checkOut}`);
  }
  Response.success(res, { data: { bookings }, message: 'Booking request sent. The hotel will confirm it.', status: 201 });
});

const bookingStatus = wrap(async (req, res, db, link) => {
  const [[row]] = await db.query('SELECT id FROM Booking WHERE bookingNumber = ? AND agentLinkId = ?', [String(req.params.number), link.id]);
  if (!row) throw new HotelError('Booking not found', 404);
  Response.success(res, { data: publicBooking(await H.loadBooking(db, row.id)) });
});

// the agency may withdraw a request the hotel hasn't checked in yet
const cancelBooking = wrap(async (req, res, db, link) => {
  const [[row]] = await db.query('SELECT id, status, bookingNumber FROM Booking WHERE bookingNumber = ? AND agentLinkId = ?', [String(req.params.number), link.id]);
  if (!row) throw new HotelError('Booking not found', 404);
  if (!['PENDING', 'CONFIRMED'].includes(row.status)) throw new HotelError(`This booking is ${row.status.replace('_', ' ').toLowerCase()} and can't be cancelled here. Call the hotel.`);
  await db.query("UPDATE Booking SET status = 'CANCELLED' WHERE id = ?", [row.id]);
  await audit(req, db, 'CANCEL', 'Booking', row.id, `${row.bookingNumber} cancelled by ${link.agencyName}`);
  Response.success(res, { data: publicBooking(await H.loadBooking(db, row.id)), message: 'Booking cancelled' });
});

// ---------------- hotel side: manage the keys (signed-in hotel staff) ----------------
const listLinks = H.handler(async (req, res, db) => {
  const [rows] = await db.query(
    `SELECT a.id, a.agencyName, a.contact, a.keyHint, a.active, a.lastUsedAt, a.createdAt,
            (SELECT COUNT(*) FROM Booking b WHERE b.agentLinkId = a.id) AS bookings,
            (SELECT COUNT(*) FROM Booking b WHERE b.agentLinkId = a.id AND b.status = 'PENDING') AS waiting
       FROM AgentLink a ORDER BY a.active DESC, a.agencyName`
  );
  Response.success(res, { data: rows });
});

const createLink = H.handler(async (req, res, db) => {
  const agencyName = String(req.body.agencyName || '').trim().slice(0, 120);
  if (!agencyName) throw new HotelError('Enter the agency name');
  const key = makeKey(req.clientId);
  const id = await H.insert(db, 'AgentLink', { agencyName, contact: req.body.contact ? String(req.body.contact).slice(0, 120) : null, keyHash: hashKey(key), keyHint: `…${key.slice(-6)}` });
  await audit(req, db, 'AGENT_LINK', 'AgentLink', id, `Key created for travel agency ${agencyName}`);
  // the key is shown once; only its hash is kept
  Response.success(res, { data: { id, key }, message: 'Key created', status: 201 });
});

const updateLink = H.handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[link]] = await db.query('SELECT agencyName FROM AgentLink WHERE id = ?', [id]);
  if (!link) throw new HotelError('Not found', 404);
  if (req.body.regenerate) {
    const key = makeKey(req.clientId);
    await db.query('UPDATE AgentLink SET keyHash = ?, keyHint = ?, active = 1 WHERE id = ?', [hashKey(key), `…${key.slice(-6)}`, id]);
    await audit(req, db, 'AGENT_LINK', 'AgentLink', id, `New key for ${link.agencyName}; the old one stopped working`);
    return Response.success(res, { data: { id, key }, message: 'New key created. The old key no longer works.' });
  }
  const active = Boolean(req.body.active);
  await db.query('UPDATE AgentLink SET active = ? WHERE id = ?', [active, id]);
  await audit(req, db, 'AGENT_LINK', 'AgentLink', id, `${link.agencyName}: access turned ${active ? 'on' : 'off'}`);
  return Response.success(res, { message: active ? 'Access turned on' : 'Access turned off' });
});

module.exports = { partnerAuth, hotelInfo, availability, createBookings, bookingStatus, cancelBooking, listLinks, createLink, updateLink };
