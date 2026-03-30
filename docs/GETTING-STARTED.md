# Getting Started with TentaCLAW OS

> **Five minutes from zero to running inference on your own hardware.**

---

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| **Node.js** | v22+ | [nodejs.org](https://nodejs.org) |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com) |
| **OS** | Windows, macOS, or Linux | Dev mode works everywhere. Production nodes run TentaCLAW OS (Linux). |

You do **not** need a GPU to try TentaCLAW. The mock agent simulates realistic hardware.

---

## Option A: One-Command Install

```bash
curl -fsSL tentaclaw.io/install | bash
```

This downloads TentaCLAW OS, installs dependencies, starts the gateway, and opens the dashboard. Done.

---

## Option B: Manual Install

```bash
# 1. Clone the repo
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW

# 2. Install dependencies (all workspaces)
npm install

# 3. Start the gateway
cd gateway && npm run dev
```

The gateway starts on **http://localhost:8080**. Open it in your browser — you'll see the dashboard.

---

## Start a Mock Agent

No GPUs? No problem. The mock agent generates fake hardware stats so you can explore the full stack.

Open a **second terminal**:

```bash
cd agent && npx tsx src/index.ts --mock
```

This registers a simulated node with fake GPUs (RTX 3090, RTX 4070 Ti Super, etc.) and pushes stats to the gateway every 5 seconds.

Want more nodes? Open a **third terminal**:

```bash
cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4
```

---

## Open the Dashboard

Navigate to:

```
http://localhost:8080/dashboard/
```

You should see your mock nodes appear with live GPU stats, temperatures, VRAM usage, and loaded models.

---

## Deploy Your First Model

Deploy a model across all online nodes:

```bash
# Via CLI
cd cli && npm install && npm run build
npx clawtopus deploy llama3.1:8b

# Or via API
curl -X POST http://localhost:8080/api/v1/deploy \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.1:8b"}'
```

The gateway picks the best node (lowest utilization, most free VRAM) and queues an `install_model` command. The agent pulls the model via Ollama automatically.

---

## Run Your First Inference

Once a model is deployed, hit the OpenAI-compatible endpoint:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "What is TentaCLAW?"}]
  }'
```

The gateway routes the request to whichever node has the model loaded, balancing across your cluster. The response includes `_tentaclaw` metadata showing which node handled it.

---

## Try the CLI

```bash
clawtopus status          # Cluster overview
clawtopus nodes           # List all nodes
clawtopus models          # See what's loaded
clawtopus health          # Health score (0-100)
clawtopus chat --model llama3.1:8b   # Interactive chat
```

---

## What's Next?

| Guide | What you'll learn |
|-------|-------------------|
| [API Reference](API.md) | Every endpoint, with curl examples |
| [CLI Reference](CLI.md) | All 40+ CLAWtopus commands |
| [BitNet Guide](BITNET.md) | CPU-only inference with 1-bit models |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute |

### Production Deployment

For bare-metal production nodes, flash the TentaCLAW OS ISO to a USB drive:

```bash
wget https://github.com/TentaCLAW-OS/TentaCLAW-OS/releases/latest/download/TentaCLAW-OS-0.1.0-amd64.iso
sudo dd if=TentaCLAW-OS-0.1.0-amd64.iso of=/dev/sdX bs=4M status=progress
```

Boot from USB. The node auto-detects GPUs, registers with the gateway via UDP broadcast on port 41337, and starts serving. No SSH, no config files, no YAML.

---

*CLAWtopus says: "Eight arms. Zero config. Let's go."*
