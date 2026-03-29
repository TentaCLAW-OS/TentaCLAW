#!/bin/bash
# =============================================================================
# TentaCLAW OS — HiveMind Registration Script (init-bottom)
# =============================================================================
# Runs inside initrd during early boot, AFTER network is up.
# Generates Farm Hash from hardware, registers with HiveMind gateway.
#
# CLAWtopus says: "Let me wrap an arm around this node."
# =============================================================================

set -euo pipefail

# Colors
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'

GATEWAY_URL_FILE="/tmp/gateway-url"
GPU_INFO_FILE="/tmp/gpu-info.json"
NETWORK_INFO_FILE="/tmp/network-info.json"
REG_CONF="/etc/tentaclaw/rig.conf"

log() {
    echo -e "${CYAN}[registration]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[registration]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[registration]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[registration]${RESET} $*" >&2
}

# =============================================================================
# Step 1: Load info from previous scripts
# =============================================================================
load_info() {
    log "Loading hardware and network info..."

    # Gateway URL
    if [ -f "$GATEWAY_URL_FILE" ]; then
        GATEWAY_URL=$(cat "$GATEWAY_URL_FILE" | tr -d '\n' || echo "")
    else
        GATEWAY_URL=""
    fi

    # GPU info
    if [ -f "$GPU_INFO_FILE" ]; then
        NVIDIA_COUNT=$(jq -r '.nvidia_count // 0' "$GPU_INFO_FILE" 2>/dev/null || echo "0")
        AMD_COUNT=$(jq -r '.amd_count // 0' "$GPU_INFO_FILE" 2>/dev/null || echo "0")
        TOTAL_GPUS=$(jq -r '.total_gpus // 0' "$GPU_INFO_FILE" 2>/dev/null || echo "0")
    else
        NVIDIA_COUNT=0
        AMD_COUNT=0
        TOTAL_GPUS=0
    fi

    # Network info
    if [ -f "$NETWORK_INFO_FILE" ]; then
        NODE_IP=$(jq -r '.node_ip // "unknown"' "$NETWORK_INFO_FILE" 2>/dev/null || echo "unknown")
        MAC_ADDRESS=$(jq -r '.mac_address // "unknown"' "$NETWORK_INFO_FILE" 2>/dev/null || echo "unknown")
        FARM_HASH_CMDLINE=$(jq -r '.farm_hash // ""' "$NETWORK_INFO_FILE" 2>/dev/null || echo "")
    else
        NODE_IP="unknown"
        MAC_ADDRESS="unknown"
        FARM_HASH_CMDLINE=""
    fi

    # Check for existing config
    if [ -f "$REG_CONF" ]; then
        log "Found existing registration config — loading..."
        source "$REG_CONF"
        log_success "Loaded existing registration: ${NODE_ID:-unknown}"
        return 0
    fi

    return 1  # No existing config
}

# =============================================================================
# Step 2: Generate Farm Hash from hardware
# =============================================================================
generate_farm_hash() {
    log "Generating Farm Hash from hardware signature..."

    # Gather hardware signature components
    local cpu_model=$(cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1 | cut -d: -f2 | tr -d ' ' | head -c 50 || echo "unknown")
    local cpu_cores=$(nproc 2>/dev/null || echo "0")
    local gpu_count="$TOTAL_GPUS"

    # Get first MAC address for unique identifier
    local mac_addr="${MAC_ADDRESS:-unknown}"
    local disk_serial=""

    # Try to get disk serial
    if [ -b /dev/sda ]; then
        disk_serial=$(cat /sys/class/block/sda/device/serial 2>/dev/null || echo "")
        if [ -z "$disk_serial" ]; then
            disk_serial=$(hdparm -I /dev/sda 2>/dev/null | grep "Serial Number" | cut -d: -f2 | tr -d ' ' || echo "")
        fi
    fi

    # Build signature
    local sig="${cpu_model}${cpu_cores}${gpu_count}${mac_addr}${disk_serial}"
    sig=$(echo "$sig" | tr -d '\n\r' | head -c 256)

    # SHA256 → first 16 chars → prefix with FARM
    local hash=$(echo -n "$sig" | sha256sum 2>/dev/null | cut -c1-16)

    # Convert to base36-ish (uppercase alphanumeric)
    FARM_HASH="FARM${hash^^}"
    FARM_HASH="${FARM_HASH:0:12}"  # Ensure max 12 chars

    log "Generated Farm Hash: ${FARM_HASH}"
    echo "$FARM_HASH" > /tmp/generated-farm-hash
}

# =============================================================================
# Step 3: Generate Node ID
# =============================================================================
generate_node_id() {
    log "Generating Node ID..."

    # Try to get persistent node ID from /etc if this is a re-run
    if [ -f /etc/machine-id ]; then
        local machine_id=$(cat /etc/machine-id 2>/dev/null | head -c 8 || echo "")
        NODE_SUFFIX="${machine_id}"
    else
        # Random suffix
        NODE_SUFFIX=$(cat /proc/sys/kernel/random/uuid 2>/dev/null | cut -c1-6 || echo "$$")
    fi

    NODE_ID="TENTACLAW-${FARM_HASH}-${NODE_SUFFIX}"
    NODE_HOSTNAME="tentaclaw-${NODE_SUFFIX}"

    log "Node ID: ${NODE_ID}"
}

# =============================================================================
# Step 4: Determine capabilities
# =============================================================================
determine_capabilities() {
    log "Determining node capabilities..."

    # CPU threads
    CPU_THREADS=$(nproc 2>/dev/null || echo "1")

    # Total VRAM
    VRAM_MB=0
    if [ -f "$GPU_INFO_FILE" ]; then
        VRAM_MB=$(jq '[.nvidia_gpus[].vram_mb // 0] | add // 0' "$GPU_INFO_FILE" 2>/dev/null || echo "0")
    fi

    # Inference backends (check what's installed)
    INFERENCE_BACKENDS="[\"ollama\",\"llamacpp\"]"
    if command -v ollama &>/dev/null; then
        INFERENCE_BACKENDS="[\"ollama\",\"llamacpp\"]"
    fi

    # GPU names
    GPU_NAMES="[]"
    if [ -f "$GPU_INFO_FILE" ]; then
        GPU_NAMES=$(jq '[.nvidia_gpus[].name] + [.amd_gpus[].name]' "$GPU_INFO_FILE" 2>/dev/null || echo "[]")
    fi
}

# =============================================================================
# Step 5: Register with gateway
# =============================================================================
register_with_gateway() {
    if [ -z "$GATEWAY_URL" ]; then
        log_warn "No gateway URL. Skipping registration."
        return 1
    fi

    # Parse host and port from gateway URL
    local gw_host=$(echo "$GATEWAY_URL" | cut -d: -f1)
    local gw_port
    if echo "$GATEWAY_URL" | grep -q ':'; then
        gw_port=$(echo "$GATEWAY_URL" | cut -d: -f2)
    else
        gw_port="7860"
    fi

    log "Registering with HiveMind gateway at ${gw_host}:${gw_port}..."

    # Determine OS version
    local os_version
    os_version=$(cat /etc/tentaclaw/version 2>/dev/null || echo "TentaCLAW-OS-0.1.0")

    # Build registration payload
    # Gateway API contract: POST /api/v1/register
    # Required fields: node_id, farm_hash, hostname, ip_address, mac_address, gpu_count, os_version
    local register_json=$(cat << EOF
{
    "node_id": "$NODE_ID",
    "farm_hash": "$FARM_HASH",
    "hostname": "$NODE_HOSTNAME",
    "ip_address": "$NODE_IP",
    "mac_address": "$MAC_ADDRESS",
    "gpu_count": $TOTAL_GPUS,
    "os_version": "$os_version"
}
EOF
)

    # Try registration
    local max_retries=5
    local retry=0

    while [ $retry -lt $max_retries ]; do
        if [ $retry -gt 0 ]; then
            log "Retry ${retry}/${max_retries}..."
            sleep 2
        fi

        # POST to registration endpoint
        local response=$(curl -sf --connect-timeout 5 \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$register_json" \
            "http://${gw_host}:${gw_port}/api/v1/register" 2>&1 || echo "")

        if [ -n "$response" ]; then
            log_success "Registration successful!"

            # Extract gateway config from response
            if echo "$response" | jq -e '.gateway_url' &>/dev/null; then
                GATEWAY_URL=$(echo "$response" | jq -r '.gateway_url')
                log "Gateway confirmed: ${GATEWAY_URL}"
            fi

            # Save response for later use
            echo "$response" > /tmp/registration-response.json

            return 0
        fi

        retry=$((retry + 1))
    done

    log_warn "Registration failed after ${max_retries} attempts. Will operate standalone."
    return 1
}

# =============================================================================
# Step 6: Write persistent config
# =============================================================================
write_config() {
    log "Writing persistent config to ${REG_CONF}..."

    mkdir -p /etc/tentaclaw

    cat > "$REG_CONF" << EOF
# TentaCLAW Node Configuration
# Auto-generated on first boot. CLAWtopus says: "This is mine now."
# Edit at your own risk. She'll know.

FARM_HASH=$FARM_HASH
NODE_ID=$NODE_ID
NODE_HOSTNAME=$NODE_HOSTNAME
GATEWAY_URL=${GATEWAY_URL:-}
NODE_IP=$NODE_IP
MAC_ADDRESS=$MAC_ADDRESS

# Hardware
GPU_COUNT=$TOTAL_GPUS
NVIDIA_COUNT=$NVIDIA_COUNT
AMD_COUNT=$AMD_COUNT
VRAM_MB=$VRAM_MB
CPU_THREADS=$CPU_THREADS

# Inference
INFERENCE_BACKENDS=ollama,llamacpp

# Agent config
AGENT_INTERVAL=10
AGENT_STATS_URL=http://${GATEWAY_URL:-}/api/v1/nodes/${NODE_ID}/stats

# Last registration
LAST_REGISTER=$(date +%s)
EOF

    chmod 600 "$REG_CONF" 2>/dev/null || true

    log_success "Config written: ${REG_CONF}"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}  ║        ${PURPLE}CLAWtopus HiveMind Registration${CYAN}         ${RESET}"
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo ""

log "Starting registration..."
log "CLAWtopus says: \"Let me wrap an arm around this node.\""

# Check if already registered
if load_info; then
    echo ""
    log_success "Already registered as ${NODE_ID}"
    echo -e "  ${GREEN}✓ Farm Hash: ${FARM_HASH}${RESET}"
    echo -e "  ${GREEN}✓ Node ID: ${NODE_ID}${RESET}"
    echo ""
    exit 0
fi

# Generate Farm Hash
generate_farm_hash

# Generate Node ID
generate_node_id

# Determine capabilities
determine_capabilities

# Register with gateway (if available)
register_with_gateway || true

# Write persistent config
write_config

echo ""

# Show summary
echo -e "  ${BOLD}${PURPLE}╭─────────────────────────────────────╮${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  ${BOLD}${WHITE}Registration Summary${RESET}              ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}├─────────────────────────────────────┤${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  Farm Hash: ${CYAN}${FARM_HASH}${RESET}           ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  Node ID:   ${CYAN}${NODE_ID}${RESET}  ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  GPUs:      ${CYAN}${TOTAL_GPUS} total${RESET}           ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  VRAM:      ${CYAN}${VRAM_MB}MB${RESET}              ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}│${RESET}  Gateway:   ${CYAN}${GATEWAY_URL:-standalone}${RESET} ${BOLD}${PURPLE}│${RESET}"
echo -e "  ${BOLD}${PURPLE}╰─────────────────────────────────────╯${RESET}"
echo ""

if [ -n "$GATEWAY_URL" ]; then
    log_success "Node registered with HiveMind"
    echo -e "  ${GREEN}✓ All arms accounted for.${RESET}"
else
    log_warn "No gateway found. Node will operate in standalone mode."
    echo -e "  ${YELLOW}⚠ CLAWtopus is flying solo.${RESET}"
fi

echo ""

exit 0
