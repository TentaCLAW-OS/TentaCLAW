#!/bin/bash
# =============================================================================
# TentaCLAW OS — GPU Detection Script (init-bottom)
# =============================================================================
# Runs inside initrd during early boot, BEFORE switchroot.
# Detects NVIDIA and AMD GPUs, loads drivers, writes /tmp/gpu-info.json
#
# CLAWtopus says: "Eight arms need GPUs to wave around."
# =============================================================================

set -euo pipefail

# Colors (ANSI 24-bit)
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'

# Output files
GPU_INFO_FILE="/tmp/gpu-info.json"
NVIDIA_SMI_FILE="/tmp/nvidia-smi.txt"
GPU_STATS_FILE="/var/run/tentaclaw/gpu-stats.json"

# Counters
NVIDIA_COUNT=0
AMD_COUNT=0
TOTAL_GPUS=0

# GPU arrays (colon-separated: bus_id:name:vram_mb)
NVIDIA_GPUS=""
AMD_GPUS=""

log() {
    echo -e "${CYAN}[gpu-detect]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[gpu-detect]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[gpu-detect]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[gpu-detect]${RESET} $*" >&2
}

# =============================================================================
# Step 1: Wait for PCI bus to settle
# =============================================================================
wait_for_pci() {
    log "Waiting for PCI bus..."
    for i in $(seq 1 10); do
        if lspci &>/dev/null; then
            log "PCI bus ready after ${i}s"
            return 0
        fi
        sleep 1
    done
    log_warn "PCI bus not responding, proceeding anyway"
}

# =============================================================================
# Step 2: Quick GPU count via lspci (fast, no driver needed)
# =============================================================================
detect_gpu_count() {
    log "Detecting GPUs via lspci..."

    NVIDIA_COUNT=$(lspci -d 10de: 2>/dev/null | grep -c "VGA\|3D controller" || echo 0)
    AMD_COUNT=$(lspci -d 1002: 2>/dev/null | grep -c "VGA\|Display controller" || echo 0)
    TOTAL_GPUS=$((NVIDIA_COUNT + AMD_COUNT))

    if [ "$TOTAL_GPUS" -eq 0 ]; then
        log_warn "No GPUs detected via lspci. Will retry after driver load."
    else
        log "Found ${TOTAL_GPUS} GPU(s): ${NVIDIA_COUNT} NVIDIA, ${AMD_COUNT} AMD"
    fi
}

# =============================================================================
# Step 3: Load NVIDIA kernel modules
# =============================================================================
load_nvidia_modules() {
    if [ "$NVIDIA_COUNT" -eq 0 ]; then
        return 0
    fi

    log "Loading NVIDIA kernel modules..."

    # Core modules (these are safe to attempt even without GPU)
    modprobe nvidia 2>/dev/null || true
    modprobe nvidia-uvm 2>/dev/null || true
    modprobe nvidia-drm 2>/dev/null || true
    modprobe nvidia-modeset 2>/dev/null || true

    # Wait for nvidia module to settle
    sleep 2

    # Check if any NVIDIA GPUs are now accessible
    if command -v nvidia-smi &>/dev/null; then
        if nvidia-smi &>/dev/null; then
            log_success "NVIDIA driver loaded successfully"
            return 0
        fi
    fi

    log_warn "NVIDIA driver loaded but nvidia-smi not responding (may need kernel module signing)"
}

# =============================================================================
# Step 4: Load AMD kernel modules
# =============================================================================
load_amd_modules() {
    if [ "$AMD_COUNT" -eq 0 ]; then
        return 0
    fi

    log "Loading AMD kernel modules..."

    modprobe amdgpu 2>/dev/null || true
    sleep 2

    # ROCm userspace tools if available
    if command -v rocm-smi &>/dev/null; then
        if rocm-smi --showid &>/dev/null; then
            log_success "AMD GPU driver loaded (ROCm detected)"
            return 0
        fi
    fi

    log_warn "AMD driver loaded. Full ROCm userspace may not be available."
}

# =============================================================================
# Step 5: Detailed GPU detection (when drivers are loaded)
# =============================================================================
detect_nvidia_detailed() {
    if ! command -v nvidia-smi &>/dev/null; then
        log "nvidia-smi not available, skipping detailed NVIDIA detection"
        return
    fi

    if ! nvidia-smi &>/dev/null; then
        log "nvidia-smi query failed, skipping detailed NVIDIA detection"
        return
    fi

    log "Querying detailed NVIDIA GPU info..."

    # Save full nvidia-smi output for later
    nvidia-smi --query-gpu=index,pci.bus_id,name,memory.total,temperature.gpu,utilization.gpu,utilization.memory,power.draw,fan.speed,clocks.sm,clocks.mem \
        --format=csv,noheader,nounits 2>/dev/null > "$NVIDIA_SMI_FILE" || true

    # Reset count — nvidia-smi is the authoritative source when available
    NVIDIA_COUNT=0
    NVIDIA_GPUS=""

    while IFS=',' read -r idx bus_id name vram temperature util_gpu util_mem power fan clock_sm clock_mem; do
        NVIDIA_COUNT=$((NVIDIA_COUNT + 1))

        # Clean up whitespace (nvidia-smi CSV uses ", " separators)
        bus_id=$(echo "$bus_id" | xargs)
        name=$(echo "$name" | xargs)
        vram=$(echo "$vram" | xargs | tr -d ' ')
        temperature=$(echo "$temperature" | xargs)
        power=$(echo "$power" | xargs | tr -d ' ')
        clock_sm=$(echo "$clock_sm" | xargs | tr -d ' ')
        clock_mem=$(echo "$clock_mem" | xargs | tr -d ' ')

        NVIDIA_GPUS="${NVIDIA_GPUS}${bus_id}:${name}:${vram}:${temperature}:${power}:${clock_sm}:${clock_mem}|"

        log "  NVIDIA #${idx}: ${name} (${vram}MB) @ ${bus_id} | ${temperature}C | ${power}W"

    done < "$NVIDIA_SMI_FILE"

    # Recalculate total now that we have authoritative NVIDIA count
    TOTAL_GPUS=$((NVIDIA_COUNT + AMD_COUNT))
}

# =============================================================================
# Step 6: Write GPU info JSON (consumed by registration script)
# =============================================================================
write_gpu_info() {
    log "Writing GPU info to ${GPU_INFO_FILE}..."

    # Build NVIDIA GPUs JSON array
    nvidia_json="[]"
    if [ -n "$NVIDIA_GPUS" ]; then
        nvidia_json=$(echo "$NVIDIA_GPUS" | tr '|' '\n' | grep -v '^$' | while IFS=':' read -r bus_id name vram temp power clock_sm clock_mem; do
            cat << EOF
{"bus_id":"$bus_id","name":"$name","vram_mb":$vram,"temperature_c":$temp,"power_w":$power,"clock_sm_mhz":$clock_sm,"clock_mem_mhz":$clock_mem}
EOF
        done | jq -s '.')
    fi

    # Build AMD GPUs JSON array
    amd_json="[]"
    if [ -n "$AMD_GPUS" ]; then
        amd_json=$(echo "$AMD_GPUS" | tr '|' '\n' | grep -v '^$' | while IFS=':' read -r bus_id name vram temp power clock_sm clock_mem; do
            cat << EOF
{"bus_id":"$bus_id","name":"$name","vram_mb":$vram,"temperature_c":$temp,"power_w":$power,"clock_sm_mhz":$clock_sm,"clock_mem_mhz":$clock_mem}
EOF
        done | jq -s '.')
    fi

    cat > "$GPU_INFO_FILE" << EOF
{
    "nvidia_count": $NVIDIA_COUNT,
    "amd_count": $AMD_COUNT,
    "total_gpus": $TOTAL_GPUS,
    "nvidia_gpus": $nvidia_json,
    "amd_gpus": $amd_json,
    "timestamp": $(date +%s)
}
EOF

    log_success "GPU info written: ${TOTAL_GPUS} GPU(s) detected"
    cat "$GPU_INFO_FILE" | jq '.' 2>/dev/null || cat "$GPU_INFO_FILE"
}

# =============================================================================
# Step 7: Write persistent GPU stats file (for agent)
# =============================================================================
write_gpu_stats() {
    mkdir -p /var/run/tentaclaw 2>/dev/null || true

    # Start with basic info
    cat > "$GPU_STATS_FILE" << EOF
{
    "timestamp": $(date +%s),
    "nvidia": [],
    "amd": []
}
EOF

    # If nvidia-smi works, append real data
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        nvidia-smi --query-gpu=index,pci.bus_id,name,memory.used,memory.total,temperature.gpu,utilization.gpu,power.draw,fan.speed,clocks.sm,clocks.mem \
            --format=csv,noheader,nounits 2>/dev/null | while IFS=',' read -r idx bus_id name vram_used vram_total temp util power fan clock_sm clock_mem; do
            bus_id=$(echo "$bus_id" | xargs)
            name=$(echo "$name" | xargs)
            vram_used=$(echo "$vram_used" | xargs | tr -d ' ')
            vram_total=$(echo "$vram_total" | xargs | tr -d ' ')
            temp=$(echo "$temp" | xargs)
            util=$(echo "$util" | xargs | tr -d ' ')
            power=$(echo "$power" | xargs | tr -d ' ')
            fan=$(echo "$fan" | xargs | tr -d ' ')
            clock_sm=$(echo "$clock_sm" | xargs | tr -d ' ')
            clock_mem=$(echo "$clock_mem" | xargs | tr -d ' ')

            echo "{\"bus_id\":\"$bus_id\",\"name\":\"$name\",\"vram_used_mb\":$vram_used,\"vram_total_mb\":$vram_total,\"temperature_c\":$temp,\"utilization_pct\":$util,\"power_draw_w\":$power,\"fan_speed_pct\":$fan,\"clock_sm_mhz\":$clock_sm,\"clock_mem_mhz\":$clock_mem}"
        done > /tmp/nvidia-gpus-temp.txt

        if [ -s /tmp/nvidia-gpus-temp.txt ]; then
            # Build valid JSON array using jq
            local nvidia_arr
            nvidia_arr=$(jq -s '.' /tmp/nvidia-gpus-temp.txt 2>/dev/null || echo "[]")
            cat > "$GPU_STATS_FILE" << EOF
{
    "timestamp": $(date +%s),
    "nvidia": ${nvidia_arr},
    "amd": []
}
EOF
        fi
    fi
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}  ║        ${PURPLE}CLAWtopus GPU Detection${CYAN}                   ${RESET}"
echo -e "${BOLD}${CYAN}  ═══════════════════════════════════════════════════════${RESET}"
echo ""

log "Starting GPU detection..."
log "CLAWtopus says: \"Let's see what arms we're working with.\""

# Execute detection steps
wait_for_pci
detect_gpu_count
load_nvidia_modules
load_amd_modules
detect_nvidia_detailed 2>/dev/null || true
write_gpu_info
write_gpu_stats

echo ""
if [ "$TOTAL_GPUS" -gt 0 ]; then
    log_success "Detection complete: ${NVIDIA_COUNT} NVIDIA, ${AMD_COUNT} AMD GPU(s)"
    echo -e "  ${GREEN}✓ All arms have GPUs. Inference ready.${RESET}"
else
    log_warn "No GPUs detected. Running in CPU-only mode."
    echo -e "  ${YELLOW}⚠ CPU-only mode. Your arms are weak but functional.${RESET}"
fi
echo ""

# Exit successfully (detection always succeeds, even with 0 GPUs)
exit 0
