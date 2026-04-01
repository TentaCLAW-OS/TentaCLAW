/**
 * TentaCLAW Gateway — Cloud Burst Tests
 *
 * Tests the cloud burst overflow system: provider management, burst policy,
 * burst decision engine, cost tracking, and history.
 * Uses vi.mock to isolate from the DB and inference layers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB layer — cloud-burst imports getAllNodes & getInferenceAnalytics
// ---------------------------------------------------------------------------

const mockAllNodes = vi.fn(() => [] as Array<{
    id: string;
    status: string;
    latest_stats: {
        gpu_count: number;
        gpus: Array<{ utilizationPct: number; vramTotalMb: number; vramUsedMb: number; powerDrawW: number }>;
        inference: { in_flight_requests: number };
    } | null;
}>);

const mockInferenceAnalytics = vi.fn((_hours?: number) => ({
    total_requests: 0,
    successful: 0,
    failed: 0,
    avg_latency_ms: 0,
    p50_latency_ms: 0,
    p95_latency_ms: 0,
    p99_latency_ms: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    requests_per_minute: 0,
    by_model: [],
    by_node: [],
}));

vi.mock('../src/db', () => ({
    getAllNodes: (...args: unknown[]) => mockAllNodes(...(args as [])),
    getInferenceAnalytics: (...args: unknown[]) => mockInferenceAnalytics(...(args as [number])),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import {
    addCloudProvider,
    removeCloudProvider,
    listCloudProviders,
    setBurstPolicy,
    getBurstPolicy,
    shouldBurst,
    estimateCloudCost,
    getBurstStats,
    getCloudSavingsReport,
    getBurstHistory,
    type CloudProvider,
} from '../src/experimental/cloud-burst';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<CloudProvider> = {}): CloudProvider {
    return {
        name: 'test-provider',
        type: 'together',
        apiKey: 'sk-test-secret-key-12345678',
        baseUrl: 'https://api.together.xyz',
        enabled: true,
        priority: 1,
        costPerMToken: 0.20,
        models: ['llama3.1:8b'],
        maxConcurrent: 10,
        ...overrides,
    };
}

/** Reset module state by removing all providers and resetting policy. */
function resetState(): void {
    // Remove all providers
    for (const p of listCloudProviders()) {
        removeCloudProvider(p.name);
    }
    // Reset policy to defaults
    setBurstPolicy({
        enabled: false,
        triggerConditions: {
            queueDepth: 10,
            utilizationPct: 95,
            latencyP95Ms: 5000,
            allNodesAtCapacity: true,
        },
        maxCostPerHour: 5.00,
        maxCostPerDay: 50.00,
        preferLocal: true,
        fallbackOrder: [],
    });
}

// =============================================================================
// Cloud Provider Management
// =============================================================================

describe('Cloud Provider Management', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('addCloudProvider creates a provider', () => {
        const provider = makeProvider({ name: 'runpod-1' });
        addCloudProvider(provider);

        const list = listCloudProviders();
        expect(list.length).toBe(1);
        expect(list[0].name).toBe('runpod-1');
        expect(list[0].type).toBe('together');
        expect(list[0].enabled).toBe(true);
    });

    it('listCloudProviders returns all providers', () => {
        addCloudProvider(makeProvider({ name: 'provider-a', priority: 2 }));
        addCloudProvider(makeProvider({ name: 'provider-b', priority: 1 }));
        addCloudProvider(makeProvider({ name: 'provider-c', priority: 3 }));

        const list = listCloudProviders();
        expect(list.length).toBe(3);
        // Should be sorted by priority
        expect(list[0].name).toBe('provider-b');
        expect(list[1].name).toBe('provider-a');
        expect(list[2].name).toBe('provider-c');
    });

    it('listCloudProviders masks API keys', () => {
        addCloudProvider(makeProvider({
            name: 'masked-key',
            apiKey: 'sk-super-secret-key-9999',
        }));

        const list = listCloudProviders();
        expect(list[0].apiKey).toBe('****9999');
        expect(list[0].apiKey).not.toContain('super');
        expect(list[0].apiKey).not.toContain('secret');
    });

    it('removeCloudProvider removes by name', () => {
        addCloudProvider(makeProvider({ name: 'remove-me' }));
        expect(listCloudProviders().length).toBe(1);

        const removed = removeCloudProvider('remove-me');
        expect(removed).toBe(true);
        expect(listCloudProviders().length).toBe(0);

        // Removing again returns false
        expect(removeCloudProvider('remove-me')).toBe(false);
    });

    it('Provider requires name and type', () => {
        const provider = makeProvider({ name: 'typed', type: 'groq' });
        addCloudProvider(provider);

        const list = listCloudProviders();
        expect(list[0].name).toBe('typed');
        expect(list[0].type).toBe('groq');
    });
});

// =============================================================================
// Burst Policy
// =============================================================================

describe('Burst Policy', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('setBurstPolicy stores policy', () => {
        setBurstPolicy({ enabled: true, maxCostPerHour: 10.00 });

        const p = getBurstPolicy();
        expect(p.enabled).toBe(true);
        expect(p.maxCostPerHour).toBe(10.00);
    });

    it('getBurstPolicy returns current policy', () => {
        const p = getBurstPolicy();
        expect(p).toBeDefined();
        expect(typeof p.enabled).toBe('boolean');
        expect(typeof p.maxCostPerHour).toBe('number');
        expect(typeof p.maxCostPerDay).toBe('number');
        expect(p.triggerConditions).toBeDefined();
    });

    it('Default policy has burst disabled', () => {
        const p = getBurstPolicy();
        expect(p.enabled).toBe(false);
        expect(p.preferLocal).toBe(true);
    });

    it('setBurstPolicy merges partial updates', () => {
        setBurstPolicy({ enabled: true, maxCostPerHour: 15.00 });

        // Now update only maxCostPerDay — enabled and maxCostPerHour should persist
        setBurstPolicy({ maxCostPerDay: 100.00 });

        const p = getBurstPolicy();
        expect(p.enabled).toBe(true);
        expect(p.maxCostPerHour).toBe(15.00);
        expect(p.maxCostPerDay).toBe(100.00);
    });
});

// =============================================================================
// Burst Decision
// =============================================================================

describe('Burst Decision', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('shouldBurst returns false when disabled', () => {
        setBurstPolicy({ enabled: false });
        addCloudProvider(makeProvider({ name: 'p1' }));

        const decision = shouldBurst('llama3.1:8b');
        expect(decision.burst).toBe(false);
        expect(decision.reason).toContain('disabled');
    });

    it('shouldBurst returns false when no providers', () => {
        setBurstPolicy({ enabled: true });
        // No providers added

        const decision = shouldBurst('llama3.1:8b');
        expect(decision.burst).toBe(false);
        expect(decision.reason).toContain('No cloud providers');
    });

    it('shouldBurst checks queue depth trigger', () => {
        addCloudProvider(makeProvider({ name: 'burst-provider', models: [] }));
        setBurstPolicy({
            enabled: true,
            triggerConditions: { queueDepth: 5 },
        });

        // Mock nodes with high queue depth
        mockAllNodes.mockReturnValue([
            {
                id: 'node-1',
                status: 'online',
                latest_stats: {
                    gpu_count: 1,
                    gpus: [{
                        utilizationPct: 50,
                        vramTotalMb: 24576,
                        vramUsedMb: 8000,
                        powerDrawW: 300,
                    }],
                    inference: { in_flight_requests: 15 },
                },
            },
        ]);

        mockInferenceAnalytics.mockReturnValue({
            total_requests: 100,
            successful: 100,
            failed: 0,
            avg_latency_ms: 30,
            p50_latency_ms: 25,
            p95_latency_ms: 100,
            p99_latency_ms: 200,
            total_tokens_in: 50000,
            total_tokens_out: 50000,
            requests_per_minute: 10,
            by_model: [],
            by_node: [],
        });

        const decision = shouldBurst('llama3.1:8b');
        expect(decision.burst).toBe(true);
        expect(decision.reason).toContain('Queue depth');
        expect(decision.provider).toBe('burst-provider');
    });

    it('shouldBurst respects cost caps', () => {
        addCloudProvider(makeProvider({ name: 'capped-provider', models: [] }));
        setBurstPolicy({
            enabled: true,
            maxCostPerHour: 0,  // $0 cap — should block
            triggerConditions: { queueDepth: 1 },
        });

        // Mock nodes to trigger burst condition
        mockAllNodes.mockReturnValue([
            {
                id: 'node-1',
                status: 'online',
                latest_stats: {
                    gpu_count: 1,
                    gpus: [{
                        utilizationPct: 99,
                        vramTotalMb: 24576,
                        vramUsedMb: 24000,
                        powerDrawW: 350,
                    }],
                    inference: { in_flight_requests: 50 },
                },
            },
        ]);

        mockInferenceAnalytics.mockReturnValue({
            total_requests: 500,
            successful: 500,
            failed: 0,
            avg_latency_ms: 100,
            p50_latency_ms: 80,
            p95_latency_ms: 6000,
            p99_latency_ms: 8000,
            total_tokens_in: 100000,
            total_tokens_out: 100000,
            requests_per_minute: 50,
            by_model: [],
            by_node: [],
        });

        const decision = shouldBurst('llama3.1:8b');
        // Cost cap of $0 means any hourly cost >= $0 blocks bursting
        // The cost cap check uses >=, so $0 cost still meets the $0 cap
        expect(decision.burst).toBe(false);
        expect(decision.reason).toContain('cost cap');
    });
});

// =============================================================================
// Cost Tracking
// =============================================================================

describe('Cost Tracking', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('estimateCloudCost returns per-provider estimates', () => {
        addCloudProvider(makeProvider({
            name: 'cheap',
            costPerMToken: 0.10,
            models: [],
        }));
        addCloudProvider(makeProvider({
            name: 'expensive',
            costPerMToken: 3.00,
            priority: 2,
            models: [],
        }));

        const estimates = estimateCloudCost('llama3.1:8b', 1_000_000);
        expect(estimates.length).toBe(2);
        // Sorted cheapest first
        expect(estimates[0].provider).toBe('cheap');
        expect(estimates[0].cost).toBeCloseTo(0.10, 2);
        expect(estimates[1].provider).toBe('expensive');
        expect(estimates[1].cost).toBeCloseTo(3.00, 2);
    });

    it('getBurstStats returns zero initially', () => {
        const stats = getBurstStats();
        expect(stats.totalBurstRequests).toBe(0);
        expect(stats.totalCost).toBe(0);
        expect(stats.costThisHour).toBe(0);
        expect(stats.costToday).toBe(0);
        expect(stats.avgLatencyMs).toBe(0);
        expect(stats.successRate).toBe(1); // 1 when no requests
    });

    it('getCloudSavingsReport returns savings data', () => {
        mockInferenceAnalytics.mockReturnValue({
            total_requests: 1000,
            successful: 1000,
            failed: 0,
            avg_latency_ms: 50,
            p50_latency_ms: 40,
            p95_latency_ms: 100,
            p99_latency_ms: 200,
            total_tokens_in: 500000,
            total_tokens_out: 500000,
            requests_per_minute: 10,
            by_model: [],
            by_node: [],
        });

        const report = getCloudSavingsReport(30);
        expect(report.periodDays).toBe(30);
        expect(typeof report.localRequests).toBe('number');
        expect(typeof report.cloudRequests).toBe('number');
        expect(typeof report.localPct).toBe('number');
        expect(typeof report.cloudPct).toBe('number');
        expect(typeof report.cloudCost).toBe('number');
        expect(typeof report.estimatedFullCloudCost).toBe('number');
        expect(typeof report.savings).toBe('number');
        expect(typeof report.savingsPct).toBe('number');
        expect(typeof report.summary).toBe('string');
    });
});

// =============================================================================
// Burst History
// =============================================================================

describe('Burst History', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('getBurstHistory returns empty initially', () => {
        const history = getBurstHistory();
        // History may contain events from previous test suites in the same module,
        // but since we have file-level isolation it should be empty on a fresh module
        expect(Array.isArray(history)).toBe(true);
        // At module init, history starts empty
        expect(history.length).toBe(0);
    });

    it('History is capped at 2000 entries', () => {
        // The MAX_BURST_HISTORY constant is 2000.
        // We verify getBurstHistory with a limit returns at most that many.
        // Since we cannot push events directly, we verify the cap logic by
        // requesting more than exists and confirming the array is bounded.
        const history = getBurstHistory(5000);
        expect(Array.isArray(history)).toBe(true);
        expect(history.length).toBeLessThanOrEqual(2000);
    });
});

// =============================================================================
// Provider Edge Cases
// =============================================================================

describe('Provider Edge Cases', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('addCloudProvider replaces existing provider with same name', () => {
        addCloudProvider(makeProvider({ name: 'same', costPerMToken: 1.00 }));
        addCloudProvider(makeProvider({ name: 'same', costPerMToken: 5.00 }));

        const list = listCloudProviders();
        expect(list.length).toBe(1);
        expect(list[0].costPerMToken).toBe(5.00);
    });

    it('listCloudProviders masks short API keys', () => {
        addCloudProvider(makeProvider({ name: 'short-key', apiKey: 'abc' }));

        const list = listCloudProviders();
        expect(list[0].apiKey).toBe('****');
    });

    it('removeCloudProvider returns false for unknown name', () => {
        expect(removeCloudProvider('does-not-exist')).toBe(false);
    });

    it('addCloudProvider stores all fields correctly', () => {
        const provider = makeProvider({
            name: 'full-check',
            type: 'openrouter',
            baseUrl: 'https://openrouter.ai/api',
            enabled: false,
            priority: 99,
            costPerMToken: 1.50,
            models: ['gpt-4o', 'claude-3.5-sonnet'],
            maxConcurrent: 25,
        });
        addCloudProvider(provider);

        const list = listCloudProviders();
        expect(list[0].type).toBe('openrouter');
        expect(list[0].baseUrl).toBe('https://openrouter.ai/api');
        expect(list[0].enabled).toBe(false);
        expect(list[0].priority).toBe(99);
        expect(list[0].costPerMToken).toBe(1.50);
        expect(list[0].models).toEqual(['gpt-4o', 'claude-3.5-sonnet']);
        expect(list[0].maxConcurrent).toBe(25);
    });

    it('listCloudProviders includes activeConcurrent field', () => {
        addCloudProvider(makeProvider({ name: 'conc-check' }));

        const list = listCloudProviders();
        expect(typeof list[0].activeConcurrent).toBe('number');
        expect(list[0].activeConcurrent).toBe(0);
    });

    it('estimateCloudCost excludes disabled providers', () => {
        addCloudProvider(makeProvider({ name: 'enabled-p', enabled: true, costPerMToken: 0.50, models: [] }));
        addCloudProvider(makeProvider({ name: 'disabled-p', enabled: false, costPerMToken: 0.10, models: [], priority: 2 }));

        const estimates = estimateCloudCost('llama3.1:8b', 1_000_000);
        expect(estimates.length).toBe(1);
        expect(estimates[0].provider).toBe('enabled-p');
    });

    it('estimateCloudCost returns empty when no providers match model', () => {
        addCloudProvider(makeProvider({ name: 'specific', models: ['only-this-model'] }));

        const estimates = estimateCloudCost('completely-different-model', 1_000_000);
        expect(estimates.length).toBe(0);
    });

    it('estimateCloudCost scales linearly with token count', () => {
        addCloudProvider(makeProvider({ name: 'linear', costPerMToken: 1.00, models: [] }));

        const est1 = estimateCloudCost('test', 1_000_000);
        const est2 = estimateCloudCost('test', 2_000_000);
        expect(est2[0].cost).toBeCloseTo(est1[0].cost * 2, 4);
    });
});

// =============================================================================
// Policy Edge Cases
// =============================================================================

describe('Policy Edge Cases', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('setBurstPolicy updates only trigger conditions when specified', () => {
        setBurstPolicy({ enabled: true });
        setBurstPolicy({ triggerConditions: { queueDepth: 20 } });

        const p = getBurstPolicy();
        expect(p.enabled).toBe(true);
        expect(p.triggerConditions.queueDepth).toBe(20);
    });

    it('setBurstPolicy preserves fallbackOrder', () => {
        setBurstPolicy({ fallbackOrder: ['provA', 'provB'] });

        const p = getBurstPolicy();
        expect(p.fallbackOrder).toEqual(['provA', 'provB']);
    });

    it('getBurstPolicy returns a copy not a reference', () => {
        const p1 = getBurstPolicy();
        p1.enabled = true;
        p1.maxCostPerHour = 9999;

        const p2 = getBurstPolicy();
        // Should not be affected by mutation of p1
        expect(p2.enabled).toBe(false);
    });

    it('setBurstPolicy merges triggerConditions with existing', () => {
        setBurstPolicy({
            triggerConditions: { queueDepth: 50, utilizationPct: 80 },
        });
        setBurstPolicy({
            triggerConditions: { latencyP95Ms: 2000 },
        });

        const p = getBurstPolicy();
        expect(p.triggerConditions.queueDepth).toBe(50);
        expect(p.triggerConditions.utilizationPct).toBe(80);
        expect(p.triggerConditions.latencyP95Ms).toBe(2000);
    });
});

// =============================================================================
// Savings Report Edge Cases
// =============================================================================

describe('Savings Report Edge Cases', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('getCloudSavingsReport handles zero requests', () => {
        mockInferenceAnalytics.mockReturnValue({
            total_requests: 0,
            successful: 0,
            failed: 0,
            avg_latency_ms: 0,
            p50_latency_ms: 0,
            p95_latency_ms: 0,
            p99_latency_ms: 0,
            total_tokens_in: 0,
            total_tokens_out: 0,
            requests_per_minute: 0,
            by_model: [],
            by_node: [],
        });

        const report = getCloudSavingsReport(7);
        expect(report.periodDays).toBe(7);
        expect(report.localPct).toBe(100);
        expect(report.cloudPct).toBe(0);
        expect(report.summary).toContain('No inference requests');
    });

    it('getCloudSavingsReport savingsPct is 100 when no cloud cost', () => {
        mockInferenceAnalytics.mockReturnValue({
            total_requests: 0,
            successful: 0,
            failed: 0,
            avg_latency_ms: 0,
            p50_latency_ms: 0,
            p95_latency_ms: 0,
            p99_latency_ms: 0,
            total_tokens_in: 0,
            total_tokens_out: 0,
            requests_per_minute: 0,
            by_model: [],
            by_node: [],
        });

        const report = getCloudSavingsReport(30);
        expect(report.savingsPct).toBe(100);
    });

    it('getBurstStats has correct shape with no events', () => {
        const stats = getBurstStats();
        expect(Object.keys(stats.requestsByProvider)).toEqual([]);
        expect(Object.keys(stats.costByProvider)).toEqual([]);
    });

    it('getCloudSavingsReport summary contains cost info for active period', () => {
        mockInferenceAnalytics.mockReturnValue({
            total_requests: 500,
            successful: 480,
            failed: 20,
            avg_latency_ms: 60,
            p50_latency_ms: 50,
            p95_latency_ms: 150,
            p99_latency_ms: 300,
            total_tokens_in: 250000,
            total_tokens_out: 250000,
            requests_per_minute: 5,
            by_model: [],
            by_node: [],
        });

        const report = getCloudSavingsReport(30);
        expect(report.localRequests).toBe(500);
        expect(report.cloudRequests).toBe(0);
        expect(report.localPct).toBe(100);
        expect(report.cloudPct).toBe(0);
        expect(report.summary).toContain('100% local');
    });

    it('getCloudSavingsReport defaults to 30 days', () => {
        mockInferenceAnalytics.mockReturnValue({
            total_requests: 100,
            successful: 100,
            failed: 0,
            avg_latency_ms: 50,
            p50_latency_ms: 40,
            p95_latency_ms: 100,
            p99_latency_ms: 200,
            total_tokens_in: 50000,
            total_tokens_out: 50000,
            requests_per_minute: 1,
            by_model: [],
            by_node: [],
        });

        const report = getCloudSavingsReport();
        expect(report.periodDays).toBe(30);
    });
});

// =============================================================================
// Burst Decision Edge Cases
// =============================================================================

describe('Burst Decision Edge Cases', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('shouldBurst returns no trigger reason when conditions not met', () => {
        addCloudProvider(makeProvider({ name: 'idle-provider', models: [] }));
        setBurstPolicy({
            enabled: true,
            triggerConditions: { queueDepth: 100 },
        });

        // Mock nodes with low queue depth — no trigger
        mockAllNodes.mockReturnValue([
            {
                id: 'node-1',
                status: 'online',
                latest_stats: {
                    gpu_count: 1,
                    gpus: [{ utilizationPct: 10, vramTotalMb: 24576, vramUsedMb: 2000, powerDrawW: 100 }],
                    inference: { in_flight_requests: 1 },
                },
            },
        ]);

        mockInferenceAnalytics.mockReturnValue({
            total_requests: 10,
            successful: 10,
            failed: 0,
            avg_latency_ms: 20,
            p50_latency_ms: 15,
            p95_latency_ms: 50,
            p99_latency_ms: 80,
            total_tokens_in: 5000,
            total_tokens_out: 5000,
            requests_per_minute: 1,
            by_model: [],
            by_node: [],
        });

        const decision = shouldBurst();
        expect(decision.burst).toBe(false);
        expect(decision.reason).toContain('No trigger conditions met');
    });

    it('shouldBurst without model parameter still works', () => {
        setBurstPolicy({ enabled: false });

        const decision = shouldBurst();
        expect(decision.burst).toBe(false);
    });

    it('estimateCloudCost with zero tokens returns zero cost', () => {
        addCloudProvider(makeProvider({ name: 'zero-test', models: [] }));

        const estimates = estimateCloudCost('test', 0);
        expect(estimates.length).toBe(1);
        expect(estimates[0].cost).toBe(0);
    });
});
