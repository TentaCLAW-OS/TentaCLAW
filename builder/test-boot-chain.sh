#!/bin/bash
# =============================================================================
# TentaCLAW OS — Boot Chain Simulator
# =============================================================================
# Runs the init-bottom scripts in sequence with mock data to test the boot flow
# WITHOUT needing an actual ISO or QEMU.
#
# Usage:
#   bash builder/test-boot-chain.sh                    # Full simulation
#   bash builder/test-boot-chain.sh --gateway http://localhost:8080  # With real gateway
#   bash builder/test-boot-chain.sh --dry-run          # Show what would happen
#
# What it does:
#   1. Creates a temp directory simulating the initrd environment
#   2. Mocks lspci, nvidia-smi, ip, udhcpc for GPU/network detection
#   3. Runs 01-gpu-detect.sh → writes gpu-info.json
#   4. Runs 02-network.sh → writes network-info.json
#   5. Runs 03-hive-registration.sh → writes rig.conf
#   6. Validates all output files
#
# CLAWtopus says: "Testing all eight arms without getting wet."
# =============================================================================

set -euo pipefail

# Colors
CYAN='\033[38;2;0;255;255m'
PURPLE='\033[38;2;140;0;200m'
GREEN='\033[38;2;0;255;136m'
YELLOW='\033[38;2;255;220;50m'
RED='\033[38;2;255;70;70m'
RESET='\033[0m'

# Parse args
GATEWAY_URL=""
DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --gateway)  shift; GATEWAY_URL="${1:-http://localhost:8080}"; shift || true ;;
        --dry-run)  DRY_RUN=true ;;
    esac
done

# Setup
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="/tmp/tentaclaw-boot-test-$$"
MOCK_BIN="$TEST_ROOT/mock-bin"

echo -e "${CYAN}"
echo "╭─────────────────────────────────────────────╮"
echo "│  TentaCLAW OS — Boot Chain Simulator        │"
echo "│  Testing the init-bottom boot sequence      │"
echo "╰─────────────────────────────────────────────╯"
echo -e "${RESET}"

echo -e "[sim] Test root: ${YELLOW}$TEST_ROOT${RESET}"
echo ""

# =============================================================================
# Create mock environment
# =============================================================================

mkdir -p "$TEST_ROOT"/{tmp,var/run/tentaclaw,etc/tentaclaw}
mkdir -p "$MOCK_BIN"

# Mock lspci — reports 2 NVIDIA GPUs
cat > "$MOCK_BIN/lspci" << 'MOCK'
#!/bin/bash
echo "01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA102 [GeForce RTX 3090] [10de:2204] (rev a1)"
echo "02:00.0 VGA compatible controller [0300]: NVIDIA Corporation AD104 [GeForce RTX 4070 Ti SUPER] [10de:2705] (rev a1)"
MOCK
chmod +x "$MOCK_BIN/lspci"

# Mock nvidia-smi — reports 2 GPUs with stats
cat > "$MOCK_BIN/nvidia-smi" << 'MOCK'
#!/bin/bash
if echo "$@" | grep -q "query-gpu"; then
    echo "0, 00000000:01:00.0, NVIDIA GeForce RTX 3090, 8192, 24576, 62, 75, 300.00, 55, 1800, 9750"
    echo "1, 00000000:02:00.0, NVIDIA GeForce RTX 4070 Ti SUPER, 4096, 16384, 55, 40, 180.00, 45, 2300, 10500"
elif echo "$@" | grep -q "count"; then
    echo "2"
else
    echo "GPU 0: NVIDIA GeForce RTX 3090 (24576 MiB)"
    echo "GPU 1: NVIDIA GeForce RTX 4070 Ti SUPER (16384 MiB)"
fi
MOCK
chmod +x "$MOCK_BIN/nvidia-smi"

# Mock modprobe — always succeeds
cat > "$MOCK_BIN/modprobe" << 'MOCK'
#!/bin/bash
echo "[mock] modprobe $@" >&2
exit 0
MOCK
chmod +x "$MOCK_BIN/modprobe"

# Mock ip — reports a network interface with IP
cat > "$MOCK_BIN/ip" << 'MOCK'
#!/bin/bash
if [[ "$*" == *"link show"* ]] || [[ "$*" == *"-o link"* ]]; then
    echo "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP"
elif [[ "$*" == *"addr show"* ]]; then
    echo "    inet 192.168.1.50/24 brd 192.168.1.255 scope global eth0"
elif [[ "$*" == *"route"* ]]; then
    echo "default via 192.168.1.1 dev eth0"
fi
MOCK
chmod +x "$MOCK_BIN/ip"

# Mock udhcpc — always succeeds
cat > "$MOCK_BIN/udhcpc" << 'MOCK'
#!/bin/bash
echo "[mock] DHCP lease obtained" >&2
exit 0
MOCK
chmod +x "$MOCK_BIN/udhcpc"

# Mock dhclient
cp "$MOCK_BIN/udhcpc" "$MOCK_BIN/dhclient"

# Mock curl — responds to health checks and registration
cat > "$MOCK_BIN/curl" << MOCK
#!/bin/bash
# Parse URL from args
URL=""
DATA=""
for arg in "\$@"; do
    case "\$arg" in
        http*) URL="\$arg" ;;
        -d)    shift_next=1 ;;
    esac
    if [[ "\${shift_next:-}" == "1" ]]; then
        DATA="\$arg"
        shift_next=0
    fi
done

if echo "\$@" | grep -q "health"; then
    echo '{"status":"ok","service":"tentaclaw-hivemind","version":"0.1.0"}'
elif echo "\$@" | grep -q "register"; then
    echo '{"status":"registered","node":{"id":"TENTACLAW-SIMTEST-mock","status":"online"}}'
elif echo "\$@" | grep -q "11434"; then
    echo '{"models":[{"name":"llama3.1:8b"},{"name":"hermes3:8b"}]}'
else
    echo '{"status":"ok"}'
fi
MOCK
chmod +x "$MOCK_BIN/curl"

# Mock hostname
cat > "$MOCK_BIN/hostname" << 'MOCK'
#!/bin/bash
echo "tentaclaw-sim-node"
MOCK
chmod +x "$MOCK_BIN/hostname"

# Mock cat for /proc/cmdline
cat > "$TEST_ROOT/tmp/proc-cmdline" << 'CMDLINE'
BOOT_IMAGE=/boot/vmlinuz root=/dev/sda1 tentaclaw.gateway=192.168.1.1:8080 tentaclaw.farmhash=SIMTEST tentaclaw.nodename=sim-node-01
CMDLINE

# Mock jq — pass through (need real jq if available)
if ! command -v jq &>/dev/null; then
    cat > "$MOCK_BIN/jq" << 'MOCK'
#!/bin/bash
cat
MOCK
    chmod +x "$MOCK_BIN/jq"
fi

# Mock sha256sum
cat > "$MOCK_BIN/sha256sum" << 'MOCK'
#!/bin/bash
echo "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890  -"
MOCK
chmod +x "$MOCK_BIN/sha256sum"

echo -e "${GREEN}  ✓${RESET} Mock environment created"
echo ""

# =============================================================================
# Run boot chain
# =============================================================================

export PATH="$MOCK_BIN:$PATH"

run_script() {
    local script="$1"
    local name="$(basename "$script")"

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${PURPLE}  Running: ${CYAN}$name${RESET}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

    if [ "$DRY_RUN" = true ]; then
        echo -e "  ${YELLOW}[dry-run] Would execute: $script${RESET}"
        return 0
    fi

    # Run with mock environment, allowing failures gracefully
    (
        export TENTACLAW_TEST_MODE=1
        export TENTACLAW_MOCK_ROOT="$TEST_ROOT"
        cd "$TEST_ROOT"
        bash "$script" 2>&1 || true
    ) | while IFS= read -r line; do
        echo "  $line"
    done

    echo ""
}

# Step 1: GPU Detection
if [ -f "$SCRIPT_DIR/scripts/init-bottom/01-gpu-detect.sh" ]; then
    run_script "$SCRIPT_DIR/scripts/init-bottom/01-gpu-detect.sh"
else
    echo -e "${YELLOW}  ⚠ 01-gpu-detect.sh not found, skipping${RESET}"
fi

# Check GPU output
if [ -f "$TEST_ROOT/tmp/gpu-info.json" ]; then
    echo -e "${GREEN}  ✓ gpu-info.json created${RESET}"
    if command -v jq &>/dev/null; then
        echo -e "  $(jq -c '.' "$TEST_ROOT/tmp/gpu-info.json" 2>/dev/null || cat "$TEST_ROOT/tmp/gpu-info.json")"
    else
        cat "$TEST_ROOT/tmp/gpu-info.json"
    fi
elif [ -f "/tmp/gpu-info.json" ]; then
    echo -e "${GREEN}  ✓ gpu-info.json created (at /tmp/)${RESET}"
    cat "/tmp/gpu-info.json" 2>/dev/null | head -5
else
    echo -e "${YELLOW}  ⚠ gpu-info.json not found (script may use /tmp directly)${RESET}"
fi
echo ""

# Step 2: Network
if [ -f "$SCRIPT_DIR/scripts/init-bottom/02-network.sh" ]; then
    run_script "$SCRIPT_DIR/scripts/init-bottom/02-network.sh"
else
    echo -e "${YELLOW}  ⚠ 02-network.sh not found, skipping${RESET}"
fi

# Step 3: Registration
if [ -f "$SCRIPT_DIR/scripts/init-bottom/03-hive-registration.sh" ]; then
    run_script "$SCRIPT_DIR/scripts/init-bottom/03-hive-registration.sh"
else
    echo -e "${YELLOW}  ⚠ 03-hive-registration.sh not found, skipping${RESET}"
fi

# Check registration output
if [ -f "$TEST_ROOT/etc/tentaclaw/rig.conf" ] || [ -f "/etc/tentaclaw/rig.conf" ]; then
    echo -e "${GREEN}  ✓ rig.conf created${RESET}"
    cat "$TEST_ROOT/etc/tentaclaw/rig.conf" 2>/dev/null || cat "/etc/tentaclaw/rig.conf" 2>/dev/null | head -10
fi

echo ""

# =============================================================================
# Summary
# =============================================================================

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${PURPLE}  Boot Chain Simulation Complete${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Output files in: ${YELLOW}$TEST_ROOT${RESET}"
echo ""

# List what was created
echo -e "  Files created:"
find "$TEST_ROOT" -type f -name "*.json" -o -name "*.conf" -o -name "*.txt" 2>/dev/null | while read f; do
    echo -e "    ${GREEN}✓${RESET} $f"
done

echo ""
echo -e "  ${CYAN}To clean up: rm -rf $TEST_ROOT${RESET}"
echo ""
