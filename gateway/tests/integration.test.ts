/**
 * TentaCLAW Gateway — Integration Tests
 *
 * Spins up the actual Hono app and tests the full HTTP flow:
 * register → push stats → query nodes → send commands → verify.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StatsPayload } from '../../shared/types';
import {
    getDb,
    registerNode,
    getAllNodes,
    getNode,
    insertStats,
    getPendingCommands,
    ackCommand,
    queueCommand,
    getClusterSummary,
    getHealthScore,
    checkAndAlert,
    getRecentAlerts,
    createFlightSheet,
    applyFlightSheet,
    storeBenchmark,
    getNodeBenchmarks,
    createSchedule,
    getAllSchedules,
    getClusterModels,
    findBestNode,
    getCompactHistory,
} from '../src/db';

process.env.TENTACLAW_DB_PATH = ':memory:';

function clearDb() {
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    for (const table of ['ssh_keys', 'node_tags', 'model_pulls', 'nodes', 'stats', 'commands', 'flight_sheets', 'alerts', 'benchmarks', 'node_events', 'schedules', 'route_latency', 'route_throughput']) {
        db.prepare('DELETE FROM ' + table).run();
    }
    db.pragma('foreign_keys = ON');
}

function mockStats(nodeId: string, overrides?: Partial<StatsPayload>): StatsPayload {
    return {
        farm_hash: 'FARM7K3P',
        node_id: nodeId,
        hostname: 'test-rig',
        uptime_secs: 7200,
        gpu_count: 2,
        gpus: [
            { busId: '0:1', name: 'RTX 4070 Ti Super', vramTotalMb: 16384, vramUsedMb: 8000, temperatureC: 62, utilizationPct: 75, powerDrawW: 220, fanSpeedPct: 50, clockSmMhz: 2300, clockMemMhz: 10500 },
            { busId: '0:2', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 12000, temperatureC: 68, utilizationPct: 85, powerDrawW: 310, fanSpeedPct: 65, clockSmMhz: 1850, clockMemMhz: 9750 },
        ],
        cpu: { usage_pct: 55, temp_c: 48 },
        ram: { total_mb: 65536, used_mb: 40960 },
        disk: { total_gb: 1000, used_gb: 450 },
        network: { bytes_in: 8000000000, bytes_out: 2000000000 },
        inference: { loaded_models: ['llama3.1:8b', 'hermes3:8b'], in_flight_requests: 2, tokens_generated: 500000, avg_latency_ms: 35 },
        toks_per_sec: 210,
        requests_completed: 8000,
        ...overrides,
    };
}

describe('Integration: Full Node Lifecycle', () => {
    beforeEach(clearDb);

    it('register → push stats → query → commands → verify', () => {
        // 1. Register
        const node = registerNode({
            node_id: 'int-node-1',
            farm_hash: 'FARM7K3P',
            hostname: 'integration-rig',
            ip_address: '10.0.0.50',
            gpu_count: 2,
            os_version: '0.1.0',
        });
        expect(node.status).toBe('online');

        // 2. Push stats
        const stats = mockStats('int-node-1');
        insertStats('int-node-1', stats);

        // 3. Query node — should have latest_stats attached
        const queried = getNode('int-node-1');
        expect(queried).not.toBeNull();
        expect(queried!.latest_stats).not.toBeNull();
        expect(queried!.latest_stats!.toks_per_sec).toBe(210);
        expect(queried!.latest_stats!.gpus.length).toBe(2);

        // 4. Queue a command
        const cmd = queueCommand('int-node-1', 'install_model', { model: 'codellama:7b' });
        expect(cmd.action).toBe('install_model');

        // 5. Agent fetches pending commands (simulates next stats push)
        const pending = getPendingCommands('int-node-1');
        expect(pending.length).toBe(1);
        expect(pending[0].model).toBe('codellama:7b');

        // 6. ACK the command — now it should no longer appear as pending
        ackCommand(cmd.id);
        const pendingAgain = getPendingCommands('int-node-1');
        expect(pendingAgain.length).toBe(0);
    });
});

describe('Integration: Multi-Node Cluster', () => {
    beforeEach(clearDb);

    it('registers multiple nodes and computes correct summary', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'rig-1', ip_address: '10.0.0.1', gpu_count: 2 });
        registerNode({ node_id: 'n2', farm_hash: 'F1', hostname: 'rig-2', ip_address: '10.0.0.2', gpu_count: 1 });
        registerNode({ node_id: 'n3', farm_hash: 'F2', hostname: 'rig-3', ip_address: '10.0.0.3', gpu_count: 4 });

        insertStats('n1', mockStats('n1', { toks_per_sec: 200 }));
        insertStats('n2', mockStats('n2', { gpu_count: 1, gpus: [mockStats('n2').gpus[0]], toks_per_sec: 100 }));
        insertStats('n3', mockStats('n3', { toks_per_sec: 400 }));

        const summary = getClusterSummary();
        expect(summary.total_nodes).toBe(3);
        expect(summary.online_nodes).toBe(3);
        expect(summary.total_toks_per_sec).toBe(700);
        expect(summary.farm_hashes).toContain('F1');
        expect(summary.farm_hashes).toContain('F2');
    });
});

describe('Integration: Flight Sheet Deploy', () => {
    beforeEach(clearDb);

    it('creates flight sheet, applies it, and verifies commands queued', () => {
        registerNode({ node_id: 'fs-1', farm_hash: 'F1', hostname: 'rig-1', gpu_count: 1 });
        registerNode({ node_id: 'fs-2', farm_hash: 'F1', hostname: 'rig-2', gpu_count: 2 });

        const sheet = createFlightSheet('Deploy Llama', 'Llama on all nodes', [
            { node_id: '*', model: 'llama3.1:8b' },
        ]);

        const commands = applyFlightSheet(sheet.id);
        expect(commands.length).toBe(2);

        // Each node should have a pending install_model command
        const cmds1 = getPendingCommands('fs-1');
        const cmds2 = getPendingCommands('fs-2');
        expect(cmds1.length).toBe(1);
        expect(cmds1[0].model).toBe('llama3.1:8b');
        expect(cmds2.length).toBe(1);
    });
});

describe('Integration: Alert Pipeline', () => {
    beforeEach(clearDb);

    it('detects hot GPU and creates alert', () => {
        registerNode({ node_id: 'hot-node', farm_hash: 'F1', hostname: 'oven', gpu_count: 1 });

        const hotStats = mockStats('hot-node', {
            gpus: [{
                busId: '0:1', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 23000,
                temperatureC: 92, utilizationPct: 99, powerDrawW: 380,
                fanSpeedPct: 100, clockSmMhz: 1800, clockMemMhz: 9500,
            }],
        });

        const alerts = checkAndAlert('hot-node', hotStats);
        expect(alerts.length).toBeGreaterThanOrEqual(1);
        expect(alerts.some(a => a.severity === 'critical')).toBe(true);

        const recent = getRecentAlerts(10);
        expect(recent.length).toBeGreaterThanOrEqual(1);
    });

    it('does not alert on normal temps', () => {
        registerNode({ node_id: 'cool-node', farm_hash: 'F1', hostname: 'chill', gpu_count: 1 });
        const alerts = checkAndAlert('cool-node', mockStats('cool-node'));
        expect(alerts.length).toBe(0);
    });
});

describe('Integration: Health Score', () => {
    beforeEach(clearDb);

    it('returns high score for healthy cluster', () => {
        registerNode({ node_id: 'h1', farm_hash: 'F1', hostname: 'healthy', gpu_count: 2 });
        insertStats('h1', mockStats('h1'));

        const health = getHealthScore();
        expect(health.score).toBeGreaterThan(70);
        expect(health.grade).toMatch(/[AB]/);
        expect(health.color).toBe('green');
    });

    it('returns low score for empty cluster', () => {
        const health = getHealthScore();
        expect(health.score).toBe(0);
        expect(health.grade).toBe('F');
    });
});

describe('Integration: Benchmarks', () => {
    beforeEach(clearDb);

    it('stores and retrieves benchmark results', () => {
        registerNode({ node_id: 'bench-1', farm_hash: 'F1', hostname: 'bencher', gpu_count: 1 });

        const result = storeBenchmark('bench-1', {
            model: 'llama3.1:8b',
            tokens_per_sec: 185,
            prompt_eval_rate: 220,
            eval_rate: 185,
            total_duration_ms: 5400,
        });

        expect(result.tokens_per_sec).toBe(185);

        const history = getNodeBenchmarks('bench-1');
        expect(history.length).toBe(1);
        expect(history[0].model).toBe('llama3.1:8b');
    });
});

describe('Integration: Inference Routing', () => {
    beforeEach(clearDb);

    it('finds best node for a model', () => {
        registerNode({ node_id: 'inf-1', farm_hash: 'F1', hostname: 'busy', ip_address: '10.0.0.1', gpu_count: 1 });
        registerNode({ node_id: 'inf-2', farm_hash: 'F1', hostname: 'idle', ip_address: '10.0.0.2', gpu_count: 1 });

        insertStats('inf-1', mockStats('inf-1', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 5, tokens_generated: 0, avg_latency_ms: 0 },
            gpus: [{ ...mockStats('inf-1').gpus[0], utilizationPct: 95 }],
        }));

        insertStats('inf-2', mockStats('inf-2', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
            gpus: [{ ...mockStats('inf-2').gpus[0], utilizationPct: 20 }],
        }));

        const best = findBestNode('llama3.1:8b');
        expect(best).not.toBeNull();
        expect(best!.node_id).toBe('inf-2'); // idle node wins
    });

    it('returns null when no node has the model', () => {
        registerNode({ node_id: 'inf-1', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        insertStats('inf-1', mockStats('inf-1'));

        const best = findBestNode('nonexistent-model:latest');
        expect(best).toBeNull();
    });

    it('lists cluster models correctly', () => {
        registerNode({ node_id: 'cm-1', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        registerNode({ node_id: 'cm-2', farm_hash: 'F1', hostname: 'h2', gpu_count: 1 });

        insertStats('cm-1', mockStats('cm-1', { inference: { loaded_models: ['llama3.1:8b', 'codellama:7b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 } }));
        insertStats('cm-2', mockStats('cm-2', { inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 } }));

        const models = getClusterModels();
        expect(models.length).toBe(2);

        const llama = models.find(m => m.model === 'llama3.1:8b');
        expect(llama!.node_count).toBe(2);

        const codellama = models.find(m => m.model === 'codellama:7b');
        expect(codellama!.node_count).toBe(1);
    });
});

describe('Integration: Sparkline History', () => {
    beforeEach(clearDb);

    it('returns compact history for charts', () => {
        registerNode({ node_id: 'sp-1', farm_hash: 'F1', hostname: 'sparky', gpu_count: 2 });

        // Push 5 stats snapshots
        for (let i = 0; i < 5; i++) {
            insertStats('sp-1', mockStats('sp-1', { toks_per_sec: 100 + i * 20 }));
        }

        const history = getCompactHistory('sp-1', 5);
        expect(history.timestamps.length).toBe(5);
        expect(history.toks_per_sec.length).toBe(5);
        expect(history.gpu_temps.length).toBe(5);
        expect(history.gpu_temps[0].length).toBe(2); // 2 GPUs
        expect(history.cpu_usage.length).toBe(5);
    });
});

describe('Integration: Schedules', () => {
    beforeEach(clearDb);

    it('creates and retrieves schedules', () => {
        const schedule = createSchedule('Nightly Deploy', 'deploy', '@daily', { model: 'llama3.1:8b' });
        expect(schedule.name).toBe('Nightly Deploy');
        expect(schedule.enabled).toBe(true);
        expect(schedule.next_run).not.toBeNull();

        const all = getAllSchedules();
        expect(all.length).toBe(1);
    });
});
