#!/bin/bash
# TentaCLAW OS — Ollama Installer
# Installs Ollama with GPU auto-detection on any Linux distro or macOS.
# Used by the TentaCLAW agent on first boot, or run standalone.
#
# Usage: ./install-ollama.sh [OPTIONS]
#
# Options:
#   --test             Pull a small model (tinyllama) and run a test prompt
#   --model MODEL      Pull a specific model after install (e.g., llama3.2:3b)
#   --force            Reinstall even if Ollama is already present
#   --no-start         Install but don't start the Ollama service
#   --help, -h         Show this help message

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Brand colors
# ──────────────────────────────────────────────────────────────────
TEAL='\033[38;2;0;212;170m'
PURPLE='\033[38;2;139;92;246m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
YELLOW='\033[38;2;255;200;50m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ──────────────────────────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────────────────────────
RUN_TEST=false
PULL_MODEL=""
FORCE=false
NO_START=false
GPU_VENDOR=""
GPU_COUNT=0

# ──────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --test)
            RUN_TEST=true
            shift
            ;;
        --model)
            PULL_MODEL="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --no-start)
            NO_START=true
            shift
            ;;
        --help|-h)
            echo "TentaCLAW OS — Ollama Installer"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --test          Pull tinyllama and run a test inference"
            echo "  --model MODEL   Pull a specific model after install"
            echo "  --force         Reinstall even if Ollama is present"
            echo "  --no-start      Don't start the Ollama service"
            echo "  --help, -h      Show this help"
            echo ""
            echo "Examples:"
            echo "  $0                          # Install Ollama"
            echo "  $0 --test                   # Install + test with tinyllama"
            echo "  $0 --model llama3.2:3b      # Install + pull llama3.2:3b"
            echo "  $0 --force --test           # Reinstall + test"
            exit 0
            ;;
        *)
            echo "Unknown option: $1 (use --help for usage)"
            exit 1
            ;;
    esac
done

# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────
step()    { echo -e "  ${DIM}[ ]${RESET} $1"; }
ok()      { echo -e "\033[1A  ${GREEN}[+]${RESET} $1"; }
fail()    { echo -e "\033[1A  ${RED}[x]${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}[!]${RESET} $1"; }
info()    { echo -e "  ${DIM}[i]${RESET} $1"; }

command_exists() { command -v "$1" &>/dev/null; }

die() {
    echo -e "\n  ${RED}${BOLD}Error:${RESET} $1\n"
    exit 1
}

# ──────────────────────────────────────────────────────────────────
# Banner
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${TEAL}${BOLD}  TentaCLAW OS — Ollama Installer${RESET}"
echo -e "${DIM}  GPU-accelerated inference backend${RESET}"
echo ""

# ──────────────────────────────────────────────────────────────────
# Step 1: Detect GPU vendor
# ──────────────────────────────────────────────────────────────────
detect_gpu() {
    step "Detecting GPU hardware..."

    # Check for NVIDIA
    if command_exists nvidia-smi; then
        GPU_VENDOR="nvidia"
        GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
        local gpu_names
        gpu_names=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -3 | tr '\n' ', ' | sed 's/, $//')
        ok "$GPU_COUNT NVIDIA GPU(s) detected: $gpu_names"

        # Check CUDA driver version
        local driver_ver
        driver_ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
        if [ -n "$driver_ver" ]; then
            info "NVIDIA driver version: $driver_ver"
        fi
        return
    fi

    # Check for NVIDIA via lspci (driver not installed yet)
    if command_exists lspci; then
        local nvidia_pci
        nvidia_pci=$(lspci 2>/dev/null | grep -i nvidia | head -5)
        if [ -n "$nvidia_pci" ]; then
            GPU_VENDOR="nvidia"
            GPU_COUNT=$(echo "$nvidia_pci" | grep -ci "vga\|3d\|display")
            if [ "$GPU_COUNT" -eq 0 ]; then GPU_COUNT=1; fi
            ok "NVIDIA GPU detected via PCI (driver may need install)"
            info "$nvidia_pci"
            warn "nvidia-smi not found. Install NVIDIA drivers for best performance."
            warn "  Ubuntu/Debian: sudo apt install nvidia-driver-550"
            warn "  Fedora:        sudo dnf install akmod-nvidia"
            warn "  Arch:          sudo pacman -S nvidia"
            return
        fi
    fi

    # Check for AMD GPUs
    if command_exists lspci; then
        local amd_pci
        amd_pci=$(lspci 2>/dev/null | grep -iE "amd|radeon" | grep -iE "vga|3d|display" | head -5)
        if [ -n "$amd_pci" ]; then
            GPU_VENDOR="amd"
            GPU_COUNT=$(echo "$amd_pci" | wc -l)
            ok "$GPU_COUNT AMD GPU(s) detected"
            info "$amd_pci"
            return
        fi
    fi

    # Check AMD via sysfs
    if [ -d /sys/class/drm ]; then
        local amd_drm
        amd_drm=$(find /sys/class/drm -name "gpu_busy_percent" 2>/dev/null | wc -l)
        if [ "$amd_drm" -gt 0 ]; then
            GPU_VENDOR="amd"
            GPU_COUNT=$amd_drm
            ok "$GPU_COUNT AMD GPU(s) detected via sysfs"
            return
        fi
    fi

    # macOS: Apple Silicon
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local chip
        chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")
        if echo "$chip" | grep -qi "apple"; then
            GPU_VENDOR="apple"
            GPU_COUNT=1
            ok "Apple Silicon detected ($chip) — Metal acceleration"
            return
        fi
    fi

    # No GPU found
    GPU_VENDOR="none"
    GPU_COUNT=0
    ok "No dedicated GPU detected — CPU-only inference"
    warn "Inference will be slower without a GPU."
}

# ──────────────────────────────────────────────────────────────────
# Step 2: Check existing Ollama installation
# ──────────────────────────────────────────────────────────────────
check_existing() {
    step "Checking for existing Ollama installation..."

    if command_exists ollama; then
        local ver
        ver=$(ollama --version 2>/dev/null | head -1)
        if $FORCE; then
            ok "Ollama found ($ver) — will reinstall (--force)"
        else
            ok "Ollama already installed ($ver)"
            info "Use --force to reinstall"
            ALREADY_INSTALLED=true
            return
        fi
    else
        ok "No existing installation found"
    fi
    ALREADY_INSTALLED=false
}

# ──────────────────────────────────────────────────────────────────
# Step 3: Install Ollama
# ──────────────────────────────────────────────────────────────────
install_ollama() {
    if [ "${ALREADY_INSTALLED:-false}" = "true" ]; then
        return
    fi

    step "Installing Ollama..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: use brew if available, otherwise direct download
        if command_exists brew; then
            brew install ollama >/dev/null 2>&1 || {
                fail "Homebrew install failed, trying direct download..."
                curl -fsSL https://ollama.com/install.sh | sh 2>&1 | tail -1
            }
        else
            curl -fsSL https://ollama.com/install.sh | sh 2>&1 | tail -1
        fi
    else
        # Linux: use official installer
        curl -fsSL https://ollama.com/install.sh | sh 2>&1 | tail -1
    fi

    if command_exists ollama; then
        ok "Ollama $(ollama --version 2>/dev/null | head -1) installed"
    else
        fail "Ollama installation failed"
        die "Could not install Ollama. Try manually: https://ollama.com/download"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 4: Configure AMD ROCm (if AMD GPU)
# ──────────────────────────────────────────────────────────────────
configure_amd() {
    if [ "$GPU_VENDOR" != "amd" ]; then return; fi

    step "Configuring AMD ROCm environment..."

    local rocm_configured=false

    # Check if ROCm is installed
    if [ -d /opt/rocm ]; then
        info "ROCm installation found at /opt/rocm"
        rocm_configured=true
    fi

    # Set environment variables for Ollama with AMD
    local ollama_env_file="/etc/environment.d/ollama-rocm.conf"
    local env_content=""

    # HSA_OVERRIDE_GFX_VERSION may be needed for some AMD GPUs
    # Detect GPU architecture
    if command_exists rocminfo; then
        local gfx_ver
        gfx_ver=$(rocminfo 2>/dev/null | grep "Name:" | grep "gfx" | head -1 | awk '{print $2}')
        if [ -n "$gfx_ver" ]; then
            info "ROCm GPU architecture: $gfx_ver"
        fi
    fi

    # Create systemd environment override for Ollama
    if command_exists systemctl && [ -d /etc/systemd/system ]; then
        local override_dir="/etc/systemd/system/ollama.service.d"
        sudo mkdir -p "$override_dir" 2>/dev/null || true

        sudo tee "$override_dir/amd-rocm.conf" >/dev/null 2>&1 << ROCM_CONF || true
[Service]
Environment="HSA_ENABLE_SDMA=0"
ROCM_CONF

        # HSA_ENABLE_SDMA=0 fixes issues on many AMD GPUs
        sudo systemctl daemon-reload 2>/dev/null || true
    fi

    # Also set for current shell session
    export HSA_ENABLE_SDMA=0

    if $rocm_configured; then
        ok "AMD ROCm environment configured"
    else
        ok "AMD GPU environment prepared"
        warn "ROCm not found. Install ROCm for best AMD GPU performance:"
        warn "  https://rocm.docs.amd.com/projects/install-on-linux/en/latest/"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 5: Start Ollama service
# ──────────────────────────────────────────────────────────────────
start_ollama() {
    if $NO_START; then
        info "Skipping service start (--no-start)"
        return
    fi

    step "Starting Ollama service..."

    if command_exists systemctl; then
        # Linux with systemd
        sudo systemctl enable ollama >/dev/null 2>&1 || true
        sudo systemctl restart ollama >/dev/null 2>&1 || {
            # Fallback: start in background
            warn "systemctl failed, starting Ollama in background..."
            ollama serve &>/dev/null &
            sleep 2
        }
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: start with brew services or direct
        if command_exists brew; then
            brew services start ollama >/dev/null 2>&1 || {
                ollama serve &>/dev/null &
                sleep 2
            }
        else
            ollama serve &>/dev/null &
            sleep 2
        fi
    else
        # Fallback: start directly
        ollama serve &>/dev/null &
        sleep 2
    fi

    # Wait for Ollama to be ready
    local retries=10
    local ready=false
    while [ $retries -gt 0 ]; do
        if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
            ready=true
            break
        fi
        sleep 1
        retries=$((retries - 1))
    done

    if $ready; then
        ok "Ollama service is running"
    else
        fail "Ollama service may not be ready"
        warn "Try manually: ollama serve"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 6: Verify installation
# ──────────────────────────────────────────────────────────────────
verify_install() {
    step "Verifying Ollama installation..."

    if ! command_exists ollama; then
        fail "Ollama binary not found in PATH"
        die "Installation may have failed. Check the output above."
    fi

    local ver
    ver=$(ollama --version 2>/dev/null | head -1)
    ok "Ollama $ver verified"

    # Show GPU detection from Ollama's perspective
    info "Checking Ollama GPU detection..."
    local ollama_gpu_info
    if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        info "Ollama API responding at http://localhost:11434"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 7: Pull test model (optional)
# ──────────────────────────────────────────────────────────────────
pull_test_model() {
    if ! $RUN_TEST && [ -z "$PULL_MODEL" ]; then return; fi

    local model_name=""

    if [ -n "$PULL_MODEL" ]; then
        model_name="$PULL_MODEL"
    elif $RUN_TEST; then
        model_name="tinyllama"
    fi

    if [ -z "$model_name" ]; then return; fi

    step "Pulling model: $model_name..."

    ollama pull "$model_name" 2>&1 | while IFS= read -r line; do
        # Show progress on same line
        printf "\r  ${DIM}[i]${RESET} %s" "$line"
    done
    echo ""  # newline after progress

    if ollama list 2>/dev/null | grep -q "$model_name"; then
        ok "Model $model_name pulled successfully"
    else
        fail "Model $model_name may not have been pulled correctly"
        warn "Try manually: ollama pull $model_name"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Step 8: Run test inference (optional)
# ──────────────────────────────────────────────────────────────────
run_test_inference() {
    if ! $RUN_TEST; then return; fi

    step "Running test inference..."

    local test_model="tinyllama"
    local test_prompt="Say hello in exactly 5 words."

    local response
    response=$(curl -sf http://localhost:11434/api/generate \
        -d "{\"model\": \"$test_model\", \"prompt\": \"$test_prompt\", \"stream\": false}" \
        2>/dev/null | grep -o '"response":"[^"]*"' | head -1 | sed 's/"response":"//;s/"$//')

    if [ -n "$response" ]; then
        ok "Test inference successful"
        echo ""
        echo -e "  ${PURPLE}${BOLD}  Prompt:${RESET}   $test_prompt"
        echo -e "  ${TEAL}${BOLD}  Response:${RESET} $response"
        echo ""
    else
        fail "Test inference returned no response"
        warn "Ollama may still be loading the model. Try:"
        warn "  ollama run tinyllama \"Hello\""
    fi
}

# ──────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${TEAL}${BOLD}  ════════════════════════════════════════${RESET}"
    echo -e "${TEAL}${BOLD}    Ollama setup complete!${RESET}"
    echo -e "${TEAL}${BOLD}  ════════════════════════════════════════${RESET}"
    echo ""
    echo -e "  ${BOLD}GPU:${RESET}      ${GPU_VENDOR:-none} (${GPU_COUNT} device(s))"
    echo -e "  ${BOLD}Version:${RESET}  $(ollama --version 2>/dev/null | head -1)"
    echo -e "  ${BOLD}API:${RESET}      http://localhost:11434"
    echo ""

    # Show installed models
    local models
    models=$(ollama list 2>/dev/null | tail -n +2)
    if [ -n "$models" ]; then
        echo -e "  ${BOLD}Installed models:${RESET}"
        echo "$models" | while IFS= read -r line; do
            echo -e "    ${GREEN}+${RESET} $line"
        done
        echo ""
    else
        echo -e "  ${DIM}No models installed yet.${RESET}"
        echo -e "  ${DIM}Pull one with: ollama pull llama3.2:3b${RESET}"
        echo ""
    fi

    echo -e "  ${BOLD}Recommended models for TentaCLAW:${RESET}"
    echo -e "    ${DIM}Small  (2-4 GB):${RESET}  ollama pull tinyllama"
    echo -e "    ${DIM}Medium (4-8 GB):${RESET}  ollama pull llama3.2:3b"
    echo -e "    ${DIM}Large  (8+ GB):${RESET}   ollama pull llama3.1:8b"
    echo -e "    ${DIM}Code:${RESET}             ollama pull codellama:7b"
    echo ""
    echo -e "  ${DIM}The TentaCLAW agent will auto-detect available models.${RESET}"
    echo ""
}

# ══════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════
main() {
    detect_gpu
    echo ""
    check_existing
    install_ollama
    configure_amd
    echo ""
    start_ollama
    verify_install
    echo ""
    pull_test_model
    run_test_inference
    print_summary
}

main "$@"
