/**
 * TentaCLAW Gateway — Advanced API Tests
 *
 * Tests HTTP endpoints: API keys, export/import, health scoring,
 * fleet reliability, cluster summary, dashboard, and Prometheus metrics.
 * Uses the Hono app directly via app.request() for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { app, initClusterSecret } from '../src/index';
import { getDb } from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';
// Set a known cluster secret so agent-authenticated endpoints accept requests
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';
initClusterSecret();

/** Wipe all tables between tests for full isolation. */
function resetDb(): void {
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
        DELETE FROM api_keys;
        DELETE FROM inference_log;
        DELETE FROM model_aliases;
        DELETE FROM notification_channels;
        DELETE FROM prompt_cache;
        DELETE FROM watchdog_events;
        DELETE FROM overclock_profiles;
        DELETE FROM uptime_events;
        DELETE FROM route_latency;
        DELETE FROM route_throughput;
        PRAGMA foreign_keys = ON;
    `);
}

/** Register a test node via the HTTP endpoint. */
async function registerTestNode(
    nodeId = 'TENTACLAW-TEST-node001',
    farmHash = 'TESTFARM',
    hostname = 'gpu-rig-test',
    gpuCount = 2,
): Promise<Response> {
    return app.request('/api/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
        body: JSON.stringify({
            node_id: nodeId,
            farm_hash: farmHash,
            hostname,
            ip_address: '10.0.0.1',
            mac_address: 'aa:bb:cc:dd:ee:ff',
            gpu_count: gpuCount,
            os_version: '0.1.0',
        }),
    });
}

/** Push stats for a registered node so it has GPU/inference data. */
async function pushStats(nodeId: string): Promise<Response> {
    return app.request(`/api/v1/nodes/${nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
        body: JSON.stringify({
            farm_hash: 'TESTFARM',
            node_id: nodeId,
            hostname: 'gpu-rig-test',
            uptime_secs: 3600,
            gpu_count: 2,
            gpus: [
                {
                    busId: '0000:01:00.0',
                    name: 'RTX 4090',
                    vramTotalMb: 24576,
                    vramUsedMb: 8192,
                    temperatureC: 55,
                    utilizationPct: 60,
                    powerDrawW: 280,
                    fanSpeedPct: 45,
                    clockSmMhz: 2100,
                    clockMemMhz: 10500,
                },
                {
                    busId: '0000:02:00.0',
                    name: 'RTX 4090',
                    vramTotalMb: 24576,
                    vramUsedMb: 4096,
                    temperatureC: 50,
                    utilizationPct: 40,
                    powerDrawW: 200,
                    fanSpeedPct: 35,
                    clockSmMhz: 2100,
                    clockMemMhz: 10500,
                },
            ],
            cpu: { usage_pct: 30, temp_c: 50 },
            ram: { total_mb: 65536, used_mb: 32768 },
            disk: { total_gb: 2000, used_gb: 800 },
            network: { bytes_in: 5000000, bytes_out: 2000000 },
            inference: {
                loaded_models: ['llama3.1:8b', 'mistral:7b'],
                in_flight_requests: 1,
                tokens_generated: 100000,
                avg_latency_ms: 35,
            },
            toks_per_sec: 200,
            requests_completed: 1500,
        }),
    });
}

// =============================================================================
// API Key Management
// =============================================================================

describe('API Key Management', () => {
    beforeEach(() => resetDb());

    it('POST /api/v1/apikeys creates a new API key', async () => {
        const res = await app.request('/api/v1/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'test-key', scope: 'inference', rate_limit_rpm: 120 }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.key).toBeDefined();
        expect(body.key).toMatch(/^tc_/);
        expect(body.id).toBeDefined();
        expect(body.message).toContain('Save this key');
    });

    it('GET /api/v1/apikeys lists all keys', async () => {
        // Create two keys
        await app.request('/api/v1/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'key-alpha' }),
        });
        await app.request('/api/v1/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'key-beta' }),
        });

        const res = await app.request('/api/v1/apikeys');
        expect(res.status).toBe(200);

        const keys = await res.json();
        expect(Array.isArray(keys)).toBe(true);
        expect(keys.length).toBe(2);

        // Listed keys should NOT expose the full key — only prefix
        for (const k of keys) {
            expect(k.key_prefix).toBeDefined();
            expect(k.key).toBeUndefined(); // full key is never returned in list
        }
    });

    it('DELETE /api/v1/apikeys/:id revokes a key', async () => {
        const createRes = await app.request('/api/v1/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'to-revoke' }),
        });
        const { id } = await createRes.json();

        const revokeRes = await app.request(`/api/v1/apikeys/${id}`, { method: 'DELETE' });
        expect(revokeRes.status).toBe(200);

        const body = await revokeRes.json();
        expect(body.status).toBe('revoked');
    });

    it('created API key has correct structure (key, id, prefix fields)', async () => {
        const res = await app.request('/api/v1/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'struct-check', scope: 'admin', rate_limit_rpm: 60 }),
        });

        const body = await res.json();
        expect(typeof body.id).toBe('string');
        expect(body.id.length).toBeGreaterThan(0);
        expect(typeof body.key).toBe('string');
        expect(body.key.startsWith('tc_')).toBe(true);
        expect(typeof body.prefix).toBe('string');
        expect(body.prefix).toBe(body.key.slice(0, 10));
    });
});

// =============================================================================
// Health Score
// =============================================================================

describe('Health Score', () => {
    beforeEach(() => resetDb());

    it('GET /api/v1/health/score returns health score with score and grade fields', async () => {
        const res = await app.request('/api/v1/health/score');
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toHaveProperty('score');
        expect(body).toHaveProperty('grade');
        expect(body).toHaveProperty('factors');
    });

    it('health score is 0-100 range', async () => {
        // Test with no nodes — still returns a valid score
        const emptyRes = await app.request('/api/v1/health/score');
        const emptyBody = await emptyRes.json();
        expect(emptyBody.score).toBeGreaterThanOrEqual(0);
        expect(emptyBody.score).toBeLessThanOrEqual(100);

        // Test with a node that has stats
        await registerTestNode();
        await pushStats('TENTACLAW-TEST-node001');

        const res = await app.request('/api/v1/health/score');
        const body = await res.json();
        expect(body.score).toBeGreaterThanOrEqual(0);
        expect(body.score).toBeLessThanOrEqual(100);
    });

    it('health grade is A-F', async () => {
        await registerTestNode();
        await pushStats('TENTACLAW-TEST-node001');

        const res = await app.request('/api/v1/health/score');
        const body = await res.json();
        expect(['A', 'B', 'C', 'D', 'F']).toContain(body.grade);
    });
});

// =============================================================================
// Fleet Reliability
// =============================================================================

describe('Fleet Reliability', () => {
    beforeEach(() => resetDb());

    it('GET /api/v1/fleet returns fleet data', async () => {
        await registerTestNode();
        await pushStats('TENTACLAW-TEST-node001');

        const res = await app.request('/api/v1/fleet');
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
    });

    it('fleet response includes node reliability info', async () => {
        await registerTestNode('node-fleet-1', 'FARM1', 'rig-1', 2);
        await pushStats('node-fleet-1');

        const res = await app.request('/api/v1/fleet');
        const body = await res.json();

        expect(body.length).toBeGreaterThanOrEqual(1);
        const node = body[0];

        expect(node).toHaveProperty('node_id');
        expect(node).toHaveProperty('hostname');
        expect(node).toHaveProperty('health_score');
        expect(node).toHaveProperty('grade');
        expect(node).toHaveProperty('uptime_pct');
        expect(node).toHaveProperty('gpu_count');
        expect(node).toHaveProperty('status');
        expect(typeof node.health_score).toBe('number');
    });
});

// =============================================================================
// Export/Import
// =============================================================================

describe('Export/Import', () => {
    beforeEach(() => resetDb());

    it('GET /api/v1/export returns cluster configuration', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/export');
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toHaveProperty('version');
        expect(body).toHaveProperty('exported_at');
    });

    it('export includes nodes, flight_sheets, and schedules fields', async () => {
        await registerTestNode();

        // Create a flight sheet so the export has data
        await app.request('/api/v1/flight-sheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Test Sheet',
                description: 'For export test',
                targets: [{ node_id: '*', model: 'llama3.1:8b' }],
            }),
        });

        const res = await app.request('/api/v1/export');
        const body = await res.json();

        expect(body).toHaveProperty('nodes');
        expect(body).toHaveProperty('flight_sheets');
        expect(body).toHaveProperty('schedules');
        expect(Array.isArray(body.nodes)).toBe(true);
        expect(Array.isArray(body.flight_sheets)).toBe(true);
        expect(body.nodes.length).toBeGreaterThanOrEqual(1);
        expect(body.flight_sheets.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/import accepts exported config', async () => {
        const res = await app.request('/api/v1/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                flight_sheets: [
                    { name: 'Imported Sheet', description: 'From backup', targets: [{ node_id: '*', model: 'hermes3:8b' }] },
                ],
                schedules: [
                    { name: 'Daily prune', type: 'prune_stats', cron: '0 3 * * *', config: { days: 7 } },
                ],
            }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('imported');
        expect(body.imported.flight_sheets).toBe(1);
        expect(body.imported.schedules).toBe(1);

        // Verify the imported flight sheet is retrievable
        const sheetsRes = await app.request('/api/v1/flight-sheets');
        const sheetsBody = await sheetsRes.json();
        expect(sheetsBody.flight_sheets.length).toBeGreaterThanOrEqual(1);
        expect(sheetsBody.flight_sheets.some((s: any) => s.name === 'Imported Sheet')).toBe(true);
    });
});

// =============================================================================
// Cluster Summary
// =============================================================================

describe('Cluster Summary', () => {
    beforeEach(() => resetDb());

    it('GET /api/v1/summary returns cluster summary', async () => {
        const res = await app.request('/api/v1/summary');
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toBeDefined();
        expect(typeof body).toBe('object');
    });

    it('summary includes total_nodes, online_nodes, total_gpus fields', async () => {
        await registerTestNode('node-sum-1', 'FARM1', 'rig-1', 2);
        await registerTestNode('node-sum-2', 'FARM2', 'rig-2', 4);
        await pushStats('node-sum-1');

        const res = await app.request('/api/v1/summary');
        const body = await res.json();

        expect(body).toHaveProperty('total_nodes');
        expect(body).toHaveProperty('online_nodes');
        expect(body).toHaveProperty('total_gpus');
        expect(body.total_nodes).toBe(2);
        expect(body.online_nodes).toBe(2);
        // total_gpus comes from stats that were pushed (only node-sum-1 has stats with 2 GPUs)
        expect(body.total_gpus).toBeGreaterThanOrEqual(2);
    });

    it('GET /api/v1/dashboard returns dashboard bundle with all data', async () => {
        await registerTestNode();
        await pushStats('TENTACLAW-TEST-node001');

        const res = await app.request('/api/v1/dashboard');
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toHaveProperty('summary');
        expect(body).toHaveProperty('health');
        expect(body).toHaveProperty('models');
        expect(body).toHaveProperty('inference');
        expect(body).toHaveProperty('power');
        expect(body).toHaveProperty('fleet');
        expect(body).toHaveProperty('timestamp');

        // Verify nested structure
        expect(body.summary).toHaveProperty('total_nodes');
        expect(body.health).toHaveProperty('score');
        expect(body.health).toHaveProperty('grade');
        expect(Array.isArray(body.models)).toBe(true);
        expect(Array.isArray(body.fleet)).toBe(true);
    });
});

// =============================================================================
// Prometheus Metrics
// =============================================================================

describe('Prometheus Metrics', () => {
    beforeEach(() => resetDb());

    it('GET /metrics returns Prometheus-format text', async () => {
        await registerTestNode();
        await pushStats('TENTACLAW-TEST-node001');

        const res = await app.request('/metrics');
        expect(res.status).toBe(200);

        const contentType = res.headers.get('content-type');
        expect(contentType).toContain('text/plain');

        const text = await res.text();
        expect(text.length).toBeGreaterThan(0);
        // Prometheus format uses "# HELP" and "# TYPE" annotations
        expect(text).toContain('# HELP');
        expect(text).toContain('# TYPE');
    });

    it('metrics include tentaclaw_nodes_total', async () => {
        await registerTestNode();

        const res = await app.request('/metrics');
        const text = await res.text();

        expect(text).toContain('tentaclaw_cluster_nodes_total');
        // With one registered node, the online count should be >= 0
        expect(text).toMatch(/tentaclaw_cluster_nodes_total/);
    });
});
