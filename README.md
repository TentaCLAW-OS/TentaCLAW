<p align="center">
  <img src="assets/tentaclaw-logo.svg" width="80" alt="TentaCLAW Logo">
</p>

<h1 align="center">TentaCLAW OS</h1>
<p align="center">
  <strong>The Operating System for AI Inference</strong><br>
  Plug in GPUs. Get inference. Zero config.
</p>

<p align="center">
  <a href="https://tentaclaw.io">Website</a> ·
  <a href="https://tentaclaw.io/docs.html">Docs</a> ·
  <a href="https://tentaclaw.io/integrations.html">Integrations</a> ·
  <a href="https://discord.gg/tentaclaw">Discord</a>
</p>

<p align="center"><em>"Eight arms. One mind. Zero compromises."</em></p>

---

TentaCLAW OS turns scattered GPUs into one self-healing AI inference cluster. Auto-detect hardware, route requests to the best available model, and monitor everything from a live dashboard — all for the cost of your power bill.

<p align="center">
  <img src="assets/screenshots/dashboard-live-octopod.png" width="800" alt="TentaCLAW Dashboard">
  <br><em>Live fleet dashboard — 5 Octopods, 10 GPUs, real-time monitoring</em>
</p>

## Quick Install

**Linux / macOS / Proxmox:**
```bash
curl -fsSL tentaclaw.io/install | bash
```

**Windows (PowerShell):**
```powershell
irm tentaclaw.io/install.ps1 | iex
```

**ISO Download:** [GitHub Releases](https://github.com/TentaCLAW-OS/TentaCLAW/releases) — Ubuntu 24.04 with TentaCLAW pre-installed.

## Features

- **Zero Config** — Auto-detect GPUs, auto-register nodes, auto-route inference
- **8 Backends** — Ollama, vLLM, SGLang, llama.cpp, LM Studio, BitNet, TabbyAPI, TensorRT-LLM
- **OpenAI + Anthropic API** — Drop-in replacement at `/v1/chat/completions` and `/v1/messages`
- **Live Dashboard** — 7 pages: Fleet, Cluster, Models, Agents, Chat, Alerts, Settings
- **28+ Integrations** — LangChain, n8n, Discord, Slack, VS Code, Grafana, HuggingFace
- **AI Coding Agent** — Built-in CLI agent with file tools, persistent sessions, workspace memory
- **Model Marketplace** — Browse 135,000+ models from HuggingFace, pull from Ollama

## Architecture

```
gateway/      API gateway + dashboard (Hono, SQLite)
agent/        GPU node agent (heartbeat, stats, commands)
cli/          CLI + AI coding agent (zero dependencies)
dashboard/    React dashboard (Vite, Tailwind, Zustand)
website/      tentaclaw.io landing page + docs
builder/      ISO builder for TentaCLAW OS
deploy/       Cloud configs (AWS, GCP, Azure)
```

## API

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.1:70b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## CLI

```
tentaclaw status       # Fleet health
tentaclaw nodes        # List Octopod nodes
tentaclaw models       # Model registry
tentaclaw code         # Launch AI coding agent
```

## License

MIT — [LICENSE](LICENSE)

---

<p align="center">
  Founded by Alexander Ivy · <a href="https://tentaclaw.io">tentaclaw.io</a>
</p>
