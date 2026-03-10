'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimiter = require('./middleware/rateLimiter');
const gatewayRouter = require('./routes/gateway');

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      callback(new Error(`CORS: Origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// ── Request logging ───────────────────────────────────────────────────────────
const morganFormat =
  process.env.NODE_ENV === 'production'
    ? 'combined'
    : ':method :url :status :response-time ms - :res[content-length]';

app.use(morgan(morganFormat));

// ── Body parsing ─────────────────────────────────────────────────────────────
// Only parse bodies for non-proxy routes; proxy middleware streams the body.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimiter);

// ── Trust proxy (required when behind a load-balancer / nginx) ────────────────
app.set('trust proxy', 1);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', gatewayRouter);

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[Error] ${req.method} ${req.url} → ${status}: ${err.message}`);

  if (res.headersSent) return next(err);

  res.status(status).json({
    status,
    error: err.name || 'Internal Server Error',
    message:
      process.env.NODE_ENV === 'production' && status === 500
        ? 'An unexpected error occurred.'
        : err.message,
  });
});

module.exports = app;
