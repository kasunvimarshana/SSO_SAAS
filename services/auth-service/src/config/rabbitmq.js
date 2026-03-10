'use strict';

const amqplib = require('amqplib');

const EXCHANGE = process.env.RABBITMQ_USER_EVENTS_EXCHANGE || 'user_events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

let channel = null;

async function connectRabbitMQ() {
  try {
    const connection = await amqplib.connect(RABBITMQ_URL);

    connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err.message);
      channel = null;
    });

    connection.on('close', () => {
      console.warn('RabbitMQ connection closed.');
      channel = null;
    });

    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    console.log(`RabbitMQ connected. Exchange "${EXCHANGE}" ready.`);
  } catch (err) {
    console.error('Failed to connect to RabbitMQ:', err.message);
    // Non-fatal: service continues without messaging
  }
}

function publishEvent(routingKey, payload) {
  if (!channel) {
    console.warn('RabbitMQ channel unavailable. Event not published:', routingKey);
    return;
  }
  try {
    const content = Buffer.from(JSON.stringify(payload));
    channel.publish(EXCHANGE, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Math.floor(Date.now() / 1000),
    });
    console.log(`Event published: ${routingKey}`);
  } catch (err) {
    console.error('Failed to publish event:', err.message);
  }
}

module.exports = { connectRabbitMQ, publishEvent };
