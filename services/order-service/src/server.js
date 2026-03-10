require('dotenv').config();
const app = require('./app');
const { connectDatabase } = require('./config/database');
const { connectRabbitMQ, subscribeToEvents } = require('./config/rabbitmq');

const PORT = process.env.PORT || 3005;

async function startServer() {
  try {
    await connectDatabase();
    console.log('✅ Database connected and synced');

    await connectRabbitMQ();
    console.log('✅ RabbitMQ connected');

    await subscribeToEvents();
    console.log('✅ RabbitMQ event subscriptions ready');

    app.listen(PORT, () => {
      console.log(`🚀 Order Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start Order Service:', err);
    process.exit(1);
  }
}

startServer();
