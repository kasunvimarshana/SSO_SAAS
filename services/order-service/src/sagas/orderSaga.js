const { v4: uuidv4 } = require('uuid');
const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');
const SagaState = require('../models/SagaState');
const { validateToken } = require('../services/authService');
const { getProductById } = require('../services/productService');
const {
  reserveInventory,
  confirmInventory,
  releaseInventory,
} = require('../services/inventoryService');
const { publishEvent } = require('../config/rabbitmq');

// ---------------------------------------------------------------------------
// Saga step names used as identifiers in saga_state records
// ---------------------------------------------------------------------------
const STEPS = {
  VALIDATE_USER: 'VALIDATE_USER',
  GET_PRODUCT: 'GET_PRODUCT',
  RESERVE_INVENTORY: 'RESERVE_INVENTORY',
  CREATE_ORDER: 'CREATE_ORDER',
  CONFIRM_INVENTORY: 'CONFIRM_INVENTORY',
  CONFIRM_ORDER: 'CONFIRM_ORDER',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recordStep(orderId, sagaStep, status, data = null) {
  return SagaState.create({ order_id: orderId, saga_step: sagaStep, status, data });
}

async function updateStep(sagaStateId, status, data = null) {
  const updates = { status };
  if (data !== null) updates.data = data;
  await SagaState.update(updates, { where: { id: sagaStateId } });
}

// ---------------------------------------------------------------------------
// Main Saga: Create Order
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full order creation saga.
 *
 * @param {Object} params
 * @param {string} params.token        - Raw JWT string (Bearer value)
 * @param {string} params.userId       - Authenticated user ID
 * @param {Array}  params.items        - [{ product_id, quantity }]
 * @param {Object} params.shippingAddress
 *
 * @returns {Object} The created Order with its items.
 */
async function runCreateOrderSaga({ token, userId, items, shippingAddress }) {
  // We generate the order ID upfront so saga states can reference it even
  // before the DB row is written.
  const orderId = uuidv4();

  // Tracks per-product reservation IDs for compensation
  const reservations = [];

  // ─── Step 1: Validate user ────────────────────────────────────────────────
  const stepValidate = await recordStep(orderId, STEPS.VALIDATE_USER, 'pending');
  let userPayload;
  try {
    const authResponse = await validateToken(token);
    userPayload = authResponse.user || authResponse;
    await updateStep(stepValidate.id, 'completed', { userId: userPayload.id });
  } catch (err) {
    await updateStep(stepValidate.id, 'failed', { error: err.message });
    throw Object.assign(new Error('User validation failed: ' + err.message), { statusCode: 401 });
  }

  // ─── Step 2 & 3: Get product details + Reserve inventory (per item) ───────
  const resolvedItems = [];
  let totalAmount = 0;

  for (const item of items) {
    const { product_id, quantity } = item;

    // Step 2: Get product
    const stepProduct = await recordStep(orderId, `${STEPS.GET_PRODUCT}:${product_id}`, 'pending');
    let product;
    try {
      const productResponse = await getProductById(product_id, token);
      product = productResponse.product || productResponse;
      await updateStep(stepProduct.id, 'completed', { product_id, name: product.name });
    } catch (err) {
      await updateStep(stepProduct.id, 'failed', { error: err.message });
      await compensate(orderId, reservations, token);
      throw Object.assign(
        new Error(`Product lookup failed for ${product_id}: ${err.message}`),
        { statusCode: 404 }
      );
    }

    // Step 3: Reserve inventory
    const stepReserve = await recordStep(orderId, `${STEPS.RESERVE_INVENTORY}:${product_id}`, 'pending');
    let reservation;
    try {
      const reserveResponse = await reserveInventory(product_id, quantity, token);
      reservation = reserveResponse.reservation || reserveResponse;
      reservations.push({ product_id, reservationId: reservation.id || reservation.reservationId });
      await updateStep(stepReserve.id, 'completed', {
        product_id,
        reservationId: reservation.id || reservation.reservationId,
      });
    } catch (err) {
      await updateStep(stepReserve.id, 'failed', { error: err.message });
      await compensate(orderId, reservations, token);
      throw Object.assign(
        new Error(`Inventory reservation failed for ${product_id}: ${err.message}`),
        { statusCode: 409 }
      );
    }

    const unitPrice = parseFloat(product.price);
    const totalPrice = parseFloat((unitPrice * quantity).toFixed(2));
    totalAmount += totalPrice;

    resolvedItems.push({
      id: uuidv4(),
      order_id: orderId,
      product_id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    });
  }

  // ─── Step 4: Create order in DB (status = pending) ────────────────────────
  const stepCreate = await recordStep(orderId, STEPS.CREATE_ORDER, 'pending');
  let order;
  try {
    order = await Order.create({
      id: orderId,
      user_id: userId,
      status: 'pending',
      total_amount: parseFloat(totalAmount.toFixed(2)),
      shipping_address: shippingAddress,
    });

    await OrderItem.bulkCreate(resolvedItems);
    await updateStep(stepCreate.id, 'completed', { orderId });
  } catch (err) {
    await updateStep(stepCreate.id, 'failed', { error: err.message });
    await compensate(orderId, reservations, token);
    throw Object.assign(new Error('Order creation in DB failed: ' + err.message), { statusCode: 500 });
  }

  await publishEvent('order.created', { orderId, userId, totalAmount, items: resolvedItems });

  // ─── Step 5: Confirm inventory reservations ───────────────────────────────
  for (const res of reservations) {
    const stepConfirmInv = await recordStep(
      orderId,
      `${STEPS.CONFIRM_INVENTORY}:${res.product_id}`,
      'pending'
    );
    try {
      await confirmInventory(res.product_id, res.reservationId, token);
      await updateStep(stepConfirmInv.id, 'completed', { product_id: res.product_id });
    } catch (err) {
      await updateStep(stepConfirmInv.id, 'failed', { error: err.message });
      await compensate(orderId, reservations, token);
      await order.update({ status: 'failed' });
      await publishEvent('order.failed', { orderId, userId, reason: err.message });
      throw Object.assign(
        new Error(`Inventory confirmation failed for ${res.product_id}: ${err.message}`),
        { statusCode: 409 }
      );
    }
  }

  // ─── Step 6: Update order status to confirmed ─────────────────────────────
  const stepConfirmOrder = await recordStep(orderId, STEPS.CONFIRM_ORDER, 'pending');
  try {
    await order.update({ status: 'confirmed' });
    await updateStep(stepConfirmOrder.id, 'completed', { orderId });
  } catch (err) {
    await updateStep(stepConfirmOrder.id, 'failed', { error: err.message });
    throw Object.assign(new Error('Order status update failed: ' + err.message), { statusCode: 500 });
  }

  await publishEvent('order.confirmed', { orderId, userId, totalAmount });

  // Return order with items
  return Order.findByPk(orderId, { include: [{ model: OrderItem, as: 'items' }] });
}

// ---------------------------------------------------------------------------
// Compensation: Release all inventory reservations
// ---------------------------------------------------------------------------

async function compensate(orderId, reservations, token) {
  for (const res of reservations) {
    const stepComp = await recordStep(
      orderId,
      `COMPENSATE_INVENTORY:${res.product_id}`,
      'pending'
    );
    try {
      await releaseInventory(res.product_id, res.reservationId, token);
      await updateStep(stepComp.id, 'compensated', { product_id: res.product_id });
      console.log(`✅ Released inventory reservation for ${res.product_id}`);
    } catch (err) {
      await updateStep(stepComp.id, 'failed', { error: err.message });
      console.error(`❌ Failed to release inventory for ${res.product_id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Cancellation Saga: Cancel an existing order
// ---------------------------------------------------------------------------

/**
 * Cancels an order, releasing any still-active inventory, and publishes the
 * order.cancelled event.
 *
 * @param {string} orderId
 * @param {string} token
 * @returns {Object} The updated Order
 */
async function runCancelOrderSaga(orderId, token) {
  const order = await Order.findByPk(orderId, {
    include: [{ model: OrderItem, as: 'items' }],
  });

  if (!order) {
    throw Object.assign(new Error('Order not found'), { statusCode: 404 });
  }

  const cancellableStatuses = ['pending', 'confirmed'];
  if (!cancellableStatuses.includes(order.status)) {
    throw Object.assign(
      new Error(`Order cannot be cancelled in status: ${order.status}`),
      { statusCode: 409 }
    );
  }

  // Release inventory for each item (best-effort compensation)
  const sagaStep = await recordStep(orderId, 'CANCEL_ORDER', 'pending');
  const releaseErrors = [];

  for (const item of order.items) {
    try {
      // Only release if we have a reservation; on cancel we release by product+order reference
      await releaseInventory(item.product_id, null, token);
    } catch (err) {
      releaseErrors.push({ product_id: item.product_id, error: err.message });
      console.error(`⚠️  Could not release inventory for product ${item.product_id}:`, err.message);
    }
  }

  await order.update({ status: 'cancelled' });
  await updateStep(sagaStep.id, releaseErrors.length > 0 ? 'compensated' : 'completed', {
    releaseErrors,
  });

  await publishEvent('order.cancelled', {
    orderId,
    userId: order.user_id,
    totalAmount: order.total_amount,
  });

  return Order.findByPk(orderId, { include: [{ model: OrderItem, as: 'items' }] });
}

module.exports = { runCreateOrderSaga, runCancelOrderSaga };
