// Guest identity details for the police register and Form C, and the private ID photos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HotelError, isYmd, pick } = require('./hotel.helper');

const ID_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'PAN', 'OTHER'];
const GENDERS = ['M', 'F', 'O'];
const FOREIGN_KEYS = ['passportNo', 'passportIssuePlace', 'passportIssueDate', 'passportExpiry', 'visaNo', 'visaType', 'visaIssueDate', 'visaExpiry', 'arrivalInIndia', 'arrivedFromCountry', 'portOfArrival', 'addressAbroad', 'nextDestinationCountry'];

const isIndian = (nationality) => !nationality || ['indian', 'india'].includes(String(nationality).trim().toLowerCase());

// only the last four digits of an Aadhaar number may be kept (the rest is masked, as UIDAI asks)
const maskAadhaar = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 12 && digits.length !== 4) throw new HotelError('Aadhaar number should have 12 digits');
  return `XXXX XXXX ${digits.slice(-4)}`;
};

// customer fields a check-in form may send
const cleanGuest = (body) => {
  const data = pick(body, ['nationality', 'gender', 'dob', 'careOf', 'idType', 'idNumber', 'address']);
  if (data.gender && !GENDERS.includes(data.gender)) throw new HotelError('Gender should be M, F or O');
  if (data.dob && !isYmd(String(data.dob))) throw new HotelError('Date of birth is not valid');
  if (data.idType && !ID_TYPES.includes(data.idType)) throw new HotelError(`ID type must be one of ${ID_TYPES.join(', ')}`);
  if (data.idType === 'AADHAAR' && data.idNumber) data.idNumber = maskAadhaar(data.idNumber);
  if (data.idNumber) data.idNumber = String(data.idNumber).trim().slice(0, 40);
  if (data.nationality) data.nationality = String(data.nationality).trim().slice(0, 60);
  if (data.careOf) data.careOf = String(data.careOf).trim().slice(0, 120);
  if (body.foreignDetails !== undefined) {
    const f = body.foreignDetails && typeof body.foreignDetails === 'object' ? body.foreignDetails : {};
    const clean = {};
    FOREIGN_KEYS.forEach((k) => {
      if (f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== '') clean[k] = String(f[k]).trim().slice(0, 120);
    });
    data.foreignDetails = Object.keys(clean).length ? JSON.stringify(clean) : null;
  }
  return data;
};

// booking fields for the register: where the guest came from, is going, why, and who is with them
const cleanStay = (body) => {
  const data = pick(body, ['comingFrom', 'goingTo', 'purpose', 'otherGuests']);
  ['comingFrom', 'goingTo', 'purpose'].forEach((k) => {
    if (data[k]) data[k] = String(data[k]).trim().slice(0, 120);
  });
  if (data.otherGuests) data.otherGuests = String(data.otherGuests).trim().slice(0, 2000);
  return data;
};

// what is still missing for the police register; empty when complete
const missingDetails = (c, b) => {
  const out = [];
  if (!c.phone) out.push('phone');
  if (!c.address) out.push('address');
  if (!c.idType || !c.idNumber) out.push('ID number');
  if (!c.idFront) out.push('ID photo');
  if (!isIndian(c.nationality)) {
    const f = typeof c.foreignDetails === 'string' ? JSON.parse(c.foreignDetails || '{}') : c.foreignDetails || {};
    if (!f.passportNo) out.push('passport number');
    if (!f.visaNo) out.push('visa number');
  }
  if (b && !b.comingFrom) out.push('coming from');
  return out;
};

// ---- ID photos: never under /File (which is public), only served to signed-in staff ----
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const privateRoot = () => path.resolve(process.env.PRIVATE_FILES_DIR || path.join(__dirname, '..', 'Private'));

const looksLikeImage = (buf) =>
  (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // jpeg
  (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) || // png
  (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');

const saveIdPhoto = (clientId, customerId, side, file) => {
  if (!file) throw new HotelError('Choose a photo of the ID');
  const ext = PHOTO_TYPES[file.mimetype];
  if (!ext || !looksLikeImage(file.buffer)) throw new HotelError('The ID photo must be a JPG, PNG or WebP picture');
  const dir = path.join(privateRoot(), 'ids', `c${Number(clientId)}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${Number(customerId)}-${side}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { mode: 0o600 });
  return `ids/c${Number(clientId)}/${name}`;
};

const idPhotoPath = (rel) => {
  if (!rel || !/^ids\/c\d+\/[\w.-]+$/.test(rel)) return null;
  const full = path.join(privateRoot(), rel);
  return full.startsWith(privateRoot()) && fs.existsSync(full) ? full : null;
};

const removeIdPhoto = (rel) => {
  const full = idPhotoPath(rel);
  if (full) fs.rmSync(full, { force: true });
};

module.exports = { ID_TYPES, FOREIGN_KEYS, isIndian, maskAadhaar, cleanGuest, cleanStay, missingDetails, saveIdPhoto, idPhotoPath, removeIdPhoto, PHOTO_TYPES };
