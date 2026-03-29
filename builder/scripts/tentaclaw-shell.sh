#!/bin/bash
# =============================================================================
# TentaCLAW Shell — Interactive CLI with CLAWtopus Personality
# =============================================================================
# A fun, interactive shell for managing your TentaCLAW cluster.
# CLAWtopus is always watching... and responding.
#
# Usage:
#   tentaclaw-shell           # Interactive mode
#   tentaclaw-shell status    # Quick status
#   tentaclaw-shell gpu       # GPU info
#   tentaclaw-shell nodes     # Node list
#   tentaclaw-shell models    # Model management
#   tentaclaw-shell bench     # Run benchmark
#   tentaclaw-shell help      # Show help
#
# CLAWtopus says: "Type 'help' if you're lost. Or don't. I'm an octopus, not a mind reader."
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
# CLAWtopus ASCII Art
# =============================================================================

clawtopus_face() {
    cat << 'EOF'

    ${PURPLE}     ,---.
   ${PURPLE}    / o o \
   ${PURPLE}    | \___/ |
    ${PURPLE}     \_____/
     ${PURPLE}      |||||
     ${PURPLE}     /|||||\
    ${PURPLE}   ( @@@@@ )
     ${PURPLE}    @@@@@

EOF
}

clawtopus_banner() {
    cat << 'EOF'

    ${CYAN}██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ██╗${RESET}
    ${PURPLE}██║   ██║██╔═══██╗╚══██╔══╝██╔═══██╗████╗  ██║${RESET}
    ${TEAL}██║   ██║██║   ██║   ██║   ██║   ██║██╔██╗ ██║${RESET}
    ${PURPLE}╚██╗ ██╔╝██║   ██║   ██║   ██║   ██║██║╚██╗██║${RESET}
    ${CYAN} ╚████╔╝ ╚██████╔╝   ██║   ╚██████╔╝██║ ╚████║${RESET}
    ${PURPLE}  ╚═══╝   ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═══╝${RESET}

EOF
}

clawtopus_loading() {
    cat << 'EOF'

    ${CYAN}     ,---.
   ${CYAN}    /     \
   ${CYAN}    | o o |
   ${CYAN}    | ~~~ |
   ${CYAN}     \___/
    ${CYAN}      |||
     ${CYAN}     |||
    ${YELLOW}   Loading...

EOF
}

clawtopus_sad() {
    cat << 'EOF'

    ${RED}     ,---.
   ${RED}    / x x \
   ${RED}    |  ~~~ |
   ${RED}     \___/
    ${RED}      |||
     ${RED}     |||

EOF
}

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
    
    if [ -n "$default" ]; then
        read -p "  ${CYAN}›${WHITE} $prompt ${DIM}[$default]${RESET}: " result
        echo "${result:-$default}"
    else
        read -p "  ${CYAN}›${WHITE} $prompt${RESET}: " result
        echo "$result"
    fi
}

print_banner() {
    clear
    echo -e "${BOLD}"
    clawtopus_banner
    echo -e "${RESET}"
    echo -e "  ${BOLD}${WHITE}TentaCLAW Shell — Interactive Cluster Management${RESET}"
    echo -e "  ${DIM}Type 'help' for commands. Type 'exit' to quit.${RESET}"
    echo ""
}

# =============================================================================
# Commands
# =============================================================================

cmd_status() {
    echo ""
    echo -e "${BOLD}  Cluster Status${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    # Load config
    if [ -f /etc/tentaclaw/rig.conf ]; then
        while IFS='=' read -r key value; do
            [ -z "$key" ] && continue
            [[ "$key" =~ ^# ]] && continue
            echo -e "    ${CYAN}$key${RESET}: ${WHITE}$value${RESET}"
        done < /etc/tentaclaw/rig.conf
    else
        warn "Not registered yet. Run 'init' first."
    fi
    
    # GPU status
    echo ""
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        echo -e "  ${GREEN}✓${RESET} ${WHITE}NVIDIA GPU(s):${RESET}"
        nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null | while IFS=',' read -r name temp util used total; do
            echo -e "    ${PURPLE}•${RESET} ${WHITE}$name${RESET}"
            echo -e "      ${DIM}Temp: ${temp}°C | Util: ${util}% | VRAM: ${used// /}/${total// /}${RESET}"
        done
    else
        warn "No NVIDIA GPU detected"
    fi
    
    # Ollama status
    echo ""
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        echo -e "  ${GREEN}✓${RESET} ${WHITE}Ollama: Running${RESET}"
        local models=$(curl -sf http://localhost:11434/api/tags 2>/dev/null | jq -r '.models[].name' 2>/dev/null | wc -l)
        echo -e "    ${DIM}$models model(s) loaded${RESET}"
    else
        warn "Ollama: Not running"
    fi
    
    echo ""
}

cmd_gpu() {
    echo ""
    echo -e "${BOLD}  GPU Information${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        echo -e "${WHITE}"
        nvidia-smi --query-gpu=index,name,driver_version,memory.total,compute_cap --format=csv,noheader 2>/dev/null | while IFS=',' read -r idx name driver vram compute; do
            echo -e "  ${PURPLE}GPU #$idx${RESET}"
            echo -e "    ${WHITE}Name:${RESET} $name"
            echo -e "    ${WHITE}Driver:${RESET} $driver"
            echo -e "    ${WHITE}VRAM:${RESET} ${vram// /}"
            echo -e "    ${WHITE}Compute:${RESET} ${compute// /}"
            echo ""
        done
        
        echo -e "  ${BOLD}Real-time Stats:${RESET}"
        nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,utilization.memory,power.draw,clocks.sm.clock,clocks.mem.clock,fan.speed --format=csv,noheader,nounits -l 1 2>/dev/null | head -5 | while IFS=',' read -r temp util mem power sm mem_mhz fan; do
            printf "    \r  ${CYAN}Temp:${RESET} %s°C | ${CYAN}Util:${RESET} %s%% | ${CYAN}Mem:${RESET} %s%% | ${CYAN}Power:${RESET} %sW | ${CYAN}Fan:${RESET} %s%%  " "$temp" "$util" "$mem" "$power" "$fan"
            sleep 1
        done
        echo ""
    else
        warn "No NVIDIA GPU detected"
        warn "Run 'nvidia-smi' to verify driver installation"
    fi
    
    echo ""
}

cmd_models() {
    echo ""
    echo -e "${BOLD}  Model Management${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    echo -e "  ${CYAN}Installed models:${RESET}"
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        local models=$(curl -sf http://localhost:11434/api/tags 2>/dev/null)
        echo "$models" | jq -r '.models[] | "  • \(.name) — \(.size)"' 2>/dev/null || echo "  (error parsing models)"
    else
        warn "Ollama not running. Start with: systemctl start ollama"
    fi
    
    echo ""
    echo -e "  ${CYAN}Available actions:${RESET}"
    echo "    pull <model>   - Download a new model"
    echo "    rm <model>     - Remove a model"
    echo "    load <model>   - Load a model into VRAM"
    echo ""
    
    local action=$(ask "Action" "")
    
    case "$action" in
        pull*)
            local model="${action#pull }"
            if [ -z "$model" ]; then
                model=$(ask "Model name (e.g. hermes3:latest)")
            fi
            echo ""
            log "Pulling $model..."
            ollama pull "$model" 2>&1 | while read -r line; do
                echo -e "  ${DIM}$line${RESET}"
            done
            success "Done!"
            ;;
        rm*)
            local model="${action#rm }"
            if [ -z "$model" ]; then
                model=$(ask "Model name")
            fi
            log "Removing $model..."
            ollama rm "$model" 2>/dev/null && success "Removed!" || warn "Failed or not found"
            ;;
        load*)
            local model="${action#load }"
            if [ -z "$model" ]; then
                model=$(ask "Model name")
            fi
            log "Loading $model..."
            curl -sf -X POST http://localhost:11434/api/load -d "{\"model\":\"$model\"}" &>/dev/null
            success "Loaded!"
            ;;
        *)
            [ -n "$action" ] && warn "Unknown action: $action"
            ;;
    esac
    
    echo ""
}

cmd_nodes() {
    echo ""
    echo -e "${BOLD}  Node Registry${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    if [ -f /etc/tentaclaw/rig.conf ]; then
        local farm_hash=$(grep FARM_HASH /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        local node_id=$(grep NODE_ID /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        local gateway=$(grep GATEWAY_URL /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        
        echo -e "  ${CYAN}This node:${RESET}"
        echo -e "    ${PURPLE}Farm Hash:${RESET} ${BOLD}$farm_hash${RESET}"
        echo -e "    ${PURPLE}Node ID:${RESET} $node_id"
        echo -e "    ${PURPLE}Gateway:${RESET} $gateway"
        echo ""
        
        echo -e "  ${YELLOW}⚠${RESET} ${DIM}To see other nodes, open the TentaCLAW dashboard${RESET}"
    else
        warn "Not registered. Run 'init' to register this node."
    fi
    
    echo ""
}

cmd_bench() {
    echo ""
    echo -e "${BOLD}  Benchmark${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    log "Running quick benchmark..."
    echo ""
    
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        echo -e "  ${CYAN}GPU Benchmark:${RESET}"
        
        local start=$(date +%s%N)
        nvidia-smi --query-gpu=timestamp,utilization.gpu --format=csv,noheader,nounits -l 1 -c 10 &>/dev/null
        local end=$(date +%s%N)
        local duration=$(( (end - start) / 1000000 ))
        
        echo -e "  ${GREEN}✓${RESET} ${WHITE}10 GPU queries completed in ${duration}ms${RESET}"
        echo ""
    fi
    
    # Ollama benchmark
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        log "Testing Ollama inference..."
        
        local start=$(date +%s%N)
        curl -sf -X POST http://localhost:11434/api/generate \
            -d '{"model":"llama3:latest","prompt":"Hello","stream":false}' &>/dev/null
        local end=$(date +%s%N)
        local duration=$(( (end - start) / 1000000 ))
        
        echo -e "  ${GREEN}✓${RESET} ${WHITE}Ollama responded in ${duration}ms${RESET}"
    fi
    
    echo ""
    success "Benchmark complete!"
    echo ""
}

cmd_help() {
    cat << 'EOF'

    ${BOLD}  TentaCLAW Shell Commands${RESET}
    ${DIM}$(printf '─%.0s' {1..50})${RESET}

    ${CYAN}Status & Info${RESET}
      status        Show cluster status
      gpu           Show GPU information (live stats)
      nodes         Show registered nodes

    ${CYAN}Models${RESET}
      models        Manage Ollama models
      bench         Run quick benchmark

    ${CYAN}System${RESET}
      init          Initialize/register this node
      update        Check for updates
      logs          View agent logs

    ${CYAN}Fun${RESET}
      ascii         Display random CLAWtopus art
      joke          Get a CLAWtopus joke
      fortune       CLAWtopus fortune cookie

    ${CYAN}Other${RESET}
      help          Show this help
      exit          Exit the shell

    ${DIM}Tips:${RESET}
    • Tab completion works
    • Use 'clear' to clear the screen
    • Type a command without arguments for interactive mode

EOF
}

cmd_ascii() {
    local arts=(
        "happy"
        "sleepy"
        "evil"
        "thinking"
        "party"
    )
    
    local art="${arts[$((RANDOM % ${#arts[@]}))]}"
    
    case "$art" in
        happy)
            cat << 'EOF'

    ${GREEN}     ,---.
   ${GREEN}    / ^ ^ \
   ${GREEN}    | (◉) |
   ${GREEN}    | \___/ |
    ${GREEN}     \_____/
     ${GREEN}      |||||
     ${GREEN}     /|||||\
    ${GREEN}   ( @@@@@ )
    ${GREEN}    @@@@@

EOF
            ;;
        sleepy)
            cat << 'EOF'

    ${YELLOW}     ,---.
   ${YELLOW}    / - - \
   ${YELLOW}    |  o   |
   ${YELLOW}    | \___/ |
    ${YELLOW}     \_____/
     ${YELLOW}      |||||
     ${YELLOW}     ~|||||~
    ${YELLOW}      ~~~~~
   ${YELLOW}     zZZZZZ

EOF
            ;;
        evil)
            cat << 'EOF'

    ${RED}     ,---.
   ${RED}    / x x \
   ${RED}    |   V   |
    ${RED}     \___/
     ${RED}      |||||
     ${RED}     /|||||\
    ${RED}   ~~~~~~~~~~~~~
    ${RED}     RECTOUS.

EOF
            ;;
        thinking)
            cat << 'EOF'

    ${CYAN}     ,---.
   ${CYAN}    / ^ ^ \
   ${CYAN}    | (°) |
   ${CYAN}    | \___/ |
    ${CYAN}     \_____/
     ${CYAN}      |||||
   ${CYAN}       /|||||\
   ${CYAN}      ( @?@?@ )

EOF
            ;;
        party)
            cat << 'EOF'

    ${PURPLE}     ,---.
   ${PURPLE}    / o o \
   ${PURPLE}    | \^o^/ |
    ${PURPLE}     \_____/
   ${CYAN}      |||||*
   ${CYAN}     /|||||*|\
   ${CYAN}    *|||*|*|||*
   ${YELLOW}    ~~~~~~~~~~~~

EOF
            ;;
    esac
    
    echo -e "  ${DIM}(Refresh for another!)${RESET}"
}

cmd_joke() {
    local jokes=(
        "Why did the octopus cross the network? To get to the other side of the cluster."
        "I have 8 arms because 4 arms couldn't handle the GPU load."
        "What's an octopus's favorite tensor operation? Tentacle multiplication."
        "Why do octopuses make great sysadmins? They can keep track of so many tentacles."
        "How many GPUs does an octopus need? All of them."
        "What do you call an octopus that runs AI? Tentacurls."
        "Why was the octopus so bad at keeping secrets? Too many arms to cover its mouth."
        "How does CLAWtopus send messages? Tentacle-net."
    )
    
    local joke="${jokes[$((RANDOM % ${#jokes[@]}))]}"
    echo ""
    echo -e "  ${PURPLE}>${CYAN}>${WHITE} $joke${RESET}"
    echo ""
}

cmd_fortune() {
    local fortunes=(
        "A GPU cluster in your homelab brings 8x the luck."
        "Your models will load smoothly. Your tensors will tensor."
        "Beware the memory leak that starts small."
        "The next token will be generated in exactly 42 milliseconds."
        "A wise octopus once said: 'Per-token is a scam.'"
        "Your VRAM will multiply like tentacles."
        "Expect a breakthrough in your inference pipeline."
        "CLAWtopus sees all. CLAWtopus knows all."
    )
    
    local fortune="${fortunes[$((RANDOM % ${#fortunes[@]}))]}"
    echo ""
    echo -e "  ${CYAN}✮${RESET} ${WHITE}$fortune${RESET}"
    echo ""
    echo -e "  ${DIM}— CLAWtopus${RESET}"
    echo ""
}

cmd_init() {
    echo ""
    echo -e "${BOLD}  Initialize Node${RESET}"
    echo -e "  ${DIM}$(printf '─%.0s' {1..50})${RESET}"
    echo ""
    
    if [ -f /etc/tentaclaw/rig.conf ]; then
        warn "Node already registered!"
        local farm_hash=$(grep FARM_HASH /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        echo -e "  Farm Hash: ${BOLD}$farm_hash${RESET}"
        echo -e "  ${DIM}To re-register, delete /etc/tentaclaw/rig.conf first.${RESET}"
    else
        log "Running registration..."
        if [ -f /etc/tentaclaw/init-bottom/03-hive-registration.sh ]; then
            bash /etc/tentaclaw/init-bottom/03-hive-registration.sh
        else
            error "Registration script not found!"
        fi
    fi
    
    echo ""
}

cmd_logs() {
    echo ""
    echo -e "${BOLD}  Agent Logs${RESET}"
    echo -e "  ${DIM}(Ctrl+C to exit)${RESET}"
    echo ""
    
    if [ -f /var/log/tentaclaw/agent.log ]; then
        tail -f /var/log/tentaclaw/agent.log 2>/dev/null || {
            warn "Log file not writable. Trying journalctl..."
            journalctl -u tentaclaw-agent -f
        }
    else
        warn "No logs found. Is the agent running?"
        echo -e "  ${DIM}Try: systemctl start tentaclaw-agent${RESET}"
    fi
    
    echo ""
}

# =============================================================================
# Interactive Mode
# =============================================================================

interactive_mode() {
    print_banner
    
    while true; do
        echo -e -n "  ${CYAN}tentaclaw${RESET}${DIM}>${RESET} "
        read -r cmd args
        
        # Handle empty input
        if [ -z "$cmd" ]; then
            continue
        fi
        
        # Parse command
        case "$cmd" in
            exit|quit|q)
                echo ""
                echo -e "  ${CYAN}See you later!${RESET}"
                echo -e "  ${YELLOW}CLAWtopus says: \"Don't go squidding out on me.\"${RESET}"
                echo ""
                break
                ;;
            status|stat|s)
                cmd_status
                ;;
            gpu|g)
                cmd_gpu
                ;;
            models|model|m)
                cmd_models $args
                ;;
            nodes|node|n)
                cmd_nodes
                ;;
            bench|b)
                cmd_bench
                ;;
            init|register|r)
                cmd_init
                ;;
            help|h|\?)
                cmd_help
                ;;
            clear|cls)
                print_banner
                ;;
            ascii|a)
                cmd_ascii
                ;;
            joke|j)
                cmd_joke
                ;;
            fortune|f)
                cmd_fortune
                ;;
            logs|l)
                cmd_logs
                ;;
            update|upgrade)
                log "Checking for updates..."
                echo -e "  ${YELLOW}Updates not implemented yet. Check back soon!${RESET}"
                ;;
            *)
                echo -e "  ${RED}Unknown command: $cmd${RESET}"
                echo -e "  ${DIM}Type 'help' for available commands.${RESET}"
                ;;
        esac
    done
}

# =============================================================================
# Main
# =============================================================================

main() {
    local cmd="${1:-}"
    
    case "$cmd" in
        status) cmd_status ;;
        gpu) cmd_gpu ;;
        models) cmd_models "${2:-}" ;;
        nodes) cmd_nodes ;;
        bench) cmd_bench ;;
        init) cmd_init ;;
        logs) cmd_logs ;;
        help) cmd_help ;;
        ascii) cmd_ascii ;;
        joke) cmd_joke ;;
        fortune) cmd_fortune ;;
        "") interactive_mode ;;
        *)
            echo -e "${RED}Unknown command: $cmd${RESET}"
            echo -e "Type ${CYAN}tentaclaw-shell help${RESET} for usage"
            exit 1
            ;;
    esac
}

main "$@"
