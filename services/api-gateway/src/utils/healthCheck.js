'use strict';

const http = require('http');
const services = require('../config/services');

/**
 * Performs an HTTP GET to the /health endpoint of the given service URL.
 * Resolves with { name, url, status, responseTime } or rejects on error/timeout.
 */
function checkService(name, url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = 5000; // 5 s

    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ name, url, status: 'unreachable', error: 'Invalid URL', responseTime: null });
    }

    const options = {
      hostname: target.hostname,
      port: target.port || 80,
      path: '/health',
      method: 'GET',
      timeout,
    };

    const req = http.request(options, (res) => {
      const responseTime = Date.now() - start;
      // Drain the response so the socket is released
      res.resume();
      resolve({
        name,
        url,
        status: res.statusCode === 200 ? 'healthy' : 'degraded',
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name,
        url,
        status: 'unreachable',
        error: 'Connection timed out',
        responseTime: `${timeout}ms`,
      });
    });

    req.on('error', (err) => {
      resolve({
        name,
        url,
        status: 'unreachable',
        error: err.message,
        responseTime: `${Date.now() - start}ms`,
      });
    });

    req.end();
  });
}

/**
 * Checks every registered downstream service and returns an aggregated result.
 */
async function checkAllServices() {
  const checks = Object.values(services).map((svc) =>
    checkService(svc.name, svc.url)
  );

  const results = await Promise.all(checks);

  const allHealthy = results.every((r) => r.status === 'healthy');
  const anyDegraded = results.some((r) => r.status === 'degraded');

  return {
    overall: allHealthy ? 'healthy' : anyDegraded ? 'degraded' : 'unhealthy',
    services: results,
  };
}

module.exports = { checkAllServices, checkService };
