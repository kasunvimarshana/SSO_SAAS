const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'order_service_db',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

async function connectDatabase() {
  await sequelize.authenticate();
  // Import models to register them before sync
  require('../models/Order');
  require('../models/OrderItem');
  require('../models/SagaState');
  await sequelize.sync({ alter: true });
}

module.exports = { sequelize, connectDatabase };
