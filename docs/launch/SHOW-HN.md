# Show HN Post

**Title:** Show HN: TentaCLAW OS -- Open-source AI inference cluster OS (like HiveOS for GPUs)

**URL:** https://github.com/TentaCLAW-OS/TentaCLAW

---

**Comment to post immediately after submission:**

Hi HN. I built TentaCLAW OS because managing local AI inference across multiple machines was driving me insane. SSH into each box, run Ollama separately, no unified view of what's loaded where, no load balancing, no alerting when a GPU overheats at 3am. I wanted something like HiveOS (the crypto mining OS) but for AI inference -- plug in a machine, it joins the cluster, done.

TentaCLAW is a gateway + agent architecture. The gateway (TypeScript, Hono, SQLite) coordinates the cluster and serves a web dashboard and 280+ REST endpoints. Agents run on each node, push GPU/system stats every 10s, and receive commands in the response -- no persistent connections, no WebSocket complexity, just HTTP POST with command piggyback. The dashboard uses SSE for real-time updates (not WebSocket -- simpler, works through proxies, auto-reconnects). The CLI (`clawtopus`) has 86 commands and zero runtime dependencies -- it's a single TypeScript build with no node_modules at runtime. Auto-discovery uses UDP broadcast on port 41337 with mDNS fallback, so nodes find the gateway without configuration.

It supports 6 inference backends (Ollama, vLLM, SGLang, llama.cpp, BitNet, MLX), mixes NVIDIA and AMD GPUs in the same cluster, and includes BitNet support for CPU-only nodes running 1-bit models. The gateway exposes an OpenAI-compatible API, so any client or framework (LangChain, CrewAI, etc.) can point at your cluster and it just works. There's also a package marketplace (CLAWHub, 185 packages) for flight sheets, agents, integrations, and themes.

864 tests passing, 68K lines, MIT licensed. Running it on my own 4-node cluster. Would appreciate any feedback on the architecture or feature gaps.

---

## HN Checklist

- [ ] Post between 8-10am ET on a weekday (Tuesday-Thursday best)
- [ ] Title under 80 chars
- [ ] URL points to GitHub repo (not website)
- [ ] First comment ready to paste immediately
- [ ] Be online for 2+ hours to answer questions
- [ ] Don't ask for upvotes anywhere

## Likely HN Questions (Prepare Answers)

**"Why not just use Kubernetes + vLLM?"**
> K8s is great if you already have it. TentaCLAW is for people who want cluster management without the K8s overhead. One curl command to install, no YAML manifests, no etcd, no control plane. That said, we do ship a Helm chart if you want to run it on K8s.

**"How does this compare to GPUStack?"**
> GPUStack is solid for multi-node GPU management. TentaCLAW adds auto-discovery (zero config), a bootable ISO, 6 backends vs 2, a full CLI, self-healing watchdog, and a package marketplace. Different scope -- GPUStack is a manager, TentaCLAW is closer to a full OS layer.

**"Why TypeScript instead of Go/Rust?"**
> Practical choice. The dashboard is React, the gateway is a web server, the CLI does HTTP calls -- TypeScript fits naturally across all components. Hono on Bun/Node is fast enough for a coordination layer that doesn't do inference itself. The hot path is the inference backend (Ollama, vLLM), not the gateway.

**"What about security?"**
> API key auth with scoped permissions and rate limiting. SSH hardening in the ISO. The agent-to-gateway communication is HTTP with shared secrets. For production over the internet, put it behind a reverse proxy with TLS. Docs cover this.

**"SQLite? Will that scale?"**
> For a coordination database tracking node stats, model assignments, and alerts -- absolutely. SQLite handles millions of rows. The gateway doesn't store inference data, just cluster state. If you're running 200+ nodes, Postgres support is on the roadmap but honestly SQLite will probably still be fine.

**"Is this vaporware / just docs?"**
> 864 tests passing, 68K lines of code, 57 source modules, running on real hardware. Mock mode lets you try the full stack without any GPUs. `docker compose up` and you have a working cluster in 30 seconds.
