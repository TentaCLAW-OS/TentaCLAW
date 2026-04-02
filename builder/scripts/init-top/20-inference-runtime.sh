#!/bin/bash
# =============================================================================
# TentaCLAW OS — Inference Runtime Start Script (init-top)
# =============================================================================
# Runs AFTER switchroot (in the real rootfs). Ensures the Ollama inference
# runtime is installed, starts it in the background, and waits for it to
# become healthy before handing off to downstream scripts.
#
# TentaCLAW says: "Warming up the neurons."
# =============================================================================

set -euo pipefail

# =============================================================================
# Brand Colors
# =============================================================================
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'

# =============================================================================
# TentaCLAW ASCII Art Library (optional)
# =============================================================================
TENTACLAW_LIB="/opt/tentaclaw/scripts/tentaclaw.sh"
if [ -f "$TENTACLAW_LIB" ]; then
    # shellcheck source=/dev/null
    source "$TENTACLAW_LIB"
fi

# =============================================================================
# Config
# =============================================================================
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
OLLAMA_API="${OLLAMA_HOST}/api/tags"
OLLAMA_LOG_DIR="/var/log/tentaclaw"
OLLAMA_LOG="${OLLAMA_LOG_DIR}/ollama.log"
MAX_WAIT_SECONDS=60
INSTALL_URL="https://ollama.ai/install.sh"

# =============================================================================
# Logging
# =============================================================================
log() {
    echo -e "${CYAN}[tentaclaw]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[tentaclaw]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[tentaclaw]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[tentaclaw]${RESET} $*" >&2
}

# =============================================================================
# Step 1: Check if Ollama is installed, install if missing
# =============================================================================
ensure_ollama_installed() {
    log "Checking for Ollama installation..."

    if command -v ollama &>/dev/null; then
        local ollama_version
        ollama_version=$(ollama --version 2>/dev/null || echo "unknown")
        log_success "Ollama is installed: ${ollama_version}"
        return 0
    fi

    log_warn "Ollama is not installed. Attempting automatic installation..."

    # Verify curl is available
    if ! command -v curl &>/dev/null; then
        log_error "curl is not installed. Cannot download Ollama installer."
        log_error "Install curl or install Ollama manually."
        return 1
    fi

    # Download and run the official Ollama installer
    log "Downloading Ollama installer from ${INSTALL_URL}..."
    if curl -fsSL "$INSTALL_URL" | sh; then
        log_success "Ollama installed successfully"
    else
        log_error "Ollama installation failed"
        return 1
    fi

    # Verify the install worked
    if ! command -v ollama &>/dev/null; then
        log_error "Ollama binary not found after installation"
        return 1
    fi

    local ollama_version
    ollama_version=$(ollama --version 2>/dev/null || echo "unknown")
    log_success "Ollama installed: ${ollama_version}"
}

# =============================================================================
# Step 2: Check if Ollama is already running
# =============================================================================
is_ollama_running() {
    # Check via API health
    if curl -sf --connect-timeout 2 "${OLLAMA_API}" &>/dev/null; then
        return 0
    fi

    # Check via process
    if pgrep -x "ollama" &>/dev/null; then
        return 0
    fi

    return 1
}

# =============================================================================
# Step 3: Start Ollama serve in background
# =============================================================================
start_ollama() {
    log "Starting Ollama inference runtime..."

    # If already running, skip
    if is_ollama_running; then
        log_success "Ollama is already running"
        return 0
    fi

    # Prepare log directory
    mkdir -p "$OLLAMA_LOG_DIR" 2>/dev/null || true

    local start_ts
    start_ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "--- Ollama started at ${start_ts} ---" >> "$OLLAMA_LOG"

    # Start ollama serve in background
    # OLLAMA_HOST env var controls the bind address/port
    export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
    nohup ollama serve >> "$OLLAMA_LOG" 2>&1 &
    local ollama_pid=$!

    log "Ollama serve started (PID: ${ollama_pid})"

    # Save PID for later reference
    mkdir -p /var/run/tentaclaw 2>/dev/null || true
    echo "$ollama_pid" > /var/run/tentaclaw/ollama.pid

    # Brief pause to let the process initialize
    sleep 2

    # Verify process is still alive
    if ! kill -0 "$ollama_pid" 2>/dev/null; then
        log_error "Ollama process died immediately after start"
        log_error "Check ${OLLAMA_LOG} for details"
        return 1
    fi
}

# =============================================================================
# Step 4: Wait for Ollama to become ready
# =============================================================================
wait_for_ollama() {
    log "Waiting for Ollama to become ready (polling ${OLLAMA_API})..."

    local elapsed=0

    while [ "$elapsed" -lt "$MAX_WAIT_SECONDS" ]; do
        if curl -sf --connect-timeout 2 "${OLLAMA_API}" &>/dev/null; then
            log_success "Ollama is ready after ${elapsed}s"
            return 0
        fi

        # Show progress every 5 seconds
        if [ $((elapsed % 5)) -eq 0 ] && [ "$elapsed" -gt 0 ]; then
            log "Still waiting... ${elapsed}/${MAX_WAIT_SECONDS}s"
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_error "Ollama did not become ready within ${MAX_WAIT_SECONDS}s"
    log_error "Check ${OLLAMA_LOG} for details"
    return 1
}

# =============================================================================
# Step 5: Log runtime status
# =============================================================================
log_status() {
    log "Querying Ollama runtime status..."

    # Get list of loaded models
    local response
    response=$(curl -sf --connect-timeout 5 "${OLLAMA_API}" 2>/dev/null || echo "")

    if [ -n "$response" ]; then
        local model_count
        model_count=$(echo "$response" | jq '.models | length' 2>/dev/null || echo "0")
        log "Models available: ${model_count}"

        # List models if any are present
        if [ "${model_count:-0}" -gt 0 ]; then
            echo "$response" | jq -r '.models[].name' 2>/dev/null | while read -r model_name; do
                log "  - ${model_name}"
            done
        fi
    else
        log_warn "Could not query model list"
    fi

    # Log GPU availability for inference
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        local gpu_count
        gpu_count=$(nvidia-smi --query-gpu=count --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "0")
        log "NVIDIA GPUs available for inference: ${gpu_count}"
    fi
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo -e "${BOLD}${CYAN}  ||        ${PURPLE}TentaCLAW Inference Runtime${CYAN}              ${RESET}"
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo ""

log "Initializing inference runtime..."
log "TentaCLAW says: \"Warming up the neurons.\""

# Ensure Ollama is installed
ensure_ollama_installed || {
    log_error "Cannot proceed without Ollama. Inference will be unavailable."
    exit 1
}

# Start Ollama serve
start_ollama || {
    log_error "Failed to start Ollama serve."
    exit 1
}

# Wait for readiness
wait_for_ollama || {
    log_error "Ollama is not responding. Inference may be degraded."
    # Don't exit — downstream scripts can retry
}

# Log status
log_status

echo ""
log_success "Inference runtime is up and running"
if type tentaclaw_status &>/dev/null; then
    tentaclaw_status "ok" "Ollama inference engine online"
fi
echo ""

exit 0
