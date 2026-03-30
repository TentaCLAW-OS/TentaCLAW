# Product Hunt Listing

## Product Name
TentaCLAW OS

## Tagline
Turn scattered GPUs into one self-healing AI inference cluster. Zero config.

## Description

TentaCLAW OS is an open-source operating system for AI inference clusters. It does for local AI what HiveOS did for GPU mining: detect hardware, register nodes, deploy models, and manage everything from one dashboard and CLI.

**The problem**: You have GPU machines running local AI. Managing them individually is painful -- SSH into each box, check if services are running, track which models are loaded where, deploy manually, monitor temps and VRAM by hand.

**The solution**: Flash a USB or run one install command. The node auto-discovers the gateway on your LAN, registers itself, and starts pushing stats. Deploy models with one command. Route inference requests automatically. Self-heal when things crash.

No Kubernetes. No cloud dependency. No YAML orchestration. Just your hardware, running your models, managed by one system.

## Key Features

### Zero-Config Auto-Discovery
New nodes find the gateway automatically via UDP broadcast. No manual network configuration. Boot and go.

### Mixed GPU Support
NVIDIA, AMD, and Intel GPUs detected automatically. Plus BitNet 1-bit CPU inference -- any spare machine becomes an inference node without a GPU.

### OpenAI-Compatible API
Point any OpenAI client at your cluster. `/v1/chat/completions` and `/v1/models` just work. Smart routing sends requests to the best available node.

### Web Dashboard
Real-time view of all nodes, GPUs, VRAM, temperatures, models, health scores. Live-updating via SSE.

### CLAWtopus CLI
60+ commands for cluster management. Deploy models, chat with your cluster, drain nodes, run diagnostics, view benchmarks. The octopus on your command line.

### Flight Sheet Deployment
Declarative model configs. "These models on these nodes." Apply once, the gateway handles the rest. Tag-based targeting.

### Self-Healing Watchdog
Crashed services get restarted automatically. Gateway reroutes around dead nodes. The cluster keeps running.

### BitNet CPU Inference
Microsoft's 1-bit LLM architecture runs on pure CPU at 2-6x speed with 70% less energy. Old servers become inference nodes. Zero GPU cost.

### Bootable ISO
Flash to USB, boot from it. BIOS and UEFI. PXE for network boot. The full OS experience.

### 200+ API Endpoints
Full REST API, SSE events, Prometheus metrics, webhook notifications. Integrate with anything.

## Tech Stack
- **Gateway**: TypeScript, Hono framework, SQLite
- **Agent**: TypeScript (zero external dependencies)
- **CLI**: TypeScript (zero external dependencies)
- **ISO Builder**: Bash, debootstrap (Ubuntu 24.04 base)
- **144 tests**, strict TypeScript, all passing

## Pricing
Free. Open source. MIT licensed. No "open core." No premium tier. No telemetry.

## Categories
- Developer Tools
- Open Source
- Artificial Intelligence
- Self-Hosted
- DevOps

## Maker Story

I started with one GPU running Ollama. Then two machines. Then four. Suddenly I had a "cluster" held together by SSH sessions and bash scripts.

Mining had this problem years ago. HiveOS solved it elegantly: flash, boot, manage from one place. AI inference in 2026 still didn't have that.

So I built TentaCLAW OS.

The first version was just a boot script and a stats daemon. Then I needed a dashboard. Then a CLI. Then auto-discovery so I'd stop hardcoding IP addresses. Then model deployment so I'd stop SSH-ing into each box. Then BitNet support because I had a spare CPU-only machine that was doing nothing.

Now it's a full stack: gateway with 200+ endpoints, agent daemon, 60+ command CLI, bootable ISO, web dashboard, MCP server for AI agent integration, and an octopus mascot named CLAWtopus who lives in the terminal and has opinions about your VRAM usage.

The philosophy is simple: if you own the hardware, you should own the inference. No per-token pricing. No cloud dependency. No permission needed.

Is it overengineered for a homelab? Probably. Do I regret it? Not even a little.

Eight arms. One mind. Zero compromises.

## Links
- **GitHub**: https://github.com/TentaCLAW-OS/TentaCLAW
- **Website**: https://www.tentaclaw.io

## Media

### Suggested Screenshots (in order)
1. Web dashboard showing cluster overview with multiple nodes, GPU stats, health scores
2. Terminal showing CLAWtopus boot splash and GPU detection
3. CLI showing `clawtopus status` with cluster summary
4. CLI showing `clawtopus chat` with live inference
5. Architecture diagram (nodes pushing to gateway)

### Suggested GIF
Boot-to-inference demo: install -> GPU detect -> register -> deploy model -> run inference (30 seconds)

## First Comment (Maker)

Hey Product Hunt! I'm the maker of TentaCLAW OS.

Quick context: I run a homelab with 9 GPUs across 4 nodes (mix of NVIDIA and AMD) plus a CPU-only node running BitNet. Managing them individually was the kind of tedious that makes you question your life choices.

TentaCLAW OS is the tool I wished existed. Flash a node, boot it, and it joins your cluster. Deploy models from one CLI. Monitor everything from one dashboard. Let the watchdog handle the crashes.

A few things I'm especially proud of:

- **Auto-discovery**: Nodes find the gateway via UDP broadcast. No manual network config. This was surprisingly hard to get right across different network topologies.

- **BitNet integration**: CPU-only machines as inference nodes. Old hardware doing useful work without GPUs. The gateway routes transparently between GPU and CPU backends.

- **The push model**: Agents push stats to the gateway (instead of the gateway polling nodes). Works through NAT, firewalls, and Tailscale without port forwarding. Borrowed from HiveOS's architecture.

The whole thing is MIT licensed. No cloud. No telemetry. 144 tests passing.

I'd love feedback on:
- What features would make this useful for YOUR setup?
- Anyone running mixed GPU vendors in a cluster?
- What inference backends should we prioritize next? (vLLM is on the roadmap)

Thanks for checking it out. CLAWtopus says hi.
