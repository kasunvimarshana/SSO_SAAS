# API Contracts

Full request/response schemas, authentication requirements, and error formats for every endpoint in the SSO_SAAS platform.

All requests go through the **API Gateway** at `http://localhost:3000` (or your deployed domain).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Common Response Format](#common-response-format)
3. [Error Response Format](#error-response-format)
4. [Auth Service — `/api/auth`](#auth-service)
5. [User Service — `/api/users`](#user-service)
6. [Product Service — `/api/products`](#product-service)
7. [Inventory Service — `/api/inventory`](#inventory-service)
8. [Order Service — `/api/orders`](#order-service)

---

## Authentication

Protected endpoints require a valid JWT access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

Access tokens are obtained from `POST /api/auth/login` or `POST /api/auth/refresh`.

### Roles

| Role    | Description                                      |
|---------|--------------------------------------------------|
| `user`  | Standard authenticated user                      |
| `admin` | Elevated privileges for write/management endpoints |

Endpoint tables use the following symbols:

| Symbol | Meaning                                     |
|--------|---------------------------------------------|
| 🌐     | Public — no authentication required         |
| 🔒     | Requires valid access token                 |
| 🛡️     | Requires access token with `role = admin`   |

---

## Common Response Format

### Success Responses

Most services wrap successful responses in a consistent envelope:

```json
{
  "success": true,
  "message": "optional human-readable message",
  "data": { ... }
}
```

The Product Service (Go/Gin) uses a slightly different envelope:

```json
{
  "status": "success",
  "data": { ... }
}
```

### Paginated Responses

Endpoints that return lists include a `pagination` object:

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5
  }
}
```

---

## Error Response Format

All services return structured errors. The HTTP status code conveys the error class.

### Standard Error Envelope

```json
{
  "success": false,
  "message": "Human-readable error description"
}
```

### Validation Error Envelope (HTTP 422)

Returned when request body fails field-level validation:

```json
{
  "success": false,
  "errors": [
    {
      "type": "field",
      "value": "bad@",
      "msg": "A valid email address is required.",
      "path": "email",
      "location": "body"
    }
  ]
}
```

### API Gateway Error Envelope (HTTP 502)

```json
{
  "status": 502,
  "error": "Bad Gateway",
  "message": "Upstream service is currently unavailable. Please try again later.",
  "upstream": "http://auth-service:3001"
}
```

### Common HTTP Status Codes

| Code | Meaning                                                     |
|------|-------------------------------------------------------------|
| 200  | OK                                                          |
| 201  | Created                                                     |
| 204  | No Content (successful delete)                              |
| 400  | Bad Request — malformed input                               |
| 401  | Unauthorized — missing, invalid, or expired token           |
| 403  | Forbidden — authenticated but insufficient permissions      |
| 404  | Not Found                                                   |
| 409  | Conflict — duplicate resource (e.g. email, SKU)             |
| 422  | Unprocessable Entity — validation errors                    |
| 500  | Internal Server Error                                       |
| 502  | Bad Gateway — upstream service unreachable                  |
| 503  | Service Unavailable                                         |

---

## Auth Service

Base path: `/api/auth`  
Port: `3001`

---

### `GET /api/auth/health` 🌐

Returns service health status.

**Response `200`:**
```json
{
  "success": true,
  "service": "auth-service",
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### `POST /api/auth/register` 🌐

Register a new user account.

**Request Body:**
```json
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "password": "SecurePass1",
  "role": "user"
}
```

| Field      | Type   | Required | Constraints                                              |
|------------|--------|----------|----------------------------------------------------------|
| `name`     | string | ✅       | 2–100 characters                                         |
| `email`    | string | ✅       | Valid email address, case-normalized                     |
| `password` | string | ✅       | Minimum 8 characters, must contain at least one digit    |
| `role`     | string | ❌       | `"user"` (default) or `"admin"`                          |

**Response `201`:**
```json
{
  "success": true,
  "message": "User registered successfully.",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "role": "user"
  }
}
```

**Error Responses:**

| Code | Condition                          | Body                                         |
|------|------------------------------------|----------------------------------------------|
| 409  | Email already registered           | `{ "success": false, "message": "Email already registered." }` |
| 422  | Validation failure                 | `{ "success": false, "errors": [...] }`      |

**Side effects:** Publishes `user.registered` event to `user_events` exchange.

---

### `POST /api/auth/login` 🌐

Authenticate and receive a token pair.

**Request Body:**
```json
{
  "email": "alice@example.com",
  "password": "SecurePass1"
}
```

| Field      | Type   | Required | Constraints              |
|------------|--------|----------|--------------------------|
| `email`    | string | ✅       | Valid email address      |
| `password` | string | ✅       | Non-empty                |

**Response `200`:**
```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1NTBlODQwMC4uLiIsImVtYWlsIjoiYWxpY2VAZXhhbXBsZS5jb20iLCJyb2xlIjoidXNlciIsImlhdCI6MTcwNTMxMDIwMCwiZXhwIjoxNzA1MzEzODAwfQ.signature",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Alice Smith",
      "email": "alice@example.com",
      "role": "user"
    }
  }
}
```

**JWT access token payload:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "email": "alice@example.com",
  "role": "user",
  "iat": 1705310200,
  "exp": 1705313800
}
```

**Error Responses:**

| Code | Condition                        | Body                                                    |
|------|----------------------------------|---------------------------------------------------------|
| 401  | Invalid credentials or inactive  | `{ "success": false, "message": "Invalid credentials." }` |
| 422  | Validation failure               | `{ "success": false, "errors": [...] }`                 |

---

### `POST /api/auth/logout` 🌐

Invalidate a refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Field          | Type   | Required |
|----------------|--------|----------|
| `refreshToken` | string | ✅       |

**Response `200`:**
```json
{
  "success": true,
  "message": "Logged out successfully."
}
```

**Error Responses:**

| Code | Condition              | Body                                                        |
|------|------------------------|-------------------------------------------------------------|
| 404  | Token not found in DB  | `{ "success": false, "message": "Refresh token not found." }` |
| 422  | Missing refreshToken   | `{ "success": false, "errors": [...] }`                     |

---

### `POST /api/auth/refresh` 🌐

Rotate access and refresh tokens. The supplied refresh token is invalidated.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**

| Code | Condition                             |
|------|---------------------------------------|
| 401  | Invalid, expired, or revoked token    |
| 422  | Missing refreshToken field            |

---

### `GET /api/auth/validate` 🔒

Validate an access token. Used internally by every other service to authenticate requests.

**Request Headers:**
```
Authorization: Bearer <accessToken>
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "email": "alice@example.com",
    "role": "user"
  }
}
```

**Error Responses:**

| Code | Condition                                |
|------|------------------------------------------|
| 401  | Missing/malformed header                 |
| 401  | Expired token (`"Access token expired."`) |
| 401  | Invalid token signature                  |
| 401  | User deactivated in DB                   |

---

## User Service

Base path: `/api/users`  
Port: `3002`

---

### `GET /api/users/health` 🌐

**Response `200`:**
```json
{
  "success": true,
  "service": "user-service",
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### `GET /api/users/me` 🔒

Get the authenticated user's profile.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "role": "user",
    "is_active": true,
    "profile": {
      "bio": "Software engineer",
      "avatar_url": "https://cdn.example.com/avatars/alice.jpg",
      "phone": "+14155552671"
    },
    "created_at": "2024-01-10T09:00:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### `PUT /api/users/me` 🔒

Update the authenticated user's own profile. Only `name` and `profile` fields can be updated this way.

**Request Body** (all fields optional):
```json
{
  "name": "Alice Johnson",
  "profile": {
    "bio": "Senior software engineer at Acme",
    "avatar_url": "https://cdn.example.com/avatars/alice-new.jpg",
    "phone": "+14155559999"
  }
}
```

| Field             | Type   | Constraints                     |
|-------------------|--------|---------------------------------|
| `name`            | string | 1–255 characters                |
| `profile`         | object | Optional                        |
| `profile.bio`     | string | Max 1000 characters             |
| `profile.avatar_url` | string | Valid URL                    |
| `profile.phone`   | string | Valid mobile phone number       |

Profile fields are **merged** with existing profile data — only provided keys are updated.

**Response `200`:** Same schema as `GET /api/users/me`.

---

### `GET /api/users` 🔒🛡️

List all users. Admin only.

**Query Parameters:**

| Parameter   | Type    | Default | Description                             |
|-------------|---------|---------|------------------------------------------|
| `page`      | integer | 1       | Page number (min 1)                      |
| `limit`     | integer | 10      | Results per page (max 100)               |
| `search`    | string  | —       | Case-insensitive search on name or email |
| `role`      | string  | —       | Filter by `admin` or `user`              |
| `is_active` | boolean | —       | Filter by active status                  |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Alice Smith",
      "email": "alice@example.com",
      "role": "user",
      "is_active": true,
      "profile": {},
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

---

### `POST /api/users` 🔒🛡️

Create a user account directly (admin bypasses registration flow).

**Request Body:**
```json
{
  "name": "Bob Jones",
  "email": "bob@example.com",
  "role": "user",
  "profile": {
    "bio": "Support engineer"
  }
}
```

| Field    | Type   | Required | Constraints         |
|----------|--------|----------|---------------------|
| `name`   | string | ✅       | Non-empty, max 255  |
| `email`  | string | ✅       | Valid email         |
| `role`   | string | ❌       | `admin` or `user`   |
| `profile`| object | ❌       | See profile schema  |

**Response `201`:** User object (same schema as `GET /me`).

**Error Responses:**

| Code | Condition           |
|------|---------------------|
| 409  | Email already in use |
| 422  | Validation failure  |

---

### `GET /api/users/:id` 🔒

Get a user by UUID. Admin can access any user; non-admin users can only access their own record.

**Path Parameter:** `id` — UUID v4

**Response `200`:** User object (same schema as `GET /me`).

**Error Responses:**

| Code | Condition                       |
|------|---------------------------------|
| 400  | `id` is not a valid UUID v4     |
| 403  | Non-admin accessing another user |
| 404  | User not found                  |

---

### `PUT /api/users/:id` 🔒

Update a user. Admin can update any field; non-admin can only update their own `name` and `profile`.

**Request Body** (all optional):
```json
{
  "name": "Updated Name",
  "role": "admin",
  "is_active": false,
  "profile": {
    "bio": "Updated bio"
  }
}
```

| Field       | Updatable by  | Constraints           |
|-------------|---------------|-----------------------|
| `name`      | Admin + self  | 1–255 chars           |
| `profile`   | Admin + self  | See profile schema    |
| `role`      | Admin only    | `admin` or `user`     |
| `is_active` | Admin only    | boolean               |

**Response `200`:** Updated user object.

---

### `DELETE /api/users/:id` 🔒🛡️

Soft-delete (deactivate) a user. Sets `is_active = false`. An admin cannot deactivate their own account.

**Response `200`:**
```json
{
  "success": true,
  "message": "User deactivated successfully"
}
```

**Error Responses:**

| Code | Condition                         |
|------|-----------------------------------|
| 400  | Attempting to deactivate own account |
| 404  | User not found                    |

---

## Product Service

Base path: `/api/products`  
Port: `3003`  

> This service uses Go/Gin. Success responses use `"status": "success"` instead of `"success": true`.

---

### `GET /api/products/health` 🌐

**Response `200`:**
```json
{
  "status": "success",
  "message": "product service is running"
}
```

---

### `GET /api/products/categories` 🌐

List all distinct product categories.

**Response `200`:**
```json
{
  "status": "success",
  "data": {
    "categories": ["Electronics", "Clothing", "Books", "Home & Garden"]
  }
}
```

---

### `GET /api/products` 🌐

List products with optional filtering and pagination.

**Query Parameters:**

| Parameter    | Type    | Default | Description                                       |
|--------------|---------|---------|---------------------------------------------------|
| `page`       | integer | 1       | Page number                                       |
| `limit`      | integer | 10      | Results per page (max 100)                        |
| `category`   | string  | —       | Filter by exact category name                     |
| `search`     | string  | —       | Search on name and description (case-insensitive) |
| `min_price`  | float   | —       | Minimum price (inclusive)                         |
| `max_price`  | float   | —       | Maximum price (inclusive)                         |

**Response `200`:**
```json
{
  "status": "success",
  "data": {
    "products": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "Wireless Keyboard",
        "description": "Compact 75% layout with Bluetooth",
        "price": 89.99,
        "category": "Electronics",
        "sku": "WKB-BT-75",
        "images": ["https://cdn.example.com/kb-75.jpg"],
        "is_active": true,
        "created_at": "2024-01-10T09:00:00Z",
        "updated_at": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "total": 24,
      "page": 1,
      "limit": 10,
      "pages": 3
    }
  }
}
```

**Error Responses:**

| Code | Condition                                         |
|------|---------------------------------------------------|
| 400  | `min_price` or `max_price` is not a valid float   |
| 400  | `min_price` > `max_price`                         |

---

### `GET /api/products/:id` 🌐

Get a product by UUID.

**Path Parameter:** `id` — UUID v4

**Response `200`:**
```json
{
  "status": "success",
  "data": {
    "product": { ... }
  }
}
```

**Error Responses:**

| Code | Condition              |
|------|------------------------|
| 404  | Product not found      |

---

### `POST /api/products` 🔒🛡️

Create a new product.

**Request Body:**
```json
{
  "name": "Wireless Keyboard",
  "description": "Compact 75% layout with Bluetooth 5.0",
  "price": 89.99,
  "category": "Electronics",
  "sku": "WKB-BT-75",
  "images": ["https://cdn.example.com/kb-75.jpg"],
  "is_active": true
}
```

| Field         | Type    | Required | Constraints                        |
|---------------|---------|----------|------------------------------------|
| `name`        | string  | ✅       | 1–255 characters                   |
| `description` | string  | ❌       | Any length                         |
| `price`       | float   | ✅       | Greater than 0                     |
| `category`    | string  | ✅       | 1–100 characters                   |
| `sku`         | string  | ✅       | 1–100 characters, globally unique  |
| `images`      | array   | ❌       | Array of URL strings               |
| `is_active`   | boolean | ❌       | Default: `true`                    |

**Response `201`:**
```json
{
  "status": "success",
  "message": "product created successfully",
  "data": {
    "product": { ... }
  }
}
```

**Error Responses:**

| Code | Condition            |
|------|----------------------|
| 400  | Binding/JSON error   |
| 409  | SKU already exists   |

**Side effects:** Publishes `product.created` to `product_events`.

---

### `PUT /api/products/:id` 🔒🛡️

Update an existing product. All fields are optional — only provided fields are updated.

**Request Body** (all optional):
```json
{
  "name": "Wireless Keyboard Pro",
  "price": 99.99,
  "category": "Electronics",
  "sku": "WKB-BT-75-PRO",
  "description": "Updated description",
  "images": ["https://cdn.example.com/kb-pro.jpg"],
  "is_active": true
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "product updated successfully",
  "data": { "product": { ... } }
}
```

**Error Responses:**

| Code | Condition             |
|------|-----------------------|
| 404  | Product not found     |
| 409  | New SKU already exists |

**Side effects:** Publishes `product.updated` to `product_events`.

---

### `DELETE /api/products/:id` 🔒🛡️

Soft-delete a product (sets `deleted_at`, excluded from future queries).

**Response `200`:**
```json
{
  "status": "success",
  "message": "product deleted successfully"
}
```

**Side effects:** Publishes `product.deleted` to `product_events`. The Inventory Service will automatically remove all inventory records for this product.

---

## Inventory Service

Base path: `/api/inventory`  
Port: `3004`  
Framework: FastAPI (Python)

> Successful responses from this service do not use an `{ "success": true }` envelope — they return the resource directly.

---

### `GET /api/inventory/health` 🌐

**Response `200`:**
```json
{
  "status": "ok",
  "service": "inventory-service"
}
```

---

### `GET /api/inventory` 🔒

List inventory records with optional filtering.

**Query Parameters:**

| Parameter      | Type    | Default | Description                          |
|----------------|---------|---------|--------------------------------------|
| `page`         | integer | 1       | Page number (min 1)                  |
| `limit`        | integer | 10      | Results per page (min 1, max 100)    |
| `product_id`   | string  | —       | Filter by product UUID               |
| `warehouse_id` | string  | —       | Filter by warehouse identifier       |
| `low_stock`    | boolean | —       | `true` to return only low-stock items |

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f1b2c3d4e5f6a7b8c9d0e1",
      "product_id": "a1b2c3d4-...",
      "warehouse_id": "warehouse-east-1",
      "quantity": 150,
      "reserved_quantity": 10,
      "low_stock_threshold": 20,
      "reservations": [],
      "created_at": "2024-01-10T09:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

---

### `GET /api/inventory/product/:product_id` 🔒

Get all inventory records across all warehouses for a specific product.

**Path Parameter:** `product_id` — product UUID

**Response `200`:** Array of inventory objects (same schema as list items above).

---

### `GET /api/inventory/:id` 🔒

Get a single inventory record by its MongoDB ObjectId.

**Path Parameter:** `id` — MongoDB ObjectId (24-character hex string)

**Response `200`:** Single inventory object.

**Error Responses:**

| Code | Condition              |
|------|------------------------|
| 404  | Inventory item not found |

---

### `POST /api/inventory` 🔒🛡️

Create a new inventory record for a product/warehouse combination.

**Request Body:**
```json
{
  "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "warehouse_id": "warehouse-east-1",
  "quantity": 150,
  "low_stock_threshold": 20
}
```

| Field                 | Type    | Required | Constraints     |
|-----------------------|---------|----------|-----------------|
| `product_id`          | string  | ✅       | Product UUID    |
| `warehouse_id`        | string  | ✅       | Non-empty       |
| `quantity`            | integer | ✅       | ≥ 0             |
| `low_stock_threshold` | integer | ❌       | ≥ 0             |

**Response `201`:** Created inventory object.

---

### `PUT /api/inventory/:id` 🔒🛡️

Update an existing inventory record.

**Request Body** (all optional):
```json
{
  "quantity": 200,
  "low_stock_threshold": 25
}
```

**Response `200`:** Updated inventory object.

---

### `DELETE /api/inventory/:id` 🔒🛡️

Delete an inventory record.

**Response `204`:** No content.

---

### `POST /api/inventory/:id/reserve` 🔒

Reserve stock for an order. Creates a reservation with status `pending` and decrements available quantity.

**Path Parameter:** `id` — inventory record ObjectId

**Request Body:**
```json
{
  "order_id": "order-uuid",
  "quantity": 2
}
```

| Field      | Type    | Required | Constraints                 |
|------------|---------|----------|-----------------------------|
| `order_id` | string  | ✅       | Order UUID                  |
| `quantity` | integer | ✅       | ≥ 1, ≤ available quantity   |

**Response `201`:**
```json
{
  "id": "64f1b2c3d4e5f6a7b8c9d0e2",
  "product_id": "a1b2c3d4-...",
  "warehouse_id": "warehouse-east-1",
  "quantity": 150,
  "reserved_quantity": 12,
  "reservation": {
    "id": "reservation-uuid",
    "order_id": "order-uuid",
    "quantity": 2,
    "status": "pending",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

**Error Responses:**

| Code | Condition                                        |
|------|--------------------------------------------------|
| 404  | Inventory record not found                       |
| 409  | Insufficient stock (`available < requested qty`) |

**Side effects:** Publishes `inventory.reserved` to `inventory_events`.

---

### `POST /api/inventory/:id/release` 🔒

Release a pending reservation, restoring available stock.

**Request Body:**
```json
{
  "order_id": "order-uuid"
}
```

**Response `200`:** Updated inventory object with reservation status set to `released`.

**Side effects:** Publishes `inventory.released` to `inventory_events`.

---

### `POST /api/inventory/:id/confirm` 🔒

Confirm a pending reservation, permanently deducting from stock.

**Request Body:**
```json
{
  "order_id": "order-uuid"
}
```

**Response `200`:** Updated inventory object with reservation status set to `confirmed`.

**Side effects:** Publishes `inventory.confirmed` to `inventory_events`.

---

## Order Service

Base path: `/api/orders`  
Port: `3005`

---

### `GET /api/orders/health` 🌐

**Response `200`:**
```json
{
  "success": true,
  "service": "order-service",
  "status": "UP",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### `GET /api/orders` 🔒

List orders. Admins see all orders; regular users see only their own.

**Query Parameters:**

| Parameter | Type    | Default | Description          |
|-----------|---------|---------|----------------------|
| `page`    | integer | 1       | Page number (min 1)  |
| `limit`   | integer | 20      | Per page (max 100)   |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "order-uuid",
      "user_id": "user-uuid",
      "status": "confirmed",
      "total_amount": "179.98",
      "shipping_address": {
        "street": "123 Main St",
        "city": "San Francisco",
        "state": "CA",
        "zip": "94102",
        "country": "US"
      },
      "items": [
        {
          "id": "item-uuid",
          "order_id": "order-uuid",
          "product_id": "product-uuid",
          "product_name": "Wireless Keyboard",
          "quantity": 2,
          "unit_price": "89.99",
          "total_price": "179.98"
        }
      ],
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:05.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "totalPages": 1
  }
}
```

---

### `GET /api/orders/:id` 🔒

Get a single order by UUID, including items and the full saga audit trail. Admin can access any order; non-admin users can only access their own.

**Path Parameter:** `id` — UUID v4

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "user_id": "user-uuid",
    "status": "confirmed",
    "total_amount": "179.98",
    "shipping_address": { ... },
    "items": [ ... ],
    "sagaStates": [
      {
        "id": "saga-uuid-1",
        "order_id": "order-uuid",
        "saga_step": "VALIDATE_USER",
        "status": "completed",
        "data": { "userId": "user-uuid" },
        "created_at": "2024-01-15T10:30:00.100Z"
      },
      {
        "id": "saga-uuid-2",
        "order_id": "order-uuid",
        "saga_step": "GET_PRODUCT:product-uuid",
        "status": "completed",
        "data": { "product_id": "product-uuid", "name": "Wireless Keyboard" },
        "created_at": "2024-01-15T10:30:00.200Z"
      },
      {
        "id": "saga-uuid-3",
        "order_id": "order-uuid",
        "saga_step": "RESERVE_INVENTORY:product-uuid",
        "status": "completed",
        "data": { "product_id": "product-uuid", "reservationId": "res-uuid" },
        "created_at": "2024-01-15T10:30:00.350Z"
      },
      {
        "id": "saga-uuid-4",
        "order_id": "order-uuid",
        "saga_step": "CREATE_ORDER",
        "status": "completed",
        "data": { "orderId": "order-uuid" },
        "created_at": "2024-01-15T10:30:00.500Z"
      },
      {
        "id": "saga-uuid-5",
        "order_id": "order-uuid",
        "saga_step": "CONFIRM_INVENTORY:product-uuid",
        "status": "completed",
        "data": { "product_id": "product-uuid" },
        "created_at": "2024-01-15T10:30:00.700Z"
      },
      {
        "id": "saga-uuid-6",
        "order_id": "order-uuid",
        "saga_step": "CONFIRM_ORDER",
        "status": "completed",
        "data": { "orderId": "order-uuid" },
        "created_at": "2024-01-15T10:30:00.850Z"
      }
    ],
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.900Z"
  }
}
```

**Error Responses:**

| Code | Condition                              |
|------|----------------------------------------|
| 403  | Non-admin accessing another user's order |
| 404  | Order not found                         |

---

### `POST /api/orders` 🔒

Create an order. Triggers the full 6-step Order Creation Saga synchronously.

**Request Body:**
```json
{
  "items": [
    {
      "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "quantity": 2
    },
    {
      "product_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "quantity": 1
    }
  ],
  "shipping_address": {
    "street": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102",
    "country": "US"
  }
}
```

**`items` array entry:**

| Field        | Type    | Required | Constraints               |
|--------------|---------|----------|---------------------------|
| `product_id` | string  | ✅       | Non-empty product UUID    |
| `quantity`   | integer | ✅       | ≥ 1                       |

**`shipping_address` object:**

| Field     | Required | Description                    |
|-----------|----------|--------------------------------|
| `street`  | ✅       | Street address                  |
| `city`    | ✅       | City                            |
| `state`   | ❌       | State/province                  |
| `zip`     | ❌       | Postal/ZIP code                 |
| `country` | ✅       | Country code or name            |

**Response `201`** (saga completed successfully):
```json
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "user_id": "user-uuid",
    "status": "confirmed",
    "total_amount": "269.97",
    "shipping_address": { ... },
    "items": [ ... ],
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Error Responses:**

| Code | Condition                                                          |
|------|--------------------------------------------------------------------|
| 400  | Validation failure (missing items, bad shipping_address)           |
| 401  | Token validation failed at saga step 1                             |
| 404  | Product not found at saga step 2 (compensation triggered)          |
| 409  | Insufficient inventory at saga step 3 (compensation triggered)     |
| 409  | Inventory confirmation failed at saga step 5 (compensation triggered) |
| 500  | DB write failure at saga step 4 (compensation triggered)           |

When a saga error occurs, all previously completed inventory reservations are automatically released before returning the error.

**Side effects:** Publishes `order.created` on saga step 4 completion; publishes `order.confirmed` on saga step 6 completion; publishes `order.failed` if saga fails after step 4.

---

### `PUT /api/orders/:id/cancel` 🔒

Cancel a pending or confirmed order. Triggers the Order Cancellation Saga.

The cancellation saga:
1. Verifies the order exists and is in a cancellable state (`pending` or `confirmed`)
2. Attempts to release inventory for each item (best-effort)
3. Sets order status to `cancelled`
4. Publishes `order.cancelled`

Non-admin users can only cancel their own orders.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "status": "cancelled",
    ...
  }
}
```

**Error Responses:**

| Code | Condition                                                        |
|------|------------------------------------------------------------------|
| 403  | Non-admin attempting to cancel another user's order              |
| 404  | Order not found                                                  |
| 409  | Order cannot be cancelled (status is `shipped`, `delivered`, or `failed`) |

---

### `PUT /api/orders/:id/status` 🔒🛡️

Admin-only endpoint to manually set order status.

**Request Body:**
```json
{
  "status": "shipped"
}
```

| Field    | Type   | Required | Allowed Values                                               |
|----------|--------|----------|--------------------------------------------------------------|
| `status` | string | ✅       | `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `failed` |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "status": "shipped",
    ...
  }
}
```

**Side effects:** Publishes the corresponding event to `order_events`:
- `order.confirmed`, `order.cancelled`, `order.failed`, `order.shipped`, or `order.delivered`

---

## Rate Limiting

The API Gateway enforces a rate limit of **100 requests per 15 minutes** per IP address.

When the limit is exceeded:

**Response `429`:**
```json
{
  "status": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again in 15 minutes."
}
```

---

## CORS

The API Gateway enforces CORS. Allowed origins are configured via the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated).

Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`  
Allowed headers: `Content-Type, Authorization, X-Requested-With`  
Credentials: allowed

Preflight (`OPTIONS`) requests return `204 No Content`.

---

## API Gateway Meta-Endpoints

### `GET /` 🌐

Returns a service registry describing all available upstream services.

**Response `200`:**
```json
{
  "name": "API Gateway",
  "version": "1.0.0",
  "description": "Central entry point for all microservices",
  "endpoints": [
    { "service": "auth-service", "path": "/api/auth/*", "upstream": "http://auth-service:3001" },
    { "service": "user-service", "path": "/api/users/*", "upstream": "http://user-service:3002" },
    { "service": "product-service", "path": "/api/products/*", "upstream": "http://product-service:3003" },
    { "service": "inventory-service", "path": "/api/inventory/*", "upstream": "http://inventory-service:3004" },
    { "service": "order-service", "path": "/api/orders/*", "upstream": "http://order-service:3005" }
  ],
  "rateLimit": { "windowMs": "15 minutes", "maxRequests": 100 },
  "healthCheck": "/health"
}
```

### `GET /health` 🌐

Aggregated health check — pings all upstream services.

**Response `200`** (all healthy):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "gateway": "healthy",
  "upstreamServices": {
    "auth-service": "healthy",
    "user-service": "healthy",
    "product-service": "healthy",
    "inventory-service": "healthy",
    "order-service": "healthy"
  }
}
```

**Response `207`** (some services degraded):
```json
{
  "status": "degraded",
  "upstreamServices": {
    "auth-service": "healthy",
    "product-service": "unhealthy"
  }
}
```

**Response `503`** (all services down).
