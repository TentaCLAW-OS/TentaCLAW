# TentaCLAW OS v3.0 — Launch Video Script

> **Runtime:** 3:00
> **Format:** Screen capture + voiceover + b-roll of hardware
> **Tone:** Confident, slightly rebellious, technically credible
> **Goal:** A viewer should understand what TentaCLAW OS is, see it actually work, and want to try it — in under 3 minutes.

---

## Pre-Production Notes

- Record all terminal footage at 1080p minimum, dark theme, font size 16+
- Use the official TentaCLAW terminal theme (cyan/purple/teal on black)
- Every terminal command must be real and reproducible — no faked output
- Voiceover should be natural, not overproduced — sounds like a builder, not a salesman
- Music: lo-fi electronic, subtle, drops out during key moments
- Cut every shot tight — no dead terminal time, no waiting for cursors

---

## Shot List

### [0:00-0:05] COLD OPEN — The Hook

**Visual:** Black screen. Terminal cursor blinks. Single line types out.
**Voiceover:**
> "What if I told you... your 5 GPU machines could think as one brain?"

**On-screen text:** The voiceover line types out in monospace, centered.
**Music:** Silent. Just keyboard clicks.

**Production note:** This frame needs to stop a scroll. No logos, no branding. Just the question.

---

### [0:05-0:15] THE PROBLEM — Real Hardware, Real Mess

**Visual:** Quick cuts of a messy desk / rack / shelf with multiple PCs, cables, GPUs visible through side panels. Real hardware, not stock footage.
**Voiceover:**
> "I have 5 machines. 9 GPUs. NVIDIA, AMD, even a CPU-only box. They all run models. None of them talk to each other. Managing them is held together with bash scripts and prayers."

**On-screen text overlay (lower third):**
```
5 machines | 9 GPUs | 0 coordination
```

**Production note:** This should feel relatable to anyone running a homelab. Show the chaos.

---

### [0:15-0:25] THE SOLUTION — One Command

**Visual:** Clean terminal. Full screen. Single command typed and executed.
**Terminal:**
```bash
curl -fsSL tentaclaw.io/install | bash
```

**Voiceover:**
> "One command. That's it."

**Visual:** Install output scrolls — driver detection, agent install, gateway discovery. Keep it fast (2x speed if needed). End on a success message.

**On-screen text:** `One command. Zero config.`

---

### [0:25-0:35] CLAWTOPUS BOOT — The Mascot Moment

**Visual:** Full-screen CLAWtopus ASCII art boot splash appears. The progress bars animate — hardware detection, network config, cluster registration.
**Voiceover:**
> "Meet CLAWtopus. She runs your cluster. She detects your hardware, finds other nodes on the network, and registers everything into one farm. Automatically."

**Terminal shows:**
```
[CLAWtopus ASCII boot splash]

Detecting hardware... RTX 3090 (24GB) x2
Detecting hardware... RX 7900 XTX (24GB) x1
Network: Auto-discovered gateway at 192.168.1.50
Farm Hash: TENTACLAW-F7K3P
Registration: complete

Eight arms. One mind. Zero compromises.
> per-token is a scam_
```

**Production note:** Let the boot splash breathe for 2-3 seconds. This is the screenshot people will share.

---

### [0:35-0:45] DASHBOARD — Visual Proof

**Visual:** Browser opens. Dashboard loads. All 5 nodes appear in a grid. GPU cards show temp bars, VRAM utilization, status indicators. Everything green.
**Voiceover:**
> "Zero config. Auto-discovery. Every GPU detected. Every node healthy. One dashboard to see it all."

**Quick cuts showing:**
1. Node grid with 5 healthy nodes
2. GPU detail cards (temp, VRAM, utilization rings)
3. Cluster health score: 98/100 "A+"

**On-screen text:** `5 nodes | 9 GPUs | 98/100 health`

---

### [0:45-1:00] DISTRIBUTED DEPLOY — The Money Shot

**Visual:** Back to terminal. Single deploy command.
**Terminal:**
```bash
$ clawtopus deploy deepseek-r1:70b

Analyzing cluster capacity...
  deepseek-r1:70b requires ~42GB VRAM
  Splitting across 2 nodes: gpu-rig-01 (24GB) + gpu-rig-03 (24GB)

Pulling model... ████████████████████████ 100%
Loading shards...
  Shard 1/2 → gpu-rig-01 [RTX 3090]  ✓
  Shard 2/2 → gpu-rig-03 [RX 7900 XTX]  ✓

✓ deepseek-r1:70b deployed (distributed across 2 nodes)
  Endpoint: http://gateway:8080/v1/chat/completions
```

**Voiceover:**
> "Deploy a 70 billion parameter model. CLAWtopus splits it across 2 nodes automatically. NVIDIA and AMD, working together. No Kubernetes. No YAML. One command."

**Production note:** This is the technical credibility moment. Show the real output. Let viewers read it.

---

### [1:00-1:15] LIVE INFERENCE — It Actually Works

**Visual:** Terminal. Chat command with streaming response.
**Terminal:**
```bash
$ clawtopus chat --model deepseek-r1:70b

You: Explain distributed inference in one paragraph.

CLAWtopus [deepseek-r1:70b] (2 nodes, 42.3 tok/s):
Distributed inference splits a large language model across multiple
GPUs on different machines, where each GPU holds a portion of the
model's layers. When a request arrives, the input flows through
the first GPU's layers, then the intermediate activations are sent
over the network to the next GPU, which processes the remaining
layers. This pipeline parallelism allows running models that exceed
any single GPU's memory capacity...
```

**Voiceover:**
> "Distributed inference. On your own hardware. No cloud fees. 42 tokens per second on consumer GPUs."

**On-screen text:** `70B model | 2 nodes | 42.3 tok/s | $0.00 per token`

---

### [1:15-1:30] MONITORING — Grafana Eye Candy

**Visual:** Dashboard monitoring panel. GPU temperature heatmap. VRAM bar charts. Inference throughput graph trending upward. Real-time request flow visualization.
**Voiceover:**
> "Real-time monitoring. GPU temps, VRAM usage, inference throughput, request routing — all visualized. Grafana dashboards included out of the box."

**Quick cuts showing:**
1. GPU temperature heatmap (color grid, all green/yellow)
2. Inference throughput chart (tok/s over time)
3. Per-node VRAM utilization bars
4. Request routing flow (which requests hit which nodes)

**Production note:** Make the dashboard look like a trading terminal. Dense, colorful, live.

---

### [1:30-1:45] FINE-TUNING — Your Data, Your Model

**Visual:** Terminal. Fine-tune command.
**Terminal:**
```bash
$ clawtopus finetune create \
    --base llama3.1:8b \
    --data ./customer-support.jsonl \
    --method qlora \
    --output my-company-llama

Validating dataset... 12,847 conversations ✓
Estimating VRAM... QLoRA 8B requires ~14GB ✓
Assigned to: gpu-rig-02 [RTX 4090, 24GB]

Training... epoch 1/3 ████████░░░░░░░░ 48%
  Loss: 1.24 → 0.87 (↓ 30%)
  Learning rate: 2e-4
  ETA: 47 minutes
```

**Voiceover:**
> "Fine-tune on your own data. One command. QLoRA on consumer GPUs. Your training data never leaves your network."

**On-screen text:** `Your data. Your model. Your hardware.`

---

### [1:45-2:00] BENCHMARKS — Prove It Worked

**Visual:** Terminal. Benchmark command and results.
**Terminal:**
```bash
$ clawtopus benchmark run --model my-company-llama

Running benchmark suite...

  Throughput     38.2 tok/s    (vs base: 41.1 tok/s, -7%)
  MMLU           72.4%         (vs base: 68.1%, +4.3%)
  HumanEval      51.2%         (vs base: 47.8%, +3.4%)
  Custom eval    94.7%         (vs base: 31.2%, +203%)

  ★ Fine-tune improved custom task accuracy by 203%
  ★ Throughput impact: minimal (-7%)

Verdict: "Ship it." — CLAWtopus
```

**Voiceover:**
> "Built-in benchmarks tell you if your fine-tune actually worked. No guessing. No vibes. Numbers."

---

### [2:00-2:15] CLAWHUB — The Ecosystem

**Visual:** Terminal. Package install.
**Terminal:**
```bash
$ clawtopus hub search rag

  @tentaclaw/rag-stack        Full RAG pipeline (embeddings + vector DB + retrieval)
  @tentaclaw/code-review      Code review pipeline with AST analysis
  @tentaclaw/doc-qa           Document Q&A with PDF/DOCX ingestion
  @tentaclaw/voice-assistant   Voice-to-text + LLM + text-to-speech pipeline

  162 packages available in CLAWHub

$ clawtopus hub install @tentaclaw/rag-stack

Installing @tentaclaw/rag-stack...
  ✓ ChromaDB (vector store)
  ✓ Embedding model (nomic-embed-text)
  ✓ Retrieval pipeline
  ✓ API endpoints (/v1/rag/ingest, /v1/rag/query)

Deployed. RAG pipeline live at http://gateway:8080/v1/rag/query
```

**Voiceover:**
> "162 packages in CLAWHub. Install an entire RAG pipeline with one command. Voice assistants, code review, document Q&A — all running on your hardware."

**On-screen text:** `One command. Entire pipeline. Your hardware.`

---

### [2:15-2:30] COST INTELLIGENCE — The Anti-Cloud Manifesto

**Visual:** Terminal. Cost command.
**Terminal:**
```bash
$ clawtopus cost

  COST INTELLIGENCE

  This month:
  ┌─────────────────────────────────────────────────┐
  │  Tokens served          14,247,832              │
  │  Power consumption      450W avg                │
  │  Electricity cost       $38.88                  │
  │  Cost per 1M tokens     $0.03                   │
  │                                                 │
  │  SAVINGS vs CLOUD                               │
  │  vs OpenAI GPT-4o       $4,658    (saved 99.2%) │
  │  vs Anthropic Claude    $5,432    (saved 99.3%) │
  │  vs Together AI         $890      (saved 95.6%) │
  │                                                 │
  │  Hardware ROI                                   │
  │  RTX 4090: paid for itself in 47 days           │
  │  RTX 3090: paid for itself in 62 days           │
  └─────────────────────────────────────────────────┘

  CLAWtopus: "Per-token pricing is a scam. You already knew that."
```

**Voiceover:**
> "$4,658 saved versus OpenAI this month. $0.03 per million tokens versus $15 per million. Per-token pricing is a scam. CLAWtopus does the math so you don't have to justify it."

**On-screen text:** `$0.03/M tokens vs $15.00/M tokens`

**Production note:** Let this screen sit for 3 full seconds. People will screenshot this.

---

### [2:30-2:45] VIBE CHECK — The Personality Moment

**Visual:** Terminal. Vibe command.
**Terminal:**
```bash
$ clawtopus vibe

  ╭──────────────────────────────────────╮
  │                                      │
  │     ,---.                            │
  │    / ◉ ◉  \                          │
  │    |  ω   |  everything's smooth     │
  │    \~~~~~/                            │
  │     `--'                             │
  │                                      │
  │  8 nodes │ 12 GPUs │ 100/100         │
  │  42.3 tok/s │ all models healthy     │
  │                                      │
  │  "Not bad for a pile of silicon."    │
  │                                      │
  ╰──────────────────────────────────────╯
```

**Voiceover:**
> "And when you just want to know if everything's okay... she'll tell you."

**Music:** Drops out entirely for this moment. Let the terminal speak.

**Production note:** This is the emotional beat. CLAWtopus is the personality that makes people remember the product.

---

### [2:45-3:00] CLOSING — The Call to Action

**Visual:** Split screen. Left: terminal with CLAWtopus ASCII. Right: dashboard with healthy cluster.

**Voiceover:**
> "TentaCLAW OS. Your GPUs. One brain. Zero limits."

**Visual transitions to end card:**
```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║              TENTACLAW OS v3.0                        ║
║                                                      ║
║           Your GPUs. One brain. Zero limits.          ║
║                                                      ║
║     github.com/TentaCLAW-OS/TentaCLAW                ║
║     www.tentaclaw.io                                  ║
║                                                      ║
║     ╭───╮                                            ║
║     │ ◉ │  "Per-token pricing is a scam."            ║
║     ╰───╯                                            ║
║                                                      ║
║  ★ Star us on GitHub                                 ║
║  🐙 Join The Tank on Discord                         ║
║  ⚡ Flash. Boot. Deploy.                              ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

**On-screen text (final frame, hold 5 seconds):**
- `github.com/TentaCLAW-OS/TentaCLAW`
- `www.tentaclaw.io`
- `Star us on GitHub. Join The Tank on Discord.`
- `Per-token pricing is a scam.`

**Music:** Fades back in, builds slightly, clean end.

---

## Post-Production Checklist

- [ ] Every terminal command is real and verified
- [ ] No screen sits idle for more than 2 seconds
- [ ] First frame is strong enough to stop a scroll
- [ ] Audio levels are consistent throughout
- [ ] Captions/subtitles added for accessibility
- [ ] End card holds for 5 seconds minimum
- [ ] Export at 1080p and 4K
- [ ] Create 60-second cut for social media (use: hook, deploy, cost, end card)
- [ ] Create 15-second cut for ads (use: hook, deploy command, cost number, end card)
- [ ] Thumbnail: CLAWtopus ASCII + "5 GPUs, 1 Brain" text

## Derivative Cuts

### 60-Second Social Cut
Use shots: [0:00] Cold open + [0:45] Deploy + [1:00] Inference + [2:15] Cost + [2:45] Closing

### 15-Second Ad Cut
Use shots: [0:00] Hook line + [0:45] Deploy command + [2:15] "$4,658 saved" + [2:45] End card

### GIF (10 seconds, no audio)
Use shots: Boot splash + Dashboard grid + Deploy output + Vibe check
