const Response = require('../../Helpers/response.helper');
const H = require('../../Helpers/hotel.helper');
const { HotelError, handler } = H;
const { audit } = require('../../Helpers/audit');

const PAY_METHODS = ['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER'];

const staffData = (body) => {
  H.need(body, ['name', 'designation', 'monthlySalary']);
  const data = H.pick(body, ['name', 'phone', 'email', 'designation', 'department', 'joinDate', 'monthlySalary', 'active', 'address', 'idNumber']);
  data.name = String(data.name).trim();
  data.monthlySalary = H.money(data.monthlySalary, 'Monthly salary');
  if (data.joinDate && !H.isYmd(data.joinDate)) throw new HotelError('Join date is not valid');
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) throw new HotelError('Email is not valid');
  return data;
};

const listStaff = handler(async (req, res, db) => {
  const [rows] = await db.query('SELECT * FROM Staff ORDER BY active DESC, name');
  Response.success(res, { data: rows });
});

const createStaff = handler(async (req, res, db) => {
  const data = staffData(req.body);
  const id = await H.insert(db, 'Staff', data);
  await audit(req, db, 'CREATE', 'Staff', id, `Staff member ${data.name} added (${data.designation}, ₹${data.monthlySalary}/month)`);
  Response.success(res, { message: 'Staff member added', status: 201 });
});

const updateStaff = handler(async (req, res, db) => {
  const data = staffData(req.body);
  await H.update(db, 'Staff', data, Number(req.params.id));
  await audit(req, db, 'UPDATE', 'Staff', Number(req.params.id), `Staff member ${data.name} changed (₹${data.monthlySalary}/month${data.active ? '' : ', left'})`);
  Response.success(res, { message: 'Staff member updated' });
});

// every staff member with this month's payment (if any); people who left still show if they were paid
const payroll = handler(async (req, res, db) => {
  const month = req.query.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new HotelError('month must look like 2026-10');
  const [rows] = await db.query(
    `SELECT s.id AS staffId, s.name, s.designation, s.department, s.monthlySalary, s.active,
            p.id AS paymentId, p.baseSalary, p.bonus, p.deductions, p.netPaid, p.method, p.paidOn, p.note
       FROM Staff s LEFT JOIN SalaryPayment p ON p.staffId = s.id AND p.month = ?
      WHERE s.active = 1 OR p.id IS NOT NULL ORDER BY s.name`,
    [month]
  );
  Response.success(res, { data: rows });
});

// pays (or corrects) one person's salary for one month
const paySalary = handler(async (req, res, db) => {
  const b = req.body;
  H.need(b, ['staffId', 'month']);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)) throw new HotelError('month must look like 2026-10');
  const [[staff]] = await db.query('SELECT id, monthlySalary FROM Staff WHERE id = ?', [Number(b.staffId)]);
  if (!staff) throw new HotelError('Staff member not found', 404);
  const method = b.method || 'CASH';
  if (!PAY_METHODS.includes(method)) throw new HotelError(`method must be one of ${PAY_METHODS.join(', ')}`);
  const paidOn = b.paidOn || H.today();
  if (!H.isYmd(paidOn)) throw new HotelError('Paid-on date is not valid');

  const baseSalary = b.baseSalary !== undefined && b.baseSalary !== '' ? H.money(b.baseSalary, 'Base salary') : staff.monthlySalary;
  const bonus = b.bonus ? H.money(b.bonus, 'Bonus') : 0;
  const deductions = b.deductions ? H.money(b.deductions, 'Deductions') : 0;
  const netPaid = H.round2(baseSalary + bonus - deductions);
  if (netPaid < 0) throw new HotelError('Deductions are more than the salary and bonus');

  await db.query(
    `INSERT INTO SalaryPayment (staffId, month, baseSalary, bonus, deductions, netPaid, method, paidOn, note) VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE baseSalary=VALUES(baseSalary), bonus=VALUES(bonus), deductions=VALUES(deductions), netPaid=VALUES(netPaid), method=VALUES(method), paidOn=VALUES(paidOn), note=VALUES(note)`,
    [staff.id, b.month, baseSalary, bonus, deductions, netPaid, method, paidOn, b.note || null]
  );
  await audit(req, db, 'SALARY_PAID', 'Staff', staff.id, `Salary ₹${netPaid} for ${b.month} recorded (${method.toLowerCase()})`);
  Response.success(res, { message: 'Salary recorded', status: 201 });
});

const deleteSalary = handler(async (req, res, db) => {
  const [[old]] = await db.query('SELECT staffId, month, netPaid FROM SalaryPayment WHERE id = ?', [Number(req.params.id)]);
  await db.query('DELETE FROM SalaryPayment WHERE id = ?', [Number(req.params.id)]);
  if (old) await audit(req, db, 'SALARY_REMOVED', 'Staff', old.staffId, `Salary payment ₹${old.netPaid} for ${old.month} removed`);
  Response.success(res, { message: 'Salary payment removed' });
});

module.exports = { listStaff, createStaff, updateStaff, payroll, paySalary, deleteSalary };
