const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { audit } = require('../../Helpers/audit');
const { HotelError, handler } = H;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MAX_ROWS = 2000;

// ============ setup wizard ============

// "101-110, 201, 202" -> ['101', ..., '110', '201', '202']
const parseRoomList = (text) => {
  const out = [];
  String(text || '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .forEach((token) => {
      const range = token.match(/^(\d+)-(\d+)$/);
      if (range) {
        const [from, to] = [Number(range[1]), Number(range[2])];
        if (to < from) throw new HotelError(`"${token}" goes backwards`);
        if (to - from > 200) throw new HotelError(`"${token}" is more than 200 rooms`);
        const width = range[1].length;
        for (let n = from; n <= to; n++) out.push(String(n).padStart(width, '0'));
      } else {
        if (token.length > 20) throw new HotelError(`"${token}" is too long for a room number`);
        out.push(token);
      }
    });
  return out;
};

// one request sets up the whole hotel, all or nothing
const onboard = handler(async (req, res, db) => {
  await H.getSettings(db);
  const b = req.body || {};

  if (b.skip) {
    await H.update(db, 'HotelSetting', { onboardedAt: new Date() }, 1);
    return Response.success(res, { message: 'Setup skipped. You can add everything later.' });
  }

  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM RoomType');
  if (n > 0) throw new HotelError('Rooms are already set up. Use the Rooms and Room types screens to change them.');

  const settings = H.cleanSettings(b.settings || {});
  if (!settings.hotelName || !String(settings.hotelName).trim()) throw new HotelError('Enter the hotel name');
  const types = Array.isArray(b.roomTypes) ? b.roomTypes : [];
  if (!types.length) throw new HotelError('Add at least one room type');

  const seenRooms = new Set();
  const plan = types.map((t, i) => {
    const label = `Room type ${i + 1}`;
    if (!t.name || !String(t.name).trim()) throw new HotelError(`${label}: enter a name`);
    const rooms = parseRoomList(t.rooms);
    if (!rooms.length) throw new HotelError(`${label} (${t.name}): list at least one room number`);
    rooms.forEach((r) => {
      if (seenRooms.has(r.toLowerCase())) throw new HotelError(`Room ${r} is listed more than once`);
      seenRooms.add(r.toLowerCase());
    });
    const maxAdults = Number(t.maxAdults ?? 2);
    const maxChildren = Number(t.maxChildren ?? 1);
    if (!(maxAdults >= 1) || !(maxChildren >= 0)) throw new HotelError(`${label} (${t.name}): check the number of guests`);
    return { name: String(t.name).trim(), basePrice: H.money(t.basePrice, `${t.name} price`), maxAdults, maxChildren, rooms };
  });
  if (seenRooms.size > 500) throw new HotelError('Set up at most 500 rooms here; import the rest later');

  const staff = (Array.isArray(b.staff) ? b.staff : []).filter((s) => s && (s.name || s.designation || s.monthlySalary)).map((s, i) => {
    if (!s.name || !String(s.name).trim() || !s.designation || !String(s.designation).trim()) throw new HotelError(`Staff ${i + 1}: enter a name and designation`);
    return { name: String(s.name).trim(), designation: String(s.designation).trim(), monthlySalary: H.money(s.monthlySalary || 0, `${s.name} salary`), active: true };
  });

  await db.transaction(async (conn) => {
    await H.update(conn, 'HotelSetting', { ...settings, onboardedAt: new Date() }, 1);
    for (const t of plan) {
      const typeId = await H.insert(conn, 'RoomType', { name: t.name, basePrice: t.basePrice, maxAdults: t.maxAdults, maxChildren: t.maxChildren });
      for (const roomNumber of t.rooms) await H.insert(conn, 'Room', { roomNumber, roomTypeId: typeId });
    }
    for (const s of staff) await H.insert(conn, 'Staff', s);
  });

  await audit(req, db, 'SETUP', 'Settings', null, `Hotel set up: ${plan.length} room type(s), ${seenRooms.size} room(s), ${staff.length} staff`);
  Response.success(res, { data: { roomTypes: plan.length, rooms: seenRooms.size, staff: staff.length }, message: 'Your hotel is ready', status: 201 });
});

// ============ CSV import ============

// header names are matched loosely: "Room Number", "room_number" and "roomnumber" are the same column
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  roomnumber: 'room', roomno: 'room', roomnum: 'room', rooms: 'room',
  roomtype: 'type', category: 'type',
  guest: 'name', guestname: 'name', customer: 'name', fullname: 'name',
  mobile: 'phone', phonenumber: 'phone', contact: 'phone', mobilenumber: 'phone',
  emailaddress: 'email', company: 'companyname', gst: 'gstin', gstnumber: 'gstin',
  checkin: 'checkin', arrival: 'checkin', arrivaldate: 'checkin', from: 'checkin',
  checkout: 'checkout', departure: 'checkout', departuredate: 'checkout', to: 'checkout',
  pax: 'adults', adult: 'adults', child: 'children', kids: 'children',
  ratepernight: 'rate', price: 'rate', nightlyrate: 'rate',
  amountpaid: 'paid', advance: 'paid', payment: 'paid',
  salary: 'monthlysalary', monthly: 'monthlysalary', pay: 'monthlysalary',
  joined: 'joindate', joiningdate: 'joindate', doj: 'joindate',
  position: 'designation', role: 'designation', title: 'designation',
  idproof: 'idtype', idnumber: 'idnumber', note: 'notes', remarks: 'notes'
};
const rowOf = (raw) => Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [ALIASES[norm(k)] || norm(k), v == null ? '' : String(v).trim()]));

// 2026-10-21, 21/10/2026, 21-10-26 -> 2026-10-21
const toDate = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (H.isYmd(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const out = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return H.isYmd(out) ? out : null;
};
const num = (v, dflt) => (v === '' || v == null ? dflt : Number(String(v).replace(/[₹,\s]/g, '')));
const phoneOk = (p) => !p || /^[0-9+\-\s]{7,15}$/.test(p);
const bad = (msg) => ({ error: msg });

const KINDS = {
  // ---- rooms ----
  rooms: {
    prepare: async (db) => {
      const [types] = await db.query('SELECT id, name FROM RoomType');
      const [rooms] = await db.query('SELECT roomNumber FROM Room');
      return { types: Object.fromEntries(types.map((t) => [t.name.toLowerCase(), t.id])), have: new Set(rooms.map((r) => r.roomNumber.toLowerCase())) };
    },
    check: (r, ctx) => {
      if (!r.room) return bad('Room number is missing');
      if (r.room.length > 20) return bad('Room number is too long');
      const typeId = ctx.types[(r.type || '').toLowerCase()];
      if (!typeId) return bad(`Room type "${r.type || ''}" does not exist. Add it under Room types & rates first`);
      if (ctx.have.has(r.room.toLowerCase())) return { skip: 'Room already exists' };
      ctx.have.add(r.room.toLowerCase());
      return { ok: { roomNumber: r.room, roomTypeId: typeId, floor: r.floor || null, notes: r.notes || null } };
    },
    save: async (conn, ok) => H.insert(conn, 'Room', ok)
  },
  // ---- guests ----
  guests: {
    prepare: async (db) => {
      const [rows] = await db.query('SELECT phone FROM Customer WHERE phone IS NOT NULL');
      return { phones: new Set(rows.map((c) => c.phone)) };
    },
    check: (r, ctx) => {
      if (!r.name) return bad('Name is missing');
      if (!phoneOk(r.phone)) return bad('Phone number is not valid');
      if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) return bad('Email is not valid');
      const gstin = (r.gstin || '').toUpperCase();
      if (gstin && !GSTIN.test(gstin)) return bad('GSTIN is not valid');
      if (r.phone && ctx.phones.has(r.phone)) return { skip: 'A guest with this phone already exists' };
      if (r.phone) ctx.phones.add(r.phone);
      const company = r.companyname || '';
      return { ok: { type: company || /^company$/i.test(r.type || '') ? 'COMPANY' : 'INDIVIDUAL', name: r.name, phone: r.phone || null, email: r.email || null, companyName: company || null, gstin: gstin || null, address: r.address || null, idType: r.idtype || null, idNumber: r.idnumber || null, notes: r.notes || null } };
    },
    save: async (conn, ok) => H.insert(conn, 'Customer', ok)
  },
  // ---- staff ----
  staff: {
    prepare: async () => ({}),
    check: (r) => {
      if (!r.name) return bad('Name is missing');
      if (!r.designation) return bad('Designation is missing');
      const salary = num(r.monthlysalary, 0);
      if (!Number.isFinite(salary) || salary < 0) return bad('Monthly salary is not a number');
      const joinDate = r.joindate ? toDate(r.joindate) : null;
      if (r.joindate && !joinDate) return bad('Join date is not a valid date');
      if (!phoneOk(r.phone)) return bad('Phone number is not valid');
      if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) return bad('Email is not valid');
      return { ok: { name: r.name, designation: r.designation, department: r.department || null, phone: r.phone || null, email: r.email || null, monthlySalary: salary, joinDate, active: !/^(no|false|0|left)$/i.test(r.active || ''), address: r.address || null } };
    },
    save: async (conn, ok) => H.insert(conn, 'Staff', ok)
  },
  // ---- bookings (history or future) ----
  bookings: {
    prepare: async (db) => {
      const [rooms] = await db.query('SELECT r.id, r.roomNumber, r.roomTypeId, r.outOfService FROM Room r');
      const [existing] = await db.query('SELECT roomId, checkIn, checkOut FROM Booking WHERE status IN (?)', [H.BLOCKING]);
      const taken = {};
      existing.forEach((b) => (taken[b.roomId] = [...(taken[b.roomId] || []), [b.checkIn, b.checkOut]]));
      return { rooms: Object.fromEntries(rooms.map((r) => [r.roomNumber.toLowerCase(), r])), taken, settings: await H.getSettings(db) };
    },
    check: (r, ctx) => {
      if (!r.name) return bad('Guest name is missing');
      if (!phoneOk(r.phone)) return bad('Phone number is not valid');
      const room = ctx.rooms[(r.room || '').toLowerCase()];
      if (!room) return bad(`Room "${r.room || ''}" does not exist`);
      const checkIn = toDate(r.checkin);
      const checkOut = toDate(r.checkout);
      if (!checkIn || !checkOut) return bad('Check-in and check-out must be dates like 21/10/2026 or 2026-10-21');
      if (checkOut <= checkIn) return bad('Check-out must be after check-in');
      if (H.nightsBetween(checkIn, checkOut).length > 365) return bad('A stay cannot be longer than 365 nights');
      const status = (r.status || 'CONFIRMED').toUpperCase().replace(/[\s-]+/g, '_');
      if (!['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'PENDING'].includes(status)) return bad(`Status "${r.status}" is not one of confirmed, checked in, checked out, cancelled, no show`);
      const adults = num(r.adults, 1);
      const children = num(r.children, 0);
      if (!(adults >= 1) || !(children >= 0)) return bad('Adults and children must be numbers');
      const rate = r.rate === '' ? null : num(r.rate, null);
      if (rate !== null && !(rate >= 0)) return bad('Rate must be a number');
      const paid = num(r.paid, 0);
      if (!Number.isFinite(paid) || paid < 0) return bad('Paid amount must be a number');
      if (r.room && room.outOfService && H.BLOCKING.includes(status)) return bad(`Room ${room.roomNumber} is out of service`);
      if (H.BLOCKING.includes(status)) {
        const clash = (ctx.taken[room.id] || []).find(([a, b]) => a < checkOut && b > checkIn);
        if (clash) return bad(`Room ${room.roomNumber} is already booked ${clash[0]} to ${clash[1]}`);
        ctx.taken[room.id] = [...(ctx.taken[room.id] || []), [checkIn, checkOut]];
      }
      const source = ['DIRECT', 'PHONE', 'WALK_IN', 'WEBSITE', 'OTA', 'AGENT', 'CORPORATE'].includes((r.source || '').toUpperCase().replace(/[\s-]+/g, '_')) ? r.source.toUpperCase().replace(/[\s-]+/g, '_') : 'DIRECT';
      return { ok: { room, guest: { name: r.name, phone: r.phone || null, email: r.email || null, companyName: r.companyname || null, gstin: (r.gstin || '').toUpperCase() || null }, checkIn, checkOut, status, adults, children, rate, paid, source, notes: r.notes || null } };
    },
    save: async (conn, ok, ctx) => {
      // reuse a guest with the same phone (or the same name when there is no phone)
      let customerId;
      const { guest } = ok;
      const [found] = guest.phone ? await conn.query('SELECT id FROM Customer WHERE phone = ? LIMIT 1', [guest.phone]) : await conn.query('SELECT id FROM Customer WHERE LOWER(name) = LOWER(?) LIMIT 1', [guest.name]);
      if (found[0]) customerId = found[0].id;
      else customerId = await H.insert(conn, 'Customer', { type: guest.companyName ? 'COMPANY' : 'INDIVIDUAL', ...guest });

      const dates = H.nightsBetween(ok.checkIn, ok.checkOut);
      const nights = ok.rate !== null ? dates.map((date) => ({ date, price: ok.rate, gstPercent: H.gstForPrice(ok.rate, ctx.settings) })) : await H.priceNights(conn, ok.room.roomTypeId, dates, ctx.settings);
      const roomTotal = H.round2(nights.reduce((s, n) => s + n.price, 0));
      const id = await H.insert(conn, 'Booking', {
        bookingNumber: `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, customerId, roomId: ok.room.id, checkIn: ok.checkIn, checkOut: ok.checkOut,
        adults: ok.adults, children: ok.children, status: ok.status, source: ok.source, roomTotal, discount: 0, notes: ok.notes,
        checkedInAt: ['CHECKED_IN', 'CHECKED_OUT'].includes(ok.status) ? new Date(`${ok.checkIn}T12:00:00`) : null,
        checkedOutAt: ok.status === 'CHECKED_OUT' ? new Date(`${ok.checkOut}T11:00:00`) : null
      });
      await conn.query('INSERT INTO BookingNight (bookingId, date, price, gstPercent) VALUES ?', [nights.map((n) => [id, n.date, n.price, n.gstPercent])]);
      const number = `${ctx.settings.bookingPrefix}-${String(id).padStart(5, '0')}`;
      await conn.query('UPDATE Booking SET bookingNumber = ? WHERE id = ?', [number, id]);
      if (ok.paid > 0) await H.insert(conn, 'Payment', { bookingId: id, amount: ok.paid, method: 'CASH', note: 'Imported', paidAt: new Date(`${ok.checkIn}T12:00:00`) });
      if (ok.status === 'CHECKED_OUT') {
        const b = (await H.loadBooking(conn, id)).bill;
        await H.insert(conn, 'Invoice', { invoiceNumber: `${ctx.settings.invoicePrefix}-${ok.checkOut.slice(0, 4)}-${String(id).padStart(5, '0')}`, bookingId: id, roomSubtotal: b.roomSubtotal, chargesSubtotal: b.chargesSubtotal, discount: b.discount, taxTotal: b.taxTotal, total: b.total, paid: b.paid, balance: b.balance, issuedAt: new Date(`${ok.checkOut}T11:00:00`) });
      }
      return id;
    }
  }
};

// body: { rows: [{...}], commit: false|true, skipInvalid: false|true }
const importData = handler(async (req, res, db) => {
  const kind = KINDS[req.params.kind];
  if (!kind) throw new HotelError('Unknown import type', 404);
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw new HotelError('The file has no rows');
  if (rows.length > MAX_ROWS) throw new HotelError(`Import at most ${MAX_ROWS} rows at a time`);

  const ctx = await kind.prepare(db);
  const results = rows.map((raw, i) => {
    const r = rowOf(raw);
    if (!Object.values(r).some(Boolean)) return { row: i + 2, status: 'empty' };
    const out = kind.check(r, ctx);
    if (out.error) return { row: i + 2, status: 'error', message: out.error };
    if (out.skip) return { row: i + 2, status: 'skipped', message: out.skip };
    return { row: i + 2, status: 'ok', ok: out.ok };
  });

  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { total: results.filter((r) => r.status !== 'empty').length, valid: count('ok'), invalid: count('error'), skipped: count('skipped') };
  const view = results.map(({ ok, ...rest }) => rest);

  if (!req.body.commit) return Response.success(res, { data: { ...summary, committed: false, results: view }, message: 'Checked. Nothing was saved yet.' });
  if (summary.invalid && !req.body.skipInvalid) throw new HotelError(`${summary.invalid} row(s) have problems. Fix them, or import only the good rows.`, 400, { ...summary, results: view });
  if (!summary.valid) throw new HotelError('There is nothing valid to import.', 400, { ...summary, results: view });

  // the "ctx" used while saving must not remember the clashes of the checking pass
  const saveCtx = await kind.prepare(db);
  await db.transaction(async (conn) => {
    for (const r of results.filter((x) => x.status === 'ok')) await kind.save(conn, r.ok, saveCtx);
  });
  await audit(req, db, 'IMPORT', 'Import', null, `Imported ${summary.valid} ${req.params.kind}${summary.invalid ? ` (${summary.invalid} rows with problems left out)` : ''}`);
  Response.success(res, { data: { ...summary, committed: true, results: view }, message: `Imported ${summary.valid} ${req.params.kind}`, status: 201 });
});

module.exports = { onboard, importData };
