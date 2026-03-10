'use strict';

const { createProxyMiddleware } = require('http-proxy-middleware');
const { Router } = require('express');
const services = require('../config/services');
const { checkAllServices } = require('../utils/healthCheck');

const router = Router();

/**
 * Builds a proxy middleware for the given target URL, stripping the
 * leading path prefix so downstream services receive clean paths.
 */
function buildProxy(targetUrl, pathPrefix) {
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    // Rewrite "/api/auth/login" → "/api/auth/login" (keep full path)
    // The downstream service is expected to handle its own /api/* namespace.
    on: {
      error: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.url} → ${targetUrl}: ${err.message}`);

        if (res.headersSent) return;

        res.status(502).json({
          status: 502,
          error: 'Bad Gateway',
          message: `Upstream service is currently unavailable. Please try again later.`,
          upstream: targetUrl,
        });
      },
      proxyReq: (proxyReq, req) => {
        // Forward the original client IP to the upstream service
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
        if (clientIp) {
          proxyReq.setHeader('X-Forwarded-For', clientIp);
        }
        proxyReq.setHeader('X-Gateway-Request-Id', req.id || Date.now().toString(36));
      },
    },
  });
}

// ── Health check ────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const result = await checkAllServices();
    const httpStatus = result.overall === 'healthy' ? 200 : result.overall === 'degraded' ? 207 : 503;
    res.status(httpStatus).json({
      status: result.overall,
      timestamp: new Date().toISOString(),
      gateway: 'healthy',
      upstreamServices: result.services,
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      error: err.message,
    });
  }
});

// ── API info / documentation ─────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.status(200).json({
    name: 'API Gateway',
    version: '1.0.0',
    description: 'Central entry point for all microservices',
    documentation: 'https://github.com/your-org/SSO_SAAS#api-documentation',
    endpoints: Object.values(services).map((svc) => ({
      service: svc.name,
      path: `${svc.pathPrefix}/*`,
      upstream: svc.url,
    })),
    rateLimit: {
      windowMs: '15 minutes',
      maxRequests: 100,
    },
    healthCheck: '/health',
  });
});

// ── Proxy routes ─────────────────────────────────────────────────────────────
router.use(services.auth.pathPrefix, buildProxy(services.auth.url, services.auth.pathPrefix));
router.use(services.users.pathPrefix, buildProxy(services.users.url, services.users.pathPrefix));
router.use(services.products.pathPrefix, buildProxy(services.products.url, services.products.pathPrefix));
router.use(services.inventory.pathPrefix, buildProxy(services.inventory.url, services.inventory.pathPrefix));
router.use(services.orders.pathPrefix, buildProxy(services.orders.url, services.orders.pathPrefix));

// ── 404 catch-all ────────────────────────────────────────────────────────────
router.use((req, res) => {
  res.status(404).json({
    status: 404,
    error: 'Not Found',
    message: `No route found for ${req.method} ${req.originalUrl}`,
  });
});

module.exports = router;
