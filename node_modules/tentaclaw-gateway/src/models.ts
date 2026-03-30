/**
 * TentaCLAW Model Catalog — Unified Model Discovery & Management
 * CLAWtopus says: "135,000 models on HuggingFace. I know which ones fit your cluster."
 */

// =============================================================================
// VRAM Estimation Engine
// =============================================================================

interface VramEstimate {
    model_weights_mb: number;
    kv_cache_mb: number;
    activation_mb: number;
    overhead_mb: number;
    total_mb: number;
}

/**
 * Parse parameter count from model name (e.g., "llama3.1:8b" → 8_000_000_000)
 */
export function parseParamCount(modelName: string): number {
    const lower = modelName.toLowerCase();
    // Match patterns like "8b", "70b", "1.5b", "405b", "0.5b"
    const match = lower.match(/(\d+\.?\d*)\s*b(?:illion)?/);
    if (match) return parseFloat(match[1]) * 1_000_000_000;

    // Match patterns like "8B", "70B" at end or before quantization
    const match2 = lower.match(/[-_](\d+\.?\d*)b[-_:]/);
    if (match2) return parseFloat(match2[1]) * 1_000_000_000;

    // Match MoE active params (e.g., "397b-17b-active")
    const moeMatch = lower.match(/(\d+\.?\d*)b.*?(\d+\.?\d*)b.*active/);
    if (moeMatch) return parseFloat(moeMatch[2]) * 1_000_000_000; // Use active params

    // Common model sizes by name
    const KNOWN_SIZES: Record<string, number> = {
        'phi3:mini': 3.8e9, 'phi3:medium': 14e9, 'phi3:small': 7e9,
        'gemma:2b': 2e9, 'gemma:7b': 7e9, 'gemma:27b': 27e9,
        'mistral': 7e9, 'mixtral': 46.7e9, // 46.7B total, 12.9B active
        'codellama': 7e9, 'dolphin-mistral': 7e9,
    };

    for (const [key, size] of Object.entries(KNOWN_SIZES)) {
        if (lower.includes(key)) return size;
    }

    return 7e9; // Default assumption: 7B
}

/**
 * Bytes per parameter for each quantization level
 */
const QUANT_BYTES: Record<string, number> = {
    'Q2_K': 0.3125,    // 2.5 bits
    'Q3_K_S': 0.375,   // 3 bits
    'Q3_K_M': 0.40625, // 3.25 bits
    'Q4_0': 0.5,       // 4 bits
    'Q4_K_S': 0.5,     // 4 bits
    'Q4_K_M': 0.5625,  // 4.5 bits
    'Q5_0': 0.625,     // 5 bits
    'Q5_K_S': 0.625,   // 5 bits
    'Q5_K_M': 0.6875,  // 5.5 bits
    'Q6_K': 0.75,      // 6 bits
    'Q8_0': 1.0,       // 8 bits
    'GPTQ': 0.5,       // 4-bit GPTQ
    'AWQ': 0.5,        // 4-bit AWQ
    'EXL2': 0.5,       // Variable, estimate 4-bit
    'FP16': 2.0,       // 16-bit float
    'BF16': 2.0,       // 16-bit bfloat
    'FP32': 4.0,       // 32-bit float
    'FP8': 1.0,        // 8-bit float
    'INT8': 1.0,       // 8-bit integer
    'INT4': 0.5,       // 4-bit integer
    '1BIT': 0.125,     // 1-bit (BitNet)
};

/**
 * Estimate VRAM requirement for a model
 */
export function estimateVramDetailed(
    modelName: string,
    quantization: string = 'Q4_K_M',
    contextLength: number = 4096,
): VramEstimate {
    const params = parseParamCount(modelName);
    const bytesPerParam = QUANT_BYTES[quantization.toUpperCase()] || QUANT_BYTES['Q4_K_M'];

    // Model weights
    const model_weights_mb = Math.ceil((params * bytesPerParam) / (1024 * 1024));

    // KV cache: ~2 bytes per token per layer per head_dim
    // Rough estimate: params^0.5 * context_length * 0.001 MB
    const layers = Math.ceil(Math.sqrt(params / 1e9) * 32); // Rough layer count
    const kv_cache_mb = Math.ceil((layers * contextLength * 2 * 128) / (1024 * 1024)); // 128 = head_dim

    // Activation memory: ~10% of model weights
    const activation_mb = Math.ceil(model_weights_mb * 0.1);

    // CUDA/driver overhead: ~500MB base + 5% of model
    const overhead_mb = 500 + Math.ceil(model_weights_mb * 0.05);

    return {
        model_weights_mb,
        kv_cache_mb,
        activation_mb,
        overhead_mb,
        total_mb: model_weights_mb + kv_cache_mb + activation_mb + overhead_mb,
    };
}

// =============================================================================
// Model Format Detection
// =============================================================================

export type ModelFormat = 'gguf' | 'gptq' | 'awq' | 'exl2' | 'safetensors' | 'fp16' | 'bitnet' | 'unknown';

/**
 * Detect model format from name/path
 */
export function detectModelFormat(modelName: string): ModelFormat {
    const lower = modelName.toLowerCase();
    if (lower.includes('.gguf') || lower.includes('gguf')) return 'gguf';
    if (lower.includes('gptq')) return 'gptq';
    if (lower.includes('awq')) return 'awq';
    if (lower.includes('exl2')) return 'exl2';
    if (lower.includes('bitnet') || lower.includes('1bit')) return 'bitnet';
    if (lower.includes('fp16') || lower.includes('f16')) return 'fp16';
    if (lower.includes('safetensors')) return 'safetensors';
    // Ollama models are GGUF by default
    if (!lower.includes('/')) return 'gguf'; // No org/ prefix = Ollama model
    return 'safetensors'; // HuggingFace default
}

/**
 * Recommend best backend for a model format
 */
export function recommendBackend(format: ModelFormat): string[] {
    switch (format) {
        case 'gguf': return ['ollama', 'llamacpp'];
        case 'gptq': return ['vllm', 'exllamav2'];
        case 'awq': return ['vllm'];
        case 'exl2': return ['exllamav2'];
        case 'safetensors': return ['vllm', 'sglang'];
        case 'fp16': return ['vllm', 'sglang'];
        case 'bitnet': return ['bitnet'];
        default: return ['ollama', 'vllm'];
    }
}

// =============================================================================
// Model Recommendations
// =============================================================================

interface ModelRecommendation {
    model: string;
    quantization: string;
    format: ModelFormat;
    vram_required_mb: number;
    recommended_backend: string;
    description: string;
    use_case: string;
}

/**
 * Get recommended models for available VRAM
 */
export function getRecommendedModels(availableVramMb: number): ModelRecommendation[] {
    const recommendations: ModelRecommendation[] = [];

    const MODELS = [
        { model: 'phi3:mini', q: 'Q4_K_M', use: 'Lightweight chat', desc: 'Small but capable' },
        { model: 'llama3.2:3b', q: 'Q4_K_M', use: 'Basic tasks', desc: 'Good for simple queries' },
        { model: 'gemma:7b', q: 'Q4_K_M', use: 'General purpose', desc: 'Google\'s efficient model' },
        { model: 'llama3.1:8b', q: 'Q4_K_M', use: 'General chat', desc: 'Best all-rounder at 8B' },
        { model: 'codellama:7b', q: 'Q4_K_M', use: 'Code generation', desc: 'Optimized for code' },
        { model: 'deepseek-r1:8b', q: 'Q4_K_M', use: 'Reasoning', desc: 'Strong reasoning chain' },
        { model: 'qwen2.5:14b', q: 'Q4_K_M', use: 'Advanced chat', desc: 'High quality, multilingual' },
        { model: 'qwen2.5:32b', q: 'Q4_K_M', use: 'Professional', desc: 'Near GPT-4 quality' },
        { model: 'llama3.1:70b', q: 'Q4_K_M', use: 'Premium', desc: 'Top-tier open model' },
        { model: 'deepseek-r1:70b', q: 'Q4_K_M', use: 'Premium reasoning', desc: 'Best reasoning model' },
        { model: 'qwen3.5:72b', q: 'Q4_K_M', use: 'Frontier', desc: 'Beats GPT-5 on benchmarks' },
    ];

    for (const m of MODELS) {
        const estimate = estimateVramDetailed(m.model, m.q);
        if (estimate.total_mb <= availableVramMb) {
            recommendations.push({
                model: m.model,
                quantization: m.q,
                format: 'gguf',
                vram_required_mb: estimate.total_mb,
                recommended_backend: 'ollama',
                description: m.desc,
                use_case: m.use,
            });
        }
    }

    return recommendations;
}

// =============================================================================
// Quantization Recommendations
// =============================================================================

/**
 * Recommend best quantization for available VRAM
 */
export function recommendQuantization(modelName: string, availableVramMb: number): {
    recommended: string;
    all_options: Array<{ quantization: string; vram_mb: number; fits: boolean; quality: string }>;
} {
    const quants = ['Q2_K', 'Q3_K_M', 'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0', 'FP16'];
    const quality = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent', 'Near-Lossless', 'Lossless'];

    const options = quants.map((q, i) => {
        const est = estimateVramDetailed(modelName, q);
        return { quantization: q, vram_mb: est.total_mb, fits: est.total_mb <= availableVramMb, quality: quality[i] };
    });

    // Recommend the highest quality that fits
    const fitsOptions = options.filter(o => o.fits);
    const recommended = fitsOptions.length > 0 ? fitsOptions[fitsOptions.length - 1].quantization : options[0].quantization;

    return { recommended, all_options: options };
}
