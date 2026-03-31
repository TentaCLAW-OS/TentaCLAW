/**
 * TentaCLAW Gateway — Auth Enforcement Tests (Wave 1, Phase 4)
 *
 * Tests auth logic and cluster secret enforcement.
 * Since vitest runs with TENTACLAW_NO_AUTH=true for other tests,
 * these tests validate the auth functions directly AND test the
 * cluster secret enforcement which is always active.
 *
 * 15 test cases covering:
 * - Auth disabled/enabled detection
 * - API key validation (valid, invalid, expired)
 * - Cluster secret enforcement (missing, wrong, valid)
 * - Public endpoint access
 */

import { describe, it, expect, beforeAll } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';
// Cluster secret is set in vitest.config.ts env: 'test-secret'

import { app, isAuthDisabled } from '../src/index';
import { createApiKey, validateApiKey, revokeApiKey } from '../src/db';

// ---------------------------------------------------------------------------
// Auth Configuration Tests
// ---------------------------------------------------------------------------

describe('Auth Configuration', () => {
    it('isAuthDisabled returns true when TENTACLAW_NO_AUTH=true', () => {
        const original = process.env.TENTACLAW_NO_AUTH;
        process.env.TENTACLAW_NO_AUTH = 'true';
        expect(isAuthDisabled()).toBe(true);
        process.env.TENTACLAW_NO_AUTH = original;
    });

    it('isAuthDisabled returns false when TENTACLAW_NO_AUTH is unset', () => {
        const original = process.env.TENTACLAW_NO_AUTH;
        delete process.env.TENTACLAW_NO_AUTH;
        expect(isAuthDisabled()).toBe(false);
        process.env.TENTACLAW_NO_AUTH = original;
    });

    it('isAuthDisabled returns false when TENTACLAW_NO_AUTH=false', () => {
        const original = process.env.TENTACLAW_NO_AUTH;
        process.env.TENTACLAW_NO_AUTH = 'false';
        expect(isAuthDisabled()).toBe(false);
        process.env.TENTACLAW_NO_AUTH = original;
    });
});

// ---------------------------------------------------------------------------
// API Key Validation (Direct DB Tests)
// ---------------------------------------------------------------------------

describe('API Key Validation', () => {
    let validKey: string;

    beforeAll(() => {
        const result = createApiKey('test-key', 'Test Key for auth tests', 'admin');
        validKey = result.key;
    });

    it('validates a correct API key', () => {
        const result = validateApiKey(validKey, 'read');
        expect(result.valid).toBe(true);
    });

    it('rejects an invalid API key', () => {
        const result = validateApiKey('nonexistent-key-12345', 'read');
        expect(result.valid).toBe(false);
    });

    it('rejects an empty API key', () => {
        const result = validateApiKey('', 'read');
        expect(result.valid).toBe(false);
    });

    it('validates read permission for admin key', () => {
        const result = validateApiKey(validKey, 'read');
        expect(result.valid).toBe(true);
    });

    it('validates write permission for admin key', () => {
        const result = validateApiKey(validKey, 'write');
        expect(result.valid).toBe(true);
    });

    it('rejects revoked key', () => {
        const result2 = createApiKey('revoke-test', 'Key to revoke', 'admin');
        revokeApiKey(result2.id);
        const check = validateApiKey(result2.key, 'read');
        expect(check.valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Cluster Secret Enforcement (Always Active)
// ---------------------------------------------------------------------------

describe('Cluster Secret Enforcement', () => {
    const validNode = {
        node_id: 'auth-test-node',
        farm_hash: 'auth-test-farm',
        hostname: 'auth-test-host',
        gpu_count: 1,
        os_version: 'ubuntu-24.04',
    };

    it('403 on register without cluster secret', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validNode),
        });
        expect(res.status).toBe(403);
    });

    it('403 on register with wrong cluster secret', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cluster-Secret': 'wrong-secret',
            },
            body: JSON.stringify({ ...validNode, node_id: 'bad-node' }),
        });
        expect(res.status).toBe(403);
    });

    it('200 on register with valid cluster secret', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cluster-Secret': 'test-secret',
            },
            body: JSON.stringify({ ...validNode, node_id: 'good-auth-node' }),
        });
        expect(res.status).toBe(200);
    });

    it('403 error mentions cluster secret', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...validNode, node_id: 'msg-node' }),
        });
        const json = await res.json();
        expect(json.error.toLowerCase()).toContain('cluster secret');
    });
});

// ---------------------------------------------------------------------------
// Public Endpoints (No Auth Required)
// ---------------------------------------------------------------------------

describe('Public Endpoints', () => {
    it('GET /health accessible without auth', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
    });

    it('GET / accessible without auth', async () => {
        const res = await app.request('/');
        expect(res.status).toBe(200);
    });
});
