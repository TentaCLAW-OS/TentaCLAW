# TentaCLAW Launch — Channel-Specific Posts

## Reddit: r/selfhosted

**Title:** I built a self-hosted "inference cluster OS" that turns any GPUs into one AI pool -- looking for brutally honest feedback

I've been running AI models on my homelab (4 Proxmox nodes, 9 AMD GPUs, 104 GB VRAM) and got tired of managing each GPU server individually. So I built TentaCLAW.

**What it does:**
- Auto-discovers GPUs across your network (NVIDIA, AMD, Intel)
- Routes inference requests to the best available GPU
- Proxmox-style dashboard with real-time GPU metrics
- OpenAI-compatible API (drop-in replacement)
- Self-heals when nodes go down
- Security by default (auth, TLS, rate limiting, signed releases)

**What it's NOT:**
- Not a cloud service -- runs entirely on YOUR hardware
- Not a mining OS (though miners transitioning to AI is a big use case)
- Not production-ready for Fortune 500 yet (v0.3 alpha)

Stack: TypeScript, React, SQLite, systemd. 864 tests. MIT license.

Screenshots: [dashboard showing live cluster]

GitHub: [link]

I'm specifically looking for feedback on:
1. Install friction -- how long does it take you to get a working cluster?
2. What GPUs are you running that I should test against?
3. What's the #1 missing feature for your homelab?

---

## Reddit: r/LocalLLaMA

**Title:** TentaCLAW -- open source inference cluster that's 29% faster with SGLang + auto-routes between vLLM/SGLang/llama.cpp backends

Benchmarked my 4-node AMD cluster (9 GPUs, 104 GB VRAM):

| Backend | Tokens/sec (Llama 8B) | TTFT (P50) |
|---------|----------------------|------------|
| SGLang | ~16,200 | ~45ms |
| vLLM | ~12,500 | ~62ms |
| llama.cpp | ~8,400 | ~95ms |

TentaCLAW auto-selects the fastest backend per request type:
- Multi-turn chat → SGLang (RadixAttention cache hits 75-95%)
- Unique prompts → vLLM (better at cold requests)
- CPU offloading → llama.cpp (when model doesn't fit in VRAM)

Also supports: structured output (JSON schema), multi-LoRA serving, FP8 KV cache on Hopper GPUs, and speculative decoding (EAGLE-3: 3-6x speedup).

OpenAI-compatible API so any existing app works as a drop-in.

864 tests. MIT license. [GitHub link]

---

## Reddit: r/homelab

**Title:** Turned my Proxmox homelab into an AI inference cluster -- 4 nodes, 9 GPUs, one dashboard

[Photo of server rack / screenshot of Proxmox + TentaCLAW dashboard side by side]

**The setup:**
- 4x Proxmox VE nodes
- 9x AMD GPUs (mix of consumer + workstation)
- 104 GB total VRAM
- 20 models loaded simultaneously

**What TentaCLAW gives me:**
- Single dashboard for all GPUs across all nodes
- GPU temp, utilization, VRAM, power monitoring
- One-command model deployment: `clawtopus deploy llama3.1:8b`
- Auto-discovery -- plug in a new GPU node, it appears in the dashboard
- Failover -- unplug a node, models auto-migrate

Built this because HiveOS exists for mining but there was nothing for AI inference.

MIT license, 864 tests, runs on any Linux box with a GPU.

GitHub: [link]

**Hardware I've tested on:**
- AMD RX 6600/6700/6900 XT
- AMD MI series (via ROCm)
- NVIDIA RTX 3090/4090 (friends' setups)
- CPU-only nodes (for small models via llama.cpp)

---

## X (Twitter) Thread

1/ I built an open-source "inference cluster OS" that turns scattered GPUs into one AI pool.

HiveOS did this for mining. Nothing existed for AI inference.

So I built TentaCLAW.

[screenshot of dashboard]

2/ The problem:
- Running AI on your own hardware = managing 10 different servers
- Cloud APIs cost $15/M tokens
- Self-hosting is 18x cheaper but the tooling is painful

TentaCLAW makes self-hosted inference plug-and-play.

3/ What it does:
- Auto-discovers GPUs (any brand)
- Routes requests to the best GPU
- Self-heals on failure
- Proxmox-style dashboard
- 111 CLI commands
- OpenAI-compatible API

4/ My cluster: 4 nodes, 9 AMD GPUs, 104 GB VRAM, 20 models.

Benchmarks:
- SGLang: 16,200 tok/s (29% faster than vLLM)
- LMCache: 7x TTFT improvement
- EAGLE-3: 3-6x decode speedup

5/ Security by default:
- Auth ON (API keys, SHA-256 hashed)
- TLS auto-generated
- Rate limiting (60/600 rpm)
- Signed releases (cosign + SLSA L3)
- 82 security tests including fuzz testing

6/ Open source. MIT license. 864 tests.

Try it:
```
curl -fsSL https://tentaclaw.io/install | bash
```

GitHub: [link]
Discord: [link]

"Per-token pricing is a scam." -- CLAWtopus

---

## LinkedIn

**Why I built an open-source alternative to per-token AI pricing**

The AI inference market is $117.8B in 2026. Most of that money goes to cloud API providers charging per-token.

But the math doesn't add up for high-volume users:
- Self-hosted inference breaks even in under 4 months
- At enterprise scale, it's 18x cheaper than Model-as-a-Service APIs
- On-prem is 8x cheaper per million tokens vs cloud IaaS

The problem? The tooling gap. Mining has HiveOS. Kubernetes has... Kubernetes. AI inference had nothing that makes multi-GPU management simple.

So I built TentaCLAW OS -- an open-source inference cluster operating system.

Key capabilities:
- Unified GPU management across any hardware (NVIDIA, AMD, Intel)
- Intelligent request routing with KV cache affinity
- Security by default (auth, TLS, signed releases)
- EU AI Act compliance features
- Kubernetes operator (coming next)

Running on my 4-node cluster: 9 GPUs, 104 GB VRAM, 20 models, 864 tests passing.

This matters because:
1. Inference costs are 66% of all AI compute spending
2. EU AI Act enforcement starts August 2, 2026
3. The mining-to-AI transition has millions of idle GPUs

MIT license. Production-ready security. Enterprise features coming Q2.

[Link to GitHub]
