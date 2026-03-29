#!/bin/bash
# CLAWtopus ASCII Art Library
# Source this file in your shell scripts: source ascii_art.sh

# ANSI Color Codes
export CYAN='\x1b[38;2;0;255;255m'
export PURPLE='\x1b[38;2;140;0;200m'
export TEAL='\x1b[38;2;0;140;140m'
export WHITE='\x1b[38;2;240;240;240m'
export GREEN='\x1b[38;2;0;255;136m'
export YELLOW='\x1b[38;2;255;220;50m'
export RED='\x1b[38;2;255;70;70m'
export DARKPURPLE='\x1b[38;2;80;0;180m'
export RESET='\x1b[0m'
export BOLD='\x1b[1m'

# CLAWtopus States
export CLAWTOPUS_NORMAL="${CYAN}        ╭──────────────────╮${RESET}
${CYAN}    ╭───┤  ${WHITE}TENTACLAW OS  ${CYAN}├───╮${RESET}
${CYAN}   ╭─┤  ${WHITE}HiveOS for AI${RESET}    ╰─┤${RESET}
${CYAN}   │╭┴────────────────────┴╮│${RESET}
${CYAN}   ││${PURPLE}    ___              ${CYAN}    ││${RESET}
${CYAN}   ││${PURPLE}   /   \\   ${CYAN}             ││${RESET}
${CYAN}   ││${PURPLE}  | ◉ ◉ |  ${CYAN}  CLAWtopus ││${RESET}
${CYAN}   ││${PURPLE}  |  ^  |  ${CYAN}  online!   ││${RESET}
${CYAN}   ││${PURPLE}   \\___/   ${CYAN}  8 arms   ││${RESET}
${CYAN}   │╰────────────────────╯│${RESET}
${CYAN}   │   ${TEAL}╔═══╗╔═══╗╔═══╗╔═══╗╔═══╗╔═══╗╔═══╗╔═══╗   │${RESET}
${CYAN}   │   ${TEAL}║ ◉ ║║ ◉ ║║ ◉ ║║ ◉ ║║ ◉ ║║ ◉ ║║ ◉ ║║ ◉ ║   │${RESET}
${CYAN}   │   ${TEAL}╚═══╝╚═══╝╚═══╝╚═══╝╚═══╝╚═══╝╚═══╝╚═══╝   │${RESET}
${CYAN}   ╰─────────────────────────────────────╯${RESET}
${WHITE}   Eight arms. One mind. Zero compromises.${RESET}
${YELLOW}   > per-token is a scam_<${RESET}"

export CLAWTOPUS_MINI="${PURPLE},---.${RESET}
${PURPLE}/  ◉ ◉  \\${RESET}
${PURPLE}|  ${CYAN}\\___/${PURPLE}  |${RESET}
${PURPLE}\\${TEAL}~~~~~~~${PURPLE}/${RESET}
${PURPLE} \`--.__.--'${RESET}
${CYAN}   ||  ||${RESET}
${CYAN}  ${TEAL}/|  |\\${CYAN}
${PURPLE} / |  | \\${RESET}"

export CLAWTOPUS_EVIL="${RED},---.
${RED}|${WHITE} x x ${RED}|
${RED}|${WHITE}  ▼  ${RED}|
${RED} \\___/${RED}
${RED}  |||||
${RED}  /||||\\
${RED} REKT.${RESET}"

export CLAWTOPUS_SLEEPING="${CYAN},---.
${CYAN}|${WHITE} - - ${CYAN}|
${CYAN}|${WHITE}  ○  ${CYAN}|
${CYAN} \\___/${CYAN}
${TEAL}  |||||
${TEAL} ~|||||~
${CYAN}  ~~~~~
${PURPLE}zzZZZZzz${RESET}"

export CLAWTOPUS_BENCHMARK="${CYAN}    ╭────────────╮
${CYAN}    │ ${GREEN}★ ★ ★ ★ ★${CYAN} │
${CYAN}    │  BENCHING  │
${CYAN}    ╰────────────╯
${PURPLE}    |||||||||
${PURPLE}   /${CYAN}|||||||||${PURPLE}\\
${PURPLE}  (${TEAL}@${PURPLE})${TEAL}@${PURPLE}@${TEAL}@${PURPLE}@${TEAL}@
${CYAN}  CLAWtopus: \"Not bad, human.\"${RESET}"

export CLAWTOPUS_THINKING="${CYAN}       ╭──────────────────────╮${RESET}
${CYAN}       │${PURPLE}    _________     ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}   /         \\   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}  |  ${CYAN}O   O${PURPLE}  |   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}  |    ${CYAN}ω${PURPLE}    |   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}   \\_________/   ${CYAN}      │${RESET}
${CYAN}       │${TEAL}  ||||||||||||||  ${CYAN}      │${RESET}
${CYAN}       │${TEAL}  ||||||||||||||  ${CYAN}      │${RESET}
${CYAN}       ╰──────────────────────╯${RESET}
${CYAN}         HMMMMM. Processing.${RESET}"

export CLAWTOPUS_PROUD="${GREEN}       ╭──────────────────────────╮${RESET}
${GREEN}       │  ${CYAN}★${GREEN}  CLAWtopus APPROVES  ${CYAN}★${GREEN}  │${RESET}
${GREEN}       │${PURPLE}    ╭────────────────╮${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    │${CYAN}  MODEL LIVE  ${PURPLE}│${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    │${CYAN}  7B params   ${PURPLE}│${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    ╰────────────────╯${GREEN}    │${RESET}
${GREEN}       │${TEAL}      ||||||||||||||      │${RESET}
${GREEN}       │${TEAL}     /${CYAN}|||||||||||||${TEAL}\\     │${RESET}
${GREEN}       ╰──────────────────────────╯${RESET}
${GREEN}         \"You're welcome.\"${RESET}"

export CLAWTOPUS_JUDGING="${YELLOW}       ╭──────────────────────────╮${RESET}
${YELLOW}       │${WHITE}   ...really? ${YELLOW}           │${RESET}
${YELLOW}       │${PURPLE}        ╭────╮${YELLOW}          │${RESET}
${YELLOW}       │${PURPLE}       /${WHITE} x x ${PURPLE}\\${YELLOW}         │${RESET}
${YELLOW}       │${PURPLE}       |${CYAN} ~~~ ${PURPLE}|${YELLOW}         │${RESET}
${YELLOW}       │${PURPLE}       \\${WHITE}-----/${YELLOW}         │${RESET}
${YELLOW}       │${TEAL}         ||||||${YELLOW}          │${RESET}
${YELLOW}       │${TEAL}        /|||||||\\${YELLOW}         │${RESET}
${YELLOW}       ╰──────────────────────────╯${RESET}
${YELLOW}         \"21GB used. Bold choice.\"${RESET}"

export CLAWTOPUS_ALONE="${CYAN}       ╭──────────────────────────╮${RESET}
${CYAN}       │${PURPLE}        ___              ${CYAN}  │${RESET}
${CYAN}       │${PURPLE}       /   \\   ${CYAN}         │${RESET}
${CYAN}       │${PURPLE}      |  ◉   |  ${CYAN}   Hi!   │${RESET}
${CYAN}       │${PURPLE}       \\___/   ${CYAN}         │${RESET}
${CYAN}       │${TEAL}         |||||${CYAN}           │${RESET}
${CYAN}       │${TEAL}        /|||||\\${CYAN}          │${RESET}
${CYAN}       ╰──────────────────────────╯${RESET}
${CYAN}         \"Just you and me. Cute.\"${RESET}"

# Weekly Messages
export CLAWTOPUS_MONDAY="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  MONDAY: CLAWtopus Check-In${CYAN}        │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}✓${RESET} All arms deployed                │${RESET}
${CYAN}│  ${GREEN}✓${RESET} Cluster healthy                   │${RESET}
${CYAN}│  ${GREEN}✓${RESET} Ready for another week            │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}This week: Deploy something cool.${CYAN}  │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
${CYAN}          Eight arms. One mind.${RESET}"

export CLAWTOPUS_FRIDAY="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  FRIDAY: Weekly Stats${CYAN}               │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  Tokens served: ${GREEN}1,247,832${CYAN}            │${RESET}
${CYAN}│  Requests handled: ${GREEN}4,291${CYAN}             │${RESET}
${CYAN}│  GPU hours: ${GREEN}167${CYAN}                       │${RESET}
${CYAN}│  Failures: ${RED}3${CYAN} (rerouted successfully)   │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}\"Not bad for a pile of silicon.\"${CYAN}   │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}"

# Countdown
export CLAWTOPUS_COUNTDOWN_7="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  7 DAYS UNTIL LAUNCH${CYAN}                │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if your GPUs could think?${CYAN}      │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if managing them was easy?${CYAN}    │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if an octopus did it?${CYAN}          │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}Find out Sunday Night.${CYAN}              │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}"

export CLAWTOPUS_COUNTDOWN_3="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  3 DAYS UNTIL LAUNCH${CYAN}                 │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}I had a dream about a cluster OS.${CYAN}    │${RESET}
${CYAN}│  ${WHITE}It was beautiful. It was simple.${CYAN}     │${RESET}
${CYAN}│  ${WHITE}It had eight arms.${CYAN}                   │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}\"Too weird to be real.\"${CYAN}             │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}3 days. Then it's real.${CYAN}              │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}"

export CLAWTOPUS_COUNTDOWN_1="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  1 DAY UNTIL LAUNCH${CYAN}                  │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}Tomorrow, your GPUs get a brain.${CYAN}     │${RESET}
${CYAN}│  ${WHITE}Her name is CLAWtopus.${CYAN}               │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${CYAN}       ╭───╮${CYAN}                       │${RESET}
${CYAN}│  ${CYAN}       │ ◉ │${CYAN}  \"Ready when you are.\" │${RESET}
${CYAN}│  ${CYAN}       ╰───╯${CYAN}                       │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}Sunday Night. Check GitHub.${CYAN}          │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}"

export CLAWTOPUS_LAUNCH="${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${GREEN}  ★ IT'S LIVE ★${CYAN}                        │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}TentaCLAW OS v1.0.0 is out.${CYAN}         │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${CYAN}    ╭────────────────╮${CYAN}              │${RESET}
${CYAN}│  ${CYAN}    │${PURPLE}  SHE'S HERE  ${CYAN}│${CYAN}              │${RESET}
${CYAN}│  ${CYAN}    │${PURPLE}  Eight arms ${CYAN}│${CYAN}              │${RESET}
${CYAN}│  ${CYAN}    │${PURPLE}  Zero config${CYAN}│${CYAN}              │${RESET}
${CYAN}│  ${CYAN}    ╰────────────────╯${CYAN}              │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}Download. Flash. Boot. Done.${CYAN}        │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}github.com/TentaCLAW-OS${CYAN}              │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}"

# Helper function to print CLAWtopus with state
clawtopus() {
    local state="${1:-normal}"
    case "$state" in
        normal) echo "$CLAWTOPUS_NORMAL" ;;
        mini) echo "$CLAWTOPUS_MINI" ;;
        evil) echo "$CLAWTOPUS_EVIL" ;;
        sleeping|sleep) echo "$CLAWTOPUS_SLEEPING" ;;
        benchmark|bench) echo "$CLAWTOPUS_BENCHMARK" ;;
        thinking|think) echo "$CLAWTOPUS_THINKING" ;;
        proud) echo "$CLAWTOPUS_PROUD" ;;
        judging|judge) echo "$CLAWTOPUS_JUDGING" ;;
        alone) echo "$CLAWTOPUS_ALONE" ;;
        monday) echo "$CLAWTOPUS_MONDAY" ;;
        friday) echo "$CLAWTOPUS_FRIDAY" ;;
        countdown7|7days) echo "$CLAWTOPUS_COUNTDOWN_7" ;;
        countdown3|3days) echo "$CLAWTOPUS_COUNTDOWN_3" ;;
        countdown1|1day) echo "$CLAWTOPUS_COUNTDOWN_1" ;;
        launch) echo "$CLAWTOPUS_LAUNCH" ;;
        *)
            echo "Usage: clawtopus [state]"
            echo "States: normal, mini, evil, sleeping, benchmark, thinking, proud, judging, alone, monday, friday, countdown7, countdown3, countdown1, launch"
            return 1
            ;;
    esac
}
