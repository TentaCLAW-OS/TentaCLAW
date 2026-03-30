# Proxmox Integration Guide

TentaCLAW OS runs great on Proxmox — LXC containers or VMs with GPU passthrough.

## Recommended: LXC Containers

LXC is the simplest way to run TentaCLAW nodes on Proxmox. No GPU passthrough needed for the gateway, and agents work in privileged containers.

### Gateway Container

```bash
# Create container
pct create 100 local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst \
  --hostname tentaclaw-gw \
  --cores 4 --memory 4096 --swap 512 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 0 \
  --features nesting=1

# Start and install
pct start 100
pct exec 100 -- bash -c "curl -fsSL tentaclaw.io/install | bash"
```

### Agent Container (with GPU)

For GPU passthrough in LXC, you need privileged containers:

```bash
# Create privileged container
pct create 101 local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst \
  --hostname tentaclaw-gpu01 \
  --cores 8 --memory 16384 --swap 1024 \
  --rootfs local-lvm:32 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 0 \
  --features nesting=1
```

Add GPU passthrough to the container config:
```bash
# Edit /etc/pve/lxc/101.conf
# Add:
lxc.cgroup2.devices.allow: c 195:* rwm
lxc.cgroup2.devices.allow: c 509:* rwm
lxc.mount.entry: /dev/nvidia0 dev/nvidia0 none bind,optional,create=file
lxc.mount.entry: /dev/nvidiactl dev/nvidiactl none bind,optional,create=file
lxc.mount.entry: /dev/nvidia-uvm dev/nvidia-uvm none bind,optional,create=file
lxc.mount.entry: /dev/nvidia-uvm-tools dev/nvidia-uvm-tools none bind,optional,create=file
```

For AMD GPUs:
```bash
lxc.cgroup2.devices.allow: c 226:* rwm
lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir
lxc.mount.entry: /dev/kfd dev/kfd none bind,optional,create=file
```

### Start the agent

```bash
pct start 101
pct exec 101 -- bash -c "
  curl -fsSL tentaclaw.io/install | bash
  export TENTACLAW_GATEWAY_URL=http://192.168.1.X:8080
  cd ~/TentaCLAW/agent && npm start
"
```

## VM with GPU Passthrough

For full GPU passthrough (better isolation):

1. **IOMMU setup** in BIOS + Proxmox:
```bash
# /etc/default/grub
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt"
# or for AMD:
GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt"
```

2. **Create VM** with GPU passthrough in Proxmox UI
3. **Flash TentaCLAW ISO** or install Ubuntu + agent

## Tips

- **LXC is simpler** — no IOMMU/VFIO needed, lower overhead
- **VMs are more isolated** — better for untrusted workloads
- Use **privileged containers** for GPU access
- Keep **gateway and agents on the same VLAN** for auto-discovery
- Set **static IPs** or use `TENTACLAW_GATEWAY_URL` env var

## Example: 4-Node Proxmox Cluster

| Container | Role | GPUs | Memory |
|-----------|------|------|--------|
| CT 100 | Gateway | 0 | 4 GB |
| CT 101 | GPU Agent | 2x RTX 3090 | 32 GB |
| CT 102 | GPU Agent | 1x RX 7900 | 16 GB |
| CT 103 | CPU Agent (BitNet) | 0 | 8 GB |

---

*CLAWtopus says: "Proxmox + TentaCLAW = unlimited tentacles."*
