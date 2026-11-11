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
          bill: b.bill, payments: b.payments.map((p) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt }))
        }
      }
    });
  } catch (error) {
    return Response.error(res, { message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
