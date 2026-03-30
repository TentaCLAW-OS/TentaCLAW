# r/LocalLLaMA Launch Post

## Title
I built an OS that turns scattered GPUs into one AI inference cluster -- zero config, auto-discovery, mixed NVIDIA+AMD+CPU(BitNet)

## Body

I've been running local LLMs across multiple machines for the past year and finally snapped. Managing GPU nodes individually is painful. Bash scripts duct-taped to cron jobs. SSH-ing into each box to check if Ollama is still alive. Manually tracking which model is loaded where. Forgetting that one node crashed three days ago.

So I built **TentaCLAW OS** -- an AI inference cluster operating system. Think HiveOS, but for inference instead of mining.

### The Problem

You have 2-8 GPU machines. You want them to act as one cluster. Today that means:
- Manual GPU config on every node
- Custom scripts to push stats and check health
- No unified way to deploy models across nodes
- No smart routing (request goes to... whichever box you remembered)
- Mixed hardware? Good luck. NVIDIA here, AMD there, that old CPU box collecting dust.

### The Solution

Flash a USB (or `curl -fsSL tentaclaw.io/install | bash`). Boot. Done.

The node auto-discovers the gateway on your LAN via UDP broadcast on port 41337. Registers itself with a Farm Hash (one ID for your entire cluster). Pushes stats every 10 seconds. Receives commands in the HTTP response. Self-heals via watchdog.

No Kubernetes. No Docker orchestration PhD. No cloud dependency.

### What's actually built

This is not a landing page. The stack is real and tested:

- **Gateway**: 200+ REST API endpoints (Hono + SQLite), web dashboard, SSE events, Prometheus metrics
- **Agent**: Zero-dep TypeScript daemon -- NVIDIA/AMD/Intel GPU stats, auto-discovery (UDP + mDNS), watchdog, overclock support
- **CLAWtopus CLI**: 60+ commands -- `chat`, `deploy`, `top`, `drain`, `cordon`, `doctor`, `backends`, `benchmarks`
- **OpenAI-compatible**: `/v1/chat/completions` and `/v1/models` -- point any client at your cluster
- **BitNet CPU inference**: 1-bit models run on ANY x86_64 CPU at 2-6x speed, 70% less energy. That dusty old server? It's an inference node now.
- **Smart VRAM routing**: Gateway knows which node has which model and how much VRAM is free. Requests go to the right place.
- **Flight sheets**: Model deployment configs. Deploy llama3.1:8b to all nodes with one command.
- **Mixed hardware**: NVIDIA via nvidia-smi, AMD via rocm-smi with per-GPU architecture detection, CPU via BitNet. All in one cluster.
- **MCP Server**: AI agents can manage your cluster via tool calls (Model Context Protocol)
- **144 tests**: 101 gateway + 28 agent + 15 CLI. Strict TypeScript. All passing.

### Terminal demo

Here's what the boot-to-inference flow looks like:

```
$ curl -fsSL tentaclaw.io/install | bash
[TentaCLAW] Installing agent...
[TentaCLAW] Detecting hardware...

   ╭──────────────────╮
   │  TENTACLAW OS    │
   │  AI Cluster OS   │
   ╰──────────────────╯
      ,---.
     / o o \
     | \___/ |
      \_____/
       |||||
   CLAWtopus online. 8 arms ready.

[GPU] Detected: NVIDIA RTX 3090 (24GB VRAM)
[GPU] Detected: NVIDIA RTX 4070 Ti Super (16GB VRAM)
[NET] Gateway discovered at 192.168.1.100:8080 (UDP broadcast)
[REG] Farm Hash: TENTACLAW-FARM7K3P
[REG] Node ID: TENTACLAW-FARM7K3P-node1
[PUSH] Stats → gateway (200 OK, 0 pending commands)
[HEALTH] All systems nominal. CLAWtopus is watching.

$ clawtopus status
  Cluster: TENTACLAW-FARM7K3P
  Nodes: 4 online, 0 offline
  GPUs: 9 total (6 NVIDIA, 2 AMD, 1 BitNet CPU)
  VRAM: 112 GB available / 144 GB total
  Models: 7 loaded
  Health: 94/100 (A)

$ clawtopus deploy llama3.1:8b
  Deploying llama3.1:8b...
  Best node: gpu-rig-02 (RTX 4090, 18GB free VRAM)
  Pulling... ████████████████████ 100%
  Model ready. Serving on /v1/chat/completions

$ clawtopus chat --model llama3.1:8b
  You: What is TentaCLAW OS?
  llama3.1:8b: TentaCLAW OS is an operating system designed
  for managing GPU inference clusters...
  [42.3 tok/s via gpu-rig-02]
```

### Architecture

```
  CLAWtopus CLI ──► TentaCLAW Gateway (:8080)
                    REST API / Dashboard / SSE / OpenAI Proxy
                              │
               ┌──────────────┼──────────────┐
               │              │              │
          GPU Node 1     GPU Node 2     CPU Node 3
          (Ollama)       (Ollama)       (BitNet)
          RTX 4090       RTX 3090       Ryzen 9
          llama3:70b     llama3:8b      bitnet-b1.58-2B
```

Nodes push stats to the gateway. Gateway routes inference requests to the best available node. If a node dies, the watchdog restarts it and the gateway reroutes. The client never notices.

### The BitNet angle

This is the part I'm most excited about. BitNet (Microsoft's 1-bit LLM architecture) runs on pure CPU. No GPU required. The agent auto-detects the BitNet binary and registers as a CPU inference backend. The gateway routes BitNet model requests to CPU nodes transparently.

Performance numbers on CPU:
- Ryzen 7 5800X: ~40-60 tok/s (bitnet-b1.58-2B)
- i7-13700K: ~15-25 tok/s (bitnet-b1.58-8B)
- Ryzen 9 7950X: ~25-40 tok/s (bitnet-b1.58-8B)

That old server under your desk? It's an inference node now. Zero GPU cost.

### Links

- **GitHub**: https://github.com/TentaCLAW-OS/TentaCLAW
- **Website**: https://www.tentaclaw.io
- **License**: MIT (fully open source, no "open core" games)

### What I'd love feedback on

1. What's missing for your homelab/cluster setup?
2. Anyone running mixed NVIDIA+AMD? How's your experience?
3. BitNet CPU inference -- has anyone else integrated this into a cluster?
4. What models/backends should we prioritize next? (vLLM support is on the roadmap)

The mascot is an octopus named CLAWtopus. She lives in your terminal. She has opinions. The cluster management is the serious part.

---

*Eight arms. One mind. Zero compromises.*
