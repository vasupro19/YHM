// GSTR-1 for one month, built from the tax invoices issued at checkout.
// A hotel's place of supply is where the property is (IGST Act s.12(3)), so every invoice is intra-state:
// CGST + SGST, no B2CL. Sections: B2B (guests with a GSTIN), B2CS (everyone else, by rate),
// HSN/SAC summary (split B2B / B2C as the portal asks since 2025) and documents issued.
const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;

const SAC = { ROOM: '996311', RESTAURANT: '996331', FOOD: '996331', MINIBAR: '996331', LAUNDRY: '999712', SPA: '999722', TRANSPORT: '996601', OTHER: '999799' };
const SAC_NAME = { 996311: 'Room or unit accommodation services', 996331: 'Services by restaurants and food serving', 999712: 'Laundry services', 999722: 'Spa and beauty services', 996601: 'Passenger transport (rental with driver)', 999799: 'Other services' };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const r2 = H.round2;
const split = (tax) => {
  const camt = r2(tax / 2);
  return { camt, samt: r2(tax - camt) };
};
const ddmmyyyy = (d) => {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}`;
};

const buildGstr1 = async (db, month) => {
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const settings = await H.getSettings(db);
  const warnings = [];
  const hotelGstin = String(settings.gstin || '').toUpperCase();
  if (!GSTIN.test(hotelGstin)) warnings.push('The hotel GSTIN is missing or not valid. Add it in Hotel settings before filing.');
  const pos = GSTIN.test(hotelGstin) ? hotelGstin.slice(0, 2) : '';

  const [invoices] = await db.query(
    `SELECT i.invoiceNumber, i.issuedAt, i.bookingId, c.name, c.gstin, c.companyName
       FROM Invoice i JOIN Booking b ON b.id = i.bookingId JOIN Customer c ON c.id = b.customerId
      WHERE i.issuedAt >= ? AND i.issuedAt < ? ORDER BY i.issuedAt, i.id LIMIT 5000`,
    [from, to]
  );

  const b2b = [];
  const b2cs = {}; // rate -> totals
  const hsn = { B2B: {}, B2C: {} }; // sac|rate -> totals
  let totals = { invoices: 0, value: 0, taxable: 0, camt: 0, samt: 0 };

  for (const inv of invoices) {
    const full = await H.loadBooking(db, inv.bookingId);
    const bill = full.bill;
    const lines = [...bill.roomLines.map((l) => ({ ...l, sac: SAC.ROOM })), ...bill.chargeLines.map((l) => ({ ...l, sac: SAC[l.category] || SAC.OTHER }))];
    const ctin = String(inv.gstin || '').toUpperCase();
    const isB2B = Boolean(ctin);
    if (isB2B && !GSTIN.test(ctin)) warnings.push(`${inv.invoiceNumber}: the guest GSTIN ${ctin} is not valid, so it is shown under B2B but the portal will reject it.`);

    // tax by rate for this invoice
    const byRate = {};
    lines.forEach((l) => {
      const k = Number(l.gstPercent);
      byRate[k] = byRate[k] || { rt: k, txval: 0, tax: 0 };
      byRate[k].txval = r2(byRate[k].txval + l.taxable);
      byRate[k].tax = r2(byRate[k].tax + l.tax);
      const hk = `${l.sac}|${k}`;
      const bucket = hsn[isB2B ? 'B2B' : 'B2C'];
      bucket[hk] = bucket[hk] || { hsn_sc: l.sac, desc: SAC_NAME[l.sac] || 'Services', rt: k, txval: 0, tax: 0 };
      bucket[hk].txval = r2(bucket[hk].txval + l.taxable);
      bucket[hk].tax = r2(bucket[hk].tax + l.tax);
    });
    const rates = Object.values(byRate).map((r) => ({ rt: r.rt, txval: r.txval, ...split(r.tax) }));

    if (isB2B) {
      b2b.push({ ctin, name: inv.companyName || inv.name, inum: inv.invoiceNumber, idt: ddmmyyyy(inv.issuedAt), val: bill.total, pos, rates });
    } else {
      rates.forEach((r) => {
        b2cs[r.rt] = b2cs[r.rt] || { rt: r.rt, txval: 0, camt: 0, samt: 0 };
        b2cs[r.rt].txval = r2(b2cs[r.rt].txval + r.txval);
        b2cs[r.rt].camt = r2(b2cs[r.rt].camt + r.camt);
        b2cs[r.rt].samt = r2(b2cs[r.rt].samt + r.samt);
      });
    }
    totals = {
      invoices: totals.invoices + 1,
      value: r2(totals.value + bill.total),
      taxable: r2(totals.taxable + rates.reduce((s, r) => s + r.txval, 0)),
      camt: r2(totals.camt + rates.reduce((s, r) => s + r.camt, 0)),
      samt: r2(totals.samt + rates.reduce((s, r) => s + r.samt, 0))
    };
  }

  const hsnRows = (bucket) => Object.values(bucket).sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.rt - b.rt).map((h) => ({ ...h, uqc: 'NA', qty: 0, ...split(h.tax) }));
  const hsnB2B = hsnRows(hsn.B2B);
  const hsnB2C = hsnRows(hsn.B2C);
  const nums = invoices.map((i) => i.invoiceNumber);
  const docs = nums.length ? [{ series: 'Invoices for outward supply', from: nums[0], to: nums[nums.length - 1], total: nums.length, cancelled: 0 }] : [];
  // numbers must run without gaps; point out any (e.g. from before numbering was made continuous)
  const seq = nums.map((n) => Number((String(n).match(/(\d+)$/) || [])[1])).filter((n) => Number.isFinite(n));
  for (let i = 1; i < seq.length; i += 1) {
    if (seq[i] !== seq[i - 1] + 1 && seq[i] > seq[i - 1]) warnings.push(`Invoice numbers jump from ${nums[i - 1]} to ${nums[i]}. Mention the gap to your CA.`);
  }
  if (invoices.length === 0) warnings.push('No tax invoices were issued this month (invoices are made at checkout).');

  // the portal's GSTR-1 JSON (offline tool upload format)
  const fp = `${String(m).padStart(2, '0')}${y}`;
  const json = {
    gstin: hotelGstin,
    fp,
    b2b: Object.values(
      b2b.reduce((acc, inv) => {
        acc[inv.ctin] = acc[inv.ctin] || { ctin: inv.ctin, inv: [] };
        acc[inv.ctin].inv.push({ inum: inv.inum, idt: inv.idt, val: inv.val, pos: inv.pos, rchrg: 'N', inv_typ: 'R', itms: inv.rates.map((r, i) => ({ num: i + 1, itm_det: { txval: r.txval, rt: r.rt, iamt: 0, camt: r.camt, samt: r.samt, csamt: 0 } })) });
        return acc;
      }, {})
    ),
    b2cs: Object.values(b2cs).map((r) => ({ sply_ty: 'INTRA', pos, typ: 'OE', rt: r.rt, txval: r.txval, iamt: 0, camt: r.camt, samt: r.samt, csamt: 0 })),
    hsn: {
      hsn_b2b: hsnB2B.map((h, i) => ({ num: i + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: 'NA', qty: 0, rt: h.rt, txval: h.txval, iamt: 0, camt: h.camt, samt: h.samt, csamt: 0 })),
      hsn_b2c: hsnB2C.map((h, i) => ({ num: i + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: 'NA', qty: 0, rt: h.rt, txval: h.txval, iamt: 0, camt: h.camt, samt: h.samt, csamt: 0 }))
    },
    doc_issue: { doc_det: docs.length ? [{ doc_num: 1, docs: docs.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled })) }] : [] }
  };
  ['b2b', 'b2cs'].forEach((k) => {
    if (!json[k].length) delete json[k];
  });

  return { month, gstin: hotelGstin, pos, totals, b2b, b2cs: Object.values(b2cs).sort((a, b) => a.rt - b.rt), hsnB2B, hsnB2C, docs, warnings, json };
};

const gstr1 = handler(async (req, res, db) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HotelError('Choose a month');
  Response.success(res, { data: await buildGstr1(db, month) });
});

module.exports = { gstr1, buildGstr1, SAC };
