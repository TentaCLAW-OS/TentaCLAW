# Twitter/X Thread Drafts

---

## Thread 1: "Why I Built TentaCLAW OS" (Origin Story)

**1/**
I was paying $200/month for AI API access while a 3090 sat under my desk doing nothing.

That was embarrassing. So I plugged it in.

Then I plugged in a second one. And a third.

That's when the real problem started.

**2/**
Managing multiple GPU machines for inference is terrible.

SSH into each box. Check if Ollama is alive. Check which model is loaded. Check VRAM. Check temps. Repeat for every node.

I had 4 machines. It felt like 40.

**3/**
Mining had this problem 8 years ago.

HiveOS solved it: flash, boot, auto-detect, register, manage from one dashboard.

AI inference in 2026 still doesn't have that.

Spreadsheets and bash scripts. Somehow.

**4/**
So I built TentaCLAW OS.

An operating system for AI inference clusters.

Flash a USB. Boot the node. It auto-discovers the gateway on your LAN. Registers itself. Starts pushing stats. Receives commands.

Zero config.

**5/**
The stack today:
- 200+ API endpoints
- Web dashboard
- CLI with 60+ commands
- OpenAI-compatible proxy
- Auto-discovery (UDP broadcast)
- Mixed GPU support (NVIDIA + AMD + CPU)
- Flight sheets for model deployment
- Self-healing watchdog
- 144 tests passing

**6/**
The part I'm most proud of: BitNet CPU inference.

Microsoft's 1-bit models run on ANY CPU. No GPU needed.

That old server collecting dust? It's an inference node now.

2-6x faster than FP16 on CPU. 70% less energy. TentaCLAW routes to it automatically.

**7/**
The mascot is an octopus named CLAWtopus.

She lives in your terminal. She has eight arms (route, balance, monitor, deploy, benchmark, overclock, heal, scale).

She has opinions about your VRAM usage.

I'm not apologizing for any of this.

**8/**
The real point is simple:

If you already own GPUs, you should be able to run inference on them without building a tiny DevOps company around your homelab.

TentaCLAW OS is that missing layer.

**9/**
MIT licensed. No cloud. No telemetry. No "open core" bait-and-switch.

Your hardware. Your inference. Your cluster.

GitHub: github.com/TentaCLAW-OS/TentaCLAW
Web: tentaclaw.io

**10/**
Eight arms. One mind. Zero compromises.

Per-token is a scam. Run local.

[screenshot of dashboard + CLI]

---

## Thread 2: "Per-Token Pricing Is a Scam" (Manifesto)

**1/**
Per-token pricing is a scam.

Not because the APIs are bad. They're good. But the pricing model is designed to make you afraid of your own usage.

"What if my agent loops?" "What if I hit rate limits?" "What if my bill spikes?"

That fear is the product.

**2/**
Here's the math nobody talks about:

A used RTX 3090 costs $600.
It runs llama3.1:8b at 80-120 tok/s.
Electricity: ~$15/month at full load.

Break-even vs API pricing: 3-4 months.

After that, inference is basically free forever.

**3/**
"But local models aren't as good as GPT-4!"

For many tasks? They're good enough. And getting better every month.

Summarization. Classification. Code review. Data extraction. RAG. Chat.

You don't need frontier models for 80% of real workloads.

**4/**
The real problem wasn't running one local model. It was running a cluster.

Multiple machines. Mixed GPUs. Model routing. Health monitoring. Deployment.

That's what TentaCLAW OS solves.

Flash. Boot. Deploy. Route. Monitor. Done.

**5/**
Own the hardware. Own the inference. Own the failure modes too.

That's the deal. You trade SLA guarantees for sovereignty.

Most homelabbers and small teams already made that trade for everything else. AI inference should be no different.

**6/**
TentaCLAW OS. MIT licensed. No cloud dependency.

Your tokens. Your cost. Your cluster.

Per-token is a scam. Run local.

github.com/TentaCLAW-OS/TentaCLAW

---

## Thread 3: "GPU Cluster in 5 Minutes" (Demo Walkthrough)

**1/**
POV: You want a local AI inference cluster but don't want to become a DevOps team.

Here's the entire setup. 5 minutes. For real.

[thread]

**2/**
Step 1: Install the gateway (30 seconds)

```
git clone github.com/TentaCLAW-OS/TentaCLAW
cd TentaCLAW/gateway
npm install && npm run dev
```

Dashboard is live at localhost:8080/dashboard.

Empty cluster. Ready for nodes.

**3/**
Step 2: Start a node (30 seconds)

```
cd agent
npm install
npx tsx src/index.ts --mock
```

The agent auto-discovers the gateway. Registers. Starts pushing stats.

Refresh the dashboard. Your first node is there. GPUs detected. Models listed. Health score: 100.

**4/**
Step 3: Deploy a model (10 seconds)

```
clawtopus deploy llama3.1:8b
```

The gateway picks the best node (most free VRAM). Pulls the model. Reports progress. Done.

**5/**
Step 4: Run inference (5 seconds)

```
curl localhost:8080/v1/chat/completions \
  -d '{"model":"llama3.1:8b","messages":[{"role":"user","content":"hello"}]}'
```

Or use the CLI:
```
clawtopus chat --model llama3.1:8b
```

OpenAI-compatible. Point any client at your cluster.

**6/**
That's it. Gateway + agent + model + inference.

For production: flash the ISO to USB, boot real hardware, and the flow is the same but with real GPUs.

No YAML. No Kubernetes. No cloud.

TentaCLAW OS: tentaclaw.io
GitHub: github.com/TentaCLAW-OS/TentaCLAW

Eight arms. One mind.

---

## Thread 4: "BitNet: AI Without GPUs" (Technical)

**1/**
What if I told you that you could run AI inference without any GPU at all?

Not slowly. Not as a toy. Actually useful inference on pure CPU.

It's called BitNet, and we built it into TentaCLAW OS as a first-class backend.

**2/**
BitNet uses 1-bit ternary weights (-1, 0, 1). Not quantized from larger models -- trained from scratch with 1-bit weights.

Result:
- 2-6x faster inference on CPU vs FP16
- ~70% less energy
- Model files are tiny (3B params = ~400MB)
- Runs on ANY x86_64 CPU

**3/**
Real numbers from our cluster:

Ryzen 9 7950X: 25-40 tok/s (8B model)
Ryzen 7 5800X: 40-60 tok/s (2B model)
i7-13700K: 15-25 tok/s (8B model)

Not GPU-fast. But useful. Especially for lightweight tasks: classification, summarization, simple chat.

**4/**
In TentaCLAW OS, the agent auto-detects the BitNet binary and registers the node as a CPU inference backend.

The gateway routes BitNet model requests to CPU nodes automatically. GPU requests go to GPU nodes. The client doesn't know or care.

Mixed cluster: GPUs for heavy lifting, CPUs for the long tail.

**5/**
That old server under your desk. The retired workstation in the closet. The NAS with spare CPU cycles.

All inference nodes now. Zero GPU cost. Zero additional hardware.

TentaCLAW OS: tentaclaw.io

1-bit weights. 8 arms. Zero excuses.

---

## Thread 5: "What We Shipped" (Feature Highlight Reel)

**1/**
We just shipped TentaCLAW OS.

AI inference cluster operating system. Open source. MIT licensed.

Here's everything in the box.

[thread -- features]

**2/**
THE GATEWAY

200+ REST API endpoints. Web dashboard with real-time node cards. SSE event stream. OpenAI-compatible inference proxy. Prometheus metrics. Webhook notifications. Health scoring (0-100, A-F grades).

All backed by SQLite. No external database needed.

[screenshot]

**3/**
THE AGENT

Zero-dependency TypeScript daemon. Runs on each node.

Detects NVIDIA (nvidia-smi), AMD (rocm-smi with per-GPU architecture mapping), and Intel GPUs. Manages Ollama, BitNet, and other backends. Pushes stats every 10s. Watchdog restarts crashed services.

Auto-discovery: finds the gateway via UDP broadcast. No manual config.

**4/**
THE CLI (CLAWtopus)

60+ commands. The octopus on the command line.

`clawtopus status` -- cluster overview
`clawtopus deploy` -- push models
`clawtopus chat` -- inference
`clawtopus top` -- live GPU stats
`clawtopus drain` -- gracefully empty a node
`clawtopus doctor` -- diagnose problems
`clawtopus benchmarks` -- performance data

**5/**
FLIGHT SHEETS

Declarative model deployment. "These models on these nodes."

```
clawtopus apply <sheet-id>
```

Tag your nodes (`production`, `amd-pool`, `cpu-only`). Deploy to tags. The gateway handles the rest.

No SSH. No per-node commands.

**6/**
BITNET CPU INFERENCE

1-bit models on pure CPU. No GPU required.

The agent detects the BitNet binary, starts the server on port 8082, and the gateway routes requests transparently.

Every spare machine becomes an inference node.

**7/**
THE ISO

Bootable USB image. Debootstrap Ubuntu 24.04. GRUB BIOS+UEFI. PXE network boot for racks.

Flash. Boot. CLAWtopus detects GPUs. Registers with the gateway. Done.

This is the "zero config" part. Actually zero config.

**8/**
THE NUMBERS

- 200+ API endpoints
- 60+ CLI commands
- 144 tests (all passing, strict TypeScript)
- 11 database tables
- 15+ shared type definitions
- Sub-5ms request routing on LAN
- MIT license
- Zero cloud dependency
- Zero telemetry

GitHub: github.com/TentaCLAW-OS/TentaCLAW
Web: tentaclaw.io

Eight arms. One mind. Zero compromises.

[dashboard screenshot]
