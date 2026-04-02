FROM node:22-slim AS builder

WORKDIR /app

# Copy shared types
COPY shared/ ./shared/

# Copy and build gateway
COPY gateway/package*.json ./gateway/
WORKDIR /app/gateway
RUN npm install
COPY gateway/ ./
RUN npm run build

# Copy and build dashboard (outputs to gateway/public)
WORKDIR /app
COPY dashboard/package*.json ./dashboard/
WORKDIR /app/dashboard
RUN npm install
COPY dashboard/ ./
RUN npm run build

# Production image
FROM node:22-slim

WORKDIR /app/gateway

# Install production deps only
COPY gateway/package.json ./
RUN npm install --omit=dev

# Copy built output + public dashboard
COPY --from=builder /app/gateway/dist ./dist
COPY --from=builder /app/gateway/public ./public
COPY --from=builder /app/shared ../shared

# Data directory for SQLite
RUN mkdir -p /app/gateway/data

ENV TENTACLAW_PORT=8080
ENV TENTACLAW_HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "dist/gateway/src/index.js"]
