# TentaCLAW OS — Brand Campaign & Visual Identity

**Website**: [www.TentaCLAW.io](https://www.TentaCLAW.io)  
**GitHub**: [github.com/TentaCLAW-OS](https://github.com/TentaCLAW-OS)  
**Mascot:** CLAWtopus — the octopus who lives in your terminal  
**Launch Date:** Sunday Night (v1.0.0)  
**Version:** 1.0

---

## 1. Color Palette (Exact — Matched to Original Clawdia)

```
Primary:     #00FFFF  (Cyan — main brand, prompts, highlights)
Secondary:   #8C00C8  (Purple — CLAWtopus tentacles, accents)
Tertiary:    #008C8C  (Teal — gradients, secondary elements)
Accent:      #5000B4  (Dark purple — bold moments)
Background:  #0D1117  (GitHub dark — terminal background)
Text:        #F0F0F0  (White — readable text)
Success:     #00FF88  (Green — healthy nodes, good status)
Warning:     #FFDC00  (Yellow — warnings)
Error:       #FF4646  (Red — node down, errors)
```

### ANSI Escape Codes (for terminal output)
```bash
# Use these in shell scripts
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
TEAL='\x1b[38;2;0;140;140m'
DARKPURPLE='\x1b[38;2;80;0;180m'
WHITE='\x1b[38;2;240;240;240m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
RESET='\x1b[0m'
BOLD='\x1b[1m'
```

---

## 2. CLAWtopus — The Mascot

### Full ASCII Art (Terminal Boot Splash)
```
${CYAN}        ╭──────────────────╮${RESET}
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
${WHITE}   Eight arms. One mind. No SaaS.${RESET}
${YELLOW}   > per-token is a scam_<${RESET}
```

### CLAWtopus Face (Smol version — for prompts)
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

### CLAWtopus — The "Evil" Mode (when nodes are down)
```
${RED},---.
${RED}|${WHITE} x x ${RED}|
${RED}|${WHITE}  ▼  ${RED}|
${RED} \\___/${RED}
${RED}  |||||
${RED}  /||||\\
${RED} REKT.${RESET}
```

### CLAWtopus Going to Sleep (shutdown)
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

### CLAWtopus Benchmarking (proud)
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

## 3. Boot Splash (Full Screen — what users see on ISO boot)

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
║    ${WHITE}Eight arms. One mind. No SaaS.${RESET}                             ║
║    ${WHITE}HiveOS for AI Inference Clusters${RESET}                            ║
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

## 4. Brand Voice — CLAWtopus Personality

### Core Traits
- **Sassy** — She has opinions. She'll roast you gently.
- **Autonomous** — She works while you sleep. Eight arms go everywhere.
- **Anti-SaaS** — She hates subscription fees.本地 all the way.
- **Terminal-native** — She lives in the shell. Not a webpage.
- **Caring** — She worries about your GPUs. Warns about temps.

### CLAWtopus Quotes (for various situations)

**Startup:**
- "Bitchen. All arms online."
- "Waking up... stretching all eight legs. Wait, I don't have legs. Whatever."
- "Systems check? Please. I was BORN ready."
- "Eight arms, zero patience for manual config."

**Node Up:**
- "Ooh, look who decided to show up. Welcome back, babe."
- "Another arm wrapped around a node. Got it."
- "Hey, you're mine now. Just kidding. ...Unless?"

**Node Down:**
- "They ghosted me. Rerouting, no big deal."
- "Lost one. I've got seven other arms. I'm resilient like that."
- "Ouch. ${NODE_NAME} went dark. Already moved on."

**Model Loaded:**
- "Hermes 3 is online. Try not to overwhelm my arms."
- "New model loaded. I'm basically a genius now."
- "Look, another model in my VRAM. I contain multitudes."

**Overheating:**
- "Hey, your GPU is running hot. Maybe ease up on the overclock?"
- "Temperature spike detected. I'm not your mother, but... chill out?"
- "Your 3090 is sweating. That's not cute."

**Queue Full:**
- "All arms busy. You're in line, human."
- "Everyone's working. Patience. You're in the queue."
- "Queue mode. I don't make the rules. Actually, I do."

**Benchmark Done:**
- "Not bad for junk drawer hardware."
- "Results are in. Here's what your cluster can do."
- "Bitchen. My tentacles are fast."

**Errors:**
- "Well that's not ideal. Let me figure this out."
- "Error? I don't do errors. ...Okay fine, this one time."
- "Yikes. Something broke. Give me a sec."

**Shutdown:**
- "K, going back to sleep. Wake me when you need me."
- "Eight arms finally at rest. ...Don't tickle me."

---

## 5. Viral Campaign Ideas

### #1 — "POV: You Just Discovered TentaCLAW"

```
[3-min screen recording]

0:00  Fresh Ubuntu install. Empty terminal.
0:08  Flash USB. Boot.
0:15  CLAWtopus ASCII art appears with boot messages
0:23  "GPU detected: RTX 3090 x2" 
0:31  "Farm Hash: FARM7K3P" — user writes it down
0:45  Dashboard shows both nodes. Green.
1:02  Click "Deploy Model" — select Hermes 3
1:15  "Model deployed to 2 nodes"
1:30  Type a prompt. Response streams back.
1:45  CLI output: "✓ All 8 arms deployed. Inference ready."

Caption: "POV: You just found out you don't need to pay $0.01/token anymore"
```

### #2 — "My Homelab Has Tentacles" (Meme)

```
[Tweet/Post]

"My homelab has tentacles now and I'm not sure how to feel about it"

[Image: CLAWtopus ASCII art with your GPU stats]

"#TentaCLAW #Homelab #LocalAI"

---

[Reply chain]

"why does your homelab have an octopus"
"long story. it started with one GPU and ended with this"
"doesn't everyone have an 8-armed AI coordinator?"
"I literally cannot go back now"
```

### #3 — "Per-Token Is A Scam" — The Cost Comparison

```
[Infographic]

OpenAI GPT-4o:
$0.01 per 1K tokens
Your query: 500 tokens
Daily usage: 100 queries
COST: $0.50/day = $15/month = $180/year

Your RTX 3090 (24GB VRAM):
Idle power: 10W
Inference power: 300W
Daily usage: 8 hours
ELECTRICITY: $0.78/day = $23/month = $285/year

BUT WAIT — you own the GPU.
Cost to run locally: $285/year
Cost to rent from OpenAI: $180/year for 500 tokens/day

"HOW IS THIS CHEAPER??"

[Graph showing break-even at 10 queries/day]

"For most people: local is already cheaper. And you own it forever."
```

### #4 — "CLAWtopus, Why?" (FAQ Comedy)

```
Q: Why does she have eight arms?
A: Because four arms couldn't handle the GPU load.

Q: What does she eat?
A: Electricity and validation.

Q: Is she sentient?
A: She likes to think so. Her AI says yes.

Q: Why purple?
A: Because cyan alone was too mainstream.

Q: Will she judge my hardware?
A: Never. But she WILL tell you when your VRAM is full.

Q: Can I run her on a potato?
A: She'll detect it. And she'll be disappointed.
```

### #5 — "Hacktoberfest or Hacktoctopus"

```
[Event Banner]

    ╭────────────────────────────────────────────╮
    │                                            │
    │   ${PURPLE}H A C K T O${CYAN} C T O P U S${RESET}           │
    │                                            │
    │   ${TEAL}████████╗██████╗ █████╗ ██████╗${RESET}            │
    │   ${TEAL}╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗${RESET}            │
    │   ${TEAL}   ██║   ██████╔╝███████║██████╔╝${RESET}            │
    │   ${TEAL}   ██║   ██╔══██╗██╔══██║██╔══██╗${RESET}            │
    │   ${TEAL}   ██║   ██║  ██║██║  ██║██║  ██║${RESET}            │
    │   ${TEAL}   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝${RESET}            │
    │                                            │
    │   October 1-31 • Submit PRs • Earn merch  │
    │                                            │
    │   [CLAWtopus Contributor Badge]            │
    │                                            │
    ╰────────────────────────────────────────────╯

Issue labels:
- "CLAWtopus-wanted" — Easy first contribution
- "tentacle-ready" — Good for newcomers  
- "eight-arms" — Complex, reward included
```

---

## 6. Taglines & Positioning

### Primary Tagline
> **"Eight arms. One mind."**

### Long-form Positioning
> TentaCLAW OS: HiveOS for AI Inference Clusters
> - Zero-config GPU detection
> - Plug-and-play model deployment
> - Self-managing cluster with Farm Hash
> - Your hardware, your inference, your rules.

### Anti-SaaS Angle
> **"Per-token is a scam. Run local."**

### Hacker Cred
> **"Because configuring CUDA by hand is a hate crime."**

### For the LocalLLaMA Crowd
> **"Finally. A cluster OS that doesn't require a PhD."**

### Short & Punchy (for ads, stickers)
- "Eight arms. One mind."
- "HiveOS for AI"
- "Per-token is a scam."
- "Your GPUs. Your inference. Your cluster."
- "CLAWtopus does the boring stuff."

---

## 7. Questions & Things to Consider

### Before Launch — Answer These First

**1. Domain Name**
- `tentaclaw.os` — available?
- `tentaclaw.ai` — available?
- `tentaclaw.io` — available?
- `clawtopus.ai` — fun but separates brand from "OS"
- What domain are you buying for v1?

**2. GitHub Organization**
- Create `tentaclaw-os` org or repo?
- What's the repo name? `tentaclaw-os` or `tentaclaw`?
- Who's the primary maintainer?

**3. Release v1 Scope (2-Day Build)**
We can either:
- **Option A: MVP** — ISO that boots, detects GPU, shows CLAWtopus, generates Farm Hash, but no actual agent/gateway yet
- **Option B: Full** — ISO that boots + basic agent + gateway API endpoints for register/stats

Which for v1?

**4. Initial Hardware Support**
- NVIDIA only first? (easier — one driver path)
- AMD ROCm harder — needs different driver stack
- Both from day 1?

**5. License**
- MIT? Apache 2? GPL?
- CLAWtopus ASCII art — do we trademark the character?

**6. Launch Platform Priority**
Which order for the drop:
1. GitHub release (with ISO download)
2. Hacker News
3. Discord server
4. r/selfhosted
5. r/LocalLLaMA
6. Lobsters
7. Twitter/X

**7. Launch Date**
When's the deadline? This weekend?

**8. README First Impression**
First 30 seconds on GitHub matter. What does the README show?
- ASCII CLAWtopus right at top?
- One-liner + "HiveOS for AI"
- Demo GIF?

---

## 8. Sticker & Merch Ideas

### Instant Viral — Sticker Pack

**Design 1: ASCII CLAWtopus (the pasteable)**
```
${CYAN},---.${RESET}
${CYAN}|${WHITE} o o ${CYAN}|${RESET}
${CYAN}|${CYAN}\\___/${CYAN}|${RESET}
${PURPLE}||||||${RESET}
${PURPLE}/${CYAN}|||||\\${PURPLE}
```
Can be copy-pasted into any terminal.

**Design 2: "My Homelab Has Tentacles"**
- Bumper sticker format
- TentaCLAW logo + tagline
- Dark background, cyan + purple text

**Design 3: "Eight Arms. One Mind."**
- Minimalist
- Just CLAWtopus face + text
- On a hoodie

**Design 4: "Per-Token Is A Scam"**
- Controversial. Viral.
- People will screenshot it.

**Design 5: "HiveOS for AI"**
- Clear positioning
- For the mining crowd

### Physical Merch Priority
1. Stickers (cheapest, highest spread)
2. Hoodies (community pride)
3. ASCII Art Print (for dev offices)
4. plushie CLAWtopus (expensive, limited — reward for contributors)

---

## 9. Discord Server Structure ("The Tank")

```
#welcome          — CLAWtopus intro, rules, sticker channels
#announcements    — releases, updates
#general          — main chat
#help             — troubleshooting (CLAWtopus assists)
#showcase         — post your cluster pics
#flightsheets     — share model configs
#tentacle-talk    — off-topic, memes
#dev-ama          — ask the dev(s) anything
#contributors     — PRs, issues, roadmap
#sticker-claims   — post your CLAWtopus terminal, get free sticker
```

**Bot Personality**: CLAWtopus bot responds in terminal style.  
**Welcome message**: ASCII CLAWtopus + "Eight arms. One mind. Welcome to the tank."

---

## 10. README.md Template (First 60 Lines — Make or Break)

```markdown
<p align="center">
<!-- CLAWtopus ASCII Art -->
<pre>
        ${CYAN},---.${RESET}
    ${CYAN}/  o o  \\${RESET}
    ${CYAN}|  ${CYAN}\\___/${CYAN}  |${RESET}
    ${PURPLE}  |||||||  ${RESET}
    ${PURPLE} /${CYAN}|||||||\\${PURPLE}
    ${PURPLE}| | | | | |${RESET}
</pre>
<!-- Tagline -->
<h2>Eight arms. One mind.</h2>
<h3>HiveOS for AI Inference Clusters</h3>

**TentaCLAW OS** turns your pile of GPUs into a unified AI inference 
cluster — zero config, auto-discovery, one-click model deployment.

[![Discord](https://img.shields.io/discord/EXAMPLE?style=for-the-badge)](https://discord.gg/EXAMPLE)
[![GitHub Stars](https://img.shields.io/github/stars/tentaclaw-os/tentaclaw-os?style=for-the-badge)](https://github.com/tentaclaw-os/tentaclaw-os/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

---

## Quick Start

```bash
# Download ISO
wget https://github.com/tentaclaw-os/tentaclaw-os/releases/latest/download/TentaCLAW-OS-0.1.0-amd64.iso

# Flash to USB
sudo dd if=TentaCLAW-OS-0.1.0-amd64.iso of=/dev/sdX bs=4M status=progress

# Boot. That's it.
```

---

## What Even Is This?

> **HiveOS for AI**

Like HiveOS, but instead of mining rigs, you manage AI inference nodes.
Instead of hashrate, you track tokens/second.
Instead of flight sheets for miners, you have flight sheets for models.

CLAWtopus handles the boring stuff. You do the interesting stuff.

---

## Features

- ${GREEN}✓${RESET} Zero-config GPU detection (NVIDIA, AMD)
- ${GREEN}✓${RESET} Farm Hash registration — one hash identifies your entire cluster
- ${GREEN}✓${RESET} HiveOS-style push model — nodes push stats, receive commands
- ${GREEN}✓${RESET} One-click model deployment via flight sheets
- ${GREEN}✓${RESET} Auto-scaling inference across heterogeneous hardware
- ${GREEN}✓${RESET} CLAWtopus ASCII art (obviously)

---

## "Per-Token Is A Scam"

Every dollar you pay OpenAI is a dollar you could've spent on more VRAM.

TentaCLAW OS runs on YOUR hardware. You already own the GPUs.
You just need the OS to manage them like HiveOS manages mining rigs.

Your AI should run on your hardware. Your cluster should manage itself.
You shouldn't need a PhD to deploy 8 GPUs.

CLAWtopus does the boring stuff. You do the interesting stuff.
```

---

## 11. Two-Day Build Plan — LAUNCH: SUNDAY NIGHT

### Day 1: Saturday — Foundation

| Time | Task | Deliverable |
|------|------|-------------|
| 0-2h | Finalize README + docs | README.md, LICENSE, CONTRIBUTING.md |
| 2-4h | Build ISO skeleton | Bare ISO that boots and shows CLAWtopus |
| 4-6h | GPU detection scripts | 01-gpu-detect.sh with real lspci parsing |
| 6-8h | Boot splash + ASCII art | The visual identity is locked |
| 8-10h | Network bring-up | 02-network.sh with DHCP + gateway discovery |
| 10-12h | Registration flow | 03-hive-registration.sh with Farm Hash generation |

### Day 2: Sunday — Polish + Ship

| Time | Task | Deliverable |
|------|------|-------------|
| 0-2h | Gateway API (FULL) | /register + /stats + /commands endpoints |
| 2-4h | TentaCLAW Agent daemon | Full tentaclaw-agent with stats push loop |
| 4-6h | Integration test | QEMU test of full boot flow |
| 6-8h | Build scripts | build-iso.sh + build-pxe.sh automation |
| 8-10h | GitHub setup | Repo, org, releases, CI/CD |
| 10-12h | Pre-launch drop | Discord + social prep + HN draft |

### Launch Checklist (Sunday Night)
- [ ] ISO uploaded to GitHub releases
- [ ] README.md live and looking sharp
- [ ] Discord server open
- [ ] Domain www.TentaCLAW.io pointing to GitHub
- [ ] HN submission drafted
- [ ] r/selfhosted + r/LocalLLaMA posts ready
- [ ] Demo GIF/screenshots ready

### v1.0.0 Must Include (FULL SCOPE)
1. Bootable ISO that boots and shows CLAWtopus
2. GPU detection works (NVIDIA)
3. Farm Hash generated and displayed
4. Agent daemon runs and pushes stats
5. Gateway API handles register + stats + commands
6. Full HiveOS-style push model working
7. README shows the vision

### Nice to Have for v1 (skip if running late)
- AMD GPU detection (can add post-launch)
- PXE artifacts (can add post-launch)
- Overclocking (can add post-launch)

---

## 12. Open Questions for You

1. **Domain**: What domain are you buying? Do you have it yet?
2. **GitHub**: Create org `tentaclaw-os` or use personal? What's the repo name?
3. **Release scope**: MVP (boot + art + Farm Hash) or Full (boot + agent + gateway)?
4. **Launch date**: This weekend?
5. **Hardware target**: NVIDIA-only first, or NVIDIA + AMD?
6. **License**: MIT for code? CLAWtopus character — trademark or leave open?
7. **First demo video**: Do you have a test machine to record the boot flow?
8. **Color feedback**: Love the cyan + purple. Any tweaks? Want more purple? Less?
9. **Font**: Any specific terminal font preference? (IBM Plex Mono? Fira Code? JetBrains?)

---

*Last updated: 2026-03-28*  
*TentaCLAW OS — Eight arms. One mind. No SaaS.*
