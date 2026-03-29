#!/bin/bash
# TentaCLAW OS — One-Line Installer
# Usage: curl -fsSL tentaclaw.io/install | bash
set -e

TEAL='\033[38;2;0;212;170m'
PURPLE='\033[38;2;139;92;246m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${TEAL}${BOLD}  TentaCLAW OS Installer${RESET}"
echo -e "${DIM}  Eight arms. One mind. Zero compromises.${RESET}"
echo ""

# Detect OS
if [ -f /etc/debian_version ]; then
    OS="debian"
elif [ -f /etc/fedora-release ]; then
    OS="fedora"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    OS="unknown"
fi
echo -e "  ${DIM}OS:${RESET} $OS"

# Check for Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    echo -e "  ${GREEN}✓${RESET} Node.js $NODE_VER"
else
    echo -e "  ${DIM}Installing Node.js...${RESET}"
    if [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
        sudo apt-get install -y nodejs >/dev/null 2>&1
    elif [ "$OS" = "fedora" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
        sudo dnf install -y nodejs >/dev/null 2>&1
    elif [ "$OS" = "macos" ]; then
        brew install node >/dev/null 2>&1 || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
    fi
    echo -e "  ${GREEN}✓${RESET} Node.js $(node --version)"
fi

# Check for Ollama
if command -v ollama &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} Ollama $(ollama --version 2>/dev/null | head -1)"
else
    echo -e "  ${DIM}Installing Ollama...${RESET}"
    curl -fsSL https://ollama.com/install.sh | sh >/dev/null 2>&1
    echo -e "  ${GREEN}✓${RESET} Ollama installed"
fi

# Install TentaCLAW
echo -e "  ${DIM}Installing TentaCLAW...${RESET}"
INSTALL_DIR="${TENTACLAW_DIR:-/opt/tentaclaw}"
sudo mkdir -p "$INSTALL_DIR"
sudo chown $(whoami) "$INSTALL_DIR"

# Clone or download
if command -v git &>/dev/null; then
    git clone --depth 1 https://github.com/TentaCLAW-OS/TentaCLAW.git "$INSTALL_DIR" 2>/dev/null || {
        cd "$INSTALL_DIR" && git pull 2>/dev/null
    }
else
    curl -fsSL https://github.com/TentaCLAW-OS/TentaCLAW/archive/master.tar.gz | tar xz -C "$INSTALL_DIR" --strip-components=1
fi

cd "$INSTALL_DIR/gateway" && npm install --production >/dev/null 2>&1
echo -e "  ${GREEN}✓${RESET} TentaCLAW installed"

# Detect GPUs
echo -e "  ${DIM}Detecting GPUs...${RESET}"
GPU_COUNT=0
if command -v nvidia-smi &>/dev/null; then
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l)
    echo -e "  ${GREEN}✓${RESET} $GPU_COUNT NVIDIA GPU(s) detected"
elif [ -d /sys/class/drm ]; then
    GPU_COUNT=$(ls -d /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null | wc -l)
    if [ "$GPU_COUNT" -gt 0 ]; then
        echo -e "  ${GREEN}✓${RESET} $GPU_COUNT AMD GPU(s) detected"
    fi
fi

if [ "$GPU_COUNT" -eq 0 ]; then
    echo -e "  ${DIM}No GPUs detected (CPU inference available)${RESET}"
fi

# Create systemd service
if command -v systemctl &>/dev/null; then
    sudo tee /etc/systemd/system/tentaclaw-gateway.service >/dev/null << SVC
[Unit]
Description=TentaCLAW Gateway
After=network.target
[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/gateway
ExecStart=$(which npx) tsx src/index.ts
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
SVC
    sudo systemctl daemon-reload
    sudo systemctl enable tentaclaw-gateway >/dev/null 2>&1
    sudo systemctl start tentaclaw-gateway
    echo -e "  ${GREEN}✓${RESET} Gateway service started"
fi

# Wait for gateway
sleep 3
if curl -s http://localhost:8080/health >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${RESET} Gateway is running"
else
    echo -e "  ${DIM}Gateway starting...${RESET}"
    sleep 5
fi

# Done!
echo ""
echo -e "${TEAL}${BOLD}  ✓ TentaCLAW OS is ready!${RESET}"
echo ""
echo -e "  ${BOLD}Dashboard:${RESET}  http://localhost:8080/dashboard/"
echo -e "  ${BOLD}API:${RESET}        http://localhost:8080/api/v1"
echo -e "  ${BOLD}CLI:${RESET}        cd $INSTALL_DIR/cli && npx tsx src/index.ts help"
echo ""
echo -e "  ${DIM}Next: open the dashboard in your browser${RESET}"
echo -e "  ${DIM}Add more nodes: run this installer on other machines${RESET}"
echo ""

# Try to open browser
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:8080/dashboard/" 2>/dev/null &
elif command -v open &>/dev/null; then
    open "http://localhost:8080/dashboard/" 2>/dev/null &
fi
