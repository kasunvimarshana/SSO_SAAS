const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  healthCheck,
  getAllOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  updateOrderStatus,
} = require('../controllers/orderController');

// Health check — no auth required
router.get('/health', healthCheck);

// Validation rules
const createOrderValidation = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('items must be a non-empty array'),
  body('items.*.product_id')
    .notEmpty()
    .withMessage('Each item must have a product_id'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Each item quantity must be a positive integer'),
  body('shipping_address')
    .isObject()
    .withMessage('shipping_address must be an object'),
  body('shipping_address.street').notEmpty().withMessage('shipping_address.street is required'),
  body('shipping_address.city').notEmpty().withMessage('shipping_address.city is required'),
  body('shipping_address.country').notEmpty().withMessage('shipping_address.country is required'),
];

const updateStatusValidation = [
  param('id').isUUID().withMessage('Order ID must be a valid UUID'),
  body('status')
    .isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'])
    .withMessage('Invalid status value'),
];

// Protected routes
router.get('/', authenticate, getAllOrders);
router.get('/:id', authenticate, getOrderById);
router.post('/', authenticate, createOrderValidation, createOrder);
router.put('/:id/cancel', authenticate, cancelOrder);
router.put('/:id/status', authenticate, requireAdmin, updateStatusValidation, updateOrderStatus);

module.exports = router;
