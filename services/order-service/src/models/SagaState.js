const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SagaState = sequelize.define(
  'SagaState',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      index: true,
    },
    saga_step: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed', 'compensated'),
      allowNull: false,
      defaultValue: 'pending',
    },
    data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: 'saga_state',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  }
);

// Association: SagaState belongs to Order via order_id
const Order = require('./Order');
Order.hasMany(SagaState, { foreignKey: 'order_id', as: 'sagaStates' });
SagaState.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

module.exports = SagaState;
