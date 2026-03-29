#!/bin/bash
# =============================================================================
# TentaCLAW OS — CLAWtopus ASCII Art Library
# =============================================================================
# A collection of ASCII art and display functions for CLAWtopus.
# Source this file to use the functions in other scripts.
#
# Usage:
#   source /path/to/clawtopus.sh
#   clawtopus_banner
#   clawtopus_face
#   clawtopus_splash
#
# Colors: Cyan (#00FFFF), Purple (#8C00C8), Teal (#008C8C), White
# =============================================================================

# ANSI Color Codes (24-bit true color)
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
DARKPURPLE='\x1b[38;2;80;0;180m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
ORANGE='\x1b[38;2;255;165;0m'
RESET='\x1b[0m'
BOLD='\x1b[1m'
DIM='\x1b[2m'
BLINK='\x1b[5m'

# =============================================================================
# CLAWtopus ASCII Art - The Full Boot Splash
# =============================================================================
clawtopus_splash() {
    cat << EOF

${CYAN}        ╭──────────────────────────────────────────────────────────╮
${CYAN}    ╭───┤  ${WHITE}TENTACLAW OS — HiveOS for AI Inference Clusters${CYAN}  ├───╮
${CYAN}   ╭─┤                                                         ╰─┤${CYAN}
${CYAN}   │╭┴───────────────────────────────────────────────────────────┴╮│
${CYAN}   ││                                                               ││
${CYAN}   ││${PURPLE}           ██████╗ ████████╗ ██████╗ ███╗   ██╗${CYAN}                     ││
${CYAN}   ││${PURPLE}           ██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║${CYAN}                     ││
${CYAN}   ││${PURPLE}           ██████╔╝   ██║   ██║   ██║██╔██╗ ██║${CYAN}                     ││
${CYAN}   ││${PURPLE}           ██╔══██╗   ██║   ██║   ██║██║╚██╗██║${CYAN}                     ││
${CYAN}   ││${PURPLE}           ██║  ██║   ██║   ╚██████╔╝██║ ╚████║${CYAN}                     ││
${CYAN}   ││${PURPLE}           ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝${CYAN}                     ││
${CYAN}   ││                                                               ││
${CYAN}   ││${TEAL}           ██████╗ ███████╗ █████╗ ██████╗ ██╗   ██╗███████╗${CYAN}        ││
${CYAN}   ││${TEAL}           ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║   ██║██╔════╝${CYAN}        ││
${CYAN}   ││${TEAL}           ██████╔╝█████╗  ███████║██████╔╝██║   ██║███████╗${CYAN}        ││
${CYAN}   ││${TEAL}           ██╔══██╗██╔══╝  ██╔══██║██╔══██╗╚██╗ ██╔╝╚════██║${CYAN}        ││
${CYAN}   ││${TEAL}           ██║  ██║███████╗██║  ██║██║  ██║ ╚████╔╝ ███████║${CYAN}        ││
${CYAN}   ││${TEAL}           ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝${CYAN}        ││
${CYAN}   ││                                                               ││
${CYAN}   ││                                                               ││
${CYAN}   │╰───────────────────────────────────────────────────────────────╯│
${CYAN}   │  ${WHITE}Eight arms. One mind. Zero compromises.${CYAN}                              │
${CYAN}   ╰─────────────────────────────────────────────────────────────────╯

EOF
}

# =============================================================================
# CLAWtopus Face - Compact Version
# =============================================================================
clawtopus_face() {
    cat << EOF

${PURPLE}     ,---.
${PURPLE}    / o o \\
${PURPLE}    | \\___/ |
${PURPLE}     \\_____/
${PURPLE}      |||||
${PURPLE}     /|||||\\
${PURPLE}    ( @@@@@ )
${CYAN}     CLAWtopus

EOF
}

# =============================================================================
# CLAWtopus Face - Happy (all arms up)
# =============================================================================
clawtopus_happy() {
    cat << EOF

${PURPLE}     ,---.
${PURPLE}    / ^ ^ \\
${PURPLE}    | (◉) |
${PURPLE}    | \\___/ |
${PURPLE}     \\_____/
${PURPLE}      |||||
${PURPLE}   ___|||||___
${PURPLE}  /  ${CYAN}@@@@@@@${PURPLE}  \\
${PURPLE} ( ${CYAN}@@@@@@@@@@@${PURPLE} )
${PURPLE}  \\__${CYAN}@@@@@@@${PURPLE}__/
${PURPLE}     ${CYAN}~|||~${CYAN}

EOF
}

# =============================================================================
# CLAWtopus Face - Sleepy
# =============================================================================
clawtopus_sleepy() {
    cat << EOF

${PURPLE}     ,---.
${PURPLE}    / - - \\
${PURPLE}    |  o   |
${PURPLE}    | \\___/ |
${PURPLE}     \\_____/
${PURPLE}      |||||
${PURPLE}     ~|||||~
${PURPLE}      ~~~~~
${PURPLE}     zZZZZZ

EOF
}

# =============================================================================
# CLAWtopus Face - Evil Mode (nodes down)
# =============================================================================
clawtopus_evil() {
    cat << EOF

${RED}     ,---.
${RED}    / x x \\
${RED}    |   V   |
${RED}     \\___/${RED}
${RED}      |||||
${RED}     /|||||\\
${RED}    /|||||||\\
${RED}   ~~~~~~~~~~~~~
${RED}     RECTO.

EOF
}

# =============================================================================
# CLAWtopus Banner - One-liner ASCII art
# =============================================================================
clawtopus_banner() {
    cat << EOF

${CYAN}██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ██╗${RESET}
${PURPLE}██║   ██║██╔═══██╗╚══██╔══╝██╔═══██╗████╗  ██║${RESET}
${TEAL}██║   ██║██║   ██║   ██║   ██║   ██║██╔██╗ ██║${RESET}
${PURPLE}╚██╗ ██╔╝██║   ██║   ██║   ██║   ██║██║╚██╗██║${RESET}
${CYAN} ╚████╔╝ ╚██████╔╝   ██║   ╚██████╔╝██║ ╚████║${RESET}
${PURPLE}  ╚═══╝   ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═══╝${RESET}
${DARKPURPLE}████████╗██████╗  █████╗  ██████╗███████╗██████╗ ██╗${RESET}
${DARKPURPLE}╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██║${RESET}
${DARKPURPLE}   ██║   ██████╔╝███████║██║     █████╗  ██║  ██║██║${RESET}
${DARKPURPLE}   ██║   ██╔══██╗██╔══██║██║     ██╔══╝  ██║  ██║╚═╝${RESET}
${DARKPURPLE}   ██║   ██║  ██║██║  ██║╚██████╗███████╗██████╔╝██╗${RESET}
${DARKPURPLE}   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═════╝ ╚═╝${RESET}

EOF
}

# =============================================================================
# CLAWtopus Progress Bar
# =============================================================================
clawtopus_progress() {
    local percent=${1:-50}
    local width=40
    local filled=$((percent * width / 100))
    local empty=$((width - filled))

    printf "${CYAN}[${GREEN}"
    printf '█'%.0s $(seq 1 $filled 2>/dev/null)
    printf "${CYAN}]"
    printf ' %d%%' "$percent"
}

# =============================================================================
# Print with CLAWtopus styling
# =============================================================================
clawtopus_say() {
    local msg="$*"
    echo -e "  ${PURPLE}>${CYAN}>${WHITE} ${msg}"
}

# =============================================================================
# Print CLAWtopus status line
# =============================================================================
clawtopus_status() {
    local status="$1"  # "ok", "warn", "error", "info"
    local msg="$2"

    case "$status" in
        ok)
            echo -e "  ${GREEN}✓${RESET} ${msg}"
            ;;
        warn)
            echo -e "  ${YELLOW}⚠${RESET} ${msg}"
            ;;
        error)
            echo -e "  ${RED}✗${RESET} ${msg}"
            ;;
        info|*)
            echo -e "  ${CYAN}›${RESET} ${msg}"
            ;;
    esac
}

# =============================================================================
# Generate random CLAWtopus quote
# =============================================================================
clawtopus_quote() {
    local quotes=(
        "Eight arms. One mind."
        "Per-token is a scam."
        "HiveOS for AI. Finally."
        "Let's party."
        "Don't make me tap the sign."
        "I've got arms for days."
        "Local inference or bust."
        "No SaaS. No cry."
    )

    local idx=$((RANDOM % ${#quotes[@]}))
    echo -e "${YELLOW}\"${quotes[$idx]}\"${RESET} — CLAWtopus"
}

# =============================================================================
# Export functions (for use in other scripts via source)
# =============================================================================
export -f clawtopus_splash
export -f clawtopus_face
export -f clawtopus_happy
export -f clawtopus_sleepy
export -f clawtopus_evil
export -f clawtopus_banner
export -f clawtopus_progress
export -f clawtopus_say
export -f clawtopus_status
export -f clawtopus_quote

# If sourced directly (not in a subshell), run splash
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    : # Being sourced, don't auto-run
else
    # Being executed directly
    clawtopus_splash
fi
