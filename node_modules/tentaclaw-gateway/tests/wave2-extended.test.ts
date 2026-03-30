/**
 * TentaCLAW Gateway — Wave 2 Extended Tests
 *
 * Tests for the webhook system, playground API, detailed health, and OpenAPI spec.
 * Uses Hono's app.request() for HTTP-level testing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { getDb } from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';

/** Helper: clean all tables between tests */
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

// =============================================================================
// Webhook System
// =============================================================================

describe('Webhook System', () => {
    // Track webhook IDs created during tests so we can clean up
    const createdWebhookIds: string[] = [];

    beforeEach(async () => {
        // Clean up any webhooks created by previous tests
        // (webhooks live in-memory, not in SQLite, so we delete via API)
        for (const id of createdWebhookIds) {
            await app.request(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
        }
        createdWebhookIds.length = 0;
    });

    it('GET /api/v1/webhooks returns empty array initially', async () => {
        const res = await app.request('/api/v1/webhooks');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(0);
    });

    it('POST /api/v1/webhooks creates a webhook', async () => {
        const res = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: 'https://example.com/hook',
                events: ['node_online', 'alert'],
            }),
        });

        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.url).toBe('https://example.com/hook');
        expect(json.events).toEqual(['node_online', 'alert']);
        createdWebhookIds.push(json.id);
    });

    it('POST /api/v1/webhooks requires url field', async () => {
        const res = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: ['*'] }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('url');
    });

    it('created webhook has id, url, events, enabled fields', async () => {
        const res = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: 'https://example.com/fields-test',
                events: ['*'],
            }),
        });

        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json).toHaveProperty('id');
        expect(json).toHaveProperty('url');
        expect(json).toHaveProperty('events');
        expect(json).toHaveProperty('enabled');
        expect(typeof json.id).toBe('string');
        expect(json.id.length).toBeGreaterThan(0);
        expect(json.enabled).toBe(true);
        createdWebhookIds.push(json.id);
    });

    it('DELETE /api/v1/webhooks/:id removes a webhook', async () => {
        // Create a webhook first
        const createRes = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com/to-delete' }),
        });
        const created = await createRes.json();
        const id = created.id;

        // Delete it
        const delRes = await app.request(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        const delJson = await delRes.json();
        expect(delJson.deleted).toBe(true);

        // Verify it's gone
        const listRes = await app.request('/api/v1/webhooks');
        const list = await listRes.json();
        expect(list.find((w: any) => w.id === id)).toBeUndefined();
    });

    it('webhook secret is masked in GET response', async () => {
        // Create a webhook with a secret
        const createRes = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: 'https://example.com/secret-test',
                secret: 'my-super-secret-key',
            }),
        });
        const created = await createRes.json();
        createdWebhookIds.push(created.id);

        // The POST response returns the full webhook (with secret)
        expect(created.secret).toBe('my-super-secret-key');

        // But GET masks the secret
        const listRes = await app.request('/api/v1/webhooks');
        const list = await listRes.json();
        const found = list.find((w: any) => w.id === created.id);
        expect(found).toBeDefined();
        expect(found.secret).toBe('***');
        expect(found.secret).not.toBe('my-super-secret-key');
    });
});

// =============================================================================
// Playground API
// =============================================================================

describe('Playground API', () => {
    beforeEach(() => {
        cleanDb();
    });

    it('GET /api/v1/playground/models returns model list', async () => {
        const res = await app.request('/api/v1/playground/models');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toHaveProperty('models');
        expect(Array.isArray(json.models)).toBe(true);
    });

    it('GET /api/v1/playground/history returns history', async () => {
        const res = await app.request('/api/v1/playground/history');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toHaveProperty('history');
        expect(json).toHaveProperty('count');
        expect(Array.isArray(json.history)).toBe(true);
        expect(json.count).toBe(json.history.length);
    });

    it('POST /api/v1/playground/chat requires model field', async () => {
        const res = await app.request('/api/v1/playground/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.message).toContain('model');
    });

    it('POST /api/v1/playground/compare requires prompt and models fields', async () => {
        // Missing both prompt and models
        const res1 = await app.request('/api/v1/playground/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res1.status).toBe(400);
        const json1 = await res1.json();
        expect(json1.error.message).toContain('prompt');

        // Has prompt but missing models
        const res2 = await app.request('/api/v1/playground/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'Hello world' }),
        });
        expect(res2.status).toBe(400);
        const json2 = await res2.json();
        expect(json2.error.message).toContain('models');
    });
});

// =============================================================================
// Health Detailed
// =============================================================================

describe('Health Detailed', () => {
    beforeEach(() => {
        cleanDb();
    });

    it('GET /api/v1/health/detailed returns detailed health', async () => {
        const res = await app.request('/api/v1/health/detailed');
        // Status could be 200 or 503 depending on node state
        expect([200, 503]).toContain(res.status);
        const json = await res.json();
        expect(json).toHaveProperty('status');
        expect(json).toHaveProperty('checks');
        expect(['healthy', 'degraded', 'unhealthy']).toContain(json.status);
    });

    it('detailed health includes database, nodes, memory checks', async () => {
        const res = await app.request('/api/v1/health/detailed');
        const json = await res.json();

        expect(json.checks).toHaveProperty('database');
        expect(json.checks.database).toHaveProperty('status');
        expect(json.checks.database).toHaveProperty('latency_ms');

        expect(json.checks).toHaveProperty('nodes');
        expect(json.checks.nodes).toHaveProperty('total');
        expect(json.checks.nodes).toHaveProperty('online');
        expect(json.checks.nodes).toHaveProperty('status');

        expect(json.checks).toHaveProperty('memory');
        expect(json.checks.memory).toHaveProperty('status');
        expect(json.checks.memory).toHaveProperty('rss_mb');
        expect(json.checks.memory).toHaveProperty('heap_mb');
    });

    it('detailed health includes version field', async () => {
        const res = await app.request('/api/v1/health/detailed');
        const json = await res.json();
        expect(json).toHaveProperty('version');
        expect(typeof json.version).toBe('string');
        expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
});

// =============================================================================
// OpenAPI
// =============================================================================

describe('OpenAPI', () => {
    it('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
        const res = await app.request('/api/v1/openapi.json');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toHaveProperty('openapi');
        expect(json).toHaveProperty('info');
        expect(json).toHaveProperty('paths');
    });

    it('OpenAPI spec has correct version and title', async () => {
        const res = await app.request('/api/v1/openapi.json');
        const json = await res.json();
        expect(json.openapi).toBe('3.0.3');
        expect(json.info.title).toBe('TentaCLAW OS API');
        expect(json.info.version).toBe('0.2.0');
    });
});
