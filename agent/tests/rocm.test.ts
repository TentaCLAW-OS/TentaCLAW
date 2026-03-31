/**
 * AMD ROCm Optimization Tests (Wave 62)
 */

import { describe, it, expect } from 'vitest';
import {
    isRocmInstalled, getRocmVersion, getHipVersion,
    detectAmdGpus, getOptimizedRocmEnv, getAmdRecommendations,
    getRocmConfig,
} from '../src/rocm';
import type { AmdGpuInfo } from '../src/rocm';

describe('ROCm Detection', () => {
    it('reports ROCm installed status', () => {
        expect(typeof isRocmInstalled()).toBe('boolean');
    });

    it('returns version or null', () => {
        const v = getRocmVersion();
        expect(v === null || typeof v === 'string').toBe(true);
    });

    it('returns HIP version or null', () => {
        const v = getHipVersion();
        expect(v === null || typeof v === 'string').toBe(true);
    });

    it('detects GPUs (empty on non-AMD systems)', () => {
        const gpus = detectAmdGpus();
        expect(Array.isArray(gpus)).toBe(true);
    });
});

describe('ROCm Optimization', () => {
    const mockMi300x: AmdGpuInfo = {
        index: 0, name: 'AMD Instinct MI300X', family: 'mi300',
        vramMb: 192000, vramUsedMb: 50000, temperatureC: 65, powerDrawW: 300,
        utilizationPct: 80, rocmVersion: '6.2.0', hipVersion: '6.2.0',
        computeUnits: 304, gfxVersion: 'gfx942', supportsFp8: false, supportsFlashAttention: true,
    };

    const mockMi350: AmdGpuInfo = {
        index: 0, name: 'AMD Instinct MI350X', family: 'mi350',
        vramMb: 288000, vramUsedMb: 80000, temperatureC: 60, powerDrawW: 350,
        utilizationPct: 90, rocmVersion: '7.0.0', hipVersion: '7.0.0',
        computeUnits: 0, gfxVersion: 'gfx950', supportsFp8: true, supportsFlashAttention: true,
    };

    it('generates optimized env for MI300X', () => {
        const env = getOptimizedRocmEnv([mockMi300x]);
        expect(env['VLLM_USE_ROCM_FLASH_ATTN_V2']).toBe('1');
        expect(env['CK_FLASH_ATTENTION_INTERNAL']).toBe('1');
        expect(env['HSA_FORCE_FINE_GRAIN_PCIE']).toBe('1');
    });

    it('enables FP8 for MI350/CDNA4', () => {
        const env = getOptimizedRocmEnv([mockMi350]);
        expect(env['ROCM_FP8_ENABLED']).toBe('1');
    });

    it('enables RCCL for multi-GPU', () => {
        const env = getOptimizedRocmEnv([mockMi300x, { ...mockMi300x, index: 1 }]);
        expect(env['RCCL_MSCCL_ENABLE']).toBe('1');
    });

    it('returns empty env for no GPUs', () => {
        const env = getOptimizedRocmEnv([]);
        expect(Object.keys(env)).toHaveLength(0);
    });
});

describe('ROCm Recommendations', () => {
    it('recommends ROCm install when no GPUs', () => {
        const recs = getAmdRecommendations([]);
        expect(recs[0]).toContain('No AMD GPUs');
    });

    it('recommends FP8 for MI350', () => {
        const recs = getAmdRecommendations([{
            index: 0, name: 'MI350X', family: 'mi350', vramMb: 288000,
            vramUsedMb: 0, temperatureC: 55, powerDrawW: 300, utilizationPct: 0,
            rocmVersion: '7.0.0', hipVersion: '7.0.0', computeUnits: 0,
            gfxVersion: 'gfx950', supportsFp8: true, supportsFlashAttention: true,
        }]);
        expect(recs.some(r => r.includes('FP8'))).toBe(true);
    });

    it('warns about high temperature', () => {
        const recs = getAmdRecommendations([{
            index: 0, name: 'MI300X', family: 'mi300', vramMb: 192000,
            vramUsedMb: 0, temperatureC: 85, powerDrawW: 400, utilizationPct: 95,
            rocmVersion: '6.2.0', hipVersion: '6.2.0', computeUnits: 304,
            gfxVersion: 'gfx942', supportsFp8: false, supportsFlashAttention: true,
        }]);
        expect(recs.some(r => r.includes('Temperature'))).toBe(true);
    });

    it('warns about outdated ROCm', () => {
        const recs = getAmdRecommendations([{
            index: 0, name: 'MI300X', family: 'mi300', vramMb: 192000,
            vramUsedMb: 0, temperatureC: 55, powerDrawW: 300, utilizationPct: 0,
            rocmVersion: '5.7.0', hipVersion: '5.7.0', computeUnits: 304,
            gfxVersion: 'gfx942', supportsFp8: false, supportsFlashAttention: true,
        }]);
        expect(recs.some(r => r.includes('outdated'))).toBe(true);
    });
});

describe('ROCm Config Report', () => {
    it('generates config report', () => {
        const config = getRocmConfig();
        expect(config).toHaveProperty('version');
        expect(config).toHaveProperty('gpus');
        expect(config).toHaveProperty('optimizations');
        expect(config).toHaveProperty('warnings');
    });
});
