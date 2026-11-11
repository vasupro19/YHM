// Standard hotel roles and the screens each one gets by default.
// The owner can still change any individual's access afterwards.
const HOTEL_MENUS = [
  '/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms', '/hotel/room-types',
  '/hotel/staff', '/hotel/payroll', '/hotel/reports', '/hotel/settings', '/hotel/activity', '/hotel/import'
];

const ROLE_PRESETS = {
  RECEPTIONIST: ['/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms'],
  HOUSEKEEPING: ['/hotel/rooms'],
  MANAGER: ['/hotel/calendar', '/hotel/bookings', '/hotel/customers', '/hotel/rooms', '/hotel/room-types', '/hotel/staff', '/hotel/reports'],
  ACCOUNTANT: ['/hotel/bookings', '/hotel/customers', '/hotel/staff', '/hotel/payroll', '/hotel/reports']
};

module.exports = { HOTEL_MENUS, ROLE_PRESETS };
