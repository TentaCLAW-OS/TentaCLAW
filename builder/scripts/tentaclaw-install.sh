#!/bin/bash
# =============================================================================
# TentaCLAW OS — Text-Mode Installer
# =============================================================================
# Installs TentaCLAW OS to a disk from the live session.
# Works headless (no GUI required) — perfect for rack servers.
#
# Usage:
#   tentaclaw-install.sh                    # Interactive mode
#   tentaclaw-install.sh --disk /dev/sda    # Auto-install to specified disk
#   tentaclaw-install.sh --role gateway     # Set role (gateway or agent)
#   tentaclaw-install.sh --unattended       # No prompts, use defaults
#
# TentaCLAW says: "Let me wrap my tentacles around that disk."
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"

# Defaults
TARGET_DISK=""
ROLE="agent"         # agent or gateway
HOSTNAME_SET=""
STATIC_IP=""
CLUSTER_SECRET=""
UNATTENDED=false
SWAP_SIZE="4G"

# Colors
CYAN='\x1b[38;2;0;255;255m'
PURPLE='\x1b[38;2;140;0;200m'
GREEN='\x1b[38;2;0;255;136m'
YELLOW='\x1b[38;2;255;220;50m'
RED='\x1b[38;2;255;70;70m'
WHITE='\x1b[38;2;240;240;240m'
BOLD='\x1b[1m'
DIM='\x1b[2m'
RESET='\x1b[0m'

log()      { echo -e "${CYAN}[install]${RESET} $*"; }
log_ok()   { echo -e "${GREEN}[install]${RESET} $*"; }
log_warn() { echo -e "${YELLOW}[install]${RESET} $*" >&2; }
log_err()  { echo -e "${RED}[install]${RESET} $*" >&2; }
log_step() { echo ""; echo -e "${BOLD}${PURPLE}═══ $* ═══${RESET}"; echo ""; }

ask() {
    local prompt="$1" default="${2:-}"
    if $UNATTENDED; then echo "$default"; return; fi
    local answer
    read -rp "$(echo -e "${CYAN}?${RESET} ${prompt}${default:+ [${default}]}: ")" answer
    echo "${answer:-$default}"
}

# =============================================================================
# Parse Arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case "$1" in
        --disk)       TARGET_DISK="$2"; shift 2 ;;
        --role)       ROLE="$2"; shift 2 ;;
        --hostname)   HOSTNAME_SET="$2"; shift 2 ;;
        --ip)         STATIC_IP="$2"; shift 2 ;;
        --secret)     CLUSTER_SECRET="$2"; shift 2 ;;
        --swap)       SWAP_SIZE="$2"; shift 2 ;;
        --unattended) UNATTENDED=true; shift ;;
        --help)
            echo "Usage: tentaclaw-install.sh [--disk /dev/sdX] [--role gateway|agent] [--unattended]"
            exit 0 ;;
        *) log_err "Unknown: $1"; exit 1 ;;
    esac
done

# =============================================================================
# Pre-flight Checks
# =============================================================================

preflight() {
    log_step "Pre-flight checks"

    if [ "$(id -u)" -ne 0 ]; then
        log_err "Must run as root. Use: sudo tentaclaw-install.sh"
        exit 1
    fi

    # Check we're in a live session
    if [ ! -f /run/casper/filesystem.squashfs ] && [ ! -d /cdrom/casper ]; then
        log_warn "Not running from live ISO — proceeding anyway (manual install)"
    fi

    # Check required tools
    for tool in parted mkfs.ext4 mkfs.fat mount chroot grub-install; do
        if ! command -v "$tool" &>/dev/null; then
            log_err "Missing tool: $tool"
            exit 1
        fi
    done

    log_ok "Pre-flight checks passed"
}

# =============================================================================
# Disk Selection
# =============================================================================

select_disk() {
    log_step "Disk Selection"

    if [ -n "$TARGET_DISK" ]; then
        if [ ! -b "$TARGET_DISK" ]; then
            log_err "Disk not found: $TARGET_DISK"
            exit 1
        fi
        log "Using specified disk: $TARGET_DISK"
        return
    fi

    # List available disks
    echo -e "${WHITE}Available disks:${RESET}"
    echo ""
    lsblk -d -o NAME,SIZE,MODEL,TYPE | grep disk | while read -r line; do
        echo -e "  ${CYAN}/dev/$(echo "$line" | awk '{print $1}')${RESET}  $(echo "$line" | awk '{print $2}')  ${DIM}$(echo "$line" | awk '{$1=$2=""; print $0}')${RESET}"
    done
    echo ""

    TARGET_DISK="/dev/$(ask "Install to disk (e.g. sda, nvme0n1)" "sda")"

    if [ ! -b "$TARGET_DISK" ]; then
        log_err "Disk not found: $TARGET_DISK"
        exit 1
    fi

    if ! $UNATTENDED; then
        echo ""
        echo -e "${RED}${BOLD}WARNING: ALL DATA ON ${TARGET_DISK} WILL BE DESTROYED${RESET}"
        local confirm
        read -rp "$(echo -e "${RED}Type 'yes' to continue: ${RESET}")" confirm
        if [ "$confirm" != "yes" ]; then
            log "Aborted."
            exit 0
        fi
    fi
}

# =============================================================================
# Partition Disk
# =============================================================================

partition_disk() {
    log_step "Partitioning ${TARGET_DISK}"

    # Wipe existing partition table
    wipefs -af "$TARGET_DISK" &>/dev/null || true
    sgdisk --zap-all "$TARGET_DISK" &>/dev/null || true

    # Create GPT partition table
    parted -s "$TARGET_DISK" mklabel gpt

    # Partition layout:
    #   1: EFI System Partition (512MB FAT32)
    #   2: Root filesystem (rest - swap)
    #   3: Swap (4GB default)
    parted -s "$TARGET_DISK" \
        mkpart "EFI"  fat32  1MiB   513MiB \
        mkpart "ROOT" ext4   513MiB "-${SWAP_SIZE}" \
        mkpart "SWAP" linux-swap "-${SWAP_SIZE}" 100% \
        set 1 esp on

    # Determine partition device names
    if [[ "$TARGET_DISK" == *nvme* ]] || [[ "$TARGET_DISK" == *mmcblk* ]]; then
        PART_EFI="${TARGET_DISK}p1"
        PART_ROOT="${TARGET_DISK}p2"
        PART_SWAP="${TARGET_DISK}p3"
    else
        PART_EFI="${TARGET_DISK}1"
        PART_ROOT="${TARGET_DISK}2"
        PART_SWAP="${TARGET_DISK}3"
    fi

    # Wait for kernel to recognize partitions
    partprobe "$TARGET_DISK"
    sleep 2

    # Format
    log "Formatting EFI partition..."
    mkfs.fat -F32 -n "EFI" "$PART_EFI"

    log "Formatting root partition..."
    mkfs.ext4 -L "TENTACLAW" -q "$PART_ROOT"

    log "Setting up swap..."
    mkswap -L "SWAP" "$PART_SWAP"

    log_ok "Disk partitioned: EFI(512M) + Root + Swap(${SWAP_SIZE})"
}

# =============================================================================
# Install System
# =============================================================================

install_system() {
    log_step "Installing TentaCLAW OS"

    local MOUNT="/mnt/tentaclaw"
    mkdir -p "$MOUNT"

    # Mount root
    mount "$PART_ROOT" "$MOUNT"
    mkdir -p "$MOUNT/boot/efi"
    mount "$PART_EFI" "$MOUNT/boot/efi"

    # Copy system from squashfs
    if [ -f /run/casper/filesystem.squashfs ]; then
        log "Copying from live filesystem..."
        unsquashfs -f -d "$MOUNT" /run/casper/filesystem.squashfs 2>&1 | tail -3
    elif [ -f /cdrom/casper/filesystem.squashfs ]; then
        log "Copying from ISO filesystem..."
        unsquashfs -f -d "$MOUNT" /cdrom/casper/filesystem.squashfs 2>&1 | tail -3
    else
        log_err "Cannot find squashfs filesystem. Are you running from the live ISO?"
        exit 1
    fi

    # Generate fstab
    local ROOT_UUID
    ROOT_UUID=$(blkid -s UUID -o value "$PART_ROOT")
    local EFI_UUID
    EFI_UUID=$(blkid -s UUID -o value "$PART_EFI")
    local SWAP_UUID
    SWAP_UUID=$(blkid -s UUID -o value "$PART_SWAP")

    cat > "$MOUNT/etc/fstab" << FSTAB
# TentaCLAW OS — /etc/fstab
UUID=${ROOT_UUID}  /           ext4  errors=remount-ro  0 1
UUID=${EFI_UUID}   /boot/efi   vfat  umask=0077         0 1
UUID=${SWAP_UUID}  none        swap  sw                 0 0
FSTAB

    log_ok "System files copied"

    # Install GRUB
    log "Installing GRUB bootloader..."
    mount --bind /dev  "$MOUNT/dev"
    mount --bind /proc "$MOUNT/proc"
    mount --bind /sys  "$MOUNT/sys"

    chroot "$MOUNT" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=tentaclaw --no-floppy 2>&1 | tail -3
    chroot "$MOUNT" update-grub 2>&1 | tail -3

    # Cleanup mounts
    umount "$MOUNT/sys" "$MOUNT/proc" "$MOUNT/dev" 2>/dev/null || true

    log_ok "GRUB installed"

    # Store mount point for configure step
    INSTALL_MOUNT="$MOUNT"
}

# =============================================================================
# Configure System
# =============================================================================

configure_system() {
    log_step "Configuring TentaCLAW OS"

    local MOUNT="${INSTALL_MOUNT:-/mnt/tentaclaw}"

    # Role
    if ! $UNATTENDED && [ -z "$ROLE" ]; then
        ROLE=$(ask "Node role (gateway or agent)" "agent")
    fi
    log "Role: ${CYAN}${ROLE}${RESET}"

    # Hostname
    if [ -z "$HOSTNAME_SET" ]; then
        if [ "$ROLE" = "gateway" ]; then
            HOSTNAME_SET=$(ask "Hostname" "tentaclaw-gateway")
        else
            HOSTNAME_SET=$(ask "Hostname" "tentaclaw-node-$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c4)")
        fi
    fi
    echo "$HOSTNAME_SET" > "$MOUNT/etc/hostname"
    sed -i "s/tentaclaw-node/$HOSTNAME_SET/g" "$MOUNT/etc/hosts"
    log "Hostname: ${CYAN}${HOSTNAME_SET}${RESET}"

    # Create tentaclaw user
    chroot "$MOUNT" useradd -m -s /bin/bash -G sudo tentaclaw 2>/dev/null || true
    if ! $UNATTENDED; then
        echo -e "${CYAN}Set password for 'tentaclaw' user:${RESET}"
        chroot "$MOUNT" passwd tentaclaw
    else
        echo "tentaclaw:tentaclaw" | chroot "$MOUNT" chpasswd
        log_warn "Default password set — CHANGE IT on first login"
    fi

    # Disable root SSH login
    sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' "$MOUNT/etc/ssh/sshd_config"
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' "$MOUNT/etc/ssh/sshd_config"

    # Configure TentaCLAW
    mkdir -p "$MOUNT/etc/tentaclaw"
    mkdir -p "$MOUNT/var/lib/tentaclaw"
    mkdir -p "$MOUNT/var/log/tentaclaw"

    # Generate rig.conf
    if [ "$ROLE" = "gateway" ]; then
        # Generate cluster secret
        if [ -z "$CLUSTER_SECRET" ]; then
            CLUSTER_SECRET=$(openssl rand -hex 32)
        fi
        cat > "$MOUNT/etc/tentaclaw/rig.conf" << CONF
# TentaCLAW Gateway Configuration
ROLE=gateway
TENTACLAW_PORT=8080
TENTACLAW_HOST=0.0.0.0
TENTACLAW_DB_PATH=/var/lib/tentaclaw/hivemind.db
TENTACLAW_CLUSTER_SECRET=${CLUSTER_SECRET}
CONF
        log "Cluster secret: ${CYAN}${CLUSTER_SECRET:0:16}...${RESET}"
        log_warn "Save this secret — agents need it to join the cluster"

        # Enable gateway service
        chroot "$MOUNT" systemctl enable tentaclaw-gateway.service 2>/dev/null || true
    else
        # Agent config
        local GW_URL
        GW_URL=$(ask "Gateway URL" "http://tentaclaw-gateway:8080")
        if [ -z "$CLUSTER_SECRET" ] && ! $UNATTENDED; then
            CLUSTER_SECRET=$(ask "Cluster secret (from gateway)" "")
        fi
        cat > "$MOUNT/etc/tentaclaw/rig.conf" << CONF
# TentaCLAW Agent Configuration
ROLE=agent
TENTACLAW_GATEWAY_URL=${GW_URL}
TENTACLAW_CLUSTER_SECRET=${CLUSTER_SECRET}
TENTACLAW_INTERVAL=10000
CONF
    fi

    # Enable agent service (runs on both gateway and agent nodes)
    chroot "$MOUNT" systemctl enable tentaclaw-agent.service 2>/dev/null || true

    # Firewall
    chroot "$MOUNT" bash -c '
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow 22/tcp       # SSH
        ufw allow 8080/tcp     # Gateway API
        ufw allow 11434/tcp    # Ollama
        ufw allow 41337/udp    # Discovery
        ufw --force enable
    ' 2>/dev/null || log_warn "Firewall setup failed (will configure on first boot)"

    log_ok "System configured as ${ROLE}"
}

# =============================================================================
# Finalize
# =============================================================================

finalize_install() {
    log_step "Finalizing installation"

    local MOUNT="${INSTALL_MOUNT:-/mnt/tentaclaw}"

    # Unmount
    umount "$MOUNT/boot/efi" 2>/dev/null || true
    umount "$MOUNT" 2>/dev/null || true

    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${GREEN}║           TentaCLAW OS Installation Complete!               ║${RESET}"
    echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Role:     ${CYAN}${ROLE}${RESET}                                              ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Hostname: ${CYAN}${HOSTNAME_SET}${RESET}                                  ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Disk:     ${CYAN}${TARGET_DISK}${RESET}                                        ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  User:     ${CYAN}tentaclaw${RESET}                                         ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Remove the USB/ISO and reboot.                             ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  SSH in with: ssh tentaclaw@${HOSTNAME_SET}              ${BOLD}${GREEN}║${RESET}"
    if [ "$ROLE" = "gateway" ]; then
    echo -e "${BOLD}${GREEN}║${RESET}  Dashboard: http://${HOSTNAME_SET}:8080/dashboard    ${BOLD}${GREEN}║${RESET}"
    fi
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo ""

    if ! $UNATTENDED; then
        read -rp "$(echo -e "${CYAN}Press Enter to reboot (or Ctrl+C to stay in live session)${RESET}")"
        reboot
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo ""
    echo -e "${BOLD}${PURPLE}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${PURPLE}║${RESET}   ${CYAN}TentaCLAW OS Installer${RESET}                                     ${BOLD}${PURPLE}║${RESET}"
    echo -e "${BOLD}${PURPLE}║${RESET}   ${DIM}Eight arms. One mind. Zero compromises.${RESET}                    ${BOLD}${PURPLE}║${RESET}"
    echo -e "${BOLD}${PURPLE}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo ""

    preflight
    select_disk
    partition_disk
    install_system
    configure_system
    finalize_install
}

main "$@"
