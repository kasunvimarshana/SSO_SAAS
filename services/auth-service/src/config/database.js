'use strict';

const { Sequelize } = require('sequelize');

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  NODE_ENV,
} = process.env;

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: parseInt(DB_PORT, 10) || 5432,
  dialect: 'postgres',
  logging: NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
  },
});

async function connectDatabase() {
  await sequelize.authenticate();
  // `sync` creates tables that don't exist yet without modifying existing ones.
  // For production schema changes, use Sequelize migrations (`sequelize-cli`).
  await sequelize.sync();
  console.log('Database connection established and models synchronized.');
}

module.exports = { sequelize, connectDatabase };
