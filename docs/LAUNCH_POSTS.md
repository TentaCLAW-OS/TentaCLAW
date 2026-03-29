# TentaCLAW OS Launch Posts

## Hacker News Submission

**Title**: TentaCLAW OS: A purpose-built Linux for AI inference clusters (like HiveOS, but for AI)

**Body**:
```
TentaCLAW OS is a new Linux distribution designed specifically for AI inference clusters. Think HiveOS but for running distributed AI inference workloads instead of GPU mining.

## What it does

- **Zero-config GPU detection**: Automatically detects and configures NVIDIA/AMD GPUs on boot
- **Push-based HiveMind protocol**: Nodes phone home with stats, receive commands via response headers (like HiveOS farm hash system)
- **One-click model deployment**: Deploy models to your cluster with a single command
- **Distributed inference gateway**: Built-in API gateway with streaming, routing, health checks, and rate limiting
- **PXE boot support**: Boot entire racks over the network

## Key features

- Farm Hash identity system (SHA256 hardware signature → cluster identity)
- Stateless config (/etc/tentaclaw/ for offline operation)
- Multi-layer GPU detection (lspci → vendor detection → BUSID mapping)
- Flight sheet-style model configs (swap configs to change deployed model)
- Watchdog daemon for hardware monitoring

## The fun part

- **CLAWtopus** - our octopus mascot who lives in the terminal
- Custom bashrc with ASCII art, progress bars, and personality
- Interactive setup wizard with CLAWtopus guiding you
- Fun system info display with gpu/util stats and fun facts
- Color scheme: Cyan #00FFFF, Purple #8C00C8, Teal #008C8C

## Built with

- Ubuntu base (debootstrap)
- Custom kernel config for inference workloads
- TypeScript agent daemon
- Express gateway with SSE streaming
- xorriso for ISO building
- iPXE for network boot

## Why

HiveOS revolutionized GPU mining with its plug-and-play approach. We wanted to bring that same ease-of-use to AI inference clusters. Running a distributed inference setup shouldn't require a PhD in cluster management.

## Links

- GitHub: https://github.com/TentaCLAW-OS/TentaCLAW-OS
- Website: https://www.TentaCLAW.io (coming soon)
- Discord: The Tank (community server)

## v1.0.0 launching Sunday

Would love feedback from the community on the architecture and approach. Pull requests welcome!

(The octopus ASCII art in the terminal is optional but highly recommended)
```

---

## Lobsters Submission

**Title**: TentaCLAW OS – Linux for AI inference clusters, with octopus mascot

**Body**:
```
TentaCLAW OS is a purpose-built Linux distribution for AI inference clusters. Inspired by HiveOS's success with GPU mining, we wanted to bring that same plug-and-play philosophy to distributed AI inference.

## Architecture Highlights

- **Farm Hash System**: SHA256 of hardware signatures creates unique cluster/node identity (same pattern as HiveOS)
- **Push Telemetry**: Nodes POST stats every 10s, commands received in HTTP response headers
- **Stateless Config**: /etc/tentaclaw/ contains all config; nodes work offline
- **GPU Detection**: Multi-layer: lspci → GPU_VENDOR → BUSID mapping → driver validation
- **Flight Sheets**: Model configs stored as swappable files (like HiveOS flight sheets)

## Technical Stack

- Ubuntu base via debootstrap
- Custom kernel config for inference workloads
- TypeScript agent (stats collection, command execution)
- Express gateway with SSE streaming, health checks, routing
- xorriso for ISO, iPXE for PXE boot

## Fun Features

- CLAWtopus: Octopus mascot living in your terminal
- Custom bashrc with ASCII art, aliases, and personality
- Interactive setup wizard with CLAWtopus guiding you
- Progress bars, fun facts, jokes

## Why "TentaCLAW"?

Tentacle + Claw = TentaCLAW. The mascot is CLAWtopus, an octopus who manages your GPUs with 8 arms (like your 8-GPU rig).

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW-OS

Launching v1.0.0 Sunday. Feedback welcome!
```

---

## r/selfhosted Submission

**Title**: TentaCLAW OS – We built a purpose-built Linux for AI inference clusters (like HiveOS for AI inference)

**Body**:
```
Hey r/selfhosted! We built TentaCLAW OS – a Linux distribution specifically for AI inference clusters. Like HiveOS revolutionized GPU mining, we wanted to make distributed AI inference accessible to everyone.

## The Problem

Setting up an AI inference cluster usually means:
- Manual GPU configuration
- Custom scripts everywhere
- No easy way to deploy models across multiple nodes
- reinventing the wheel for monitoring and health checks

## Our Solution

TentaCLAW OS handles:

- **Auto GPU detection** – NVIDIA and AMD GPUs detected and configured on boot
- **Zero-config networking** – DHCP + gateway discovery out of the box
- **Push-based stats** – Nodes phone home with GPU/utilization stats
- **Command system** – Push commands to nodes via API
- **Model deployment** – One-command model deployment to your cluster
- **PXE boot** – Boot entire racks over the network

## Architecture

- Farm Hash identity (like HiveOS)
- Stateless /etc/tentaclaw/ config
- TypeScript agent daemon
- Express gateway with SSE streaming
- Health checks with exponential backoff

## The Fun Part

Meet **CLAWtopus** – your new terminal mascot. An octopus who:
- Greets you on login
- Shows you gpu stats with ASCII art
- Tells terrible jokes
- Guides you through setup

Color scheme: Cyan, Purple, Teal – it looks really nice in the terminal.

## Links

- GitHub: https://github.com/TentaCLAW-OS/TentaCLAW-OS
- Discord: "The Tank" – community server
- Docs: Quick start guide in the repo

## Questions?

Happy to answer questions about the architecture, design decisions, or anything else. We launched v1.0.0 today!

(Yes, the octopus mascot is mandatory. No, you can't disable it. Yes, it's worth it.)
```

---

## r/homelab Submission

**Title**: Built TentaCLAW OS – a purpose-built Linux for AI inference clusters (with an octopus mascot)

**Body**:
```
Sup r/homelab! Wanted to share TentaCLAW OS – a Linux distro we built specifically for AI inference clusters.

## Background

Been running some AI inference workloads at home and got tired of:
1. Manual GPU configuration on each node
2. Custom bash scripts for everything
3. No good way to manage multiple nodes
4. Reinventing the wheel for each new model

So we built TentaCLAW OS – think HiveOS but for AI inference.

## Features

- Auto GPU detection (NVIDIA + AMD)
- Zero-config networking (DHCP + gateway discovery)
- Push-based stats (nodes POST stats, receive commands in response)
- One-command model deployment
- PXE boot for entire racks
- Built-in streaming API gateway
- Hardware watchdog

## Architecture

Same principles that made HiveOS successful:
- Farm Hash identity (SHA256 of hardware sig)
- Stateless config in /etc/tentaclaw/
- Push telemetry every 10s
- Command queue via HTTP headers

## The Fun Part

We have a mascot named CLAWtopus – an octopus who lives in your terminal. He's there when you login, shows you gpu stats, tells jokes, and guides you through setup. The color scheme is Cyan/Purple/Teal and looks really slick.

## Specs

- Ubuntu base (debootstrap)
- Custom kernel config
- TypeScript agent
- Express gateway
- xorriso + iPXE

## Links

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW-OS
Discord: The Tank

Would love feedback from the homelab community!

EDIT: Added quick start guide link
```

---

## Template for Posting

### Pre-launch (Sunday)
1. Finalize all docs
2. Test the ISO in VM if possible
3. Prepare launch graphics (optional)
4. Draft all posts, save as drafts

### At Launch
1. Push final commit with v1.0.0 tag
2. Create GitHub release
3. Post HN first (submit early morning PST for best visibility)
4. Post Lobsters 10-15 min later
5. Post r/selfhosted and r/homelab
6. Post in Discord if you have one
7. Celebrate with CLAWtopus! 🐙

### Post-launch
1. Monitor for feedback
2. Respond to comments
3. Collect issues
4. Plan v1.0.1

---

*Good luck with the launch! 🐙*
