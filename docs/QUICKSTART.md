# TentaCLAW OS — Quick Start Guide

> **AI inference cluster OS**

## TL;DR

1. Download ISO
2. Flash to USB
3. Boot
4. Join the cluster
5. Deploy a model

---

## 1. Download the ISO

Get the latest release from:
```
https://github.com/TentaCLAW-OS/TentaCLAW-OS/releases
```

Or build it yourself:

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW-OS.git
cd TentaCLAW-OS
make deps    # Install build dependencies (Ubuntu/Debian)
make iso     # Build the ISO
```

---

## 2. Flash to USB

```bash
# Find your USB device
lsblk

# Flash (replace /dev/sdX with your device)
sudo dd if=TentaCLAW-OS-0.1.0-amd64.iso of=/dev/sdX bs=4M status=progress
```

**WARNING**: This will erase everything on the USB drive!

---

## 3. Boot

1. Insert USB into your inference node
2. Power on
3. Select USB boot from BIOS/UEFI boot menu (usually F12, F2, or Del)
4. Watch CLAWtopus do her thing

---

## 4. First Boot

On first boot, you'll see:

```
[CLAWtopus ASCII art]

GPU Detection:
✓ Found 2x NVIDIA GeForce RTX 3090

Network:
✓ DHCP OK
✓ Gateway: 192.168.1.100

Registration:
✓ Farm Hash generated: FARM7K3P9
✓ Node ID: TENTACLAW-FARM7K3P9-abc123
```

**Write down the Farm Hash!** You'll need it to add this node to your dashboard.

---

## 5. Add Node to HiveMind Gateway

On your HiveMind gateway server:

```bash
# Check gateway logs for new node registrations
tail -f /var/log/tentaclaw/gateway.log

# Or use the CLI
tentaclaw nodes
```

Enter the Farm Hash in your dashboard to claim the node.

---

## 6. Deploy Your First Model

```bash
# Via CLI
tentaclaw deploy hermes3:latest

# Or via API
curl -X POST http://localhost:8080/api/v1/deploy \
  -H "Content-Type: application/json" \
  -d '{"model": "hermes3:latest"}'
```

---

## Network Boot (PXE)

For network boot, set up a PXE server:

```bash
# On your gateway/HiveMind server
cd /path/to/pxe-artifacts
sudo ./setup-pxe.sh
```

See [SETUP.md](./SETUP.md) for detailed PXE setup.

---

## Troubleshooting

### "No GPU detected"
- Check `lspci | grep -i vga`
- NVIDIA: `nvidia-smi`
- AMD: `rocm-smi`

### "Network failed"
- Check ethernet cable
- Try static IP: `tentaclaw.gateway=192.168.1.100 ip=192.168.1.50::192.168.1.1:255.255.255.0`

### "Gateway unreachable"
- Ensure HiveMind gateway is running
- Check firewall: `sudo ufw allow 7860/tcp`

### "Registration failed"
- Node will operate in standalone mode
- Stats will queue until gateway is available

---

## Getting Help

- GitHub Issues: https://github.com/TentaCLAW-OS/TentaCLAW-OS/issues
- Discord: https://discord.gg/tentaclaw (The Tank)
- r/selfhosted: https://reddit.com/r/selfhosted

---

## CLAWtopus says:

> *"Eight arms. One mind. Let's run some local AI."*
