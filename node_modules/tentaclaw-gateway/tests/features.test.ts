/**
 * TentaCLAW Gateway — Feature Tests (SSH Keys, Tags, Alerts, Benchmarks)
 *
 * Tests the HTTP API layer using Hono's built-in test client.
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { getDb } from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wipe all tables between tests for full isolation. */
function clearDb(): void {
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

/** Register a node via the HTTP API and return the JSON response. */
async function registerTestNode(overrides: Record<string, unknown> = {}): Promise<{ status: string; node: Record<string, unknown> }> {
    const body = {
        node_id: 'test-node-001',
        farm_hash: 'FARM0001',
        hostname: 'gpu-rig-01',
        gpu_count: 2,
        os_version: '0.1.0',
        ...overrides,
    };
    const res = await app.request('/api/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json() as Promise<{ status: string; node: Record<string, unknown> }>;
}

/** Build a stats payload for pushing to /api/v1/nodes/:id/stats. */
function makeHotStatsPayload(nodeId: string, hostname: string, tempC: number): Record<string, unknown> {
    return {
        farm_hash: 'FARM0001',
        node_id: nodeId,
        hostname,
        uptime_secs: 3600,
        gpu_count: 1,
        gpus: [{
            busId: '0000:01:00.0',
            name: 'RTX 3090',
            vramTotalMb: 24576,
            vramUsedMb: 8192,
            temperatureC: tempC,
            utilizationPct: 99,
            powerDrawW: 350,
            fanSpeedPct: 100,
            clockSmMhz: 1800,
            clockMemMhz: 9500,
        }],
        cpu: { usage_pct: 45, temp_c: 55 },
        ram: { total_mb: 32768, used_mb: 16384 },
        disk: { total_gb: 500, used_gb: 250 },
        network: { bytes_in: 1000000, bytes_out: 500000 },
        inference: {
            loaded_models: ['llama3.1:8b'],
            in_flight_requests: 0,
            tokens_generated: 1000,
            avg_latency_ms: 50,
        },
        toks_per_sec: 100,
        requests_completed: 200,
    };
}

// =============================================================================
// SSH Key Management
// =============================================================================

describe('SSH Key Management', () => {
    beforeEach(clearDb);

    it('POST /api/v1/nodes/:id/ssh-keys adds a key', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/nodes/test-node-001/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label: 'my-laptop',
                public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest user@host',
            }),
        });

        expect(res.status).toBe(201);
        const key = await res.json() as Record<string, unknown>;
        expect(key.label).toBe('my-laptop');
        expect(key.public_key).toContain('ssh-ed25519');
        expect(key.node_id).toBe('test-node-001');
        expect(key.fingerprint).toBeDefined();
    });

    it('GET /api/v1/nodes/:id/ssh-keys lists keys for a node', async () => {
        await registerTestNode();

        // Add two keys
        await app.request('/api/v1/nodes/test-node-001/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'key-a', public_key: 'ssh-ed25519 AAAAC3keyA user@a' }),
        });
        await app.request('/api/v1/nodes/test-node-001/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'key-b', public_key: 'ssh-rsa AAAABkeyB user@b' }),
        });

        const res = await app.request('/api/v1/nodes/test-node-001/ssh-keys');
        expect(res.status).toBe(200);

        const keys = await res.json() as Array<Record<string, unknown>>;
        expect(keys.length).toBe(2);
        const labels = keys.map(k => k.label);
        expect(labels).toContain('key-a');
        expect(labels).toContain('key-b');
    });

    it('rejects SSH key with missing public_key field', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/nodes/test-node-001/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'no-key' }),
        });

        expect(res.status).toBe(400);
        const body = await res.json() as Record<string, unknown>;
        expect(body.error).toBeDefined();
    });

    it('DELETE /api/v1/ssh-keys/:keyId removes a key', async () => {
        await registerTestNode();

        // Add a key
        const addRes = await app.request('/api/v1/nodes/test-node-001/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'temp-key', public_key: 'ssh-rsa AAAABtemp user@tmp' }),
        });
        const key = await addRes.json() as Record<string, unknown>;

        // Delete it
        const delRes = await app.request(`/api/v1/ssh-keys/${key.id}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        const delBody = await delRes.json() as Record<string, unknown>;
        expect(delBody.status).toBe('deleted');

        // Verify it is gone
        const listRes = await app.request('/api/v1/nodes/test-node-001/ssh-keys');
        const keys = await listRes.json() as Array<Record<string, unknown>>;
        expect(keys.length).toBe(0);
    });
});

// =============================================================================
// Node Tags
// =============================================================================

describe('Node Tags', () => {
    beforeEach(clearDb);

    it('POST /api/v1/nodes/:id/tags adds a tag', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/nodes/test-node-001/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['production'] }),
        });

        expect(res.status).toBe(200);
        const tags = await res.json() as string[];
        expect(tags).toContain('production');
    });

    it('GET /api/v1/nodes/:id/tags lists node tags', async () => {
        await registerTestNode();

        // Add multiple tags
        await app.request('/api/v1/nodes/test-node-001/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['production', 'inference', 'gpu-heavy'] }),
        });

        const res = await app.request('/api/v1/nodes/test-node-001/tags');
        expect(res.status).toBe(200);

        const tags = await res.json() as string[];
        expect(tags).toContain('production');
        expect(tags).toContain('inference');
        expect(tags).toContain('gpu-heavy');
        expect(tags.length).toBe(3);
    });

    it('GET /api/v1/tags returns all tags with counts', async () => {
        // Register two nodes
        await registerTestNode({ node_id: 'node-a', hostname: 'rig-a' });
        await registerTestNode({ node_id: 'node-b', hostname: 'rig-b' });

        // Tag them
        await app.request('/api/v1/nodes/node-a/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['production', 'inference'] }),
        });
        await app.request('/api/v1/nodes/node-b/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['production'] }),
        });

        const res = await app.request('/api/v1/tags');
        expect(res.status).toBe(200);

        const allTags = await res.json() as Array<{ tag: string; count: number }>;
        const prod = allTags.find(t => t.tag === 'production');
        expect(prod).toBeDefined();
        expect(prod!.count).toBe(2);

        const inf = allTags.find(t => t.tag === 'inference');
        expect(inf).toBeDefined();
        expect(inf!.count).toBe(1);
    });

    it('DELETE /api/v1/nodes/:id/tags/:tag removes a tag', async () => {
        await registerTestNode();

        await app.request('/api/v1/nodes/test-node-001/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['staging', 'temp'] }),
        });

        const delRes = await app.request('/api/v1/nodes/test-node-001/tags/temp', { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        const delBody = await delRes.json() as Record<string, unknown>;
        expect(delBody.status).toBe('removed');

        // Verify the tag was removed but the other remains
        const listRes = await app.request('/api/v1/nodes/test-node-001/tags');
        const tags = await listRes.json() as string[];
        expect(tags).toContain('staging');
        expect(tags).not.toContain('temp');
    });

    it('rejects empty tag name', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/nodes/test-node-001/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['', '  '] }),
        });

        expect(res.status).toBe(400);
        const body = await res.json() as Record<string, unknown>;
        expect(body.error).toBeDefined();
    });
});

// =============================================================================
// Alerts
// =============================================================================

describe('Alerts', () => {
    beforeEach(clearDb);

    it('GET /api/v1/alerts returns alerts (empty initially)', async () => {
        const res = await app.request('/api/v1/alerts');
        expect(res.status).toBe(200);

        const body = await res.json() as { alerts: unknown[] };
        expect(body.alerts).toBeDefined();
        expect(body.alerts.length).toBe(0);
    });

    it('stats ingestion with high GPU temp triggers alert', async () => {
        await registerTestNode();

        // Push stats with GPU temperature above the 85C threshold
        const res = await app.request('/api/v1/nodes/test-node-001/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeHotStatsPayload('test-node-001', 'gpu-rig-01', 95)),
        });

        expect(res.status).toBe(200);
    });

    it('GET /api/v1/alerts shows the triggered alert', async () => {
        await registerTestNode();

        // Push overheating stats
        await app.request('/api/v1/nodes/test-node-001/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeHotStatsPayload('test-node-001', 'gpu-rig-01', 95)),
        });

        // Now fetch alerts
        const alertRes = await app.request('/api/v1/alerts');
        expect(alertRes.status).toBe(200);

        const body = await alertRes.json() as { alerts: Array<Record<string, unknown>> };
        expect(body.alerts.length).toBeGreaterThanOrEqual(1);

        const overheat = body.alerts.find(a => a.type === 'gpu_overheat');
        expect(overheat).toBeDefined();
        expect(overheat!.severity).toBe('critical');
        expect(overheat!.node_id).toBe('test-node-001');
    });
});

// =============================================================================
// Benchmarks
// =============================================================================

describe('Benchmarks', () => {
    beforeEach(clearDb);

    it('POST /api/v1/nodes/:id/benchmark stores benchmark result', async () => {
        await registerTestNode();

        const res = await app.request('/api/v1/nodes/test-node-001/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1:8b',
                tokens_per_sec: 185.5,
                prompt_eval_rate: 220.0,
                eval_rate: 185.5,
                total_duration_ms: 12500,
            }),
        });

        expect(res.status).toBe(200);
        const body = await res.json() as { status: string; benchmark: Record<string, unknown> };
        expect(body.status).toBe('stored');
        expect(body.benchmark).toBeDefined();
        expect(body.benchmark.model).toBe('llama3.1:8b');
        expect(body.benchmark.tokens_per_sec).toBe(185.5);
        expect(body.benchmark.node_id).toBe('test-node-001');
    });

    it('GET /api/v1/benchmarks returns benchmark results', async () => {
        await registerTestNode();

        // Store two benchmarks
        await app.request('/api/v1/nodes/test-node-001/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3.1:8b', tokens_per_sec: 185 }),
        });
        await app.request('/api/v1/nodes/test-node-001/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'hermes3:8b', tokens_per_sec: 200 }),
        });

        const res = await app.request('/api/v1/benchmarks');
        expect(res.status).toBe(200);

        const body = await res.json() as { benchmarks: Array<Record<string, unknown>> };
        expect(body.benchmarks.length).toBe(2);
    });

    it('GET /api/v1/leaderboard returns ranked results', async () => {
        // Register two nodes with different performance
        await registerTestNode({ node_id: 'fast-node', hostname: 'fast-rig' });
        await registerTestNode({ node_id: 'slow-node', hostname: 'slow-rig' });

        // Push stats so nodes are online with loaded models (leaderboard uses live stats)
        const makeStatsPayload = (nodeId: string, hostname: string, toks: number) => ({
            farm_hash: 'FARM0001',
            node_id: nodeId,
            hostname,
            uptime_secs: 3600,
            gpu_count: 1,
            gpus: [{
                busId: '0000:01:00.0',
                name: 'RTX 3090',
                vramTotalMb: 24576,
                vramUsedMb: 8192,
                temperatureC: 60,
                utilizationPct: 80,
                powerDrawW: 300,
                fanSpeedPct: 60,
                clockSmMhz: 1800,
                clockMemMhz: 9500,
            }],
            cpu: { usage_pct: 40, temp_c: 50 },
            ram: { total_mb: 32768, used_mb: 16384 },
            disk: { total_gb: 500, used_gb: 250 },
            network: { bytes_in: 1000000, bytes_out: 500000 },
            inference: {
                loaded_models: ['llama3.1:8b'],
                in_flight_requests: 1,
                tokens_generated: 10000,
                avg_latency_ms: 40,
            },
            toks_per_sec: toks,
            requests_completed: 500,
        });

        await app.request('/api/v1/nodes/fast-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeStatsPayload('fast-node', 'fast-rig', 300)),
        });
        await app.request('/api/v1/nodes/slow-node/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeStatsPayload('slow-node', 'slow-rig', 100)),
        });

        const res = await app.request('/api/v1/leaderboard');
        expect(res.status).toBe(200);

        const body = await res.json() as { leaderboard: Array<Record<string, unknown>> };
        expect(body.leaderboard).toBeDefined();
        expect(body.leaderboard.length).toBeGreaterThanOrEqual(1);

        // The model llama3.1:8b should appear and fast-node should be the best
        const llama = body.leaderboard.find(e => e.model === 'llama3.1:8b');
        expect(llama).toBeDefined();
        expect(llama!.best_node).toBe('fast-rig');
        expect(llama!.best_toks_per_sec).toBe(300);
        expect(llama!.node_count).toBe(2);
    });
});
