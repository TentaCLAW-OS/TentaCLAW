# r/selfhosted Launch Post

## Title
Self-hosted GPU cluster management -- flash USB, boot, zero config. Open source.

## Body

I had the same problem a lot of us have: multiple machines with GPUs, all running local AI stuff (Ollama, llama.cpp, etc.), and no sane way to manage them as a group. I was SSH-ing into each box, writing custom health check scripts, and losing track of which model was loaded where.

So I built an OS for it.

**TentaCLAW OS** is an AI inference cluster operating system. Fully self-hosted. No cloud. No phone-home. No "free tier" with a paywall behind it. MIT licensed.

### How it works

1. Flash ISO to USB (or `curl -fsSL tentaclaw.io/install | bash`)
2. Boot the machine
3. Agent auto-discovers the gateway on your LAN (UDP broadcast, port 41337)
4. Node registers itself, starts pushing GPU/system stats every 10 seconds
5. Manage everything from one dashboard or CLI

That's it. No YAML files. No container orchestration. No Kubernetes cluster just to run inference.

### What you get

- **Web dashboard** at `:8080/dashboard` -- see all nodes, GPUs, VRAM, models, health scores
- **CLI** (`clawtopus`) -- 60+ commands for cluster management, model deployment, chat
- **OpenAI-compatible API** -- `/v1/chat/completions` works with any client that speaks OpenAI
- **Flight sheets** -- deployment configs. Push a model to all nodes or specific tagged nodes
- **Auto-discovery** -- new node boots, finds the gateway, registers. No manual config.
- **Self-healing** -- watchdog restarts crashed services. Gateway reroutes around dead nodes.
- **Node tags** -- label nodes as `production`, `inference`, `staging`. Filter and deploy by tag.
- **Alerts** -- temperature, VRAM, disk space. Automatic threshold alerts.
- **SSH key management** -- push keys to nodes via API
- **Docker Compose** -- one-command gateway deployment: `docker compose up`

### Self-hosted means self-hosted

- Gateway stores everything in local SQLite. No external database.
- No telemetry. No analytics. No "anonymous usage data."
- Runs on your LAN. Tailscale/WireGuard if you want remote access. Your choice.
- All config lives in `/etc/tentaclaw/`. Flat files. Readable. Editable.

### Comparison

| Feature | TentaCLAW OS | GPUStack | Ollama (standalone) |
|---------|-------------|----------|-------------------|
| Multi-node cluster | Yes (auto-discovery) | Yes (manual config) | No (single node) |
| Web dashboard | Yes (built-in) | Yes | No |
| CLI | Yes (60+ commands) | Limited | Yes |
| OpenAI-compatible API | Yes | Yes | Yes |
| Zero-config node setup | Yes (flash + boot) | No (manual install) | No |
| Auto-discovery (LAN) | Yes (UDP broadcast) | No | No |
| Mixed GPU vendors | Yes (NVIDIA + AMD + CPU) | NVIDIA focus | NVIDIA + AMD |
| CPU inference (BitNet) | Yes (1-bit models, no GPU) | No | No |
| Flight sheets (bulk deploy) | Yes | No | No |
| Self-healing watchdog | Yes | Partial | No |
| Node tagging | Yes | No | No |
| Health scoring (0-100) | Yes | No | No |
| Docker Compose deploy | Yes | Yes | Yes |
| ISO / USB boot | Yes | No | No |
| PXE network boot | Yes | No | No |
| License | MIT | Apache 2.0 | MIT |
| Cloud dependency | None | None | None |

### Quick start (no GPUs needed)

You can test the full stack on any machine with Node.js:

```bash
# Terminal 1 -- Gateway + Dashboard
cd gateway && npm install && npm run dev
# Open http://localhost:8080/dashboard

# Terminal 2 -- Mock agent (fake GPUs)
cd agent && npm install && npx tsx src/index.ts --mock

# Terminal 3 -- Second mock node (optional)
cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4
```

The mock agent generates realistic stats for simulated GPUs and pushes them to the gateway. You can test the dashboard, CLI, and API without any real hardware.

### Docker Compose

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW
docker compose up
# Gateway at :8080, dashboard at :8080/dashboard
```

### Links

- **GitHub**: https://github.com/TentaCLAW-OS/TentaCLAW
- **Website**: https://www.tentaclaw.io
- **License**: MIT

### What I'm looking for

Feedback from people who actually self-host local AI. What would make this useful for your setup? What's the most annoying part of managing multiple inference nodes that I haven't addressed?

The project has 144 tests, strict TypeScript, and 200+ API endpoints. It's not a weekend prototype -- but it IS still early, and real-world feedback is what shapes what comes next.

---

*Your hardware. Your inference. Your cluster. No cloud required.*
