const rateLimit = require('express-rate-limit');
const Response = require('../Helpers/response.helper');

const limited = (res, message) => Response.error(res, { status: 429, message });

// sign-in: 10 tries per 15 minutes for one email from one address
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  handler: (req, res) => limited(res, 'Too many sign-in attempts. Wait 15 minutes and try again.')
});

// password reset: 5 requests per hour from one address
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => limited(res, 'Too many requests. Try again in an hour.')
});

// everything else: a generous ceiling per address
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  handler: (req, res) => limited(res, 'Too many requests. Slow down a little.')
});

module.exports = { loginLimiter, resetLimiter, apiLimiter };
