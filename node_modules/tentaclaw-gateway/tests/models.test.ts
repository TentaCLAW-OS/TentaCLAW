/**
 * TentaCLAW Gateway — Model Intelligence Tests
 *
 * Tests parameter parsing, VRAM estimation, format detection,
 * backend recommendation, model recommendations, and quantization recommendations.
 * These functions are pure (no DB dependency) so no mocking is needed.
 */

import { describe, it, expect } from 'vitest';

import {
    parseParamCount,
    estimateVramDetailed,
    detectModelFormat,
    recommendBackend,
    getRecommendedModels,
    recommendQuantization,
} from '../src/models';

// =============================================================================
// Parameter Parsing
// =============================================================================

describe('Parameter Parsing', () => {
    it('parses "llama3.1:8b" to 8B', () => {
        const count = parseParamCount('llama3.1:8b');
        expect(count).toBe(8_000_000_000);
    });

    it('parses "deepseek-r1:70b" to 70B', () => {
        const count = parseParamCount('deepseek-r1:70b');
        expect(count).toBe(70_000_000_000);
    });

    it('parses "phi3:mini" to 3.8B', () => {
        const count = parseParamCount('phi3:mini');
        expect(count).toBe(3.8e9);
    });

    it('handles unknown models with default', () => {
        const count = parseParamCount('totally-unknown-model');
        expect(count).toBe(7e9); // default 7B
    });

    it('parses "1.5b" fractional param counts', () => {
        const count = parseParamCount('qwen:1.5b');
        expect(count).toBe(1.5e9);
    });

    it('parses "gemma:27b" correctly', () => {
        const count = parseParamCount('gemma:27b');
        expect(count).toBe(27e9);
    });
});

// =============================================================================
// VRAM Estimation
// =============================================================================

describe('VRAM Estimation', () => {
    it('8B Q4_K_M is approximately 4-6 GB', () => {
        const est = estimateVramDetailed('llama3.1:8b', 'Q4_K_M');
        const totalGb = est.total_mb / 1024;
        expect(totalGb).toBeGreaterThan(3);
        expect(totalGb).toBeLessThan(8);
    });

    it('70B Q4_K_M is approximately 35-45 GB', () => {
        const est = estimateVramDetailed('llama3.1:70b', 'Q4_K_M');
        const totalGb = est.total_mb / 1024;
        expect(totalGb).toBeGreaterThan(30);
        expect(totalGb).toBeLessThan(55);
    });

    it('8B FP16 is approximately 16 GB', () => {
        const est = estimateVramDetailed('llama3.1:8b', 'FP16');
        const totalGb = est.total_mb / 1024;
        expect(totalGb).toBeGreaterThan(12);
        expect(totalGb).toBeLessThan(22);
    });

    it('context length affects KV cache', () => {
        const short = estimateVramDetailed('llama3.1:8b', 'Q4_K_M', 2048);
        const long = estimateVramDetailed('llama3.1:8b', 'Q4_K_M', 16384);
        expect(long.kv_cache_mb).toBeGreaterThan(short.kv_cache_mb);
    });

    it('returns all expected fields', () => {
        const est = estimateVramDetailed('llama3.1:8b');
        expect(est).toHaveProperty('model_weights_mb');
        expect(est).toHaveProperty('kv_cache_mb');
        expect(est).toHaveProperty('activation_mb');
        expect(est).toHaveProperty('overhead_mb');
        expect(est).toHaveProperty('total_mb');
    });

    it('total equals sum of components', () => {
        const est = estimateVramDetailed('llama3.1:8b', 'Q4_K_M');
        expect(est.total_mb).toBe(
            est.model_weights_mb + est.kv_cache_mb + est.activation_mb + est.overhead_mb,
        );
    });
});

// =============================================================================
// Format Detection
// =============================================================================

describe('Format Detection', () => {
    it('detects GGUF from filename', () => {
        expect(detectModelFormat('llama-3.1-8b.gguf')).toBe('gguf');
    });

    it('detects GPTQ from name', () => {
        expect(detectModelFormat('TheBloke/Llama-2-7B-GPTQ')).toBe('gptq');
    });

    it('detects AWQ from name', () => {
        expect(detectModelFormat('TheBloke/Llama-2-7B-AWQ')).toBe('awq');
    });

    it('Ollama names default to GGUF', () => {
        // No org/ prefix means Ollama model
        expect(detectModelFormat('llama3.1:8b')).toBe('gguf');
    });

    it('HuggingFace names default to SafeTensors', () => {
        // Has org/ prefix, no other format marker
        expect(detectModelFormat('meta-llama/Meta-Llama-3.1-8B')).toBe('safetensors');
    });

    it('detects bitnet format', () => {
        expect(detectModelFormat('microsoft/bitnet-b1.58')).toBe('bitnet');
    });

    it('detects EXL2 format', () => {
        expect(detectModelFormat('TheBloke/Llama-2-7B-exl2')).toBe('exl2');
    });

    it('detects FP16 from name', () => {
        expect(detectModelFormat('some-model-fp16')).toBe('fp16');
    });
});

// =============================================================================
// Backend Recommendation
// =============================================================================

describe('Backend Recommendation', () => {
    it('GGUF recommends ollama/llamacpp', () => {
        const backends = recommendBackend('gguf');
        expect(backends).toContain('ollama');
        expect(backends).toContain('llamacpp');
    });

    it('GPTQ recommends vllm', () => {
        const backends = recommendBackend('gptq');
        expect(backends).toContain('vllm');
    });

    it('BitNet recommends bitnet backend', () => {
        const backends = recommendBackend('bitnet');
        expect(backends).toContain('bitnet');
    });

    it('SafeTensors recommends vllm/sglang', () => {
        const backends = recommendBackend('safetensors');
        expect(backends).toContain('vllm');
        expect(backends).toContain('sglang');
    });

    it('AWQ recommends vllm', () => {
        const backends = recommendBackend('awq');
        expect(backends).toContain('vllm');
    });

    it('unknown format returns defaults', () => {
        const backends = recommendBackend('unknown');
        expect(backends.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Model Recommendations
// =============================================================================

describe('Model Recommendations', () => {
    it('8GB VRAM gets small models', () => {
        const recs = getRecommendedModels(8 * 1024);
        expect(recs.length).toBeGreaterThan(0);
        // Should include small models like phi3:mini or llama3.2:3b
        const modelNames = recs.map(r => r.model);
        const hasSmall = modelNames.some(m =>
            m.includes('phi3') || m.includes('3b') || m.includes('mini'),
        );
        expect(hasSmall).toBe(true);
    });

    it('24GB VRAM gets medium models', () => {
        const recs = getRecommendedModels(24 * 1024);
        expect(recs.length).toBeGreaterThan(2);
        // Should include 8b models
        const has8b = recs.some(r => r.model.includes('8b'));
        expect(has8b).toBe(true);
    });

    it('48GB+ VRAM gets large models', () => {
        const recs = getRecommendedModels(48 * 1024);
        expect(recs.length).toBeGreaterThan(4);
        // Should include some medium/large models
        const hasLarger = recs.some(r =>
            r.model.includes('14b') || r.model.includes('32b'),
        );
        expect(hasLarger).toBe(true);
    });

    it('returns empty for tiny VRAM', () => {
        const recs = getRecommendedModels(512); // 512 MB — too small for anything
        expect(recs.length).toBe(0);
    });

    it('all recommendations have required fields', () => {
        const recs = getRecommendedModels(24 * 1024);
        for (const rec of recs) {
            expect(rec).toHaveProperty('model');
            expect(rec).toHaveProperty('quantization');
            expect(rec).toHaveProperty('format');
            expect(rec).toHaveProperty('vram_required_mb');
            expect(rec).toHaveProperty('recommended_backend');
            expect(rec).toHaveProperty('description');
            expect(rec).toHaveProperty('use_case');
        }
    });

    it('recommendations are sorted by VRAM requirement (ascending)', () => {
        const recs = getRecommendedModels(48 * 1024);
        for (let i = 1; i < recs.length; i++) {
            expect(recs[i].vram_required_mb).toBeGreaterThanOrEqual(recs[i - 1].vram_required_mb);
        }
    });
});

// =============================================================================
// Quantization Recommendations
// =============================================================================

describe('Quantization Recommendations', () => {
    it('recommends highest quality that fits', () => {
        // 24GB should fit several quantizations for 8B model
        const result = recommendQuantization('llama3.1:8b', 24 * 1024);
        expect(result.recommended).toBeDefined();
        // The recommended quant should fit
        const recOption = result.all_options.find(o => o.quantization === result.recommended);
        expect(recOption).toBeDefined();
        expect(recOption!.fits).toBe(true);
    });

    it('lists all options with fit status', () => {
        const result = recommendQuantization('llama3.1:8b', 24 * 1024);
        expect(result.all_options.length).toBeGreaterThan(0);
        for (const opt of result.all_options) {
            expect(opt).toHaveProperty('quantization');
            expect(opt).toHaveProperty('vram_mb');
            expect(opt).toHaveProperty('fits');
            expect(opt).toHaveProperty('quality');
            expect(typeof opt.fits).toBe('boolean');
        }
    });

    it('small VRAM forces low quantization', () => {
        // 4GB: only the smallest quants should fit for 8B
        const result = recommendQuantization('llama3.1:8b', 4 * 1024);
        // The recommended quant should be a low one (Q2 or Q3)
        expect(['Q2_K', 'Q3_K_M', 'Q4_K_M']).toContain(result.recommended);
    });

    it('large VRAM allows FP16', () => {
        // 80GB: even FP16 should fit for 8B
        const result = recommendQuantization('llama3.1:8b', 80 * 1024);
        expect(result.recommended).toBe('FP16');
    });

    it('quality labels go from poor to lossless', () => {
        const result = recommendQuantization('llama3.1:8b', 24 * 1024);
        const qualities = result.all_options.map(o => o.quality);
        expect(qualities[0]).toBe('Poor');
        expect(qualities[qualities.length - 1]).toBe('Lossless');
    });

    it('70B model needs large VRAM for high quant', () => {
        const result = recommendQuantization('llama3.1:70b', 24 * 1024);
        // FP16 for 70B ≈ 140GB, should not fit in 24GB
        const fp16 = result.all_options.find(o => o.quantization === 'FP16');
        expect(fp16).toBeDefined();
        expect(fp16!.fits).toBe(false);
    });
});
