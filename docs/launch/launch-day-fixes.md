# Launch Day — Rapid Response Fixes

## Pre-Staged Fixes for Common Issues

### Fix 1: Install script fails on macOS (no gpg)
```bash
# macOS doesn't ship with gpg
# Workaround: skip signature verification on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Note: GPG verification skipped on macOS. Verify checksums manually."
fi
```

### Fix 2: Port 8080 already in use
```
Error: listen EADDRINUSE: address already in use :::8080
```
Quick fix: `TENTACLAW_PORT=9090 npm start`

### Fix 3: VRAM detection fails on AMD (ROCm not installed)
```
[agent] No GPUs detected
```
Quick fix: `sudo apt install rocm-smi-lib` or run with `--mock` flag to explore the dashboard without GPUs.

### Fix 4: Dashboard CORS error from LAN
```
Access to fetch at 'http://192.168.1.x:8080' blocked by CORS
```
Already fixed: CORS auto-detects LAN IPs. If still failing: `TENTACLAW_CORS_ORIGINS=http://192.168.1.x:8080`

### Fix 5: Node.js version too old
```
SyntaxError: Unexpected token '??='
```
Requires Node.js 22+. Quick fix: `nvm install 22 && nvm use 22`

## Monitoring During Launch

### Star tracking
```bash
# Check GitHub stars
curl -s https://api.github.com/repos/TentaCLAW-OS/TentaCLAW | jq '.stargazers_count'
```

### Download tracking
```bash
# Check release downloads
curl -s https://api.github.com/repos/TentaCLAW-OS/TentaCLAW/releases/latest | \
  jq '.assets[] | {name, download_count}'
```

## Response Templates

### "Is this production-ready?"
> TentaCLAW is v0.3 alpha. It's stable for homelab/dev use (864 tests, 82 security tests). For production, we recommend waiting for v1.0 which adds multi-gateway HA and formal stability testing. That said, I'm running it 24/7 on my own cluster.

### "How does this compare to GPUStack?"
> GPUStack (~5K stars) is excellent for multi-cluster GPU management. TentaCLAW goes further: it's a full OS experience with a dashboard, CLI (111 commands), installer, auto-discovery, and personality system (CLAWtopus). GPUStack focuses on the cluster manager; TentaCLAW is the cluster manager + dashboard + CLI + agent + security + monitoring.

### "Why not just use vLLM/SGLang directly?"
> You absolutely can for a single server. TentaCLAW adds value when you have 2+ machines: auto-discovery, intelligent routing, failover, unified dashboard, and the ability to mix backends (vLLM for batch, SGLang for chat, llama.cpp for CPU nodes).

### "Why TypeScript instead of Go/Rust?"
> Three reasons: (1) the Node.js ecosystem has the best AI SDK compatibility (OpenAI SDK, HuggingFace libraries), (2) TypeScript compiles fast and the gateway handles 10K+ req/s easily (Hono is 3x faster than Express), (3) contributor accessibility -- more developers know TypeScript than Go/Rust.
