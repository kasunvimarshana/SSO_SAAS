const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

/**
 * Validate a JWT token against the Auth Service.
 * Returns the decoded user payload on success, throws on failure.
 */
async function validateToken(token) {
  const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/validate`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5000,
  });
  return response.data;
}

module.exports = { validateToken };
