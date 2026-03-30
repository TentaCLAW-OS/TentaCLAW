# Hacker News Launch Post (Show HN)

## Title
Show HN: TentaCLAW OS -- A purpose-built OS for GPU inference clusters

## Body

We built TentaCLAW OS because the gap between "I own GPUs" and "I can run them as one manageable inference cluster" is still unreasonably large.

The premise: HiveOS made GPU mining manageable by abstracting away per-node configuration. The same problem exists for AI inference -- detect hardware, register nodes, push stats, deploy models, route requests -- and nobody had built the OS layer for it. So we did.

**GitHub**: https://github.com/TentaCLAW-OS/TentaCLAW
**Website**: https://www.tentaclaw.io

### Architecture

```
  CLAWtopus CLI ──> TentaCLAW Gateway (:8080)
                    Hono + SQLite | 200+ endpoints | SSE | OpenAI proxy
                              |
               ┌──────────────┼──────────────┐
               |              |              |
          GPU Node 1     GPU Node 2     CPU Node 3
          Agent daemon   Agent daemon   Agent daemon
          nvidia-smi     rocm-smi       BitNet 1-bit
          Ollama :11434  Ollama :11434  bitnet :8082
```

**Agent** (TypeScript, zero external dependencies): Runs on each node. Detects GPUs, pushes telemetry, receives commands, manages inference backends (Ollama, BitNet, vLLM planned), runs a watchdog.

**Gateway** (TypeScript, Hono framework, SQLite): Central coordinator. 200+ REST endpoints, web dashboard, SSE event stream, OpenAI-compatible inference proxy, Prometheus metrics, webhook notifications.

**CLI** (TypeScript, zero dependencies): 60+ commands. Deploy, chat, drain, cordon, doctor, top, backends, benchmarks, tags, alerts. Designed to feel like kubectl but for inference.

### Technical decisions worth discussing

**1. Push model instead of pull.**

Agents POST stats to the gateway every 10 seconds. The gateway returns pending commands in the HTTP response body. This means the gateway never needs to reach into nodes -- it just waits for them to check in. Works through NAT, firewalls, and Tailscale without port forwarding. Borrowed directly from HiveOS's architecture.

**2. Auto-discovery via UDP broadcast.**

New nodes broadcast on port 41337 to find the gateway. The gateway listens for broadcasts and responds with its address. Fallback chain: UDP broadcast -> mDNS -> static config. Zero manual network configuration in 90% of cases.

**3. Per-GPU architecture detection for AMD.**

This was surprisingly hard. AMD GPUs report different capabilities depending on architecture (Vega vs RDNA vs RDNA2 vs RDNA3). We parse `rocm-smi` output and map each GPU to its architecture to determine ROCm compatibility, VRAM reporting accuracy, and supported features. NVIDIA was trivial by comparison (nvidia-smi just works).

**4. BitNet CPU inference as a first-class backend.**

Microsoft's BitNet (1-bit ternary weights, trained from scratch) runs on pure CPU at 2-6x the speed of FP16 inference with ~70% less energy. We treat it as just another backend: the agent detects the BitNet binary, starts the server on port 8082, and the gateway routes requests transparently. A machine with zero GPUs becomes a useful inference node.

Performance on CPU:
- Ryzen 9 7950X (32T): ~25-40 tok/s (bitnet-b1.58-8B)
- Ryzen 7 5800X (16T): ~40-60 tok/s (bitnet-b1.58-2B)
- Xeon E5-2690 v4 (28T): ~30-50 tok/s (bitnet-b1.58-2B)

**5. Farm Hash identity.**

Each cluster gets a deterministic hash (SHA256 of hardware signature) called a Farm Hash. All nodes in a cluster share the same Farm Hash. This is the cluster identity -- you add the Farm Hash to the gateway and all nodes with that hash are part of your cluster. Borrowed from mining pool registration patterns.

**6. Flight sheets for model deployment.**

A flight sheet is a declarative config that says "these models should be running on these nodes (or all nodes, or nodes with this tag)." Apply a flight sheet and the gateway sends install commands to the relevant nodes. This replaces SSH-ing into each machine to pull models.

### Numbers

- 200+ API endpoints (REST, SSE, OpenAI-compatible proxy, Prometheus)
- 144 tests (101 gateway, 28 agent, 15 CLI) -- strict TypeScript, all passing
- 60+ CLI commands
- 11 database tables (SQLite)
- 15+ shared type definitions (agent <-> gateway <-> CLI contract)
- Zero external runtime dependencies for the agent
- Sub-5ms request routing on LAN

### Benchmark data (real hardware)

| GPU | Model | tok/s | VRAM used |
|-----|-------|-------|-----------|
| RTX 4090 | llama3.1:70b-q4 | 35-45 | 38 GB |
| RTX 3090 | llama3.1:8b | 80-120 | 6.4 GB |
| RTX 4070 Ti Super | llama3.1:8b | 65-95 | 6.4 GB |
| RX 7900 XTX | llama3.1:8b (ROCm) | 40-70 | 6.4 GB |
| Ryzen 9 7950X (CPU) | bitnet-b1.58-2B | 40-60 | 0.4 GB RAM |

### What's shipped

- ISO builder (debootstrap Ubuntu 24.04, GRUB BIOS+UEFI, PXE boot)
- Gateway with full REST API, dashboard, SSE, webhooks
- Agent with GPU detection, auto-discovery, watchdog, overclock
- CLI with chat, deploy, top, drain, cordon, doctor, benchmarks
- MCP server (AI agents can manage the cluster via tool calls)
- Docker Compose deployment
- CI pipeline (test -> build -> release)

### What's next

- vLLM backend support
- Intel Arc GPU detection
- Cluster-wide model rebalancing (auto-migrate models when VRAM pressure changes)
- Multi-gateway federation (multiple clusters, one pane of glass)

### License

MIT. No "open core." No premium tier. No telemetry.

Would appreciate feedback on the architecture, the push-vs-pull tradeoff, the AMD detection approach, and whether BitNet CPU inference is something others are experimenting with in production-adjacent setups.

---

*Built by a homelab person for homelab people. The octopus mascot is optional but recommended.*

## Prepared Comment Replies

### "Why not Kubernetes?"

Because most people with 2-8 GPU machines don't want to become a platform engineering team just to run local inference. K8s solves a much broader problem and brings proportionally more complexity. TentaCLAW OS is deliberately narrow: detect GPUs, register nodes, deploy models, route inference. If you already have K8s and love it, this probably isn't for you. If you have a Proxmox homelab and want to stop SSH-ing into each box, this might be.

### "Why not just use Ollama directly?"

Ollama is great for single-node inference and we use it as the default GPU backend. But Ollama doesn't give you: multi-node auto-discovery, unified dashboard across nodes, smart routing to the node with the right model and free VRAM, flight sheet deployment, health scoring, BitNet CPU backend, or one CLI for the whole cluster. TentaCLAW sits on top of Ollama (and other backends), not instead of it.

### "How is this different from GPUStack?"

GPUStack is closer to what we're doing than Ollama. Key differences: TentaCLAW does zero-config auto-discovery (UDP broadcast), has a bootable ISO/PXE flow, includes BitNet CPU inference as a first-class backend, has the push-based telemetry model (nodes push to gateway, not gateway pulling from nodes), and has the flight sheet deployment concept. GPUStack requires more manual node setup and is more focused on NVIDIA. Both are valid approaches for different preferences.

### "Why TypeScript for a systems tool?"

The agent and gateway are not kernel-level systems code. They're network daemons that push JSON over HTTP. TypeScript gives us: strict typing across agent/gateway/CLI boundaries (shared type definitions), fast iteration, and a huge ecosystem. The agent has zero external dependencies. The performance bottleneck is always GPU inference, never the management layer. The ISO builder and boot scripts are Bash, which is the right tool for that job.

### "Is the octopus necessary?"

No. But the cluster management problem is real, the technical stack is real, and having a personality in the terminal makes the daily experience of managing a homelab slightly less soul-crushing. CLAWtopus is the mascot, not the product.
