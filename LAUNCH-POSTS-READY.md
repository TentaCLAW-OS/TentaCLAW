# TentaCLAW v1.0.0 "Sucker" — Launch Posts (Ready to Paste)

> All copy below is final and corrected. AMD GPU support is REAL (tested on 9 AMD GPUs).
> Post in this order, spaced 1 hour apart.

---

## 1. HACKER NEWS (Post first — 8:00 AM PT Tue/Wed/Thu)

**Submit to:** https://news.ycombinator.com/submit

**Title:**
```
Show HN: TentaCLAW OS – Turn scattered GPUs into one AI inference pool
```

**URL:** `https://github.com/TentaCLAW-OS/TentaCLAW`

**Maker comment (post within 60 seconds):**
```
Hey HN — I built TentaCLAW OS because I have a homelab cluster and was
tired of manually wrangling distributed inference across machines.

It's a self-hosted GPU cluster management platform. Think HiveOS but
for AI inference instead of mining.

What's built:
- Gateway with 150+ API endpoints (782 tests passing)
- Dashboard: Proxmox-style 3-panel React SPA with 12 tabs, real-time
  SSE, resource tree, embedded terminal, AI chat
- CLI: 111 commands with sparklines, progress bars, ASCII art
- 6 backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- Auto-discovery via UDP broadcast (zero config)
- OpenAI-compatible API
- MCP server for AI agents
- One-line install + setup wizard

Currently running on my Proxmox cluster: 4 nodes, 9 AMD GPUs (Vega FE,
Vega 56/64, RX 5700 XT, RX 5500), 104GB VRAM, 20 models loaded including
llama3.1:70b and mixtral. Health score: A (100/100).

Tech: TypeScript gateway (Hono), React dashboard, systemd-hardened agent.

Known gaps: federation between clusters is early, the ISO builder needs
more hardware testing, NVIDIA GPU testing is limited (built on AMD).

Demo: https://tentaclaw.io
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

Would love feedback on install friction and which backends to prioritize.
If you try it and hit a bug, please open an issue — I'll fix it same day.
```

---

## 2. REDDIT r/LocalLLaMA (Post 1 hour after HN — 9:00 AM PT)

**Title:**
```
I built a self-hosted platform that turns scattered GPUs into one inference pool — open source, 9 AMD GPUs running right now, Proxmox-style dashboard
```

**Body:**
```
Hey r/LocalLLaMA — I've been building TentaCLAW OS and just tagged v1.0.

**The problem:** I have a 4-node Proxmox cluster with mixed AMD GPUs
(Vega Frontier Edition, Vega 56/64, RX 5700 XT, RX 5500). Running
distributed inference meant SSH-ing into each one, manually configuring
Ollama, and hoping nothing crashed overnight.

**What TentaCLAW does:**
- Install on any machine → it auto-discovers other nodes via UDP broadcast
- Proxmox-style dashboard with 12 tabs (summary, metrics, models, terminal, chat, billing...)
- 6 inference backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- 111 CLI commands with sparklines, progress bars, and CLAWtopus personality
- OpenAI-compatible API (drop-in replacement)
- MCP server so AI agents can use your cluster
- Drag-and-drop model deployment from the dashboard
- Built-in billing for shared clusters

**My cluster right now:**
- 4 nodes, 9 AMD GPUs, 104GB total VRAM
- 20 models loaded (llama3.1:70b, mixtral:8x7b, codellama:13b, qwen3:14b, gemma2:9b...)
- Health: A (100/100)
- Power: 422W ($1.22/day)

**Install:**
```
curl -fsSL https://tentaclaw.io/install | bash
```

Or Docker:
```
git clone https://github.com/TentaCLAW-OS/TentaCLAW && cd TentaCLAW
docker compose up
```

**Screenshot:** https://github.com/TentaCLAW-OS/TentaCLAW/blob/master/assets/screenshots/live-cluster-dashboard.png

**GitHub:** https://github.com/TentaCLAW-OS/TentaCLAW
**Website:** https://tentaclaw.io

MIT licensed. 782 tests passing. What would you run on a 9-GPU AMD cluster?
```

---

## 3. REDDIT r/selfhosted (Post 2 hours after HN — 10:00 AM PT)

**Title:**
```
TentaCLAW OS — self-hosted GPU cluster management for AI inference (HiveOS-style dashboard, 12 tabs, zero config)
```

**Body:**
```
I built TentaCLAW OS — a self-hosted platform that manages GPU inference
clusters the way HiveOS manages mining rigs.

**What it does:**
- Auto-discovers GPU nodes on your network (zero config, UDP broadcast)
- Proxmox-style web dashboard with 12 tabs, resource tree, embedded terminal
- Manages 6 inference backends (Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2)
- OpenAI-compatible API so your existing code just works
- Flight sheets (deployment templates), alerts, benchmarks, billing
- Real-time monitoring with sparklines, GPU temps, VRAM bars, health scoring

**Running on my Proxmox cluster:** 4 nodes, 9 AMD GPUs, 104GB VRAM,
20 models, Health A. Dashboard screenshot:
https://github.com/TentaCLAW-OS/TentaCLAW/blob/master/assets/screenshots/live-cluster-dashboard.png

**Install:**
```
curl -fsSL https://tentaclaw.io/install | bash
```

MIT licensed. No telemetry. No cloud dependency.
Your GPUs, your data, your rules.

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
```

---

## 4. TWITTER/X THREAD (Post alongside HN)

**Tweet 1:**
```
I just open-sourced TentaCLAW OS — turn scattered GPUs into one AI inference pool.

Like HiveOS but for AI instead of mining. 🐙

4 nodes, 9 AMD GPUs, 104GB VRAM, 20 models loaded.
Health: A (100/100). Power: $1.22/day.

Per-token pricing is a scam.

[Attach dashboard screenshot]
```

**Tweet 2:**
```
The problem: GPUs spread across machines. Homelab rigs, old miners, office PCs with idle RTX cards.

Running distributed inference = juggling Docker, SSH, configs, and prayers.

TentaCLAW makes those machines into one cluster automatically.
Zero config. UDP auto-discovery. Just works.
```

**Tweet 3:**
```
What you get:

🐙 Proxmox-style dashboard (12 tabs, real-time, embedded terminal)
🐙 111 CLI commands with sparklines + progress bars
🐙 6 backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
🐙 OpenAI-compatible API
🐙 MCP server for AI agents
🐙 Drag-and-drop model deployment

[Attach dashboard screenshot]
```

**Tweet 4:**
```
Get running in 60 seconds:

curl -fsSL tentaclaw.io/install | bash

Or Docker:
git clone https://github.com/TentaCLAW-OS/TentaCLAW
docker compose up

Dashboard at localhost:8080/dashboard

[Attach install GIF or screenshot]
```

**Tweet 5:**
```
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Website: https://tentaclaw.io

Star ⭐ if you want to stop paying per-token.

Eight arms. One mind. Zero compromises. 🐙

Feedback welcome — what hardware/backends should I prioritize?
```

---

## HN REBUTTAL TABLE (have these ready)

| They say | You reply |
|----------|-----------|
| "Just use K8s" | "K8s is great but overkill for 5-50 GPU inference. TentaCLAW is purpose-built — auto-discovers GPUs, routes by VRAM/temp, needs zero K8s knowledge. It's closer to HiveOS than K8s." |
| "Why not Docker Swarm?" | "Swarm doesn't understand GPUs. TentaCLAW detects GPU model, VRAM, thermal state, and schedules inference accordingly. GPU-aware at every layer." |
| "Just a wrapper around Ollama" | "Ollama is one of 6 backends. TentaCLAW adds multi-node orchestration, auto-discovery, dashboard, billing, and cluster-wide scheduling. Ollama is the engine; TentaCLAW is fleet management." |
| "Why TypeScript?" | "Gateway + dashboard are TypeScript (fast to ship, easy contributions). GPU detection and OS scripts are POSIX shell. Agent talks HTTP/SSE. It works." |
| "How about AMD?" | "Running on 9 AMD GPUs right now — Vega FE, Vega 56/64, RX 5700 XT, RX 5500. 104GB VRAM across 4 Proxmox nodes. AMD is a first-class citizen." |
| "vs GPUStack?" | "GPUStack (4.7K stars) is Python, 2 backends, no CLI, no billing, no flight sheets, no auto-discovery. TentaCLAW has 6 backends, 111 CLI commands, built-in billing, MCP server, and a Proxmox-style dashboard." |
| "Will it scale?" | "Designed for it — federation, namespaces, SSO, multi-tenant billing. Tested on 4 nodes. Looking for people with bigger clusters to test." |
