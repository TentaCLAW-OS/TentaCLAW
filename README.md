<p align="center">
  <!-- CLAWtopus ASCII Art -->
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
  <span style="color:#00FFFF">   │  <span style="color:#F0F0F0">Eight arms. One mind. Zero compromises.</span>                              │</span>
  <span style="color:#00FFFF">   ╰─────────────────────────────────────────────────────────────────╯</span>

  </pre>

  <!-- Tagline -->
  <h2>Eight arms. One mind.</h2>
  <h3>HiveOS for AI Inference Clusters</h3>

  <p><strong>TentaCLAW OS</strong> turns your pile of GPUs into a unified AI inference cluster — zero config, auto-discovery, one-click model deployment.</p>

  <p align="center">
    <a href="https://www.TentaCLAW.io"><img src="https://img.shields.io/badge/Web-TentaCLAW.io-00FFFF?style=for-the-badge" alt="Website"></a>
    <a href="https://github.com/TentaCLAW-OS"><img src="https://img.shields.io/badge/GitHub-TentaCLAW--OS-8C00C8?style=for-the-badge&logo=github" alt="GitHub"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-8C00C8?style=for-the-badge" alt="License"></a>
  </p>

</p>

---

## What Even Is This?

> **HiveOS for AI**

Like [HiveOS](https://hiveos.farm/) revolutionized GPU mining by making 1000-rig farms manageable from one dashboard, **TentaCLAW OS** makes AI inference clusters accessible to non-technical users.

Instead of mining rigs, you manage AI inference nodes.
Instead of hashrate, you track tokens/second.
Instead of flight sheets for miners, you have flight sheets for models.

**CLAWtopus** handles the boring stuff. You do the interesting stuff.

---

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

## "Per-Token Is A Scam"

Every dollar you pay OpenAI is a dollar you could've spent on more VRAM.

```
OpenAI GPT-4o:
  $0.01 per 1K tokens
  Your usage: 500 tokens/day
  COST: $15/month = $180/year

Your RTX 3090 (24GB VRAM):
  Idle: 10W | Inference: 300W
  8 hours/day = $23/month = $285/year

BUT YOU OWN THE GPU FOREVER.
Cost to run locally: $285/year
Cost to rent from OpenAI: $180/year

For most people: local is already cheaper.
And you own your data. And your cluster.
```

---

## Quick Start — ISO (Production)

```bash
# 1. Download the ISO
wget https://github.com/TentaCLAW-OS/TentaCLAW/releases/latest/download/TentaCLAW-OS-0.1.0-amd64.iso

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

## CLI

Manage your cluster from any terminal:

```bash
cd cli && npm install && npm run build

# Cluster overview
npx tentaclaw status

# List nodes
npx tentaclaw nodes

# Deploy a model to all nodes
npx tentaclaw deploy llama3.1:8b

# Send a command to a specific node
npx tentaclaw command TENTACLAW-FARM7K3P-node1 install_model --model hermes3:8b

# List and apply flight sheets
npx tentaclaw flight-sheets
npx tentaclaw apply <sheet-id>
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
  │  CLI Tool    │      │      HiveMind Gateway (:8080)         │
  │              │─────►│                                       │
  │  tentaclaw   │      │  REST API    Web Dashboard    SSE     │
  │  status      │      │  /api/v1/*   /dashboard       Events  │
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
| **Gateway** (`gateway/`) | TypeScript + Hono + SQLite | Central coordinator — REST API, web dashboard, SSE real-time updates |
| **Agent** (`agent/`) | TypeScript (zero deps) | Node daemon — collects GPU/system stats, pushes to gateway, executes commands |
| **CLI** (`cli/`) | TypeScript (zero deps) | Command-line cluster management — status, deploy, commands |
| **Builder** (`builder/`) | Bash | ISO/PXE build system — debootstrap Ubuntu 24.04, custom initrd |
| **Shared** (`shared/`) | TypeScript | Shared type definitions for agent ↔ gateway contract |

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
| `GET/POST` | `/api/v1/flight-sheets` | List/create flight sheets |
| `POST` | `/api/v1/flight-sheets/:id/apply` | Apply flight sheet to nodes |
| `GET` | `/api/v1/alerts` | Recent alerts (temp, VRAM, disk) |
| `GET/POST` | `/api/v1/benchmarks` | Benchmark results |
| `GET` | `/api/v1/events` | SSE stream for real-time dashboard |

## Project Structure

```
tentaclaw-os/
├── agent/               # Node daemon (TypeScript, zero deps)
│   ├── src/index.ts     # Agent with --mock mode for dev
│   └── tests/           # 10 tests
├── gateway/             # HiveMind Gateway (Hono + SQLite)
│   ├── src/index.ts     # REST API + SSE
│   ├── src/db.ts        # Database layer
│   ├── public/          # Web dashboard (HTML/CSS/JS)
│   └── tests/           # 19 tests
├── cli/                 # CLI tool (tentaclaw status/deploy/...)
│   └── src/index.ts     # 530+ lines, zero deps
├── shared/              # Shared TypeScript types
│   └── types.ts         # Agent ↔ Gateway contract
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
