#!/usr/bin/env bash
# =============================================================================
# TentaCLAW OS — Installer
# =============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/TentaCLAW-OS/TentaCLAW/master/install.sh | bash
#
# Or with options:
#   bash install.sh --port 9090
#   bash install.sh --dir /opt/tentaclaw
#   bash install.sh --no-service        # don't install systemd, just build
# =============================================================================

set -euo pipefail

# --- defaults -----------------------------------------------------------------
INSTALL_DIR="/opt/tentaclaw"
PORT=8080
INSTALL_SERVICE=true
REPO="https://github.com/TentaCLAW-OS/TentaCLAW.git"
NODE_MIN=20

# --- colors -------------------------------------------------------------------
CY='\033[38;2;0;255;255m'   # cyan
PU='\033[38;2;140;0;200m'   # purple
GR='\033[38;2;0;255;136m'   # green
YE='\033[38;2;255;220;50m'  # yellow
RE='\033[38;2;255;70;70m'   # red
DI='\033[38;2;80;80;100m'   # dim
RS='\033[0m'

step()  { echo -e "\n${CY}▸ $*${RS}"; }
ok()    { echo -e "  ${GR}✓${RS} $*"; }
warn()  { echo -e "  ${YE}⚠${RS} $*"; }
die()   { echo -e "\n${RE}✗ $*${RS}\n"; exit 1; }

# --- parse args ---------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)        PORT="$2";        shift 2 ;;
    --dir)         INSTALL_DIR="$2"; shift 2 ;;
    --no-service)  INSTALL_SERVICE=false; shift ;;
    --help|-h)
      echo "Usage: bash install.sh [--port N] [--dir PATH] [--no-service]"
      exit 0 ;;
    *) warn "Unknown option: $1"; shift ;;
  esac
done

# --- banner -------------------------------------------------------------------
echo -e "${CY}"
cat << 'BANNER'
  ████████╗███████╗███╗   ██╗████████╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
     ██╔══╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
     ██║   █████╗  ██╔██╗ ██║   ██║   ███████║██║     ██║     ███████║██║ █╗ ██║
     ██║   ██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║     ██║     ██╔══██║██║███╗██║
     ██║   ███████╗██║ ╚████║   ██║   ██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
BANNER
echo -e "${DI}  Distributed AI Inference Cluster Management${RS}"
echo ""

# --- root check ---------------------------------------------------------------
if [[ "$EUID" -ne 0 ]]; then
  die "Run as root: sudo bash install.sh"
fi

# --- detect OS ----------------------------------------------------------------
step "Detecting system..."

if [[ -f /etc/os-release ]]; then
  source /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
else
  die "Cannot detect OS. Supported: Debian, Ubuntu, RHEL, Rocky, AlmaLinux."
fi

is_debian() { [[ "$OS_ID" == "debian" || "$OS_ID" == "ubuntu" || "$OS_LIKE" == *"debian"* ]]; }
is_rhel()   { [[ "$OS_ID" == "rhel" || "$OS_ID" == "rocky" || "$OS_ID" == "almalinux" || "$OS_LIKE" == *"rhel"* ]]; }

if is_debian; then
  ok "Debian/Ubuntu ($PRETTY_NAME)"
elif is_rhel; then
  ok "RHEL-compatible ($PRETTY_NAME)"
else
  warn "Untested OS: $PRETTY_NAME — attempting anyway"
fi

# --- Node.js ------------------------------------------------------------------
step "Checking Node.js..."

install_node() {
  echo -e "  Installing Node.js $NODE_MIN..."
  if is_debian; then
    apt-get update -qq
    apt-get install -y ca-certificates curl gnupg -qq
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN}.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs -qq
  elif is_rhel; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MIN}.x | bash - >/dev/null 2>&1
    yum install -y nodejs -q
  else
    die "Cannot auto-install Node.js on this OS. Install Node $NODE_MIN+ manually and re-run."
  fi
}

if command -v node &>/dev/null; then
  NODE_VER=$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])')
  if [[ "$NODE_VER" -ge "$NODE_MIN" ]]; then
    ok "Node.js $(node --version)"
  else
    warn "Node.js v$NODE_VER is too old (need v$NODE_MIN+), upgrading..."
    install_node
    ok "Node.js $(node --version)"
  fi
else
  install_node
  ok "Node.js $(node --version)"
fi

# --- git ----------------------------------------------------------------------
if ! command -v git &>/dev/null; then
  step "Installing git..."
  is_debian && apt-get install -y git -qq || yum install -y git -q
fi
ok "git $(git --version | awk '{print $3}')"

# --- clone / update -----------------------------------------------------------
step "Fetching TentaCLAW OS..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
  CURRENT=$(git -C "$INSTALL_DIR" rev-parse --short HEAD)
  git -C "$INSTALL_DIR" fetch origin -q
  git -C "$INSTALL_DIR" reset --hard origin/master -q
  NEW=$(git -C "$INSTALL_DIR" rev-parse --short HEAD)
  if [[ "$CURRENT" == "$NEW" ]]; then
    ok "Already up to date ($NEW)"
  else
    ok "Updated $CURRENT → $NEW"
  fi
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR" -q
  ok "Cloned to $INSTALL_DIR"
fi

# --- build gateway ------------------------------------------------------------
step "Building gateway..."
cd "$INSTALL_DIR/gateway"
npm install --silent
npm run build
npm prune --omit=dev --silent
ok "Gateway built"

# --- build dashboard ----------------------------------------------------------
step "Building dashboard..."
cd "$INSTALL_DIR/dashboard"
npm install --silent
npm run build
mkdir -p "$INSTALL_DIR/gateway/public"
cp -r dist/. "$INSTALL_DIR/gateway/public/"
ok "Dashboard built and copied to gateway/public/"

# --- systemd ------------------------------------------------------------------
if [[ "$INSTALL_SERVICE" == true ]] && command -v systemctl &>/dev/null; then
  step "Installing systemd service..."

  cat > /etc/systemd/system/tentaclaw.service <<EOF
[Unit]
Description=TentaCLAW OS Gateway
Documentation=https://tentaclaw.io/docs
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/gateway
Environment=TENTACLAW_PORT=$PORT
Environment=TENTACLAW_HOST=0.0.0.0
Environment=NODE_ENV=production
ExecStart=$(which node) dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tentaclaw

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable tentaclaw -q
  systemctl restart tentaclaw

  # wait up to 5s for it to start
  for i in {1..10}; do
    sleep 0.5
    systemctl is-active tentaclaw -q && break
  done

  if systemctl is-active tentaclaw -q; then
    ok "Service running (systemctl status tentaclaw)"
  else
    warn "Service may not have started — check: journalctl -fu tentaclaw"
  fi
else
  step "Skipping systemd (--no-service or systemd not available)"
  warn "Start manually: cd $INSTALL_DIR/gateway && TENTACLAW_PORT=$PORT node dist/index.js"
fi

# --- done ---------------------------------------------------------------------
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${CY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RS}"
echo -e "${GR}  TentaCLAW OS installed successfully!${RS}"
echo -e "${CY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RS}"
echo ""
echo -e "  Dashboard   ${YE}http://$IP:$PORT/dashboard${RS}"
echo -e "  API         ${YE}http://$IP:$PORT/api/v1${RS}"
echo ""
echo -e "  ${DI}Logs:    journalctl -fu tentaclaw${RS}"
echo -e "  ${DI}Stop:    systemctl stop tentaclaw${RS}"
echo -e "  ${DI}Update:  bash $INSTALL_DIR/install.sh${RS}"
echo ""
echo -e "  ${PU}Point your cluster agents at: http://$IP:$PORT${RS}"
echo ""
