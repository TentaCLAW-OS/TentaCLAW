# TentaCLAW OS — Build Specification

**Website**: [www.TentaCLAW.io](https://www.TentaCLAW.io)  
**GitHub**: [github.com/TentaCLAW-OS](https://github.com/TentaCLAW-OS)  
**Mascot**: CLAWtopus — an octopus who lives in the terminal and coordinates your AI inference cluster with eight arms.  
**Launch Date**: Sunday Night (v1.0.0)

---

## 1. Project Overview

### What is TentaCLAW OS?
TentaCLAW OS is a purpose-built Linux distribution for AI inference clusters. Like HiveOS revolutionized GPU mining by making 1000-rig farms manageable from one dashboard, TentaCLAW OS makes AI inference clusters accessible to non-technical users via zero-config auto-discovery and one-click model deployment.

### What This Build Covers (v1.0.0 — FULL SCOPE)
This is a **full release** covering:
1. Bootable ISO (USB/CD) and PXE network boot
2. Auto-detect GPU hardware on first boot (NVIDIA + AMD)
3. HiveMind gateway registration using Farm Hash
4. Full TentaCLAW Agent daemon (`tentaclaw-agent`)
5. HiveMind gateway API endpoints (register, stats, commands)
6. HiveOS-style push model (POST stats, receive commands in response)
7. GPU stats collection and watchdog

### Future Phases
- GPU overclocking scripts (`amd-oc*.sh`, `nvidia-oc.sh`)
- Advanced flight sheet system (rolling deployments, canary)
- Web dashboard for farm management
- Proxmox VM ISO

---

## 2. Architecture

### 2.1 Directory Structure

```
F:\Daphney-OG\tentaclaw-os\
├── BUILD.md                          # This file
├── README.md                          # User-facing overview
│
├── iso/                              # ISO build output
│   └── TentaCLAW-OS-{version}-{arch}.iso
│
├── pxe/                              # PXE boot artifacts
│   ├── bootx64.efi                    # UEFI PXE loader
│   ├── ipxe.efi                       # iPXE UEFI binary
│   ├── ipxe.bin                       # iPXE BIOS binary
│   ├── boot/                          # PXE root filesystem
│   │   ├── TENTACLAW/                   #   - TentaCLAW OS kernel + initrd
│   │   │   ├── vmlinuz
│   │   │   ├── initrd.img
│   │   │   └── boot-config.cfg        #   - Kernel cmdline defaults
│   │   └── gateway/                    #   - Gateway fallback (optional)
│   │       └── tentaclaw-gateway.squash #   - Pre-built gateway squashfs
│   └── tftp/                          # TFTP server root
│       └── ... (see pxe/boot above)
│
├── builder/                          # Build scripts & tooling
│   ├── build-iso.sh                  # Main ISO build script
│   ├── build-pxe.sh                  # PXE artifact builder
│   ├── scripts/                       # Inside initrd/scripts
│   │   ├── init-bottom/              # Early boot (inside initrd)
│   │   │   ├── 01-gpu-detect.sh      #   GPU detection, driver loading
│   │   │   ├── 02-network.sh         #   Network bring-up + gateway discovery
│   │   │   └── 03-hive registration.sh #   Farm Hash registration
│   │   └── init-top/                 # Post-boot scripts (chroot)
│   │   ├── 10-tentaclaw-agent.sh   #   Start tentaclaw-agent daemon
│   │       ├── 20-inference-runtime.sh #  Install/configure inference runtime
│   │       └── 30-model-boot.sh      #   Optional: PXE-stream models
│   │
│   ├── config/                        # OS rootfs config templates
│   │   ├── etc/
│   │   │   ├── hostname               # Hostname template
│   │   │   ├── hosts
│   │   │   ├── systemd/               # Systemd service templates
│   │   │   │   ├── tentaclaw-agent.service
│   │   │   │   └── sshd.service
│   │   │   ├── ssh/
│   │   │   │   └── sshd_config
│   │   │   ├── modprobe.d/
│   │   │   │   └── nvidia.conf       # NVIDIA kernel params
│   │   │   └── udev/
│   │   │       └── 99-nvidia.rules   # NVIDIA device rules
│   │   │
│   │   ├── root/
│   │   │   └── .bashrc               # Root bashrc
│   │   │
│   │   └── etc-release               # OS release info
│   │
│   ├── packages/                     # Package list for debootstrap
│   │   ├── base.txt                  # Base packages
│   │   └── inference.txt              # Inference runtime packages
│   │
│   └── hooks/                        # Build hooks
│       ├── after extracting.sh        # After rootfs extracted
│       └── before packing.sh          # Before initrd/ISO packed
│
├── agent/                            # TentaCLAW Agent source (Phase 2)
│   ├── src/
│   │   ├── index.ts
│   │   ├── gpu-detect.ts
│   │   ├── stats-reporter.ts
│   │   ├── command-queue.ts
│   │   └── watchdog.ts
│   ├── package.json
│   └── tsconfig.json
│
├── gateway-fallback/                 # Optional pre-built gateway for PXE
│   ├── Dockerfile
│   └── docker-entrypoint.sh
│
└── docs/
    ├── NETWORK-BOOT.md               # PXE server setup guide
    ├── USB-BOOT.md                   # USB creation guide
    └── GATEWAY-SETUP.md              # HiveMind gateway setup
```

### 2.2 Boot Flow

```
[Node Powers On]
       │
       ▼
┌─────────────────┐
│  BIOS/UEFI      │ ← User selects "Network Boot" or inserts USB
└────────┬────────┘
         │
         ▼ (PXE) or ▼ (USB/CD)
┌─────────────────┐
│  iPXE firmware  │ ← Embedded iPXE or card firmware
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  iPXE chainload:                       │
│  http://{gateway}/pxe/boot.ipxe        │
│                                         │
│  OR fallback: TFTP://tftp-server/boot/ │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  boot.ipxe script (HTTP)               │
│  → Downloads kernel + initrd           │
│  → Sets kernel cmdline:                 │
│     tentaclaw.gateway=192.168.1.100      │
│     tentaclaw.farmhash=XXXXX             │
│     tentaclaw.nodename=node-abc123       │
│     tentaclaw.initrd=*                   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  Linux kernel boots                    │
│  │                                      │
│  ▼ (init-bottom scripts)               │
│  1. GPU detection (lspci → vendor ID)  │
│  2. Load appropriate GPU drivers        │
│  3. Network bring-up (DHCP or static)   │
│  4. Register with gateway               │
│     → POST /register {farmhash, hw}    │
│     → GET /config → receive config      │
│     → Persistent config in /etc/        │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  SwitchRoot to final filesystem         │
│  (PXE: tmpfs overlay or NFS root)      │
│  │                                      │
│  ▼ (init-top scripts)                  │
│  1. Start tentaclaw-agent daemon         │
│  2. Configure inference runtime         │
│  3. Load models (if local) or stream   │
│  4. Begin stats push loop              │
└─────────────────────────────────────────┘
```

### 2.3 Network Communication Model

**HiveOS-style push model** — nodes push stats, receive commands in response:

```
EVERY 10 SECONDS:
  Node → POST /api/v1/nodes/{nodeId}/stats
    {
      "farm_hash": "abc123",
      "node_id": "node-abc123",
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
      "network": { "bytes_in": 0, "bytes_out": 0 },
      "inference": {
        "loaded_models": ["hermes3:latest", "dolphin-mistral:latest"],
        "in_flight_requests": 2,
        "tokens_generated": 1500000,
        "avg_latency_ms": 45
      },
      "hashrate": {           // AI inference "hashrate" equivalent
        "tokens_per_second": 127.5,
        "requests_completed": 5000
      }
    }

  Gateway ← HTTP 200 OK + commands array (if any)
    {
      "commands": [
        { "action": "reload_model", "model": "hermes3:latest" },
        { "action": "overclock", "gpu": 0, "profile": "aggressive" }
      ],
      "config_hash": "def456" // Node skips if matches current
    }
```

### 2.4 Registration Flow

```
ON FIRST BOOT (or when /etc/tentaclaw/rig.conf missing):

  1. Generate Farm Hash from hardware signature:
     - CPU model, GPU models, MAC addresses, disk serials
     - SHA256 first 16 chars → base36 → "FARMXXXX"
     - Example: "FARM3K7P9"
     - User enters this hash in web dashboard to "claim" the rig

  2. Generate Node ID:
     - hostname: "tentaclaw-{random6}"
     - node_id: "{farmhash}-{random6}"
     - Example: "TentaCLAW-FARM3K7P9-a1b2c3"

  3. POST /api/v1/nodes/register
     {
       "farm_hash": "FARM3K7P9",
       "node_id": "TentaCLAW-FARM3K7P9-a1b2c3",
       "hostname": "tentaclaw-a1b2c3",
       "gpu_count": 2,
       "gpus": [...],
       "capabilities": {
         "vram_mb": 49152,
         "cpu_threads": 32,
         "inference_backends": ["ollama", "llamacpp"],
         "preferred_models": ["hermes3", "dolphin-mistral"]
       }
     }

  4. Gateway responds:
     {
       "node_id": "TentaCLAW-FARM3K7P9-a1b2c3",
       "gateway_url": "http://192.168.1.100:7860",
       "config": { ... },
       "commands": []
     }

  5. Node writes /etc/tentaclaw/rig.conf (persistent config)
     # This file is the key — rigs are "stateless" after this
     FARM_HASH=FARM3K7P9
     NODE_ID=TentaCLAW-FARM3K7P9-a1b2c3
     GATEWAY_URL=http://192.168.1.100:7860
     NODE_HASH=abc123def456
```

---

## 3. Build Components

### 3.1 ISO Builder (`builder/build-iso.sh`)

**Purpose**: Build a bootable ISO that can be flashed to USB or burned to CD.

**Inputs**:
- Base rootfs (Ubuntu 24.04 minimal)
- GPU driver packages (NVIDIA, AMD)
- Inference runtime packages (ollama, llama.cpp, etc.)
- TentaCLAW Agent binary
- Custom boot scripts

**Output**: `TentaCLAW-OS-{version}-{arch}.iso`

**Process**:
```
1. Install Ubuntu 24.04 base in chroot (debootstrap)
   → $ROOTFS/

2. Install packages from builder/packages/base.txt
   → ubuntu-minimal, network-manager, openssh-server, etc.

3. Install GPU drivers
   → NVIDIA: nvidia-driver-535 (or newest stable)
   → AMD:_ROCM (amdgpu-core, rocm)

4. Install inference runtimes
   → ollama (binary install)
   → llama.cpp (compile from source or binary)

5. Copy config templates
   → builder/config/ → $ROOTFS/etc/

6. Install TentaCLAW Agent binary
   → builder/agent/ → $ROOTFS/usr/local/bin/tentaclaw-agent

7. Install init scripts
   → builder/scripts/init-top/ → $ROOTFS/etc/init/
   → builder/scripts/init-bottom/ → (packed into initrd)

8. Build initrd with embedded scripts
   → builder/scripts/init-bottom/* → initrd

9. Install kernel + initrd to ISO
   → cp $ROOTFS/boot/vmlinuz-* iso/boot/vmlinuz
   → cp initrd iso/boot/initrd.img

10. Create ISO with xorriso
    → bios boot: isolinux/syslinux
    → uefi boot: EFI/BOOT/BOOTX64.EFI
    → boot config: loader/entries/*.conf
```

**Key Files Created**:
```
iso/boot/
├── vmlinuz                    # Linux kernel
├── initrd.img                 # Initial ramdisk with GPU detect + network
└── grub/
    └── grub.cfg               # GRUB menu entries

iso/EFI/
└── BOOT/
    └── BOOTX64.EFI            # UEFI boot loader

iso/isolinux/
├── isolinux.bin
├── isolinux.cfg               # BIOS boot menu
└── menu.cfg
```

### 3.2 PXE Builder (`builder/build-pxe.sh`)

**Purpose**: Build artifacts for network boot (no USB/CD needed after initial setup).

**Output**:
- `pxe/bootx64.efi` — UEFI PXE boot binary
- `pxe/ipxe.efi` / `pxe/ipxe.bin` — iPXE binaries
- `pxe/boot/TentaCLAW/vmlinuz` — Kernel
- `pxe/boot/TentaCLAW/initrd.img` — Initrd
- `pxe/boot/TentaCLAW/boot-config.cfg` — Default kernel cmdline

**Process**:
```
1. Download iPXE source or prebuilt binaries
   → https://github.com/ipxe/ipxe/releases

2. Build customized iPXE with embedded script:
   → #!ipxe
   → set gateway http://${next-server}
   → kernel http://${gateway}/pxe/boot/TentaCLAW/vmlinuz \
       tentaclaw.gateway=${gateway} \
       tentaclaw.farmhash=PXE_BOOT \
       tentaclaw.initrd=*
   → initrd http://${gateway}/pxe/boot/TentaCLAW/initrd.img
   → boot

3. Extract kernel + initrd from ISO
   → xorriso -dev claunia-os.iso -- -rx /boot/ px/boot/

4. Create TFTP server tree:
   → tftpboot/
       ├── bootx64.efi         # Or ipxe.efi for UEFI
       ├── bootia32.efi       # 32-bit UEFI fallback
       ├── bootx64.efi.sanalla# For some Dell/hp hardware
       └── TentaCLAW/
           ├── vmlinuz
           ├── initrd.img
           └── boot-config.cfg
```

**PXE Server Setup** (for docs):
- Dnsmasq for DHCP + TFTP
- Nginx/Apache for HTTP (faster than TFTP for kernel/initrd)
- Option 67 (bootfile) points to `bootx64.efi`

### 3.3 GPU Detection Script (`builder/scripts/init-bottom/01-gpu-detect.sh`)

**Purpose**: Detect GPU hardware and load appropriate drivers on boot.

**Inputs**: `lspci`, `nvidia-smi`, `rocm-smi`

**Output**: Sets shell variables and writes `/tmp/gpu-info.json`

```bash
#!/bin/bash
# 01-gpu-detect.sh — Runs inside initrd during early boot

set -e

GPU_INFO_FILE="/tmp/gpu-info.json"
NVIDIA_COUNT=0
AMD_COUNT=0
NVIDIA_GPUS=""
AMD_GPUS=""

log() { echo "[gpu-detect] $*"; }

# Step 1: Detect NVIDIA GPUs
detect_nvidia() {
    if command -v nvidia-smi &>/dev/null; then
        nvidia-smi --query-gpu=pci.bus_id,name,vram.total,memory.total,temperature.gpu \
                   --format=csv,noheader,nounits 2>/dev/null | while IFS=',' read -r bus_id name vram mem temp; do
            NVIDIA_COUNT=$((NVIDIA_COUNT + 1))
            NVIDIA_GPUS="$NVIDIA_GPUS $bus_id:$name:$vram"
            log "Found NVIDIA: $name (${vram}MB) @ $bus_id"
        done
    fi
}

# Step 2: Detect AMD GPUs
detect_amd() {
    if command -v rocm-smi &>/dev/null; then
        rocm-smi --showid --showbus --showmeminfo vram --showtemperature 2>/dev/null | grep -v "GPU\|GPU-" | while read -r line; do
            # Parse ROCm output
            :
        done
    else
        # Fallback: lspci for AMD
        for dev in $(lspci -d 1002: 2>/dev/null | cut -d' ' -f1); do
            AMD_COUNT=$((AMD_COUNT + 1))
            AMD_GPUS="$AMD_GPUS $dev"
            log "Found AMD GPU @ $dev"
        done
    fi
}

# Step 3: Detect GPU count via lspci
detect_via_lspci() {
    NVIDIA_COUNT=$(lspci -d 10de: 2>/dev/null | grep -c "VGA" || echo 0)
    AMD_COUNT=$(lspci -d 1002: 2>/dev/null | grep -c "VGA" || echo 0)
}

# Step 4: Load kernel modules
load_gpu_modules() {
    if [ "$NVIDIA_COUNT" -gt 0 ]; then
        modprobe nvidia nvidia-uvm nvidia-drm 2>/dev/null || true
        # Apply kernel params from /etc/modprobe.d/nvidia.conf
        NVIDIA_AUDIT=$(lspci -d 10de: -nn 2>/dev/null | grep "VGA" | wc -l)
        log "Loaded $NVIDIA_AUDIT NVIDIA kernel modules"
    fi

    if [ "$AMD_COUNT" -gt 0 ]; then
        modprobe amdgpu 2>/dev/null || true
        # ROCm userspace needed for full detection
        log "Loaded amdgpu kernel module"
    fi
}

# Step 5: Write GPU info JSON (consumed by registration)
write_gpu_info() {
    cat > "$GPU_INFO_FILE" << EOF
{
    "nvidia_count": $NVIDIA_COUNT,
    "amd_count": $AMD_COUNT,
    "total_gpus": $((NVIDIA_COUNT + AMD_COUNT)),
    "nvidia_gpus": [$(echo $NVIDIA_GPUS | tr ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')],
    "amd_gpus": [$(echo $AMD_GPUS | tr ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')]
}
EOF
    log "GPU info written to $GPU_INFO_FILE"
}

# Execute
detect_via_lspci
load_gpu_modules
detect_nvidia
detect_amd
write_gpu_info

log "Detection complete: $NVIDIA_COUNT NVIDIA, $AMD_COUNT AMD"
```

### 3.4 Network Boot Script (`builder/scripts/init-bottom/02-network.sh`)

**Purpose**: Bring up networking and discover the HiveMind gateway.

```bash
#!/bin/bash
# 02-network.sh — Network bring-up inside initrd

set -e

log() { echo "[network] $*"; }

GATEWAY_CMDLINE=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.gateway=' | cut -d= -f2)
FARM_HASH=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.farmhash=' | cut -d= -f2)

# If gateway not in cmdline, try DHCP discover
if [ -z "$GATEWAY_CMDLINE" ]; then
    log "No gateway in cmdline, attempting DHCP + gateway discovery..."

    # Wait for network
    for i in $(seq 1 30); do
        if ip link show eth0 &>/dev/null || ip link show enp0s3 &>/dev/null; then
            break
        fi
        sleep 1
    done

    # DHCP
    udhcpc -i eth0 2>/dev/null || dhclient eth0 2>/dev/null || true

    # Gateway discovery via DNS/MDNS
    # Try: tentaclaw.local, or check /etc/resolv.conf for search domain
    GATEWAY_CMDLINE=$(nslookup tentaclaw-gateway 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}')
fi

# Wait for gateway to respond
if [ -n "$GATEWAY_CMDLINE" ]; then
    log "Gateway: $GATEWAY_CMDLINE"

    # Test connectivity
    for i in $(seq 1 10); do
        if curl -sf --connect-timeout 3 "http://$GATEWAY_CMDLINE/health" &>/dev/null; then
            log "Gateway is reachable"
            break
        fi
        log "Waiting for gateway... ($i/10)"
        sleep 2
    done

    # Write gateway URL for later scripts
    echo "$GATEWAY_CMDLINE" > /tmp/gateway-url
else
    log "WARNING: No gateway found. Node will operate in standalone mode."
    echo "" > /tmp/gateway-url
fi
```

### 3.5 Hive Registration Script (`builder/scripts/init-bottom/03-hive-registration.sh`)

**Purpose**: Register node with HiveMind gateway using Farm Hash.

```bash
#!/bin/bash
# 03-hive-registration.sh — Farm Hash registration

set -e

log() { echo "[registration] $*"; }

GATEWAY_URL=$(cat /tmp/gateway-url 2>/dev/null || echo "")
FARM_HASH=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.farmhash=' | cut -d= -f2 || echo "PXE_BOOT")
NODE_NAME=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.nodename=' | cut -d= -f2 || echo "")

# Load GPU info from previous script
source /tmp/gpu-info.json 2>/dev/null || true

# Generate Farm Hash from hardware if not provided
generate_farm_hash() {
    local cpu_model=$(cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | tr -d ' ')
    local gpu_count=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.gpu_count=' | cut -d= -f2 || echo "0")
    local mac=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/enp0s3/address 2>/dev/null | tr -d ':')
    local disk_serial=$(cat /proc/cmdline | tr ' ' '\n' | grep '^tentaclaw.disk_serial=' | cut -d= -f2 || echo "")

    local sig="${cpu_model}${gpu_count}${mac}${disk_serial}"
    local hash=$(echo -n "$sig" | sha256sum | cut -c1-16)
    local farm_hash="FARM${hash^^}"

    # Convert to base36
    echo "$farm_hash"
}

if [ "$FARM_HASH" = "PXE_BOOT" ] || [ -z "$FARM_HASH" ]; then
    FARM_HASH=$(generate_farm_hash)
    log "Generated Farm Hash: $FARM_HASH"
fi

# Generate Node ID
generate_node_id() {
    local node_suffix=$(cat /proc/sys/kernel/random/uuid | cut -c1-6)
    echo "TentaCLAW-${FARM_HASH}-${node_suffix}"
}

NODE_ID=$(cat /etc/tentaclaw/node_id 2>/dev/null || echo "$(generate_node_id)")
NODE_HOSTNAME=$(cat /etc/tentaclaw/hostname 2>/dev/null || echo "tentaclaw-${NODE_ID: -6}")

# Registration payload
REGISTER_PAYLOAD=$(cat << EOF
{
    "farm_hash": "$FARM_HASH",
    "node_id": "$NODE_ID",
    "hostname": "$NODE_HOSTNAME",
    "gpu_count": ${TOTAL_GPUS:-0},
    "nvidia_count": ${NVIDIA_COUNT:-0},
    "amd_count": ${AMD_COUNT:-0},
    "capabilities": {
        "vram_mb": 0,
        "cpu_threads": $(nproc),
        "inference_backends": ["ollama", "llamacpp"],
        "preferred_models": []
    }
}
EOF
)

# Register with gateway
if [ -n "$GATEWAY_URL" ]; then
    log "Registering with gateway at $GATEWAY_URL..."

    RESPONSE=$(curl -sf -X POST \
        -H "Content-Type: application/json" \
        -d "$REGISTER_PAYLOAD" \
        "http://${GATEWAY_URL}/api/v1/nodes/register" 2>/dev/null || echo "{}")

    # Extract gateway config from response
    if echo "$RESPONSE" | jq -e '.gateway_url' &>/dev/null; then
        GATEWAY_URL=$(echo "$RESPONSE" | jq -r '.gateway_url')
        log "Gateway confirmed: $GATEWAY_URL"
    fi
fi

# Write persistent config
mkdir -p /etc/tentaclaw
cat > /etc/tentaclaw/rig.conf << EOF
FARM_HASH=$FARM_HASH
NODE_ID=$NODE_ID
NODE_HOSTNAME=$NODE_HOSTNAME
GATEWAY_URL=${GATEWAY_URL:-}
NODE_HASH=${NODE_HASH:-}
EOF

log "Registration complete: $NODE_ID"
```

### 3.6 Kernel Command Line Parameters

These are passed by PXE/iPXE or ISO bootloader:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `tentaclaw.gateway` | `192.168.1.100` | HiveMind gateway IP:port |
| `tentaclaw.farmhash` | `FARM3K7P9` | Farm Hash (user enters in dashboard) |
| `tentaclaw.nodename` | `node-a1b2c3` | Optional explicit node name |
| `tentaclaw.initrd` | `*` | Signals that initrd is loaded |
| `tentaclaw.mode` | `iso` \| `pxe` \| `usb` | Boot mode |
| `tentaclaw.standalone` | `1` | Skip gateway registration |
| `tentaclaw.driver` | `nvidia` \| `amd` \| `auto` | Force GPU driver |
| `ip` | `dhcp` | Network config (standard kernel) |
| `nameserver` | `8.8.8.8` | DNS server (standard kernel) |

---

## 4. Build Process

### 4.1 Prerequisites

**On the build machine** (can be Linux or WSL):

```bash
# Ubuntu 24.04 build deps
sudo apt-get install -y \
    debootstrap \
    xorriso \
    mtools \
    grub-pc-bin \
    grub-efi-amd64-bin \
    squashfs-tools \
    gzip \
    curl \
    wget \
    jq \
    uuid-runtime \
    dosfstools

# Optional: for GPU driver packages inside ISO
# These would be downloaded at build time
# NVIDIA_DRIVER_URL=$(curl -s https://download.nvidia.com/XFree86/Linux-x86_64/ | grep -o '535.[0-9]*' | sort -V | tail -1)

# Optional: for compiling GPU detection tools
sudo apt-get install -y \
    build-essential \
    pciutils \
    usbutils
```

### 4.2 Build Commands

```bash
cd F:/Daphney-OG/tentaclaw-os

# Full ISO build (~20-30 minutes first time)
./builder/build-iso.sh --version 0.1.0 --arch amd64 --output ../TentaCLAW-OS-0.1.0-amd64.iso

# PXE artifacts only (~5 minutes)
./builder/build-pxe.sh --version 0.1.0 --arch amd64 --output ./pxe/

# Build + sign for Secure Boot (optional)
./builder/build-iso.sh --version 0.1.0 --arch amd64 --secure-boot --sign-key key.pem --output ./TentaCLAW-OS-0.1.0-amd64.iso

# Local test with QEMU
./builder/test-qemu.sh ./TentaCLAW-OS-0.1.0-amd64.iso
```

### 4.3 Build Script Architecture

```
build-iso.sh
  │
  ├── 00-check-deps.sh          # Verify build tools installed
  │
  ├── 01-create-rootfs.sh      # debootstrap base Ubuntu
  │     └── ROOTFS=/tmp/tentaclaw-rootfs
  │
  ├── 02-install-packages.sh   # Base + GPU + inference packages
  │
  ├── 03-install-agents.sh     # Build + install TentaCLAW Agent
  │
  ├── 04-copy-configs.sh       # Apply config templates
  │
  ├── 05-install-kernel.sh     # Copy kernel + headers
  │
  ├── 06-build-initrd.sh       # Build initrd with early boot scripts
  │
  ├── 07-create-iso.sh        # xorriso to create bootable ISO
  │
  └── 99-cleanup.sh           # Remove build artifacts from ISO
```

### 4.4 PXE Server Setup (User Docs)

After building PXE artifacts, the user sets up a server:

```bash
# On the gateway/HiveMind machine (Ubuntu 24.04)

# Install dnsmasq for DHCP+TFTP
sudo apt-get install -y dnsmasq

# /etc/dnsmasq.d/pxe.conf
interface=eth0
dhcp-range=192.168.1.100,192.168.1.200,12h
dhcp-boot=bootx64.efi
enable-tftp
tftp-root=/srv/tftp

# Create TFTP root
sudo mkdir -p /srv/tftp
sudo cp -r pxe/boot/* /srv/tftp/
sudo chown -R nobody:nobody /srv/tftp

# Restart
sudo systemctl restart dnsmasq

# Optional: Nginx for faster HTTP kernel delivery
# /etc/nginx/sites-available/pxe
server {
    listen 8080;
    root /srv/tftp;
    autoindex on;
}
```

---

## 5. Configuration File Formats

### 5.1 Node Config — `/etc/tentaclaw/rig.conf`

```ini
# TentaCLAW Node Configuration
# Auto-generated on first boot. Do not edit manually (except GATEWAY_URL).

FARM_HASH=FARM3K7P9
NODE_ID=TentaCLAW-FARM3K7P9-a1b2c3
NODE_HOSTNAME=tentaclaw-a1b2c3
GATEWAY_URL=http://192.168.1.100:7860
NODE_HASH=abc123def456

# GPU Configuration
NVIDIA_ENABLED=1
NVIDIA_DRIVER_VERSION=535
AMD_ENABLED=0

# Inference Runtime
INFERENCE_BACKEND=ollama
OLLAMA_HOST=http://127.0.0.1:11434
AUTO_START_MODEL=hermes3:latest

# Overclocking (optional)
OC_PROFILE=balanced
NVIDIA_OC_CONF=/etc/tentaclaw/nvidia-oc.conf

# Flight Sheet Active
FLIGHTSHEET_ID=

# Last stats push
LAST_PUSH=1715000000
```

### 5.2 GPU Stats File — `/var/run/tentaclaw/gpu-stats.json`

```json
{
    "timestamp": 1715000000,
    "nvidia": [
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
            "clock_mem_mhz": 9751,
            "encoder_utilization_pct": 0,
            "decoder_utilization_pct": 0
        }
    ],
    "amd": []
}
```

### 5.3 Gateway Registration Response

```json
{
    "node_id": "TentaCLAW-FARM3K7P9-a1b2c3",
    "farm_hash": "FARM3K7P9",
    "gateway_url": "http://192.168.1.100:7860",
    "config_hash": "def456",
    "config": {
        "inference_backend": "ollama",
        "model_preferences": ["hermes3", "dolphin-mistral"],
        "max_concurrent_requests": 4,
        "oc_profile": "balanced",
        "watchdog": {
            "hashrate_threshold_tps": 10,
            "gpu_missing_trigger": true,
            "power_draw_threshold_w": 400
        }
    },
    "commands": [
        {
            "id": "cmd-001",
            "action": "install_model",
            "model": "hermes3:latest",
            "priority": "high"
        }
    ]
}
```

---

## 6. Build Environment Variables

These control the build behavior:

```bash
# Version
TentaCLAW_VERSION=0.1.0
TentaCLAW_BUILD=1

# Architecture
ARCH=amd64  # or arm64

# GPU drivers
NVIDIA_DRIVER_VERSION=535  # or 545, 550, latest
AMD_ROCM_VERSION=6.0

# Inference runtimes
OLLAMA_VERSION=latest
LLAMA_CPP_BRANCH=master

# Build paths
ROOTFS=/tmp/tentaclaw-rootfs
ISO_ROOT=/tmp/tentaclaw-iso
OUTPUT_DIR=F:/Daphney-OG/

# Gateway URL (for kernel cmdline)
DEFAULT_GATEWAY_URL=

# Debug
DEBUG=0
BUILD_LOG=/tmp/tentaclaw-build.log
```

---

## 7. Testing Plan

### 7.1 Build Verification Tests

| Test | Command | Expected Result |
|------|---------|----------------|
| ISO exists | `ls -lh TentaCLAW-OS-*.iso` | File size > 500MB |
| ISO bootable | `xorriso -indev TentaCLAW-OS-*.iso --bootable` | "Bootable" |
| Kernel present | `xorriso -indev TentaCLAW-OS-*.iso -- -rx /boot/vmlinuz` | vmlinuz extracted |
| Initrd present | `xorriso -indev TentaCLAW-OS-*.iso -- -rx /boot/initrd.img` | initrd extracted |
| GPU scripts present | `xzgrep -c gpu-detect initrd.img` | Count > 0 |

### 7.2 VM Testing (QEMU)

```bash
# Test ISO in QEMU with GPU passthrough (if available)
./builder/test-qemu.sh ./TentaCLAW-OS-0.1.0-amd64.iso

# With network (requires TFTP server running)
./builder/test-qemu.sh --pxe ./TentaCLAW-OS-0.1.0-amd64.iso \
    --tftp 192.168.1.100 \
    --gateway 192.168.1.100

# Headless (no GPU)
./builder/test-qemu.sh --headless ./TentaCLAW-OS-0.1.0-amd64.iso
```

### 7.3 Manual Test Checklist

- [ ] Node boots from ISO/USB and shows TentaCLAW splash
- [ ] GPU detection runs and reports correct GPU count
- [ ] Network obtains DHCP address
- [ ] Node registers with gateway (check gateway logs)
- [ ] `rig.conf` is written to `/etc/tentaclaw/`
- [ ] `tentaclaw-agent` starts and begins stats push loop
- [ ] Gateway dashboard shows new node
- [ ] Model can be loaded via flight sheet command
- [ ] Stats appear in gateway dashboard

---

## 8. File Manifest

### Files to Create (in order)

```
F:/Daphney-OG/tentaclaw-os/
├── BUILD.md                           [THIS FILE]
├── README.md                          
│
├── builder/
│   ├── build-iso.sh                   # Main ISO build (executable)
│   ├── build-pxe.sh                   # PXE artifact builder
│   ├── test-qemu.sh                   # QEMU test runner
│   ├── Makefile                       # Top-level make targets
│   │
│   ├── scripts/
│   │   ├── init-bottom/
│   │   │   ├── 01-gpu-detect.sh       # GPU detection
│   │   │   ├── 02-network.sh          # Network bring-up
│   │   │   └── 03-hive-registration.sh # Farm Hash registration
│   │   │
│   │   └── init-top/                  # (empty for now, Phase 2)
│   │
│   ├── config/
│   │   ├── etc/
│   │   │   ├── hostname               # Template: tentaclaw-${RANDOM}
│   │   │   ├── hosts
│   │   │   ├── ssh/
│   │   │   │   └── sshd_config        # Permits root login for now
│   │   │   ├── modprobe.d/
│   │   │   │   └── nvidia.conf
│   │   │   ├── udev/
│   │   │   │   └── 99-nvidia.rules
│   │   │   ├── systemd/
│   │   │   │   └── tentaclaw-agent.service
│   │   │   └── release                # /etc/os-release
│   │   │
│   │   ├── root/
│   │   │   └── .bashrc
│   │   │
│   │   └── etc-release
│   │
│   ├── packages/
│   │   ├── base.txt                   # Ubuntu minimal + networking
│   │   └── inference.txt              # ollama, llama.cpp, etc.
│   │
│   └── hooks/
│       ├── after-extract.sh           # Post-rootfs-extract hook
│       └── before-pack.sh             # Pre-initrd-pack hook
│
├── iso/
│   └── TentaCLAW-OS-{version}-{arch}.iso  # [BUILD OUTPUT]
│
├── pxe/
│   ├── bootx64.efi                    # [BUILD OUTPUT]
│   ├── ipxe.efi                       # [BUILD OUTPUT]
│   ├── ipxe.bin                       # [BUILD OUTPUT]
│   └── boot/
│       ├── TentaCLAW/
│       │   ├── vmlinuz                # [BUILD OUTPUT]
│       │   ├── initrd.img             # [BUILD OUTPUT]
│       │   └── boot-config.cfg        # Default kernel cmdline
│       └── grub/
│           └── grub.cfg               # PXE GRUB config
│
├── agent/                             # [PHASE 2]
│   └── ...
│
└── docs/
    ├── NETWORK-BOOT.md
    ├── USB-BOOT.md
    └── GATEWAY-SETUP.md
```

### Files to Modify (Existing Clawdia)

```
D:/DaphneyBrain/Source/clawdia/src/gateway.ts
  → Add /api/v1/nodes/register endpoint
  → Add /api/v1/nodes/{id}/stats endpoint
  → Add command queue in HTTP response

D:/DaphneyBrain/Source/clawdia/src/types.ts
  → Add NodeRegistration, StatsPayload, GatewayCommand types

D:/DaphneyBrain/Source/clawdia/tentaclaw.yaml
  → Add farm_hash, gateway_api_port, node_api_base settings
```

---

## 9. Dependencies & External Downloads

These are fetched at build time, not bundled:

| Package | URL | Notes |
|---------|-----|-------|
| Ubuntu 24.04 rootfs | `ubuntu.mirrors.tuna.tsinghua.edu.cn/ubuntu/` | debootstrap |
| NVIDIA driver | `download.nvidia.com/XFree86/Linux-x86_64/` | 535.154.05 or latest |
| AMD ROCm | `repo.radeon.com/rocm/` | 6.0 |
| iPXE binaries | `boot.ipxe.org/ipxe.tar.gz` | Prebuilt |
| Ollama | `github.com/ollama/ollama/releases` | Binary install |
| Linux kernel | `kernel.ubuntu.com/~kernel-ppa/mainline/` | Or use Ubuntu kernel |
| TentaCLAW Agent | Built from `agent/` directory | Compiled at build time |

---

## 10. Open Questions / Edge Cases

### 10.1 Unsolved

1. **Model storage in PXE mode**: If node has no local disk, where do 4-80GB models live? Options:
   - NFS root with centralized storage
   - Stream models from gateway (like PXE filesystem)
   - tmpfs with compressed squashfs pulled from HTTP

2. **GPU driver version mismatch**: Different GPU generations need different drivers. How to handle auto-detection at boot vs. bundled in ISO?

3. **Secure Boot signing**: Need to sign bootloaders for UEFI Secure Boot on consumer hardware.

4. **ARM64 support**: Inference on ARM (Apple Silicon, NVIDIA Jetson) — different driver stack.

5. **Multi-node provisioning**: When 100 nodes boot simultaneously via PXE, TFTP becomes a bottleneck. Need HTTP fallback for kernel/initrd delivery.

### 10.2 Edge Cases

- Node boots but gateway is unreachable → operates in standalone mode, queues stats for later sync
- Wrong GPU driver loaded → fallback to basic VESA, warn user
- GPU not detected → skip GPU steps, CPU-only inference mode
- Farm Hash collision (unlikely) → gateway appends suffix
- Node re-registers with same Farm Hash → gateway updates existing record, doesn't create duplicate

---

## 11. Future Phases

| Phase | Component | Description |
|-------|-----------|-------------|
| **Phase 1** | ISO/PXE | This build — bootable OS, GPU detect, gateway registration |
| **Phase 2** | TentaCLAW Agent | Full daemon with stats push, command execution, watchdog |
| **Phase 3** | GPU Overclocking | `amd-oc.sh`, `nvidia-oc.sh` equivalent scripts |
| **Phase 4** | Flight Sheets | Model deployment profiles, rolling updates |
| **Phase 5** | Web Dashboard | Farm management UI, node monitoring, model management |
| **Phase 6** | PXE Model Boot | Network-stream models from central store |
| **Phase 7** | Proxmox Integration | TentaCLAW OS as Proxmox VM ISO |

---

## 12. Quick Reference

### Boot Kernel Command Line (for iPXE)
```
tentaclaw.gateway=192.168.1.100 tentaclaw.farmhash=FARM3K7P9 tentaclaw.initrd=* ip=dhcp BOOT_IMAGE=/boot/vmlinuz
```

### Key File Locations on Running Node
```
/etc/tentaclaw/rig.conf          # Node config (Farm Hash, gateway URL)
/var/run/tentaclaw/gpu-stats.json # Current GPU stats
/var/log/tentaclaw/agent.log     # Agent daemon log
/etc/tentaclaw/nvidia-oc.conf    # NVIDIA overclocking profile
/etc/tentaclaw/flightsheet.json  # Active flight sheet
```

### Gateway API Endpoints (to implement in gateway.ts)
```
POST /api/v1/nodes/register    # Node registration
POST /api/v1/nodes/{id}/stats   # Stats push
GET  /api/v1/nodes/{id}/config  # Config pull (fallback)
GET  /api/v1/nodes/{id}/commands # Command queue (long poll)
```

### Key Scripts to Understand
- `hive/sbin/gpu-detect` (HiveOS) — Reference for GPU detection
- `hive/sbin/gpu-stats` (HiveOS) — Reference for GPU stats collection
- `hive/sbin/amd-oc` (HiveOS) — Reference for AMD overclocking

---

*Last updated: 2026-03-28*
*Version: 0.1.0-draft*
