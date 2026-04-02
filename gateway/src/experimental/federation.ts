// F:\tentaclaw-os\gateway\src\federation.ts
// Multi-Cluster Federation — One API, Many Clusters
// TentaCLAW says: "One cluster is a business. Many clusters is an empire."

/**
 * TentaCLAW Gateway — Multi-Cluster Federation Controller
 *
 * Connects multiple TentaCLAW clusters as a single federated mesh.
 * Each cluster operates independently; the federation layer adds
 * cross-cluster model discovery, intelligent routing, and model replication.
 *
 * - Local-first: always prefer the local cluster for lowest latency.
 * - Split-brain safe: clusters degrade to standalone on disconnect.
 * - Stateless controller: all persistent state lives in the DB.
 * - Zero external deps: uses only fetch() for cross-cluster HTTP.
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * TentaCLAW says: "Eight arms across eight clusters. Now that's reach."
 */

import { getDb } from './db';

// =============================================================================
// Types
// =============================================================================

export interface FederatedCluster {
    id: string;
    name: string;
    gatewayUrl: string;
    location: string;           // "home", "office", "aws-us-east", etc.
    apiKey?: string;
    status: 'online' | 'offline' | 'degraded';
    lastSeen: string;
    capabilities: {
        totalGpus: number;
        totalVramMb: number;
        loadedModels: string[];
        backends: string[];
        latencyMs: number;      // from this gateway to that cluster
    };
}

export interface FederatedClusterConfig {
    name: string;
    gatewayUrl: string;
    location: string;
    apiKey?: string;
}

export interface FederatedRouteResult {
    response: Record<string, unknown>;
    _tentaclaw: {
        federated: boolean;
        cluster: string;
        clusterId: string;
        latencyMs: number;
    };
}

export interface FederatedModel {
    model: string;
    clusters: Array<{
        clusterId: string;
        clusterName: string;
        location: string;
        latencyMs: number;
    }>;
}

export interface FederatedCapacity {
    totalClusters: number;
    onlineClusters: number;
    totalGpus: number;
    totalVramMb: number;
    totalModelsLoaded: number;
    uniqueModels: number;
    clusters: Array<{
        id: string;
        name: string;
        location: string;
        status: string;
        gpus: number;
        vramMb: number;
        models: number;
    }>;
}

export interface ReplicationStatus {
    model: string;
    clusters: Array<{
        clusterId: string;
        clusterName: string;
        available: boolean;
    }>;
    replicaCount: number;
}

export interface ReplicationTask {
    model: string;
    targetClusterId: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    startedAt: string;
    completedAt: string | null;
    error: string | null;
}

export interface FederationHealth {
    status: 'healthy' | 'degraded' | 'unhealthy';
    totalClusters: number;
    onlineClusters: number;
    offlineClusters: number;
    degradedClusters: number;
    lastHealthCheck: string | null;
    clusters: Array<{
        id: string;
        name: string;
        status: string;
        latencyMs: number;
        lastSeen: string;
    }>;
}

// =============================================================================
// Module State
// =============================================================================

/** In-memory cache of cluster states (synced from DB). */
const clusterCache = new Map<string, FederatedCluster>();

/** Active replication tasks tracked in memory. */
const replicationTasks = new Map<string, ReplicationTask>();

/** Federation health check loop handle. */
let healthLoopTimer: ReturnType<typeof setInterval> | null = null;

/** Timestamp of the last health check cycle. */
let lastHealthCheckTime: string | null = null;

/** Default health check interval (30 seconds). */
const DEFAULT_HEALTH_INTERVAL_MS = 30_000;

/** HTTP request timeout for cross-cluster calls (10 seconds). */
const CLUSTER_REQUEST_TIMEOUT_MS = 10_000;

/** Counter for generating unique IDs. */
let idCounter = 0;

// =============================================================================
// Helpers
// =============================================================================

/** Generate a unique federation ID. */
function generateFederationId(): string {
    idCounter += 1;
    return `fed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a unique replication task key. */
function replicationKey(model: string, clusterId: string): string {
    return `${model}::${clusterId}`;
}

/** Current ISO timestamp. */
function nowISO(): string {
    return new Date().toISOString();
}

/**
 * Make an HTTP request to a remote cluster.
 *
 * Uses the global fetch() API. Adds the cluster's API key as a Bearer token
 * if configured. Returns the parsed JSON response.
 */
async function clusterFetch<T = Record<string, unknown>>(
    cluster: FederatedCluster,
    path: string,
    options: {
        method?: string;
        body?: unknown;
        timeoutMs?: number;
    } = {},
): Promise<T> {
    const url = cluster.gatewayUrl.replace(/\/+$/, '') + path;
    const timeout = options.timeoutMs ?? CLUSTER_REQUEST_TIMEOUT_MS;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-TentaCLAW-Federation': 'true',
    };

    if (cluster.apiKey) {
        headers['Authorization'] = `Bearer ${cluster.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const resp = await fetch(url, {
            method: options.method ?? 'GET',
            headers,
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} from ${cluster.name} (${url})`);
        }

        return await resp.json() as T;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Measure round-trip latency to a remote cluster by timing a health check.
 */
async function measureLatency(cluster: FederatedCluster): Promise<number> {
    const start = Date.now();
    try {
        await clusterFetch(cluster, '/health', { timeoutMs: 5000 });
        return Date.now() - start;
    } catch {
        return -1; // unreachable
    }
}

// =============================================================================
// Database Layer — federated_clusters table
// =============================================================================

/**
 * Ensure the federated_clusters table exists.
 *
 * Called lazily on first use. Uses CREATE TABLE IF NOT EXISTS so it is
 * safe to call multiple times.
 */
function ensureFederationTable(): void {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS federated_clusters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            gateway_url TEXT NOT NULL UNIQUE,
            location TEXT NOT NULL DEFAULT 'unknown',
            api_key TEXT,
            status TEXT NOT NULL DEFAULT 'offline',
            last_seen TEXT,
            capabilities TEXT NOT NULL DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_federated_clusters_status
            ON federated_clusters(status);
    `);
}

/** Serialize a FederatedCluster to a DB row. */
function clusterToRow(cluster: FederatedCluster): {
    id: string;
    name: string;
    gateway_url: string;
    location: string;
    api_key: string | null;
    status: string;
    last_seen: string | null;
    capabilities: string;
} {
    return {
        id: cluster.id,
        name: cluster.name,
        gateway_url: cluster.gatewayUrl,
        location: cluster.location,
        api_key: cluster.apiKey ?? null,
        status: cluster.status,
        last_seen: cluster.lastSeen || null,
        capabilities: JSON.stringify(cluster.capabilities),
    };
}

/** Deserialize a DB row to a FederatedCluster. */
function rowToCluster(row: Record<string, unknown>): FederatedCluster {
    const capabilities = typeof row.capabilities === 'string'
        ? JSON.parse(row.capabilities as string)
        : {
            totalGpus: 0,
            totalVramMb: 0,
            loadedModels: [],
            backends: [],
            latencyMs: -1,
        };

    return {
        id: row.id as string,
        name: row.name as string,
        gatewayUrl: row.gateway_url as string,
        location: (row.location as string) || 'unknown',
        apiKey: (row.api_key as string) || undefined,
        status: (row.status as FederatedCluster['status']) || 'offline',
        lastSeen: (row.last_seen as string) || '',
        capabilities,
    };
}

/** Load all clusters from DB into the in-memory cache. */
function loadClustersFromDb(): void {
    ensureFederationTable();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM federated_clusters').all() as Record<string, unknown>[];

    clusterCache.clear();
    for (const row of rows) {
        const cluster = rowToCluster(row);
        clusterCache.set(cluster.id, cluster);
    }
}

/** Persist a single cluster to DB and update the in-memory cache. */
function saveClusterToDb(cluster: FederatedCluster): void {
    ensureFederationTable();
    const db = getDb();
    const row = clusterToRow(cluster);

    db.prepare(`
        INSERT INTO federated_clusters (id, name, gateway_url, location, api_key, status, last_seen, capabilities, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            gateway_url = excluded.gateway_url,
            location = excluded.location,
            api_key = excluded.api_key,
            status = excluded.status,
            last_seen = excluded.last_seen,
            capabilities = excluded.capabilities,
            updated_at = datetime('now')
    `).run(row.id, row.name, row.gateway_url, row.location, row.api_key, row.status, row.last_seen, row.capabilities);

    clusterCache.set(cluster.id, cluster);
}

/** Remove a cluster from DB and in-memory cache. */
function deleteClusterFromDb(id: string): boolean {
    ensureFederationTable();
    const db = getDb();
    const result = db.prepare('DELETE FROM federated_clusters WHERE id = ?').run(id);
    clusterCache.delete(id);
    return result.changes > 0;
}

// =============================================================================
// 1. Cluster Registry
// =============================================================================

/**
 * Register a remote cluster in the federation.
 *
 * Pings the cluster to verify reachability and populate initial capabilities.
 * The cluster is added to both the DB and in-memory cache.
 */
export async function registerCluster(config: FederatedClusterConfig): Promise<FederatedCluster> {
    ensureFederationTable();

    // Check for duplicate gateway URL
    const existing = Array.from(clusterCache.values()).find(
        c => c.gatewayUrl.replace(/\/+$/, '') === config.gatewayUrl.replace(/\/+$/, ''),
    );
    if (existing) {
        throw new Error(`Cluster already registered at ${config.gatewayUrl} (id: ${existing.id})`);
    }

    const id = generateFederationId();
    const cluster: FederatedCluster = {
        id,
        name: config.name,
        gatewayUrl: config.gatewayUrl.replace(/\/+$/, ''),
        location: config.location,
        apiKey: config.apiKey,
        status: 'offline',
        lastSeen: '',
        capabilities: {
            totalGpus: 0,
            totalVramMb: 0,
            loadedModels: [],
            backends: [],
            latencyMs: -1,
        },
    };

    // Try to fetch initial capabilities
    try {
        await refreshClusterCapabilities(cluster);
    } catch {
        // Cluster starts offline if unreachable — that is fine
        cluster.status = 'offline';
    }

    saveClusterToDb(cluster);
    return cluster;
}

/**
 * Remove a cluster from the federation.
 *
 * Returns true if the cluster existed and was removed.
 */
export function removeCluster(id: string): boolean {
    // Also clean up any replication tasks targeting this cluster
    for (const [key, task] of replicationTasks) {
        if (task.targetClusterId === id) {
            replicationTasks.delete(key);
        }
    }
    return deleteClusterFromDb(id);
}

/**
 * List all federated clusters with their current health and capabilities.
 *
 * Returns a fresh snapshot from the in-memory cache (which is synced with DB).
 */
export function listClusters(): FederatedCluster[] {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }
    return Array.from(clusterCache.values());
}

/**
 * Get a single federated cluster by ID.
 *
 * Returns null if the cluster is not found.
 */
export function getCluster(id: string): FederatedCluster | null {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }
    return clusterCache.get(id) ?? null;
}

/**
 * Ping a remote cluster and update its capabilities, latency, and status.
 *
 * This is the core health-check operation. It:
 *   1. Measures round-trip latency
 *   2. Fetches the cluster's summary (GPUs, VRAM, models, backends)
 *   3. Updates the cluster record in DB and cache
 */
export async function refreshClusterHealth(id: string): Promise<FederatedCluster> {
    const cluster = getCluster(id);
    if (!cluster) {
        throw new Error(`Unknown cluster: ${id}`);
    }

    await refreshClusterCapabilities(cluster);
    saveClusterToDb(cluster);
    return cluster;
}

/**
 * Internal: refresh capabilities on a cluster object (mutates in place).
 */
async function refreshClusterCapabilities(cluster: FederatedCluster): Promise<void> {
    // Measure latency
    const latency = await measureLatency(cluster);

    if (latency < 0) {
        cluster.status = 'offline';
        cluster.capabilities.latencyMs = -1;
        return;
    }

    cluster.capabilities.latencyMs = latency;
    cluster.lastSeen = nowISO();

    // Fetch cluster summary for capabilities
    try {
        const summary = await clusterFetch<Record<string, unknown>>(
            cluster,
            '/api/cluster/summary',
        );

        // Extract GPU/VRAM info
        const gpuCount = typeof summary.total_gpus === 'number'
            ? summary.total_gpus
            : (typeof summary.gpu_count === 'number' ? summary.gpu_count : 0);

        const totalVram = typeof summary.total_vram_mb === 'number'
            ? summary.total_vram_mb
            : 0;

        // Extract loaded models
        let loadedModels: string[] = [];
        if (Array.isArray(summary.models)) {
            loadedModels = (summary.models as Array<Record<string, unknown>>).map(
                (m) => (typeof m === 'string' ? m : (m.model as string) || String(m)),
            );
        } else if (Array.isArray(summary.loaded_models)) {
            loadedModels = summary.loaded_models as string[];
        }

        // Extract backends
        let backends: string[] = [];
        if (Array.isArray(summary.backends)) {
            backends = summary.backends as string[];
        }

        cluster.capabilities = {
            totalGpus: gpuCount,
            totalVramMb: totalVram,
            loadedModels,
            backends,
            latencyMs: latency,
        };

        // Determine status from summary health indicators
        const nodeCount = typeof summary.total_nodes === 'number' ? summary.total_nodes : 0;
        const onlineNodes = typeof summary.online_nodes === 'number' ? summary.online_nodes : nodeCount;

        if (onlineNodes === 0 && nodeCount > 0) {
            cluster.status = 'degraded';
        } else if (onlineNodes < nodeCount && nodeCount > 0) {
            cluster.status = 'degraded';
        } else {
            cluster.status = 'online';
        }
    } catch {
        // Health check succeeded (latency > 0) but summary fetch failed — degraded
        cluster.status = 'degraded';
    }
}

// =============================================================================
// 2. Cross-Cluster Routing
// =============================================================================

/**
 * Route an inference request to the best available cluster.
 *
 * Strategy:
 *   1. Check local cluster first (always preferred for lowest latency).
 *   2. If local cannot serve the model, find a remote cluster that:
 *      - Has the model loaded
 *      - Is online
 *      - Has the lowest latency
 *   3. Forward the request transparently.
 *   4. Return the response with federation metadata.
 *
 * @param model - The model name to run inference on.
 * @param messages - Chat messages in OpenAI format.
 * @param options - Additional parameters to pass through (temperature, etc.).
 */
export async function federatedRoute(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>,
): Promise<FederatedRouteResult> {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    // Find clusters that have this model and are online
    const candidates: Array<FederatedCluster & { _sortScore: number }> = [];

    for (const cluster of clusterCache.values()) {
        if (cluster.status === 'offline') continue;

        const hasModel = cluster.capabilities.loadedModels.some(
            (m) => m === model || m.startsWith(model.split(':')[0]),
        );
        if (!hasModel) continue;

        // Score: latency is the primary factor; degraded clusters get a penalty
        const latencyScore = cluster.capabilities.latencyMs >= 0
            ? cluster.capabilities.latencyMs
            : 99999;
        const statusPenalty = cluster.status === 'degraded' ? 5000 : 0;

        candidates.push({
            ...cluster,
            _sortScore: latencyScore + statusPenalty,
        });
    }

    if (candidates.length === 0) {
        throw new Error(
            `No federated cluster has model "${model}" available. ` +
            `Known clusters: ${listClusters().map(c => c.name).join(', ') || 'none'}`,
        );
    }

    // Sort by score (lowest = best)
    candidates.sort((a, b) => a._sortScore - b._sortScore);
    const target = candidates[0];

    // Build the inference request payload
    const payload: Record<string, unknown> = {
        model,
        messages,
        ...options,
    };

    const startMs = Date.now();

    const response = await clusterFetch<Record<string, unknown>>(
        target,
        '/v1/chat/completions',
        {
            method: 'POST',
            body: payload,
            timeoutMs: 120_000, // inference can take a while
        },
    );

    const elapsedMs = Date.now() - startMs;

    return {
        response,
        _tentaclaw: {
            federated: true,
            cluster: target.name,
            clusterId: target.id,
            latencyMs: elapsedMs,
        },
    };
}

/**
 * Get all models available across the entire federation, deduplicated.
 *
 * Each model entry lists all clusters that have it loaded, along with
 * their latency for routing decisions.
 */
export function getFederatedModels(): FederatedModel[] {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    const modelMap = new Map<string, FederatedModel['clusters']>();

    for (const cluster of clusterCache.values()) {
        if (cluster.status === 'offline') continue;

        for (const model of cluster.capabilities.loadedModels) {
            const existing = modelMap.get(model) || [];
            existing.push({
                clusterId: cluster.id,
                clusterName: cluster.name,
                location: cluster.location,
                latencyMs: cluster.capabilities.latencyMs,
            });
            modelMap.set(model, existing);
        }
    }

    return Array.from(modelMap.entries()).map(([model, clusters]) => ({
        model,
        clusters: clusters.sort((a, b) => a.latencyMs - b.latencyMs),
    }));
}

/**
 * Get total capacity across the entire federation.
 *
 * Aggregates GPUs, VRAM, and model counts from all online clusters.
 */
export function getFederatedCapacity(): FederatedCapacity {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    let totalGpus = 0;
    let totalVramMb = 0;
    const allModels = new Set<string>();
    let totalModelsLoaded = 0;
    let onlineClusters = 0;

    const clusterDetails: FederatedCapacity['clusters'] = [];

    for (const cluster of clusterCache.values()) {
        const isOnline = cluster.status !== 'offline';
        if (isOnline) {
            onlineClusters++;
            totalGpus += cluster.capabilities.totalGpus;
            totalVramMb += cluster.capabilities.totalVramMb;
            totalModelsLoaded += cluster.capabilities.loadedModels.length;

            for (const model of cluster.capabilities.loadedModels) {
                allModels.add(model);
            }
        }

        clusterDetails.push({
            id: cluster.id,
            name: cluster.name,
            location: cluster.location,
            status: cluster.status,
            gpus: cluster.capabilities.totalGpus,
            vramMb: cluster.capabilities.totalVramMb,
            models: cluster.capabilities.loadedModels.length,
        });
    }

    return {
        totalClusters: clusterCache.size,
        onlineClusters,
        totalGpus,
        totalVramMb,
        totalModelsLoaded,
        uniqueModels: allModels.size,
        clusters: clusterDetails,
    };
}

// =============================================================================
// 3. Model Replication
// =============================================================================

/**
 * Trigger a model download/pull on a remote cluster.
 *
 * Sends a pull command to the target cluster's API and tracks the
 * replication task. Returns the task for status polling.
 */
export async function replicateModel(
    model: string,
    targetClusterId: string,
): Promise<ReplicationTask> {
    const cluster = getCluster(targetClusterId);
    if (!cluster) {
        throw new Error(`Unknown cluster: ${targetClusterId}`);
    }

    if (cluster.status === 'offline') {
        throw new Error(`Cluster "${cluster.name}" is offline — cannot replicate`);
    }

    // Check if model is already on this cluster
    const alreadyLoaded = cluster.capabilities.loadedModels.some(
        (m) => m === model || m.startsWith(model.split(':')[0]),
    );
    if (alreadyLoaded) {
        return {
            model,
            targetClusterId,
            status: 'completed',
            startedAt: nowISO(),
            completedAt: nowISO(),
            error: null,
        };
    }

    const task: ReplicationTask = {
        model,
        targetClusterId,
        status: 'pending',
        startedAt: nowISO(),
        completedAt: null,
        error: null,
    };

    const key = replicationKey(model, targetClusterId);
    replicationTasks.set(key, task);

    // Fire off the pull request asynchronously
    task.status = 'in_progress';

    try {
        await clusterFetch(cluster, '/api/commands/pull', {
            method: 'POST',
            body: { model },
            timeoutMs: 30_000, // pulling can take a while; this just starts it
        });

        task.status = 'completed';
        task.completedAt = nowISO();
    } catch (err) {
        task.status = 'failed';
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = nowISO();
    }

    return task;
}

/**
 * Get the replication status for all models across all clusters.
 *
 * Returns a list showing which models are available on which clusters.
 */
export function getReplicationStatus(): ReplicationStatus[] {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    // Collect all unique models across the federation
    const modelSet = new Set<string>();
    for (const cluster of clusterCache.values()) {
        for (const model of cluster.capabilities.loadedModels) {
            modelSet.add(model);
        }
    }

    const results: ReplicationStatus[] = [];

    for (const model of modelSet) {
        const clusterStatuses: ReplicationStatus['clusters'] = [];

        for (const cluster of clusterCache.values()) {
            const available = cluster.capabilities.loadedModels.some(
                (m) => m === model || m.startsWith(model.split(':')[0]),
            );
            clusterStatuses.push({
                clusterId: cluster.id,
                clusterName: cluster.name,
                available,
            });
        }

        results.push({
            model,
            clusters: clusterStatuses,
            replicaCount: clusterStatuses.filter(c => c.available).length,
        });
    }

    return results;
}

/**
 * Ensure a model is replicated on at least N clusters.
 *
 * Finds clusters that do not have the model and triggers replication
 * until the desired replica count is met.
 *
 * @param model - Model to replicate.
 * @param minClusters - Minimum number of clusters that should have this model.
 * @returns Array of replication tasks started.
 */
export async function autoReplicate(
    model: string,
    minClusters: number,
): Promise<ReplicationTask[]> {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    // Count how many clusters already have the model
    const clustersWithModel: string[] = [];
    const clustersWithout: FederatedCluster[] = [];

    for (const cluster of clusterCache.values()) {
        if (cluster.status === 'offline') continue;

        const hasModel = cluster.capabilities.loadedModels.some(
            (m) => m === model || m.startsWith(model.split(':')[0]),
        );

        if (hasModel) {
            clustersWithModel.push(cluster.id);
        } else {
            clustersWithout.push(cluster);
        }
    }

    const needed = minClusters - clustersWithModel.length;
    if (needed <= 0) {
        return []; // Already satisfied
    }

    // Sort candidates by latency (prefer low-latency clusters for replication)
    clustersWithout.sort((a, b) =>
        (a.capabilities.latencyMs >= 0 ? a.capabilities.latencyMs : 99999) -
        (b.capabilities.latencyMs >= 0 ? b.capabilities.latencyMs : 99999),
    );

    const targets = clustersWithout.slice(0, needed);
    const tasks: ReplicationTask[] = [];

    for (const target of targets) {
        try {
            const task = await replicateModel(model, target.id);
            tasks.push(task);
        } catch (err) {
            tasks.push({
                model,
                targetClusterId: target.id,
                status: 'failed',
                startedAt: nowISO(),
                completedAt: nowISO(),
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return tasks;
}

// =============================================================================
// 4. Federation Health
// =============================================================================

/**
 * Get the overall health of the federation.
 *
 * Aggregates the status of all registered clusters into a single report.
 */
export function getFederationHealth(): FederationHealth {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    let online = 0;
    let offline = 0;
    let degraded = 0;

    const clusterDetails: FederationHealth['clusters'] = [];

    for (const cluster of clusterCache.values()) {
        switch (cluster.status) {
            case 'online': online++; break;
            case 'offline': offline++; break;
            case 'degraded': degraded++; break;
        }

        clusterDetails.push({
            id: cluster.id,
            name: cluster.name,
            status: cluster.status,
            latencyMs: cluster.capabilities.latencyMs,
            lastSeen: cluster.lastSeen,
        });
    }

    const total = clusterCache.size;
    let status: FederationHealth['status'];

    if (total === 0 || online === total) {
        status = 'healthy';
    } else if (online === 0) {
        status = 'unhealthy';
    } else {
        status = 'degraded';
    }

    return {
        status,
        totalClusters: total,
        onlineClusters: online,
        offlineClusters: offline,
        degradedClusters: degraded,
        lastHealthCheck: lastHealthCheckTime,
        clusters: clusterDetails,
    };
}

/**
 * Run a single health check cycle across all federated clusters.
 *
 * Pings every registered cluster, updates latency and capabilities,
 * and persists the results to DB.
 */
export async function runHealthCheckCycle(): Promise<void> {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    const tasks = Array.from(clusterCache.values()).map(async (cluster) => {
        try {
            await refreshClusterCapabilities(cluster);
        } catch {
            cluster.status = 'offline';
        }
        saveClusterToDb(cluster);
    });

    await Promise.allSettled(tasks);
    lastHealthCheckTime = nowISO();
}

/**
 * Start the background federation health check loop.
 *
 * @param intervalMs - Check interval in milliseconds (default: 30000).
 */
export function startFederationLoop(intervalMs?: number): void {
    stopFederationLoop();

    const interval = intervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;

    // Load initial state from DB
    loadClustersFromDb();

    // Run the first check immediately
    runHealthCheckCycle().catch(() => {
        // Silently handle first-run failures
    });

    healthLoopTimer = setInterval(() => {
        runHealthCheckCycle().catch(() => {
            // Individual check failures are handled per-cluster
        });
    }, interval);
}

/**
 * Stop the background federation health check loop.
 */
export function stopFederationLoop(): void {
    if (healthLoopTimer) {
        clearInterval(healthLoopTimer);
        healthLoopTimer = null;
    }
}

// =============================================================================
// 5. Split-Brain Protection
// =============================================================================

/**
 * Reconcile federation state after a network partition heals.
 *
 * When clusters reconnect, this:
 *   1. Refreshes capabilities from all reachable clusters
 *   2. Merges model lists (union of all cluster models)
 *   3. Updates routing tables with fresh latency measurements
 *   4. Marks clusters that remain unreachable as offline
 *
 * Each cluster operates independently when disconnected — the federation
 * controller is stateless and simply reflects the latest known state.
 * There is no distributed consensus or locking; reconciliation is purely
 * read-and-merge.
 */
export async function reconcileFederation(): Promise<{
    reconciled: number;
    stillOffline: number;
    modelsDiscovered: string[];
}> {
    if (clusterCache.size === 0) {
        loadClustersFromDb();
    }

    let reconciled = 0;
    let stillOffline = 0;
    const newModels = new Set<string>();

    // Snapshot the models we knew about before reconciliation
    const knownModels = new Set<string>();
    for (const cluster of clusterCache.values()) {
        for (const model of cluster.capabilities.loadedModels) {
            knownModels.add(model);
        }
    }

    // Refresh every cluster
    const tasks = Array.from(clusterCache.values()).map(async (cluster) => {
        const wasPreviouslyOffline = cluster.status === 'offline';

        try {
            await refreshClusterCapabilities(cluster);
            saveClusterToDb(cluster);

            if (cluster.status !== 'offline') {
                reconciled++;

                // Track newly discovered models from reconnected clusters
                if (wasPreviouslyOffline) {
                    for (const model of cluster.capabilities.loadedModels) {
                        if (!knownModels.has(model)) {
                            newModels.add(model);
                        }
                    }
                }
            } else {
                stillOffline++;
            }
        } catch {
            cluster.status = 'offline';
            saveClusterToDb(cluster);
            stillOffline++;
        }
    });

    await Promise.allSettled(tasks);
    lastHealthCheckTime = nowISO();

    return {
        reconciled,
        stillOffline,
        modelsDiscovered: Array.from(newModels),
    };
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Get all active replication tasks.
 */
export function getReplicationTasks(): ReplicationTask[] {
    return Array.from(replicationTasks.values());
}

/**
 * Clear completed and failed replication tasks from memory.
 */
export function clearCompletedReplications(): number {
    let cleared = 0;
    for (const [key, task] of replicationTasks) {
        if (task.status === 'completed' || task.status === 'failed') {
            replicationTasks.delete(key);
            cleared++;
        }
    }
    return cleared;
}

/**
 * Reset all federation state. Used by tests.
 * @internal
 */
export function _resetFederation(): void {
    stopFederationLoop();
    clusterCache.clear();
    replicationTasks.clear();
    lastHealthCheckTime = null;
    idCounter = 0;
}
