# Networking Guide

TentaCLAW OS uses automatic discovery to build clusters. This guide covers networking setup.

## Ports Used

| Port | Protocol | Component | Description |
|------|----------|-----------|-------------|
| **8080** | TCP | Gateway | REST API + Dashboard |
| **11434** | TCP | Ollama | Ollama inference API |
| **8082** | TCP | BitNet | BitNet inference API |
| **8000** | TCP | vLLM | vLLM inference API |
| **41337** | UDP | Agent | Auto-discovery broadcast |
| **41338** | UDP | Agent | Discovery response |

## Auto-Discovery

TentaCLAW uses multiple discovery methods (tried in order):

1. **UDP Broadcast** (port 41337) — Fastest, works on flat LANs
2. **mDNS/DNS-SD** — Resolves `_tentaclaw._tcp.local` service records
3. **Subnet Scan** — Scans local /24 for gateway on common ports
4. **Environment Variable** — `TENTACLAW_GATEWAY_URL=http://10.0.0.1:8080`
5. **Config File** — `/etc/tentaclaw/rig.conf` with `GATEWAY_URL=...`
6. **Localhost Fallback** — `http://127.0.0.1:8080`

## Firewall Rules

### Gateway Node
```bash
# Allow dashboard + API
sudo ufw allow 8080/tcp

# Allow auto-discovery broadcasts
sudo ufw allow 41337/udp
sudo ufw allow 41338/udp
```

### Agent Nodes
```bash
# Allow Ollama (if running inference)
sudo ufw allow 11434/tcp

# Allow discovery
sudo ufw allow 41337/udp
sudo ufw allow 41338/udp
```

## Multi-Subnet / VLAN

If your nodes are on different subnets, UDP broadcast won't reach across VLANs. Options:

1. **Set gateway URL explicitly** on each agent:
   ```bash
   export TENTACLAW_GATEWAY_URL=http://10.0.1.1:8080
   ```

2. **Use mDNS** — If your network supports mDNS relay (Avahi), discovery works across subnets

3. **Config file** — Set `GATEWAY_URL` in `/etc/tentaclaw/rig.conf`

## VPN / WireGuard

TentaCLAW works great over WireGuard:

```bash
# On each node, set gateway to the WireGuard IP
export TENTACLAW_GATEWAY_URL=http://10.66.66.1:8080
```

## Tailscale

```bash
# Use Tailscale hostname or IP
export TENTACLAW_GATEWAY_URL=http://gateway-node:8080
```

## Performance Tips

- **10GbE recommended** for large model transfers between nodes
- **1GbE is fine** for stats reporting and inference requests
- Keep gateway and inference nodes on the same subnet for lowest latency
- Use `clawtopus top` to monitor per-node latency

---

*CLAWtopus says: "I can reach across any network. Eight arms, remember?"*
