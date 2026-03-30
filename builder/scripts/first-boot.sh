#!/bin/bash
# =============================================================================
# TentaCLAW OS — First Boot Configuration
# =============================================================================
# Runs once when a node boots from the ISO for the first time.
# Detects hardware, installs drivers, sets up inference backends,
# configures networking, and starts the TentaCLAW agent.
#
# This script is idempotent — safe to re-run if interrupted.
#
# Usage:
#   first-boot.sh                # Full first-boot sequence
#   first-boot.sh --step <name>  # Run a single step
#   first-boot.sh --dry-run      # Show what would happen without changes
#
# Steps (in order):
#   1. detect-gpu       — Detect GPU hardware
#   2. install-drivers  — Install appropriate GPU drivers
#   3. install-backend  — Install inference backend (Ollama or BitNet)
#   4. configure-net    — Configure networking and mDNS
#   5. start-agent      — Create config and start TentaCLAW agent
#   6. boot-summary     — Print summary with CLAWtopus art
#
# CLAWtopus says: "First boot? Let's make this tentacular."
# =============================================================================

set -euo pipefail

# =============================================================================
# Constants & Globals
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TENTACLAW_CONF_DIR="/etc/tentaclaw"
TENTACLAW_RIG_CONF="${TENTACLAW_CONF_DIR}/rig.conf"
TENTACLAW_LOG_DIR="/var/log/tentaclaw"
TENTACLAW_FIRST_BOOT_MARKER="/var/lib/tentaclaw/.first-boot-complete"
BITNET_INSTALL_DIR="/opt/bitnet"
VERSION="1.0.0"
DRY_RUN=false

# Detected hardware (populated during step 1)
GPU_VENDOR="none"
GPU_JSON=""
GPU_COUNT=0
GPU_DRIVER_INSTALLED=false
RECOMMENDED_BACKEND="bitnet"
TOTAL_VRAM_MB=0

# =============================================================================
# Colors — TentaCLAW brand palette
# =============================================================================

CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
ORANGE='\x1b[38;2;255;165;0m'
RESET='\x1b[0m'
BOLD='\x1b[1m'
DIM='\x1b[2m'

# =============================================================================
# Logging & Output
# =============================================================================

# Timestamp for log entries
_ts() {
    date '+%Y-%m-%d %H:%M:%S'
}

log() {
    echo -e "  ${CYAN}$(_ts)${RESET}  ${CYAN}INFO${RESET}   $*"
}

success() {
    echo -e "  ${CYAN}$(_ts)${RESET}  ${GREEN} OK ${RESET}   $*"
}

warn() {
    echo -e "  ${CYAN}$(_ts)${RESET}  ${YELLOW}WARN${RESET}   $*" >&2
}

error() {
    echo -e "  ${CYAN}$(_ts)${RESET}  ${RED}FAIL${RESET}   $*" >&2
}

fatal() {
    error "$@"
    echo -e "  ${RED}First boot aborted. Check logs at ${TENTACLAW_LOG_DIR}/first-boot.log${RESET}" >&2
    exit 1
}

# Section header with step number
section() {
    local step_num="$1"
    local title="$2"
    echo ""
    echo -e "  ${BOLD}${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "  ${BOLD}${CYAN}  Step ${step_num}${WHITE} — ${title}${RESET}"
    echo -e "  ${BOLD}${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
}

# Run a command, or show what would run in dry-run mode
run_cmd() {
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "  ${DIM}[dry-run] $*${RESET}"
        return 0
    fi
    "$@"
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_root() {
    if [[ "$EUID" -ne 0 ]]; then
        echo -e "${RED}Error: first-boot.sh must be run as root.${RESET}" >&2
        echo -e "${DIM}Try: sudo $0${RESET}" >&2
        exit 1
    fi
}

check_prerequisites() {
    log "Checking prerequisites..."

    # Ensure critical directories exist
    run_cmd mkdir -p "$TENTACLAW_CONF_DIR"
    run_cmd mkdir -p "$TENTACLAW_LOG_DIR"
    run_cmd mkdir -p "$(dirname "$TENTACLAW_FIRST_BOOT_MARKER")"

    # Check if already completed
    if [[ -f "$TENTACLAW_FIRST_BOOT_MARKER" ]]; then
        warn "First boot already completed on $(cat "$TENTACLAW_FIRST_BOOT_MARKER")"
        warn "Re-running anyway. Remove ${TENTACLAW_FIRST_BOOT_MARKER} to suppress this warning."
    fi

    # Verify we have basic tools
    local missing=()
    for cmd in ip hostname systemctl; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        fatal "Missing required commands: ${missing[*]}"
    fi

    success "Prerequisites OK"
}

# =============================================================================
# Step 1: GPU Detection
# =============================================================================

step_detect_gpu() {
    section "1/6" "GPU Hardware Detection"

    log "Scanning PCI bus for GPU hardware..."

    # --- NVIDIA ---
    local nvidia_found=false
    local nvidia_info
    nvidia_info=$(lspci 2>/dev/null | grep -i nvidia || true)
    if [[ -n "$nvidia_info" ]]; then
        nvidia_found=true
        success "NVIDIA GPU(s) detected:"
        echo "$nvidia_info" | while IFS= read -r line; do
            echo -e "    ${WHITE}${line}${RESET}"
        done
    fi

    # --- AMD ---
    local amd_found=false
    local amd_info
    amd_info=$(lspci 2>/dev/null | grep -i amd | grep -iE "VGA|Display|3D" || true)
    if [[ -n "$amd_info" ]]; then
        amd_found=true
        success "AMD GPU(s) detected:"
        echo "$amd_info" | while IFS= read -r line; do
            echo -e "    ${WHITE}${line}${RESET}"
        done
    fi

    # --- Intel Arc ---
    local intel_found=false
    local intel_info
    intel_info=$(lspci 2>/dev/null | grep -iE "Intel.*(Arc|DG[12])" || true)
    if [[ -n "$intel_info" ]]; then
        intel_found=true
        success "Intel Arc GPU(s) detected:"
        echo "$intel_info" | while IFS= read -r line; do
            echo -e "    ${WHITE}${line}${RESET}"
        done
    fi

    # --- Determine primary vendor (priority: NVIDIA > AMD > Intel) ---
    if [[ "$nvidia_found" == true ]]; then
        GPU_VENDOR="nvidia"
    elif [[ "$amd_found" == true ]]; then
        GPU_VENDOR="amd"
    elif [[ "$intel_found" == true ]]; then
        GPU_VENDOR="intel"
    else
        GPU_VENDOR="none"
    fi

    # --- Run the full JSON detection script if available ---
    local detect_script="${SCRIPT_DIR}/detect-gpu.sh"
    if [[ -x "$detect_script" ]]; then
        log "Running detailed GPU detection..."
        GPU_JSON=$("$detect_script" 2>/dev/null || echo '{"vendor":"none","gpus":[],"driver_installed":false,"recommended_backend":"bitnet","total_vram_mb":0}')

        # Parse JSON fields using lightweight methods
        if command -v python3 &>/dev/null; then
            GPU_VENDOR=$(echo "$GPU_JSON" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['vendor'])" 2>/dev/null || echo "$GPU_VENDOR")
            GPU_COUNT=$(echo "$GPU_JSON" | python3 -c "import json,sys; print(len(json.loads(sys.stdin.read())['gpus']))" 2>/dev/null || echo 0)
            GPU_DRIVER_INSTALLED=$(echo "$GPU_JSON" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('true' if d['driver_installed'] else 'false')" 2>/dev/null || echo "false")
            RECOMMENDED_BACKEND=$(echo "$GPU_JSON" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['recommended_backend'])" 2>/dev/null || echo "bitnet")
            TOTAL_VRAM_MB=$(echo "$GPU_JSON" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('total_vram_mb',0))" 2>/dev/null || echo 0)
        fi
    else
        warn "detect-gpu.sh not found at ${detect_script} — using basic detection"
    fi

    # --- Print detection summary ---
    echo ""
    case "$GPU_VENDOR" in
        nvidia)
            success "Primary vendor: ${BOLD}NVIDIA${RESET}"
            log "GPU count: ${GPU_COUNT}, Total VRAM: ${TOTAL_VRAM_MB} MB"
            log "Recommended backend: ${RECOMMENDED_BACKEND}"
            ;;
        amd)
            success "Primary vendor: ${BOLD}AMD${RESET}"
            log "GPU count: ${GPU_COUNT}, Total VRAM: ${TOTAL_VRAM_MB} MB"
            log "Recommended backend: ${RECOMMENDED_BACKEND}"
            ;;
        intel)
            success "Primary vendor: ${BOLD}Intel Arc${RESET}"
            log "GPU count: ${GPU_COUNT}"
            log "Recommended backend: ${RECOMMENDED_BACKEND}"
            ;;
        none)
            warn "No GPU detected — this node will run in CPU-only mode"
            log "Recommended backend: ${BOLD}BitNet${RESET} (1-bit LLM, CPU-optimized)"
            RECOMMENDED_BACKEND="bitnet"
            ;;
    esac
}

# =============================================================================
# Step 2: Driver Installation
# =============================================================================

step_install_drivers() {
    section "2/6" "GPU Driver Installation"

    case "$GPU_VENDOR" in
        nvidia)
            install_nvidia_drivers
            ;;
        amd)
            install_amd_drivers
            ;;
        intel)
            install_intel_drivers
            ;;
        none)
            log "No GPU detected — skipping driver installation"
            success "CPU-only mode — no drivers needed"
            ;;
    esac
}

install_nvidia_drivers() {
    log "Installing NVIDIA drivers and CUDA toolkit..."

    # Check if drivers are already installed
    if [[ "$GPU_DRIVER_INSTALLED" == "true" ]]; then
        success "NVIDIA drivers already installed"
        if command -v nvidia-smi &>/dev/null; then
            log "Driver version: $(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo 'unknown')"
        fi
        return 0
    fi

    # Detect package manager
    if command -v apt-get &>/dev/null; then
        # Debian/Ubuntu path
        log "Detected apt-based system"

        # Add NVIDIA package repository
        run_cmd apt-get update -qq

        # Install NVIDIA driver and CUDA toolkit
        # nvidia-driver handles kernel module + userspace
        # cuda-toolkit provides CUDA runtime for inference
        log "Installing nvidia-driver and cuda-toolkit (this may take several minutes)..."
        run_cmd apt-get install -y --no-install-recommends \
            nvidia-driver \
            nvidia-cuda-toolkit \
            nvidia-utils-* 2>/dev/null || {
                warn "Standard nvidia-driver package failed, trying nvidia-driver-535..."
                run_cmd apt-get install -y --no-install-recommends \
                    nvidia-driver-535 \
                    nvidia-cuda-toolkit || {
                        error "NVIDIA driver installation failed"
                        warn "You may need to install drivers manually"
                        return 1
                    }
            }

        success "NVIDIA drivers installed"

    elif command -v dnf &>/dev/null; then
        # Fedora/RHEL path
        log "Detected dnf-based system"
        run_cmd dnf install -y nvidia-driver cuda-toolkit || {
            error "NVIDIA driver installation failed via dnf"
            return 1
        }
        success "NVIDIA drivers installed"

    elif command -v pacman &>/dev/null; then
        # Arch path
        log "Detected pacman-based system"
        run_cmd pacman -S --noconfirm nvidia nvidia-utils cuda || {
            error "NVIDIA driver installation failed via pacman"
            return 1
        }
        success "NVIDIA drivers installed"

    else
        warn "Unsupported package manager — cannot auto-install NVIDIA drivers"
        warn "Please install NVIDIA drivers manually"
        return 1
    fi

    # Load the kernel module
    log "Loading NVIDIA kernel module..."
    run_cmd modprobe nvidia 2>/dev/null || warn "Could not load nvidia module (may need reboot)"

    # Apply TentaCLAW nvidia.conf settings if available
    local nvidia_conf="${SCRIPT_DIR}/../config/etc/modprobe.d/nvidia.conf"
    if [[ -f "$nvidia_conf" ]]; then
        log "Applying TentaCLAW NVIDIA module parameters..."
        run_cmd cp "$nvidia_conf" /etc/modprobe.d/tentaclaw-nvidia.conf
        success "NVIDIA modprobe config applied"
    fi
}

install_amd_drivers() {
    log "Installing AMD GPU drivers..."

    # Check if amdgpu is already loaded
    if lsmod 2>/dev/null | grep -q "^amdgpu "; then
        success "amdgpu driver already loaded"
    fi

    if command -v apt-get &>/dev/null; then
        log "Detected apt-based system"

        # Install base amdgpu firmware and mesa drivers
        run_cmd apt-get update -qq
        run_cmd apt-get install -y --no-install-recommends \
            firmware-amd-graphics \
            libdrm-amdgpu1 \
            mesa-vulkan-drivers || {
                warn "AMD base driver installation had issues"
            }

        # Check for RDNA2+ and offer ROCm
        # RDNA2 = gfx1030+, RDNA3 = gfx1100+
        local gpu_gen
        gpu_gen=$(cat /sys/class/drm/card*/device/gpu_id 2>/dev/null | head -1 || echo "")

        log "Checking for ROCm compatibility (RDNA2+ recommended)..."

        # ROCm is beneficial for ML inference on AMD
        run_cmd apt-get install -y --no-install-recommends \
            rocm-libs rocm-dev 2>/dev/null || {
                warn "ROCm installation not available — base amdgpu driver only"
                warn "For ROCm support, see: https://rocm.docs.amd.com"
            }

        success "AMD drivers installed"

    elif command -v dnf &>/dev/null; then
        log "Detected dnf-based system"
        run_cmd dnf install -y mesa-dri-drivers mesa-vulkan-drivers || true
        success "AMD drivers installed"

    elif command -v pacman &>/dev/null; then
        log "Detected pacman-based system"
        run_cmd pacman -S --noconfirm mesa vulkan-radeon libva-mesa-driver || true
        success "AMD drivers installed"

    else
        warn "Unsupported package manager — relying on kernel's built-in amdgpu"
    fi

    # Ensure kernel module is loaded
    run_cmd modprobe amdgpu 2>/dev/null || warn "Could not load amdgpu module"
}

install_intel_drivers() {
    log "Installing Intel Arc GPU drivers..."

    if command -v apt-get &>/dev/null; then
        log "Detected apt-based system"
        run_cmd apt-get update -qq

        # Intel Arc uses the i915 (older) or xe (newer) kernel driver
        # Userspace needs intel-media-va-driver and level-zero for compute
        run_cmd apt-get install -y --no-install-recommends \
            intel-media-va-driver-non-free \
            intel-gpu-tools \
            level-zero \
            intel-opencl-icd 2>/dev/null || {
                warn "Some Intel GPU packages not available — using kernel defaults"
            }

        success "Intel Arc drivers installed"

    elif command -v dnf &>/dev/null; then
        log "Detected dnf-based system"
        run_cmd dnf install -y intel-media-driver level-zero intel-compute-runtime || true
        success "Intel Arc drivers installed"

    elif command -v pacman &>/dev/null; then
        log "Detected pacman-based system"
        run_cmd pacman -S --noconfirm intel-media-driver level-zero-loader intel-compute-runtime || true
        success "Intel Arc drivers installed"

    else
        warn "Unsupported package manager — relying on kernel's built-in i915/xe driver"
    fi

    # Ensure kernel module is loaded
    run_cmd modprobe xe 2>/dev/null || run_cmd modprobe i915 2>/dev/null || warn "Could not load Intel GPU module"
}

# =============================================================================
# Step 3: Inference Backend Installation
# =============================================================================

step_install_backend() {
    section "3/6" "Inference Backend Installation"

    case "$RECOMMENDED_BACKEND" in
        ollama)
            install_ollama
            ;;
        bitnet)
            install_bitnet
            ;;
        *)
            warn "Unknown backend: ${RECOMMENDED_BACKEND} — defaulting to Ollama"
            install_ollama
            ;;
    esac
}

install_ollama() {
    log "Installing Ollama (GPU-accelerated inference)..."

    # Check if already installed
    if command -v ollama &>/dev/null; then
        local ollama_version
        ollama_version=$(ollama --version 2>/dev/null || echo "unknown")
        success "Ollama already installed: ${ollama_version}"
    else
        # Install via official installer script
        log "Downloading Ollama installer..."
        if [[ "$DRY_RUN" == true ]]; then
            echo -e "  ${DIM}[dry-run] curl -fsSL https://ollama.com/install.sh | sh${RESET}"
        else
            curl -fsSL https://ollama.com/install.sh | sh || {
                error "Ollama installation failed"
                warn "Trying manual installation..."

                # Fallback: download binary directly
                local arch
                arch=$(uname -m)
                case "$arch" in
                    x86_64)  arch="amd64" ;;
                    aarch64) arch="arm64" ;;
                esac

                curl -fsSL "https://ollama.com/download/ollama-linux-${arch}" -o /usr/local/bin/ollama || {
                    fatal "Could not install Ollama"
                }
                chmod +x /usr/local/bin/ollama
            }
        fi
        success "Ollama installed"
    fi

    # Enable and start Ollama service
    log "Enabling Ollama service..."
    if systemctl list-unit-files 2>/dev/null | grep -q ollama; then
        run_cmd systemctl enable ollama.service
        run_cmd systemctl start ollama.service
        success "Ollama service started"
    else
        # Create a systemd service if the installer didn't
        log "Creating Ollama systemd service..."
        run_cmd tee /etc/systemd/system/ollama.service > /dev/null << 'UNIT'
[Unit]
Description=Ollama — Local LLM Inference Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ollama serve
Restart=on-failure
RestartSec=5
Environment="OLLAMA_HOST=0.0.0.0"
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ollama

[Install]
WantedBy=multi-user.target
UNIT
        run_cmd systemctl daemon-reload
        run_cmd systemctl enable ollama.service
        run_cmd systemctl start ollama.service
        success "Ollama service created and started"
    fi

    # Wait for Ollama to be ready
    log "Waiting for Ollama to be ready..."
    local retries=0
    while [[ $retries -lt 30 ]]; do
        if curl -sf http://localhost:11434/api/tags &>/dev/null; then
            success "Ollama is ready and listening on port 11434"
            return 0
        fi
        retries=$((retries + 1))
        sleep 1
    done

    warn "Ollama may not be fully ready yet — it will start after reboot"
}

install_bitnet() {
    log "Installing BitNet (CPU-optimized 1-bit LLM inference)..."

    # Check if already installed
    if [[ -d "$BITNET_INSTALL_DIR" && -f "${BITNET_INSTALL_DIR}/build/bin/llama-cli" ]]; then
        success "BitNet already installed at ${BITNET_INSTALL_DIR}"
        return 0
    fi

    # Install build dependencies
    log "Installing build dependencies..."
    if command -v apt-get &>/dev/null; then
        run_cmd apt-get update -qq
        run_cmd apt-get install -y --no-install-recommends \
            git cmake build-essential python3 python3-pip || {
                fatal "Could not install build dependencies for BitNet"
            }
    elif command -v dnf &>/dev/null; then
        run_cmd dnf install -y git cmake gcc-c++ python3 python3-pip
    elif command -v pacman &>/dev/null; then
        run_cmd pacman -S --noconfirm git cmake base-devel python python-pip
    fi

    # Clone and build BitNet
    log "Cloning BitNet repository..."
    run_cmd mkdir -p "$BITNET_INSTALL_DIR"
    if [[ ! -d "${BITNET_INSTALL_DIR}/.git" ]]; then
        run_cmd git clone https://github.com/microsoft/BitNet.git "$BITNET_INSTALL_DIR" || {
            fatal "Could not clone BitNet repository"
        }
    else
        log "BitNet repo already cloned, pulling latest..."
        run_cmd git -C "$BITNET_INSTALL_DIR" pull --ff-only || true
    fi

    # Build BitNet
    log "Building BitNet (this may take several minutes)..."
    run_cmd mkdir -p "${BITNET_INSTALL_DIR}/build"
    (
        cd "${BITNET_INSTALL_DIR}/build"
        run_cmd cmake .. \
            -DCMAKE_BUILD_TYPE=Release \
            -DGGML_NATIVE=ON
        run_cmd cmake --build . --config Release -j "$(nproc)"
    ) || {
        error "BitNet build failed"
        warn "You may need to build manually. See: ${BITNET_INSTALL_DIR}/README.md"
        return 1
    }

    success "BitNet built successfully"

    # Create a systemd service for BitNet
    log "Creating BitNet systemd service..."
    run_cmd tee /etc/systemd/system/bitnet.service > /dev/null << UNIT
[Unit]
Description=BitNet — CPU-Optimized 1-bit LLM Inference
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${BITNET_INSTALL_DIR}
ExecStart=${BITNET_INSTALL_DIR}/build/bin/llama-cli --host 0.0.0.0 --port 11434
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bitnet

[Install]
WantedBy=multi-user.target
UNIT

    run_cmd systemctl daemon-reload
    run_cmd systemctl enable bitnet.service
    run_cmd systemctl start bitnet.service || warn "BitNet service start deferred — may need a model first"

    success "BitNet service created and enabled"
}

# =============================================================================
# Step 4: Network Configuration
# =============================================================================

step_configure_network() {
    section "4/6" "Network Configuration"

    # --- Enable DHCP on all interfaces ---
    log "Configuring DHCP on all network interfaces..."

    local interfaces
    interfaces=$(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -v lo || true)

    if [[ -z "$interfaces" ]]; then
        warn "No network interfaces found"
    else
        for iface in $interfaces; do
            # Skip virtual/docker/bridge interfaces
            if [[ "$iface" =~ ^(docker|br-|veth|virbr|lo) ]]; then
                continue
            fi

            log "Enabling DHCP on ${iface}..."

            # Use networkd (systemd-based systems) or NetworkManager
            if systemctl is-active --quiet systemd-networkd 2>/dev/null; then
                # systemd-networkd: create a .network file
                run_cmd tee "/etc/systemd/network/50-tentaclaw-${iface}.network" > /dev/null << NETCONF
[Match]
Name=${iface}

[Network]
DHCP=yes
MulticastDNS=yes

[DHCPv4]
UseDomains=yes
NETCONF
                success "DHCP configured for ${iface} (systemd-networkd)"

            elif command -v nmcli &>/dev/null; then
                # NetworkManager
                run_cmd nmcli device set "$iface" autoconnect yes 2>/dev/null || true
                run_cmd nmcli connection modify "$iface" ipv4.method auto 2>/dev/null || true
                success "DHCP configured for ${iface} (NetworkManager)"

            else
                # Fallback: dhclient
                run_cmd dhclient "$iface" 2>/dev/null || warn "Could not start DHCP on ${iface}"
            fi
        done

        # Restart networking
        if systemctl is-active --quiet systemd-networkd 2>/dev/null; then
            run_cmd systemctl restart systemd-networkd
        fi
    fi

    # --- Set hostname ---
    log "Configuring hostname..."

    local desired_hostname=""

    # Try to read from rig.conf
    if [[ -f "$TENTACLAW_RIG_CONF" ]]; then
        desired_hostname=$(grep -E "^HOSTNAME=" "$TENTACLAW_RIG_CONF" 2>/dev/null | cut -d= -f2 | tr -d '"' || true)
    fi

    # Generate a hostname if not set
    if [[ -z "$desired_hostname" ]]; then
        # Generate: tentaclaw-<short-machine-id>
        local machine_id
        if [[ -f /etc/machine-id ]]; then
            machine_id=$(head -c 8 /etc/machine-id)
        else
            machine_id=$(head -c 8 /dev/urandom | xxd -p 2>/dev/null | head -c 8 || echo "$(date +%s)" | tail -c 8)
        fi
        desired_hostname="tentaclaw-${machine_id}"
        log "Generated hostname: ${desired_hostname}"
    fi

    run_cmd hostnamectl set-hostname "$desired_hostname" 2>/dev/null || {
        # Fallback for systems without hostnamectl
        echo "$desired_hostname" | run_cmd tee /etc/hostname > /dev/null
        run_cmd hostname "$desired_hostname"
    }
    success "Hostname set to: ${BOLD}${desired_hostname}${RESET}"

    # --- Start mDNS/Avahi for service discovery ---
    log "Configuring mDNS (Avahi) for service discovery..."

    if command -v avahi-daemon &>/dev/null; then
        run_cmd systemctl enable avahi-daemon.service 2>/dev/null || true
        run_cmd systemctl start avahi-daemon.service 2>/dev/null || true
        success "Avahi mDNS started — node discoverable as ${desired_hostname}.local"
    else
        # Try to install avahi
        log "Avahi not found, attempting installation..."
        if command -v apt-get &>/dev/null; then
            run_cmd apt-get install -y --no-install-recommends avahi-daemon avahi-utils 2>/dev/null || true
        elif command -v dnf &>/dev/null; then
            run_cmd dnf install -y avahi avahi-tools 2>/dev/null || true
        elif command -v pacman &>/dev/null; then
            run_cmd pacman -S --noconfirm avahi nss-mdns 2>/dev/null || true
        fi

        if command -v avahi-daemon &>/dev/null; then
            run_cmd systemctl enable avahi-daemon.service 2>/dev/null || true
            run_cmd systemctl start avahi-daemon.service 2>/dev/null || true
            success "Avahi mDNS installed and started"
        else
            warn "Could not install Avahi — mDNS service discovery unavailable"
        fi
    fi

    # --- Show current network state ---
    echo ""
    log "Current network configuration:"
    local primary_ip
    primary_ip=$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9.]+/[0-9]+' | grep -v '^127\.' | head -1 || echo "no IP")
    local default_gw
    default_gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -1 || echo "no gateway")
    local default_iface
    default_iface=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1 || echo "none")

    echo -e "    ${PURPLE}Hostname${RESET}    ${WHITE}${desired_hostname}${RESET}"
    echo -e "    ${PURPLE}Interface${RESET}   ${WHITE}${default_iface}${RESET}"
    echo -e "    ${PURPLE}IP Address${RESET}  ${WHITE}${primary_ip}${RESET}"
    echo -e "    ${PURPLE}Gateway${RESET}     ${WHITE}${default_gw}${RESET}"
}

# =============================================================================
# Step 5: Start TentaCLAW Agent
# =============================================================================

step_start_agent() {
    section "5/6" "TentaCLAW Agent"

    # --- Create /etc/tentaclaw/rig.conf if it doesn't exist ---
    log "Configuring TentaCLAW agent..."

    run_cmd mkdir -p "$TENTACLAW_CONF_DIR"

    if [[ ! -f "$TENTACLAW_RIG_CONF" ]]; then
        log "Creating ${TENTACLAW_RIG_CONF}..."

        # Generate a unique node ID
        local node_id
        if [[ -f /etc/machine-id ]]; then
            node_id=$(cat /etc/machine-id | sha256sum | head -c 16)
        else
            node_id=$(head -c 16 /dev/urandom | xxd -p 2>/dev/null | head -c 16 || date +%s%N | sha256sum | head -c 16)
        fi

        run_cmd tee "$TENTACLAW_RIG_CONF" > /dev/null << CONF
# =============================================================================
# TentaCLAW OS — Rig Configuration
# =============================================================================
# Generated by first-boot.sh on $(date -Iseconds)
# Edit this file to change node behavior.
# =============================================================================

# Node identity
NODE_ID=${node_id}
HOSTNAME=$(hostname)

# GPU hardware (auto-detected)
GPU_VENDOR=${GPU_VENDOR}
GPU_COUNT=${GPU_COUNT}
TOTAL_VRAM_MB=${TOTAL_VRAM_MB}

# Inference backend
INFERENCE_BACKEND=${RECOMMENDED_BACKEND}

# Gateway connection (auto-discovered via mDNS, or set manually)
# GATEWAY_URL=http://192.168.1.100:7860

# Agent behavior
AGENT_POLL_INTERVAL=30
AGENT_LOG_LEVEL=info
CONF

        success "Created ${TENTACLAW_RIG_CONF}"
    else
        log "rig.conf already exists — preserving existing configuration"

        # Update GPU detection fields if they're missing
        if ! grep -q "^GPU_VENDOR=" "$TENTACLAW_RIG_CONF" 2>/dev/null; then
            echo "" >> "$TENTACLAW_RIG_CONF"
            echo "# GPU hardware (auto-detected on $(date -Iseconds))" >> "$TENTACLAW_RIG_CONF"
            echo "GPU_VENDOR=${GPU_VENDOR}" >> "$TENTACLAW_RIG_CONF"
            echo "GPU_COUNT=${GPU_COUNT}" >> "$TENTACLAW_RIG_CONF"
            echo "TOTAL_VRAM_MB=${TOTAL_VRAM_MB}" >> "$TENTACLAW_RIG_CONF"
            echo "INFERENCE_BACKEND=${RECOMMENDED_BACKEND}" >> "$TENTACLAW_RIG_CONF"
            log "Appended GPU detection results to existing rig.conf"
        fi

        success "Using existing ${TENTACLAW_RIG_CONF}"
    fi

    # --- Create runtime directories ---
    run_cmd mkdir -p /var/run/tentaclaw
    run_cmd mkdir -p /var/log/tentaclaw

    # --- Enable and start the TentaCLAW agent service ---
    log "Starting tentaclaw-agent.service..."

    if systemctl list-unit-files 2>/dev/null | grep -q tentaclaw-agent; then
        run_cmd systemctl enable tentaclaw-agent.service
        run_cmd systemctl start tentaclaw-agent.service || {
            warn "tentaclaw-agent.service failed to start — check logs with: journalctl -u tentaclaw-agent"
        }
        success "tentaclaw-agent.service started"
    else
        # Check if service file exists in our config tree
        local agent_service="${SCRIPT_DIR}/../config/etc/systemd/tentaclaw-agent.service"
        if [[ -f "$agent_service" ]]; then
            log "Installing tentaclaw-agent.service from config..."
            run_cmd cp "$agent_service" /etc/systemd/system/tentaclaw-agent.service
            run_cmd systemctl daemon-reload
            run_cmd systemctl enable tentaclaw-agent.service
            run_cmd systemctl start tentaclaw-agent.service || {
                warn "tentaclaw-agent.service failed to start"
            }
            success "tentaclaw-agent.service installed and started"
        else
            warn "tentaclaw-agent.service not found — agent will need manual setup"
            warn "Expected at: ${agent_service}"
        fi
    fi

    log "Agent will auto-discover the gateway via mDNS or use GATEWAY_URL from rig.conf"
}

# =============================================================================
# Step 6: Boot Summary
# =============================================================================

step_boot_summary() {
    section "6/6" "Boot Summary"

    # --- CLAWtopus ASCII Art ---
    echo -e "${CYAN}"
    cat << 'OCTOPUS'
                         ___
                      .-'   `'.
                     /         \
                     |         ;
                     |         |           ___.--,
            _.._     |0) ~ (0) |    _.---'`__.-( (_.
     __.--'`_.. '.__.\    '--. \_.-' ,.--'`     `""`
    ( ,.--'`   ',__) )  .'   `./ ,-')             ,
     `---'     /_/)) ) /   _  / /  /       TentaCLAW OS
              /( (/   (/ .(  ( (  /     First Boot Complete
             ((._,)   ((_,)   `-'
OCTOPUS
    echo -e "${RESET}"

    # --- Hardware Summary ---
    echo -e "  ${BOLD}${WHITE}Hardware${RESET}"
    echo -e "  ${DIM}────────────────────────────────────────────────${RESET}"

    local cpu_model
    cpu_model=$(cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1 | cut -d: -f2 | xargs || echo "unknown")
    local cpu_cores
    cpu_cores=$(nproc 2>/dev/null || echo "?")
    local total_ram
    total_ram=$(free -h 2>/dev/null | grep Mem | awk '{print $2}' || echo "?")

    echo -e "    ${PURPLE}CPU${RESET}          ${WHITE}${cpu_cores} cores — ${cpu_model}${RESET}"
    echo -e "    ${PURPLE}RAM${RESET}          ${WHITE}${total_ram}${RESET}"

    case "$GPU_VENDOR" in
        nvidia) echo -e "    ${PURPLE}GPU${RESET}          ${GREEN}NVIDIA${RESET} (${GPU_COUNT} GPU(s), ${TOTAL_VRAM_MB} MB VRAM)" ;;
        amd)    echo -e "    ${PURPLE}GPU${RESET}          ${RED}AMD${RESET} (${GPU_COUNT} GPU(s), ${TOTAL_VRAM_MB} MB VRAM)" ;;
        intel)  echo -e "    ${PURPLE}GPU${RESET}          ${CYAN}Intel Arc${RESET} (${GPU_COUNT} GPU(s))" ;;
        none)   echo -e "    ${PURPLE}GPU${RESET}          ${YELLOW}None (CPU-only)${RESET}" ;;
    esac

    echo ""

    # --- Backend Summary ---
    echo -e "  ${BOLD}${WHITE}Inference Backend${RESET}"
    echo -e "  ${DIM}────────────────────────────────────────────────${RESET}"

    case "$RECOMMENDED_BACKEND" in
        ollama)
            local ollama_status="stopped"
            if systemctl is-active --quiet ollama 2>/dev/null; then
                ollama_status="${GREEN}running${RESET}"
            else
                ollama_status="${YELLOW}stopped${RESET}"
            fi
            echo -e "    ${PURPLE}Backend${RESET}      ${WHITE}Ollama${RESET} (${ollama_status})"
            echo -e "    ${PURPLE}API${RESET}          ${WHITE}http://localhost:11434${RESET}"
            ;;
        bitnet)
            local bitnet_status="stopped"
            if systemctl is-active --quiet bitnet 2>/dev/null; then
                bitnet_status="${GREEN}running${RESET}"
            else
                bitnet_status="${YELLOW}stopped${RESET}"
            fi
            echo -e "    ${PURPLE}Backend${RESET}      ${WHITE}BitNet${RESET} (${bitnet_status})"
            echo -e "    ${PURPLE}Install${RESET}      ${WHITE}${BITNET_INSTALL_DIR}${RESET}"
            ;;
    esac

    echo ""

    # --- Network Summary ---
    echo -e "  ${BOLD}${WHITE}Network${RESET}"
    echo -e "  ${DIM}────────────────────────────────────────────────${RESET}"

    local hostname_val
    hostname_val=$(hostname 2>/dev/null || echo "unknown")
    local primary_ip
    primary_ip=$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9.]+' | grep -v '^127\.' | head -1 || echo "no IP")
    local mdns_status="unavailable"
    if systemctl is-active --quiet avahi-daemon 2>/dev/null; then
        mdns_status="${GREEN}active${RESET}"
    fi

    echo -e "    ${PURPLE}Hostname${RESET}     ${WHITE}${hostname_val}${RESET}"
    echo -e "    ${PURPLE}IP Address${RESET}   ${WHITE}${primary_ip}${RESET}"
    echo -e "    ${PURPLE}mDNS${RESET}         ${mdns_status} (${hostname_val}.local)"

    echo ""

    # --- Agent Summary ---
    echo -e "  ${BOLD}${WHITE}TentaCLAW Agent${RESET}"
    echo -e "  ${DIM}────────────────────────────────────────────────${RESET}"

    local agent_status="stopped"
    if systemctl is-active --quiet tentaclaw-agent 2>/dev/null; then
        agent_status="${GREEN}running${RESET}"
    else
        agent_status="${YELLOW}stopped${RESET}"
    fi

    echo -e "    ${PURPLE}Status${RESET}       ${agent_status}"
    echo -e "    ${PURPLE}Config${RESET}       ${WHITE}${TENTACLAW_RIG_CONF}${RESET}"
    echo -e "    ${PURPLE}Logs${RESET}         ${WHITE}journalctl -u tentaclaw-agent -f${RESET}"

    echo ""
    echo -e "  ${DIM}────────────────────────────────────────────────${RESET}"
    echo ""

    # --- Next steps ---
    echo -e "  ${BOLD}${CYAN}Next Steps:${RESET}"
    echo ""
    echo -e "    ${WHITE}1.${RESET} View status:       ${CYAN}tentaclaw-status${RESET}"
    echo -e "    ${WHITE}2.${RESET} Pull a model:       ${CYAN}ollama pull hermes3:latest${RESET}"
    echo -e "    ${WHITE}3.${RESET} Run inference:      ${CYAN}ollama run hermes3${RESET}"
    echo -e "    ${WHITE}4.${RESET} Edit config:        ${CYAN}nano ${TENTACLAW_RIG_CONF}${RESET}"
    echo -e "    ${WHITE}5.${RESET} Join a cluster:     ${CYAN}tentaclaw-setup${RESET}"
    echo ""

    # --- CLAWtopus quote ---
    local quotes=(
        "Eight arms. One mind. Zero compromises."
        "Per-token is a scam. Run local."
        "First boot complete. Let's party."
        "Your tentacles are ready."
        "Local inference or bust."
        "Welcome to the swarm."
    )
    local quote="${quotes[$((RANDOM % ${#quotes[@]}))]}"
    echo -e "  ${DIM}CLAWtopus says: \"${quote}\"${RESET}"
    echo ""

    # --- Mark first boot as complete ---
    if [[ "$DRY_RUN" != true ]]; then
        date -Iseconds > "$TENTACLAW_FIRST_BOOT_MARKER"
    fi
}

# =============================================================================
# Main Entry Point
# =============================================================================

print_banner() {
    echo ""
    echo -e "${BOLD}${CYAN}"
    cat << 'BANNER'
  ████████╗███████╗███╗   ██╗████████╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
  ╚══██╔══╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
     ██║   █████╗  ██╔██╗ ██║   ██║   ███████║██║     ██║     ███████║██║ █╗ ██║
     ██║   ██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║     ██║     ██╔══██║██║███╗██║
     ██║   ███████╗██║ ╚████║   ██║   ██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
BANNER
    echo -e "${RESET}"
    echo -e "  ${PURPLE}First Boot Configuration${RESET}  ${DIM}v${VERSION}${RESET}"
    echo -e "  ${DIM}Detecting hardware, installing drivers, starting services...${RESET}"
    echo ""
}

usage() {
    echo "Usage: first-boot.sh [OPTIONS]"
    echo ""
    echo "TentaCLAW OS first-boot configuration script."
    echo "Detects hardware, installs drivers, and starts the TentaCLAW agent."
    echo ""
    echo "Options:"
    echo "  --dry-run          Show what would happen without making changes"
    echo "  --step <name>      Run a single step:"
    echo "                       detect-gpu, install-drivers, install-backend,"
    echo "                       configure-net, start-agent, boot-summary"
    echo "  --force            Run even if first boot was already completed"
    echo "  --help, -h         Show this help"
    echo "  --version, -v      Show version"
    echo ""
    echo "Steps run in order:"
    echo "  1. detect-gpu       Scan PCI bus for GPU hardware"
    echo "  2. install-drivers  Install NVIDIA/AMD/Intel drivers"
    echo "  3. install-backend  Install Ollama (GPU) or BitNet (CPU)"
    echo "  4. configure-net    Enable DHCP, set hostname, start mDNS"
    echo "  5. start-agent      Create rig.conf and start tentaclaw-agent"
    echo "  6. boot-summary     Print summary and CLAWtopus art"
}

main() {
    local step=""
    local force=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --step)
                step="${2:-}"
                [[ -z "$step" ]] && { echo "Error: --step requires a step name" >&2; exit 1; }
                shift 2
                ;;
            --force)
                force=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            --version|-v)
                echo "first-boot.sh v${VERSION} — TentaCLAW OS"
                exit 0
                ;;
            *)
                echo "Unknown option: $1" >&2
                echo "Use --help for usage" >&2
                exit 1
                ;;
        esac
    done

    # Root check
    check_root

    # Banner
    print_banner

    if [[ "$DRY_RUN" == true ]]; then
        echo -e "  ${YELLOW}*** DRY RUN MODE — no changes will be made ***${RESET}"
        echo ""
    fi

    # Run single step or full sequence
    if [[ -n "$step" ]]; then
        case "$step" in
            detect-gpu)       check_prerequisites; step_detect_gpu ;;
            install-drivers)  check_prerequisites; step_detect_gpu; step_install_drivers ;;
            install-backend)  check_prerequisites; step_detect_gpu; step_install_backend ;;
            configure-net)    check_prerequisites; step_configure_network ;;
            start-agent)      check_prerequisites; step_detect_gpu; step_start_agent ;;
            boot-summary)     check_prerequisites; step_detect_gpu; step_boot_summary ;;
            *)
                echo "Unknown step: $step" >&2
                echo "Valid steps: detect-gpu, install-drivers, install-backend, configure-net, start-agent, boot-summary" >&2
                exit 1
                ;;
        esac
    else
        # Full first-boot sequence
        check_prerequisites
        step_detect_gpu
        step_install_drivers
        step_install_backend
        step_configure_network
        step_start_agent
        step_boot_summary
    fi

    # Log completion
    log "First boot configuration finished at $(date -Iseconds)"
}

# Trap errors for clean reporting
trap 'error "Unexpected error on line ${LINENO}. Check ${TENTACLAW_LOG_DIR}/first-boot.log"' ERR

# Tee all output to log file (if we can write to it)
if [[ "$EUID" -eq 0 ]] && mkdir -p "$TENTACLAW_LOG_DIR" 2>/dev/null; then
    exec > >(tee -a "${TENTACLAW_LOG_DIR}/first-boot.log") 2>&1
fi

main "$@"
