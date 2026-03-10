'use strict';

const { verifyAccessToken } = require('../utils/jwt');

/**
 * Middleware that validates a Bearer JWT access token.
 * Attaches decoded payload to req.user on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization header missing or malformed.' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Access token expired.' : 'Invalid access token.';
    return res.status(401).json({ success: false, message });
  }
}

/**
 * Middleware factory that restricts access to specified roles.
 * Must be used after authenticate().
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
