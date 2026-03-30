/**
 * TentaCLAW Gateway — Inference Proxy Tests
 *
 * Tests the OpenAI-compatible inference proxy, prompt cache,
 * model aliases, and model search endpoints via Hono's app.request().
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getDb,
    registerNode,
    insertStats,
    getClusterModels,
    setModelAlias,
    getAllModelAliases,
    ensureDefaultAliases,
    getCacheStats,
} from '../src/db';
import { app } from '../src/index';
import type { StatsPayload } from '../../shared/types';

process.env.TENTACLAW_DB_PATH = ':memory:';

function clearDb() {
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    for (const table of [
        'ssh_keys', 'node_tags', 'model_pulls', 'nodes', 'stats',
        'commands', 'flight_sheets', 'alerts', 'benchmarks',
        'node_events', 'schedules', 'prompt_cache', 'model_aliases',
        'api_keys', 'inference_log', 'watchdog_events',
        'notification_channels', 'uptime_events', 'overclock_profiles',
        'route_latency', 'route_throughput',
    ]) {
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
        gpu_count: 1,
        gpus: [{
            busId: '0:1',
            name: 'RTX 4070 Ti Super',
            vramTotalMb: 16384,
            vramUsedMb: 8000,
            temperatureC: 62,
            utilizationPct: 30,
            powerDrawW: 220,
            fanSpeedPct: 50,
            clockSmMhz: 2300,
            clockMemMhz: 10500,
        }],
        cpu: { usage_pct: 55, temp_c: 48 },
        ram: { total_mb: 65536, used_mb: 40960 },
        disk: { total_gb: 1000, used_gb: 450 },
        network: { bytes_in: 8000000000, bytes_out: 2000000000 },
        inference: {
            loaded_models: ['llama3.1:8b'],
            in_flight_requests: 0,
            tokens_generated: 500000,
            avg_latency_ms: 35,
        },
        toks_per_sec: 210,
        requests_completed: 8000,
        ...overrides,
    };
}

// =============================================================================
// Inference Proxy
// =============================================================================

describe('Inference Proxy', () => {
    beforeEach(clearDb);

    it('POST /v1/chat/completions returns 400 when model is missing', async () => {
        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toContain('model is required');
        expect(body.error.type).toBe('invalid_request_error');
    });

    it('POST /v1/chat/completions returns 400 when messages array is missing', async () => {
        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1:8b',
            }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toContain('messages array is required');
        expect(body.error.type).toBe('invalid_request_error');
    });

    it('POST /v1/chat/completions returns 503 when no node has the model', async () => {
        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nonexistent-model:latest',
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.message).toContain('No online node has model');
        expect(body.error.type).toBe('model_not_found');
    });

    it('POST /v1/chat/completions returns available_models in error response', async () => {
        // Register a node with a loaded model so available_models is populated
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'rig-1', ip_address: '10.0.0.1', gpu_count: 1 });
        insertStats('n1', mockStats('n1', {
            inference: { loaded_models: ['hermes3:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nonexistent-model:latest',
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.available_models).toBeDefined();
        expect(Array.isArray(body.error.available_models)).toBe(true);
        expect(body.error.available_models).toContain('hermes3:8b');
    });

    it('GET /v1/models returns model list (even if empty)', async () => {
        const res = await app.request('/v1/models', { method: 'GET' });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.object).toBe('list');
        expect(Array.isArray(body.data)).toBe(true);
    });
});

// =============================================================================
// Anthropic Messages API (/v1/messages)
// =============================================================================

describe('Anthropic Messages API', () => {
    beforeEach(clearDb);

    it('POST /v1/messages returns 400 when model is missing', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('invalid_request_error');
        expect(body.error.message).toContain('model is required');
    });

    it('POST /v1/messages returns 400 when messages is missing', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
            }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('invalid_request_error');
        expect(body.error.message).toContain('messages array is required');
    });

    it('POST /v1/messages returns 400 when max_tokens is missing', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-3-opus-20240229',
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('invalid_request_error');
        expect(body.error.message).toContain('max_tokens is required');
    });

    it('POST /v1/messages returns 404 when no node has the model', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('not_found_error');
        expect(body.error.message).toContain('not available');
    });

    it('POST /v1/messages resolves versioned Anthropic model names via alias system', async () => {
        // Verify that the alias chain works: claude-3-opus-20240229 → claude-3-opus → llama3.1:70b
        // We do NOT register a node, so it should resolve the model but return 404 with the resolved name
        ensureDefaultAliases();

        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('not_found_error');
        // The error message should mention the resolved model name
        expect(body.error.message).toContain('claude-3-opus-20240229');
    });

    it('POST /v1/messages falls through to 404 when no node has fallback models either', async () => {
        // With aliases seeded but no nodes, should still get 404 even with fallbacks
        ensureDefaultAliases();

        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.type).toBe('error');
        expect(body.error.type).toBe('not_found_error');
    });

    it('POST /v1/messages returns Anthropic error format', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nonexistent-model',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'test' }],
            }),
        });

        const body = await res.json();
        // Anthropic error envelope
        expect(body).toHaveProperty('type', 'error');
        expect(body).toHaveProperty('error');
        expect(body.error).toHaveProperty('type');
        expect(body.error).toHaveProperty('message');
    });

    it('version endpoint includes anthropic_compatible field', async () => {
        const res = await app.request('/api/v1/version', { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.anthropic_compatible).toContain('/v1/messages');
    });

    it('capabilities endpoint includes anthropic_messages_api feature', async () => {
        const res = await app.request('/api/v1/capabilities', { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.features.anthropic_messages_api).toBe(true);
        expect(body.api_compatibility.anthropic).toContain('/v1/messages');
    });

    it('root endpoint includes anthropic path', async () => {
        const res = await app.request('/', { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.endpoints.anthropic).toBe('/v1/messages');
    });
});

// =============================================================================
// Prompt Cache
// =============================================================================

describe('Prompt Cache', () => {
    beforeEach(clearDb);

    it('GET /api/v1/cache/stats returns cache statistics', async () => {
        const res = await app.request('/api/v1/cache/stats', { method: 'GET' });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.entries).toBe('number');
        expect(typeof body.total_hits).toBe('number');
    });

    it('cache stats include entries and total_hits fields', async () => {
        const res = await app.request('/api/v1/cache/stats', { method: 'GET' });
        const body = await res.json();

        expect(body).toHaveProperty('entries');
        expect(body).toHaveProperty('total_hits');
        expect(body).toHaveProperty('total_tokens_saved');
        // Fresh DB should have zero entries
        expect(body.entries).toBe(0);
        expect(body.total_hits).toBe(0);
        expect(body.total_tokens_saved).toBe(0);
    });
});

// =============================================================================
// Model Aliases
// =============================================================================

describe('Model Aliases', () => {
    beforeEach(clearDb);

    it('GET /api/v1/aliases returns alias list', async () => {
        const res = await app.request('/api/v1/aliases', { method: 'GET' });

        expect(res.status).toBe(200);
        const body = await res.json();
        // ensureDefaultAliases is called by the route, so we should get the defaults
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
        // Each alias should have the expected shape
        const first = body[0];
        expect(first).toHaveProperty('alias');
        expect(first).toHaveProperty('target');
    });

    it('POST /api/v1/aliases creates a new alias', async () => {
        const res = await app.request('/api/v1/aliases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                alias: 'my-custom-model',
                target: 'llama3.1:8b',
                fallbacks: ['mistral:7b'],
            }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('created');
        expect(body.alias).toBe('my-custom-model');
        expect(body.target).toBe('llama3.1:8b');

        // Verify the alias is now in the list
        const listRes = await app.request('/api/v1/aliases', { method: 'GET' });
        const aliases = await listRes.json();
        const created = aliases.find((a: any) => a.alias === 'my-custom-model');
        expect(created).toBeDefined();
        expect(created.target).toBe('llama3.1:8b');
    });

    it('model alias resolution works in chat completions error (shows resolved name)', async () => {
        // Create an alias mapping
        setModelAlias('my-alias', 'some-resolved-model:7b');

        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'my-alias',
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        // The error message should mention the resolved model name
        expect(body.error.message).toContain('some-resolved-model:7b');
        // The aliases field should show the mapping
        expect(body.error.aliases).toBeDefined();
        expect(body.error.aliases.requested).toBe('my-alias');
        expect(body.error.aliases.resolved).toBe('some-resolved-model:7b');
    });
});

// =============================================================================
// Model Search
// =============================================================================

describe('Model Search', () => {
    beforeEach(clearDb);

    it('GET /api/v1/model-search returns results', async () => {
        const res = await app.request('/api/v1/model-search', { method: 'GET' });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('models');
        expect(Array.isArray(body.models)).toBe(true);
        expect(body.models.length).toBeGreaterThan(0);
        expect(body).toHaveProperty('cluster_vram_mb');
        expect(body).toHaveProperty('tags');
        // Each model should have expected fields
        const first = body.models[0];
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('params');
        expect(first).toHaveProperty('vram_mb');
        expect(first).toHaveProperty('tags');
        expect(first).toHaveProperty('fits_cluster');
    });

    it('GET /api/v1/model-search?q=llama filters results', async () => {
        const res = await app.request('/api/v1/model-search?q=llama', { method: 'GET' });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.models.length).toBeGreaterThan(0);
        // All returned models should have "llama" in the name
        for (const model of body.models) {
            expect(model.name.toLowerCase()).toContain('llama');
        }

        // Should be fewer than the unfiltered total
        const allRes = await app.request('/api/v1/model-search', { method: 'GET' });
        const allBody = await allRes.json();
        expect(body.models.length).toBeLessThan(allBody.models.length);
    });
});
