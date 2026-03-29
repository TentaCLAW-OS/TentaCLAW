#!/bin/bash
# =============================================================================
# TentaCLAW OS — ASCII Art Collection
# =============================================================================
# Display various CLAWtopus ASCII art.
#
# Usage:
#   tentaclaw-art              # Random art
#   tentaclaw-art happy        # Happy octopus
#   tentaclaw-art all         # Show all art
#   tentaclaw-art --random    # Random art
#   tentaclaw-art --list      # List available art
#
# CLAWtopus says: "I'm not just one octopus. I'm MANY octopuses."
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
# ASCII Art Collection
# =============================================================================

art_happy() {
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
}

art_sleepy() {
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
}

art_evil() {
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
}

art_thinking() {
    cat << 'EOF'

    ${CYAN}     ,---.
   ${CYAN}    / ^ ^ \
   ${CYAN}    | (°) |
   ${CYAN}    | \___/ |
    ${CYAN}     \_____/
     ${CYAN}      |||||
   ${CYAN}       /|||||\
   ${CYAN}      ( @?@?@ )
    ${CYAN}       hmm...

EOF
}

art_party() {
    cat << 'EOF'

    ${PURPLE}     ,---.
   ${PURPLE}    / o o \
   ${PURPLE}    | \^o^/ |
    ${PURPLE}     \_____/
   ${CYAN}      |||||*
   ${CYAN}     /|||||*|\
   ${CYAN}    *|||*|*|||*
   ${YELLOW}    ~~~~~~~~~~~~
   ${PURPLE}     PARTY!

EOF
}

art_coding() {
    cat << 'EOF'

    ${CYAN}     ,---.
   ${CYAN}    / o o \
   ${CYAN}    | ~~~ |
   ${CYAN}    | \___/ |
    ${CYAN}     \_____/
     ${CYAN}      |||||
   ${CYAN}     /${PURPLE}|||||${CYAN}\
  ${CYAN}    /  ${PURPLE}@   @  ${CYAN}\
   ${CYAN}   (  ${PURPLE}|||||||  ${CYAN})
    ${CYAN}    \  ${PURPLE}@   @  ${CYAN}/
     ${CYAN}     =========

EOF
}

art_mining() {
    cat << 'EOF'

    ${GREEN}     ,---.
   ${GREEN}    /* * \
   ${GREEN}    | ~~~ |
   ${GREEN}    |/___/|
    ${GREEN}     |||||
   ${GREEN}    /|||||/\
   ${GREEN}   / ${YELLOW}GH${GREEN} /\
   ${GREEN}  (  ${YELLOW}HIVE${GREEN}  )
    ${GREEN}   =========

EOF
}

art_hacker() {
    cat << 'EOF'

    ${CYAN}     ,---.
   ${CYAN}    / 0 0 \
   ${CYAN}    | ~~~ |
   ${CYAN}    | \___/ |
    ${CYAN}     \_____/
     ${CYAN}      |||||
   ${CYAN}   __|||||||__
   ${CYAN}  /  ${PURPLE}////////  ${CYAN}\
  ${CYAN}  |  ${PURPLE} LINUX   ${CYAN} |
   ${CYAN}   \  ${PURPLE}////////  ${CYAN}/
    ${CYAN}     =========

EOF
}

art_love() {
    cat << 'EOF'

    ${RED}     ,---.
   ${RED}    / <3 <3 \
   ${RED}    |  ~~~  |
   ${RED}    | \___/ |
    ${RED}     \_____/
     ${RED}      |||||
     ${RED}     /|||||\
    ${RED}    (  @@@  )
     ${RED}     =======

EOF
}

art_fire() {
    cat << 'EOF'

    ${YELLOW}     ,---.
   ${YELLOW}    / ~~~ \
   ${YELLOW}    | (°) |
   ${YELLOW}    |/___/|
    ${YELLOW}     |||||
   ${RED}     /|||||\
  ${RED}    /  ~~~  \
  ${RED}   (   ===   )
    ${YELLOW}   ========

EOF
}

art_matrix() {
    cat << 'EOF'

    ${GREEN}     ,---.
   ${GREEN}    / 1 1 \
   ${GREEN}    | ~~~ |
   ${GREEN}    | \___/ |
    ${GREEN}     \_____/
     ${GREEN}      |||||
   ${GREEN}   01101101 01100001
   ${GREEN}   01110100 01110010
    ${GREEN}      |||||

EOF
}

art_space() {
    cat << 'EOF'

    ${CYAN}        *      .
   ${CYAN}    .    *       .
   ${CYAN}        ,---.
   ${CYAN}       / o o \
   ${CYAN}       | ~~~ |
   ${CYAN}       | \___/ |
    ${CYAN}        \_____/
     ${CYAN}         |||||
   ${CYAN}      . ||||| .
   ${CYAN}   *    ======    .
        .        *    .

EOF
}

# Full logo
art_logo() {
    cat << 'EOF'

    ${CYAN}        ╭──────────────────────────────────────────────────────────╮${RESET}
    ${CYAN}    ╭───┤  ${WHITE}TENTACLAW OS — AI inference cluster OS Inference Clusters${CYAN}  ├───╮${RESET}
    ${CYAN}   ╭─┤                                                         ╰─┤${CYAN}
    ${CYAN}   │╭┴───────────────────────────────────────────────────────────┴╮│
    ${CYAN}   ││                                                               ││
    ${CYAN}   ││${PURPLE}           ██████╗ ████████╗ ██████╗ ███╗   ██╗               ││
    ${CYAN}   ││${PURPLE}           ██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║               ││
    ${CYAN}   ││${PURPLE}           ██████╔╝   ██║   ██║   ██║██╔██╗ ██║               ││
    ${CYAN}   ││${PURPLE}           ██╔══██╗   ██║   ██║   ██║██║╚██╗██║               ││
    ${CYAN}   ││${PURPLE}           ██║  ██║   ██║   ╚██████╔╝██║ ╚████║               ││
    ${CYAN}   ││${PURPLE}           ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝               ││
    ${CYAN}   ││${TEAL}           ██████╗ ███████╗ █████╗ ██████╗ ██╗   ██╗███████╗   ││
    ${CYAN}   ││${TEAL}           ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║   ██║██╔════╝   ││
    ${CYAN}   ││${TEAL}           ██████╔╝█████╗  ███████║██████╔╝██║   ██║███████╗   ││
    ${CYAN}   ││${TEAL}           ██╔══██║██╔══╝  ██╔══██║██║  ██║╚██╗ ██╔╝╚════██║   ││
    ${CYAN}   ││${TEAL}           ██║  ██║███████╗██║  ██║██║  ██║ ╚████╔╝ ███████║   ││
    ${CYAN}   ││${TEAL}           ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝   ││
    ${CYAN}   ││                                                               ││
    ${CYAN}   │╰───────────────────────────────────────────────────────────────╯│
    ${CYAN}   │  ${WHITE}Eight arms. One mind. Zero compromises.${CYAN}                              │
    ${CYAN}   ╰─────────────────────────────────────────────────────────────────╯

EOF
}

# =============================================================================
# Main
# =============================================================================

show_art() {
    local art_name="$1"
    
    case "$art_name" in
        happy) art_happy ;;
        sleepy|sleep) art_sleepy ;;
        evil|angry) art_evil ;;
        thinking|hmm) art_thinking ;;
        party|celebrate) art_party ;;
        coding|code) art_coding ;;
        mining|mine) art_mining ;;
        hacker|1337) art_hacker ;;
        love|heart) art_love ;;
        fire|hot) art_fire ;;
        matrix|neo) art_matrix ;;
        space|cosmos) art_space ;;
        logo|banner) art_logo ;;
        all)
            for a in happy sleepy evil thinking party coding mining hacker love fire matrix space logo; do
                echo -e "${BOLD}${CYAN}═══ $a ═══${RESET}"
                "art_$a"
                echo ""
            done
            ;;
        *)
            echo -e "${RED}Unknown art: $art_name${RESET}"
            echo -e "${DIM}Available: happy, sleepy, evil, thinking, party, coding, mining, hacker, love, fire, matrix, space, logo${RESET}"
            return 1
            ;;
    esac
}

list_arts() {
    echo -e "${BOLD}${CYAN}Available ASCII Art:${RESET}"
    echo ""
    echo -e "  ${PURPLE}happy${RESET}        - Happy octopus (◉‿◉)"
    echo -e "  ${PURPLE}sleepy${RESET}       - Sleepy octopus zZZZ"
    echo -e "  ${PURPLE}evil${RESET}         - Evil mode >:)"
    echo -e "  ${PURPLE}thinking${RESET}       - Deep thought..."
    echo -e "  ${PURPLE}party${RESET}         - Party time!"
    echo -e "  ${PURPLE}coding${RESET}        - Coding octopus"
    echo -e "  ${PURPLE}mining${RESET}        - TentaCLAW vibes"
    echo -e "  ${PURPLE}hacker${RESET}        - Matrix vibes"
    echo -e "  ${PURPLE}love${RESET}          - Love is in the air"
    echo -e "  ${PURPLE}fire${RESET}          - Things are heating up"
    echo -e "  ${PURPLE}matrix${RESET}        - Follow the white rabbit"
    echo -e "  ${PURPLE}space${RESET}         - Space octopus"
    echo -e "  ${PURPLE}logo${RESET}          - TentaCLAW OS logo"
    echo ""
    echo -e "${DIM}Use: tentaclaw-art <name>${RESET}"
}

main() {
    local art="${1:-}"
    local random=false
    
    # Parse args
    if [ "$art" = "--random" ] || [ "$art" = "-r" ]; then
        random=true
    elif [ "$art" = "--list" ] || [ "$art" = "-l" ]; then
        list_arts
        return 0
    elif [ -z "$art" ]; then
        random=true
    fi
    
    if [ "$random" = true ]; then
        local arts=(happy sleepy evil thinking party coding hacker love fire matrix space)
        art="${arts[$((RANDOM % ${#arts[@]}))]}"
    fi
    
    # Resolve aliases
    case "$art" in
        h) art=happy ;;
        s) art=sleepy ;;
        e) art=evil ;;
        t) art=thinking ;;
        p) art=party ;;
        c) art=coding ;;
        m) art=mining ;;
        l) art=love ;;
        f) art=fire ;;
        x) art=matrix ;;
        logo) art=logo ;;
    esac
    
    show_art "$art"
}

main "$@"
