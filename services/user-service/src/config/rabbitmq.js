const amqplib = require('amqplib');
const User = require('../models/User');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE = process.env.RABBITMQ_USER_EVENTS_EXCHANGE || 'user_events';
const QUEUE = 'user_service_queue';
const ROUTING_KEY = 'user.registered';

let channel = null;

async function connectRabbitMQ() {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const connection = await amqplib.connect(RABBITMQ_URL);
      channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(QUEUE, { durable: true });
      await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

      channel.consume(QUEUE, handleMessage, { noAck: false });

      connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err.message);
      });
      connection.on('close', () => {
        console.warn('RabbitMQ connection closed. Reconnecting in 5s...');
        setTimeout(connectRabbitMQ, 5000);
      });

      console.log('RabbitMQ connected and listening for user.registered events.');
      return;
    } catch (error) {
      attempt++;
      console.warn(`RabbitMQ connection attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 5000));
      } else {
        console.error('Could not connect to RabbitMQ after maximum retries. Continuing without it.');
      }
    }
  }
}

async function handleMessage(msg) {
  if (!msg) return;

  try {
    const event = JSON.parse(msg.content.toString());
    console.log('Received user.registered event:', event);

    const { userId, name, email, role } = event;

    const [user, created] = await User.findOrCreate({
      where: { id: userId },
      defaults: {
        id: userId,
        name: name || '[Name Not Provided]',
        email,
        role: role || 'user',
        is_active: true,
        profile: {},
      },
    });

    if (created) {
      console.log(`Auto-created user profile for: ${email}`);
    } else {
      console.log(`User profile already exists for: ${email}`);
    }

    channel.ack(msg);
  } catch (error) {
    console.error('Error processing user.registered event:', error.message);
    channel.nack(msg, false, false);
  }
}

function getChannel() {
  return channel;
}

module.exports = { connectRabbitMQ, getChannel };
