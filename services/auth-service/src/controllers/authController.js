'use strict';

const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiryStringToDate,
  REFRESH_EXPIRES_IN,
} = require('../utils/jwt');
const { publishEvent } = require('../config/rabbitmq');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

async function register(req, res, next) {
  try {
    if (validationErrors(req, res)) return;

    const { name, email, password, role } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existing = await User.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await User.create({
      name,
      email: normalizedEmail,
      password_hash,
      role: role || 'user',
    });

    // Publish domain event (non-blocking)
    publishEvent('user.registered', {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      registeredAt: user.created_at,
    });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

async function login(req, res, next) {
  try {
    if (validationErrors(req, res)) return;

    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    await RefreshToken.create({
      user_id: user.id,
      token: refreshToken,
      expires_at: expiryStringToDate(REFRESH_EXPIRES_IN),
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

async function logout(req, res, next) {
  try {
    if (validationErrors(req, res)) return;

    const { refreshToken } = req.body;

    const deleted = await RefreshToken.destroy({ where: { token: refreshToken } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Refresh token not found.' });
    }

    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

async function refresh(req, res, next) {
  try {
    if (validationErrors(req, res)) return;

    const { refreshToken } = req.body;

    // Verify the JWT signature and expiry first
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    // Verify it exists in DB and has not been revoked
    const storedToken = await RefreshToken.findOne({
      where: {
        token: refreshToken,
        expires_at: { [Op.gt]: new Date() },
      },
    });

    if (!storedToken) {
      return res.status(401).json({ success: false, message: 'Refresh token revoked or expired.' });
    }

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive.' });
    }

    // Rotate refresh token
    await storedToken.destroy();

    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    await RefreshToken.create({
      user_id: user.id,
      token: newRefreshToken,
      expires_at: expiryStringToDate(REFRESH_EXPIRES_IN),
    });

    return res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/auth/validate
// ---------------------------------------------------------------------------

async function validate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authorization header missing or malformed.' });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const message = err.name === 'TokenExpiredError' ? 'Access token expired.' : 'Invalid access token.';
      return res.status(401).json({ success: false, message });
    }

    // Optionally confirm user still active in DB
    const user = await User.findByPk(decoded.userId, {
      attributes: ['id', 'email', 'role', 'is_active'],
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive.' });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/auth/health
// ---------------------------------------------------------------------------

function health(_req, res) {
  return res.status(200).json({
    success: true,
    service: 'auth-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { register, login, logout, refresh, validate, health };
