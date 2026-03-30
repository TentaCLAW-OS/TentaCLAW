# TentaCLAW Gateway API Reference

> **Base URL:** `http://localhost:8080`
>
> **Version:** 0.2.0 | **Protocol:** REST + SSE | **Format:** JSON

---

## Authentication

Authentication is **optional**. To enable it, set the `TENTACLAW_API_KEY` environment variable on the gateway.

When enabled, all `/api/*` and `/v1/*` routes require a Bearer token:

```bash
curl http://localhost:8080/api/v1/nodes \
  -H "Authorization: Bearer your-api-key-here"
```

You can also pass the key as a query parameter on `/api/*` routes: `?api_key=your-key`.

### Rate Limiting

Set `TENTACLAW_RATE_LIMIT` to a number (requests per minute) to enable rate limiting on `/v1/*` inference endpoints. Rate limit headers are returned:

- `X-RateLimit-Limit` -- max requests per minute
- `X-RateLimit-Remaining` -- requests left in window
- `X-RateLimit-Reset` -- window reset time (Unix timestamp)

---

## Health & System

### `GET /health`

Basic health check. Always public (never requires auth).

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

### `GET /api/v1/version`

Gateway version, build info, and runtime details.

```bash
curl http://localhost:8080/api/v1/version
```

### `GET /api/v1/health/score`

Cluster health score from 0-100, with letter grade (A-F).

```bash
curl http://localhost:8080/api/v1/health/score
```

```json
{
  "score": 87,
  "grade": "B",
  "issues": [],
  "recommendations": ["Consider adding more nodes for redundancy"]
}
```

### `GET /api/v1/health/detailed`

Deep health analysis with per-node breakdown, issue detection, and recommendations.

### `GET /api/v1/healthz`

Kubernetes-style liveness probe. Returns `200` if the gateway process is alive.

### `GET /api/v1/readyz`

Kubernetes-style readiness probe. Returns `200` if the gateway has at least one online node.

### `GET /api/v1/capabilities`

Lists all features and capabilities of this gateway instance.

---

## Node Management

### `POST /api/v1/register`

Register a new node with the cluster.

```bash
curl -X POST http://localhost:8080/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "TENTACLAW-FARM7K3P-node1",
    "farm_hash": "FARM7K3P",
    "hostname": "gpu-rig-01",
    "gpu_count": 2,
    "gpus": [{"busId": "0000:01:00.0", "name": "RTX 3090", "vramTotalMb": 24576, "vramUsedMb": 0, "temperatureC": 35, "utilizationPct": 0, "powerDrawW": 30, "fanSpeedPct": 0, "clockSmMhz": 210, "clockMemMhz": 405}]
  }'
```

### `GET /api/v1/nodes`

List all registered nodes with their latest stats. Supports pagination via `?page=1&limit=50`.

```bash
curl http://localhost:8080/api/v1/nodes
```

### `GET /api/v1/nodes/:nodeId`

Get detailed info for a single node, including full GPU stats and loaded models.

```bash
curl http://localhost:8080/api/v1/nodes/TENTACLAW-FARM7K3P-node1
```

### `DELETE /api/v1/nodes/:nodeId`

Remove a node from the cluster.

### `POST /api/v1/nodes/:id/maintenance`

Toggle maintenance mode. Cordoned nodes receive no new inference requests.

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## Stats

### `POST /api/v1/nodes/:nodeId/stats`

Push stats from an agent. Returns pending commands in the response (the push/pull heartbeat model).

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/stats \
  -H "Content-Type: application/json" \
  -d '{ "farm_hash": "FARM7K3P", "node_id": "NODE-001", ... }'
```

Response:

```json
{
  "commands": [
    {"id": "cmd-123", "action": "install_model", "model": "llama3.1:8b"}
  ]
}
```

### `GET /api/v1/nodes/:nodeId/stats/history`

Historical stats for a node. Query params: `?hours=24&limit=100`.

### `GET /api/v1/summary`

Cluster-wide summary: total nodes, GPUs, VRAM, tokens/sec, loaded models.

```bash
curl http://localhost:8080/api/v1/summary
```

---

## Commands

### `POST /api/v1/nodes/:nodeId/commands`

Queue a command for a node. The node picks it up on the next stats push.

```bash
curl -X POST http://localhost:8080/api/v1/nodes/NODE-001/commands \
  -H "Content-Type: application/json" \
  -d '{"action": "install_model", "model": "llama3.1:8b"}'
```

**Available actions:** `reload_model`, `install_model`, `remove_model`, `overclock`, `benchmark`, `restart_agent`, `reboot`

### `POST /api/v1/commands/:commandId/complete`

Mark a command as completed (called by the agent).

### Bulk Operations

```bash
# Send a command to multiple nodes at once
curl -X POST http://localhost:8080/api/v1/bulk/command \
  -H "Content-Type: application/json" \
  -d '{"node_ids": ["NODE-001", "NODE-002"], "action": "install_model", "model": "llama3.1:8b"}'

# Bulk deploy
POST /api/v1/bulk/deploy

# Bulk reboot
POST /api/v1/bulk/reboot

# Bulk tag
POST /api/v1/bulk/tags
```

---

## Models

### `GET /api/v1/models`

List all models loaded across the cluster, with per-node distribution.

```bash
curl http://localhost:8080/api/v1/models
```

### `POST /api/v1/deploy`

Deploy a model to the best available node (or a specific node).

```bash
curl -X POST http://localhost:8080/api/v1/deploy \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.1:8b"}'
```

### `POST /api/v1/models/smart-deploy`

AI-assisted deployment -- finds the optimal node based on VRAM, utilization, and model requirements.

### `GET /api/v1/model-search`

Search the Ollama model catalog. Returns VRAM requirements and whether each model fits your cluster.

```bash
curl "http://localhost:8080/api/v1/model-search?q=llama&limit=10"
```

### `GET /api/v1/models/distribution`

Which models are on which nodes.

### `GET /api/v1/models/check-fit`

Check if a model fits in the cluster's available VRAM.

```bash
curl "http://localhost:8080/api/v1/models/check-fit?model=llama3.1:70b"
```

### Model Aliases

Map friendly names to real model names (e.g., `gpt-4` -> `llama3.1:70b`).

```bash
# List aliases
GET /api/v1/aliases

# Create alias
POST /api/v1/aliases
{"alias": "gpt-4", "target": "llama3.1:70b", "fallbacks": ["llama3.1:8b"]}

# Delete alias
DELETE /api/v1/aliases/:alias
```

---

## Inference (OpenAI-Compatible)

These endpoints are fully compatible with OpenAI client libraries. Point any OpenAI SDK at your gateway.

### `POST /v1/chat/completions`

Chat completions with streaming support, function calling, and JSON mode.

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

Supports all standard OpenAI parameters: `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `frequency_penalty`, `presence_penalty`, `tools`, `tool_choice`, `response_format`, `logprobs`.

The response includes a `_tentaclaw` field with routing metadata:

```json
{
  "_tentaclaw": {
    "routed_to": "NODE-001",
    "hostname": "gpu-rig-01",
    "latency_ms": 142,
    "backend": "ollama",
    "cached": false
  }
}
```

Streaming returns `text/event-stream` with `X-TentaCLAW-Node` and `X-TentaCLAW-Latency` headers.

### `POST /v1/completions`

Legacy completions endpoint. Same routing and load-balancing.

### `POST /v1/embeddings`

Generate embeddings via the cluster.

```bash
curl http://localhost:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": "Hello world"}'
```

### `GET /v1/models`

OpenAI-compatible model list. Returns all models currently loaded across the cluster.

```bash
curl http://localhost:8080/v1/models
```

---

## Tags

Organize nodes with arbitrary string tags (`production`, `inference`, `staging`, etc.).

```bash
# List all tags with counts
GET /api/v1/tags

# Get nodes with a specific tag
GET /api/v1/tags/:tag/nodes

# Get tags for a node
GET /api/v1/nodes/:id/tags

# Add a tag to a node
POST /api/v1/nodes/:id/tags
{"tag": "production"}

# Remove a tag
DELETE /api/v1/nodes/:id/tags/:tag
```

---

## SSH Keys

Manage SSH keys on nodes via the API.

```bash
# List keys for a node
GET /api/v1/nodes/:id/ssh-keys

# Add a key
POST /api/v1/nodes/:id/ssh-keys
{"label": "my-laptop", "public_key": "ssh-ed25519 AAAA..."}

# Delete a key
DELETE /api/v1/ssh-keys/:keyId
```

---

## Alerts

Automatic alerting for GPU temperature, VRAM pressure, disk full, CPU saturation, and node offline.

```bash
# Get recent alerts
curl http://localhost:8080/api/v1/alerts

# Acknowledge an alert
curl -X POST http://localhost:8080/api/v1/alerts/alert-123/acknowledge
```

---

## Benchmarks

```bash
# Get all benchmarks
GET /api/v1/benchmarks

# Get benchmarks for a node
GET /api/v1/nodes/:nodeId/benchmarks

# Submit a benchmark result
POST /api/v1/nodes/:nodeId/benchmark

# Trigger a benchmark run on a node
POST /api/v1/nodes/:nodeId/benchmark/run
```

---

## Flight Sheets

Declarative model deployment plans.

```bash
# List all flight sheets
GET /api/v1/flight-sheets

# Create a flight sheet
POST /api/v1/flight-sheets
{"name": "production-stack", "description": "Standard inference models", "targets": [{"node_id": "*", "model": "llama3.1:8b"}]}

# Get a specific flight sheet
GET /api/v1/flight-sheets/:id

# Apply a flight sheet (deploy all targets)
POST /api/v1/flight-sheets/:id/apply

# Delete a flight sheet
DELETE /api/v1/flight-sheets/:id
```

---

## Schedules

Cron-based automation for model deployment, benchmarks, and reboots.

```bash
# List schedules
GET /api/v1/schedules

# Create a schedule
POST /api/v1/schedules
{"name": "nightly-benchmark", "cron": "0 2 * * *", "action": "benchmark", "target_nodes": ["*"]}

# Toggle enable/disable
POST /api/v1/schedules/:id/toggle

# Delete
DELETE /api/v1/schedules/:id
```

---

## Monitoring

### `GET /metrics`

Prometheus-compatible metrics endpoint. Exposes:

- `tentaclaw_nodes_total`, `tentaclaw_nodes_online`
- `tentaclaw_gpus_total`, `tentaclaw_vram_total_bytes`, `tentaclaw_vram_used_bytes`
- `tentaclaw_toks_per_sec`, `tentaclaw_requests_total`
- `tentaclaw_health_score`, `tentaclaw_alerts_active`
- `tentaclaw_sse_clients`, `tentaclaw_models_loaded`
- Per-GPU metrics: `tentaclaw_gpu_temperature_celsius`, `tentaclaw_gpu_utilization_percent`, `tentaclaw_gpu_vram_used_bytes`, `tentaclaw_gpu_power_watts`

```bash
curl http://localhost:8080/metrics
```

### `GET /api/v1/events`

Server-Sent Events (SSE) stream for real-time updates. Used by the dashboard.

Event types: `node_online`, `node_offline`, `stats_update`, `command_sent`, `command_completed`, `flight_sheet_applied`, `alert`, `benchmark_complete`

```bash
curl -N http://localhost:8080/api/v1/events
```

### `GET /api/v1/game/stream`

SSE stream for game engine (UE5/Unity) integration. Emits topology changes, inference events, and GPU state.

---

## Watchdog

Self-healing event log. The watchdog monitors and auto-restarts crashed services.

```bash
# Get all watchdog events
GET /api/v1/watchdog

# Get watchdog events for a node
GET /api/v1/nodes/:id/watchdog

# Record a watchdog event
POST /api/v1/nodes/:id/watchdog
```

---

## Notifications

Configure external notification channels for alerts.

```bash
# List channels
GET /api/v1/notifications/channels

# Create a channel (discord, slack, telegram, email, webhook)
POST /api/v1/notifications/channels
{"type": "discord", "name": "ops-channel", "config": {"webhook_url": "https://discord.com/api/webhooks/..."}}

# Test a channel
POST /api/v1/notifications/test
{"channel_id": "ch-123", "message": "Test notification"}

# Delete a channel
DELETE /api/v1/notifications/channels/:id
```

---

## API Keys

Scoped API keys with per-key rate limits and permissions.

```bash
# List keys
GET /api/v1/apikeys

# Create a key
POST /api/v1/apikeys
{"name": "ci-pipeline", "permissions": ["read", "write"], "rate_limit": 100}

# Revoke a key
DELETE /api/v1/apikeys/:id
```

---

## Power & Cost

```bash
# Cluster power draw + cost estimate
GET /api/v1/power
```

Returns per-node wattage, GPU wattage, and daily/monthly cost estimates.

---

## Overclock Profiles

```bash
# Get current profile for a node
GET /api/v1/nodes/:id/overclock

# Apply a profile (stock, gaming, mining, inference)
POST /api/v1/nodes/:id/overclock
{"profile": "inference"}
```

---

## Doctor & Diagnostics

```bash
# Run cluster-wide diagnostics
GET /api/v1/doctor

# Run diagnostics on a specific node
POST /api/v1/nodes/:id/doctor

# Auto-fix detected issues
POST /api/v1/doctor/fix
```

---

## Additional Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/topology` | Cluster topology with farm groupings |
| `GET` | `/api/v1/inventory` | Full hardware inventory across all nodes |
| `GET` | `/api/v1/timeline` | Event timeline for the cluster |
| `GET` | `/api/v1/leaderboard` | Node leaderboard by tokens/sec |
| `GET` | `/api/v1/leaderboard/models` | Model performance leaderboard |
| `GET` | `/api/v1/compare` | Compare two nodes side-by-side |
| `GET` | `/api/v1/inference/stats` | Inference request statistics |
| `GET` | `/api/v1/inference/analytics` | Detailed inference analytics |
| `GET` | `/api/v1/inference/backends` | List inference backends per node |
| `GET` | `/api/v1/capacity` | Available capacity for new models |
| `GET` | `/api/v1/gpu-map` | Visual GPU map of the cluster |
| `GET` | `/api/v1/utilization` | Cluster utilization breakdown |
| `GET` | `/api/v1/nodes/hot` | Hottest nodes by temperature |
| `GET` | `/api/v1/nodes/idle` | Most idle nodes |
| `GET` | `/api/v1/suggestions` | AI-generated optimization suggestions |
| `GET` | `/api/v1/digest` | Daily cluster digest |
| `GET` | `/api/v1/status-page` | Public status page data |
| `GET` | `/api/v1/fleet` | Fleet reliability metrics |
| `GET` | `/api/v1/uptime` | Fleet-wide uptime stats |
| `GET` | `/api/v1/nodes/:id/uptime` | Per-node uptime |
| `GET` | `/api/v1/nodes/:id/health-score` | Per-node health score |
| `GET` | `/api/v1/nodes/:id/lifecycle` | Node lifecycle events |
| `GET` | `/api/v1/nodes/:id/pulls` | Active model download progress |
| `GET` | `/api/v1/cache/stats` | Prompt cache statistics |
| `POST` | `/api/v1/cache/purge` | Purge the prompt cache |
| `POST` | `/api/v1/auto` | Run auto-optimization mode |
| `GET` | `/api/v1/config/export` | Export cluster configuration |
| `POST` | `/api/v1/config/import` | Import cluster configuration |
| `GET` | `/api/v1/openapi.json` | OpenAPI spec (auto-generated) |
| `GET` | `/api/v1/about` | About this gateway instance |

---

## Request Tracing

Every response includes an `X-Request-ID` header. Pass your own via the request header to correlate with your logs.

---

*CLAWtopus says: "65+ endpoints. Eight arms. Do the math."*
