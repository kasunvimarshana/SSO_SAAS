'use strict';

const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // maximum requests per window per IP
  standardHeaders: true,     // return rate limit info in RateLimit-* headers
  legacyHeaders: false,      // disable X-RateLimit-* headers
  message: {
    status: 429,
    error: 'Too Many Requests',
    message: 'You have exceeded the 100 requests per 15-minute limit. Please try again later.',
  },
  handler: (req, res, next, options) => {
    res.status(options.message.status).json(options.message);
  },
  skip: (req) => req.path === '/health' || req.path === '/',
});

module.exports = rateLimiter;
