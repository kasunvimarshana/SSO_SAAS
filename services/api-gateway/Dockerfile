# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Install only production dependencies first (layer-cache friendly)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:18-alpine AS runtime

# Non-root user for security
RUN addgroup -S gateway && adduser -S gateway -G gateway

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY package.json ./

# Switch to non-root user
USER gateway

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
