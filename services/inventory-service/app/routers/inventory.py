from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config.database import get_database
from app.dependencies.auth import get_current_user, require_admin
from app.models.inventory import (
    InventoryCreate,
    InventoryResponse,
    InventoryUpdate,
    PaginatedInventoryResponse,
    ReservationResponse,
    ReserveRequest,
)
from app.services import inventory_service

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

DbDep = Annotated[AsyncIOMotorDatabase, Depends(get_database)]


# ---------------------------------------------------------------------------
# Health check – placed first so /health is not shadowed by /:id
# ---------------------------------------------------------------------------

@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {"status": "ok", "service": "inventory-service"}


# ---------------------------------------------------------------------------
# GET /api/inventory
# ---------------------------------------------------------------------------

@router.get("", response_model=PaginatedInventoryResponse)
async def list_inventory(
    db: DbDep,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    product_id: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    low_stock: Optional[bool] = Query(None),
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.list_inventory(
        db, page, limit, product_id, warehouse_id, low_stock
    )


# ---------------------------------------------------------------------------
# GET /api/inventory/product/:product_id  (must come before /:id)
# ---------------------------------------------------------------------------

@router.get("/product/{product_id}", response_model=list[InventoryResponse])
async def get_inventory_by_product(
    product_id: str,
    db: DbDep,
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.get_inventory_by_product(db, product_id)


# ---------------------------------------------------------------------------
# GET /api/inventory/:id
# ---------------------------------------------------------------------------

@router.get("/{item_id}", response_model=InventoryResponse)
async def get_inventory(
    item_id: str,
    db: DbDep,
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.get_inventory_by_id(db, item_id)


# ---------------------------------------------------------------------------
# POST /api/inventory
# ---------------------------------------------------------------------------

@router.post("", response_model=InventoryResponse, status_code=status.HTTP_201_CREATED)
async def create_inventory(
    body: InventoryCreate,
    db: DbDep,
    _admin: dict = Depends(require_admin),
):
    return await inventory_service.create_inventory(db, body)


# ---------------------------------------------------------------------------
# PUT /api/inventory/:id
# ---------------------------------------------------------------------------

@router.put("/{item_id}", response_model=InventoryResponse)
async def update_inventory(
    item_id: str,
    body: InventoryUpdate,
    db: DbDep,
    _admin: dict = Depends(require_admin),
):
    return await inventory_service.update_inventory(db, item_id, body)


# ---------------------------------------------------------------------------
# DELETE /api/inventory/:id
# ---------------------------------------------------------------------------

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory(
    item_id: str,
    db: DbDep,
    _admin: dict = Depends(require_admin),
):
    await inventory_service.delete_inventory(db, item_id)


# ---------------------------------------------------------------------------
# POST /api/inventory/:id/reserve
# ---------------------------------------------------------------------------

@router.post("/{item_id}/reserve", response_model=ReservationResponse, status_code=status.HTTP_201_CREATED)
async def reserve_stock(
    item_id: str,
    body: ReserveRequest,
    db: DbDep,
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.reserve_stock(db, item_id, body)


# ---------------------------------------------------------------------------
# POST /api/inventory/:id/release
# ---------------------------------------------------------------------------

@router.post("/{item_id}/release", response_model=ReservationResponse)
async def release_stock(
    item_id: str,
    body: ReserveRequest,
    db: DbDep,
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.release_stock(db, item_id, body.order_id)


# ---------------------------------------------------------------------------
# POST /api/inventory/:id/confirm
# ---------------------------------------------------------------------------

@router.post("/{item_id}/confirm", response_model=ReservationResponse)
async def confirm_stock(
    item_id: str,
    body: ReserveRequest,
    db: DbDep,
    _user: dict = Depends(get_current_user),
):
    return await inventory_service.confirm_stock(db, item_id, body.order_id)
