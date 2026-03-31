# Why I Built TentaCLAW: The $117.8B Inference Market Doesn't Need Another Per-Token API

The AI inference market hit $117.8 billion in 2026. Two-thirds of all AI compute
is now inference, not training. And most of that spending goes to cloud providers
charging per-token.

But here's what nobody talks about: **self-hosted inference breaks even in under
4 months**. At enterprise scale, it's 18x cheaper than Model-as-a-Service APIs.
Lenovo published a study showing 8x cost advantage per million tokens vs cloud IaaS.

So why is everyone still paying per-token?

**Because the tooling is terrible.**

## The Gap

Mining has HiveOS -- plug in a rig, it auto-discovers, and you manage 10,000 GPUs
from one dashboard. Kubernetes has... Kubernetes. But AI inference? If you want to
run models on your own hardware, you're SSHing into individual machines, managing
vLLM processes manually, and hoping nothing crashes at 3 AM.

I built TentaCLAW to fill this gap.

## What TentaCLAW Does

TentaCLAW is an open-source inference cluster OS. Think "HiveOS for AI inference":

1. **Install on any machine with a GPU** -- one command, 60 seconds
2. **Auto-discovers nodes** -- agents find the gateway via mDNS, join automatically
3. **Routes requests intelligently** -- KV cache affinity, load scoring, model-aware routing
4. **Self-heals** -- detects GPU failures, migrates models, restarts backends
5. **Proxmox-style dashboard** -- 12 tabs, real-time GPU metrics, drag-and-drop deployment
6. **OpenAI-compatible API** -- any app using the OpenAI SDK works as a drop-in replacement
7. **Secure by default** -- auth, TLS, rate limiting, signed releases, SLSA L3 provenance

## The Numbers

My cluster: 4 Proxmox nodes, 9 AMD GPUs, 104 GB VRAM, running 20 models.

What the research shows:
- SGLang is 29% faster than vLLM (16,200 vs 12,500 tok/s on H100)
- LMCache provides 3-15x throughput improvement and 7x TTFT reduction
- EAGLE-3 speculative decoding delivers 3-6.5x faster token generation
- Ollama hits 52M monthly downloads but maxes out at 1-2 concurrent users
- GPUStack (~5K stars) is the closest competitor but lacks the OS experience

## Why Now

Three things converged:

1. **EU AI Act enforcement starts August 2, 2026** -- on-prem inference = compliance-friendly
2. **The mining-to-AI transition** -- millions of GPUs sitting idle, miners desperate for software
3. **NVIDIA Dynamo 1.0** -- adopted by AWS/Azure/GCP, making distributed inference standard

## What's Next

- Kubernetes operator (Helm chart, DRA integration)
- NVIDIA Dynamo backend (disaggregated prefill/decode)
- LMCache integration (3-15x throughput)
- Enterprise features (SSO, compliance, SLAs)

## Try It

```bash
curl -fsSL https://tentaclaw.io/install | bash
```

864 tests. MIT license. Built in the open.

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Discord: https://discord.gg/tentaclaw

Per-token pricing is a scam. Run your own inference. -- CLAWtopus
