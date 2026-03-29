#!/bin/bash
# =============================================================================
# TentaCLAW OS — Network Bring-Up Script (init-bottom)
# =============================================================================
# Runs inside initrd during early boot, BEFORE switchroot.
# Brings up networking via DHCP and discovers the TentaCLAW gateway.
#
# CLAWtopus says: "I need to reach out to my other arms."
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
NETWORK_INFO_FILE="/tmp/network-info.json"

log() {
    echo -e "${CYAN}[network]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[network]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[network]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[network]${RESET} $*" >&2
}

# =============================================================================
# Step 1: Parse kernel command line for gateway
# =============================================================================
parse_cmdline() {
    log "Parsing kernel command line..."

    # Try to get gateway from cmdline
    CMDLINE=$(cat /proc/cmdline 2>/dev/null || echo "")

    GATEWAY_IP=$(echo "$CMDLINE" | tr ' ' '\n' | grep '^tentaclaw\.gateway=' | cut -d= -f2 || echo "")
    FARM_HASH=$(echo "$CMDLINE" | tr ' ' '\n' | grep '^tentaclaw\.farmhash=' | cut -d= -f2 || echo "")
    NODE_NAME=$(echo "$CMDLINE" | tr ' ' '\n' | grep '^tentaclaw\.nodename=' | cut -d= -f2 || echo "")
    BOOT_MODE=$(echo "$CMDLINE" | tr ' ' '\n' | grep '^tentaclaw\.mode=' | cut -d= -f2 || echo "iso")

    if [ -n "$GATEWAY_IP" ]; then
        log "Gateway from cmdline: ${GATEWAY_IP}"
    else
        log "No gateway in cmdline — will discover via DHCP/DNS"
    fi

    if [ -n "$FARM_HASH" ]; then
        log "Farm Hash from cmdline: ${FARM_HASH}"
    else
        log "No Farm Hash — will generate on first boot"
    fi
}

# =============================================================================
# Step 2: Wait for network interface
# =============================================================================
wait_for_interface() {
    log "Waiting for network interface..."

    # Common interface names
    local ifaces="eth0 enp0s3 enp0s5 ens33 em0"

    for i in $(seq 1 15); do
        for iface in $ifaces; do
            if ip link show "$iface" &>/dev/null; then
                if ip link show "$iface" | grep -q "state UP"; then
                    log "Interface ${iface} is UP after ${i}s"
                    return 0
                fi
            fi
        done
        sleep 1
    done

    # Last resort: try to bring up any interface
    for iface in $ifaces; do
        if ip link show "$iface" &>/dev/null; then
            log "Bringing up ${iface}..."
            ip link set "$iface" up 2>/dev/null || true
            sleep 2
            return 0
        fi
    done

    log_warn "No network interface found. Will retry later."
    return 1
}

# =============================================================================
# Step 3: Bring up network via DHCP
# =============================================================================
dhcp_setup() {
    log "Requesting DHCP lease..."

    # Try common DHCP clients
    local dhcp_attempted=0

    # udhcpc (busybox)
    if command -v udhcpc &>/dev/null; then
        for iface in eth0 enp0s3 ens33 em0; do
            if ip link show "$iface" &>/dev/null; then
                log "Trying udhcpc on ${iface}..."
                udhcpc -i "$iface" -q 2>/dev/null && dhcp_attempted=1 && break
            fi
        done
    fi

    # dhclient (ISC)
    if [ "$dhcp_attempted" -eq 0 ] && command -v dhclient &>/dev/null; then
        for iface in eth0 enp0s3 ens33 em0; do
            if ip link show "$iface" &>/dev/null; then
                log "Trying dhclient on ${iface}..."
                dhclient -q "$iface" 2>/dev/null && dhcp_attempted=1 && break
            fi
        done
    fi

    # ip fallback (always available)
    if [ "$dhcp_attempted" -eq 0 ]; then
        for iface in eth0 enp0s3 ens33 em0; do
            if ip link show "$iface" &>/dev/null; then
                log "Using static IP link setup on ${iface}..."
                ip link set "$iface" up
                sleep 2
                break
            fi
        done
    fi

    sleep 2

    # Show IP address (strip CIDR prefix like /24)
    local ip_addr=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | cut -d/ -f1 || echo "no IP")
    log "Node IP: ${ip_addr}"
    echo "$ip_addr" > /tmp/node-ip
}

# =============================================================================
# Step 4: Discover gateway via DNS/mDNS
# =============================================================================
discover_gateway() {
    if [ -n "$GATEWAY_IP" ]; then
        log "Gateway already specified: ${GATEWAY_IP}"
        return 0
    fi

    log "Discovering TentaCLAW gateway..."

    # Try DNS resolution for common gateway names
    local discovered=""

    # Try: tentaclaw.local, tentaclaw-gateway.local
    for name in tentaclaw-gateway tentaclaw; do
        if command -v nslookup &>/dev/null; then
            discovered=$(nslookup "$name" 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}' || echo "")
        fi
        if [ -z "$discovered" ] && command -v getent &>/dev/null; then
            discovered=$(getent hosts "$name" 2>/dev/null | awk '{print $1}' || echo "")
        fi
        if [ -z "$discovered" ] && command -v ping &>/dev/null; then
            if ping -c 1 -W 2 "$name" &>/dev/null; then
                discovered=$(ping -c 1 -W 2 "$name" 2>/dev/null | grep 'PING' | sed 's/.*(\([0-9.]*\)).*/\1/' || echo "")
            fi
        fi

        if [ -n "$discovered" ] && [ "$discovered" != "127.0.0.1" ]; then
            GATEWAY_IP="$discovered"
            log "Discovered gateway via DNS: ${GATEWAY_IP}"
            return 0
        fi
    done

    # Try gateway IP from routing table
    local default_gateway=$(ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -1 || echo "")
    if [ -n "$default_gateway" ]; then
        log "Using default gateway from routing table: ${default_gateway}"
        GATEWAY_IP="$default_gateway"
        return 0
    fi

    log_warn "Could not discover gateway. Will proceed without gateway."
    GATEWAY_IP=""
}

# =============================================================================
# Step 5: Wait for gateway to respond
# =============================================================================
wait_for_gateway() {
    if [ -z "$GATEWAY_IP" ]; then
        log_warn "No gateway IP. Operating in standalone mode."
        echo "" > "$GATEWAY_URL_FILE"
        return 0
    fi

    # Strip port if present, default to 7860
    GATEWAY_HOST=$(echo "$GATEWAY_IP" | cut -d: -f1)
    if echo "$GATEWAY_IP" | grep -q ':'; then
        GATEWAY_PORT=$(echo "$GATEWAY_IP" | cut -d: -f2)
    else
        GATEWAY_PORT="7860"
    fi

    log "Waiting for gateway at ${GATEWAY_HOST}:${GATEWAY_PORT}..."

    for i in $(seq 1 30); do
        # Try /health endpoint and validate response contains status: ok
        local health_resp
        health_resp=$(curl -sf --connect-timeout 3 "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health" 2>/dev/null || echo "")
        if [ -n "$health_resp" ]; then
            if echo "$health_resp" | jq -e '.status == "ok"' &>/dev/null; then
                log_success "Gateway health check passed after ${i}s"
                echo "${GATEWAY_HOST}:${GATEWAY_PORT}" > "$GATEWAY_URL_FILE"
                return 0
            else
                log_warn "Gateway /health responded but status is not 'ok': ${health_resp}"
            fi
        fi

        # Fallback: try root endpoint
        if curl -sf --connect-timeout 3 "http://${GATEWAY_HOST}:${GATEWAY_PORT}/" &>/dev/null; then
            log_success "Gateway responded on / after ${i}s"
            echo "${GATEWAY_HOST}:${GATEWAY_PORT}" > "$GATEWAY_URL_FILE"
            return 0
        fi

        echo -ne "\r  Waiting... ${i}/30"
        sleep 1
    done

    echo ""
    log_warn "Gateway not responding. Operating in standalone mode."
    echo "" > "$GATEWAY_URL_FILE"
}

# =============================================================================
# Step 6: Write network info
# =============================================================================
write_network_info() {
    local node_ip=$(cat /tmp/node-ip 2>/dev/null || echo "unknown")
    local mac=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/enp0s3/address 2>/dev/null || echo "unknown")
    local gateway=$(cat "$GATEWAY_URL_FILE" 2>/dev/null || echo "")

    log "Writing network info..."

    cat > "$NETWORK_INFO_FILE" << EOF
{
    "node_ip": "$node_ip",
    "mac_address": "$mac",
    "gateway": "$gateway",
    "gateway_from_cmdline": "${GATEWAY_IP:-}",
    "farm_hash": "${FARM_HASH:-}",
    "node_name": "${NODE_NAME:-}",
    "boot_mode": "$BOOT_MODE",
    "timestamp": $(date +%s)
}
EOF

    log_success "Network info written"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}  ║        ${PURPLE}CLAWtopus Network Bring-Up${CYAN}              ${RESET}"
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo ""

log "Starting network bring-up..."
log "CLAWtopus says: \"I need to reach out to my other arms.\""

parse_cmdline
wait_for_interface || true
dhcp_setup
discover_gateway
wait_for_gateway
write_network_info

echo ""

# Show final status
if [ -s "$GATEWAY_URL_FILE" ] && [ -n "$(cat "$GATEWAY_URL_FILE")" ]; then
    gw=$(cat "$GATEWAY_URL_FILE")
    log_success "Network ready. Gateway: ${gw}"
    echo -e "  ${GREEN}✓ Connected to TentaCLAW${RESET}"
else
    log_warn "Network ready but no gateway found."
    echo -e "  ${YELLOW}⚠ Operating in standalone mode${RESET}"
fi

echo ""

exit 0
