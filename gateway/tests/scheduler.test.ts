/**
 * TentaCLAW Gateway — Scheduler Tests
 *
 * Tests VRAM estimation, model placement, request routing,
 * autoscale recommendations, and capacity analysis.
 * Uses vi.mock to isolate scheduler logic from the DB layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB layer — scheduler.ts imports these from '../src/db'
// ---------------------------------------------------------------------------

const mockNodes: any[] = [];
const mockClusterModels: any[] = [];
const mockEvictionCandidates: any[] = [];
const mockLatency: Record<string, number> = {};
const mockThroughput: Record<string, number> = {};
const mockPriority: Record<string, string> = {};
const mockIdleModels: any[] = [];
const mockConstraints: any[] = [];
const mockModelVram: Record<string, number> = {};

vi.mock('../src/db', () => ({
    getAllNodes: () => mockNodes,
    getClusterModels: () => mockClusterModels,
    getEvictionCandidates: (nodeId: string) => mockEvictionCandidates.filter(c => c._nodeId === nodeId || !c._nodeId),
    getNodeLatencyP50: (nodeId: string, model: string) => mockLatency[`${nodeId}:${model}`] ?? 0,
    getNodeThroughput: (nodeId: string, model: string) => mockThroughput[`${nodeId}:${model}`] ?? 0,
    getModelPriority: (model: string) => mockPriority[model] ?? 'normal',
    getIdleModels: (_mins: number) => mockIdleModels,
    getPlacementConstraints: (_model?: string) => mockConstraints,
    estimateModelVram: (model: string) => mockModelVram[model] ?? 4000,
    resolveModelAlias: (model: string) => ({ target: model, fallbacks: [] }),
}));

import {
    estimateVram,
    planModelPlacement,
    routeRequest,
    getAutoscaleRecommendations,
    analyzeCapacity,
} from '../src/experimental/scheduler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides?: any) {
    return {
        id,
        hostname: overrides?.hostname ?? `host-${id}`,
        status: overrides?.status ?? 'online',
        farm_hash: 'FARM01',
        gpu_count: 1,
        latest_stats: overrides?.latest_stats ?? {
            gpus: [{
                busId: '0:0',
                name: 'RTX 4090',
                vramTotalMb: 24576,
                vramUsedMb: overrides?.vramUsed ?? 8000,
                temperatureC: 60,
                utilizationPct: overrides?.gpuUtil ?? 50,
                powerDrawW: 300,
                fanSpeedPct: 50,
                clockSmMhz: 2000,
                clockMemMhz: 10000,
            }],
            inference: {
                loaded_models: overrides?.models ?? ['llama3.1:8b'],
                in_flight_requests: overrides?.inFlight ?? 2,
                tokens_generated: 50000,
                avg_latency_ms: 45,
            },
            backend: overrides?.backend ?? { type: 'ollama', port: 11434 },
        },
    };
}

function resetMocks() {
    mockNodes.length = 0;
    mockClusterModels.length = 0;
    mockEvictionCandidates.length = 0;
    mockIdleModels.length = 0;
    mockConstraints.length = 0;
    Object.keys(mockLatency).forEach(k => delete mockLatency[k]);
    Object.keys(mockThroughput).forEach(k => delete mockThroughput[k]);
    Object.keys(mockPriority).forEach(k => delete mockPriority[k]);
    Object.keys(mockModelVram).forEach(k => delete mockModelVram[k]);
}

// =============================================================================
// VRAM Estimation
// =============================================================================

describe('VRAM Estimation', () => {
    beforeEach(resetMocks);

    it('estimateVram parses "8b" parameter count correctly', () => {
        const est = estimateVram('llama3.1:8b');
        // 8B params at Q4 (0.5 bytes/param) = 8e9 * 0.5 / 1048576 ≈ 3815 MB weights
        expect(est.model_weights_mb).toBeGreaterThan(3500);
        expect(est.model_weights_mb).toBeLessThan(4200);
    });

    it('estimateVram parses "70b" correctly', () => {
        const est = estimateVram('llama3.1:70b');
        // 70B at Q4 = 70e9 * 0.5 / 1048576 ≈ 33378 MB weights
        expect(est.model_weights_mb).toBeGreaterThan(30000);
        expect(est.model_weights_mb).toBeLessThan(36000);
    });

    it('estimateVram handles MoE format "8x7b"', () => {
        const est = estimateVram('mixtral:8x7b');
        // MoE: 8*7 * (5/6) = 46.67B effective, at Q4 ≈ 22252 MB
        expect(est.model_weights_mb).toBeGreaterThan(20000);
        expect(est.model_weights_mb).toBeLessThan(25000);
    });

    it('Q4_K_M uses ~0.5 bytes per param', () => {
        const est = estimateVram('llama3.1:8b', 'Q4_K_M');
        // 8B * 0.5 / 1048576 ≈ 3815 MB
        expect(est.model_weights_mb).toBeGreaterThan(3500);
        expect(est.model_weights_mb).toBeLessThan(4200);
    });

    it('FP16 uses 2 bytes per param', () => {
        const est = estimateVram('llama3.1:8b', 'FP16');
        // 8B * 2.0 / 1048576 ≈ 15259 MB
        expect(est.model_weights_mb).toBeGreaterThan(14000);
        expect(est.model_weights_mb).toBeLessThan(16500);
    });

    it('KV cache scales with context length', () => {
        const short = estimateVram('llama3.1:8b', 'Q4_K_M', 2048);
        const long = estimateVram('llama3.1:8b', 'Q4_K_M', 8192);
        expect(long.kv_cache_mb).toBeGreaterThan(short.kv_cache_mb);
    });

    it('total includes overhead (~400MB)', () => {
        const est = estimateVram('llama3.1:8b');
        expect(est.overhead_mb).toBe(400);
        expect(est.total_mb).toBe(
            est.model_weights_mb + est.kv_cache_mb + est.activation_mb + est.overhead_mb,
        );
    });
});

// =============================================================================
// Model Placement
// =============================================================================

describe('Model Placement', () => {
    beforeEach(resetMocks);

    it('planModelPlacement returns valid plan', () => {
        mockNodes.push(makeNode('n1', { models: [], vramUsed: 4000 }));
        const plan = planModelPlacement('llama3.1:8b');
        expect(plan).toHaveProperty('model');
        expect(plan).toHaveProperty('target_nodes');
        expect(plan).toHaveProperty('strategy');
        expect(plan).toHaveProperty('warnings');
        expect(plan).toHaveProperty('total_vram_required_mb');
    });

    it('spread strategy distributes across nodes', () => {
        // Two nodes with different load counts
        mockNodes.push(makeNode('n1', { models: ['phi3:mini', 'gemma:7b'], vramUsed: 4000 }));
        mockNodes.push(makeNode('n2', { models: [], vramUsed: 4000 }));
        const plan = planModelPlacement('llama3.1:8b', { strategy: 'spread', replicas: 2 });
        // Spread should prefer the node with fewer loaded models first
        if (plan.target_nodes.length === 2) {
            expect(plan.target_nodes[0].node_id).toBe('n2');
        }
        expect(plan.strategy).toBe('spread');
    });

    it('binpack strategy fills one node first', () => {
        // n1 has less free VRAM (tighter fit) but can still fit the model
        mockNodes.push(makeNode('n1', { models: [], vramUsed: 18000 }));
        mockNodes.push(makeNode('n2', { models: [], vramUsed: 4000 }));
        const plan = planModelPlacement('llama3.2:3b', { strategy: 'binpack' });
        // Binpack should prefer the tightest fit (least available VRAM) with zero evictions
        if (plan.target_nodes.length >= 1) {
            expect(plan.target_nodes[0].node_id).toBe('n1');
        }
        expect(plan.strategy).toBe('binpack');
    });

    it('plan includes eviction candidates when VRAM full', () => {
        // Node with very little free VRAM — needs eviction
        mockNodes.push(makeNode('n1', { models: [], vramUsed: 22000 }));
        mockEvictionCandidates.push({ model: 'old-model:7b', last_used: '2024-01-01', request_count: 0, vram_mb: 6000, _nodeId: 'n1' });

        const plan = planModelPlacement('llama3.1:8b');
        if (plan.target_nodes.length > 0) {
            expect(plan.target_nodes[0].evictions_needed.length).toBeGreaterThan(0);
        }
    });

    it('plan respects exclude_nodes option', () => {
        mockNodes.push(makeNode('n1', { models: [], vramUsed: 4000 }));
        mockNodes.push(makeNode('n2', { models: [], vramUsed: 4000 }));
        const plan = planModelPlacement('llama3.1:8b', { exclude_nodes: ['n1'] });
        const nodeIds = plan.target_nodes.map(n => n.node_id);
        expect(nodeIds).not.toContain('n1');
    });

    it('empty cluster returns empty plan', () => {
        const plan = planModelPlacement('llama3.1:70b');
        expect(plan.target_nodes.length).toBe(0);
        expect(plan.warnings.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Request Routing
// =============================================================================

describe('Request Routing', () => {
    beforeEach(resetMocks);

    it('routeRequest returns best node', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 2 }));
        const decision = routeRequest('llama3.1:8b');
        expect(decision).not.toBeNull();
        expect(decision!.node_id).toBe('n1');
    });

    it('least-loaded strategy picks node with fewest requests', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 10 }));
        mockNodes.push(makeNode('n2', { models: ['llama3.1:8b'], inFlight: 1 }));
        const decision = routeRequest('llama3.1:8b', { strategy: 'least-loaded' });
        expect(decision).not.toBeNull();
        expect(decision!.node_id).toBe('n2');
    });

    it('round-robin cycles through nodes', () => {
        mockNodes.push(makeNode('n1', { models: ['test-model:7b'], inFlight: 0 }));
        mockNodes.push(makeNode('n2', { models: ['test-model:7b'], inFlight: 0 }));

        const first = routeRequest('test-model:7b', { strategy: 'round-robin' });
        const second = routeRequest('test-model:7b', { strategy: 'round-robin' });

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        // Two consecutive round-robin calls should return different nodes
        if (first && second) {
            expect(first.node_id !== second.node_id || mockNodes.length === 1).toBe(true);
        }
    });

    it('returns null when no nodes available', () => {
        const decision = routeRequest('nonexistent-model:7b');
        expect(decision).toBeNull();
    });

    it('excludes specified nodes from routing', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 0 }));
        mockNodes.push(makeNode('n2', { models: ['llama3.1:8b'], inFlight: 0 }));
        const decision = routeRequest('llama3.1:8b', { exclude_nodes: ['n1'] });
        expect(decision).not.toBeNull();
        expect(decision!.node_id).toBe('n2');
    });

    it('returns routing decision with all expected fields', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 1 }));
        const decision = routeRequest('llama3.1:8b');
        expect(decision).not.toBeNull();
        expect(decision).toHaveProperty('node_id');
        expect(decision).toHaveProperty('hostname');
        expect(decision).toHaveProperty('backend_port');
        expect(decision).toHaveProperty('backend_type');
        expect(decision).toHaveProperty('reason');
        expect(decision).toHaveProperty('score');
        expect(decision).toHaveProperty('latency_estimate_ms');
    });

    it('skips offline nodes', () => {
        mockNodes.push(makeNode('n1', { status: 'offline', models: ['llama3.1:8b'], inFlight: 0 }));
        const decision = routeRequest('llama3.1:8b');
        expect(decision).toBeNull();
    });

    it('respects max_latency_ms constraint', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 0 }));
        mockLatency['n1:llama3.1:8b'] = 500;

        const decision = routeRequest('llama3.1:8b', { max_latency_ms: 100 });
        // Node has 500ms latency but limit is 100ms, should be filtered out
        expect(decision).toBeNull();
    });
});

// =============================================================================
// Autoscale Recommendations
// =============================================================================

describe('Autoscale Recommendations', () => {
    beforeEach(resetMocks);

    it('recommends scale_up for overloaded models', () => {
        // Single replica with high in-flight requests
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b'], inFlight: 5 }));
        mockClusterModels.push({ model: 'llama3.1:8b', node_count: 1, nodes: ['n1'] });

        const recs = getAutoscaleRecommendations();
        const scaleUp = recs.find(r => r.action === 'scale_up' && r.model === 'llama3.1:8b');
        expect(scaleUp).toBeDefined();
        expect(scaleUp!.recommended_replicas).toBeGreaterThan(1);
    });

    it('recommends evict for long-idle models', () => {
        mockNodes.push(makeNode('n1', { models: ['old-model:7b'], inFlight: 0 }));
        mockClusterModels.push({ model: 'old-model:7b', node_count: 1, nodes: ['n1'] });
        mockPriority['old-model:7b'] = 'low';
        mockIdleModels.push({ model: 'old-model:7b', node_id: 'n1', last_used: '2024-01-01', idle_minutes: 60 });

        const recs = getAutoscaleRecommendations();
        const evict = recs.find(r => r.action === 'evict' && r.model === 'old-model:7b');
        expect(evict).toBeDefined();
        expect(evict!.recommended_replicas).toBe(0);
    });

    it('never evicts critical-priority models', () => {
        mockNodes.push(makeNode('n1', { models: ['important:7b'], inFlight: 0 }));
        mockClusterModels.push({ model: 'important:7b', node_count: 1, nodes: ['n1'] });
        mockPriority['important:7b'] = 'critical';
        mockIdleModels.push({ model: 'important:7b', node_id: 'n1', last_used: '2024-01-01', idle_minutes: 120 });

        const recs = getAutoscaleRecommendations();
        const evict = recs.find(r => r.action === 'evict' && r.model === 'important:7b');
        expect(evict).toBeUndefined();
    });
});

// =============================================================================
// Capacity Analysis
// =============================================================================

describe('Capacity Analysis', () => {
    beforeEach(resetMocks);

    it('analyzeCapacity returns correct totals', () => {
        mockNodes.push(makeNode('n1', { vramUsed: 8000, gpuUtil: 50 }));
        mockNodes.push(makeNode('n2', { vramUsed: 12000, gpuUtil: 70 }));

        const cap = analyzeCapacity();
        expect(cap.total_vram_mb).toBe(24576 * 2);
        expect(cap.used_vram_mb).toBe(8000 + 12000);
        expect(cap.free_vram_mb).toBe(cap.total_vram_mb - cap.used_vram_mb);
        expect(cap.utilization_pct).toBeGreaterThan(0);
    });

    it('empty cluster shows zero capacity', () => {
        const cap = analyzeCapacity();
        expect(cap.total_vram_mb).toBe(0);
        expect(cap.used_vram_mb).toBe(0);
        expect(cap.free_vram_mb).toBe(0);
        expect(cap.models_loaded).toBe(0);
    });

    it('bottleneck detection works', () => {
        // High VRAM utilization = 'vram' bottleneck
        mockNodes.push(makeNode('n1', { vramUsed: 23000, gpuUtil: 50 }));
        const cap = analyzeCapacity();
        expect(cap.bottleneck).toBe('vram');
    });

    it('counts loaded models correctly', () => {
        mockNodes.push(makeNode('n1', { models: ['llama3.1:8b', 'phi3:mini'], vramUsed: 8000 }));
        mockNodes.push(makeNode('n2', { models: ['llama3.1:8b'], vramUsed: 6000 }));
        const cap = analyzeCapacity();
        // Unique models: llama3.1:8b, phi3:mini = 2
        expect(cap.models_loaded).toBe(2);
    });

    it('utilization percent is between 0 and 100', () => {
        mockNodes.push(makeNode('n1', { vramUsed: 12000 }));
        const cap = analyzeCapacity();
        expect(cap.utilization_pct).toBeGreaterThanOrEqual(0);
        expect(cap.utilization_pct).toBeLessThanOrEqual(100);
    });

    it('bottleneck is "none" when cluster is lightly used', () => {
        mockNodes.push(makeNode('n1', { vramUsed: 2000, gpuUtil: 10 }));
        const cap = analyzeCapacity();
        expect(cap.bottleneck).toBe('none');
    });

    it('offline nodes are excluded from capacity', () => {
        mockNodes.push(makeNode('n1', { status: 'offline', vramUsed: 8000 }));
        const cap = analyzeCapacity();
        expect(cap.total_vram_mb).toBe(0);
    });
});
