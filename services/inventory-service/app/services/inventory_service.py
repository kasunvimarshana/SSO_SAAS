import logging
import math
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING

from app.config.rabbitmq import publish_event
from app.models.inventory import (
    InventoryCreate,
    InventoryResponse,
    InventoryUpdate,
    PaginatedInventoryResponse,
    ReservationResponse,
    ReservationStatus,
    ReserveRequest,
)

logger = logging.getLogger(__name__)

INVENTORY_COLLECTION = "inventory"
RESERVATIONS_COLLECTION = "reservations"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_response(doc: dict) -> InventoryResponse:
    doc["id"] = str(doc.pop("_id"))
    doc["available_quantity"] = max(
        0, doc.get("quantity", 0) - doc.get("reserved_quantity", 0)
    )
    return InventoryResponse(**doc)


def _reservation_to_response(doc: dict) -> ReservationResponse:
    doc["id"] = str(doc.pop("_id"))
    return ReservationResponse(**doc)


# ---------------------------------------------------------------------------
# Inventory CRUD
# ---------------------------------------------------------------------------

async def list_inventory(
    db: AsyncIOMotorDatabase,
    page: int,
    limit: int,
    product_id: Optional[str],
    warehouse_id: Optional[str],
    low_stock: Optional[bool],
) -> PaginatedInventoryResponse:
    query: dict = {}
    if product_id:
        query["product_id"] = product_id
    if warehouse_id:
        query["warehouse_id"] = warehouse_id

    collection = db[INVENTORY_COLLECTION]

    if low_stock:
        # Use aggregation to filter on virtual field available_quantity <= reorder_point
        pipeline = [
            {"$match": query},
            {
                "$addFields": {
                    "available_quantity": {
                        "$max": [
                            0,
                            {"$subtract": ["$quantity", "$reserved_quantity"]},
                        ]
                    }
                }
            },
            {
                "$match": {
                    "$expr": {
                        "$lte": ["$available_quantity", "$reorder_point"]
                    }
                }
            },
        ]
        count_pipeline = pipeline + [{"$count": "total"}]
        count_result = await collection.aggregate(count_pipeline).to_list(1)
        total = count_result[0]["total"] if count_result else 0

        data_pipeline = pipeline + [
            {"$skip": (page - 1) * limit},
            {"$limit": limit},
        ]
        docs = await collection.aggregate(data_pipeline).to_list(limit)
    else:
        total = await collection.count_documents(query)
        cursor = (
            collection.find(query)
            .sort("created_at", ASCENDING)
            .skip((page - 1) * limit)
            .limit(limit)
        )
        docs = await cursor.to_list(limit)

    items = [_to_response(d) for d in docs]
    return PaginatedInventoryResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


async def get_inventory_by_id(db: AsyncIOMotorDatabase, item_id: str) -> InventoryResponse:
    if not ObjectId.is_valid(item_id):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ID format.")
    doc = await db[INVENTORY_COLLECTION].find_one({"_id": ObjectId(item_id)})
    if not doc:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    return _to_response(doc)


async def get_inventory_by_product(
    db: AsyncIOMotorDatabase, product_id: str
) -> list[InventoryResponse]:
    docs = await db[INVENTORY_COLLECTION].find({"product_id": product_id}).to_list(None)
    return [_to_response(d) for d in docs]


async def create_inventory(
    db: AsyncIOMotorDatabase, data: InventoryCreate
) -> InventoryResponse:
    now = _now()
    doc = data.model_dump()
    doc["created_at"] = now
    doc["updated_at"] = now
    doc.setdefault("reserved_quantity", 0)

    result = await db[INVENTORY_COLLECTION].insert_one(doc)
    created = await db[INVENTORY_COLLECTION].find_one({"_id": result.inserted_id})
    assert created is not None
    return _to_response(created)


async def update_inventory(
    db: AsyncIOMotorDatabase, item_id: str, data: InventoryUpdate
) -> InventoryResponse:
    if not ObjectId.is_valid(item_id):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ID format.")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return await get_inventory_by_id(db, item_id)
    updates["updated_at"] = _now()
    result = await db[INVENTORY_COLLECTION].find_one_and_update(
        {"_id": ObjectId(item_id)},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    return _to_response(result)


async def delete_inventory(db: AsyncIOMotorDatabase, item_id: str) -> None:
    if not ObjectId.is_valid(item_id):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ID format.")
    result = await db[INVENTORY_COLLECTION].delete_one({"_id": ObjectId(item_id)})
    if result.deleted_count == 0:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    await db[RESERVATIONS_COLLECTION].delete_many({"inventory_id": item_id})


async def delete_inventory_by_product(db: AsyncIOMotorDatabase, product_id: str) -> None:
    """Called when a product.deleted event is received."""
    docs = await db[INVENTORY_COLLECTION].find(
        {"product_id": product_id}, {"_id": 1}
    ).to_list(None)
    ids = [str(d["_id"]) for d in docs]
    await db[INVENTORY_COLLECTION].delete_many({"product_id": product_id})
    if ids:
        await db[RESERVATIONS_COLLECTION].delete_many({"inventory_id": {"$in": ids}})
    logger.info("Deleted %d inventory item(s) for product %s", len(ids), product_id)


# ---------------------------------------------------------------------------
# Reservation operations
# ---------------------------------------------------------------------------

async def reserve_stock(
    db: AsyncIOMotorDatabase, item_id: str, req: ReserveRequest
) -> ReservationResponse:
    from fastapi import HTTPException, status as http_status

    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Invalid ID format.")

    # Atomic check-and-update: only increment reserved_quantity if enough stock
    result = await db[INVENTORY_COLLECTION].find_one_and_update(
        {
            "_id": ObjectId(item_id),
            "$expr": {
                "$gte": [
                    {"$subtract": ["$quantity", "$reserved_quantity"]},
                    req.quantity,
                ]
            },
        },
        {
            "$inc": {"reserved_quantity": req.quantity},
            "$set": {"updated_at": _now()},
        },
        return_document=True,
    )
    if not result:
        # Check whether the item exists at all
        exists = await db[INVENTORY_COLLECTION].find_one({"_id": ObjectId(item_id)})
        if not exists:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Insufficient available stock.",
        )

    now = _now()
    reservation = {
        "inventory_id": item_id,
        "order_id": req.order_id,
        "quantity": req.quantity,
        "status": ReservationStatus.PENDING,
        "created_at": now,
    }
    res_result = await db[RESERVATIONS_COLLECTION].insert_one(reservation)
    created_res = await db[RESERVATIONS_COLLECTION].find_one({"_id": res_result.inserted_id})
    assert created_res is not None
    reservation_response = _reservation_to_response(created_res)

    await publish_event(
        "inventory.reserved",
        {
            "event": "inventory.reserved",
            "inventory_id": item_id,
            "reservation_id": reservation_response.id,
            "order_id": req.order_id,
            "quantity": req.quantity,
            "product_id": result.get("product_id"),
        },
    )
    return reservation_response


async def release_stock(
    db: AsyncIOMotorDatabase, item_id: str, order_id: str
) -> ReservationResponse:
    from fastapi import HTTPException, status as http_status

    reservation = await db[RESERVATIONS_COLLECTION].find_one(
        {
            "inventory_id": item_id,
            "order_id": order_id,
            "status": ReservationStatus.PENDING,
        }
    )
    if not reservation:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Active reservation not found for this order.",
        )

    qty = reservation["quantity"]

    await db[INVENTORY_COLLECTION].update_one(
        {"_id": ObjectId(item_id)},
        {
            "$inc": {"reserved_quantity": -qty},
            "$set": {"updated_at": _now()},
        },
    )
    updated_res = await db[RESERVATIONS_COLLECTION].find_one_and_update(
        {"_id": reservation["_id"]},
        {"$set": {"status": ReservationStatus.RELEASED}},
        return_document=True,
    )
    assert updated_res is not None
    reservation_response = _reservation_to_response(updated_res)

    await publish_event(
        "inventory.released",
        {
            "event": "inventory.released",
            "inventory_id": item_id,
            "reservation_id": reservation_response.id,
            "order_id": order_id,
            "quantity": qty,
        },
    )
    return reservation_response


async def confirm_stock(
    db: AsyncIOMotorDatabase, item_id: str, order_id: str
) -> ReservationResponse:
    from fastapi import HTTPException, status as http_status

    reservation = await db[RESERVATIONS_COLLECTION].find_one(
        {
            "inventory_id": item_id,
            "order_id": order_id,
            "status": ReservationStatus.PENDING,
        }
    )
    if not reservation:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Active reservation not found for this order.",
        )

    qty = reservation["quantity"]

    # Deduct from total quantity and remove from reserved
    await db[INVENTORY_COLLECTION].update_one(
        {"_id": ObjectId(item_id)},
        {
            "$inc": {"quantity": -qty, "reserved_quantity": -qty},
            "$set": {"updated_at": _now()},
        },
    )
    updated_res = await db[RESERVATIONS_COLLECTION].find_one_and_update(
        {"_id": reservation["_id"]},
        {"$set": {"status": ReservationStatus.CONFIRMED}},
        return_document=True,
    )
    assert updated_res is not None
    reservation_response = _reservation_to_response(updated_res)

    await publish_event(
        "inventory.confirmed",
        {
            "event": "inventory.confirmed",
            "inventory_id": item_id,
            "reservation_id": reservation_response.id,
            "order_id": order_id,
            "quantity": qty,
        },
    )
    return reservation_response
