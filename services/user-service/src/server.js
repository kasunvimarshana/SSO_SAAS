require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./config/database');
const { connectRabbitMQ } = require('./config/rabbitmq');

const PORT = process.env.PORT || 3002;

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    await sequelize.sync({ alter: true });
    console.log('Database models synchronized.');

    await connectRabbitMQ();

    app.listen(PORT, () => {
      console.log(`User Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
