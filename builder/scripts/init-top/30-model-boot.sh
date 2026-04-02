#!/bin/bash
# =============================================================================
# TentaCLAW OS — Model Boot Script (init-top)
# =============================================================================
# Runs AFTER switchroot (in the real rootfs), after the inference runtime
# is up. Pulls the default model on first boot so the node is ready to
# serve inference requests immediately.
#
# TentaCLAW says: "Feeding the brain."
# =============================================================================

set -euo pipefail

# =============================================================================
# Brand Colors
# =============================================================================
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'

# =============================================================================
# TentaCLAW ASCII Art Library (optional)
# =============================================================================
TENTACLAW_LIB="/opt/tentaclaw/scripts/tentaclaw.sh"
if [ -f "$TENTACLAW_LIB" ]; then
    # shellcheck source=/dev/null
    source "$TENTACLAW_LIB"
fi

# =============================================================================
# Config
# =============================================================================
RIG_CONF="/etc/tentaclaw/rig.conf"
OLLAMA_API="http://127.0.0.1:11434"
DEFAULT_MODEL_FALLBACK="llama3.1:8b"

# =============================================================================
# Logging
# =============================================================================
log() {
    echo -e "${CYAN}[tentaclaw]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[tentaclaw]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[tentaclaw]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[tentaclaw]${RESET} $*" >&2
}

# =============================================================================
# Step 1: Read config for default model
# =============================================================================
load_model_config() {
    log "Loading model configuration..."

    DEFAULT_MODEL="$DEFAULT_MODEL_FALLBACK"

    if [ -f "$RIG_CONF" ]; then
        # shellcheck source=/dev/null
        source "$RIG_CONF"

        # rig.conf uses DEFAULT_MODEL or AUTO_START_MODEL
        if [ -n "${DEFAULT_MODEL:-}" ] && [ "$DEFAULT_MODEL" != "$DEFAULT_MODEL_FALLBACK" ]; then
            log "DEFAULT_MODEL from rig.conf: ${DEFAULT_MODEL}"
        elif [ -n "${AUTO_START_MODEL:-}" ]; then
            DEFAULT_MODEL="$AUTO_START_MODEL"
            log "AUTO_START_MODEL from rig.conf: ${DEFAULT_MODEL}"
        else
            log "No model specified in rig.conf, using default: ${DEFAULT_MODEL}"
        fi
    else
        log_warn "Config not found at ${RIG_CONF}, using default model: ${DEFAULT_MODEL}"
    fi
}

# =============================================================================
# Step 2: Wait for Ollama to be available
# =============================================================================
wait_for_ollama() {
    log "Verifying Ollama is available..."

    local max_wait=30
    local elapsed=0

    while [ "$elapsed" -lt "$max_wait" ]; do
        if curl -sf --connect-timeout 2 "${OLLAMA_API}/api/tags" &>/dev/null; then
            log "Ollama API is available"
            return 0
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_error "Ollama API not available after ${max_wait}s"
    return 1
}

# =============================================================================
# Step 3: Check if the model is already pulled
# =============================================================================
is_model_pulled() {
    local model_name="$1"
    log "Checking if model '${model_name}' is already available..."

    local response
    response=$(curl -sf --connect-timeout 5 "${OLLAMA_API}/api/tags" 2>/dev/null || echo "")

    if [ -z "$response" ]; then
        log_warn "Could not query Ollama API"
        return 1
    fi

    # Check if the model name appears in the list of available models
    # Handle both exact matches and tag-less matches (e.g., "llama3.1:8b" matches "llama3.1:8b")
    local found
    found=$(echo "$response" | jq -r --arg model "$model_name" \
        '.models[]? | select(.name == $model or .name == ($model + ":latest")) | .name' \
        2>/dev/null || echo "")

    if [ -n "$found" ]; then
        log_success "Model '${model_name}' is already pulled (found: ${found})"
        return 0
    fi

    # Also try a substring match for models with implicit :latest
    local base_name
    base_name=$(echo "$model_name" | cut -d: -f1)
    found=$(echo "$response" | jq -r --arg base "$base_name" \
        '.models[]? | select(.name | startswith($base)) | .name' \
        2>/dev/null | head -1 || echo "")

    if [ -n "$found" ]; then
        log_success "Model '${model_name}' variant found: ${found}"
        return 0
    fi

    log "Model '${model_name}' is not yet pulled"
    return 1
}

# =============================================================================
# Step 4: Pull the model
# =============================================================================
pull_model() {
    local model_name="$1"
    log "Pulling model '${model_name}'..."
    log "This may take a while depending on model size and connection speed."

    echo ""

    # Use ollama pull which shows progress natively
    if ollama pull "$model_name"; then
        log_success "Model '${model_name}' pulled successfully"
        return 0
    else
        log_error "Failed to pull model '${model_name}'"
        return 1
    fi
}

# =============================================================================
# Step 5: Verify the model is loaded and functional
# =============================================================================
verify_model() {
    local model_name="$1"
    log "Verifying model '${model_name}' is available..."

    # Re-check via API
    local response
    response=$(curl -sf --connect-timeout 5 "${OLLAMA_API}/api/tags" 2>/dev/null || echo "")

    if [ -z "$response" ]; then
        log_error "Cannot verify — Ollama API not responding"
        return 1
    fi

    local model_count
    model_count=$(echo "$response" | jq '.models | length' 2>/dev/null || echo "0")

    if [ "${model_count:-0}" -eq 0 ]; then
        log_error "No models available after pull. Something went wrong."
        return 1
    fi

    # Check that our specific model is in the list
    local found
    found=$(echo "$response" | jq -r '.models[].name' 2>/dev/null | grep -c "${model_name%%:*}" || echo "0")

    if [ "${found:-0}" -gt 0 ]; then
        log_success "Model '${model_name}' verified and ready for inference"

        # Log model details
        echo "$response" | jq -r --arg base "${model_name%%:*}" \
            '.models[] | select(.name | contains($base)) | "  Name: \(.name)\n  Size: \(.size // "unknown")"' \
            2>/dev/null || true

        return 0
    fi

    log_warn "Model may be available under a different tag"
    return 0
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo -e "${BOLD}${CYAN}  ||        ${PURPLE}TentaCLAW Model Boot${CYAN}                      ${RESET}"
echo -e "${BOLD}${CYAN}  =======================================================${RESET}"
echo ""

log "Initializing model boot sequence..."
log "TentaCLAW says: \"Feeding the brain.\""

# Load config to determine which model to pull
load_model_config

# Wait for Ollama to be ready
wait_for_ollama || {
    log_error "Ollama is not available. Cannot pull models."
    log_error "Ensure 20-inference-runtime.sh ran successfully."
    exit 1
}

echo ""

# Check if model is already pulled (skip on subsequent boots)
if is_model_pulled "$DEFAULT_MODEL"; then
    echo ""
    log_success "Model already available — skipping pull"
else
    echo ""
    log "First boot detected — pulling default model: ${DEFAULT_MODEL}"
    echo ""

    pull_model "$DEFAULT_MODEL" || {
        log_error "Model pull failed. Node will boot without a default model."
        log_error "You can pull manually later: ollama pull ${DEFAULT_MODEL}"
        exit 1
    }
fi

echo ""

# Verify the model is ready
verify_model "$DEFAULT_MODEL" || {
    log_warn "Model verification had issues, but continuing boot."
}

echo ""

# Victory message
log_success "Model boot complete"
echo -e "  ${GREEN}Default model: ${BOLD}${DEFAULT_MODEL}${RESET}"
echo -e "  ${GREEN}Inference endpoint: ${BOLD}${OLLAMA_API}${RESET}"
echo ""

# TentaCLAW celebrates
if type tentaclaw_quote &>/dev/null; then
    echo -e "  $(tentaclaw_quote)"
elif type tentaclaw_happy &>/dev/null; then
    tentaclaw_happy
else
    echo -e "  ${YELLOW}\"Eight arms. One mind. Zero compromises.\"${RESET} -- TentaCLAW"
fi

echo ""

exit 0
