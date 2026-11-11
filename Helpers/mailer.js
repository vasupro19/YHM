const nodemailer = require('nodemailer');
const Logger = require('./logger');

// Two ways to configure outgoing mail (nodemailer):
//   Gmail:         GMAIL_USER + GMAIL_APP_PASSWORD   (a 16-character Google "App password", not your normal password)
//   Any SMTP host: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
// MAIL_FROM sets the sender name, e.g. "YHM <you@gmail.com>". With neither configured the email is only
// printed in the server log, which is what you want on a developer machine.
let transport;

const gmailUser = () => (process.env.GMAIL_USER || '').trim();
const gmailPass = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // Google shows it in groups of four

const mode = () => (process.env.SMTP_HOST ? 'smtp' : gmailUser() && gmailPass() ? 'gmail' : 'off');

const getTransport = () => {
  const m = mode();
  if (m === 'off') return null;
  if (!transport) {
    if (m === 'gmail') {
      transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser(), pass: gmailPass() } });
    } else {
      const port = Number(process.env.SMTP_PORT || 587);
      transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
      });
    }
  }
  return transport;
};

const sender = () => process.env.MAIL_FROM || (mode() === 'gmail' ? `YHM <${gmailUser()}>` : 'YHM <no-reply@yhm.local>');

// turns nodemailer's technical errors into something a hotel owner can act on
const explain = (error) => {
  if (error.code === 'EAUTH' || /Invalid login|Username and Password not accepted|535/.test(error.message || '')) {
    return mode() === 'gmail'
      ? 'Gmail refused the sign-in. Use a 16-character App password (Google account → Security → 2-Step Verification → App passwords), not your normal password.'
      : 'The mail server refused the username or password.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(error.code)) return 'Could not reach the mail server. Check the internet connection and the mail settings.';
  if (error.responseCode === 550 || error.responseCode === 553 || error.code === 'EENVELOPE') return 'The mail server rejected the recipient address.';
  return `The email could not be sent (${error.message}).`;
};

// fromName shows the hotel's name as the sender; replyTo sends the guest's reply to the hotel instead of the shared mailbox
const sendMail = async ({ to, subject, text, html, fromName, replyTo }) => {
  const t = getTransport();
  if (!t) {
    Logger.info(`[mail not configured] to=${to} subject="${subject}"\n${text}`);
    console.log(`[mail not configured] to=${to} subject="${subject}"\n${text}`);
    return { logged: true };
  }
  try {
    const address = (sender().match(/<([^>]+)>/) || [null, sender()])[1];
    const from = fromName ? { name: String(fromName).replace(/[\r\n"<>]/g, ''), address } : sender();
    return await t.sendMail({ from, to, subject, text, html, replyTo: replyTo || undefined });
  } catch (error) {
    Logger.error(`mail to ${to} failed: ${error.message}`);
    const friendly = new Error(explain(error));
    friendly.mailError = true;
    throw friendly;
  }
};

// checks the saved settings by logging in to the mail server (used by Scripts/testMail.js)
const verifyMail = async () => {
  const t = getTransport();
  if (!t) return { mode: 'off' };
  try {
    await t.verify();
    return { mode: mode(), ok: true, from: sender() };
  } catch (error) {
    return { mode: mode(), ok: false, message: explain(error) };
  }
};

module.exports = { sendMail, verifyMail, mailMode: mode };
