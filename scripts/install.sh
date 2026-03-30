#!/bin/bash
# TentaCLAW OS — Cross-Platform Installer
# Usage: curl -fsSL tentaclaw.io/install | bash
#   Or:  curl -fsSL tentaclaw.io/install | bash -s -- --agent-only
#   Or:  ./install.sh --mock --gateway-only
#
# Flags:
#   --agent-only      Skip gateway install
#   --gateway-only    Skip agent install
#   --mock            Start in mock mode after install (no real GPU/Ollama required)
#   --install-dir DIR Set custom install directory (default: /opt/tentaclaw or ~/TentaCLAW)
#   --no-service      Skip systemd service creation
#   --help            Show this help message

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Brand colors (24-bit true color)
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
INSTALL_DIR="${TENTACLAW_DIR:-}"
AGENT_ONLY=false
GATEWAY_ONLY=false
MOCK_MODE=false
NO_SERVICE=false
REPO_URL="https://github.com/TentaCLAW-OS/TentaCLAW.git"

# ──────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --agent-only)
            AGENT_ONLY=true
            shift
            ;;
        --gateway-only)
            GATEWAY_ONLY=true
            shift
            ;;
        --mock)
            MOCK_MODE=true
            shift
            ;;
        --no-service)
            NO_SERVICE=true
            shift
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "TentaCLAW OS Installer"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --agent-only        Only install the agent (skip gateway)"
            echo "  --gateway-only      Only install the gateway (skip agent)"
            echo "  --mock              Start in mock mode after install"
            echo "  --no-service        Skip systemd service creation"
            echo "  --install-dir DIR   Custom install directory"
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  TENTACLAW_DIR       Default install directory"
            exit 0
            ;;
        *)
            echo "Unknown option: $1 (use --help for usage)"
            exit 1
            ;;
    esac
done

# Validate flag combinations
if $AGENT_ONLY && $GATEWAY_ONLY; then
    echo -e "${RED}Error: --agent-only and --gateway-only cannot be used together.${RESET}"
    exit 1
fi

# ──────────────────────────────────────────────────────────────────
# Helper functions
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
print_banner() {
    echo ""
    echo -e "${TEAL}${BOLD}"
    cat << 'BANNER'
        _____ ___ _  _ _____  _    ___ _      ___      __  ___  ___
       |_   _| __| \| |_   _|/_\  / __| |    /_\ \    / / / _ \/ __|
         | | | _|| .` | | | / _ \| (__| |__ / _ \ \/\/ / | (_) \__ \
         |_| |___|_|\_| |_|/_/ \_\\___|____/_/ \_\_/\_/   \___/|___/
BANNER
    echo -e "${RESET}"
    echo -e "${PURPLE}${BOLD}          Eight arms. One mind. Zero compromises.${RESET}"
    echo ""
    echo -e "${TEAL}"
    cat << 'OCTOPUS'
                        .---.
                       /     \
                       \.@-@./
                       /`\_/`\
                      //  _  \\
                     | \     )|_
                    /`\_`>  <_/ \
                    \__/'---'\__/
                     ___/   \___
                    / (_\   /_) \
                   /   /\___/\   \
                  /   /  | |  \   \
                 (   /   | |   \   )
                  \_/    | |    \_/
                         | |
                         | |
                          V
OCTOPUS
    echo -e "${RESET}"
}

# ──────────────────────────────────────────────────────────────────
# OS Detection
# ──────────────────────────────────────────────────────────────────
detect_os() {
    OS="unknown"
    PKG_MANAGER="unknown"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        if command_exists brew; then
            PKG_MANAGER="brew"
        else
            PKG_MANAGER="none"
        fi
    elif [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|pop|linuxmint|elementary|zorin)
                OS="debian"
                PKG_MANAGER="apt"
                ;;
            fedora)
                OS="fedora"
                PKG_MANAGER="dnf"
                ;;
            rhel|centos|rocky|alma)
                OS="rhel"
                if command_exists dnf; then
                    PKG_MANAGER="dnf"
                else
                    PKG_MANAGER="yum"
                fi
                ;;
            arch|manjaro|endeavouros|garuda)
                OS="arch"
                PKG_MANAGER="pacman"
                ;;
            opensuse*|sles)
                OS="suse"
                PKG_MANAGER="zypper"
                ;;
            alpine)
                OS="alpine"
                PKG_MANAGER="apk"
                ;;
            *)
                OS="linux-other"
                # Try to detect package manager
                if command_exists apt-get; then PKG_MANAGER="apt"
                elif command_exists dnf; then PKG_MANAGER="dnf"
                elif command_exists yum; then PKG_MANAGER="yum"
                elif command_exists pacman; then PKG_MANAGER="pacman"
                elif command_exists zypper; then PKG_MANAGER="zypper"
                elif command_exists apk; then PKG_MANAGER="apk"
                fi
                ;;
        esac
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
        PKG_MANAGER="none"
    fi

    echo -e "  ${DIM}OS:${RESET}              $OS"
    echo -e "  ${DIM}Package manager:${RESET} $PKG_MANAGER"
}

# ──────────────────────────────────────────────────────────────────
# Set install directory based on OS
# ──────────────────────────────────────────────────────────────────
set_install_dir() {
    if [ -n "$INSTALL_DIR" ]; then
        return # Already set via flag or env var
    fi

    if [[ "$OS" == "macos" ]]; then
        INSTALL_DIR="$HOME/TentaCLAW"
    elif [[ "$(id -u)" == "0" ]]; then
        INSTALL_DIR="/opt/tentaclaw"
    else
        INSTALL_DIR="$HOME/TentaCLAW"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Install Node.js
# ──────────────────────────────────────────────────────────────────
ensure_nodejs() {
    step "Checking Node.js..."

    if command_exists node; then
        local node_ver
        node_ver=$(node --version)
        local major
        major=$(echo "$node_ver" | sed 's/v//' | cut -d. -f1)

        if [ "$major" -ge 22 ]; then
            ok "Node.js $node_ver"
        elif [ "$major" -ge 18 ]; then
            ok "Node.js $node_ver"
            warn "Node.js 22+ is recommended. Current: $node_ver"
        else
            fail "Node.js $node_ver is too old (minimum: 18, recommended: 22+)"
            install_nodejs
        fi
        return
    fi

    fail "Node.js is not installed"
    install_nodejs
}

install_nodejs() {
    info "Installing Node.js 22..."

    case "$PKG_MANAGER" in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
            sudo apt-get install -y nodejs >/dev/null 2>&1
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
            sudo dnf install -y nodejs >/dev/null 2>&1
            ;;
        yum)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
            sudo yum install -y nodejs >/dev/null 2>&1
            ;;
        pacman)
            sudo pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1
            ;;
        zypper)
            sudo zypper install -y nodejs22 npm22 >/dev/null 2>&1 || {
                curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
                sudo zypper install -y nodejs >/dev/null 2>&1
            }
            ;;
        apk)
            sudo apk add --no-cache nodejs npm >/dev/null 2>&1
            ;;
        brew)
            brew install node >/dev/null 2>&1
            ;;
        *)
            die "Could not install Node.js automatically.\n  Install Node.js 22+ manually: https://nodejs.org/en/download\n  Or use nvm: https://github.com/nvm-sh/nvm"
            ;;
    esac

    if command_exists node; then
        ok "Node.js $(node --version) installed"
    else
        die "Node.js installation failed. Install manually: https://nodejs.org/en/download"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Check git
# ──────────────────────────────────────────────────────────────────
ensure_git() {
    step "Checking git..."

    if command_exists git; then
        ok "git $(git --version | awk '{print $3}')"
        return
    fi

    fail "git is not installed"
    info "Installing git..."

    case "$PKG_MANAGER" in
        apt)     sudo apt-get install -y git >/dev/null 2>&1 ;;
        dnf)     sudo dnf install -y git >/dev/null 2>&1 ;;
        yum)     sudo yum install -y git >/dev/null 2>&1 ;;
        pacman)  sudo pacman -Sy --noconfirm git >/dev/null 2>&1 ;;
        zypper)  sudo zypper install -y git >/dev/null 2>&1 ;;
        apk)     sudo apk add --no-cache git >/dev/null 2>&1 ;;
        brew)    brew install git >/dev/null 2>&1 ;;
        *)       die "Could not install git. Install it manually and re-run." ;;
    esac

    if command_exists git; then
        ok "git $(git --version | awk '{print $3}') installed"
    else
        die "git installation failed. Install manually and re-run."
    fi
}

# ──────────────────────────────────────────────────────────────────
# Check npm
# ──────────────────────────────────────────────────────────────────
ensure_npm() {
    step "Checking npm..."

    if command_exists npm; then
        ok "npm $(npm --version)"
    else
        fail "npm not found"
        die "npm should be installed with Node.js. Try reinstalling Node.js."
    fi
}

# ──────────────────────────────────────────────────────────────────
# Clone / update repository
# ──────────────────────────────────────────────────────────────────
clone_repo() {
    step "Setting up TentaCLAW OS..."

    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Existing installation found. Pulling latest..."
        (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null) || {
            warn "git pull failed. Continuing with existing version."
        }
        ok "TentaCLAW OS updated at $INSTALL_DIR"
    else
        local parent_dir
        parent_dir=$(dirname "$INSTALL_DIR")

        # Create directory (with sudo if needed)
        if [ -w "$parent_dir" ] || [ "$(id -u)" == "0" ]; then
            mkdir -p "$INSTALL_DIR"
        else
            sudo mkdir -p "$INSTALL_DIR"
            sudo chown "$(whoami):$(id -gn)" "$INSTALL_DIR"
        fi

        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
            fail "Failed to clone repository"
            die "Could not clone $REPO_URL\n  Check your internet connection and try again.\n  Or clone manually: git clone $REPO_URL \"$INSTALL_DIR\""
        }
        ok "TentaCLAW OS cloned to $INSTALL_DIR"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Install dependencies
# ──────────────────────────────────────────────────────────────────
install_gateway_deps() {
    if $AGENT_ONLY; then return; fi

    step "Installing gateway dependencies..."

    if [ ! -f "$INSTALL_DIR/gateway/package.json" ]; then
        fail "Gateway package.json not found"
        die "The repository appears incomplete. Try removing $INSTALL_DIR and re-running."
    fi

    (cd "$INSTALL_DIR/gateway" && npm install --production 2>&1) >/dev/null || {
        fail "Gateway npm install failed"
        die "Failed to install gateway dependencies.\n  Try manually: cd \"$INSTALL_DIR/gateway\" && npm install"
    }
    ok "Gateway dependencies installed"
}

install_agent_deps() {
    if $GATEWAY_ONLY; then return; fi

    step "Installing agent dependencies..."

    if [ ! -f "$INSTALL_DIR/agent/package.json" ]; then
        fail "Agent package.json not found"
        die "The repository appears incomplete. Try removing $INSTALL_DIR and re-running."
    fi

    (cd "$INSTALL_DIR/agent" && npm install --production 2>&1) >/dev/null || {
        fail "Agent npm install failed"
        die "Failed to install agent dependencies.\n  Try manually: cd \"$INSTALL_DIR/agent\" && npm install"
    }
    ok "Agent dependencies installed"
}

# ──────────────────────────────────────────────────────────────────
# Detect GPUs
# ──────────────────────────────────────────────────────────────────
detect_gpus() {
    step "Detecting GPU hardware..."

    local gpu_count=0
    local gpu_vendor=""

    if command_exists nvidia-smi; then
        gpu_count=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
        gpu_vendor="NVIDIA"
        local gpu_names
        gpu_names=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -3 | tr '\n' ', ' | sed 's/, $//')
        ok "$gpu_count NVIDIA GPU(s): $gpu_names"
    elif [ -d /sys/class/drm ]; then
        # Check for AMD GPUs
        local amd_count=0
        amd_count=$(find /sys/class/drm -name "gpu_busy_percent" 2>/dev/null | wc -l)
        if [ "$amd_count" -gt 0 ]; then
            gpu_count=$amd_count
            gpu_vendor="AMD"
            ok "$gpu_count AMD GPU(s) detected"
        fi
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: check for Apple Silicon
        local chip
        chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")
        if echo "$chip" | grep -qi "apple"; then
            ok "Apple Silicon detected ($chip) - Metal acceleration available"
            gpu_count=1
            gpu_vendor="Apple"
        else
            ok "Intel Mac detected - limited GPU inference"
        fi
    fi

    if [ "$gpu_count" -eq 0 ] && [ -z "$gpu_vendor" ]; then
        ok "No dedicated GPU detected (CPU inference available)"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Check Ollama
# ──────────────────────────────────────────────────────────────────
check_ollama() {
    step "Checking Ollama..."

    if command_exists ollama; then
        local ollama_ver
        ollama_ver=$(ollama --version 2>/dev/null | head -1)
        ok "Ollama detected ($ollama_ver)"
    else
        ok "Ollama not found (optional - needed for local inference)"
        info "Install: curl -fsSL https://ollama.com/install.sh | sh"
        info "Or run: ./scripts/install-ollama.sh"
    fi
}

# ──────────────────────────────────────────────────────────────────
# Create systemd service (Linux only)
# ──────────────────────────────────────────────────────────────────
create_service() {
    if $NO_SERVICE; then return; fi
    if $AGENT_ONLY; then return; fi
    if ! command_exists systemctl; then return; fi
    if [[ "$OSTYPE" == "darwin"* ]]; then return; fi

    step "Creating systemd service..."

    local node_path
    node_path=$(which node)
    local npx_path
    npx_path=$(which npx)

    sudo tee /etc/systemd/system/tentaclaw-gateway.service >/dev/null << SVC
[Unit]
Description=TentaCLAW Gateway
Documentation=https://tentaclaw.io/docs
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/gateway
ExecStart=$npx_path tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TENTACLAW_PORT=8080

[Install]
WantedBy=multi-user.target
SVC

    sudo systemctl daemon-reload
    sudo systemctl enable tentaclaw-gateway >/dev/null 2>&1
    ok "Systemd service created (tentaclaw-gateway)"
    info "Start with: sudo systemctl start tentaclaw-gateway"
}

# ──────────────────────────────────────────────────────────────────
# Create macOS launchd plist (macOS only)
# ──────────────────────────────────────────────────────────────────
create_launchd_service() {
    if $NO_SERVICE; then return; fi
    if $AGENT_ONLY; then return; fi
    if [[ "$OSTYPE" != "darwin"* ]]; then return; fi

    step "Creating launchd service..."

    local plist_dir="$HOME/Library/LaunchAgents"
    local plist_path="$plist_dir/io.tentaclaw.gateway.plist"
    local node_path
    node_path=$(which node)
    local npx_path
    npx_path=$(which npx)

    mkdir -p "$plist_dir"

    cat > "$plist_path" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.tentaclaw.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>$npx_path</string>
        <string>tsx</string>
        <string>src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR/gateway</string>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>TENTACLAW_PORT</key>
        <string>8080</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/tentaclaw-gateway.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/tentaclaw-gateway.err</string>
</dict>
</plist>
PLIST

    ok "launchd service created"
    info "Start with: launchctl load $plist_path"
}

# ──────────────────────────────────────────────────────────────────
# Print completion message
# ──────────────────────────────────────────────────────────────────
print_success() {
    echo ""
    echo -e "${TEAL}${BOLD}  ════════════════════════════════════════════${RESET}"
    echo -e "${TEAL}${BOLD}    TentaCLAW OS installed successfully!${RESET}"
    echo -e "${TEAL}${BOLD}  ════════════════════════════════════════════${RESET}"
    echo ""
    echo -e "  ${BOLD}Location:${RESET}    $INSTALL_DIR"
    echo ""

    if ! $AGENT_ONLY; then
        echo -e "  ${BOLD}Start the gateway:${RESET}"
        echo -e "    cd \"$INSTALL_DIR/gateway\" && npm run dev"
        echo ""
        echo -e "  ${BOLD}Dashboard:${RESET}   http://localhost:8080/dashboard/"
        echo -e "  ${BOLD}API:${RESET}         http://localhost:8080/api/v1"
        echo ""
    fi

    if ! $GATEWAY_ONLY; then
        echo -e "  ${BOLD}Start the agent:${RESET}"
        if $MOCK_MODE; then
            echo -e "    cd \"$INSTALL_DIR/agent\" && TENTACLAW_MOCK=true npm run dev"
        else
            echo -e "    cd \"$INSTALL_DIR/agent\" && npm run dev"
        fi
        echo ""
    fi

    echo -e "  ${DIM}Documentation: https://tentaclaw.io/docs${RESET}"
    echo -e "  ${DIM}GitHub:        https://github.com/TentaCLAW-OS/TentaCLAW${RESET}"
    echo ""
}

# ──────────────────────────────────────────────────────────────────
# Auto-start in mock mode
# ──────────────────────────────────────────────────────────────────
start_mock() {
    if ! $MOCK_MODE; then return; fi

    echo -e "${PURPLE}${BOLD}  Starting in mock mode...${RESET}"
    echo ""

    export TENTACLAW_MOCK=true

    if ! $AGENT_ONLY; then
        echo -e "  Starting gateway (mock mode)..."
        echo -e "  Press Ctrl+C to stop."
        echo ""
        cd "$INSTALL_DIR/gateway" && npm run dev
    elif ! $GATEWAY_ONLY; then
        echo -e "  Starting agent (mock mode)..."
        echo -e "  Press Ctrl+C to stop."
        echo ""
        cd "$INSTALL_DIR/agent" && npm run dev
    fi
}

# ──────────────────────────────────────────────────────────────────
# Try to open browser
# ──────────────────────────────────────────────────────────────────
open_browser() {
    if $AGENT_ONLY; then return; fi
    if $MOCK_MODE; then return; fi  # Don't open if we're about to start

    if command_exists xdg-open; then
        xdg-open "http://localhost:8080/dashboard/" 2>/dev/null &
    elif command_exists open; then
        open "http://localhost:8080/dashboard/" 2>/dev/null &
    fi
}

# ══════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════
main() {
    print_banner

    echo -e "  ${BOLD}Preflight checks${RESET}"
    echo ""

    detect_os
    set_install_dir

    echo ""
    echo -e "  ${BOLD}Install directory:${RESET} $INSTALL_DIR"
    if $AGENT_ONLY;   then echo -e "  ${BOLD}Mode:${RESET}              Agent only"; fi
    if $GATEWAY_ONLY; then echo -e "  ${BOLD}Mode:${RESET}              Gateway only"; fi
    if $MOCK_MODE;    then echo -e "  ${BOLD}Mock mode:${RESET}         Enabled"; fi
    echo ""

    # Prerequisites
    ensure_nodejs
    ensure_git
    ensure_npm

    echo ""
    echo -e "  ${BOLD}Installing${RESET}"
    echo ""

    # Install
    clone_repo
    install_gateway_deps
    install_agent_deps

    echo ""
    echo -e "  ${BOLD}System detection${RESET}"
    echo ""

    # System info
    detect_gpus
    check_ollama

    echo ""
    echo -e "  ${BOLD}Service setup${RESET}"
    echo ""

    # Service
    create_service
    create_launchd_service

    # Done
    print_success
    open_browser
    start_mock
}

main "$@"
