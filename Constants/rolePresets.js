// Standard hotel roles and the screens each one gets by default.
// The owner can still change any individual's access afterwards.
const HOTEL_MENUS = [
  '/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms', '/hotel/room-types',
  '/hotel/staff', '/hotel/payroll', '/hotel/reports', '/hotel/settings', '/hotel/activity', '/hotel/import',
  '/hotel/day-report', '/hotel/cash', '/hotel/register', '/hotel/gst', '/hotel/agents'
];

const ROLE_PRESETS = {
  RECEPTIONIST: ['/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms', '/hotel/cash', '/hotel/register'],
  HOUSEKEEPING: ['/hotel/rooms'],
  MANAGER: ['/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms', '/hotel/room-types', '/hotel/staff', '/hotel/reports', '/hotel/cash', '/hotel/register', '/hotel/day-report'],
  ACCOUNTANT: ['/hotel/bookings', '/hotel/customers', '/hotel/staff', '/hotel/payroll', '/hotel/reports', '/hotel/day-report', '/hotel/gst']
};

module.exports = { HOTEL_MENUS, ROLE_PRESETS };
