// Every few minutes: for each hotel whose owner gave an email, send today's day report once the
// summary time (default 22:00, Indian time) has passed. Turn off with DAILY_SUMMARY=off.
const { PrismaClient } = require('@prisma/client');
const Logger = require('./logger');
const H = require('./hotel.helper');
const { getDynamicConnectionForDatabase } = require('./db.helper');
const { buildDayReport, summaryText } = require('./dayReport');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();
let running = false;

const nowHm = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

const tick = async () => {
  if (running) return;
  running = true;
  try {
    const clients = await prisma.client.findMany({ select: { code: true, name: true } });
    const today = H.today();
    for (const c of clients) {
      try {
        const db = await getDynamicConnectionForDatabase(c.code);
        const s = await H.getSettings(db);
        if (!s.ownerEmail || s.lastSummaryOn === today || nowHm() < (s.summaryTime || '22:00')) continue;
        // mark first, so a failing mail server never sends the owner the same report twice
        await db.query('UPDATE HotelSetting SET lastSummaryOn = ? WHERE id = 1', [today]);
        const report = await buildDayReport(db, today);
        const text = summaryText(report);
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
        const high = report.alerts.filter((a) => a.level === 'high').length;
        await sendMail({ to: s.ownerEmail, subject: `${s.hotelName || 'Hotel'}: day report${high ? ` (${high} to check)` : ''}`, text, html, fromName: 'YHM' });
        Logger.info(`day report sent for ${c.code}`);
      } catch (error) {
        Logger.error(`day report for ${c.code} failed: ${error.message}`);
      }
    }
  } catch (error) {
    Logger.error(`day report run failed: ${error.message}`);
  } finally {
    running = false;
  }
};

const startNightlySummary = () => {
  if (String(process.env.DAILY_SUMMARY || '').toLowerCase() === 'off') return;
  setInterval(tick, 5 * 60 * 1000).unref();
  setTimeout(tick, 30 * 1000).unref();
};

module.exports = { startNightlySummary, tick };
