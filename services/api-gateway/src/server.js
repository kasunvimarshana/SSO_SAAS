'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[API Gateway] Listening on http://${HOST}:${PORT}`);
  console.log(`[API Gateway] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[API Gateway] Health check: http://${HOST}:${PORT}/health`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[API Gateway] Received ${signal}. Shutting down gracefully…`);
  server.close((err) => {
    if (err) {
      console.error('[API Gateway] Error during shutdown:', err);
      process.exit(1);
    }
    console.log('[API Gateway] Server closed. Bye!');
    process.exit(0);
  });

  // Force-kill if graceful shutdown takes too long
  setTimeout(() => {
    console.error('[API Gateway] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[API Gateway] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[API Gateway] Uncaught Exception:', err);
  process.exit(1);
});

module.exports = server;
