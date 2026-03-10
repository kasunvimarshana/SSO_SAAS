const axios = require('axios');

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003';

/**
 * Reserve inventory for a product.
 * Returns reservation confirmation on success, throws on failure.
 */
async function reserveInventory(productId, quantity, token) {
  const response = await axios.post(
    `${INVENTORY_SERVICE_URL}/api/inventory/${productId}/reserve`,
    { quantity },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 5000,
    }
  );
  return response.data;
}

/**
 * Confirm a previously reserved inventory hold.
 */
async function confirmInventory(productId, reservationId, token) {
  const response = await axios.post(
    `${INVENTORY_SERVICE_URL}/api/inventory/${productId}/confirm`,
    { reservationId },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 5000,
    }
  );
  return response.data;
}

/**
 * Release a previously reserved inventory hold (compensation).
 */
async function releaseInventory(productId, reservationId, token) {
  const response = await axios.post(
    `${INVENTORY_SERVICE_URL}/api/inventory/${productId}/release`,
    { reservationId },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 5000,
    }
  );
  return response.data;
}

module.exports = { reserveInventory, confirmInventory, releaseInventory };
