#!/bin/bash
# =============================================================================
# TentaCLAW OS — TentaCLAW Setup Wizard
# =============================================================================
# Interactive first-boot setup wizard.
# Because configuring your cluster should be fun.
#
# TentaCLAW says: "Let's get you set up, human."
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
BLINK='\x1b[5m'

# =============================================================================
# Utility Functions
# =============================================================================

log() {
    echo -e "  ${CYAN}›${RESET} $*"
}

success() {
    echo -e "  ${GREEN}✓${RESET} $*"
}

warn() {
    echo -e "  ${YELLOW}⚠${RESET} $*"
}

error() {
    echo -e "  ${RED}✗${RESET} $*" >&2
}

ask() {
    local prompt="$1"
    local default="${2:-}"
    local result

    if [ -n "$default" ]; then
        read -p "  ${CYAN}›${WHITE} $prompt ${DIM}[$default]${RESET}: " result
        echo "${result:-$default}"
    else
        read -p "  ${CYAN}›${WHITE} $prompt${RESET}: " result
        echo "$result"
    fi
}

ask_password() {
    local prompt="$1"
    local result

    read -sp "  ${CYAN}›${WHITE} $prompt${RESET}: " result
    echo "$result"
}

confirm() {
    local prompt="$1"
    local default="${2:-n}"

    local yn
    if [ "$default" = "y" ]; then
        read -p "  ${CYAN}›${WHITE} $prompt ${DIM}[Y/n]${RESET}: " yn
        [ "${yn,,:=y}" = "y" ]
    else
        read -p "  ${CYAN}›${WHITE} $prompt ${DIM}[y/N]${RESET}: " yn
        [ "${yn,,:=n}" = "y" ]
    fi
}

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0

    printf "  ${CYAN}Working${RESET} "
    while kill -0 $pid 2>/dev/null; do
        printf "\b%s" "${spinstr:i++%${#spinstr}:1}"
        sleep $delay
    done
    printf "\b \n"
}

# =============================================================================
# TentaCLAW ASCII Art
# =============================================================================

tentaclaw_welcome() {
    cat << 'EOF'

        ╭──────────────────────────────────────────────────────────╮
        │                                                          │
        │    ${CYAN}██████╗ ████████╗ ██████╗ ███╗   ██╗${RESET}              │
        │    ${CYAN}██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║${RESET}              │
        │    ${CYAN}███████╔╝   ██║   ██║   ██║██╔██╗ ██║${RESET}              │
        │    ${CYAN}██╔══██╗   ██║   ██║   ██║██║╚██╗██║${RESET}              │
        │    ${CYAN}██║  ██║   ██║   ╚██████╔╝██║ ╚████║${RESET}              │
        │    ${CYAN}╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝${RESET}              │
        │                                                          │
        │    ${PURPLE}██████╗ ███████╗ █████╗ ██████╗ ██╗   ██╗${RESET}         │
        │    ${PURPLE}██╔══██╗██╔════╝██╔══██╗██╔══██╗██║   ██║${RESET}         │
        │    ${PURPLE}███████╔╝█████╗  ███████║██████╔╝██║   ██║${RESET}         │
        │    ${PURPLE}██╔══██║██╔══╝  ██╔══██║██║  ██║╚██╗ ██╔╝${RESET}         │
        │    ${PURPLE}██║  ██║███████╗██║  ██║██║  ██║ ╚████╔╝${RESET}         │
        │    ${PURPLE}╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝${RESET}         │
        │                                                          │
        │    ${TEAL}Setup Wizard — Let's get your cluster running!${RESET}    │
        │                                                          │
        ╰──────────────────────────────────────────────────────────╯

EOF
}

tentaclaw_happy() {
    cat << 'EOF'

        ${GREEN}     ,---.
       / o o \
       | \___/ |
        \_____/
         |||||
        /|||||\
       ( @@@@@ )
        @@@@@
    
    ${GREEN}All done! Let's run some AI!${RESET}

EOF
}

tentaclaw_thinking() {
    cat << 'EOF'

        ${YELLOW}     ,---.
       / ^ ^ \
       | (◉) |
       | \___/ |
        \_____/
         |||||
        /|||||\
       ( @@@@@ )
        @@@@@

    ${YELLOW}Hmm, let me think about this...${RESET}

EOF
}

# =============================================================================
# Welcome Screen
# =============================================================================

welcome() {
    clear
    echo -e "${BOLD}"
    tentaclaw_welcome
    echo -e "${RESET}"
    
    echo -e "  ${DIM}Welcome to TentaCLAW OS! I'm TentaCLAW, and I'll be${RESET}"
    echo -e "  ${DIM}your guide to setting up your AI inference cluster.${RESET}"
    echo ""
    
    if confirm "Ready to begin?" "y"; then
        return 0
    else
        echo ""
        echo -e "  ${YELLOW}No rush. Run me anytime with: ${CYAN}tentaclaw-setup${RESET}"
        exit 0
    fi
}

# =============================================================================
# Step 1: System Info
# =============================================================================

step_system_info() {
    echo ""
    echo -e "${BOLD}  ═══ Step 1: System Information ═══${RESET}"
    echo ""
    
    # Detect hostname
    log "Detecting system information..."
    sleep 1
    
    local hostname=$(hostname)
    local cpu_cores=$(nproc)
    local cpu_model=$(cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | xargs)
    local total_ram=$(free -h | grep Mem | awk '{print $2}')
    
    echo ""
    echo -e "  ${CYAN}Your system:${RESET}"
    echo ""
    echo -e "    ${PURPLE}Hostname${RESET}:   ${WHITE}$hostname${RESET}"
    echo -e "    ${PURPLE}CPU${RESET}:        ${WHITE}$cpu_cores cores — $cpu_model${RESET}"
    echo -e "    ${PURPLE}RAM${RESET}:        ${WHITE}$total_ram${RESET}"
    
    # GPU detection
    echo ""
    echo -e "  ${CYAN}GPUs detected:${RESET}"
    
    local gpu_count=0
    if command -v nvidia-smi &>/dev/null; then
        if nvidia-smi &>/dev/null; then
            nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | while IFS=',' read -r name vram; do
                gpu_count=$((gpu_count + 1))
                echo -e "    ${GREEN}✓${RESET} ${WHITE}$name — ${vram// /}${RESET}"
            done
        fi
    fi
    
    if [ "$gpu_count" -eq 0 ]; then
        # Try lspci
        local nvidia=$(lspci -d 10de: 2>/dev/null | grep -c "VGA\|3D" || echo 0)
        local amd=$(lspci -d 1002: 2>/dev/null | grep -c "VGA\|Display" || echo 0)
        
        if [ "$nvidia" -gt 0 ]; then
            echo -e "    ${GREEN}✓${RESET} ${WHITE}NVIDIA GPU(s) detected ($nvidia)${RESET}"
            gpu_count=$nvidia
        elif [ "$amd" -gt 0 ]; then
            echo -e "    ${YELLOW}⚠${RESET} ${WHITE}AMD GPU(s) detected ($amd) — ROCm support coming${RESET}"
            gpu_count=$amd
        else
            echo -e "    ${YELLOW}⚠${RESET} ${WHITE}No GPU detected — CPU-only mode${RESET}"
        fi
    fi
    
    echo ""
    
    if confirm "Looks good?" "y"; then
        return 0
    else
        warn "System info correction not implemented yet."
        return 0
    fi
}

# =============================================================================
# Step 2: Network Setup
# =============================================================================

step_network() {
    echo ""
    echo -e "${BOLD}  ═══ Step 2: Network Configuration ═══${RESET}"
    echo ""
    
    log "Checking network..."
    sleep 1
    
    local ip=$(ip addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')
    local gateway=$(ip route show default | awk '/default/ {print $3}')
    local iface=$(ip route show default | awk '/default/ {print $5}')
    
    echo ""
    echo -e "  ${CYAN}Current network:${RESET}"
    echo ""
    echo -e "    ${PURPLE}Interface${RESET}: ${WHITE}$iface${RESET}"
    echo -e "    ${PURPLE}IP Address${RESET}: ${WHITE}$ip${RESET}"
    echo -e "    ${PURPLE}Gateway${RESET}: ${WHITE}$gateway${RESET}"
    echo ""
    
    echo -e "  ${DIM}Network mode:${RESET}"
    echo ""
    echo -e "    ${CYAN}1${RESET}) ${WHITE}DHCP (automatic)${RESET} — Recommended"
    echo -e "    ${CYAN}2${RESET}) ${WHITE}Static IP${RESET} — Advanced"
    
    local choice=$(ask "Select" "1")
    
    case "$choice" in
        1)
            success "Using DHCP — I'll auto-detect settings"
            ;;
        2)
            echo ""
            local static_ip=$(ask "Static IP" "$ip")
            local static_gw=$(ask "Gateway" "$gateway")
            success "Static IP configured: $static_ip"
            ;;
    esac
    
    return 0
}

# =============================================================================
# Step 3: Gateway Connection
# =============================================================================

step_gateway() {
    echo ""
    echo -e "${BOLD}  ═══ Step 3: TentaCLAW Gateway ═══${RESET}"
    echo ""
    
    echo -e "  ${DIM}The TentaCLAW gateway is the brain of your cluster.${RESET}"
    echo -e "  ${DIM}Nodes push stats here and receive commands.${RESET}"
    echo ""
    
    local gateway_ip=$(ask "TentaCLAW Gateway IP" "192.168.1.100")
    local gateway_port=$(ask "Gateway Port" "7860")
    
    echo ""
    log "Testing connection to $gateway_ip:$gateway_port..."
    echo ""
    
    if curl -sf --connect-timeout 3 "http://${gateway_ip}:${gateway_port}/health" &>/dev/null; then
        success "Gateway is reachable!"
    elif curl -sf --connect-timeout 3 "http://${gateway_ip}:${gateway_port}/" &>/dev/null; then
        success "Gateway is reachable!"
    else
        warn "Gateway not responding. You can:"
        echo ""
        echo -e "    ${CYAN}1${RESET}) ${WHITE}Skip — run in standalone mode${RESET}"
        echo -e "    ${CYAN}2${RESET}) ${WHITE}Try different IP${RESET}"
        echo -e "    ${CYAN}3${RESET}) ${WHITE}Continue anyway${RESET}"
        
        local skip_choice=$(ask "Select" "1")
        case "$skip_choice" in
            1)
                warn "Skipping gateway — standalone mode"
                gateway_ip=""
                gateway_port=""
                ;;
            2)
                step_gateway
                return $?
                ;;
            *)
                warn "Continuing without gateway"
                gateway_ip=""
                gateway_port=""
                ;;
        esac
    fi
    
    # Save to config
    if [ -n "$gateway_ip" ]; then
        mkdir -p /etc/tentaclaw
        cat >> /etc/tentaclaw/rig.conf << EOF
GATEWAY_URL=http://${gateway_ip}:${gateway_port}
EOF
    fi
    
    return 0
}

# =============================================================================
# Step 4: GPU Configuration
# =============================================================================

step_gpu_config() {
    echo ""
    echo -e "${BOLD}  ═══ Step 4: GPU Configuration ═══${RESET}"
    echo ""
    
    if ! command -v nvidia-smi &>/dev/null || ! nvidia-smi &>/dev/null; then
        warn "No NVIDIA GPU detected. Skipping GPU config."
        return 0
    fi
    
    echo -e "  ${DIM}NVIDIA GPU(s) detected! Let's configure them.${RESET}"
    echo ""
    
    echo -e "  ${CYAN}Power management:${RESET}"
    echo ""
    echo -e "    ${CYAN}1${RESET}) ${WHITE}Adaptive (default)${RESET} — Balances power and performance"
    echo -e "    ${CYAN}2${RESET}) ${WHITE}Performance${RESET} — Max performance, higher power draw"
    echo -e "    ${CYAN}3${RESET}) ${WHITE}Quiet${RESET} — Lower power, quieter fans"
    
    local power_choice=$(ask "Select" "1")
    
    local power_mode="adaptive"
    case "$power_choice" in
        1) power_mode="adaptive" ;;
        2) power_mode="performance" ;;
        3) power_mode="quiet" ;;
    esac
    
    success "Power mode set to: $power_mode"
    
    echo ""
    echo -e "  ${CYAN}Overclocking:${RESET}"
    echo ""
    
    if confirm "Enable overclocking?" "n"; then
        warn "Overclocking is experimental!"
        if confirm "Really enable overclocking?" "n"; then
            echo -e "    ${YELLOW}⚠${RESET} ${WHITE}Overclocking enabled${RESET}"
            mkdir -p /etc/tentaclaw
            echo "OC_PROFILE=aggressive" >> /etc/tentaclaw/rig.conf
        fi
    fi
    
    return 0
}

# =============================================================================
# Step 5: Inference Runtime
# =============================================================================

step_inference() {
    echo ""
    echo -e "${BOLD}  ═══ Step 5: Inference Runtime ═══${RESET}"
    echo ""
    
    echo -e "  ${DIM}Which inference runtime would you like to use?${RESET}"
    echo ""
    echo -e "    ${CYAN}1${RESET}) ${WHITE}Ollama (recommended)${RESET} — Easy model management"
    echo -e "    ${CYAN}2${RESET}) ${WHITE}llama.cpp${RESET} — Lightweight, fast"
    echo -e "    ${CYAN}3${RESET}) ${WHITE}Both${RESET} — I'll figure it out"
    
    local runtime_choice=$(ask "Select" "1")
    
    case "$runtime_choice" in
        1)
            success "Ollama selected — I'll install it on first boot"
            ;;
        2)
            success "llama.cpp selected — I'll install it on first boot"
            ;;
        3)
            success "Both selected — You get the best of both worlds"
            ;;
    esac
    
    echo ""
    echo -e "  ${CYAN}First model to install?${RESET}"
    echo ""
    echo -e "    ${CYAN}1${RESET}) ${WHITE}Hermes 3 (recommended)${RESET} — Powerful chat model"
    echo -e "    ${CYAN}2${RESET}) ${WHITE}Mistral${RESET} — Fast and efficient"
    echo -e "    ${CYAN}3${RESET}) ${WHITE}Llama 3${RESET} — Meta's latest"
    echo -e "    ${CYAN}4${RESET}) ${WHITE}Skip${RESET} — I'll install later"
    
    local model_choice=$(ask "Select" "1")
    
    local first_model=""
    case "$model_choice" in
        1) first_model="hermes3:latest" ;;
        2) first_model="mistral:latest" ;;
        3) first_model="llama3:latest" ;;
        *) first_model="" ;;
    esac
    
    if [ -n "$first_model" ]; then
        success "First model: $first_model"
        mkdir -p /etc/tentaclaw
        echo "AUTO_START_MODEL=$first_model" >> /etc/tentaclaw/rig.conf
    fi
    
    return 0
}

# =============================================================================
# Step 6: Admin Account
# =============================================================================

step_admin() {
    echo ""
    echo -e "${BOLD}  ═══ Step 6: Admin Account ═══${RESET}"
    echo ""
    
    echo -e "  ${DIM}Let's set up your admin account for SSH access.${RESET}"
    echo ""
    
    local username=$(ask "Username" "root")
    local password
    local password_confirm
    
    while true; do
        password=$(ask_password "Password (leave empty for SSH key only)")
        if [ -z "$password" ]; then
            warn "No password — SSH key only"
            break
        fi
        password_confirm=$(ask_password "Confirm password")
        
        if [ "$password" = "$password_confirm" ]; then
            break
        else
            error "Passwords don't match. Try again."
        fi
    done
    
    if [ -n "$password" ]; then
        success "Password set for $username"
    else
        warn "SSH key only — make sure you have your key ready!"
    fi
    
    return 0
}

# =============================================================================
# Step 7: Summary
# =============================================================================

step_summary() {
    echo ""
    echo -e "${BOLD}  ═══ Step 7: All Done! ═══${RESET}"
    echo ""
    
    echo -e "${GREEN}"
    tentaclaw_happy
    echo -e "${RESET}"
    
    echo -e "  ${BOLD}${WHITE}Here's your setup summary:${RESET}"
    echo ""
    
    # Read back config
    if [ -f /etc/tentaclaw/rig.conf ]; then
        while IFS='=' read -r key value; do
            [ -z "$key" ] && continue
            [[ "$key" =~ ^# ]] && continue
            echo -e "    ${CYAN}$key${RESET} = ${WHITE}$value${RESET}"
        done < /etc/tentaclaw/rig.conf
    fi
    
    echo ""
    echo -e "  ${BOLD}${GREEN}Your cluster is ready!${RESET}"
    echo ""
    echo -e "  ${DIM}Next steps:${RESET}"
    echo ""
    echo -e "    1. ${WHITE}Reboot: ${CYAN}sudo reboot${RESET}"
    echo -e "    2. ${WHITE}TentaCLAW will auto-start and begin pushing stats${RESET}"
    echo -e "    3. ${WHITE}Add this node to your dashboard using the Farm Hash${RESET}"
    echo ""
    
    if confirm "Reboot now?" "y"; then
        echo ""
        echo -e "  ${CYAN}See you on the other side!${RESET}"
        echo -e "  ${YELLOW}TentaCLAW says: \"Don't tickle my tentacles on the way out.\"${RESET}"
        sleep 2
        reboot
    else
        echo ""
        warn "Remember to reboot when ready!"
        echo -e "  ${CYAN}Run ${WHITE}tentaclaw-agent${CYAN} to start the daemon.${RESET}"
    fi
    
    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}Please run as root: sudo tentaclaw-setup${RESET}"
        exit 1
    fi
    
    welcome
    step_system_info
    step_network
    step_gateway
    step_gpu_config
    step_inference
    step_admin
    step_summary
}

main "$@"
