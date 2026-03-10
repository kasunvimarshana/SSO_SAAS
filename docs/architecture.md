# Architecture Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Service Boundaries and Responsibilities](#service-boundaries-and-responsibilities)
3. [Service Interaction Flows](#service-interaction-flows)
4. [Database Schemas](#database-schemas)
5. [Saga Pattern Implementation](#saga-pattern-implementation)
6. [Event-Driven Communication](#event-driven-communication)
7. [Security Architecture](#security-architecture)
8. [Infrastructure Configuration](#infrastructure-configuration)

---

## System Overview

The SSO_SAAS platform is a **polyglot microservices architecture** in which each domain service:

- Owns exactly one database instance (database-per-service pattern)
- Is deployed as a separate Docker container
- Communicates synchronously with other services via HTTP (for request/response) and asynchronously via RabbitMQ (for domain events)
- Is independently deployable and horizontally scalable

All external traffic enters through a single **API Gateway** (port 3000), which performs rate limiting, CORS enforcement, security header injection, and transparent HTTP proxying to the correct upstream service.

```
                   External Traffic
                         │
                    ┌────▼─────┐
                    │  API GW  │  Port 3000
                    │ Node.js  │  Rate-limit: 100 req/15 min
                    │ Express  │  CORS, Helmet, HTTP Proxy
                    └────┬─────┘
                         │
         ┌───────────────┼───────────────────────┐
         │               │               │        │        │
    ┌────▼───┐      ┌────▼───┐      ┌───▼──┐  ┌──▼──────┐ ┌──▼────┐
    │  Auth  │      │  User  │      │Prod. │  │Inventory│ │Order  │
    │ :3001  │      │ :3002  │      │:3003 │  │  :3004  │ │ :3005 │
    │Node.js │      │Node.js │      │  Go  │  │ Python  │ │Node.js│
    └────┬───┘      └────┬───┘      └───┬──┘  └──┬──────┘ └──┬────┘
         │               │              │         │            │
    ┌────▼──┐        ┌───▼──┐       ┌──▼───┐  ┌──▼───┐   ┌───▼──┐
    │PG auth│        │PG usr│       │PG prd│  │Mongo │   │MySQL │
    └───────┘        └──────┘       └──────┘  └──────┘   └──────┘

              ┌────────────────────────────────────────────┐
              │  RabbitMQ  5672/15672  (topic exchanges)   │
              │  Redis     6379        (cache / sessions)  │
              └────────────────────────────────────────────┘
```

---

## Service Boundaries and Responsibilities

### API Gateway (`services/api-gateway`)

**Technology:** Node.js, Express, http-proxy-middleware  
**Port:** 3000  
**Role:** The single entry point for all client traffic.

Responsibilities:
- Route requests to the correct upstream service based on the URL path prefix
- Enforce rate limits (express-rate-limit, 100 requests per 15-minute window per IP)
- Inject security headers via Helmet (CSP, HSTS, XSS-protection, etc.)
- Enforce CORS policy (configurable `CORS_ALLOWED_ORIGINS`)
- Forward the original client IP via `X-Forwarded-For`
- Add a gateway request ID via `X-Gateway-Request-Id`
- Return `502 Bad Gateway` with a structured error when an upstream is unreachable
- Expose a `/health` endpoint that aggregates health from all upstreams

The gateway does **not** perform authentication — that responsibility lives in each service.

Path routing table:
```
/api/auth/*       → http://auth-service:3001
/api/users/*      → http://user-service:3002
/api/products/*   → http://product-service:3003
/api/inventory/*  → http://inventory-service:3004
/api/orders/*     → http://order-service:3005
```

---

### Auth Service (`services/auth-service`)

**Technology:** Node.js, Express, Sequelize ORM  
**Database:** PostgreSQL (`auth_db`)  
**Port:** 3001  
**RabbitMQ Exchange:** `user_events` (topic)

The Auth Service is the identity authority of the platform. It is the **only** service that stores passwords and issues JWT tokens.

**Token strategy:**
- **Access tokens**: short-lived (default 15 min), signed with `JWT_ACCESS_SECRET`, include `{ userId, email, role }`
- **Refresh tokens**: long-lived (default 7 d), signed with `JWT_REFRESH_SECRET`, stored in the `refresh_tokens` table
- **Rotation**: each call to `/refresh` destroys the old refresh token and issues a new pair

Other services validate access tokens by calling `GET /api/auth/validate` with the `Authorization: Bearer` header. This provides a single source of truth for token validity — if a user is deactivated, the validate endpoint will return `401` even for a cryptographically valid token.

---

### User Service (`services/user-service`)

**Technology:** Node.js, Express, Sequelize ORM  
**Database:** PostgreSQL (`users_db`)  
**Port:** 3002  
**RabbitMQ Exchange:** consumes from `user_events`

The User Service maintains the **profile layer** on top of authentication identities. It does not know passwords; it receives user creation events from the Auth Service via RabbitMQ and maintains its own user table with extended profile data.

**Authorization logic:**
- `GET /me`, `PUT /me`: any authenticated user can access their own profile
- `GET /:id`, `PUT /:id`: admin or the user themselves
- `GET /`, `POST /`, `DELETE /:id`: admin only

**Soft delete:** `DELETE /:id` sets `is_active = false`, never hard-deletes rows.

---

### Product Service (`services/product-service`)

**Technology:** Go 1.23, Gin framework, GORM  
**Database:** PostgreSQL (`products_db`)  
**Port:** 3003  
**RabbitMQ Exchange:** `product_events` (topic)

The Product Service owns the product catalog. It publishes domain events when products change so that other services (e.g. Inventory) can react without coupling.

**Authentication:** Uses the `AuthRequired` Gin middleware, which calls the Auth Service's validate endpoint. The `AdminOnly` middleware then checks `role == "admin"` from the validated token payload.

**Soft delete:** GORM's `DeletedAt` (`gorm.DeletedAt`) field; deleted products are excluded from list queries automatically via GORM's default scope.

**SKU uniqueness:** Enforced at both the DB level (unique index) and application level (checked before insert/update to return a clean 409).

---

### Inventory Service (`services/inventory-service`)

**Technology:** Python 3.12, FastAPI, Motor (async MongoDB driver), Pika (RabbitMQ)  
**Database:** MongoDB (`inventory_db`)  
**Port:** 3004  
**RabbitMQ Exchange (publish):** `inventory_events` (topic)  
**RabbitMQ Exchange (consume):** `product_events`, queue `inventory_product_events`, key `product.deleted`

The Inventory Service tracks stock levels per product per warehouse. It exposes three reservation lifecycle operations used by the Order Saga:

1. **Reserve** (`/reserve`): atomically decrements available quantity and creates a reservation record with status `pending`
2. **Confirm** (`/confirm`): marks the reservation as `confirmed`, permanently consuming the stock
3. **Release** (`/release`): marks the reservation as `released`, restoring the available quantity

The consumer thread runs in a separate daemon thread (using `pika.BlockingConnection`) and handles `product.deleted` events by deleting all inventory records for the given product. Reconnection is automatic with 5 s backoff.

---

### Order Service (`services/order-service`)

**Technology:** Node.js, Express, Sequelize ORM  
**Database:** MySQL 8.0 (`orders_db`)  
**Port:** 3005  
**RabbitMQ Exchange:** `order_events` (topic)

The Order Service orchestrates the full order lifecycle. It calls the Auth, Product, and Inventory services synchronously during saga execution, and publishes events to RabbitMQ at key lifecycle transitions.

MySQL was chosen for the Order Service to provide strong ACID guarantees for financial data (order totals, payment states) and to leverage Sequelize's transaction support for atomic order + saga-state writes.

---

## Service Interaction Flows

### Authentication Flow

```
Client                  API Gateway             Auth Service            PostgreSQL
  │                          │                       │                       │
  │── POST /api/auth/login ──▶                        │                       │
  │                          │── proxy ──────────────▶                       │
  │                          │                       │── SELECT users ───────▶
  │                          │                       │◀── user row ──────────│
  │                          │                       │── bcrypt.compare ─────┤
  │                          │                       │── INSERT refresh_tokens▶
  │                          │                       │◀── ok ────────────────│
  │                          │◀── { accessToken, ────│
  │                          │     refreshToken }    │
  │◀── 200 tokens ───────────│                       │
```

### Token Validation Flow (used by every protected service)

```
Client                  API Gateway          Product Service          Auth Service
  │                          │                     │                       │
  │── GET /api/products ─────▶                     │                       │
  │                          │── proxy ────────────▶                       │
  │                          │                     │── GET /api/auth/validate ─▶
  │                          │                     │   Authorization: Bearer...  │
  │                          │                     │◀── { userId, role } ──────│
  │                          │                     │── handle request ─────┤
  │                          │◀── products ────────│                       │
  │◀── 200 products ─────────│                     │                       │
```

### Order Creation Flow (Saga)

```
Client         API GW      Order Service     Auth Svc    Product Svc    Inventory Svc    MySQL
  │              │               │               │             │               │            │
  │─POST /orders▶│               │               │             │               │            │
  │              │──proxy────────▶               │             │               │            │
  │              │               │──VALIDATE_USER─▶            │               │            │
  │              │               │◀─{userId}─────│             │               │            │
  │              │               │               │             │               │            │
  │              │               │  [for each item]:           │               │            │
  │              │               │──GET_PRODUCT───────────────▶               │            │
  │              │               │◀─{product}─────────────────│               │            │
  │              │               │──RESERVE_INVENTORY──────────────────────────▶            │
  │              │               │◀─{reservationId}────────────────────────────│            │
  │              │               │                             │               │            │
  │              │               │──CREATE_ORDER (status=pending)──────────────────────────▶│
  │              │               │◀─{order}────────────────────────────────────────────────│
  │              │               │──Publish: order.created                                  │
  │              │               │                             │               │            │
  │              │               │  [for each reservation]:    │               │            │
  │              │               │──CONFIRM_INVENTORY──────────────────────────▶            │
  │              │               │◀─{ok}───────────────────────────────────────│            │
  │              │               │                             │               │            │
  │              │               │──CONFIRM_ORDER (status=confirmed)───────────────────────▶│
  │              │               │──Publish: order.confirmed                               │
  │◀─201 order───│◀─────────────│                             │               │            │
```

### Product Deletion Cascade

```
Admin           API GW       Product Svc     RabbitMQ         Inventory Svc      MongoDB
  │               │               │               │                 │                │
  │─DELETE /prod──▶               │               │                 │                │
  │               │──proxy────────▶               │                 │                │
  │               │               │──Soft delete──┤                 │                │
  │               │               │──Publish: product.deleted ──────▶                │
  │◀─200 ok───────│◀──────────────│               │                 │                │
  │               │               │               │──deliver────────▶                │
  │               │               │               │                 │──DELETE inventory
  │               │               │               │                 │   by product_id▶
  │               │               │               │                 │◀─ok────────────│
```

---

## Database Schemas

### Auth Service — PostgreSQL (`auth_db`)

**Table: `users`**

| Column          | Type             | Constraints                    |
|-----------------|------------------|--------------------------------|
| `id`            | UUID             | PRIMARY KEY, default gen_random_uuid() |
| `name`          | VARCHAR(100)     | NOT NULL                       |
| `email`         | VARCHAR(255)     | NOT NULL, UNIQUE               |
| `password_hash` | VARCHAR(255)     | NOT NULL                       |
| `role`          | ENUM(user,admin) | NOT NULL, DEFAULT 'user'       |
| `is_active`     | BOOLEAN          | NOT NULL, DEFAULT true         |
| `created_at`    | TIMESTAMP        | auto                           |
| `updated_at`    | TIMESTAMP        | auto                           |

**Indexes:** `email (UNIQUE)`, `role`, `is_active`

**Table: `refresh_tokens`**

| Column       | Type      | Constraints               |
|--------------|-----------|---------------------------|
| `id`         | UUID      | PRIMARY KEY               |
| `user_id`    | UUID      | FK → users(id)            |
| `token`      | TEXT      | NOT NULL, UNIQUE          |
| `expires_at` | TIMESTAMP | NOT NULL                  |
| `created_at` | TIMESTAMP | auto                      |

**Indexes:** `token (UNIQUE)`, `user_id`, `expires_at`

---

### User Service — PostgreSQL (`users_db`)

**Table: `users`**

| Column       | Type              | Constraints                    |
|--------------|-------------------|--------------------------------|
| `id`         | UUID              | PRIMARY KEY, default UUIDV4    |
| `name`       | VARCHAR(255)      | NOT NULL                       |
| `email`      | VARCHAR(255)      | NOT NULL, UNIQUE               |
| `role`       | ENUM(admin,user)  | NOT NULL, DEFAULT 'user'       |
| `is_active`  | BOOLEAN           | NOT NULL, DEFAULT true         |
| `profile`    | JSONB             | nullable, default `{}`         |
| `created_at` | TIMESTAMP         | auto                           |
| `updated_at` | TIMESTAMP         | auto                           |

`profile` JSONB structure:
```json
{
  "bio": "string (max 1000 chars)",
  "avatar_url": "string (valid URL)",
  "phone": "string (valid mobile phone number)"
}
```

**Indexes:** `email (UNIQUE)`, `role`, `is_active`

---

### Product Service — PostgreSQL (`products_db`)

**Table: `products`**

| Column        | Type               | Constraints                    |
|---------------|--------------------|--------------------------------|
| `id`          | UUID               | PRIMARY KEY, default UUIDV4    |
| `name`        | VARCHAR(255)       | NOT NULL                       |
| `description` | TEXT               | nullable                       |
| `price`       | DECIMAL(10,2)      | NOT NULL                       |
| `category`    | VARCHAR(100)       | NOT NULL, indexed              |
| `sku`         | VARCHAR(100)       | NOT NULL, UNIQUE               |
| `images`      | JSONB              | NOT NULL, default `[]`         |
| `is_active`   | BOOLEAN            | NOT NULL, default true         |
| `created_at`  | TIMESTAMP          | auto                           |
| `updated_at`  | TIMESTAMP          | auto                           |
| `deleted_at`  | TIMESTAMP          | nullable (GORM soft-delete)    |

**Indexes:** `sku (UNIQUE)`, `category`, `deleted_at`

`images` JSONB is an array of URL strings:
```json
["https://cdn.example.com/product-1.jpg", "https://cdn.example.com/product-2.jpg"]
```

---

### Inventory Service — MongoDB (`inventory_db`)

**Collection: `inventory`**

```json
{
  "_id": "ObjectId",
  "product_id": "string (UUID reference to product service)",
  "warehouse_id": "string",
  "quantity": "integer (total stock)",
  "reserved_quantity": "integer (held by pending reservations)",
  "low_stock_threshold": "integer",
  "reservations": [
    {
      "id": "string (UUID)",
      "order_id": "string",
      "quantity": "integer",
      "status": "pending | confirmed | released",
      "created_at": "datetime",
      "updated_at": "datetime"
    }
  ],
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

**Available stock** = `quantity - reserved_quantity`

**Indexes:** `product_id`, `warehouse_id`, compound `{ product_id, warehouse_id }`

---

### Order Service — MySQL 8.0 (`orders_db`)

**Table: `orders`**

| Column             | Type                                                        | Constraints         |
|--------------------|-------------------------------------------------------------|---------------------|
| `id`               | CHAR(36)                                                    | PRIMARY KEY (UUID)  |
| `user_id`          | VARCHAR(255)                                                | NOT NULL, indexed   |
| `status`           | ENUM(pending,confirmed,shipped,delivered,cancelled,failed)  | NOT NULL            |
| `total_amount`     | DECIMAL(12,2)                                               | NOT NULL            |
| `shipping_address` | JSON                                                        | NOT NULL            |
| `created_at`       | DATETIME                                                    | auto                |
| `updated_at`       | DATETIME                                                    | auto                |

`shipping_address` JSON structure:
```json
{
  "street": "string",
  "city": "string",
  "state": "string (optional)",
  "zip": "string (optional)",
  "country": "string"
}
```

**Table: `order_items`**

| Column         | Type          | Constraints                  |
|----------------|---------------|------------------------------|
| `id`           | CHAR(36)      | PRIMARY KEY (UUID)           |
| `order_id`     | CHAR(36)      | FK → orders(id) ON DELETE CASCADE |
| `product_id`   | VARCHAR(255)  | NOT NULL                     |
| `product_name` | VARCHAR(500)  | NOT NULL (snapshotted at order time) |
| `quantity`     | INT UNSIGNED  | NOT NULL                     |
| `unit_price`   | DECIMAL(12,2) | NOT NULL                     |
| `total_price`  | DECIMAL(12,2) | NOT NULL                     |

> `product_name` and `unit_price` are **snapshotted** at order creation time so that subsequent product updates do not affect historical orders.

**Table: `saga_state`**

| Column      | Type                                           | Constraints          |
|-------------|------------------------------------------------|----------------------|
| `id`        | CHAR(36)                                       | PRIMARY KEY (UUID)   |
| `order_id`  | CHAR(36)                                       | NOT NULL, indexed    |
| `saga_step` | VARCHAR(100)                                   | NOT NULL             |
| `status`    | ENUM(pending,completed,failed,compensated)     | NOT NULL             |
| `data`      | JSON                                           | nullable             |
| `created_at`| DATETIME                                       | auto                 |

---

## Saga Pattern Implementation

### Design Principles

The Order Service implements an **orchestrator-style saga** — one central component (the Order Service) coordinates all steps sequentially, knows the overall goal, and is responsible for compensating on failure.

This differs from a **choreography-based saga** where services react to each other's events. The orchestrator approach was chosen because:
- It centralizes business logic in one place, making it easier to reason about and test
- It provides a clear audit trail (the `saga_state` table records every step)
- It makes compensation straightforward — the orchestrator knows exactly which steps succeeded

### Step Identification

Each saga step is recorded with a unique `saga_step` string. For per-item steps, the product UUID is appended:

```
VALIDATE_USER
GET_PRODUCT:a1b2c3d4-...
RESERVE_INVENTORY:a1b2c3d4-...
CREATE_ORDER
CONFIRM_INVENTORY:a1b2c3d4-...
CONFIRM_ORDER
COMPENSATE_INVENTORY:a1b2c3d4-...   ← compensation step
CANCEL_ORDER                         ← cancellation saga
```

### State Machine per Step

Each step entry follows this state machine:

```
         ┌─────────┐
         │ pending │
         └────┬────┘
              │
     ┌────────┴──────────┐
     │                   │
     ▼                   ▼
┌─────────┐         ┌────────┐
│completed│         │ failed │
└─────────┘         └────────┘
                         │
                         ▼
                   ┌────────────┐
                   │compensated │
                   └────────────┘
```

### Compensation Guarantee

The `compensate()` function iterates all successful reservations and calls `releaseInventory()` for each. Failures during compensation are logged and recorded as `failed` in `saga_state` — they do not prevent other compensations from running (best-effort, not all-or-nothing compensation).

This means it is possible for compensation to partially succeed. In a production system, a dead-letter queue or background reconciliation job would handle stuck compensations.

### Idempotency Considerations

The Order ID is generated with `uuidv4()` **before** any remote calls. Saga state rows use this ID as their `order_id` foreign key from the very first step. If the process crashes mid-saga, the incomplete saga steps are visible in `saga_state`, but re-running the saga will generate a new Order ID — the old partial state serves as an audit log only.

---

## Event-Driven Communication

### Exchange Topology

```
┌────────────────────────────────────────────────────────────────┐
│                        RabbitMQ                                │
│                                                                │
│  Exchange: user_events       (topic, durable)                  │
│    routing key: user.registered                                │
│    → no bound queues by default                                │
│                                                                │
│  Exchange: product_events    (topic, durable)                  │
│    routing key: product.created                                │
│    routing key: product.updated                                │
│    routing key: product.deleted                                │
│      → Queue: inventory_product_events  (durable)              │
│                                                                │
│  Exchange: inventory_events  (topic, durable)                  │
│    routing key: inventory.reserved                             │
│    routing key: inventory.released                             │
│    routing key: inventory.confirmed                            │
│      → Queue: order_service_events  (durable)                  │
│                                                                │
│  Exchange: order_events      (topic, durable)                  │
│    routing key: order.created                                  │
│    routing key: order.confirmed                                │
│    routing key: order.cancelled                                │
│    routing key: order.failed                                   │
│    routing key: order.shipped                                  │
│    routing key: order.delivered                                │
│      → no bound queues by default                              │
└────────────────────────────────────────────────────────────────┘
```

### Event Payload Schemas

**`user.registered`** (published by Auth Service)
```json
{
  "userId": "uuid",
  "name": "string",
  "email": "string",
  "role": "user | admin",
  "registeredAt": "ISO8601 datetime"
}
```

**`product.created` / `product.updated`** (published by Product Service)
```json
{
  "event": "product.created",
  "payload": {
    "id": "uuid",
    "name": "string",
    "price": 0.00,
    "category": "string",
    "sku": "string",
    "is_active": true
  },
  "timestamp": "ISO8601 datetime"
}
```

**`product.deleted`** (published by Product Service)
```json
{
  "event": "product.deleted",
  "payload": { "id": "uuid" },
  "timestamp": "ISO8601 datetime"
}
```

**`order.created`** (published by Order Service)
```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "totalAmount": 0.00,
  "items": [
    { "product_id": "uuid", "product_name": "string", "quantity": 1, "unit_price": 0.00, "total_price": 0.00 }
  ]
}
```

**`order.confirmed` / `order.cancelled` / `order.failed`** (published by Order Service)
```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "totalAmount": 0.00
}
```

---

## Security Architecture

### Token Flow

```
┌──────────┐        ┌─────────────┐       ┌──────────────────────┐
│  Client  │        │ Auth Service│       │ Protected Service    │
└──────────┘        └─────────────┘       └──────────────────────┘
     │                     │                          │
     │── POST /login ──────▶                          │
     │◀─ { accessToken,    │                          │
     │     refreshToken }  │                          │
     │                     │                          │
     │── GET /api/products ────────────────────────────▶
     │   Authorization: Bearer <accessToken>          │
     │                     │                          │──GET /api/auth/validate──▶
     │                     │                          │◀─{ userId, role }────────│
     │                     │                          │
     │◀── response ──────────────────────────────────│
```

### Authentication Middleware Pattern

Each service implements its own `auth` middleware that:
1. Extracts the `Authorization: Bearer <token>` header
2. Makes an HTTP GET request to `AUTH_SERVICE_URL/api/auth/validate`
3. On success: attaches `req.user = { id, email, role }` (Node.js) or sets user in request context (Go/Python)
4. On failure: returns `401 Unauthorized`

This means the Auth Service is on the hot path for every authenticated request. In a higher-scale deployment, services could instead verify tokens locally using the shared `JWT_SECRET`, falling back to the Auth Service only when the token is expired or the user needs to be confirmed active.

### Admin Authorization

After authentication, admin-only routes check `req.user.role === 'admin'`. The role is embedded in the JWT payload at login time and re-verified by the Auth Service on each validate call.

### Network Isolation

All services communicate on the internal Docker bridge network `microservices-net`. No database or RabbitMQ port is exposed to the host except the API Gateway (`:3000`), RabbitMQ management UI (`:15672` — for development only), and RabbitMQ AMQP (`:5672`). In production, the management UI and AMQP ports should be accessible only from within a private VPC.

---

## Infrastructure Configuration

### Docker Compose Dependency Chain

```
rabbitmq ──────────────────────────────────────────┐
postgres-auth ──────────────────────────────────────┤
postgres-users ─────────────────────────────────────┤
postgres-products ──────────────────────────────────┤
mongodb ─────────────────────────────────────────────┤
mysql-orders ────────────────────────────────────────┤
redis ──────────────────────────────────────────────┘
         │  (all healthy)
         ├──▶ auth-service (depends on: postgres-auth [healthy], rabbitmq [healthy])
         ├──▶ user-service (depends on: postgres-users [healthy], rabbitmq [healthy], auth-service [started])
         ├──▶ product-service (depends on: postgres-products [healthy], rabbitmq [healthy], auth-service [started])
         ├──▶ inventory-service (depends on: mongodb [healthy], rabbitmq [healthy], auth-service [started])
         ├──▶ order-service (depends on: mysql-orders [healthy], rabbitmq [healthy],
         │                              auth-service [started], product-service [started],
         │                              inventory-service [started])
         └──▶ api-gateway (depends on: all 5 services [started])
```

### Health Checks

| Container          | Check command                               | Interval | Retries |
|--------------------|---------------------------------------------|----------|---------|
| `rabbitmq`         | `rabbitmq-diagnostics check_port_connectivity` | 30 s  | 5       |
| `postgres-auth`    | `pg_isready -U auth_user -d auth_db`        | 10 s     | 5       |
| `postgres-users`   | `pg_isready -U users_user -d users_db`      | 10 s     | 5       |
| `postgres-products`| `pg_isready -U products_user -d products_db`| 10 s     | 5       |
| `mongodb`          | `mongosh --eval "db.adminCommand('ping')"`  | 15 s     | 5       |
| `mysql-orders`     | `mysqladmin ping -h localhost`              | 15 s     | 5       |
| `redis`            | `redis-cli ping`                            | 10 s     | 5       |

### Volumes

| Volume                  | Used by             |
|-------------------------|---------------------|
| `rabbitmq_data`         | RabbitMQ            |
| `postgres_auth_data`    | Auth Service DB     |
| `postgres_users_data`   | User Service DB     |
| `postgres_products_data`| Product Service DB  |
| `mongodb_data`          | Inventory Service DB|
| `mysql_orders_data`     | Order Service DB    |
| `redis_data`            | Redis cache         |

All volumes use the default `local` driver and are persisted across container restarts.

### Logging

All containers use the `json-file` log driver with rotation settings:
- `max-size: 10m` — rotate when log file reaches 10 MB
- `max-file: 3` — keep the 3 most recent log files per container

Access logs with: `docker-compose logs -f <service-name>`
