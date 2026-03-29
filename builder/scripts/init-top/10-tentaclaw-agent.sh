#!/bin/bash
# =============================================================================
# TentaCLAW OS — Agent Daemon Start Script (init-top)
# =============================================================================
# Runs AFTER switchroot (in the real rootfs), called by systemd via
# tentaclaw-agent.service. Sources rig.conf, validates the environment,
# and starts the TentaCLAW agent with proper logging.
#
# CLAWtopus says: "All arms report for duty."
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
# CLAWtopus ASCII Art Library (optional)
# =============================================================================
CLAWTOPUS_LIB="/opt/tentaclaw/scripts/clawtopus.sh"
if [ -f "$CLAWTOPUS_LIB" ]; then
    # shellcheck source=/dev/null
    source "$CLAWTOPUS_LIB"
fi

# =============================================================================
# Paths
# =============================================================================
RIG_CONF="/etc/tentaclaw/rig.conf"
AGENT_BINARY="/opt/tentaclaw/agent/dist/index.js"
AGENT_LOG_DIR="/var/log/tentaclaw"
AGENT_LOG="${AGENT_LOG_DIR}/agent.log"
AGENT_PID_DIR="/var/run/tentaclaw"
AGENT_PID_FILE="${AGENT_PID_DIR}/agent.pid"

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
# Step 1: Source rig.conf
# =============================================================================
load_config() {
    log "Loading config from ${RIG_CONF}..."

    if [ ! -f "$RIG_CONF" ]; then
        log_error "Config file not found: ${RIG_CONF}"
        log_error "Node may not be registered. Run init-bottom scripts first."
        return 1
    fi

    # shellcheck source=/dev/null
    source "$RIG_CONF"

    # Validate required fields
    if [ -z "${NODE_ID:-}" ]; then
        log_error "NODE_ID not set in ${RIG_CONF}"
        return 1
    fi

    if [ -z "${FARM_HASH:-}" ]; then
        log_error "FARM_HASH not set in ${RIG_CONF}"
        return 1
    fi

    log "Node ID:    ${NODE_ID}"
    log "Farm Hash:  ${FARM_HASH}"
    log "Gateway:    ${GATEWAY_URL:-standalone}"
    log "GPU Count:  ${GPU_COUNT:-unknown}"
}

# =============================================================================
# Step 2: Verify Node.js is installed
# =============================================================================
check_nodejs() {
    log "Checking Node.js installation..."

    if ! command -v node &>/dev/null; then
        log_error "Node.js is not installed."
        log_error "Install Node.js 18+ or ensure it is in PATH."
        return 1
    fi

    local node_version
    node_version=$(node --version 2>/dev/null || echo "unknown")
    log "Node.js version: ${node_version}"

    # Verify minimum version (v18+)
    local major_version
    major_version=$(echo "$node_version" | sed 's/^v//' | cut -d. -f1)
    if [ "${major_version:-0}" -lt 18 ]; then
        log_warn "Node.js ${node_version} detected. Recommended: v18 or later."
    fi
}

# =============================================================================
# Step 3: Verify agent binary exists
# =============================================================================
check_agent_binary() {
    log "Checking agent binary at ${AGENT_BINARY}..."

    if [ ! -f "$AGENT_BINARY" ]; then
        log_error "Agent binary not found: ${AGENT_BINARY}"
        log_error "Ensure the agent is built and installed."
        return 1
    fi

    log_success "Agent binary found"
}

# =============================================================================
# Step 4: Prepare runtime directories
# =============================================================================
prepare_directories() {
    log "Preparing runtime directories..."

    mkdir -p "$AGENT_LOG_DIR" 2>/dev/null || true
    mkdir -p "$AGENT_PID_DIR" 2>/dev/null || true

    # Ensure log file is writable
    touch "$AGENT_LOG" 2>/dev/null || true
}

# =============================================================================
# Step 5: Export environment for agent process
# =============================================================================
export_environment() {
    # The agent reads these from env or rig.conf; export for consistency
    export NODE_ID="${NODE_ID:-}"
    export FARM_HASH="${FARM_HASH:-}"
    export GATEWAY_URL="${GATEWAY_URL:-}"
    export GPU_COUNT="${GPU_COUNT:-0}"
    export AGENT_INTERVAL="${AGENT_INTERVAL:-10}"
}

# =============================================================================
# Step 6: Start the agent
# =============================================================================
start_agent() {
    log "Starting TentaCLAW agent daemon..."

    # Record start time
    local start_ts
    start_ts=$(date '+%Y-%m-%d %H:%M:%S')

    echo "--- Agent started at ${start_ts} ---" >> "$AGENT_LOG"

    # Execute Node.js agent — systemd manages the process lifecycle.
    # stdout/stderr go to the journal (via systemd) AND to the log file.
    exec node "$AGENT_BINARY" 2>&1 | tee -a "$AGENT_LOG"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo -e "${BOLD}${CYAN}  ||        ${PURPLE}CLAWtopus Agent Daemon${CYAN}                   ${RESET}"
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo ""

log "Initializing TentaCLAW agent..."

# Run preflight checks — abort on any failure
load_config || {
    log_error "Failed to load config. Agent cannot start."
    exit 1
}

check_nodejs || {
    log_error "Node.js check failed. Agent cannot start."
    exit 1
}

check_agent_binary || {
    log_error "Agent binary check failed. Agent cannot start."
    exit 1
}

prepare_directories
export_environment

echo ""
log_success "All preflight checks passed"
if type clawtopus_quote &>/dev/null; then
    echo -e "  $(clawtopus_quote)"
fi
echo ""

# Start the agent (this call does not return — exec replaces the process)
start_agent
