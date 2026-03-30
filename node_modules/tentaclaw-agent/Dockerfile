FROM node:22-slim AS builder

WORKDIR /app

# Copy shared types
COPY shared/ ./shared/

# Copy agent source
COPY agent/package*.json ./agent/
WORKDIR /app/agent
RUN npm ci

COPY agent/ ./
RUN npm run build

# Production image
FROM node:22-slim

WORKDIR /app/agent

# Install production deps only
COPY agent/package*.json ./
RUN npm ci --omit=dev

# Copy built output
COPY --from=builder /app/agent/dist ./dist
COPY --from=builder /app/shared ../shared

ENV TENTACLAW_MOCK=true
ENV TENTACLAW_GATEWAY_URL=http://gateway:8080

CMD ["node", "dist/index.js", "--mock"]
