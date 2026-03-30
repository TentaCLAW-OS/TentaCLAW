# TentaCLAW OS Architecture

> How the octopus thinks. A deep dive into the system architecture.

---

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Gateway Internals](#gateway-internals)
- [Agent Internals](#agent-internals)
- [Database Layer](#database-layer)
- [Real-Time System](#real-time-system)
- [Authentication & Security](#authentication--security)
- [Inference Routing](#inference-routing)
- [Module Breakdown](#module-breakdown)
- [Technology Stack](#technology-stack)
- [Directory Structure](#directory-structure)

---

## System Overview

TentaCLAW OS is a distributed system for managing AI inference clusters. It follows a hub-and-spoke architecture where a central **Gateway** coordinates multiple **Agents** running on GPU machines.

```
                         ┌────────────────────────────┐
                         │     TentaCLAW Gateway       │
                         │                              │
                         │  ┌──────────┐ ┌──────────┐  │
                         │  │ REST API │ │Dashboard │  │
           ┌─────────────│  └──────────┘ └──────────┘  │─────────────┐
           │             │  ┌──────────┐ ┌──────────┐  │             │
           │             │  │   SSE    │ │WebSocket │  │             │
           │             │  └──────────┘ └──────────┘  │             │
           │             │  ┌──────────┐               │             │
           │             │  │  SQLite  │               │             │
           │             │  └──────────┘               │             │
           │             └────────────────────────────┘             │
           │                          │                              │
           ▼                          ▼                              ▼
   ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
   │   Agent 1    │          │   Agent 2    │          │   Agent N    │
   │              │          │              │          │              │
   │ ┌──────────┐ │          │ ┌──────────┐ │          │ ┌──────────┐ │
   │ │  Ollama  │ │          │ │   vLLM   │ │          │ │llama.cpp │ │
   │ └──────────┘ │          │ └──────────┘ │          │ └──────────┘ │
   │ ┌──┐┌──┐    │          │ ┌──┐┌──┐┌──┐ │          │ ┌──┐        │
   │ │G1││G2│    │          │ │G1││G2││G3│ │          │ │G1│        │
   │ └──┘└──┘    │          │ └──┘└──┘└──┘ │          │ └──┘        │
   └──────────────┘          └──────────────┘          └──────────────┘
      GPU Rig 1                 GPU Rig 2                 GPU Rig N
```

**Design principles:**
- **Zero-config**: Agents auto-discover the gateway via UDP broadcast
- **Self-healing**: The doctor subsystem auto-fixes common issues
- **Backend-agnostic**: Works with Ollama, vLLM, llama.cpp, or any OpenAI-compatible backend
- **Single binary per role**: Gateway and agent are standalone Node.js processes
- **SQLite-first**: No external database dependencies
- **OpenAI-compatible**: Drop-in replacement for OpenAI and Anthropic APIs

---

## Component Architecture

### Gateway

The gateway is the brain. It runs on a single machine and provides:

- **REST API** (200+ endpoints) for cluster management
- **Web Dashboard** (static HTML/JS served from `public/`)
- **SSE Stream** for real-time updates to the dashboard
- **WebSocket Server** for remote shell access to nodes
- **OpenAI/Anthropic-compatible inference proxy** with load balancing
- **SQLite Database** for persistent state
- **Prometheus Metrics** endpoint (`/metrics`)
- **Auto-Discovery** via UDP broadcast/listen

### Agent

The agent runs on each GPU machine. It:

- Detects GPUs (NVIDIA via `nvidia-smi`, AMD via `rocm-smi`)
- Detects inference backends (Ollama, vLLM, llama.cpp)
- Pushes stats to the gateway every 10 seconds
- Receives and executes commands (deploy model, benchmark, reboot, etc.)
- Runs a watchdog to auto-restart crashed backends
- Provides a shell tunnel for remote terminal access

### CLI (CLAWtopus)

The CLI provides 86+ commands for managing the cluster from the terminal. It communicates with the gateway via the REST API.

### Dashboard

A single-page web application served as static files by the gateway. It uses SSE for real-time updates and the REST API for data.

### SDK

A TypeScript SDK for programmatic access to the gateway API.

### MCP Server

A Model Context Protocol server for AI tool integration.

---

## Data Flow

### Agent Heartbeat (Push/Pull Model)

```
Agent                              Gateway
  │                                   │
  │  POST /api/v1/nodes/:id/stats    │
  │──────────────────────────────────►│
  │  { gpus, cpu, ram, disk,          │  ← Store stats
  │    inference, toks_per_sec }      │  ← Check alert thresholds
  │                                   │  ← Evaluate alert rules
  │  Response: { commands: [...] }    │  ← Broadcast SSE
  │◄──────────────────────────────────│
  │                                   │
  │  Execute commands locally         │
  │  POST /api/v1/commands/:id/done   │
  │──────────────────────────────────►│
  │                                   │
```

This push/pull model means:
1. Agents push stats every 10 seconds
2. The gateway returns any pending commands in the response
3. Agents execute commands and report completion
4. No long-lived connections needed between agent and gateway

### Inference Request Flow

```
Client                Gateway                 Agent
  │                     │                       │
  │  POST /v1/chat/     │                       │
  │  completions        │                       │
  │────────────────────►│                       │
  │                     │  Resolve model alias   │
  │                     │  Find best node        │
  │                     │  Check prompt cache    │
  │                     │                       │
  │                     │  Proxy to backend     │
  │                     │──────────────────────►│
  │                     │                       │  ← Ollama/vLLM
  │                     │  Response             │
  │                     │◄──────────────────────│
  │                     │                       │
  │                     │  Record metrics       │
  │                     │  Cache response       │
  │  Response + meta    │                       │
  │◄────────────────────│                       │
```

**Routing logic:**
1. Resolve model aliases (e.g., `gpt-4` -> `llama3.1:70b`)
2. Try fallback models if primary is unavailable
3. Find the best node: prefers nodes with the model loaded, lowest utilization, and best latency history
4. Check prompt cache (non-streaming only)
5. Proxy the request to the backend (Ollama/vLLM endpoint)
6. Auto-retry on a different node if the first fails
7. Record metrics and cache the response

### Real-Time Updates

```
Dashboard             Gateway              Agent
  │                     │                    │
  │  GET /api/v1/events │                    │
  │────────────────────►│                    │
  │  SSE stream opens   │                    │
  │◄────────────────────│                    │
  │                     │                    │
  │                     │  Stats received    │
  │                     │◄───────────────────│
  │  event: stats_update│                    │
  │◄────────────────────│                    │
  │                     │                    │
  │                     │  Alert triggered   │
  │  event: alert       │                    │
  │◄────────────────────│                    │
```

---

## Gateway Internals

### Request Processing Pipeline

```
Incoming Request
       │
       ▼
┌──────────────┐
│ CORS Headers │  ← Permissive in dev, configurable in production
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Security    │  ← X-Content-Type-Options, X-Frame-Options, HSTS
│  Headers     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Request ID   │  ← X-Request-ID tracing (auto-generated or forwarded)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  API Key     │  ← /api/* and /v1/* routes (if TENTACLAW_API_KEY set)
│  Auth        │  ← Per-key permission + expiry check
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Rate Limit   │  ← Global (per-IP) + per-key rate limiting
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Route       │  ← Hono router dispatches to handler
│  Handler     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Response    │  ← JSON serialization + TentaCLAW metadata
└──────────────┘
```

### Background Tasks

The gateway runs several background tasks:

| Task | Interval | Description |
|------|----------|-------------|
| Stale node detection | 30s | Mark nodes offline if no stats for 60s |
| Stats pruning | 24h | Remove stats older than 7 days |
| Schedule executor | 60s | Run cron-scheduled tasks (deploy, benchmark, reboot) |
| Auto-doctor | 5min | Run auto-optimization and self-healing |
| Rate bucket cleanup | 5min | Purge expired rate limit buckets |

### Pagination

All list endpoints support pagination:

```
?page=1&limit=50
```

The gateway caps `limit` at 500 and defaults to 50. Response includes:

```json
{
  "data": [...],
  "total": 150,
  "page": 1,
  "limit": 50,
  "pages": 3
}
```

---

## Agent Internals

### Agent Lifecycle

```
Start
  │
  ▼
Detect GPUs (nvidia-smi / rocm-smi)
  │
  ▼
Detect Backend (Ollama / vLLM / llama.cpp)
  │
  ▼
Register with Gateway (POST /api/v1/register)
  │
  ▼
┌─────────────────────┐
│  Main Loop (10s)    │◄─────┐
│                     │      │
│  1. Collect stats   │      │
│  2. Push to gateway │      │
│  3. Execute cmds    │      │
│  4. Watchdog check  │      │
│                     │      │
└──────────┬──────────┘      │
           │                 │
           └─────────────────┘
```

### Discovery

Agents can find the gateway via:
1. **Explicit URL**: `TENTACLAW_GATEWAY_URL` environment variable
2. **Auto-discovery**: Listen for gateway UDP broadcasts on port 41338

The gateway broadcasts `TENTACLAW-GATEWAY` packets every 30 seconds with its URL.

---

## Database Layer

### Engine

SQLite 3 via `better-sqlite3` with WAL (Write-Ahead Logging) mode for concurrent reads and non-blocking writes.

### Schema Overview

```
nodes                    stats                    commands
├── id (PK)              ├── id (PK, auto)        ├── id (PK)
├── farm_hash            ├── node_id (FK)         ├── node_id (FK)
├── hostname             ├── timestamp            ├── action
├── ip_address           ├── payload (JSON)       ├── payload (JSON)
├── status               ├── gpu_count            ├── status
├── gpu_count            ├── cpu_usage_pct        ├── created_at
├── registered_at        ├── ram_used_mb          └── completed_at
└── last_seen_at         └── toks_per_sec

flight_sheets            alerts                   alert_rules
├── id (PK)              ├── id (PK)              ├── id (PK)
├── name                 ├── node_id              ├── name
├── description          ├── severity             ├── metric
├── targets (JSON)       ├── message              ├── operator
└── created_at           ├── acknowledged         ├── threshold
                         └── created_at           ├── severity
                                                  └── enabled

schedules                benchmarks               node_events
├── id (PK)              ├── id (PK, auto)        ├── id (PK, auto)
├── name                 ├── node_id (FK)         ├── node_id
├── type                 ├── model                ├── event_type
├── cron                 ├── tokens_per_sec       ├── message
├── config (JSON)        └── created_at           └── created_at
└── enabled

api_keys                 users                    sessions
├── id (PK)              ├── id (PK)              ├── id (PK)
├── key_hash             ├── username (UNIQUE)    ├── user_id (FK)
├── name                 ├── password_hash        ├── token
├── permissions          ├── role                 ├── expires_at
├── rate_limit_rpm       ├── email                └── created_at
└── expires_at           └── created_at

inference_log            prompt_cache             model_aliases
├── id (PK, auto)        ├── id (PK)              ├── alias (PK)
├── node_id              ├── cache_key            ├── target
├── model                ├── model                └── fallbacks (JSON)
├── latency_ms           ├── response
├── success              ├── tokens_saved
└── created_at           └── expires_at

namespaces               namespace_quotas         namespace_usage
├── id (PK)              ├── namespace_id (FK)    ├── namespace_id (FK)
├── name (UNIQUE)        ├── max_gpus             ├── gpu_hours
├── display_name         ├── max_vram_mb          ├── tokens_generated
├── description          ├── max_models           ├── requests_served
└── created_at           └── max_requests_per_min └── period

audit_log                watchdog_events          notification_channels
├── id (PK, auto)        ├── id (PK, auto)        ├── id (PK)
├── event_type           ├── node_id              ├── type
├── username             ├── level                ├── name
├── ip_address           ├── action               ├── config (JSON)
├── details              ├── detail               └── created_at
└── created_at           └── created_at
```

### Indexes

- `idx_stats_node_time` on `stats(node_id, timestamp DESC)` -- fast history queries
- `idx_commands_node_status` on `commands(node_id, status)` -- fast pending command lookup

### Maintenance

- **Auto-prune**: Stats older than 7 days are deleted daily
- **Doctor mode**: Cleans orphaned stats/commands, marks stale pulls as failed
- **WAL checkpoint**: SQLite handles this automatically
- **Integrity checks**: Doctor mode runs `PRAGMA integrity_check`

---

## Real-Time System

### SSE (Server-Sent Events)

The gateway maintains an array of SSE client connections. When an event occurs (stats update, alert, command, etc.), it broadcasts to all connected clients.

```typescript
// Client connects
GET /api/v1/events → ReadableStream

// Server broadcasts
broadcastSSE('stats_update', { node_id, hostname, gpu_count, toks_per_sec })
```

Event types and their triggers:

| Event | Trigger |
|-------|---------|
| `connected` | Client connects to SSE stream |
| `node_online` | New node registers |
| `node_offline` | Node goes stale (60s no stats) |
| `stats_update` | Agent pushes stats |
| `command_sent` | Command queued for a node |
| `command_completed` | Command marked complete |
| `alert` | Alert threshold crossed |
| `flight_sheet_applied` | Flight sheet deployed |
| `benchmark_complete` | Benchmark result stored |
| `smart_deploy` | Smart deploy executed |
| `maintenance` | Node enters/exits maintenance |
| `model_pull_started` | Model download begins |
| `model_pull_progress` | Download progress update |
| `shell_available` | Agent shell tunnel connected |
| `watchdog_event` | Watchdog action recorded |
| `doctor_ran` | Doctor diagnostics completed |

### WebSocket (Remote Shell)

Two WebSocket paths:

1. **Agent tunnel** (`/ws/agent-shell/:nodeId`): Agent connects and holds open. Authenticated via cluster secret.
2. **Dashboard shell** (`/ws/shell/:nodeId`): Dashboard connects to interact with a node. Authenticated via session token (admin/operator role required).

The gateway pipes data bidirectionally between dashboard and agent WebSocket connections.

### Webhooks

External webhook URLs receive event notifications via HTTP POST. Supports HMAC signing via `X-TentaCLAW-Signature` header.

---

## Authentication & Security

### Three Auth Layers

1. **API Key Auth** (external clients): Bearer token in `Authorization` header. Supports scoped permissions (`read`, `write`, `admin`), per-key rate limits, and expiry.

2. **Session Auth** (dashboard users): Username/password login returns a session token. Supports roles: `admin`, `operator`, `viewer`, `user`.

3. **Cluster Secret Auth** (agents): `X-Cluster-Secret` header on agent-to-gateway communication (register, stats push).

### Security Headers

Every response includes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Brute Force Protection

Failed login attempts are tracked per IP. After repeated failures, the IP is blocked for 15 minutes.

### Audit Log

All security-relevant actions are recorded in the audit log: login, logout, API key creation/revocation, cluster secret rotation, auth failures.

---

## Inference Routing

### Load Balancing Algorithm

```
findBestNode(model):
  1. Filter nodes: online, not in maintenance, has model loaded
  2. Score each node:
     - Lower GPU utilization = better
     - Lower active requests = better
     - Better latency history = better
     - More free VRAM = better
  3. Return highest-scoring node
```

### Model Alias Resolution

```
Client requests "gpt-4"
  → resolveModelAlias("gpt-4")
  → { target: "llama3.1:70b", fallbacks: ["llama3.1:8b"] }
  → Try "llama3.1:70b" first
  → If unavailable, try "llama3.1:8b"
```

### Prompt Caching

Non-streaming responses are cached by SHA-256 hash of `{model, messages}`. Cache is checked before proxying. Bypass with `Cache-Control: no-cache` header.

### Circuit Breaking

If a node fails, the request auto-retries on a different node. Failed nodes get lower scores in the routing algorithm based on recent error history.

---

## Module Breakdown

The gateway source (`gateway/src/`) is organized into focused modules:

| Module | File | Purpose |
|--------|------|---------|
| **Core** | `index.ts` | Main server, all route handlers, SSE, WebSocket |
| **Database** | `db.ts` | SQLite schema, migrations, all data access functions |
| **Namespaces** | `namespaces.ts` | Multi-tenancy, quotas, usage tracking, chargeback |
| **Comedy** | `comedy.ts` | Wait-state microcopy generator |
| **Profiler** | `profiler.ts` | Performance profiling and load test config |
| **Analytics** | `analytics.ts` | Inference analytics and reporting |
| **Security** | `security.ts` | Advanced security features |
| **SSO** | `sso.ts` | Single sign-on integration |
| **Billing** | `billing.ts` | Stripe billing integration |
| **Licensing** | `licensing.ts` | License key validation |
| **Cost Intelligence** | `cost-intelligence.ts` | Cost optimization recommendations |
| **Cloud Burst** | `cloud-burst.ts` | Overflow to cloud providers |
| **Cloud** | `cloud.ts` | Cloud provider integration |
| **Federation** | `federation.ts` | Multi-cluster federation |
| **Declarative** | `declarative.ts` | Declarative cluster configuration |
| **Distributed** | `distributed.ts` | Distributed inference (tensor parallelism) |
| **HA** | `ha.ts` | High availability features |
| **Scheduler** | `scheduler.ts` | Advanced job scheduling |
| **Autoscaler** | `autoscaler.ts` | Auto-scaling based on demand |
| **Benchmark Engine** | `benchmark-engine.ts` | Advanced benchmarking |
| **Compression** | `compression.ts` | Model compression utilities |
| **Fine-tune** | `finetune.ts` | Fine-tuning workflow management |
| **HuggingFace** | `huggingface.ts` | HuggingFace Hub integration |
| **Models** | `models.ts` | Model registry and management |
| **Observability** | `observability.ts` | OpenTelemetry integration |
| **RAG** | `rag.ts` | Retrieval-augmented generation |
| **Real-time** | `realtime.ts` | Advanced real-time features |
| **Agents** | `agents.ts` | Agent management logic |
| **DB (PostgreSQL)** | `db-pg.ts` | PostgreSQL adapter (alternative to SQLite) |

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 20+ | Server runtime |
| **Language** | TypeScript (strict mode) | Type safety |
| **HTTP Framework** | Hono | Fast, lightweight HTTP framework |
| **Database** | SQLite (better-sqlite3) | Embedded database with WAL mode |
| **WebSocket** | ws | Remote shell WebSocket server |
| **Testing** | Vitest | Unit and integration tests |
| **Build** | TypeScript compiler (tsc) | Compilation |
| **Process** | Node.js native | Single-process, no PM2/cluster needed |
| **Discovery** | UDP broadcast (dgram) | Zero-config agent discovery |
| **Dashboard** | HTML/CSS/JS (static) | No build step, served by gateway |
| **Metrics** | Prometheus text format | Standard observability |

### Why These Choices?

- **Hono** over Express: 3x faster, smaller, modern TypeScript-first design
- **SQLite** over PostgreSQL: Zero configuration, single file, perfect for self-hosted
- **better-sqlite3** over knex/prisma: Synchronous API = simpler code, WAL mode for concurrency
- **Vitest** over Jest: Faster, native TypeScript support, ESM-first
- **No ORM**: Direct SQL for maximum performance and transparency

---

## Directory Structure

```
tentaclaw-os/
├── gateway/              -- Central coordinator (Hono + SQLite)
│   ├── src/
│   │   ├── index.ts      -- Main server (6,100+ lines, all routes)
│   │   ├── db.ts          -- Database layer
│   │   ├── namespaces.ts  -- Multi-tenancy
│   │   ├── comedy.ts      -- Comedy engine
│   │   ├── profiler.ts    -- Performance profiler
│   │   └── ...            -- 29 total modules
│   ├── public/            -- Dashboard static files
│   ├── data/              -- SQLite database (auto-created)
│   └── tests/             -- Gateway tests
│
├── agent/                -- Node daemon (runs on each GPU machine)
│   ├── src/
│   │   ├── index.ts       -- Agent main loop
│   │   └── spawner.ts     -- Mock node spawner
│   └── tests/
│
├── cli/                  -- CLAWtopus CLI (86+ commands)
│   └── src/
│
├── shared/               -- Shared TypeScript types and utilities
│   └── types.ts
│
├── sdk/                  -- TypeScript SDK
├── mcp/                  -- Model Context Protocol server
├── clawhub/              -- Package marketplace (185 packages)
├── builder/              -- ISO/PXE build system
├── observability/        -- Prometheus + Grafana stack
├── deploy/               -- Helm, Terraform, Ansible, Kubernetes
├── integrations/         -- Dify, n8n, Home Assistant, etc.
├── website/              -- tentaclaw.io landing page
├── scripts/              -- Installer and utility scripts
│   ├── quickstart.sh
│   └── setup-wizard.sh
│
├── docker-compose.yml    -- Docker Compose stack
├── Makefile              -- Build targets
├── setup.sh              -- Dev environment setup
└── docs/                 -- Documentation
    ├── API.md
    ├── ARCHITECTURE.md    -- (this file)
    ├── DEPLOYMENT.md
    └── ...
```

---

## Related Documentation

- [API Reference](API.md) -- Full endpoint documentation
- [Deployment Guide](DEPLOYMENT.md) -- Installation and production setup
- [Getting Started](GETTING-STARTED.md) -- Quick start tutorial
- [Troubleshooting](TROUBLESHOOTING.md) -- Common issues and fixes
- [CLI Reference](CLI.md) -- CLAWtopus command reference

---

*Eight arms. One brain. Now you know how it thinks.*
