/**
 * AMD GPU Detection & Management
 * TentaCLAW says: "Red team? I've got arms for that."
 *
 * Consolidated AMD GPU functionality for TentaCLAW agent nodes:
 *   - Architecture detection with fuzzy matching
 *   - sysfs-based GPU stats (VRAM, temp, clocks, power, fan)
 *   - ROCm / Vulkan compute backend selection
 *   - HSA_OVERRIDE_GFX_VERSION configuration
 *   - Driver version detection
 */

import * as fs from 'fs';
import { execSync } from 'child_process';

// =============================================================================
// Types
// =============================================================================

/** GPU statistics — compatible with the GpuStats interface in index.ts */
export interface GpuStats {
    busId: string;
    name: string;
    vramTotalMb: number;
    vramUsedMb: number;
    temperatureC: number;
    utilizationPct: number;
    powerDrawW: number;
    fanSpeedPct: number;
    clockSmMhz: number;
    clockMemMhz: number;
}

export type AmdArch = 'rdna3' | 'rdna2' | 'rdna1' | 'vega' | 'polaris' | 'fiji' | 'unknown';
export type AmdComputeBackend = 'rocm' | 'vulkan' | 'sysfs-only';

export interface AmdGpuInfo {
    arch: AmdArch;
    compute: AmdComputeBackend;
    gfxVersion: string;
    rocmSupported: boolean;
    hsaOverride?: string;
}

// =============================================================================
// AMD GPU Architecture Map
// =============================================================================

/**
 * Maps device name substrings (lowercased) to architecture families.
 * Order matters for fuzzy matching: more specific patterns should come first
 * within each generation to avoid false matches.
 */
export const AMD_GPU_ARCH_MAP: Record<string, {
    arch: AmdArch;
    gfxVersion: string;
    compute: 'rocm' | 'vulkan';
    rocmSupported: boolean;
    hsaOverride?: string;
}> = {
    // -------------------------------------------------------------------------
    // RDNA 3 (GFX11) -- full ROCm support
    // -------------------------------------------------------------------------
    'RX 7900 XTX':  { arch: 'rdna3', gfxVersion: 'gfx1100', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7900 XT':   { arch: 'rdna3', gfxVersion: 'gfx1100', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7900 GRE':  { arch: 'rdna3', gfxVersion: 'gfx1100', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7900':      { arch: 'rdna3', gfxVersion: 'gfx1100', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7800 XT':   { arch: 'rdna3', gfxVersion: 'gfx1101', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7800':      { arch: 'rdna3', gfxVersion: 'gfx1101', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7700 XT':   { arch: 'rdna3', gfxVersion: 'gfx1101', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7700':      { arch: 'rdna3', gfxVersion: 'gfx1101', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7600 XT':   { arch: 'rdna3', gfxVersion: 'gfx1102', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'RX 7600':      { arch: 'rdna3', gfxVersion: 'gfx1102', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },
    'navi 3':       { arch: 'rdna3', gfxVersion: 'gfx1100', compute: 'rocm', rocmSupported: true, hsaOverride: '11.0.0' },

    // -------------------------------------------------------------------------
    // RDNA 2 (GFX10.3) -- ROCm supported
    // -------------------------------------------------------------------------
    'RX 6950 XT':   { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6900 XT':   { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6900':      { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6800 XT':   { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6800':      { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6750 XT':   { arch: 'rdna2', gfxVersion: 'gfx1031', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6700 XT':   { arch: 'rdna2', gfxVersion: 'gfx1031', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6700':      { arch: 'rdna2', gfxVersion: 'gfx1031', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6650 XT':   { arch: 'rdna2', gfxVersion: 'gfx1032', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6600 XT':   { arch: 'rdna2', gfxVersion: 'gfx1032', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6600':      { arch: 'rdna2', gfxVersion: 'gfx1032', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6500 XT':   { arch: 'rdna2', gfxVersion: 'gfx1034', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'RX 6500':      { arch: 'rdna2', gfxVersion: 'gfx1034', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },
    'navi 2':       { arch: 'rdna2', gfxVersion: 'gfx1030', compute: 'rocm', rocmSupported: true, hsaOverride: '10.3.0' },

    // -------------------------------------------------------------------------
    // RDNA 1 (GFX10.1) -- Vulkan only (ROCm does NOT reliably support RDNA1)
    // -------------------------------------------------------------------------
    'RX 5700 XT':   { arch: 'rdna1', gfxVersion: 'gfx1010', compute: 'vulkan', rocmSupported: false },
    'RX 5700':      { arch: 'rdna1', gfxVersion: 'gfx1010', compute: 'vulkan', rocmSupported: false },
    'RX 5600 XT':   { arch: 'rdna1', gfxVersion: 'gfx1010', compute: 'vulkan', rocmSupported: false },
    'RX 5600':      { arch: 'rdna1', gfxVersion: 'gfx1010', compute: 'vulkan', rocmSupported: false },
    'RX 5500 XT':   { arch: 'rdna1', gfxVersion: 'gfx1012', compute: 'vulkan', rocmSupported: false },
    'RX 5500':      { arch: 'rdna1', gfxVersion: 'gfx1012', compute: 'vulkan', rocmSupported: false },
    'navi 1':       { arch: 'rdna1', gfxVersion: 'gfx1010', compute: 'vulkan', rocmSupported: false },

    // -------------------------------------------------------------------------
    // Vega (GFX9) -- Vulkan preferred, ROCm possible but flaky on consumer cards
    // -------------------------------------------------------------------------
    'Radeon VII':       { arch: 'vega', gfxVersion: 'gfx906', compute: 'vulkan', rocmSupported: true,  hsaOverride: '9.0.6' },
    'Vega Frontier':    { arch: 'vega', gfxVersion: 'gfx900', compute: 'vulkan', rocmSupported: false },
    'Vega 64':          { arch: 'vega', gfxVersion: 'gfx900', compute: 'vulkan', rocmSupported: false },
    'Vega 56':          { arch: 'vega', gfxVersion: 'gfx900', compute: 'vulkan', rocmSupported: false },
    'vega 20':          { arch: 'vega', gfxVersion: 'gfx906', compute: 'vulkan', rocmSupported: true,  hsaOverride: '9.0.6' },
    'vega 10':          { arch: 'vega', gfxVersion: 'gfx900', compute: 'vulkan', rocmSupported: false },
    'vega':             { arch: 'vega', gfxVersion: 'gfx900', compute: 'vulkan', rocmSupported: false },
    'Instinct MI':      { arch: 'vega', gfxVersion: 'gfx906', compute: 'rocm',   rocmSupported: true,  hsaOverride: '9.0.6' },

    // -------------------------------------------------------------------------
    // Polaris (GFX8) -- NO ROCm, Vulkan only
    // -------------------------------------------------------------------------
    'RX 590':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 580':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 570':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 560':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 550':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 480':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'RX 470':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'WX 7100':  { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'WX 5100':  { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'ellesmere':{ arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'baffin':   { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'polaris':  { arch: 'polaris', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },

    // -------------------------------------------------------------------------
    // Fiji (GFX8) -- NO ROCm, Vulkan only
    // -------------------------------------------------------------------------
    'Fury X':   { arch: 'fiji', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'Fury':     { arch: 'fiji', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'Nano':     { arch: 'fiji', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
    'fiji':     { arch: 'fiji', gfxVersion: 'gfx803', compute: 'vulkan', rocmSupported: false },
};

// =============================================================================
// GPU Detection (lspci + sysfs)
// =============================================================================

/**
 * Detect all AMD GPUs in the system via lspci and /sys/class/drm.
 *
 * Returns an array of discovered GPUs with PCI bus IDs, human-readable names,
 * and vendor string. Works on Linux only (requires sysfs or lspci).
 */
export function detectAmdGpus(): Array<{ busId: string; name: string; vendor: string }> {
    const gpus: Array<{ busId: string; name: string; vendor: string }> = [];

    // Strategy 1: Parse lspci for AMD/Radeon VGA/3D controllers
    try {
        const lspci = execSync('lspci -nn 2>/dev/null', { encoding: 'utf-8' });
        const lines = lspci.split('\n');
        for (const line of lines) {
            const lower = line.toLowerCase();
            if ((lower.includes('vga') || lower.includes('3d') || lower.includes('display'))
                && (lower.includes('amd') || lower.includes('radeon') || lower.includes('advanced micro'))) {
                // Format: "06:00.0 VGA compatible controller [0300]: Advanced Micro ..."
                const busMatch = line.match(/^([0-9a-f:.]+)\s/i);
                const nameMatch = line.match(/:\s+(.+?)(?:\s+\[[\da-f:]+\])?$/i);
                const busId = busMatch ? busMatch[1] : 'unknown';
                const name = nameMatch ? nameMatch[1].replace(/\(rev.*\)/, '').trim() : 'AMD GPU';
                gpus.push({ busId, name, vendor: 'AMD' });
            }
        }
        if (gpus.length > 0) return gpus;
    } catch { /* lspci not available, fall through to sysfs */ }

    // Strategy 2: Walk /sys/class/drm/card*/device/ for amdgpu-driven cards
    try {
        const cards = fs.readdirSync('/sys/class/drm').filter(d => /^card\d+$/.test(d));
        for (const card of cards) {
            const base = `/sys/class/drm/${card}/device`;
            // Only pick up cards driven by amdgpu (gpu_busy_percent exists)
            if (!fs.existsSync(`${base}/gpu_busy_percent`)) continue;

            let name = 'AMD GPU';
            let busId = card;
            try {
                const uevent = fs.readFileSync(`${base}/uevent`, 'utf-8');
                const slotMatch = uevent.match(/PCI_SLOT_NAME=(.*)/);
                if (slotMatch) {
                    busId = slotMatch[1];
                    try {
                        const lspciOut = execSync(`lspci -s ${busId} 2>/dev/null`, { encoding: 'utf-8' });
                        const m = lspciOut.match(/:\s+(.*)/);
                        if (m) name = m[1].replace(/\(rev.*\)/, '').trim();
                    } catch { /* keep generic name */ }
                }
            } catch { /* keep defaults */ }

            gpus.push({ busId, name, vendor: 'AMD' });
        }
    } catch { /* sysfs not available */ }

    return gpus;
}

// =============================================================================
// Architecture Detection
// =============================================================================

/**
 * Detect AMD GPU architecture from its name string using fuzzy matching
 * against AMD_GPU_ARCH_MAP.
 *
 * Matching strategy:
 *   1. Case-insensitive substring search against all map keys
 *   2. Prefer longer (more specific) matches over shorter ones
 *   3. Fall back to sysfs revision probing for unknown GPUs
 */
export function detectAmdArch(gpuName: string): AmdGpuInfo {
    const lower = gpuName.toLowerCase();

    // Find all matching entries, then pick the most specific (longest key match)
    let bestMatch: { key: string; entry: (typeof AMD_GPU_ARCH_MAP)[string] } | null = null;

    for (const [pattern, entry] of Object.entries(AMD_GPU_ARCH_MAP)) {
        if (lower.includes(pattern.toLowerCase())) {
            if (!bestMatch || pattern.length > bestMatch.key.length) {
                bestMatch = { key: pattern, entry };
            }
        }
    }

    if (bestMatch) {
        const entry = bestMatch.entry;

        // For architectures where ROCm is listed but may not be installed,
        // downgrade compute backend if ROCm binaries are absent
        let compute: AmdComputeBackend = entry.compute;
        if (compute === 'rocm' && !isRocmAvailable()) {
            compute = 'vulkan';
        }

        return {
            arch: entry.arch,
            compute,
            gfxVersion: entry.gfxVersion,
            rocmSupported: entry.rocmSupported,
            hsaOverride: entry.hsaOverride,
        };
    }

    // Unknown AMD GPU -- probe sysfs for any amdgpu-driven card
    try {
        const cards = fs.readdirSync('/sys/class/drm').filter(d => /^card\d+$/.test(d));
        for (const card of cards) {
            const revPath = `/sys/class/drm/${card}/device/revision`;
            if (fs.existsSync(revPath)) {
                // amdgpu driver is loaded -- sysfs stats will work even if arch is unknown
                return { arch: 'unknown', compute: 'sysfs-only', gfxVersion: 'unknown', rocmSupported: false };
            }
        }
    } catch { /* no sysfs */ }

    return { arch: 'unknown', compute: 'sysfs-only', gfxVersion: 'unknown', rocmSupported: false };
}

// =============================================================================
// GPU Stats (sysfs hwmon)
// =============================================================================

/**
 * Read GPU statistics from sysfs hwmon for AMD GPUs.
 *
 * @param busId  Optional PCI bus ID to filter (e.g. "06:00.0"). If omitted,
 *               returns stats for ALL AMD GPUs detected via sysfs.
 */
export function getAmdGpuStats(busId?: string): GpuStats[] {
    const gpus: GpuStats[] = [];

    try {
        const cards = fs.readdirSync('/sys/class/drm').filter(d => /^card\d+$/.test(d));
        for (const card of cards) {
            const base = `/sys/class/drm/${card}/device`;
            if (!fs.existsSync(`${base}/gpu_busy_percent`)) continue;

            const readSysfs = (file: string): string => {
                try { return fs.readFileSync(`${base}/${file}`, 'utf-8').trim(); } catch { return ''; }
            };

            // Check bus ID filter
            const uevent = readSysfs('uevent');
            const pciSlot = uevent.match(/PCI_SLOT_NAME=(.*)/)?.[1] || card;
            if (busId && pciSlot !== busId) continue;

            // GPU name from lspci
            let name = 'AMD GPU';
            try {
                if (pciSlot && pciSlot !== card) {
                    const lspciOut = execSync(`lspci -s ${pciSlot} 2>/dev/null`, { encoding: 'utf-8' });
                    const match = lspciOut.match(/:\s+(.*)/);
                    if (match) name = match[1].replace(/\(rev.*\)/, '').trim();
                }
            } catch { /* keep generic name */ }

            // Detect architecture and log once per detection cycle
            const archInfo = detectAmdArch(name);
            if (gpus.length === 0) {
                console.log(
                    `[amd] arch: ${archInfo.arch} (${archInfo.gfxVersion}) -> compute: ${archInfo.compute}` +
                    (archInfo.rocmSupported ? '' : ` (ROCm NOT supported -- using ${archInfo.compute})`)
                );
            }

            // VRAM from mem_info_vram_total / mem_info_vram_used (bytes)
            let vramTotal = 0;
            let vramUsed = 0;
            try {
                vramTotal = Math.round(parseInt(readSysfs('mem_info_vram_total')) / 1048576);
                vramUsed = Math.round(parseInt(readSysfs('mem_info_vram_used')) / 1048576);
            } catch { /* VRAM info not available */ }

            // Temperature from hwmon (millidegrees C)
            let temp = 0;
            try {
                const hwmonDir = resolveHwmonDir(base);
                if (hwmonDir) {
                    const tempStr = fs.readFileSync(`${hwmonDir}/temp1_input`, 'utf-8').trim();
                    temp = Math.round(parseInt(tempStr) / 1000);
                }
            } catch { /* temp not available */ }

            // GPU utilization (0-100)
            const util = parseInt(readSysfs('gpu_busy_percent')) || 0;

            // Power draw from hwmon (microwatts -> watts)
            let power = 0;
            try {
                const hwmonDir = resolveHwmonDir(base);
                if (hwmonDir) {
                    const powerStr = fs.readFileSync(`${hwmonDir}/power1_average`, 'utf-8').trim();
                    power = Math.round(parseInt(powerStr) / 1_000_000);
                }
            } catch { /* power info not available */ }

            // Fan speed from hwmon (PWM 0-255 -> percentage)
            let fan = 0;
            try {
                const hwmonDir = resolveHwmonDir(base);
                if (hwmonDir) {
                    const pwm = parseInt(fs.readFileSync(`${hwmonDir}/pwm1`, 'utf-8').trim());
                    fan = Math.round((pwm / 255) * 100);
                }
            } catch { /* fan info not available */ }

            // GPU / Memory clocks from pp_dpm_sclk / pp_dpm_mclk
            // The active clock line is marked with '*'
            let clockGfx = 0;
            let clockMem = 0;
            try {
                const gfxClk = readSysfs('pp_dpm_sclk');
                const activeLine = gfxClk.split('\n').find(l => l.includes('*'));
                if (activeLine) {
                    clockGfx = parseInt(activeLine.match(/(\d+)\s*Mhz/i)?.[1] || '0');
                }
            } catch { /* clock info not available */ }
            try {
                const memClk = readSysfs('pp_dpm_mclk');
                const activeLine = memClk.split('\n').find(l => l.includes('*'));
                if (activeLine) {
                    clockMem = parseInt(activeLine.match(/(\d+)\s*Mhz/i)?.[1] || '0');
                }
            } catch { /* clock info not available */ }

            gpus.push({
                busId: pciSlot,
                name,
                vramTotalMb: vramTotal,
                vramUsedMb: vramUsed,
                temperatureC: temp,
                utilizationPct: util,
                powerDrawW: power,
                fanSpeedPct: fan,
                clockSmMhz: clockGfx,
                clockMemMhz: clockMem,
            });
        }
    } catch (err) {
        console.error('[amd] GPU stats detection error: ' + err);
    }

    return gpus;
}

// =============================================================================
// Compute Configuration
// =============================================================================

/**
 * Configure environment variables for AMD GPU compute compatibility.
 *
 * Sets HSA_OVERRIDE_GFX_VERSION and related env vars so that ROCm-based
 * inference backends (Ollama, vLLM, llama.cpp) can see the GPU correctly.
 *
 * For Polaris/Fiji GPUs that cannot run ROCm, sets OLLAMA_LLM_LIBRARY=cpu
 * as a safe fallback and logs a message about installing Vulkan drivers.
 */
export function configureAmdCompute(gpuName: string): void {
    const archInfo = detectAmdArch(gpuName);

    switch (archInfo.arch) {
        case 'polaris':
        case 'fiji':
            // GFX8: ROCm is not supported at all. CPU fallback + Vulkan recommendation.
            process.env['OLLAMA_LLM_LIBRARY'] = 'cpu';
            console.log('[amd] Polaris/Fiji detected -- ROCm disabled, using CPU/Vulkan fallback');
            console.log('[amd] For GPU acceleration, install Vulkan: sudo apt install mesa-vulkan-drivers');
            break;

        case 'vega':
            // GFX9: ROCm works on some cards (Radeon VII, MI25) if installed
            process.env['HSA_OVERRIDE_GFX_VERSION'] = archInfo.hsaOverride || '9.0.0';
            process.env['HIP_VISIBLE_DEVICES'] = '0';
            console.log(`[amd] Vega detected -- set HSA_OVERRIDE_GFX_VERSION=${archInfo.hsaOverride || '9.0.0'}`);
            break;

        case 'rdna1':
            // GFX10.1: ROCm is hit-or-miss, but set the override in case it helps
            process.env['HSA_OVERRIDE_GFX_VERSION'] = '10.1.0';
            console.log('[amd] RDNA1 detected -- set HSA_OVERRIDE_GFX_VERSION=10.1.0');
            break;

        case 'rdna2':
            // GFX10.3: Native ROCm support; override for compatibility with edge cases
            process.env['HSA_OVERRIDE_GFX_VERSION'] = archInfo.hsaOverride || '10.3.0';
            console.log(`[amd] RDNA2 detected -- set HSA_OVERRIDE_GFX_VERSION=${archInfo.hsaOverride || '10.3.0'}`);
            break;

        case 'rdna3':
            // GFX11: Full native ROCm. Override only if hsaOverride is specified (some
            // specific gfx1101/gfx1102 chips still benefit from it).
            if (archInfo.hsaOverride) {
                process.env['HSA_OVERRIDE_GFX_VERSION'] = archInfo.hsaOverride;
                console.log(`[amd] RDNA3 detected -- set HSA_OVERRIDE_GFX_VERSION=${archInfo.hsaOverride}`);
            } else {
                console.log('[amd] RDNA3 detected -- native ROCm support');
            }
            break;

        default:
            console.log(`[amd] Unknown arch "${archInfo.arch}" -- no HSA override set`);
            break;
    }
}

// =============================================================================
// ROCm & Driver Utilities
// =============================================================================

/**
 * Check whether ROCm is available on this system by probing for the
 * rocm-smi binary and /opt/rocm directory.
 */
export function isRocmAvailable(): boolean {
    // Check for rocm-smi in PATH
    try {
        execSync('which rocm-smi 2>/dev/null', { encoding: 'utf-8' });
        return true;
    } catch { /* not in PATH */ }

    // Check well-known paths
    if (fs.existsSync('/usr/bin/rocm-smi')) return true;
    if (fs.existsSync('/opt/rocm/bin/rocm-smi')) return true;
    if (fs.existsSync('/opt/rocm')) return true;

    return false;
}

/**
 * Read the AMD GPU kernel driver version from sysfs.
 *
 * Tries multiple sources:
 *   1. /sys/module/amdgpu/version  (most direct)
 *   2. modinfo amdgpu              (works if module is loaded)
 *   3. /proc/driver/amdgpu/version (some kernels)
 *
 * Returns null if the driver version cannot be determined.
 */
export function getAmdDriverVersion(): string | null {
    // Source 1: sysfs module version
    try {
        const version = fs.readFileSync('/sys/module/amdgpu/version', 'utf-8').trim();
        if (version) return version;
    } catch { /* not available */ }

    // Source 2: modinfo
    try {
        const modinfo = execSync('modinfo amdgpu 2>/dev/null', { encoding: 'utf-8' });
        const match = modinfo.match(/^version:\s+(.+)$/m);
        if (match) return match[1].trim();
    } catch { /* modinfo not available */ }

    // Source 3: /proc/driver
    try {
        const version = fs.readFileSync('/proc/driver/amdgpu/version', 'utf-8').trim();
        if (version) return version;
    } catch { /* not available */ }

    return null;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Resolve the first hwmon directory under a sysfs device path.
 * Returns the full path (e.g. "/sys/class/drm/card0/device/hwmon/hwmon3")
 * or null if none exists.
 */
function resolveHwmonDir(deviceBase: string): string | null {
    try {
        const hwmonEntries = fs.readdirSync(`${deviceBase}/hwmon`);
        if (hwmonEntries.length > 0) {
            return `${deviceBase}/hwmon/${hwmonEntries[0]}`;
        }
    } catch { /* no hwmon directory */ }
    return null;
}
