# CLAWtopus CLI Reference

> **Eight arms on the command line.**
>
> Inference router + cluster management for TentaCLAW OS. Pure Node.js, zero dependencies.

---

## Installation

```bash
# Install globally
npm install -g clawtopus-cli

# Or run via npx (no install required)
npx clawtopus status

# Or build from source
cd cli && npm install && npm run build
npx clawtopus status
```

---

## Configuration

The CLI talks to a TentaCLAW Gateway. By default it connects to `http://localhost:8080`.

**Set the gateway URL:**

```bash
# Via environment variable (recommended)
export TENTACLAW_GATEWAY=http://192.168.1.100:8080

# Or per-command via flag
clawtopus status --gateway http://192.168.1.100:8080
```

---

## Cluster Management

### `status`

Cluster overview: nodes, GPUs, total VRAM, tokens/sec.

```bash
clawtopus status
```

### `nodes`

List all registered nodes with status, GPU count, and loaded models.

```bash
clawtopus nodes
```

### `node <nodeId>`

Detailed info for a single node: hardware, GPU stats, loaded models, uptime.

```bash
clawtopus node TENTACLAW-FARM7K3P-node1
```

### `health`

Cluster health score (0-100) with letter grade and issues.

```bash
clawtopus health
```

### `doctor`

Run diagnostics across the cluster and auto-fix detected issues.

```bash
clawtopus doctor           # Diagnose + auto-fix
clawtopus doctor --no-fix  # Diagnose only (dry run)
```

### `alerts`

View active cluster alerts (GPU temp, VRAM pressure, disk full, node offline).

```bash
clawtopus alerts
```

### `benchmarks`

View benchmark results across all nodes.

```bash
clawtopus benchmarks
```

### `watchdog`

View self-healing watchdog events (service restarts, GPU resets).

```bash
clawtopus watchdog
```

### `fleet` / `reliability`

Fleet reliability metrics and uptime statistics.

```bash
clawtopus fleet
```

### `power` / `cost`

Cluster power draw and cost estimates (per-node wattage, daily/monthly costs).

```bash
clawtopus power
```

### `events` / `timeline`

Cluster event timeline.

```bash
clawtopus events
clawtopus events --hours 12
```

---

## Inference & Models

### `models`

List all models currently loaded across the cluster.

```bash
clawtopus models
```

### `chat`

Interactive chat with a model running on your cluster.

```bash
clawtopus chat --model llama3.1:8b
```

### `deploy <model> [nodeId]`

Deploy a model. Without a node ID, CLAWtopus picks the best node automatically (smart deploy).

```bash
clawtopus deploy llama3.1:8b              # Auto-pick best node
clawtopus deploy llama3.1:8b NODE-001     # Deploy to specific node
```

### `backends`

List inference backends on each node (Ollama, BitNet, llama.cpp, vLLM) with versions and loaded models.

```bash
clawtopus backends
```

---

## Model Package Manager

### `search <query>`

Search Ollama and HuggingFace for models.

```bash
clawtopus search llama
clawtopus search "code assistant" --source ollama
clawtopus search mistral --source hf
```

### `tags`

Browse model categories (text-generation, code, vision, etc.) when used without subcommands.

```bash
clawtopus tags
```

### `keywords <tag>`

List models matching a HuggingFace pipeline tag.

```bash
clawtopus keywords text-generation
```

### `info <org/model>`

Detailed model info from HuggingFace.

```bash
clawtopus info meta-llama/Meta-Llama-3.1-8B
```

---

## Node Tags

Organize nodes with arbitrary labels.

### `tags list`

List all tags with node counts.

```bash
clawtopus tags list
```

### `tags add <nodeId> <tag>`

Tag a node.

```bash
clawtopus tags add NODE-001 production
```

### `tags nodes <tag>`

List nodes with a specific tag.

```bash
clawtopus tags nodes production
```

---

## Automation

### `command <nodeId> <action> [options]`

Send a command to a specific node.

```bash
clawtopus command NODE-001 install_model --model llama3.1:8b
clawtopus command NODE-001 overclock --profile inference
clawtopus command NODE-001 reboot
```

**Actions:** `reload_model`, `install_model`, `remove_model`, `overclock`, `benchmark`, `restart_agent`, `reboot`

### `flight-sheets`

List all flight sheets (declarative deployment plans).

```bash
clawtopus flight-sheets
```

### `apply <flightSheetId>`

Apply a flight sheet to deploy its model targets.

```bash
clawtopus apply fs-abc123
```

### `auto`

Let CLAWtopus auto-optimize the cluster. Trust the octopus.

```bash
clawtopus auto
```

### `optimize`

Run cluster optimization suggestions.

```bash
clawtopus optimize
```

### `fix`

Auto-fix detected cluster issues.

```bash
clawtopus fix
```

### `explain`

Get a plain-English explanation of current cluster state.

```bash
clawtopus explain
```

---

## Operations

### `top`

Real-time cluster monitor (refreshes every 3 seconds). Shows per-node GPU temp, utilization, VRAM, and loaded models.

```bash
clawtopus top    # Ctrl+C to exit
```

### `drain <nodeId>`

Put a node into maintenance mode. No new requests will be routed to it.

```bash
clawtopus drain NODE-001
```

### `cordon <nodeId>`

Cordon a node (same as drain -- prevents new scheduling).

```bash
clawtopus cordon NODE-001
```

### `uncordon <nodeId>`

Bring a cordoned node back into active scheduling.

```bash
clawtopus uncordon NODE-001
```

### `maintenance <nodeId>`

Toggle maintenance mode.

```bash
clawtopus maintenance NODE-001
```

---

## Analytics & Monitoring

### `analytics`

Inference analytics: request counts, latency distribution, model usage.

```bash
clawtopus analytics
clawtopus analytics --hours 24
```

### `notify`

Manage notification channels (Discord, Slack, Telegram, email, webhooks).

```bash
clawtopus notify
```

---

## API Keys

### `apikey` / `apikeys`

Manage scoped API keys.

```bash
clawtopus apikeys
```

---

## Model Aliases

### `alias` / `aliases`

Map friendly names to real model names (e.g., `gpt-4` -> `llama3.1:70b`).

```bash
clawtopus alias
```

---

## Additional Commands

### `capacity`

Show available capacity for new models across the cluster.

```bash
clawtopus capacity
```

### `suggestions` / `suggest`

AI-generated optimization suggestions for your cluster.

```bash
clawtopus suggestions
```

### `gpu-map` / `gpus`

Visual GPU map of the cluster.

```bash
clawtopus gpu-map
```

### `vibe`

Quick cluster vibe check. Is everything cool? CLAWtopus will tell you.

```bash
clawtopus vibe
```

---

## Fun Stuff

Because every CLI needs a personality.

### `joke`

GPU humor, courtesy of CLAWtopus.

```bash
clawtopus joke
```

### `fortune`

Octopus wisdom for the day.

```bash
clawtopus fortune
```

### `dance`

CLAWtopus does a little dance in your terminal.

```bash
clawtopus dance
```

### `credits`

Project credits and links.

```bash
clawtopus credits
```

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--gateway <url>` | TentaCLAW Gateway URL (overrides `TENTACLAW_GATEWAY` env var) |
| `--model <name>` | Model name (for `chat`, `command`, `deploy`) |
| `--gpu <index>` | GPU index (for `command`) |
| `--profile <name>` | Overclock profile: `stock`, `gaming`, `mining`, `inference` |
| `--priority <level>` | Command priority |
| `--source <src>` | Model search source: `ollama`, `hf` |
| `--hours <n>` | Time window for analytics/events |
| `--no-fix` | Dry-run mode for `doctor` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_GATEWAY` | `http://localhost:8080` | Gateway URL the CLI connects to |

---

## Version

```bash
clawtopus version    # prints: clawtopus-cli v0.2.0
clawtopus --version
clawtopus -v
```

---

*CLAWtopus says: "40+ commands. Eight arms. I'm not even breaking a sweat."*
