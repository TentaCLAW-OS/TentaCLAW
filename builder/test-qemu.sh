#!/bin/bash
# =============================================================================
# TentaCLAW OS — QEMU Boot Test
# =============================================================================
# Tests the ISO in QEMU with GPU passthrough simulation.
#
# Usage:
#   bash builder/test-qemu.sh                          # Boot latest ISO
#   bash builder/test-qemu.sh --iso path/to/iso        # Boot specific ISO
#   bash builder/test-qemu.sh --ram 4096               # Set RAM (default 2048)
#   bash builder/test-qemu.sh --cpus 4                 # Set CPUs (default 2)
#   bash builder/test-qemu.sh --serial                 # Serial console (no GUI)
#   bash builder/test-qemu.sh --gateway 10.0.0.1:8080  # Set gateway IP for node
#
# TentaCLAW says: "Virtual arms are still arms."
# =============================================================================

set -euo pipefail

CYAN='\033[38;2;0;255;255m'
GREEN='\033[38;2;0;255;136m'
YELLOW='\033[38;2;255;220;50m'
RED='\033[38;2;255;70;70m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults
ISO_PATH=""
RAM=2048
CPUS=2
SERIAL=false
GATEWAY_IP=""

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --iso)      ISO_PATH="$2"; shift 2 ;;
        --ram)      RAM="$2"; shift 2 ;;
        --cpus)     CPUS="$2"; shift 2 ;;
        --serial)   SERIAL=true; shift ;;
        --gateway)  GATEWAY_IP="$2"; shift 2 ;;
        *)          shift ;;
    esac
done

# Find ISO if not specified
if [ -z "$ISO_PATH" ]; then
    ISO_PATH=$(find "$PROJECT_ROOT/iso" -name "TentaCLAW-OS-*.iso" -type f 2>/dev/null | sort -r | head -1)
    if [ -z "$ISO_PATH" ]; then
        echo -e "${RED}No ISO found. Build one first: make iso${RESET}"
        echo -e "Or specify: ${YELLOW}bash builder/test-qemu.sh --iso path/to/iso${RESET}"
        exit 1
    fi
fi

echo -e "${CYAN}"
echo "╭──────────────────────────────────────────╮"
echo "│  TentaCLAW OS — QEMU Boot Test           │"
echo "╰──────────────────────────────────────────╯"
echo -e "${RESET}"

echo -e "  ISO:     ${YELLOW}$ISO_PATH${RESET}"
echo -e "  RAM:     ${GREEN}${RAM}MB${RESET}"
echo -e "  CPUs:    ${GREEN}${CPUS}${RESET}"
echo -e "  Serial:  ${GREEN}${SERIAL}${RESET}"

if [ -n "$GATEWAY_IP" ]; then
    echo -e "  Gateway: ${GREEN}${GATEWAY_IP}${RESET}"
fi
echo ""

# Check QEMU installed
if ! command -v qemu-system-x86_64 &>/dev/null; then
    echo -e "${RED}QEMU not found.${RESET}"
    echo ""
    echo "Install with:"
    echo "  Ubuntu/Debian: sudo apt install qemu-system-x86"
    echo "  macOS:         brew install qemu"
    echo "  Windows:       choco install qemu OR download from https://www.qemu.org"
    exit 1
fi

# Build QEMU command
QEMU_ARGS=(
    -m "$RAM"
    -smp "$CPUS"
    -cdrom "$ISO_PATH"
    -boot d
    -enable-kvm 2>/dev/null || true
    -net nic,model=virtio
    -net user,hostfwd=tcp::2222-:22,hostfwd=tcp::8081-:8080
)

# Add kernel cmdline for gateway
if [ -n "$GATEWAY_IP" ]; then
    QEMU_ARGS+=(-append "tentaclaw.gateway=$GATEWAY_IP")
fi

# Serial console mode (no GUI)
if [ "$SERIAL" = true ]; then
    QEMU_ARGS+=(-nographic -serial mon:stdio)
else
    QEMU_ARGS+=(-vga virtio)
fi

echo -e "${GREEN}Starting QEMU...${RESET}"
echo -e "  SSH:       ${CYAN}ssh -p 2222 root@localhost${RESET}"
echo -e "  Dashboard: ${CYAN}http://localhost:8081/dashboard${RESET}"
echo ""

qemu-system-x86_64 "${QEMU_ARGS[@]}"
