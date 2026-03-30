#!/bin/bash
# =============================================================================
# TentaCLAW OS — First-Time Setup Wizard
# =============================================================================
# The "install-to-wow in 60 seconds" experience.
# Auto-detects GPUs, installs inference backend, pulls a model,
# starts services, and delivers your first inference — all guided.
#
# Usage:
#   ./scripts/setup-wizard.sh              # Full interactive wizard
#   ./scripts/setup-wizard.sh --auto       # Non-interactive (accept all defaults)
#   ./scripts/setup-wizard.sh --skip-model # Skip model download
#   ./scripts/setup-wizard.sh --backend X  # Pre-select backend (ollama|vllm|llamacpp)
#
# CLAWtopus says: "told you. under 60 seconds."
# =============================================================================

set -euo pipefail

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
# Defaults & state
# ──────────────────────────────────────────────────────────────────
AUTO_MODE=false
SKIP_MODEL=false
BACKEND_OVERRIDE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
GATEWAY_PORT="${TENTACLAW_PORT:-8080}"

# GPU detection results
GPU_COUNT=0
GPU_VENDOR=""
GPU_NAMES=()
GPU_VRAM_EACH=0
GPU_VRAM_TOTAL=0

# Selection results
SELECTED_BACKEND=""
SELECTED_MODEL=""

# Timer
WIZARD_START=$(date +%s)

# ──────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto)
            AUTO_MODE=true
            shift
            ;;
        --skip-model)
            SKIP_MODEL=true
            shift
            ;;
        --backend)
            BACKEND_OVERRIDE="$2"
            shift 2
            ;;
        --help|-h)
            echo "TentaCLAW OS — Setup Wizard"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --auto          Accept all defaults (non-interactive)"
            echo "  --skip-model    Skip model download step"
            echo "  --backend NAME  Pre-select backend (ollama, vllm, llamacpp)"
            echo "  --help, -h      Show this help"
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

# Draw a box with rounded corners
box() {
    local width=55
    local padding=""
    echo ""
    echo -e "  ${PURPLE}╭$(printf '─%.0s' $(seq 1 $width))╮${RESET}"
    while IFS= read -r line; do
        local stripped
        stripped=$(echo -e "$line" | sed 's/\x1b\[[0-9;]*m//g')
        local len=${#stripped}
        local pad=$((width - len - 2))
        if [ $pad -lt 0 ]; then pad=0; fi
        echo -e "  ${PURPLE}│${RESET} $line$(printf ' %.0s' $(seq 1 $pad)) ${PURPLE}│${RESET}"
    done
    echo -e "  ${PURPLE}╰$(printf '─%.0s' $(seq 1 $width))╯${RESET}"
    echo ""
}

# Progress bar (fake but satisfying)
progress_bar() {
    local label="$1"
    local duration="${2:-3}"
    local width=30
    local steps=$((duration * 5))
    if [ $steps -lt 5 ]; then steps=5; fi

    for ((i=1; i<=steps; i++)); do
        local pct=$((i * 100 / steps))
        local filled=$((i * width / steps))
        local empty=$((width - filled))
        local bar=""
        for ((j=0; j<filled; j++)); do bar+="█"; done
        for ((j=0; j<empty; j++)); do bar+="░"; done
        printf "\r  ${DIM}$label${RESET} ${CYAN}${bar}${RESET}  ${BOLD}%3d%%${RESET}" "$pct"
        sleep 0.05 2>/dev/null || true
    done
    printf "\r  %-$((${#label} + width + 12))s\r" " "
}

# Prompt user for a choice (or auto-select in --auto mode)
prompt_choice() {
    local prompt_text="$1"
    local default="$2"

    if $AUTO_MODE; then
        echo "$default"
        return
    fi

    echo -ne "  ${BOLD}${prompt_text}${RESET} ${DIM}[${default}]:${RESET} "
    local answer
    read -r answer </dev/tty 2>/dev/null || answer=""
    if [ -z "$answer" ]; then
        echo "$default"
    else
        echo "$answer"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 1: Welcome
# ──────────────────────────────────────────────────────────────────
step_welcome() {
    clear 2>/dev/null || true
    echo ""
    {
        echo ""
        echo -e "   ${CYAN}${BOLD}Welcome to TentaCLAW OS v1.0.0${RESET}"
        echo ""
        echo -e "   ${DIM}The AI inference cluster operating system.${RESET}"
        echo -e "   ${DIM}Eight arms. One mind. Zero compromises.${RESET}"
        echo ""
        echo -e "   ${GREEN}Let's get you running in under 60 seconds.${RESET}"
        echo ""
    } | box

    if ! $AUTO_MODE; then
        echo -ne "  ${DIM}Press Enter to begin...${RESET}"
        read -r </dev/tty 2>/dev/null || true
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 2: Auto-detect GPUs
# ──────────────────────────────────────────────────────────────────
step_detect_hardware() {
    echo ""
    echo -e "  ${BOLD}${PURPLE}Step 1/5${RESET}  ${BOLD}Detecting hardware...${RESET}"
    echo ""

    # ── NVIDIA GPUs ──
    if command_exists nvidia-smi; then
        GPU_VENDOR="NVIDIA"

        # Get GPU count
        GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l | tr -d ' ')

        # Get GPU names
        local idx=0
        while IFS= read -r gpu_name; do
            gpu_name=$(echo "$gpu_name" | xargs)  # trim whitespace
            GPU_NAMES+=("$gpu_name")
            idx=$((idx + 1))
        done < <(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null)

        # Get VRAM per GPU (in MB, convert to GB)
        local vram_mb
        vram_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
        if [ -n "$vram_mb" ] && [ "$vram_mb" -gt 0 ] 2>/dev/null; then
            GPU_VRAM_EACH=$((vram_mb / 1024))
            GPU_VRAM_TOTAL=$((GPU_VRAM_EACH * GPU_COUNT))
        fi

        # Display results
        echo -e "  ${GREEN}✓${RESET} Found ${BOLD}${GPU_COUNT}${RESET} GPU(s):"
        for ((i=0; i<GPU_COUNT && i<${#GPU_NAMES[@]}; i++)); do
            echo -e "    ${CYAN}GPU $i:${RESET} ${GPU_NAMES[$i]} ${DIM}(${GPU_VRAM_EACH} GB VRAM)${RESET}"
        done
        echo ""
        echo -e "  ${BOLD}Total cluster VRAM:${RESET} ${GREEN}${GPU_VRAM_TOTAL} GB${RESET}"

    # ── AMD GPUs ──
    elif command_exists rocm-smi; then
        GPU_VENDOR="AMD"
        GPU_COUNT=$(rocm-smi --showid 2>/dev/null | grep -c "GPU" || echo "1")

        echo -e "  ${GREEN}✓${RESET} Found ${BOLD}${GPU_COUNT}${RESET} AMD GPU(s)"
        info "AMD ROCm detected — Ollama or llama.cpp recommended"

    # ── Apple Silicon ──
    elif [[ "${OSTYPE:-}" == "darwin"* ]]; then
        local chip
        chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")
        if echo "$chip" | grep -qi "apple"; then
            GPU_VENDOR="Apple"
            GPU_COUNT=1

            # Get unified memory
            local mem_bytes
            mem_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
            GPU_VRAM_TOTAL=$((mem_bytes / 1073741824))
            GPU_VRAM_EACH=$GPU_VRAM_TOTAL

            echo -e "  ${GREEN}✓${RESET} Apple Silicon detected: ${BOLD}${chip}${RESET}"
            echo -e "    ${DIM}Unified memory: ${GPU_VRAM_TOTAL} GB (shared CPU/GPU)${RESET}"
        else
            echo -e "  ${YELLOW}!${RESET} Intel Mac detected — CPU inference only"
            GPU_VENDOR="none"
        fi

    # ── Check for GPUs via lspci ──
    elif command_exists lspci; then
        local nvidia_pci
        nvidia_pci=$(lspci 2>/dev/null | grep -i "nvidia" | grep -iE "vga|3d|display" || true)
        local amd_pci
        amd_pci=$(lspci 2>/dev/null | grep -iE "amd|radeon" | grep -iE "vga|3d|display" || true)

        if [ -n "$nvidia_pci" ]; then
            GPU_VENDOR="NVIDIA"
            GPU_COUNT=$(echo "$nvidia_pci" | wc -l | tr -d ' ')
            echo -e "  ${GREEN}✓${RESET} Found ${BOLD}${GPU_COUNT}${RESET} NVIDIA GPU(s) via PCI"
            warn "nvidia-smi not found — install NVIDIA drivers for best performance"
        elif [ -n "$amd_pci" ]; then
            GPU_VENDOR="AMD"
            GPU_COUNT=$(echo "$amd_pci" | wc -l | tr -d ' ')
            echo -e "  ${GREEN}✓${RESET} Found ${BOLD}${GPU_COUNT}${RESET} AMD GPU(s) via PCI"
        fi
    fi

    # ── No GPU fallback ──
    if [ "$GPU_COUNT" -eq 0 ] && [ -z "$GPU_VENDOR" ]; then
        GPU_VENDOR="none"
        echo -e "  ${YELLOW}!${RESET} No dedicated GPU detected"
        echo -e "    ${DIM}CPU inference is available (slower but works)${RESET}"
    fi

    # ── Also detect CPU and RAM ──
    echo ""
    local cpu_model=""
    local total_ram=""

    if [[ "${OSTYPE:-}" == "darwin"* ]]; then
        cpu_model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown")
        local ram_bytes
        ram_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
        total_ram="$((ram_bytes / 1073741824)) GB"
    elif [ -f /proc/cpuinfo ]; then
        cpu_model=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "Unknown")
        local ram_kb
        ram_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
        total_ram="$((ram_kb / 1048576)) GB"
    else
        cpu_model="Unknown"
        total_ram="Unknown"
    fi

    echo -e "  ${DIM}CPU:${RESET} $cpu_model"
    echo -e "  ${DIM}RAM:${RESET} $total_ram"
    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Step 3: Choose inference backend
# ──────────────────────────────────────────────────────────────────
step_choose_backend() {
    echo -e "  ${BOLD}${PURPLE}Step 2/5${RESET}  ${BOLD}Choose inference backend${RESET}"
    echo ""

    # Auto-recommend based on hardware
    local recommended="ollama"
    local recommend_reason="easiest, great for GGUF models"

    if [ "$GPU_VENDOR" = "NVIDIA" ] && [ "$GPU_VRAM_TOTAL" -ge 24 ]; then
        recommended="vllm"
        recommend_reason="fastest, best for your ${GPU_VRAM_TOTAL}GB VRAM"
    elif [ "$GPU_VENDOR" = "Apple" ]; then
        recommended="ollama"
        recommend_reason="best Metal acceleration support"
    elif [ "$GPU_VENDOR" = "AMD" ]; then
        recommended="ollama"
        recommend_reason="best ROCm support"
    elif [ "$GPU_VENDOR" = "none" ]; then
        recommended="ollama"
        recommend_reason="works great on CPU"
    fi

    # Apply override if specified
    if [ -n "$BACKEND_OVERRIDE" ]; then
        case "$BACKEND_OVERRIDE" in
            ollama|vllm|llamacpp) recommended="$BACKEND_OVERRIDE" ;;
            *) warn "Unknown backend '$BACKEND_OVERRIDE', using recommendation" ;;
        esac
    fi

    echo -e "  ${GREEN}Recommended:${RESET} ${BOLD}$(echo "$recommended" | tr '[:lower:]' '[:upper:]')${RESET} ${DIM}($recommend_reason)${RESET}"
    echo ""
    echo -e "  ${BOLD}[1]${RESET} Ollama     ${DIM}— easiest, great for GGUF models${RESET}"
    echo -e "  ${BOLD}[2]${RESET} vLLM       ${DIM}— fastest, best for large models (NVIDIA required)${RESET}"
    echo -e "  ${BOLD}[3]${RESET} llama.cpp  ${DIM}— lightweight, CPU+GPU hybrid${RESET}"
    echo -e "  ${BOLD}[4]${RESET} Skip       ${DIM}— I'll set up my own backend${RESET}"
    echo ""

    local default_choice
    case "$recommended" in
        ollama)   default_choice="1" ;;
        vllm)     default_choice="2" ;;
        llamacpp) default_choice="3" ;;
        *)        default_choice="1" ;;
    esac

    local choice
    choice=$(prompt_choice "Choice" "$default_choice")

    case "$choice" in
        1) SELECTED_BACKEND="ollama" ;;
        2) SELECTED_BACKEND="vllm" ;;
        3) SELECTED_BACKEND="llamacpp" ;;
        4) SELECTED_BACKEND="skip" ;;
        *) SELECTED_BACKEND="ollama" ;;
    esac

    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Step 4: Install backend
# ──────────────────────────────────────────────────────────────────
step_install_backend() {
    if [ "$SELECTED_BACKEND" = "skip" ]; then
        info "Skipping backend installation"
        echo ""
        return
    fi

    echo -e "  ${BOLD}${PURPLE}Step 3/5${RESET}  ${BOLD}Installing ${SELECTED_BACKEND}...${RESET}"
    echo ""

    case "$SELECTED_BACKEND" in
        ollama)
            install_ollama
            ;;
        vllm)
            install_vllm
            ;;
        llamacpp)
            install_llamacpp
            ;;
    esac

    echo ""
}

install_ollama() {
    # Check if already installed
    if command_exists ollama; then
        local ver
        ver=$(ollama --version 2>/dev/null | head -1 || echo "unknown")
        ok "Ollama already installed ($ver)"
        ensure_ollama_running
        return
    fi

    progress_bar "Downloading Ollama..." 2

    # Install Ollama
    local install_output
    if [[ "${OSTYPE:-}" == "darwin"* ]]; then
        if command_exists brew; then
            install_output=$(brew install ollama 2>&1) || true
        else
            install_output=$(curl -fsSL https://ollama.com/install.sh | sh 2>&1) || true
        fi
    else
        install_output=$(curl -fsSL https://ollama.com/install.sh | sh 2>&1) || true
    fi

    if command_exists ollama; then
        local ver
        ver=$(ollama --version 2>/dev/null | head -1 || echo "unknown")
        ok "Ollama $ver installed"
        ensure_ollama_running
    else
        fail "Ollama installation failed"
        echo -e "    ${DIM}Try manually: curl -fsSL https://ollama.com/install.sh | sh${RESET}"
        echo -e "    ${DIM}Or visit: https://ollama.com/download${RESET}"
    fi
}

ensure_ollama_running() {
    # Check if Ollama API is already responding
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        return
    fi

    info "Starting Ollama service..."

    if command_exists systemctl; then
        sudo systemctl start ollama 2>/dev/null || {
            ollama serve &>/dev/null &
        }
    elif [[ "${OSTYPE:-}" == "darwin"* ]] && command_exists brew; then
        brew services start ollama &>/dev/null || {
            ollama serve &>/dev/null &
        }
    else
        ollama serve &>/dev/null &
    fi

    # Wait for API to come up
    local retries=15
    while [ $retries -gt 0 ]; do
        if curl -sf http://localhost:11434/api/tags &>/dev/null; then
            ok "Ollama service running"
            return
        fi
        sleep 1
        retries=$((retries - 1))
    done

    warn "Ollama may still be starting — continuing anyway"
}

install_vllm() {
    if command_exists python3 && python3 -c "import vllm" 2>/dev/null; then
        ok "vLLM already installed"
        return
    fi

    if ! command_exists python3; then
        fail "Python 3 required for vLLM"
        info "Install Python 3.10+ and try again"
        SELECTED_BACKEND="skip"
        return
    fi

    if ! command_exists pip3 && ! command_exists pip; then
        fail "pip required for vLLM installation"
        SELECTED_BACKEND="skip"
        return
    fi

    progress_bar "Installing vLLM (this may take a few minutes)..." 5

    local pip_cmd="pip3"
    command_exists pip3 || pip_cmd="pip"

    $pip_cmd install vllm 2>&1 | tail -1 || {
        fail "vLLM installation failed"
        info "Try manually: pip3 install vllm"
        SELECTED_BACKEND="skip"
        return
    }

    if python3 -c "import vllm" 2>/dev/null; then
        ok "vLLM installed"
    else
        fail "vLLM installation may have failed"
    fi
}

install_llamacpp() {
    if command_exists llama-server || command_exists llama-cli; then
        ok "llama.cpp already installed"
        return
    fi

    # Try brew on macOS
    if [[ "${OSTYPE:-}" == "darwin"* ]] && command_exists brew; then
        progress_bar "Installing llama.cpp via Homebrew..." 3
        brew install llama.cpp 2>&1 | tail -1 || {
            fail "llama.cpp installation failed"
            info "Try manually: brew install llama.cpp"
            return
        }
        ok "llama.cpp installed"
        return
    fi

    # Build from source
    if ! command_exists cmake; then
        fail "cmake required to build llama.cpp from source"
        info "Install cmake and try again, or install llama.cpp manually"
        info "  https://github.com/ggerganov/llama.cpp#build"
        SELECTED_BACKEND="skip"
        return
    fi

    progress_bar "Building llama.cpp from source..." 5

    local build_dir="/tmp/llama-cpp-build"
    rm -rf "$build_dir"
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$build_dir" 2>/dev/null || {
        fail "Failed to clone llama.cpp"
        SELECTED_BACKEND="skip"
        return
    }

    (cd "$build_dir" && cmake -B build && cmake --build build --config Release -j "$(nproc 2>/dev/null || echo 4)" 2>&1) | tail -1 || {
        fail "llama.cpp build failed"
        SELECTED_BACKEND="skip"
        return
    }

    # Install binary
    if [ -f "$build_dir/build/bin/llama-server" ]; then
        sudo cp "$build_dir/build/bin/llama-server" /usr/local/bin/ 2>/dev/null || \
            cp "$build_dir/build/bin/llama-server" "$HOME/.local/bin/" 2>/dev/null
        ok "llama.cpp installed"
    else
        fail "llama.cpp binary not found after build"
    fi

    rm -rf "$build_dir"
}

# ──────────────────────────────────────────────────────────────────
# Step 5: Pull a starter model
# ──────────────────────────────────────────────────────────────────
step_pull_model() {
    if $SKIP_MODEL; then
        info "Skipping model download (--skip-model)"
        echo ""
        return
    fi

    if [ "$SELECTED_BACKEND" = "skip" ]; then
        info "No backend installed — skipping model download"
        echo ""
        return
    fi

    # Only Ollama has a built-in model pull mechanism
    if [ "$SELECTED_BACKEND" != "ollama" ]; then
        info "For $SELECTED_BACKEND, download models manually from HuggingFace"
        echo ""
        return
    fi

    echo -e "  ${BOLD}${PURPLE}Step 4/5${RESET}  ${BOLD}Pull a starter model${RESET}"
    echo ""

    # Recommend model based on available VRAM
    local rec_model="llama3.1:8b"
    local rec_size="4.7 GB"

    if [ "$GPU_VRAM_TOTAL" -ge 48 ]; then
        rec_model="llama3.1:8b"
        rec_size="4.7 GB"
    elif [ "$GPU_VRAM_TOTAL" -ge 16 ]; then
        rec_model="llama3.1:8b"
        rec_size="4.7 GB"
    elif [ "$GPU_VRAM_TOTAL" -ge 8 ]; then
        rec_model="qwen2.5:7b"
        rec_size="4.4 GB"
    elif [ "$GPU_VRAM_TOTAL" -ge 4 ]; then
        rec_model="phi3:3.8b"
        rec_size="2.2 GB"
    else
        rec_model="tinyllama"
        rec_size="637 MB"
    fi

    echo -e "  ${GREEN}Recommended for your hardware:${RESET} ${BOLD}${rec_model}${RESET} ${DIM}(${rec_size})${RESET}"
    echo ""
    echo -e "  ${BOLD}[1]${RESET} llama3.1:8b     ${DIM}— 4.7 GB, fast, great quality${RESET}"
    echo -e "  ${BOLD}[2]${RESET} qwen2.5:7b      ${DIM}— 4.4 GB, excellent coding${RESET}"
    echo -e "  ${BOLD}[3]${RESET} phi3:3.8b        ${DIM}— 2.2 GB, small but mighty${RESET}"
    echo -e "  ${BOLD}[4]${RESET} tinyllama        ${DIM}— 637 MB, fastest to download${RESET}"
    echo -e "  ${BOLD}[5]${RESET} Skip             ${DIM}— I'll download models later${RESET}"
    echo ""

    local default_choice="1"
    # Match default to recommendation
    case "$rec_model" in
        llama3.1:8b) default_choice="1" ;;
        qwen2.5:7b)  default_choice="2" ;;
        phi3:3.8b)   default_choice="3" ;;
        tinyllama)   default_choice="4" ;;
    esac

    local choice
    choice=$(prompt_choice "Choice" "$default_choice")

    case "$choice" in
        1) SELECTED_MODEL="llama3.1:8b" ;;
        2) SELECTED_MODEL="qwen2.5:7b" ;;
        3) SELECTED_MODEL="phi3:3.8b" ;;
        4) SELECTED_MODEL="tinyllama" ;;
        5) SELECTED_MODEL="" ;;
        *) SELECTED_MODEL="llama3.1:8b" ;;
    esac

    if [ -z "$SELECTED_MODEL" ]; then
        info "Skipping model download"
        echo ""
        return
    fi

    echo ""
    echo -e "  Pulling ${BOLD}${SELECTED_MODEL}${RESET}..."
    echo ""

    # Check if model already exists
    if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
        ok "$SELECTED_MODEL already downloaded"
        return
    fi

    # Pull with progress
    ollama pull "$SELECTED_MODEL" 2>&1 | while IFS= read -r line; do
        # Show download progress on same line
        if echo "$line" | grep -qE "pulling|downloading|verifying|writing"; then
            printf "\r  ${DIM}%s${RESET}%-20s" "$line" " "
        fi
    done
    echo ""

    if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
        ok "$SELECTED_MODEL ready"
    else
        warn "Model pull may not have completed — try: ollama pull $SELECTED_MODEL"
    fi

    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Step 6: Start services
# ──────────────────────────────────────────────────────────────────
step_start_services() {
    echo -e "  ${BOLD}${PURPLE}Step 5/5${RESET}  ${BOLD}Starting TentaCLAW services...${RESET}"
    echo ""

    local gateway_ok=false
    local agent_ok=false
    local model_ok=false

    # ── Start gateway ──
    if [ -f "$INSTALL_DIR/gateway/package.json" ]; then
        # Check if gateway is already running
        if curl -sf "http://localhost:${GATEWAY_PORT}/api/v1/cluster" &>/dev/null; then
            ok "Gateway already running on port ${GATEWAY_PORT}"
            gateway_ok=true
        else
            # Install deps if needed
            if [ ! -d "$INSTALL_DIR/gateway/node_modules" ]; then
                info "Installing gateway dependencies..."
                (cd "$INSTALL_DIR/gateway" && npm install --silent 2>/dev/null) || true
            fi

            # Start gateway in background
            (cd "$INSTALL_DIR/gateway" && npx tsx src/index.ts &>/dev/null &)
            local gw_pid=$!

            # Wait for gateway to be ready
            local retries=15
            while [ $retries -gt 0 ]; do
                if curl -sf "http://localhost:${GATEWAY_PORT}/api/v1/cluster" &>/dev/null; then
                    gateway_ok=true
                    break
                fi
                sleep 1
                retries=$((retries - 1))
            done

            if $gateway_ok; then
                ok "Gateway started on port ${GATEWAY_PORT}"
            else
                fail "Gateway failed to start (check logs)"
            fi
        fi
    else
        fail "Gateway not found at $INSTALL_DIR/gateway"
    fi

    # ── Start agent ──
    if [ -f "$INSTALL_DIR/agent/package.json" ]; then
        # Install deps if needed
        if [ ! -d "$INSTALL_DIR/agent/node_modules" ]; then
            info "Installing agent dependencies..."
            (cd "$INSTALL_DIR/agent" && npm install --silent 2>/dev/null) || true
        fi

        # Determine agent flags
        local agent_flags=""
        local agent_desc=""

        if [ "$GPU_VENDOR" = "none" ] || [ "$GPU_COUNT" -eq 0 ]; then
            agent_flags="--mock"
            agent_desc="mock mode"
        else
            agent_desc="${GPU_COUNT}x ${GPU_VENDOR} GPU"
        fi

        # Start agent in background
        (cd "$INSTALL_DIR/agent" && npx tsx src/index.ts $agent_flags --gateway "http://localhost:${GATEWAY_PORT}" &>/dev/null &)

        # Give agent a moment to register
        sleep 2

        local hostname
        hostname=$(hostname 2>/dev/null || echo "localhost")
        ok "Agent registered (${hostname}, ${agent_desc})"
        agent_ok=true
    else
        fail "Agent not found at $INSTALL_DIR/agent"
    fi

    # ── Report model status ──
    if [ -n "$SELECTED_MODEL" ] && [ "$SELECTED_BACKEND" = "ollama" ]; then
        if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
            ok "Model ${SELECTED_MODEL} loaded"
            model_ok=true
        fi
    fi

    # ── Dashboard ──
    if $gateway_ok; then
        ok "Dashboard available at ${CYAN}http://localhost:${GATEWAY_PORT}/dashboard${RESET}"
    fi

    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Step 7: First inference + completion
# ──────────────────────────────────────────────────────────────────
step_complete() {
    local elapsed=$(( $(date +%s) - WIZARD_START ))

    # Build endpoint info
    local dashboard_url="http://localhost:${GATEWAY_PORT}/dashboard"
    local api_url="http://localhost:${GATEWAY_PORT}/v1/chat"
    local cli_cmd="clawtopus status"
    local chat_cmd="clawtopus chat \"What can you do?\""

    # Check if CLI is available
    if ! command_exists clawtopus; then
        # Try to make it available
        if [ -f "$INSTALL_DIR/cli/dist/index.js" ]; then
            cli_cmd="node $INSTALL_DIR/cli/dist/index.js status"
            chat_cmd="node $INSTALL_DIR/cli/dist/index.js chat \"What can you do?\""
        elif [ -f "$INSTALL_DIR/cli/src/index.ts" ]; then
            cli_cmd="cd $INSTALL_DIR/cli && npx tsx src/index.ts status"
            chat_cmd="cd $INSTALL_DIR/cli && npx tsx src/index.ts chat \"What can you do?\""
        fi
    fi

    # Timing quip
    local time_quip=""
    if [ "$elapsed" -le 60 ]; then
        time_quip="told you. under 60 seconds."
    elif [ "$elapsed" -le 120 ]; then
        time_quip="okay, ${elapsed} seconds. close enough."
    else
        time_quip="${elapsed} seconds. blame the download speed, not me."
    fi

    {
        echo ""
        echo -e "   ${GREEN}${BOLD}TentaCLAW is running!${RESET}"
        echo ""
        echo -e "   ${BOLD}Dashboard:${RESET}  ${CYAN}${dashboard_url}${RESET}"
        echo -e "   ${BOLD}API:${RESET}        ${CYAN}${api_url}${RESET}"
        echo -e "   ${BOLD}CLI:${RESET}        ${DIM}${cli_cmd}${RESET}"
        echo ""
        echo -e "   ${BOLD}Try it now:${RESET}"
        echo -e "   ${CYAN}\$ ${chat_cmd}${RESET}"
        echo ""
        echo -e "   ${DIM}\"${time_quip}\"${RESET}"
        echo ""
    } | box

    # Try to open dashboard in browser
    if command_exists xdg-open; then
        xdg-open "$dashboard_url" 2>/dev/null &
    elif command_exists open; then
        open "$dashboard_url" 2>/dev/null &
    fi

    echo -e "  ${DIM}Setup took ${elapsed} seconds.${RESET}"
    echo -e "  ${DIM}Docs: https://tentaclaw.io/docs${RESET}"
    echo -e "  ${DIM}GitHub: https://github.com/TentaCLAW-OS/TentaCLAW${RESET}"
    echo ""
}

# ══════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════
main() {
    step_welcome
    step_detect_hardware
    step_choose_backend
    step_install_backend
    step_pull_model
    step_start_services
    step_complete
}

main "$@"
