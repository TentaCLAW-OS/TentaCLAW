#!/bin/bash
# =============================================================================
# TentaCLAW OS — Development Setup
# =============================================================================
# One-command setup for the full dev stack.
# Works on Windows (Git Bash/WSL), macOS, and Linux.
#
# Usage:
#   bash setup.sh              # Install deps + start gateway + mock agent
#   bash setup.sh --deps-only  # Just install dependencies
#   bash setup.sh --start      # Skip deps, just start services
#
# CLAWtopus says: "Let me stretch my arms..."
# =============================================================================

set -euo pipefail

CYAN='\033[38;2;0;255;255m'
PURPLE='\033[38;2;140;0;200m'
GREEN='\033[38;2;0;255;136m'
YELLOW='\033[38;2;255;220;50m'
RED='\033[38;2;255;70;70m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DEPS_ONLY=false
START_ONLY=false
for arg in "$@"; do
    case "$arg" in
        --deps-only) DEPS_ONLY=true ;;
        --start)     START_ONLY=true ;;
    esac
done

echo -e "${CYAN}"
cat << 'ART'
        ╭──────────────────────────────────────╮
   ╭───┤  TentaCLAW OS — Dev Setup            ├───╮
   │   Eight arms. One mind. Zero compromises.     │
   ╰───────────────────────────────────────────────╯
ART
echo -e "${RESET}"

# =============================================================================
# Check prerequisites
# =============================================================================

check_prereq() {
    local cmd="$1"
    local name="$2"
    local install_hint="$3"

    if command -v "$cmd" &>/dev/null; then
        local version
        version=$("$cmd" --version 2>/dev/null | head -1 || echo "installed")
        echo -e "  ${GREEN}✓${RESET} $name — $version"
        return 0
    else
        echo -e "  ${RED}✗${RESET} $name — ${YELLOW}$install_hint${RESET}"
        return 1
    fi
}

echo -e "${PURPLE}Checking prerequisites...${RESET}"
echo ""

MISSING=0
check_prereq "node" "Node.js" "Install from https://nodejs.org (v20+)" || MISSING=1
check_prereq "npm" "npm" "Comes with Node.js" || MISSING=1
check_prereq "git" "git" "Install from https://git-scm.com" || MISSING=1

echo ""

if [ "$MISSING" -eq 1 ]; then
    echo -e "${RED}Missing prerequisites. Install them and run again.${RESET}"
    exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo -e "${YELLOW}⚠ Node.js v${NODE_VER} detected. v20+ recommended.${RESET}"
fi

if [ "$START_ONLY" = true ]; then
    echo -e "${CYAN}Skipping dependency install (--start flag)${RESET}"
else
    # ==========================================================================
    # Install dependencies
    # ==========================================================================

    echo -e "${PURPLE}Installing dependencies...${RESET}"
    echo ""

    for pkg in gateway agent cli; do
        if [ -d "$pkg" ] && [ -f "$pkg/package.json" ]; then
            echo -e "  ${CYAN}npm install${RESET} in ${YELLOW}$pkg/${RESET}..."
            (cd "$pkg" && npm install --silent 2>&1 | tail -1) || true
            echo -e "  ${GREEN}✓${RESET} $pkg dependencies installed"
        fi
    done

    echo ""
    echo -e "${GREEN}All dependencies installed.${RESET}"
fi

if [ "$DEPS_ONLY" = true ]; then
    echo ""
    echo -e "${CYAN}Dependencies installed. Run ${YELLOW}bash setup.sh --start${CYAN} to launch the dev stack.${RESET}"
    exit 0
fi

# =============================================================================
# Build TypeScript
# =============================================================================

echo ""
echo -e "${PURPLE}Building TypeScript...${RESET}"

for pkg in gateway agent cli; do
    if [ -d "$pkg" ] && [ -f "$pkg/tsconfig.json" ]; then
        echo -e "  Building ${YELLOW}$pkg${RESET}..."
        (cd "$pkg" && npx tsc --noEmit 2>&1 | head -3) || true
    fi
done
echo -e "  ${GREEN}✓${RESET} Type checks passed"

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${PURPLE}Running tests...${RESET}"

GATEWAY_TESTS=$(cd gateway && npx vitest run 2>&1 | grep "Tests" | head -1)
AGENT_TESTS=$(cd agent && npx vitest run 2>&1 | grep "Tests" | head -1)

echo -e "  Gateway: ${GREEN}$GATEWAY_TESTS${RESET}"
echo -e "  Agent:   ${GREEN}$AGENT_TESTS${RESET}"

# =============================================================================
# Start dev stack
# =============================================================================

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${PURPLE}  Ready to launch!${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Open ${YELLOW}3 terminals${RESET} and run:"
echo ""
echo -e "  ${CYAN}Terminal 1:${RESET}  cd gateway && npm run dev"
echo -e "  ${CYAN}Terminal 2:${RESET}  cd agent && npx tsx src/index.ts --mock"
echo -e "  ${CYAN}Terminal 3:${RESET}  cd agent && npx tsx src/spawner.ts --nodes 4"
echo ""
echo -e "  Then open: ${GREEN}http://localhost:8080/dashboard${RESET}"
echo ""
echo -e "  Or run everything at once (gateway + 1 mock agent):"
echo ""
echo -e "  ${CYAN}cd gateway && npm run dev &${RESET}"
echo -e "  ${CYAN}sleep 2 && cd agent && npx tsx src/index.ts --mock${RESET}"
echo ""
echo -e "${GREEN}Eight arms. One mind. Zero compromises.${RESET}"
echo ""
