const validator = require('validator');

const sanitizeQuery = (config = {}) => {
  return (req, res, next) => {
    const sanitized = {};
    const rawQuery = req.query;

    for (const key in rawQuery) {
      const raw = rawQuery[key];
      const type = config[key] || 'string';

      if (type === 'int' && validator.isInt(raw)) {
        sanitized[key] = parseInt(raw, 10);
      } else if (type === 'float' && validator.isFloat(raw)) {
        sanitized[key] = parseFloat(raw);
      } else if (type === 'boolean' && ['true', 'false', '1', '0'].includes(raw)) {
        sanitized[key] = raw === 'true' || raw === '1';
      } else if (type === 'date' && validator.isISO8601(raw)) {
        sanitized[key] = new Date(raw).toISOString();
      } else if (type === 'string' && typeof raw === 'string') {
        sanitized[key] = validator.escape(raw.trim());
      }
    }

    req.sanitizedQuery = sanitized;
    next();
  };
};

module.exports = sanitizeQuery;
