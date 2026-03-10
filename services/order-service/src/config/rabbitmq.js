const amqp = require('amqplib');

const EXCHANGE_NAME = 'order_events';
const RETRY_INTERVAL_MS = 5000;
const MAX_RETRIES = 10;

let connection = null;
let channel = null;

async function connectRabbitMQ(attempt = 1) {
  try {
    connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err.message);
      reconnect();
    });

    connection.on('close', () => {
      console.warn('RabbitMQ connection closed, reconnecting...');
      reconnect();
    });
  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      console.warn(`RabbitMQ connect attempt ${attempt} failed, retrying in ${RETRY_INTERVAL_MS}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
      return connectRabbitMQ(attempt + 1);
    }
    throw new Error(`RabbitMQ connection failed after ${MAX_RETRIES} attempts: ${err.message}`);
  }
}

async function reconnect() {
  connection = null;
  channel = null;
  try {
    await connectRabbitMQ();
    console.log('✅ RabbitMQ reconnected');
  } catch (err) {
    console.error('RabbitMQ reconnect failed:', err.message);
  }
}

async function publishEvent(routingKey, payload) {
  if (!channel) {
    console.error('RabbitMQ channel not available, skipping publish:', routingKey);
    return;
  }
  const message = Buffer.from(JSON.stringify(payload));
  channel.publish(EXCHANGE_NAME, routingKey, message, { persistent: true });
  console.log(`📤 Published event [${routingKey}]:`, payload.orderId || '');
}

async function subscribeToEvents() {
  if (!channel) return;

  const queueName = 'order_service_events';
  await channel.assertQueue(queueName, { durable: true });

  // Bind to relevant external routing keys
  const bindingKeys = [
    'inventory.reserved',
    'inventory.reservation_failed',
    'payment.processed',
    'payment.failed',
  ];

  for (const key of bindingKeys) {
    await channel.bindQueue(queueName, EXCHANGE_NAME, key);
  }

  channel.consume(queueName, (msg) => {
    if (!msg) return;
    try {
      const content = JSON.parse(msg.content.toString());
      console.log(`📥 Received event [${msg.fields.routingKey}]:`, content);
      // Future: route events to saga state machine handlers
    } catch (err) {
      console.error('Failed to parse incoming RabbitMQ message:', err.message);
    } finally {
      channel.ack(msg);
    }
  });
}

function getChannel() {
  return channel;
}

module.exports = { connectRabbitMQ, publishEvent, subscribeToEvents, getChannel };
