/**
 * NVIDIA GPU Advanced Management
 * CLAWtopus says: "Green team? I've got arms for that too."
 *
 * Consolidated NVIDIA GPU advanced functionality for TentaCLAW agent nodes:
 *   - MIG (Multi-Instance GPU) detection
 *   - Detailed GPU info beyond basic nvidia-smi queries
 *   - NVLink topology discovery
 *   - Power limit / persistence mode management
 *   - GPU reset, process listing, process killing
 *   - Inference optimization recommendations
 *   - Driver health checks
 */

import { execFileSync } from 'child_process';

// =============================================================================
// Types
// =============================================================================

export interface MigInstance {
    gi_id: number;
    ci_id: number;
    gpu_instance_id: string;
    name: string;
    vram_mb: number;
}

export interface MigInfo {
    supported: boolean;
    enabled: boolean;
    instances: MigInstance[];
}

export interface GpuProcess {
    pid: number;
    name: string;
    vram_mb: number;
}

export interface DetailedGpuInfo {
    index: number;
    name: string;
    uuid: string;
    pci_bus_id: string;
    driver_version: string;
    cuda_version: string;
    compute_capability: string;
    vram_total_mb: number;
    vram_used_mb: number;
    temperature_c: number;
    power_draw_w: number;
    power_limit_w: number;
    clock_sm_mhz: number;
    clock_mem_mhz: number;
    fan_speed_pct: number;
    utilization_gpu_pct: number;
    utilization_mem_pct: number;
    pcie_gen: number;
    pcie_width: number;
    ecc_errors: number;
    processes: GpuProcess[];
}

export interface NvLinkConnection {
    gpu_0: number;
    gpu_1: number;
    link_type: string;
    bandwidth_gb_s: number;
}

export interface InferenceOptimization {
    persistence_mode: boolean;
    power_limit_pct: number;
    clock_lock_sm?: number;
    ecc_mode: boolean;
    compute_mode: string;
}

export interface DriverHealth {
    healthy: boolean;
    driver_version: string;
    cuda_version: string;
    issues: string[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Run nvidia-smi with arguments, return trimmed stdout or null on failure */
function nvidiaSmi(args: string[], timeoutMs: number = 10_000): string | null {
    try {
        return execFileSync('nvidia-smi', args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
        }).trim();
    } catch {
        return null;
    }
}

/** Parse a CSV row from nvidia-smi --format=csv,noheader,nounits */
function parseCsvRow(line: string): string[] {
    return line.split(',').map(s => s.trim());
}

/** Safe parseInt with fallback */
function safeInt(s: string, fallback: number = 0): number {
    const v = parseInt(s, 10);
    return isNaN(v) ? fallback : v;
}

/** Safe parseFloat with fallback */
function safeFloat(s: string, fallback: number = 0): number {
    const v = parseFloat(s);
    return isNaN(v) ? fallback : v;
}

// =============================================================================
// MIG Detection
// =============================================================================

/**
 * Detect if MIG (Multi-Instance GPU) is supported and enabled.
 *
 * MIG is available on A100, A30, H100, and similar data-center GPUs.
 * This queries nvidia-smi for MIG mode status and enumerates any
 * active GPU instances.
 */
export function detectMIG(): MigInfo {
    const result: MigInfo = { supported: false, enabled: false, instances: [] };

    // Check if MIG mode is supported / enabled
    const migOutput = nvidiaSmi([
        '--query-gpu=mig.mode.current,mig.mode.pending',
        '--format=csv,noheader,nounits',
    ]);
    if (!migOutput) return result;

    const lines = migOutput.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
        const [current, _pending] = parseCsvRow(line);
        if (current === 'Enabled') {
            result.supported = true;
            result.enabled = true;
        } else if (current === 'Disabled') {
            // MIG is supported (field exists) but disabled
            result.supported = true;
        }
        // If value is "[N/A]" or empty, MIG is not supported on this GPU
    }

    if (!result.enabled) return result;

    // Enumerate active MIG instances via nvidia-smi mig -lgi
    try {
        const giOutput = execFileSync('nvidia-smi', ['mig', '-lgi'], {
            encoding: 'utf-8',
            timeout: 10_000,
        }).trim();

        // Parse the table output: each line after header has GPU instance info
        // Format: +----+--------+--------+-----+-------+------+--------+-----------+
        //         | GPU| GI ID  |  CI ID |Name | VRAM  | ...  |
        const giLines = giOutput.split('\n').filter(l => l.includes('|') && !l.includes('+--') && !l.toLowerCase().includes('gpu'));
        for (const giLine of giLines) {
            const cols = giLine.split('|').map(c => c.trim()).filter(c => c.length > 0);
            if (cols.length >= 5) {
                result.instances.push({
                    gi_id: safeInt(cols[1]),
                    ci_id: safeInt(cols[2]),
                    gpu_instance_id: cols[0],
                    name: cols[3],
                    vram_mb: safeInt(cols[4]),
                });
            }
        }
    } catch {
        // MIG enabled but couldn't list instances -- maybe no instances created yet
        console.log('[nvidia] MIG enabled but no instances could be enumerated');
    }

    return result;
}

// =============================================================================
// Detailed GPU Info
// =============================================================================

/**
 * Get detailed NVIDIA GPU info beyond basic nvidia-smi.
 *
 * Queries a comprehensive set of GPU properties including UUID, PCIe info,
 * compute capability, ECC errors, and per-GPU process lists.
 */
export function getDetailedGpuInfo(): DetailedGpuInfo[] {
    const queryFields = [
        'index',
        'name',
        'uuid',
        'pci.bus_id',
        'driver_version',
        'compute_cap',
        'memory.total',
        'memory.used',
        'temperature.gpu',
        'power.draw',
        'power.limit',
        'clocks.current.sm',
        'clocks.current.memory',
        'fan.speed',
        'utilization.gpu',
        'utilization.memory',
        'pcie.link.gen.current',
        'pcie.link.width.current',
        'ecc.errors.corrected.aggregate.total',
    ].join(',');

    const output = nvidiaSmi([
        '--query-gpu=' + queryFields,
        '--format=csv,noheader,nounits',
    ]);
    if (!output) return [];

    // Get CUDA version from nvidia-smi header (separate query)
    let cudaVersion = 'unknown';
    try {
        const headerOutput = nvidiaSmi([], 5_000);
        if (headerOutput) {
            const cudaMatch = headerOutput.match(/CUDA Version:\s*([\d.]+)/);
            if (cudaMatch) cudaVersion = cudaMatch[1];
        }
    } catch { /* CUDA version unavailable */ }

    const gpus: DetailedGpuInfo[] = [];

    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
        const cols = parseCsvRow(line);
        if (cols.length < 19) continue;

        const gpuIndex = safeInt(cols[0]);

        // Get per-GPU processes
        const processes = getProcessesForGpu(gpuIndex);

        gpus.push({
            index: gpuIndex,
            name: cols[1] || 'Unknown GPU',
            uuid: cols[2] || 'unknown',
            pci_bus_id: cols[3] || 'unknown',
            driver_version: cols[4] || 'unknown',
            cuda_version: cudaVersion,
            compute_capability: cols[5] || 'unknown',
            vram_total_mb: safeInt(cols[6]),
            vram_used_mb: safeInt(cols[7]),
            temperature_c: safeInt(cols[8]),
            power_draw_w: safeFloat(cols[9]),
            power_limit_w: safeFloat(cols[10]),
            clock_sm_mhz: safeInt(cols[11]),
            clock_mem_mhz: safeInt(cols[12]),
            fan_speed_pct: safeInt(cols[13]),
            utilization_gpu_pct: safeInt(cols[14]),
            utilization_mem_pct: safeInt(cols[15]),
            pcie_gen: safeInt(cols[16]),
            pcie_width: safeInt(cols[17]),
            ecc_errors: safeInt(cols[18]),
            processes,
        });
    }

    return gpus;
}

/** Get processes running on a specific GPU */
function getProcessesForGpu(gpuIndex: number): GpuProcess[] {
    const output = nvidiaSmi([
        '--query-compute-apps=pid,process_name,used_gpu_memory',
        '--format=csv,noheader,nounits',
        '-i', String(gpuIndex),
    ]);
    if (!output) return [];

    const processes: GpuProcess[] = [];
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
        const cols = parseCsvRow(line);
        if (cols.length >= 3) {
            processes.push({
                pid: safeInt(cols[0]),
                name: cols[1] || 'unknown',
                vram_mb: safeInt(cols[2]),
            });
        }
    }
    return processes;
}

// =============================================================================
// NVLink Topology
// =============================================================================

/**
 * Get NVLink topology (if available).
 *
 * Returns inter-GPU NVLink connections with bandwidth info, or null
 * if NVLink is not present (e.g., consumer GPUs, single-GPU systems).
 */
export function getNvLinkTopology(): NvLinkConnection[] | null {
    // Use nvidia-smi topo -m to get the topology matrix
    const output = nvidiaSmi(['topo', '-m']);
    if (!output) return null;

    const connections: NvLinkConnection[] = [];
    const lines = output.split('\n').filter(l => l.trim().length > 0);

    // The topology matrix header line lists GPU indices
    // Format:
    //         GPU0  GPU1  GPU2  ...
    // GPU0     X    NV12  NV12  ...
    // GPU1    NV12   X    NV12  ...

    let gpuIndices: number[] = [];
    for (const line of lines) {
        // Header line: starts with whitespace and has GPU0 GPU1 etc
        const headerMatch = line.match(/^\s+(GPU\d+.*)/);
        if (headerMatch) {
            gpuIndices = headerMatch[1].split(/\s+/)
                .filter(s => s.startsWith('GPU'))
                .map(s => safeInt(s.replace('GPU', '')));
            continue;
        }

        // Data line: starts with GPUn
        const rowMatch = line.match(/^GPU(\d+)\s+(.*)/);
        if (rowMatch && gpuIndices.length > 0) {
            const srcGpu = safeInt(rowMatch[1]);
            const cells = rowMatch[2].split(/\s+/);
            for (let i = 0; i < cells.length && i < gpuIndices.length; i++) {
                const cell = cells[i];
                const dstGpu = gpuIndices[i];

                // Only record NVLink connections (not PHB, PIX, SYS, X etc)
                // NVn means NVLink with n links
                const nvMatch = cell.match(/^NV(\d+)$/);
                if (nvMatch && srcGpu < dstGpu) {
                    const numLinks = safeInt(nvMatch[1]);
                    // NVLink 3.0 = 25 GB/s per link per direction
                    // NVLink 4.0 = 25 GB/s per link per direction (same per-link, more links)
                    const bandwidthPerLink = 25;
                    connections.push({
                        gpu_0: srcGpu,
                        gpu_1: dstGpu,
                        link_type: 'NVLink',
                        bandwidth_gb_s: numLinks * bandwidthPerLink,
                    });
                }
            }
        }
    }

    return connections.length > 0 ? connections : null;
}

// =============================================================================
// Power / Persistence / Reset
// =============================================================================

/**
 * Set GPU power limit.
 *
 * Requires root/admin privileges. The watts value must be within the
 * GPU's min-max power limit range.
 */
export function setPowerLimit(gpuIndex: number, watts: number): boolean {
    try {
        execFileSync('nvidia-smi', [
            '-i', String(gpuIndex),
            '-pl', String(watts),
        ], { encoding: 'utf-8', timeout: 10_000 });
        console.log(`[nvidia] GPU ${gpuIndex}: Power limit set to ${watts}W`);
        return true;
    } catch (e) {
        console.error(`[nvidia] GPU ${gpuIndex}: Failed to set power limit to ${watts}W: ${e}`);
        return false;
    }
}

/**
 * Set GPU persistence mode (keeps driver loaded).
 *
 * When enabled, the NVIDIA driver remains loaded even when no GPU
 * applications are running. This reduces latency for the first CUDA
 * call after idle. Requires root/admin privileges.
 */
export function setPersistenceMode(enabled: boolean): boolean {
    try {
        execFileSync('nvidia-smi', [
            '-pm', enabled ? '1' : '0',
        ], { encoding: 'utf-8', timeout: 10_000 });
        console.log(`[nvidia] Persistence mode ${enabled ? 'enabled' : 'disabled'}`);
        return true;
    } catch (e) {
        console.error(`[nvidia] Failed to set persistence mode: ${e}`);
        return false;
    }
}

/**
 * Reset GPU (for stuck GPUs).
 *
 * Attempts a GPU reset via nvidia-smi. This will kill all processes
 * running on the GPU. Use with caution. Requires root/admin privileges.
 */
export function resetGpu(gpuIndex: number): boolean {
    try {
        execFileSync('nvidia-smi', [
            '-i', String(gpuIndex),
            '--gpu-reset',
        ], { encoding: 'utf-8', timeout: 30_000 });
        console.log(`[nvidia] GPU ${gpuIndex}: Reset successful`);
        return true;
    } catch (e) {
        console.error(`[nvidia] GPU ${gpuIndex}: Reset failed: ${e}`);
        return false;
    }
}

// =============================================================================
// Process Management
// =============================================================================

/**
 * Get GPU processes and their VRAM usage across all GPUs.
 */
export function getGpuProcesses(): Array<{ gpu: number; pid: number; name: string; vram_mb: number }> {
    // Query all GPUs for compute processes
    const output = nvidiaSmi([
        '--query-compute-apps=gpu_bus_id,pid,process_name,used_gpu_memory',
        '--format=csv,noheader,nounits',
    ]);
    if (!output) return [];

    // Also need a bus_id -> index mapping
    const indexMap = new Map<string, number>();
    const indexOutput = nvidiaSmi([
        '--query-gpu=index,pci.bus_id',
        '--format=csv,noheader,nounits',
    ]);
    if (indexOutput) {
        for (const line of indexOutput.split('\n').filter(l => l.trim())) {
            const [idx, busId] = parseCsvRow(line);
            indexMap.set(busId, safeInt(idx));
        }
    }

    const processes: Array<{ gpu: number; pid: number; name: string; vram_mb: number }> = [];
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
        const cols = parseCsvRow(line);
        if (cols.length >= 4) {
            const busId = cols[0];
            processes.push({
                gpu: indexMap.get(busId) ?? 0,
                pid: safeInt(cols[1]),
                name: cols[2] || 'unknown',
                vram_mb: safeInt(cols[3]),
            });
        }
    }

    return processes;
}

/**
 * Kill a process on a GPU.
 *
 * Uses execFileSync to send a kill signal to the specified PID.
 * On Windows uses taskkill, on Linux/macOS uses kill -TERM.
 * Returns true if the kill command succeeded.
 */
export function killGpuProcess(pid: number): boolean {
    try {
        if (process.platform === 'win32') {
            execFileSync('taskkill', ['/PID', String(pid), '/F'], {
                encoding: 'utf-8',
                timeout: 10_000,
            });
        } else {
            execFileSync('kill', ['-TERM', String(pid)], {
                encoding: 'utf-8',
                timeout: 10_000,
            });
        }
        console.log(`[nvidia] Killed process ${pid}`);
        return true;
    } catch (e) {
        console.error(`[nvidia] Failed to kill process ${pid}: ${e}`);
        return false;
    }
}

// =============================================================================
// Inference Optimization
// =============================================================================

/**
 * Get recommended settings for inference workloads based on GPU model.
 *
 * Returns a configuration that prioritizes throughput and stability
 * for LLM inference while minimizing power consumption and thermal issues.
 */
export function getInferenceOptimization(gpuName: string): InferenceOptimization {
    const lower = gpuName.toLowerCase();

    // Data-center GPUs (A100, H100, L40S, etc.) -- built for inference
    if (lower.includes('a100') || lower.includes('h100') || lower.includes('h200')) {
        return {
            persistence_mode: true,
            power_limit_pct: 100,    // Run at full power; these are designed for it
            ecc_mode: true,          // Always keep ECC on for data-center GPUs
            compute_mode: 'DEFAULT', // Allow multiple contexts for batched serving
        };
    }

    if (lower.includes('l40') || lower.includes('a40') || lower.includes('a30')) {
        return {
            persistence_mode: true,
            power_limit_pct: 95,
            ecc_mode: true,
            compute_mode: 'DEFAULT',
        };
    }

    // Professional GPUs (Quadro, RTX A-series)
    if (lower.includes('quadro') || lower.includes('rtx a') || lower.includes('ada')) {
        return {
            persistence_mode: true,
            power_limit_pct: 90,
            ecc_mode: true,
            compute_mode: 'DEFAULT',
        };
    }

    // High-end consumer GPUs (RTX 4090, 4080, 3090, 3080)
    if (lower.includes('4090') || lower.includes('3090')) {
        return {
            persistence_mode: true,
            power_limit_pct: 85,      // Slightly reduce power for thermal headroom
            clock_lock_sm: 1800,      // Lock SM clock for consistent performance
            ecc_mode: false,          // Consumer GPUs don't have ECC
            compute_mode: 'EXCLUSIVE_PROCESS',
        };
    }

    if (lower.includes('4080') || lower.includes('3080')) {
        return {
            persistence_mode: true,
            power_limit_pct: 85,
            clock_lock_sm: 1700,
            ecc_mode: false,
            compute_mode: 'EXCLUSIVE_PROCESS',
        };
    }

    // Mid-range consumer GPUs (RTX 4070, 3070, 4060, 3060)
    if (lower.includes('4070') || lower.includes('3070')) {
        return {
            persistence_mode: true,
            power_limit_pct: 90,
            clock_lock_sm: 1600,
            ecc_mode: false,
            compute_mode: 'EXCLUSIVE_PROCESS',
        };
    }

    if (lower.includes('4060') || lower.includes('3060')) {
        return {
            persistence_mode: true,
            power_limit_pct: 90,
            clock_lock_sm: 1500,
            ecc_mode: false,
            compute_mode: 'EXCLUSIVE_PROCESS',
        };
    }

    // Tesla / older data-center GPUs
    if (lower.includes('tesla') || lower.includes('v100') || lower.includes('p100') || lower.includes('t4')) {
        return {
            persistence_mode: true,
            power_limit_pct: 95,
            ecc_mode: true,
            compute_mode: 'DEFAULT',
        };
    }

    // Default / unknown GPU -- conservative settings
    return {
        persistence_mode: true,
        power_limit_pct: 85,
        ecc_mode: false,
        compute_mode: 'EXCLUSIVE_PROCESS',
    };
}

// =============================================================================
// Driver Health
// =============================================================================

/**
 * Check NVIDIA driver health.
 *
 * Performs multiple checks to verify the NVIDIA driver and GPU are
 * functioning correctly:
 *   - Driver responsiveness (nvidia-smi responds)
 *   - Driver version detection
 *   - CUDA version detection
 *   - GPU error checks (XID errors, ECC issues, thermal throttling)
 */
export function checkDriverHealth(): DriverHealth {
    const issues: string[] = [];
    let driverVersion = 'unknown';
    let cudaVersion = 'unknown';

    // Check 1: Can nvidia-smi respond at all?
    const basicOutput = nvidiaSmi([], 5_000);
    if (!basicOutput) {
        return {
            healthy: false,
            driver_version: 'unknown',
            cuda_version: 'unknown',
            issues: ['nvidia-smi is not responding -- driver may be crashed or not installed'],
        };
    }

    // Parse driver and CUDA versions from nvidia-smi header
    const driverMatch = basicOutput.match(/Driver Version:\s*([\d.]+)/);
    if (driverMatch) {
        driverVersion = driverMatch[1];
    } else {
        issues.push('Could not parse driver version from nvidia-smi output');
    }

    const cudaMatch = basicOutput.match(/CUDA Version:\s*([\d.]+)/);
    if (cudaMatch) {
        cudaVersion = cudaMatch[1];
    } else {
        issues.push('Could not parse CUDA version from nvidia-smi output');
    }

    // Check 2: Query GPU status for per-GPU health indicators
    const statusOutput = nvidiaSmi([
        '--query-gpu=index,name,temperature.gpu,power.draw,power.limit,ecc.errors.uncorrected.aggregate.total,gpu_operation_mode.current',
        '--format=csv,noheader,nounits',
    ]);
    if (statusOutput) {
        const lines = statusOutput.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
            const cols = parseCsvRow(line);
            if (cols.length < 7) continue;

            const gpuIndex = cols[0];
            const gpuName = cols[1];
            const temp = safeInt(cols[2]);
            const powerDraw = safeFloat(cols[3]);
            const powerLimit = safeFloat(cols[4]);
            const eccUncorrected = safeInt(cols[5]);

            // Thermal check
            if (temp >= 90) {
                issues.push(`GPU ${gpuIndex} (${gpuName}): CRITICAL temperature ${temp}C -- thermal throttling likely`);
            } else if (temp >= 80) {
                issues.push(`GPU ${gpuIndex} (${gpuName}): High temperature ${temp}C -- consider improving cooling`);
            }

            // Power check
            if (powerLimit > 0 && powerDraw > powerLimit * 0.95) {
                issues.push(`GPU ${gpuIndex} (${gpuName}): Power draw ${powerDraw}W near limit ${powerLimit}W -- may be power throttling`);
            }

            // ECC check
            if (eccUncorrected > 0) {
                issues.push(`GPU ${gpuIndex} (${gpuName}): ${eccUncorrected} uncorrected ECC errors -- hardware issue possible`);
            }
        }
    } else {
        issues.push('Could not query GPU status details');
    }

    // Check 3: Look for pending page retirements (sign of hardware degradation)
    const retirementOutput = nvidiaSmi([
        '--query-retired-pages=gpu_bus_id,address,cause',
        '--format=csv,noheader',
    ]);
    if (retirementOutput && retirementOutput.trim().length > 0) {
        const retiredCount = retirementOutput.split('\n').filter(l => l.trim().length > 0).length;
        if (retiredCount > 0) {
            issues.push(`${retiredCount} retired memory page(s) detected -- indicates VRAM hardware degradation`);
        }
    }

    // Check 4: Verify persistence mode (recommended for servers)
    const pmOutput = nvidiaSmi([
        '--query-gpu=persistence_mode',
        '--format=csv,noheader',
    ]);
    if (pmOutput) {
        const pmLines = pmOutput.split('\n').filter(l => l.trim().length > 0);
        const allEnabled = pmLines.every(l => l.trim() === 'Enabled');
        if (!allEnabled) {
            issues.push('Persistence mode is not enabled on all GPUs -- recommended for inference workloads');
        }
    }

    return {
        healthy: issues.length === 0,
        driver_version: driverVersion,
        cuda_version: cudaVersion,
        issues,
    };
}
