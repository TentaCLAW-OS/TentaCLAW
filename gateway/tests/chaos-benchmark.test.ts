/**
 * Chaos Engineering + Benchmark Regression Tests (Waves 60 + 76)
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';

import { detectRegressions, generateCiReport } from '../src/experimental/benchmark-engine';
import { createExperiment, injectChaos, listExperiments, listActions, clearExperiments, _resetChaos } from '../src/experimental/chaos';

// =============================================================================
// Wave 60: Regression Detection
// =============================================================================

describe('Benchmark Regression Detection', () => {
    const baseline = { tokens_per_sec: 100, ttft_ms: 50, latency_p99_ms: 200, throughput_rps: 10 };

    it('detects no regression when performance unchanged', () => {
        const current = { ...baseline };
        const results = detectRegressions(baseline, current);
        expect(results.every(r => !r.regression)).toBe(true);
    });

    it('detects TPS regression (>5% decrease)', () => {
        const current = { ...baseline, tokens_per_sec: 90 }; // 10% drop
        const results = detectRegressions(baseline, current);
        const tps = results.find(r => r.metric === 'tokens_per_sec');
        expect(tps?.regression).toBe(true);
        expect(tps?.changePercent).toBe(-10);
    });

    it('detects latency regression (>5% increase)', () => {
        const current = { ...baseline, latency_p99_ms: 220 }; // 10% increase
        const results = detectRegressions(baseline, current);
        const lat = results.find(r => r.metric === 'latency_p99_ms');
        expect(lat?.regression).toBe(true);
        expect(lat?.changePercent).toBe(10);
    });

    it('ignores minor changes within threshold', () => {
        const current = { ...baseline, tokens_per_sec: 97 }; // 3% drop — within 5%
        const results = detectRegressions(baseline, current);
        const tps = results.find(r => r.metric === 'tokens_per_sec');
        expect(tps?.regression).toBe(false);
    });

    it('detects TTFT regression', () => {
        const current = { ...baseline, ttft_ms: 60 }; // 20% increase
        const results = detectRegressions(baseline, current);
        const ttft = results.find(r => r.metric === 'ttft_ms');
        expect(ttft?.regression).toBe(true);
    });

    it('supports custom threshold', () => {
        const current = { ...baseline, tokens_per_sec: 92 }; // 8% drop
        const strict = detectRegressions(baseline, current, 3.0);
        expect(strict.find(r => r.metric === 'tokens_per_sec')?.regression).toBe(true);

        const lenient = detectRegressions(baseline, current, 10.0);
        expect(lenient.find(r => r.metric === 'tokens_per_sec')?.regression).toBe(false);
    });

    it('generates CI report without regression', () => {
        const report = generateCiReport('llama-8b', baseline);
        expect(report.model).toBe('llama-8b');
        expect(report.hasRegression).toBe(false);
        expect(report.regressions).toHaveLength(0);
        expect(report.summary).toContain('TPS: 100');
    });

    it('generates CI report with regression', () => {
        const current = { ...baseline, tokens_per_sec: 80 };
        const report = generateCiReport('llama-8b', current, baseline);
        expect(report.hasRegression).toBe(true);
        expect(report.summary).toContain('REGRESSIONS');
    });
});

// =============================================================================
// Wave 76: Chaos Engineering
// =============================================================================

describe('Chaos Engineering', () => {
    beforeEach(() => {
        _resetChaos();
    });

    it('lists all available chaos actions', () => {
        const actions = listActions();
        expect(actions.length).toBe(8);
        expect(actions.map(a => a.action)).toContain('kill-node');
        expect(actions.map(a => a.action)).toContain('backend-crash');
        expect(actions.map(a => a.action)).toContain('network-partition');
    });

    it('creates a chaos experiment', () => {
        const exp = createExperiment('kill-node', 'node-1');
        expect(exp.id).toMatch(/^chaos-/);
        expect(exp.action).toBe('kill-node');
        expect(exp.target).toBe('node-1');
        expect(exp.status).toBe('pending');
    });

    it('runs dry-run experiment without injecting', async () => {
        const exp = createExperiment('kill-node', 'node-1', {}, { dryRun: true });
        const result = await injectChaos(exp.id);
        expect(result.injected).toBe(false);
        expect(result.observation).toContain('Dry run');
    });

    it('tracks experiment history', () => {
        createExperiment('kill-node', 'node-1');
        createExperiment('backend-crash', 'node-2');
        createExperiment('cpu-stress');

        const experiments = listExperiments();
        expect(experiments).toHaveLength(3);
    });

    it('clears completed experiments', async () => {
        const exp = createExperiment('kill-node', 'node-1', {}, { dryRun: true });
        await injectChaos(exp.id);

        const cleared = clearExperiments();
        expect(cleared).toBe(1);
        expect(listExperiments()).toHaveLength(0);
    });

    it('rejects invalid chaos action', () => {
        expect(() => createExperiment('invalid-action' as any, 'node-1')).toThrow('Unknown chaos action');
    });

    it('experiment has default random target', () => {
        const exp = createExperiment('cpu-stress');
        expect(exp.target).toBe('random');
    });

    it('injects chaos and measures heal time', async () => {
        const exp = createExperiment('kill-node', 'test-node', {}, { maxDurationMs: 1000, dryRun: false });
        const result = await injectChaos(exp.id);
        expect(result.injected).toBe(true);
        expect(result.healTimeMs).toBeGreaterThan(0);
        expect(exp.status).toBe('completed');
    });
});
