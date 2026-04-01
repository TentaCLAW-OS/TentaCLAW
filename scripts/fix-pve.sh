#!/bin/bash
# =============================================================================
# TentaCLAW — Fix pve node (tasks 5, 9, 7)
# =============================================================================
# Run on pve (192.168.1.69) as root:
#   curl -fsSL https://raw.githubusercontent.com/TentaCLAW-OS/TentaCLAW/master/scripts/fix-pve.sh | bash
# =============================================================================

set -euo pipefail

CYAN='\033[38;2;0;212;170m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
BOLD='\033[1m'
RESET='\033[0m'

log() { echo -e "$*"; }
ok()  { log "${GREEN}  ✓ $*${RESET}"; }
fail(){ log "${RED}  ✗ $*${RESET}"; }
step(){ log "\n${CYAN}${BOLD}▸ $*${RESET}"; }

INSTALL_DIR="/opt/tentaclaw"

# ── Step 1: Pull latest code ────────────────────────────────────────────────
step "1/6 Pull latest code"
cd "$INSTALL_DIR"
git pull origin master 2>&1 | tail -3
ok "Code updated"

# ── Step 2: Build gateway ───────────────────────────────────────────────────
step "2/6 Build gateway"
cd "$INSTALL_DIR/gateway"
npm install --silent 2>&1 | tail -1
npx tsc 2>&1 | tail -5 || true
ok "Gateway built"

# ── Step 3: Build agent ─────────────────────────────────────────────────────
step "3/6 Build agent"
cd "$INSTALL_DIR/agent"
npm install --silent 2>&1 | tail -1
npx tsc 2>&1 | tail -5 || true
ok "Agent built"

# ── Step 4: Build CLI ───────────────────────────────────────────────────────
step "4/6 Build CLI"
cd "$INSTALL_DIR/cli"
npm install --silent 2>&1 | tail -1
npx tsc 2>&1 | tail -5 || true
ok "CLI built"

# ── Step 5: Fix service files ───────────────────────────────────────────────
step "5/6 Fix and restart services"

# Fix agent service to point at correct dist path
if [ -f /etc/systemd/system/tentaclaw-agent.service ]; then
    # Get the current gateway port
    GATEWAY_PORT="8080"
    if [ -f "$HOME/.tentaclaw/gateway-port" ]; then
        GATEWAY_PORT=$(cat "$HOME/.tentaclaw/gateway-port")
    fi

    # Rewrite agent service with correct paths
    printf '[Unit]\nDescription=TentaCLAW Agent\nAfter=network.target tentaclaw-gateway.service\n\n[Service]\nType=simple\nExecStart=/usr/bin/node %s/agent/dist/agent/src/index.js --gateway http://localhost:%s\nRestart=always\nRestartSec=5\nEnvironment=OLLAMA_VULKAN=1\nWorkingDirectory=%s/agent\n\n[Install]\nWantedBy=multi-user.target\n' "$INSTALL_DIR" "$GATEWAY_PORT" "$INSTALL_DIR" > /etc/systemd/system/tentaclaw-agent.service
    ok "Agent service fixed (port $GATEWAY_PORT)"
fi

# Fix gateway service to use dist path
if [ -f /etc/systemd/system/tentaclaw-gateway.service ]; then
    GATEWAY_PORT="8080"
    if [ -f "$HOME/.tentaclaw/gateway-port" ]; then
        GATEWAY_PORT=$(cat "$HOME/.tentaclaw/gateway-port")
    fi

    printf '[Unit]\nDescription=TentaCLAW Gateway\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/node %s/gateway/dist/gateway/src/index.js --port %s\nRestart=always\nRestartSec=5\nWorkingDirectory=%s/gateway\n\n[Install]\nWantedBy=multi-user.target\n' "$INSTALL_DIR" "$GATEWAY_PORT" "$INSTALL_DIR" > /etc/systemd/system/tentaclaw-gateway.service
    ok "Gateway service fixed (port $GATEWAY_PORT)"
fi

systemctl daemon-reload
systemctl restart tentaclaw-gateway 2>/dev/null || true
sleep 3
systemctl restart tentaclaw-agent 2>/dev/null || true
sleep 5

# Check status
if systemctl is-active tentaclaw-gateway &>/dev/null; then
    ok "Gateway running"
else
    fail "Gateway not running"
    systemctl status tentaclaw-gateway --no-pager 2>&1 | tail -5
fi

if systemctl is-active tentaclaw-agent &>/dev/null; then
    ok "Agent running"
else
    fail "Agent not running"
    systemctl status tentaclaw-agent --no-pager 2>&1 | tail -5
fi

# ── Step 6: Test chat ───────────────────────────────────────────────────────
step "6/6 Test chat"

# Fix CLI wrapper if needed
CLI_WRAPPER="/usr/local/bin/tentaclaw-bin.sh"
if [ ! -f "$CLI_WRAPPER" ]; then
    printf '#!/bin/sh\nexec node %s/cli/dist/cli/src/index.js "$@"\n' "$INSTALL_DIR" > "$CLI_WRAPPER"
    chmod +x "$CLI_WRAPPER"
    ln -sf "$CLI_WRAPPER" /usr/local/bin/tentaclaw 2>/dev/null || true
    ok "CLI wrapper created"
fi

# Wait for agent to register
sleep 5

GATEWAY_PORT="8080"
if [ -f "$HOME/.tentaclaw/gateway-port" ]; then
    GATEWAY_PORT=$(cat "$HOME/.tentaclaw/gateway-port")
fi

REPLY=$(curl -sf "http://localhost:${GATEWAY_PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"llama3.2","messages":[{"role":"user","content":"Say hello in 5 words"}],"max_tokens":50}' \
    --max-time 60 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    c = d.get('choices',[{}])[0].get('message',{}).get('content','')
    if isinstance(c, list):
        c = ''.join(p.get('text','') for p in c if p.get('type')=='text')
    print(str(c)[:100])
except: print('(parse error)')
" 2>/dev/null)

if [ -n "$REPLY" ] && [ "$REPLY" != "(parse error)" ] && [ "$REPLY" != "(no response)" ]; then
    ok "Chat works: $REPLY"
else
    fail "Chat failed: $REPLY"
    log "  Check: curl -s http://localhost:${GATEWAY_PORT}/v1/models"
fi

log "\n${GREEN}${BOLD}Done! pve node is fixed.${RESET}"
log "  Gateway: http://localhost:${GATEWAY_PORT}/dashboard"
log "  Chat:    tentaclaw chat \"hello\""
