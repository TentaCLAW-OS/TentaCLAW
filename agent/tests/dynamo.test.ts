/**
 * NVIDIA Dynamo Backend — Unit Tests (Wave 41)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    isDynamoInstalled,
    getDynamoVersion,
    isNixlAvailable,
    getDynamoRecommendation,
    getDynamoState,
    getDynamoHealth,
    _resetDynamo,
} from '../src/dynamo';

beforeEach(() => {
    _resetDynamo();
});

describe('Dynamo Detection', () => {
    it('reports installed status (false in CI without Dynamo)', () => {
        const installed = isDynamoInstalled();
        expect(typeof installed).toBe('boolean');
    });

    it('returns version or null', () => {
        const version = getDynamoVersion();
        expect(version === null || typeof version === 'string').toBe(true);
    });

    it('checks NIXL availability (false on non-Linux)', () => {
        const available = isNixlAvailable();
        expect(typeof available).toBe('boolean');
    });
});

describe('Dynamo State Management', () => {
    it('starts in stopped state', () => {
        expect(getDynamoState()).toBe('stopped');
    });

    it('health reports stopped state', () => {
        const health = getDynamoHealth();
        expect(health.state).toBe('stopped');
        expect(health.natsConnected).toBe(false);
    });
});

describe('Dynamo GPU Recommendations', () => {
    it('rejects single GPU for disaggregated mode', () => {
        const rec = getDynamoRecommendation(1, 24000);
        expect(rec.recommended).toBe(false);
        expect(rec.reason).toContain('at least 2 GPUs');
    });

    it('recommends 1 prefill + 1 decode for 2 GPUs', () => {
        const rec = getDynamoRecommendation(2, 48000);
        expect(rec.recommended).toBe(true);
        expect(rec.config.prefillWorkers).toBe(1);
        expect(rec.config.decodeWorkers).toBe(1);
        expect(rec.config.prefillGpuIds).toEqual([0]);
        expect(rec.config.decodeGpuIds).toEqual([1]);
    });

    it('recommends 1 prefill + 2 decode for 3 GPUs', () => {
        const rec = getDynamoRecommendation(3, 72000);
        expect(rec.recommended).toBe(true);
        expect(rec.config.prefillWorkers).toBe(1);
        expect(rec.config.decodeWorkers).toBe(2);
    });

    it('splits 4+ GPUs with ~33% prefill / ~67% decode', () => {
        const rec = getDynamoRecommendation(6, 144000);
        expect(rec.recommended).toBe(true);
        expect(rec.config.prefillWorkers).toBe(2);
        expect(rec.config.decodeWorkers).toBe(4);
        expect(rec.config.enableNixl).toBe(true);
    });

    it('recommends 8 GPUs with correct split', () => {
        const rec = getDynamoRecommendation(8, 640000);
        expect(rec.recommended).toBe(true);
        const total = (rec.config.prefillWorkers || 0) + (rec.config.decodeWorkers || 0);
        expect(total).toBe(8);
    });

    it('enables FP8 KV cache for Hopper+ GPUs (80GB+ VRAM)', () => {
        const rec = getDynamoRecommendation(4, 320000); // 4x H100 80GB
        expect(rec.config.kvCacheDtype).toBe('fp8_e5m2');
    });

    it('uses auto KV cache for smaller GPUs', () => {
        const rec = getDynamoRecommendation(4, 64000); // 4x 16GB
        expect(rec.config.kvCacheDtype).toBe('auto');
    });

    it('always enables NIXL for multi-GPU', () => {
        const rec = getDynamoRecommendation(4, 96000);
        expect(rec.config.enableNixl).toBe(true);
    });
});
