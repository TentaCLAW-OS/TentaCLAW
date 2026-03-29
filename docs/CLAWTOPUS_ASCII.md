# CLAWtopus ASCII Art Library

All ASCII art for TentaCLAW OS. Copy-paste ready.

## Usage in Code

```bash
# In shell scripts, source this file and use the variables:
source ascii_art.sh
echo "$CLAWTOPUS_NORMAL"
echo "$CLAWTOPUS_BOOT"
```

## Color Variables (ANSI)

```bash
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
```

---

## Full Size - Boot Splash

```
${CYAN}        ╭──────────────────╮${RESET}
${CYAN}    ╭───┤  ${WHITE}TENTACLAW OS  ${CYAN}├───╮${RESET}
${CYAN}   ╭─┤  ${WHITE}AI inference cluster OS${RESET}    ╰─┤${RESET}
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
${YELLOW}   > per-token is a scam_<${RESET}
```

---

## Mini Version (Prompt Size)

```
${PURPLE},---.${RESET}
${PURPLE}/  ◉ ◉  \\${RESET}
${PURPLE}|  ${CYAN}\\___/${PURPLE}  |${RESET}
${PURPLE}\\${TEAL}~~~~~~~${PURPLE}/${RESET}
${PURPLE} \`--.__.--'${RESET}
${CYAN}   ||  ||${RESET}
${CYAN}  ${TEAL}/|  |\\${CYAN}
${PURPLE} / |  | \\${RESET}
```

---

## State: Evil (Nodes Down)

```
${RED},---.
${RED}|${WHITE} x x ${RED}|
${RED}|${WHITE}  ▼  ${RED}|
${RED} \\___/${RED}
${RED}  |||||
${RED}  /||||\\
${RED} REKT.${RESET}
```

---

## State: Sleeping (Shutdown)

```
${CYAN},---.
${CYAN}|${WHITE} - - ${CYAN}|
${CYAN}|${WHITE}  ○  ${CYAN}|
${CYAN} \\___/${CYAN}
${TEAL}  |||||
${TEAL} ~|||||~
${CYAN}  ~~~~~
${PURPLE}zzZZZZzz${RESET}
```

---

## State: Benchmarking (Proud)

```
${CYAN}    ╭────────────╮
${CYAN}    │ ${GREEN}★ ★ ★ ★ ★${CYAN} │
${CYAN}    │  BENCHING  │
${CYAN}    ╰────────────╯
${PURPLE}    |||||||||
${PURPLE}   /${CYAN}|||||||||${PURPLE}\\
${PURPLE}  (${TEAL}@${PURPLE})${TEAL}@${PURPLE}@${TEAL}@${PURPLE}@${TEAL}@
${CYAN}  CLAWtopus: "Not bad, human."${RESET}
```

---

## State: Thinking (Processing)

```
${CYAN}       ╭──────────────────────╮${RESET}
${CYAN}       │${PURPLE}    _________     ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}   /         \\   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}  |  ${CYAN}O   O${PURPLE}  |   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}  |    ${CYAN}ω${PURPLE}    |   ${CYAN}      │${RESET}
${CYAN}       │${PURPLE}   \\_________/   ${CYAN}      │${RESET}
${CYAN}       │${TEAL}  ||||||||||||||  ${CYAN}      │${RESET}
${CYAN}       │${TEAL}  ||||||||||||||  ${CYAN}      │${RESET}
${CYAN}       ╰──────────────────────╯${RESET}
${CYAN}         HMMMMM. Processing.${RESET}
```

---

## State: Proud (Model Deployed)

```
${GREEN}       ╭──────────────────────────╮${RESET}
${GREEN}       │  ${CYAN}★${GREEN}  CLAWtopus APPROVES  ${CYAN}★${GREEN}  │${RESET}
${GREEN}       │${PURPLE}    ╭────────────────╮${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    │${CYAN}  MODEL LIVE  ${PURPLE}│${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    │${CYAN}  7B params   ${PURPLE}│${GREEN}    │${RESET}
${GREEN}       │${PURPLE}    ╰────────────────╯${GREEN}    │${RESET}
${GREEN}       │${TEAL}      ||||||||||||||      │${RESET}
${GREEN}       │${TEAL}     /${CYAN}|||||||||||||${TEAL}\\     │${RESET}
${GREEN}       ╰──────────────────────────╯${RESET}
${GREEN}         "You're welcome."${RESET}
```

---

## State: Judging (Low VRAM)

```
${YELLOW}       ╭──────────────────────────╮${RESET}
${YELLOW}       │${WHITE}   ...really? ${YELLOW}           │${RESET}
${YELLOW}       │${PURPLE}        ╭────╮${YELLOW}          │${RESET}
${YELLOW}       │${PURPLE}       /${WHITE} x x ${PURPLE}\\${YELLOW}         │${RESET}
${YELLOW}       │${PURPLE}       |${CYAN} ~~~ ${PURPLE}|${YELLOW}         │${RESET}
${YELLOW}       │${PURPLE}       \\${WHITE}-----/${YELLOW}         │${RESET}
${YELLOW}       │${TEAL}         ||||||${YELLOW}          │${RESET}
${YELLOW}       │${TEAL}        /|||||||\\${YELLOW}         │${RESET}
${YELLOW}       ╰──────────────────────────╯${RESET}
${YELLOW}         "21GB used. Bold choice."${RESET}
```

---

## State: Debug Mode (Verbose)

```
${CYAN}       ╭──────────────────────────────────────────╮${RESET}
${CYAN}       │ DEBUG MODE${RESET}                              │${RESET}
${CYAN}       │ ${PURPLE}[00:00:00]${CYAN} GPU0: Detecting...${RESET}           │${RESET}
${CYAN}       │ ${PURPLE}[00:00:01]${CYAN} GPU0: RTX 3090 found${RESET}          │${RESET}
${CYAN}       │ ${PURPLE}[00:00:02]${CYAN} GPU1: Detecting...${RESET}           │${RESET}
${CYAN}       │ ${PURPLE}[00:00:03]${CYAN} GPU1: RTX 3090 found${RESET}          │${RESET}
${CYAN}       │ ${PURPLE}[00:00:04]${CYAN} MEM: 24GB / 24GB allocated${RESET}   │${RESET}
${CYAN}       │ ${PURPLE}[00:00:05]${CYAN} CLAW: "This is fine."${RESET}       │${RESET}
${CYAN}       │ ${TEAL}       ||||||||||||||||||||||${CYAN}        │${RESET}
${CYAN}       │ ${TEAL}      /${PURPLE}|||||||||||||||||||${TEAL}\\       │${RESET}
${CYAN}       ╰──────────────────────────────────────────╯${RESET}
```

---

## State: Synced (Multi-Node)

```
${CYAN}   ╭───╮   ╭───╮   ╭───╮   ╭───╮${RESET}
${CYAN}   │ ◉ │───│ ◉ │───│ ◉ │───│ ◉ │${RESET}
${CYAN}   ╰───╯   ╰───╯   ╰───╯   ╰───╯${RESET}
${CYAN}     │       │       │       │${RESET}
${CYAN}     ╰───────┼───────┼───────╯${RESET}
${CYAN}             │${PURPLE}       │${RESET}
${CYAN}         ╭───┴───╮${RESET}
${CYAN}         │${PURPLE} CLAWtopus ${CYAN}│${RESET}
${CYAN}         │${PURPLE}  ◉    ◉  ${CYAN}│${RESET}
${CYAN}         ╰───────╯${RESET}
${GREEN}   "Four arms. Four arms. All synchronized."${RESET}
```

---

## State: Alone (Single GPU)

```
${CYAN}       ╭──────────────────────────╮${RESET}
${CYAN}       │${PURPLE}        ___              ${CYAN}  │${RESET}
${CYAN}       │${PURPLE}       /   \\   ${CYAN}         │${RESET}
${CYAN}       │${PURPLE}      |  ◉   |  ${CYAN}   Hi!   │${RESET}
${CYAN}       │${PURPLE}       \\___/   ${CYAN}         │${RESET}
${CYAN}       │${TEAL}         |||||${CYAN}           │${RESET}
${CYAN}       │${TEAL}        /|||||\\${CYAN}          │${RESET}
${CYAN}       ╰──────────────────────────╯${RESET}
${CYAN}         "Just you and me. Cute."${RESET}
```

---

## Boot Splash (Full Screen)

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║    ${CYAN}██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ██╗${RESET}              ║
║    ${CYAN}██║   ██║██╔═══██╗╚══██╔══╝██╔═══██╗████╗  ██║${RESET}              ║
║    ${CYAN}██║   ██║██║   ██║   ██║   ██║   ██║██╔██╗ ██║${RESET}              ║
║    ${CYAN}╚██╗ ██╔╝██║   ██║   ██║   ██║   ██║██║╚██╗██║${RESET}              ║
║    ${CYAN} ╚████╔╝ ╚██████╔╝   ██║   ╚██████╔╝██║ ╚████║${RESET}              ║
║    ${CYAN}  ╚═══╝   ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═══╝${RESET}              ║
║                                                                  ║
║    ${PURPLE}████████╗██████╗  █████╗  ██████╗███████╗██████╗ ██╗${RESET}       ║
║    ${PURPLE}╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██║${RESET}       ║
║    ${PURPLE}   ██║   ██████╔╝███████║██║     █████╗  ██║  ██║██║${RESET}       ║
║    ${PURPLE}   ██║   ██╔══██╗██╔══██║██║     ██╔══╝  ██║  ██║╚═╝${RESET}       ║
║    ${PURPLE}   ██║   ██║  ██║██║  ██║╚██████╗███████╗██████╔╝██╗${RESET}       ║
║    ${PURPLE}   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═════╝ ╚═╝${RESET}       ║
║                                                                  ║
║    ${TEAL}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${RESET}    ║
║                                                                  ║
║    ${WHITE}Eight arms. One mind. Zero compromises.${RESET}                             ║
║    ${WHITE}AI inference cluster OS Inference Clusters${RESET}                            ║
║                                                                  ║
║    ${CYAN}[ CLAWtopus ]${RESET} — Loading...                              ║
║                                                                  ║
║    ${PURPLE}    ╭──────────────────────────────────────╮${RESET}           ║
║    ${PURPLE}    │${TEAL}  Detecting hardware... ${CYAN}████████████░░░░░${PURPLE} │${RESET}           ║
║    ${PURPLE}    │${TEAL}  GPU: RTX 3090 x2 ${CYAN}████████████████░░░░${PURPLE} │${RESET}           ║
║    ${PURPLE}    │${TEAL}  Network: DHCP ${CYAN}████████████████████░░${PURPLE} │${RESET}           ║
║    ${PURPLE}    │${TEAL}  Registering... ${CYAN}██████████████████████${PURPLE} │${RESET}           ║
║    ${PURPLE}    ╰──────────────────────────────────────╯${RESET}           ║
║                                                                  ║
║    ${GREEN}✓ All 8 arms deployed. Inference ready.${RESET}                      ║
║                                                                  ║
║    ${YELLOW}> per-token is a scam_<${RESET}                                    ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Weekly Status - Monday

```
${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  MONDAY: CLAWtopus Check-In${CYAN}        │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}✓${RESET} All arms deployed                │${RESET}
${CYAN}│  ${GREEN}✓${RESET} Cluster healthy                   │${RESET}
${CYAN}│  ${GREEN}✓${RESET} Ready for another week            │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}This week: Deploy something cool.${CYAN}  │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
${CYAN}          Eight arms. One mind.${RESET}
```

---

## Weekly Status - Friday

```
${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  FRIDAY: Weekly Stats${CYAN}               │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  Tokens served: ${GREEN}1,247,832${CYAN}            │${RESET}
${CYAN}│  Requests handled: ${GREEN}4,291${CYAN}             │${RESET}
${CYAN}│  GPU hours: ${GREEN}167${CYAN}                       │${RESET}
${CYAN}│  Failures: ${RED}3${CYAN} (rerouted successfully)   │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}"Not bad for a pile of silicon."${CYAN}   │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
```

---

## Countdown - 7 Days

```
${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  7 DAYS UNTIL LAUNCH${CYAN}                │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if your GPUs could think?${CYAN}      │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if managing them was easy?${CYAN}    │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}What if an octopus did it?${CYAN}          │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}Find out Sunday Night.${CYAN}              │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
```

---

## Countdown - 3 Days

```
${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  3 DAYS UNTIL LAUNCH${CYAN}                 │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}I had a dream about a cluster OS.${CYAN}    │${RESET}
${CYAN}│  ${WHITE}It was beautiful. It was simple.${CYAN}     │${RESET}
${CYAN}│  ${WHITE}It had eight arms.${CYAN}                   │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${YELLOW}"Too weird to be real."${CYAN}             │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}3 days. Then it's real.${CYAN}              │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
```

---

## Countdown - 1 Day

```
${CYAN}╭──────────────────────────────────────╮${RESET}
${CYAN}│${PURPLE}  1 DAY UNTIL LAUNCH${CYAN}                  │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${WHITE}Tomorrow, your GPUs get a brain.${CYAN}     │${RESET}
${CYAN}│  ${WHITE}Her name is CLAWtopus.${CYAN}               │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${CYAN}       ╭───╮${CYAN}                       │${RESET}
${CYAN}│  ${CYAN}       │ ◉ │${CYAN}  "Ready when you are." │${RESET}
${CYAN}│  ${CYAN}       ╰───╯${CYAN}                       │${RESET}
${CYAN}│                                      │${RESET}
${CYAN}│  ${GREEN}Sunday Night. Check GitHub.${CYAN}          │${RESET}
${CYAN}╰──────────────────────────────────────╯${RESET}
```

---

## Launch Day

```
${CYAN}╭──────────────────────────────────────╮${RESET}
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
${CYAN}╰──────────────────────────────────────╯${RESET}
```

---

## Sticker Designs (Copy-Paste)

### Sticker A - Minimal
```
,---.
| o o |
|  ω  |
\\|||//
 ||||
Eight arms. One mind.
TentaCLAW OS
```

### Sticker B - Full Logo
```
╭──────────────────────╮
│  TENTACLAW OS        │
│                      │
│    ╭───╮             │
│    │ ◉ │ CLAWtopus  │
│    ╰───╯             │
│                      │
│  "Per-token is a     │
│   scam."             │
╰──────────────────────╯
```

### Sticker C - Logo Only
```
[CLAWtopus face]

TENTACLAW

Eight arms. One mind.
```
