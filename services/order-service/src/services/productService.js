const axios = require('axios');

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3003';

/**
 * Fetch product details by ID from the Product Service.
 * Returns the product object on success, throws on failure.
 */
async function getProductById(productId, token) {
  const response = await axios.get(`${PRODUCT_SERVICE_URL}/api/products/${productId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeout: 5000,
  });
  return response.data;
}

module.exports = { getProductById };
