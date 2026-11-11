// Checks the mail settings and sends a test message.
//   node Scripts/testMail.js you@example.com
require('dotenv').config();
const { sendMail, verifyMail, mailMode } = require('../Helpers/mailer');

(async () => {
  const to = process.argv[2];
  console.log(`Mail mode: ${mailMode()}`);
  if (mailMode() === 'off') {
    console.log('No mail settings found. Set GMAIL_USER and GMAIL_APP_PASSWORD (or SMTP_HOST...) in .env.');
    process.exit(1);
  }
  const check = await verifyMail();
  if (!check.ok) {
    console.error(`Could not log in: ${check.message}`);
    process.exit(1);
  }
  console.log(`Logged in to the mail server. Sending as ${check.from}`);
  if (!to) return console.log('Add an address to send a test message: node Scripts/testMail.js you@example.com');
  try {
    await sendMail({ to, subject: 'YHM test email', text: 'This is a test from YHM. If you can read it, email is set up correctly.' });
    console.log(`Test email sent to ${to}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
