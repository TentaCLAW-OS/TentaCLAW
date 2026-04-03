# TentaCLAW CLI Reference

> **Eight arms on the command line.**
>
> Inference router, cluster manager, and AI coding agent for TentaCLAW OS.
> Pure Node.js, zero dependencies.

---

## Installation

```bash
# Linux / macOS / Proxmox (one-liner)
curl -fsSL https://tentaclaw.io/install-cli | bash

# Windows PowerShell (one-liner)
irm https://tentaclaw.io/install.ps1 | iex

# Or build from source
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cd tentaclaw-os
npm install --workspace=cli
npm run build --workspace=cli
npm install -g --force ./cli
```

---

## Configuration

The CLI talks to a TentaCLAW Gateway. By default it auto-discovers on `http://localhost:8080`.

```bash
# Via environment variable
export TENTACLAW_GATEWAY=http://192.168.1.100:8080

# Or per-command
tentaclaw status --gateway http://192.168.1.100:8080
```

Config is stored at `~/.tentaclaw/config.json` (Linux/macOS) or `%USERPROFILE%\.tentaclaw\config.json` (Windows).

---

## Setup Wizard

```bash
tentaclaw setup
```

Interactive wizard — configure provider (Ollama, OpenAI, OpenRouter, custom), model, and gateway URL. Backs up existing config to `config.json.bak` before writing.

---

## Config Management

```bash
tentaclaw config show            # Print all settings
tentaclaw config path            # Print config file path
tentaclaw config get <key>       # Get a single value
tentaclaw config set <key> <val> # Set a value (backs up first)
tentaclaw config validate        # Check config is valid
```

---

## Cluster Management

### `status`

Cluster overview: nodes, GPUs, total VRAM, tokens/sec.

```bash
tentaclaw status
```

### `nodes`

List all registered nodes with status, GPU count, and loaded models.

```bash
tentaclaw nodes
```

### `node <nodeId>`

Detailed info for a single node: hardware, GPU stats, loaded models, uptime.

```bash
tentaclaw node Octopod-1
```

### `health`

Cluster health score (0–100) with letter grade (A–F) and issues.

```bash
tentaclaw health
```

### `doctor`

Run diagnostics across config, connectivity, and backend availability.

```bash
tentaclaw doctor
```

### `alerts`

View active cluster alerts (GPU temp, VRAM pressure, disk full, node offline).

```bash
tentaclaw alerts
```

### `benchmarks`

View benchmark results across all nodes.

```bash
tentaclaw benchmarks
```

---

## Inference & Models

### `models`

List all models currently loaded across the cluster.

```bash
tentaclaw models
```

### `chat`

Interactive chat with a model. Streams responses word-by-word.

```bash
tentaclaw chat --model llama3.1:8b
```

**Chat slash commands:** `/help`, `/status`, `/sessions`, `/model <name>`, `/new`, `/clear`, `/save`, `/export`, `/usage`, `/quit`

### `deploy <model> [nodeId]`

Deploy a model. Without a node ID, TentaCLAW picks the best node automatically.

```bash
tentaclaw deploy llama3.1:8b              # Auto-pick best node
tentaclaw deploy llama3.1:8b NODE-001     # Deploy to specific node
```

### `backends`

List inference backends on each node (Ollama, BitNet, llama.cpp) with versions and loaded models.

```bash
tentaclaw backends
```

---

## AI Coding Agent

```bash
tentaclaw code
tentaclaw code --model alexa-coder:latest
tentaclaw code --task "Write fizzbuzz.js and run it" --yes
tentaclaw code --resume <sessionId>
```

The code agent is a full agentic loop: it reads files, writes files, edits files, runs shell commands, searches codebases, and iterates until tasks are complete.

### Tools available to the agent

| Tool | Description |
|------|-------------|
| `read_file` | Read any file |
| `write_file` | Write (create or overwrite) a file |
| `edit_file` | Surgical replacement — `old_text → new_text`, no full rewrite |
| `list_dir` | List directory contents |
| `run_shell` | Run shell command (requires approval unless `--yes`) |
| `search_files` | Grep across files with regex |
| `create_directory` | Create directory tree |
| `delete_file` | Delete a file (always requires approval) |
| `move_file` | Move / rename a file (requires approval) |
| `copy_file` | Copy a file |

### Slash commands (inside the REPL)

| Command | Description |
|---------|-------------|
| `/help` | Show all slash commands |
| `/status` | Session info, token counts, model |
| `/usage` | Token usage + cost estimate (free for local Ollama) |
| `/context` | Number of messages in context |
| `/workspace` | Show workspace files and sizes |
| `/sessions` | Recent sessions (resumable) |
| `/model <name>` | Switch model mid-session |
| `/auto` | Toggle tool auto-approval |
| `/think <off\|low\|medium\|high>` | Set reasoning depth |
| `/compact` | Summarize + trim context |
| `/save` | Save session snapshot |
| `/export` | Export session to markdown |
| `/clear` | Clear screen |
| `/new` | Start a fresh session |
| `/cd <path>` | Change working directory |
| `/cwd` | Show current directory |
| `/quit` or `/exit` | Save session and exit |

### Shell shortcut

```
❯ ! git status
❯ ! npm test
```

Prefix any line with `!` to run it directly in the shell — no LLM involved.

### Session persistence

- Sessions are stored at `~/.tentaclaw/sessions/<id>.jsonl`
- Resume any session: `tentaclaw code --resume <sessionId>`
- Browse sessions: `tentaclaw sessions`
- Sessions include full message history, tool calls, and token counts

### Workspace system

The agent loads `~/.tentaclaw/workspace/` on every startup:

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent identity and operating principles |
| `USER.md` | Who you are — updated by the agent over time |
| `IDENTITY.md` | TentaCLAW branding and voice |
| `MEMORY.md` | Long-term memory — agent writes here automatically |
| `AGENTS.md` | Operating protocol: when to save memory, red lines, tool discipline |
| `TOOLS.md` | Your environment: SSH hosts, custom paths, preferences |
| `BOOTSTRAP.md` | First-run onboarding (deleted after first session) |
| `memory/YYYY-MM-DD.md` | Daily working notes |

### First-run onboarding

On first run, the agent asks your name, role, and tech stack — then updates `USER.md` and deletes `BOOTSTRAP.md`. Subsequent sessions skip onboarding.

---

## Node Tags

```bash
tentaclaw tags list              # List all tags with node counts
tentaclaw tags add NODE-001 gpu  # Tag a node
tentaclaw tags nodes gpu         # List nodes with a specific tag
```

---

## Automation

```bash
tentaclaw command NODE-001 install_model --model llama3.1:8b
tentaclaw command NODE-001 overclock --profile inference
tentaclaw command NODE-001 reboot
```

**Actions:** `reload_model`, `install_model`, `remove_model`, `overclock`, `benchmark`, `restart_agent`, `reboot`

### Flight Sheets

Declarative deployment plans — deploy model sets across nodes.

```bash
tentaclaw flight-sheets          # List all flight sheets
tentaclaw apply <flightSheetId>  # Apply a flight sheet
```

---

## Sessions

```bash
tentaclaw sessions               # List recent sessions
tentaclaw sessions info <id>     # Full session info + stats
```

---

## Update

```bash
tentaclaw update                 # Self-update CLI to latest master
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_GATEWAY` | `http://localhost:8080` | Gateway URL |
| `TENTACLAW_API_KEY` | — | API key for authenticated gateway |

---

## Testing

```bash
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts/test-cli.ps1
powershell -ExecutionPolicy Bypass -File scripts/test-cli.ps1 -Model alexa-coder:latest

# Linux / macOS / Proxmox
bash scripts/test-cli.sh
bash scripts/test-cli.sh alexa-coder:latest
```

77 assertions covering: version, config, models, doctor, sessions, code agent, all 9 tools, workspace files, session persistence, resume, 12 slash commands, `!` shortcut, `/cd`, `/cwd`, `/usage`, config backup, error handling, and a 5-round coding benchmark.

---

## Build from Source

```bash
cd tentaclaw-os
npm run build --workspace=cli    # Compile TypeScript → dist/
npm install -g --force ./cli     # Install globally
tentaclaw --version
```
