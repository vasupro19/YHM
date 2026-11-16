// Partner API for travel agencies (Travelytics and others). Authenticated by a hotel-issued key, not a login.
const express = require('express');
const rateLimit = require('express-rate-limit');
const Response = require('../Helpers/response.helper');
const P = require('../Controllers/partner.controller');

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, handler: (req, res) => Response.error(res, { status: 429, message: 'Too many requests. Try again in a minute.' }) }));
router.use(P.partnerAuth);

router
  .get('/hotel', P.hotelInfo)
  .get('/availability', P.availability)
  .post('/bookings', P.createBookings)
  .get('/bookings/:number', P.bookingStatus)
  .post('/bookings/:number/cancel', P.cancelBooking);

module.exports = router;
