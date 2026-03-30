#!/bin/bash
# =============================================================================
# TentaCLAW OS — GPU Detection Script
# =============================================================================
# Detects GPU hardware and outputs a structured JSON report.
# Used by first-boot.sh and other TentaCLAW components.
#
# Usage:
#   detect-gpu.sh              # JSON output to stdout
#   detect-gpu.sh --pretty     # Pretty-printed JSON
#   detect-gpu.sh --summary    # Human-readable summary
#
# Output format (JSON):
#   {
#     "vendor": "nvidia|amd|intel|none",
#     "gpus": [{"name": "...", "pci_id": "...", "vram_mb": 0}],
#     "driver_installed": true|false,
#     "recommended_backend": "ollama|bitnet|vllm"
#   }
#
# CLAWtopus says: "Let me feel around for GPUs with my tentacles..."
# =============================================================================

set -euo pipefail

# =============================================================================
# Constants
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"

# Colors (only used in --summary mode)
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'
DIM='\x1b[2m'

# =============================================================================
# GPU Detection Functions
# =============================================================================

# Detect NVIDIA GPUs via lspci and nvidia-smi
detect_nvidia() {
    local gpus_json="[]"
    local found=false

    # Check lspci for NVIDIA devices (VGA compatible or 3D controller)
    if command -v lspci &>/dev/null; then
        local nvidia_lines
        nvidia_lines=$(lspci -nn 2>/dev/null | grep -i nvidia | grep -iE "VGA|3D|Display" || true)

        if [[ -n "$nvidia_lines" ]]; then
            found=true
            gpus_json="["

            local first=true
            while IFS= read -r line; do
                [[ -z "$line" ]] && continue

                # Extract PCI ID (e.g., "01:00.0")
                local pci_id
                pci_id=$(echo "$line" | awk '{print $1}')

                # Extract GPU name — everything between the colon after the category and the bracket
                local name
                name=$(echo "$line" | sed -E 's/^[^ ]+ [^:]+: //' | sed -E 's/ \[.*$//')

                # Try to get VRAM from nvidia-smi if available
                local vram_mb=0

                [[ "$first" == true ]] && first=false || gpus_json+=","
                gpus_json+="{\"name\":\"${name}\",\"pci_id\":\"${pci_id}\",\"vram_mb\":${vram_mb}}"
            done <<< "$nvidia_lines"

            gpus_json+="]"
        fi
    fi

    # If nvidia-smi is available, enrich with VRAM data
    if [[ "$found" == true ]] && command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
        gpus_json="["
        local first=true

        while IFS=',' read -r idx name vram pci_bus; do
            [[ -z "$idx" ]] && continue

            local clean_name clean_vram clean_pci
            clean_name=$(echo "$name" | xargs)
            clean_vram=$(echo "$vram" | xargs | tr -d ' ')
            clean_pci=$(echo "$pci_bus" | xargs)

            [[ "$first" == true ]] && first=false || gpus_json+=","
            gpus_json+="{\"name\":\"${clean_name}\",\"pci_id\":\"${clean_pci}\",\"vram_mb\":${clean_vram}}"
        done < <(nvidia-smi --query-gpu=index,name,memory.total,pci.bus_id --format=csv,noheader,nounits 2>/dev/null || true)

        gpus_json+="]"
    fi

    echo "$gpus_json"
    [[ "$found" == true ]] && return 0 || return 1
}

# Detect AMD GPUs via lspci
detect_amd() {
    local gpus_json="[]"
    local found=false

    if command -v lspci &>/dev/null; then
        local amd_lines
        # Match AMD/ATI VGA and Display controllers, but exclude non-GPU devices
        # AMD GPUs use vendor ID 1002 (ATI/AMD)
        amd_lines=$(lspci -nn 2>/dev/null | grep -E "\[1002:" | grep -iE "VGA|3D|Display" || true)

        if [[ -n "$amd_lines" ]]; then
            found=true
            gpus_json="["

            local first=true
            while IFS= read -r line; do
                [[ -z "$line" ]] && continue

                local pci_id
                pci_id=$(echo "$line" | awk '{print $1}')

                local name
                name=$(echo "$line" | sed -E 's/^[^ ]+ [^:]+: //' | sed -E 's/ \[.*$//')

                # VRAM detection for AMD requires parsing sysfs or rocm-smi
                local vram_mb=0
                local sysfs_path="/sys/bus/pci/devices/0000:${pci_id}/mem_info_vram_total"
                if [[ -f "$sysfs_path" ]]; then
                    local vram_bytes
                    vram_bytes=$(cat "$sysfs_path" 2>/dev/null || echo 0)
                    vram_mb=$((vram_bytes / 1048576))
                fi

                [[ "$first" == true ]] && first=false || gpus_json+=","
                gpus_json+="{\"name\":\"${name}\",\"pci_id\":\"${pci_id}\",\"vram_mb\":${vram_mb}}"
            done <<< "$amd_lines"

            gpus_json+="]"
        fi
    fi

    echo "$gpus_json"
    [[ "$found" == true ]] && return 0 || return 1
}

# Detect Intel Arc GPUs via lspci
detect_intel_arc() {
    local gpus_json="[]"
    local found=false

    if command -v lspci &>/dev/null; then
        local intel_lines
        # Intel Arc GPUs — match "Intel.*Arc" or Intel discrete GPU device classes
        intel_lines=$(lspci -nn 2>/dev/null | grep -iE "Intel.*(Arc|DG[12])" | grep -iE "VGA|3D|Display" || true)

        if [[ -n "$intel_lines" ]]; then
            found=true
            gpus_json="["

            local first=true
            while IFS= read -r line; do
                [[ -z "$line" ]] && continue

                local pci_id
                pci_id=$(echo "$line" | awk '{print $1}')

                local name
                name=$(echo "$line" | sed -E 's/^[^ ]+ [^:]+: //' | sed -E 's/ \[.*$//')

                local vram_mb=0

                [[ "$first" == true ]] && first=false || gpus_json+=","
                gpus_json+="{\"name\":\"${name}\",\"pci_id\":\"${pci_id}\",\"vram_mb\":${vram_mb}}"
            done <<< "$intel_lines"

            gpus_json+="]"
        fi
    fi

    echo "$gpus_json"
    [[ "$found" == true ]] && return 0 || return 1
}

# Check if the appropriate driver is installed for a given vendor
check_driver_installed() {
    local vendor="$1"

    case "$vendor" in
        nvidia)
            # Check for nvidia kernel module or nvidia-smi
            if lsmod 2>/dev/null | grep -q "^nvidia " || \
               command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
                return 0
            fi
            ;;
        amd)
            # Check for amdgpu kernel module
            if lsmod 2>/dev/null | grep -q "^amdgpu "; then
                return 0
            fi
            ;;
        intel)
            # Check for i915 or xe kernel module (xe is for Arc/newer)
            if lsmod 2>/dev/null | grep -qE "^(i915|xe) "; then
                return 0
            fi
            ;;
        none)
            return 1
            ;;
    esac

    return 1
}

# Determine the recommended inference backend based on hardware
recommend_backend() {
    local vendor="$1"
    local total_vram="$2"

    case "$vendor" in
        nvidia)
            # NVIDIA with large VRAM could benefit from vLLM, otherwise Ollama
            if [[ "$total_vram" -ge 24000 ]]; then
                echo "ollama"  # Ollama is the standard; vLLM for production multi-GPU
            else
                echo "ollama"
            fi
            ;;
        amd)
            # AMD with ROCm support — Ollama has ROCm builds
            echo "ollama"
            ;;
        intel)
            # Intel Arc — Ollama has experimental support via SYCL
            echo "ollama"
            ;;
        none)
            # CPU-only — BitNet is optimized for CPU inference
            echo "bitnet"
            ;;
    esac
}

# =============================================================================
# Main Detection Logic
# =============================================================================

run_detection() {
    local vendor="none"
    local gpus_json="[]"
    local driver_installed=false
    local recommended_backend="bitnet"
    local total_vram=0

    # Priority: NVIDIA > AMD > Intel Arc > CPU-only
    # This ordering reflects driver maturity and inference ecosystem support

    local nvidia_gpus amd_gpus intel_gpus

    nvidia_gpus=$(detect_nvidia) && vendor="nvidia" || true
    if [[ "$vendor" == "nvidia" && "$nvidia_gpus" != "[]" ]]; then
        gpus_json="$nvidia_gpus"
    else
        amd_gpus=$(detect_amd) && vendor="amd" || true
        if [[ "$vendor" == "amd" && "$amd_gpus" != "[]" ]]; then
            gpus_json="$amd_gpus"
        else
            intel_gpus=$(detect_intel_arc) && vendor="intel" || true
            if [[ "$vendor" == "intel" && "$intel_gpus" != "[]" ]]; then
                gpus_json="$intel_gpus"
            else
                vendor="none"
                gpus_json="[]"
            fi
        fi
    fi

    # Calculate total VRAM from detected GPUs
    if command -v python3 &>/dev/null; then
        total_vram=$(python3 -c "
import json, sys
gpus = json.loads('$gpus_json')
print(sum(g.get('vram_mb', 0) for g in gpus))
" 2>/dev/null || echo 0)
    else
        # Fallback: parse with bash (simple sum of vram_mb values)
        total_vram=$(echo "$gpus_json" | grep -oP '"vram_mb":\s*\K[0-9]+' | paste -sd+ | bc 2>/dev/null || echo 0)
    fi

    # Check driver status
    if check_driver_installed "$vendor"; then
        driver_installed=true
    fi

    # Determine recommended backend
    recommended_backend=$(recommend_backend "$vendor" "$total_vram")

    # Build final JSON output
    cat << EOF
{"vendor":"${vendor}","gpus":${gpus_json},"driver_installed":${driver_installed},"recommended_backend":"${recommended_backend}","total_vram_mb":${total_vram}}
EOF
}

# =============================================================================
# Output Formatting
# =============================================================================

print_summary() {
    local json="$1"

    local vendor gpus_count driver backend total_vram
    vendor=$(echo "$json" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['vendor'])" 2>/dev/null || echo "unknown")
    gpus_count=$(echo "$json" | python3 -c "import json,sys; print(len(json.loads(sys.stdin.read())['gpus']))" 2>/dev/null || echo 0)
    driver=$(echo "$json" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['driver_installed'])" 2>/dev/null || echo "false")
    backend=$(echo "$json" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['recommended_backend'])" 2>/dev/null || echo "unknown")
    total_vram=$(echo "$json" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('total_vram_mb', 0))" 2>/dev/null || echo 0)

    echo ""
    echo -e "  ${BOLD}${CYAN}GPU Detection Report${RESET}"
    echo -e "  ${DIM}────────────────────────────────────${RESET}"
    echo ""

    # Vendor
    case "$vendor" in
        nvidia)  echo -e "  ${PURPLE}Vendor${RESET}       ${GREEN}NVIDIA${RESET}" ;;
        amd)     echo -e "  ${PURPLE}Vendor${RESET}       ${RED}AMD${RESET}" ;;
        intel)   echo -e "  ${PURPLE}Vendor${RESET}       ${CYAN}Intel Arc${RESET}" ;;
        none)    echo -e "  ${PURPLE}Vendor${RESET}       ${YELLOW}None (CPU-only)${RESET}" ;;
    esac

    echo -e "  ${PURPLE}GPU Count${RESET}    ${WHITE}${gpus_count}${RESET}"
    echo -e "  ${PURPLE}Total VRAM${RESET}   ${WHITE}${total_vram} MB${RESET}"

    # Driver
    if [[ "$driver" == "True" || "$driver" == "true" ]]; then
        echo -e "  ${PURPLE}Driver${RESET}       ${GREEN}Installed${RESET}"
    else
        echo -e "  ${PURPLE}Driver${RESET}       ${YELLOW}Not installed${RESET}"
    fi

    # Backend
    echo -e "  ${PURPLE}Backend${RESET}      ${WHITE}${backend}${RESET}"

    # Per-GPU details
    if [[ "$gpus_count" -gt 0 ]]; then
        echo ""
        echo -e "  ${BOLD}${CYAN}Detected GPUs:${RESET}"
        echo ""
        echo "$json" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
for i, gpu in enumerate(data['gpus']):
    vram = gpu.get('vram_mb', 0)
    vram_str = f'{vram} MB' if vram > 0 else 'unknown'
    print(f'    #{i}  {gpu[\"name\"]}')
    print(f'        PCI: {gpu[\"pci_id\"]}  |  VRAM: {vram_str}')
" 2>/dev/null || true
    fi

    echo ""
}

print_pretty() {
    local json="$1"
    if command -v python3 &>/dev/null; then
        echo "$json" | python3 -m json.tool 2>/dev/null || echo "$json"
    elif command -v jq &>/dev/null; then
        echo "$json" | jq . 2>/dev/null || echo "$json"
    else
        echo "$json"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    local mode="${1:-}"

    case "$mode" in
        --pretty|-p)
            local result
            result=$(run_detection)
            print_pretty "$result"
            ;;
        --summary|-s)
            local result
            result=$(run_detection)
            print_summary "$result"
            ;;
        --help|-h)
            echo "Usage: detect-gpu.sh [OPTIONS]"
            echo ""
            echo "Detect GPU hardware and output a JSON report."
            echo ""
            echo "Options:"
            echo "  --pretty, -p    Pretty-print JSON output"
            echo "  --summary, -s   Human-readable summary"
            echo "  --help, -h      Show this help"
            echo "  (no option)     Compact JSON to stdout"
            echo ""
            echo "Output JSON schema:"
            echo '  {"vendor": "nvidia|amd|intel|none",'
            echo '   "gpus": [{"name": "...", "pci_id": "...", "vram_mb": 0}],'
            echo '   "driver_installed": true|false,'
            echo '   "recommended_backend": "ollama|bitnet|vllm",'
            echo '   "total_vram_mb": 0}'
            ;;
        --version|-v)
            echo "detect-gpu.sh v${VERSION} — TentaCLAW OS GPU Detection"
            ;;
        "")
            run_detection
            ;;
        *)
            echo "Unknown option: $mode" >&2
            echo "Use --help for usage" >&2
            exit 1
            ;;
    esac
}

main "$@"
