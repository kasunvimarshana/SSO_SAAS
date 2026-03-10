const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Order = require('./Order');

const OrderItem = sequelize.define(
  'OrderItem',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Order,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    product_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    product_name: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    total_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
  },
  {
    tableName: 'order_items',
    underscored: true,
    timestamps: false,
  }
);

Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

module.exports = OrderItem;
