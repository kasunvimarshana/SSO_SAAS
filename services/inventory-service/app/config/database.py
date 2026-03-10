from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from .settings import get_settings

settings = get_settings()

_client: Optional[AsyncIOMotorClient] = None


async def connect_db() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.MONGODB_URL)
    # Verify connection
    await _client.admin.command("ping")


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def get_database() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("Database client is not initialised. Call connect_db() first.")
    return _client[settings.MONGODB_DB_NAME]
