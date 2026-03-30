# TentaCLAW OS Troubleshooting Guide

> **Something broken? CLAWtopus has eight arms for fixing things.**

This guide covers the most common problems, how to diagnose them, and how to fix them. Search for your symptom or error message.

---

## Table of Contents

- [Node Not Appearing in Dashboard](#node-not-appearing-in-dashboard)
- [GPU Not Detected](#gpu-not-detected)
- [Ollama Not Starting](#ollama-not-starting)
- [Model Deployment Stuck](#model-deployment-stuck)
- [Dashboard Not Loading](#dashboard-not-loading)
- [Agent Can't Find Gateway](#agent-cant-find-gateway)
- [High GPU Temperatures](#high-gpu-temperatures)
- [Out of VRAM Errors](#out-of-vram-errors)
- [BitNet Not Working](#bitnet-not-working)
- [WebSocket / SSE Disconnections](#websocket--sse-disconnections)
- [API Returning 401/403](#api-returning-401403)
- [General Diagnostic Tools](#general-diagnostic-tools)

---

## Node Not Appearing in Dashboard

### Symptoms

- You booted a node (or started a mock agent) but it does not show up in the dashboard
- `clawtopus nodes` returns an empty list or is missing the new node
- No registration events in the gateway logs

### Diagnosis

```bash
# 1. Check if the agent is running on the node
systemctl status tentaclaw-agent

# 2. Check agent logs for errors
journalctl -u tentaclaw-agent --since "5 minutes ago"

# 3. Verify the agent can reach the gateway
curl -s http://<gateway-ip>:8080/health

# 4. Check the gateway logs for incoming registration attempts
# On the gateway host:
curl http://localhost:8080/api/v1/events
```

### Solution

**Agent not running:**
```bash
systemctl start tentaclaw-agent
systemctl enable tentaclaw-agent
```

**Agent can't reach the gateway:**
```bash
# Set the gateway URL explicitly
export TENTACLAW_GATEWAY_URL=http://<gateway-ip>:8080

# Or persist it
echo "GATEWAY_URL=http://<gateway-ip>:8080" > /etc/tentaclaw/rig.conf
systemctl restart tentaclaw-agent
```

**Firewall blocking registration:**
```bash
# On the gateway
sudo ufw allow 8080/tcp
sudo ufw allow 41337/udp
sudo ufw allow 41338/udp

# On the agent node
sudo ufw allow 41337/udp
sudo ufw allow 41338/udp
```

**Node stuck in "offline" status:**

If the node registered but shows as offline, it stopped pushing stats. Restart the agent:
```bash
systemctl restart tentaclaw-agent
```

---

## GPU Not Detected

### Symptoms

- Dashboard shows a node with `gpu_count: 0`
- `clawtopus node <id>` shows no GPUs
- Agent logs say "No GPUs detected" or "GPU detection failed"
- `nvidia-smi` or `rocm-smi` not found or returning errors

### Diagnosis

```bash
# 1. Check if the OS sees the GPU at all
lspci | grep -iE "vga|3d|display"

# 2. NVIDIA: Check driver and nvidia-smi
nvidia-smi

# 3. AMD: Check driver and ROCm
rocm-smi
# Or check sysfs
ls /sys/class/drm/card*/device/vendor

# 4. Check agent's GPU detection log
journalctl -u tentaclaw-agent | grep -i gpu
```

### Solution

**NVIDIA GPU not detected:**

```bash
# Install or reinstall NVIDIA drivers
sudo apt install nvidia-driver-550
sudo reboot

# Verify
nvidia-smi
```

If `nvidia-smi` works but the agent doesn't see the GPU, check that the agent user has permission to access `/dev/nvidia*`:
```bash
ls -la /dev/nvidia*
sudo usermod -aG video tentaclaw
```

**AMD GPU not detected:**

```bash
# Check if amdgpu driver is loaded
lsmod | grep amdgpu

# Install ROCm for RDNA2+
sudo amdgpu-install --usecase=rocm

# For older GPUs, Ollama uses Vulkan — no ROCm needed
# Just ensure the amdgpu driver is loaded
```

**GPU visible to OS but not to agent:**

Check the agent's GPU detection script:
```bash
# Run the detection script manually
/opt/tentaclaw/scripts/01-gpu-detect.sh

# Check if Ollama sees the GPU
ollama list
curl http://localhost:11434/api/tags
```

**PCIe slot issue:**

If `lspci` doesn't show the GPU at all:
- Reseat the GPU in its PCIe slot
- Check the power cables (8-pin/12-pin)
- Try a different PCIe slot
- Update BIOS/UEFI

---

## Ollama Not Starting

### Symptoms

- Agent reports `backend: null` or no backend
- `curl http://localhost:11434/api/tags` times out or connection refused
- Model deployment fails with "no backend available"
- Agent logs show "Ollama health check failed"

### Diagnosis

```bash
# 1. Check if Ollama is installed
which ollama
ollama --version

# 2. Check if the Ollama service is running
systemctl status ollama

# 3. Check Ollama logs
journalctl -u ollama --since "10 minutes ago"

# 4. Try starting Ollama manually
ollama serve
```

### Solution

**Ollama not installed:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**Ollama service crashed:**
```bash
systemctl restart ollama
# Wait a few seconds, then verify
curl http://localhost:11434/api/tags
```

**Port conflict (another service on 11434):**
```bash
# Check what's using the port
ss -tlnp | grep 11434

# If another process, kill it or change Ollama's port
OLLAMA_HOST=0.0.0.0:11435 ollama serve
```

**CUDA/ROCm errors in Ollama logs:**

This usually means a driver mismatch. Reinstall the GPU driver:
```bash
# NVIDIA
sudo apt install --reinstall nvidia-driver-550

# AMD
sudo amdgpu-install --usecase=rocm --accept-eula
```

**Ollama starts but models won't load (OOM):**

The GPU doesn't have enough VRAM for the model. Try a smaller model:
```bash
ollama pull llama3.1:8b-q4_0    # 4-bit quantized, uses less VRAM
```

---

## Model Deployment Stuck

### Symptoms

- `clawtopus deploy <model>` hangs or shows "pending" indefinitely
- Dashboard shows a deploy command in "queued" state
- Model never appears in `clawtopus models`

### Diagnosis

```bash
# 1. Check the command queue for the target node
curl http://localhost:8080/api/v1/nodes/<nodeId>

# 2. Check model pull progress
curl http://localhost:8080/api/v1/nodes/<nodeId>/pulls

# 3. Check agent logs on the target node
journalctl -u tentaclaw-agent | grep -i "model\|deploy\|install\|pull"

# 4. Check Ollama pull status directly on the node
curl http://localhost:11434/api/pull -d '{"model":"llama3.1:8b","stream":false}'
```

### Solution

**Agent not picking up commands:**

Commands are delivered via the stats push/pull cycle. If the agent isn't pushing stats, it won't receive commands:
```bash
systemctl restart tentaclaw-agent
```

**Model download stalled:**

Ollama downloads can stall on slow or unreliable connections:
```bash
# On the target node, cancel and retry
ollama rm <model>
ollama pull <model>

# Or set a longer timeout
export OLLAMA_KEEP_ALIVE=60m
```

**Disk full:**
```bash
# Check disk space
df -h

# Ollama stores models in ~/.ollama/models (or /usr/share/ollama/.ollama/models for systemd)
du -sh ~/.ollama/models/

# Remove unused models
ollama rm <old-model>
```

**No node with enough VRAM:**

The gateway picks the node with the most available VRAM. If no node has enough:
```bash
# Check cluster capacity
clawtopus capacity

# Check which node was targeted
curl http://localhost:8080/api/v1/models/check-fit?model=<model>
```

Deploy to a specific node if auto-selection isn't working:
```bash
clawtopus deploy <model> <nodeId>
```

---

## Dashboard Not Loading

### Symptoms

- Browser shows blank page, 404, or connection refused at `http://localhost:8080/dashboard/`
- Dashboard loads but shows "No nodes" when agents are running
- Dashboard freezes or stops updating

### Diagnosis

```bash
# 1. Is the gateway process running?
curl http://localhost:8080/health

# 2. Check gateway logs
cd gateway && npm run dev 2>&1 | tail -50

# 3. Check browser console (F12 → Console tab) for JavaScript errors

# 4. Check the SSE connection
curl -N http://localhost:8080/api/v1/events
```

### Solution

**Gateway not running:**
```bash
cd gateway && npm run dev
```

**Wrong URL:**

The dashboard is at `/dashboard/` (with trailing slash). Not `/dashboard` or `/`.

**Gateway running but no data:**

The dashboard depends on agents pushing stats. Verify agents are running and connected:
```bash
clawtopus status
clawtopus nodes
```

**Browser cache issue:**

Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (macOS).

**CORS errors in browser console:**

If you're accessing the dashboard from a different hostname than `localhost`, you may see CORS errors. The gateway allows CORS by default, but check that the URL matches what you expect.

**SSE stream disconnected (dashboard stops updating):**

The dashboard uses Server-Sent Events. If the connection drops (network hiccup, gateway restart), refresh the page. The dashboard should auto-reconnect, but a hard refresh guarantees it.

---

## Agent Can't Find Gateway

### Symptoms

- Agent logs show "Gateway discovery failed" or "No gateway found"
- Agent keeps retrying connection to localhost
- "ECONNREFUSED" errors in agent output

### Diagnosis

```bash
# 1. Check what the agent thinks the gateway URL is
journalctl -u tentaclaw-agent | grep -i gateway

# 2. Test network connectivity to the gateway
ping <gateway-ip>
curl http://<gateway-ip>:8080/health

# 3. Check if auto-discovery is working
# On the agent node, listen for UDP broadcasts:
# (requires netcat)
nc -lu 41337
```

### Solution

**Set the gateway URL explicitly** (most reliable):
```bash
export TENTACLAW_GATEWAY_URL=http://<gateway-ip>:8080
systemctl restart tentaclaw-agent
```

Or persist in the config file:
```bash
echo "GATEWAY_URL=http://<gateway-ip>:8080" > /etc/tentaclaw/rig.conf
systemctl restart tentaclaw-agent
```

**Auto-discovery not working across subnets:**

UDP broadcast only works on the same Layer 2 network. If your gateway and agents are on different subnets/VLANs, broadcast won't cross the boundary. Use one of:

1. **Explicit URL** (above)
2. **mDNS** — if your network supports Avahi/Bonjour relay
3. **VPN** — put all nodes on a WireGuard or Tailscale mesh

```bash
# WireGuard example
export TENTACLAW_GATEWAY_URL=http://10.66.66.1:8080

# Tailscale example
export TENTACLAW_GATEWAY_URL=http://gateway-hostname:8080
```

**DNS resolution failure:**

If using a hostname instead of IP:
```bash
# Test DNS resolution
nslookup gateway-hostname

# Fall back to IP
export TENTACLAW_GATEWAY_URL=http://192.168.1.100:8080
```

---

## High GPU Temperatures

### Symptoms

- Dashboard shows GPU temps above 85C
- Alerts firing for `gpu_temperature_high`
- Fans running at 100%
- Thermal throttling (reduced clock speeds)

### Diagnosis

```bash
# 1. Check current GPU temps
nvidia-smi   # NVIDIA
rocm-smi     # AMD

# 2. Check temperature history
clawtopus node <nodeId>

# 3. Check alerts
clawtopus alerts

# 4. Check fan speed
nvidia-smi --query-gpu=fan.speed --format=csv
```

### Solution

**Immediate — reduce thermal load:**
```bash
# Put the node in maintenance mode (stops new inference requests)
clawtopus drain <nodeId>

# Apply a conservative overclock profile
clawtopus command <nodeId> overclock --profile stock
```

**Physical fixes:**

1. **Check airflow** — ensure the case/rack has adequate ventilation
2. **Clean dust** — compressed air on GPU heatsink fins and fans
3. **Thermal paste** — if the GPU is old (3+ years), reapply thermal paste
4. **Fan curve** — adjust in BIOS or with `nvidia-settings`
5. **Ambient temperature** — server room too hot? Check HVAC

**Software power limit:**

Reducing GPU power limit lowers temps with minimal performance impact:
```bash
# NVIDIA: set power limit to 250W (from default 350W)
sudo nvidia-smi -pl 250

# This typically drops temps 10-15C with only 5-10% performance loss
```

**Inference-optimized overclock:**

TentaCLAW's inference profile underclocks the GPU core but maximizes memory bandwidth:
```bash
clawtopus command <nodeId> overclock --profile inference
```

This prioritizes throughput-per-watt over raw speed.

---

## Out of VRAM Errors

### Symptoms

- Model deployment fails with "CUDA out of memory" or "insufficient VRAM"
- Ollama crashes when loading a model
- Agent reports VRAM usage at 100%
- `clawtopus models` shows a model but inference returns errors

### Diagnosis

```bash
# 1. Check VRAM usage
nvidia-smi
clawtopus gpu-map

# 2. Check what models are loaded (they consume VRAM even when idle)
clawtopus models

# 3. Check the model's VRAM requirement
clawtopus search <model>
curl "http://localhost:8080/api/v1/models/check-fit?model=<model>"

# 4. Check cluster-wide capacity
clawtopus capacity
```

### Solution

**Unload unused models:**

Ollama keeps models loaded in VRAM. Unload models you're not using:
```bash
# Remove a model from a specific node
clawtopus command <nodeId> remove_model --model <model>
```

**Use a smaller quantization:**

Lower quantization = less VRAM, slightly lower quality:

| Model | Q8 | Q6_K | Q4_K_M | Q4_0 |
|-------|-----|------|--------|------|
| 7B | ~8 GB | ~6 GB | ~5 GB | ~4 GB |
| 13B | ~14 GB | ~11 GB | ~8 GB | ~7 GB |
| 70B | ~75 GB | ~55 GB | ~40 GB | ~35 GB |

```bash
clawtopus deploy llama3.1:8b-q4_K_M
```

**Deploy to a different node:**
```bash
# Check which node has the most free VRAM
clawtopus nodes

# Deploy to a specific node
clawtopus deploy <model> <nodeId>
```

**Consider BitNet for simple tasks:**

If you have CPU-only nodes available, offload lightweight tasks to BitNet:
```bash
clawtopus deploy bitnet-b1.58-2B
```

This frees GPU VRAM for larger models.

**Multiple GPU nodes:**

If you have machines with multiple GPUs, Ollama can split large models across them. Check that `CUDA_VISIBLE_DEVICES` isn't restricting access:
```bash
echo $CUDA_VISIBLE_DEVICES
# Should be unset (all GPUs visible) or a comma-separated list
```

---

## BitNet Not Working

### Symptoms

- CPU-only node shows no backend
- `clawtopus deploy bitnet-b1.58-2B` fails
- Agent logs say "BitNet binary not found"
- BitNet starts but inference returns errors

### Diagnosis

```bash
# 1. Check if the BitNet binary exists
ls -la /opt/bitnet/build/bin/run_inference
ls -la /usr/local/bin/bitnet-server
ls -la /opt/tentaclaw/bitnet/run_inference

# 2. Check agent backend detection
journalctl -u tentaclaw-agent | grep -i bitnet

# 3. Try running BitNet manually
/opt/bitnet/build/bin/run_inference --help

# 4. Check if port 8082 is in use
ss -tlnp | grep 8082
```

### Solution

**BitNet not installed:**

```bash
git clone https://github.com/Microsoft/BitNet.git /opt/bitnet
cd /opt/bitnet
pip install -r requirements.txt
python setup_env.py --hf-repo 1bitLLM/bitnet_b1_58-3B -q i2_s
```

**Build failed:**

BitNet requires a C++ compiler and CMake:
```bash
sudo apt install build-essential cmake python3-pip
cd /opt/bitnet
python setup_env.py --hf-repo 1bitLLM/bitnet_b1_58-3B -q i2_s
```

**Agent not detecting BitNet:**

The agent looks for the binary in these paths (in order):
1. `/opt/bitnet/build/bin/run_inference`
2. `/usr/local/bin/bitnet-server`
3. `/opt/tentaclaw/bitnet/run_inference`

Symlink to one of those paths:
```bash
sudo ln -s /path/to/your/bitnet/binary /usr/local/bin/bitnet-server
systemctl restart tentaclaw-agent
```

**BitNet starts but inference fails:**

Check CPU architecture support. BitNet uses AVX2/AVX-512 instructions:
```bash
# Check CPU flags
grep -o 'avx2\|avx512' /proc/cpuinfo | head -1
```

Very old CPUs (pre-Haswell, pre-2013) may not support AVX2.

---

## WebSocket / SSE Disconnections

### Symptoms

- Dashboard stops updating after a few minutes
- `clawtopus top` freezes or disconnects
- Browser console shows "EventSource connection lost" errors
- Intermittent "Connection reset" errors

### Diagnosis

```bash
# 1. Test SSE connection stability
curl -N http://localhost:8080/api/v1/events

# 2. Check for proxy timeouts (if using reverse proxy)
# nginx default proxy_read_timeout is 60s — too short for SSE

# 3. Check gateway memory usage (memory leak = eventual crash)
curl http://localhost:8080/api/v1/version

# 4. Check active SSE clients
curl http://localhost:8080/metrics | grep sse_clients
```

### Solution

**Reverse proxy timeout:**

If you're behind nginx, Caddy, or another reverse proxy, increase the read timeout for SSE endpoints:

```nginx
# nginx — add to your server block
location /api/v1/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;  # 24 hours
    chunked_transfer_encoding off;
}

location /api/v1/game/stream {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    chunked_transfer_encoding off;
}
```

**Cloudflare / CDN buffering:**

CDNs buffer responses by default, which kills SSE streams. Disable buffering or bypass the CDN for SSE endpoints.

**Gateway restart:**

If the gateway process restarted (crash, deploy, etc.), all SSE connections drop. Refresh the dashboard. The gateway has no persistent SSE state.

**Network instability:**

If you're running over WireGuard/Tailscale and seeing frequent disconnects, check the VPN tunnel:
```bash
wg show     # WireGuard
tailscale status  # Tailscale
```

---

## API Returning 401/403

### Symptoms

- API calls return `401 Unauthorized` or `403 Forbidden`
- `clawtopus status` shows "Authentication failed"
- Dashboard shows "Unauthorized" errors
- Agent fails to register with "401" in logs

### Diagnosis

```bash
# 1. Check if auth is enabled on the gateway
# Try the health endpoint (always public)
curl http://localhost:8080/health

# 2. Try with the API key
curl -H "Authorization: Bearer your-key" http://localhost:8080/api/v1/nodes

# 3. Check if the key is set on the gateway
# Look at gateway startup logs for "API key authentication enabled"

# 4. Check agent's auth config
journalctl -u tentaclaw-agent | grep -i "auth\|401\|403"
```

### Solution

**You set `TENTACLAW_API_KEY` but forgot to pass it:**

```bash
# CLI
export TENTACLAW_API_KEY=your-key
clawtopus status

# Or per-request
curl -H "Authorization: Bearer your-key" http://localhost:8080/api/v1/nodes
```

**Agent can't authenticate:**

Set the API key on the agent so it can register and push stats:
```bash
# On the agent node
export TENTACLAW_API_KEY=your-key
systemctl restart tentaclaw-agent
```

**Key expired or revoked:**

If using scoped API keys, check if the key is still valid:
```bash
clawtopus apikeys
```

Create a new key if needed:
```bash
clawtopus apikey create --name "new-key" --permissions read,write
```

**Default admin password:**

If you're using user auth and forgot the password, the default is `admin`/`admin`. If you changed it and forgot, you'll need to reset the database or create a new admin via the SQLite DB directly:
```bash
# Last resort — connect to the gateway DB
sqlite3 gateway/data/tentaclaw.db "SELECT * FROM users;"
```

**403 on specific endpoints:**

A 403 means your key doesn't have the required permission level. Check the key's permissions:
- `read` — GET endpoints only
- `write` — GET + POST/PUT/DELETE
- `admin` — everything including key management

---

## General Diagnostic Tools

### Built-in Diagnostics

```bash
# Run cluster-wide diagnostics
clawtopus doctor

# Auto-fix detected issues
clawtopus fix

# Health score with issues and recommendations
clawtopus health

# Per-node health score
curl http://localhost:8080/api/v1/nodes/<nodeId>/health-score

# Active alerts
clawtopus alerts

# Watchdog events (auto-restarts, crashes)
clawtopus watchdog
```

### Gateway Diagnostics

```bash
# Full API diagnostics
curl http://localhost:8080/api/v1/doctor

# Prometheus metrics
curl http://localhost:8080/metrics

# Gateway version and uptime
curl http://localhost:8080/api/v1/version
```

### Agent Diagnostics

```bash
# Agent status on the node
systemctl status tentaclaw-agent
journalctl -u tentaclaw-agent -f

# GPU check
nvidia-smi          # NVIDIA
rocm-smi            # AMD
lspci | grep -i vga # Any vendor

# Network check
curl http://<gateway-ip>:8080/health
```

### Collecting a Support Bundle

If you need to file an issue, collect this info:

```bash
# 1. Gateway version
curl http://localhost:8080/api/v1/version

# 2. Cluster status
clawtopus status
clawtopus nodes
clawtopus health

# 3. Recent alerts and events
clawtopus alerts
clawtopus events --hours 1

# 4. Gateway logs (last 100 lines)
# Whatever method your deployment uses

# 5. Agent logs from affected node
journalctl -u tentaclaw-agent --since "1 hour ago" --no-pager

# 6. GPU info
nvidia-smi -q     # NVIDIA
rocm-smi --showallinfo   # AMD
```

Paste this into your GitHub issue at https://github.com/TentaCLAW-OS/TentaCLAW/issues.

---

## Still Stuck?

- **GitHub Issues**: https://github.com/TentaCLAW-OS/TentaCLAW/issues
- **Discord**: The Tank -- https://discord.gg/tentaclaw
- **`clawtopus doctor`** -- let the octopus diagnose it

---

*CLAWtopus says: "Eight arms for fixing. Zero arms for panicking. We've got this."*
