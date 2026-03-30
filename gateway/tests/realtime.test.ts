/**
 * TentaCLAW Gateway — Real-time Communication Layer Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerClient,
    removeClient,
    getClients,
    getClientCounts,
    subscribe,
    unsubscribe,
    shouldReceive,
    getConnectionStats,
    pruneStaleClients,
    formatSSE,
    formatWS,
    _resetClients,
} from '../src/realtime';

beforeEach(() => {
    _resetClients();
});

// ---------------------------------------------------------------------------
// Client registration
// ---------------------------------------------------------------------------

describe('registerClient / removeClient', () => {
    it('should register a client and return it', () => {
        const c = registerClient('c1', 'dashboard');
        expect(c.id).toBe('c1');
        expect(c.type).toBe('dashboard');
        expect(c.subscriptions).toEqual([]);
        expect(c.connectedAt).toBeGreaterThan(0);
        expect(c.lastPing).toBe(c.connectedAt);
    });

    it('should list registered clients', () => {
        registerClient('a', 'agent');
        registerClient('b', 'cli');
        expect(getClients()).toHaveLength(2);
    });

    it('should remove a client', () => {
        registerClient('x', 'external');
        removeClient('x');
        expect(getClients()).toHaveLength(0);
    });

    it('should silently ignore removing a non-existent client', () => {
        removeClient('ghost');
        expect(getClients()).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Client counts
// ---------------------------------------------------------------------------

describe('getClientCounts', () => {
    it('should return counts grouped by type', () => {
        registerClient('a1', 'agent');
        registerClient('a2', 'agent');
        registerClient('d1', 'dashboard');
        const counts = getClientCounts();
        expect(counts).toEqual({ agent: 2, dashboard: 1 });
    });

    it('should return empty object when no clients', () => {
        expect(getClientCounts()).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe('subscribe / unsubscribe', () => {
    it('should add subscriptions to a client', () => {
        registerClient('s1', 'dashboard');
        subscribe('s1', ['stats', 'alerts']);
        const c = getClients().find(c => c.id === 's1')!;
        expect(c.subscriptions).toEqual(['stats', 'alerts']);
    });

    it('should not duplicate subscriptions', () => {
        registerClient('s2', 'cli');
        subscribe('s2', ['stats']);
        subscribe('s2', ['stats', 'alerts']);
        const c = getClients().find(c => c.id === 's2')!;
        expect(c.subscriptions).toEqual(['stats', 'alerts']);
    });

    it('should unsubscribe from events', () => {
        registerClient('s3', 'agent');
        subscribe('s3', ['stats', 'alerts', 'commands']);
        unsubscribe('s3', ['alerts']);
        const c = getClients().find(c => c.id === 's3')!;
        expect(c.subscriptions).toEqual(['stats', 'commands']);
    });

    it('should handle subscribe/unsubscribe on non-existent client', () => {
        // Should not throw
        subscribe('nope', ['stats']);
        unsubscribe('nope', ['stats']);
    });
});

// ---------------------------------------------------------------------------
// shouldReceive
// ---------------------------------------------------------------------------

describe('shouldReceive', () => {
    it('should return true when client has matching subscription', () => {
        registerClient('r1', 'dashboard');
        subscribe('r1', ['stats']);
        expect(shouldReceive('r1', 'stats')).toBe(true);
    });

    it('should return false when client does not have matching subscription', () => {
        registerClient('r2', 'dashboard');
        subscribe('r2', ['alerts']);
        expect(shouldReceive('r2', 'stats')).toBe(false);
    });

    it('should return true (wildcard) when client has no subscriptions', () => {
        registerClient('r3', 'agent');
        expect(shouldReceive('r3', 'anything')).toBe(true);
    });

    it('should return false for non-existent client', () => {
        expect(shouldReceive('ghost', 'stats')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Connection statistics
// ---------------------------------------------------------------------------

describe('getConnectionStats', () => {
    it('should return zeros when no clients connected', () => {
        const stats = getConnectionStats();
        expect(stats.total).toBe(0);
        expect(stats.avg_connection_time_ms).toBe(0);
        expect(stats.by_type).toEqual({});
        expect(stats.subscriptions).toEqual({});
    });

    it('should aggregate stats across clients', () => {
        registerClient('a', 'agent');
        registerClient('b', 'dashboard');
        subscribe('a', ['stats']);
        subscribe('b', ['stats', 'alerts']);

        const stats = getConnectionStats();
        expect(stats.total).toBe(2);
        expect(stats.by_type).toEqual({ agent: 1, dashboard: 1 });
        expect(stats.subscriptions).toEqual({ stats: 2, alerts: 1 });
        expect(stats.avg_connection_time_ms).toBeGreaterThanOrEqual(0);
    });
});

// ---------------------------------------------------------------------------
// Prune stale clients
// ---------------------------------------------------------------------------

describe('pruneStaleClients', () => {
    it('should remove clients whose lastPing exceeds max age', () => {
        const c = registerClient('stale', 'agent');
        // Simulate a very old ping
        c.lastPing = Date.now() - 120_000; // 2 minutes ago
        const removed = pruneStaleClients(60);
        expect(removed).toEqual(['stale']);
        expect(getClients()).toHaveLength(0);
    });

    it('should keep fresh clients', () => {
        registerClient('fresh', 'dashboard');
        const removed = pruneStaleClients(60);
        expect(removed).toEqual([]);
        expect(getClients()).toHaveLength(1);
    });

    it('should default to 60 seconds', () => {
        const c = registerClient('old', 'cli');
        c.lastPing = Date.now() - 61_000;
        const removed = pruneStaleClients();
        expect(removed).toEqual(['old']);
    });
});

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

describe('formatSSE', () => {
    it('should produce valid SSE output', () => {
        const result = formatSSE('stats', { cpu: 42 });
        expect(result).toContain('event: stats\n');
        expect(result).toContain('data: {"cpu":42}');
        expect(result).toMatch(/\n\n$/);
    });
});

describe('formatWS', () => {
    it('should produce a JSON envelope with type, data, and ts', () => {
        const raw = formatWS('alert', { level: 'critical' });
        const parsed = JSON.parse(raw);
        expect(parsed.type).toBe('alert');
        expect(parsed.data).toEqual({ level: 'critical' });
        expect(parsed.ts).toBeGreaterThan(0);
    });
});
