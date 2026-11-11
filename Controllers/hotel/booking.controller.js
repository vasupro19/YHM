const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit } = require('../../Helpers/audit');

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SOURCES = ['DIRECT', 'PHONE', 'WALK_IN', 'WEBSITE', 'OTA', 'AGENT', 'CORPORATE'];
const CHARGE_CATEGORIES = ['FOOD', 'RESTAURANT', 'LAUNDRY', 'SPA', 'MINIBAR', 'TRANSPORT', 'OTHER'];
const PAY_METHODS = ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];

// ================= customers =================
const customerData = (body) => {
  H.need(body, ['name']);
  const data = H.pick(body, ['type', 'name', 'phone', 'email', 'companyName', 'gstin', 'address', 'idType', 'idNumber', 'notes']);
  data.type = data.type === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL';
  data.name = String(data.name).trim();
  if (data.gstin) {
    data.gstin = String(data.gstin).toUpperCase();
    if (!GSTIN.test(data.gstin)) throw new HotelError('GSTIN is not valid');
  }
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) throw new HotelError('Email is not valid');
  return data;
};

const listCustomers = handler(async (req, res, db) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM Booking b WHERE b.customerId = c.id) AS bookingCount
       FROM Customer c ${q ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.companyName LIKE ? OR c.email LIKE ?' : ''}
      ORDER BY c.name LIMIT 500`,
    q ? [like, like, like, like] : []
  );
  Response.success(res, { data: rows });
});

const getCustomer = handler(async (req, res, db) => {
  const [[customer]] = await db.query('SELECT * FROM Customer WHERE id = ?', [Number(req.params.id)]);
  if (!customer) throw new HotelError('Customer not found', 404);
  const [bookings] = await db.query('SELECT b.id, b.bookingNumber, b.checkIn, b.checkOut, b.status, r.roomNumber FROM Booking b JOIN Room r ON r.id = b.roomId WHERE b.customerId = ? ORDER BY b.checkIn DESC', [customer.id]);
  Response.success(res, { data: { ...customer, bookings } });
});

const createCustomer = handler(async (req, res, db) => {
  const data = customerData(req.body);
  const id = await H.insert(db, 'Customer', data);
  await audit(req, db, 'CREATE', 'Customer', id, `Guest ${data.name} added`);
  Response.success(res, { data: { id }, message: 'Customer added', status: 201 });
});

const updateCustomer = handler(async (req, res, db) => {
  const data = customerData(req.body);
  await H.update(db, 'Customer', data, Number(req.params.id));
  await audit(req, db, 'UPDATE', 'Customer', Number(req.params.id), `Guest ${data.name} changed`);
  Response.success(res, { message: 'Customer updated' });
});

// ================= bookings =================
const listBookings = handler(async (req, res, db) => {
  const { status, from, to, q, customerId, roomId } = req.query;
  const where = [];
  const values = [];
  if (status) (where.push('b.status IN (?)'), values.push(String(status).split(',')));
  if (H.isYmd(from)) (where.push('b.checkOut > ?'), values.push(from));
  if (H.isYmd(to)) (where.push('b.checkIn < ?'), values.push(to));
  if (customerId) (where.push('b.customerId = ?'), values.push(Number(customerId)));
  if (roomId) (where.push('b.roomId = ?'), values.push(Number(roomId)));
  if (q) {
    where.push('(b.bookingNumber LIKE ? OR c.name LIKE ? OR c.companyName LIKE ? OR r.roomNumber LIKE ?)');
    values.push(...Array(4).fill(`%${String(q).trim()}%`));
  }
  const [rows] = await db.query(
    `SELECT b.id, b.bookingNumber, b.customerId, b.roomId, b.checkIn, b.checkOut, b.adults, b.children, b.status, b.source, b.discount, b.createdAt,
            c.name AS customerName, c.type AS customerType, c.companyName, r.roomNumber, t.name AS roomTypeName
       FROM Booking b JOIN Customer c ON c.id = b.customerId JOIN Room r ON r.id = b.roomId JOIN RoomType t ON t.id = r.roomTypeId
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.checkIn DESC, b.id DESC LIMIT 500`,
    values
  );
  Response.success(res, { data: await H.attachBills(db, rows) });
});

const getBooking = handler(async (req, res, db) => {
  Response.success(res, { data: await H.loadBooking(db, Number(req.params.id)) });
});

// locks the room row so two simultaneous requests can't both pass the availability check
const lockRoom = async (conn, roomId) => {
  const [[room]] = await conn.query('SELECT r.id, r.roomNumber, r.roomTypeId, r.outOfService FROM Room r WHERE r.id = ? FOR UPDATE', [roomId]);
  if (!room) throw new HotelError('Room not found', 404);
  if (room.outOfService) throw new HotelError(`Room ${room.roomNumber} is out of service`);
  return room;
};

const assertGuests = (adults, children) => {
  if (!(Number(adults) >= 1)) throw new HotelError('At least one adult is required');
  if (Number(children) < 0) throw new HotelError('Children cannot be negative');
};

const createBooking = handler(async (req, res, db) => {
  const b = req.body;
  H.need(b, ['roomId', 'checkIn', 'checkOut']);
  H.assertStay(b.checkIn, b.checkOut);
  assertGuests(b.adults ?? 1, b.children ?? 0);
  if (!b.customerId && !b.customer) throw new HotelError('Choose or add a customer');
  const status = b.status === 'PENDING' ? 'PENDING' : 'CONFIRMED';
  const discount = b.discount ? H.money(b.discount, 'Discount') : 0;
  const advance = b.advance ? H.money(b.advance, 'Advance') : 0;
  if (advance && !PAY_METHODS.includes(b.advanceMethod || 'CASH')) throw new HotelError('Unknown payment method');
  const settings = await H.getSettings(db);

  const bookingId = await db.transaction(async (conn) => {
    const room = await lockRoom(conn, Number(b.roomId));
    const conflicts = await H.findConflicts(conn, room.id, b.checkIn, b.checkOut);
    if (conflicts.length) throw new HotelError(H.describeConflict(conflicts[0]), 409, conflicts);

    let customerId = Number(b.customerId);
    if (customerId) {
      const [[c]] = await conn.query('SELECT id FROM Customer WHERE id = ?', [customerId]);
      if (!c) throw new HotelError('Customer not found', 404);
    } else {
      customerId = await H.insert(conn, 'Customer', customerData(b.customer));
    }

    const nights = await H.priceNights(conn, room.roomTypeId, H.nightsBetween(b.checkIn, b.checkOut), settings);
    const roomTotal = H.round2(nights.reduce((s, n) => s + n.price, 0));
    if (discount > roomTotal) throw new HotelError('Discount cannot be more than the room total');

    const id = await H.insert(conn, 'Booking', {
      bookingNumber: `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      roomId: room.id,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      adults: Number(b.adults ?? 1),
      children: Number(b.children ?? 0),
      status,
      source: SOURCES.includes(b.source) ? b.source : 'DIRECT',
      roomTotal,
      discount,
      notes: b.notes || null,
      createdBy: Number(req.query.auth_user_id) || null
    });
    await conn.query('INSERT INTO BookingNight (bookingId, date, price, gstPercent) VALUES ?', [nights.map((n) => [id, n.date, n.price, n.gstPercent])]);
    await conn.query('UPDATE Booking SET bookingNumber = ? WHERE id = ?', [`${settings.bookingPrefix}-${String(id).padStart(5, '0')}`, id]);
    if (advance) await H.insert(conn, 'Payment', { bookingId: id, amount: advance, method: b.advanceMethod || 'CASH', note: 'Advance', createdBy: Number(req.query.auth_user_id) || null });
    return id;
  });

  const created = await H.loadBooking(db, bookingId);
  await audit(req, db, 'CREATE', 'Booking', bookingId, `${created.bookingNumber} created for ${created.customerName}, room ${created.roomNumber}, ${created.checkIn} to ${created.checkOut}`);
  Response.success(res, { data: created, message: 'Booking created', status: 201 });
});

const EDITABLE = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];

const updateBooking = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const b = req.body;
  const settings = await H.getSettings(db);

  await db.transaction(async (conn) => {
    const [[cur]] = await conn.query('SELECT b.*, r.roomTypeId FROM Booking b JOIN Room r ON r.id = b.roomId WHERE b.id = ? FOR UPDATE', [id]);
    if (!cur) throw new HotelError('Booking not found', 404);
    if (!EDITABLE.includes(cur.status)) throw new HotelError(`A ${cur.status.replace('_', ' ').toLowerCase()} booking can't be edited`);

    const next = {
      roomId: Number(b.roomId ?? cur.roomId),
      checkIn: b.checkIn ?? cur.checkIn,
      checkOut: b.checkOut ?? cur.checkOut,
      adults: Number(b.adults ?? cur.adults),
      children: Number(b.children ?? cur.children)
    };
    H.assertStay(next.checkIn, next.checkOut);
    assertGuests(next.adults, next.children);
    if (cur.status === 'CHECKED_IN' && next.checkIn !== cur.checkIn) throw new HotelError("Check-in date can't change once the guest has arrived");

    const room = await lockRoom(conn, next.roomId);
    const conflicts = await H.findConflicts(conn, room.id, next.checkIn, next.checkOut, id);
    if (conflicts.length) throw new HotelError(H.describeConflict(conflicts[0]), 409, conflicts);

    // keep the price a guest was quoted for nights that stay; price new nights at today's rate
    const dates = H.nightsBetween(next.checkIn, next.checkOut);
    const [old] = await conn.query('SELECT date, price, gstPercent FROM BookingNight WHERE bookingId = ?', [id]);
    const sameType = room.roomTypeId === cur.roomTypeId;
    const keep = Object.fromEntries(old.filter((n) => sameType).map((n) => [n.date, n]));
    const fresh = await H.priceNights(conn, room.roomTypeId, dates.filter((d) => !keep[d]), settings);
    const freshByDate = Object.fromEntries(fresh.map((n) => [n.date, n]));
    const nights = dates.map((d) => keep[d] || freshByDate[d]);
    const roomTotal = H.round2(nights.reduce((s, n) => s + n.price, 0));
    const discount = b.discount !== undefined ? H.money(b.discount || 0, 'Discount') : cur.discount;
    if (discount > roomTotal) throw new HotelError('Discount cannot be more than the room total');

    await conn.query('DELETE FROM BookingNight WHERE bookingId = ?', [id]);
    await conn.query('INSERT INTO BookingNight (bookingId, date, price, gstPercent) VALUES ?', [nights.map((n) => [id, n.date, n.price, n.gstPercent])]);
    await H.update(conn, 'Booking', {
      ...next,
      roomTotal,
      discount,
      notes: b.notes !== undefined ? b.notes || null : cur.notes,
      source: SOURCES.includes(b.source) ? b.source : cur.source,
      customerId: b.customerId ? Number(b.customerId) : cur.customerId
    }, id);
  });

  const updated = await H.loadBooking(db, id);
  await audit(req, db, 'UPDATE', 'Booking', id, `${updated.bookingNumber} edited: room ${updated.roomNumber}, ${updated.checkIn} to ${updated.checkOut}, discount ₹${updated.discount}`);
  Response.success(res, { data: updated, message: 'Booking updated' });
});

const nextInvoiceNumber = async (conn, settings, id) => `${settings.invoicePrefix}-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;

const changeStatus = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const { action } = req.body;
  const settings = await H.getSettings(db);
  const today = H.today();

  await db.transaction(async (conn) => {
    const [[b]] = await conn.query('SELECT * FROM Booking WHERE id = ? FOR UPDATE', [id]);
    if (!b) throw new HotelError('Booking not found', 404);
    const must = (...statuses) => {
      if (!statuses.includes(b.status)) throw new HotelError(`Can't ${action} a booking that is ${b.status.replace('_', ' ').toLowerCase()}`);
    };

    if (action === 'confirm') {
      must('PENDING');
      await H.update(conn, 'Booking', { status: 'CONFIRMED' }, id);
    } else if (action === 'checkin') {
      must('PENDING', 'CONFIRMED');
      if (b.checkIn > today) throw new HotelError(`Arrival is on ${b.checkIn}; the guest can't be checked in earlier`);
      if (b.checkOut <= today) throw new HotelError('This stay has already ended; edit the dates first');
      const [[room]] = await conn.query('SELECT roomNumber, outOfService FROM Room WHERE id = ?', [b.roomId]);
      if (room.outOfService) throw new HotelError(`Room ${room.roomNumber} is out of service`);
      await H.update(conn, 'Booking', { status: 'CHECKED_IN', checkedInAt: new Date() }, id);
    } else if (action === 'checkout') {
      must('CHECKED_IN');
      const patch = { status: 'CHECKED_OUT', checkedOutAt: new Date() };
      // leaving early frees the room for the nights not stayed, and the guest isn't billed for them
      const lastNight = today > b.checkIn ? today : H.addDays(b.checkIn, 1); // at least one night is always billed
      if (lastNight < b.checkOut) {
        patch.checkOut = lastNight;
        await conn.query('DELETE FROM BookingNight WHERE bookingId = ? AND date >= ?', [id, lastNight]);
        const [[sum]] = await conn.query('SELECT COALESCE(SUM(price), 0) AS total FROM BookingNight WHERE bookingId = ?', [id]);
        patch.roomTotal = sum.total;
        if (b.discount > sum.total) patch.discount = sum.total;
      }
      await H.update(conn, 'Booking', patch, id);
      await H.update(conn, 'Room', { status: 'DIRTY' }, b.roomId);
      const [[existing]] = await conn.query('SELECT id FROM Invoice WHERE bookingId = ?', [id]);
      if (!existing) {
        const full = await H.loadBooking(conn, id);
        const bill = full.bill;
        await H.insert(conn, 'Invoice', {
          invoiceNumber: await nextInvoiceNumber(conn, settings, id),
          bookingId: id,
          roomSubtotal: bill.roomSubtotal,
          chargesSubtotal: bill.chargesSubtotal,
          discount: bill.discount,
          taxTotal: bill.taxTotal,
          total: bill.total,
          paid: bill.paid,
          balance: bill.balance
        });
      }
    } else if (action === 'cancel') {
      must('PENDING', 'CONFIRMED');
      await H.update(conn, 'Booking', { status: 'CANCELLED' }, id);
    } else if (action === 'noshow') {
      must('CONFIRMED', 'PENDING');
      if (b.checkIn > today) throw new HotelError("The arrival date hasn't passed yet");
      await H.update(conn, 'Booking', { status: 'NO_SHOW' }, id);
    } else {
      throw new HotelError('Unknown action. Use confirm, checkin, checkout, cancel or noshow');
    }
  });

  const full = await H.syncInvoice(db, id);
  await audit(req, db, action.toUpperCase(), 'Booking', id, `${full.bookingNumber} ${full.status.replace('_', ' ').toLowerCase()}${full.invoice ? ` (${full.invoice.invoiceNumber}, total ₹${full.bill.total})` : ''}`);
  Response.success(res, { data: full, message: `Booking ${full.status.replace('_', ' ').toLowerCase()}` });
});

// ---------- charges (food, restaurant, laundry …) ----------
const addCharge = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const b = req.body;
  H.need(b, ['category', 'description', 'unitPrice']);
  if (!CHARGE_CATEGORIES.includes(b.category)) throw new HotelError(`category must be one of ${CHARGE_CATEGORIES.join(', ')}`);
  const quantity = Number(b.quantity ?? 1);
  if (!(quantity > 0)) throw new HotelError('Quantity must be more than zero');
  const gstPercent = Number(b.gstPercent ?? 0);
  if (!(gstPercent >= 0 && gstPercent <= 100)) throw new HotelError('GST must be between 0 and 100');
  const chargeDate = b.chargeDate || H.today();
  if (!H.isYmd(chargeDate)) throw new HotelError('Charge date is not valid');

  const [[booking]] = await db.query('SELECT status FROM Booking WHERE id = ?', [id]);
  if (!booking) throw new HotelError('Booking not found', 404);
  if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(booking.status)) throw new HotelError(`Charges can't be added to a ${booking.status.replace('_', ' ').toLowerCase()} booking`);

  await H.insert(db, 'Charge', { bookingId: id, category: b.category, description: String(b.description).trim(), quantity, unitPrice: H.money(b.unitPrice, 'Unit price'), gstPercent, chargeDate, createdBy: Number(req.query.auth_user_id) || null });
  const withCharge = await H.loadBooking(db, id);
  await audit(req, db, 'CHARGE_ADDED', 'Booking', id, `${withCharge.bookingNumber}: ${String(b.description).trim()} ₹${H.round2(quantity * b.unitPrice)} (${b.category.toLowerCase()})`);
  Response.success(res, { data: withCharge, message: 'Charge added', status: 201 });
});

const deleteCharge = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[booking]] = await db.query('SELECT status FROM Booking WHERE id = ?', [id]);
  if (!booking) throw new HotelError('Booking not found', 404);
  if (booking.status === 'CHECKED_OUT') throw new HotelError("The bill is final; charges can't be removed after checkout");
  const [[gone]] = await db.query('SELECT description, quantity, unitPrice FROM Charge WHERE id = ? AND bookingId = ?', [Number(req.params.chargeId), id]);
  await db.query('DELETE FROM Charge WHERE id = ? AND bookingId = ?', [Number(req.params.chargeId), id]);
  const after = await H.loadBooking(db, id);
  if (gone) await audit(req, db, 'CHARGE_REMOVED', 'Booking', id, `${after.bookingNumber}: removed ${gone.description} ₹${H.round2(gone.quantity * gone.unitPrice)}`);
  Response.success(res, { data: after, message: 'Charge removed' });
});

// ---------- payments ----------
const addPayment = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const b = req.body;
  const amount = H.money(b.amount, 'Amount');
  if (!(amount > 0)) throw new HotelError('Amount must be more than zero');
  const method = b.method || 'CASH';
  if (!PAY_METHODS.includes(method)) throw new HotelError(`method must be one of ${PAY_METHODS.join(', ')}`);
  const [[booking]] = await db.query('SELECT status FROM Booking WHERE id = ?', [id]);
  if (!booking) throw new HotelError('Booking not found', 404);

  await H.insert(db, 'Payment', { bookingId: id, amount, method, reference: b.reference || null, note: b.note || null, createdBy: Number(req.query.auth_user_id) || null });
  const paid = await H.syncInvoice(db, id);
  await audit(req, db, 'PAYMENT_ADDED', 'Booking', id, `${paid.bookingNumber}: received ₹${amount} by ${method.toLowerCase()}`);
  Response.success(res, { data: paid, message: 'Payment recorded', status: 201 });
});

const deletePayment = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[booking]] = await db.query('SELECT status FROM Booking WHERE id = ?', [id]);
  if (!booking) throw new HotelError('Booking not found', 404);
  if (booking.status === 'CHECKED_OUT') throw new HotelError("The bill is final; payments can't be removed after checkout");
  const [[gonePay]] = await db.query('SELECT amount, method FROM Payment WHERE id = ? AND bookingId = ?', [Number(req.params.paymentId), id]);
  await db.query('DELETE FROM Payment WHERE id = ? AND bookingId = ?', [Number(req.params.paymentId), id]);
  const afterPay = await H.loadBooking(db, id);
  if (gonePay) await audit(req, db, 'PAYMENT_REMOVED', 'Booking', id, `${afterPay.bookingNumber}: removed payment ₹${gonePay.amount} (${gonePay.method.toLowerCase()})`);
  Response.success(res, { data: afterPay, message: 'Payment removed' });
});

// ---------- invoice (bill for the guest) ----------
const getInvoice = handler(async (req, res, db) => {
  const booking = await H.loadBooking(db, Number(req.params.id));
  const settings = await H.getSettings(db);
  Response.success(res, { data: { booking, settings, proforma: !booking.invoice } });
});

// ---------- sharing with the guest ----------
const crypto = require('crypto');
const { buildMessages, waNumber, SUBJECTS } = require('../../Helpers/messages');
const { sendMail } = require('../../Helpers/mailer');

const appUrl = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');

// every booking gets one private link (c<clientId>-<random>) that opens its bill without logging in
const ensureToken = async (db, clientId, id, regenerate = false) => {
  const [[row]] = await db.query('SELECT shareToken FROM Booking WHERE id = ?', [id]);
  if (!row) throw new HotelError('Booking not found', 404);
  if (row.shareToken && !regenerate) return row.shareToken;
  const token = `c${clientId}-${crypto.randomBytes(16).toString('hex')}`;
  await db.query('UPDATE Booking SET shareToken = ? WHERE id = ?', [token, id]);
  return token;
};

const share = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const regenerate = Boolean(req.body?.regenerate);
  const token = await ensureToken(db, req.clientId, id, regenerate);
  const booking = await H.loadBooking(db, id);
  const settings = await H.getSettings(db);
  if (regenerate) await audit(req, db, 'LINK_RESET', 'Booking', id, `${booking.bookingNumber}: private bill link replaced (the old link no longer works)`);
  Response.success(res, {
    data: {
      token,
      phone: waNumber(booking.customerPhone),
      email: booking.customerEmail || '',
      balance: booking.bill.balance,
      upiId: settings.upiId || '',
      hotelName: settings.hotelName || '',
      messages: buildMessages(booking, settings)
    }
  });
});

// emails one of the standard messages to the guest
const emailGuest = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const kind = req.body?.kind;
  if (!SUBJECTS[kind]) throw new HotelError('Unknown message type');
  const booking = await H.loadBooking(db, id);
  if (!booking.customerEmail) throw new HotelError('This guest has no email address saved');
  const settings = await H.getSettings(db);
  const token = await ensureToken(db, req.clientId, id);
  const text = (typeof req.body.text === 'string' && req.body.text.trim() ? req.body.text : buildMessages(booking, settings)[kind]).replace(/\{\{BILL_LINK\}\}/g, `${appUrl()}/b/${token}`).slice(0, 4000);
  const escape = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-line">${escape(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</div>`;
  let info;
  try {
    info = await sendMail({ to: booking.customerEmail, subject: SUBJECTS[kind](booking, settings), text, html, fromName: settings.hotelName, replyTo: settings.email });
  } catch (mailError) {
    throw new HotelError(mailError.message, 502);
  }
  await audit(req, db, 'EMAIL_SENT', 'Booking', id, `${booking.bookingNumber}: ${kind} email ${info.logged ? 'prepared (email is not set up on the server)' : 'sent'} to ${booking.customerEmail}`);
  Response.success(res, { message: info.logged ? 'Email is not set up on the server yet, so nothing was sent.' : `Email sent to ${booking.customerEmail}` });
});

module.exports = { share, emailGuest, listCustomers, getCustomer, createCustomer, updateCustomer, listBookings, getBooking, createBooking, updateBooking, changeStatus, addCharge, deleteCharge, addPayment, deletePayment, getInvoice };
