# Docker Deployment Guide

Run TentaCLAW with Docker — one command, full stack.

## Quick Start

```bash
# Full stack: gateway + mock agent
docker compose up -d

# Open dashboard
open http://localhost:8080/dashboard
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `gateway` | 8080 | TentaCLAW Gateway + Dashboard |
| `mock-agent` | — | Mock agent with fake GPU stats |

## Gateway Only

```bash
docker compose up -d gateway
```

## With Real Agents

On your GPU nodes, run the agent pointing to the gateway:

```bash
# On GPU node
export TENTACLAW_GATEWAY_URL=http://gateway-host:8080
cd agent && npm start
```

Or with Docker:
```bash
docker run -d \
  -e TENTACLAW_GATEWAY_URL=http://gateway-host:8080 \
  -e TENTACLAW_HOSTNAME=$(hostname) \
  --gpus all \
  tentaclaw/agent
```

## Environment Variables

### Gateway
| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_PORT` | 8080 | Gateway port |
| `TENTACLAW_HOST` | 0.0.0.0 | Bind address |
| `TENTACLAW_API_KEY` | — | Optional API key |
| `TENTACLAW_LOG_FORMAT` | text | `json` for structured logs |

### Agent
| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_GATEWAY_URL` | http://localhost:8080 | Gateway URL |
| `TENTACLAW_MOCK` | false | Enable mock mode |
| `TENTACLAW_HOSTNAME` | auto | Node hostname |
| `TENTACLAW_NODE_ID` | auto | Node ID |
| `TENTACLAW_INTERVAL` | 10 | Stats push interval (seconds) |

## Data Persistence

Gateway data (SQLite) is stored in a Docker volume:
```yaml
volumes:
  gateway-data:
```

To back up:
```bash
docker cp tentaclaw-gateway-1:/app/gateway/data/tentaclaw.db ./backup.db
```

## Building Images

```bash
# Build all
docker compose build

# Build specific
docker compose build gateway
docker compose build mock-agent
```

## GPU Passthrough (NVIDIA)

```bash
# Install nvidia-container-toolkit
# Then run agent with --gpus all
docker run --gpus all -e TENTACLAW_GATEWAY_URL=http://host:8080 tentaclaw/agent
```

---

*CLAWtopus says: "Containers? I've got arms for that too."*
