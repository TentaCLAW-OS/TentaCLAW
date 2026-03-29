# Reddit Launch Posts

## r/LocalLLaMA Post

**Title:** I built an open-source OS that turns any pile of GPUs into one AI inference cluster — zero config

**Body:**

Hey r/LocalLLaMA,

I've been frustrated with managing multiple machines for local inference. SSH into each one, manage Ollama separately, no unified dashboard, no load balancing. So I built TentaCLAW OS.

**What it does:**
- Plug in any machine → it auto-discovers the gateway and starts serving
- Dashboard shows all nodes, GPUs, VRAM, temps, models in real-time
- OpenAI-compatible API across your entire cluster
- Smart routing: requests go to the best available node
- Self-healing: if a GPU crashes at 3am, it fixes itself
- Works with NVIDIA + AMD (via sysfs, no ROCm needed)

**Install:**
```
curl -fsSL tentaclaw.io/install | bash
```

Currently running on my 4-node Proxmox cluster (9 AMD GPUs, 20 models).

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

Would love feedback from this community. What features would make this useful for your setup?

---

## r/selfhosted Post

**Title:** TentaCLAW OS — manage your AI inference cluster like you manage your homelab

...similar format...

