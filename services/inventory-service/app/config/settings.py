from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    PORT: int = 3004
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "inventory_db"
    AUTH_SERVICE_URL: str = "http://localhost:3001"
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
