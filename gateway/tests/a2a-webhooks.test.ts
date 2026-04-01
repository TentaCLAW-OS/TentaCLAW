/**
 * A2A Protocol + Webhook System Tests (Waves 94 + 98)
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';

import { getAgentCard, submitTask, getTask, listTasks, _resetA2A } from '../src/experimental/a2a';
import { registerWebhook, listWebhooks, deleteWebhook, verifySignature, ALL_WEBHOOK_EVENTS, _resetWebhooks } from '../src/experimental/webhooks';
import { app } from '../src/experimental/index';

beforeEach(() => {
    _resetA2A();
    _resetWebhooks();
});

// =============================================================================
// A2A Protocol
// =============================================================================

describe('A2A Agent Card', () => {
    it('returns valid agent card', () => {
        const card = getAgentCard('https://cluster.local');
        expect(card.name).toBe('TentaCLAW GPU Cluster');
        expect(card.protocol_version).toBe('0.3');
        expect(card.capabilities.length).toBe(4);
        expect(card.url).toBe('https://cluster.local');
    });

    it('exposes inference capability', () => {
        const card = getAgentCard('http://localhost:8080');
        const inference = card.capabilities.find(c => c.name === 'inference');
        expect(inference).toBeTruthy();
        expect(inference!.input_schema).toBeTruthy();
    });

    it('agent card accessible via /.well-known/agent.json', async () => {
        const res = await app.request('/.well-known/agent.json');
        expect(res.status).toBe(200);
        const card = await res.json() as any;
        expect(card.name).toContain('TentaCLAW');
        expect(card.capabilities).toBeTruthy();
    });
});

describe('A2A Task Management', () => {
    it('accepts valid task', async () => {
        const task = await submitTask('cluster_status', {});
        expect(task.id).toMatch(/^task-/);
        expect(['accepted', 'working', 'completed']).toContain(task.state);
    });

    it('rejects unknown capability', async () => {
        const task = await submitTask('fly_to_moon', {});
        expect(task.state).toBe('rejected');
        expect(task.error).toContain('Unknown capability');
    });

    it('tracks task by ID', async () => {
        const task = await submitTask('cluster_status', {});
        const found = getTask(task.id);
        expect(found).toBeTruthy();
        expect(found!.capability).toBe('cluster_status');
    });

    it('lists recent tasks', async () => {
        await submitTask('cluster_status', {});
        await submitTask('compliance_check', { period_days: 7 });
        const tasks = listTasks();
        expect(tasks.length).toBe(2);
    });

    it('POST /api/v1/a2a/tasks creates task', async () => {
        const res = await app.request('/api/v1/a2a/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ capability: 'cluster_status' }),
        });
        expect(res.status).toBe(200);
        const task = await res.json() as any;
        expect(task.id).toBeTruthy();
    });
});

// =============================================================================
// Webhooks
// =============================================================================

describe('Webhook Registration', () => {
    it('registers a webhook', () => {
        const wh = registerWebhook('https://example.com/hook', ['model.deployed', 'node.joined'], 'Test hook');
        expect(wh.id).toMatch(/^wh_/);
        expect(wh.secret).toMatch(/^whsec_/);
        expect(wh.events).toHaveLength(2);
    });

    it('lists webhooks with masked secrets', () => {
        registerWebhook('https://a.com/hook', ['model.deployed']);
        registerWebhook('https://b.com/hook', ['node.joined']);
        const list = listWebhooks();
        expect(list).toHaveLength(2);
        expect(list[0].secret).toContain('...');
    });

    it('deletes a webhook', () => {
        const wh = registerWebhook('https://x.com/hook', ['model.deployed']);
        expect(deleteWebhook(wh.id)).toBe(true);
        expect(listWebhooks()).toHaveLength(0);
    });

    it('delete returns false for nonexistent', () => {
        expect(deleteWebhook('wh_nonexistent')).toBe(false);
    });

    it('15 event types defined', () => {
        expect(ALL_WEBHOOK_EVENTS).toHaveLength(15);
        expect(ALL_WEBHOOK_EVENTS).toContain('model.deployed');
        expect(ALL_WEBHOOK_EVENTS).toContain('node.unhealthy');
        expect(ALL_WEBHOOK_EVENTS).toContain('scale.up');
    });
});

describe('Webhook Signatures', () => {
    it('verifies valid HMAC-SHA256 signature', () => {
        const secret = 'whsec_test123';
        const body = '{"event":"test"}';
        const { createHmac } = require('crypto');
        const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
        expect(verifySignature(secret, body, sig)).toBe(true);
    });

    it('rejects invalid signature', () => {
        expect(verifySignature('secret', 'body', 'sha256=invalid')).toBe(false);
    });
});

describe('Webhook HTTP Endpoints', () => {
    it('POST /api/v1/webhooks creates webhook', async () => {
        const res = await app.request('/api/v1/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://test.com/hook', events: ['model.deployed'] }),
        });
        expect(res.status).toBeLessThan(300);
        const data = await res.json() as any;
        expect(data.id).toBeTruthy(); // ID format varies by webhook implementation
    });

    it('GET /api/v1/webhooks lists webhooks', async () => {
        registerWebhook('https://test.com/hook', ['model.deployed']);
        const res = await app.request('/api/v1/webhooks');
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data).toHaveLength(1);
    });

    it('GET /api/v1/webhooks/events lists event types', async () => {
        const res = await app.request('/api/v1/webhooks/events');
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.events).toHaveLength(15);
    });
});
