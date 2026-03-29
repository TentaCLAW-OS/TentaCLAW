<p align="center">
  <pre>

  <span style="color:#00FFFF">        ╭──────────────────────────────────────────────────────────╮</span>
  <span style="color:#00FFFF">    ╭───┤  <span style="color:#F0F0F0">TENTACLAW OS — HiveOS for AI Inference Clusters</span>  ├───╮</span>
  <span style="color:#00FFFF">   ╭─┤                                                         ╰─┤</span>
  <span style="color:#00FFFF">   │╭┴───────────────────────────────────────────────────────────┴╮│</span>
  <span style="color:#00FFFF">   ││                                                               ││</span>
  <span style="color:#8C00C8">   ││           ██████╗ ████████╗ ██████╗ ███╗   ██╗               ││</span>
  <span style="color:#8C00C8">   ││           ██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║               ││</span>
  <span style="color:#8C00C8">   ││           ██████╔╝   ██║   ██║   ██║██╔██╗ ██║               ││</span>
  <span style="color:#8C00C8">   ││           ██╔══██╗   ██║   ██║   ██║██║╚██╗██║               ││</span>
  <span style="color:#8C00C8">   ││           ██║  ██║   ██║   ╚██████╔╝██║ ╚████║               ││</span>
  <span style="color:#8C00C8">   ││           ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝               ││</span>
  <span style="color:#008C8C">   ││           ██████╗ ███████╗ █████╗ ██████╗ ██╗   ██╗███████╗   ││</span>
  <span style="color:#008C8C">   ││           ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║   ██║██╔════╝   ││</span>
  <span style="color:#008C8C">   ││           ██████╔╝█████╗  ███████║██████╔╝██║   ██║███████╗   ││</span>
  <span style="color:#008C8C">   ││           ██╔══██╗██╔══╝  ██╔══██║██║  ██║╚██╗ ██╔╝╚════██║   ││</span>
  <span style="color:#008C8C">   ││           ██║  ██║███████╗██║  ██║██║  ██║ ╚████╔╝ ███████║   ││</span>
  <span style="color:#008C8C">   ││           ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝   ││</span>
  <span style="color:#00FFFF">   │╰───────────────────────────────────────────────────────────────╯│</span>
  <span style="color:#00FFFF">   │  <span style="color:#F0F0F0">Eight arms. One mind.</span>                                            │</span>
  <span style="color:#00FFFF">   ╰─────────────────────────────────────────────────────────────────╯</span>

  </pre>

  <h2>HiveOS for AI inference clusters</h2>
  <p><strong>TentaCLAW OS</strong> turns your pile of GPUs into a self-managing local AI cluster — auto-discovery, node health, model deployment, and one CLI to control the whole tank.</p>

  <p align="center">
    <a href="https://www.TentaCLAW.io"><img src="https://img.shields.io/badge/Web-TentaCLAW.io-00FFFF?style=for-the-badge" alt="Website"></a>
    <a href="https://github.com/TentaCLAW-OS"><img src="https://img.shields.io/badge/GitHub-TentaCLAW--OS-8C00C8?style=for-the-badge&logo=github" alt="GitHub"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-8C00C8?style=for-the-badge" alt="License"></a>
  </p>
</p>

> Flash the ISO. Boot the node. Let CLAWtopus do the boring stuff.

### Why it exists

- **Turn spare GPUs into one cluster**
- **Skip manual CUDA-and-dashboard nonsense**
- **Run local inference on hardware you actually own**
- **Get HiveOS-style visibility for AI nodes**

### Launch hooks

- **HiveOS for AI**
- **Eight arms. One mind.**
- **Per-token is a scam. Run local.**

### Start here

- [Quick Start](docs/QUICKSTART.md)
- [Build Guide](BUILD.md)
- [Brand Guide](BRAND.md)
- [Launch Plan](docs/LAUNCH.md)
- [Launch Checklist](docs/LAUNCH-CHECKLIST.md)
- [Release Copy](docs/RELEASE.md)
- [Social Launch Kit](docs/SOCIAL.md)
- [Final Launch Posts](docs/POSTS-FINAL.md)
- [Demo Production Script](docs/DEMO-SCRIPT.md)
- [Screenshot Shotlist](docs/SCREENSHOT-SHOTLIST.md)
- [Hacker News Final](docs/HN-FINAL.md)
- [Naming Audit](docs/NAMING-AUDIT.md)

---

## What Even Is This?

> **HiveOS for AI**

Like [HiveOS](https://hiveos.farm/) revolutionized GPU mining by making 1000-rig farms manageable from one dashboard, **TentaCLAW OS** makes AI inference clusters accessible to non-technical users.

Instead of mining rigs, you manage AI inference nodes.
Instead of hashrate, you track tokens/second.
Instead of flight sheets for miners, you have flight sheets for models.

**CLAWtopus** handles the boring stuff. You do the interesting stuff.

---

## What's New in v0.2.0

- **CLAWtopus CLI** — CLAWDIA rebranded. Inference router + cluster management with `clawtopus chat`, `models`, `health`, `tags`, `alerts`, `benchmarks`
- **Inference Playground** — Chat with your cluster models directly from the dashboard
- **Node Tags** — Label nodes as `production`, `inference`, `staging` etc. Filter by tag
- **SSH Key Management** — Push SSH keys to nodes via API, stored in DB with fingerprints
- **Model Pull Progress** — Track download progress when deploying models to nodes
- **Auto-Discovery** — UDP broadcast on port 41337. Agents and gateways find each other on LAN
- **Daphney Bridge** — SSE endpoint at `/api/v1/daphney/stream` for DaphneyBrain UE5 integration
- **Model Search** — Browse Ollama model catalog with VRAM requirements and cluster fit check
- **52 tests** — 42 gateway (unit + integration) + 10 agent tests, all passing

## Features

| | |
|---|
| <span style="color:#00FF88">&#10003;</span> **Zero-config GPU detection** — NVIDIA, AMD, Intel (eventually) |
| <span style="color:#00FF88">&#10003;</span> **Farm Hash registration** — one hash identifies your entire cluster |
| <span style="color:#00FF88">&#10003;</span> **HiveOS-style push model** — nodes push stats, receive commands |
| <span style="color:#00FF88">&#10003;</span> **One-click model deployment** via flight sheets |
| <span style="color:#00FF88">&#10003;</span> **Auto-scaling inference** across heterogeneous hardware |
| <span style="color:#00FF88">&#10003;</span> **CLAWtopus ASCII art** — because your terminal deserves better |

---

## Per-Token Is a Scam

That line is the hook, not the whole product.

The real point is simpler: if you already own GPUs, you should be able to run inference on them without building a tiny DevOps company around your homelab.

**TentaCLAW OS** gives local AI the missing operating layer:
- bootable node setup
- auto-discovery on the LAN
- cluster registration and health
- model deployment and routing
- one dashboard and one CLI for the whole mess

Own the hardware. Own the inference. Own the failure modes too.

---

## Quick Start — ISO (Production)

```bash
# 1. Download the ISO
wget https://github.com/TentaCLAW-OS/TentaCLAW-OS/releases/latest/download/TentaCLAW-OS-0.1.0-amd64.iso

# 2. Flash to USB
sudo dd if=TentaCLAW-OS-0.1.0-amd64.iso of=/dev/sdX bs=4M status=progress

# 3. Boot from USB
# 4. Watch CLAWtopus do her thing
# 5. That's it. Seriously.
```

## Quick Start — Gateway + Dashboard (Dev)

Try the full stack on **any machine** (Windows, Mac, Linux) — no GPUs needed:

```bash
# Install dependencies
cd gateway && npm install
cd ../agent && npm install

# Terminal 1 — Start the HiveMind Gateway
cd gateway && npm run dev
# → http://localhost:8080/dashboard

# Terminal 2 — Start a mock agent (fake GPUs)
cd agent && npx tsx src/index.ts --mock

# Terminal 3 — Start a second mock node (optional)
cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4
```

The mock agent generates realistic stats for fake GPUs (RTX 3090, 4070 Ti Super, etc.) and pushes them to the gateway every 5 seconds. Open the dashboard to see your simulated cluster.

## CLAWtopus CLI

The inference router and cluster management tool. Eight arms on the command line.

```bash
cd cli && npm install && npm run build

# Cluster overview
npx clawtopus status

# List nodes & models
npx clawtopus nodes
npx clawtopus models

# Health score (0-100)
npx clawtopus health

# Interactive chat with a cluster model
npx clawtopus chat --model llama3.1:8b

# Deploy a model to all nodes
npx clawtopus deploy llama3.1:8b

# Tag nodes for organization
npx clawtopus tags add NODE-001 production
npx clawtopus tags nodes production

# View alerts and benchmarks
npx clawtopus alerts
npx clawtopus benchmarks

# Flight sheets
npx clawtopus flight-sheets
npx clawtopus apply <sheet-id>

# Send commands
npx clawtopus command TENTACLAW-FARM7K3P-node1 install_model --model hermes3:8b
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  YOU (The Human)                                                │
│                                                                  │
│  1. Flash ISO to USB                                            │
│  2. Boot node                                                   │
│  3. CLAWtopus detects GPUs, registers with Farm Hash            │
│  4. You add Farm Hash to dashboard                              │
│  5. One-click model deployment                                   │
│  6. CLAWtopus keeps everything running                           │
│                                                                  │
│  "Eight arms. One mind."                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
  ┌──────────────┐      ┌───────────────────────────────────────┐
  │ CLAWtopus    │      │      HiveMind Gateway (:8080)         │
  │ CLI          │─────►│                                       │
  │              │      │  REST API    Web Dashboard    SSE     │
  │  clawtopus   │      │  /api/v1/*   /dashboard       Events  │
  │  status      │      │  /v1/*       /daphney         UDP     │
  └──────────────┘      └──────────────────┬────────────────────┘
                                           │
                    POST stats ◄───────────┼──────────► Commands
                    every 10s              │            in response
                                           │
        ┌──────────────────────────────────┼────────────────────────┐
        │                                  │                        │
  ┌─────┴─────┐                    ┌───────┴──────┐          ┌─────┴──────┐
  │  Node 1   │                    │   Node 2     │          │  Node 3    │
  │  Agent    │                    │   Agent      │          │  Agent     │
  │           │                    │              │          │            │
  │  RTX 3090 │                    │  RTX 4090 x2 │          │  RTX 3060  │
  │  Ollama   │                    │  Ollama      │          │  Ollama    │
  │  Farm:7K3P│                    │  Farm:7K3P   │          │  Farm:7K3P │
  └───────────┘                    └──────────────┘          └────────────┘
```

### Components

| Component | Language | Description |
|-----------|----------|-------------|
| **Gateway** (`gateway/`) | TypeScript + Hono + SQLite | Central coordinator — 65+ REST endpoints, web dashboard, SSE, Daphney bridge, OpenAI-compat proxy |
| **Agent** (`agent/`) | TypeScript (zero deps) | Node daemon — GPU stats, command execution, auto-discovery, overclock profiles |
| **CLAWtopus CLI** (`cli/`) | TypeScript (zero deps) | Inference router + cluster management — chat, models, health, tags, deploy |
| **Builder** (`builder/`) | Bash | ISO/PXE build system — debootstrap Ubuntu 24.04, custom initrd |
| **Shared** (`shared/`) | TypeScript | Shared type definitions — agent ↔ gateway ↔ CLI contract |

---

## Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | Any x86_64 | Modern multi-core |
| RAM | 4GB | 16GB+ |
| GPU | Any NVIDIA/AMD | RTX 3090 or better |
| Storage | 20GB | 100GB+ NVMe |
| Network | 1GbE | 10GbE (for clusters) |

---

## Supported GPUs

| Vendor | Status | Notes |
|--------|--------|-------|
| **NVIDIA** | Full | Pascal+, CUDA capable |
| **AMD** | Partial | ROCm support coming |
| **Intel** | Planned | Arc GPUs, future |

---

## Community

| |
|---|
| **Discord** — The Tank — CLAWtopus lives here |
| **GitHub Discussions** — Questions, ideas, showcase |
| **GitHub Issues** — Bugs and feature requests |

---

## CLAWtopus

The mascot of TentaCLAW OS. An octopus who lives in your terminal and coordinates your AI inference cluster with eight arms.

```
        ,---.
       / o o \
       | \___/ |
        \_____/
         |||||
        /|||||\
       ( @@@@@ )
        @@@@@
```

**CLAWtopus says:**
- *"Eight arms. One mind."*
- *"Per-token is a scam."*
- *"HiveOS for AI. Finally."*
- *"I've got arms for days."*

---

## Gateway API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/register` | Register a node |
| `POST` | `/api/v1/nodes/:id/stats` | Push stats (returns pending commands) |
| `GET` | `/api/v1/nodes` | List all nodes with latest stats |
| `GET` | `/api/v1/nodes/:id` | Get single node detail |
| `POST` | `/api/v1/nodes/:id/commands` | Queue a command for a node |
| `GET` | `/api/v1/summary` | Cluster summary (GPUs, VRAM, tok/s) |
| `GET` | `/api/v1/health/score` | Cluster health score (0-100, A-F grading) |
| `GET/POST` | `/api/v1/flight-sheets` | List/create flight sheets |
| `POST` | `/api/v1/flight-sheets/:id/apply` | Apply flight sheet to nodes |
| `GET` | `/api/v1/alerts` | Recent alerts (temp, VRAM, disk) |
| `GET/POST` | `/api/v1/benchmarks` | Benchmark results |
| `GET/POST` | `/api/v1/nodes/:id/ssh-keys` | SSH key management |
| `GET/POST` | `/api/v1/nodes/:id/tags` | Node tagging system |
| `GET` | `/api/v1/tags` | List all tags with counts |
| `GET` | `/api/v1/nodes/:id/pulls` | Active model pull progress |
| `GET` | `/api/v1/model-search` | Search Ollama model catalog |
| `POST` | `/v1/chat/completions` | OpenAI-compatible inference proxy |
| `GET` | `/v1/models` | OpenAI-compatible model list |
| `GET` | `/api/v1/events` | SSE stream for real-time dashboard |
| `GET` | `/api/v1/daphney/stream` | SSE stream for DaphneyBrain UE5 |

## Project Structure

```
tentaclaw-os/
├── agent/               # Node daemon (TypeScript, zero deps)
│   ├── src/index.ts     # Agent with --mock mode, auto-discovery, overclock
│   ├── src/spawner.ts   # Multi-node mock spawner (16 presets)
│   └── tests/           # 10 tests
├── gateway/             # HiveMind Gateway (Hono + SQLite)
│   ├── src/index.ts     # 65+ REST API endpoints, SSE, OpenAI proxy, Daphney bridge
│   ├── src/db.ts        # Database layer (11 tables)
│   ├── public/          # HiveOS-style web dashboard (HTML/CSS/JS)
│   └── tests/           # 42 tests (unit + integration)
├── cli/                 # CLAWtopus CLI (inference router + cluster management)
│   └── src/index.ts     # chat, models, health, tags, deploy, alerts, benchmarks
├── shared/              # Shared TypeScript types
│   └── types.ts         # Agent ↔ Gateway ↔ CLI contract
├── builder/             # ISO/PXE build system
│   ├── build-iso.sh     # Bootable ISO builder
│   ├── scripts/
│   │   ├── init-bottom/ # Boot scripts (GPU detect, network, registration)
│   │   └── init-top/    # Post-boot (agent start, Ollama, model loading)
│   └── config/          # OS rootfs configuration
├── docker-compose.yml   # One-command gateway deployment
├── Makefile             # Build/dev/test targets
└── .github/workflows/   # CI: test → build → release
```

## Documentation

| Doc | Description |
|-----|-------------|
| [BUILD.md](BUILD.md) | Detailed build specification |
| [BRAND.md](BRAND.md) | Brand guidelines and visual identity |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Quick start guide |

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Issues labeled `CLAWtopus-wanted` are good first contributions.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

**TentaCLAW OS** — Eight arms. One mind. Zero compromises.

Built with sassy by [TentaCLAW-OS](https://github.com/TentaCLAW-OS)
