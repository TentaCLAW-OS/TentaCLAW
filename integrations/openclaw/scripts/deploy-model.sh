#!/usr/bin/env bash
#
# deploy-model.sh — Deploy a model to a TentaCLAW GPU cluster
#
# Usage:
#   ./deploy-model.sh <model>                        # Deploy with default quantization
#   ./deploy-model.sh <model> <quantization>         # Deploy with specific quantization
#   ./deploy-model.sh <model> <quantization> <node>  # Deploy to a specific node
#
# Examples:
#   ./deploy-model.sh llama-3.1-8b-q4_k_m
#   ./deploy-model.sh mistral-7b Q5_K_M
#   ./deploy-model.sh llama-3.1-8b-q4_k_m Q4_K_M node-gpu-01
#
# Environment:
#   TENTACLAW_GATEWAY  Gateway URL (default: http://localhost:8080)
#
# Exit codes:
#   0 — Model deployed successfully
#   1 — Deployment failed
#   2 — Pre-flight checks failed (insufficient VRAM, unhealthy cluster)
#   3 — Gateway unreachable

set -euo pipefail

GATEWAY="${TENTACLAW_GATEWAY:-http://localhost:8080}"
MODEL="${1:-}"
QUANTIZATION="${2:-}"
NODE="${3:-}"

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

# --- Usage ---

if [ -z "$MODEL" ]; then
    echo "Usage: $0 <model> [quantization] [node]"
    echo ""
    echo "Examples:"
    echo "  $0 llama-3.1-8b-q4_k_m"
    echo "  $0 mistral-7b Q5_K_M"
    echo "  $0 llama-3.1-8b-q4_k_m Q4_K_M node-gpu-01"
    echo ""
    echo "Set TENTACLAW_GATEWAY to point at your cluster (default: http://localhost:8080)"
    exit 1
fi

echo -e "${BOLD}TentaCLAW Model Deployment${NC}"
echo "Gateway: ${GATEWAY}"
echo "Model:   ${MODEL}"
[ -n "$QUANTIZATION" ] && echo "Quant:   ${QUANTIZATION}"
[ -n "$NODE" ] && echo "Node:    ${NODE}"
echo "────────────────────────────────────────"

# --- Pre-flight: Gateway connectivity ---

echo -e "\n${CYAN}[1/5] Checking gateway connectivity...${NC}"

if ! curl -sf "${GATEWAY}/api/v1/health/score" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Gateway unreachable at ${GATEWAY}${NC}"
    echo "Set TENTACLAW_GATEWAY to your cluster's gateway URL."
    exit 3
fi
echo -e "${GREEN}Gateway reachable.${NC}"

# --- Pre-flight: Cluster health ---

echo -e "\n${CYAN}[2/5] Checking cluster health...${NC}"

HEALTH_JSON=$(curl -s "${GATEWAY}/api/v1/health/score")
HEALTH_SCORE=$(echo "$HEALTH_JSON" | jq -r '.score // 0')

if [ "$HEALTH_SCORE" -lt 40 ] 2>/dev/null; then
    echo -e "${RED}ERROR: Cluster health is critical (score: ${HEALTH_SCORE}/100).${NC}"
    echo "Resolve cluster issues before deploying. Run check-health.sh for details."
    exit 2
elif [ "$HEALTH_SCORE" -lt 70 ] 2>/dev/null; then
    echo -e "${YELLOW}WARNING: Cluster health is degraded (score: ${HEALTH_SCORE}/100).${NC}"
    echo "Proceeding with deployment, but monitor closely."
else
    echo -e "${GREEN}Cluster healthy (score: ${HEALTH_SCORE}/100).${NC}"
fi

# --- Pre-flight: VRAM estimate ---

echo -e "\n${CYAN}[3/5] Estimating VRAM requirements...${NC}"

VRAM_QUERY="model=${MODEL}"
[ -n "$QUANTIZATION" ] && VRAM_QUERY="${VRAM_QUERY}&quantization=${QUANTIZATION}"

VRAM_JSON=$(curl -s "${GATEWAY}/api/v1/models/estimate-vram?${VRAM_QUERY}")
VRAM_REQUIRED=$(echo "$VRAM_JSON" | jq -r '.estimated_vram_gb // "unknown"')

if [ "$VRAM_REQUIRED" = "unknown" ] || [ "$VRAM_REQUIRED" = "null" ]; then
    echo -e "${YELLOW}Could not estimate VRAM. Proceeding anyway.${NC}"
else
    echo "Estimated VRAM: ${VRAM_REQUIRED} GB"

    # Check available VRAM across cluster
    SUMMARY=$(curl -s "${GATEWAY}/api/v1/summary")
    TOTAL_VRAM=$(echo "$SUMMARY" | jq -r '.total_vram_gb // 0')
    USED_VRAM=$(echo "$SUMMARY" | jq -r '.used_vram_gb // 0')

    AVAILABLE_VRAM=$(echo "$TOTAL_VRAM - $USED_VRAM" | bc 2>/dev/null || echo "unknown")

    if [ "$AVAILABLE_VRAM" != "unknown" ]; then
        echo "Available VRAM: ${AVAILABLE_VRAM} GB"

        FITS=$(echo "$AVAILABLE_VRAM >= $VRAM_REQUIRED" | bc 2>/dev/null || echo "1")
        if [ "$FITS" -eq 0 ] 2>/dev/null; then
            echo -e "${RED}ERROR: Insufficient VRAM. Need ${VRAM_REQUIRED} GB, only ${AVAILABLE_VRAM} GB available.${NC}"
            echo ""
            echo "Options:"
            echo "  - Undeploy unused models to free VRAM"
            echo "  - Use a smaller quantization (e.g., Q4_K_M instead of Q8_0)"
            echo "  - Add more GPU nodes to the cluster"
            exit 2
        fi
        echo -e "${GREEN}Sufficient VRAM available.${NC}"
    fi
fi

# --- Deploy ---

echo -e "\n${CYAN}[4/5] Deploying model...${NC}"

# Build JSON payload
PAYLOAD="{\"model\":\"${MODEL}\""
[ -n "$QUANTIZATION" ] && PAYLOAD="${PAYLOAD},\"quantization\":\"${QUANTIZATION}\""
[ -n "$NODE" ] && PAYLOAD="${PAYLOAD},\"node\":\"${NODE}\""
PAYLOAD="${PAYLOAD}}"

DEPLOY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GATEWAY}/api/v1/deploy" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

HTTP_CODE=$(echo "$DEPLOY_RESPONSE" | tail -n1)
DEPLOY_BODY=$(echo "$DEPLOY_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
    echo -e "${GREEN}Deploy request accepted.${NC}"
    echo "$DEPLOY_BODY" | jq . 2>/dev/null || echo "$DEPLOY_BODY"
else
    echo -e "${RED}Deploy request failed (HTTP ${HTTP_CODE}).${NC}"
    echo "$DEPLOY_BODY" | jq . 2>/dev/null || echo "$DEPLOY_BODY"
    exit 1
fi

# --- Verify ---

echo -e "\n${CYAN}[5/5] Verifying deployment...${NC}"

MAX_WAIT=120
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    MODELS_JSON=$(curl -s "${GATEWAY}/api/v1/models")
    MODEL_STATUS=$(echo "$MODELS_JSON" | jq -r --arg m "$MODEL" '.models[]? | select(.name == $m) | .status' 2>/dev/null)

    if [ "$MODEL_STATUS" = "ready" ]; then
        echo -e "${GREEN}${BOLD}Model '${MODEL}' is deployed and ready.${NC}"
        echo ""
        echo "────────────────────────────────────────"
        echo -e "${GREEN}Deployment successful.${NC}"
        echo ""
        echo "You can now run inference:"
        echo "  curl -s -X POST ${GATEWAY}/v1/chat/completions \\"
        echo "    -H 'Content-Type: application/json' \\"
        echo "    -d '{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'"
        exit 0
    elif [ "$MODEL_STATUS" = "error" ] || [ "$MODEL_STATUS" = "failed" ]; then
        echo -e "${RED}Model deployment failed with status: ${MODEL_STATUS}${NC}"
        echo "Check alerts for details: curl -s ${GATEWAY}/api/v1/alerts | jq"
        exit 1
    fi

    echo "  Waiting for model to be ready... (${ELAPSED}s / ${MAX_WAIT}s, status: ${MODEL_STATUS:-loading})"
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

echo -e "${YELLOW}WARNING: Model did not reach 'ready' state within ${MAX_WAIT}s.${NC}"
echo "The model may still be loading. Check status with:"
echo "  curl -s ${GATEWAY}/api/v1/models | jq '.models[] | select(.name == \"${MODEL}\")'"
exit 1
