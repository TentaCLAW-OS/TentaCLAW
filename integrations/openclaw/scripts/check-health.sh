#!/usr/bin/env bash
#
# check-health.sh — Quick health check for a TentaCLAW GPU cluster
#
# Usage:
#   ./check-health.sh              # Uses TENTACLAW_GATEWAY env var
#   ./check-health.sh <gateway>    # Override gateway URL
#
# Exit codes:
#   0 — Cluster healthy (score >= 70)
#   1 — Cluster degraded (score 40-69)
#   2 — Cluster critical (score < 40)
#   3 — Gateway unreachable

set -euo pipefail

GATEWAY="${1:-${TENTACLAW_GATEWAY:-http://localhost:8080}}"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    RED='\033[0;31m'
    YELLOW='\033[1;33m'
    GREEN='\033[0;32m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' YELLOW='' GREEN='' CYAN='' BOLD='' NC=''
fi

echo -e "${BOLD}TentaCLAW Cluster Health Check${NC}"
echo "Gateway: ${GATEWAY}"
echo "────────────────────────────────────────"

# Check gateway connectivity
if ! curl -sf "${GATEWAY}/api/v1/health/score" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Gateway unreachable at ${GATEWAY}${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Verify the gateway is running"
    echo "  2. Check TENTACLAW_GATEWAY environment variable"
    echo "  3. Check firewall rules for port $(echo "$GATEWAY" | grep -oP ':\K[0-9]+$' || echo '8080')"
    exit 3
fi

# Fetch health score
HEALTH_JSON=$(curl -s "${GATEWAY}/api/v1/health/score")
HEALTH_SCORE=$(echo "$HEALTH_JSON" | jq -r '.score // "unknown"')

if [ "$HEALTH_SCORE" = "unknown" ] || [ "$HEALTH_SCORE" = "null" ]; then
    echo -e "${YELLOW}WARNING: Could not parse health score${NC}"
    echo "$HEALTH_JSON" | jq . 2>/dev/null || echo "$HEALTH_JSON"
    exit 1
fi

# Display health score with color
if [ "$HEALTH_SCORE" -ge 70 ] 2>/dev/null; then
    echo -e "Health Score: ${GREEN}${BOLD}${HEALTH_SCORE}/100${NC} (Healthy)"
elif [ "$HEALTH_SCORE" -ge 40 ] 2>/dev/null; then
    echo -e "Health Score: ${YELLOW}${BOLD}${HEALTH_SCORE}/100${NC} (Degraded)"
else
    echo -e "Health Score: ${RED}${BOLD}${HEALTH_SCORE}/100${NC} (Critical)"
fi

echo ""

# Fetch cluster summary
echo -e "${CYAN}Cluster Summary${NC}"
echo "────────────────────────────────────────"
SUMMARY=$(curl -s "${GATEWAY}/api/v1/summary")
echo "$SUMMARY" | jq -r '
    "Nodes:          \(.total_nodes // "N/A") (\(.online_nodes // "N/A") online)",
    "Models Loaded:  \(.loaded_models // "N/A")",
    "Total VRAM:     \(.total_vram_gb // "N/A") GB",
    "Used VRAM:      \(.used_vram_gb // "N/A") GB (\(.vram_utilization // "N/A")%)",
    "Active Requests: \(.active_requests // "N/A")"
' 2>/dev/null || echo "$SUMMARY" | jq .

echo ""

# Fetch node details
echo -e "${CYAN}Node Status${NC}"
echo "────────────────────────────────────────"
NODES=$(curl -s "${GATEWAY}/api/v1/nodes")
echo "$NODES" | jq -r '
    .nodes[]? |
    "\(.id // "unknown")\t\(.status // "unknown")\t\(.gpu_model // "unknown")\t\(.vram_used_gb // "?")/\(.vram_total_gb // "?") GB\t\(.temperature_c // "?")°C"
' 2>/dev/null | column -t -s $'\t' -N "NODE,STATUS,GPU,VRAM,TEMP" 2>/dev/null || echo "$NODES" | jq '.nodes[]?' 2>/dev/null || echo "$NODES" | jq .

# Check for high temperatures
HIGH_TEMP_NODES=$(echo "$NODES" | jq -r '.nodes[]? | select(.temperature_c != null and .temperature_c > 85) | "\(.id): \(.temperature_c)°C"' 2>/dev/null)
if [ -n "$HIGH_TEMP_NODES" ]; then
    echo ""
    echo -e "${RED}${BOLD}THERMAL WARNING${NC}"
    echo "The following nodes have GPU temperatures above 85°C:"
    echo "$HIGH_TEMP_NODES"
fi

echo ""

# Fetch alerts
echo -e "${CYAN}Active Alerts${NC}"
echo "────────────────────────────────────────"
ALERTS=$(curl -s "${GATEWAY}/api/v1/alerts")
ALERT_COUNT=$(echo "$ALERTS" | jq '.alerts | length' 2>/dev/null || echo "0")

if [ "$ALERT_COUNT" -eq 0 ] 2>/dev/null; then
    echo -e "${GREEN}No active alerts${NC}"
else
    echo "$ALERTS" | jq -r '.alerts[]? | "\(.severity // "info")\t\(.message // "No message")\t\(.timestamp // "")"' 2>/dev/null | \
        column -t -s $'\t' -N "SEVERITY,MESSAGE,TIME" 2>/dev/null || echo "$ALERTS" | jq '.alerts[]?'
fi

echo ""

# Loaded models
echo -e "${CYAN}Loaded Models${NC}"
echo "────────────────────────────────────────"
MODELS=$(curl -s "${GATEWAY}/api/v1/models")
MODEL_COUNT=$(echo "$MODELS" | jq '.models | length' 2>/dev/null || echo "0")

if [ "$MODEL_COUNT" -eq 0 ] 2>/dev/null; then
    echo "No models loaded. Use deploy-model.sh to deploy one."
else
    echo "$MODELS" | jq -r '.models[]? | "\(.name // "unknown")\t\(.status // "unknown")\t\(.node // "unknown")\t\(.vram_gb // "?") GB"' 2>/dev/null | \
        column -t -s $'\t' -N "MODEL,STATUS,NODE,VRAM" 2>/dev/null || echo "$MODELS" | jq '.models[]?'
fi

echo ""
echo "────────────────────────────────────────"

# Set exit code based on health score
if [ "$HEALTH_SCORE" -ge 70 ] 2>/dev/null; then
    echo -e "${GREEN}Cluster is healthy.${NC}"
    exit 0
elif [ "$HEALTH_SCORE" -ge 40 ] 2>/dev/null; then
    echo -e "${YELLOW}Cluster is degraded. Review alerts above.${NC}"
    exit 1
else
    echo -e "${RED}Cluster is in critical state. Immediate attention required.${NC}"
    exit 2
fi
