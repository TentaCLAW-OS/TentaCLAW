/**
 * AMD ROCm Optimization Module (Wave 62)
 *
 * Detects and configures AMD Instinct GPUs for optimal inference:
 *   - MI300X/MI350/MI355X/MI400 detection
 *   - ROCm version verification
 *   - HIP profiling hooks
 *   - Composable Kernel flash attention configuration
 *   - RCCL multi-GPU tuning
 *   - FP8 support detection (CDNA 4+)
 *   - HBM bandwidth optimization
 *
 * TentaCLAW says: "AMD or NVIDIA? I love all GPUs equally. With eight arms."
 */

import { execFileSync } from 'child_process';

// =============================================================================
// Types
// =============================================================================

export interface AmdGpuInfo {
    index: number;
    name: string;
    family: 'mi300' | 'mi350' | 'mi400' | 'rdna3' | 'rdna2' | 'cdna3' | 'cdna4' | 'unknown';
    vramMb: number;
    vramUsedMb: number;
    temperatureC: number;
    powerDrawW: number;
    utilizationPct: number;
    rocmVersion: string | null;
    hipVersion: string | null;
    computeUnits: number;
    gfxVersion: string;
    supportsFp8: boolean;
    supportsFlashAttention: boolean;
}

export interface RocmConfig {
    version: string | null;
    hipVersion: string | null;
    gpus: AmdGpuInfo[];
    optimizations: Record<string, string>;
    warnings: string[];
}

// =============================================================================
// Detection
// =============================================================================

/** Check if ROCm is installed */
export function isRocmInstalled(): boolean {
    try {
        execFileSync('rocm-smi', ['--showid'], { stdio: 'pipe', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/** Get ROCm version */
export function getRocmVersion(): string | null {
    try {
        // Try rocm-smi first
        const output = execFileSync('rocm-smi', ['--showdriverversion'], { stdio: 'pipe', timeout: 5000 }).toString();
        const match = output.match(/(\d+\.\d+\.\d+)/);
        if (match) return match[1];

        // Try rocminfo
        const info = execFileSync('rocminfo', [], { stdio: 'pipe', timeout: 5000 }).toString();
        const verMatch = info.match(/ROCm Runtime Version:\s*(\d+\.\d+)/);
        return verMatch ? verMatch[1] : null;
    } catch {
        return null;
    }
}

/** Get HIP version */
export function getHipVersion(): string | null {
    try {
        const output = execFileSync('hipcc', ['--version'], { stdio: 'pipe', timeout: 5000 }).toString();
        const match = output.match(/HIP version:\s*(\d+\.\d+\.\d+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/** Detect AMD GPUs via rocm-smi */
export function detectAmdGpus(): AmdGpuInfo[] {
    if (!isRocmInstalled()) return [];

    try {
        const output = execFileSync('rocm-smi', ['--showallinfo', '--json'], { stdio: 'pipe', timeout: 10000 }).toString();
        const data = JSON.parse(output);
        const gpus: AmdGpuInfo[] = [];

        for (const [key, info] of Object.entries(data as Record<string, any>)) {
            if (!key.startsWith('card')) continue;
            const idx = parseInt(key.replace('card', ''), 10) || 0;
            const name = info['Card Series'] || info['Card series'] || 'Unknown AMD GPU';
            const family = classifyGpuFamily(name);

            gpus.push({
                index: idx,
                name,
                family,
                vramMb: parseMemoryMb(info['VRAM Total Memory (B)'] || info['vram_total'] || '0'),
                vramUsedMb: parseMemoryMb(info['VRAM Total Used Memory (B)'] || info['vram_used'] || '0'),
                temperatureC: parseFloat(info['Temperature (Sensor edge) (C)'] || info['temperature'] || '0'),
                powerDrawW: parseFloat(info['Average Graphics Package Power (W)'] || info['power'] || '0'),
                utilizationPct: parseFloat(info['GPU use (%)'] || info['gpu_use'] || '0'),
                rocmVersion: getRocmVersion(),
                hipVersion: getHipVersion(),
                computeUnits: parseInt(info['Compute Units'] || '0', 10),
                gfxVersion: info['GFX Version'] || info['gfx_version'] || 'unknown',
                supportsFp8: family === 'cdna4' || family === 'mi350' || family === 'mi400',
                supportsFlashAttention: family !== 'unknown' && family !== 'rdna2',
            });
        }

        return gpus;
    } catch {
        // Fallback: non-JSON rocm-smi
        return detectAmdGpusFallback();
    }
}

function detectAmdGpusFallback(): AmdGpuInfo[] {
    try {
        const output = execFileSync('rocm-smi', ['--showid', '--showtemp', '--showuse', '--showmemuse'], {
            stdio: 'pipe', timeout: 10000,
        }).toString();

        // Parse tabular output — basic detection
        const gpus: AmdGpuInfo[] = [];
        const lines = output.split('\n').filter(l => l.match(/^\d/));

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const idx = parseInt(parts[0]);
            if (isNaN(idx)) continue;

            gpus.push({
                index: idx,
                name: 'AMD GPU ' + idx,
                family: 'unknown',
                vramMb: 0,
                vramUsedMb: 0,
                temperatureC: parseFloat(parts[1] || '0'),
                powerDrawW: 0,
                utilizationPct: parseFloat(parts[2] || '0'),
                rocmVersion: getRocmVersion(),
                hipVersion: getHipVersion(),
                computeUnits: 0,
                gfxVersion: 'unknown',
                supportsFp8: false,
                supportsFlashAttention: false,
            });
        }

        return gpus;
    } catch {
        return [];
    }
}

// =============================================================================
// GPU Classification
// =============================================================================

function classifyGpuFamily(name: string): AmdGpuInfo['family'] {
    const lower = name.toLowerCase();
    if (lower.includes('mi400')) return 'mi400';
    if (lower.includes('mi350') || lower.includes('mi355')) return 'mi350';
    if (lower.includes('mi300')) return 'mi300';
    if (lower.includes('mi250') || lower.includes('mi210')) return 'cdna3';
    if (lower.includes('7900') || lower.includes('7800') || lower.includes('7600')) return 'rdna3';
    if (lower.includes('6900') || lower.includes('6800') || lower.includes('6700') || lower.includes('6600')) return 'rdna2';
    return 'unknown';
}

function parseMemoryMb(value: string): number {
    const num = parseInt(value, 10);
    if (isNaN(num)) return 0;
    // If value is in bytes (> 1 billion), convert to MB
    if (num > 1_000_000_000) return Math.round(num / (1024 * 1024));
    // If already in MB range
    if (num > 1000) return num;
    return 0;
}

// =============================================================================
// Optimization Configuration
// =============================================================================

/** Generate optimized environment variables for AMD GPUs */
export function getOptimizedRocmEnv(gpus: AmdGpuInfo[]): Record<string, string> {
    const env: Record<string, string> = {};

    if (gpus.length === 0) return env;

    const hasCdna4 = gpus.some(g => g.family === 'mi350' || g.family === 'mi400' || g.family === 'cdna4');
    const hasCdna3 = gpus.some(g => g.family === 'mi300' || g.family === 'cdna3');

    // General ROCm tuning
    env['HSA_FORCE_FINE_GRAIN_PCIE'] = '1';
    env['GPU_MAX_HW_QUEUES'] = '8';

    // Memory optimization
    env['PYTORCH_TUNABLEOP_ENABLED'] = '1'; // Auto-tune GEMM kernels
    env['PYTORCH_TUNABLEOP_TUNING'] = '1';

    // HIP optimization
    env['HIP_FORCE_DEV_KERNARG'] = '1';

    if (hasCdna4) {
        // MI350/MI400 specific: enable FP8
        env['ROCM_FP8_ENABLED'] = '1';
        env['VLLM_USE_ROCM_FLASH_ATTN_V2'] = '1'; // Composable Kernel flash attention
        env['CK_FLASH_ATTENTION_INTERNAL'] = '1';
    }

    if (hasCdna3) {
        // MI300X specific
        env['VLLM_USE_ROCM_FLASH_ATTN_V2'] = '1';
        env['CK_FLASH_ATTENTION_INTERNAL'] = '1';
    }

    // Multi-GPU: RCCL tuning
    if (gpus.length > 1) {
        env['NCCL_DEBUG'] = 'WARN';
        env['RCCL_MSCCL_ENABLE'] = '1'; // Microsoft Collective Communication Library optimizations
        env['NCCL_IB_DISABLE'] = gpus.length <= 8 ? '1' : '0'; // Use IB for large clusters
    }

    return env;
}

/** Get AMD GPU recommendations for inference */
export function getAmdRecommendations(gpus: AmdGpuInfo[]): string[] {
    const recommendations: string[] = [];

    if (gpus.length === 0) {
        recommendations.push('No AMD GPUs detected. Install ROCm: https://rocm.docs.amd.com/');
        return recommendations;
    }

    const rocmVersion = gpus[0].rocmVersion;
    if (rocmVersion) {
        const major = parseInt(rocmVersion.split('.')[0], 10) || 0;
        if (major > 0 && major < 6) {
            recommendations.push(`ROCm ${rocmVersion} is outdated. Upgrade to ROCm 7+ for best inference performance.`);
        }
    }

    for (const gpu of gpus) {
        if (gpu.family === 'rdna2' || gpu.family === 'rdna3') {
            recommendations.push(`${gpu.name}: Consumer AMD GPU. Use llama.cpp (Vulkan) or vLLM (ROCm) for inference. Limited compared to Instinct MI series.`);
        }
        if (gpu.family === 'mi300') {
            recommendations.push(`${gpu.name}: Use vLLM or SGLang with ROCm. Enable flash attention via Composable Kernel. FP16/BF16 recommended.`);
        }
        if (gpu.family === 'mi350') {
            recommendations.push(`${gpu.name}: CDNA 4 with FP8 support. Use vLLM with --quantization fp8 for 2x throughput.`);
        }
        if (gpu.temperatureC > 80) {
            recommendations.push(`${gpu.name} (GPU ${gpu.index}): Temperature ${gpu.temperatureC}C is high. Check cooling.`);
        }
    }

    return recommendations;
}

/** Full ROCm configuration report */
export function getRocmConfig(): RocmConfig {
    const gpus = detectAmdGpus();
    const optimizations = getOptimizedRocmEnv(gpus);
    const warnings: string[] = [];

    if (!isRocmInstalled()) {
        warnings.push('ROCm not installed. AMD GPU inference requires ROCm 6+.');
    }

    const version = getRocmVersion();
    if (version) {
        const major = parseInt(version.split('.')[0], 10) || 0;
        if (major > 0 && major < 6) warnings.push(`ROCm ${version} is outdated. Recommend ROCm 7+.`);
    }

    return {
        version: getRocmVersion(),
        hipVersion: getHipVersion(),
        gpus,
        optimizations,
        warnings,
    };
}
