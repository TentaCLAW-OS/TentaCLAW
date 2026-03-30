# TentaCLAW Benchmark Suite

Load-test the TentaCLAW Gateway and measure throughput, latency percentiles, and error rates. Zero external dependencies — uses only Node.js built-in `http` module with connection pooling.

## Prerequisites

- Node.js 18+
- `tsx` (included in the gateway's devDependencies)
- A running TentaCLAW Gateway instance (default: `http://localhost:8080`)

## Quick Start

```bash
# From the repository root — start the gateway first
cd gateway
npm run dev

# In another terminal — run all benchmarks
cd tests/benchmark
npx tsx run-benchmarks.ts
```

Or use the convenience scripts:

```bash
npm run bench              # Run all benchmarks
npm run bench:health       # Run just health_throughput
npm run bench:json         # Output JSON only
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--gateway URL` | `http://localhost:8080` | Gateway base URL |
| `--concurrency N` | `50` | Maximum concurrent requests |
| `--duration S` | `10` | Duration for sustained benchmarks (seconds) |
| `--benchmark NAME` | *(all)* | Run a single benchmark by name |
| `--json` | `false` | Output JSON only (suppresses human-readable output) |
| `--help` | | Show help and exit |

## Benchmarks

### 1. health_throughput
Fires 10,000 `GET /health` requests and measures raw requests-per-second. This is the baseline throughput number for the gateway.

### 2. registration_burst
Registers 500 unique nodes concurrently via `POST /api/v1/register`. Measures how the gateway handles burst registration load including database writes.

### 3. stats_ingestion
Pre-registers 100 nodes, then pushes stats from all 100 simultaneously via `POST /api/v1/nodes/:id/stats`. Measures stats processing throughput.

### 4. model_search
Sends 1,000 `GET /api/v1/model-search` requests with varying query terms. Measures search/filter performance under load.

### 5. dashboard_bundle
Sends 500 `GET /api/v1/dashboard` requests under concurrency. The dashboard endpoint aggregates data from multiple sources, so this tests the "heaviest" read path.

### 6. concurrent_chat
Sends `POST /v1/chat/completions` at three concurrency tiers: 10, 50, and 100. Since no inference backend is connected during benchmarking, the gateway returns 503/429 — but this measures the routing and load-shedding latency.

### 7. sse_connections
Opens 100 Server-Sent Events connections to `/api/v1/events`, triggers a broadcast (via node registration), and verifies that all clients receive the event. Measures connection setup latency and broadcast reliability.

### 8. cold_start
Spawns a fresh gateway process and polls `/health` until it responds. Measures the time from process start to first successful response.

## Output Format

Each benchmark prints:

```
[BENCH] health_throughput
  Requests:  10,000
  Duration:  2.1s
  RPS:       4,762
  P50:       0.2ms
  P95:       0.5ms
  P99:       1.2ms
  Errors:    0
  Status:    PASS
```

Status values:
- **PASS** — Error rate below 1%
- **WARN** — Error rate between 1% and 10%
- **FAIL** — Error rate above 10%, or benchmark could not complete

## Results

Results are saved to:
- `results/latest.json` — always overwritten with the most recent run
- `results/<timestamp>.json` — timestamped copy for historical comparison

### Comparing Results

To compare two runs, diff the JSON files:

```bash
# Compare latest against a previous run
diff results/latest.json results/2026-03-29T10-30-00-000Z.json
```

Or use `jq` to extract specific metrics:

```bash
# Extract RPS for each benchmark
cat results/latest.json | jq '.results[] | {name, rps, p99Ms}'
```

### CI Integration

Use `--json` for machine-readable output and check the exit code:
- Exit 0: all benchmarks passed
- Exit 1: one or more benchmarks failed

```bash
npx tsx run-benchmarks.ts --json > results.json
if [ $? -ne 0 ]; then
  echo "Benchmark regression detected"
  exit 1
fi
```

## Tuning

- **Concurrency**: Increase `--concurrency` to stress-test connection handling. The default (50) is moderate.
- **Cold start port**: The cold_start benchmark uses port 19876 internally to avoid conflicts with the running gateway.
- **Connection pooling**: The suite uses `http.Agent` with `keepAlive: true` and up to 1024 sockets, simulating a realistic high-throughput client.
