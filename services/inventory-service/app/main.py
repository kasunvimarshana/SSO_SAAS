import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.database import close_db, connect_db, get_database
from app.config.rabbitmq import close_publisher, start_consumer, stop_consumer
from app.config.settings import get_settings
from app.routers.inventory import router as inventory_router
from app.services.inventory_service import delete_inventory_by_product

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


def _make_product_deleted_handler():
    """Return a sync handler that schedules an async DB cleanup via asyncio."""
    import asyncio

    def handler(data: dict) -> None:
        product_id = data.get("product_id") or data.get("id")
        if not product_id:
            logger.warning("product.deleted event missing product_id: %s", data)
            return

        async def _cleanup():
            try:
                db = get_database()
                await delete_inventory_by_product(db, product_id)
            except Exception as exc:
                logger.error("Cleanup for product %s failed: %s", product_id, exc)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(_cleanup(), loop)
            else:
                loop.run_until_complete(_cleanup())
        except RuntimeError:
            asyncio.run(_cleanup())

    return handler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──────────────────────────────────────────────────────────────
    logger.info("Connecting to MongoDB …")
    await connect_db()
    logger.info("MongoDB connected.")

    logger.info("Starting RabbitMQ consumer …")
    try:
        start_consumer(_make_product_deleted_handler())
    except Exception as exc:
        logger.warning("RabbitMQ consumer could not start (continuing): %s", exc)

    yield

    # ── shutdown ─────────────────────────────────────────────────────────────
    logger.info("Shutting down …")
    stop_consumer()
    await close_publisher()
    await close_db()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="Inventory Service",
    description="Manages product inventory across warehouses.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(inventory_router)


@app.get("/", tags=["root"])
async def root():
    return {"service": "inventory-service", "status": "running"}
