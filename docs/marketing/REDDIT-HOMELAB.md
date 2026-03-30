# r/homelab Launch Post

## Title
My 4-node AI inference cluster running on Proxmox -- here's the OS I built for it

## Body

Been lurking here for a while. Finally have something worth sharing.

I've been running AI inference workloads across 4 nodes in my homelab and got tired of managing each one individually. So I built a purpose-built OS for it.

### My setup

| Node | Host | GPUs | VRAM | Role |
|------|------|------|------|------|
| pve-gpu | Proxmox (LXC) | 2x NVIDIA RTX 4070 Ti Super | 32 GB | Primary inference |
| pve-vega2 | Proxmox (LXC) | 4x AMD Radeon (Vega/RDNA) | 48 GB | Bulk inference |
| pve-amd | Proxmox (LXC) | 3x AMD Radeon | 36 GB | Secondary inference |
| cpu-worker | Bare metal | None (Ryzen 9 7950X) | -- | BitNet CPU inference |

**Total: 9 GPUs + 1 CPU-only node. 116 GB VRAM. Mixed NVIDIA + AMD + CPU.**

All running on Proxmox with GPU passthrough to LXC containers. The CPU-only node runs Microsoft's BitNet 1-bit models -- no GPU needed, ~25-40 tok/s on pure CPU.

### The problem

Managing this was a nightmare:
- SSH into each LXC to check if Ollama was running
- Custom bash scripts to scrape GPU temps and VRAM usage
- No unified view of which models were loaded where
- No way to deploy a model across multiple nodes without doing it manually on each one
- AMD GPU detection was especially painful (each GPU has different architecture flags)
- The CPU-only box was completely separate from the GPU workflow

### What I built

**TentaCLAW OS** -- an AI inference cluster operating system. Named after the mining rig management tool because the problem shape is identical: detect hardware, register nodes, push stats, deploy workloads, manage from one place.

On each node I run the TentaCLAW agent (a zero-dependency TypeScript daemon). The agent:
- Auto-detects all GPUs (NVIDIA via nvidia-smi, AMD via rocm-smi with per-GPU architecture detection)
- Discovers the gateway on the LAN (UDP broadcast on port 41337)
- Registers with a Farm Hash (one ID for the entire cluster)
- Pushes stats every 10 seconds (GPU temps, VRAM, utilization, power draw, fan speed)
- Receives commands in the stats response (install model, restart service, etc.)
- Runs a watchdog that restarts crashed services

The **gateway** (Hono + SQLite, runs on any node or a dedicated box) provides:
- Web dashboard at `:8080/dashboard` with real-time node cards
- 200+ REST API endpoints
- OpenAI-compatible proxy (`/v1/chat/completions`)
- SSE event stream for live updates
- Prometheus metrics endpoint
- Health scoring (0-100, letter grades A-F)

### What the dashboard shows

Each node card displays:
- Hostname and node ID
- Online/offline status with last-seen timestamp
- GPU list with per-GPU stats (temp, VRAM used/total, utilization %, power draw)
- Loaded models per GPU
- Health score
- Tags (I tag mine as `production`, `inference`, `amd-pool`)
- Active alerts (high temp, low disk, VRAM pressure)

The cluster summary panel shows:
- Total nodes online/offline
- Total GPUs and aggregate VRAM
- Cluster-wide tok/s throughput
- Total power draw across all nodes
- Health grade for the whole cluster

### Power monitoring

Each agent reports per-GPU power draw. The gateway aggregates it. I can see that my cluster pulls ~650W under full inference load vs ~180W at idle. Over a month that's the difference between $45 and $12 on my electricity bill (at $0.10/kWh).

Not huge numbers, but when you're running 24/7 inference it adds up. And it's nice to actually see it instead of guessing.

### Cost tracking

Here's the math I did that convinced me to build this:

| | Cloud API | My Cluster |
|---|---|---|
| Monthly cost | ~$200-400 (depending on usage) | ~$30-45 electricity |
| Hardware cost | $0 | ~$3,500 (already owned) |
| Break-even | -- | ~10-15 months |
| Privacy | Nope | Full |
| Latency | 200-500ms | 5-15ms (LAN) |
| Uptime guarantee | 99.9% | "it depends" (but the watchdog helps) |

After month 12, inference is basically free minus electricity.

### The Proxmox integration

Running TentaCLAW agents inside LXC containers works great:
- GPU passthrough via Proxmox (add GPU to LXC config)
- Agent detects the passed-through GPU normally
- Each LXC is lightweight (~200MB RAM overhead)
- Can snapshot and clone LXC containers for quick node provisioning
- Proxmox handles the host-level stuff, TentaCLAW handles the inference layer

### CLI highlights

```
$ clawtopus status
  Cluster: TENTACLAW-FARM7K3P
  Nodes: 4 online, 0 offline
  GPUs: 9 total (2 NVIDIA, 7 AMD) + 1 BitNet CPU
  VRAM: 96 GB free / 116 GB total
  Models: 5 loaded
  Health: 91/100 (A)
  Power: 287W (idle)

$ clawtopus nodes
  NODE         GPUS   VRAM        STATUS   TAGS
  pve-gpu      2      28/32 GB    online   production, nvidia
  pve-vega2    4      38/48 GB    online   inference, amd-pool
  pve-amd      3      30/36 GB    online   inference, amd-pool
  cpu-worker   0      --          online   bitnet, cpu-only

$ clawtopus deploy llama3.1:8b --tag nvidia
  Deploying to nodes tagged 'nvidia'...
  pve-gpu: pulling... done.

$ clawtopus top
  GPU               TEMP    VRAM         UTIL    POWER
  RTX 4070 Ti S #1  62C     12.4/16 GB   78%     185W
  RTX 4070 Ti S #2  58C     14.1/16 GB   65%     172W
  RX Vega 64 #1     71C     6.8/8 GB     82%     195W
  ...
```

### Links

- **GitHub**: https://github.com/TentaCLAW-OS/TentaCLAW
- **Website**: https://www.tentaclaw.io
- **License**: MIT

### Questions for r/homelab

1. Anyone else running inference clusters on Proxmox with GPU passthrough? Would love to compare notes on LXC vs VM for this.
2. How are you handling AMD GPU management? The per-architecture detection (Vega vs RDNA vs RDNA2) was one of the harder problems to solve.
3. What's your power draw look like for similar setups? I'm curious if my numbers are typical.
4. Anyone using BitNet or other CPU-only inference in their homelab?

The whole thing is MIT licensed. 144 tests. Docker Compose or bare install. An octopus mascot named CLAWtopus who lives in the terminal because at this point, why not.

Happy to answer questions about the build, the Proxmox setup, or the architecture.

---

*Eight arms. One mind. More GPUs than I probably need.*
