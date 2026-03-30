# TentaCLAW OS Performance Tuning Guide

> **Squeeze every token per second out of your cluster.**

This guide covers hardware recommendations, network optimization, GPU memory management, model quantization, inference latency tuning, power efficiency, and benchmarking.

---

## Table of Contents

- [Hardware Recommendations](#hardware-recommendations)
- [Network Optimization](#network-optimization)
- [GPU Memory Management](#gpu-memory-management)
- [Model Quantization Recommendations](#model-quantization-recommendations)
- [Inference Latency Optimization](#inference-latency-optimization)
- [Power Efficiency](#power-efficiency)
- [Benchmark Your Cluster](#benchmark-your-cluster)

---

## Hardware Recommendations

### Per Cluster Size

#### Small (2-4 nodes) — Homelab / Personal

| Component | Recommended | Why |
|-----------|-------------|-----|
| **GPU** | RTX 3090 (24 GB) or RTX 4070 Ti Super (16 GB) | Best VRAM/dollar on the used market |
| **CPU** | Any modern quad-core | Agent + Ollama overhead is minimal |
| **RAM** | 32 GB DDR4 | Comfortable for OS + model loading |
| **Storage** | 500 GB NVMe SSD | Fast model loading. Models can be 5-50 GB each. |
| **Network** | 1 GbE | Fine for inference traffic between 2-4 nodes |
| **Gateway** | Any spare machine, VM, or Raspberry Pi | Gateway is lightweight |

**Budget build**: Two used RTX 3090 machines ($500-700 each) give you 48 GB of VRAM for $1000-1400 total. That runs Llama 3.1 70B at Q4 quantization.

#### Medium (5-15 nodes) — Team / Lab

| Component | Recommended | Why |
|-----------|-------------|-----|
| **GPU** | RTX 4090 (24 GB) or A6000 (48 GB) | Maximum per-node VRAM |
| **CPU** | 8+ cores (for CPU-only BitNet nodes too) | BitNet scales with core count |
| **RAM** | 64 GB DDR5 | Headroom for multiple models |
| **Storage** | 1 TB NVMe | Room for many models without swapping |
| **Network** | **10 GbE** or 2.5 GbE | Model transfers between nodes benefit hugely |
| **Gateway** | Dedicated machine or VM (4 cores, 8 GB RAM) | More nodes = more SSE connections and API traffic |

#### Large (15+ nodes) — Production / Data Center

| Component | Recommended | Why |
|-----------|-------------|-----|
| **GPU** | A100 (80 GB), H100, or multiple RTX 4090s | Maximize throughput per node |
| **CPU** | 16+ cores per node | System overhead + potential BitNet workloads |
| **RAM** | 128 GB+ | Large model loading, multiple concurrent requests |
| **Storage** | 2 TB+ NVMe RAID | Redundancy + fast model caching |
| **Network** | **10 GbE minimum**, 25 GbE ideal | Model distribution, inter-node traffic |
| **Gateway** | Dedicated server (8+ cores, 16 GB RAM) | Handle hundreds of concurrent SSE streams |

### GPU Selection Guide

Pick your GPU based on what you need:

| Priority | Best GPU | Why |
|----------|----------|-----|
| **Maximum VRAM (run 70B+)** | A6000 (48 GB) or A100 (80 GB) | Only way to fit 70B at Q8 on one card |
| **Best VRAM/dollar** | RTX 3090 (24 GB) used | ~$500-700, 24 GB VRAM, great for 7-13B models |
| **Maximum speed** | RTX 4090 (24 GB) | Fastest consumer card for inference |
| **Best power efficiency** | RTX 4070 Ti Super (16 GB) | Strong performance at only 285W TDP |
| **Cheapest entry** | RTX 3060 12 GB or GTX 1660 Ti 6 GB | $100-200 used, runs 7B models |
| **No GPU budget** | Any CPU with AVX2 | BitNet 1-bit models, ~30-60 tok/s |

---

## Network Optimization

### 1 GbE vs 10 GbE

| Scenario | 1 GbE | 10 GbE |
|----------|-------|--------|
| **Inference requests/responses** | Fine (KB-sized payloads) | Overkill |
| **Stats push (every 10s)** | Fine (< 1 KB per push) | Overkill |
| **Model distribution** | Slow (a 40 GB model takes ~5+ minutes) | Fast (~30 seconds) |
| **SSE/dashboard streaming** | Fine | Fine |
| **Embedding large batches** | Can bottleneck | Smooth |

**Rule of thumb**: If you're deploying models frequently or running a medium+ cluster, 10 GbE is worth it. If your models are already cached on each node, 1 GbE is fine.

### Network Topology

```
                    ┌─────────────────────────┐
                    │      10 GbE Switch       │
                    │  (or 2.5 GbE minimum)   │
                    └──┬──────┬──────┬──────┬─┘
                       │      │      │      │
                  Gateway  Node1  Node2  Node3
```

Best practices:

- **Same subnet** for all nodes — auto-discovery uses UDP broadcast on port 41337
- **Dedicated inference VLAN** — isolate inference traffic from other LAN traffic
- **Gateway close to nodes** — minimize routing hops between gateway and inference nodes
- **Jumbo frames** (MTU 9000) — reduces CPU overhead on high-throughput transfers

```bash
# Enable jumbo frames (both ends + switch must support it)
sudo ip link set eth0 mtu 9000
```

### Reduce Stats Push Interval

The default stats push interval is 10 seconds. For latency-sensitive routing decisions, reduce it:

```bash
# Agent pushes stats every 5 seconds
export TENTACLAW_INTERVAL=5
```

Trade-off: more frequent pushes = more accurate routing decisions, but slightly more network and DB overhead.

### Keep-Alive Connections

The agent maintains a persistent HTTP connection to the gateway. If you're behind a reverse proxy, ensure keep-alive is enabled:

```nginx
# nginx
upstream tentaclaw_gateway {
    server 127.0.0.1:8080;
    keepalive 32;
}
```

---

## GPU Memory Management

### Understand VRAM Usage

VRAM is your scarcest resource. Every loaded model consumes VRAM even when idle.

```bash
# Check cluster-wide VRAM usage
clawtopus gpu-map

# Check a specific node
nvidia-smi
clawtopus node <nodeId>

# Check what models are consuming VRAM
clawtopus models
```

### Ollama VRAM Behavior

Ollama loads models into VRAM on first request and keeps them loaded. By default, idle models are unloaded after 5 minutes.

```bash
# Keep models loaded longer (useful for frequently-used models)
export OLLAMA_KEEP_ALIVE=60m

# Unload immediately after each request (saves VRAM, adds latency)
export OLLAMA_KEEP_ALIVE=0
```

### Multi-Model Strategy

If you need multiple models on one node:

1. **Use quantized models** — Q4_K_M uses ~50% less VRAM than Q8
2. **Stagger model sizes** — Put the big model on the GPU with the most VRAM
3. **Use flight sheets** — Declare which models go where

```bash
# Flight sheet example: big model on GPU node, small model on CPU node
curl -X POST http://localhost:8080/api/v1/flight-sheets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production",
    "targets": [
      {"node_id": "GPU-NODE-01", "model": "llama3.1:70b-q4_K_M"},
      {"node_id": "CPU-NODE-01", "model": "bitnet-b1.58-2B"}
    ]
  }'
```

### VRAM Fragmentation

Loading and unloading models repeatedly can fragment VRAM. If you see OOM errors on a GPU that should have enough free VRAM:

```bash
# Restart Ollama to defragment
sudo systemctl restart ollama

# Or restart the agent (which restarts Ollama)
clawtopus command <nodeId> restart_agent
```

### Shared VRAM (Integrated GPUs)

Integrated GPUs (Intel UHD, AMD APUs) share system RAM. They work but are slow. Allocate more shared memory in BIOS if available.

---

## Model Quantization Recommendations

Quantization reduces model size and VRAM usage at the cost of some quality. Pick the right level for your hardware.

### Quantization Levels

| Quantization | VRAM (7B) | VRAM (13B) | VRAM (70B) | Quality | Speed |
|-------------|-----------|------------|------------|---------|-------|
| **F16** (full) | ~14 GB | ~26 GB | ~140 GB | Best | Baseline |
| **Q8_0** | ~8 GB | ~14 GB | ~75 GB | Near-lossless | Slightly faster |
| **Q6_K** | ~6 GB | ~11 GB | ~55 GB | Very good | Faster |
| **Q5_K_M** | ~5.5 GB | ~9 GB | ~48 GB | Good | Faster |
| **Q4_K_M** | ~5 GB | ~8 GB | ~40 GB | Good (recommended) | Fast |
| **Q4_0** | ~4 GB | ~7 GB | ~35 GB | Acceptable | Fastest |
| **Q3_K_M** | ~3.5 GB | ~6 GB | ~30 GB | Noticeable degradation | Fastest |
| **Q2_K** | ~3 GB | ~5 GB | ~25 GB | Significant degradation | Fastest |

### Recommendations

| Your VRAM | Model Size | Recommended Quantization |
|-----------|-----------|------------------------|
| **6 GB** (RTX 2060, 3060) | 7B | Q4_K_M |
| **8 GB** (RTX 3060 Ti, 4060) | 7B | Q6_K or Q8_0 |
| **12 GB** (RTX 3060 12GB) | 7B | Q8_0; or 13B at Q4_K_M |
| **16 GB** (RTX 4070 Ti Super) | 13B | Q6_K; or 7B at F16 |
| **24 GB** (RTX 3090, 4090) | 13B | Q8_0; or 70B at Q4_K_M (tight) |
| **48 GB** (A6000) | 70B | Q4_K_M comfortably |
| **80 GB** (A100) | 70B | Q8_0 or F16 |

**Rule of thumb**: Q4_K_M is the sweet spot for most use cases. Quality is very close to full precision, and you get roughly 3x the model size per GB of VRAM compared to F16.

```bash
# Deploy a specific quantization
clawtopus deploy llama3.1:8b-q4_K_M
clawtopus deploy llama3.1:70b-q4_K_M
```

---

## Inference Latency Optimization

### Measure First

Before optimizing, measure your baseline:

```bash
# Run a benchmark
clawtopus command <nodeId> benchmark

# View results
clawtopus benchmarks

# Check per-request latency
clawtopus analytics
```

### Time-to-First-Token (TTFT)

TTFT is the delay before the first token appears. It's dominated by:

1. **Model loading** — first request after idle loads the model into VRAM (seconds)
2. **Prompt processing** — longer prompts = longer TTFT
3. **Network latency** — gateway-to-node round-trip

Reduce TTFT:

```bash
# Keep models loaded in VRAM (avoid cold-start)
export OLLAMA_KEEP_ALIVE=24h

# Use flash attention (if supported by your GPU)
export OLLAMA_FLASH_ATTENTION=1

# Reduce prompt size (summarize context, use RAG instead of stuffing)
```

### Tokens Per Second (tok/s)

tok/s is your throughput during generation. It depends on:

1. **GPU memory bandwidth** — the primary bottleneck for inference
2. **Model size and quantization** — smaller models = faster
3. **Batch size** — multiple concurrent requests can increase throughput
4. **GPU clock speed** — overclocking helps marginally

Increase tok/s:

```bash
# Use inference-optimized overclock profile
clawtopus command <nodeId> overclock --profile inference

# Use a more aggressive quantization if quality allows
clawtopus deploy llama3.1:8b-q4_0   # faster than q4_K_M

# Ensure no other processes are using GPU memory
nvidia-smi   # check for other consumers
```

### Gateway Routing Latency

The gateway adds a small routing overhead (typically < 5 ms). Minimize it:

- Run the gateway on the same subnet as your inference nodes
- Use the Prometheus metrics to monitor `tentaclaw_requests_total` and latency distribution
- If you only have one node, the routing decision is trivial

### Prompt Caching

TentaCLAW supports prompt caching for repeated prefixes (system prompts, few-shot examples):

```bash
# Check cache stats
curl http://localhost:8080/api/v1/cache/stats

# Purge the cache if it's stale
curl -X POST http://localhost:8080/api/v1/cache/purge
```

### Concurrent Request Handling

Ollama handles one request at a time per model by default. For higher concurrency:

```bash
# Allow Ollama to process multiple requests in parallel
export OLLAMA_NUM_PARALLEL=4

# Increase context size if needed (uses more VRAM)
export OLLAMA_MAX_LOADED_MODELS=2
```

With TentaCLAW's routing, you get natural concurrency by spreading requests across nodes. Deploy the same model on multiple nodes and the gateway load-balances automatically.

---

## Power Efficiency

### Why It Matters

A GPU running inference 24/7 at full power adds up:

| GPU | TDP | Daily Cost ($0.12/kWh) | Monthly Cost |
|-----|-----|----------------------|--------------|
| RTX 3060 | 170W | $0.49 | $14.70 |
| RTX 3090 | 350W | $1.01 | $30.24 |
| RTX 4070 Ti Super | 285W | $0.82 | $24.62 |
| RTX 4090 | 450W | $1.30 | $38.88 |
| BitNet CPU node (125W system) | 125W | $0.36 | $10.80 |

### Power Limit Tuning

GPUs draw maximum power under load, but inference doesn't need full power. Reducing the power limit by 20-30% typically costs < 10% performance:

```bash
# NVIDIA: Set power limit to 250W (from 350W default on RTX 3090)
sudo nvidia-smi -pl 250

# Check current power limit
nvidia-smi --query-gpu=power.limit --format=csv
```

| RTX 3090 Power Limit | tok/s (7B Q4) | Reduction | Power Save |
|----------------------|---------------|-----------|------------|
| 350W (default) | ~85 tok/s | — | — |
| 300W | ~82 tok/s | -3.5% | 14% less power |
| 250W | ~78 tok/s | -8.2% | 29% less power |
| 200W | ~70 tok/s | -17.6% | 43% less power |

The sweet spot is usually 70-80% of the default TDP.

### TentaCLAW Power Monitoring

```bash
# Cluster-wide power draw and cost estimate
clawtopus power

# API endpoint
curl http://localhost:8080/api/v1/power
```

### Idle Power Management

Nodes that aren't serving requests still draw power. Options:

1. **Drain idle nodes** — `clawtopus drain <nodeId>` stops new requests, then power off
2. **Use BitNet** for low-traffic periods — CPU nodes draw much less than GPU nodes
3. **Schedule models** — Use flight sheets to load models only during business hours

```bash
# Schedule: unload all models at midnight, reload at 8am
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{"name":"off-hours","cron":"0 0 * * *","action":"remove_all_models","target_nodes":["*"]}'
```

### Efficiency Metrics

Track tokens-per-watt as your key efficiency metric:

```
Efficiency = tok/s / power_draw_watts

RTX 4070 Ti Super: 65 tok/s / 200W = 0.325 tok/s/W  (best efficiency)
RTX 3090:          85 tok/s / 300W = 0.283 tok/s/W
RTX 4090:          120 tok/s / 400W = 0.300 tok/s/W
BitNet (CPU):      40 tok/s / 100W = 0.400 tok/s/W   (most efficient)
```

BitNet on CPUs is often the most power-efficient option for smaller models.

---

## Benchmark Your Cluster

### Built-in Benchmarks

TentaCLAW includes a benchmarking system that measures real-world inference performance on each node.

```bash
# Trigger a benchmark on a specific node
clawtopus command <nodeId> benchmark

# Trigger benchmarks on all nodes
curl -X POST http://localhost:8080/api/v1/bulk/command \
  -H "Content-Type: application/json" \
  -d '{"node_ids":["*"],"action":"benchmark"}'

# View results
clawtopus benchmarks
```

### What Gets Measured

- **Tokens per second** — generation speed for a standardized prompt
- **Time to first token** — latency before generation starts
- **GPU utilization during inference** — should be 90%+ for a well-configured node
- **VRAM peak usage** — how much memory the model actually consumes

### Leaderboard

Compare node performance across your cluster:

```bash
# Which node is fastest?
clawtopus leaderboard

# API endpoint
curl http://localhost:8080/api/v1/leaderboard
```

### Manual Benchmark (Quick)

For a quick check, time a request directly:

```bash
time curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role":"user","content":"Write a 200-word essay about octopuses."}],
    "stream": false
  }' | jq '._tentaclaw.latency_ms'
```

### Expected Performance

Rough expectations for common hardware with Q4_K_M quantization:

| GPU | 7B tok/s | 13B tok/s | 70B tok/s |
|-----|----------|-----------|-----------|
| RTX 3060 12GB | ~45 | ~25 | N/A (not enough VRAM) |
| RTX 3090 24GB | ~85 | ~50 | ~12 (Q4_K_M, tight) |
| RTX 4070 Ti Super 16GB | ~65 | ~35 | N/A |
| RTX 4090 24GB | ~120 | ~70 | ~18 (Q4_K_M, tight) |
| A6000 48GB | ~70 | ~45 | ~15 |
| A100 80GB | ~100 | ~65 | ~25 |
| CPU (BitNet 2B) | ~40-60 | N/A | N/A |

These are approximate. Real performance varies with prompt length, generation length, quantization method, driver version, thermal conditions, and system load. Benchmark your own hardware.

### Prometheus + Grafana Dashboards

For continuous performance monitoring, scrape the TentaCLAW metrics endpoint:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: tentaclaw
    static_configs:
      - targets: ['gateway:8080']
    scrape_interval: 15s
```

Key metrics for performance:
- `tentaclaw_toks_per_sec` — cluster-wide throughput
- `tentaclaw_gpu_utilization_percent` — per-GPU utilization
- `tentaclaw_gpu_temperature_celsius` — thermal throttling indicator
- `tentaclaw_gpu_power_watts` — power consumption
- `tentaclaw_vram_used_bytes` / `tentaclaw_vram_total_bytes` — memory pressure

---

*CLAWtopus says: "Optimize once, infer forever. Eight arms, zero wasted cycles."*
