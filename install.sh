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
echo -e "${CY}"
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
echo -e "${RS}"

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

# --- Ollama -------------------------------------------------------------------
step "Checking Ollama..."

if command -v ollama &>/dev/null; then
  ok "Ollama $(ollama --version 2>/dev/null | head -1)"
else
  echo -e "  Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh >/dev/null 2>&1
  if command -v ollama &>/dev/null; then
    ok "Ollama installed"
  else
    warn "Ollama install may have failed — continuing anyway"
  fi
fi

# ensure ollama service is running
if command -v systemctl &>/dev/null && systemctl list-unit-files ollama.service &>/dev/null 2>&1; then
  systemctl enable ollama -q 2>/dev/null || true
  systemctl start ollama 2>/dev/null || true
fi

# --- detect GPU ---------------------------------------------------------------
step "Detecting GPU..."

HAS_AMD=false
HAS_NVIDIA=false
HAS_GPU=false

if command -v rocm-smi &>/dev/null || [[ -d /opt/rocm ]]; then
  HAS_AMD=true; HAS_GPU=true
  ok "AMD GPU detected (ROCm)"
elif command -v nvidia-smi &>/dev/null; then
  HAS_NVIDIA=true; HAS_GPU=true
  ok "NVIDIA GPU detected"
else
  ok "No GPU detected — CPU-only mode"
fi

# --- Octopod name -------------------------------------------------------------
step "Configuring node identity..."

# Derive a stable sequential-style pod number from the hostname
RAW_HOST=$(hostname -s 2>/dev/null || hostname)
HASH_NUM=$(echo "$RAW_HOST" | cksum | awk '{print ($1 % 99) + 1}')
POD_NAME="Octopod-${HASH_NUM}"

mkdir -p /etc/tentaclaw
cat > /etc/tentaclaw/rig.conf <<RIGEOF
# TentaCLAW node identity — auto-generated by installer
NODE_HOSTNAME=${POD_NAME}
RIGEOF
ok "Node identity: ${POD_NAME}"

# --- install all workspace deps from root -------------------------------------
step "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --silent
ok "Dependencies installed"

# --- build gateway ------------------------------------------------------------
step "Building gateway..."
npm run build --workspace=gateway
ok "Gateway built"

# --- build dashboard ----------------------------------------------------------
step "Building dashboard..."
npm run build --workspace=dashboard
ok "Dashboard built to gateway/public/"

# --- build agent --------------------------------------------------------------
step "Building agent..."
npm run build --workspace=agent
ok "Agent built"

# --- systemd ------------------------------------------------------------------
if [[ "$INSTALL_SERVICE" == true ]] && command -v systemctl &>/dev/null; then
  step "Installing systemd services..."

  NODE_BIN=$(which node)

  # Gateway service
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
ExecStart=$NODE_BIN dist/gateway/src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tentaclaw

[Install]
WantedBy=multi-user.target
EOF

  # Agent service
  cat > /etc/systemd/system/tentaclaw-agent.service <<EOF
[Unit]
Description=TentaCLAW OS Agent
Documentation=https://tentaclaw.io/docs
After=network.target tentaclaw.service
Wants=tentaclaw.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/agent
Environment=NODE_ENV=production
EnvironmentFile=-/etc/tentaclaw/rig.conf
ExecStart=$NODE_BIN dist/agent/src/index.js --gateway http://127.0.0.1:$PORT
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tentaclaw-agent

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable tentaclaw tentaclaw-agent -q
  systemctl restart tentaclaw tentaclaw-agent

  # wait up to 5s for gateway to start
  for i in {1..10}; do
    sleep 0.5
    systemctl is-active tentaclaw -q && break
  done

  if systemctl is-active tentaclaw -q; then
    ok "Gateway running (systemctl status tentaclaw)"
  else
    warn "Gateway may not have started — check: journalctl -fu tentaclaw"
  fi

  if systemctl is-active tentaclaw-agent -q; then
    ok "Agent running (systemctl status tentaclaw-agent)"
  else
    warn "Agent may not have started — check: journalctl -fu tentaclaw-agent"
  fi

  # --- background model pull --------------------------------------------------
  step "Pulling starter model..."

  if [[ "$HAS_GPU" == true ]]; then
    STARTER_MODEL="llama3.1:8b"
  else
    STARTER_MODEL="tinyllama:1.1b"
  fi

  # Pull in background — non-blocking
  (
    # wait for ollama to be ready (up to 30s)
    for i in {1..30}; do
      curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
      sleep 1
    done
    ollama pull "$STARTER_MODEL" >/dev/null 2>&1
  ) &
  disown $!

  ok "Pulling ${STARTER_MODEL} in background"

else
  step "Skipping systemd (--no-service or systemd not available)"
  warn "Start gateway: cd $INSTALL_DIR/gateway && TENTACLAW_PORT=$PORT node dist/gateway/src/index.js"
  warn "Start agent:   cd $INSTALL_DIR/agent && node dist/agent/src/index.js --gateway http://127.0.0.1:$PORT"
fi

# --- done ---------------------------------------------------------------------
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${CY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RS}"
echo -e "${GR}  TentaCLAW OS installed successfully!${RS}"
echo -e "${CY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RS}"
echo ""
echo -e "  Node        ${PU}${POD_NAME}${RS}"
echo -e "  Dashboard   ${YE}http://$IP:$PORT/dashboard${RS}"
echo -e "  API         ${YE}http://$IP:$PORT/api/v1${RS}"
echo ""
echo -e "  ${DI}Gateway: journalctl -fu tentaclaw${RS}"
echo -e "  ${DI}Agent:   journalctl -fu tentaclaw-agent${RS}"
echo -e "  ${DI}Stop:    systemctl stop tentaclaw tentaclaw-agent${RS}"
echo -e "  ${DI}Update:  bash $INSTALL_DIR/install.sh${RS}"
echo ""
echo -e "  ${PU}Point your cluster agents at: http://$IP:$PORT${RS}"
if [[ "$HAS_GPU" == true ]]; then
  echo -e "  ${DI}Model pull: ollama pull llama3.1:8b (running in background)${RS}"
else
  echo -e "  ${DI}Model pull: ollama pull tinyllama:1.1b (running in background)${RS}"
fi
echo ""
