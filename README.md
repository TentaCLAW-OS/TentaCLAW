<p align="center">
  <img src="assets/tentaclaw-logo.svg" width="80" alt="TentaCLAW Logo">
</p>

<h1 align="center">TentaCLAW OS</h1>
<p align="center">
  <strong>The Operating System for AI Inference</strong><br>
  Plug in GPUs. Get inference. Zero config.
</p>

<p align="center">
  <a href="https://tentaclaw.io">Website</a> &middot;
  <a href="https://tentaclaw.io/docs.html">Docs</a> &middot;
  <a href="https://tentaclaw.io/integrations.html">Integrations</a> &middot;
  <a href="https://discord.gg/tentaclaw">Discord</a>
</p>

<p align="center"><em>"Eight arms. One mind. Zero compromises."</em></p>

---

TentaCLAW OS turns scattered GPUs into one self-healing AI inference cluster. Auto-detect hardware, route requests to the best available model, and monitor everything from a live dashboard — all for the cost of your power bill.

<p align="center">
  <img src="assets/screenshots/dashboard-live-octopod.png" width="800" alt="TentaCLAW Dashboard">
  <br><em>Live fleet dashboard — 5 Octopods, 10 GPUs, real-time metrics</em>
</p>

## Quick Install

**Linux / macOS / Proxmox:** `curl -fsSL tentaclaw.io/install | bash`

**Windows (PowerShell):** `irm tentaclaw.io/install.ps1 | iex`

**ISO Download:** [GitHub Releases](https://github.com/TentaCLAW-OS/TentaCLAW/releases) — Ubuntu 24.04 with TentaCLAW pre-installed.

## Key Features

- **Zero-config GPU detection** — Agents auto-discover GPUs, register with the gateway, and begin serving inference immediately
- **8 inference backends** — Ollama, vLLM, SGLang, llama.cpp, LM Studio, BitNet, TabbyAPI, TensorRT-LLM
- **OpenAI + Anthropic API compatibility** — Drop-in replacement at `/v1/chat/completions` and `/v1/messages`
- **Live dashboard** — 7 pages: Fleet, Cluster, Models, Agents, Chat, Alerts, Settings
- **AI coding agent** — Built-in CLI agent with 12 file/shell tools, 30+ slash commands, persistent sessions, and workspace memory
- **28+ integrations** — LangChain, n8n, Discord, Slack, VS Code, Continue.dev, Dify, Home Assistant, Grafana, and more
- **Model marketplace** — Browse 135,000+ models from HuggingFace, pull from Ollama, or publish to CLAWHub
- **Self-healing agent** — Watchdog with 4-level escalation: restart process, reload model, reboot node, drain and failover
- **MCP server** — 16 tools for Claude Desktop, Cursor, and any MCP-compatible client
- **Multi-node clustering** — Smart routing by model affinity, VRAM headroom, thermal state, and latency

## Architecture

```
gateway/      API gateway, inference router, SQLite DB, SSE events
agent/        GPU node agent — heartbeat, stats, commands, watchdog
cli/          CLI + AI coding agent with persistent sessions
dashboard/    React dashboard (Vite, Tailwind, Zustand)
mcp/          MCP server — 16 tools for Claude/Cursor
sdk/          TypeScript SDK for programmatic access
clawhub/      Model registry and marketplace
website/      tentaclaw.io — landing page, docs, install scripts
builder/      ISO builder for TentaCLAW OS (Ubuntu 24.04)
deploy/       Cloud deploy configs (AWS, GCP, Azure, Docker)
```

## CLI

```
tentaclaw status             Show fleet health, node count, GPU utilization
tentaclaw nodes              List all Octopod nodes with status
tentaclaw models             List models across the cluster
tentaclaw chat "prompt"      One-shot inference from the terminal
tentaclaw code               Launch the AI coding agent
tentaclaw pull <model>       Pull a model from Ollama or HuggingFace
tentaclaw bench              Run GPU benchmarks across nodes
tentaclaw logs               Stream gateway or agent logs
tentaclaw alerts             View active alerts and rules
tentaclaw ssh <node>         Open a shell on a remote Octopod
```

## API

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:70b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

The gateway routes to the best available node automatically. Responses follow the standard OpenAI shape with additional `_tentaclaw` routing metadata.

## Links

- [Website](https://tentaclaw.io) — Landing page, pricing, and downloads
- [Documentation](https://tentaclaw.io/docs.html) — Setup guides, API reference, configuration
- [Integrations](https://tentaclaw.io/integrations.html) — 28+ supported tools and platforms
- [Discord](https://discord.gg/tentaclaw) — Community support and discussion
- [GitHub Issues](https://github.com/TentaCLAW-OS/TentaCLAW/issues) — Bug reports and feature requests

## License

MIT — [LICENSE](LICENSE)

---

<p align="center">
  Founded by Alexander Ivy &middot; <a href="https://tentaclaw.io">tentaclaw.io</a>
</p>
