// Booking emails screen: the hotel's own inbox and Gemini key, recent emails and what YHM did with each, and pasting an email by hand.
const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit } = require('../../Helpers/audit');
const E = require('../../Helpers/emailBookings');

const shape = (r) => ({ ...r, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data, bookingIds: r.bookingIds ? r.bookingIds.split(',').map(Number) : [] });

// what the screen may know about the connection: never the password or key themselves
const connection = (s) => ({
  on: Boolean(s.emailImportOn),
  mailUser: s.mailUser || '',
  mailHost: s.mailHost || '',
  mailPort: s.mailPort || 993,
  mailSenders: s.mailSenders || E.DEFAULT_SENDERS,
  passSaved: Boolean(E.unseal(s.mailPass)),
  geminiKeyHint: E.hint(E.unseal(s.geminiKey)),
  checkedAt: s.mailCheckedAt,
  error: s.mailError
});

const overview = handler(async (req, res, db) => {
  const s = await H.getSettings(db);
  const [rows] = await db.query('SELECT * FROM EmailImport ORDER BY id DESC LIMIT 60');
  const items = rows.map(shape);
  const ids = [...new Set(items.flatMap((i) => i.bookingIds))];
  const [bookings] = ids.length ? await db.query('SELECT id, bookingNumber, status FROM Booking WHERE id IN (?)', [ids]) : [[]];
  Response.success(res, {
    data: {
      ...connection(s),
      ai: Boolean(E.unseal(s.geminiKey)),
      waiting: items.filter((i) => i.status === 'NEEDS_REVIEW').length,
      items,
      bookings
    }
  });
});

// save the inbox and key; they're tested before saving so a typo shows up straight away
const saveSettings = handler(async (req, res, db) => {
  const b = req.body || {};
  const s = await H.getSettings(db);
  const on = Boolean(b.on);
  const mailUser = String(b.mailUser ?? s.mailUser ?? '').trim().toLowerCase();
  if (mailUser && !/^\S+@\S+\.\S+$/.test(mailUser)) throw new HotelError('Enter the full email address of the inbox');
  const mailHost = String(b.mailHost || '').trim().toLowerCase() || E.guessHost(mailUser) || '';
  const mailPort = Number(b.mailPort || 993);
  if (!(mailPort > 0 && mailPort < 65536)) throw new HotelError('Port should be a number like 993');
  const pass = String(b.mailPass || '').replace(/\s+/g, '') || E.unseal(s.mailPass); // Google shows app passwords in groups of four
  const apiKey = String(b.geminiKey || '').trim() || E.unseal(s.geminiKey);
  const senders = E.senderList(b.mailSenders).join(', ');

  if (on) {
    if (!mailUser) throw new HotelError('Enter the email address where your booking emails arrive');
    if (!mailHost) throw new HotelError('Enter your mail server (IMAP), e.g. imap.hostinger.com');
    if (!pass) throw new HotelError('Enter the app password for that email');
    if (!apiKey) throw new HotelError('Enter your Gemini API key');
    await E.testConnection({ host: mailHost, port: mailPort, user: mailUser, pass, apiKey });
  }
  const inboxChanged = mailUser !== (s.mailUser || '') || mailHost !== (s.mailHost || '');
  await H.update(db, 'HotelSetting', {
    emailImportOn: on,
    mailUser: mailUser || null,
    mailHost: mailHost || null,
    mailPort,
    mailSenders: senders,
    mailPass: pass ? E.seal(pass) : null,
    geminiKey: apiKey ? E.seal(apiKey) : null,
    mailError: null,
    // a different inbox starts fresh from its last two days of mail
    ...(inboxChanged ? { mailUidValidity: null, mailLastUid: null, mailCheckedAt: null } : {})
  }, 1);
  await audit(req, db, 'UPDATE', 'Settings', null, `Booking emails ${on ? `turned on for ${mailUser}` : 'turned off'}`);
  Response.success(res, { data: connection(await H.getSettings(db)), message: on ? 'Connected. New booking emails will be added within two minutes of arriving.' : 'Booking emails turned off' });
});

// the owner can check right away instead of waiting two minutes
const checkNow = handler(async (req, res, db) => {
  const s = await H.getSettings(db);
  if (!s.emailImportOn) throw new HotelError('Turn booking emails on first');
  const counts = await E.checkHotel(`client${req.clientId}`, db, s);
  const after = await H.getSettings(db);
  if (after.mailError) throw new HotelError(after.mailError);
  Response.success(res, { data: counts, message: counts.read ? `Read ${counts.read} booking email${counts.read === 1 ? '' : 's'}.` : 'No new booking emails.' });
});

const paste = handler(async (req, res, db) => {
  const text = String(req.body.text || '').trim();
  if (text.length < 30) throw new HotelError('Paste the whole booking email');
  if (text.length > 60000) throw new HotelError('That is too long for one email');
  const subject = (text.match(/^Subject:\s*(.+)$/im) || [])[1] || null;
  const from = (text.match(/^From:\s*(.+)$/im) || [])[1] || null;
  try {
    const row = await E.processEmail(db, { messageId: null, from, subject, date: new Date(), text, via: 'PASTE' });
    await audit(req, db, 'EMAIL_BOOKING', 'EmailImport', row.id, `Booking email pasted: ${row.message || row.status}`);
    Response.success(res, { data: shape(row), message: row.message || 'Done' });
  } catch (error) {
    if (error instanceof HotelError) throw error;
    if ([400, 401, 403].includes(error.status) && /api[_ ]?key|permission|unauthori[sz]ed/i.test(error.message)) throw new HotelError('Gemini did not accept your API key. Enter it again in Settings → Booking emails.');
    throw new HotelError(`The email couldn't be read right now (${error.message}). Try again in a minute.`, 502);
  }
});

const dismiss = handler(async (req, res, db) => {
  const id = Number(req.params.id);
  const [[row]] = await db.query('SELECT id, status FROM EmailImport WHERE id = ?', [id]);
  if (!row) throw new HotelError('Not found', 404);
  if (row.status !== 'NEEDS_REVIEW') throw new HotelError('This one is already done');
  await db.query("UPDATE EmailImport SET status = 'HANDLED' WHERE id = ?", [id]);
  await audit(req, db, 'EMAIL_BOOKING', 'EmailImport', id, 'Booking email marked as handled');
  Response.success(res, { message: 'Marked as handled' });
});

module.exports = { overview, saveSettings, checkNow, paste, dismiss };
