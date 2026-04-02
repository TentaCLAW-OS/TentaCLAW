#!/usr/bin/env bash
# =============================================================================
# TentaCLAW CLI Installer — Linux / macOS / Proxmox
# =============================================================================
#
# Usage:
#   curl -fsSL https://tentaclaw.io/install-cli | bash
#   wget -qO- https://tentaclaw.io/install-cli | bash
#
# Or clone and run locally:
#   bash scripts/install-cli.sh
#
# Options:
#   TENTACLAW_BRANCH=dev  — install from a specific branch
#   TENTACLAW_DIR=...     — install to a custom directory (default: ~/.tentaclaw/src)
#   SKIP_SETUP=1          — skip interactive setup after install
# =============================================================================

set -euo pipefail

# Brand colors
TEAL='\033[38;2;0;212;170m'
PURPLE='\033[38;2;139;92;246m'
GREEN='\033[38;2;0;255;136m'
RED='\033[38;2;255;70;70m'
YELLOW='\033[38;2;255;220;0m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

BRANCH="${TENTACLAW_BRANCH:-master}"
INSTALL_DIR="${TENTACLAW_DIR:-$HOME/.tentaclaw/src}"
REPO_URL="https://github.com/TentaCLAW-OS/tentaclaw-os.git"

# --- Banner ---
banner() {
    echo ""
    echo -e "${TEAL}"
    cat << 'BANNER'
  ████████╗███████╗███╗   ██╗████████╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
     ██╔══╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
     ██║   █████╗  ██╔██╗ ██║   ██║   ███████║██║     ██║     ███████║██║ █╗ ██║
     ██║   ██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║     ██║     ██╔══██║██║███╗██║
     ██║   ███████╗██║ ╚████║   ██║   ██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
BANNER
    echo -e "${DIM}  Distributed AI Inference Cluster Management${RESET}"
    echo ""
    echo -e "${TEAL}"
    cat << 'OCTOPUS'
                          ___
                       .-'   `'.
                      /         \
                      |         ;
                      |         |           ___.--,
             _.._     |0) ~ (0) |    _.---'`__.-( (_.
      __.--'`_.. '.__.\.    '--. \_.-' ,.--'`     `""`
     ( ,.--'`   ',__/|)  `-. '.  `.   /   _
     _`) )  .---.__.' /   `. `. \_  `-'  /`.)
    `)_')  /        /     `.  `\  \ `'  /
     `'''  |  _    |       `. `. `.  /`
            ;  \   '.        `. `. `./
             \  '.   \         `. `.  `-._     _
              '.  `'. `.         `-. `.    `.__/
                `'.  `\ `.         `.  `-.
                   `'  \ `;          `-._`.
                        ` \               `'
OCTOPUS
    echo -e "${RESET}"
    echo -e "  ${PURPLE}${BOLD}CLI Installer${RESET} ${DIM}— Eight arms. One mind.${RESET}"
    echo ""
}

info()    { echo -e "  ${GREEN}✔${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail()    { echo -e "  ${RED}✘${RESET} $1"; exit 1; }
step()    { echo -e "  ${TEAL}▸${RESET} $1"; }

# --- Check prerequisites ---
check_node() {
    if ! command -v node &>/dev/null; then
        warn "Node.js not found. Installing..."
        install_node
    fi

    local ver
    ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$ver" -lt 20 ]; then
        warn "Node.js v${ver} is too old (need >= 20). Upgrading..."
        install_node
    else
        info "Node.js $(node -v)"
    fi
}

install_node() {
    if command -v apt-get &>/dev/null; then
        # Debian/Ubuntu
        step "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - || fail "NodeSource setup failed"
        sudo apt-get install -y nodejs || fail "Node.js install failed"
    elif command -v dnf &>/dev/null; then
        # RHEL/Fedora
        step "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - || fail "NodeSource setup failed"
        sudo dnf install -y nodejs || fail "Node.js install failed"
    elif command -v yum &>/dev/null; then
        # Older RHEL/CentOS
        step "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - || fail "NodeSource setup failed"
        sudo yum install -y nodejs || fail "Node.js install failed"
    elif command -v brew &>/dev/null; then
        # macOS
        step "Installing Node.js via Homebrew..."
        brew install node || fail "Homebrew node install failed"
    else
        fail "Cannot auto-install Node.js. Please install Node.js >= 20 manually: https://nodejs.org"
    fi

    info "Node.js $(node -v) installed"
}

check_git() {
    if ! command -v git &>/dev/null; then
        warn "git not found. Installing..."
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y git
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y git
        elif command -v yum &>/dev/null; then
            sudo yum install -y git
        elif command -v brew &>/dev/null; then
            brew install git
        else
            fail "Cannot auto-install git. Please install git manually."
        fi
    fi
    info "git $(git --version | cut -d' ' -f3)"
}

# --- Clone or update repository ---
clone_or_update() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        step "Updating existing installation..."
        cd "$INSTALL_DIR"
        git fetch origin "$BRANCH" --quiet
        git checkout "$BRANCH" --quiet 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" --quiet
        git pull origin "$BRANCH" --quiet
        info "Updated to latest $BRANCH"
    else
        step "Cloning TentaCLAW OS..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR" --quiet
        info "Cloned to $INSTALL_DIR"
    fi
}

# --- Build CLI ---
build_cli() {
    cd "$INSTALL_DIR"

    step "Installing dependencies..."
    npm install --no-audit --no-fund --loglevel=error 2>&1 | tail -3
    info "Dependencies installed"

    step "Building CLI..."
    npm run build --workspace=cli 2>&1 | tail -3
    info "CLI built"
}

# --- Create global symlink ---
link_cli() {
    step "Creating global 'tentaclaw' command..."

    local bindir=""
    if [ -w "/usr/local/bin" ]; then
        bindir="/usr/local/bin"
    elif [ -d "$HOME/.local/bin" ]; then
        bindir="$HOME/.local/bin"
    else
        mkdir -p "$HOME/.local/bin"
        bindir="$HOME/.local/bin"
    fi

    local target="$INSTALL_DIR/cli/dist/cli/src/index.js"
    chmod +x "$target"

    # Create wrapper script instead of symlink (more portable)
    cat > "$bindir/tentaclaw" << WRAPPER
#!/usr/bin/env bash
exec node "$target" "\$@"
WRAPPER
    chmod +x "$bindir/tentaclaw"

    # Check if bindir is in PATH
    if ! echo "$PATH" | tr ':' '\n' | grep -q "^${bindir}$"; then
        warn "$bindir is not in your PATH"
        echo ""
        echo -e "  ${DIM}Add this to your shell profile (~/.bashrc or ~/.zshrc):${RESET}"
        echo -e "  ${YELLOW}export PATH=\"$bindir:\$PATH\"${RESET}"
        echo ""
    fi

    info "Installed 'tentaclaw' to $bindir/tentaclaw"
}

# --- Detect Ollama ---
detect_ollama() {
    for port in 11434 11435; do
        if curl -sf "http://localhost:${port}/api/tags" >/dev/null 2>&1; then
            info "Ollama detected on port $port"
            return 0
        fi
    done
    return 1
}

# --- Main ---
main() {
    banner

    step "Checking prerequisites..."
    check_git
    check_node
    echo ""

    clone_or_update
    echo ""

    build_cli
    echo ""

    link_cli
    echo ""

    # Verify
    if command -v tentaclaw &>/dev/null; then
        info "Installation complete!"
        echo ""
        tentaclaw --version 2>/dev/null || true
    else
        info "Installation complete! (restart your shell or source your profile)"
    fi

    echo ""

    # Run setup if not skipped
    if [ "${SKIP_SETUP:-0}" != "1" ]; then
        if detect_ollama 2>/dev/null; then
            echo -e "  ${TEAL}${BOLD}Ollama detected! Running setup...${RESET}"
            echo ""
            tentaclaw setup 2>/dev/null || "$INSTALL_DIR/cli/dist/cli/src/index.js" setup || true
        else
            echo -e "  ${YELLOW}${BOLD}Next steps:${RESET}"
            echo -e "    ${GREEN}1.${RESET} Install Ollama: ${DIM}curl -fsSL https://ollama.ai/install.sh | sh${RESET}"
            echo -e "    ${GREEN}2.${RESET} Pull a model:   ${DIM}ollama pull llama3.1:8b${RESET}"
            echo -e "    ${GREEN}3.${RESET} Configure:      ${DIM}tentaclaw setup${RESET}"
            echo -e "    ${GREEN}4.${RESET} Start coding:   ${DIM}tentaclaw code${RESET}"
        fi
    fi

    echo ""
    echo -e "  ${PURPLE}${BOLD}🐙 TentaCLAW is ready.${RESET}"
    echo ""
}

main "$@"
