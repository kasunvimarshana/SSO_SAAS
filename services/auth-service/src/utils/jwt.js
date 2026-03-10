'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be set and at least 32 characters long.');
}
if (!REFRESH_SECRET || REFRESH_SECRET.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be set and at least 32 characters long.');
}

function generateAccessToken(payload) {
  return jwt.sign(
    { userId: payload.userId, email: payload.email, role: payload.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

function generateRefreshToken(payload) {
  return jwt.sign(
    { userId: payload.userId, email: payload.email, role: payload.role },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Converts a JWT expiry string like "7d" or "15m" into a future Date.
 */
function expiryStringToDate(expiresIn) {
  const match = String(expiresIn).match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiresIn format: ${expiresIn}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(Date.now() + value * multipliers[unit]);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiryStringToDate,
  REFRESH_EXPIRES_IN,
};
