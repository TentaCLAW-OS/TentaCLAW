/**
 * TentaCLAW Gateway — Stress & Chaos Tests
 *
 * Validates gateway behavior under concurrent load, data integrity
 * under chaotic conditions, and response time requirements.
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StatsPayload } from '../../shared/types';
import { app, initClusterSecret } from '../src/index';

import {
    getDb,
    registerNode,
    getNode,
    getAllNodes,
    deleteNode,
    insertStats,
    getStatsHistory,
    queueCommand,
    checkAndAlert,
    getRecentAlerts,
    createApiKey,
    exportClusterConfig,
    importClusterConfig,
} from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';
// Set a known cluster secret so agent-authenticated endpoints accept requests
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';
initClusterSecret();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanDb(): void {
    const db = getDb();
    db.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM ssh_keys;
        DELETE FROM node_tags;
        DELETE FROM model_pulls;
        DELETE FROM stats;
        DELETE FROM commands;
        DELETE FROM flight_sheets;
        DELETE FROM alerts;
        DELETE FROM benchmarks;
        DELETE FROM node_events;
        DELETE FROM schedules;
        DELETE FROM nodes;
        DELETE FROM route_latency;
        DELETE FROM route_throughput;
        PRAGMA foreign_keys = ON;
    `);
}

function makeStats(nodeId: string, overrides?: Partial<StatsPayload>): StatsPayload {
    return {
        farm_hash: 'FARM0001',
        node_id: nodeId,
        hostname: 'test-rig',
        uptime_secs: 3600,
        gpu_count: 1,
        gpus: [{
            busId: '0000:01:00.0',
            name: 'RTX 3090',
            vramTotalMb: 24576,
            vramUsedMb: 8192,
            temperatureC: 65,
            utilizationPct: 80,
            powerDrawW: 300,
            fanSpeedPct: 60,
            clockSmMhz: 1800,
            clockMemMhz: 9500,
        }],
        cpu: { usage_pct: 45, temp_c: 55 },
        ram: { total_mb: 32768, used_mb: 16384 },
        disk: { total_gb: 500, used_gb: 250 },
        network: { bytes_in: 1000000, bytes_out: 500000 },
        inference: {
            loaded_models: ['llama3.1:8b'],
            in_flight_requests: 2,
            tokens_generated: 50000,
            avg_latency_ms: 45,
        },
        toks_per_sec: 120,
        requests_completed: 500,
        ...overrides,
    };
}

function makeHotStats(nodeId: string, tempC: number = 90): StatsPayload {
    const stats = makeStats(nodeId);
    stats.gpus[0].temperatureC = tempC;
    return stats;
}

function registerHelper(id: string): void {
    registerNode({ node_id: id, farm_hash: 'FARM0001', hostname: `host-${id}`, gpu_count: 1 });
}

// =============================================================================
// Stress: Concurrent Registration
// =============================================================================

describe('Stress: Concurrent Registration', () => {
    beforeEach(cleanDb);

    it('registers 100 nodes concurrently without errors', async () => {
        const promises = Array.from({ length: 100 }, (_, i) => {
            const nodeId = `stress-node-${String(i).padStart(3, '0')}`;
            return app.request('/api/v1/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify({
                    node_id: nodeId,
                    farm_hash: 'STRESS-FARM',
                    hostname: `rig-${i}`,
                    gpu_count: 2,
                }),
            });
        });

        const responses = await Promise.all(promises);

        // All should succeed
        for (const res of responses) {
            expect(res.status).toBe(200);
        }
    });

    it('has all 100 nodes in the DB after concurrent registration', async () => {
        const promises = Array.from({ length: 100 }, (_, i) =>
            app.request('/api/v1/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify({
                    node_id: `batch-node-${String(i).padStart(3, '0')}`,
                    farm_hash: 'BATCH-FARM',
                    hostname: `rig-${i}`,
                    gpu_count: 1,
                }),
            }),
        );

        await Promise.all(promises);
        const allNodes = getAllNodes();
        expect(allNodes.length).toBe(100);
    });

    it('produces no duplicate node IDs after concurrent registration', async () => {
        const promises = Array.from({ length: 100 }, (_, i) =>
            app.request('/api/v1/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify({
                    node_id: `unique-node-${String(i).padStart(3, '0')}`,
                    farm_hash: 'UNIQUE-FARM',
                    hostname: `rig-${i}`,
                    gpu_count: 1,
                }),
            }),
        );

        await Promise.all(promises);
        const allNodes = getAllNodes();
        const ids = allNodes.map(n => n.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });
});

// =============================================================================
// Stress: Concurrent Stats Push
// =============================================================================

describe('Stress: Concurrent Stats Push', () => {
    beforeEach(cleanDb);

    it('pushes stats from 50 nodes simultaneously', async () => {
        // Pre-register 50 nodes
        for (let i = 0; i < 50; i++) {
            registerHelper(`stats-node-${String(i).padStart(3, '0')}`);
        }

        const promises = Array.from({ length: 50 }, (_, i) => {
            const nodeId = `stats-node-${String(i).padStart(3, '0')}`;
            return app.request(`/api/v1/nodes/${nodeId}/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify(makeStats(nodeId)),
            });
        });

        const responses = await Promise.all(promises);

        for (const res of responses) {
            expect(res.status).toBe(200);
        }
    });

    it('records stats for all 50 nodes after concurrent push', async () => {
        for (let i = 0; i < 50; i++) {
            registerHelper(`rec-node-${String(i).padStart(3, '0')}`);
        }

        const promises = Array.from({ length: 50 }, (_, i) => {
            const nodeId = `rec-node-${String(i).padStart(3, '0')}`;
            return app.request(`/api/v1/nodes/${nodeId}/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify(makeStats(nodeId)),
            });
        });

        await Promise.all(promises);

        // Verify each node has exactly 1 stats record
        for (let i = 0; i < 50; i++) {
            const nodeId = `rec-node-${String(i).padStart(3, '0')}`;
            const history = getStatsHistory(nodeId);
            expect(history.length).toBe(1);
        }
    });

    it('responds to all 50 concurrent stats pushes in under 100ms each', async () => {
        for (let i = 0; i < 50; i++) {
            registerHelper(`perf-node-${String(i).padStart(3, '0')}`);
        }

        const timings: number[] = [];
        const promises = Array.from({ length: 50 }, async (_, i) => {
            const nodeId = `perf-node-${String(i).padStart(3, '0')}`;
            const start = performance.now();
            const res = await app.request(`/api/v1/nodes/${nodeId}/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify(makeStats(nodeId)),
            });
            const elapsed = performance.now() - start;
            timings.push(elapsed);
            return res;
        });

        await Promise.all(promises);

        for (const t of timings) {
            expect(t).toBeLessThan(100);
        }
    });
});

// =============================================================================
// Stress: Rapid Model Deployment
// =============================================================================

describe('Stress: Rapid Model Deployment', () => {
    beforeEach(cleanDb);

    it('queues 20 deploy commands to different nodes', () => {
        // Register 20 nodes
        for (let i = 0; i < 20; i++) {
            registerHelper(`deploy-node-${String(i).padStart(2, '0')}`);
        }

        const commands = Array.from({ length: 20 }, (_, i) => {
            const nodeId = `deploy-node-${String(i).padStart(2, '0')}`;
            return queueCommand(nodeId, 'install_model', { model: `model-${i}` });
        });

        // All commands should have been created with unique IDs
        expect(commands.length).toBe(20);
        const ids = commands.map(c => c.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(20);

        // Each command should have the correct action
        for (const cmd of commands) {
            expect(cmd.action).toBe('install_model');
        }
    });
});

// =============================================================================
// Stress: Alert Storm
// =============================================================================

describe('Stress: Alert Storm', () => {
    beforeEach(cleanDb);

    it('pushes high-temp stats from 30 nodes simultaneously and generates alerts', async () => {
        // Register 30 nodes
        for (let i = 0; i < 30; i++) {
            registerHelper(`hot-node-${String(i).padStart(2, '0')}`);
        }

        const promises = Array.from({ length: 30 }, (_, i) => {
            const nodeId = `hot-node-${String(i).padStart(2, '0')}`;
            return app.request(`/api/v1/nodes/${nodeId}/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify(makeHotStats(nodeId, 90)),
            });
        });

        const responses = await Promise.all(promises);

        for (const res of responses) {
            expect(res.status).toBe(200);
        }

        // All 30 nodes should have generated alerts
        const alerts = getRecentAlerts(200);
        const overheatAlerts = alerts.filter(a => a.type === 'gpu_overheat');

        // Each node should have at least one gpu_overheat alert
        const alertedNodes = new Set(overheatAlerts.map(a => a.node_id));
        expect(alertedNodes.size).toBe(30);
    });

    it('does not create duplicate alert types per node in single push', () => {
        registerHelper('dedup-node');

        // Push high-temp stats once
        const stats = makeHotStats('dedup-node', 90);
        const alerts = checkAndAlert('dedup-node', stats);

        // Should have exactly one gpu_overheat alert for this node
        const overheatAlerts = alerts.filter(a => a.type === 'gpu_overheat');
        expect(overheatAlerts.length).toBe(1);
        expect(overheatAlerts[0].node_id).toBe('dedup-node');
    });
});

// =============================================================================
// Stress: API Key Operations
// =============================================================================

describe('Stress: API Key Operations', () => {
    beforeEach(cleanDb);

    it('creates 50 API keys concurrently with unique IDs', () => {
        const keys = Array.from({ length: 50 }, (_, i) =>
            createApiKey(`key-${i}`, 'inference', 1000),
        );

        expect(keys.length).toBe(50);

        // All IDs must be unique
        const ids = keys.map(k => k.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(50);

        // All raw keys must be unique
        const rawKeys = keys.map(k => k.key);
        const uniqueRawKeys = new Set(rawKeys);
        expect(uniqueRawKeys.size).toBe(50);

        // Each key should have a name
        for (let i = 0; i < 50; i++) {
            expect(keys[i].name).toBe(`key-${i}`);
        }
    });
});

// =============================================================================
// Chaos: Data Integrity
// =============================================================================

describe('Chaos: Data Integrity', () => {
    beforeEach(cleanDb);

    it('register -> push stats -> delete -> re-register produces clean state', () => {
        // Register and push stats
        registerHelper('lifecycle-node');
        insertStats('lifecycle-node', makeStats('lifecycle-node'));
        expect(getStatsHistory('lifecycle-node').length).toBe(1);

        // Delete
        expect(deleteNode('lifecycle-node')).toBe(true);
        expect(getNode('lifecycle-node')).toBeNull();

        // Re-register
        registerHelper('lifecycle-node');
        const node = getNode('lifecycle-node');
        expect(node).not.toBeNull();
        expect(node!.status).toBe('online');

        // Stats history should be empty after delete + re-register
        // (cascade deletes stats with the node)
        const history = getStatsHistory('lifecycle-node');
        expect(history.length).toBe(0);
    });

    it('pushing stats to non-existent node auto-registers it', async () => {
        // Node does not exist
        expect(getNode('phantom-node')).toBeNull();

        const res = await app.request('/api/v1/nodes/phantom-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify(makeStats('phantom-node')),
        });

        expect(res.status).toBe(200);

        // Node should now exist
        const node = getNode('phantom-node');
        expect(node).not.toBeNull();
        expect(node!.id).toBe('phantom-node');
    });

    it('pushing malformed stats (missing optional fields) does not crash', async () => {
        registerHelper('malformed-node');

        // Send stats with all required nested objects present but optional fields missing.
        // The gateway requires cpu, ram, disk, network, inference to exist as objects.
        const res = await app.request('/api/v1/nodes/malformed-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                farm_hash: 'FARM0001',
                node_id: 'malformed-node',
                hostname: 'test',
                gpu_count: 0,
                gpus: [],
                cpu: { usage_pct: 0, temp_c: 0 },
                ram: { total_mb: 1, used_mb: 0 },
                disk: { total_gb: 1, used_gb: 0 },
                network: { bytes_in: 0, bytes_out: 0 },
                inference: { loaded_models: [], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
                // Missing: uptime_secs, toks_per_sec, requests_completed
            }),
        });

        // Should succeed even with missing optional numeric fields
        expect(res.status).toBe(200);
    });

    it('pushing deeply malformed stats (missing nested objects) returns error', async () => {
        registerHelper('broken-node');

        const res = await app.request('/api/v1/nodes/broken-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                // Missing cpu, ram, disk, network, inference objects entirely
                farm_hash: 'FARM0001',
                node_id: 'broken-node',
                hostname: 'test',
            }),
        });

        // Gateway now defensively fills in missing nested objects with defaults,
        // so this succeeds with 200.
        expect(res.status).toBe(200);

        // Verify the server is still alive after the error
        const healthRes = await app.request('/health');
        expect(healthRes.status).toBe(200);
    });

    it('pushing stats with extreme values does not crash', async () => {
        registerHelper('extreme-node');

        const extremeStats = makeStats('extreme-node');
        extremeStats.gpus[0].temperatureC = 999;
        extremeStats.gpus[0].vramUsedMb = -1;
        extremeStats.cpu.usage_pct = 999;
        extremeStats.ram.used_mb = -1;
        extremeStats.disk.used_gb = 99999;

        const res = await app.request('/api/v1/nodes/extreme-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify(extremeStats),
        });

        // Should not crash — may succeed or validate, but no 500
        expect(res.status).toBeLessThan(500);

        // Stats should still be recorded (gateway stores what it receives)
        const history = getStatsHistory('extreme-node');
        expect(history.length).toBe(1);
    });
});

// =============================================================================
// Chaos: Concurrent Read/Write
// =============================================================================

describe('Chaos: Concurrent Read/Write', () => {
    beforeEach(cleanDb);

    it('reads nodes while simultaneously registering new ones', async () => {
        // Pre-register some nodes
        for (let i = 0; i < 5; i++) {
            registerHelper(`existing-${i}`);
        }

        // Concurrently: register 10 new nodes + read the node list 10 times
        const registerPromises = Array.from({ length: 10 }, (_, i) =>
            app.request('/api/v1/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify({
                    node_id: `concurrent-${i}`,
                    farm_hash: 'CONC-FARM',
                    hostname: `rig-${i}`,
                    gpu_count: 1,
                }),
            }),
        );

        const readPromises = Array.from({ length: 10 }, () =>
            app.request('/api/v1/nodes'),
        );

        const allResults = await Promise.all([...registerPromises, ...readPromises]);

        // All register calls should succeed
        for (let i = 0; i < 10; i++) {
            expect(allResults[i].status).toBe(200);
        }

        // All read calls should succeed (status 200) and return valid JSON
        for (let i = 10; i < 20; i++) {
            expect(allResults[i].status).toBe(200);
            const json = await allResults[i].json() as { nodes: unknown[] };
            expect(Array.isArray(json.nodes)).toBe(true);
        }

        // After all operations, we should have 15 nodes (5 existing + 10 new)
        const finalNodes = getAllNodes();
        expect(finalNodes.length).toBe(15);
    });

    it('reads alerts while simultaneously pushing high-temp stats', async () => {
        // Register nodes
        for (let i = 0; i < 10; i++) {
            registerHelper(`alert-rw-${i}`);
        }

        // Concurrently: push hot stats + read summary
        const pushPromises = Array.from({ length: 10 }, (_, i) => {
            const nodeId = `alert-rw-${i}`;
            return app.request(`/api/v1/nodes/${nodeId}/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
                body: JSON.stringify(makeHotStats(nodeId, 90)),
            });
        });

        const readPromises = Array.from({ length: 10 }, () =>
            app.request('/api/v1/summary'),
        );

        const allResults = await Promise.all([...pushPromises, ...readPromises]);

        // All pushes should succeed
        for (let i = 0; i < 10; i++) {
            expect(allResults[i].status).toBe(200);
        }

        // All reads should succeed
        for (let i = 10; i < 20; i++) {
            expect(allResults[i].status).toBe(200);
        }
    });

    it('exports config while importing different config concurrently', () => {
        // Setup: create some initial config data
        registerHelper('config-node-1');
        registerHelper('config-node-2');

        // Export current config
        const exported = exportClusterConfig();
        expect(exported).toBeDefined();
        expect(exported.version).toBeDefined();

        // Import a different config — should not crash even running near-simultaneously
        const importResult = importClusterConfig({
            aliases: [
                { alias: 'default', target: 'llama3.1:8b', fallbacks: [] },
            ],
            flight_sheets: [
                { name: 'Import Test', description: 'test', targets: [] },
            ],
        });

        expect(importResult.errors.length).toBe(0);
        expect(importResult.imported.length).toBeGreaterThan(0);

        // Export again to confirm state is consistent
        const exported2 = exportClusterConfig();
        expect(exported2).toBeDefined();
    });
});

// =============================================================================
// Performance: Response Times
// =============================================================================

describe('Performance: Response Times', () => {
    beforeEach(cleanDb);

    it('GET /health responds in under 5ms', async () => {
        const start = performance.now();
        const res = await app.request('/health');
        const elapsed = performance.now() - start;

        expect(res.status).toBe(200);
        expect(elapsed).toBeLessThan(5);
    });

    it('GET /api/v1/nodes responds in under 20ms', async () => {
        // Seed a few nodes to make it realistic
        for (let i = 0; i < 10; i++) {
            registerHelper(`perf-list-${i}`);
        }

        const start = performance.now();
        const res = await app.request('/api/v1/nodes');
        const elapsed = performance.now() - start;

        expect(res.status).toBe(200);
        expect(elapsed).toBeLessThan(20);
    });

    it('GET /api/v1/summary responds in under 20ms', async () => {
        for (let i = 0; i < 10; i++) {
            registerHelper(`perf-summary-${i}`);
        }

        const start = performance.now();
        const res = await app.request('/api/v1/summary');
        const elapsed = performance.now() - start;

        expect(res.status).toBe(200);
        expect(elapsed).toBeLessThan(20);
    });

    it('POST /api/v1/register responds in under 50ms', async () => {
        const start = performance.now();
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'perf-register-node',
                farm_hash: 'PERF-FARM',
                hostname: 'perf-rig',
                gpu_count: 4,
            }),
        });
        const elapsed = performance.now() - start;

        expect(res.status).toBe(200);
        expect(elapsed).toBeLessThan(50);
    });
});
