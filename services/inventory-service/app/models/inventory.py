from datetime import datetime
from enum import Enum
from typing import Optional

from bson import ObjectId
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class PyObjectId(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, _info=None):
        if isinstance(v, ObjectId):
            return str(v)
        if isinstance(v, str) and ObjectId.is_valid(v):
            return v
        raise ValueError(f"Invalid ObjectId: {v!r}")

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema
        return core_schema.no_info_plain_validator_function(cls.validate)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ReservationStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    RELEASED = "released"


# ---------------------------------------------------------------------------
# Inventory document
# ---------------------------------------------------------------------------

class InventoryBase(BaseModel):
    product_id: str
    warehouse_id: str
    quantity: int = Field(ge=0, description="Total stock quantity")
    reserved_quantity: int = Field(default=0, ge=0)
    sku: str
    unit: str = "piece"
    reorder_point: int = Field(default=0, ge=0)
    reorder_quantity: int = Field(default=0, ge=0)


class InventoryCreate(InventoryBase):
    pass


class InventoryUpdate(BaseModel):
    product_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    quantity: Optional[int] = Field(default=None, ge=0)
    reserved_quantity: Optional[int] = Field(default=None, ge=0)
    sku: Optional[str] = None
    unit: Optional[str] = None
    reorder_point: Optional[int] = Field(default=None, ge=0)
    reorder_quantity: Optional[int] = Field(default=None, ge=0)


class InventoryResponse(InventoryBase):
    id: str
    available_quantity: int
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def flatten_mongo_doc(cls, values):
        if isinstance(values, dict):
            if "_id" in values and "id" not in values:
                values["id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Reservation document
# ---------------------------------------------------------------------------

class ReservationBase(BaseModel):
    inventory_id: str
    order_id: str
    quantity: int = Field(gt=0)


class ReservationCreate(ReservationBase):
    pass


class ReservationResponse(ReservationBase):
    id: str
    status: ReservationStatus
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def flatten_mongo_doc(cls, values):
        if isinstance(values, dict):
            if "_id" in values and "id" not in values:
                values["id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Request / response helpers
# ---------------------------------------------------------------------------

class ReserveRequest(BaseModel):
    quantity: int = Field(gt=0)
    order_id: str


class PaginatedInventoryResponse(BaseModel):
    items: list[InventoryResponse]
    total: int
    page: int
    limit: int
    pages: int
