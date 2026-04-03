<p align="center">
  <img src="assets/tentaclaw-header.svg" alt="TentaCLAW OS" width="900">
</p>

<h3 align="center">Your GPUs. One Brain. Zero Limits.</h3>

<p align="center">
  <strong>TentaCLAW OS turns scattered GPUs into one self-healing AI inference cluster.<br>Multi-backend. Auto-discovery. Zero config.</strong>
</p>

<p align="center">
  <a href="https://github.com/TentaCLAW-OS/TentaCLAW/actions"><img src="https://img.shields.io/github/actions/workflow/status/TentaCLAW-OS/TentaCLAW/ci.yml?style=flat-square&label=build&color=00d4aa" alt="Build"></a>
  <a href="https://github.com/TentaCLAW-OS/TentaCLAW/actions"><img src="https://img.shields.io/github/actions/workflow/status/TentaCLAW-OS/TentaCLAW/ci.yml?style=flat-square&label=tests&color=00d4aa" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square" alt="License"></a>
  <a href="https://github.com/TentaCLAW-OS/TentaCLAW/stargazers"><img src="https://img.shields.io/github/stars/TentaCLAW-OS/TentaCLAW?style=flat-square&color=ffdd00" alt="Stars"></a>
  <a href="https://discord.gg/tentaclaw"><img src="https://img.shields.io/badge/Discord-The%20Tank-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="#install-in-60-seconds">Install</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="STATUS.md">Status</a> &bull;
  <a href="#why-tentaclaw">Comparison</a> &bull;
  <a href="https://www.tentaclaw.io">Website</a> &bull;
  <a href="docs/API.md">API Docs</a> &bull;
  <a href="docs/CLI.md">CLI Docs</a> &bull;
  <a href="https://discord.gg/tentaclaw">Discord</a>
</p>

---

<p align="center">
  <img src="assets/terminal-screenshot.png" alt="TentaCLAW terminal" width="600">
</p>

---

## Install in 60 Seconds

```bash
curl -fsSL https://tentaclaw.io/install | bash
```

<details>
<summary><strong>Docker (one command)</strong></summary>

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW
docker compose up
# Gateway → http://localhost:8080/dashboard
```

</details>

<details>
<summary><strong>From source</strong></summary>

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW
cd gateway && npm install && npm run dev
# Open http://localhost:8080/dashboard
```

</details>

---

## Dashboard

<p align="center">
  <img src="assets/screenshots/live-cluster-dashboard.png" alt="TentaCLAW Dashboard — Live Cluster" width="900">
</p>

<p align="center"><em>Real cluster: 4 nodes, 9 AMD GPUs, 104 GB VRAM, 20 models — running on Proxmox</em></p>

<details>
<summary><strong>More screenshots</strong></summary>

| Login | Metrics | AI Chat | Billing |
|-------|---------|---------|---------|
| <img src="assets/screenshots/login-page.png" width="220"> | <img src="assets/screenshots/dashboard-metrics.png" width="220"> | <img src="assets/screenshots/dashboard-chat.png" width="220"> | <img src="assets/screenshots/dashboard-billing.png" width="220"> |

| Website Hero | Features | Dashboard Preview | Pricing |
|-------------|----------|-------------------|---------|
| <img src="assets/screenshots/website-hero.png" width="220"> | <img src="assets/screenshots/website-features.png" width="220"> | <img src="assets/screenshots/website-dashboard-preview.png" width="220"> | <img src="assets/screenshots/website-pricing.png" width="220"> |

</details>

---

## Why TentaCLAW?

> "Eight arms. One mind. Zero compromises." &mdash; TentaCLAW

There are GPU inference tools. There are model runners. There are cluster schedulers. None of them are a complete operating system for your AI hardware.

<table>
<thead>
<tr>
<th>Feature</th>
<th align="center">TentaCLAW OS</th>
<th align="center">GPUStack</th>
<th align="center">Ollama</th>
<th align="center">vLLM</th>
<th align="center">EXO</th>
</tr>
</thead>
<tbody>
<tr><td><strong>Multi-node cluster</strong></td><td align="center">Yes</td><td align="center">Yes</td><td align="center">No</td><td align="center">No</td><td align="center">Yes</td></tr>
<tr><td><strong>Auto-discovery (zero config)</strong></td><td align="center">UDP + mDNS</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">mDNS</td></tr>
<tr><td><strong>Bootable ISO</strong></td><td align="center">Planned</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>Web dashboard</strong></td><td align="center">Built-in</td><td align="center">Built-in</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>CLI tool</strong></td><td align="center">Yes</td><td align="center">Basic</td><td align="center">Basic</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>Multiple backends</strong></td><td align="center">Ollama + 5 experimental</td><td align="center">2</td><td align="center">1 (own)</td><td align="center">1 (own)</td><td align="center">1 (own)</td></tr>
<tr><td><strong>BitNet CPU inference</strong></td><td align="center">Experimental</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>Self-healing watchdog</strong></td><td align="center">Partial</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>Flight sheets (declarative deploy)</strong></td><td align="center">Yes</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>OpenAI-compatible API</strong></td><td align="center">Yes</td><td align="center">Yes</td><td align="center">Yes</td><td align="center">Yes</td><td align="center">Yes</td></tr>
<tr><td><strong>GPU overclocking</strong></td><td align="center">Planned</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>Package marketplace</strong></td><td align="center">CLAWHub (96 pkgs)</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>MCP server (AI agent access)</strong></td><td align="center">Yes</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
<tr><td><strong>NVIDIA + AMD + Apple Silicon + CPU</strong></td><td align="center">All (Intel planned)</td><td align="center">NVIDIA + AMD</td><td align="center">All</td><td align="center">NVIDIA</td><td align="center">Apple + NVIDIA</td></tr>
<tr><td><strong>Helm / Terraform / Ansible</strong></td><td align="center">All three</td><td align="center">No</td><td align="center">No</td><td align="center">Helm</td><td align="center">No</td></tr>
<tr><td><strong>Prometheus metrics</strong></td><td align="center">Built-in</td><td align="center">No</td><td align="center">No</td><td align="center">Prometheus</td><td align="center">No</td></tr>
<tr><td><strong>Mascot with personality</strong></td><td align="center">Obviously</td><td align="center">No</td><td align="center">No</td><td align="center">No</td><td align="center">No</td></tr>
</tbody>
</table>

**TL;DR:** Ollama runs one model on one machine. vLLM serves one model really fast. EXO splits one model across devices. GPUStack manages a few nodes. TentaCLAW OS is the entire operating layer -- boot, discover, deploy, route, monitor, heal, scale -- across all your hardware.

---

## Features

**Cluster Management**
- :globe_with_meridians: **Zero-Config Auto-Discovery** -- Agents find the gateway via UDP broadcast + mDNS. Plug in a machine, it joins the cluster.
- :shield: **Self-Healing Watchdog** -- Crashed services restart automatically. Failed GPU resets. Node goes offline, models re-route. No babysitting.
- :zap: **Flight Sheets** -- Declarative model deployment. Define what runs where. Apply with one click or one command.
- :bar_chart: **Real-Time Dashboard** -- Web UI with live GPU temps, VRAM, tok/s, model status, alerts, and cluster health scoring.

**Inference**
- :brain: **Multi-Backend Support** -- Ollama (production), vLLM, SGLang, llama.cpp, BitNet, MLX (experimental). Pick the best backend per workload.
- :link: **OpenAI-Compatible API** -- Drop-in replacement. Point any client, framework, or agent at `http://your-cluster:8080/v1/`.
- :robot: **Smart Routing** -- Requests route to the best available node based on VRAM, model availability, queue depth, and health.

**Operations**
- :octopus: **CLI** -- `tentaclaw status`, `chat`, `nodes`, `models`, and more. Cluster control from your terminal.
- :package: **CLAWHub Marketplace** -- 96 packages: agents, skills, flight sheets, integrations, adapters, stacks, themes. Install with one command.
- :satellite: **Observability** -- Prometheus metrics endpoint, structured logging, alert channels.

> **Full engineering status**: See **[STATUS.md](STATUS.md)** for what works, what's experimental, and what's planned.

---

## What's New in v0.3.0

- **One-curl install** -- `curl tentaclaw.io/install | bash` with auto port selection, AMD Vulkan detection, systemd services
- **CLAWHub Marketplace** -- 96 installable packages: agents, skills, flight sheets, integrations, themes, adapters, stacks
- **Multi-backend inference** -- Ollama (production) + vLLM, SGLang, llama.cpp, BitNet, MLX (experimental)
- **215 API endpoints** -- REST API, OpenAI proxy, SSE events, Prometheus metrics
- **MCP Server** -- AI agents can manage your cluster via Model Context Protocol tool calls (experimental)
- **TypeScript SDK** -- Programmatic access to gateway features (experimental)
- **API key management** -- Scoped keys with rate limiting and usage tracking
- **Model aliases** -- Map `gpt-4` to `llama3.1:70b` for seamless client compatibility
- **Power monitoring** -- Per-node wattage, daily/monthly cost estimates
- **Fleet reliability metrics** -- Uptime stats, MTBF, availability grades per node
- **Helm chart + Terraform + Ansible** -- Deploy anywhere, any way
- **1006 tests passing** -- Gateway and agent test suites (39 test files, Vitest)

---

## Security

TentaCLAW ships secure by default. No configuration needed for safe operation.

| Control | Default | Status |
|---------|---------|--------|
| **Authentication** | API keys enabled (SHA-256 hashed) | On |
| **Cluster secret** | 256-bit auto-generated, `0600` permissions | On |
| **Rate limiting** | 60 rpm unauth / 600 rpm auth | On |
| **Input validation** | 10MB payload limit, XSS sanitization | On |
| **Secure headers** | nosniff, DENY, HSTS, Permissions-Policy | On |
| **Audit logging** | All security events with actor, IP, timestamp | On |
| **TLS** | Self-signed CA, auto-generated node certs | Planned |
| **RBAC** | 5 built-in roles (admin/operator/developer/viewer/inference) | Planned |
| **Supply chain** | Cosign signed images, SBOM, SLSA L3 provenance | Planned |

Security test suite included (auth enforcement, fuzz testing, penetration tests).

See [docs/security/safe-defaults.md](docs/security/safe-defaults.md) | [Threat Model](docs/security/threat-model.md) | [SECURITY.md](SECURITY.md)

---

## Quick Start

### Path 1: Dev Mode (Any Machine)

No GPUs needed. Mock agents simulate a real cluster.

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW

# Terminal 1 — Gateway
cd gateway && npm install && npm run dev
# → Dashboard: http://localhost:8080/dashboard

# Terminal 2 — Mock agent (fake GPUs)
cd agent && npm install && npx tsx src/index.ts --mock

# Terminal 3 — Second node (optional)
cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4

# Terminal 4 — CLI
cd cli && npm install && npm run build
tentaclaw status
```

### Path 2: Docker

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW
docker compose up
# Gateway + mock agent → http://localhost:8080/dashboard
```

### Path 3: Kubernetes (Helm)

```bash
helm repo add tentaclaw https://tentaclaw-os.github.io/charts
helm install tentaclaw tentaclaw/tentaclaw \
  --namespace tentaclaw --create-namespace \
  --set gateway.replicas=1 \
  --set agent.enabled=true
```

---

## Architecture

```
                          ┌──────────────────────┐
                          │     You / Client      │
                          │  curl, Python, JS,    │
                          │  LangChain, CrewAI    │
                          └──────────┬───────────┘
                                     │
                            OpenAI-compat API
                            POST /v1/chat/completions
                                     │
                                     ▼
┌──────────┐          ┌──────────────────────────────────────────┐
│TentaCLAW │          │        TentaCLAW Gateway (:8080)         │
│   CLI    │─────────▶│                                          │
│          │          │  REST API (215 endpoints)                │
│tentaclaw │          │  Web Dashboard      SSE Events           │
│ status   │          │  OpenAI Proxy       Prometheus /metrics  │
│ chat     │          │  SQLite (11 tables)                      │
│ models   │          └──────────┬──────────┬──────────┬─────────┘
└──────────┘                     │          │          │
                      ┌──────────┘          │          └──────────┐
                      │       Push stats every 10s               │
                      │       Receive commands in response       │
                      ▼                     ▼                    ▼
              ┌──────────────┐   ┌───────────────┐   ┌───────────────┐
              │   Node 1     │   │    Node 2      │   │    Node 3     │
              │   Agent      │   │    Agent       │   │    Agent      │
              │              │   │                │   │               │
              │ RTX 4090 x2  │   │ RTX 3090       │   │ CPU only      │
              │ Ollama       │   │ vLLM           │   │ BitNet        │
              │ Farm:7K3P    │   │ Farm:7K3P      │   │ Farm:7K3P     │
              └──────────────┘   └────────────────┘   └───────────────┘
```

---

## Components

| Package | Path | Description |
|---------|------|-------------|
| **Gateway** | `gateway/` | Central coordinator -- 215 REST endpoints, web dashboard, SSE, webhooks, OpenAI proxy, Prometheus metrics, SQLite. TypeScript + Hono. |
| **Agent** | `agent/` | Node daemon -- GPU detection (NVIDIA/AMD/Apple Silicon), system stats, auto-discovery (UDP+mDNS+subnet scan), inference backend management. |
| **CLI** | `cli/` | `tentaclaw status`, `chat`, `nodes`, `models`. Cluster control from your terminal. |
| **MCP Server** | `mcp/` | Model Context Protocol server -- AI agents manage your cluster via tool calls. Zero deps. |
| **SDK** | `sdk/` | TypeScript SDK for programmatic gateway access. |
| **Shared** | `shared/` | Shared type definitions -- agent/gateway/CLI/MCP contract, personality engine, ASCII art. |
| **CLAWHub** | `clawhub/` | Package marketplace -- registry, schema validation, 96 packages across 8 categories. |
| **Builder** | `builder/` | ISO/PXE build system -- debootstrap Ubuntu 24.04, custom initrd, GRUB BIOS+UEFI. |
| **Observability** | `observability/` | Prometheus + Grafana stack with pre-built dashboards and alerting rules. |
| **Deploy** | `deploy/` | Helm chart, Terraform modules, Ansible playbooks, Kubernetes manifests, Docker production compose. |
| **Integrations** | `integrations/` | First-party integrations -- Dify, n8n, Home Assistant, Continue.dev, OpenClaw. |
| **Website** | `website/` | Project website source (tentaclaw.io). |

---

## Supported Hardware

| Vendor | GPU Status | Notes |
|--------|------------|-------|
| **NVIDIA** | Full support | Pascal and newer. CUDA detection via `nvidia-smi`. Overclocking supported. |
| **AMD** | Full support | Auto-detects architecture (RDNA3/2/1, Vega, Polaris). Auto-selects Vulkan or ROCm per GPU. |
| **Intel** | Planned | Arc GPUs. Detection stubbed, awaiting driver stabilization. |
| **Apple Silicon** | Via MLX backend | M1/M2/M3/M4. MLX backend handles Metal acceleration. |
| **CPU (BitNet)** | Full support | 1-bit quantized models on any x86_64 CPU. 2-6x faster, 70% less energy than FP16. |

---

## Supported Backends

| Backend | Type | Best For |
|---------|------|----------|
| **Ollama** | GPU / CPU | General purpose. Easy model management. Widest model support. |
| **vLLM** | GPU | High-throughput production serving. PagedAttention, continuous batching. |
| **SGLang** | GPU | Structured generation. JSON/regex constrained decoding. |
| **llama.cpp** | GPU / CPU | Lightweight inference. GGUF models. Low overhead. |
| **BitNet** | CPU only | 1-bit models. No GPU needed. Energy efficient. Great for CPU-only nodes. |
| **MLX** | Apple Silicon | Native Metal acceleration on Mac. M-series optimized. |

---

## CLAWHub Marketplace

> 96 packages. Install with one command.

CLAWHub is the package registry for TentaCLAW OS. Agents, flight sheets, integrations, skills, adapters, stacks, themes -- all declarative YAML, all versioned.

| Category | Count | Examples |
|----------|-------|---------|
| **Integrations** | 26 | Grafana, Discord, Home Assistant, n8n, Continue.dev, LangChain, CrewAI, Dify, Open WebUI |
| **Adapters** | 20 | `code-python`, `medical-terminology`, `creative-writing`, `formal-english`, `sql-expert` |
| **Agents** | 17 | `deep-researcher`, `code-reviewer`, `bug-hunter`, `blog-writer`, `cluster-monitor` |
| **Themes** | 10 | `deep-ocean`, `terminal-green`, `cyberpunk`, `dracula`, `nord`, `catppuccin`, `tokyo-night` |
| **Stacks** | 9 | `rag-stack`, `code-assistant-stack`, `voice-ai-stack`, `enterprise-chat-stack` |
| **Skills** | 6 | `web-search`, `shell-exec`, `docker-manager`, `pdf-parser` |
| **Examples** | 5 | Agent, skill, model, integration, theme templates |
| **Flight Sheets** | 3 | `llama3-8b`, `deepseek-r1-70b`, `bitnet-cpu` |

```bash
tentaclaw hub install deep-researcher
tentaclaw hub install llama3-8b
tentaclaw hub install cyberpunk
```

---

## Integrations

TentaCLAW OS plays well with the tools you already use.

| Integration | Description |
|-------------|-------------|
| **Dify** | Custom model provider. Use TentaCLAW as a backend for Dify workflows. |
| **n8n** | Native node for n8n workflow automation. Trigger deploys, query cluster status. |
| **Home Assistant** | Custom component. Monitor GPU temps, cluster health from your smart home dashboard. |
| **Continue.dev** | VS Code AI coding assistant backed by your local cluster. |
| **OpenClaw** | Multi-agent orchestration. Skills and scripts for TentaCLAW cluster management. |
| **LangChain** | Drop-in via OpenAI-compatible API. Point `ChatOpenAI` at your gateway. |
| **CrewAI** | Multi-agent crews powered by your local inference cluster. |
| **Grafana** | Pre-built dashboards for GPU metrics, inference latency, cluster health. |
| **Open WebUI** | Chat interface backed by your TentaCLAW cluster via OpenAI API. |

---

## API

215 endpoints. Full OpenAI compatibility. Here are the essentials:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat (streaming supported) |
| `GET` | `/v1/models` | OpenAI-compatible model list |
| `GET` | `/health` | Gateway health check |
| `POST` | `/api/v1/register` | Register a node |
| `POST` | `/api/v1/nodes/:id/stats` | Push stats (returns pending commands) |
| `GET` | `/api/v1/nodes` | List all nodes with latest stats |
| `GET` | `/api/v1/summary` | Cluster summary (GPUs, VRAM, tok/s) |
| `GET` | `/api/v1/health/score` | Cluster health score (0-100, A-F grade) |
| `GET/POST` | `/api/v1/flight-sheets` | Manage flight sheets |
| `POST` | `/api/v1/flight-sheets/:id/apply` | Apply flight sheet to nodes |
| `GET` | `/api/v1/alerts` | Active alerts (temp, VRAM, disk) |
| `GET` | `/api/v1/events` | SSE stream for real-time updates |
| `GET` | `/api/v1/game/stream` | SSE stream for UE5/Unity integration |
| `GET` | `/metrics` | Prometheus metrics endpoint |

> Full API reference: **[docs/API.md](docs/API.md)**

---

## CLI

```bash
# Install
curl -fsSL tentaclaw.io/install-cli | bash   # Linux / macOS / Proxmox
irm tentaclaw.io/install.ps1 | iex           # Windows PowerShell

# Cluster management
tentaclaw status                          # Nodes, GPUs, VRAM, tok/s
tentaclaw nodes                           # List all cluster nodes
tentaclaw models                          # List loaded models across cluster
tentaclaw health                          # Health score with letter grade

# AI coding agent — reads files, writes files, runs shell, iterates
tentaclaw code                            # Interactive REPL
tentaclaw code --model alexa-coder:latest # Use a specific model
tentaclaw code --task "Write fizzbuzz.js and run it" --yes  # Non-interactive
tentaclaw code --resume <sessionId>       # Resume a previous session

# Chat
tentaclaw chat --model llama3.1:8b        # Streaming chat, slash commands
```

> Full CLI reference: **[docs/CLI.md](docs/CLI.md)**

---

## The Octopus

Eight arms, each with a job. TentaCLAW keeps your cluster healthy so you don't have to.

```
            ___
           /   \
          | o o |
          | \___/ |     "I'm gonna make you an inference
           \_____/        you can't refuse."
       .-~|||||||~-.
      /  |||||||||| \         — TentaCLAW
     {  /|\ /|\ /|\  }
      \ |||_|||_||| /     Arm 1: Route      Arm 5: Benchmark
       '-.______.-'       Arm 2: Balance     Arm 6: Overclock
        |   |   |         Arm 3: Monitor     Arm 7: Heal
        |   |   |         Arm 4: Deploy      Arm 8: Scale
```

**TentaCLAW says:**
- *"Say hello to my little GPU."*
- *"Leave the gun. Take the model weights."*
- *"Per-token pricing is a scam."*
- *"Eight arms. One mind. Zero compromises."*
- *"I've got arms for days and VRAM for weeks."*
- *"You come to me, on this day of model deployment, asking for VRAM?"*

---

## Deploy Anywhere

| Method | Command |
|--------|---------|
| **One-curl** | `curl -fsSL tentaclaw.io/install \| bash` |
| **Docker** | `docker compose up` |
| **Docker (Production)** | `docker compose -f deploy/docker/docker-compose.production.yml up` |
| **Kubernetes** | `kubectl apply -f deploy/kubernetes/` |
| **Helm** | `helm install tentaclaw deploy/helm/tentaclaw/` |
| **Terraform** | `cd deploy/terraform && terraform apply` |
| **Ansible** | `ansible-playbook -i inventory deploy/ansible/playbook.yml` |
| **Proxmox** | See [docs/PROXMOX.md](docs/PROXMOX.md) |

---

## Documentation

| Doc | Description |
|-----|-------------|
| **[Getting Started](docs/GETTING-STARTED.md)** | First-time setup guide |
| **[Quick Start](docs/QUICKSTART.md)** | 5-minute overview |
| **[API Reference](docs/API.md)** | Full REST API documentation |
| **[CLI Reference](docs/CLI.md)** | TentaCLAW CLI commands |
| **[BitNet Guide](docs/BITNET.md)** | CPU-only inference with 1-bit models |
| **[AMD Support](docs/AMD.md)** | ROCm setup and GPU detection |
| **[Security](docs/SECURITY.md)** | API keys, SSH, hardening |
| **[Docker](docs/DOCKER.md)** | Container deployment guide |
| **[Proxmox](docs/PROXMOX.md)** | VM/LXC deployment on Proxmox VE |
| **[Networking](docs/NETWORKING.md)** | Auto-discovery, UDP broadcast, mDNS |
| **[Performance](docs/PERFORMANCE.md)** | Tuning and benchmarking |
| **[Themes](docs/THEMES.md)** | Dashboard theming and customization |
| **[Troubleshooting](docs/TROUBLESHOOTING.md)** | Common issues and fixes |
| **[FAQ](docs/FAQ.md)** | Frequently asked questions |
| **[Roadmap](docs/ROADMAP-v1.0.md)** | What's coming next |
| **[Build Spec](BUILD.md)** | ISO build system internals |
| **[Brand Guide](BRAND.md)** | Visual identity and design system |

---

## Project Stats

| Metric | Count |
|--------|-------|
| Tests passing | **1006** |
| Test files | **39** |
| API endpoints | **215** |
| Gateway modules | **40** (4 active, 36 experimental/planned) |
| CLAWHub packages | **96** |
| Inference backends | **1 production + 5 experimental** |
| Deploy methods | **8** |

---

## Contributing

Contributions welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

Issues labeled **`clawtopus-wanted`** are good first contributions. We accept code, docs, CLAWHub packages, integrations, themes, and ASCII art.

```bash
# Run the full test suite
npm test

# Run gateway tests only
cd gateway && npm test

# Run with coverage
npm run test:coverage
```

---

## Community

| Channel | Link |
|---------|------|
| **Discord** | [The Tank](https://discord.gg/tentaclaw) -- TentaCLAW lives here |
| **GitHub Discussions** | [Questions, ideas, showcase](https://github.com/TentaCLAW-OS/TentaCLAW/discussions) |
| **GitHub Issues** | [Bugs and feature requests](https://github.com/TentaCLAW-OS/TentaCLAW/issues) |
| **Website** | [tentaclaw.io](https://www.tentaclaw.io) |

---

## License

MIT -- see [LICENSE](LICENSE) for details.

Use it. Fork it. Run it. Own your inference.

---

<p align="center">
  <strong>TentaCLAW OS</strong><br>
  <em>Eight arms. One mind. Zero compromises.</em><br><br>
  Built with eight arms by <a href="https://github.com/TentaCLAW-OS">TentaCLAW-OS</a><br><br>
  <sub>Per-token pricing is a scam.</sub>
</p>
