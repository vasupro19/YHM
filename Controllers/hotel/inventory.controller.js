const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit } = require('../../Helpers/audit');

const HK_STATUSES = ['CLEAN', 'DIRTY', 'INSPECTED'];

// ---------- settings ----------
const getSettings = handler(async (req, res, db) => {
  Response.success(res, { data: await H.getSettings(db) });
});

const updateSettings = handler(async (req, res, db) => {
  await H.getSettings(db);
  const data = H.cleanSettings(req.body);
  await H.update(db, 'HotelSetting', data, 1);
  await audit(req, db, 'UPDATE', 'Settings', null, 'Hotel settings changed');
  Response.success(res, { data: await H.getSettings(db), message: 'Settings saved' });
});

// ---------- room types ----------
const listRoomTypes = handler(async (req, res, db) => {
  const [rows] = await db.query('SELECT t.*, (SELECT COUNT(*) FROM Room r WHERE r.roomTypeId = t.id) AS roomCount FROM RoomType t ORDER BY t.name');
  Response.success(res, { data: rows });
});

const typeData = (body) => {
  H.need(body, ['name', 'basePrice']);
  const data = H.pick(body, ['name', 'description', 'maxAdults', 'maxChildren', 'basePrice', 'amenities', 'active']);
  data.name = String(data.name).trim();
  data.basePrice = H.money(data.basePrice, 'Base price');
  if (data.maxAdults !== undefined && !(Number(data.maxAdults) >= 1)) throw new HotelError('Max adults must be at least 1');
  if (data.maxChildren !== undefined && !(Number(data.maxChildren) >= 0)) throw new HotelError('Max children cannot be negative');
  return data;
};

const createRoomType = handler(async (req, res, db) => {
  const data = typeData(req.body);
  const id = await H.insert(db, 'RoomType', data);
  await audit(req, db, 'CREATE', 'RoomType', id, `Room type ${data.name} added at ₹${data.basePrice}`);
  Response.success(res, { message: 'Room type created', status: 201 });
});

const updateRoomType = handler(async (req, res, db) => {
  const data = typeData(req.body);
  await H.update(db, 'RoomType', data, Number(req.params.id));
  await audit(req, db, 'UPDATE', 'RoomType', Number(req.params.id), `Room type ${data.name} changed (usual price ₹${data.basePrice})`);
  Response.success(res, { message: 'Room type updated' });
});

// ---------- date-specific rates ----------
const listRates = handler(async (req, res, db) => {
  const { roomTypeId, from, to } = req.query;
  if (!H.isYmd(from) || !H.isYmd(to)) throw new HotelError('from and to must be valid dates');
  const [rows] = await db.query('SELECT roomTypeId, date, price FROM RoomRate WHERE date >= ? AND date <= ?' + (roomTypeId ? ' AND roomTypeId = ?' : '') + ' ORDER BY date', roomTypeId ? [from, to, Number(roomTypeId)] : [from, to]);
  Response.success(res, { data: rows });
});

// body: { roomTypeId, from, to (inclusive), price | null to clear, weekdays?: [0..6] (0 = Sunday) }
const setRates = handler(async (req, res, db) => {
  const { roomTypeId, from, to, price, weekdays } = req.body;
  if (!roomTypeId) throw new HotelError('roomTypeId is required');
  if (!H.isYmd(from) || !H.isYmd(to) || to < from) throw new HotelError('Choose a valid date range');
  const dates = H.nightsBetween(from, H.addDays(to, 1)).filter((d) => !Array.isArray(weekdays) || !weekdays.length || weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  if (dates.length > 400) throw new HotelError('Choose a range of 400 days or fewer');
  if (!dates.length) throw new HotelError('No dates match that selection');

  if (price === null || price === '' || price === undefined) {
    await db.query('DELETE FROM RoomRate WHERE roomTypeId = ? AND date IN (?)', [Number(roomTypeId), dates]);
    await audit(req, db, 'RATES', 'RoomType', Number(roomTypeId), `Custom prices cleared for ${dates.length} day(s) from ${dates[0]}`);
    return Response.success(res, { message: `Custom prices cleared for ${dates.length} day(s)` });
  }
  const value = H.money(price, 'Price');
  await db.query('INSERT INTO RoomRate (roomTypeId, date, price) VALUES ? ON DUPLICATE KEY UPDATE price = VALUES(price)', [dates.map((d) => [Number(roomTypeId), d, value])]);
  await audit(req, db, 'RATES', 'RoomType', Number(roomTypeId), `Price set to ₹${value} for ${dates.length} day(s), ${dates[0]} to ${dates[dates.length - 1]}`);
  Response.success(res, { message: `Price set for ${dates.length} day(s)` });
});

// ---------- rooms ----------
const listRooms = handler(async (req, res, db) => {
  const today = H.today();
  const [rows] = await db.query(
    `SELECT r.*, t.name AS roomTypeName,
            (SELECT c.name FROM Booking b JOIN Customer c ON c.id = b.customerId WHERE b.roomId = r.id AND b.status = 'CHECKED_IN' LIMIT 1) AS guestName,
            (SELECT b.checkOut FROM Booking b WHERE b.roomId = r.id AND b.status = 'CHECKED_IN' LIMIT 1) AS guestCheckOut,
            (SELECT COUNT(*) FROM Booking b WHERE b.roomId = r.id AND b.status IN ('PENDING','CONFIRMED') AND b.checkIn = ?) AS arrivingToday
       FROM Room r JOIN RoomType t ON t.id = r.roomTypeId ORDER BY r.roomNumber + 0, r.roomNumber`,
    [today]
  );
  Response.success(res, { data: rows });
});

const roomData = async (db, body) => {
  H.need(body, ['roomNumber', 'roomTypeId']);
  const data = H.pick(body, ['roomNumber', 'floor', 'roomTypeId', 'notes', 'outOfService']);
  data.roomNumber = String(data.roomNumber).trim();
  data.roomTypeId = Number(data.roomTypeId);
  const [[type]] = await db.query('SELECT id FROM RoomType WHERE id = ?', [data.roomTypeId]);
  if (!type) throw new HotelError('Room type not found');
  return data;
};

const createRoom = handler(async (req, res, db) => {
  const data = await roomData(db, req.body);
  const id = await H.insert(db, 'Room', data);
  await audit(req, db, 'CREATE', 'Room', id, `Room ${data.roomNumber} added`);
  Response.success(res, { message: 'Room added', status: 201 });
});

const updateRoom = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const data = await roomData(db, req.body);
  if (data.outOfService) {
    const future = await db.query(`SELECT bookingNumber FROM Booking WHERE roomId = ? AND status IN ('PENDING','CONFIRMED','CHECKED_IN') AND checkOut > ? LIMIT 1`, [id, H.today()]);
    if (future[0].length) throw new HotelError(`Room has an upcoming booking (${future[0][0].bookingNumber}); move or cancel it before taking the room out of service`);
  }
  await H.update(db, 'Room', data, id);
  await audit(req, db, 'UPDATE', 'Room', id, `Room ${data.roomNumber} changed${data.outOfService ? ' (out of service)' : ''}`);
  Response.success(res, { message: 'Room updated' });
});

const setHousekeeping = handler(async (req, res, db) => {
  if (!HK_STATUSES.includes(req.body.status)) throw new HotelError(`status must be one of ${HK_STATUSES.join(', ')}`);
  await H.update(db, 'Room', { status: req.body.status }, Number(req.params.id));
  await audit(req, db, 'HOUSEKEEPING', 'Room', Number(req.params.id), `Room marked ${req.body.status.toLowerCase()}`);
  Response.success(res, { message: 'Housekeeping status updated' });
});

// ---------- availability + calendar ----------
const availability = handler(async (req, res, db) => {
  const { checkIn, checkOut, roomTypeId, excludeBookingId } = req.query;
  H.assertStay(checkIn, checkOut);
  const settings = await H.getSettings(db);

  const [rooms] = await db.query(
    `SELECT r.id, r.roomNumber, r.floor, r.roomTypeId, t.name AS roomTypeName, t.maxAdults, t.maxChildren
       FROM Room r JOIN RoomType t ON t.id = r.roomTypeId
      WHERE r.outOfService = 0 AND t.active = 1 ${roomTypeId ? 'AND r.roomTypeId = ?' : ''}
        AND NOT EXISTS (SELECT 1 FROM Booking b WHERE b.roomId = r.id AND b.status IN (?) AND b.checkIn < ? AND b.checkOut > ? AND b.id <> ?)
      ORDER BY r.roomNumber + 0, r.roomNumber`,
    [...(roomTypeId ? [Number(roomTypeId)] : []), H.BLOCKING, checkOut, checkIn, Number(excludeBookingId) || 0]
  );

  const dates = H.nightsBetween(checkIn, checkOut);
  const quotes = {};
  for (const typeId of [...new Set(rooms.map((r) => r.roomTypeId))]) quotes[typeId] = await H.priceNights(db, typeId, dates, settings);

  const withPrice = rooms.map((r) => {
    const nights = quotes[r.roomTypeId];
    return { ...r, nights, roomTotal: H.round2(nights.reduce((s, n) => s + n.price, 0)) };
  });
  const byType = Object.values(
    withPrice.reduce((m, r) => {
      m[r.roomTypeId] = m[r.roomTypeId] || { roomTypeId: r.roomTypeId, roomTypeName: r.roomTypeName, available: 0, roomTotal: r.roomTotal, perNight: H.round2(r.roomTotal / dates.length) };
      m[r.roomTypeId].available += 1;
      return m;
    }, {})
  );
  Response.success(res, { data: { nights: dates.length, rooms: withPrice, byType } });
});

const calendar = handler(async (req, res, db) => {
  const { from, to } = req.query; // [from, to) window
  H.assertStay(from, to);
  if (H.nightsBetween(from, to).length > 62) throw new HotelError('The calendar can show at most 62 days at a time');

  const [rooms] = await db.query('SELECT r.id, r.roomNumber, r.floor, r.roomTypeId, r.status, r.outOfService, t.name AS roomTypeName FROM Room r JOIN RoomType t ON t.id = r.roomTypeId ORDER BY t.name, r.roomNumber + 0, r.roomNumber');
  const [types] = await db.query('SELECT id, name, basePrice FROM RoomType');
  const [rates] = await db.query('SELECT roomTypeId, date, price FROM RoomRate WHERE date >= ? AND date < ?', [from, to]);
  const [bookings] = await db.query(
    `SELECT b.id, b.bookingNumber, b.roomId, b.checkIn, b.checkOut, b.status, b.adults, b.children, c.name AS customerName, c.companyName
       FROM Booking b JOIN Customer c ON c.id = b.customerId
      WHERE b.status IN (?) AND b.checkIn < ? AND b.checkOut > ?`,
    [H.BLOCKING, to, from]
  );
  Response.success(res, { data: { from, to, rooms, types, rates, bookings } });
});

module.exports = { getSettings, updateSettings, listRoomTypes, createRoomType, updateRoomType, listRates, setRates, listRooms, createRoom, updateRoom, setHousekeeping, availability, calendar };
