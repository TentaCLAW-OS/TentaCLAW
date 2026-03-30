# AMD GPU Guide

TentaCLAW OS supports AMD GPUs from Polaris (RX 400/500) through RDNA3 (RX 7000).

## Supported GPU Families

| Family | GPUs | Compute | ROCm | Notes |
|--------|------|---------|------|-------|
| **RDNA3** (GFX11) | RX 7900 XTX/XT, 7800 XT, 7700 XT, 7600 | ROCm | Yes | Full support |
| **RDNA2** (GFX10.3) | RX 6900 XT, 6800 XT/6800, 6700 XT, 6600 | ROCm | Yes | Full support |
| **RDNA1** (GFX10.1) | RX 5700 XT, 5600 XT | Vulkan | No | Ollama via Vulkan |
| **Vega** (GFX9) | Vega 56/64, VII | Vulkan | Partial | VII works with ROCm |
| **Polaris** (GFX8) | RX 580/570/480 | Vulkan | No | Ollama via Vulkan |

## How It Works

TentaCLAW auto-detects your AMD GPU architecture and selects the best compute backend:

1. **Agent starts** → detects AMD GPU via `lspci` or `/sys/class/drm`
2. **Architecture detection** → maps GPU name to architecture family
3. **Backend selection**:
   - RDNA2+ → ROCm (if installed) → sets `HSA_OVERRIDE_GFX_VERSION`
   - RDNA1 and older → Vulkan → configures Ollama for Vulkan backend
4. **Stats collection** → reads temperature, VRAM, utilization from sysfs hwmon

## Environment Variables

TentaCLAW auto-sets these per GPU:

| Variable | Purpose | Example |
|----------|---------|---------|
| `HSA_OVERRIDE_GFX_VERSION` | Tell ROCm which GFX version to target | `10.3.0` for RDNA2 |
| `HIP_VISIBLE_DEVICES` | Limit which GPUs ROCm sees | `0` |
| `OLLAMA_LLM_LIBRARY` | Force Ollama backend | `rocm` or `vulkan` |

## ROCm Installation

For RDNA2+ GPUs:
```bash
# Ubuntu/Debian
wget https://repo.radeon.com/amdgpu-install/latest/ubuntu/focal/amdgpu-install_latest_all.deb
sudo apt install ./amdgpu-install_latest_all.deb
sudo amdgpu-install --usecase=rocm

# Verify
rocm-smi
```

## Troubleshooting

### "ROCm not detected" on RDNA2+ GPU
- Install ROCm: `amdgpu-install --usecase=rocm`
- TentaCLAW will fall back to Vulkan automatically

### Ollama not using AMD GPU
- Check: `OLLAMA_LLM_LIBRARY` is set
- Check: `HSA_OVERRIDE_GFX_VERSION` matches your GPU
- Run: `clawtopus backends` to see what backend each node uses

### Low VRAM reported
- AMD VRAM is read from sysfs: `/sys/class/drm/card0/device/mem_info_vram_total`
- If 0, your GPU driver may not expose this info

### Performance tips
- RDNA3 GPUs get best performance with ROCm 6.x+
- Set power profile: `echo high > /sys/class/drm/card0/device/power_dpm_force_performance_level`

---

*CLAWtopus says: "Red team, green team — I manage them all."*
