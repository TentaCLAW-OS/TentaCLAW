#!/bin/bash
# =============================================================================
# TentaCLAW OS — Cloud Image Builder
# =============================================================================
# Builds cloud-ready disk images (qcow2/raw/vhd) with cloud-init support.
# For deployment on AWS, GCP, Azure, Proxmox, or any cloud/hypervisor.
#
# Usage:
#   ./build-cloud-image.sh                          # Default: qcow2, amd64
#   ./build-cloud-image.sh --format raw             # Raw disk image
#   ./build-cloud-image.sh --format vhd             # Azure VHD
#   ./build-cloud-image.sh --size 20G               # 20GB disk
#   ./build-cloud-image.sh --role gateway            # Pre-configure as gateway
#
# TentaCLAW says: "Reaching into the cloud with all eight arms."
# =============================================================================

set -euo pipefail

VERSION="${VERSION:-0.1.0}"
ARCH="${ARCH:-amd64}"
FORMAT="${FORMAT:-qcow2}"
DISK_SIZE="${DISK_SIZE:-16G}"
ROLE="${ROLE:-agent}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ROOT="${BUILD_ROOT:-/tmp/tentaclaw-cloud-build}"
ROOTFS="${BUILD_ROOT}/rootfs"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/../iso}"

CYAN='\x1b[38;2;0;255;255m'
GREEN='\x1b[38;2;0;255;136m'
PURPLE='\x1b[38;2;140;0;200m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
BOLD='\x1b[1m'
RESET='\x1b[0m'

log()      { echo -e "${CYAN}[cloud]${RESET} $*"; }
log_ok()   { echo -e "${GREEN}[cloud]${RESET} $*"; }
log_step() { echo ""; echo -e "${BOLD}${PURPLE}═══ $* ═══${RESET}"; echo ""; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --format) FORMAT="$2"; shift 2 ;;
        --size)   DISK_SIZE="$2"; shift 2 ;;
        --role)   ROLE="$2"; shift 2 ;;
        --arch)   ARCH="$2"; shift 2 ;;
        --output) OUTPUT_DIR="$2"; shift 2 ;;
        --help)   echo "Usage: $0 [--format qcow2|raw|vhd] [--size 16G] [--role gateway|agent]"; exit 0 ;;
        *)        echo "Unknown: $1"; exit 1 ;;
    esac
done

OUTPUT_FILE="${OUTPUT_DIR}/TentaCLAW-OS-${VERSION}-${ARCH}-cloud.${FORMAT}"

main() {
    log_step "TentaCLAW OS Cloud Image Builder"
    log "Format: ${FORMAT} | Size: ${DISK_SIZE} | Role: ${ROLE} | Arch: ${ARCH}"

    # Step 1: Create raw disk image
    log_step "Creating disk image"
    mkdir -p "$BUILD_ROOT" "$OUTPUT_DIR"
    local RAW_IMG="${BUILD_ROOT}/disk.raw"
    truncate -s "$DISK_SIZE" "$RAW_IMG"

    # Partition: EFI + root
    log "Partitioning..."
    parted -s "$RAW_IMG" mklabel gpt
    parted -s "$RAW_IMG" mkpart EFI fat32 1MiB 513MiB
    parted -s "$RAW_IMG" mkpart ROOT ext4 513MiB 100%
    parted -s "$RAW_IMG" set 1 esp on

    # Setup loop device
    local LOOP
    LOOP=$(losetup -fP --show "$RAW_IMG")
    log "Loop device: $LOOP"

    # Format
    mkfs.fat -F32 "${LOOP}p1"
    mkfs.ext4 -q "${LOOP}p2"

    # Mount
    mkdir -p "$ROOTFS"
    mount "${LOOP}p2" "$ROOTFS"
    mkdir -p "$ROOTFS/boot/efi"
    mount "${LOOP}p1" "$ROOTFS/boot/efi"

    # Step 2: Debootstrap
    log_step "Bootstrapping Ubuntu 24.04"
    debootstrap --arch="$ARCH" --variant=minbase noble "$ROOTFS" http://archive.ubuntu.com/ubuntu/ 2>&1 | tail -5

    # Step 3: Install packages + cloud-init
    log_step "Installing packages"
    mount -t proc proc "$ROOTFS/proc"
    mount -t sysfs sys "$ROOTFS/sys"
    mount --bind /dev "$ROOTFS/dev"

    cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf" 2>/dev/null || true

    chroot "$ROOTFS" apt-get update -qq
    chroot "$ROOTFS" apt-get install -y -qq \
        systemd linux-image-generic initramfs-tools \
        cloud-init cloud-guest-utils \
        openssh-server sudo curl wget jq \
        network-manager pciutils usbutils lshw \
        ufw fail2ban unattended-upgrades \
        ca-certificates gnupg \
        2>&1 | tail -5

    # Step 4: Install Node.js + TentaCLAW
    log_step "Installing TentaCLAW"
    chroot "$ROOTFS" bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -" 2>&1 | tail -3
    chroot "$ROOTFS" apt-get install -y -qq nodejs 2>&1 | tail -3

    # Copy TentaCLAW from source
    local PROJECT_ROOT="${SCRIPT_DIR}/.."
    if [ -d "${PROJECT_ROOT}/agent" ]; then
        mkdir -p "$ROOTFS/opt/tentaclaw"
        cp -r "${PROJECT_ROOT}/agent" "$ROOTFS/opt/tentaclaw/" 2>/dev/null || true
        cp -r "${PROJECT_ROOT}/gateway" "$ROOTFS/opt/tentaclaw/" 2>/dev/null || true
        cp -r "${PROJECT_ROOT}/shared" "$ROOTFS/opt/tentaclaw/" 2>/dev/null || true
    fi

    # Step 5: Configure cloud-init
    log_step "Configuring cloud-init"
    mkdir -p "$ROOTFS/etc/cloud/cloud.cfg.d"
    cat > "$ROOTFS/etc/cloud/cloud.cfg.d/99-tentaclaw.cfg" << 'CLOUDINIT'
# TentaCLAW OS cloud-init configuration
system_info:
  default_user:
    name: tentaclaw
    lock_passwd: false
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]

runcmd:
  - systemctl enable tentaclaw-agent
  - /opt/tentaclaw/builder/scripts/first-boot.sh || true
CLOUDINIT

    # Step 6: Install GRUB
    log_step "Installing GRUB"
    chroot "$ROOTFS" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=tentaclaw --no-floppy "${LOOP}" 2>&1 | tail -3 || log "GRUB EFI install (may need manual setup for some clouds)"
    chroot "$ROOTFS" update-grub 2>&1 | tail -3

    # Cleanup
    rm -f "$ROOTFS/etc/resolv.conf"
    umount "$ROOTFS/dev" "$ROOTFS/proc" "$ROOTFS/sys" 2>/dev/null || true
    umount "$ROOTFS/boot/efi" "$ROOTFS" 2>/dev/null || true
    losetup -d "$LOOP"

    # Step 7: Convert to target format
    log_step "Converting to ${FORMAT}"
    case "$FORMAT" in
        qcow2)
            qemu-img convert -f raw -O qcow2 -c "$RAW_IMG" "$OUTPUT_FILE"
            ;;
        vhd)
            qemu-img convert -f raw -O vpc "$RAW_IMG" "$OUTPUT_FILE"
            ;;
        raw)
            mv "$RAW_IMG" "$OUTPUT_FILE"
            ;;
        *)
            log "Unknown format: $FORMAT — keeping raw"
            mv "$RAW_IMG" "$OUTPUT_FILE"
            ;;
    esac

    # Cleanup
    rm -rf "$BUILD_ROOT"

    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${GREEN}║           TentaCLAW Cloud Image Built!                      ║${RESET}"
    echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Format:  ${CYAN}${FORMAT}${RESET}                                              ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Size:    ${CYAN}$(du -h "$OUTPUT_FILE" | cut -f1)${RESET}                                             ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Output:  ${CYAN}${OUTPUT_FILE}${RESET}  ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
}

main "$@"
