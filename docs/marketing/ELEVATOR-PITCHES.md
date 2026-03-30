# TentaCLAW OS v3.0 — Elevator Pitches

> Pitch-per-audience. Every audience cares about something different.
> Use the right pitch for the right room.

---

## r/homelab

### Core Angle
TentaCLAW is like HiveOS but for AI. Flash a USB, boot, and your GPU box auto-joins the cluster. Zero config.

### 30-Second Pitch
> I had 5 machines with GPUs sitting around doing nothing useful. Setting them up for AI inference meant SSH-ing into each one, installing drivers, configuring Ollama, writing bash scripts to check if things were alive. TentaCLAW OS replaces all of that. Flash a USB, boot the machine, and it auto-discovers the gateway on your LAN, registers itself, and starts accepting inference requests. One dashboard shows everything. One CLI controls everything.

### 60-Second Pitch
> I had 5 machines with GPUs sitting around doing nothing useful. Setting them up for AI inference meant SSH-ing into each one, installing drivers, configuring Ollama, writing bash scripts to check if things were alive, and hoping nothing crashed overnight.
>
> TentaCLAW OS replaces all of that. It's a purpose-built Linux distribution for AI inference clusters. Flash a USB, boot the machine, and it auto-discovers the gateway on your LAN, detects your GPUs (NVIDIA and AMD), registers the node into your farm, and starts accepting inference requests. No manual driver installs. No config files. No port forwarding.
>
> One dashboard shows every node, every GPU, temps, VRAM, throughput. One CLI lets you deploy models, run inference, fine-tune, benchmark. There's even a built-in cost calculator that shows you exactly how much you're saving versus OpenAI.
>
> It's free, open source, and there's an octopus mascot in the terminal who roasts you when your VRAM is full.

### 2-Minute Pitch
> I've been running a homelab for years. Started with Proxmox, Plex, the usual stuff. Then I got into local AI and suddenly had 5 machines with 9 GPUs that I was managing with SSH sessions and cron jobs. Every time I wanted to try a new model, I had to figure out which machine had enough VRAM, SSH in, pull the model, hope the drivers didn't break. It was terrible.
>
> I used to run mining rigs, and I missed how easy HiveOS made it. Flash a USB, boot, everything just works. So I built TentaCLAW OS to be that for AI inference.
>
> Here's how it works: you flash the ISO to a USB stick. Boot your GPU machine from it. On first boot, TentaCLAW OS auto-detects all GPUs (NVIDIA via nvidia-smi, AMD via sysfs, even CPU-only boxes for smaller models). It broadcasts on the LAN to find the gateway. When it finds it, the node registers itself automatically with a Farm Hash — one ID for your entire cluster. No IPs to configure, no ports to open, no YAML to write.
>
> From there, you manage everything from one place. The dashboard shows all nodes in a grid — GPU temps, VRAM usage, loaded models, health scores. The CLI (CLAWtopus) lets you deploy models across the cluster with one command. If a model is too big for one GPU, it splits it across multiple nodes automatically. Distributed inference on consumer hardware. I'm running DeepSeek-R1 70B across an RTX 3090 and an RX 7900 XTX right now.
>
> There's also fine-tuning (QLoRA on consumer GPUs), a package manager (CLAWHub, 162 packages), built-in benchmarks, a cost intelligence dashboard that calculates your savings versus cloud providers, and a health monitoring system with alerting.
>
> It's free, open source, 59K lines of code, and the mascot is an octopus named CLAWtopus who has terminal ASCII art for every mood. If your VRAM is full, she judges you. If your cluster is healthy, she says "not bad for a pile of silicon."
>
> github.com/TentaCLAW-OS/TentaCLAW

---

## r/LocalLLaMA

### Core Angle
Run Llama 70B across multiple machines without Kubernetes. 6 inference backends. Auto model splitting. One CLI.

### 30-Second Pitch
> TentaCLAW OS turns your pile of GPU machines into one unified inference cluster. Deploy a 70B model and it automatically splits across multiple nodes — NVIDIA, AMD, even CPU-only boxes. No Kubernetes, no Docker Compose, no YAML. `clawtopus deploy deepseek-r1:70b` and it handles the rest. 6 backends supported: Ollama, vLLM, llama.cpp, TensorRT-LLM, text-generation-inference, and ExLlamaV2.

### 60-Second Pitch
> If you've ever tried to run a model that's too big for one GPU, you know the pain. Tensor parallelism setup, NCCL configuration, making sure both machines can see each other, custom scripts to route requests. TentaCLAW OS makes that a one-command operation.
>
> It's a cluster OS — a purpose-built Linux distribution where each GPU machine is a node. Nodes auto-discover each other on LAN. When you deploy a model, CLAWtopus (the CLI) analyzes your cluster's available VRAM and automatically assigns model shards to the right nodes. RTX 3090 with 24GB and an RX 7900 XTX with 24GB? Perfect, that's 48GB of combined VRAM for a 70B model.
>
> Beyond deployment, there's built-in fine-tuning (QLoRA on consumer GPUs, one command), benchmarking (MMLU, HumanEval, custom evals), a package manager with 162 packages (RAG stacks, code review pipelines, voice assistants), and cost tracking that proves your ROI versus cloud APIs. All of it exposed through an OpenAI-compatible API, so your existing code just works.
>
> 59K lines. Free. Open source. Six inference backends. One octopus.

### 2-Minute Pitch
> The local LLM space has incredible models now — Llama 3.1, DeepSeek, Qwen, Mistral. What we don't have is good infrastructure for running them at scale on hardware we own. You can run Ollama on one machine, sure. But what happens when you have 3 machines? 5 machines? A mix of NVIDIA and AMD? A model that needs 40GB but your biggest GPU has 24GB?
>
> That's what TentaCLAW OS solves. It's a GPU cluster operating system. Each machine runs the TentaCLAW agent, which auto-detects GPUs, registers with a central gateway, and reports health every 10 seconds. The gateway knows the full topology of your cluster — which nodes have which GPUs, how much VRAM is free, what models are loaded, what the throughput looks like.
>
> When you run `clawtopus deploy deepseek-r1:70b`, CLAWtopus calculates the optimal placement. If no single node can hold it, it splits the model across multiple nodes using pipeline parallelism. The routing layer handles requests transparently — your client hits one OpenAI-compatible endpoint and the gateway routes to the right nodes, handles streaming, manages failover.
>
> We support 6 inference backends: Ollama (default, easiest), vLLM (best throughput), llama.cpp (most hardware support), TensorRT-LLM (NVIDIA optimization), text-generation-inference (HuggingFace compatibility), and ExLlamaV2 (GPTQ/EXL2 quantization). Mix and match per node based on your hardware.
>
> Fine-tuning is built in. `clawtopus finetune create --base llama3.1:8b --data ./my-data.jsonl --method qlora` and it handles dataset validation, VRAM estimation, GPU assignment, and training. QLoRA on a 3090 does 8B models comfortably. After training, `clawtopus benchmark run` tells you if it actually improved.
>
> CLAWHub has 162 packages — install a full RAG pipeline with `clawtopus hub install @tentaclaw/rag-stack`. Voice assistants, code review, document Q&A, all as one-command installs.
>
> Cost intelligence tracks your actual electricity usage and compares it to cloud pricing. Most clusters pay for themselves in 45-60 days versus what you'd spend on API calls.
>
> It's free, open source, 59K lines, and the mascot is an octopus who lives in your terminal. Per-token pricing is a scam. Run local.

---

## r/selfhosted

### Core Angle
Self-hosted GPU cluster. No cloud. No Kubernetes. Just your GPUs, one dashboard, and one CLI.

### 30-Second Pitch
> TentaCLAW OS is a self-hosted GPU cluster operating system. Flash a USB, boot your machines, they auto-discover each other and form a cluster. Deploy AI models with one command. Monitor everything from one dashboard. No cloud dependency, no Kubernetes, no subscription fees. Your hardware, your data, your inference. Open source.

### 60-Second Pitch
> If you self-host everything else, why are you still paying per-token for AI? TentaCLAW OS is a purpose-built Linux distribution that turns your GPU machines into a self-managing AI inference cluster.
>
> The setup is as close to zero as possible: flash the ISO, boot the machine, it auto-detects GPUs, finds other nodes on the LAN, and joins the cluster. No Docker Compose, no Ansible playbooks, no env files. The gateway manages everything — node health, model deployment, request routing, load balancing.
>
> You get a dashboard (GPU temps, VRAM, throughput, health scores), a CLI for cluster management, an OpenAI-compatible API for your apps, fine-tuning on your own data, a package manager with 162 pre-built pipelines, and cost tracking that shows exactly how much you're saving.
>
> All data stays on your network. All inference runs on your hardware. The only outbound connection is optional telemetry (off by default). Self-hosted down to the OS level.

### 2-Minute Pitch
> I'm a self-hoster. Everything I run — media, DNS, email, VPN, monitoring — runs on hardware I own in my house. But when it came to AI, I was paying OpenAI $200/month because setting up a proper local inference stack was too painful.
>
> Not "install Ollama on one box" painful — that part is fine. I mean "I have 5 machines with 9 GPUs and I want them to work as one cluster" painful. Managing drivers across NVIDIA and AMD, keeping models in sync, routing requests to the right node, handling failures, monitoring health — it was bash scripts and SSH all the way down.
>
> TentaCLAW OS is the self-hosted solution for that. It's a bootable Linux distro purpose-built for GPU inference clusters. The experience is: flash a USB, boot a machine, it joins your cluster automatically. Auto GPU detection (NVIDIA, AMD, Intel Arc, CPU-only). mDNS discovery on LAN. Zero config files to edit.
>
> The gateway is your cluster brain. It knows every node, every GPU, every model. Deploy a model and it figures out where it fits. If a model needs more VRAM than one GPU, it splits across nodes. If a node goes down, requests get rerouted. The API is OpenAI-compatible, so you swap one URL in your apps and everything works.
>
> The dashboard gives you the full picture — node grid, GPU stats, model status, health scores, inference throughput. The CLI (CLAWtopus) does everything the dashboard does, plus fine-tuning, benchmarking, package management, cost tracking, and diagnostics.
>
> CLAWHub has 162 packages. `clawtopus hub install @tentaclaw/rag-stack` gives you a full RAG pipeline — vector DB, embedding model, retrieval API — deployed to your cluster in one command. There are packages for voice assistants, code review, document Q&A, image generation, and more.
>
> Cost intelligence is built in. `clawtopus cost` shows your actual electricity spend, cost per million tokens, and a comparison to cloud providers. My cluster costs $0.03 per million tokens. OpenAI charges $15. That's not a typo.
>
> It's free, open source (MIT), 59K lines, and the octopus mascot in the terminal has more personality than most SaaS products. Everything stays on your network. No cloud. No telemetry by default. No per-token fees. Just your GPUs.

---

## Hacker News

### Core Angle
Purpose-built OS for GPU inference clusters with declarative management, auto-discovery, and distributed inference. Like HiveOS, but for AI.

### 30-Second Pitch
> TentaCLAW OS is a cluster operating system for GPU inference. Nodes auto-discover via mDNS, register with a central gateway, and expose a unified OpenAI-compatible API. Deploy models declaratively — the scheduler handles placement, sharding across nodes for large models, and failover. Supports NVIDIA, AMD, and CPU-only nodes. 72 API endpoints, 162 CLAWHub packages, 6 inference backends. Open source, MIT licensed.

### 60-Second Pitch
> The local inference stack has a management gap. Running one model on one GPU is solved (Ollama, llama.cpp). But orchestrating multiple GPU machines as a cluster — placement, routing, health, distributed inference for large models — still requires Kubernetes or custom scripts.
>
> TentaCLAW OS fills that gap. It's a purpose-built Linux distribution where each GPU machine runs an agent. Agents auto-discover the gateway via mDNS, register with hardware manifests (GPU vendor, VRAM, compute capability), and report health every 10 seconds. The gateway handles model placement, request routing (weighted round-robin by VRAM and tok/s), and failover.
>
> For models that exceed single-GPU VRAM, the scheduler splits across nodes using pipeline parallelism. The routing layer is transparent — clients hit one endpoint. Six inference backends are supported: Ollama, vLLM, llama.cpp, TensorRT-LLM, TGI, and ExLlamaV2.
>
> Additional capabilities: QLoRA fine-tuning, automated benchmarking (MMLU, HumanEval, custom), a package manager (162 packages for RAG, voice, code review), cost intelligence (TCO vs cloud comparison), and a Grafana-compatible monitoring stack.
>
> 59K lines. 72 API endpoints. 57 tests. MIT license.

### 2-Minute Pitch
> I'm going to skip the mascot and get to the architecture, because that's what matters here.
>
> TentaCLAW OS is a cluster operating system for multi-GPU AI inference. The architecture is inspired by HiveOS (GPU mining management) but redesigned for inference workloads.
>
> **Agent-gateway model.** Each GPU machine runs a lightweight agent (Node.js, ~2K lines). The agent auto-detects GPUs via nvidia-smi (NVIDIA), sysfs (AMD), and lscpu (CPU-only). On boot, it broadcasts on the LAN via mDNS (_tentaclaw._tcp) and UDP. When it finds the gateway, it registers with a hardware manifest: GPU vendor, VRAM, compute capability, driver version, available backends. After registration, it reports health every 10 seconds (push model, not poll).
>
> **Gateway.** Stateful coordinator. SQLite DB with 11 tables. 72 REST API endpoints. Manages node registry, model deployment, request routing, health tracking, alerting. Exposes an OpenAI-compatible /v1/chat/completions endpoint that routes to the optimal node based on model availability, VRAM headroom, and current throughput.
>
> **Distributed inference.** When a model exceeds any single node's VRAM, the gateway calculates a sharding plan. It uses pipeline parallelism — layers are split across nodes, intermediate activations flow over the network. Works across GPU vendors (NVIDIA node 1 + AMD node 2). Not as fast as NVLink tensor parallelism, but it works on commodity hardware over ethernet.
>
> **Declarative management.** Models are deployed via "flight sheets" — YAML manifests that declare the desired state (which models, how many replicas, placement constraints). The gateway reconciles actual vs desired state and takes action.
>
> **Fine-tuning.** Built-in QLoRA/LoRA/full fine-tuning via a unified CLI. Dataset validation, VRAM estimation, GPU assignment, and training are automated. Post-training benchmarking (MMLU, HumanEval, custom evals) runs automatically.
>
> **CLAWHub.** Package manager with 162 packages. Each package is a declarative manifest that deploys a complete pipeline (model + dependencies + API endpoints). Example: `@tentaclaw/rag-stack` installs ChromaDB, an embedding model, and a retrieval API.
>
> **Cost intelligence.** Tracks actual power consumption (GPU wattage from driver APIs), calculates real electricity cost, computes cost per million tokens, and compares against cloud provider pricing. Most homelab clusters show 99%+ savings versus API pricing.
>
> The codebase is 59K lines across gateway, agent, CLI, dashboard, and ISO builder. MIT license. Feedback on the architecture welcome — particularly around the sharding approach and the agent-gateway communication model.

---

## Enterprises

### Core Angle
On-prem AI inference platform with SSO, RBAC, audit logging, compliance, and $0 per-token fees. Deploy behind your firewall.

### 30-Second Pitch
> TentaCLAW OS is an on-premises AI inference platform. Deploy it on your existing GPU hardware. SSO/LDAP authentication, role-based access control, API key management with per-key rate limits and usage tracking, full audit logging, and data sovereignty — every byte stays on your network. No per-token fees. No data leaving your perimeter. OpenAI-compatible API means zero application changes.

### 60-Second Pitch
> Your AI spend is growing 10x year over year. Your security team is worried about data flowing to third-party APIs. Your GPU hardware is sitting underutilized. TentaCLAW OS solves all three problems.
>
> It's an on-premises inference platform that runs on GPU hardware you already own or can procure. The architecture is agent-gateway: each GPU machine runs a lightweight agent, a central gateway handles orchestration. Deploy models declaratively, route requests automatically, scale by adding hardware.
>
> Security and compliance are built in: LDAP/SAML SSO, RBAC with admin/operator/viewer roles, API key management with per-key scopes and rate limits, full audit logging of every admin action and inference request, encrypted transport (mTLS between agents), and no outbound data flow. Your prompts, your models, your fine-tuning data — never leaves your network.
>
> The OpenAI-compatible API means your developers change one URL and their existing LangChain, LlamaIndex, and custom applications work immediately. No rewrite.
>
> Cost: hardware amortization + electricity. Our customers see 95-99% savings versus API pricing at scale. The ROI calculator is built into the product.

### 2-Minute Pitch
> Let me frame the problem. Your organization is spending $50K-$500K per month on AI API calls. That number is growing. Your security team is flagging data sovereignty concerns — customer data, internal documents, proprietary code is flowing to third-party APIs with terms of service that may allow training on your data. Meanwhile, you have GPU hardware (or budget for it) that's underutilized.
>
> TentaCLAW OS is the bridge. It's an on-premises AI inference platform — not a model, not a framework, but the operating layer that turns your GPU hardware into a managed inference cluster.
>
> **Deployment:** Install on bare metal or VMs. Agent-gateway architecture. Each GPU node runs a lightweight agent. The gateway handles orchestration, routing, and the API layer. Add capacity by adding hardware — no re-architecture required.
>
> **Security:** LDAP/SAML SSO integration. RBAC with admin, operator, and viewer roles. API key management with per-key scopes, rate limits, IP allowlists, and expiration. Full audit trail — every admin action, every inference request, every model deployment. Encrypted agent-gateway communication via mTLS. Zero outbound data flow by default. Compliant with air-gapped deployment requirements.
>
> **Operations:** OpenAI-compatible API — your existing applications (LangChain, LlamaIndex, custom) change one URL. Grafana-compatible monitoring. Alerting via webhook, email, Slack, or PagerDuty. Declarative model management via flight sheets. Automated failover and request rerouting. Fine-tuning on internal data without it leaving your network.
>
> **Economics:** The platform is open source (MIT license, no enterprise paywall). Your cost is hardware + electricity + your team's time. Built-in cost intelligence tracks real TCO and compares against cloud pricing. At scale, we consistently see 95-99% cost reduction. An 8-GPU cluster running 24/7 typically pays for itself in 45-90 days versus equivalent API spend.
>
> **Ecosystem:** 162 CLAWHub packages for common pipelines — RAG, document Q&A, code review, voice assistants. One-command deployment. The marketplace is open — your team can publish internal packages for standardized pipelines across departments.
>
> We're working with organizations running 4 to 200 GPU nodes. The architecture scales horizontally. Gateway clustering provides HA for production workloads. Geo-distributed clusters are on the roadmap for multi-site deployments.
>
> Happy to run a proof-of-concept on your existing hardware. It takes about 30 minutes to go from bare metal to first inference.

---

## Investors

### Core Angle
The Kubernetes of AI inference. 162-package marketplace. 59K lines of code. Open source with enterprise upsell potential. Growing fast.

### 30-Second Pitch
> TentaCLAW OS is the operating layer for AI inference clusters. Think Kubernetes, but purpose-built for GPU workloads and simple enough that a homelab user can run it. Open source, MIT licensed, 59K lines, 162-package marketplace, 6 backend integrations. The market is every organization running local AI — from homelabs to enterprises. Per-token pricing creates a massive cost incentive to self-host. We're the tooling that makes self-hosting viable.

### 60-Second Pitch
> The AI inference market is splitting in two. Cloud APIs serve the convenience market. But cost-sensitive users — homelabs, startups, enterprises with data sovereignty needs — are moving to self-hosted inference. The problem is tooling. Kubernetes is overkill and complex. Everything else is scripts and glue.
>
> TentaCLAW OS is purpose-built for this gap. It's a cluster operating system for GPU inference. Auto-discovery, declarative model management, distributed inference across heterogeneous hardware, an OpenAI-compatible API, and a 162-package marketplace for production pipelines.
>
> The TAM is significant. Every NVIDIA GPU sold is a potential node. Every organization paying $10K+/month for AI APIs is a potential customer. The open-source play builds adoption in the homelab and developer community. The enterprise play (SSO, RBAC, audit logging, SLA management) is the monetization layer.
>
> 59K lines of code. Active development. The community is forming around "per-token pricing is a scam" — a positioning that resonates with both cost-conscious enterprises and the self-hosted community.

### 2-Minute Pitch
> Three trends are converging. First, AI model quality at small sizes is improving rapidly — 8B models now match GPT-3.5. Second, consumer GPU hardware is extraordinarily powerful and widely available. Third, enterprises are increasingly uncomfortable sending proprietary data to third-party APIs.
>
> The result: a massive and growing market for self-hosted AI inference. But the tooling doesn't exist. Kubernetes can orchestrate GPU workloads, but it's complex, designed for general-purpose containers, and requires significant DevOps expertise. The alternative is manual setup — SSH into each machine, install drivers, configure models, write scripts. Neither scales.
>
> TentaCLAW OS fills this gap. It's a purpose-built operating system for GPU inference clusters. The experience is radically simple: flash a USB, boot a machine, it auto-joins the cluster. Deploy models with one command. The system handles placement, sharding across nodes for large models, failover, routing, and monitoring.
>
> The architecture supports heterogeneous hardware — NVIDIA, AMD, and CPU nodes in the same cluster. This is critical because real-world GPU fleets are mixed. We support 6 inference backends, covering the full spectrum from easy (Ollama) to optimized (TensorRT-LLM, vLLM).
>
> The marketplace (CLAWHub) has 162 packages — pre-built production pipelines for RAG, voice, code review, document processing. This is our flywheel: more packages attract more users, more users attract more package contributors.
>
> **Business model:** Open source core (MIT). Enterprise features as a paid tier: SSO/LDAP, RBAC, audit logging, SLA management, multi-cluster federation, priority support. This is the proven open-source monetization playbook (GitLab, HashiCorp, Elastic).
>
> **Market sizing:** The global AI inference market is projected at $100B+ by 2028. Self-hosted inference is the fastest-growing segment. Every organization with GPU hardware and AI API spend is a customer. The homelab community (millions of users) is the organic growth engine.
>
> **Traction:** 59K lines of code. 72 API endpoints. 162 marketplace packages. 6 backend integrations. Active development with a public roadmap of 2000 phases. Community forming around "per-token pricing is a scam" — a rallying cry that's both technically correct and emotionally resonant.
>
> **Ask:** We're raising to accelerate three things: the ISO builder (bootable USB images), enterprise features (SSO, RBAC, compliance), and community growth. The playbook is: dominate the self-hosted inference management space before the big cloud providers build it themselves.
>
> We're not competing with OpenAI on models. We're the operating layer that makes it viable to run anyone's models on your own hardware. That's a platform play, not a model play.

---

## Quick Reference Card

| Audience | Lead With | Avoid |
|----------|----------|-------|
| r/homelab | Zero config, flash-and-boot, dashboard | Enterprise jargon, investor language |
| r/LocalLLaMA | Model sizes, tok/s, backends, distributed inference | "Easy for non-technical users" |
| r/selfhosted | Data sovereignty, no cloud, no subscription | Mascot-first messaging |
| Hacker News | Architecture, technical depth, honest trade-offs | Marketing language, hype |
| Enterprises | Security, compliance, ROI, API compatibility | Mascot, "scam" language, casual tone |
| Investors | TAM, business model, traction, competition | Too much technical detail |

---

## Universal Taglines (Use Anywhere)

- **Primary:** "Your GPUs. One brain. Zero limits."
- **Technical:** "AI inference cluster OS."
- **Emotional:** "Eight arms. One mind."
- **Provocative:** "Per-token pricing is a scam."
- **Action:** "Flash. Boot. Deploy."
- **ROI:** "$0.03 per million tokens. Not a typo."
