/**
 * TentaCLAW Gateway — Federation Tests
 *
 * Tests the multi-cluster federation module: cluster registry,
 * federated model discovery, health, capacity, replication, and reconciliation.
 * Uses in-memory SQLite via the shared DB layer; remote HTTP calls are mocked.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';

import {
    registerCluster,
    removeCluster,
    listClusters,
    getCluster,
    getFederatedModels,
    getFederationHealth,
    getFederatedCapacity,
    getReplicationStatus,
    reconcileFederation,
    _resetFederation,
} from '../src/federation';

import type {
    FederatedClusterConfig,
} from '../src/federation';

// ---------------------------------------------------------------------------
// Mock global fetch so registerCluster's network calls don't actually fire.
// Each test can override the mock behavior as needed.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockFetchOnline(overrides: Record<string, unknown> = {}) {
    mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
            status: 'ok',
            total_gpus: 4,
            total_vram_mb: 98304,
            total_nodes: 2,
            online_nodes: 2,
            models: ['llama3.1:8b', 'hermes3:8b'],
            backends: ['ollama'],
            ...overrides,
        }),
    });
}

function mockFetchOffline() {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClusterConfig(name: string, url: string, extra: Partial<FederatedClusterConfig> = {}): FederatedClusterConfig {
    return {
        name,
        gatewayUrl: url,
        location: extra.location ?? 'test-lab',
        apiKey: extra.apiKey,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cluster Registry', () => {
    beforeEach(() => {
        _resetFederation();
        mockFetchOnline();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('registerCluster adds a cluster', async () => {
        const cluster = await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        expect(cluster).toBeDefined();
        expect(cluster.id).toBeTruthy();
        expect(cluster.name).toBe('alpha');
        expect(cluster.gatewayUrl).toBe('http://alpha:3000');
    });

    it('listClusters returns all clusters', async () => {
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        await registerCluster(makeClusterConfig('beta', 'http://beta:3000'));
        const all = listClusters();
        expect(all.length).toBe(2);
        expect(all.map(c => c.name).sort()).toEqual(['alpha', 'beta']);
    });

    it('removeCluster removes by id', async () => {
        const cluster = await registerCluster(makeClusterConfig('gamma', 'http://gamma:3000'));
        expect(removeCluster(cluster.id)).toBe(true);
        expect(getCluster(cluster.id)).toBeNull();
        expect(listClusters().length).toBe(0);
    });

    it('getCluster returns single cluster', async () => {
        const cluster = await registerCluster(makeClusterConfig('delta', 'http://delta:3000'));
        const found = getCluster(cluster.id);
        expect(found).not.toBeNull();
        expect(found!.name).toBe('delta');
    });

    it('cluster has required fields (id, name, gatewayUrl, status)', async () => {
        const cluster = await registerCluster(makeClusterConfig('echo', 'http://echo:3000'));
        expect(cluster).toHaveProperty('id');
        expect(cluster).toHaveProperty('name');
        expect(cluster).toHaveProperty('gatewayUrl');
        expect(cluster).toHaveProperty('status');
        expect(typeof cluster.id).toBe('string');
        expect(typeof cluster.name).toBe('string');
        expect(typeof cluster.gatewayUrl).toBe('string');
        expect(['online', 'offline', 'degraded']).toContain(cluster.status);
    });
});

describe('Federated Models', () => {
    beforeEach(() => {
        _resetFederation();
        mockFetchOnline();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('getFederatedModels returns empty initially', () => {
        const models = getFederatedModels();
        expect(models).toEqual([]);
    });

    it('after registering cluster with models, returns combined list', async () => {
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        const models = getFederatedModels();
        // The mock returns ['llama3.1:8b', 'hermes3:8b']
        expect(models.length).toBeGreaterThanOrEqual(1);
        const modelNames = models.map(m => m.model);
        expect(modelNames).toContain('llama3.1:8b');
        expect(modelNames).toContain('hermes3:8b');
    });

    it('models are deduplicated across clusters', async () => {
        // Both clusters report the same models
        mockFetchOnline({ models: ['llama3.1:8b'], total_gpus: 2, total_vram_mb: 49152 });
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        await registerCluster(makeClusterConfig('beta', 'http://beta:3000'));
        const models = getFederatedModels();
        // Same model should appear once but with two cluster entries
        const llamaEntry = models.find(m => m.model === 'llama3.1:8b');
        expect(llamaEntry).toBeDefined();
        expect(llamaEntry!.clusters.length).toBe(2);
    });
});

describe('Federation Health', () => {
    beforeEach(() => {
        _resetFederation();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('getFederationHealth returns status', async () => {
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        const health = getFederationHealth();
        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('totalClusters');
        expect(health).toHaveProperty('onlineClusters');
        expect(health).toHaveProperty('offlineClusters');
        expect(health).toHaveProperty('clusters');
        expect(health.totalClusters).toBe(1);
    });

    it('offline clusters are marked', async () => {
        // Register an online cluster
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));

        // Register an offline cluster
        mockFetchOffline();
        await registerCluster(makeClusterConfig('beta', 'http://beta:3000'));

        const health = getFederationHealth();
        expect(health.offlineClusters).toBeGreaterThanOrEqual(1);
        const offlineCluster = health.clusters.find(c => c.status === 'offline');
        expect(offlineCluster).toBeDefined();
    });
});

describe('Federated Capacity', () => {
    beforeEach(() => {
        _resetFederation();
        mockFetchOnline();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('getFederatedCapacity returns aggregate stats', async () => {
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        const capacity = getFederatedCapacity();
        expect(capacity).toHaveProperty('totalClusters');
        expect(capacity).toHaveProperty('onlineClusters');
        expect(capacity).toHaveProperty('totalGpus');
        expect(capacity).toHaveProperty('totalVramMb');
        expect(capacity).toHaveProperty('totalModelsLoaded');
        expect(capacity).toHaveProperty('uniqueModels');
        expect(capacity.totalClusters).toBe(1);
    });

    it('includes all clusters GPUs and VRAM', async () => {
        mockFetchOnline({ total_gpus: 4, total_vram_mb: 98304 });
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        await registerCluster(makeClusterConfig('beta', 'http://beta:3000'));

        const capacity = getFederatedCapacity();
        expect(capacity.totalGpus).toBe(8);
        expect(capacity.totalVramMb).toBe(196608);
        expect(capacity.clusters.length).toBe(2);
    });
});

describe('Model Replication', () => {
    beforeEach(() => {
        _resetFederation();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('getReplicationStatus returns empty initially', () => {
        const status = getReplicationStatus();
        expect(status).toEqual([]);
    });
});

describe('Reconciliation', () => {
    beforeEach(() => {
        _resetFederation();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        _resetFederation();
    });

    it('reconcileFederation returns reconciled count', async () => {
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha', 'http://alpha:3000'));
        const result = await reconcileFederation();
        expect(result).toHaveProperty('reconciled');
        expect(result).toHaveProperty('stillOffline');
        expect(result).toHaveProperty('modelsDiscovered');
        expect(typeof result.reconciled).toBe('number');
    });
});
