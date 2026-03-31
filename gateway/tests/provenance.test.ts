/**
 * Model Provenance Tracking Tests (Wave 92)
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';

import {
    registerProvenance, getProvenance, listProvenances, verifyModelIntegrity,
    setTrustPolicy, getTrustPolicy, checkTrustPolicy,
    generateAiSbom, getProvenanceEvents, logDeployment,
    _resetProvenance,
} from '../src/model-provenance';

beforeEach(() => _resetProvenance());

describe('Model Registration', () => {
    it('registers model provenance', () => {
        registerProvenance('llama-8b', 'abc123hash', 'huggingface', { format: 'safetensors', size_bytes: 5000000000 });
        const prov = getProvenance('llama-8b');
        expect(prov).toBeTruthy();
        expect(prov!.hash_sha256).toBe('abc123hash');
        expect(prov!.source).toBe('huggingface');
        expect(prov!.format).toBe('safetensors');
    });

    it('returns null for unregistered model', () => {
        expect(getProvenance('nonexistent')).toBeNull();
    });

    it('lists all provenances', () => {
        registerProvenance('model-a', 'hash-a', 'huggingface');
        registerProvenance('model-b', 'hash-b', 'clawhub');
        expect(listProvenances()).toHaveLength(2);
    });

    it('updates on re-register', () => {
        registerProvenance('model-a', 'hash-1', 'huggingface');
        registerProvenance('model-a', 'hash-2', 'huggingface');
        expect(getProvenance('model-a')!.hash_sha256).toBe('hash-2');
    });
});

describe('Hash Verification', () => {
    it('verifies matching hash', () => {
        registerProvenance('model-x', 'correct-hash', 'local');
        const result = verifyModelIntegrity('model-x', 'correct-hash');
        expect(result.valid).toBe(true);
    });

    it('detects tampered model', () => {
        registerProvenance('model-x', 'original-hash', 'local');
        const result = verifyModelIntegrity('model-x', 'different-hash');
        expect(result.valid).toBe(false);
        expect(result.expected).toBe('original-hash');
    });

    it('rejects unregistered model', () => {
        const result = verifyModelIntegrity('unknown', 'some-hash');
        expect(result.valid).toBe(false);
        expect(result.expected).toBe('not_registered');
    });
});

describe('Trust Policies', () => {
    it('default policy is warn_unsigned', () => {
        expect(getTrustPolicy()).toBe('warn_unsigned');
    });

    it('allow_all allows everything', () => {
        setTrustPolicy('allow_all');
        expect(checkTrustPolicy('any-model').allowed).toBe(true);
    });

    it('warn_unsigned allows but warns', () => {
        setTrustPolicy('warn_unsigned');
        expect(checkTrustPolicy('unsigned-model').allowed).toBe(true);
    });

    it('reject_unsigned blocks unregistered', () => {
        setTrustPolicy('reject_unsigned');
        expect(checkTrustPolicy('unregistered').allowed).toBe(false);
    });

    it('reject_unsigned allows verified', () => {
        setTrustPolicy('reject_unsigned');
        registerProvenance('verified-model', 'hash', 'hf', { verified: true });
        expect(checkTrustPolicy('verified-model').allowed).toBe(true);
    });

    it('require_signed blocks unsigned', () => {
        setTrustPolicy('require_signed');
        registerProvenance('unsigned', 'hash', 'hf');
        expect(checkTrustPolicy('unsigned').allowed).toBe(false);
    });

    it('require_signed allows signed', () => {
        setTrustPolicy('require_signed');
        registerProvenance('signed-model', 'hash', 'hf', { signed: true, signature: 'sig123' });
        expect(checkTrustPolicy('signed-model').allowed).toBe(true);
    });
});

describe('AI SBOM Generation', () => {
    it('generates CycloneDX SBOM', () => {
        registerProvenance('llama-8b', 'sha256hash', 'huggingface', { format: 'safetensors', quantization: 'q4_k_m' });
        const sbom = generateAiSbom('llama-8b');
        expect(sbom.bomFormat).toBe('CycloneDX');
        expect(sbom.specVersion).toBe('1.6');
        expect((sbom.components as any[])[0].type).toBe('machine-learning-model');
        expect((sbom.components as any[])[0].hashes[0].content).toBe('sha256hash');
    });

    it('generates SBOM for unknown model', () => {
        const sbom = generateAiSbom('unknown-model');
        expect(sbom.bomFormat).toBe('CycloneDX');
        expect((sbom.components as any[])[0].hashes).toHaveLength(0);
    });
});

describe('Provenance Events', () => {
    it('logs events on registration', () => {
        registerProvenance('model-a', 'hash', 'hf');
        const events = getProvenanceEvents('model-a');
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0].event).toBe('downloaded');
    });

    it('logs deployment events', () => {
        registerProvenance('model-a', 'hash', 'hf');
        logDeployment('model-a', 'node-1');
        const events = getProvenanceEvents('model-a');
        expect(events.some((e: any) => e.event === 'deployed')).toBe(true);
    });

    it('logs tamper detection', () => {
        registerProvenance('model-a', 'original', 'hf');
        verifyModelIntegrity('model-a', 'tampered');
        const events = getProvenanceEvents('model-a');
        expect(events.some((e: any) => e.event === 'tampered')).toBe(true);
    });
});
