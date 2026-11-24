const express = require('express');
const { authJwt } = require('../Middleware/apiAuth.middleware');
const dynamicDbConnectionMiddleware = require('../Middleware/getDynamicConnection.middleware');
const { requireMenu: need } = require('../Middleware/menuAccess.middleware');
const { HOTEL_MENUS } = require('../Constants/rolePresets');
const inventory = require('../Controllers/hotel/inventory.controller');
const booking = require('../Controllers/hotel/booking.controller');
const staff = require('../Controllers/hotel/staff.controller');
const report = require('../Controllers/hotel/report.controller');
const activity = require('../Controllers/hotel/activity.controller');
const setup = require('../Controllers/hotel/setup.controller');
const control = require('../Controllers/hotel/control.controller');
const reg = require('../Controllers/hotel/register.controller');
const gst = require('../Controllers/hotel/gst.controller');
const partner = require('../Controllers/partner.controller');
const emailBooking = require('../Controllers/hotel/emailBooking.controller');

const router = express.Router();

// every hotel route needs a logged-in user and the client's own database (?clientId=…)
router.use(authJwt, dynamicDbConnectionMiddleware);

// screens that read the same data as others (e.g. the booking form needs rooms and guests)
const FRONT = ['/hotel/calendar', '/hotel/bookings'];

router
  .get('/settings', need(...HOTEL_MENUS), inventory.getSettings)
  .put('/settings', need('/hotel/settings'), inventory.updateSettings)

  .get('/room-types', need('/hotel/room-types', '/hotel/rooms', ...FRONT), inventory.listRoomTypes)
  .post('/room-types', need('/hotel/room-types'), inventory.createRoomType)
  .put('/room-types/:id', need('/hotel/room-types'), inventory.updateRoomType)

  .get('/rates', need('/hotel/room-types'), inventory.listRates)
  .put('/rates', need('/hotel/room-types'), inventory.setRates)

  .get('/rooms', need('/hotel/rooms', ...FRONT), inventory.listRooms)
  .post('/rooms', need('/hotel/room-types'), inventory.createRoom)
  .put('/rooms/:id', need('/hotel/room-types'), inventory.updateRoom)
  .put('/rooms/:id/housekeeping', need('/hotel/rooms'), inventory.setHousekeeping)

  .get('/availability', need(...FRONT), inventory.availability)
  .get('/calendar', need(...FRONT), inventory.calendar)

  .get('/customers', need('/hotel/customers', ...FRONT), booking.listCustomers)
  .post('/customers', need('/hotel/customers', ...FRONT), booking.createCustomer)
  .get('/customers/:id', need('/hotel/customers', ...FRONT), booking.getCustomer)
  .put('/customers/:id', need('/hotel/customers'), booking.updateCustomer)

  .get('/bookings', need(...FRONT, '/hotel/customers', '/hotel/reports'), booking.listBookings)
  .post('/bookings', need(...FRONT), booking.createBooking)
  .get('/bookings/:id', need(...FRONT, '/hotel/customers', '/hotel/reports'), booking.getBooking)
  .put('/bookings/:id', need('/hotel/bookings'), booking.updateBooking)
  .post('/bookings/:id/status', need('/hotel/bookings'), booking.changeStatus)
  .post('/bookings/:id/charges', need('/hotel/bookings'), booking.addCharge)
  .delete('/bookings/:id/charges/:chargeId', need('/hotel/bookings'), booking.deleteCharge)
  .post('/bookings/:id/payments', need('/hotel/bookings'), booking.addPayment)
  .delete('/bookings/:id/payments/:paymentId', need('/hotel/bookings'), booking.deletePayment)
  .get('/bookings/:id/invoice', need('/hotel/bookings', '/hotel/reports'), booking.getInvoice)
  .post('/bookings/:id/share', need('/hotel/bookings'), booking.share)
  .post('/bookings/:id/email', need('/hotel/bookings'), booking.emailGuest)

  .get('/staff', need('/hotel/staff', '/hotel/payroll'), staff.listStaff)
  .post('/staff', need('/hotel/staff'), staff.createStaff)
  .put('/staff/:id', need('/hotel/staff'), staff.updateStaff)
  .get('/payroll', need('/hotel/payroll'), staff.payroll)
  .post('/payroll', need('/hotel/payroll'), staff.paySalary)
  .delete('/payroll/:id', need('/hotel/payroll'), staff.deleteSalary)

  .get('/dashboard', need(...HOTEL_MENUS), report.dashboard)
  .get('/reports', need('/hotel/reports'), report.report)
  .get('/activity', need('/hotel/activity'), activity.list)

  // cash drawer: anyone who takes payments closes their own; the owner sees every close
  .get('/cash/drawer', need('/hotel/cash', '/hotel/bookings'), control.drawer)
  .post('/cash/close', need('/hotel/cash', '/hotel/bookings'), control.closeDrawer)
  .get('/cash/closes', need('/hotel/day-report'), control.closes)
  .get('/day-report', need('/hotel/day-report'), control.dayReport)
  .get('/gst/gstr1', need('/hotel/gst'), gst.gstr1)

  // travel agencies allowed to see availability and send booking requests
  .get('/agent-links', need('/hotel/agents'), partner.listLinks)
  .post('/agent-links', need('/hotel/agents'), partner.createLink)
  .put('/agent-links/:id', need('/hotel/agents'), partner.updateLink)

  // booking emails from OTAs and agents, read by AI
  .get('/email-bookings', need('/hotel/settings', '/hotel/bookings'), emailBooking.overview)
  .post('/email-bookings/paste', need('/hotel/settings', '/hotel/bookings'), emailBooking.paste)
  .post('/email-bookings/:id/handled', need('/hotel/settings', '/hotel/bookings'), emailBooking.dismiss)
  .put('/email-bookings/settings', need('/hotel/settings'), emailBooking.saveSettings)
  .post('/email-bookings/check', need('/hotel/settings', '/hotel/bookings'), emailBooking.checkNow)

  // guest register, ID photos and Form C
  .put('/bookings/:id/guest-details', need(...FRONT, '/hotel/register'), reg.saveGuestDetails)
  .post('/customers/:id/id-photo/:side', need(...FRONT, '/hotel/customers', '/hotel/register'), reg.uploadIdPhoto)
  .get('/customers/:id/id-photo/:side', need(...FRONT, '/hotel/customers', '/hotel/register'), reg.getIdPhoto)
  .delete('/customers/:id/id-photo/:side', need(...FRONT, '/hotel/customers', '/hotel/register'), reg.removeIdPhoto)
  .get('/register', need('/hotel/register'), reg.register)
  .get('/form-c', need('/hotel/register'), reg.formC)
  .post('/bookings/:id/form-c', need('/hotel/register'), reg.markFormC)

  .post('/onboarding', need('/hotel/settings'), setup.onboard)
  .post('/import/:kind', need('/hotel/import'), setup.importData);

module.exports = router;
