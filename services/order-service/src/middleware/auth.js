const { validateToken } = require('../services/authService');

/**
 * Middleware that validates the JWT bearer token by calling the Auth Service.
 * Attaches `req.user` and `req.token` on success.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const data = await validateToken(token);
    req.user = data.user || data;
    req.token = token;
    next();
  } catch (err) {
    const status = err.response?.status || 401;
    return res.status(status).json({ success: false, message: 'Authentication failed' });
  }
}

/**
 * Middleware that restricts access to admin users only.
 * Must be used AFTER authenticate().
 */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Admin access required' });
}

module.exports = { authenticate, requireAdmin };
