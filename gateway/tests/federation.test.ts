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

import { getDb } from '../src/db';

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

/** Unique counter to generate distinct gateway URLs per test. */
let urlCounter = 0;

function uniqueUrl(name: string): string {
    urlCounter++;
    return `http://${name}-${urlCounter}:3000`;
}

function makeClusterConfig(name: string, extra: Partial<FederatedClusterConfig> = {}): FederatedClusterConfig {
    return {
        name,
        gatewayUrl: extra.gatewayUrl ?? uniqueUrl(name),
        location: extra.location ?? 'test-lab',
        apiKey: extra.apiKey,
    };
}

/** Fully reset federation state: in-memory cache AND the DB table. */
function fullReset() {
    _resetFederation();
    try {
        const db = getDb();
        db.prepare(`DELETE FROM federated_clusters`).run();
    } catch {
        // Table may not exist yet -- that is fine
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cluster Registry', () => {
    beforeEach(() => {
        fullReset();
        mockFetchOnline();
    });
    afterEach(() => {
        fullReset();
    });

    it('registerCluster adds a cluster', async () => {
        const cluster = await registerCluster(makeClusterConfig('alpha'));
        expect(cluster).toBeDefined();
        expect(cluster.id).toBeTruthy();
        expect(cluster.name).toBe('alpha');
    });

    it('listClusters returns all clusters', async () => {
        await registerCluster(makeClusterConfig('alpha'));
        await registerCluster(makeClusterConfig('beta'));
        const all = listClusters();
        expect(all.length).toBe(2);
        expect(all.map(c => c.name).sort()).toEqual(['alpha', 'beta']);
    });

    it('removeCluster removes by id', async () => {
        const cluster = await registerCluster(makeClusterConfig('gamma'));
        expect(removeCluster(cluster.id)).toBe(true);
        expect(getCluster(cluster.id)).toBeNull();
        expect(listClusters().length).toBe(0);
    });

    it('getCluster returns single cluster', async () => {
        const cluster = await registerCluster(makeClusterConfig('delta'));
        const found = getCluster(cluster.id);
        expect(found).not.toBeNull();
        expect(found!.name).toBe('delta');
    });

    it('cluster has required fields (id, name, gatewayUrl, status)', async () => {
        const cluster = await registerCluster(makeClusterConfig('echo'));
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
        fullReset();
        mockFetchOnline();
    });
    afterEach(() => {
        fullReset();
    });

    it('getFederatedModels returns empty initially', () => {
        const models = getFederatedModels();
        expect(models).toEqual([]);
    });

    it('after registering cluster with models, returns combined list', async () => {
        await registerCluster(makeClusterConfig('alpha'));
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
        await registerCluster(makeClusterConfig('alpha'));
        await registerCluster(makeClusterConfig('beta'));
        const models = getFederatedModels();
        // Same model should appear once but with two cluster entries
        const llamaEntry = models.find(m => m.model === 'llama3.1:8b');
        expect(llamaEntry).toBeDefined();
        expect(llamaEntry!.clusters.length).toBe(2);
    });
});

describe('Federation Health', () => {
    beforeEach(() => {
        fullReset();
    });
    afterEach(() => {
        fullReset();
    });

    it('getFederationHealth returns status', async () => {
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha'));
        const health = getFederationHealth();
        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('totalClusters');
        expect(health).toHaveProperty('onlineClusters');
        expect(health).toHaveProperty('offlineClusters');
        expect(health).toHaveProperty('clusters');
        expect(health.totalClusters).toBe(1);
    });

    it('offline clusters are marked', async () => {
        // Register an online cluster first
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha'));

        // Register an offline cluster
        mockFetchOffline();
        await registerCluster(makeClusterConfig('beta'));

        const health = getFederationHealth();
        expect(health.offlineClusters).toBeGreaterThanOrEqual(1);
        const offlineCluster = health.clusters.find(c => c.status === 'offline');
        expect(offlineCluster).toBeDefined();
    });
});

describe('Federated Capacity', () => {
    beforeEach(() => {
        fullReset();
        mockFetchOnline();
    });
    afterEach(() => {
        fullReset();
    });

    it('getFederatedCapacity returns aggregate stats', async () => {
        await registerCluster(makeClusterConfig('alpha'));
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
        await registerCluster(makeClusterConfig('alpha'));
        await registerCluster(makeClusterConfig('beta'));

        const capacity = getFederatedCapacity();
        expect(capacity.totalGpus).toBe(8);
        expect(capacity.totalVramMb).toBe(196608);
        expect(capacity.clusters.length).toBe(2);
    });
});

describe('Model Replication', () => {
    beforeEach(() => {
        fullReset();
    });
    afterEach(() => {
        fullReset();
    });

    it('getReplicationStatus returns empty initially', () => {
        const status = getReplicationStatus();
        expect(status).toEqual([]);
    });

    it('getReplicationStatus lists models after cluster registration', async () => {
        mockFetchOnline({ models: ['llama3.1:8b'] });
        await registerCluster(makeClusterConfig('alpha'));
        const status = getReplicationStatus();
        expect(status.length).toBe(1);
        expect(status[0].model).toBe('llama3.1:8b');
        expect(status[0].replicaCount).toBe(1);
    });

    it('replicaCount reflects number of clusters with model', async () => {
        mockFetchOnline({ models: ['llama3.1:8b'] });
        await registerCluster(makeClusterConfig('alpha'));
        await registerCluster(makeClusterConfig('beta'));
        const status = getReplicationStatus();
        const llama = status.find(s => s.model === 'llama3.1:8b');
        expect(llama).toBeDefined();
        expect(llama!.replicaCount).toBe(2);
        expect(llama!.clusters.length).toBe(2);
    });
});

describe('Reconciliation', () => {
    beforeEach(() => {
        fullReset();
    });
    afterEach(() => {
        fullReset();
    });

    it('reconcileFederation returns reconciled count', async () => {
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha'));
        const result = await reconcileFederation();
        expect(result).toHaveProperty('reconciled');
        expect(result).toHaveProperty('stillOffline');
        expect(result).toHaveProperty('modelsDiscovered');
        expect(typeof result.reconciled).toBe('number');
    });

    it('reconcileFederation marks offline clusters as stillOffline', async () => {
        // Register while online, then switch mock to offline before reconciliation
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alpha'));
        mockFetchOffline();
        const result = await reconcileFederation();
        expect(result.stillOffline).toBeGreaterThanOrEqual(1);
    });

    it('reconcileFederation handles empty federation gracefully', async () => {
        const result = await reconcileFederation();
        expect(result.reconciled).toBe(0);
        expect(result.stillOffline).toBe(0);
        expect(result.modelsDiscovered).toEqual([]);
    });
});

describe('Cluster Registry Edge Cases', () => {
    beforeEach(() => {
        fullReset();
        mockFetchOnline();
    });
    afterEach(() => {
        fullReset();
    });

    it('removeCluster returns false for nonexistent id', () => {
        expect(removeCluster('nonexistent-id')).toBe(false);
    });

    it('getCluster returns null for nonexistent id', () => {
        expect(getCluster('nonexistent-id')).toBeNull();
    });

    it('cluster location is preserved', async () => {
        const cluster = await registerCluster(makeClusterConfig('loc-test', { location: 'aws-us-east-1' }));
        expect(cluster.location).toBe('aws-us-east-1');
    });

    it('cluster capabilities are populated from mock fetch', async () => {
        mockFetchOnline({ total_gpus: 8, total_vram_mb: 196608, models: ['mixtral:8x7b'] });
        const cluster = await registerCluster(makeClusterConfig('cap-test'));
        expect(cluster.capabilities.totalGpus).toBe(8);
        expect(cluster.capabilities.totalVramMb).toBe(196608);
        expect(cluster.capabilities.loadedModels).toContain('mixtral:8x7b');
    });

    it('offline cluster starts with status offline', async () => {
        mockFetchOffline();
        const cluster = await registerCluster(makeClusterConfig('offline-start'));
        expect(cluster.status).toBe('offline');
    });

    it('listClusters returns empty for clean state', () => {
        const clusters = listClusters();
        expect(clusters).toEqual([]);
    });
});

describe('Federation Health Edge Cases', () => {
    beforeEach(() => {
        fullReset();
    });
    afterEach(() => {
        fullReset();
    });

    it('health is healthy when no clusters exist', () => {
        const health = getFederationHealth();
        expect(health.status).toBe('healthy');
        expect(health.totalClusters).toBe(0);
    });

    it('health is unhealthy when all clusters are offline', async () => {
        mockFetchOffline();
        await registerCluster(makeClusterConfig('dead-a'));
        await registerCluster(makeClusterConfig('dead-b'));
        const health = getFederationHealth();
        expect(health.status).toBe('unhealthy');
        expect(health.offlineClusters).toBe(2);
    });

    it('health is degraded when mix of online and offline', async () => {
        mockFetchOnline();
        await registerCluster(makeClusterConfig('alive'));
        mockFetchOffline();
        await registerCluster(makeClusterConfig('dead'));
        const health = getFederationHealth();
        expect(health.status).toBe('degraded');
    });
});

describe('Federated Capacity Edge Cases', () => {
    beforeEach(() => {
        fullReset();
    });
    afterEach(() => {
        fullReset();
    });

    it('capacity is zero with no clusters', () => {
        const capacity = getFederatedCapacity();
        expect(capacity.totalClusters).toBe(0);
        expect(capacity.totalGpus).toBe(0);
        expect(capacity.totalVramMb).toBe(0);
    });

    it('offline clusters do not contribute to GPU/VRAM totals', async () => {
        mockFetchOffline();
        await registerCluster(makeClusterConfig('offline-gpu'));
        const capacity = getFederatedCapacity();
        expect(capacity.totalGpus).toBe(0);
        expect(capacity.totalVramMb).toBe(0);
    });

    it('uniqueModels counts distinct models across clusters', async () => {
        mockFetchOnline({ models: ['llama3.1:8b', 'hermes3:8b'] });
        await registerCluster(makeClusterConfig('alpha'));
        await registerCluster(makeClusterConfig('beta'));
        const capacity = getFederatedCapacity();
        // Both clusters have same 2 models, so unique should be 2
        expect(capacity.uniqueModels).toBe(2);
        // Total loaded = 2 models * 2 clusters = 4
        expect(capacity.totalModelsLoaded).toBe(4);
    });
});
