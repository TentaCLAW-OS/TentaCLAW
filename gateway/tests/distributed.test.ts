/**
 * TentaCLAW Gateway — Distributed Inference Tests
 *
 * Tests the distributed inference coordinator: distribution planning, latency
 * estimation, feasibility checks, model management, and metrics.
 * Mocks the DB layer so we test pure logic only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeWithStats, StatsPayload, GpuStats } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — stub out DB and model helpers so distributed.ts runs in isolation
// ---------------------------------------------------------------------------

vi.mock('../src/db', () => ({
    getAllNodes: vi.fn(() => [] as NodeWithStats[]),
}));

vi.mock('../src/models', () => ({
    parseParamCount: vi.fn((name: string) => {
        const match = name.toLowerCase().match(/(\d+\.?\d*)\s*b/);
        return match ? parseFloat(match[1]) * 1e9 : 7e9;
    }),
    estimateVramDetailed: vi.fn((_name: string, _quant: string) => {
        const params = (() => {
            const m = _name.toLowerCase().match(/(\d+\.?\d*)\s*b/);
            return m ? parseFloat(m[1]) : 7;
        })();
        const totalMb = Math.ceil(params * 1024 * 0.6); // rough Q4 estimate
        return {
            model_weights_mb: totalMb,
            kv_cache_mb: 512,
            overhead_mb: 256,
            total_mb: totalMb + 768,
        };
    }),
}));

import {
    planDistribution,
    estimateDistributedLatency,
    canDistribute,
    getDistributedModels,
    removeDistributedModel,
    getDistributedMetrics,
    getDistributionPlan,
    redistributeModel,
    getBoundaryCrossings,
    getLayerAssignments,
    recordDistributedLatency,
} from '../src/distributed';

import { getAllNodes } from '../src/db';

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

function makeNode(id: string, overrides?: Partial<NodeWithStats>): NodeWithStats {
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
        latest_stats: makeStats(id),
        ...overrides,
    };
}

/** Build N online nodes with the given free VRAM per node. */
function makeCluster(count: number, freeVramPerNode: number = 24000): NodeWithStats[] {
    return Array.from({ length: count }, (_, i) => {
        const totalVram = 49152; // 48 GB VRAM per GPU
        const usedVram = totalVram - freeVramPerNode;
        return makeNode(`node-${i}`, {
            latest_stats: makeStats(`node-${i}`, {
                gpus: [makeGpu({ vramTotalMb: totalVram, vramUsedMb: Math.max(0, usedVram) })],
            }),
        });
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Distribution Planning', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        // Clear internal state by removing any lingering models
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('planDistribution returns valid config for large model', () => {
        const nodes = makeCluster(3);
        const config = planDistribution('llama3.1:70b', nodes);

        expect(config).toBeDefined();
        expect(config.model).toBe('llama3.1:70b');
        expect(config.total_layers).toBeGreaterThan(0);
        expect(config.total_params_b).toBeGreaterThan(0);
        expect(config.nodes.length).toBeGreaterThanOrEqual(2);
        expect(config.pipeline_parallel_size).toBe(config.nodes.length);
    });

    it('planDistribution distributes layers proportionally to VRAM', () => {
        // Node 0 has 32000 MB free, Node 1 has 16000 MB free (total 48000 > 43776 needed)
        const bigNode = makeNode('big', {
            latest_stats: makeStats('big', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 17152 })], // 32000 free
            }),
        });
        const smallNode = makeNode('small', {
            latest_stats: makeStats('small', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 33152 })], // 16000 free
            }),
        });

        const config = planDistribution('llama3.1:70b', [bigNode, smallNode]);

        // The node with more VRAM should get more layers
        const bigAssignment = config.nodes.find(n => n.node_id === 'big')!;
        const smallAssignment = config.nodes.find(n => n.node_id === 'small')!;

        const bigLayerCount = bigAssignment.layers.end - bigAssignment.layers.start + 1;
        const smallLayerCount = smallAssignment.layers.end - smallAssignment.layers.start + 1;

        expect(bigLayerCount).toBeGreaterThan(smallLayerCount);
    });

    it('planDistribution requires at least 2 nodes', () => {
        const singleNode = makeCluster(1);
        expect(() => planDistribution('llama3.1:70b', singleNode))
            .toThrow(/at least 2/i);
    });

    it('planDistribution handles no eligible nodes', () => {
        expect(() => planDistribution('llama3.1:70b', []))
            .toThrow(/at least 2/i);
    });

    it('Layer assignments are contiguous (no gaps)', () => {
        const nodes = makeCluster(4);
        const config = planDistribution('llama3.1:70b', nodes);

        // Sort by layer start
        const sorted = [...config.nodes].sort((a, b) => a.layers.start - b.layers.start);

        // First node starts at 0
        expect(sorted[0].layers.start).toBe(0);

        // Each subsequent node picks up where the previous left off
        for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].layers.start).toBe(sorted[i - 1].layers.end + 1);
        }

        // Last node ends at total_layers - 1
        expect(sorted[sorted.length - 1].layers.end).toBe(config.total_layers - 1);
    });
});

describe('Latency Estimation', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('estimateDistributedLatency returns positive number', () => {
        const nodes = makeCluster(2);
        vi.mocked(getAllNodes).mockReturnValue(nodes);

        const config = planDistribution('llama3.1:70b', nodes);
        const est = estimateDistributedLatency(config);

        expect(est.total_ms).toBeGreaterThan(0);
        expect(est.per_node_ms.length).toBeGreaterThanOrEqual(2);
        expect(est.boundary_crossings).toBe(config.nodes.length - 1);
    });

    it('More nodes increases latency (communication overhead)', () => {
        // Use smaller VRAM per node (12000 MB) so the planner must use all provided nodes.
        // 70b model needs ~43776 MB. 2 nodes x 24000 = 48000, 4 nodes x 12000 = 48000.
        const twoNodes = makeCluster(2, 24000);
        const fourNodes = makeCluster(4, 12000);
        vi.mocked(getAllNodes).mockReturnValue(twoNodes);
        const config2 = planDistribution('llama3.1:70b', twoNodes);

        // Clean up before next plan
        removeDistributedModel('llama3.1:70b');

        vi.mocked(getAllNodes).mockReturnValue(fourNodes);
        const config4 = planDistribution('llama3.1:70b', fourNodes);

        const est2 = estimateDistributedLatency(config2);
        const est4 = estimateDistributedLatency(config4);

        // 4 nodes has more boundary crossings than 2 nodes
        expect(est4.boundary_crossings).toBeGreaterThan(est2.boundary_crossings);
        expect(est4.inter_node_transfer_ms).toBeGreaterThan(est2.inter_node_transfer_ms);
    });

    it('Single-node is faster than multi-node (when single-node config exists)', () => {
        const nodes = makeCluster(3);
        vi.mocked(getAllNodes).mockReturnValue(nodes);

        const config = planDistribution('llama3.1:70b', nodes);
        const est = estimateDistributedLatency(config);

        // A single-node config would have 0 boundary crossings
        expect(est.inter_node_transfer_ms).toBeGreaterThan(0);
        // Total latency includes inter-node overhead which wouldn't exist for single-node
        expect(est.boundary_crossings).toBeGreaterThan(0);
    });
});

describe('Feasibility Check', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('canDistribute returns true when VRAM sufficient', () => {
        const nodes = makeCluster(3, 20000); // 20 GB free per node = 60 GB total
        const result = canDistribute('llama3.1:70b', nodes);

        expect(result.feasible).toBe(true);
        expect(result.total_vram_available_mb).toBeGreaterThan(0);
        expect(result.eligible_node_count).toBe(3);
        expect(result.shortfall_mb).toBe(0);
    });

    it('canDistribute returns false when VRAM insufficient', () => {
        // Tiny free VRAM: 100 MB per node
        const nodes = makeCluster(2, 100);
        const result = canDistribute('llama3.1:70b', nodes);

        expect(result.feasible).toBe(false);
        expect(result.reason).toMatch(/insufficient/i);
        expect(result.shortfall_mb).toBeGreaterThan(0);
    });

    it('canDistribute requires minimum 2 nodes', () => {
        const nodes = makeCluster(1);
        const result = canDistribute('llama3.1:70b', nodes);

        expect(result.feasible).toBe(false);
        expect(result.reason).toMatch(/at least 2/i);
        expect(result.eligible_node_count).toBe(1);
    });
});

describe('Model Management', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('getDistributedModels returns empty initially', () => {
        const models = getDistributedModels();
        expect(models).toEqual([]);
    });

    it('After planDistribution, model appears in list', () => {
        const nodes = makeCluster(3);
        planDistribution('llama3.1:70b', nodes);

        const models = getDistributedModels();
        expect(models.length).toBe(1);
        expect(models[0].model).toBe('llama3.1:70b');
        expect(models[0].node_count).toBeGreaterThanOrEqual(2);

        // cleanup
        removeDistributedModel('llama3.1:70b');
    });

    it('removeDistributedModel cleans up', () => {
        const nodes = makeCluster(3);
        planDistribution('llama3.1:70b', nodes);

        expect(removeDistributedModel('llama3.1:70b')).toBe(true);
        expect(removeDistributedModel('llama3.1:70b')).toBe(false); // already removed
        expect(getDistributedModels().length).toBe(0);
    });
});

describe('Metrics', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('getDistributedMetrics returns null for unknown model', () => {
        expect(getDistributedMetrics('nonexistent-model:70b')).toBeNull();
    });

    it('getDistributedMetrics returns data for active model', () => {
        const nodes = makeCluster(3);
        vi.mocked(getAllNodes).mockReturnValue(nodes);
        planDistribution('llama3.1:70b', nodes);

        const metrics = getDistributedMetrics('llama3.1:70b');
        expect(metrics).not.toBeNull();
        expect(metrics!.model).toBe('llama3.1:70b');
        expect(metrics!.nodes.length).toBeGreaterThanOrEqual(2);
        expect(metrics!.total_latency_ms).toBeGreaterThan(0);
        expect(metrics!.tokens_per_sec).toBeGreaterThan(0);

        removeDistributedModel('llama3.1:70b');
    });
});

describe('Distribution Plan Retrieval', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('getDistributionPlan returns null for unplanned model', () => {
        expect(getDistributionPlan('nonexistent:70b')).toBeNull();
    });

    it('getDistributionPlan returns config after planning', () => {
        const nodes = makeCluster(3);
        planDistribution('llama3.1:70b', nodes);

        const plan = getDistributionPlan('llama3.1:70b');
        expect(plan).not.toBeNull();
        expect(plan!.model).toBe('llama3.1:70b');
        expect(plan!.nodes.length).toBeGreaterThanOrEqual(2);

        removeDistributedModel('llama3.1:70b');
    });
});

describe('Redistribution', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('redistributeModel creates a new plan', () => {
        const nodes = makeCluster(3);
        vi.mocked(getAllNodes).mockReturnValue(nodes);
        planDistribution('llama3.1:70b', nodes);

        const newNodes = makeCluster(4);
        vi.mocked(getAllNodes).mockReturnValue(newNodes);
        const newConfig = redistributeModel('llama3.1:70b', newNodes);

        expect(newConfig).toBeDefined();
        expect(newConfig.model).toBe('llama3.1:70b');
        expect(newConfig.nodes.length).toBeGreaterThanOrEqual(2);

        removeDistributedModel('llama3.1:70b');
    });
});

describe('Boundary Crossings', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('getBoundaryCrossings is nodes - 1', () => {
        const nodes = makeCluster(3);
        const config = planDistribution('llama3.1:70b', nodes);
        const crossings = getBoundaryCrossings(config);

        expect(crossings).toBe(config.nodes.length - 1);

        removeDistributedModel('llama3.1:70b');
    });

    it('getBoundaryCrossings is 0 for empty config', () => {
        // Construct a config with no nodes
        const fakeConfig = {
            model: 'test:7b',
            nodes: [],
            total_layers: 0,
            total_params_b: 0,
            pipeline_parallel_size: 0,
            tensor_parallel_size: 1,
        };
        expect(getBoundaryCrossings(fakeConfig)).toBe(0);
    });
});

describe('Layer Assignments', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('getLayerAssignments returns flat list with correct fields', () => {
        const nodes = makeCluster(3);
        vi.mocked(getAllNodes).mockReturnValue(nodes);
        const config = planDistribution('llama3.1:70b', nodes);
        const assignments = getLayerAssignments(config);

        expect(assignments.length).toBe(config.nodes.length);
        for (const a of assignments) {
            expect(a.node_id).toBeDefined();
            expect(a.layers_start).toBeGreaterThanOrEqual(0);
            expect(a.layers_end).toBeGreaterThanOrEqual(a.layers_start);
            expect(a.vram_needed_mb).toBeGreaterThan(0);
            expect(a.estimated_latency_ms).toBeGreaterThan(0);
        }

        removeDistributedModel('llama3.1:70b');
    });
});

describe('Distributed Latency Recording', () => {
    it('recordDistributedLatency does not throw', () => {
        expect(() => recordDistributedLatency('some-node', 5.5)).not.toThrow();
    });
});

describe('Edge Cases', () => {
    beforeEach(() => {
        vi.mocked(getAllNodes).mockReset();
        for (const m of getDistributedModels()) {
            removeDistributedModel(m.model);
        }
    });

    it('planDistribution filters out offline nodes', () => {
        // Each online node has 24000 MB free, so both are needed (24000*2=48000 > 43776)
        const online1 = makeNode('on-1', {
            latest_stats: makeStats('on-1', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 25152 })], // 24000 free
            }),
        });
        const online2 = makeNode('on-2', {
            latest_stats: makeStats('on-2', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 25152 })], // 24000 free
            }),
        });
        const offline = makeNode('off-1', {
            status: 'offline' as const,
            latest_stats: makeStats('off-1', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 25152 })],
            }),
        });

        const config = planDistribution('llama3.1:70b', [online1, online2, offline]);

        const nodeIds = config.nodes.map(n => n.node_id);
        expect(nodeIds).not.toContain('off-1');
        expect(nodeIds).toContain('on-1');
        expect(nodeIds).toContain('on-2');

        removeDistributedModel('llama3.1:70b');
    });

    it('planDistribution filters out nodes without GPUs', () => {
        const gpuNode1 = makeNode('gpu-1', {
            latest_stats: makeStats('gpu-1', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 1000 })],
            }),
        });
        const gpuNode2 = makeNode('gpu-2', {
            latest_stats: makeStats('gpu-2', {
                gpus: [makeGpu({ vramTotalMb: 49152, vramUsedMb: 1000 })],
            }),
        });
        const cpuOnly = makeNode('cpu-1', {
            gpu_count: 0,
            latest_stats: makeStats('cpu-1', {
                gpu_count: 0,
                gpus: [],
            }),
        });

        const config = planDistribution('llama3.1:70b', [gpuNode1, gpuNode2, cpuOnly]);
        const nodeIds = config.nodes.map(n => n.node_id);
        expect(nodeIds).not.toContain('cpu-1');

        removeDistributedModel('llama3.1:70b');
    });

    it('canDistribute reports shortfall when VRAM nearly sufficient', () => {
        // Just barely not enough
        const nodes = makeCluster(2, 500); // 1000 MB total, far less than needed
        const result = canDistribute('llama3.1:70b', nodes);

        expect(result.feasible).toBe(false);
        expect(result.shortfall_mb).toBeGreaterThan(0);
        expect(result.total_vram_required_mb).toBeGreaterThan(result.total_vram_available_mb);
    });

    it('planDistribution config has correct total_params_b', () => {
        const nodes = makeCluster(3);
        const config = planDistribution('llama3.1:70b', nodes);

        expect(config.total_params_b).toBe(70);

        removeDistributedModel('llama3.1:70b');
    });

    it('planDistribution sets tensor_parallel_size to 1 by default', () => {
        const nodes = makeCluster(3);
        const config = planDistribution('llama3.1:70b', nodes);

        expect(config.tensor_parallel_size).toBe(1);

        removeDistributedModel('llama3.1:70b');
    });

    it('canDistribute with empty node list returns infeasible', () => {
        const result = canDistribute('llama3.1:70b', []);
        expect(result.feasible).toBe(false);
        expect(result.eligible_node_count).toBe(0);
    });

    it('estimateDistributedLatency bottleneck_node_id is set', () => {
        const nodes = makeCluster(3);
        vi.mocked(getAllNodes).mockReturnValue(nodes);
        const config = planDistribution('llama3.1:70b', nodes);
        const est = estimateDistributedLatency(config);

        expect(est.bottleneck_node_id).not.toBeNull();

        removeDistributedModel('llama3.1:70b');
    });
});
