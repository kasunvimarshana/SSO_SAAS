const { validationResult } = require('express-validator');
const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');
const SagaState = require('../models/SagaState');
const { runCreateOrderSaga, runCancelOrderSaga } = require('../sagas/orderSaga');
const { publishEvent } = require('../config/rabbitmq');
const { Op } = require('sequelize');

// ---------------------------------------------------------------------------
// GET /api/orders/health
// ---------------------------------------------------------------------------
async function healthCheck(req, res) {
  res.json({ success: true, service: 'order-service', status: 'UP', timestamp: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// GET /api/orders
// ---------------------------------------------------------------------------
async function getAllOrders(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const where = req.user.role === 'admin' ? {} : { user_id: req.user.id };

  const { rows: orders, count: total } = await Order.findAndCountAll({
    where,
    include: [{ model: OrderItem, as: 'items' }],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  res.json({
    success: true,
    data: orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
async function getOrderById(req, res) {
  const order = await Order.findByPk(req.params.id, {
    include: [
      { model: OrderItem, as: 'items' },
      { model: SagaState, as: 'sagaStates', foreignKey: 'order_id' },
    ],
  });

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  // Non-admin users can only access their own orders
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  res.json({ success: true, data: order });
}

// ---------------------------------------------------------------------------
// POST /api/orders
// ---------------------------------------------------------------------------
async function createOrder(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { items, shipping_address } = req.body;

  try {
    const order = await runCreateOrderSaga({
      token: req.token,
      userId: req.user.id,
      items,
      shippingAddress: shipping_address,
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, message: err.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/cancel
// ---------------------------------------------------------------------------
async function cancelOrder(req, res) {
  const order = await Order.findByPk(req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  try {
    const updatedOrder = await runCancelOrderSaga(req.params.id, req.token);
    res.json({ success: true, data: updatedOrder });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, message: err.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/status  (admin only)
// ---------------------------------------------------------------------------
async function updateOrderStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { status } = req.body;
  const order = await Order.findByPk(req.params.id, {
    include: [{ model: OrderItem, as: 'items' }],
  });

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const previousStatus = order.status;
  await order.update({ status });

  // Publish relevant status-change event
  const eventMap = {
    confirmed: 'order.confirmed',
    cancelled: 'order.cancelled',
    failed: 'order.failed',
    shipped: 'order.shipped',
    delivered: 'order.delivered',
  };

  if (eventMap[status]) {
    await publishEvent(eventMap[status], {
      orderId: order.id,
      userId: order.user_id,
      previousStatus,
      status,
    });
  }

  const updatedOrder = await Order.findByPk(order.id, {
    include: [{ model: OrderItem, as: 'items' }],
  });

  res.json({ success: true, data: updatedOrder });
}

module.exports = { healthCheck, getAllOrders, getOrderById, createOrder, cancelOrder, updateOrderStatus };
