# TentaCLAW Gateway API Reference

> **Base URL:** `http://localhost:8080`
>
> **Version:** 0.2.0 | **Protocol:** REST + SSE + WebSocket | **Format:** JSON

---

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Health & System](#health--system)
- [Nodes](#nodes)
- [Stats](#stats)
- [Commands](#commands)
- [Models](#models)
- [Inference (OpenAI-Compatible)](#inference-openai-compatible)
- [Inference (Anthropic-Compatible)](#inference-anthropic-compatible)
- [Multi-Modal](#multi-modal)
- [Alerts](#alerts)
- [Alert Rules](#alert-rules)
- [Flight Sheets](#flight-sheets)
- [Benchmarks](#benchmarks)
- [Schedules](#schedules)
- [Tags](#tags)
- [SSH Keys](#ssh-keys)
- [Model Pull Progress](#model-pull-progress)
- [Model Search](#model-search)
- [Model Aliases](#model-aliases)
- [API Keys](#api-keys)
- [Auth & Users](#auth--users)
- [Namespaces & Multi-Tenancy](#namespaces--multi-tenancy)
- [Power & Cost](#power--cost)
- [Overclock Profiles](#overclock-profiles)
- [Watchdog](#watchdog)
- [Notifications](#notifications)
- [Doctor & Diagnostics](#doctor--diagnostics)
- [Bulk Operations](#bulk-operations)
- [Node Groups & Placement](#node-groups--placement)
- [Webhooks](#webhooks)
- [Monitoring & Observability](#monitoring--observability)
- [Topology & Visualization](#topology--visualization)
- [Cluster Operations](#cluster-operations)
- [Playground](#playground)
- [Profiler](#profiler)
- [WebSocket & Real-Time](#websocket--real-time)
- [Additional Endpoints](#additional-endpoints)

---

## Authentication

Authentication is **optional by default**. To enable it, set the `TENTACLAW_API_KEY` environment variable on the gateway.

When enabled, all `/api/*` and `/v1/*` routes require a Bearer token:

```bash
curl http://localhost:8080/api/v1/nodes \
  -H "Authorization: Bearer your-api-key-here"
```

You can also pass the key as a query parameter on `/api/*` routes: `?api_key=your-key`.

API keys support scoped permissions (`read`, `write`, `admin`) and per-key rate limits. Keys are validated for expiration and permission level based on the HTTP method (GET = `read`, POST/PUT/DELETE = `write`).

Agent-to-gateway communication uses a separate **cluster secret** via the `X-Cluster-Secret` header. Set `TENTACLAW_CLUSTER_SECRET` or let the gateway auto-generate one on first boot.

---

## Rate Limiting

Set `TENTACLAW_RATE_LIMIT` to a number (requests per minute) to enable global rate limiting on `/v1/*` inference endpoints. Per-key rate limits are also supported via the `rate_limit_rpm` field on API keys.

Rate limit headers are returned on every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests per minute |
| `X-RateLimit-Remaining` | Requests remaining in window |
| `X-RateLimit-Reset` | Window reset time (Unix timestamp) |
| `Retry-After` | Seconds until retry (on 429 responses) |

---

## Health & System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Basic health check (always public) |
| `GET` | `/` | No | Gateway info and endpoint directory |
| `GET` | `/api/v1/version` | Yes | Gateway version, features, and API compatibility list |
| `GET` | `/api/v1/health/score` | Yes | Cluster health score (0-100) with letter grade (A-F) |
| `GET` | `/api/v1/health/detailed` | Yes | Deep health analysis: database, nodes, memory, disk, uptime |
| `GET` | `/api/v1/healthz` | Yes | Kubernetes liveness probe |
| `GET` | `/api/v1/readyz` | Yes | Kubernetes readiness probe (requires online nodes + models) |
| `GET` | `/api/v1/capabilities` | Yes | List all features, backends, models, and API compatibility |
| `GET` | `/api/v1/about` | Yes | Product info, version, website |
| `GET` | `/api/v1/config` | Yes | Gateway configuration (features, connections, environment) |
| `GET` | `/api/v1/discover` | Yes | Service discovery endpoint for agents |
| `GET` | `/api/v1/gateway/uptime` | Yes | Gateway process uptime, memory, Node.js version |
| `GET` | `/api/v1/openapi.json` | Yes | Auto-generated OpenAPI 3.0 specification |
| `GET` | `/api/v1/badge/:type` | Yes | Shields.io-compatible status badges (health, nodes, gpus, models) |

### Example: Health Check

```bash
curl http://localhost:8080/health
```

```json
{
  "status": "ok",
  "service": "tentaclaw-gateway",
  "version": "0.1.0",
  "uptime": 3621.4,
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

### Example: Detailed Health

```bash
curl http://localhost:8080/api/v1/health/detailed
```

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok", "latency_ms": 0.42 },
    "nodes": { "total": 4, "online": 4, "status": "ok" },
    "memory": { "status": "ok", "rss_mb": 85.3, "heap_mb": 42.1 },
    "uptime_seconds": 86400
  },
  "version": "0.2.0"
}
```

---

## Nodes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/register` | Cluster Secret | Register a new node |
| `GET` | `/api/v1/nodes` | Yes | List all nodes (supports `?farm_hash=` filter, `?page=&limit=`) |
| `GET` | `/api/v1/nodes/:nodeId` | Yes | Get single node details |
| `DELETE` | `/api/v1/nodes/:nodeId` | Yes | Remove a node from the cluster |
| `POST` | `/api/v1/nodes/:id/maintenance` | Yes | Toggle maintenance mode |
| `GET` | `/api/v1/nodes/:nodeId/events` | Yes | Node event history (`?limit=50`) |
| `GET` | `/api/v1/nodes/:nodeId/sparklines` | Yes | Compact history for sparkline charts (`?points=60`) |
| `GET` | `/api/v1/nodes/:id/lifecycle` | Yes | Full node lifecycle: health, uptime, events, watchdog |
| `GET` | `/api/v1/nodes/:id/health-score` | Yes | Per-node health score |
| `GET` | `/api/v1/nodes/:id/uptime` | Yes | Per-node uptime stats (`?hours=24`) |
| `GET` | `/api/v1/nodes/:nodeId/logs` | Yes | Node log buffer (`?limit=100`) |
| `POST` | `/api/v1/nodes/:nodeId/logs` | Yes | Push log lines from agent |
| `GET` | `/api/v1/nodes/:nodeId/models` | Yes | List models loaded on a specific node |
| `POST` | `/api/v1/nodes/:nodeId/models/pull` | Yes | Pull (install) a model to a specific node |
| `DELETE` | `/api/v1/nodes/:nodeId/models/:model` | Yes | Remove a model from a specific node |
| `GET` | `/api/v1/nodes/hot` | Yes | Nodes with hottest GPUs (sorted by max temp) |
| `GET` | `/api/v1/nodes/idle` | Yes | Idle nodes (GPU utilization < 5-10%) |

### Example: Register a Node

```bash
curl -X POST http://localhost:8080/api/v1/register \
  -H "Content-Type: application/json" \
  -H "X-Cluster-Secret: your-cluster-secret" \
  -d '{
    "node_id": "TENTACLAW-FARM7K3P-node1",
    "farm_hash": "FARM7K3P",
    "hostname": "gpu-rig-01",
    "gpu_count": 2
  }'
```

### Example: Toggle Maintenance Mode

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/nodes/:nodeId/stats` | Cluster Secret | Push stats from agent; returns pending commands |
| `GET` | `/api/v1/nodes/:nodeId/stats/history` | Yes | Historical stats (`?limit=100`) |
| `GET` | `/api/v1/summary` | Yes | Cluster-wide summary (nodes, GPUs, VRAM, tok/s, models) |
| `GET` | `/api/v1/inference/stats` | Yes | Inference request statistics |
| `GET` | `/api/v1/inference/analytics` | Yes | Detailed inference analytics (`?hours=24`) |
| `GET` | `/api/v1/inference/backends` | Yes | List inference backends per node |

### Example: Push Stats (Agent Heartbeat)

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/stats \
  -H "Content-Type: application/json" \
  -H "X-Cluster-Secret: your-secret" \
  -d '{"farm_hash":"FARM7K3P","node_id":"NODE-001","gpu_count":2,"gpus":[...],"cpu":{"usage_pct":15},"ram":{"total_mb":32768,"used_mb":8192},"disk":{"total_gb":500,"used_gb":120},"inference":{"loaded_models":["llama3.1:8b"],"in_flight_requests":0}}'
```

Response includes pending commands:

```json
{
  "commands": [
    {"id": "cmd-123", "action": "install_model", "model": "llama3.1:8b"}
  ]
}
```

---

## Commands

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/nodes/:nodeId/commands` | Yes | Queue a command for a node |
| `POST` | `/api/v1/commands/:commandId/complete` | Yes | Mark a command as completed (called by agent) |

**Available actions:** `reload_model`, `install_model`, `remove_model`, `overclock`, `benchmark`, `restart_agent`, `reboot`

### Example: Queue a Command

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/commands \
  -H "Content-Type: application/json" \
  -d '{"action": "install_model", "model": "llama3.1:8b"}'
```

---

## Models

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/models` | Yes | List all cluster models (TentaCLAW format) |
| `GET` | `/api/v1/models/distribution` | Yes | Which models are on which nodes |
| `GET` | `/api/v1/models/check-fit` | Yes | Check if a model fits (`?model=&node=`) |
| `GET` | `/api/v1/models/coverage` | Yes | Model coverage report (redundancy, VRAM estimates) |
| `GET` | `/api/v1/models/:model/stats` | Yes | Per-model request stats (last hour, last 24h) |
| `POST` | `/api/v1/deploy` | Yes | Deploy a model to online nodes (optional `farm_hash`, `node_ids` filter) |
| `POST` | `/api/v1/deploy/all` | Yes | VRAM-aware deploy to all eligible nodes |
| `POST` | `/api/v1/models/smart-deploy` | Yes | AI-assisted optimal node selection |

### Example: Smart Deploy

```bash
curl -X POST http://localhost:8080/api/v1/models/smart-deploy \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.1:8b", "count": 2}'
```

### Example: Check Model Fit

```bash
curl "http://localhost:8080/api/v1/models/check-fit?model=llama3.1:70b"
```

```json
{
  "model": "llama3.1:70b",
  "estimated_vram_mb": 40960,
  "best_node": {"node_id": "NODE-001", "hostname": "gpu-rig-01"},
  "fits_anywhere": true
}
```

---

## Inference (OpenAI-Compatible)

These endpoints are fully compatible with OpenAI client libraries. Point any OpenAI SDK at your gateway.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/chat/completions` | Yes | Chat completions (streaming, function calling, JSON mode) |
| `POST` | `/v1/completions` | Yes | Legacy completions |
| `POST` | `/v1/embeddings` | Yes | Generate embeddings (batch support) |
| `GET` | `/v1/models` | Yes | OpenAI-compatible model list with TentaCLAW metadata |

### Example: Chat Completion

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**Supported OpenAI parameters:** `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `frequency_penalty`, `presence_penalty`, `n`, `tools`, `tool_choice`, `functions` (legacy), `function_call` (legacy), `response_format` (JSON mode), `logprobs`, `top_logprobs`.

**Response includes TentaCLAW metadata:**

```json
{
  "choices": [...],
  "_tentaclaw": {
    "routed_to": "NODE-001",
    "hostname": "gpu-rig-01",
    "latency_ms": 142,
    "backend": "ollama",
    "cached": false,
    "resolved_model": "llama3.1:8b"
  }
}
```

**Streaming** returns `text/event-stream` with `X-TentaCLAW-Node` and `X-TentaCLAW-Latency` headers.

**Features:**
- Model alias resolution (e.g., `gpt-4` resolves to `llama3.1:70b`)
- Fallback chains (if primary model unavailable, try fallbacks)
- Prompt caching (non-streaming, bypass with `Cache-Control: no-cache`)
- Auto-retry on a different node if the first fails
- Load shedding (429 when queue is full)

### Example: Embeddings

```bash
curl http://localhost:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": ["Hello world", "Goodbye world"]}'
```

---

## Inference (Anthropic-Compatible)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/messages` | Yes | Anthropic Messages API (streaming + non-streaming, tool use) |

Full compatibility with Anthropic SDKs. The gateway translates between Anthropic and OpenAI formats automatically.

### Example: Anthropic Messages

```bash
curl http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Supports: `system`, `temperature`, `top_p`, `top_k`, `stop_sequences`, `tools`, `tool_choice`, `stream`.

---

## Multi-Modal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/audio/transcriptions` | Yes | Whisper-compatible audio transcription |
| `POST` | `/v1/audio/speech` | Yes | Text-to-speech (TTS) generation |
| `POST` | `/v1/audio/translate` | Yes | Audio translation to English via Whisper |
| `GET` | `/v1/audio/models` | Yes | List available audio models |
| `POST` | `/v1/images/generations` | Yes | OpenAI-compatible image generation |

---

## Alerts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/alerts` | Yes | List recent alerts (`?limit=50`) |
| `POST` | `/api/v1/alerts/:id/acknowledge` | Yes | Acknowledge an alert |

Automatic alerting fires for GPU temperature, VRAM pressure, disk full, CPU saturation, and node offline.

### Example

```bash
curl http://localhost:8080/api/v1/alerts
curl -X POST http://localhost:8080/api/v1/alerts/alert-123/acknowledge
```

---

## Alert Rules

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/alert-rules` | Yes | List all alert rules |
| `POST` | `/api/v1/alert-rules` | Yes | Create a custom alert rule |
| `PUT` | `/api/v1/alert-rules/:id` | Yes | Update an alert rule |
| `DELETE` | `/api/v1/alert-rules/:id` | Yes | Delete an alert rule |
| `POST` | `/api/v1/alert-rules/:id/toggle` | Yes | Enable/disable an alert rule |

**Valid metrics:** `gpu_temp`, `gpu_util`, `vram_pct`, `cpu_usage`, `ram_pct`, `disk_pct`, `inference_latency`

**Valid operators:** `gt`, `lt`, `gte`, `lte`, `eq`

### Example: Create Alert Rule

```bash
curl -X POST http://localhost:8080/api/v1/alert-rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GPU Overheating",
    "metric": "gpu_temp",
    "operator": "gt",
    "threshold": 85,
    "severity": "critical",
    "cooldown_secs": 300
  }'
```

---

## Flight Sheets

Declarative model deployment plans.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/flight-sheets` | Yes | List all flight sheets |
| `POST` | `/api/v1/flight-sheets` | Yes | Create a flight sheet |
| `GET` | `/api/v1/flight-sheets/:id` | Yes | Get a specific flight sheet |
| `DELETE` | `/api/v1/flight-sheets/:id` | Yes | Delete a flight sheet |
| `POST` | `/api/v1/flight-sheets/:id/apply` | Yes | Apply a flight sheet (deploy all targets) |

### Example: Create & Apply

```bash
curl -X POST http://localhost:8080/api/v1/flight-sheets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-stack",
    "description": "Standard inference models",
    "targets": [{"node_id": "*", "model": "llama3.1:8b"}]
  }'

curl -X POST http://localhost:8080/api/v1/flight-sheets/fs-123/apply
```

---

## Benchmarks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/benchmarks` | Yes | List all benchmarks (`?limit=50`) |
| `GET` | `/api/v1/nodes/:nodeId/benchmarks` | Yes | Benchmarks for a specific node |
| `POST` | `/api/v1/nodes/:nodeId/benchmark` | Yes | Submit a benchmark result |
| `POST` | `/api/v1/nodes/:nodeId/benchmark/run` | Yes | Trigger a benchmark run on a node |

---

## Schedules

Cron-based automation for model deployment, benchmarks, and reboots.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/schedules` | Yes | List all schedules |
| `POST` | `/api/v1/schedules` | Yes | Create a schedule |
| `GET` | `/api/v1/schedules/:id` | Yes | Get a specific schedule |
| `DELETE` | `/api/v1/schedules/:id` | Yes | Delete a schedule |
| `POST` | `/api/v1/schedules/:id/toggle` | Yes | Enable/disable a schedule |

**Schedule types:** `deploy`, `benchmark`, `reboot`

### Example

```bash
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nightly-benchmark",
    "type": "benchmark",
    "cron": "0 2 * * *",
    "config": {"model": "llama3.1:8b"}
  }'
```

---

## Tags

Organize nodes with arbitrary string tags.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/tags` | Yes | List all tags with counts |
| `GET` | `/api/v1/tags/:tag/nodes` | Yes | Get nodes with a specific tag |
| `GET` | `/api/v1/nodes/:id/tags` | Yes | Get tags for a node |
| `POST` | `/api/v1/nodes/:id/tags` | Yes | Add tags to a node (`{"tags": ["production"]}`) |
| `DELETE` | `/api/v1/nodes/:id/tags/:tag` | Yes | Remove a tag from a node |

---

## SSH Keys

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/nodes/:id/ssh-keys` | Yes | List SSH keys for a node |
| `POST` | `/api/v1/nodes/:id/ssh-keys` | Yes | Add an SSH key to a node |
| `DELETE` | `/api/v1/ssh-keys/:keyId` | Yes | Delete an SSH key |

### Example

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/ssh-keys \
  -H "Content-Type: application/json" \
  -d '{"label": "my-laptop", "public_key": "ssh-ed25519 AAAA..."}'
```

---

## Model Pull Progress

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/pulls` | Yes | All active model downloads across cluster |
| `GET` | `/api/v1/nodes/:id/pulls` | Yes | Active downloads for a specific node |
| `POST` | `/api/v1/nodes/:id/pulls` | Yes | Start a model pull on a node |
| `PUT` | `/api/v1/nodes/:id/pulls/:model` | Yes | Update pull progress (from agent) |

---

## Model Search

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/model-search` | Yes | Search Ollama model catalog (`?q=llama&tag=code&limit=10`) |

Returns VRAM requirements and whether each model fits the cluster.

```bash
curl "http://localhost:8080/api/v1/model-search?q=llama"
```

---

## Model Aliases

Map friendly names to real model names (e.g., `gpt-4` -> `llama3.1:70b`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/aliases` | Yes | List all model aliases |
| `POST` | `/api/v1/aliases` | Yes | Create/update an alias |
| `DELETE` | `/api/v1/aliases/:alias` | Yes | Delete an alias |

### Example

```bash
curl -X POST http://localhost:8080/api/v1/aliases \
  -H "Content-Type: application/json" \
  -d '{"alias": "gpt-4", "target": "llama3.1:70b", "fallbacks": ["llama3.1:8b"]}'
```

---

## API Keys

Scoped API keys with per-key rate limits, permissions, and expiry.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/apikeys` | Yes | List all API keys (secrets masked) |
| `POST` | `/api/v1/apikeys` | Yes | Create a new API key |
| `DELETE` | `/api/v1/apikeys/:id` | Yes | Revoke an API key |

**Valid permissions:** `read`, `write`, `admin`

### Example: Create API Key

```bash
curl -X POST http://localhost:8080/api/v1/apikeys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ci-pipeline",
    "permissions": ["read", "write"],
    "rate_limit_rpm": 100,
    "expires_at": "2027-01-01T00:00:00Z"
  }'
```

Response (key shown only once):

```json
{
  "id": "key-abc123",
  "key": "tc_live_abc123...",
  "prefix": "tc_live_ab",
  "name": "ci-pipeline",
  "permissions": ["read", "write"],
  "message": "Save this key -- it will not be shown again."
}
```

---

## Auth & Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/login` | No | Authenticate and get session token |
| `POST` | `/api/v1/auth/logout` | Session | Invalidate current session |
| `GET` | `/api/v1/auth/me` | Session | Get current user from session |
| `GET` | `/api/v1/users` | Admin | List all users |
| `POST` | `/api/v1/users` | Admin | Create a user |
| `DELETE` | `/api/v1/users/:id` | Admin | Delete a user |
| `PUT` | `/api/v1/users/:id/role` | Admin | Change user role |
| `GET` | `/api/v1/audit` | Admin | Audit log (`?limit=100&event_type=`) |
| `GET` | `/api/v1/cluster/secret` | Admin | View cluster secret status |
| `POST` | `/api/v1/cluster/secret/rotate` | Admin | Rotate cluster secret |

**Valid roles:** `admin`, `operator`, `viewer`, `user`

Default admin credentials are created on first boot. Brute force protection blocks IPs after repeated failures.

### Example: Login

```bash
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

```json
{
  "token": "session-token-here",
  "expires_at": "2026-04-30T00:00:00Z",
  "user": {"id": "usr-001", "username": "admin", "role": "admin"}
}
```

---

## Namespaces & Multi-Tenancy

Isolate resources, models, and usage by namespace for multi-team deployments.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/namespaces` | Yes | List all namespaces |
| `POST` | `/api/v1/namespaces` | Yes | Create a namespace |
| `GET` | `/api/v1/namespaces/:name` | Yes | Get namespace details |
| `PUT` | `/api/v1/namespaces/:name` | Yes | Update a namespace |
| `DELETE` | `/api/v1/namespaces/:name` | Yes | Delete a namespace |
| `GET` | `/api/v1/namespaces/:name/quota` | Yes | Get quota usage |
| `PUT` | `/api/v1/namespaces/:name/quota` | Yes | Set quota limits |
| `POST` | `/api/v1/namespaces/:name/quota/check` | Yes | Check if an action would exceed quota |
| `GET` | `/api/v1/namespaces/:name/models` | Yes | Models in a namespace |
| `GET` | `/api/v1/namespaces/:name/nodes` | Yes | Nodes assigned to a namespace |
| `POST` | `/api/v1/namespaces/:name/nodes` | Yes | Assign a node to a namespace |
| `GET` | `/api/v1/api-keys/:keyId/namespace` | Yes | Get namespace for an API key |
| `PUT` | `/api/v1/api-keys/:keyId/namespace` | Yes | Assign an API key to a namespace |
| `POST` | `/api/v1/namespaces/:name/usage` | Yes | Record usage (for chargeback) |
| `GET` | `/api/v1/namespaces/:name/usage` | Yes | Get usage report (`?period=`) |
| `GET` | `/api/v1/namespaces/:name/usage/csv` | Yes | Export usage as CSV |
| `GET` | `/api/v1/usage/all` | Yes | All namespace usage reports |

### Example: Create Namespace with Quota

```bash
curl -X POST http://localhost:8080/api/v1/namespaces \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ml-team",
    "display_name": "ML Team",
    "description": "Production inference workloads",
    "quota": {"maxGpus": 8, "maxVramMb": 196608, "maxModels": 10}
  }'
```

---

## Power & Cost

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/power` | Yes | Cluster power draw, cost estimates, per-node breakdown |

Set `TENTACLAW_POWER_COST` (default: `0.12` $/kWh) for accurate cost estimates.

```json
{
  "total_watts": 2400,
  "gpu_watts": 1800,
  "daily_cost_usd": 6.91,
  "monthly_cost_usd": 207.36,
  "tokens_per_dollar": 1250000,
  "per_node": [...]
}
```

---

## Overclock Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/nodes/:id/overclock` | Yes | Get current overclock profiles |
| `POST` | `/api/v1/nodes/:id/overclock` | Yes | Apply overclock settings to a GPU |

### Example

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/overclock \
  -H "Content-Type: application/json" \
  -d '{"gpu_index": 0, "core_offset_mhz": 100, "power_limit_w": 300}'
```

---

## Watchdog

Self-healing event log. The watchdog monitors and auto-restarts crashed services.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/watchdog` | Yes | All watchdog events (`?limit=100`) |
| `GET` | `/api/v1/nodes/:id/watchdog` | Yes | Watchdog events for a node |
| `POST` | `/api/v1/nodes/:id/watchdog` | Yes | Record watchdog events (from agent) |

---

## Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/notifications/channels` | Yes | List notification channels |
| `POST` | `/api/v1/notifications/channels` | Yes | Create a channel (telegram, discord, webhook) |
| `DELETE` | `/api/v1/notifications/channels/:id` | Yes | Delete a channel |
| `POST` | `/api/v1/notifications/test` | Yes | Send a test notification |

### Example

```bash
curl -X POST http://localhost:8080/api/v1/notifications/channels \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discord",
    "name": "ops-channel",
    "config": {"webhook_url": "https://discord.com/api/webhooks/..."}
  }'
```

---

## Doctor & Diagnostics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/doctor` | Yes | Run cluster-wide diagnostics (`?autofix=true`) |
| `POST` | `/api/v1/nodes/:id/doctor` | Yes | Receive agent self-heal reports |
| `POST` | `/api/v1/doctor/fix` | Yes | Auto-fix a specific issue |
| `POST` | `/api/v1/auto` | Yes | Run auto-optimization mode |
| `GET` | `/api/v1/auto/status` | Yes | Auto mode status |
| `GET` | `/api/v1/errors` | Yes | Classified error log (`?hours=24`) |
| `GET` | `/api/v1/suggestions` | Yes | AI-generated optimization suggestions |

Doctor checks: stale nodes, orphaned stats/commands, stuck commands, stale pulls, unacked critical alerts, stats bloat, DB integrity, WAL mode, empty nodes, GPU thermal throttling.

**Fix actions:** `reboot_node`, `restart_agent`, `prune_stats`, `clear_alerts`, `deploy_model`

---

## Bulk Operations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/bulk/command` | Yes | Send a command to multiple nodes (by IDs or tag) |
| `POST` | `/api/v1/bulk/tags` | Yes | Add/remove tags on multiple nodes |
| `POST` | `/api/v1/bulk/reboot` | Yes | Reboot multiple nodes |
| `POST` | `/api/v1/bulk/deploy` | Yes | Deploy a model to multiple nodes |
| `POST` | `/api/v1/cluster/reboot` | Yes | Emergency cluster-wide reboot (`{"confirm": true}`) |

### Example: Bulk Command

```bash
curl -X POST http://localhost:8080/api/v1/bulk/command \
  -H "Content-Type: application/json" \
  -d '{"tag": "production", "action": "install_model", "payload": {"model": "llama3.1:8b"}}'
```

---

## Node Groups & Placement

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/node-groups` | Yes | List node groups |
| `POST` | `/api/v1/node-groups` | Yes | Create a node group |
| `DELETE` | `/api/v1/node-groups/:id` | Yes | Delete a node group |
| `POST` | `/api/v1/node-groups/:id/members` | Yes | Add a node to a group |
| `GET` | `/api/v1/node-groups/:id/members` | Yes | List group members |
| `GET` | `/api/v1/placement-constraints` | Yes | List placement constraints (`?model=`) |
| `POST` | `/api/v1/placement-constraints` | Yes | Add a placement constraint |
| `DELETE` | `/api/v1/placement-constraints/:id` | Yes | Delete a placement constraint |

---

## Webhooks

Fire events to external URLs with optional HMAC signing.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/webhooks` | Yes | List webhooks (secrets masked) |
| `POST` | `/api/v1/webhooks` | Yes | Create a webhook |
| `DELETE` | `/api/v1/webhooks/:id` | Yes | Delete a webhook |
| `POST` | `/api/v1/webhooks/:id/test` | Yes | Send a test event |

### Example

```bash
curl -X POST http://localhost:8080/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.example.com/tentaclaw",
    "events": ["alert", "node_offline"],
    "secret": "my-signing-secret"
  }'
```

Webhook payloads include `X-TentaCLAW-Signature` header (SHA-256 HMAC).

---

## Monitoring & Observability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/metrics` | No | Prometheus-compatible metrics endpoint |
| `GET` | `/api/v1/cache/stats` | Yes | Prompt cache statistics |
| `POST` | `/api/v1/cache/purge` | Yes | Purge expired cache entries |
| `GET` | `/api/v1/queue` | Yes | Inference request queue stats |
| `GET` | `/api/v1/config/db-stats` | Yes | Database table sizes and disk usage |
| `GET` | `/api/v1/config/cors` | Yes | CORS configuration |

**Prometheus metrics include:**
- Cluster: `tentaclaw_cluster_nodes_total`, `tentaclaw_cluster_gpus_total`, `tentaclaw_cluster_vram_*_bytes`, `tentaclaw_cluster_models_loaded`
- Per-GPU (DCGM-compatible): `tentaclaw_gpu_temperature_celsius`, `tentaclaw_gpu_utilization_ratio`, `tentaclaw_gpu_memory_*_bytes`, `tentaclaw_gpu_power_draw_watts`, `tentaclaw_gpu_fan_speed_ratio`, `tentaclaw_gpu_clock_*_mhz`
- Inference: `tentaclaw_inference_requests_total`, `tentaclaw_inference_tokens_generated_total`, `tentaclaw_inference_latency_seconds` (histogram), `tentaclaw_inference_ttft_seconds`, `tentaclaw_inference_tokens_per_second`, `tentaclaw_inference_queue_depth`
- Cache: `tentaclaw_cache_entries`, `tentaclaw_cache_hits_total`, `tentaclaw_cache_hit_ratio`
- Backend: `tentaclaw_backend_healthy`, `tentaclaw_backend_models_loaded`

---

## Topology & Visualization

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/topology` | Yes | Cluster topology with farm groupings |
| `GET` | `/api/v1/farms` | Yes | List farms with aggregate stats |
| `GET` | `/api/v1/farms/:hash` | Yes | Nodes in a specific farm |
| `GET` | `/api/v1/inventory` | Yes | Full hardware inventory |
| `GET` | `/api/v1/gpu-map` | Yes | Visual GPU memory map |
| `GET` | `/api/v1/utilization` | Yes | Per-node utilization breakdown (GPU, VRAM, CPU, RAM) |
| `GET` | `/api/v1/capacity` | Yes | Available capacity + what models still fit |
| `GET` | `/api/v1/compare` | Yes | Compare nodes side-by-side (`?nodes=A,B`) |
| `GET` | `/api/v1/leaderboard` | Yes | Node leaderboard by tokens/sec |
| `GET` | `/api/v1/leaderboard/models` | Yes | Model performance leaderboard |
| `GET` | `/api/v1/search` | Yes | Search nodes, models, aliases, tags (`?q=`) |
| `GET` | `/api/v1/timeline` | Yes | Cluster event timeline (`?limit=50`) |
| `GET` | `/api/v1/fleet` | Yes | Fleet reliability metrics |
| `GET` | `/api/v1/uptime` | Yes | Fleet-wide uptime (`?hours=24`) |

---

## Cluster Operations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/dashboard` | Yes | Single-call data bundle for dashboard UI |
| `GET` | `/api/v1/digest` | Yes | Human-readable daily cluster digest |
| `GET` | `/api/v1/status-page` | Yes | Public status page data |
| `GET` | `/api/v1/export` | Yes | Export cluster data (nodes, flight sheets, schedules) |
| `POST` | `/api/v1/import` | Yes | Import cluster data |
| `GET` | `/api/v1/config/export` | Yes | Export full cluster configuration |
| `POST` | `/api/v1/config/import` | Yes | Import cluster configuration |
| `GET` | `/api/v1/shells` | Yes | List nodes with remote shell available |

---

## Playground

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/playground/chat` | Yes | Enhanced chat for the playground UI |
| `GET` | `/api/v1/playground/models` | Yes | Models formatted for the playground |
| `GET` | `/api/v1/playground/history` | Yes | Recent playground requests (`?limit=50`) |
| `POST` | `/api/v1/playground/compare` | Yes | Compare same prompt across up to 5 models |

---

## Profiler

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/profiler/summary` | Yes | Performance summary |
| `GET` | `/api/v1/profiler/endpoint/:path` | Yes | Per-endpoint performance data |
| `GET` | `/api/v1/profiler/recent` | Yes | Recent profiler entries (`?limit=`) |
| `POST` | `/api/v1/profiler/load-test` | Yes | Generate load test configuration |
| `DELETE` | `/api/v1/profiler` | Yes | Clear all profiler data |

---

## Comedy Engine

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/comedy/wait-line` | Yes | Generate wait-state comedy microcopy |
| `POST` | `/api/v1/comedy/wait-line` | Yes | Generate comedy with full options |

---

## Daphney Bridge (UE5 Integration)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/daphney/stream` | Yes | SSE stream for UE5 integration |
| `GET` | `/api/v1/daphney/config` | Yes | Daphney integration configuration |
| `POST` | `/api/v1/daphney/event` | Yes | Receive events from UE5 |
| `POST` | `/api/v1/daphney/chat` | Yes | Character-based chat with emotion detection |
| `GET` | `/api/v1/daphney/characters` | Yes | List registered characters |
| `POST` | `/api/v1/daphney/characters` | Yes | Register a character |
| `DELETE` | `/api/v1/daphney/characters/:id` | Yes | Remove a character |

---

## WebSocket & Real-Time

### SSE (Server-Sent Events)

**`GET /api/v1/events`** -- Dashboard real-time event stream.

```bash
curl -N http://localhost:8080/api/v1/events
```

Event types: `connected`, `node_online`, `node_offline`, `stats_update`, `command_sent`, `command_completed`, `flight_sheet_applied`, `alert`, `benchmark_complete`, `smart_deploy`, `doctor_ran`, `maintenance`, `bulk_command`, `bulk_deploy`, `bulk_reboot`, `model_pull_started`, `model_pull_progress`, `shell_available`, `watchdog_event`, `daphney_event`

### WebSocket: Remote Shell

- **Agent connects:** `ws://gateway:8080/ws/agent-shell/:nodeId` (authenticated via cluster secret)
- **Dashboard connects:** `ws://gateway:8080/ws/shell/:nodeId` (authenticated via session token, requires admin/operator role)

The gateway pipes data bidirectionally between dashboard and agent. The agent spawns a shell process and streams stdin/stdout.

### Auto-Discovery

The gateway broadcasts its presence via UDP on port 41337 every 30 seconds. Agents can discover the gateway automatically on the local network.

---

## Request Tracing

Every response includes an `X-Request-ID` header. Pass your own via the request header to correlate with your logs.

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

OpenAI-compatible endpoints use the OpenAI error format:

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type"
  }
}
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (missing/invalid fields) |
| 401 | Unauthorized (missing or invalid auth) |
| 403 | Forbidden (insufficient permissions, expired key) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, insufficient VRAM) |
| 429 | Rate limit exceeded |
| 502 | Backend proxy error |
| 503 | Service unavailable (no nodes, no models) |

---

*200+ endpoints. Eight arms. Do the math.*
