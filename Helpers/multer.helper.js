const multer = require('multer');

// only pictures and PDFs, at most 8 MB, one file per request
const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    const error = new Error('Only images (PNG, JPG, WebP, GIF, SVG) and PDF files can be uploaded.');
    error.status = 400;
    return cb(error);
  }
});

upload.ALLOWED = ALLOWED;
module.exports = upload;
