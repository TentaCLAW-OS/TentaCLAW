/**
 * VRAM Estimator + Data Residency Tests (Waves 67 + 91)
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';

import { estimateVram, estimateByModelName, getKnownModels, getQuantizationLevels } from '../src/vram-estimator';
import {
    tagNodeRegion, getNodeRegion, listRegionTags, removeNodeRegion,
    setResidencyPolicy, getResidencyPolicy, isNodeAllowedForNamespace,
    filterNodesByResidency, verifyResidency, _resetResidency,
} from '../src/data-residency';

// =============================================================================
// VRAM Estimator
// =============================================================================

describe('VRAM Estimation', () => {
    it('estimates 8B model at FP16', () => {
        const est = estimateVram(8, 'fp16', 4096, 1);
        expect(est.model_weights_mb).toBeGreaterThan(15000);
        expect(est.model_weights_mb).toBeLessThan(17000);
        expect(est.total_mb).toBeGreaterThan(est.model_weights_mb);
    });

    it('estimates 8B model at Q4_K_M', () => {
        const est = estimateVram(8, 'q4_k_m', 4096, 1);
        expect(est.model_weights_mb).toBeGreaterThan(3500);
        expect(est.model_weights_mb).toBeLessThan(5000);
    });

    it('Q4 is roughly 25% of FP16', () => {
        const fp16 = estimateVram(8, 'fp16').model_weights_mb;
        const q4 = estimateVram(8, 'q4_k_m').model_weights_mb;
        const ratio = q4 / fp16;
        expect(ratio).toBeGreaterThan(0.2);
        expect(ratio).toBeLessThan(0.3);
    });

    it('KV cache scales with context length', () => {
        const short = estimateVram(8, 'q4_k_m', 2048, 1);
        const long = estimateVram(8, 'q4_k_m', 32768, 1);
        expect(long.kv_cache_mb).toBeGreaterThan(short.kv_cache_mb * 10);
    });

    it('KV cache scales with batch size', () => {
        const single = estimateVram(8, 'q4_k_m', 4096, 1);
        const batch8 = estimateVram(8, 'q4_k_m', 4096, 8);
        expect(batch8.kv_cache_mb).toBe(single.kv_cache_mb * 8);
    });

    it('checks GPU fit', () => {
        const fits = estimateVram(8, 'q4_k_m', 4096, 1, 16000);
        expect(fits.fits_gpu).toBe(true);
        expect(fits.headroom_mb).toBeGreaterThan(0);

        const noFit = estimateVram(70, 'fp16', 4096, 1, 16000);
        expect(noFit.fits_gpu).toBe(false);
        expect(noFit.recommendation).toContain('more');
    });

    it('provides recommendation when tight', () => {
        const est = estimateVram(8, 'q4_k_m', 4096, 1, 5500);
        if (est.headroom_pct < 10) {
            expect(est.recommendation).toBeTruthy();
        }
    });
});

describe('VRAM Estimation by Model Name', () => {
    it('estimates llama-3.1-8b correctly', () => {
        const est = estimateByModelName('llama-3.1-8b', 'q4_k_m');
        expect(est.model_weights_mb).toBeGreaterThan(3000);
        expect(est.model_weights_mb).toBeLessThan(5000);
    });

    it('estimates phi-4-mini correctly', () => {
        const est = estimateByModelName('phi-4-mini', 'q4_k_m');
        expect(est.model_weights_mb).toBeGreaterThan(1500);
        expect(est.model_weights_mb).toBeLessThan(2500);
    });

    it('estimates 70B model', () => {
        const est = estimateByModelName('llama-3.1-70b', 'q4_k_m');
        expect(est.model_weights_mb).toBeGreaterThan(30000);
        expect(est.model_weights_mb).toBeLessThan(40000);
    });

    it('handles MoE models (active params)', () => {
        const est = estimateByModelName('llama-4-scout', 'q4_k_m');
        // Scout: 109B total but 17B active — VRAM should reflect active params
        expect(est.model_weights_mb).toBeLessThan(10000);
    });

    it('handles unknown model names gracefully', () => {
        const est = estimateByModelName('totally-unknown-model-7b', 'q4_k_m');
        expect(est.total_mb).toBeGreaterThan(0);
    });

    it('knows 15+ model architectures', () => {
        expect(getKnownModels().length).toBeGreaterThanOrEqual(15);
    });

    it('lists all quantization levels', () => {
        const levels = getQuantizationLevels();
        expect(levels.length).toBeGreaterThanOrEqual(15);
        expect(levels.find(l => l.level === 'q4_k_m')?.bytes_per_param).toBe(0.5);
    });
});

// =============================================================================
// Data Residency
// =============================================================================

describe('Region Tagging', () => {
    beforeEach(() => _resetResidency());

    it('tags a node with region', () => {
        tagNodeRegion('node-1', 'eu-west', 'DE');
        const tag = getNodeRegion('node-1');
        expect(tag?.region).toBe('eu-west');
        expect(tag?.country_code).toBe('DE');
    });

    it('returns null for untagged node', () => {
        expect(getNodeRegion('nonexistent')).toBeNull();
    });

    it('removes region tag', () => {
        tagNodeRegion('node-1', 'us-east');
        expect(removeNodeRegion('node-1')).toBe(true);
        expect(getNodeRegion('node-1')).toBeNull();
    });
});

describe('Residency Policies', () => {
    beforeEach(() => _resetResidency());

    it('sets and retrieves policy', () => {
        const policy = setResidencyPolicy('healthcare', ['eu-west', 'eu-central']);
        expect(policy.namespace).toBe('healthcare');
        expect(policy.allowed_regions).toEqual(['eu-west', 'eu-central']);
        expect(getResidencyPolicy('healthcare')).toBeTruthy();
    });

    it('returns null for no policy', () => {
        expect(getResidencyPolicy('nonexistent')).toBeNull();
    });
});

describe('Residency Enforcement', () => {
    beforeEach(() => _resetResidency());

    it('allows node in permitted region', () => {
        tagNodeRegion('node-eu', 'eu-west');
        setResidencyPolicy('data', ['eu-west']);
        const check = isNodeAllowedForNamespace('node-eu', 'data');
        expect(check.allowed).toBe(true);
    });

    it('denies node outside permitted region', () => {
        tagNodeRegion('node-us', 'us-east');
        setResidencyPolicy('eu-data', ['eu-west', 'eu-central']);
        const check = isNodeAllowedForNamespace('node-us', 'eu-data');
        expect(check.allowed).toBe(false);
        expect(check.reason).toContain('not in allowed list');
    });

    it('denies node in denied region', () => {
        tagNodeRegion('node-cn', 'ap-northeast');
        setResidencyPolicy('us-only', [], ['ap-northeast']);
        const check = isNodeAllowedForNamespace('node-cn', 'us-only');
        expect(check.allowed).toBe(false);
    });

    it('denies untagged node', () => {
        setResidencyPolicy('strict', ['eu-west']);
        const check = isNodeAllowedForNamespace('untagged-node', 'strict');
        expect(check.allowed).toBe(false);
        expect(check.reason).toContain('no region tag');
    });

    it('allows all when no policy', () => {
        tagNodeRegion('any-node', 'us-east');
        const check = isNodeAllowedForNamespace('any-node', 'no-policy');
        expect(check.allowed).toBe(true);
    });

    it('filters nodes by residency', () => {
        tagNodeRegion('eu-1', 'eu-west');
        tagNodeRegion('eu-2', 'eu-central');
        tagNodeRegion('us-1', 'us-east');
        setResidencyPolicy('eu-only', ['eu-west', 'eu-central']);

        const result = filterNodesByResidency(['eu-1', 'eu-2', 'us-1'], 'eu-only');
        expect(result.allowed).toEqual(['eu-1', 'eu-2']);
        expect(result.denied).toHaveLength(1);
        expect(result.denied[0].node_id).toBe('us-1');
    });
});
