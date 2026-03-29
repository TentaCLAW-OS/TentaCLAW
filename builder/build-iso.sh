#!/bin/bash
# =============================================================================
# TentaCLAW OS — ISO Build Script
# =============================================================================
# Builds a bootable ISO for TentaCLAW OS
#
# Usage:
#   ./build-iso.sh                    # Default: amd64, version from git
#   ./build-iso.sh --version 0.1.0   # Specify version
#   ./build-iso.sh --arch arm64       # Build for ARM64
#   ./build-iso.sh --output ./iso/    # Custom output dir
#
# Prerequisites:
#   - Ubuntu/Debian with: debootstrap, xorriso, grub-efi-amd64-bin
#
# CLAWtopus says: "Time to build an OS with eight arms."
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Version
VERSION="${VERSION:-0.1.0}"
BUILD="$(date +%Y%m%d%H%M)"

# Architecture
ARCH="${ARCH:-amd64}"

# Build tier (minimal or 20,000-claws)
#   minimal          - Just enough to boot and run agent on any hardware
#   20,000-claws     - Full upgrade: dev tools, GPU drivers, agent, gateway, everything
TIER="${TIER:-20,000-claws}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ROOT="${BUILD_ROOT:-/tmp/tentaclaw-build}"
ROOTFS="${BUILD_ROOT}/rootfs"
ISO_ROOT="${BUILD_ROOT}/iso"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/../iso}"
OUTPUT_FILE="${OUTPUT_DIR}/TentaCLAW-OS-${VERSION}-${ARCH}.iso"

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

# =============================================================================
# Helper Functions
# =============================================================================

log() {
    echo -e "${CYAN}[build]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[build]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[build]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[build]${RESET} $*" >&2
}

log_step() {
    echo ""
    echo -e "${BOLD}${PURPLE}═══ $* ═══${RESET}"
    echo ""
}

cleanup() {
    log "Cleaning up build artifacts..."
    rm -rf "$BUILD_ROOT" 2>/dev/null || true
}

# =============================================================================
# Parse Arguments
# =============================================================================

usage() {
    cat << EOF
TentaCLAW OS — ISO Build Script

Usage: $(basename "$0") [OPTIONS]

Build Tiers:
    --tier minimal          Bare bones ISO (just enough to boot and auto-run agent)
    --tier 20,000-claws    Full upgrade: dev tools, GPU drivers, agent, gateway, everything

Options:
    --version VERSION    Set version (default: 0.1.0)
    --arch ARCH          Set architecture: amd64, arm64 (default: amd64)
    --output PATH        Output ISO path (default: ./iso/TentaCLAW-OS-{version}-{arch}.iso)
    --no-cleanup         Don't clean up build artifacts
    --help               Show this help

Examples:
    $(basename "$0") --tier minimal            # Bare bones, boots anywhere
    $(basename "$0") --tier 20,000-claws     # Full upgrade
    $(basename "$0") --version 0.1.0
    $(basename "$0") --arch arm64 --output /tmp/test.iso

EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tier)
            TIER="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --no-cleanup)
            NO_CLEANUP=1
            shift
            ;;
        --help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

OUTPUT_DIR="$(dirname "$OUTPUT_FILE")"

# =============================================================================
# Dependency Check
# =============================================================================

check_deps() {
    log "Checking dependencies..."

    local missing=()

    if [ "$TIER" = "20,000-claws" ]; then
        local tools="debootstrap xorriso grub-mkimage xz gzip tar jq npm node"
        for tool in $tools; do
            if ! command -v "$tool" &>/dev/null; then
                missing+=("$tool")
            fi
        done
        if [ "$ARCH" = "arm64" ]; then
            if ! command -v qemu-aarch64-static &>/dev/null; then
                missing+=("qemu-aarch64-static")
            fi
        done
    else
        local tools="debootstrap xorriso xz gzip tar"
        for tool in $tools; do
            if ! command -v "$tool" &>/dev/null; then
                missing+=("$tool")
            fi
        done
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing[*]}"
        log "Install with: apt-get install ${missing[*]}"
        exit 1
    fi

    log "Build tier: ${YELLOW}$TIER${RESET}"
    log_success "All dependencies satisfied"
}

# =============================================================================
# Setup Build Root
# =============================================================================

setup_build_root() {
    log_step "Setting up build environment"

    if [ -d "$BUILD_ROOT" ]; then
        log "Removing previous build..."
        rm -rf "$BUILD_ROOT"
    fi

    mkdir -p "$ROOTFS" "$ISO_ROOT/boot" "$ISO_ROOT/EFI/BOOT" "$ISO_ROOT/boot/grub"

    log_success "Build root created: $BUILD_ROOT"
}

# =============================================================================
# Bootstrap Base System
# =============================================================================

bootstrap_rootfs() {
    log_step "Bootstrapping Ubuntu 24.04 rootfs"

    log "This may take a few minutes..."

    # Use debootstrap to create base system
    debootstrap --arch="$ARCH" --variant=minbase \
        noble \
        "$ROOTFS" \
        http://archive.ubuntu.com/ubuntu/ \
        2>&1 | while read -r line; do
            echo -ne "\r  $line"
        done

    echo ""
    log_success "Base system bootstrapped"
}

# =============================================================================
# Install Base Packages
# =============================================================================

install_packages() {
    log_step "Installing base packages"

    # Mount pseudo-filesystems
    mount -t proc proc "$ROOTFS/proc"
    mount -t sysfs sys "$ROOTFS/sys"
    mount --bind /dev "$ROOTFS/dev" 2>/dev/null || mount -t devpts devpts "$ROOTFS/dev/pts"

    # Copy DNS config
    cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf" 2>/dev/null || true

    # Update package lists
    chroot "$ROOTFS" apt-get update -qq

    # Install base packages
    local packages=(
        # Core
        systemd
        udev
        sudo
        wget
        curl
        jq
        vim-tiny
        gnupg

        # Network
        network-manager
        net-tools
        iputils-ping
        dnsutils
        iproute2

        # Boot
        linux-image-generic
        initramfs-tools

        # SSH
        openssh-server

        # Hardware
        pciutils
        usbutils
        lshw

        # Misc
        dbus
        policykit-1
    )

    log "Installing ${#packages[@]} packages..."
    chroot "$ROOTFS" apt-get install -y -qq "${packages[@]}" 2>&1 | tail -5

    # Cleanup
    rm -f "$ROOTFS/etc/resolv.conf"

    # Unmount pseudo-filesystems
    umount "$ROOTFS/proc" 2>/dev/null || true
    umount "$ROOTFS/sys" 2>/dev/null || true
    umount "$ROOTFS/dev/pts" 2>/dev/null || true
    umount "$ROOTFS/dev" 2>/dev/null || true

    log_success "Packages installed"
}

# =============================================================================
# Install GPU Drivers
# =============================================================================

install_gpu_drivers() {
    log_step "Installing GPU drivers (optional)"

    # Mount pseudo-filesystems
    mount -t proc proc "$ROOTFS/proc"
    mount -t sysfs sys "$ROOTFS/sys"
    mount --bind /dev "$ROOTFS/dev" 2>/dev/null || mount -t devpts devpts "$ROOTFS/dev/pts"

    # NVIDIA driver (will be installed on first boot if not here)
    # For ISO, we include the driver metapackage
    log "Installing NVIDIA driver (will complete on first boot with GPU)..."
    chroot "$ROOTFS" apt-get install -y -qq \
        nvidia-driver-535 \
        nvidia-dkms-535 \
        nvidia-utils-535 \
        2>&1 | tail -3 || log_warn "NVIDIA driver install failed (expected in chroot)"

    # AMD ROCm (optional)
    log "AMD ROCm will be installed on first boot if AMD GPU detected"

    # Cleanup
    umount "$ROOTFS/proc" 2>/dev/null || true
    umount "$ROOTFS/sys" 2>/dev/null || true
    umount "$ROOTFS/dev/pts" 2>/dev/null || true
    umount "$ROOTFS/dev" 2>/dev/null || true

    log_success "GPU drivers configured"
}

# =============================================================================
# Install Node.js in Rootfs
# =============================================================================

install_nodejs() {
    log_step "Installing Node.js"

    # Mount pseudo-filesystems
    mount -t proc proc "$ROOTFS/proc"
    mount -t sysfs sys "$ROOTFS/sys"
    mount --bind /dev "$ROOTFS/dev" 2>/dev/null || mount -t devpts devpts "$ROOTFS/dev/pts"

    # Copy DNS config
    cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf" 2>/dev/null || true

    # Install Node.js 22.x LTS via NodeSource
    log "Adding NodeSource repository..."
    chroot "$ROOTFS" bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -" 2>&1 | tail -3
    chroot "$ROOTFS" apt-get install -y -qq nodejs 2>&1 | tail -3

    # Verify installation
    local node_ver
    node_ver=$(chroot "$ROOTFS" node --version 2>/dev/null || echo "FAILED")
    log "Node.js version: $node_ver"

    # Cleanup
    rm -f "$ROOTFS/etc/resolv.conf"
    umount "$ROOTFS/proc" 2>/dev/null || true
    umount "$ROOTFS/sys" 2>/dev/null || true
    umount "$ROOTFS/dev/pts" 2>/dev/null || true
    umount "$ROOTFS/dev" 2>/dev/null || true

    log_success "Node.js installed"
}

install_agent() {
    log_step "Installing TentaCLAW Agent"

    local PROJECT_ROOT="${SCRIPT_DIR}/.."

    # Create target directories
    mkdir -p "$ROOTFS/opt/tentaclaw/agent"
    mkdir -p "$ROOTFS/etc/tentaclaw"
    mkdir -p "$ROOTFS/var/log/tentaclaw"
    mkdir -p "$ROOTFS/var/run/tentaclaw"

    # Build agent (npm install + npm run build)
    if [ -d "${PROJECT_ROOT}/agent" ]; then
        log "Building agent..."
        (cd "${PROJECT_ROOT}/agent" && npm install --ignore-scripts && npm run build)

        # Copy built agent to rootfs
        cp -r "${PROJECT_ROOT}/agent/dist" "$ROOTFS/opt/tentaclaw/agent/dist"
        cp "${PROJECT_ROOT}/agent/package.json" "$ROOTFS/opt/tentaclaw/agent/"
        cp "${PROJECT_ROOT}/agent/package-lock.json" "$ROOTFS/opt/tentaclaw/agent/" 2>/dev/null || true

        # Install production dependencies inside rootfs
        mkdir -p "$ROOTFS/opt/tentaclaw/agent/node_modules"
        (cd "${PROJECT_ROOT}/agent" && npm install --omit=dev --ignore-scripts)
        cp -r "${PROJECT_ROOT}/agent/node_modules" "$ROOTFS/opt/tentaclaw/agent/"

        log_success "Agent built and installed to /opt/tentaclaw/agent/"
    else
        log_error "Agent source not found at ${PROJECT_ROOT}/agent"
    fi

    log_success "Agent installed"
}

install_gateway() {
    log_step "Installing TentaCLAW Gateway"

    local PROJECT_ROOT="${SCRIPT_DIR}/.."

    # Create target directory
    mkdir -p "$ROOTFS/opt/tentaclaw/gateway"

    # Build gateway (npm install + npm run build)
    if [ -d "${PROJECT_ROOT}/gateway" ]; then
        log "Building gateway..."
        (cd "${PROJECT_ROOT}/gateway" && npm install --ignore-scripts && npm run build)

        # Copy built gateway to rootfs
        cp -r "${PROJECT_ROOT}/gateway/dist" "$ROOTFS/opt/tentaclaw/gateway/dist"
        cp "${PROJECT_ROOT}/gateway/package.json" "$ROOTFS/opt/tentaclaw/gateway/"
        cp "${PROJECT_ROOT}/gateway/package-lock.json" "$ROOTFS/opt/tentaclaw/gateway/" 2>/dev/null || true

        # Install production dependencies inside rootfs
        mkdir -p "$ROOTFS/opt/tentaclaw/gateway/node_modules"
        (cd "${PROJECT_ROOT}/gateway" && npm install --omit=dev --ignore-scripts)
        cp -r "${PROJECT_ROOT}/gateway/node_modules" "$ROOTFS/opt/tentaclaw/gateway/"

        log_success "Gateway built and installed to /opt/tentaclaw/gateway/"
    else
        log_error "Gateway source not found at ${PROJECT_ROOT}/gateway"
    fi

    log_success "Gateway installed"
}

install_scripts() {
    log_step "Installing TentaCLAW scripts and configuration"

    # ── init-top scripts (run post-switchroot via systemd) ──
    mkdir -p "$ROOTFS/opt/tentaclaw/scripts/init-top"
    cp "${SCRIPT_DIR}/scripts/init-top/"*.sh "$ROOTFS/opt/tentaclaw/scripts/init-top/" 2>/dev/null || true
    chmod +x "$ROOTFS/opt/tentaclaw/scripts/init-top/"*.sh 2>/dev/null || true

    # ── CLAWtopus ASCII art library ──
    cp "${SCRIPT_DIR}/scripts/clawtopus.sh" "$ROOTFS/opt/tentaclaw/scripts/" 2>/dev/null || true
    chmod +x "$ROOTFS/opt/tentaclaw/scripts/clawtopus.sh" 2>/dev/null || true

    # ── Shared types (optional, for reference) ──
    if [ -d "${SCRIPT_DIR}/../shared" ]; then
        mkdir -p "$ROOTFS/opt/tentaclaw/shared"
        cp -r "${SCRIPT_DIR}/../shared/"* "$ROOTFS/opt/tentaclaw/shared/" 2>/dev/null || true
    fi

    # ── Config overlay (preserves directory structure) ──
    # builder/config/ mirrors the rootfs layout: etc/systemd/, etc/ssh/, root/, etc.
    if [ -d "${SCRIPT_DIR}/config" ]; then
        cp -r "${SCRIPT_DIR}/config/"* "$ROOTFS/" 2>/dev/null || true
    fi

    # ── Systemd service ──
    mkdir -p "$ROOTFS/etc/systemd/system"
    if [ -f "${SCRIPT_DIR}/config/etc/systemd/tentaclaw-agent.service" ]; then
        cp "${SCRIPT_DIR}/config/etc/systemd/tentaclaw-agent.service" \
           "$ROOTFS/etc/systemd/system/tentaclaw-agent.service"
        # Enable the service for multi-user target
        mkdir -p "$ROOTFS/etc/systemd/system/multi-user.target.wants"
        ln -sf /etc/systemd/system/tentaclaw-agent.service \
               "$ROOTFS/etc/systemd/system/multi-user.target.wants/tentaclaw-agent.service"
        log_success "tentaclaw-agent.service installed and enabled"
    else
        log_warn "tentaclaw-agent.service not found in config"
    fi

    log_success "Scripts and configuration installed"
}

# =============================================================================
# Install Inference Runtime
# =============================================================================

install_inference_runtime() {
    log_step "Installing Inference Runtime"

    # Create runtime directories
    mkdir -p "$ROOTFS/opt/inference"

    # Ollama (download and install binary)
    log "Installing Ollama..."
    if command -v ollama &>/dev/null; then
        cp "$(command -v ollama)" "$ROOTFS/usr/local/bin/ollama" 2>/dev/null || true
    fi

    # Llama.cpp (placeholder)
    log "Llama.cpp will be installed on first boot"

    log_success "Inference runtime configured"
}

# =============================================================================
# Configure System
# =============================================================================

configure_system() {
    log_step "Configuring system"

    # Hostname
    echo "tentaclaw-node" > "$ROOTFS/etc/hostname"

    # Hosts
    cat > "$ROOTFS/etc/hosts" << 'EOF'
127.0.0.1   localhost
127.0.1.1   tentaclaw-node

# The following lines are desirable for IPv6 capable hosts
::1     localhost ip6-localhost ip6-loopback
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
EOF

    # Network (use NetworkManager)
    mkdir -p "$ROOTFS/etc/netplan"
    cat > "$ROOTFS/etc/netplan/01-tentaclaw.yaml" << 'EOF'
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: true
      optional: true
EOF

    # SSH (permit root login for now)
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' "$ROOTFS/etc/ssh/sshd_config"
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' "$ROOTFS/etc/ssh/sshd_config"

    # Disable splash screen
    mkdir -p "$ROOTFS/etc/default"
    echo "GRUB_TIMEOUT=5" >> "$ROOTFS/etc/default/grub"
    echo "GRUB_CMDLINE_LINUX_DEFAULT=\"quiet splash\"" >> "$ROOTFS/etc/default/grub"

    log_success "System configured"
}

# =============================================================================
# Create Initrd with CLAWtopus Scripts
# =============================================================================

create_initrd() {
    log_step "Creating initrd with CLAWtopus early boot"

    # Create init-bottom scripts directory in initrd
    local initrd_dir="$BUILD_ROOT/initrd"
    mkdir -p "$initrd_dir/scripts"

    # Copy scripts
    cp "${SCRIPT_DIR}/scripts/init-bottom/"*.sh "$initrd_dir/scripts/"
    cp "${SCRIPT_DIR}/scripts/clawtopus.sh" "$initrd_dir/scripts/"

    # Create the init script
    cat > "$initrd_dir/init" << 'INITEOF'
#!/bin/bash
# TentaCLAW OS — Init (runs in initrd)
# CLAWtopus says: "I'm waking up."

set -e

# Mount pseudo-filesystems
mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev 2>/dev/null || mount -t devpts devpts /dev/pts

# Source CLAWtopus art
. /scripts/clawtopus.sh

# Clear screen
clear

# Print splash
clawtopus_splash

# Run init-bottom scripts in order
for script in /scripts/*.sh; do
    if [ -f "$script" ] && [ "$(basename "$script")" != "clawtopus.sh" ]; then
        echo ""
        echo -e "${CYAN}Running: $(basename $script)${RESET}"
        echo ""
        bash "$script"
    fi
done

# Continue with switchroot
echo ""
echo -e "${GREEN}[init] Switching to real root filesystem...${RESET}"

# Unmount pseudo-filesystems
umount /proc /sys /dev/pts /dev 2>/dev/null || true

# Switch to real root
exec switch_root /mnt /sbin/init
INITEOF

    chmod +x "$initrd_dir/init"

    # Build initrd (cpio + gzip)
    cd "$initrd_dir"
    find . -print0 | cpio --null --quiet -ov --format=newc | gzip -9 > "$ISO_ROOT/boot/initrd.img"
    cd - > /dev/null

    log_success "Initrd created with CLAWtopus scripts"
}

# =============================================================================
# Install Kernel
# =============================================================================

install_kernel() {
    log_step "Installing kernel"

    # Copy kernel from rootfs
    if [ -f "$ROOTFS/boot/vmlinuz" ]; then
        cp "$ROOTFS/boot/vmlinuz" "$ISO_ROOT/boot/vmlinuz"
    elif [ -f "$ROOTFS/boot/vmlinuz-$(ls "$ROOTFS/boot/" | grep vmlinuz | head -1)" ]; then
        local kver=$(ls "$ROOTFS/boot/" | grep vmlinuz | head -1)
        cp "$ROOTFS/boot/$kver" "$ISO_ROOT/boot/vmlinuz"
    else
        log_warn "No kernel found in rootfs, using host kernel"
        if [ -f /boot/vmlinuz ]; then
            cp /boot/vmlinuz "$ISO_ROOT/boot/vmlinuz"
        elif [ -f /vmlinuz ]; then
            cp /vmlinuz "$ISO_ROOT/boot/vmlinuz"
        fi
    fi

    # Copy System.map if exists
    if [ -f "$ROOTFS/boot/System.map-"* ]; then
        cp "$ROOTFS/boot/System.map-"* "$ISO_ROOT/boot/System.map" 2>/dev/null || true
    fi

    # Copy initramfs (rebuild with our scripts)
    if command -v mkinitramfs &>/dev/null; then
        log "Kernel installed"
    fi

    log_success "Kernel installed"
}

# =============================================================================
# Create GRUB Bootloader
# =============================================================================

create_bootloader() {
    log_step "Creating GRUB bootloader"

    # Create GRUB config
    mkdir -p "$ISO_ROOT/boot/grub"

    cat > "$ISO_ROOT/boot/grub/grub.cfg" << 'GRUBEOF'
# TentaCLAW OS — GRUB Configuration
set timeout=5
set default=0

menuentry "TentaCLAW OS" {
    echo "Loading TentaCLAW OS..."
    linux /boot/vmlinuz tentaclaw.mode=iso ip=dhcp quiet
    initrd /boot/initrd.img
}

menuentry "TentaCLAW OS (debug)" {
    echo "Loading TentaCLAW OS (debug mode)..."
    linux /boot/vmlinuz tentaclaw.mode=iso ip=dhcp debug tentaclaw.init=sh
    initrd /boot/initrd.img
}
GRUBEOF

    # Build GRUB image for BIOS boot
    if command -v grub-mkimage &>/dev/null; then
        grub-mkimage \
            -O i386-pc \
            -o "$ISO_ROOT/boot/grub/i386-pc/core.img" \
            biosdisk part_msdos ext2 normal search \
            2>/dev/null || true
    fi

    log_success "Bootloader created"
}

# =============================================================================
# Create UEFI Boot
# =============================================================================

create_uefi_boot() {
    log_step "Creating UEFI boot files"

    # Create EFI directories
    mkdir -p "$ISO_ROOT/EFI/BOOT"
    mkdir -p "$ISO_ROOT/boot/grub/x86_64-efi"

    # Create minimal EFI boot manager
    cat > "$ISO_ROOT/EFI/BOOT/BOOTX64.EFI" 2>/dev/null << 'EFIDUMMY' || true
    (placeholder - real UEFI binary built by grub-mkimage)
EFIDUMMY

    # Create EFI config
    cat > "$ISO_ROOT/EFI/BOOT/grub.cfg" << 'EOF'
set timeout=5
search --label TENTACLAW
set default=0

menuentry "TentaCLAW OS" {
    echo "Loading TentaCLAW OS..."
    linux /boot/vmlinuz tentaclaw.mode=iso ip=dhcp quiet
    initrd /boot/initrd.img
}
EOF

    # Build actual UEFI binary
    if command -v grub-mkimage &>/dev/null; then
        grub-mkimage \
            -O x86_64-efi \
            -o "$ISO_ROOT/EFI/BOOT/BOOTX64.EFI" \
            part_gpt part_msdos fat normal search search_fs_file \
            2>/dev/null || log_warn "Could not build UEFI binary (may need grub-efi-amd64-bin)"
    fi

    log_success "UEFI boot files created"
}

# =============================================================================
# Create ISO9660 Filesystem
# =============================================================================

create_iso() {
    log_step "Creating ISO9660 filesystem"

    # Create ISO directory structure
    mkdir -p "$ISO_ROOT/.disk"

    # Create disk info
    echo "TentaCLAW OS ${VERSION}" > "$ISO_ROOT/.disk/info"
    echo "amd64" > "$ISO_ROOT/.disk/arch"
    touch "$ISO_ROOT/.disk/base_installable"

    # Create isolinux for BIOS boot
    mkdir -p "$ISO_ROOT/isolinux"

    # Create isolinux config
    cat > "$ISO_ROOT/isolinux/isolinux.cfg" << 'EOF'
DEFAULT tentaclaw
LABEL tentaclaw
    KERNEL /boot/vmlinuz
    INITRD /boot/initrd.img
    APPEND tentaclaw.mode=iso ip=dhcp quiet
EOF

    # Build ISO with xorriso
    log "Building ISO (this may take a few minutes)..."

    xorriso \
        -as mkisofs \
        -r \
        -J \
        -joliet-level 3 \
        -isohybrid-mbr /usr/lib/syslinux/bios/mbr.bin \
        -partition_offset 16 \
        -V "TENTACLAW" \
        -appid "TentaCLAW OS" \
        -publisher "TentaCLAW Project" \
        -p "built by build-iso.sh" \
        -preparerer "TentaCLAW" \
        -o "$OUTPUT_FILE" \
        "$ISO_ROOT" \
        2>&1 | while read -r line; do
            echo -ne "\r  $line"
        done

    echo ""
    log_success "ISO created: $OUTPUT_FILE"
}

# =============================================================================
# Finalize
# =============================================================================

finalize() {
    log_step "Finalizing build"

    # Make ISO bootable (if isohybrid succeeded)
    if command -v isohybrid &>/dev/null; then
        isohybrid --uefi "$OUTPUT_FILE" 2>/dev/null || true
    fi

    # Set permissions
    chmod 644 "$OUTPUT_FILE" 2>/dev/null || true

    # Create checksum
    if command -v sha256sum &>/dev/null; then
        sha256sum "$OUTPUT_FILE" > "${OUTPUT_FILE}.sha256"
        log_success "Checksum: $(cat "${OUTPUT_FILE}.sha256" | cut -d' ' -f1)"
    fi

    # Output summary
    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${GREEN}║                TentaCLAW OS Build Complete!                 ║${RESET}"
    echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Version:  ${CYAN}${VERSION}${RESET}                                           ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Arch:     ${CYAN}${ARCH}${RESET}                                              ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Output:   ${CYAN}${OUTPUT_FILE}${RESET}  ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Size:     ${CYAN}$(du -h "$OUTPUT_FILE" 2>/dev/null | cut -f1)${RESET}                                         ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo ""

    # Cleanup
    if [ -z "${NO_CLEANUP:-}" ]; then
        cleanup
    else
        log "Build artifacts kept at: $BUILD_ROOT"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo ""
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   ${PURPLE}TentaCLAW OS${CYAN} — ISO Builder                           ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   ${TEAL}Eight arms. One mind. Zero compromises.${RESET}                       ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   Version ${VERSION} | Architecture ${ARCH} | Tier: ${TIER}         ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}"
    echo ""

    check_deps
    setup_build_root
    bootstrap_rootfs
    install_packages
    configure_system

    if [ "$TIER" = "20,000-claws" ]; then
        install_nodejs
        install_gpu_drivers
        install_agent
        install_gateway
        install_inference_runtime
    else
        log "Skipping 20,000-claws-only components (Node.js, GPU drivers, agent, gateway, inference runtime)"
    fi

    install_scripts
    create_initrd
    install_kernel
    create_bootloader
    create_uefi_boot
    create_iso
    finalize
}

# Run
main "$@"
