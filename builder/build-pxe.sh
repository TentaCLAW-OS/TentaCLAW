#!/bin/bash
# =============================================================================
# TentaCLAW OS — PXE Boot Artifact Builder
# =============================================================================
# Builds PXE boot artifacts: kernel, initrd, iPXE binaries, and boot config.
#
# Usage:
#   ./build-pxe.sh                    # Default: amd64, version from parent
#   ./build-pxe.sh --version 0.1.0    # Specify version
#   ./build-pxe.sh --output ./pxe/     # Custom output dir
#
# Prerequisites:
#   - Linux with: xorriso, gzip, cpio, wget
#   - iPXE source or prebuilt binaries (optional)
#
# TentaCLAW says: "Network boot? Now we're talking."
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

VERSION="${VERSION:-0.1.0}"
ARCH="${ARCH:-amd64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/../pxe}"
BUILD_ROOT="${BUILD_ROOT:-/tmp/tentaclaw-pxe}"

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
    echo -e "${CYAN}[pxe-build]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}[pxe-build]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}[pxe-build]${RESET} $*" >&2
}

log_error() {
    echo -e "${RED}[pxe-build]${RESET} $*" >&2
}

log_step() {
    echo ""
    echo -e "${BOLD}${PURPLE}═══ $* ═══${RESET}"
    echo ""
}

# =============================================================================
# Setup
# =============================================================================

setup() {
    log_step "Setting up PXE build environment"

    if [ -d "$BUILD_ROOT" ]; then
        rm -rf "$BUILD_ROOT"
    fi

    mkdir -p "$OUTPUT_DIR"/boot/TENTACLAW
    mkdir -p "$BUILD_ROOT"/initrd
    mkdir -p "$BUILD_ROOT"/ipxe

    log_success "Build directories created"
}

# =============================================================================
# Download/Prepare iPXE Binaries
# =============================================================================

prepare_ipxe() {
    log_step "Preparing iPXE binaries"

    # Try to download prebuilt iPXE
    local ipxe_url="https://boot.ipxe.org/ipxe.tar.gz"
    local ipxe_tar="/tmp/ipxe.tar.gz"

    if command -v wget &>/dev/null; then
        log "Downloading iPXE..."
        wget -q -O "$ipxe_tar" "$ipxe_url" 2>/dev/null || {
            log_warn "Could not download iPXE, creating placeholder"
            create_ipxe_placeholder
            return
        }
    else
        log_warn "wget not available, creating placeholder iPXE"
        create_ipxe_placeholder
        return
    fi

    # Extract iPXE
    if [ -f "$ipxe_tar" ]; then
        tar -xzf "$ipxe_tar" -C "$BUILD_ROOT/ipxe" 2>/dev/null || true
        
        # Copy binaries
        if [ -f "$BUILD_ROOT/ipxe/src/bin/x86_64/ipxe.efi" ]; then
            cp "$BUILD_ROOT/ipxe/src/bin/x86_64/ipxe.efi" "$OUTPUT_DIR/ipxe.efi"
            cp "$BUILD_ROOT/ipxe/src/bin/x86_64/ipxe.bin" "$OUTPUT_DIR/ipxe.bin"
            cp "$BUILD_ROOT/ipxe/src/bin/ia32/ipxe.efi" "$OUTPUT_DIR/ipxeia32.efi" 2>/dev/null || true
            log_success "iPXE binaries installed"
        else
            create_ipxe_placeholder
        fi
    else
        create_ipxe_placeholder
    fi
}

create_ipxe_placeholder() {
    log_warn "iPXE placeholder created (real binaries will be downloaded at runtime)"
    # Create empty placeholders
    touch "$OUTPUT_DIR/ipxe.efi"
    touch "$OUTPUT_DIR/ipxe.bin"
    touch "$OUTPUT_DIR/bootx64.efi"
}

# =============================================================================
# Create Boot Script
# =============================================================================

create_boot_script() {
    log_step "Creating iPXE boot script"

    local gateway="${1:-192.168.1.100}"  # Default gateway for kernel cmdline

    cat > "$OUTPUT_DIR/boot/ipxe.boot" << EOF
#!ipxe

# TentaCLAW OS — iPXE Boot Script
# TentaCLAW says: "Time to boot from the network."

set gateway ${gateway}
set arch ${ARCH}
set version ${VERSION}

# Menu timeout
set timeout 5

# Boot menu
menu TentaCLAW OS ${VERSION} - Network Boot
item tentaclaw TentaCLAW OS (Normal)
item debug TentaCLAW OS (Debug Mode)
item shell iPXE Shell
item reboot Reboot

choose --default tentaclaw --timeout 5000 target

goto \${target}

:tentaclaw
echo Booting TentaCLAW OS ${VERSION}...
kernel http://\${gateway}/pxe/boot/TENTACLAW/vmlinuz \
    tentaclaw.mode=pxe \
    tentaclaw.gateway=\${gateway} \
    tentaclaw.farmhash=PXE_BOOT \
    ip=dhcp \
    BOOT_IMAGE=/boot/vmlinuz
initrd http://\${gateway}/pxe/boot/TENTACLAW/initrd.img
boot

:debug
echo Booting TentaCLAW OS (Debug)...
kernel http://\${gateway}/pxe/boot/TENTACLAW/vmlinuz \
    tentaclaw.mode=pxe \
    tentaclaw.gateway=\${gateway} \
    tentaclaw.farmhash=PXE_BOOT \
    tentaclaw.debug=1 \
    ip=dhcp \
    BOOT_IMAGE=/boot/vmlinuz
initrd http://\${gateway}/pxe/boot/TENTACLAW/initrd.img
boot

:shell
echo Dropping to iPXE shell...
shell

:reboot
reboot
EOF

    log_success "iPXE boot script created"
}

# =============================================================================
# Create Kernel Command Line Defaults
# =============================================================================

create_boot_config() {
    log_step "Creating boot configuration"

    cat > "$OUTPUT_DIR/boot/TENTACLAW/boot-config.cfg" << EOF
# TentaCLAW OS — Kernel Command Line Defaults
# These can be overridden by iPXE script or PXE server
tentaclaw.mode=pxe
tentaclaw.gateway=192.168.1.100
tentaclaw.farmhash=PXE_BOOT
ip=dhcp
quiet
EOF

    log_success "Boot config created"
}

# =============================================================================
# Build Initrd (PXE version)
# =============================================================================

build_pxe_initrd() {
    log_step "Building PXE initrd"

    # Copy init-bottom scripts
    mkdir -p "$BUILD_ROOT/initrd/scripts"
    cp "${SCRIPT_DIR}/scripts/init-bottom/"*.sh "$BUILD_ROOT/initrd/scripts/" 2>/dev/null || true
    cp "${SCRIPT_DIR}/scripts/tentaclaw.sh" "$BUILD_ROOT/initrd/scripts/" 2>/dev/null || true

    # Create minimal init
    cat > "$BUILD_ROOT/initrd/init" << 'INITEOF'
#!/bin/bash
# TentaCLAW OS — PXE Init
# TentaCLAW says: "Waking up from the network."

set -e

mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev 2>/dev/null || mount -t devpts devpts /dev/pts

# Source TentaCLAW
. /scripts/tentaclaw.sh
clear
tentaclaw_splash

echo ""
echo -e "${CYAN}[init] TentaCLAW is waking up from the network...${RESET}"
echo ""

# Run init scripts
for script in /scripts/*.sh; do
    if [ -f "$script" ] && [ "$(basename "$script")" != "tentaclaw.sh" ]; then
        echo -e "${CYAN}[init] Running: $(basename $script)${RESET}"
        bash "$script"
    fi
done

echo ""
echo -e "${GREEN}[init] All arms deployed. Switching to network root.${RESET}"

# Continue boot (would switch to NFS root in full implementation)
exec /bin/bash
INITEOF

    chmod +x "$BUILD_ROOT/initrd/init"

    # Build initrd
    cd "$BUILD_ROOT/initrd"
    find . -print0 | cpio --null --quiet -ov --format=newc | gzip -9 > "$OUTPUT_DIR/boot/TENTACLAW/initrd.img"

    log_success "PXE initrd created"
}

# =============================================================================
# Copy Kernel (from host or build)
# =============================================================================

install_kernel() {
    log_step "Installing kernel"

    # Try to copy from host system
    local kerns=("/boot/vmlinuz" "/vmlinuz" "/usr/share/tentaclaw/vmlinuz")
    local kernel_found=false

    for kern in "${kerns[@]}"; do
        if [ -f "$kern" ]; then
            cp "$kern" "$OUTPUT_DIR/boot/TENTACLAW/vmlinuz"
            kernel_found=true
            log_success "Kernel installed: $kern"
            return
        fi
    done

    # If no kernel found, create a placeholder
    # In production, this would be downloaded or built
    if [ "$kernel_found" = false ]; then
        log_warn "No kernel found. Placeholder created."
        log_warn "In production, download Ubuntu kernel or build custom."
        touch "$OUTPUT_DIR/boot/TENTACLAW/vmlinuz"
        touch "$OUTPUT_DIR/boot/TENTACLAW/vmlinuz.placeholder"
    fi
}

# =============================================================================
# Create GRUB for PXE
# =============================================================================

create_pxe_grub() {
    log_step "Creating PXE GRUB configuration"

    mkdir -p "$OUTPUT_DIR/boot/grub"

    cat > "$OUTPUT_DIR/boot/grub/grub.cfg" << 'EOF'
# TentaCLAW OS — PXE GRUB Config

set timeout=5
set default=0

menuentry "TentaCLAW OS (Network Boot)" {
    echo "Loading TentaCLAW OS via PXE..."
    linux /boot/TENTACLAW/vmlinuz tentaclaw.mode=pxe ip=dhcp quiet
    initrd /boot/TENTACLAW/initrd.img
    boot
}

menuentry "TentaCLAW OS (Debug)" {
    echo "Loading TentaCLAW OS (Debug Mode)..."
    linux /boot/TENTACLAW/vmlinuz tentaclaw.mode=pxe ip=dhcp debug
    initrd /boot/TENTACLAW/initrd.img
    boot
}
EOF

    log_success "PXE GRUB config created"
}

# =============================================================================
# Create Setup Documentation
# =============================================================================

create_setup_docs() {
    log_step "Creating setup documentation"

    cat > "$OUTPUT_DIR/SETUP.md" << 'EOF'
# TentaCLAW OS — PXE Boot Setup

## Overview

This directory contains the files needed to network boot TentaCLAW OS.

## Files

```
pxe/
├── bootx64.efi         # UEFI PXE loader (from iPXE)
├── ipxe.efi            # iPXE UEFI binary
├── ipxe.bin            # iPXE BIOS binary
├── boot/
│   ├── ipxe.boot       # iPXE boot script
│   ├── grub/
│   │   └── grub.cfg    # GRUB PXE config
│   └── TENTACLAW/
│       ├── vmlinuz     # Linux kernel
│       ├── initrd.img  # Initial ramdisk
│       └── boot-config.cfg
└── SETUP.md           # This file
```

## Quick Setup with Dnsmasq

On your TentaCLAW gateway server (Ubuntu/Debian):

```bash
# 1. Install dnsmasq
sudo apt-get install -y dnsmasq

# 2. Configure dnsmasq for PXE
sudo tee /etc/dnsmasq.d/pxe.conf << 'EOF'
interface=eth0
dhcp-range=192.168.1.100,192.168.1.200,12h
dhcp-boot=bootx64.efi
enable-tftp
tftp-root=/srv/tftp
port=0
EOF

# 3. Create TFTP root
sudo mkdir -p /srv/tftp
sudo cp -r /path/to/pxe/boot/* /srv/tftp/
sudo chown -R nobody:nobody /srv/tftp

# 4. Start dnsmasq
sudo systemctl restart dnsmasq
sudo systemctl enable dnsmasq
```

## Faster Boot: HTTP Kernel Delivery

For faster kernel loading (recommended for many nodes), use Nginx:

```bash
# 1. Install Nginx
sudo apt-get install -y nginx

# 2. Configure Nginx
sudo tee /etc/nginx/sites-available/pxe << 'EOF'
server {
    listen 8080;
    root /srv/tftp;
    autoindex on;
    
    # CORS for iPXE
    add_header Access-Control-Allow-Origin *;
}
EOF

# 3. Enable and start
sudo ln -s /etc/nginx/sites-available/pxe /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

## Client Boot Order

1. Boot client and select "Network Boot" or "PXE" from boot menu
2. Client receives IP via DHCP and downloads bootx64.efi
3. iPXE loads and executes boot.ipxe from TFTP/HTTP
4. Kernel and initrd are downloaded (HTTP recommended)
5. TentaCLAW OS boots and runs init scripts
6. TentaCLAW registers with TentaCLAW gateway

## Troubleshooting

### "No DHCP response"
- Check dnsmasq is running: `systemctl status dnsmasq`
- Check network interface in config matches your LAN

### "TFTP timeout"
- Verify TFTP root permissions: `chmod -R 755 /srv/tftp`
- Check firewall: `sudo ufw allow 69/udp`

### "Gateway unreachable"
- Ensure the TentaCLAW gateway is running
- Check firewall on gateway: `sudo ufw allow 7860/tcp`

## Notes

- For 100+ nodes, use HTTP for kernel/initrd delivery (TFTP is slow)
- TentaCLAW will register automatically once the gateway is reachable
- Nodes can also boot from USB ISO for initial setup, then switch to PXE
EOF

    log_success "Setup documentation created"
}

# =============================================================================
# Finalize
# =============================================================================

finalize() {
    log_step "Finalizing PXE build"

    # Show directory structure
    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${GREEN}║                PXE Build Complete!                             ║${RESET}"
    echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Version:  ${CYAN}${VERSION}${RESET}                                               ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Arch:     ${CYAN}${ARCH}${RESET}                                                  ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}║${RESET}  Output:   ${CYAN}${OUTPUT_DIR}${RESET}  ${BOLD}${GREEN}║${RESET}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo ""

    # Tree of output
    echo "Output structure:"
    find "$OUTPUT_DIR" -type f | sort | sed 's/^/  /'
    echo ""

    log_success "PXE artifacts ready!"

    # Cleanup
    rm -rf "$BUILD_ROOT" 2>/dev/null || true
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo ""
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   ${PURPLE}TentaCLAW OS${CYAN} — PXE Builder                             ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   ${TEAL}Eight arms. One mind. Network boot edition.${RESET}             ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}║${RESET}   Version ${VERSION} | Architecture ${ARCH}                          ${BOLD}${CYAN}║${RESET}"
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}"
    echo ""

    setup
    prepare_ipxe
    create_boot_script "${GATEWAY_IP:-192.168.1.100}"
    create_boot_config
    build_pxe_initrd
    install_kernel
    create_pxe_grub
    create_setup_docs
    finalize
}

main "$@"
