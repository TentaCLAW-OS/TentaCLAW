# =============================================================================
# TentaCLAW OS — CLAWtopus Bashrc
# =============================================================================
# Custom bash configuration with CLAWtopus personality.
# Source this file or copy to /etc/skel/.bashrc for new users.
#
# CLAWtopus says: "Your terminal looks boring. Let me fix that."
# =============================================================================

# Colors
export CL_CYAN='\033[38;2;0;255;255m'
export CL_PURPLE='\033[38;2;140;0;200m'
export CL_TEAL='\033[38;2;0;140;140m'
export CL_WHITE='\033[38;2;240;240;240m'
export CL_GREEN='\033[38;2;0;255;136m'
export CL_YELLOW='\033[38;2;255;220;50m'
export CL_RED='\033[38;2;255;70;70m'
export CL_RESET='\033[0m'
export CL_BOLD='\033[1m'
export CL_DIM='\033[2m'

# =============================================================================
# PS1 — Custom Prompt
# =============================================================================

# Detect if terminal supports color
if [ -x /usr/bin/tput ] && tput setaf 1 &>/dev/null; then
    # Full color prompt (for supported terminals)
    export PS1="\[\033]0;\u@\h: \w\007\]"
    export PS1+="\n"
    export PS1+="\[${CL_CYAN}\]┌─\[${CL_PURPLE}\]\u\[${CL_CYAN}\]@\[${CL_TEAL}\]\h\[${CL_CYAN}\]─\[${CL_WHITE}\]\w\[${CL_CYAN}\]─\[${CL_DIM}\]\@\[${CL_CYAN}\]──\[\033[0m\] "
    export PS1+="\n"
    export PS1+="\[${CL_CYAN}\]└─\[${CL_GREEN}\!\[${CL_CYAN}\]]\[${CL_RESET}\] "
else
    # Fallback prompt (for dumb terminals)
    export PS1="\u@\h:\w\$ "
fi

# =============================================================================
# Aliases
# =============================================================================

alias ls='ls --color=auto'
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'

# TentaCLAW aliases
alias tentaclaw='tentaclaw-shell'
alias tstatus='tentaclaw-shell status'
alias tgpus='tentaclaw-shell gpu'
alias tnodes='tentaclaw-shell nodes'
alias tbench='tentaclaw-shell bench'
alias tjoke='tentaclaw-shell joke'
alias tfortune='tentaclaw-shell fortune'
alias tascii='tentaclaw-shell ascii'

# Git aliases (if available)
if command -v git &>/dev/null; then
    alias g='git'
    alias gs='git status'
    alias ga='git add'
    alias gc='git commit'
    alias gp='git push'
    alias gl='git log --oneline --graph --decorate'
fi

# =============================================================================
# Functions
# =============================================================================

# Quick GPU check
gpu() {
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null | \
            while IFS=',' read -r idx name temp util used total; do
                echo -e "${CL_PURPLE}GPU #$idx${CL_RESET}: ${CL_WHITE}$name${CL_RESET} | ${CL_CYAN}Temp:${CL_RESET} ${temp}°C | ${CL_CYAN}Util:${CL_RESET} ${util}% | ${CL_CYAN}VRAM:${CL_RESET} ${used// /}/${total// /}"
            done
    else
        echo -e "${CL_YELLOW}⚠ No NVIDIA GPU detected${CL_RESET}"
    fi
}

# Quick model list
models() {
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
        echo -e "${CL_CYAN}Loaded models:${CL_RESET}"
        curl -sf http://localhost:11434/api/tags 2>/dev/null | jq -r '.models[].name' 2>/dev/null | while read -r model; do
            echo -e "  ${CL_PURPLE}•${CL_RESET} $model"
        done
    else
        echo -e "${CL_YELLOW}⚠ Ollama not running${CL_RESET}"
    fi
}

# Quick cluster status
cluster() {
    echo -e "${CL_BOLD}${CL_CYAN}Cluster Status${CL_RESET}"
    echo -e "${CL_DIM}$(printf '─%.0s' {1..40})${CL_RESET}"
    
    if [ -f /etc/tentaclaw/rig.conf ]; then
        local farm_hash=$(grep FARM_HASH /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        local node_id=$(grep NODE_ID /etc/tentaclaw/rig.conf 2>/dev/null | cut -d= -f2)
        echo -e "${CL_PURPLE}Farm Hash:${CL_RESET} ${CL_BOLD}$farm_hash${CL_RESET}"
        echo -e "${CL_PURPLE}Node ID:${CL_RESET} $node_id"
    else
        echo -e "${CL_YELLOW}⚠ Not registered${CL_RESET}"
    fi
    
    echo ""
    gpu
    echo ""
    models
}

# CLAWtopus greeting
clawtopus_greet() {
    # Only on interactive shells
    if [ -z "$CLAWTOUS_SILENT" ] && [ -t 0 ]; then
        local greetings=(
            "Bitchen. All arms online."
            "Systems check? Please. I was BORN ready."
            "Eight arms. One mind. Let's party."
            "Waking up... stretching all eight arms."
            "Another day, another thousand tokens."
        )
        
        local greeting="${greetings[$((RANDOM % ${#greetings[@]}))]}"
        echo -e "${CL_CYAN}> ${CL_WHITE}$greeting${CL_RESET}"
        echo -e "${CL_DIM}> Type 'help' or 'tentaclaw' for commands.${CL_RESET}"
        echo ""
    fi
}

# Easter egg: sl (steam locomotive) but octopus
sl() {
    echo -e "${CL_CYAN}"
    cat << 'EOF'
        ,---.
       / o o \
       | \___/ |
        \_____/
         |||||
        /|||||\
       ( @@@@@ )
        @@@@@
     ~~~~~~~~~~~
      |||||||||
     /|||||||||\
EOF
    echo -e "${CL_RESET}"
    echo -e "${CL_DIM}(You meant 'ls', right?)${CL_RESET}"
}

# =============================================================================
# Environment
# =============================================================================

# History
export HISTCONTROL=ignoredups:erasedups
export HISTSIZE=10000
export HISTFILESIZE=20000
shopt -s histappend

# Check window size after each command
shopt -s checkwinsize

# Case-insensitive globbing
shopt -s nocaseglob

# Enable color support
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
fi

# =============================================================================
# Path Additions
# =============================================================================

# Add local bin if exists
[ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH"

# Add TentaCLAW binaries
[ -d "/usr/local/bin" ] && PATH="/usr/local/bin:$PATH"

# =============================================================================
# Welcome Message
# =============================================================================

# Show greeting on new terminal
clawtopus_greet

# =============================================================================
# Completion
# =============================================================================

# Enable bash completion if available
if ! shopt -oq posix; then
    if [ -f /usr/share/bash-completion/bash_completion ]; then
        . /usr/share/bash-completion/bash_completion
    elif [ -f /etc/bash_completion ]; then
        . /etc/bash_completion
    fi
fi
