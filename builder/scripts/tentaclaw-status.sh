#!/bin/bash
# =============================================================================
# TentaCLAW Status — Fun System Info Display
# =============================================================================
# Display system status with TentaCLAW flair.
#
# Usage:
#   tentaclaw-status            # Full status
#   tentaclaw-status gpu       # GPU only
#   tentaclaw-status model    # Model only
#   tentaclaw-status cluster  # Cluster info
#   tentaclaw-status --fun    # Fun facts mode
#
# TentaCLAW says: "Let me tell you about your cluster."
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
DIM='\x1b[2m'

# =============================================================================
# Utility Functions
# =============================================================================

bar() {
    local percent=$1
    local width=20
    local filled=$((percent * width / 100))
    local empty=$((width - filled))
    
    printf "${GREEN}"
    printf '█%.0s' $(seq 1 $filled 2>/dev/null)
    printf "${DIM}"
    printf '░%.0s' $(seq 1 $empty 2>/dev/null)
    printf "${RESET}"
}

temp_color() {
    local temp=$1
    if [ "$temp" -lt 50 ]; then
        echo -e "${GREEN}$temp°C${RESET}"
    elif [ "$temp" -lt 70 ]; then
        echo -e "${YELLOW}$temp°C${RESET}"
    else
        echo -e "${RED}$temp°C${RESET}"
    fi
}

# =============================================================================
# GPU Status
# =============================================================================

status_gpu() {
    echo ""
    echo -e "${BOLD}  ═══ GPU Status ═══${RESET}"
    echo ""
    
    if ! command -v nvidia-smi &>/dev/null; then
        echo -e "  ${DIM}nvidia-smi not found${RESET}"
        return
    fi
    
    if ! nvidia-smi &>/dev/null 2>&1; then
        echo -e "  ${YELLOW}⚠ No NVIDIA GPU accessible${RESET}"
        return
    fi
    
    # Get GPU info
    local gpus=$(nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,fan.speed,clocks.sm.clock,clocks.mem.clock --format=csv,noheader,nounits 2>/dev/null)
    
    while IFS=',' read -r idx name temp util mem used total power fan sm_clock mem_clock; do
        local temp_val=$(echo "$temp" | tr -d ' ')
        local util_val=$(echo "$util" | tr -d ' ')
        local mem_val=$(echo "$mem" | tr -d ' ')
        local used_val=$(echo "$used" | tr -d ' ')
        local total_val=$(echo "$total" | tr -d ' ')
        local power_val=$(echo "$power" | tr -d ' ')
        local fan_val=$(echo "$fan" | tr -d ' ')
        local sm_val=$(echo "$sm_clock" | tr -d ' ')
        local mem_mhz=$(echo "$mem_clock" | tr -d ' ')
        
        echo -e "  ${PURPLE}GPU #$idx${RESET}: ${WHITE}$name${RESET}"
        echo ""
        
        # Temperature
        echo -ne "    ${CYAN}Temperature${RESET}   "
        temp_color "$temp_val"
        
        # Utilization bar
        echo -ne "    ${CYAN}GPU Util${RESET}       $(bar $util_val) ${util_val}%"
        echo ""
        
        # Memory bar
        local mem_percent=$((used_val * 100 / total_val))
        echo -ne "    ${CYAN}VRAM${RESET}          $(bar $mem_percent) ${used_val}MB/${total_val}MB"
        echo ""
        
        # Power
        echo -e "    ${CYAN}Power${RESET}         ${power_val}W"
        
        # Fan
        echo -e "    ${CYAN}Fan${RESET}           ${fan_val}%"
        
        # Clocks
        echo -e "    ${CYAN}SM Clock${RESET}       ${sm_val} MHz"
        echo -e "    ${CYAN}Mem Clock${RESET}       ${mem_mhz} MHz"
        
        echo ""
    done <<< "$gpus"
}

# =============================================================================
# Model Status
# =============================================================================

status_model() {
    echo ""
    echo -e "${BOLD}  ═══ Inference Models ═══${RESET}"
    echo ""
    
    if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
        echo -e "  ${YELLOW}⚠ Ollama not running${RESET}"
        echo -e "  ${DIM}Start with: sudo systemctl start ollama${RESET}"
        return
    fi
    
    local models=$(curl -sf http://localhost:11434/api/tags 2>/dev/null | jq -r '.models[] | "\(.name)|\(.size)"' 2>/dev/null)
    
    if [ -z "$models" ]; then
        echo -e "  ${DIM}No models installed${RESET}"
        return
    fi
    
    local count=0
    while IFS='|' read -r name size; do
        [ -z "$name" ] && continue
        count=$((count + 1))
        
        # Format size
        local size_gb=$(echo "scale=1; $size / 1073741824" | bc 2>/dev/null || echo "?")
        
        echo -e "  ${PURPLE}$count.${RESET} ${WHITE}$name${RESET}"
        echo -e "      ${DIM}${size_gb} GB${RESET}"
        echo ""
    done <<< "$models"
    
    echo -e "  ${GREEN}✓${RESET} ${count} model(s) installed"
}

# =============================================================================
# Cluster Status
# =============================================================================

status_cluster() {
    echo ""
    echo -e "${BOLD}  ═══ Cluster Status ═══${RESET}"
    echo ""
    
    # Load config
    if [ -f /etc/tentaclaw/rig.conf ]; then
        local farm_hash=$(grep FARM_HASH /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        local node_id=$(grep NODE_ID /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        local gateway=$(grep GATEWAY_URL /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        
        echo -e "  ${PURPLE}Farm Hash${RESET}  ${BOLD}$farm_hash${RESET}"
        echo -e "  ${PURPLE}Node ID${RESET}    $node_id"
        echo -e "  ${PURPLE}Gateway${RESET}    $gateway"
    else
        echo -e "  ${YELLOW}⚠ Not registered${RESET}"
        echo -e "  ${DIM}Run: tentaclaw-setup or tentaclaw-init${RESET}"
    fi
    
    echo ""
    
    # Uptime
    local uptime=$(uptime -p 2>/dev/null | sed 's/up //')
    echo -e "  ${PURPLE}Uptime${RESET}    $uptime"
    
    # Agent status
    if pgrep -f tentaclaw-agent &>/dev/null; then
        echo -e "  ${GREEN}✓${RESET} Agent running"
    else
        echo -e "  ${YELLOW}⚠${RESET} Agent not running"
    fi
    
    echo ""
}

# =============================================================================
# System Status
# =============================================================================

status_system() {
    echo ""
    echo -e "${BOLD}  ═══ System Info ═══${RESET}"
    echo ""
    
    # CPU
    local cpu_usage=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//' || echo "?")
    local cpu_cores=$(nproc)
    local cpu_model=$(cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | xargs)
    
    echo -e "  ${PURPLE}CPU${RESET}         ${cpu_cores} cores"
    echo -e "  ${DIM}$cpu_model${RESET}"
    echo -ne "  ${CYAN}CPU Usage${RESET}    "
    bar "${cpu_usage:-0}"
    echo " ${cpu_usage:-?}%"
    echo ""
    
    # RAM
    local ram_used=$(free -m | grep Mem | awk '{print $3}')
    local ram_total=$(free -m | grep Mem | awk '{print $2}')
    local ram_percent=$((ram_used * 100 / ram_total))
    
    echo -ne "  ${CYAN}RAM${RESET}          $(bar $ram_percent) ${ram_used}MB/${ram_total}MB"
    echo ""
    
    # Disk
    local disk_used=$(df -h / | tail -1 | awk '{print $3}')
    local disk_total=$(df -h / | tail -1 | awk '{print $2}')
    local disk_percent=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
    
    echo -ne "  ${CYAN}Disk${RESET}         $(bar "${disk_percent:-0}") ${disk_used}/${disk_total}"
    echo ""
    
    # Network
    local iface=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)
    local ip=$(ip addr show 2>/dev/null | grep "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')
    
    if [ -n "$iface" ]; then
        echo -e "  ${PURPLE}Network${RESET}      ${iface}"
        echo -e "  ${CYAN}IP${RESET}            ${ip:-No IP}"
    fi
    
    echo ""
}

# =============================================================================
# Fun Facts Mode
# =============================================================================

status_fun() {
    echo ""
    
    # Get some stats
    local gpu_count=0
    local total_vram=0
    
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
        while IFS=',' read -r _ _ _ _ _ vram _; do
            gpu_count=$((gpu_count + 1))
            total_vram=$((total_vram + $(echo "$vram" | tr -d ' MB')))
        done < <(nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits 2>/dev/null)
    fi
    
    local model_count=0
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        model_count=$(curl -sf http://localhost:11434/api/tags 2>/dev/null | jq '.models | length' 2>/dev/null || echo 0)
    fi
    
    local facts=()
    
    # Generate fun facts
    if [ "$gpu_count" -gt 0 ]; then
        facts+=("You have $gpu_count GPU(s) totaling ${total_vram}MB of VRAM!")
        facts+=("That's $(echo "scale=1; $total_vram / 1024" | bc 2>/dev/null || echo "a lot") GB of GPU memory!")
        
        if [ "$total_vram" -gt 48000 ]; then
            facts+=("Your VRAM is so large it has its own ZIP code.")
        elif [ "$total_vram" -gt 24000 ]; then
            facts+=("You could run multiple models at once with this VRAM.")
        fi
    else
        facts+=("No GPU? TentaCLAW feels your pain. CPU inference is still valid.")
    fi
    
    if [ "$model_count" -gt 0 ]; then
        facts+=("You have $model_count AI model(s) ready to party!")
        
        if [ "$model_count" -gt 5 ]; then
            facts+=("That's a lot of models. TentaCLAW approves.")
        fi
    fi
    
    # Pick a random fact
    local fact="${facts[$((RANDOM % ${#facts[@]}))]}"
    
    echo -e "  ${BOLD}${CYAN}>${WHITE} $fact${RESET}"
    echo ""
    
    # Add a random quote
    local quotes=(
        "Per-token is a scam. Run local.",
        "Eight arms. One mind. Zero regrets.",
        "Your cluster is only as strong as your weakest GPU. (Just kidding, they're all great.)",
        "TentaCLAW has seen things you wouldn't believe.",
        "I've been waiting for you, human.",
        "Let's run some local AI and make OpenAI sweat.",
        "My tentacles are longer than your patience for cloud bills.",
        "This cluster is so cool, even penguins are jealous.",
    )
    
    local quote="${quotes[$((RANDOM % ${#quotes[@]}))]}"
    
    echo -e "  ${DIM}— TentaCLAW${RESET}"
    echo -e "  ${DIM}  \"$quote\"${RESET}"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
    local mode="${1:-}"
    
    case "$mode" in
        gpu|g)
            status_gpu
            ;;
        model|models|m)
            status_model
            ;;
        cluster|c)
            status_cluster
            ;;
        system|sys|s)
            status_system
            ;;
        --fun|fun|f)
            status_fun
            ;;
        "")
            # Full status
            status_cluster
            status_gpu
            status_model
            status_system
            status_fun
            ;;
        -h|--help|help|h)
            echo "Usage: tentaclaw-status [mode]"
            echo ""
            echo "Modes:"
            echo "  gpu       - GPU status only"
            echo "  model     - Model status only"
            echo "  cluster   - Cluster info only"
            echo "  system    - System info only"
            echo "  fun       - Fun facts"
            echo "  (none)    - Full status"
            ;;
        *)
            echo -e "${RED}Unknown mode: $mode${RESET}"
            echo "Use --help for usage"
            exit 1
            ;;
    esac
}

main "$@"
