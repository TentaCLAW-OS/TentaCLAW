# TentaCLAW OS — Frequently Asked Questions

> **Thirty questions. Eight arms. All the answers.**

---

## General

### 1. What is TentaCLAW OS?

TentaCLAW OS is an **AI inference cluster operating system**. It turns scattered GPUs across multiple machines into one unified, self-healing inference cluster. You boot nodes, they auto-discover each other, and you manage everything through a single dashboard and CLI.

Think of it as **HiveOS for AI inference** instead of cryptocurrency mining.

### 2. How is TentaCLAW different from Ollama, GPUStack, or vLLM?

Those tools run on a single machine. TentaCLAW runs **across** machines.

| | Ollama | vLLM | GPUStack | TentaCLAW OS |
|---|---|---|---|---|
| **Scope** | Single machine | Single machine | Multi-machine | Multi-machine |
| **Auto-discovery** | No | No | No | Yes (UDP + mDNS) |
| **Bootable OS** | No | No | No | Yes (ISO + PXE) |
| **OpenAI-compatible** | Yes | Yes | Yes | Yes |
| **Heterogeneous hardware** | No | No | Partial | Yes (NVIDIA + AMD + CPU) |
| **Self-healing** | No | No | No | Yes (watchdog) |
| **Bare-metal focus** | No | No | No | Yes |

TentaCLAW **uses** Ollama (and vLLM, llama.cpp, BitNet) as inference backends on each node. It adds the clustering, routing, management, and operational layer on top.

### 3. Who is TentaCLAW for?

- Homelab builders with multiple GPU machines
- Small teams running local AI without cloud API bills
- Research labs managing a GPU cluster
- Anyone who owns GPUs and wants to use them for inference without building DevOps from scratch

### 4. Is TentaCLAW OS free?

Yes. TentaCLAW OS is open source under the MIT license. Use it however you want.

### 5. Is it production-ready?

TentaCLAW OS is in **early release** (v0.2.0). The gateway, agent, CLI, and dashboard are functional and tested (129+ tests). People run it in homelabs today.

For mission-critical production workloads, evaluate carefully. The project is moving fast and APIs may change between minor versions.

### 6. What's CLAWtopus?

CLAWtopus is the mascot octopus of TentaCLAW OS. She's also the name of the CLI tool (`clawtopus`). Eight arms, eight functions: route, balance, monitor, deploy, benchmark, overclock, heal, scale. She's the personality of the project.

---

## Hardware

### 7. Do I need GPUs?

No. You can run TentaCLAW with:

- **GPU nodes** — for maximum inference speed (Ollama, vLLM)
- **CPU-only nodes** — using BitNet 1-bit models (any x86_64 CPU)
- **Mock mode** — for development and testing (no hardware at all)

A cluster can mix all three.

### 8. What GPUs are supported?

| Vendor | Families | Backend | Status |
|--------|----------|---------|--------|
| **NVIDIA** | Pascal+ (GTX 10xx, RTX 20xx/30xx/40xx/50xx) | CUDA / Ollama | Full support |
| **AMD** | RDNA2+ (RX 6000/7000) | ROCm / Ollama | Full support |
| **AMD** | RDNA1, Vega, Polaris | Vulkan / Ollama | Works via Vulkan |
| **Intel** | Arc (A770, A750) | Planned | Not yet |
| **CPU** | Any x86_64 | BitNet | Full support |

### 9. Can I mix NVIDIA and AMD GPUs in the same cluster?

Yes. Each node runs its own inference backend (CUDA for NVIDIA, ROCm/Vulkan for AMD). The gateway routes requests to whichever node has the requested model loaded. The client never needs to know which vendor is handling the request.

You can even mix GPU nodes and CPU-only BitNet nodes in the same cluster.

### 10. What's the minimum hardware to get started?

For development and testing: **any machine** with Node.js 22+. The mock agent simulates GPU hardware.

For real inference: one machine with at least one GPU (even a GTX 1060 works). Add more nodes whenever you want. There's no minimum cluster size.

### 11. How many nodes can a TentaCLAW cluster handle?

The gateway is designed for hundreds of nodes. The SQLite database and in-memory node registry are lightweight. In practice, most homelab clusters are 2-20 nodes.

The current bottleneck at very large scale would be the single-gateway architecture. Clustered gateways (HA) are on the roadmap.

### 12. What are the recommended specs for the gateway machine?

The gateway is lightweight. It doesn't run inference — it just coordinates.

| | Minimum | Recommended |
|---|---|---|
| CPU | Any dual-core | Modern quad-core |
| RAM | 2 GB | 4 GB+ |
| Storage | 1 GB | 10 GB (for database history) |
| Network | 1 GbE | 1 GbE (10 GbE for large clusters) |
| GPU | Not needed | Not needed |

The gateway can run on a Raspberry Pi, a VM, a NAS — anything with a network connection. It doesn't need to be a powerful machine.

---

## Setup & Configuration

### 13. How does auto-discovery work?

When an agent starts, it tries to find the gateway using multiple methods (in order):

1. **UDP broadcast** on port 41337 — fastest, works on flat LANs
2. **mDNS/DNS-SD** — resolves `_tentaclaw._tcp.local` service records
3. **Subnet scan** — probes the local /24 for a gateway on port 8080
4. **Environment variable** — `TENTACLAW_GATEWAY_URL=http://...`
5. **Config file** — `/etc/tentaclaw/rig.conf`
6. **Localhost fallback** — `http://127.0.0.1:8080`

For multi-subnet or VPN setups, set the gateway URL explicitly.

### 14. Can I run TentaCLAW over a VPN (WireGuard, Tailscale)?

Yes. Set the gateway URL to the VPN IP:

```bash
# WireGuard
export TENTACLAW_GATEWAY_URL=http://10.66.66.1:8080

# Tailscale
export TENTACLAW_GATEWAY_URL=http://gateway-hostname:8080
```

UDP auto-discovery won't work over most VPNs, so you must set the URL explicitly.

### 15. Do I have to flash the ISO? Can I just run the agent on my existing Linux install?

Yes. The ISO is for dedicated bare-metal inference nodes. If you want to keep your existing OS, just run the agent:

```bash
cd agent && npm install
npx tsx src/index.ts
```

Or with Docker:
```bash
docker run -d --gpus all \
  -e TENTACLAW_GATEWAY_URL=http://gateway:8080 \
  tentaclaw/agent
```

### 16. How do I run TentaCLAW in Docker?

```bash
docker compose up -d
open http://localhost:8080/dashboard/
```

See [DOCKER.md](DOCKER.md) for full details.

### 17. Does TentaCLAW support PXE network boot?

Yes. The ISO builder generates PXE artifacts. Boot diskless nodes straight from the network — no USB drives needed. See [QUICKSTART.md](QUICKSTART.md) for PXE setup.

---

## Models & Inference

### 18. What models can I run?

Anything that Ollama, vLLM, or llama.cpp supports:

- **Llama 3.1** (8B, 70B, 405B)
- **Mistral / Mixtral**
- **Qwen 2.5**
- **Gemma 2**
- **Phi-3 / Phi-4**
- **DeepSeek**
- **CodeLlama / StarCoder**
- **Embedding models** (nomic-embed, mxbai)
- **BitNet 1-bit models** (CPU-only)
- And thousands more from the Ollama and HuggingFace catalogs

If Ollama can pull it, TentaCLAW can run it.

### 19. Does TentaCLAW support the OpenAI API format?

Yes. The gateway exposes `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/embeddings`, and `GET /v1/models`. Point any OpenAI SDK or client at your gateway URL:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://your-gateway:8080/v1",
    api_key="your-key"  # or "not-needed" if auth is off
)

response = client.chat.completions.create(
    model="llama3.1:8b",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### 20. Can I use TentaCLAW with LangChain / LlamaIndex / AutoGen?

Yes. Any framework that talks to OpenAI-compatible APIs works. Just set the `base_url` to your gateway:

```python
# LangChain
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="http://gateway:8080/v1", model="llama3.1:8b")

# LlamaIndex
from llama_index.llms.openai_like import OpenAILike
llm = OpenAILike(api_base="http://gateway:8080/v1", model="llama3.1:8b")
```

### 21. Does TentaCLAW support streaming?

Yes. Pass `"stream": true` in your request. The gateway proxies the SSE stream from the backend node. Standard `text/event-stream` format, compatible with all OpenAI clients.

### 22. Does TentaCLAW support function calling / tool use?

Yes. The gateway passes through all OpenAI-compatible parameters including `tools`, `tool_choice`, and `response_format`. If the underlying model supports function calling (e.g., Hermes, Mistral), it works through TentaCLAW.

### 23. Does TentaCLAW support fine-tuning?

Not directly. TentaCLAW is an **inference** platform. Fine-tune your models with your preferred tool (Axolotl, Unsloth, etc.), then deploy the result to your TentaCLAW cluster:

```bash
clawtopus deploy my-fine-tuned-model:latest
```

### 24. How does the gateway decide which node to send a request to?

The gateway uses a **smart routing** algorithm:

1. Find all nodes that have the requested model loaded
2. Score each candidate by: available VRAM, current GPU utilization, inference queue depth, recent latency
3. Route to the best-scoring node

If no node has the model loaded, the response tells you to deploy it first.

---

## What's BitNet?

### 25. What's BitNet and why should I care?

BitNet is Microsoft's **1-bit large language model** architecture. Weights are ternary (-1, 0, 1) instead of 16-bit floats. This means:

- **Runs on any CPU** — no GPU required
- **2-6x faster** inference than FP16 on CPUs
- **~70% less energy** consumption
- **Tiny model files** — a 3B model is ~400 MB

TentaCLAW treats BitNet as just another backend. Deploy a BitNet model, and the gateway routes to a CPU node. See [BITNET.md](BITNET.md) for details.

---

## Monitoring & Operations

### 26. How do I monitor my cluster?

Multiple ways:

- **Dashboard** — `http://gateway:8080/dashboard/` for a visual overview
- **CLI** — `clawtopus status`, `clawtopus top` (live monitoring), `clawtopus health`
- **Prometheus** — `GET /metrics` for Grafana integration
- **Alerts** — automatic alerts for GPU temp, VRAM pressure, disk full, node offline
- **Notifications** — push alerts to Discord, Slack, Telegram, email, or webhooks

### 27. Can I set up alerts for GPU temperature or node failures?

Yes. TentaCLAW has built-in alerting:

```bash
# View active alerts
clawtopus alerts

# Set up Discord notifications
curl -X POST http://localhost:8080/api/v1/notifications/channels \
  -H "Content-Type: application/json" \
  -d '{"type":"discord","name":"ops","config":{"webhook_url":"https://discord.com/api/webhooks/..."}}'
```

Alert types: GPU temperature, VRAM pressure, disk full, CPU saturation, node offline.

### 28. Does TentaCLAW integrate with Grafana / Prometheus?

Yes. The `/metrics` endpoint exposes Prometheus-format metrics. Add it as a Prometheus scrape target:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: tentaclaw
    static_configs:
      - targets: ['gateway:8080']
```

Then build Grafana dashboards using `tentaclaw_*` metrics.

---

## Contributing & Community

### 29. How do I contribute?

1. Fork the repo: https://github.com/TentaCLAW-OS/TentaCLAW
2. Pick an issue labeled `good-first-issue` or `CLAWtopus-wanted`
3. Follow the code style (TypeScript, zero runtime deps in agent/CLI, Vitest for tests)
4. Submit a PR

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.

### 30. Where do I report bugs or request features?

- **Bugs**: https://github.com/TentaCLAW-OS/TentaCLAW/issues
- **Feature requests**: https://github.com/TentaCLAW-OS/TentaCLAW/issues (use the `enhancement` label)
- **Discussion**: https://github.com/TentaCLAW-OS/TentaCLAW/discussions
- **Discord**: The Tank -- https://discord.gg/tentaclaw
- **Reddit**: r/selfhosted, r/LocalLLaMA

---

## Quick Answers

| Question | Answer |
|----------|--------|
| What port does the gateway use? | 8080 (configurable via `TENTACLAW_PORT`) |
| What port does Ollama use? | 11434 |
| What port does BitNet use? | 8082 |
| What port is auto-discovery? | 41337 (UDP) |
| What database does the gateway use? | SQLite |
| What language is it written in? | TypeScript (gateway, agent, CLI, MCP) + Bash (ISO builder) |
| Does it need the internet? | Only for pulling models. Runs fully offline once models are cached. |
| Does it support Windows nodes? | Dev mode works on Windows. Production nodes run Linux. |
| Does it support ARM? | Not yet. x86_64 only for now. ARM is on the roadmap. |
| How often do agents push stats? | Every 10 seconds (configurable via `TENTACLAW_INTERVAL`) |
| Is there a mobile app? | No. The web dashboard is mobile-responsive. |
| What's a Farm Hash? | A unique identifier for your cluster. All nodes in the same farm share the same hash. |
| What's a flight sheet? | A declarative model deployment plan. Define which models go on which nodes. |

---

*CLAWtopus says: "Thirty answers. Eight arms. Still have tentacles to spare."*
