/**
 * TentaCLAW Gateway — VRAM Estimation Engine (Wave 67)
 *
 * Accurate VRAM prediction before model loading:
 *   VRAM = model_weights + kv_cache + activation_buffer + overhead
 *
 * Formulas:
 *   model_weights = params_billions * bytes_per_param * 1024 (MB)
 *   kv_cache = 2 * layers * kv_heads * head_dim * max_seq * batch * dtype_size / 1M
 *   activation_buffer = ~10% of model weights for inference
 *   overhead = ~300MB CUDA/ROCm runtime + ~200MB per loaded model
 *
 * CLAWtopus says: "Measure twice, load once. VRAM isn't free."
 */

// =============================================================================
// Types
// =============================================================================

export type QuantizationLevel = 'fp32' | 'fp16' | 'bf16' | 'fp8' | 'int8' | 'int4' | 'q8_0' | 'q6_k' | 'q5_k_m' | 'q4_k_m' | 'q3_k_m' | 'q2_k' | 'exl2_4bpw' | 'exl2_3bpw' | 'awq_4bit' | 'gptq_4bit';

export interface VramEstimate {
    /** Total VRAM needed in MB */
    total_mb: number;
    /** Breakdown */
    model_weights_mb: number;
    kv_cache_mb: number;
    activation_buffer_mb: number;
    runtime_overhead_mb: number;
    /** Fits on target? */
    fits_gpu: boolean;
    gpu_vram_mb: number;
    /** Headroom remaining after loading */
    headroom_mb: number;
    headroom_pct: number;
    /** Recommendations */
    recommendation: string;
}

export interface ModelArchitecture {
    params_b: number;       // Billion parameters
    layers: number;
    hidden_dim: number;
    kv_heads: number;       // Key-value heads (for GQA, this < query heads)
    head_dim: number;
    vocab_size: number;
    is_moe: boolean;
    active_params_b?: number; // For MoE: active parameters per token
}

// =============================================================================
// Bytes per parameter by quantization
// =============================================================================

const BYTES_PER_PARAM: Record<QuantizationLevel, number> = {
    'fp32': 4.0,
    'fp16': 2.0,
    'bf16': 2.0,
    'fp8': 1.0,
    'int8': 1.0,
    'q8_0': 1.0,
    'q6_k': 0.75,
    'q5_k_m': 0.625,
    'q4_k_m': 0.5,
    'q3_k_m': 0.375,
    'q2_k': 0.25,
    'int4': 0.5,
    'awq_4bit': 0.5,
    'gptq_4bit': 0.5,
    'exl2_4bpw': 0.5,
    'exl2_3bpw': 0.375,
};

// =============================================================================
// Known model architectures
// =============================================================================

const KNOWN_ARCHITECTURES: Record<string, ModelArchitecture> = {
    'llama-3.2-1b': { params_b: 1.24, layers: 16, hidden_dim: 2048, kv_heads: 8, head_dim: 64, vocab_size: 128256, is_moe: false },
    'llama-3.2-3b': { params_b: 3.21, layers: 28, hidden_dim: 3072, kv_heads: 8, head_dim: 128, vocab_size: 128256, is_moe: false },
    'llama-3.1-8b': { params_b: 8.03, layers: 32, hidden_dim: 4096, kv_heads: 8, head_dim: 128, vocab_size: 128256, is_moe: false },
    'llama-3.1-70b': { params_b: 70.6, layers: 80, hidden_dim: 8192, kv_heads: 8, head_dim: 128, vocab_size: 128256, is_moe: false },
    'llama-3.1-405b': { params_b: 405, layers: 126, hidden_dim: 16384, kv_heads: 8, head_dim: 128, vocab_size: 128256, is_moe: false },
    'llama-4-scout': { params_b: 109, layers: 60, hidden_dim: 8192, kv_heads: 8, head_dim: 128, vocab_size: 202400, is_moe: true, active_params_b: 17 },
    'llama-4-maverick': { params_b: 400, layers: 96, hidden_dim: 8192, kv_heads: 8, head_dim: 128, vocab_size: 202400, is_moe: true, active_params_b: 17 },
    'mistral-7b': { params_b: 7.24, layers: 32, hidden_dim: 4096, kv_heads: 8, head_dim: 128, vocab_size: 32000, is_moe: false },
    'mixtral-8x7b': { params_b: 46.7, layers: 32, hidden_dim: 4096, kv_heads: 8, head_dim: 128, vocab_size: 32000, is_moe: true, active_params_b: 13 },
    'qwen-2.5-7b': { params_b: 7.62, layers: 28, hidden_dim: 3584, kv_heads: 4, head_dim: 128, vocab_size: 151936, is_moe: false },
    'qwen-2.5-72b': { params_b: 72.7, layers: 80, hidden_dim: 8192, kv_heads: 8, head_dim: 128, vocab_size: 151936, is_moe: false },
    'qwen-3.5-4b': { params_b: 4.0, layers: 24, hidden_dim: 2560, kv_heads: 4, head_dim: 128, vocab_size: 151936, is_moe: false },
    'phi-4-mini': { params_b: 3.82, layers: 32, hidden_dim: 3072, kv_heads: 8, head_dim: 96, vocab_size: 100352, is_moe: false },
    'gemma-3-1b': { params_b: 1.0, layers: 18, hidden_dim: 1536, kv_heads: 4, head_dim: 256, vocab_size: 262144, is_moe: false },
    'gemma-3-4b': { params_b: 4.0, layers: 34, hidden_dim: 2560, kv_heads: 4, head_dim: 256, vocab_size: 262144, is_moe: false },
    'deepseek-v3': { params_b: 671, layers: 61, hidden_dim: 7168, kv_heads: 1, head_dim: 128, vocab_size: 129280, is_moe: true, active_params_b: 37 },
    'deepseek-r1': { params_b: 671, layers: 61, hidden_dim: 7168, kv_heads: 1, head_dim: 128, vocab_size: 129280, is_moe: true, active_params_b: 37 },
};

// =============================================================================
// Core Estimation
// =============================================================================

/**
 * Estimate VRAM requirement for a model deployment.
 *
 * @param paramsB - Billion parameters (or use modelName for lookup)
 * @param quant - Quantization level
 * @param maxSeqLen - Maximum sequence/context length
 * @param batchSize - Maximum concurrent requests
 * @param gpuVramMb - Target GPU VRAM for fit check (0 to skip)
 * @param modelName - Optional model name for architecture lookup
 */
export function estimateVram(
    paramsB: number,
    quant: QuantizationLevel = 'q4_k_m',
    maxSeqLen: number = 4096,
    batchSize: number = 1,
    gpuVramMb: number = 0,
    modelName?: string,
): VramEstimate {
    // Look up architecture if model name given
    let arch: ModelArchitecture | null = null;
    if (modelName) {
        const normalized = normalizeModelName(modelName);
        arch = KNOWN_ARCHITECTURES[normalized] || null;
        if (arch) paramsB = arch.is_moe ? (arch.active_params_b || arch.params_b) : arch.params_b;
    }

    // Estimate architecture from param count if not known
    if (!arch) {
        arch = estimateArchitecture(paramsB);
    }

    const bytesPerParam = BYTES_PER_PARAM[quant] || 0.5;

    // 1. Model weights
    const modelWeightsMb = Math.round(paramsB * bytesPerParam * 1024);

    // 2. KV cache
    // Formula: 2 * layers * kv_heads * head_dim * max_seq * batch * dtype_bytes / (1024*1024)
    const kvDtypeBytes = quant === 'fp8' ? 1 : 2; // FP8 KV cache on Hopper+, else FP16
    const kvCacheMb = Math.round(
        (2 * arch.layers * arch.kv_heads * arch.head_dim * maxSeqLen * batchSize * kvDtypeBytes) / (1024 * 1024)
    );

    // 3. Activation buffer (~10% of model for inference, ~30% for training)
    const activationMb = Math.round(modelWeightsMb * 0.1);

    // 4. Runtime overhead (CUDA/ROCm context + model metadata)
    const runtimeOverheadMb = 500; // ~300MB runtime + ~200MB per model

    const totalMb = modelWeightsMb + kvCacheMb + activationMb + runtimeOverheadMb;

    const fitsGpu = gpuVramMb > 0 ? totalMb <= gpuVramMb : true;
    const headroomMb = gpuVramMb > 0 ? gpuVramMb - totalMb : 0;
    const headroomPct = gpuVramMb > 0 ? Math.round((headroomMb / gpuVramMb) * 100) : 0;

    let recommendation = '';
    if (!fitsGpu && gpuVramMb > 0) {
        const neededReduction = totalMb - gpuVramMb;
        if (quant === 'fp16' || quant === 'bf16') {
            recommendation = `Model needs ${neededReduction}MB more. Try Q4_K_M quantization to reduce by ~75%.`;
        } else if (quant === 'q4_k_m') {
            recommendation = `Model needs ${neededReduction}MB more. Try Q3_K_M or reduce context length from ${maxSeqLen} to ${Math.round(maxSeqLen * 0.5)}.`;
        } else {
            recommendation = `Model needs ${neededReduction}MB more. Consider multi-GPU (tensor parallel) or a smaller model.`;
        }
    } else if (headroomPct < 10 && gpuVramMb > 0) {
        recommendation = `Tight fit (${headroomPct}% headroom). Reduce batch size or context length to avoid OOM under load.`;
    } else if (headroomPct > 50 && gpuVramMb > 0) {
        recommendation = `${headroomPct}% headroom — room for a second model or larger context window.`;
    }

    return {
        total_mb: totalMb,
        model_weights_mb: modelWeightsMb,
        kv_cache_mb: kvCacheMb,
        activation_buffer_mb: activationMb,
        runtime_overhead_mb: runtimeOverheadMb,
        fits_gpu: fitsGpu,
        gpu_vram_mb: gpuVramMb,
        headroom_mb: headroomMb,
        headroom_pct: headroomPct,
        recommendation,
    };
}

/** Shorthand: estimate by model name string */
export function estimateByModelName(
    modelName: string,
    quant: QuantizationLevel = 'q4_k_m',
    maxSeqLen: number = 4096,
    batchSize: number = 1,
    gpuVramMb: number = 0,
): VramEstimate {
    const normalized = normalizeModelName(modelName);
    const arch = KNOWN_ARCHITECTURES[normalized];
    const paramsB = arch ? arch.params_b : parseParamsFromName(modelName);
    return estimateVram(paramsB, quant, maxSeqLen, batchSize, gpuVramMb, modelName);
}

/** Get list of known model architectures */
export function getKnownModels(): string[] {
    return Object.keys(KNOWN_ARCHITECTURES);
}

/** Get all quantization levels with bytes per parameter */
export function getQuantizationLevels(): Array<{ level: QuantizationLevel; bytes_per_param: number; quality_retention: string }> {
    const quality: Record<string, string> = {
        'fp32': '100%', 'fp16': '100%', 'bf16': '100%', 'fp8': '~99%', 'int8': '~99%',
        'q8_0': '~99%', 'q6_k': '~97%', 'q5_k_m': '~96%', 'q4_k_m': '~92-95%',
        'q3_k_m': '~85-88%', 'q2_k': '~75-80%', 'int4': '~90-95%',
        'awq_4bit': '~95%', 'gptq_4bit': '~90-95%', 'exl2_4bpw': '~93%', 'exl2_3bpw': '~85%',
    };
    return Object.entries(BYTES_PER_PARAM).map(([level, bytes]) => ({
        level: level as QuantizationLevel,
        bytes_per_param: bytes,
        quality_retention: quality[level] || '~90%',
    }));
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeModelName(name: string): string {
    return name.toLowerCase()
        .replace(/[_:]/g, '-')
        .replace(/\.(\d)/g, '-$1')
        .replace(/--+/g, '-')
        .replace(/^(llama|mistral|qwen|phi|gemma|deepseek)-?/, '$1-')
        .replace(/instruct$|chat$|it$/, '')
        .trim()
        .replace(/-$/, '');
}

function parseParamsFromName(name: string): number {
    const match = name.match(/(\d+\.?\d*)b/i);
    if (match) return parseFloat(match[1]);
    // Common sizes
    if (name.includes('7b') || name.includes('8b')) return 8;
    if (name.includes('13b') || name.includes('14b')) return 14;
    if (name.includes('70b')) return 70;
    if (name.includes('3b') || name.includes('4b')) return 4;
    if (name.includes('1b')) return 1;
    return 7; // Default assumption
}

function estimateArchitecture(paramsB: number): ModelArchitecture {
    // Estimate architecture from parameter count using common patterns
    const layers = paramsB < 3 ? 16 : paramsB < 10 ? 32 : paramsB < 40 ? 48 : paramsB < 100 ? 80 : 96;
    const hidden = paramsB < 3 ? 2048 : paramsB < 10 ? 4096 : paramsB < 40 ? 5120 : paramsB < 100 ? 8192 : 12288;
    const kvHeads = paramsB < 10 ? 8 : paramsB < 40 ? 8 : 8;
    const headDim = 128;

    return {
        params_b: paramsB,
        layers,
        hidden_dim: hidden,
        kv_heads: kvHeads,
        head_dim: headDim,
        vocab_size: 128000,
        is_moe: false,
    };
}
