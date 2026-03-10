'use strict';

require('dotenv').config();

const services = {
  auth: {
    name: 'auth-service',
    url: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
    pathPrefix: '/api/auth',
  },
  users: {
    name: 'user-service',
    url: process.env.USER_SERVICE_URL || 'http://user-service:3002',
    pathPrefix: '/api/users',
  },
  products: {
    name: 'product-service',
    url: process.env.PRODUCT_SERVICE_URL || 'http://product-service:3003',
    pathPrefix: '/api/products',
  },
  inventory: {
    name: 'inventory-service',
    url: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004',
    pathPrefix: '/api/inventory',
  },
  orders: {
    name: 'order-service',
    url: process.env.ORDER_SERVICE_URL || 'http://order-service:3005',
    pathPrefix: '/api/orders',
  },
};

module.exports = services;
