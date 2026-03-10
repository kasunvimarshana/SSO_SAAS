'use strict';

require('dotenv').config();

const app = require('./app');
const { connectDatabase } = require('./config/database');
const { connectRabbitMQ } = require('./config/rabbitmq');

// Ensure models are loaded so Sequelize registers all associations
require('./models/User');
require('./models/RefreshToken');

const PORT = parseInt(process.env.PORT, 10) || 3001;

async function start() {
  await connectDatabase();
  await connectRabbitMQ();

  const server = app.listen(PORT, () => {
    console.log(`Auth service listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`Received ${signal}. Shutting down gracefully…`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 10 s if connections are still open
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
}

start().catch((err) => {
  console.error('Failed to start auth service:', err);
  process.exit(1);
});
