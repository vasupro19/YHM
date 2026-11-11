// Ready-to-send guest messages. {{BILL_LINK}} is replaced by the caller with the guest's private bill page.
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// 98765 43210 / 09876543210 / +91 98765 43210 -> 919876543210 (the form WhatsApp links need)
const waNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
};

const buildMessages = (b, s) => {
  const hotel = s.hotelName || 'our hotel';
  const guest = b.customerName.split(' ')[0];
  const nights = b.nights.length;
  const contact = [s.address, s.phone].filter(Boolean).join('\n');
  const sign = `${contact ? `\n${contact}` : ''}`;
  const bill = b.bill;

  return {
    confirmation:
      `Hello ${guest}, your booking at ${hotel} is confirmed.\n\n` +
      `Booking: ${b.bookingNumber}\nRoom: ${b.roomTypeName}\n` +
      `Check-in: ${day(b.checkIn)} (from ${s.checkInTime})\nCheck-out: ${day(b.checkOut)} (by ${s.checkOutTime})\n` +
      `${nights} night${nights > 1 ? 's' : ''}, ${b.adults} adult${b.adults > 1 ? 's' : ''}${b.children ? `, ${b.children} child${b.children > 1 ? 'ren' : ''}` : ''}\n\n` +
      `Total: ${money(bill.total)} (including GST)\nReceived: ${money(bill.paid)}\n${bill.balance > 0 ? `Balance to pay: ${money(bill.balance)}\n` : ''}\n` +
      `Details and bill: {{BILL_LINK}}\n\nWe look forward to hosting you.${sign}`,
    reminder:
      `Hello ${guest}, a reminder that your stay at ${hotel} starts on ${day(b.checkIn)}. Check-in is from ${s.checkInTime}.\n\n` +
      `Booking: ${b.bookingNumber}${bill.balance > 0 ? `\nBalance to pay: ${money(bill.balance)}` : ''}\n` +
      `Details: {{BILL_LINK}}\n\nCall us if you need directions or want to change anything.${sign}`,
    payment:
      `Hello ${guest}, ${bill.balance > 0 ? `${money(bill.balance)} is due` : 'your payment details'} for booking ${b.bookingNumber} at ${hotel}.\n\n` +
      `${bill.balance > 0 ? 'You can pay by UPI from this page: {{BILL_LINK}}\n\n' : 'Bill: {{BILL_LINK}}\n\n'}Thank you.${sign}`,
    bill:
      `Hello ${guest}, thank you for staying at ${hotel}.\n\n` +
      `${b.invoice ? `Invoice ${b.invoice.invoiceNumber}\n` : `Booking ${b.bookingNumber}\n`}Total: ${money(bill.total)}\nPaid: ${money(bill.paid)}\n${bill.balance > 0 ? `Balance: ${money(bill.balance)}\n` : 'Balance: nil\n'}\n` +
      `Your bill: {{BILL_LINK}}${sign}`,
    thanks:
      `Hello ${guest}, thank you for choosing ${hotel}. We hope you had a comfortable stay and would love to see you again.\n\nIf you have a moment, tell us how we did. Your feedback helps us improve.${sign}`
  };
};

const SUBJECTS = {
  confirmation: (b, s) => `Booking confirmed: ${b.bookingNumber} at ${s.hotelName || 'your hotel'}`,
  reminder: (b, s) => `Your stay at ${s.hotelName || 'the hotel'} starts ${day(b.checkIn)}`,
  payment: (b, s) => `Payment due for booking ${b.bookingNumber}`,
  bill: (b, s) => `Your bill from ${s.hotelName || 'the hotel'}${b.invoice ? ` (${b.invoice.invoiceNumber})` : ''}`,
  thanks: (b, s) => `Thank you for staying at ${s.hotelName || 'our hotel'}`
};

module.exports = { buildMessages, waNumber, SUBJECTS, money };
