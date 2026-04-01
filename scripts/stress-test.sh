#!/bin/bash
# =============================================================================
# TentaCLAW OS — 20-Iteration Stress Test
# =============================================================================
# Full install → chat → two-agent → tetris → test → delete → uninstall loop
# Run on vega2 as root: bash stress-test.sh
# =============================================================================

set -uo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
CYAN='\033[38;2;0;212;170m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
YELLOW='\033[38;2;255;220;0m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────────
ITERATIONS=20
INSTALL_DIR="/opt/tentaclaw"
LOG_FILE="/tmp/tentaclaw-stress-$(date +%Y%m%d-%H%M%S).log"
RESULTS_FILE="/tmp/tentaclaw-stress-results.txt"
TETRIS_FILE="/tmp/tetris-test.html"
MODEL_A="llama3.2"
MODEL_B="qwen2.5:0.5b"
PASS=0
FAIL=0
declare -A STEP_FAILS

# ── Logging ───────────────────────────────────────────────────────────────────
log() { echo -e "$*" | tee -a "$LOG_FILE"; }
step() { log "\n${CYAN}  ▸ $*${RESET}"; }
ok()   { log "${GREEN}  ✓ $*${RESET}"; }
fail() { log "${RED}  ✗ $*${RESET}"; }
warn() { log "${YELLOW}  ! $*${RESET}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
get_gateway_port() {
    local saved="$HOME/.tentaclaw/gateway-port"
    if [[ -f "$saved" ]]; then
        cat "$saved"
    else
        echo "8080"
    fi
}

wait_for_gateway() {
    local port; port=$(get_gateway_port)
    local url="http://localhost:${port}/health"
    local attempts=0
    while [[ $attempts -lt 30 ]]; do
        if curl -sf "$url" &>/dev/null; then
            ok "Gateway up on port $port"
            return 0
        fi
        sleep 2
        ((attempts++))
    done
    fail "Gateway never came up on port $port"
    return 1
}

wait_for_agent() {
    local port; port=$(get_gateway_port)
    local attempts=0
    while [[ $attempts -lt 30 ]]; do
        local models
        models=$(curl -sf "http://localhost:${port}/v1/models" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
        if [[ "$models" -gt 0 ]]; then
            ok "Agent registered $models model(s)"
            return 0
        fi
        sleep 2
        ((attempts++))
    done
    warn "No models registered after 60s — agent may need more time"
    return 0  # non-fatal, continue
}

chat() {
    local port; port=$(get_gateway_port)
    local model="$1"
    local prompt="$2"
    curl -sf "http://localhost:${port}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"${prompt}\"}],\"max_tokens\":2048}" \
        --max-time 120 2>/dev/null
}

extract_text() {
    python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    choices = d.get('choices', [])
    if choices:
        msg = choices[0].get('message', {})
        content = msg.get('content', '')
        if isinstance(content, list):
            content = ''.join(p.get('text','') for p in content if p.get('type')=='text')
        print(str(content)[:500])
    else:
        print('(no choices)')
except Exception as e:
    print(f'parse error: {e}')
" 2>/dev/null
}

uninstall() {
    step "Uninstalling TentaCLAW..."

    # Stop and disable services
    for svc in tentaclaw-gateway tentaclaw-agent; do
        systemctl stop "$svc" 2>/dev/null || true
        systemctl disable "$svc" 2>/dev/null || true
        rm -f "/etc/systemd/system/${svc}.service"
    done
    systemctl daemon-reload 2>/dev/null || true

    # Kill any stray processes
    pkill -f "tentaclaw" 2>/dev/null || true
    pkill -f "dist/gateway" 2>/dev/null || true
    pkill -f "dist/agent" 2>/dev/null || true
    sleep 1

    # Remove files
    rm -rf "$INSTALL_DIR"
    rm -f "$HOME/.tentaclaw/gateway-port"
    rm -f /usr/local/bin/tentaclaw
    rm -f /usr/local/bin/tentaclaw-bin.sh

    ok "Uninstall complete"
}

record_step_fail() {
    local step_name="$1"
    STEP_FAILS["$step_name"]=$(( ${STEP_FAILS["$step_name"]:-0} + 1 ))
}

# ── Pre-flight ─────────────────────────────────────────────────────────────────
log "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗"
log "║       TentaCLAW OS — 20-Iteration Stress Test            ║"
log "╚══════════════════════════════════════════════════════════╝${RESET}"
log "Log: $LOG_FILE\n"

# Ensure required tools
for tool in curl git node python3 systemctl; do
    if ! command -v "$tool" &>/dev/null; then
        fail "Required tool missing: $tool"
        exit 1
    fi
done

# Check ollama is running
if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
    warn "Ollama not running — starting it..."
    ollama serve &>/dev/null &
    sleep 3
fi

# Pull models if not already present
step "Ensuring models are available..."
for model in "$MODEL_A" "$MODEL_B"; do
    if ! ollama list 2>/dev/null | grep -q "^${model%:*}"; then
        log "  Pulling $model (this may take a while)..."
        ollama pull "$model" >> "$LOG_FILE" 2>&1 || warn "Could not pull $model — will use whatever is available"
    else
        ok "$model already present"
    fi
done

# Pick whatever model is available if our preferred ones aren't there
AVAILABLE_MODEL=$(ollama list 2>/dev/null | awk 'NR>1 {print $1; exit}' | tr -d ' ')
if [[ -z "$AVAILABLE_MODEL" ]]; then
    fail "No Ollama models available. Run: ollama pull llama3.2"
    exit 1
fi
MODEL_A="${MODEL_A:-$AVAILABLE_MODEL}"
MODEL_B="${MODEL_B:-$AVAILABLE_MODEL}"
log "  Using models: ${MODEL_A} / ${MODEL_B}"

# Clean slate before starting
uninstall 2>/dev/null || true

# ── Main Loop ──────────────────────────────────────────────────────────────────
for i in $(seq 1 $ITERATIONS); do
    ITER_PASS=true
    log "\n${BOLD}${YELLOW}══════════════════════════════════════════════════════════"
    log "  ITERATION $i / $ITERATIONS"
    log "══════════════════════════════════════════════════════════${RESET}"

    # ── Step 1: Install ─────────────────────────────────────────────────────
    step "1/8 Install"
    if curl -fsSL https://tentaclaw.io/install | bash -s -- --no-wizard >> "$LOG_FILE" 2>&1; then
        # Source profile to get tentaclaw in PATH
        export PATH="/usr/local/bin:$PATH"
        ok "Install complete"
    else
        fail "Install failed"
        record_step_fail "install"
        ITER_PASS=false
        ((FAIL++)) || true
        echo "ITER $i: FAIL (install)" >> "$RESULTS_FILE"
        continue
    fi

    # ── Step 2: Start services ──────────────────────────────────────────────
    step "2/8 Start gateway + agent"
    # Try systemd first, fall back to manual
    if systemctl is-active tentaclaw-gateway &>/dev/null; then
        ok "Gateway already running via systemd"
    elif [[ -f "${INSTALL_DIR}/dist/gateway/src/index.js" ]]; then
        PORT=$(python3 -c "
import socket
for p in [8080,8081,8082,8083,9080,9090]:
    try:
        s=socket.socket(); s.bind(('',p)); s.close(); print(p); break
    except: pass
")
        mkdir -p "$HOME/.tentaclaw"
        echo "$PORT" > "$HOME/.tentaclaw/gateway-port"
        OLLAMA_VULKAN=1 node "${INSTALL_DIR}/dist/gateway/src/index.js" --port "$PORT" >> "$LOG_FILE" 2>&1 &
        sleep 3
    fi

    if ! wait_for_gateway; then
        fail "Gateway failed to start"
        record_step_fail "gateway_start"
        ITER_PASS=false
        uninstall >> "$LOG_FILE" 2>&1
        ((FAIL++)) || true
        echo "ITER $i: FAIL (gateway_start)" >> "$RESULTS_FILE"
        continue
    fi

    # Start agent if not running
    if ! systemctl is-active tentaclaw-agent &>/dev/null; then
        if [[ -f "${INSTALL_DIR}/agent/dist/agent/src/index.js" ]]; then
            GATEWAY_PORT=$(get_gateway_port)
            OLLAMA_VULKAN=1 node "${INSTALL_DIR}/agent/dist/agent/src/index.js" --gateway "http://localhost:${GATEWAY_PORT}" >> "$LOG_FILE" 2>&1 &
        fi
    fi

    wait_for_agent

    # ── Step 3: First chat message ──────────────────────────────────────────
    step "3/8 First chat message"
    REPLY=$(chat "$MODEL_A" "Say hello in exactly 5 words." | extract_text)
    if [[ -n "$REPLY" && "$REPLY" != "(no choices)" && "$REPLY" != *"error"* ]]; then
        ok "Chat response: ${REPLY:0:80}"
    else
        fail "Chat failed — response: $REPLY"
        record_step_fail "first_chat"
        ITER_PASS=false
    fi

    # ── Step 4: Agent A ─────────────────────────────────────────────────────
    step "4/8 Agent A (${MODEL_A})"
    REPLY_A=$(chat "$MODEL_A" "What is 2+2? Reply with just the number." | extract_text)
    if [[ -n "$REPLY_A" && "$REPLY_A" != "(no choices)" ]]; then
        ok "Agent A replied: ${REPLY_A:0:60}"
    else
        fail "Agent A failed"
        record_step_fail "agent_a"
        ITER_PASS=false
    fi

    # ── Step 5: Agent B ─────────────────────────────────────────────────────
    step "5/8 Agent B (${MODEL_B})"
    REPLY_B=$(chat "$MODEL_B" "What is 3+3? Reply with just the number." | extract_text)
    if [[ -n "$REPLY_B" && "$REPLY_B" != "(no choices)" ]]; then
        ok "Agent B replied: ${REPLY_B:0:60}"
    else
        warn "Agent B failed (model may not be available) — non-fatal"
        record_step_fail "agent_b"
        # non-fatal if only one model available
    fi

    # ── Step 6: Generate Tetris ─────────────────────────────────────────────
    step "6/8 Generate Tetris game"
    TETRIS_PROMPT="Write a complete single-file HTML Tetris game. Use a <canvas> element, vanilla JavaScript game loop, arrow key controls, score display, and game over screen. Output ONLY the HTML — no explanation, no markdown fences, just raw HTML starting with <!DOCTYPE html>."

    GATEWAY_PORT=$(get_gateway_port)
    curl -sf "http://localhost:${GATEWAY_PORT}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"${MODEL_A}\",\"messages\":[{\"role\":\"user\",\"content\":\"${TETRIS_PROMPT}\"}],\"max_tokens\":4096}" \
        --max-time 180 \
        2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
choices = d.get('choices', [])
if choices:
    msg = choices[0].get('message', {})
    content = msg.get('content', '')
    if isinstance(content, list):
        content = ''.join(p.get('text','') for p in content if p.get('type')=='text')
    # Strip markdown fences if present
    content = content.strip()
    if content.startswith('\`\`\`'):
        lines = content.split('\n')
        lines = [l for l in lines if not l.startswith('\`\`\`')]
        content = '\n'.join(lines)
    print(content)
" > "$TETRIS_FILE" 2>/dev/null

    if [[ -f "$TETRIS_FILE" ]] && grep -qi "<canvas" "$TETRIS_FILE" 2>/dev/null; then
        SIZE=$(wc -c < "$TETRIS_FILE")
        ok "Tetris game generated (${SIZE} bytes)"
    else
        fail "Tetris generation failed or missing <canvas>"
        record_step_fail "tetris_generate"
        ITER_PASS=false
    fi

    # ── Step 7: Test Tetris ─────────────────────────────────────────────────
    step "7/8 Test Tetris game"
    TEST_PASS=true
    for pattern in "<!DOCTYPE" "<canvas" "requestAnimationFrame\|setInterval\|gameLoop\|game_loop\|tick\|update" "score\|Score\|SCORE"; do
        if grep -qE "$pattern" "$TETRIS_FILE" 2>/dev/null; then
            ok "  Found: $pattern"
        else
            warn "  Missing: $pattern"
            TEST_PASS=false
        fi
    done

    if $TEST_PASS; then
        ok "Tetris game passes structural tests"
    else
        warn "Tetris game missing some elements (non-fatal)"
        record_step_fail "tetris_test"
    fi

    # ── Step 8: Delete Tetris ───────────────────────────────────────────────
    step "8/8 Delete Tetris + uninstall"
    rm -f "$TETRIS_FILE"
    if [[ ! -f "$TETRIS_FILE" ]]; then
        ok "Tetris deleted"
    else
        fail "Could not delete Tetris file"
    fi

    # ── Uninstall ───────────────────────────────────────────────────────────
    uninstall >> "$LOG_FILE" 2>&1

    # Verify clean
    if [[ ! -d "$INSTALL_DIR" ]] && ! command -v tentaclaw &>/dev/null 2>/dev/null; then
        ok "Clean uninstall verified"
    else
        warn "Some files may remain after uninstall"
    fi

    sleep 2  # Brief pause before next iteration

    if $ITER_PASS; then
        ((PASS++)) || true
        echo "ITER $i: PASS" >> "$RESULTS_FILE"
        log "${GREEN}  → Iteration $i PASSED${RESET}"
    else
        ((FAIL++)) || true
        echo "ITER $i: FAIL" >> "$RESULTS_FILE"
        log "${RED}  → Iteration $i FAILED${RESET}"
    fi

done

# ── Final Report ───────────────────────────────────────────────────────────────
log "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗"
log "║                   STRESS TEST RESULTS                   ║"
log "╚══════════════════════════════════════════════════════════╝${RESET}"
log ""
log "  Total iterations : $ITERATIONS"
log "  ${GREEN}Passed           : $PASS${RESET}"
log "  ${RED}Failed           : $FAIL${RESET}"
log ""

if [[ ${#STEP_FAILS[@]} -gt 0 ]]; then
    log "  Step failure counts:"
    for step_name in "${!STEP_FAILS[@]}"; do
        log "    ${YELLOW}${step_name}${RESET}: ${STEP_FAILS[$step_name]}"
    done
fi

log ""
log "  Full log  : $LOG_FILE"
log "  Results   : $RESULTS_FILE"
cat "$RESULTS_FILE"
log ""

if [[ $FAIL -eq 0 ]]; then
    log "${GREEN}${BOLD}  ALL $ITERATIONS ITERATIONS PASSED ✓${RESET}"
    exit 0
else
    log "${RED}${BOLD}  $FAIL / $ITERATIONS ITERATIONS FAILED ✗${RESET}"
    exit 1
fi
