# r/selfhosted Post

**Title:** TentaCLAW OS -- self-hosted GPU cluster management for AI inference (HiveOS-style dashboard)

**Flair:** `AI / Machine Learning`

---

Hey r/selfhosted,

If you've tried running local AI inference across multiple machines in your homelab, you know how painful it gets. SSH into each node, manage Ollama or vLLM separately, no unified dashboard, no idea which GPU has capacity, no alerting when something breaks.

I built **TentaCLAW OS** to solve this. It's an open-source GPU cluster operating system -- think HiveOS (the crypto mining OS) but for AI inference instead of mining. One dashboard. One API. Auto-discovery. Self-healing.

**GitHub:** https://github.com/TentaCLAW-OS/TentaCLAW

---

## The self-hosting angle

This is built for homelabs and small clusters. Here's what matters to this community:

### Zero config, auto-discovery
Run the gateway on any machine. Run agents on your GPU nodes. The agents find the gateway automatically via UDP broadcast + mDNS on your LAN. No manual IP configuration, no config files, no DNS entries needed. Plug in a machine, it joins the cluster.

### Real-time dashboard
A web UI that shows all your nodes, GPUs, VRAM, temperatures, loaded models, tokens/sec, health scores, and alerts -- all updated in real-time via SSE streaming. It's Proxmox-style: resource tree on the left, tabbed detail panels on the right.

![Dashboard](https://github.com/TentaCLAW-OS/TentaCLAW/raw/master/assets/screenshots/dashboard-summary.png)

### Docker support
Don't want to flash an ISO? Run the whole stack in Docker:

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW
docker compose up
# Dashboard → http://localhost:8080/dashboard
```

For GPU nodes, add `--gpus all` to the agent container. There's also a production Docker Compose file with proper volume mounts and restart policies.

### Proxmox integration
If you're running Proxmox (and let's be honest, most of this sub is), TentaCLAW agents run inside VMs or LXCs with GPU passthrough. There's a dedicated [Proxmox guide](https://github.com/TentaCLAW-OS/TentaCLAW/blob/master/docs/PROXMOX.md) in the docs.

### Monitoring & alerting
- Prometheus metrics endpoint (`/metrics`) -- plug into your existing Grafana stack
- Built-in alerts for GPU temperature, VRAM pressure, disk full, CPU saturation, node offline
- Notification channels: Discord, Slack, Telegram, email, webhooks
- Pre-built Grafana dashboards included

### Self-healing
The watchdog handles failures automatically. Service crashed? Restart it. GPU hung? Reset it. Node offline? Re-route requests to healthy nodes. No 3am pages.

### OpenAI-compatible API
One endpoint for your entire cluster: `POST /v1/chat/completions`. Point Open WebUI, LangChain, or any OpenAI-compatible client at your gateway. Smart routing sends requests to the best available node based on VRAM, queue depth, and latency.

---

## Hardware support

| Vendor | Status |
|--------|--------|
| NVIDIA (Pascal+) | Full support via CUDA |
| AMD (RDNA2+) | Full support via ROCm |
| AMD (older) | Vulkan fallback |
| CPU-only | BitNet 1-bit models (no GPU needed) |
| Apple Silicon | MLX backend |

Mix NVIDIA and AMD GPUs in the same cluster. Mix GPU nodes and CPU-only BitNet nodes. The gateway doesn't care -- it routes requests to whatever has the model loaded.

---

## Install options

**One-liner:**
```bash
curl -fsSL https://tentaclaw.io/install | bash
```

**Docker:**
```bash
docker compose up
```

**Bare metal ISO (dedicated inference nodes):**
```bash
wget https://github.com/TentaCLAW-OS/TentaCLAW/releases/latest/download/tentaclaw-os-amd64.iso
sudo dd if=tentaclaw-os-amd64.iso of=/dev/sdX bs=4M status=progress
# Boot → auto-detects GPUs → joins cluster
```

**Helm (Kubernetes):**
```bash
helm install tentaclaw tentaclaw/tentaclaw --namespace tentaclaw --create-namespace
```

**Ansible / Terraform** playbooks and modules also included in the repo.

---

## What else is in the box

- **86-command CLI** (`clawtopus`) for cluster management from the terminal
- **Flight sheets** -- declarative YAML for model deployment (which models on which nodes)
- **Package marketplace** (CLAWHub) -- 185 packages: agents, integrations, themes, stacks
- **Integrations** -- Dify, n8n, Home Assistant, Continue.dev, Grafana, Open WebUI
- **API key management** with scoped permissions and rate limiting
- **8 dashboard themes** including dracula, nord, catppuccin, and tokyo-night

---

## Tech stack

- Gateway: TypeScript + Hono + SQLite
- Agent: TypeScript, zero runtime dependencies
- Dashboard: React + SSE
- CLI: TypeScript, zero runtime dependencies
- 810 tests, 68K lines, MIT licensed

---

If you're running local AI in your homelab, I'd love to hear what features would be useful. This is built by a self-hoster for self-hosters.

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Discord: https://discord.gg/tentaclaw
Website: https://www.tentaclaw.io
