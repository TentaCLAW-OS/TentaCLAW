// F:\tentaclaw-os\gateway\src\cloud.ts
// TentaCLAW Cloud — Managed Gateway as a Service
// TentaCLAW says: "Your GPUs, my brain in the cloud. Best of both worlds."

/**
 * TentaCLAW Gateway — Cloud-Hosted Gateway Management Layer
 *
 * Users connect their GPU nodes to a cloud-managed gateway at
 * cluster-name.cloud.tentaclaw.io. The gateway handles orchestration,
 * routing, and observability while GPUs stay on the user's hardware.
 *
 * Plans: free (hobby), pro (team), enterprise (org).
 * Tables: cloud_clusters, cloud_usage, cloud_node_tokens.
 */

import { getDb } from './db';
import { createHash, randomBytes } from 'crypto';

// =============================================================================
// Types
// =============================================================================

export interface CloudCluster {
    id: string;
    ownerId: string;
    name: string;
    subdomain: string;          // cluster-name.cloud.tentaclaw.io
    plan: 'free' | 'pro' | 'enterprise';
    status: 'active' | 'suspended' | 'deleted';
    nodes: number;
    gpus: number;
    vramMb: number;
    createdAt: string;
    lastActiveAt: string;
    config: {
        region: string;
        customDomain?: string;
        ssoEnabled: boolean;
        maxNodes: number;
    };
    usage: {
        requestsThisMonth: number;
        tokensThisMonth: number;
        gpuHoursThisMonth: number;
    };
}

export type CloudPlan = 'free' | 'pro' | 'enterprise';
export type CloudClusterStatus = 'active' | 'suspended' | 'deleted';

export interface CloudClusterConfig {
    region?: string;
    customDomain?: string;
    ssoEnabled?: boolean;
    maxNodes?: number;
}

export interface CloudUsageMetrics {
    requests?: number;
    tokens?: number;
    gpuHours?: number;
}

export interface CloudUsageReport {
    clusterId: string;
    period: string;
    requests: number;
    tokens: number;
    gpuHours: number;
    updatedAt: string;
}

export interface CloudBillingReport {
    clusterId: string;
    plan: CloudPlan;
    period: string;
    usage: {
        requests: number;
        tokens: number;
        gpuHours: number;
    };
    limits: PlanLimits;
    overages: {
        requests: number;
        tokens: number;
    };
    estimatedCostUsd: number;
}

export interface CloudNodeToken {
    id: string;
    clusterId: string;
    tokenHash: string;
    tokenPrefix: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    revoked: boolean;
}

export interface ConnectedNode {
    tokenId: string;
    label: string;
    lastUsedAt: string | null;
}

export interface CloudDashboard {
    ownerId: string;
    clusters: CloudCluster[];
    totals: {
        clusters: number;
        nodes: number;
        gpus: number;
        vramMb: number;
        requestsThisMonth: number;
        tokensThisMonth: number;
    };
}

export interface CloudPlatformStats {
    totalClusters: number;
    activeClusters: number;
    totalNodes: number;
    totalGpus: number;
    totalVramMb: number;
    requestsThisMonth: number;
    tokensThisMonth: number;
}

// =============================================================================
// Plan Limits
// =============================================================================

export interface PlanLimits {
    maxNodes: number;
    maxGpus: number;
    maxRequests: number;
    customDomain: boolean;
    sso: boolean;
    support: 'community' | 'email' | 'dedicated';
}

export const PLAN_LIMITS: Record<CloudPlan, PlanLimits> = {
    free: { maxNodes: 3, maxGpus: 6, maxRequests: 10000, customDomain: false, sso: false, support: 'community' },
    pro: { maxNodes: 20, maxGpus: 50, maxRequests: 100000, customDomain: true, sso: true, support: 'email' },
    enterprise: { maxNodes: 1000, maxGpus: 5000, maxRequests: Infinity, customDomain: true, sso: true, support: 'dedicated' },
};

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

// =============================================================================
// Schema Bootstrap
// =============================================================================

/**
 * Ensure the cloud tables exist. Called from gateway boot or migration.
 */
export function ensureCloudSchema(): void {
    const d = getDb();
    d.exec(`
        CREATE TABLE IF NOT EXISTS cloud_clusters (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            subdomain TEXT NOT NULL UNIQUE,
            plan TEXT NOT NULL DEFAULT 'free',
            status TEXT NOT NULL DEFAULT 'active',
            nodes INTEGER DEFAULT 0,
            gpus INTEGER DEFAULT 0,
            vram_mb INTEGER DEFAULT 0,
            region TEXT DEFAULT 'us-east-1',
            custom_domain TEXT,
            sso_enabled INTEGER DEFAULT 0,
            max_nodes INTEGER DEFAULT 3,
            created_at TEXT DEFAULT (datetime('now')),
            last_active_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_cloud_clusters_owner ON cloud_clusters(owner_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_clusters_subdomain ON cloud_clusters(subdomain);

        CREATE TABLE IF NOT EXISTS cloud_usage (
            id TEXT PRIMARY KEY,
            cluster_id TEXT NOT NULL REFERENCES cloud_clusters(id) ON DELETE CASCADE,
            period TEXT NOT NULL,
            requests INTEGER DEFAULT 0,
            tokens INTEGER DEFAULT 0,
            gpu_hours REAL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_cloud_usage_cluster_period ON cloud_usage(cluster_id, period);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_usage_unique ON cloud_usage(cluster_id, period);

        CREATE TABLE IF NOT EXISTS cloud_node_tokens (
            id TEXT PRIMARY KEY,
            cluster_id TEXT NOT NULL REFERENCES cloud_clusters(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            last_used_at TEXT,
            revoked INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_cloud_node_tokens_cluster ON cloud_node_tokens(cluster_id);
        CREATE INDEX IF NOT EXISTS idx_cloud_node_tokens_hash ON cloud_node_tokens(token_hash);
    `);
}

// =============================================================================
// Cluster Registration
// =============================================================================

/**
 * Create a new managed cloud cluster.
 * Generates a unique subdomain from the name.
 */
export function createCloudCluster(
    ownerId: string,
    name: string,
    plan: CloudPlan = 'free',
): CloudCluster {
    const d = getDb();
    ensureCloudSchema();

    if (!name || name.length < 2 || name.length > 63) {
        throw new Error('Cluster name must be between 2 and 63 characters.');
    }

    const id = generateId();
    const subdomain = slugify(name);

    if (!subdomain) {
        throw new Error('Cluster name must produce a valid subdomain (lowercase alphanumeric with hyphens).');
    }

    // Ensure subdomain uniqueness
    const existing = d.prepare('SELECT id FROM cloud_clusters WHERE subdomain = ?').get(subdomain);
    if (existing) {
        throw new Error(`Subdomain "${subdomain}" is already taken. Choose a different cluster name.`);
    }

    const limits = PLAN_LIMITS[plan];
    const now = nowIso();

    d.prepare(`
        INSERT INTO cloud_clusters (id, owner_id, name, subdomain, plan, status, nodes, gpus, vram_mb, region, sso_enabled, max_nodes, created_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, 'active', 0, 0, 0, 'us-east-1', 0, ?, ?, ?)
    `).run(id, ownerId, name, subdomain, plan, limits.maxNodes, now, now);

    return {
        id,
        ownerId,
        name,
        subdomain,
        plan,
        status: 'active',
        nodes: 0,
        gpus: 0,
        vramMb: 0,
        createdAt: now,
        lastActiveAt: now,
        config: {
            region: 'us-east-1',
            ssoEnabled: false,
            maxNodes: limits.maxNodes,
        },
        usage: {
            requestsThisMonth: 0,
            tokensThisMonth: 0,
            gpuHoursThisMonth: 0,
        },
    };
}

/**
 * Get cluster details by ID.
 */
export function getCloudCluster(id: string): CloudCluster | null {
    const d = getDb();
    ensureCloudSchema();

    const row = d.prepare('SELECT * FROM cloud_clusters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return rowToCluster(d, row);
}

/**
 * List all clusters, optionally filtered by owner.
 */
export function listCloudClusters(ownerId?: string): CloudCluster[] {
    const d = getDb();
    ensureCloudSchema();

    let rows: Record<string, unknown>[];
    if (ownerId) {
        rows = d.prepare(
            "SELECT * FROM cloud_clusters WHERE owner_id = ? AND status != 'deleted' ORDER BY created_at DESC",
        ).all(ownerId) as Record<string, unknown>[];
    } else {
        rows = d.prepare(
            "SELECT * FROM cloud_clusters WHERE status != 'deleted' ORDER BY created_at DESC",
        ).all() as Record<string, unknown>[];
    }

    return rows.map(row => rowToCluster(d, row));
}

/**
 * Soft-delete a cluster (sets status to 'deleted').
 */
export function deleteCloudCluster(id: string): boolean {
    const d = getDb();
    ensureCloudSchema();

    const now = nowIso();
    const result = d.prepare(
        "UPDATE cloud_clusters SET status = 'deleted', last_active_at = ? WHERE id = ? AND status != 'deleted'",
    ).run(now, id);

    if (result.changes > 0) {
        // Revoke all tokens for this cluster
        d.prepare(
            'UPDATE cloud_node_tokens SET revoked = 1 WHERE cluster_id = ?',
        ).run(id);
    }

    return result.changes > 0;
}

/**
 * Update cluster configuration.
 */
export function updateCloudCluster(id: string, config: CloudClusterConfig): CloudCluster | null {
    const d = getDb();
    ensureCloudSchema();

    const existing = d.prepare('SELECT * FROM cloud_clusters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return null;

    const plan = existing.plan as CloudPlan;
    const limits = PLAN_LIMITS[plan];

    // Validate plan-restricted features
    if (config.customDomain && !limits.customDomain) {
        throw new Error(`Custom domains are not available on the "${plan}" plan. Upgrade to pro or enterprise.`);
    }
    if (config.ssoEnabled && !limits.sso) {
        throw new Error(`SSO is not available on the "${plan}" plan. Upgrade to pro or enterprise.`);
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (config.region !== undefined) {
        updates.push('region = ?');
        params.push(config.region);
    }
    if (config.customDomain !== undefined) {
        updates.push('custom_domain = ?');
        params.push(config.customDomain || null);
    }
    if (config.ssoEnabled !== undefined) {
        updates.push('sso_enabled = ?');
        params.push(config.ssoEnabled ? 1 : 0);
    }
    if (config.maxNodes !== undefined) {
        if (config.maxNodes > limits.maxNodes) {
            throw new Error(`Max nodes for "${plan}" plan is ${limits.maxNodes}. Requested ${config.maxNodes}.`);
        }
        updates.push('max_nodes = ?');
        params.push(config.maxNodes);
    }

    if (updates.length === 0) {
        return getCloudCluster(id);
    }

    updates.push('last_active_at = ?');
    params.push(nowIso());
    params.push(id);

    d.prepare(`UPDATE cloud_clusters SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return getCloudCluster(id);
}

/**
 * Resolve a subdomain to its cluster.
 */
export function getCloudClusterBySubdomain(subdomain: string): CloudCluster | null {
    const d = getDb();
    ensureCloudSchema();

    const row = d.prepare(
        "SELECT * FROM cloud_clusters WHERE subdomain = ? AND status != 'deleted'",
    ).get(subdomain) as Record<string, unknown> | undefined;

    if (!row) return null;
    return rowToCluster(d, row);
}

// =============================================================================
// Plan Limits
// =============================================================================

/**
 * Check if a cluster is within its plan limit for a given resource.
 * Returns { allowed, reason? }.
 */
export function checkPlanLimit(
    clusterId: string,
    resource: 'nodes' | 'gpus' | 'requests',
): { allowed: boolean; reason?: string } {
    const d = getDb();
    ensureCloudSchema();

    const row = d.prepare('SELECT * FROM cloud_clusters WHERE id = ?').get(clusterId) as Record<string, unknown> | undefined;
    if (!row) return { allowed: false, reason: 'Cluster not found.' };

    const plan = row.plan as CloudPlan;
    const limits = PLAN_LIMITS[plan];

    switch (resource) {
        case 'nodes': {
            const currentNodes = row.nodes as number;
            if (currentNodes >= limits.maxNodes) {
                return { allowed: false, reason: `Node limit reached: ${currentNodes}/${limits.maxNodes} (${plan} plan).` };
            }
            return { allowed: true };
        }
        case 'gpus': {
            const currentGpus = row.gpus as number;
            if (currentGpus >= limits.maxGpus) {
                return { allowed: false, reason: `GPU limit reached: ${currentGpus}/${limits.maxGpus} (${plan} plan).` };
            }
            return { allowed: true };
        }
        case 'requests': {
            const period = currentPeriod();
            const usageRow = d.prepare(
                'SELECT requests FROM cloud_usage WHERE cluster_id = ? AND period = ?',
            ).get(clusterId, period) as { requests: number } | undefined;
            const currentRequests = usageRow?.requests ?? 0;
            if (limits.maxRequests !== Infinity && currentRequests >= limits.maxRequests) {
                return { allowed: false, reason: `Monthly request limit reached: ${currentRequests}/${limits.maxRequests} (${plan} plan).` };
            }
            return { allowed: true };
        }
        default:
            return { allowed: false, reason: `Unknown resource type: ${resource as string}` };
    }
}

/**
 * Get current usage vs plan limits for a cluster.
 */
export function getPlanUsage(clusterId: string): {
    plan: CloudPlan;
    limits: PlanLimits;
    current: { nodes: number; gpus: number; requests: number; tokens: number; gpuHours: number };
    remaining: { nodes: number; gpus: number; requests: number };
} | null {
    const d = getDb();
    ensureCloudSchema();

    const row = d.prepare('SELECT * FROM cloud_clusters WHERE id = ?').get(clusterId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const plan = row.plan as CloudPlan;
    const limits = PLAN_LIMITS[plan];
    const period = currentPeriod();

    const usageRow = d.prepare(
        'SELECT requests, tokens, gpu_hours FROM cloud_usage WHERE cluster_id = ? AND period = ?',
    ).get(clusterId, period) as { requests: number; tokens: number; gpu_hours: number } | undefined;

    const currentNodes = row.nodes as number;
    const currentGpus = row.gpus as number;
    const currentRequests = usageRow?.requests ?? 0;
    const currentTokens = usageRow?.tokens ?? 0;
    const currentGpuHours = usageRow?.gpu_hours ?? 0;

    return {
        plan,
        limits,
        current: {
            nodes: currentNodes,
            gpus: currentGpus,
            requests: currentRequests,
            tokens: currentTokens,
            gpuHours: currentGpuHours,
        },
        remaining: {
            nodes: Math.max(0, limits.maxNodes - currentNodes),
            gpus: Math.max(0, limits.maxGpus - currentGpus),
            requests: limits.maxRequests === Infinity
                ? Infinity
                : Math.max(0, limits.maxRequests - currentRequests),
        },
    };
}

// =============================================================================
// Usage Tracking
// =============================================================================

/**
 * Record usage metrics for a cluster (typically called per-request or in batch).
 */
export function recordCloudUsage(clusterId: string, metrics: CloudUsageMetrics): void {
    const d = getDb();
    ensureCloudSchema();

    const cluster = d.prepare('SELECT id FROM cloud_clusters WHERE id = ?').get(clusterId);
    if (!cluster) {
        throw new Error(`Cloud cluster "${clusterId}" not found.`);
    }

    const period = currentPeriod();

    const existing = d.prepare(
        'SELECT id FROM cloud_usage WHERE cluster_id = ? AND period = ?',
    ).get(clusterId, period) as { id: string } | undefined;

    if (existing) {
        d.prepare(`
            UPDATE cloud_usage SET
                requests = requests + ?,
                tokens = tokens + ?,
                gpu_hours = gpu_hours + ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            metrics.requests ?? 0,
            metrics.tokens ?? 0,
            metrics.gpuHours ?? 0,
            nowIso(),
            existing.id,
        );
    } else {
        d.prepare(`
            INSERT INTO cloud_usage (id, cluster_id, period, requests, tokens, gpu_hours, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            generateId(),
            clusterId,
            period,
            metrics.requests ?? 0,
            metrics.tokens ?? 0,
            metrics.gpuHours ?? 0,
            nowIso(),
        );
    }

    // Update cluster last_active_at
    d.prepare('UPDATE cloud_clusters SET last_active_at = ? WHERE id = ?').run(nowIso(), clusterId);
}

/**
 * Get usage report for a cluster in a given billing period.
 */
export function getCloudUsage(clusterId: string, period?: string): CloudUsageReport {
    const d = getDb();
    ensureCloudSchema();

    const p = period ?? currentPeriod();

    const row = d.prepare(
        'SELECT requests, tokens, gpu_hours, updated_at FROM cloud_usage WHERE cluster_id = ? AND period = ?',
    ).get(clusterId, p) as { requests: number; tokens: number; gpu_hours: number; updated_at: string } | undefined;

    return {
        clusterId,
        period: p,
        requests: row?.requests ?? 0,
        tokens: row?.tokens ?? 0,
        gpuHours: row?.gpu_hours ?? 0,
        updatedAt: row?.updated_at ?? nowIso(),
    };
}

/**
 * Get estimated billing based on plan + overages.
 *
 * Pricing model (simplified):
 * - Free:       $0 base, hard limits, no overages
 * - Pro:        $49/mo base, $0.005/request over limit, $0.001/1k tokens over
 * - Enterprise: custom pricing, no hard limits
 */
export function getCloudBilling(clusterId: string): CloudBillingReport | null {
    const d = getDb();
    ensureCloudSchema();

    const clusterRow = d.prepare('SELECT * FROM cloud_clusters WHERE id = ?').get(clusterId) as Record<string, unknown> | undefined;
    if (!clusterRow) return null;

    const plan = clusterRow.plan as CloudPlan;
    const limits = PLAN_LIMITS[plan];
    const period = currentPeriod();

    const usageRow = d.prepare(
        'SELECT requests, tokens, gpu_hours FROM cloud_usage WHERE cluster_id = ? AND period = ?',
    ).get(clusterId, period) as { requests: number; tokens: number; gpu_hours: number } | undefined;

    const requests = usageRow?.requests ?? 0;
    const tokens = usageRow?.tokens ?? 0;
    const gpuHours = usageRow?.gpu_hours ?? 0;

    // Calculate overages
    const overageRequests = limits.maxRequests === Infinity
        ? 0
        : Math.max(0, requests - limits.maxRequests);
    const overageTokens = 0; // Tokens not directly capped per plan, overages come from requests

    // Estimate cost
    let estimatedCost = 0;
    switch (plan) {
        case 'free':
            estimatedCost = 0;
            break;
        case 'pro':
            estimatedCost = 49.0; // base
            estimatedCost += overageRequests * 0.005;
            break;
        case 'enterprise':
            // Custom pricing — placeholder
            estimatedCost = 499.0; // base
            estimatedCost += gpuHours * 0.50;
            break;
    }

    return {
        clusterId,
        plan,
        period,
        usage: { requests, tokens, gpuHours },
        limits,
        overages: { requests: overageRequests, tokens: overageTokens },
        estimatedCostUsd: Math.round(estimatedCost * 100) / 100,
    };
}

// =============================================================================
// Node Connection Tokens
// =============================================================================

/**
 * Generate a bearer token for an agent node to connect to this cloud cluster.
 * Returns the raw token (shown once) and the stored metadata.
 */
export function generateNodeToken(
    clusterId: string,
    label: string = '',
): { token: string; metadata: CloudNodeToken } {
    const d = getDb();
    ensureCloudSchema();

    const cluster = d.prepare('SELECT id, plan FROM cloud_clusters WHERE id = ?').get(clusterId) as { id: string; plan: string } | undefined;
    if (!cluster) {
        throw new Error(`Cloud cluster "${clusterId}" not found.`);
    }

    const rawToken = `tc_${randomBytes(32).toString('hex')}`;
    const tokenH = hashToken(rawToken);
    const prefix = rawToken.slice(0, 10);
    const id = generateId();
    const now = nowIso();

    d.prepare(`
        INSERT INTO cloud_node_tokens (id, cluster_id, token_hash, token_prefix, label, created_at, revoked)
        VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(id, clusterId, tokenH, prefix, label, now);

    return {
        token: rawToken,
        metadata: {
            id,
            clusterId,
            tokenHash: tokenH,
            tokenPrefix: prefix,
            label,
            createdAt: now,
            lastUsedAt: null,
            revoked: false,
        },
    };
}

/**
 * Validate a node connection token.
 * Returns the cluster ID if valid, null if invalid/revoked.
 */
export function validateNodeToken(token: string): { clusterId: string; tokenId: string } | null {
    const d = getDb();
    ensureCloudSchema();

    const tokenH = hashToken(token);

    const row = d.prepare(`
        SELECT t.id, t.cluster_id, c.status as cluster_status
        FROM cloud_node_tokens t
        JOIN cloud_clusters c ON c.id = t.cluster_id
        WHERE t.token_hash = ? AND t.revoked = 0 AND c.status = 'active'
    `).get(tokenH) as { id: string; cluster_id: string; cluster_status: string } | undefined;

    if (!row) return null;

    // Update last_used_at
    d.prepare('UPDATE cloud_node_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);

    return { clusterId: row.cluster_id, tokenId: row.id };
}

/**
 * List nodes connected to a cloud cluster (based on tokens that have been used).
 */
export function getConnectedNodes(clusterId: string): ConnectedNode[] {
    const d = getDb();
    ensureCloudSchema();

    const rows = d.prepare(`
        SELECT id, label, last_used_at
        FROM cloud_node_tokens
        WHERE cluster_id = ? AND revoked = 0 AND last_used_at IS NOT NULL
        ORDER BY last_used_at DESC
    `).all(clusterId) as Array<{ id: string; label: string; last_used_at: string | null }>;

    return rows.map(r => ({
        tokenId: r.id,
        label: r.label,
        lastUsedAt: r.last_used_at,
    }));
}

// =============================================================================
// Cloud Dashboard Data
// =============================================================================

/**
 * Get all clusters for an owner with summary stats.
 */
export function getCloudDashboard(ownerId: string): CloudDashboard {
    const clusters = listCloudClusters(ownerId);

    let totalNodes = 0;
    let totalGpus = 0;
    let totalVramMb = 0;
    let totalRequests = 0;
    let totalTokens = 0;

    for (const c of clusters) {
        totalNodes += c.nodes;
        totalGpus += c.gpus;
        totalVramMb += c.vramMb;
        totalRequests += c.usage.requestsThisMonth;
        totalTokens += c.usage.tokensThisMonth;
    }

    return {
        ownerId,
        clusters,
        totals: {
            clusters: clusters.length,
            nodes: totalNodes,
            gpus: totalGpus,
            vramMb: totalVramMb,
            requestsThisMonth: totalRequests,
            tokensThisMonth: totalTokens,
        },
    };
}

/**
 * Get global cloud platform stats (admin/ops view).
 */
export function getCloudStats(): CloudPlatformStats {
    const d = getDb();
    ensureCloudSchema();

    const period = currentPeriod();

    const clusterRow = d.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            COALESCE(SUM(nodes), 0) as total_nodes,
            COALESCE(SUM(gpus), 0) as total_gpus,
            COALESCE(SUM(vram_mb), 0) as total_vram_mb
        FROM cloud_clusters
        WHERE status != 'deleted'
    `).get() as {
        total: number;
        active: number;
        total_nodes: number;
        total_gpus: number;
        total_vram_mb: number;
    };

    const usageRow = d.prepare(`
        SELECT
            COALESCE(SUM(requests), 0) as total_requests,
            COALESCE(SUM(tokens), 0) as total_tokens
        FROM cloud_usage
        WHERE period = ?
    `).get(period) as { total_requests: number; total_tokens: number };

    return {
        totalClusters: clusterRow.total,
        activeClusters: clusterRow.active,
        totalNodes: clusterRow.total_nodes,
        totalGpus: clusterRow.total_gpus,
        totalVramMb: clusterRow.total_vram_mb,
        requestsThisMonth: usageRow.total_requests,
        tokensThisMonth: usageRow.total_tokens,
    };
}

// =============================================================================
// Internal: Row Mapping
// =============================================================================

function rowToCluster(d: ReturnType<typeof getDb>, row: Record<string, unknown>): CloudCluster {
    const period = currentPeriod();
    const usageRow = d.prepare(
        'SELECT requests, tokens, gpu_hours FROM cloud_usage WHERE cluster_id = ? AND period = ?',
    ).get(row.id as string, period) as { requests: number; tokens: number; gpu_hours: number } | undefined;

    return {
        id: row.id as string,
        ownerId: row.owner_id as string,
        name: row.name as string,
        subdomain: row.subdomain as string,
        plan: row.plan as CloudPlan,
        status: row.status as CloudClusterStatus,
        nodes: row.nodes as number,
        gpus: row.gpus as number,
        vramMb: row.vram_mb as number,
        createdAt: row.created_at as string,
        lastActiveAt: row.last_active_at as string,
        config: {
            region: row.region as string,
            customDomain: (row.custom_domain as string) || undefined,
            ssoEnabled: (row.sso_enabled as number) === 1,
            maxNodes: row.max_nodes as number,
        },
        usage: {
            requestsThisMonth: usageRow?.requests ?? 0,
            tokensThisMonth: usageRow?.tokens ?? 0,
            gpuHoursThisMonth: usageRow?.gpu_hours ?? 0,
        },
    };
}
