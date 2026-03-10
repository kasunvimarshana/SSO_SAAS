# SSO_SAAS — Microservices SaaS Platform

A production-ready, event-driven microservices platform featuring JWT-based SSO authentication, a product catalog, inventory management with a reservation system, and distributed order processing via the **Saga orchestration pattern**.

> **Five independent services** communicate asynchronously over RabbitMQ and are exposed through a single API Gateway — all orchestrated with Docker Compose.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Services](#services)
4. [Saga Pattern — Order Creation](#saga-pattern--order-creation)
5. [API Reference](#api-reference)
6. [RabbitMQ Events](#rabbitmq-events)
7. [Quick Start](#quick-start)
8. [Environment Variables](#environment-variables)
9. [Example API Calls](#example-api-calls)
10. [Scalability](#scalability)
11. [Failure Handling & Compensation](#failure-handling--compensation)
12. [Development Setup](#development-setup)

---

## Architecture Overview

```
                              ┌─────────────────────────────────────────────────────────┐
                              │                    Docker Network: microservices-net      │
                              │                                                           │
  ┌──────────┐   HTTP/S       │   ┌─────────────────────────────────────────────────┐   │
  │  Client  │───────────────▶│   │          API Gateway  :3000  (Node.js)           │   │
  └──────────┘                │   │   • Rate limiting (100 req / 15 min)             │   │
                              │   │   • CORS, Helmet security headers               │   │
                              │   │   • HTTP proxy to upstream services             │   │
                              │   └──────────────┬──────────────────────────────────┘   │
                              │                  │                                       │
                              │    ┌─────────────┼──────────────────────────┐           │
                              │    │             │                          │           │
                              │    ▼             ▼             ▼            ▼    ▼      │
                              │  ┌──────┐  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌──────┐  │
                              │  │Auth  │  │  User    │  │ Product │  │Inventory│  │Order│  │
                              │  │:3001 │  │  :3002   │  │  :3003  │  │  :3004  │  │:3005│  │
                              │  │Node.js│  │ Node.js  │  │   Go   │  │ Python  │  │Node │  │
                              │  └──┬───┘  └────┬─────┘  └────┬────┘  └────┬────┘  └──┬──┘  │
                              │     │            │             │            │           │     │
                              │     ▼            ▼             ▼            ▼           ▼     │
                              │  ┌──────┐   ┌────────┐  ┌──────────┐  ┌────────┐  ┌───────┐ │
                              │  │PG    │   │ PG     │  │ PG       │  │MongoDB │  │MySQL  │ │
                              │  │auth  │   │ users  │  │ products │  │        │  │orders │ │
                              │  └──────┘   └────────┘  └──────────┘  └────────┘  └───────┘ │
                              │                                                           │
                              │   ┌────────────────────────────────────────────────────┐ │
                              │   │         RabbitMQ  :5672 / Management UI :15672     │ │
                              │   │         Exchanges: user_events, product_events,    │ │
                              │   │                    inventory_events, order_events  │ │
                              │   └────────────────────────────────────────────────────┘ │
                              │                                                           │
                              │   ┌──────────────────┐                                   │
                              │   │  Redis  :6379     │  (shared session / rate-limit)   │
                              │   └──────────────────┘                                   │
                              └─────────────────────────────────────────────────────────┘
```

### Request Routing (API Gateway path prefixes)

| Client path prefix    | Upstream service          |
|-----------------------|---------------------------|
| `/api/auth/*`         | auth-service `:3001`      |
| `/api/users/*`        | user-service `:3002`      |
| `/api/products/*`     | product-service `:3003`   |
| `/api/inventory/*`    | inventory-service `:3004` |
| `/api/orders/*`       | order-service `:3005`     |

---

## Tech Stack

| Service            | Language / Framework    | Database          | Port |
|--------------------|-------------------------|-------------------|------|
| **API Gateway**    | Node.js / Express       | —                 | 3000 |
| **Auth Service**   | Node.js / Express       | PostgreSQL        | 3001 |
| **User Service**   | Node.js / Express       | PostgreSQL        | 3002 |
| **Product Service**| Go / Gin                | PostgreSQL (GORM) | 3003 |
| **Inventory Service** | Python / FastAPI     | MongoDB (Motor)   | 3004 |
| **Order Service**  | Node.js / Express       | MySQL (Sequelize) | 3005 |
| **Message Broker** | RabbitMQ 3.12           | —                 | 5672 / 15672 |
| **Cache**          | Redis 7                 | —                 | 6379 |

---

## Services

### 1. Auth Service (`:3001`)

Handles all identity and authentication concerns. Issues short-lived **access tokens** (JWT, default 1 h) and long-lived **refresh tokens** (default 7 d, stored in PostgreSQL and rotated on each use).

**Responsibilities:**
- User registration with bcrypt password hashing (12 rounds)
- Login / logout
- Refresh-token rotation (old token is invalidated on each refresh)
- Token validation endpoint used by every other service

**Key model:** `User` — `id (UUID)`, `name`, `email (unique)`, `password_hash`, `role (user|admin)`, `is_active`

---

### 2. User Service (`:3002`)

Manages extended user profiles. Listens on the `user_events` RabbitMQ exchange so it can react to auth events and keep its own user store in sync.

**Responsibilities:**
- Self-service profile reads and updates (`/me`)
- Admin CRUD for user accounts
- Soft-delete (sets `is_active = false`)
- Profile JSONB field: `bio`, `avatar_url`, `phone`

---

### 3. Product Service (`:3003`)

Go/Gin microservice for the product catalog, backed by PostgreSQL with GORM. Soft-deletes via GORM's `DeletedAt`.

**Responsibilities:**
- Paginated product listing with filters (category, search, price range)
- Product CRUD (admin-only writes)
- Category enumeration from the existing product data
- SKU uniqueness enforcement

**Key model:** `Product` — `id (UUID)`, `name`, `description`, `price (decimal 10,2)`, `category`, `sku (unique)`, `images (JSONB array)`, `is_active`, soft-delete timestamps

---

### 4. Inventory Service (`:3004`)

Python/FastAPI microservice, the only service using MongoDB. Manages per-warehouse stock levels and a reservation ledger used by the order saga.

**Responsibilities:**
- Track `quantity` and `reserved_quantity` per product/warehouse
- Create and release stock reservations (used by order saga)
- Confirm reservations (deduct from available stock permanently)
- Consume `product.deleted` events to clean up orphaned inventory
- Low-stock alerting threshold

---

### 5. Order Service (`:3005`)

Node.js/MySQL service that orchestrates the full order lifecycle using the **Saga pattern**. Every step of order creation is durably recorded in a `saga_state` table, enabling full auditability and compensating transactions on failure.

**Responsibilities:**
- Create orders through a multi-step saga
- Cancel orders with inventory release
- Admin order status management
- Publish lifecycle events to downstream consumers

---

## Saga Pattern — Order Creation

The Order Creation Saga is an **orchestrator-style** saga — the Order Service drives every step and records each one in the `saga_state` MySQL table.

### Happy Path (6 Steps)

```
Order Service                Auth Service   Product Service   Inventory Service   Database
     │                            │               │                  │               │
     │─── Step 1: VALIDATE_USER ─▶│               │                  │               │
     │◀── 200 OK {userId} ────────│               │                  │               │
     │                            │               │                  │               │
     │─── Step 2: GET_PRODUCT ────────────────────▶               │               │
     │◀── 200 OK {product} ───────────────────────│               │               │
     │                            │               │                  │               │
     │─── Step 3: RESERVE_INVENTORY ──────────────────────────────▶│               │
     │◀── 201 {reservationId} ────────────────────────────────────│               │
     │                            │               │                  │               │
     │─── Step 4: CREATE_ORDER (status=pending) ──────────────────────────────────▶│
     │◀── Order row + items ──────────────────────────────────────────────────────│
     │                            │               │                  │               │
     │─── Step 5: CONFIRM_INVENTORY ──────────────────────────────▶│               │
     │◀── 200 OK ─────────────────────────────────────────────────│               │
     │                            │               │                  │               │
     │─── Step 6: CONFIRM_ORDER (status=confirmed) ───────────────────────────────▶│
     │◀── Order confirmed ────────────────────────────────────────────────────────│
     │                            │               │                  │               │
     │══▶ Publish: order.confirmed                │                  │               │
```

Steps 2 and 3 are executed **per order item** — each item gets its own product lookup and inventory reservation.

### Compensation (Rollback) Flow

If any step fails **after** reservations have been made, the saga compensates by releasing all held reservations before failing the order:

```
     Step N fails
          │
          ▼
  ┌────────────────────────────────────────┐
  │  For each successful reservation:      │
  │    POST /api/inventory/:id/release     │
  │    Record COMPENSATE_INVENTORY step    │
  └────────────────────────────────────────┘
          │
          ▼
  Order status → "failed"  (if order row was created)
  Publish: order.failed
```

### Saga State Table

Each saga step produces a row in `saga_state`:

| Column      | Type                                          | Description                        |
|-------------|-----------------------------------------------|------------------------------------|
| `id`        | UUID                                          | Row identifier                     |
| `order_id`  | UUID                                          | Parent order                       |
| `saga_step` | VARCHAR(100)                                  | e.g. `VALIDATE_USER`, `GET_PRODUCT:uuid`, `RESERVE_INVENTORY:uuid` |
| `status`    | ENUM: pending, completed, failed, compensated | Current step state                 |
| `data`      | JSON                                          | Step-specific payload / error msg  |
| `created_at`| TIMESTAMP                                     | When step was recorded             |

---

## API Reference

All routes go through the API Gateway on **port 3000**.  
Routes marked 🔒 require `Authorization: Bearer <accessToken>`.  
Routes marked 🛡️ additionally require `role = admin`.

### Auth Service — `/api/auth`

| Method | Path                  | Description                        | Auth |
|--------|-----------------------|------------------------------------|------|
| GET    | `/api/auth/health`    | Service health check               |      |
| POST   | `/api/auth/register`  | Register a new user                |      |
| POST   | `/api/auth/login`     | Login and receive token pair       |      |
| POST   | `/api/auth/logout`    | Invalidate a refresh token         |      |
| POST   | `/api/auth/refresh`   | Rotate access + refresh tokens     |      |
| GET    | `/api/auth/validate`  | Validate an access token           | 🔒   |

### User Service — `/api/users`

| Method | Path               | Description                              | Auth |
|--------|--------------------|------------------------------------------|------|
| GET    | `/api/users/health`| Service health check                     |      |
| GET    | `/api/users/me`    | Get current user profile                 | 🔒   |
| PUT    | `/api/users/me`    | Update current user profile              | 🔒   |
| GET    | `/api/users`       | List all users (paginated, filterable)   | 🔒🛡️ |
| POST   | `/api/users`       | Create a new user account                | 🔒🛡️ |
| GET    | `/api/users/:id`   | Get a user by UUID (admin or self)       | 🔒   |
| PUT    | `/api/users/:id`   | Update a user (admin or self)            | 🔒   |
| DELETE | `/api/users/:id`   | Soft-delete / deactivate a user          | 🔒🛡️ |

**Query parameters for `GET /api/users`:** `page`, `limit`, `search`, `role`, `is_active`

### Product Service — `/api/products`

| Method | Path                        | Description                                  | Auth |
|--------|-----------------------------|----------------------------------------------|------|
| GET    | `/api/products/health`      | Service health check                         |      |
| GET    | `/api/products/categories`  | List all distinct product categories         |      |
| GET    | `/api/products`             | List products (paginated, filterable)        |      |
| GET    | `/api/products/:id`         | Get a product by UUID                        |      |
| POST   | `/api/products`             | Create a new product                         | 🔒🛡️ |
| PUT    | `/api/products/:id`         | Update a product                             | 🔒🛡️ |
| DELETE | `/api/products/:id`         | Soft-delete a product                        | 🔒🛡️ |

**Query parameters for `GET /api/products`:** `page`, `limit`, `category`, `search`, `min_price`, `max_price`

### Inventory Service — `/api/inventory`

| Method | Path                              | Description                                       | Auth |
|--------|-----------------------------------|---------------------------------------------------|------|
| GET    | `/api/inventory/health`           | Service health check                              |      |
| GET    | `/api/inventory`                  | List inventory records (paginated, filterable)    | 🔒   |
| GET    | `/api/inventory/product/:id`      | Get all inventory records for a product           | 🔒   |
| GET    | `/api/inventory/:id`              | Get inventory record by MongoDB ObjectId          | 🔒   |
| POST   | `/api/inventory`                  | Create an inventory record                        | 🔒🛡️ |
| PUT    | `/api/inventory/:id`              | Update stock levels / threshold                   | 🔒🛡️ |
| DELETE | `/api/inventory/:id`              | Delete an inventory record                        | 🔒🛡️ |
| POST   | `/api/inventory/:id/reserve`      | Reserve stock for an order                        | 🔒   |
| POST   | `/api/inventory/:id/release`      | Release a pending reservation                     | 🔒   |
| POST   | `/api/inventory/:id/confirm`      | Confirm a reservation (deduct from stock)         | 🔒   |

**Query parameters for `GET /api/inventory`:** `page`, `limit`, `product_id`, `warehouse_id`, `low_stock`

### Order Service — `/api/orders`

| Method | Path                     | Description                                   | Auth |
|--------|--------------------------|-----------------------------------------------|------|
| GET    | `/api/orders/health`     | Service health check                          |      |
| GET    | `/api/orders`            | List orders (admin sees all, users see own)   | 🔒   |
| GET    | `/api/orders/:id`        | Get order by UUID (with items + saga states)  | 🔒   |
| POST   | `/api/orders`            | Create order (runs full creation saga)        | 🔒   |
| PUT    | `/api/orders/:id/cancel` | Cancel an order (runs cancellation saga)      | 🔒   |
| PUT    | `/api/orders/:id/status` | Admin: manually update order status           | 🔒🛡️ |

**Query parameters for `GET /api/orders`:** `page`, `limit`

---

## RabbitMQ Events

All exchanges are declared as **topic** type with `durable: true`. Messages are persisted (`delivery_mode: 2`).

| Exchange           | Routing Key                       | Publisher          | Consumer(s)                    |
|--------------------|-----------------------------------|--------------------|--------------------------------|
| `user_events`      | `user.registered`                 | Auth Service       | User Service                   |
| `product_events`   | `product.created`                 | Product Service    | —                              |
| `product_events`   | `product.updated`                 | Product Service    | —                              |
| `product_events`   | `product.deleted`                 | Product Service    | Inventory Service              |
| `inventory_events` | `inventory.reserved`              | Inventory Service  | Order Service                  |
| `inventory_events` | `inventory.released`              | Inventory Service  | Order Service                  |
| `inventory_events` | `inventory.confirmed`             | Inventory Service  | Order Service                  |
| `order_events`     | `order.created`                   | Order Service      | —                              |
| `order_events`     | `order.confirmed`                 | Order Service      | —                              |
| `order_events`     | `order.cancelled`                 | Order Service      | —                              |
| `order_events`     | `order.failed`                    | Order Service      | —                              |
| `order_events`     | `order.shipped`                   | Order Service      | —                              |
| `order_events`     | `order.delivered`                 | Order Service      | —                              |

The Inventory Service also has a **durable queue** named `inventory_product_events` bound to `product_events` with routing key `product.deleted`. When a product is deleted, the inventory service automatically removes all associated inventory records.

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) ≥ 2.20

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-org/SSO_SAAS.git
cd SSO_SAAS

# 2. Create and configure your environment file
cp services/auth-service/.env.example .env
# Edit .env — at minimum set strong JWT secrets:
#   JWT_ACCESS_SECRET=<random 64-char string>
#   JWT_REFRESH_SECRET=<random 64-char string>

# 3. Start all services (infrastructure first, then application)
docker-compose up -d

# 4. Wait for health checks to pass (~60 s for databases to initialize)
docker-compose ps

# 5. Verify the gateway is responding
curl http://localhost:3000/health
```

The gateway exposes a unified health endpoint that checks all upstream services:
```
GET http://localhost:3000/health
→ { "status": "healthy", "gateway": "healthy", "upstreamServices": { ... } }
```

Access the **RabbitMQ Management UI** at `http://localhost:15672` (user: `admin`, password: `password`).

---

## Environment Variables

### API Gateway

| Variable               | Default                         | Description                        |
|------------------------|---------------------------------|------------------------------------|
| `PORT`                 | `3000`                          | Listen port                        |
| `HOST`                 | `0.0.0.0`                       | Bind address                       |
| `NODE_ENV`             | `development`                   | Node environment                   |
| `AUTH_SERVICE_URL`     | `http://auth-service:3001`      | Auth upstream                      |
| `USER_SERVICE_URL`     | `http://user-service:3002`      | User upstream                      |
| `PRODUCT_SERVICE_URL`  | `http://product-service:3003`   | Product upstream                   |
| `INVENTORY_SERVICE_URL`| `http://inventory-service:3004` | Inventory upstream                 |
| `ORDER_SERVICE_URL`    | `http://order-service:3005`     | Order upstream                     |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000`         | Comma-separated allowed origins    |

### Auth Service

| Variable                      | Default       | Description                               |
|-------------------------------|---------------|-------------------------------------------|
| `PORT`                        | `3001`        | Listen port                               |
| `DB_HOST`                     | `localhost`   | PostgreSQL host                           |
| `DB_PORT`                     | `5432`        | PostgreSQL port                           |
| `DB_NAME`                     | `auth_db`     | Database name                             |
| `DB_USER`                     | `postgres`    | Database user                             |
| `DB_PASSWORD`                 | —             | Database password                         |
| `JWT_ACCESS_SECRET`           | —             | ≥ 32-char secret for access tokens        |
| `JWT_REFRESH_SECRET`          | —             | ≥ 32-char secret for refresh tokens       |
| `JWT_ACCESS_EXPIRES_IN`       | `15m`         | Access token TTL                          |
| `JWT_REFRESH_EXPIRES_IN`      | `7d`          | Refresh token TTL                         |
| `RABBITMQ_URL`                | `amqp://guest:guest@localhost:5672` | RabbitMQ connection string |
| `RABBITMQ_USER_EVENTS_EXCHANGE` | `user_events` | Exchange name                           |
| `BCRYPT_SALT_ROUNDS`          | `12`          | Bcrypt work factor                        |
| `CORS_ORIGIN`                 | `http://localhost:3000` | Allowed CORS origin            |

### User Service

| Variable                      | Default         | Description                         |
|-------------------------------|-----------------|-------------------------------------|
| `PORT`                        | `3002`          | Listen port                         |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | PostgreSQL connection |
| `AUTH_SERVICE_URL`            | `http://auth-service:3001` | For token validation       |
| `JWT_SECRET`                  | —               | Must match auth service secret      |
| `RABBITMQ_URL`                | —               | RabbitMQ connection string          |
| `RABBITMQ_USER_EVENTS_EXCHANGE` | `user_events` | Exchange to listen on               |

### Product Service

| Variable         | Default          | Description              |
|------------------|------------------|--------------------------|
| `PORT`           | `3003`           | Listen port              |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | PostgreSQL connection |
| `AUTH_SERVICE_URL` | `http://auth-service:3001` | For token validation |
| `JWT_SECRET`     | —                | Must match auth service  |
| `RABBITMQ_URL`   | —                | RabbitMQ connection string |

### Inventory Service

| Variable             | Default                       | Description              |
|----------------------|-------------------------------|--------------------------|
| `PORT`               | `3004`                        | Listen port              |
| `MONGODB_URL`        | `mongodb://localhost:27017`   | MongoDB connection string |
| `MONGODB_DB_NAME`    | `inventory_db`                | Database name            |
| `AUTH_SERVICE_URL`   | `http://auth-service:3001`    | For token validation     |
| `RABBITMQ_URL`       | `amqp://guest:guest@localhost:5672/` | RabbitMQ connection |

### Order Service

| Variable                  | Default          | Description              |
|---------------------------|------------------|--------------------------|
| `PORT`                    | `3005`           | Listen port              |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | MySQL connection |
| `AUTH_SERVICE_URL`        | `http://auth-service:3001` | Token validation |
| `PRODUCT_SERVICE_URL`     | `http://product-service:3003` | Product lookups |
| `INVENTORY_SERVICE_URL`   | `http://inventory-service:3004` | Stock management |
| `JWT_SECRET`              | —                | Must match auth service  |
| `RABBITMQ_URL`            | —                | RabbitMQ connection string |

---

## Example API Calls

> Replace `<TOKEN>` with the `accessToken` returned by the login endpoint.

### 1. Register a User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Smith",
    "email": "alice@example.com",
    "password": "SecurePass1",
    "role": "user"
  }'
```

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

### 2. Login and Get JWT Token

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass1"
  }'
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": { "id": "...", "name": "Alice Smith", "email": "alice@example.com", "role": "user" }
  }
}
```

### 3. Create a Product (Admin)

```bash
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "Wireless Keyboard",
    "description": "Compact 75% layout with Bluetooth",
    "price": 89.99,
    "category": "Electronics",
    "sku": "WKB-BT-75",
    "images": ["https://cdn.example.com/kb-75.jpg"],
    "is_active": true
  }'
```

**Response `201`:**
```json
{
  "status": "success",
  "message": "product created successfully",
  "data": {
    "product": {
      "id": "a1b2c3d4-...",
      "name": "Wireless Keyboard",
      "price": 89.99,
      "category": "Electronics",
      "sku": "WKB-BT-75",
      "is_active": true
    }
  }
}
```

### 4. Create Inventory for a Product (Admin)

```bash
curl -X POST http://localhost:3000/api/inventory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "product_id": "a1b2c3d4-...",
    "warehouse_id": "warehouse-east-1",
    "quantity": 150,
    "low_stock_threshold": 20
  }'
```

**Response `201`:**
```json
{
  "id": "64f1b2c3d4e5f6a7b8c9d0e1",
  "product_id": "a1b2c3d4-...",
  "warehouse_id": "warehouse-east-1",
  "quantity": 150,
  "reserved_quantity": 0,
  "low_stock_threshold": 20
}
```

### 5. Place an Order (Runs the Saga)

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "items": [
      { "product_id": "a1b2c3d4-...", "quantity": 2 }
    ],
    "shipping_address": {
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94102",
      "country": "US"
    }
  }'
```

**Response `201`** (after saga completes all 6 steps):
```json
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "user_id": "user-uuid",
    "status": "confirmed",
    "total_amount": "179.98",
    "items": [
      {
        "product_id": "a1b2c3d4-...",
        "product_name": "Wireless Keyboard",
        "quantity": 2,
        "unit_price": "89.99",
        "total_price": "179.98"
      }
    ]
  }
}
```

### 6. Check Order Status (with Saga Audit Trail)

```bash
curl http://localhost:3000/api/orders/<ORDER_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

The response includes the `sagaStates` array showing every step that ran, its status, and any stored data — giving you a complete audit trail of what happened during order creation.

### 7. Refresh an Access Token

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<REFRESH_TOKEN>" }'
```

---

## Scalability

### Horizontal Scaling

All application services are **stateless** — no sticky sessions or local state. They can be replicated freely:

```bash
# Scale the product service to 3 replicas
docker-compose up -d --scale product-service=3

# Scale multiple services simultaneously
docker-compose up -d --scale product-service=3 --scale inventory-service=2
```

> **Note:** When scaling, place a load balancer (e.g. nginx) in front of the API Gateway or scale the gateway itself.

### Async Processing with RabbitMQ

All inter-service events flow through RabbitMQ topic exchanges. The message broker:
- Decouples producers from consumers — adding a new consumer never changes the publisher
- Buffers messages if a consumer is temporarily unavailable
- Enables fan-out: multiple services can consume the same event independently
- All messages are marked `persistent: true` — they survive a RabbitMQ restart

### Database Isolation

Each service owns its own database engine and schema. This means:
- Services can be migrated or scaled independently
- Schema changes in one service never affect another
- Different databases can be optimized for their specific workload (relational for structured data, MongoDB for flexible documents)

---

## Failure Handling & Compensation

### Order Saga Compensation

When any step of the order creation saga fails:

1. **Before any reservation** (steps 1–2 fail): No compensation needed; the order was never persisted.
2. **After some reservations** (step 3 fails mid-loop): All successful reservations are released via `POST /api/inventory/:id/release` before returning an error.
3. **After order creation** (steps 5–6 fail): Reservations are released, the order status is set to `failed`, and an `order.failed` event is published.

Each compensation action is itself recorded in `saga_state` with status `compensated` or `failed`, so partial compensation failures are visible.

### Service Resilience

- **API Gateway**: Returns `502 Bad Gateway` with a human-readable message if an upstream is unreachable. Other services continue serving normally.
- **RabbitMQ reconnection**: The Order Service includes automatic reconnect logic (up to 10 retries with 5 s backoff). Auth and User services continue without messaging if RabbitMQ is unavailable (non-fatal).
- **Inventory consumer**: The Python consumer thread reconnects automatically on connection loss with 5 s backoff.
- **Database health checks**: Docker Compose health checks prevent application services from starting before their databases are ready.

---

## Development Setup

### Running a Single Service Locally

**Auth / User / Order Service (Node.js):**
```bash
cd services/auth-service      # or user-service / order-service
cp .env.example .env
# Edit .env with local DB/RabbitMQ credentials
npm install
npm run dev                   # or: node src/server.js
```

**Product Service (Go):**
```bash
cd services/product-service
cp .env.example .env
# Edit .env
go mod download
go run cmd/server/main.go
```

**Inventory Service (Python):**
```bash
cd services/inventory-service
cp .env.example .env
# Edit .env
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 3004
```

### Starting Only Infrastructure

To develop a single service while running all databases and RabbitMQ in Docker:

```bash
docker-compose up -d rabbitmq postgres-auth postgres-users postgres-products mongodb mysql-orders redis
```

Then run your service locally pointing at `localhost` for each dependency.

### Useful Commands

```bash
# View logs for a specific service
docker-compose logs -f auth-service

# Restart a single service after a code change
docker-compose up -d --build product-service

# Open a shell in a running container
docker-compose exec order-service sh

# Run all services and rebuild all images
docker-compose up -d --build

# Stop and remove everything (including volumes — destructive!)
docker-compose down -v
```

---

## Further Documentation

- [Architecture & Service Interactions](docs/architecture.md)
- [Full API Contracts with Request/Response Schemas](docs/api-contracts.md)
