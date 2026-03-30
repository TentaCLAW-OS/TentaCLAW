# r/LocalLLaMA Post

**Title:** I built an open-source GPU cluster OS for self-hosted inference -- dashboard, auto-discovery, 6 backends

**Flair:** `Tools / Projects`

---

Hey r/LocalLLaMA,

I've been running local inference for a while and hit the same wall many of you probably have: I've got multiple machines with GPUs, and managing them individually is painful. SSH into each box, run Ollama separately, no idea which node has capacity, no unified view of what's running where. If a GPU overheats at 3am, nobody knows until the next morning.

So I built **TentaCLAW OS** -- an open-source AI inference cluster operating system. Think HiveOS (the crypto mining dashboard) but for AI inference instead of mining.

**GitHub:** https://github.com/TentaCLAW-OS/TentaCLAW

---

## What it does

You run the gateway on one machine. You run agents on your GPU nodes. The agents auto-discover the gateway on your LAN (UDP broadcast + mDNS -- zero configuration). Now you have a cluster.

From there:

- **One dashboard** shows every node, every GPU, VRAM usage, temperatures, loaded models, tokens/sec -- all in real-time (SSE streaming)
- **One API endpoint** (`POST /v1/chat/completions`) routes requests to the best available node. It's OpenAI-compatible, so LangChain, CrewAI, Open WebUI, anything that talks to OpenAI just works
- **One CLI** (`clawtopus`) with 86 commands: `deploy`, `status`, `top`, `chat`, `drain`, `doctor`, and more
- **Self-healing watchdog** -- if a service crashes, it restarts. If a GPU hangs, it resets. If a node goes offline, requests re-route automatically

---

## Here's what it looks like

Dashboard overview:
![Dashboard Summary](https://github.com/TentaCLAW-OS/TentaCLAW/raw/master/assets/screenshots/dashboard-summary.png)

Metrics view:
![Dashboard Metrics](https://github.com/TentaCLAW-OS/TentaCLAW/raw/master/assets/screenshots/dashboard-metrics.png)

AI Chat (talk to any model from the dashboard):
![Dashboard Chat](https://github.com/TentaCLAW-OS/TentaCLAW/raw/master/assets/screenshots/dashboard-chat.png)

---

## Key features for this community

- **6 inference backends:** Ollama, vLLM, SGLang, llama.cpp, BitNet, MLX. Pick the best backend per workload. Mix and match across nodes
- **Mix NVIDIA + AMD + CPU** in the same cluster. Each node runs whatever backend fits its hardware
- **BitNet CPU inference:** Got a box without a GPU? Run 1-bit quantized models on pure CPU at 2-6x the speed of FP16. TentaCLAW treats it as just another node
- **Flight sheets:** Declarative model deployment. Define which models go on which nodes in a YAML file. Apply with one click
- **Smart routing:** Requests go to the node with the most free VRAM, lowest queue depth, and best recent latency
- **OpenAI-compatible API:** `POST /v1/chat/completions`, streaming, function calling, JSON mode -- all pass through

---

## Install

```
curl -fsSL https://tentaclaw.io/install | bash
```

Or Docker:
```
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git && cd TentaCLAW
docker compose up
# Dashboard at http://localhost:8080/dashboard
```

Or dev mode (no GPUs needed, mock agents simulate hardware):
```
cd gateway && npm install && npm run dev
cd agent && npx tsx src/index.ts --mock
```

---

## Frequently asked questions

**"How is this different from just running Ollama on each machine?"**

Ollama is the inference engine. TentaCLAW is the cluster layer on top. You still run Ollama (or vLLM, or llama.cpp) on each node -- TentaCLAW adds auto-discovery, a unified API, load balancing, a dashboard, health monitoring, alerting, and self-healing across all of them.

**"Does this replace Ollama?"**

No. TentaCLAW uses Ollama (and other backends) under the hood. It orchestrates them.

**"What about vLLM? SGLang?"**

Supported as backends. If you want PagedAttention and continuous batching on your production nodes, run vLLM on those nodes. TentaCLAW routes requests to them the same way.

**"How does it compare to GPUStack?"**

Similar goal, different scope. TentaCLAW adds auto-discovery, a bootable ISO, 6 backends (vs 2), an 86-command CLI, a self-healing watchdog, a package marketplace with 185 packages, and Prometheus/Grafana integration out of the box.

**"Can I use this with Open WebUI?"**

Yes. Point Open WebUI at your TentaCLAW gateway (`http://gateway:8080/v1`) as an OpenAI-compatible endpoint. It just works.

**"Is this actually usable or is it a README-only project?"**

810 tests passing, 68K lines of code, 57 source modules. Running on my own hardware. You can spin up a full cluster with mock agents in 30 seconds using Docker.

---

## What's next

- ARM support (RPi nodes for edge inference)
- High-availability gateway (clustered gateways)
- Model splitting across nodes (tensor parallelism)
- Web-based terminal (SSH into nodes from the dashboard)

---

MIT licensed. Would love feedback from this community -- you're the target audience. What would make this useful for your setup? What's missing?

Star it if you think it's interesting: https://github.com/TentaCLAW-OS/TentaCLAW

Discord: https://discord.gg/tentaclaw
