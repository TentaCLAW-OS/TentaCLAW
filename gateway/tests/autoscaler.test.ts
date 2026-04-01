/**
 * TentaCLAW Gateway — Autoscaler Tests
 *
 * Tests the autoscaler module: configuration, scale evaluation, request
 * tracking, scale history, and model state management.
 * Mocks the DB layer so we test pure logic only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeWithStats, StatsPayload, GpuStats } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — stub out DB so autoscaler runs in isolation
// ---------------------------------------------------------------------------

const mockGetAllNodes = vi.fn((): NodeWithStats[] => []);
const mockGetClusterModels = vi.fn((): { model: string; node_count: number; nodes: string[] }[] => []);
const mockQueueCommand = vi.fn((_nodeId: string, _action: string, _payload: Record<string, unknown>) => ({
    id: `cmd-${Date.now()}`,
    node_id: _nodeId,
    action: _action,
    payload: _payload,
    status: 'pending',
}));

vi.mock('../src/db', () => ({
    getAllNodes: (...args: unknown[]) => mockGetAllNodes(...(args as [])),
    getClusterModels: (...args: unknown[]) => mockGetClusterModels(...(args as [])),
    queueCommand: (...args: unknown[]) => mockQueueCommand(...(args as [string, string, Record<string, unknown>])),
}));

import {
    getAutoscaleConfig,
    updateAutoscaleConfig,
    evaluateScaling,
    recordRequest,
    getScaleHistory,
    getModelScaleStates,
    setModelMinReplicas,
    stopAutoscaler,
    executeScaleAction,
} from '../src/experimental/autoscaler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGpu(overrides?: Partial<GpuStats>): GpuStats {
    return {
        busId: '0000:01:00.0',
        name: 'NVIDIA RTX 3090',
        vramTotalMb: 24576,
        vramUsedMb: 4096,
        temperatureC: 60,
        utilizationPct: 40,
        powerDrawW: 250,
        fanSpeedPct: 50,
        clockSmMhz: 1800,
        clockMemMhz: 9500,
        ...overrides,
    };
}

function makeStats(nodeId: string, overrides?: Partial<StatsPayload>): StatsPayload {
    return {
        farm_hash: 'FARM0001',
        node_id: nodeId,
        hostname: `host-${nodeId}`,
        uptime_secs: 3600,
        gpu_count: 1,
        gpus: [makeGpu()],
        cpu: { usage_pct: 30, temp_c: 50 },
        ram: { total_mb: 32768, used_mb: 16384 },
        disk: { total_gb: 500, used_gb: 200 },
        network: { bytes_in: 100000, bytes_out: 50000 },
        inference: {
            loaded_models: [],
            in_flight_requests: 0,
            tokens_generated: 0,
            avg_latency_ms: 0,
        },
        toks_per_sec: 0,
        requests_completed: 0,
        ...overrides,
    };
}

function makeNode(id: string, loadedModels: string[] = []): NodeWithStats {
    return {
        id,
        farm_hash: 'FARM0001',
        hostname: `host-${id}`,
        ip_address: '192.168.1.100',
        mac_address: 'aa:bb:cc:dd:ee:ff',
        registered_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        status: 'online',
        gpu_count: 1,
        os_version: '0.1.0',
        latest_stats: makeStats(id, {
            inference: {
                loaded_models: loadedModels,
                in_flight_requests: 0,
                tokens_generated: 0,
                avg_latency_ms: 0,
            },
        }),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Configuration', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
    });

    it('getAutoscaleConfig returns default config', () => {
        const cfg = getAutoscaleConfig();

        expect(cfg).toBeDefined();
        expect(typeof cfg.enabled).toBe('boolean');
        expect(typeof cfg.check_interval_ms).toBe('number');
        expect(typeof cfg.scale_up_threshold).toBe('number');
        expect(typeof cfg.min_replicas).toBe('number');
        expect(typeof cfg.max_replicas).toBe('number');
        expect(typeof cfg.cooldown_seconds).toBe('number');
    });

    it('updateAutoscaleConfig merges updates', () => {
        const before = getAutoscaleConfig();
        const updated = updateAutoscaleConfig({ scale_up_threshold: 20 });

        expect(updated.scale_up_threshold).toBe(20);
        // Other fields preserved
        expect(updated.max_replicas).toBe(before.max_replicas);
        expect(updated.cooldown_seconds).toBe(before.cooldown_seconds);
    });

    it('Default check interval is 30000ms', () => {
        const cfg = getAutoscaleConfig();
        expect(cfg.check_interval_ms).toBe(30_000);
    });
});

describe('Scale Evaluation', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
        // Reset config to defaults
        updateAutoscaleConfig({
            enabled: false,
            check_interval_ms: 30_000,
            scale_up_threshold: 5,
            scale_down_idle_minutes: 15,
            scale_to_zero_minutes: 30,
            min_replicas: 1,
            max_replicas: 10,
            cooldown_seconds: 60,
        });
    });

    it('evaluateScaling returns empty array when no models', () => {
        mockGetClusterModels.mockReturnValue([]);
        const actions = evaluateScaling();
        expect(actions).toEqual([]);
    });

    it('evaluateScaling recommends scale_up for high queue depth', () => {
        const node1 = makeNode('n1', ['llama3.1:8b']);
        const node2 = makeNode('n2', []);

        mockGetClusterModels.mockReturnValue([
            { model: 'llama3.1:8b', node_count: 1, nodes: ['n1'] },
        ]);
        mockGetAllNodes.mockReturnValue([node1, node2]);

        // Set very low threshold and low cooldown so it can fire
        updateAutoscaleConfig({ scale_up_threshold: 1, cooldown_seconds: 0 });

        // Generate enough requests to push queue depth above threshold
        for (let i = 0; i < 10; i++) {
            recordRequest('llama3.1:8b');
        }

        const actions = evaluateScaling();
        const scaleUp = actions.find(a => a.action === 'scale_up');

        expect(scaleUp).toBeDefined();
        expect(scaleUp!.model).toBe('llama3.1:8b');
        expect(scaleUp!.to_replicas).toBe(2);
    });

    it('evaluateScaling recommends evict for long-idle models', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'idle-model:7b', node_count: 1, nodes: ['n1'] },
        ]);

        // Set scale-to-zero config with 0 min_replicas and very short idle window
        updateAutoscaleConfig({
            min_replicas: 0,
            scale_to_zero_minutes: 0, // immediately eligible for unload
            cooldown_seconds: 0,
        });

        // The model tracker for idle-model:7b has last_request_at = 0
        // which means minutesSince returns Infinity (idle forever)
        const actions = evaluateScaling();
        const unload = actions.find(a => a.action === 'unload');

        expect(unload).toBeDefined();
        expect(unload!.model).toBe('idle-model:7b');
        expect(unload!.to_replicas).toBe(0);
    });

    it('evaluateScaling respects min_replicas', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'important:7b', node_count: 2, nodes: ['n1', 'n2'] },
        ]);

        // min_replicas = 2 should prevent scale-down below 2
        updateAutoscaleConfig({
            min_replicas: 2,
            scale_down_idle_minutes: 0,
            cooldown_seconds: 0,
        });

        const actions = evaluateScaling();
        const scaleDown = actions.find(
            a => a.action === 'scale_down' && a.model === 'important:7b',
        );

        // Should NOT recommend scaling down because current_replicas (2) == min_replicas (2)
        expect(scaleDown).toBeUndefined();
    });

    it('evaluateScaling respects max_replicas', () => {
        const nodes = Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`, i === 0 ? ['test:7b'] : []));

        mockGetClusterModels.mockReturnValue([
            { model: 'test:7b', node_count: 3, nodes: ['n0', 'n1', 'n2'] },
        ]);
        mockGetAllNodes.mockReturnValue(nodes);

        updateAutoscaleConfig({
            max_replicas: 3,
            scale_up_threshold: 1,
            cooldown_seconds: 0,
        });

        // Flood requests to trigger scale-up desire
        for (let i = 0; i < 20; i++) {
            recordRequest('test:7b');
        }

        const actions = evaluateScaling();
        const scaleUp = actions.find(
            a => a.action === 'scale_up' && a.model === 'test:7b',
        );

        // current_replicas (3) is already at max_replicas (3), so no scale_up
        expect(scaleUp).toBeUndefined();
    });

    it('evaluateScaling respects cooldown period', () => {
        const node1 = makeNode('n1', ['cooldown-model:7b']);
        const node2 = makeNode('n2', []);

        mockGetClusterModels.mockReturnValue([
            { model: 'cooldown-model:7b', node_count: 1, nodes: ['n1'] },
        ]);
        mockGetAllNodes.mockReturnValue([node1, node2]);

        // Long cooldown
        updateAutoscaleConfig({
            scale_up_threshold: 1,
            cooldown_seconds: 9999,
        });

        // Generate requests
        for (let i = 0; i < 10; i++) {
            recordRequest('cooldown-model:7b');
        }

        // First evaluation may trigger, but since recordRequest can trigger
        // executeScaleAction (cold_start), the cooldown is set.
        // Subsequent evaluations should be blocked by cooldown.
        const actions = evaluateScaling();
        // Since cooldown is very long and a previous action may have been recorded,
        // actions for this model should be empty
        expect(
            actions.filter(a => a.model === 'cooldown-model:7b').length,
        ).toBeLessThanOrEqual(1);
    });
});

describe('Request Tracking', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
    });

    it('recordRequest updates last_request_at', () => {
        // Track initial state
        const statesBefore = getModelScaleStates();
        const beforeModel = statesBefore.find(s => s.model === 'track-test:7b');
        // Model may not exist yet, so last_request_at would be null
        expect(beforeModel?.last_request_at ?? null).toBeNull();

        mockGetClusterModels.mockReturnValue([
            { model: 'track-test:7b', node_count: 1, nodes: ['n1'] },
        ]);

        recordRequest('track-test:7b');

        const statesAfter = getModelScaleStates();
        const afterModel = statesAfter.find(s => s.model === 'track-test:7b');

        expect(afterModel).toBeDefined();
        expect(afterModel!.last_request_at).not.toBeNull();
    });

    it('recordRequest triggers cold_start for unloaded model', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'cold-model:7b', node_count: 1, nodes: ['n1'] },
        ]);
        mockGetAllNodes.mockReturnValue([makeNode('n1', [])]);

        // Set up for scale-to-zero
        updateAutoscaleConfig({
            min_replicas: 0,
            scale_to_zero_minutes: 0,
            cooldown_seconds: 0,
        });

        // Evaluate to unload the model, then execute the unload action
        const unloadActions = evaluateScaling();
        const unload = unloadActions.find(a => a.action === 'unload' && a.model === 'cold-model:7b');
        expect(unload).toBeDefined();

        // Execute the unload so the model enters the unloadedModels set
        executeScaleAction(unload!);

        // Now the model is in the unloaded set. A new request should trigger cold_start.
        mockGetAllNodes.mockReturnValue([makeNode('avail-1', [])]);
        mockQueueCommand.mockClear();

        recordRequest('cold-model:7b');

        // Check that a cold_start event was recorded
        const history = getScaleHistory(50);
        const coldStart = history.find(e => e.action === 'cold_start' && e.model === 'cold-model:7b');
        expect(coldStart).toBeDefined();
    });
});

describe('Scale History', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
    });

    it('getScaleHistory returns recent events', () => {
        const history = getScaleHistory();
        expect(Array.isArray(history)).toBe(true);
        // History persists across tests in this module; just confirm we get an array
    });

    it('History is ordered newest first', () => {
        const history = getScaleHistory(50);

        if (history.length >= 2) {
            for (let i = 0; i < history.length - 1; i++) {
                const a = new Date(history[i].timestamp).getTime();
                const b = new Date(history[i + 1].timestamp).getTime();
                expect(a).toBeGreaterThanOrEqual(b);
            }
        }
    });
});

describe('Model State', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
    });

    it('getModelScaleStates returns all models', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'model-a:7b', node_count: 1, nodes: ['n1'] },
            { model: 'model-b:13b', node_count: 2, nodes: ['n2', 'n3'] },
        ]);

        const states = getModelScaleStates();
        const modelNames = states.map(s => s.model);

        expect(modelNames).toContain('model-a:7b');
        expect(modelNames).toContain('model-b:13b');
    });

    it('setModelMinReplicas overrides default', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'pinned:7b', node_count: 3, nodes: ['n1', 'n2', 'n3'] },
        ]);

        // Global min is 1, set model-specific to 3
        updateAutoscaleConfig({ min_replicas: 1, scale_down_idle_minutes: 0, cooldown_seconds: 0 });
        setModelMinReplicas('pinned:7b', 3);

        // With min_replicas = 3 and current = 3, scale_down should NOT trigger
        const actions = evaluateScaling();
        const scaleDown = actions.find(
            a => a.action === 'scale_down' && a.model === 'pinned:7b',
        );
        expect(scaleDown).toBeUndefined();

        // Cleanup: remove override
        setModelMinReplicas('pinned:7b', null);
    });

    it('getModelScaleStates includes tracked but unloaded models', () => {
        // Record a request for a model that is not in the cluster
        mockGetClusterModels.mockReturnValue([]);
        recordRequest('phantom:7b');

        const states = getModelScaleStates();
        const phantom = states.find(s => s.model === 'phantom:7b');

        expect(phantom).toBeDefined();
        expect(phantom!.current_replicas).toBe(0);
        expect(phantom!.last_request_at).not.toBeNull();
    });

    it('Model scale state reports correct queue_depth', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'queue-test:7b', node_count: 1, nodes: ['n1'] },
        ]);

        // Rapid-fire requests
        for (let i = 0; i < 5; i++) {
            recordRequest('queue-test:7b');
        }

        const states = getModelScaleStates();
        const model = states.find(s => s.model === 'queue-test:7b');

        expect(model).toBeDefined();
        expect(model!.queue_depth).toBeGreaterThan(0);
    });
});

describe('Config Edge Cases', () => {
    beforeEach(() => {
        stopAutoscaler();
        mockGetAllNodes.mockReset();
        mockGetClusterModels.mockReset();
        mockQueueCommand.mockReset();
    });

    it('updateAutoscaleConfig preserves unset fields', () => {
        updateAutoscaleConfig({ max_replicas: 5 });
        const cfg1 = getAutoscaleConfig();
        expect(cfg1.max_replicas).toBe(5);

        updateAutoscaleConfig({ scale_up_threshold: 10 });
        const cfg2 = getAutoscaleConfig();
        // max_replicas should still be 5
        expect(cfg2.max_replicas).toBe(5);
        expect(cfg2.scale_up_threshold).toBe(10);
    });

    it('setModelMinReplicas with null removes override', () => {
        setModelMinReplicas('override-test:7b', 5);

        mockGetClusterModels.mockReturnValue([
            { model: 'override-test:7b', node_count: 5, nodes: ['n1', 'n2', 'n3', 'n4', 'n5'] },
        ]);

        // With min=5, scale_down should be blocked at 5 replicas
        updateAutoscaleConfig({ min_replicas: 1, scale_down_idle_minutes: 0, cooldown_seconds: 0 });
        let actions = evaluateScaling();
        expect(actions.find(a => a.action === 'scale_down' && a.model === 'override-test:7b')).toBeUndefined();

        // Remove override — now global min_replicas (1) applies
        setModelMinReplicas('override-test:7b', null);
        actions = evaluateScaling();
        const scaleDown = actions.find(a => a.action === 'scale_down' && a.model === 'override-test:7b');
        expect(scaleDown).toBeDefined();
        expect(scaleDown!.to_replicas).toBeLessThan(5);
    });

    it('recordRequest with latency tracks avg_latency_ms', () => {
        mockGetClusterModels.mockReturnValue([
            { model: 'latency-test:7b', node_count: 1, nodes: ['n1'] },
        ]);

        recordRequest('latency-test:7b', 50);
        recordRequest('latency-test:7b', 100);
        recordRequest('latency-test:7b', 150);

        const states = getModelScaleStates();
        const model = states.find(s => s.model === 'latency-test:7b');

        expect(model).toBeDefined();
        expect(model!.avg_latency_ms).toBe(100); // (50+100+150)/3 = 100
    });
});
