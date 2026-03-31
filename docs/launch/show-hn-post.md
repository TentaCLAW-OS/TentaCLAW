# Show HN: TentaCLAW -- Turn scattered GPUs into one AI inference pool (open source)

Hi HN -- I built TentaCLAW, an open-source inference cluster OS that unifies
your GPUs (any brand, any machine) into a single self-healing pool for running
AI models.

**The problem:** Running AI models on your own hardware means juggling individual
GPU servers, manually routing requests, restarting crashed processes, and
monitoring each machine separately. Cloud API pricing ($15/M tokens for
frontier models) makes this worse -- self-hosting is 18x cheaper at scale,
but the tooling gap is massive.

**What TentaCLAW does:**

- Auto-discovers GPUs across your network (NVIDIA, AMD, Intel)
- Routes inference requests to the best GPU based on load, cache state, and model
- Self-heals: detects GPU failures, migrates models, restarts backends
- Proxmox-style dashboard with 12 tabs (metrics, GPU health, models, billing)
- 111 CLI commands with personality (CLAWtopus the octopus)
- OpenAI-compatible API -- drop-in replacement for any app using OpenAI SDK
- 6 backends: vLLM, SGLang, llama.cpp, Ollama, BitNet, MLX
- Security by default: auth, rate limiting, TLS, signed releases

**My setup:** 4 Proxmox nodes, 9 AMD GPUs, 104 GB VRAM, running 20 models.
The dashboard shows real data from my cluster:
[screenshot link]

**What I learned building this:**

1. Self-hosted inference breaks even vs cloud APIs in under 4 months
2. GPU memory is NOT zeroed between processes -- a real security concern for multi-tenant
3. SGLang is 29% faster than vLLM for multi-turn conversations (RadixAttention)
4. The mining-to-AI transition is real -- millions of idle GPUs looking for software

**Stack:** TypeScript (Hono server), React (Vite dashboard), SQLite, systemd.
864 tests. MIT license. Signed releases (cosign + SLSA L3).

Repo: https://github.com/TentaCLAW-OS/TentaCLAW
Website: https://tentaclaw.io
Discord: https://discord.gg/tentaclaw

I'd love feedback on: setup friction, security posture, and which backends/features
to prioritize next. Happy to answer any questions about inference infrastructure.

---

## Founder's Follow-Up Comment (post within 5 minutes)

For context on why I built this:

I was running multiple vLLM instances across my homelab and realized I was
spending more time managing the infrastructure than actually using the models.
Every time I added a GPU, I had to manually configure routing, monitoring,
and failover.

HiveOS solved this for GPU mining -- you plug in a rig, it auto-discovers,
and you manage everything from one dashboard. There's nothing equivalent for
AI inference. GPUStack comes closest (~5K stars) but it's cluster management
only, not a full OS experience.

TentaCLAW is my attempt at the "HiveOS for AI inference" -- one install, one
dashboard, one CLI. Auto-everything.

Technical choices worth noting:
- TypeScript for the gateway because it's the right balance of speed and ecosystem
- SQLite (not Postgres) because clusters shouldn't need a separate database server
- Hono over Express because it's 3x faster and supports Web Standard APIs
- In-memory rate limiting (not Redis) to keep the zero-dependency promise

What's next: Kubernetes operator (Helm chart), NVIDIA Dynamo integration for
disaggregated prefill/decode, and EU AI Act compliance features.
