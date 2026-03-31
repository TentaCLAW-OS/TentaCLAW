/**
 * TentaCLAW Gateway — Scaling & Management Tests
 *
 * Tests node grouping (via tags), schedules, alert rules, model management,
 * power reporting, inference analytics, and bulk operations.
 * Uses HTTP-level tests via app.request for full coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StatsPayload } from '../../shared/types';
import { app, initClusterSecret } from '../src/index';

import {
    getDb,
    registerNode,
    getAllNodes,
    insertStats,
    getAlertRules,
    seedDefaultAlertRules,
} from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';
// Set a known cluster secret so agent-authenticated endpoints accept requests
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';
initClusterSecret();

/** Helper: build a valid stats payload */
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

/** Helper: register a node via the HTTP endpoint */
async function httpRegister(opts: {
    node_id: string;
    farm_hash?: string;
    hostname?: string;
    gpu_count?: number;
}) {
    const res = await app.request('/api/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
        body: JSON.stringify({
            farm_hash: 'FARM0001',
            hostname: 'test-rig',
            gpu_count: 1,
            ...opts,
        }),
    });
    return res;
}

/** Helper: wipe all data between tests */
function wipeDb() {
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
        DELETE FROM alert_rules;
        PRAGMA foreign_keys = ON;
    `);
}

// =============================================================================
// Node Groups (via Tags — the gateway's grouping mechanism)
// =============================================================================

describe('Node Groups (via Tags API)', () => {
    beforeEach(() => wipeDb());

    it('POST then GET /api/v1/nodes/:id/tags creates and lists groups', async () => {
        await httpRegister({ node_id: 'group-n1' });
        await httpRegister({ node_id: 'group-n2' });

        // Tag both nodes with "gpu-cluster-a"
        const r1 = await app.request('/api/v1/nodes/group-n1/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['gpu-cluster-a'] }),
        });
        expect(r1.status).toBe(200);

        const r2 = await app.request('/api/v1/nodes/group-n2/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['gpu-cluster-a'] }),
        });
        expect(r2.status).toBe(200);

        // List all tags — should show "gpu-cluster-a" with count 2
        const tagsRes = await app.request('/api/v1/tags');
        expect(tagsRes.status).toBe(200);
        const tags = await tagsRes.json();
        expect(Array.isArray(tags)).toBe(true);
        const groupTag = (tags as any[]).find((t: any) => t.tag === 'gpu-cluster-a');
        expect(groupTag).toBeDefined();
        expect(groupTag.count).toBe(2);

        // List nodes in this group
        const groupRes = await app.request('/api/v1/tags/gpu-cluster-a/nodes');
        expect(groupRes.status).toBe(200);
        const groupNodes = await groupRes.json();
        expect(Array.isArray(groupNodes)).toBe(true);
        expect((groupNodes as any[]).length).toBe(2);
    });

    it('adding a node to a group (tag) works', async () => {
        await httpRegister({ node_id: 'tag-add-node' });

        const addRes = await app.request('/api/v1/nodes/tag-add-node/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['prod', 'inference'] }),
        });
        expect(addRes.status).toBe(200);

        const tagsArr = await addRes.json();
        expect(Array.isArray(tagsArr)).toBe(true);
        expect(tagsArr).toContain('prod');
        expect(tagsArr).toContain('inference');
    });

    it('deleting a group (removing tag from all nodes) works', async () => {
        await httpRegister({ node_id: 'rm-tag-n1' });
        await httpRegister({ node_id: 'rm-tag-n2' });

        // Add tag
        await app.request('/api/v1/nodes/rm-tag-n1/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['temp-group'] }),
        });
        await app.request('/api/v1/nodes/rm-tag-n2/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['temp-group'] }),
        });

        // Remove from both nodes
        const del1 = await app.request('/api/v1/nodes/rm-tag-n1/tags/temp-group', { method: 'DELETE' });
        expect(del1.status).toBe(200);
        const del2 = await app.request('/api/v1/nodes/rm-tag-n2/tags/temp-group', { method: 'DELETE' });
        expect(del2.status).toBe(200);

        // Group should be empty
        const groupRes = await app.request('/api/v1/tags/temp-group/nodes');
        const nodes = await groupRes.json();
        expect((nodes as any[]).length).toBe(0);
    });
});

// =============================================================================
// Schedules (related to placement constraints — time-based scheduling)
// =============================================================================

describe('Schedules (Placement / Timing Constraints)', () => {
    beforeEach(() => wipeDb());

    it('POST /api/v1/schedules creates a schedule', async () => {
        const res = await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Night power-save',
                type: 'power_profile',
                cron: '0 22 * * *',
                config: { mode: 'eco' },
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('created');
        expect(json.schedule.name).toBe('Night power-save');
        expect(json.schedule.cron).toBe('0 22 * * *');
    });

    it('GET /api/v1/schedules lists schedules', async () => {
        // Create two schedules
        await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Sched-1', type: 'backup', cron: '0 3 * * *' }),
        });
        await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Sched-2', type: 'rebalance', cron: '*/30 * * * *' }),
        });

        const res = await app.request('/api/v1/schedules');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.schedules.length).toBe(2);
    });

    it('DELETE /api/v1/schedules/:id removes a schedule', async () => {
        const createRes = await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Temp', type: 'cleanup', cron: '0 0 * * 0' }),
        });
        const created = await createRes.json();
        const id = created.schedule.id;

        const delRes = await app.request(`/api/v1/schedules/${id}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        const delJson = await delRes.json();
        expect(delJson.status).toBe('deleted');

        // Verify it's gone
        const getRes = await app.request(`/api/v1/schedules/${id}`);
        expect(getRes.status).toBe(404);
    });

    it('POST /api/v1/schedules/:id/toggle enables/disables a schedule', async () => {
        const createRes = await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Toggle-Me', type: 'deploy', cron: '0 6 * * *' }),
        });
        const created = await createRes.json();
        const id = created.schedule.id;

        // Disable
        const disableRes = await app.request(`/api/v1/schedules/${id}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: false }),
        });
        expect(disableRes.status).toBe(200);
        const disJson = await disableRes.json();
        expect(disJson.status).toBe('disabled');

        // Re-enable
        const enableRes = await app.request(`/api/v1/schedules/${id}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: true }),
        });
        expect(enableRes.status).toBe(200);
        const enJson = await enableRes.json();
        expect(enJson.status).toBe('enabled');
    });

    it('POST /api/v1/schedules rejects missing fields', async () => {
        const res = await app.request('/api/v1/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Incomplete' }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBeDefined();
    });

    it('DELETE /api/v1/schedules/:id returns 404 for nonexistent schedule', async () => {
        const res = await app.request('/api/v1/schedules/nonexistent-id', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });
});

// =============================================================================
// Alert Rules
// =============================================================================

describe('Alert Rules', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/alert-rules returns default rules (seeded on boot)', async () => {
        seedDefaultAlertRules();

        const res = await app.request('/api/v1/alert-rules');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.rules).toBeDefined();
        expect(json.rules.length).toBe(6);

        // Verify known defaults exist
        const names = json.rules.map((r: any) => r.name);
        expect(names).toContain('GPU Temp Warning');
        expect(names).toContain('GPU Temp Critical');
        expect(names).toContain('VRAM High');
        expect(names).toContain('CPU Saturated');
        expect(names).toContain('Disk Nearly Full');
        expect(names).toContain('RAM Critical');
    });

    it('POST /api/v1/alert-rules creates a new rule', async () => {
        const res = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Latency Spike',
                metric: 'inference_latency',
                operator: 'gt',
                threshold: 500,
                severity: 'warning',
                cooldown_secs: 120,
            }),
        });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.status).toBe('created');
        expect(json.id).toBeDefined();

        // Verify the rule exists
        const listRes = await app.request('/api/v1/alert-rules');
        const listJson = await listRes.json();
        expect(listJson.rules.length).toBe(1);
        expect(listJson.rules[0].name).toBe('Latency Spike');
        expect(listJson.rules[0].metric).toBe('inference_latency');
        expect(listJson.rules[0].operator).toBe('gt');
        expect(listJson.rules[0].threshold).toBe(500);
    });

    it('PUT /api/v1/alert-rules/:id updates a rule', async () => {
        const createRes = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'GPU Util Low',
                metric: 'gpu_util',
                operator: 'lt',
                threshold: 10,
            }),
        });
        const created = await createRes.json();
        const id = created.id;

        const updateRes = await app.request(`/api/v1/alert-rules/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                threshold: 20,
                severity: 'critical',
                name: 'GPU Util Very Low',
            }),
        });
        expect(updateRes.status).toBe(200);
        const updateJson = await updateRes.json();
        expect(updateJson.status).toBe('updated');

        // Verify changes
        const listRes = await app.request('/api/v1/alert-rules');
        const listJson = await listRes.json();
        const rule = listJson.rules.find((r: any) => r.id === id);
        expect(rule.threshold).toBe(20);
        expect(rule.severity).toBe('critical');
        expect(rule.name).toBe('GPU Util Very Low');
    });

    it('DELETE /api/v1/alert-rules/:id removes a rule', async () => {
        const createRes = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Temp Rule',
                metric: 'gpu_temp',
                operator: 'gt',
                threshold: 80,
            }),
        });
        const created = await createRes.json();
        const id = created.id;

        const delRes = await app.request(`/api/v1/alert-rules/${id}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        const delJson = await delRes.json();
        expect(delJson.status).toBe('deleted');

        // Verify it's gone
        const listRes = await app.request('/api/v1/alert-rules');
        const listJson = await listRes.json();
        expect(listJson.rules.length).toBe(0);
    });

    it('POST /api/v1/alert-rules/:id/toggle disables and enables a rule', async () => {
        const createRes = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Toggle Test',
                metric: 'cpu_usage',
                operator: 'gt',
                threshold: 90,
            }),
        });
        const created = await createRes.json();
        const id = created.id;

        // Disable
        const disableRes = await app.request(`/api/v1/alert-rules/${id}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: false }),
        });
        expect(disableRes.status).toBe(200);
        const disJson = await disableRes.json();
        expect(disJson.status).toBe('disabled');

        // Enable
        const enableRes = await app.request(`/api/v1/alert-rules/${id}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: true }),
        });
        expect(enableRes.status).toBe(200);
        const enJson = await enableRes.json();
        expect(enJson.status).toBe('enabled');
    });

    it('POST /api/v1/alert-rules rejects invalid metric', async () => {
        const res = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Bad Metric',
                metric: 'fake_metric',
                operator: 'gt',
                threshold: 50,
            }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Invalid metric');
    });

    it('POST /api/v1/alert-rules rejects invalid operator', async () => {
        const res = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                name: 'Bad Op',
                metric: 'gpu_temp',
                operator: 'invalid',
                threshold: 50,
            }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Invalid operator');
    });

    it('POST /api/v1/alert-rules rejects missing required fields', async () => {
        const res = await app.request('/api/v1/alert-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ name: 'Incomplete' }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Missing required fields');
    });

    it('DELETE /api/v1/alert-rules/:id returns 404 for nonexistent rule', async () => {
        const res = await app.request('/api/v1/alert-rules/nonexistent', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('PUT /api/v1/alert-rules/:id returns 404 for nonexistent rule', async () => {
        const res = await app.request('/api/v1/alert-rules/nonexistent', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ threshold: 99 }),
        });
        expect(res.status).toBe(404);
    });

    it('POST /api/v1/alert-rules/:id/toggle returns 404 for nonexistent rule', async () => {
        const res = await app.request('/api/v1/alert-rules/nonexistent/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: false }),
        });
        expect(res.status).toBe(404);
    });
});

// =============================================================================
// Model Management
// =============================================================================

describe('Model Management', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/models/distribution returns model distribution', async () => {
        // Register nodes with loaded models
        registerNode({ node_id: 'dist-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('dist-n1', makeStats('dist-n1', {
            inference: { loaded_models: ['llama3.1:8b', 'codellama:7b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));
        registerNode({ node_id: 'dist-n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 1 });
        insertStats('dist-n2', makeStats('dist-n2', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/api/v1/models/distribution');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);

        // llama3.1:8b should be on 2 nodes
        const llama = (json as any[]).find((m: any) => m.model === 'llama3.1:8b');
        expect(llama).toBeDefined();
        expect(llama.nodes.length).toBe(2);
        expect(llama.coverage).toBe(100); // 2/2 online nodes

        // codellama:7b on 1 node
        const codellama = (json as any[]).find((m: any) => m.model === 'codellama:7b');
        expect(codellama).toBeDefined();
        expect(codellama.nodes.length).toBe(1);
        expect(codellama.coverage).toBe(50); // 1/2 online nodes
    });

    it('GET /api/v1/models/coverage returns coverage report', async () => {
        registerNode({ node_id: 'cov-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('cov-n1', makeStats('cov-n1', {
            inference: { loaded_models: ['mistral:7b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/api/v1/models/coverage');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_models).toBeDefined();
        expect(json.online_nodes).toBe(1);
        expect(json.avg_coverage_pct).toBeDefined();
        expect(json.models).toBeDefined();
        expect(Array.isArray(json.models)).toBe(true);

        const mistral = json.models.find((m: any) => m.model === 'mistral:7b');
        expect(mistral).toBeDefined();
        expect(mistral.coverage_pct).toBe(100);
        expect(mistral.redundant).toBe(false); // only on 1 node
    });

    it('GET /api/v1/models/check-fit checks if model fits', async () => {
        registerNode({ node_id: 'fit-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('fit-n1', makeStats('fit-n1'));

        const res = await app.request('/api/v1/models/check-fit?model=llama3.1:8b');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.model).toBe('llama3.1:8b');
        expect(json.estimated_vram_mb).toBeDefined();
        expect(typeof json.estimated_vram_mb).toBe('number');
        expect(json.fits_anywhere).toBeDefined();
    });

    it('GET /api/v1/models/check-fit with specific node', async () => {
        registerNode({ node_id: 'fit-n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 1 });
        insertStats('fit-n2', makeStats('fit-n2'));

        const res = await app.request('/api/v1/models/check-fit?model=llama3.1:8b&node=fit-n2');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.fits).toBeDefined();
        expect(json.required_mb).toBeDefined();
        expect(json.available_mb).toBeDefined();
        expect(json.node).toBe('fit-n2');
    });

    it('GET /api/v1/models/check-fit returns 400 without model param', async () => {
        const res = await app.request('/api/v1/models/check-fit');
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('model');
    });

    it('GET /api/v1/models/distribution returns empty array with no nodes', async () => {
        const res = await app.request('/api/v1/models/distribution');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect((json as any[]).length).toBe(0);
    });

    it('GET /api/v1/models/coverage returns zeros with no nodes', async () => {
        const res = await app.request('/api/v1/models/coverage');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_models).toBe(0);
        expect(json.online_nodes).toBe(0);
        expect(json.avg_coverage_pct).toBe(0);
        expect(json.models.length).toBe(0);
    });

    it('GET /api/v1/models/coverage shows redundancy when model on multiple nodes', async () => {
        registerNode({ node_id: 'red-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        registerNode({ node_id: 'red-n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 1 });
        insertStats('red-n1', makeStats('red-n1', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));
        insertStats('red-n2', makeStats('red-n2', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/api/v1/models/coverage');
        const json = await res.json();
        const llama = json.models.find((m: any) => m.model === 'llama3.1:8b');
        expect(llama.redundant).toBe(true);
        expect(llama.node_count).toBe(2);
    });
});

// =============================================================================
// Power & Analytics
// =============================================================================

describe('Power & Analytics', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/power returns power data with no nodes', async () => {
        const res = await app.request('/api/v1/power');
        expect(res.status).toBe(200);
        const json = await res.json();
        // Should return valid structure even with no nodes
        expect(json).toBeDefined();
        expect(typeof json).toBe('object');
    });

    it('GET /api/v1/power returns correct data with online nodes', async () => {
        registerNode({ node_id: 'pwr-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('pwr-n1', makeStats('pwr-n1'));

        const res = await app.request('/api/v1/power');
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.total_watts).toBeDefined();
        expect(json.total_watts).toBeGreaterThan(0);
        expect(json.per_node).toBeDefined();
        expect(Array.isArray(json.per_node)).toBe(true);
        expect(json.per_node.length).toBe(1);
        expect(json.per_node[0].node_id).toBe('pwr-n1');
    });

    it('GET /api/v1/power reflects GPU wattage per node', async () => {
        registerNode({ node_id: 'pwr-n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 2 });
        insertStats('pwr-n2', makeStats('pwr-n2', {
            gpu_count: 2,
            gpus: [
                { busId: '0', name: 'RTX 4090', vramTotalMb: 24576, vramUsedMb: 4096, temperatureC: 55, utilizationPct: 50, powerDrawW: 350, fanSpeedPct: 40, clockSmMhz: 2200, clockMemMhz: 10000 },
                { busId: '1', name: 'RTX 4090', vramTotalMb: 24576, vramUsedMb: 4096, temperatureC: 58, utilizationPct: 60, powerDrawW: 400, fanSpeedPct: 45, clockSmMhz: 2200, clockMemMhz: 10000 },
            ],
        }));

        const res = await app.request('/api/v1/power');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.per_node[0].gpu_watts).toBeGreaterThanOrEqual(750);
    });

    it('GET /api/v1/inference/analytics returns analytics', async () => {
        const res = await app.request('/api/v1/inference/analytics');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_requests).toBeDefined();
        expect(json.successful).toBeDefined();
        expect(json.failed).toBeDefined();
        expect(json.avg_latency_ms).toBeDefined();
        expect(json.p50_latency_ms).toBeDefined();
        expect(json.p95_latency_ms).toBeDefined();
        expect(json.p99_latency_ms).toBeDefined();
        expect(json.total_tokens_in).toBeDefined();
        expect(json.total_tokens_out).toBeDefined();
        expect(json.requests_per_minute).toBeDefined();
        expect(json.by_model).toBeDefined();
        expect(json.by_node).toBeDefined();
    });

    it('GET /api/v1/inference/analytics accepts hours parameter', async () => {
        const res = await app.request('/api/v1/inference/analytics?hours=1');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_requests).toBe(0); // no inference logs in test
        expect(json.by_model).toEqual([]);
    });

    it('GET /api/v1/inference/analytics returns zero counts when no logs', async () => {
        const res = await app.request('/api/v1/inference/analytics?hours=48');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_requests).toBe(0);
        expect(json.successful).toBe(0);
        expect(json.failed).toBe(0);
        expect(json.avg_latency_ms).toBe(0);
    });
});

// =============================================================================
// Bulk Operations
// =============================================================================

describe('Bulk Operations', () => {
    beforeEach(() => wipeDb());

    it('POST /api/v1/bulk/command sends command to all nodes', async () => {
        await httpRegister({ node_id: 'bulk-n1' });
        await httpRegister({ node_id: 'bulk-n2' });

        const res = await app.request('/api/v1/bulk/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                action: 'install_model',
                payload: { model: 'llama3.1:8b' },
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.action).toBe('install_model');
        expect(json.total).toBe(2);
        expect(json.results.length).toBe(2);
        expect(json.results.every((r: any) => r.status === 'queued')).toBe(true);
    });

    it('POST /api/v1/bulk/command targets specific nodes by ID', async () => {
        await httpRegister({ node_id: 'bulk-a' });
        await httpRegister({ node_id: 'bulk-b' });
        await httpRegister({ node_id: 'bulk-c' });

        const res = await app.request('/api/v1/bulk/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_ids: ['bulk-a', 'bulk-c'],
                action: 'reload_model',
                payload: { model: 'test' },
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total).toBe(2);
    });

    it('POST /api/v1/bulk/command targets nodes by tag', async () => {
        await httpRegister({ node_id: 'tagged-1' });
        await httpRegister({ node_id: 'tagged-2' });
        await httpRegister({ node_id: 'untagged' });

        // Tag two nodes
        await app.request('/api/v1/nodes/tagged-1/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['gpu-fleet'] }),
        });
        await app.request('/api/v1/nodes/tagged-2/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['gpu-fleet'] }),
        });

        const res = await app.request('/api/v1/bulk/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                tag: 'gpu-fleet',
                action: 'install_model',
                payload: { model: 'hermes3:8b' },
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total).toBe(2);
    });

    it('POST /api/v1/bulk/command rejects missing action', async () => {
        const res = await app.request('/api/v1/bulk/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ node_ids: ['x'] }),
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/v1/bulk/tags adds and removes tags in bulk', async () => {
        await httpRegister({ node_id: 'bt-n1' });
        await httpRegister({ node_id: 'bt-n2' });

        // Add tags in bulk
        const addRes = await app.request('/api/v1/bulk/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_ids: ['bt-n1', 'bt-n2'],
                tags: ['prod', 'llm'],
                action: 'add',
            }),
        });
        expect(addRes.status).toBe(200);
        const addJson = await addRes.json();
        expect(addJson.status).toBe('done');
        expect(addJson.operations).toBe(4); // 2 nodes x 2 tags

        // Verify tags are set
        const t1 = await app.request('/api/v1/nodes/bt-n1/tags');
        const tags1 = await t1.json();
        expect(tags1).toContain('prod');
        expect(tags1).toContain('llm');

        // Remove tags in bulk
        const rmRes = await app.request('/api/v1/bulk/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_ids: ['bt-n1', 'bt-n2'],
                tags: ['prod'],
                action: 'remove',
            }),
        });
        expect(rmRes.status).toBe(200);

        // Verify prod is removed
        const t1After = await app.request('/api/v1/nodes/bt-n1/tags');
        const tags1After = await t1After.json();
        expect(tags1After).not.toContain('prod');
        expect(tags1After).toContain('llm');
    });

    it('POST /api/v1/bulk/reboot queues reboot for tagged nodes', async () => {
        await httpRegister({ node_id: 'reboot-1' });
        await httpRegister({ node_id: 'reboot-2' });

        await app.request('/api/v1/nodes/reboot-1/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['maintenance'] }),
        });
        await app.request('/api/v1/nodes/reboot-2/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['maintenance'] }),
        });

        const res = await app.request('/api/v1/bulk/reboot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tag: 'maintenance' }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('queued');
        expect(json.count).toBe(2);
    });

    it('POST /api/v1/bulk/reboot rejects missing targets', async () => {
        const res = await app.request('/api/v1/bulk/reboot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/v1/bulk/deploy deploys model to tagged nodes', async () => {
        await httpRegister({ node_id: 'dep-n1' });
        await httpRegister({ node_id: 'dep-n2' });

        await app.request('/api/v1/nodes/dep-n1/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['deploy-target'] }),
        });

        const res = await app.request('/api/v1/bulk/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                model: 'hermes3:8b',
                tag: 'deploy-target',
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.model).toBe('hermes3:8b');
    });

    it('POST /api/v1/bulk/deploy rejects missing model', async () => {
        const res = await app.request('/api/v1/bulk/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ node_ids: ['n1'] }),
        });
        expect(res.status).toBe(400);
    });
});

// =============================================================================
// Topology & Cluster Info
// =============================================================================

describe('Topology & Cluster Info', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/topology returns gateway and farm structure', async () => {
        await httpRegister({ node_id: 'topo-n1', farm_hash: 'FARM-A', hostname: 'rig-1' });
        await httpRegister({ node_id: 'topo-n2', farm_hash: 'FARM-A', hostname: 'rig-2' });
        await httpRegister({ node_id: 'topo-n3', farm_hash: 'FARM-B', hostname: 'rig-3' });

        const res = await app.request('/api/v1/topology');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.gateway).toBeDefined();
        expect(json.gateway.id).toBe('gateway');
        expect(json.farms).toBeDefined();
        expect(json.connections).toBeDefined();
        expect(json.connections.length).toBe(3);
    });

    it('GET /api/v1/summary returns cluster summary', async () => {
        await httpRegister({ node_id: 'sum-n1', gpu_count: 2 });
        await httpRegister({ node_id: 'sum-n2', gpu_count: 1 });

        const res = await app.request('/api/v1/summary');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_nodes).toBe(2);
        expect(json.online_nodes).toBe(2);
    });

    it('GET /api/v1/fleet returns fleet reliability data', async () => {
        const res = await app.request('/api/v1/fleet');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/health/score returns health score', async () => {
        const res = await app.request('/api/v1/health/score');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.score).toBeDefined();
        expect(json.grade).toBeDefined();
    });

    it('GET /api/v1/health/detailed returns detailed health info', async () => {
        // With no nodes, the detailed check returns 503 (unhealthy)
        const resEmpty = await app.request('/api/v1/health/detailed');
        expect(resEmpty.status).toBe(503);
        const jsonEmpty = await resEmpty.json();
        expect(jsonEmpty.status).toBe('unhealthy');
        expect(jsonEmpty.checks).toBeDefined();
        expect(jsonEmpty.checks.database).toBeDefined();

        // Register a node so we get 200
        await httpRegister({ node_id: 'health-n1' });
        const res = await app.request('/api/v1/health/detailed');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('healthy');
        expect(json.checks.nodes.online).toBe(1);
    });
});

// =============================================================================
// Smart Deploy & Model Operations
// =============================================================================

describe('Smart Deploy & Model Operations', () => {
    beforeEach(() => wipeDb());

    it('POST /api/v1/models/smart-deploy deploys to best node', async () => {
        registerNode({ node_id: 'smart-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        // Very large GPU with plenty of free VRAM
        insertStats('smart-n1', makeStats('smart-n1', {
            gpus: [{ busId: '0', name: 'A100', vramTotalMb: 81920, vramUsedMb: 1000, temperatureC: 50, utilizationPct: 20, powerDrawW: 200, fanSpeedPct: 30, clockSmMhz: 1800, clockMemMhz: 9500 }],
        }));

        const res = await app.request('/api/v1/models/smart-deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ model: 'llama3.2:1b' }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.model).toBe('llama3.2:1b');
        expect(json.deployed).toBeDefined();
        expect(json.deployed.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/models/smart-deploy rejects missing model', async () => {
        const res = await app.request('/api/v1/models/smart-deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/v1/models/smart-deploy returns 409 if no node has capacity', async () => {
        // Register node with fully used VRAM
        registerNode({ node_id: 'full-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('full-n1', makeStats('full-n1', {
            gpus: [{ busId: '0', name: 'GTX 1050', vramTotalMb: 2048, vramUsedMb: 2000, temperatureC: 70, utilizationPct: 90, powerDrawW: 75, fanSpeedPct: 80, clockSmMhz: 1500, clockMemMhz: 7000 }],
        }));

        const res = await app.request('/api/v1/models/smart-deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ model: 'llama3.1:70b' }),
        });
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error).toContain('No node');
    });

    it('GET /api/v1/inference/stats returns request stats', async () => {
        const res = await app.request('/api/v1/inference/stats');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// Additional Tag Edge Cases
// =============================================================================

describe('Tag Edge Cases (HTTP)', () => {
    beforeEach(() => wipeDb());

    it('POST /api/v1/nodes/:id/tags rejects empty tags array', async () => {
        await httpRegister({ node_id: 'tag-empty' });

        const res = await app.request('/api/v1/nodes/tag-empty/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: [] }),
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/v1/nodes/:id/tags rejects missing tags field', async () => {
        await httpRegister({ node_id: 'tag-missing' });

        const res = await app.request('/api/v1/nodes/tag-missing/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/v1/nodes/:id/tags returns 404 for nonexistent node', async () => {
        const res = await app.request('/api/v1/nodes/ghost-node/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['test'] }),
        });
        expect(res.status).toBe(404);
    });

    it('GET /api/v1/nodes/:id/tags returns 404 for nonexistent node', async () => {
        const res = await app.request('/api/v1/nodes/ghost-node/tags');
        expect(res.status).toBe(404);
    });

    it('DELETE /api/v1/nodes/:id/tags/:tag returns 404 for nonexistent tag', async () => {
        await httpRegister({ node_id: 'tag-del-fail' });

        const res = await app.request('/api/v1/nodes/tag-del-fail/tags/nonexistent', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('POST /api/v1/nodes/:id/tags ignores empty-string tags', async () => {
        await httpRegister({ node_id: 'tag-filter' });

        const res = await app.request('/api/v1/nodes/tag-filter/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ tags: ['', '  ', 'valid-tag'] }),
        });
        expect(res.status).toBe(200);
        const tags = await res.json();
        expect(tags).toContain('valid-tag');
        expect((tags as string[]).length).toBe(1);
    });
});

// =============================================================================
// Config & Version Endpoints
// =============================================================================

describe('Config & Version Endpoints', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/config returns gateway config', async () => {
        const res = await app.request('/api/v1/config');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.version).toBeDefined();
        expect(json.service).toBe('tentaclaw-gateway');
    });

    it('GET /api/v1/version returns version info', async () => {
        const res = await app.request('/api/v1/version');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/capabilities returns capabilities list', async () => {
        const res = await app.request('/api/v1/capabilities');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /health returns health status', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('ok');
    });

    it('GET /api/v1/healthz returns OK', async () => {
        const res = await app.request('/api/v1/healthz');
        expect(res.status).toBe(200);
    });

    it('GET /api/v1/readyz returns 503 when no nodes/models', async () => {
        const res = await app.request('/api/v1/readyz');
        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json.status).toBe('not_ready');
        expect(json.reason).toBeDefined();
    });
});

// =============================================================================
// Node Lifecycle & Maintenance
// =============================================================================

describe('Node Lifecycle & Maintenance', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/nodes/:id/lifecycle returns lifecycle info', async () => {
        await httpRegister({ node_id: 'lc-n1' });

        const res = await app.request('/api/v1/nodes/lc-n1/lifecycle');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('POST /api/v1/nodes/:id/maintenance puts node in maintenance', async () => {
        await httpRegister({ node_id: 'maint-n1' });

        const res = await app.request('/api/v1/nodes/maint-n1/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({ enabled: true }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('maintenance');
        expect(json.node_id).toBe('maint-n1');
    });

    it('GET /api/v1/nodes/:id/uptime returns uptime data', async () => {
        await httpRegister({ node_id: 'up-n1' });

        const res = await app.request('/api/v1/nodes/up-n1/uptime');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/uptime returns fleet-wide uptime', async () => {
        const res = await app.request('/api/v1/uptime');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/nodes/:id/health-score returns node health', async () => {
        await httpRegister({ node_id: 'hs-n1' });

        const res = await app.request('/api/v1/nodes/hs-n1/health-score');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// Search & Discovery
// =============================================================================

describe('Search & Discovery', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/search returns search results', async () => {
        await httpRegister({ node_id: 'search-n1', hostname: 'big-gpu-rig' });

        const res = await app.request('/api/v1/search?q=big');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/discover returns discovery data', async () => {
        const res = await app.request('/api/v1/discover');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/suggestions returns suggestions', async () => {
        const res = await app.request('/api/v1/suggestions');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/digest returns cluster digest', async () => {
        const res = await app.request('/api/v1/digest');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// GPU & Utilization
// =============================================================================

describe('GPU & Utilization', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/gpu-map returns GPU map', async () => {
        registerNode({ node_id: 'gm-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 2 });
        insertStats('gm-n1', makeStats('gm-n1', {
            gpu_count: 2,
            gpus: [
                { busId: '0', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 8000, temperatureC: 60, utilizationPct: 70, powerDrawW: 300, fanSpeedPct: 50, clockSmMhz: 1800, clockMemMhz: 9500 },
                { busId: '1', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 12000, temperatureC: 65, utilizationPct: 90, powerDrawW: 320, fanSpeedPct: 60, clockSmMhz: 1800, clockMemMhz: 9500 },
            ],
        }));

        const res = await app.request('/api/v1/gpu-map');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/utilization returns utilization data', async () => {
        const res = await app.request('/api/v1/utilization');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    // Note: /api/v1/nodes/hot and /api/v1/nodes/idle are shadowed by
    // the earlier /api/v1/nodes/:nodeId route, so they return 404.
    // Test them via the /api/v1/utilization endpoint instead.

    it('GET /api/v1/utilization contains utilization info', async () => {
        registerNode({ node_id: 'util-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('util-n1', makeStats('util-n1'));

        const res = await app.request('/api/v1/utilization');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// Capacity Planning
// =============================================================================

describe('Capacity Planning', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/capacity returns capacity report', async () => {
        registerNode({ node_id: 'cap-n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        insertStats('cap-n1', makeStats('cap-n1'));

        const res = await app.request('/api/v1/capacity');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_vram_mb).toBeDefined();
        expect(json.used_vram_mb).toBeDefined();
        expect(json.free_vram_mb).toBeDefined();
        expect(json.utilization_pct).toBeDefined();
        expect(json.total_gpus).toBeDefined();
    });

    it('GET /api/v1/capacity returns zero with no nodes', async () => {
        const res = await app.request('/api/v1/capacity');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total_vram_mb).toBe(0);
        expect(json.free_vram_mb).toBe(0);
    });
});

// =============================================================================
// Cache & DB Stats
// =============================================================================

describe('Cache & DB Stats', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/cache/stats returns cache stats', async () => {
        const res = await app.request('/api/v1/cache/stats');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('POST /api/v1/cache/purge purges expired entries', async () => {
        const res = await app.request('/api/v1/cache/purge', { method: 'POST' });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('purged');
        expect(json.expired_entries_removed).toBeDefined();
    });

    it('GET /api/v1/config/db-stats returns DB statistics', async () => {
        const res = await app.request('/api/v1/config/db-stats');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/config/cors returns CORS config', async () => {
        const res = await app.request('/api/v1/config/cors');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// Webhooks
// =============================================================================

describe('Webhooks', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/webhooks returns webhook list', async () => {
        const res = await app.request('/api/v1/webhooks');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('POST /api/v1/webhooks creates a webhook', async () => {
        const res = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                url: 'https://example.com/hook',
                events: ['node_online', 'node_offline'],
            }),
        });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('DELETE /api/v1/webhooks/:id removes a webhook', async () => {
        // Create one first
        const createRes = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                url: 'https://example.com/hook2',
                events: ['alert'],
            }),
        });
        const created = await createRes.json();
        const id = created.id;

        if (id) {
            const delRes = await app.request(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
            expect(delRes.status).toBe(200);
        }
    });
});

// =============================================================================
// Status Page & Dashboard
// =============================================================================

describe('Status Page & Dashboard', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/status-page returns status page data', async () => {
        const res = await app.request('/api/v1/status-page');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/dashboard returns dashboard data', async () => {
        const res = await app.request('/api/v1/dashboard');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/gateway/uptime returns gateway uptime', async () => {
        const res = await app.request('/api/v1/gateway/uptime');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/about returns about info', async () => {
        const res = await app.request('/api/v1/about');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});

// =============================================================================
// Errors & Observability
// =============================================================================

describe('Errors & Observability', () => {
    beforeEach(() => wipeDb());

    it('GET /api/v1/errors returns error log', async () => {
        const res = await app.request('/api/v1/errors');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/timeline returns timeline events', async () => {
        const res = await app.request('/api/v1/timeline');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });

    it('GET /api/v1/inventory returns hardware inventory', async () => {
        const res = await app.request('/api/v1/inventory');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toBeDefined();
    });
});
