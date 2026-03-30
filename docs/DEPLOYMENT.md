# TentaCLAW OS Deployment Guide

> From laptop to production cluster. Every path covered.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Manual Installation](#manual-installation)
- [Docker](#docker)
- [Setup Wizard](#setup-wizard)
- [Configuration](#configuration)
- [Multi-Node Setup](#multi-node-setup)
- [Production Deployment](#production-deployment)
- [Reverse Proxy](#reverse-proxy)
- [SSL/TLS](#ssltls)
- [Firewall](#firewall)
- [Systemd Services](#systemd-services)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### One-Line Install

```bash
curl -fsSL tentaclaw.io/install | bash
```

This downloads TentaCLAW OS, installs dependencies, starts the gateway, and opens the dashboard.

### Quickstart Script

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW
./scripts/quickstart.sh
```

Options:

```bash
./scripts/quickstart.sh --mock           # Mock GPUs (no real GPU needed)
./scripts/quickstart.sh --mock --gpus 4  # Mock mode with 4 fake GPUs
./scripts/quickstart.sh --no-browser     # Don't auto-open dashboard
./scripts/quickstart.sh --port 9090      # Custom port
./scripts/quickstart.sh --stop           # Stop all running services
```

The quickstart script handles dependency checking, building, starting the gateway and agent, and opening the dashboard automatically.

---

## Manual Installation

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Node.js** | v20+ | v22+ |
| **npm** | v9+ | v10+ |
| **Git** | Any recent | Latest |
| **OS** | Windows, macOS, Linux | Linux (production) |

You do **not** need a GPU for development. The mock agent simulates realistic hardware.

### Step-by-Step

```bash
# 1. Clone the repository
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW

# 2. Install dependencies for all packages
cd gateway && npm install && cd ..
cd agent && npm install && cd ..
cd cli && npm install && cd ..

# Or use the Makefile:
make node-deps

# 3. Build all packages
make all

# 4. Start the gateway
cd gateway && npm run dev
# Gateway starts on http://localhost:8080

# 5. Start a mock agent (in a separate terminal)
cd agent && npx tsx src/index.ts --mock
# Agent registers with the gateway and starts sending stats

# 6. Open the dashboard
# Visit http://localhost:8080/dashboard
```

### Using the Setup Script

The `setup.sh` script automates the above steps:

```bash
bash setup.sh              # Full setup: install deps + build + test
bash setup.sh --deps-only  # Just install dependencies
bash setup.sh --start      # Skip deps, just start services
```

---

## Docker

A `docker-compose.yml` is included for running the full stack in containers.

### Quick Docker Start

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Or using Make targets:

```bash
make docker-build   # Build images
make docker-up      # Start in background
make docker-down    # Stop everything
make docker-logs    # Follow logs
```

### docker-compose.yml

```yaml
services:
  gateway:
    build:
      context: .
      dockerfile: gateway/Dockerfile
    ports:
      - "8080:8080"
    volumes:
      - gateway-data:/app/gateway/data
    environment:
      - TENTACLAW_PORT=8080
      - TENTACLAW_HOST=0.0.0.0
      - TENTACLAW_LOG_FORMAT=json
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  mock-agent:
    build:
      context: .
      dockerfile: agent/Dockerfile
    depends_on:
      gateway:
        condition: service_healthy
    environment:
      - TENTACLAW_GATEWAY_URL=http://gateway:8080
      - TENTACLAW_MOCK=true
      - TENTACLAW_HOSTNAME=mock-rig-01
    restart: unless-stopped

volumes:
  gateway-data:
```

### Adding More Mock Agents

Uncomment or add additional agent services in `docker-compose.yml`:

```yaml
  mock-agent-2:
    build:
      context: .
      dockerfile: agent/Dockerfile
    depends_on:
      gateway:
        condition: service_healthy
    environment:
      - TENTACLAW_GATEWAY_URL=http://gateway:8080
      - TENTACLAW_MOCK=true
      - TENTACLAW_HOSTNAME=mock-rig-02
```

---

## Setup Wizard

For first-time production setup on a machine with real GPUs, use the interactive setup wizard:

```bash
./scripts/setup-wizard.sh
```

The wizard:

1. Auto-detects your GPUs (NVIDIA, AMD, Intel)
2. Recommends and installs an inference backend (Ollama, vLLM, llama.cpp)
3. Selects a model based on your VRAM capacity
4. Pulls the model and verifies it works
5. Starts the gateway and agent
6. Delivers your first inference

Options:

```bash
./scripts/setup-wizard.sh --auto          # Non-interactive (accept all defaults)
./scripts/setup-wizard.sh --skip-model    # Skip model download
./scripts/setup-wizard.sh --backend ollama  # Pre-select backend
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_PORT` | `8080` | Gateway HTTP port |
| `TENTACLAW_HOST` | `0.0.0.0` | Gateway bind address |
| `TENTACLAW_API_KEY` | *(empty)* | Master API key (enables auth when set) |
| `TENTACLAW_CLUSTER_SECRET` | *(auto-generated)* | Secret for agent-to-gateway auth |
| `TENTACLAW_RATE_LIMIT` | `0` | Global rate limit (req/min, 0 = disabled) |
| `TENTACLAW_POWER_COST` | `0.12` | Electricity cost in $/kWh |
| `TENTACLAW_DB_PATH` | `data/tentaclaw.db` | SQLite database file path |
| `TENTACLAW_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `TENTACLAW_LOG_FORMAT` | *(text)* | Set to `json` for structured JSON logs |

**Agent environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_GATEWAY_URL` | `http://localhost:8080` | Gateway URL to report to |
| `TENTACLAW_MOCK` | `false` | Enable mock mode (no real GPUs needed) |
| `TENTACLAW_HOSTNAME` | *(auto)* | Override hostname for this node |

### Cluster Secret

The cluster secret authenticates agents with the gateway. There are three ways to configure it:

1. **Environment variable** (recommended for production): Set `TENTACLAW_CLUSTER_SECRET` on the gateway and all agents.
2. **Auto-generated**: On first boot, the gateway generates a secret and stores it in the database. Retrieve it via `GET /api/v1/cluster/secret` (admin auth required).
3. **Disabled**: If no secret is configured anywhere, agent auth is disabled (backward compatibility).

To rotate the secret:

```bash
curl -X POST http://localhost:8080/api/v1/cluster/secret/rotate \
  -H "Authorization: Bearer admin-session-token"
```

### Database

TentaCLAW uses SQLite with WAL mode for zero-configuration persistence. The database file is stored at `TENTACLAW_DB_PATH` (default: `gateway/data/tentaclaw.db`).

Key tables: `nodes`, `stats`, `commands`, `flight_sheets`, `alerts`, `benchmarks`, `node_events`, `schedules`, `ssh_keys`, `node_tags`, `model_pulls`, `inference_log`, `api_keys`, `prompt_cache`, `model_aliases`, `users`, `sessions`, `audit_log`, `namespaces`, `namespace_quotas`, `namespace_usage`.

The database is auto-created and auto-migrated on startup. No manual migration needed.

---

## Multi-Node Setup

### Architecture

```
┌─────────────┐     ┌───────────┐     ┌───────────┐
│   Gateway    │◄────│  Agent 1  │     │  Agent 2  │
│  (port 8080) │◄────│ (GPU rig) │     │ (GPU rig) │
│              │◄────│           │     │           │
│  Dashboard   │     │  Ollama   │     │  vLLM     │
│  API Server  │     │  Backend  │     │  Backend  │
└─────────────┘     └───────────┘     └───────────┘
```

### Adding Nodes

1. **Install the agent** on each GPU machine:

```bash
# On the GPU machine
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW/agent
npm install
npm run build
```

2. **Start the agent** pointing to your gateway:

```bash
TENTACLAW_GATEWAY_URL=http://gateway-ip:8080 \
TENTACLAW_CLUSTER_SECRET=your-secret \
npx tsx src/index.ts
```

3. The agent will:
   - Auto-detect GPUs and inference backends
   - Register with the gateway
   - Start pushing stats every 10 seconds
   - Pull and execute commands from the gateway

### Auto-Discovery

If the gateway and agents are on the same LAN, auto-discovery works automatically. The gateway broadcasts its presence via UDP on port 41337 every 30 seconds, and listens for agent discovery broadcasts.

No configuration needed -- agents find the gateway and register themselves.

### Mock Node Swarm

For testing multi-node scenarios without hardware:

```bash
# Spawn 4 mock nodes
make swarm NODES=4

# Or spawn 8 nodes
cd agent && npx tsx src/spawner.ts --nodes 8 --gateway http://localhost:8080
```

---

## Production Deployment

### Recommended Architecture

```
Internet
    │
    ▼
┌──────────┐
│  Caddy / │  ← SSL termination, reverse proxy
│  Nginx   │
└────┬─────┘
     │
     ▼
┌──────────┐
│ Gateway  │  ← Port 8080 (internal only)
│ + SQLite │
└────┬─────┘
     │
     ├──── Agent 1 (GPU Rig 1)
     ├──── Agent 2 (GPU Rig 2)
     └──── Agent N (GPU Rig N)
```

### Security Checklist

- [ ] Set `TENTACLAW_API_KEY` to enable authentication
- [ ] Set `TENTACLAW_CLUSTER_SECRET` for agent-to-gateway auth
- [ ] Set `TENTACLAW_RATE_LIMIT` to prevent abuse
- [ ] Use a reverse proxy with SSL (HTTPS)
- [ ] Firewall: only expose ports 80/443 externally
- [ ] Keep port 8080 internal (behind reverse proxy)
- [ ] Keep port 41337/UDP internal (auto-discovery)

---

## Reverse Proxy

### Caddy (Recommended)

```
tentaclaw.example.com {
    reverse_proxy localhost:8080
}
```

Caddy automatically provisions SSL via Let's Encrypt.

### Nginx

```nginx
server {
    listen 80;
    server_name tentaclaw.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tentaclaw.example.com;

    ssl_certificate /etc/letsencrypt/live/tentaclaw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tentaclaw.example.com/privkey.pem;

    # API and Dashboard
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE (Server-Sent Events)
    location /api/v1/events {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # WebSocket (Remote Shell)
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }
}
```

Key points for reverse proxy configuration:
- **SSE endpoints** (`/api/v1/events`, `/api/v1/daphney/stream`) need buffering disabled and long timeouts.
- **WebSocket endpoints** (`/ws/*`) need HTTP/1.1 upgrade support.

---

## SSL/TLS

### With Caddy

Automatic. Just point your domain and Caddy handles Let's Encrypt.

### With Certbot (Nginx)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tentaclaw.example.com
```

### Self-Signed (Development)

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj '/CN=localhost'
```

---

## Firewall

### Recommended Rules

```bash
# Allow HTTPS from anywhere
sudo ufw allow 443/tcp

# Allow HTTP (redirect to HTTPS)
sudo ufw allow 80/tcp

# Allow agent communication (internal network only)
sudo ufw allow from 10.0.0.0/8 to any port 8080 proto tcp

# Allow auto-discovery (internal network only)
sudo ufw allow from 10.0.0.0/8 to any port 41337 proto udp

# Enable firewall
sudo ufw enable
```

### Ports Reference

| Port | Protocol | Usage | Exposure |
|------|----------|-------|----------|
| 80 | TCP | HTTP redirect | Public |
| 443 | TCP | HTTPS (reverse proxy) | Public |
| 8080 | TCP | Gateway API + Dashboard | Internal |
| 41337 | UDP | Auto-discovery | Internal (LAN) |
| 11434 | TCP | Ollama backend (per-node) | Internal |

---

## Systemd Services

### Gateway Service

Create `/etc/systemd/system/tentaclaw-gateway.service`:

```ini
[Unit]
Description=TentaCLAW Gateway
After=network.target

[Service]
Type=simple
User=tentaclaw
WorkingDirectory=/opt/tentaclaw/gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=TENTACLAW_PORT=8080
Environment=TENTACLAW_HOST=0.0.0.0
Environment=TENTACLAW_API_KEY=your-api-key
Environment=TENTACLAW_CLUSTER_SECRET=your-cluster-secret
Environment=TENTACLAW_LOG_FORMAT=json
Environment=TENTACLAW_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

### Agent Service

Create `/etc/systemd/system/tentaclaw-agent.service`:

```ini
[Unit]
Description=TentaCLAW Agent
After=network.target

[Service]
Type=simple
User=tentaclaw
WorkingDirectory=/opt/tentaclaw/agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=TENTACLAW_GATEWAY_URL=http://gateway-ip:8080
Environment=TENTACLAW_CLUSTER_SECRET=your-cluster-secret

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable tentaclaw-gateway
sudo systemctl start tentaclaw-gateway
sudo systemctl status tentaclaw-gateway

# On agent machines:
sudo systemctl enable tentaclaw-agent
sudo systemctl start tentaclaw-agent
```

### View Logs

```bash
journalctl -u tentaclaw-gateway -f
journalctl -u tentaclaw-agent -f
```

---

## Upgrading

### Standard Upgrade

```bash
cd /opt/tentaclaw
git pull origin master
cd gateway && npm install && npm run build
cd ../agent && npm install && npm run build
sudo systemctl restart tentaclaw-gateway
sudo systemctl restart tentaclaw-agent
```

### Docker Upgrade

```bash
cd /opt/tentaclaw
git pull origin master
docker compose build
docker compose up -d
```

### Zero-Downtime Upgrade

For production clusters with multiple nodes:

1. Upgrade agents one at a time (rolling update).
2. Upgrade the gateway last.
3. The gateway gracefully handles SIGTERM -- it waits 5 seconds for in-flight requests to complete.

### Database Migrations

Database migrations run automatically on gateway startup. No manual migration steps needed. The gateway uses SQLite with WAL mode, so upgrades are safe even while agents are connected.

### Backup Before Upgrade

```bash
# Export cluster config
curl http://localhost:8080/api/v1/config/export > cluster-backup.json

# Copy the database
cp gateway/data/tentaclaw.db gateway/data/tentaclaw.db.backup
```

---

## Troubleshooting

### Common Issues

**Gateway won't start:**
- Check Node.js version: `node --version` (need v20+)
- Check port availability: `lsof -i :8080`
- Check logs: `journalctl -u tentaclaw-gateway -f`

**Agent can't connect to gateway:**
- Verify gateway URL: `curl http://gateway-ip:8080/health`
- Check cluster secret matches
- Check firewall allows port 8080 from agent IP

**No models showing up:**
- Ensure an inference backend (Ollama, vLLM) is running on the agent machine
- Check agent logs for backend detection
- Pull a model: `curl -X POST http://gateway:8080/api/v1/nodes/NODE-ID/models/pull -d '{"model":"llama3.1:8b"}'`

**SSE not working through reverse proxy:**
- Disable proxy buffering for `/api/v1/events`
- Set long read timeout (86400s)

**WebSocket shell not connecting:**
- Ensure nginx/caddy has WebSocket upgrade support for `/ws/*`
- Check authentication: admin or operator role required

See also: [Troubleshooting Guide](TROUBLESHOOTING.md)

---

*Eight arms. One mind. Zero compromises.*
