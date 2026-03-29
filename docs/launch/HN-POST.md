# Hacker News Launch Post

**Title:** Show HN: TentaCLAW OS – Open-source AI inference cluster OS (zero config, self-healing)

**URL:** https://github.com/TentaCLAW-OS/TentaCLAW

**Comment:**

TentaCLAW OS turns scattered GPUs into one unified AI inference cluster. Think of it as infrastructure management for local AI — but with zero config.

Key features:
- Auto-discovery: nodes find the gateway on the LAN automatically
- Smart load balancing with circuit breaker and auto-retry
- OpenAI-compatible API (function calling, JSON mode, streaming)
- Self-healing watchdog (5-level escalation: restart → GPU reset → reboot)
- Real-time dashboard + CLI with personality

Built with TypeScript (Hono + SQLite gateway, zero-dep agent).
Running on 4 bare-metal Proxmox nodes with 9 AMD GPUs.

What the local AI community has been asking for: multi-node Ollama with a dashboard.

