const express = require('express');
const rateLimit = require('express-rate-limit');
const Response = require('../Helpers/response.helper');
const H = require('../Helpers/hotel.helper');
const { getDynamicConnectionForDatabase } = require('../Helpers/db.helper');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

// no login here, so keep it slow to guess
router.use(rateLimit({ windowMs: 60 * 1000, max: 60, handler: (req, res) => Response.error(res, { status: 429, message: 'Too many requests. Try again in a minute.' }) }));

// the guest's private bill page: /v1/public/bill/c<clientId>-<random>
router.get('/bill/:token', async (req, res) => {
  try {
    const match = String(req.params.token).match(/^c(\d+)-([a-f0-9]{32})$/);
    if (!match) return Response.error(res, { status: 404, message: 'This link is not valid.' });
    const client = await prisma.client.findUnique({ where: { id: Number(match[1]) }, select: { code: true } });
    if (!client) return Response.error(res, { status: 404, message: 'This link is not valid.' });

    const db = await getDynamicConnectionForDatabase(client.code);
    const [[row]] = await db.query('SELECT id FROM Booking WHERE shareToken = ?', [req.params.token]);
    if (!row) return Response.error(res, { status: 404, message: 'This link is not valid or was replaced.' });

    const b = await H.loadBooking(db, row.id);
    const s = await H.getSettings(db);
    // only what a guest needs to see: no internal notes, staff names or other bookings
    return Response.success(res, {
      data: {
        hotel: { name: s.hotelName, address: s.address, phone: s.phone, email: s.email, gstin: s.gstin, logoPath: s.logoPath, policy: s.policy, upiId: s.upiId, checkInTime: s.checkInTime, checkOutTime: s.checkOutTime },
        booking: {
          bookingNumber: b.bookingNumber, status: b.status, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults, children: b.children,
          guestName: b.customerName, companyName: b.companyName, guestGstin: b.customerGstin, roomTypeName: b.roomTypeName, roomNumber: b.roomNumber,
          invoiceNumber: b.invoice?.invoiceNumber || null, invoiceDate: b.invoice?.issuedAt || null,
          bill: b.bill, payments: b.payments.map((p) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt, receiptNo: require('../Helpers/messages').receiptNo(b, p) }))
        }
      }
    });
  } catch (error) {
    return Response.error(res, { message: 'Something went wrong. Please try again.' });
  }
});

// ---------------- online check-in: the guest fills in the register details and adds their ID before arriving ----------------
const multer = require('multer');
const G = require('../Helpers/guest.helper');
const { audit } = require('../Helpers/audit');

const openByToken = async (token) => {
  const match = String(token).match(/^c(\d+)-([a-f0-9]{32})$/);
  if (!match) return null;
  const client = await prisma.client.findUnique({ where: { id: Number(match[1]) }, select: { code: true } });
  if (!client) return null;
  const db = await getDynamicConnectionForDatabase(client.code);
  const [[row]] = await db.query('SELECT id, customerId, status, bookingNumber FROM Booking WHERE shareToken = ?', [token]);
  return row ? { db, booking: row, clientId: Number(match[1]) } : null;
};
const OPEN = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];
const fail = (res, error) => Response.error(res, { status: error.status || 500, message: error.status ? error.message : 'Something went wrong. Please try again.' });

router.get('/checkin/:token', async (req, res) => {
  try {
    const found = await openByToken(req.params.token);
    if (!found) return Response.error(res, { status: 404, message: 'This link is not valid or was replaced.' });
    const b = await H.loadBooking(found.db, found.booking.id);
    const s = await H.getSettings(found.db);
    const open = OPEN.includes(b.status);
    // after the stay the link no longer shows the guest's saved details
    const [[c]] = open ? await found.db.query('SELECT name, phone, email, address, nationality, gender, dob, careOf, idType, idNumber, foreignDetails FROM Customer WHERE id = ?', [found.booking.customerId]) : [[{ name: '' }]];
    return Response.success(res, {
      data: {
        open,
        hotel: { name: s.hotelName, address: s.address, phone: s.phone, logoPath: s.logoPath, checkInTime: s.checkInTime, checkOutTime: s.checkOutTime },
        booking: { bookingNumber: b.bookingNumber, status: b.status, checkIn: b.checkIn, checkOut: b.checkOut, roomTypeName: b.roomTypeName, adults: b.adults, children: b.children, precheckinAt: b.precheckinAt, ...(open ? { comingFrom: b.comingFrom, goingTo: b.goingTo, purpose: b.purpose, otherGuests: b.otherGuests } : {}) },
        guest: { ...c, foreignDetails: typeof c.foreignDetails === 'string' ? JSON.parse(c.foreignDetails || 'null') : c.foreignDetails || null, hasIdFront: open && b.hasIdFront, hasIdBack: open && b.hasIdBack }
      }
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/checkin/:token', express.json({ limit: '50kb' }), async (req, res) => {
  try {
    const found = await openByToken(req.params.token);
    if (!found) return Response.error(res, { status: 404, message: 'This link is not valid or was replaced.' });
    if (!OPEN.includes(found.booking.status)) return Response.error(res, { status: 400, message: 'This booking is closed, so details can no longer be added here.' });
    const body = req.body || {};
    const guest = G.cleanGuest(body);
    if (!String(body.name || '').trim()) return Response.error(res, { status: 400, message: 'Please enter your full name.' });
    guest.name = String(body.name).trim().slice(0, 120);
    if (body.phone !== undefined) guest.phone = String(body.phone || '').trim().slice(0, 20) || null;
    if (body.email !== undefined) {
      if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) return Response.error(res, { status: 400, message: 'Email is not valid.' });
      guest.email = body.email || null;
    }
    await H.update(found.db, 'Customer', guest, found.booking.customerId);
    await H.update(found.db, 'Booking', { ...G.cleanStay(body), precheckinAt: new Date() }, found.booking.id);
    await audit({ query: {} }, found.db, 'PRECHECKIN', 'Booking', found.booking.id, `${found.booking.bookingNumber}: guest filled in online check-in`);
    return Response.success(res, { message: 'Thank you. Your details are saved.' });
  } catch (error) {
    return fail(res, error);
  }
});

const guestPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('file');
const uploads = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, handler: (req, res) => Response.error(res, { status: 429, message: 'Too many uploads. Try again later.' }) });
router.post('/checkin/:token/id/:side', uploads, (req, res) =>
  guestPhoto(req, res, async (uploadError) => {
    try {
      if (uploadError) return Response.error(res, { status: 400, message: uploadError.code === 'LIMIT_FILE_SIZE' ? 'The photo is larger than 8 MB.' : 'Could not read the photo.' });
      const col = { front: 'idFront', back: 'idBack' }[req.params.side];
      if (!col) return Response.error(res, { status: 404, message: 'Not found' });
      const found = await openByToken(req.params.token);
      if (!found) return Response.error(res, { status: 404, message: 'This link is not valid or was replaced.' });
      if (!OPEN.includes(found.booking.status)) return Response.error(res, { status: 400, message: 'This booking is closed.' });
      const [[c]] = await found.db.query(`SELECT ${col} AS old FROM Customer WHERE id = ?`, [found.booking.customerId]);
      const rel = G.saveIdPhoto(found.clientId, found.booking.customerId, req.params.side, req.file);
      await found.db.query(`UPDATE Customer SET ${col} = ? WHERE id = ?`, [rel, found.booking.customerId]);
      if (c?.old) G.removeIdPhoto(c.old);
      await audit({ query: {} }, found.db, 'ID_PHOTO', 'Booking', found.booking.id, `${found.booking.bookingNumber}: guest added an ID photo (${req.params.side}) online`);
      return Response.success(res, { message: 'Photo saved.' });
    } catch (error) {
      return fail(res, error);
    }
  })
);

module.exports = router;
