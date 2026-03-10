import asyncio
import json
import logging
import threading
from typing import Callable, Optional

import pika
import pika.exceptions

from .settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

EXCHANGE_NAME = "inventory_events"
PRODUCT_EXCHANGE = "product_events"


class RabbitMQPublisher:
    """Thread-safe synchronous RabbitMQ publisher used from async context via run_in_executor."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connection: Optional[pika.BlockingConnection] = None
        self._channel: Optional[pika.adapters.blocking_connection.BlockingChannel] = None

    def _ensure_connected(self) -> None:
        if self._connection and self._connection.is_open:
            return
        params = pika.URLParameters(settings.RABBITMQ_URL)
        params.heartbeat = 60
        self._connection = pika.BlockingConnection(params)
        self._channel = self._connection.channel()
        self._channel.exchange_declare(
            exchange=EXCHANGE_NAME, exchange_type="topic", durable=True
        )

    def publish(self, routing_key: str, payload: dict) -> None:
        with self._lock:
            try:
                self._ensure_connected()
                assert self._channel is not None
                self._channel.basic_publish(
                    exchange=EXCHANGE_NAME,
                    routing_key=routing_key,
                    body=json.dumps(payload),
                    properties=pika.BasicProperties(
                        delivery_mode=2,  # persistent
                        content_type="application/json",
                    ),
                )
            except Exception as exc:
                logger.error("Failed to publish message '%s': %s", routing_key, exc)
                self._connection = None
                self._channel = None

    def close(self) -> None:
        with self._lock:
            if self._connection and self._connection.is_open:
                try:
                    self._connection.close()
                except Exception:
                    pass
            self._connection = None
            self._channel = None


_publisher = RabbitMQPublisher()


async def publish_event(routing_key: str, payload: dict) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _publisher.publish, routing_key, payload)


async def close_publisher() -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _publisher.close)


# ---------------------------------------------------------------------------
# Consumer (listens for product.deleted events)
# ---------------------------------------------------------------------------

_consumer_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _consume(handler: Callable[[dict], None]) -> None:
    """Blocking consumer loop; runs in a dedicated daemon thread."""
    while not _stop_event.is_set():
        try:
            params = pika.URLParameters(settings.RABBITMQ_URL)
            params.heartbeat = 60
            connection = pika.BlockingConnection(params)
            channel = connection.channel()

            channel.exchange_declare(
                exchange=PRODUCT_EXCHANGE, exchange_type="topic", durable=True
            )
            queue = channel.queue_declare(
                queue="inventory_product_events", durable=True
            )
            channel.queue_bind(
                exchange=PRODUCT_EXCHANGE,
                queue=queue.method.queue,
                routing_key="product.deleted",
            )

            def _callback(ch, method, properties, body):  # noqa: ANN001
                try:
                    data = json.loads(body)
                    handler(data)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception as exc:
                    logger.error("Error processing message: %s", exc)
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(
                queue=queue.method.queue, on_message_callback=_callback
            )
            channel.start_consuming()
        except pika.exceptions.AMQPConnectionError as exc:
            if _stop_event.is_set():
                break
            logger.warning("RabbitMQ connection lost, retrying in 5 s: %s", exc)
            _stop_event.wait(5)
        except Exception as exc:
            if _stop_event.is_set():
                break
            logger.error("Consumer error, retrying in 5 s: %s", exc)
            _stop_event.wait(5)


def start_consumer(handler: Callable[[dict], None]) -> None:
    global _consumer_thread, _stop_event
    _stop_event.clear()
    _consumer_thread = threading.Thread(
        target=_consume, args=(handler,), daemon=True, name="rabbitmq-consumer"
    )
    _consumer_thread.start()
    logger.info("RabbitMQ consumer thread started.")


def stop_consumer() -> None:
    _stop_event.set()
    logger.info("RabbitMQ consumer stop requested.")
