#!/bin/bash
# =============================================================================
# TentaCLAW OS — Quickstart
# =============================================================================
# Start everything in one command: gateway + agent + dashboard.
#
# Usage:
#   ./scripts/quickstart.sh                  # Start with GPU auto-detect
#   ./scripts/quickstart.sh --mock           # Start with mock GPUs (no real GPU needed)
#   ./scripts/quickstart.sh --mock --gpus 4  # Mock mode with 4 fake GPUs
#   ./scripts/quickstart.sh --no-browser     # Don't open the dashboard in browser
#   ./scripts/quickstart.sh --stop           # Stop all running TentaCLAW services
#
# CLAWtopus says: "One command. That's it. I handle the rest."
# =============================================================================

set -euo pipefail

# Error trap — report the failing line on unexpected errors
trap 'echo -e "${RED:-}Error on line $LINENO${RESET:-}"; exit 1' ERR

# ──────────────────────────────────────────────────────────────────
# Brand colors (24-bit true color)
# ──────────────────────────────────────────────────────────────────
CYAN='\033[38;2;0;212;170m'
PURPLE='\033[38;2;139;92;246m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
YELLOW='\033[38;2;255;220;0m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ──────────────────────────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GATEWAY_PORT="${TENTACLAW_PORT:-8080}"
MOCK_MODE=false
MOCK_GPUS=2
NO_BROWSER=false
STOP_MODE=false
AGENT_FLAGS=""

# PID tracking
PID_DIR="$PROJECT_DIR/.pids"
GATEWAY_PID_FILE="$PID_DIR/gateway.pid"
AGENT_PID_FILE="$PID_DIR/agent.pid"

# ──────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mock)
            MOCK_MODE=true
            shift
            ;;
        --gpus)
            MOCK_GPUS="$2"
            shift 2
            ;;
        --no-browser)
            NO_BROWSER=true
            shift
            ;;
        --stop)
            STOP_MODE=true
            shift
            ;;
        --port)
            GATEWAY_PORT="$2"
            shift 2
            ;;
        --help|-h)
            echo "TentaCLAW OS — Quickstart"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --mock            Use mock GPUs (no real GPU needed)"
            echo "  --gpus N          Number of mock GPUs (default: 2)"
            echo "  --no-browser      Don't open dashboard in browser"
            echo "  --port PORT       Gateway port (default: 8080)"
            echo "  --stop            Stop all TentaCLAW services"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1 (use --help for usage)"
            exit 1
            ;;
    esac
done

# ──────────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
warn() { echo -e "  ${YELLOW}!${RESET} $1"; }
info() { echo -e "  ${DIM}$1${RESET}"; }

# Check if a PID file's process is still running
is_running() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            rm -f "$pid_file"
            return 1
        fi
    fi
    return 1
}

# ──────────────────────────────────────────────────────────────────
# Graceful kill helper — SIGTERM first, then SIGKILL after timeout
# ──────────────────────────────────────────────────────────────────
graceful_kill() {
    local pid="$1"
    local label="${2:-process}"

    # Send SIGTERM first
    kill "$pid" 2>/dev/null || return 0

    # Wait up to 5 seconds for graceful exit
    local retries=10
    while [ $retries -gt 0 ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        sleep 0.5 2>/dev/null || sleep 1
        retries=$((retries - 1))
    done

    # Force kill if still alive
    if kill -0 "$pid" 2>/dev/null; then
        warn "$label (PID $pid) did not exit gracefully, sending SIGKILL..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
}

# ──────────────────────────────────────────────────────────────────
# Stop all services
# ──────────────────────────────────────────────────────────────────
stop_services() {
    echo ""
    echo -e "  ${BOLD}Stopping TentaCLAW services...${RESET}"
    echo ""

    local stopped=0

    # ── Stop agent by PID file ──
    if is_running "$AGENT_PID_FILE"; then
        local pid
        pid=$(cat "$AGENT_PID_FILE")
        graceful_kill "$pid" "Agent"
        rm -f "$AGENT_PID_FILE"
        ok "Agent stopped (PID $pid)"
        stopped=$((stopped + 1))
    fi

    # ── Stop gateway by PID file ──
    if is_running "$GATEWAY_PID_FILE"; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        graceful_kill "$pid" "Gateway"
        rm -f "$GATEWAY_PID_FILE"
        ok "Gateway stopped (PID $pid)"
        stopped=$((stopped + 1))
    fi

    # ── Clean up stale PID files ──
    for pid_file in "$PID_DIR"/*.pid; do
        [ -f "$pid_file" ] || continue
        local stale_pid
        stale_pid=$(cat "$pid_file" 2>/dev/null || echo "")
        if [ -n "$stale_pid" ] && ! kill -0 "$stale_pid" 2>/dev/null; then
            rm -f "$pid_file"
            info "Cleaned stale PID file: $(basename "$pid_file")"
        fi
    done

    # ── Kill by port — find anything still holding the gateway port ──
    if command_exists lsof; then
        local port_pid
        port_pid=$(lsof -ti ":${GATEWAY_PORT}" 2>/dev/null || true)
        if [ -n "$port_pid" ]; then
            echo "$port_pid" | while read -r pid; do
                graceful_kill "$pid" "Process on port ${GATEWAY_PORT}"
                ok "Killed process on port ${GATEWAY_PORT} (PID $pid)"
                stopped=$((stopped + 1))
            done
        fi
    elif command_exists ss; then
        local port_pid
        port_pid=$(ss -tlnp "sport = :${GATEWAY_PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' || true)
        if [ -n "$port_pid" ]; then
            echo "$port_pid" | while read -r pid; do
                graceful_kill "$pid" "Process on port ${GATEWAY_PORT}"
                ok "Killed process on port ${GATEWAY_PORT} (PID $pid)"
                stopped=$((stopped + 1))
            done
        fi
    fi

    # ── Also try to find and kill any orphaned processes ──
    local orphans
    orphans=$(pgrep -f "tentaclaw.*index.ts" 2>/dev/null || true)
    if [ -n "$orphans" ]; then
        echo "$orphans" | while read -r pid; do
            graceful_kill "$pid" "Orphaned TentaCLAW process"
        done
        ok "Cleaned up orphaned processes"
        stopped=$((stopped + 1))
    fi

    if [ "$stopped" -eq 0 ]; then
        info "No running TentaCLAW services found"
    fi

    echo ""
    exit 0
}

# ──────────────────────────────────────────────────────────────────
# Banner
# ──────────────────────────────────────────────────────────────────
print_banner() {
    echo ""
    echo -e "  ${PURPLE}╭──────────────────────────────────────────────╮${RESET}"
    echo -e "  ${PURPLE}│${RESET}  ${CYAN}${BOLD}TentaCLAW OS${RESET}  ${DIM}Quickstart${RESET}                    ${PURPLE}│${RESET}"
    echo -e "  ${PURPLE}│${RESET}  ${DIM}Starting gateway + agent + dashboard${RESET}       ${PURPLE}│${RESET}"
    echo -e "  ${PURPLE}╰──────────────────────────────────────────────╯${RESET}"
    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Preflight checks
# ──────────────────────────────────────────────────────────────────
preflight() {
    local errors=0

    # Check Node.js
    if ! command_exists node; then
        fail "Node.js not found"
        info "Install Node.js 20+: https://nodejs.org"
        errors=$((errors + 1))
    else
        local node_ver
        node_ver=$(node --version 2>/dev/null || echo "v0")
        local major
        major=$(echo "$node_ver" | sed 's/v//' | cut -d. -f1)
        if [ "$major" -lt 18 ] 2>/dev/null; then
            fail "Node.js $node_ver too old (need 18+)"
            errors=$((errors + 1))
        else
            ok "Node.js $node_ver"
            if [ "$major" -lt 20 ] 2>/dev/null; then
                warn "Node.js 20+ recommended (current: $node_ver)"
            fi
        fi
    fi

    # Check npx
    if ! command_exists npx; then
        fail "npx not found (comes with Node.js)"
        errors=$((errors + 1))
    fi

    # Check gateway exists
    if [ ! -f "$PROJECT_DIR/gateway/package.json" ]; then
        fail "Gateway not found at $PROJECT_DIR/gateway"
        errors=$((errors + 1))
    fi

    # Check agent exists
    if [ ! -f "$PROJECT_DIR/agent/package.json" ]; then
        fail "Agent not found at $PROJECT_DIR/agent"
        errors=$((errors + 1))
    fi

    if [ "$errors" -gt 0 ]; then
        echo ""
        fail "Preflight checks failed ($errors error(s))"
        info "Run the installer first: curl -fsSL tentaclaw.io/install | bash"
        exit 1
    fi

    # Check if deps are installed
    if [ ! -d "$PROJECT_DIR/gateway/node_modules" ]; then
        info "Installing gateway dependencies..."
        (cd "$PROJECT_DIR/gateway" && npm install --silent 2>/dev/null) || true
    fi

    if [ ! -d "$PROJECT_DIR/agent/node_modules" ]; then
        info "Installing agent dependencies..."
        (cd "$PROJECT_DIR/agent" && npm install --silent 2>/dev/null) || true
    fi
}

# ──────────────────────────────────────────────────────────────────
# Port conflict detection
# ──────────────────────────────────────────────────────────────────
is_port_free() {
    local port="$1"
    if command_exists lsof; then
        ! lsof -i ":${port}" > /dev/null 2>&1
    elif command_exists ss; then
        ! ss -tlnp 2>/dev/null | grep -q ":${port} "
    else
        ! (echo >/dev/tcp/127.0.0.1/"${port}") 2>/dev/null
    fi
}

find_free_port() {
    local start="$1"
    for try_port in $start 8081 8082 8083 9080 9090 3080 7080; do
        if is_port_free "$try_port"; then
            echo "$try_port"
            return
        fi
    done
    echo "$start"
}

check_port_available() {
    local port="$1"
    if ! is_port_free "$port"; then
        local new_port
        new_port=$(find_free_port "$((port + 1))")
        warn "Port ${port} already in use — switching to port ${new_port}"
        GATEWAY_PORT="$new_port"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Start gateway
# ──────────────────────────────────────────────────────────────────
start_gateway() {
    # Check if already running (our own gateway responding)
    if curl -sf "http://localhost:${GATEWAY_PORT}/api/v1/cluster" &>/dev/null; then
        ok "Gateway already running on port ${GATEWAY_PORT}"
        return 0
    fi

    if is_running "$GATEWAY_PID_FILE"; then
        ok "Gateway process exists (PID $(cat "$GATEWAY_PID_FILE"))"
        return 0
    fi

    # Check for port conflicts before attempting to start
    check_port_available "$GATEWAY_PORT"

    info "Starting gateway on port ${GATEWAY_PORT}..."

    # Create PID directory
    mkdir -p "$PID_DIR"

    # Start gateway in background
    TENTACLAW_PORT="$GATEWAY_PORT" nohup npx tsx "$PROJECT_DIR/gateway/src/index.ts" \
        > "$PID_DIR/gateway.log" 2>&1 &
    local gw_pid=$!
    echo "$gw_pid" > "$GATEWAY_PID_FILE"

    # Wait for gateway to be ready
    local retries=20
    while [ $retries -gt 0 ]; do
        if curl -sf "http://localhost:${GATEWAY_PORT}/api/v1/cluster" &>/dev/null; then
            ok "Gateway started on port ${GATEWAY_PORT} (PID $gw_pid)"
            return 0
        fi
        sleep 0.5 2>/dev/null || sleep 1
        retries=$((retries - 1))
    done

    # Check if process is still alive
    if kill -0 "$gw_pid" 2>/dev/null; then
        warn "Gateway started (PID $gw_pid) but not yet responding"
        info "Check logs: cat $PID_DIR/gateway.log"
        return 0
    else
        fail "Gateway failed to start"
        info "Check logs: cat $PID_DIR/gateway.log"
        return 1
    fi
}

# ──────────────────────────────────────────────────────────────────
# Start agent
# ──────────────────────────────────────────────────────────────────
start_agent() {
    if is_running "$AGENT_PID_FILE"; then
        ok "Agent already running (PID $(cat "$AGENT_PID_FILE"))"
        return 0
    fi

    # Build agent flags
    AGENT_FLAGS="--gateway http://localhost:${GATEWAY_PORT}"

    if $MOCK_MODE; then
        AGENT_FLAGS="$AGENT_FLAGS --mock --gpus $MOCK_GPUS"
        info "Starting agent (mock mode, $MOCK_GPUS GPUs)..."
    else
        info "Starting agent (auto-detecting hardware)..."
    fi

    # Create PID directory
    mkdir -p "$PID_DIR"

    # Start agent in background
    # shellcheck disable=SC2086
    nohup npx tsx "$PROJECT_DIR/agent/src/index.ts" $AGENT_FLAGS \
        > "$PID_DIR/agent.log" 2>&1 &
    local agent_pid=$!
    echo "$agent_pid" > "$AGENT_PID_FILE"

    # Give agent time to register
    sleep 2

    if kill -0 "$agent_pid" 2>/dev/null; then
        local hostname
        hostname=$(hostname 2>/dev/null || echo "localhost")
        if $MOCK_MODE; then
            ok "Agent registered ($hostname, ${MOCK_GPUS}x mock GPUs, PID $agent_pid)"
        else
            ok "Agent registered ($hostname, PID $agent_pid)"
        fi
        return 0
    else
        fail "Agent failed to start"
        info "Check logs: cat $PID_DIR/agent.log"
        return 1
    fi
}

# ──────────────────────────────────────────────────────────────────
# Open dashboard in browser
# ──────────────────────────────────────────────────────────────────
open_dashboard() {
    if $NO_BROWSER; then
        return
    fi

    local url="http://localhost:${GATEWAY_PORT}/dashboard"

    if command_exists xdg-open; then
        xdg-open "$url" 2>/dev/null &
    elif command_exists open; then
        open "$url" 2>/dev/null &
    elif command_exists start; then
        start "$url" 2>/dev/null &
    elif [[ "${OSTYPE:-}" == "msys" || "${OSTYPE:-}" == "cygwin" ]]; then
        cmd.exe /c start "$url" 2>/dev/null &
    fi
}

# ──────────────────────────────────────────────────────────────────
# Print status summary
# ──────────────────────────────────────────────────────────────────
print_status() {
    echo ""
    echo -e "  ${PURPLE}╭──────────────────────────────────────────────╮${RESET}"
    echo -e "  ${PURPLE}│${RESET}  ${GREEN}${BOLD}TentaCLAW is running!${RESET}                        ${PURPLE}│${RESET}"
    echo -e "  ${PURPLE}╰──────────────────────────────────────────────╯${RESET}"
    echo ""
    echo -e "  ${BOLD}Dashboard:${RESET}  ${CYAN}http://localhost:${GATEWAY_PORT}/dashboard${RESET}"
    echo -e "  ${BOLD}API:${RESET}        ${CYAN}http://localhost:${GATEWAY_PORT}/api/v1${RESET}"
    echo ""

    # Show detected backend
    if command_exists ollama && curl -sf http://localhost:11434/api/tags &>/dev/null; then
        local model_count
        model_count=$(curl -sf http://localhost:11434/api/tags 2>/dev/null | grep -o '"name"' | wc -l | tr -d ' ')
        echo -e "  ${BOLD}Ollama:${RESET}     ${GREEN}running${RESET} ($model_count model(s) available)"
    fi

    echo ""
    echo -e "  ${BOLD}Logs:${RESET}"
    echo -e "    ${DIM}Gateway: $PID_DIR/gateway.log${RESET}"
    echo -e "    ${DIM}Agent:   $PID_DIR/agent.log${RESET}"
    echo ""
    echo -e "  ${BOLD}Stop:${RESET}       ${DIM}bash $0 --stop${RESET}"
    echo ""

    # Show the CLAWtopus quip
    local quips=(
        "eight arms, zero problems"
        "all systems purring"
        "smooth seas today, captain"
        "running like a dream"
        "you didn't even notice huh... that's the point"
        "ready when you are"
    )
    local quip="${quips[$((RANDOM % ${#quips[@]}))]}"
    echo -e "  ${DIM}CLAWtopus says: \"${quip}\"${RESET}"
    echo ""
}

# ══════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════
main() {
    # Handle --stop
    if $STOP_MODE; then
        stop_services
    fi

    print_banner
    preflight

    echo ""
    echo -e "  ${BOLD}Starting services...${RESET}"
    echo ""

    start_gateway
    start_agent
    open_dashboard
    print_status
}

main "$@"
