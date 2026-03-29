# TentaCLAW OS — Project Documentation
# Generated: 2026-03-28
# =============================================================================

## PROJECT OVERVIEW

TentaCLAW OS is a purpose-built Linux distribution for AI inference clusters that 
combines HiveOS's plug-and-play GPU management with distributed inference gateway 
capabilities. Think "HiveOS for AI inference" — zero-config, auto-discovery, 
one-click model deployment.

**Website**: www.TentaCLAW.io
**GitHub**: github.com/TentaCLAW-OS
**Launch Date**: Sunday Night (v1.0.0)
**Scope**: FULL (ISO + Agent + Gateway API)

---

## THE VISION

Like HiveOS revolutionized GPU mining by making 1000-rig farms manageable from 
one dashboard, TentaCLAW OS makes AI inference clusters accessible to 
non-technical users. Your AI should run on YOUR hardware. Your cluster should 
manage itself. You shouldn't need a PhD to deploy 8 GPUs.

**CLAWtopus** handles the boring stuff. You do the interesting stuff.

---

## BRAND IDENTITY

### Name
- TentaCLAW = Tentacle + CLAW
- The "TENTACLE" metaphor works beautifully — eight arms = distributed nodes

### Mascot: CLAWtopus
An octopus who lives in the terminal and coordinates your AI inference cluster 
with eight arms. Sassy, autonomous, anti-SaaS.

### Color Palette (Exact)
```
Primary:     #00FFFF  (Cyan — main brand, prompts, highlights)
Secondary:   #8C00C8  (Purple — CLAWtopus tentacles, accents)
Tertiary:    #008C8C  (Teal — gradients, secondary elements)
Accent:      #5000B4  (Dark purple — bold moments)
Background:  #0D1117  (GitHub dark — terminal background)
Text:        #F0F0F0  (White — readable text)
Success:     #00FF88  (Green — healthy nodes)
Warning:     #FFDC00  (Yellow — warnings)
Error:       #FF4646  (Red — errors)
```

### Taglines
- Primary: "Eight arms. One mind."
- Anti-SaaS: "Per-token is a scam."
- Positioning: "HiveOS for AI Inference Clusters"
- Hacker: "Because configuring CUDA by hand is a hate crime."

### CLAWtopus Quotes
- Startup: "Bitchen. All arms online." / "Waking up... stretching all eight legs."
- Node Up: "Another arm wrapped around a node. Got it."
- Node Down: "They ghosted me. Rerouting, no big deal."
- Queue Full: "All arms busy. Patience, human. You're in the queue."
- Benchmark Done: "Not bad for junk drawer hardware."
- Shutdown: "K, going back to sleep. Wake me when you need me."

---

## WHAT'S BEEN BUILT

### Directory Structure
```
F:\tentaclaw-os\
├── README.md                    ← GitHub-ready landing page with CLAWtopus art
├── BRAND.md                     ← Full brand campaign + visual identity
├── BUILD.md                     ← Detailed build specification
├── CONTRIBUTING.md              ← Contribution guidelines
├── LICENSE                      ← MIT
├── Makefile                     ← Easy build targets
│
├── agent/
│   ├── src/index.ts            ← Full TentaCLAW Agent daemon (Node.js)
│   ├── package.json
│   └── tsconfig.json
│
└── builder/
    ├── build-iso.sh            ← ISO builder (Ubuntu base + kernel + initrd)
    ├── build-pxe.sh           ← PXE artifact builder
    │
    ├── scripts/
    │   ├── clawtopus.sh       ← ASCII art library (splash, faces, quotes)
    │   └── init-bottom/
    │       ├── 01-gpu-detect.sh      ← GPU detection (NVIDIA + AMD)
    │       ├── 02-network.sh          ← Network bring-up + gateway discovery
    │       └── 03-hive-registration.sh  ← Farm Hash generation + registration
    │
    ├── config/
    │   ├── etc/
    │   │   ├── systemd/tentaclaw-agent.service
    │   │   ├── modprobe.d/nvidia.conf
    │   │   └── ssh/sshd_config
    │   └── packages/
    │       ├── base.txt         ← Ubuntu packages
    │       └── inference.txt    ← Runtime packages
```

### Core Components Built

1. **01-gpu-detect.sh** — GPU Detection (init-bottom)
   - Detects NVIDIA via lspci + nvidia-smi
   - Detects AMD via lspci + rocm-smi
   - Loads kernel modules (nvidia, amdgpu)
   - Writes /tmp/gpu-info.json with detailed GPU data
   - Supports 0 GPUs (CPU-only mode)

2. **02-network.sh** — Network Bring-Up (init-bottom)
   - Parses kernel cmdline for gateway IP
   - Waits for network interface
   - DHCP setup via udhcpc/dhclient
   - Gateway discovery via DNS/mDNS
   - Writes /tmp/network-info.json

3. **03-hive-registration.sh** — HiveMind Registration (init-bottom)
   - Generates Farm Hash from hardware signature (CPU, GPU, MAC, disk)
   - Generates unique Node ID: TENTACLAW-{FARMHASH}-{SUFFIX}
   - POSTs to /api/v1/nodes/register on gateway
   - Writes /etc/tentaclaw/rig.conf (persistent config)
   - Falls back to standalone mode if gateway unreachable

4. **clawtopus.sh** — ASCII Art Library
   - clawtopus_splash() — Full boot splash with TENTACLAW ASCII art
   - clawtopus_face() — Compact face
   - clawtopus_happy() / clawtopus_sleepy() / clawtopus_evil() — Mood variants
   - clawtopus_banner() — One-liner ASCII logo
   - clawtopus_progress() — Progress bar
   - clawtopus_say() / clawtopus_status() — Output helpers
   - clawtopus_quote() — Random CLAWtopus quote

5. **build-iso.sh** — ISO Builder
   - Bootstrap Ubuntu 24.04 via debootstrap
   - Install base packages
   - Install GPU drivers (NVIDIA, AMD ROCm)
   - Install TentaCLAW Agent
   - Configure system (hostname, SSH, network)
   - Create initrd with CLAWtopus scripts
   - Install kernel
   - Create GRUB bootloader (BIOS + UEFI)
   - Build ISO with xorriso

6. **build-pxe.sh** — PXE Builder
   - Download iPXE binaries
   - Create iPXE boot script
   - Build PXE initrd
   - Install kernel
   - Create GRUB PXE config
   - Generate SETUP.md documentation

7. **agent/src/index.ts** — TentaCLAW Agent Daemon
   - Loads config from /etc/tentaclaw/rig.conf
   - Collects GPU stats via nvidia-smi
   - Collects system stats (CPU, RAM, disk, network)
   - Collects inference stats (loaded models via Ollama API)
   - Pushes stats to gateway every 10 seconds (configurable)
   - Receives commands in HTTP response
   - Executes commands (reload_model, install_model, overclock)
   - Graceful shutdown handling

---

## ARCHITECTURE

### Boot Flow
```
[Node Powers On]
       │
       ▼
┌─────────────────┐
│  BIOS/UEFI     │ ← User selects "Network Boot" or inserts USB
└────────┬────────┘
         │
         ▼ (PXE) or ▼ (USB/CD)
┌─────────────────┐
│  iPXE firmware  │ ← Embedded iPXE or card firmware
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  boot.ipxe script (HTTP)               │
│  → Downloads kernel + initrd             │
│  → Sets kernel cmdline                  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  Linux kernel boots                     │
│  │                                      │
│  ▼ (init-bottom scripts)               │
│  1. GPU detection (lspci → vendor ID) │
│  2. Load appropriate GPU drivers       │
│  3. Network bring-up (DHCP)            │
│  4. Register with gateway              │
│     → POST /register {farmhash, hw}   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  SwitchRoot to final filesystem         │
│  │                                      │
│  ▼ (init-top scripts)                  │
│  1. Start tentaclaw-agent daemon       │
│  2. Configure inference runtime         │
│  3. Begin stats push loop              │
└─────────────────────────────────────────┘
```

### HiveOS-Style Push Model
```
EVERY 10 SECONDS:
  Node → POST /api/v1/nodes/{nodeId}/stats
    {
      "farm_hash": "FARM3K7P9",
      "node_id": "TENTACLAW-FARM3K7P9-abc123",
      "uptime_secs": 3600,
      "gpu_count": 2,
      "gpus": [...],
      "cpu": {...},
      "ram": {...},
      "inference": {...}
    }

  Gateway ← HTTP 200 OK + commands array (if any)
    {
      "commands": [
        { "action": "reload_model", "model": "hermes3:latest" }
      ],
      "config_hash": "def456"
    }
```

### Registration Flow
```
ON FIRST BOOT:
  1. Generate Farm Hash from hardware signature
     - CPU model, GPU models, MAC addresses, disk serials
     - SHA256 → "FARM3K7P9"
     
  2. Generate Node ID: "TENTACLAW-FARM3K7P9-abc123"
  
  3. POST /api/v1/nodes/register with capabilities
  
  4. Gateway responds with config
  
  5. Node writes /etc/tentaclaw/rig.conf
     - This file is the key — rigs are "stateless" after this
```

---

## BUILD INSTRUCTIONS

### Prerequisites (Ubuntu/Debian)
```bash
sudo apt-get install -y \
    debootstrap \
    xorriso \
    grub-pc-bin \
    grub-efi-amd64-bin \
    mtools \
    squashfs-tools \
    gzip \
    cpio \
    wget \
    jq \
    uuid-runtime \
    dosfstools
```

### Build Commands
```bash
cd F:/tentaclaw-os

# Full ISO build (~20-30 minutes)
make iso VERSION=0.1.0

# PXE artifacts only (~5 minutes)
make pxe VERSION=0.1.0

# Build agent
make agent-deps && make agent

# Test ISO in QEMU
make test-iso

# Clean
make clean
```

### Manual Build
```bash
# ISO
cd builder && bash build-iso.sh --version 0.1.0 --arch amd64

# PXE
cd builder && bash build-pxe.sh --version 0.1.0
```

---

## REMAINING TASKS

| Task | Status | Priority |
|------|--------|---------|
| Gateway API expansion (register + stats + commands) | ⬜ Pending | HIGH |
| Test ISO in QEMU | ⬜ Pending | HIGH |
| GitHub org + repo setup (TentaCLAW-OS) | ⬜ Pending | HIGH |
| Domain DNS (www.TentaCLAW.io) | ⬜ Pending | HIGH |
| GitHub release + upload ISO | ⬜ Pending | HIGH |
| HN/Lobsters/r/selfhosted posts | ⬜ Pending | HIGH |
| Discord server setup | ⬜ Pending | MEDIUM |

---

## GATEWAY API (To Be Built)

The existing Clawdia gateway (D:\DaphneyBrain\Source\clawdia) needs expansion:

### Endpoints to Add
```
POST /api/v1/nodes/register    # Node registration
POST /api/v1/nodes/{id}/stats # Stats push
GET  /api/v1/nodes/{id}/config # Config pull (fallback)
GET  /api/v1/nodes/{id}/commands # Command queue (long poll)
```

### Registration Request
```json
{
  "farm_hash": "FARM3K7P9",
  "node_id": "TENTACLAW-FARM3K7P9-abc123",
  "hostname": "tentaclaw-abc123",
  "gpu_count": 2,
  "nvidia_count": 2,
  "capabilities": {
    "vram_mb": 49152,
    "cpu_threads": 32,
    "inference_backends": ["ollama", "llamacpp"],
    "gpu_names": ["RTX 3090", "RTX 3090"]
  }
}
```

### Registration Response
```json
{
  "node_id": "TENTACLAW-FARM3K7P9-abc123",
  "farm_hash": "FARM3K7P9",
  "gateway_url": "http://192.168.1.100:7860",
  "config_hash": "def456",
  "config": {...},
  "commands": []
}
```

### Stats Push Request
```json
{
  "farm_hash": "FARM3K7P9",
  "node_id": "TENTACLAW-FARM3K7P9-abc123",
  "uptime_secs": 3600,
  "gpu_count": 2,
  "gpus": [
    {
      "bus_id": "00000000:01:00.0",
      "name": "NVIDIA GeForce RTX 3090",
      "vram_total_mb": 24576,
      "vram_used_mb": 8192,
      "temperature_c": 67,
      "utilization_pct": 95,
      "power_draw_w": 350,
      "fan_speed_pct": 45,
      "clock_sm_mhz": 1695,
      "clock_mem_mhz": 9751
    }
  ],
  "cpu": { "usage_pct": 12, "temp_c": 55 },
  "ram": { "total_mb": 65536, "used_mb": 8192 },
  "disk": { "total_gb": 512, "used_gb": 120 },
  "inference": {
    "loaded_models": ["hermes3:latest"],
    "in_flight_requests": 2,
    "tokens_generated": 1500000,
    "avg_latency_ms": 45
  }
}
```

### Stats Push Response
```json
{
  "commands": [
    { "id": "cmd-001", "action": "reload_model", "model": "hermes3:latest" }
  ],
  "config_hash": "def456"
}
```

---

## VIRAL CAMPAIGN IDEAS

### 1. "POV: You Just Discovered TentaCLAW"
3-min screen recording of ISO boot to working inference

### 2. "My Homelab Has Tentacles" 
Meme + screenshot of CLAWtopus with GPU stats

### 3. "Per-Token Is A Scam"
Cost comparison: OpenAI $180/year vs local GPU electricity

### 4. "CLAWtopus, Why?" (FAQ Comedy)
Q: Why does she have eight arms?
A: Because four arms couldn't handle the GPU load.

### 5. "Hacktoctopus" (Hacktoberfest)
Event banner with CLAWtopus ASCII art

---

## OPEN QUESTIONS

1. **Gateway Integration**: Add endpoints to existing Clawdia gateway or create separate TentaCLAW gateway project?

2. **Color Feedback**: Love the cyan + purple. Any tweaks? Want more purple? Less?

3. **First Demo Video**: Do you have a test machine to record the boot flow?

4. **AMD GPU Support**: Full ROCm detection for v1 or post-launch?

---

## FILES CREATED

```
F:\tentaclaw-os\
├── README.md
├── BRAND.md
├── BUILD.md
├── CONTRIBUTING.md
├── LICENSE
├── Makefile
├── agent/
│   ├── src/index.ts
│   ├── package.json
│   └── tsconfig.json
└── builder/
    ├── build-iso.sh
    ├── build-pxe.sh
    ├── config/
    │   ├── etc/
    │   │   ├── systemd/tentaclaw-agent.service
    │   │   ├── modprobe.d/nvidia.conf
    │   │   └── ssh/sshd_config
    │   └── packages/
    │       ├── base.txt
    │       └── inference.txt
    └── scripts/
        ├── clawtopus.sh
        └── init-bottom/
            ├── 01-gpu-detect.sh
            ├── 02-network.sh
            └── 03-hive-registration.sh
```

---

## QUICK REFERENCE

### Kernel Command Line Parameters
```
tentaclaw.gateway=192.168.1.100  # HiveMind gateway IP
tentaclaw.farmhash=FARM3K7P9     # Farm Hash
tentaclaw.nodename=node-abc123   # Optional explicit node name
tentaclaw.mode=iso|pxe          # Boot mode
tentaclaw.standalone=1          # Skip gateway registration
ip=dhcp                          # Network config
```

### Key File Locations
```
/etc/tentaclaw/rig.conf          # Node config (Farm Hash, gateway URL)
/var/run/tentaclaw/gpu-stats.json # Current GPU stats
/var/log/tentaclaw/agent.log     # Agent daemon log
/etc/tentaclaw/nvidia-oc.conf   # NVIDIA overclocking profile
```

### Gateway API Endpoints
```
POST /api/v1/nodes/register      # Node registration
POST /api/v1/nodes/{id}/stats    # Stats push
GET  /api/v1/nodes/{id}/config   # Config pull
GET  /api/v1/nodes/{id}/commands # Command queue
```

---

*Eight arms. One mind. Zero compromises.*
*TentaCLAW OS — Built with sassy by TentaCLAW-OS*
