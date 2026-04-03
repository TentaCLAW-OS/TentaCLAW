# Changelog

All notable changes to TentaCLAW OS are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [2.0.0] — 2026-04-02

### CLI — AI Coding Agent (major feature)

- **`tentaclaw code`** — full agentic code loop: reads files, writes files, edits files, runs shell commands, searches codebases, iterates until done
- **`edit_file` tool** — surgical `old_text → new_text` replacement, no full-file rewrites, with multiple-match detection and nearby-lines hints on failure
- **`create_directory`, `delete_file`, `move_file`, `copy_file`** — complete file management toolset (9 tools total)
- **`search_files`** — pure Node.js implementation, works on Windows/Linux/macOS without grep
- **Streaming chat** — `tentaclaw chat` now streams token-by-token via SSE, no more blank-screen wait
- **Shell shortcut** — prefix `! <cmd>` in the REPL to run directly without LLM
- **`/cd <path>` and `/cwd`** — directory navigation inside the REPL
- **`/usage`** — token counts + cost estimate (FREE for local Ollama, USD for cloud)
- **Workspace protocol** — `AGENTS.md` (operating protocol) and `TOOLS.md` (environment notes) added to the 4-file workspace system
- **`BOOTSTRAP.md`** — first-run onboarding: agent asks name, role, tech stack; deleted after first session
- **Token tracking** — `/status` shows real token counts parsed from SSE `usage` events
- **Graceful Ctrl+C** — saves `session_end` event cleanly, no JSONL corruption
- **Memory write-back** — system prompt instructs agent to update `MEMORY.md` with user preferences and project facts
- **Streaming error recovery** — partial response saved with `[stream interrupted]` marker on disconnect
- **Config backup** — `config.json.bak` written before every `config set`
- **Version check** — 5% of runs check GitHub releases API and show update notice (cached 24h)
- **Chat slash command parity** — `/usage`, `/sessions`, `/status`, `/save`, `/export` added to `tentaclaw chat`
- **Chat usage tracking** — `chatUsage` stats tracked per session in `tentaclaw chat`
- **Usage JSONL events** — `{ type: 'usage', ... }` event appended after each inference call

### Installers

- Block-letter TENTACLAW banner + octopus ASCII art in both `install-cli.sh` and `install-cli.ps1`
- Updated install URLs to `tentaclaw.io/install-cli` and `tentaclaw.io/install.ps1`
- PS 5.1 compatibility fixes throughout `install-cli.ps1`

### Website

- New CLI section: 3 feature cards, bash + PowerShell install one-liners, CLI Docs link
- All inline styles moved to named CSS classes

### Tests & CI

- `scripts/test-cli.ps1` — expanded from 61 to 82 assertions
- `scripts/test-cli.sh` — new Linux/macOS/Proxmox equivalent (82 assertions)
- `scripts/benchmark-cli.ps1` — Windows PowerShell 15-round coding benchmark
- `scripts/benchmark-cli.sh` — Linux/macOS 15-round coding benchmark
- `alexa-coder:latest` benchmark result: **15/15 (100%, Grade A)**
- CI `build-cli` job now verifies `dist/index.js` exists and reports version in job summary

### Docs

- `docs/CLI.md` — complete rewrite: TentaCLAW branding, all v2 features documented
- `CLAUDE.md` — CLI v2 section: workspace system, tools, slash commands, build/test commands

### Bug Fixes

- `child_process` import made static — fixes `!` shell shortcut race condition when stdin is piped
- `edit_file` strips UTF-8 BOM on read — fixes PowerShell `Out-File -Encoding utf8` compatibility
- `execSync` in `!` handler now uses `stdio: ['ignore', 'pipe', 'pipe']` — prevents stdin consumption

---

## [1.0.0] — 2026-03-15

### Gateway

- Hono-based REST API gateway with SQLite persistence
- Node registration + heartbeat system
- OpenAI-compatible `/v1/chat/completions` endpoint with smart routing
- Model alias resolution (map `gpt-4` → any local model)
- VRAM-aware model routing across nodes
- SSE event stream (`/api/v1/events`) for real-time dashboard updates
- API key auth (SHA-256 hashed, scoped read/write/admin)
- Rate limiting (configurable RPM)
- Prometheus metrics (`/metrics`)
- Flight sheets (declarative multi-node model deployment)
- Alert system (GPU temp, VRAM pressure, disk, node offline)
- Benchmark recording + leaderboard
- Cloud burst routing to OpenAI/OpenRouter fallback
- WebSocket shell (authenticated node terminal)

### Agent

- Periodic stats collection (GPU temp, VRAM, tok/s via Ollama API)
- Cluster secret authentication
- UDP broadcast discovery
- Config from `/etc/tentaclaw/rig.conf`
- Mock GPU mode (`TENTACLAW_MOCK=true`) for dev

### Dashboard

- React + Zustand SPA served from gateway `/dashboard`
- 8 themes (Teal, Purple, Red, Blue, Green, Amber, Rose, Monochrome)
- Tabs: Summary, GPUs, Models, Inference, Metrics, Terminal, Chat, Alerts, Flight Sheets, Settings
- SSE live updates for all cluster state
- Keybinds: `g s/g/m/i/c/a/t` tab switch, `Ctrl+B/J/K` panels

### CLI (v1)

- Cluster management: `status`, `nodes`, `health`, `alerts`, `benchmarks`, `doctor`
- Inference: `models`, `chat`, `deploy`, `backends`
- Model search: `search`, `info`, `recommend`, `estimate`
- Node tags: `tags list/add/nodes`
- Config wizard: `setup`, `config show/get/set/validate`
- Sessions: `sessions`, `sessions info`, `code --resume`
- Self-update: `update`
- Zero npm dependencies (pure Node.js + TypeScript types only)

### Infrastructure

- Dockerfiles for gateway + agent
- Multi-node `docker-compose.yml`
- Kubernetes manifests, Helm chart, Terraform, Ansible
- GitHub Actions CI/CD (lint, test, build, Docker push, website deploy)
- GitHub Pages website at `tentaclaw.io`
- MIT licensed

---

[2.0.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/releases/tag/v1.0.0
