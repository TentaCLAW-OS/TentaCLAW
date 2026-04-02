/**
 * Apple Silicon Detection & Management
 * TentaCLAW says: "Apple arms? I've got eight of my own."
 *
 * Consolidated Apple Silicon functionality for TentaCLAW agent nodes:
 *   - Chip detection (M1/M2/M3/M4 and Pro/Max/Ultra variants)
 *   - Metal GPU capability detection
 *   - Unified memory usage
 *   - Thermal state monitoring
 *   - Power metrics (wattage, battery)
 *   - Model sizing recommendations
 *   - Ollama Metal compatibility
 *
 * Zero external dependencies — macOS-only (gracefully returns null on other platforms).
 */

import { execFileSync } from 'child_process';
import os from 'os';

// =============================================================================
// Types
// =============================================================================

export interface AppleSiliconInfo {
    chip: string;                // 'M1', 'M2', 'M3', 'M4', 'M1 Pro', 'M2 Max', etc.
    cores_performance: number;
    cores_efficiency: number;
    cores_gpu: number;
    unified_memory_gb: number;
    metal_supported: boolean;
    neural_engine_cores: number;
}

export interface MacGpuInfo {
    name: string;
    metal_family: string;
    vram_mb: number;
    vendor: string;
}

export interface UnifiedMemoryUsage {
    total_mb: number;
    used_mb: number;
    available_mb: number;
}

export interface PowerMetrics {
    cpu_watts: number;
    gpu_watts: number;
    total_watts: number;
    battery_pct?: number;
    charging?: boolean;
}

export interface RecommendedModel {
    model: string;
    fits: boolean;
    expected_toks: number;
}

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

// =============================================================================
// Helpers
// =============================================================================

/** Run a command and return trimmed stdout, or null on failure. */
function runCmd(cmd: string, args: string[], timeoutMs: number = 10_000): string | null {
    try {
        return execFileSync(cmd, args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
        }).trim();
    } catch {
        return null;
    }
}

/** Read a sysctl value by key. Returns null if unavailable or not on macOS. */
function sysctl(key: string): string | null {
    return runCmd('sysctl', ['-n', key], 5_000);
}

/** Safe parseInt with fallback. */
function safeInt(s: string | null | undefined, fallback: number = 0): number {
    if (s == null) return fallback;
    const v = parseInt(s, 10);
    return isNaN(v) ? fallback : v;
}

/** Safe parseFloat with fallback. */
function safeFloat(s: string | null | undefined, fallback: number = 0): number {
    if (s == null) return fallback;
    const v = parseFloat(s);
    return isNaN(v) ? fallback : v;
}

// =============================================================================
// Chip Database — core counts and Neural Engine specs by chip variant
// =============================================================================

/**
 * Known Apple Silicon configurations.
 *
 * Maps chip name substrings (matched case-insensitively from the brand string)
 * to their hardware specs. Order matters: more specific patterns come first so
 * "M2 Ultra" matches before "M2".
 */
const CHIP_SPECS: Array<{
    pattern: string;
    chip: string;
    perf_cores: number;
    eff_cores: number;
    gpu_cores: number;
    neural_engine_cores: number;
}> = [
    // M4 family
    { pattern: 'M4 Ultra',  chip: 'M4 Ultra',  perf_cores: 16, eff_cores: 16, gpu_cores: 80, neural_engine_cores: 32 },
    { pattern: 'M4 Max',    chip: 'M4 Max',    perf_cores: 14, eff_cores: 10, gpu_cores: 40, neural_engine_cores: 16 },
    { pattern: 'M4 Pro',    chip: 'M4 Pro',    perf_cores: 10, eff_cores:  4, gpu_cores: 20, neural_engine_cores: 16 },
    { pattern: 'M4',        chip: 'M4',        perf_cores:  4, eff_cores:  6, gpu_cores: 10, neural_engine_cores: 16 },

    // M3 family
    { pattern: 'M3 Ultra',  chip: 'M3 Ultra',  perf_cores: 16, eff_cores: 16, gpu_cores: 76, neural_engine_cores: 32 },
    { pattern: 'M3 Max',    chip: 'M3 Max',    perf_cores: 12, eff_cores:  4, gpu_cores: 40, neural_engine_cores: 16 },
    { pattern: 'M3 Pro',    chip: 'M3 Pro',    perf_cores:  6, eff_cores:  6, gpu_cores: 18, neural_engine_cores: 16 },
    { pattern: 'M3',        chip: 'M3',        perf_cores:  4, eff_cores:  4, gpu_cores: 10, neural_engine_cores: 16 },

    // M2 family
    { pattern: 'M2 Ultra',  chip: 'M2 Ultra',  perf_cores: 16, eff_cores:  8, gpu_cores: 76, neural_engine_cores: 32 },
    { pattern: 'M2 Max',    chip: 'M2 Max',    perf_cores:  8, eff_cores:  4, gpu_cores: 38, neural_engine_cores: 16 },
    { pattern: 'M2 Pro',    chip: 'M2 Pro',    perf_cores:  8, eff_cores:  4, gpu_cores: 19, neural_engine_cores: 16 },
    { pattern: 'M2',        chip: 'M2',        perf_cores:  4, eff_cores:  4, gpu_cores: 10, neural_engine_cores: 16 },

    // M1 family
    { pattern: 'M1 Ultra',  chip: 'M1 Ultra',  perf_cores: 16, eff_cores:  4, gpu_cores: 64, neural_engine_cores: 32 },
    { pattern: 'M1 Max',    chip: 'M1 Max',    perf_cores:  8, eff_cores:  2, gpu_cores: 32, neural_engine_cores: 16 },
    { pattern: 'M1 Pro',    chip: 'M1 Pro',    perf_cores:  8, eff_cores:  2, gpu_cores: 16, neural_engine_cores: 16 },
    { pattern: 'M1',        chip: 'M1',        perf_cores:  4, eff_cores:  4, gpu_cores:  8, neural_engine_cores: 16 },
];

// =============================================================================
// Detection
// =============================================================================

/**
 * Detect if running on Apple Silicon.
 *
 * Checks platform (darwin) and architecture (arm64). Intel Macs return false.
 */
export function isAppleSilicon(): boolean {
    return process.platform === 'darwin' && process.arch === 'arm64';
}

/**
 * Get Apple Silicon chip info.
 *
 * Uses sysctl to read the CPU brand string and memory size, then maps
 * the chip name to known specs from CHIP_SPECS. Returns null on non-Apple
 * Silicon platforms.
 */
export function getAppleSiliconInfo(): AppleSiliconInfo | null {
    if (!isAppleSilicon()) return null;

    // Read CPU brand string: "Apple M2 Max" etc.
    const brand = sysctl('machdep.cpu.brand_string');
    if (!brand) return null;

    // Read total memory in bytes
    const memBytes = sysctl('hw.memsize');
    const memGb = memBytes ? Math.round(parseInt(memBytes, 10) / (1024 * 1024 * 1024)) : 0;

    // Match against known chip specs (most specific first)
    const brandLower = brand.toLowerCase();
    for (const spec of CHIP_SPECS) {
        if (brandLower.includes(spec.pattern.toLowerCase())) {
            // Refine core counts from the actual OS when possible
            const cpus = os.cpus();
            const totalCores = cpus.length;

            // On Apple Silicon, performance cores run at higher frequency.
            // We can distinguish them by clock speed: P-cores > 2.5 GHz typically.
            let perfCores = spec.perf_cores;
            let effCores = spec.eff_cores;

            if (totalCores > 0) {
                // If OS reports a different total, trust the OS for total and
                // use the ratio from the spec to split P/E.
                const specTotal = spec.perf_cores + spec.eff_cores;
                if (totalCores !== specTotal) {
                    // Use frequency-based heuristic: cores above the median speed
                    // are performance cores, the rest are efficiency cores.
                    const speeds = cpus.map(c => c.speed).sort((a, b) => a - b);
                    const median = speeds[Math.floor(speeds.length / 2)];
                    perfCores = speeds.filter(s => s >= median).length;
                    effCores = totalCores - perfCores;
                }
            }

            // Read GPU core count from sysctl if available
            let gpuCores = spec.gpu_cores;
            const gpuCoreSysctl = sysctl('machdep.gpu.core_count');
            if (gpuCoreSysctl) {
                gpuCores = safeInt(gpuCoreSysctl, spec.gpu_cores);
            }

            return {
                chip: spec.chip,
                cores_performance: perfCores,
                cores_efficiency: effCores,
                cores_gpu: gpuCores,
                unified_memory_gb: memGb,
                metal_supported: true,  // All Apple Silicon supports Metal
                neural_engine_cores: spec.neural_engine_cores,
            };
        }
    }

    // Unknown Apple Silicon chip (future chips not yet in CHIP_SPECS)
    const cpus = os.cpus();
    return {
        chip: brand.replace('Apple ', ''),
        cores_performance: Math.ceil(cpus.length / 2),
        cores_efficiency: Math.floor(cpus.length / 2),
        cores_gpu: 0,
        unified_memory_gb: memGb,
        metal_supported: true,
        neural_engine_cores: 16,  // Conservative default
    };
}

// =============================================================================
// GPU Info (system_profiler)
// =============================================================================

/**
 * Get system profiler GPU info (macOS).
 *
 * Parses `system_profiler SPDisplaysDataType` to extract the GPU name,
 * Metal family, VRAM, and vendor. Works on both Apple Silicon (unified memory
 * reported as VRAM) and Intel Macs with discrete GPUs.
 *
 * Returns null on non-macOS platforms or if GPU info cannot be parsed.
 */
export function getMacGpuInfo(): MacGpuInfo | null {
    if (process.platform !== 'darwin') return null;

    const output = runCmd('system_profiler', ['SPDisplaysDataType'], 15_000);
    if (!output) return null;

    let name = 'Unknown GPU';
    let metalFamily = 'Unknown';
    let vramMb = 0;
    let vendor = 'Unknown';

    // Parse the structured text output
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Chipset Model: Apple M2 Max
        const chipMatch = line.match(/^Chipset Model:\s+(.+)/);
        if (chipMatch) {
            name = chipMatch[1];
        }

        // Vendor: Apple (0x106b) or sppci_vendor_apple
        const vendorMatch = line.match(/^Vendor:\s+(.+)/);
        if (vendorMatch) {
            const vendorRaw = vendorMatch[1];
            if (vendorRaw.toLowerCase().includes('apple') || vendorRaw.includes('106b')) {
                vendor = 'Apple';
            } else if (vendorRaw.toLowerCase().includes('amd') || vendorRaw.includes('1002')) {
                vendor = 'AMD';
            } else if (vendorRaw.toLowerCase().includes('intel') || vendorRaw.includes('8086')) {
                vendor = 'Intel';
            } else {
                vendor = vendorRaw;
            }
        }

        // VRAM (Total): 36864 MB  or  VRAM (Dynamic, Max): 49152 MB
        const vramMatch = line.match(/^VRAM\s*\([^)]*\):\s+(\d+)\s*(MB|GB)/i);
        if (vramMatch) {
            const amount = safeInt(vramMatch[1]);
            vramMb = vramMatch[2].toUpperCase() === 'GB' ? amount * 1024 : amount;
        }

        // Metal Family: Apple GPU Family 9  or  Metal Support: Metal 3
        const metalMatch = line.match(/^Metal\s+(?:Family|Support):\s+(.+)/);
        if (metalMatch) {
            metalFamily = metalMatch[1].trim();
        }
    }

    // On Apple Silicon, if VRAM wasn't reported, use unified memory
    if (vramMb === 0 && isAppleSilicon()) {
        const memBytes = sysctl('hw.memsize');
        if (memBytes) {
            vramMb = Math.round(parseInt(memBytes, 10) / (1024 * 1024));
        }
    }

    return { name, metal_family: metalFamily, vram_mb: vramMb, vendor };
}

// =============================================================================
// Unified Memory Usage
// =============================================================================

/**
 * Get unified memory usage on Apple Silicon.
 *
 * On Apple Silicon, CPU and GPU share the same memory pool. This function
 * reads total memory from sysctl and computes usage from os.freemem().
 *
 * Returns null on non-Apple Silicon platforms.
 */
export function getUnifiedMemoryUsage(): UnifiedMemoryUsage | null {
    if (!isAppleSilicon()) return null;

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    return {
        total_mb: Math.round(totalBytes / (1024 * 1024)),
        used_mb: Math.round(usedBytes / (1024 * 1024)),
        available_mb: Math.round(freeBytes / (1024 * 1024)),
    };
}

// =============================================================================
// Ollama Metal Support
// =============================================================================

/**
 * Check if Ollama supports Metal on this Mac.
 *
 * Ollama uses Metal for GPU-accelerated inference on Apple Silicon.
 * This function checks:
 *   1. Running on Apple Silicon (Metal is always available)
 *   2. Ollama binary is installed
 *   3. Ollama version is recent enough (>= 0.1.0 supports Metal)
 *
 * Returns false on non-Apple Silicon or if Ollama is not installed.
 */
export function isOllamaMetalSupported(): boolean {
    if (!isAppleSilicon()) return false;

    // Check if Ollama is installed
    const ollamaVersion = runCmd('ollama', ['--version'], 5_000);
    if (!ollamaVersion) return false;

    // All Apple Silicon Macs support Metal, and Ollama uses Metal
    // automatically on Apple Silicon since early versions.
    // Parse version to ensure >= 0.1.0
    const versionMatch = ollamaVersion.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) return true;  // If we can't parse, assume it's new enough

    const major = safeInt(versionMatch[1]);
    const minor = safeInt(versionMatch[2]);

    // Metal support has been in Ollama since the very first Apple Silicon builds
    return major > 0 || minor >= 1;
}

// =============================================================================
// Model Recommendations
// =============================================================================

/**
 * Get recommended models for this Apple Silicon chip.
 *
 * Returns a list of common LLM models with their memory requirements and
 * expected performance on the given chip. Models are classified as fitting
 * or not based on available unified memory.
 *
 * The token generation rate estimates assume Ollama with Metal acceleration
 * and are rough guidelines — actual performance depends on quantization,
 * context length, batch size, and background system load.
 */
export function getRecommendedModels(chip: string, memoryGb: number): RecommendedModel[] {
    const chipLower = chip.toLowerCase();

    // Base tokens/sec multiplier per chip family (relative to M1 base)
    let speedMultiplier = 1.0;
    if (chipLower.includes('m4 ultra'))       speedMultiplier = 5.0;
    else if (chipLower.includes('m4 max'))    speedMultiplier = 3.5;
    else if (chipLower.includes('m4 pro'))    speedMultiplier = 2.5;
    else if (chipLower.includes('m4'))        speedMultiplier = 2.0;
    else if (chipLower.includes('m3 ultra'))  speedMultiplier = 4.5;
    else if (chipLower.includes('m3 max'))    speedMultiplier = 3.0;
    else if (chipLower.includes('m3 pro'))    speedMultiplier = 2.2;
    else if (chipLower.includes('m3'))        speedMultiplier = 1.8;
    else if (chipLower.includes('m2 ultra'))  speedMultiplier = 4.0;
    else if (chipLower.includes('m2 max'))    speedMultiplier = 2.8;
    else if (chipLower.includes('m2 pro'))    speedMultiplier = 2.0;
    else if (chipLower.includes('m2'))        speedMultiplier = 1.5;
    else if (chipLower.includes('m1 ultra'))  speedMultiplier = 3.5;
    else if (chipLower.includes('m1 max'))    speedMultiplier = 2.5;
    else if (chipLower.includes('m1 pro'))    speedMultiplier = 1.8;
    else if (chipLower.includes('m1'))        speedMultiplier = 1.0;

    // Models with their memory requirements (GB) and base tok/s on M1 8GB
    const models: Array<{ name: string; memRequired: number; baseToks: number }> = [
        { name: 'tinyllama:1b',           memRequired: 2,    baseToks: 80 },
        { name: 'phi3:3.8b',              memRequired: 3,    baseToks: 50 },
        { name: 'llama3.2:3b',            memRequired: 3,    baseToks: 45 },
        { name: 'mistral:7b-q4_0',        memRequired: 5,    baseToks: 25 },
        { name: 'llama3.1:8b-q4_0',       memRequired: 6,    baseToks: 22 },
        { name: 'llama3.1:8b',            memRequired: 8,    baseToks: 18 },
        { name: 'codellama:13b-q4_0',     memRequired: 9,    baseToks: 14 },
        { name: 'llama3.1:13b',           memRequired: 14,   baseToks: 10 },
        { name: 'mixtral:8x7b-q4_0',      memRequired: 26,   baseToks: 8 },
        { name: 'llama3.1:70b-q4_0',      memRequired: 40,   baseToks: 5 },
        { name: 'llama3.1:70b',           memRequired: 75,   baseToks: 3 },
        { name: 'llama3.1:405b-q4_0',     memRequired: 220,  baseToks: 1 },
    ];

    // Leave ~2 GB headroom for OS and other processes
    const availableMemGb = memoryGb - 2;

    return models.map(m => ({
        model: m.name,
        fits: m.memRequired <= availableMemGb,
        expected_toks: Math.round(m.baseToks * speedMultiplier),
    }));
}

// =============================================================================
// Thermal State
// =============================================================================

/**
 * Get thermal state on macOS.
 *
 * Reads the thermal pressure from macOS IOKit via `pmset -g therm`.
 * Possible states:
 *   - nominal:  Normal operating temperature
 *   - fair:     Slightly elevated, no throttling yet
 *   - serious:  Thermal throttling is active
 *   - critical: Severe throttling or impending shutdown
 *   - unknown:  Cannot determine (non-macOS or command failure)
 */
export function getThermalState(): ThermalState {
    if (process.platform !== 'darwin') return 'unknown';

    const output = runCmd('pmset', ['-g', 'therm'], 5_000);
    if (!output) return 'unknown';

    // pmset -g therm output contains a line like:
    //   CPU_Scheduler_Limit = 100
    //   CPU_Available_CPUs   = 10
    //   CPU_Speed_Limit      = 100
    // When throttled, Speed_Limit drops below 100.

    const speedLimitMatch = output.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
    if (!speedLimitMatch) return 'unknown';

    const speedLimit = safeInt(speedLimitMatch[1], 100);

    if (speedLimit >= 100) return 'nominal';
    if (speedLimit >= 80) return 'fair';
    if (speedLimit >= 50) return 'serious';
    return 'critical';
}

// =============================================================================
// Power Metrics
// =============================================================================

/**
 * Get power metrics on macOS (via pmset).
 *
 * Reads battery status from `pmset -g batt` and estimates power draw.
 * Detailed per-component wattage requires `sudo powermetrics`, which is not
 * available without elevated privileges — so this function provides battery
 * state and approximate total system power from the battery discharge rate.
 *
 * Returns null on non-macOS platforms or if metrics cannot be read.
 */
export function getPowerMetrics(): PowerMetrics | null {
    if (process.platform !== 'darwin') return null;

    // Battery info from pmset -g batt
    const battOutput = runCmd('pmset', ['-g', 'batt'], 5_000);

    let batteryPct: number | undefined;
    let charging: boolean | undefined;

    if (battOutput) {
        // Parse: "InternalBattery-0 (id=...)  82%; charging; 1:23 remaining"
        // or "Now drawing from 'AC Power'"
        const pctMatch = battOutput.match(/(\d+)%/);
        if (pctMatch) {
            batteryPct = safeInt(pctMatch[1]);
        }

        const chargingLower = battOutput.toLowerCase();
        if (chargingLower.includes('charging') && !chargingLower.includes('not charging')) {
            charging = true;
        } else if (chargingLower.includes('discharging') || chargingLower.includes('battery power')) {
            charging = false;
        } else if (chargingLower.includes('ac power') || chargingLower.includes('charged')) {
            charging = true;
        }
    }

    // Try to get instantaneous power from powermetrics (requires no sudo for
    // the basic query on some macOS versions, but may fail without privileges)
    const powerOutput = runCmd('powermetrics', [
        '--samplers', 'cpu_power,gpu_power',
        '-n', '1',
        '-i', '500',
    ], 5_000);

    let cpuWatts = 0;
    let gpuWatts = 0;

    if (powerOutput) {
        // Parse: "CPU Power: 3245 mW" or "Package Power: 8123 mW"
        const cpuMatch = powerOutput.match(/CPU Power:\s*([\d.]+)\s*mW/i);
        if (cpuMatch) {
            cpuWatts = safeFloat(cpuMatch[1]) / 1000;
        }

        const gpuMatch = powerOutput.match(/GPU Power:\s*([\d.]+)\s*mW/i);
        if (gpuMatch) {
            gpuWatts = safeFloat(gpuMatch[1]) / 1000;
        }

        // Fallback: package power includes both CPU and GPU
        if (cpuWatts === 0 && gpuWatts === 0) {
            const pkgMatch = powerOutput.match(/Package Power:\s*([\d.]+)\s*mW/i);
            if (pkgMatch) {
                const totalMw = safeFloat(pkgMatch[1]);
                // Rough split: 60% CPU, 40% GPU
                cpuWatts = (totalMw * 0.6) / 1000;
                gpuWatts = (totalMw * 0.4) / 1000;
            }
        }
    }

    const totalWatts = cpuWatts + gpuWatts;

    // Only return if we got at least some information
    if (totalWatts === 0 && batteryPct === undefined) return null;

    return {
        cpu_watts: Math.round(cpuWatts * 100) / 100,
        gpu_watts: Math.round(gpuWatts * 100) / 100,
        total_watts: Math.round(totalWatts * 100) / 100,
        battery_pct: batteryPct,
        charging,
    };
}

// =============================================================================
// VRAM Equivalent
// =============================================================================

/**
 * Map Apple Silicon chip to equivalent VRAM for model sizing.
 *
 * Apple Silicon uses unified memory shared between CPU and GPU. For model
 * sizing purposes, we estimate the "effective VRAM" available for inference
 * by reserving a portion of unified memory for the OS and CPU workloads.
 *
 * The reservation depends on the chip class:
 *   - Ultra chips: 4 GB reserved (huge memory pools, OS overhead is tiny %)
 *   - Max chips:   3 GB reserved
 *   - Pro chips:   2.5 GB reserved
 *   - Base chips:  2 GB reserved (tighter memory, minimal reservation)
 *
 * Returns the effective VRAM equivalent in MB.
 */
export function chipToVramEquivalent(chip: string, memoryGb: number): number {
    const chipLower = chip.toLowerCase();

    // Apple Silicon can use ~75-90% of unified memory for GPU workloads.
    // The exact usable fraction depends on the chip and macOS memory pressure.
    let reservedGb: number;
    let gpuFraction: number;

    if (chipLower.includes('ultra')) {
        // Ultra: massive memory pool, OS uses a small fraction
        reservedGb = 4;
        gpuFraction = 0.90;
    } else if (chipLower.includes('max')) {
        // Max: large memory, good GPU utilization
        reservedGb = 3;
        gpuFraction = 0.85;
    } else if (chipLower.includes('pro')) {
        // Pro: moderate memory
        reservedGb = 2.5;
        gpuFraction = 0.80;
    } else {
        // Base M-series: tighter memory budgets
        reservedGb = 2;
        gpuFraction = 0.75;
    }

    const effectiveGb = Math.max(0, memoryGb - reservedGb) * gpuFraction;
    return Math.round(effectiveGb * 1024);  // Convert GB to MB
}
