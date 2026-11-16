// Guest register: ID details and photos at check-in, the police register and Form C for foreign guests.
const multer = require('multer');
const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit } = require('../../Helpers/audit');
const G = require('../../Helpers/guest.helper');

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('file');
// multer errors (file too big …) become a plain message
const withPhoto = (req, res, next) =>
  photoUpload(req, res, (error) => {
    if (!error) return next();
    return Response.badRequest(res, { message: error.code === 'LIMIT_FILE_SIZE' ? 'The photo is larger than 8 MB' : error.message });
  });

const SIDES = { front: 'idFront', back: 'idBack' };
const sideOf = (req) => {
  const col = SIDES[req.params.side];
  if (!col) throw new HotelError('Not found', 404);
  return col;
};

// saves what the check-in form collects about the guest and the stay
const saveGuestDetails = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[booking]] = await db.query('SELECT id, customerId, bookingNumber FROM Booking WHERE id = ?', [id]);
  if (!booking) throw new HotelError('Booking not found', 404);
  const guest = G.cleanGuest(req.body);
  if (req.body.phone !== undefined) guest.phone = req.body.phone ? String(req.body.phone).trim().slice(0, 20) : null;
  if (req.body.name !== undefined) {
    if (!String(req.body.name || '').trim()) throw new HotelError('Name is required');
    guest.name = String(req.body.name).trim().slice(0, 120);
  }
  await H.update(db, 'Customer', guest, booking.customerId);
  await H.update(db, 'Booking', G.cleanStay(req.body), id);
  const full = await H.loadBooking(db, id);
  await audit(req, db, 'GUEST_DETAILS', 'Booking', id, `${booking.bookingNumber}: guest details saved for ${full.customerName}`);
  Response.success(res, { data: full, message: 'Guest details saved' });
});

const uploadIdPhoto = [
  withPhoto,
  handler(async (req, res, db) => {
    const col = sideOf(req);
    const customerId = Number(req.params.id);
    const [[c]] = await db.query(`SELECT id, name, ${col} AS old FROM Customer WHERE id = ?`, [customerId]);
    if (!c) throw new HotelError('Guest not found', 404);
    const rel = G.saveIdPhoto(req.clientId, customerId, req.params.side, req.file);
    await db.query(`UPDATE Customer SET ${col} = ? WHERE id = ?`, [rel, customerId]);
    if (c.old) G.removeIdPhoto(c.old);
    await audit(req, db, 'ID_PHOTO', 'Customer', customerId, `ID photo (${req.params.side}) saved for ${c.name}`);
    Response.success(res, { message: 'ID photo saved', status: 201 });
  })
];

const getIdPhoto = handler(async (req, res, db) => {
  const col = sideOf(req);
  const [[c]] = await db.query(`SELECT ${col} AS rel FROM Customer WHERE id = ?`, [Number(req.params.id)]);
  const full = G.idPhotoPath(c?.rel);
  if (!full) throw new HotelError('No photo', 404);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.sendFile(full);
});

const removeIdPhoto = handler(async (req, res, db) => {
  const col = sideOf(req);
  const customerId = Number(req.params.id);
  const [[c]] = await db.query(`SELECT name, ${col} AS rel FROM Customer WHERE id = ?`, [customerId]);
  if (!c) throw new HotelError('Guest not found', 404);
  if (c.rel) G.removeIdPhoto(c.rel);
  await db.query(`UPDATE Customer SET ${col} = NULL WHERE id = ?`, [customerId]);
  await audit(req, db, 'ID_PHOTO', 'Customer', customerId, `ID photo (${req.params.side}) removed for ${c.name}`);
  Response.success(res, { message: 'ID photo removed' });
});

const REGISTER_SELECT = `
  SELECT b.id, b.bookingNumber, b.checkIn, b.checkOut, b.checkedInAt, b.checkedOutAt, b.status, b.adults, b.children,
         b.comingFrom, b.goingTo, b.purpose, b.otherGuests, b.formCSubmittedAt, b.formCRef, b.precheckinAt,
         c.id AS customerId, c.name, c.phone, c.email, c.address, c.nationality, c.gender, c.dob, c.careOf, c.idType, c.idNumber,
         c.foreignDetails, c.idFront IS NOT NULL AS hasIdFront, c.idBack IS NOT NULL AS hasIdBack, c.companyName,
         r.roomNumber
    FROM Booking b JOIN Customer c ON c.id = b.customerId JOIN Room r ON r.id = b.roomId`;

const shape = (row) => {
  const foreignDetails = typeof row.foreignDetails === 'string' ? JSON.parse(row.foreignDetails || 'null') : row.foreignDetails;
  const c = { ...row, foreignDetails, idFront: row.hasIdFront, hasIdFront: Boolean(row.hasIdFront), hasIdBack: Boolean(row.hasIdBack) };
  return { ...c, foreign: !G.isIndian(row.nationality), missing: G.missingDetails(c, row) };
};

// every guest who stayed (checked in) between two dates, in arrival order: the register the police ask to see
const register = handler(async (req, res, db) => {
  const { from, to } = req.query;
  if (!H.isYmd(from) || !H.isYmd(to) || to < from) throw new HotelError('Choose a valid date range');
  const [rows] = await db.query(`${REGISTER_SELECT} WHERE b.checkedInAt >= ? AND b.checkedInAt < ? ORDER BY b.checkedInAt, b.id`, [from, H.addDays(to, 1)]);
  Response.success(res, { data: rows.map(shape) });
});

// foreign guests: Form C has to be filed on the FRRO site within 24 hours of arrival
const formC = handler(async (req, res, db) => {
  const all = req.query.show === 'all';
  const [rows] = await db.query(
    `${REGISTER_SELECT} WHERE c.nationality IS NOT NULL AND c.nationality <> '' AND LOWER(c.nationality) NOT IN ('indian','india')
       AND b.status IN ('CONFIRMED','PENDING','CHECKED_IN','CHECKED_OUT') ${all ? '' : 'AND b.formCSubmittedAt IS NULL'}
     ORDER BY COALESCE(b.checkedInAt, b.checkIn) DESC LIMIT 300`
  );
  Response.success(res, { data: rows.map(shape) });
});

const markFormC = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[b]] = await db.query('SELECT bookingNumber FROM Booking WHERE id = ?', [id]);
  if (!b) throw new HotelError('Booking not found', 404);
  if (req.body.undo) {
    await db.query('UPDATE Booking SET formCSubmittedAt = NULL, formCRef = NULL WHERE id = ?', [id]);
    await audit(req, db, 'FORM_C', 'Booking', id, `${b.bookingNumber}: Form C marked as not filed`);
    return Response.success(res, { message: 'Marked as not filed' });
  }
  const ref = req.body.ref ? String(req.body.ref).trim().slice(0, 60) : null;
  await db.query('UPDATE Booking SET formCSubmittedAt = ?, formCRef = ? WHERE id = ?', [new Date(), ref, id]);
  await audit(req, db, 'FORM_C', 'Booking', id, `${b.bookingNumber}: Form C filed${ref ? ` (${ref})` : ''}`);
  Response.success(res, { message: 'Form C marked as filed' });
});

module.exports = { saveGuestDetails, uploadIdPhoto, getIdPhoto, removeIdPhoto, register, formC, markFormC, shape, REGISTER_SELECT };
