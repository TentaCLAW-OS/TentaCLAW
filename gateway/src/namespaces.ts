// F:\tentaclaw-os\gateway\src\namespaces.ts
// Namespace & Multi-Tenancy System
// TentaCLAW says: "Every family has territories. Every territory has a boss."

import { getDb } from './db';

// =============================================================================
// Types
// =============================================================================

export interface NamespaceQuota {
    maxGpus: number;           // max GPUs across all deployments
    maxVramMb: number;         // max VRAM allocation
    maxModels: number;         // max loaded models
    maxRequestsPerMin: number; // rate limit
    maxStorageMb: number;      // model storage quota
}

export interface Namespace {
    id: string;
    name: string;
    display_name: string;
    description: string;
    labels: Record<string, string>;
    quota: NamespaceQuota;
    created_at: string;
    updated_at: string;
}

export interface NamespaceUsage {
    namespace: string;
    period: string;           // "2026-03"
    gpu_hours: number;
    vram_hours_gb: number;
    tokens_generated: number;
    requests_served: number;
    power_kwh: number;
    estimated_cost_usd: number;
}

export interface NamespaceConfig {
    display_name?: string;
    description?: string;
    labels?: Record<string, string>;
    quota?: Partial<NamespaceQuota>;
}

export interface QuotaUsageReport {
    namespace: string;
    quota: NamespaceQuota;
    used: {
        gpus: number;
        vram_mb: number;
        models: number;
        requests_last_min: number;
        storage_mb: number;
    };
    remaining: {
        gpus: number;
        vram_mb: number;
        models: number;
        requests_this_min: number;
        storage_mb: number;
    };
    utilization_pct: {
        gpus: number;
        vram: number;
        models: number;
        requests: number;
        storage: number;
    };
}

export interface ResourceRequest {
    gpus?: number;
    vram_mb?: number;
    models?: number;
    storage_mb?: number;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_QUOTA: NamespaceQuota = {
    maxGpus: 0,               // 0 = unlimited
    maxVramMb: 0,             // 0 = unlimited
    maxModels: 0,             // 0 = unlimited
    maxRequestsPerMin: 0,     // 0 = unlimited
    maxStorageMb: 0,          // 0 = unlimited
};

function nowIso(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function pct(used: number, max: number): number {
    if (max <= 0) return 0;
    return Math.round((used / max) * 1000) / 10; // one decimal place
}

// =============================================================================
// Namespace CRUD
// =============================================================================

/**
 * Create a namespace with optional quotas, labels, etc.
 */
export function createNamespace(name: string, config?: NamespaceConfig): Namespace {
    const d = getDb();

    // Validate name: lowercase alphanumeric + hyphens, max 63 chars (k8s-style)
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(name) && name !== 'default') {
        throw new Error(
            `Invalid namespace name "${name}". Must be lowercase alphanumeric with hyphens, 2-63 chars.`,
        );
    }

    // Check uniqueness
    const existing = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(name);
    if (existing) {
        throw new Error(`Namespace "${name}" already exists.`);
    }

    const id = generateId();
    const displayName = config?.display_name ?? name;
    const description = config?.description ?? '';
    const labels = config?.labels ?? {};
    const quota: NamespaceQuota = { ...DEFAULT_QUOTA, ...config?.quota };
    const now = nowIso();

    d.prepare(`
        INSERT INTO namespaces (id, name, display_name, description, labels, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, displayName, description, JSON.stringify(labels), now, now);

    d.prepare(`
        INSERT INTO namespace_quotas (namespace_id, max_gpus, max_vram_mb, max_models, max_requests_per_min, max_storage_mb)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, quota.maxGpus, quota.maxVramMb, quota.maxModels, quota.maxRequestsPerMin, quota.maxStorageMb);

    return {
        id,
        name,
        display_name: displayName,
        description,
        labels,
        quota,
        created_at: now,
        updated_at: now,
    };
}

/**
 * Get namespace details + current quota.
 */
export function getNamespace(name: string): Namespace | null {
    const d = getDb();
    const row = d.prepare(`
        SELECT n.*, q.max_gpus, q.max_vram_mb, q.max_models, q.max_requests_per_min, q.max_storage_mb
        FROM namespaces n
        LEFT JOIN namespace_quotas q ON q.namespace_id = n.id
        WHERE n.name = ?
    `).get(name) as any;

    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        description: row.description ?? '',
        labels: safeJsonParse(row.labels, {}),
        quota: {
            maxGpus: row.max_gpus ?? 0,
            maxVramMb: row.max_vram_mb ?? 0,
            maxModels: row.max_models ?? 0,
            maxRequestsPerMin: row.max_requests_per_min ?? 0,
            maxStorageMb: row.max_storage_mb ?? 0,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * List all namespaces with usage stats summary.
 */
export function listNamespaces(): Array<Namespace & { resource_count: number }> {
    const d = getDb();
    const rows = d.prepare(`
        SELECT n.*, q.max_gpus, q.max_vram_mb, q.max_models, q.max_requests_per_min, q.max_storage_mb,
            (SELECT COUNT(*) FROM nodes WHERE namespace = n.name) as node_count,
            (SELECT COUNT(DISTINCT model) FROM inference_log il
             JOIN nodes nd ON nd.id = il.node_id
             WHERE nd.namespace = n.name) as model_count
        FROM namespaces n
        LEFT JOIN namespace_quotas q ON q.namespace_id = n.id
        ORDER BY n.name
    `).all() as any[];

    return rows.map(row => ({
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        description: row.description ?? '',
        labels: safeJsonParse(row.labels, {}),
        quota: {
            maxGpus: row.max_gpus ?? 0,
            maxVramMb: row.max_vram_mb ?? 0,
            maxModels: row.max_models ?? 0,
            maxRequestsPerMin: row.max_requests_per_min ?? 0,
            maxStorageMb: row.max_storage_mb ?? 0,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
        resource_count: (row.node_count ?? 0) + (row.model_count ?? 0),
    }));
}

/**
 * Delete namespace. Must be empty (no nodes assigned).
 */
export function deleteNamespace(name: string): boolean {
    if (name === 'default') {
        throw new Error('Cannot delete the "default" namespace.');
    }

    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(name) as { id: string } | undefined;
    if (!ns) return false;

    // Check for assigned nodes
    const nodeCount = (d.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE namespace = ?').get(name) as { cnt: number }).cnt;
    if (nodeCount > 0) {
        throw new Error(
            `Cannot delete namespace "${name}": ${nodeCount} node(s) still assigned. Reassign or remove them first.`,
        );
    }

    // Check for assigned API keys
    const keyCount = (d.prepare('SELECT COUNT(*) as cnt FROM api_keys WHERE namespace = ?').get(name) as { cnt: number }).cnt;
    if (keyCount > 0) {
        throw new Error(
            `Cannot delete namespace "${name}": ${keyCount} API key(s) still bound. Reassign or revoke them first.`,
        );
    }

    d.transaction(() => {
        d.prepare('DELETE FROM namespace_usage WHERE namespace_id = ?').run(ns.id);
        d.prepare('DELETE FROM namespace_quotas WHERE namespace_id = ?').run(ns.id);
        d.prepare('DELETE FROM namespaces WHERE id = ?').run(ns.id);
    })();

    return true;
}

/**
 * Update namespace config: display name, description, labels, quotas.
 */
export function updateNamespace(name: string, config: NamespaceConfig): Namespace | null {
    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(name) as { id: string } | undefined;
    if (!ns) return null;

    const now = nowIso();

    d.transaction(() => {
        const updates: string[] = [];
        const params: unknown[] = [];

        if (config.display_name !== undefined) {
            updates.push('display_name = ?');
            params.push(config.display_name);
        }
        if (config.description !== undefined) {
            updates.push('description = ?');
            params.push(config.description);
        }
        if (config.labels !== undefined) {
            updates.push('labels = ?');
            params.push(JSON.stringify(config.labels));
        }

        if (updates.length > 0) {
            updates.push('updated_at = ?');
            params.push(now);
            params.push(ns.id);
            d.prepare(`UPDATE namespaces SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        if (config.quota) {
            const q = config.quota;
            const qUpdates: string[] = [];
            const qParams: unknown[] = [];

            if (q.maxGpus !== undefined) { qUpdates.push('max_gpus = ?'); qParams.push(q.maxGpus); }
            if (q.maxVramMb !== undefined) { qUpdates.push('max_vram_mb = ?'); qParams.push(q.maxVramMb); }
            if (q.maxModels !== undefined) { qUpdates.push('max_models = ?'); qParams.push(q.maxModels); }
            if (q.maxRequestsPerMin !== undefined) { qUpdates.push('max_requests_per_min = ?'); qParams.push(q.maxRequestsPerMin); }
            if (q.maxStorageMb !== undefined) { qUpdates.push('max_storage_mb = ?'); qParams.push(q.maxStorageMb); }

            if (qUpdates.length > 0) {
                qParams.push(ns.id);
                d.prepare(`UPDATE namespace_quotas SET ${qUpdates.join(', ')} WHERE namespace_id = ?`).run(...qParams);
            }
        }
    })();

    return getNamespace(name);
}

// =============================================================================
// Resource Quotas
// =============================================================================

/**
 * Set (replace) the full quota for a namespace.
 */
export function setQuota(namespaceName: string, quota: NamespaceQuota): boolean {
    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName) as { id: string } | undefined;
    if (!ns) return false;

    d.prepare(`
        UPDATE namespace_quotas
        SET max_gpus = ?, max_vram_mb = ?, max_models = ?, max_requests_per_min = ?, max_storage_mb = ?
        WHERE namespace_id = ?
    `).run(quota.maxGpus, quota.maxVramMb, quota.maxModels, quota.maxRequestsPerMin, quota.maxStorageMb, ns.id);

    d.prepare("UPDATE namespaces SET updated_at = ? WHERE id = ?").run(nowIso(), ns.id);
    return true;
}

/**
 * Get current usage vs limits for a namespace.
 */
export function getQuotaUsage(namespaceName: string): QuotaUsageReport | null {
    const d = getDb();
    const ns = getNamespace(namespaceName);
    if (!ns) return null;

    // Count GPUs from nodes in this namespace
    const gpuRow = d.prepare(`
        SELECT COALESCE(SUM(gpu_count), 0) as total_gpus
        FROM nodes WHERE namespace = ? AND status != 'offline'
    `).get(namespaceName) as { total_gpus: number };

    // Total VRAM from stats of nodes in namespace (latest per node)
    // Use ram_used_mb column as a proxy — actual GPU VRAM requires JSON array iteration
    // which SQLite can't do natively. The routing layer uses JS for accurate VRAM.
    const vramRow = d.prepare(`
        SELECT COALESCE(SUM(ram_used_mb), 0) as total_vram_mb
        FROM (
            SELECT s.node_id, s.ram_used_mb
            FROM stats s
            JOIN nodes n ON n.id = s.node_id
            WHERE n.namespace = ?
            AND s.timestamp = (SELECT MAX(s2.timestamp) FROM stats s2 WHERE s2.node_id = s.node_id)
        )
    `).get(namespaceName) as { total_vram_mb: number };

    // Count models loaded on namespace nodes
    const modelRow = d.prepare(`
        SELECT COUNT(DISTINCT model) as model_count
        FROM inference_log il
        JOIN nodes n ON n.id = il.node_id
        WHERE n.namespace = ?
        AND il.created_at >= datetime('now', '-1 hour')
    `).get(namespaceName) as { model_count: number };

    // Requests in the last minute
    const reqRow = d.prepare(`
        SELECT COUNT(*) as req_count
        FROM inference_log il
        JOIN nodes n ON n.id = il.node_id
        WHERE n.namespace = ?
        AND il.created_at >= datetime('now', '-1 minute')
    `).get(namespaceName) as { req_count: number };

    // Storage estimate (placeholder — real storage tracking would need filesystem integration)
    const storageRow = d.prepare(`
        SELECT COUNT(DISTINCT il.model) * 4096 as storage_mb
        FROM inference_log il
        JOIN nodes n ON n.id = il.node_id
        WHERE n.namespace = ?
    `).get(namespaceName) as { storage_mb: number };

    const q = ns.quota;
    const used = {
        gpus: gpuRow.total_gpus,
        vram_mb: vramRow.total_vram_mb,
        models: modelRow.model_count,
        requests_last_min: reqRow.req_count,
        storage_mb: storageRow.storage_mb,
    };

    return {
        namespace: namespaceName,
        quota: q,
        used,
        remaining: {
            gpus: q.maxGpus > 0 ? Math.max(0, q.maxGpus - used.gpus) : -1,
            vram_mb: q.maxVramMb > 0 ? Math.max(0, q.maxVramMb - used.vram_mb) : -1,
            models: q.maxModels > 0 ? Math.max(0, q.maxModels - used.models) : -1,
            requests_this_min: q.maxRequestsPerMin > 0 ? Math.max(0, q.maxRequestsPerMin - used.requests_last_min) : -1,
            storage_mb: q.maxStorageMb > 0 ? Math.max(0, q.maxStorageMb - used.storage_mb) : -1,
        },
        utilization_pct: {
            gpus: pct(used.gpus, q.maxGpus),
            vram: pct(used.vram_mb, q.maxVramMb),
            models: pct(used.models, q.maxModels),
            requests: pct(used.requests_last_min, q.maxRequestsPerMin),
            storage: pct(used.storage_mb, q.maxStorageMb),
        },
    };
}

/**
 * Check whether a resource request fits within the namespace quota.
 * Returns { allowed, reason? }.
 */
export function checkQuota(
    namespaceName: string,
    request: ResourceRequest,
): { allowed: boolean; reason?: string } {
    const usage = getQuotaUsage(namespaceName);
    if (!usage) return { allowed: false, reason: `Namespace "${namespaceName}" not found.` };

    const q = usage.quota;

    if (request.gpus && q.maxGpus > 0) {
        if (usage.used.gpus + request.gpus > q.maxGpus) {
            return {
                allowed: false,
                reason: `GPU quota exceeded: ${usage.used.gpus} + ${request.gpus} > ${q.maxGpus} max`,
            };
        }
    }

    if (request.vram_mb && q.maxVramMb > 0) {
        if (usage.used.vram_mb + request.vram_mb > q.maxVramMb) {
            return {
                allowed: false,
                reason: `VRAM quota exceeded: ${usage.used.vram_mb} + ${request.vram_mb} > ${q.maxVramMb} max MB`,
            };
        }
    }

    if (request.models && q.maxModels > 0) {
        if (usage.used.models + request.models > q.maxModels) {
            return {
                allowed: false,
                reason: `Model quota exceeded: ${usage.used.models} + ${request.models} > ${q.maxModels} max`,
            };
        }
    }

    if (request.storage_mb && q.maxStorageMb > 0) {
        if (usage.used.storage_mb + request.storage_mb > q.maxStorageMb) {
            return {
                allowed: false,
                reason: `Storage quota exceeded: ${usage.used.storage_mb} + ${request.storage_mb} > ${q.maxStorageMb} max MB`,
            };
        }
    }

    return { allowed: true };
}

// =============================================================================
// Namespace Isolation
// =============================================================================

/**
 * Get models loaded on nodes in a specific namespace.
 */
export function getModelsInNamespace(namespaceName: string): Array<{ model: string; node_count: number; nodes: string[] }> {
    const d = getDb();
    const rows = d.prepare(`
        SELECT il.model, COUNT(DISTINCT il.node_id) as node_count, GROUP_CONCAT(DISTINCT il.node_id) as node_ids
        FROM inference_log il
        JOIN nodes n ON n.id = il.node_id
        WHERE n.namespace = ?
        AND il.created_at >= datetime('now', '-1 hour')
        GROUP BY il.model
        ORDER BY node_count DESC
    `).all(namespaceName) as any[];

    return rows.map(r => ({
        model: r.model,
        node_count: r.node_count,
        nodes: r.node_ids ? r.node_ids.split(',') : [],
    }));
}

/**
 * Get nodes assigned to a namespace.
 */
export function getNodesInNamespace(namespaceName: string): Array<{
    id: string;
    hostname: string;
    status: string;
    gpu_count: number;
    ip_address: string | null;
}> {
    const d = getDb();
    return d.prepare(`
        SELECT id, hostname, status, gpu_count, ip_address
        FROM nodes
        WHERE namespace = ?
        ORDER BY hostname
    `).all(namespaceName) as any[];
}

/**
 * Assign (or reassign) a node to a namespace.
 */
export function assignNodeToNamespace(nodeId: string, namespaceName: string): boolean {
    const d = getDb();

    // Verify namespace exists
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName);
    if (!ns) {
        throw new Error(`Namespace "${namespaceName}" does not exist.`);
    }

    // Verify node exists
    const node = d.prepare('SELECT id FROM nodes WHERE id = ?').get(nodeId);
    if (!node) {
        throw new Error(`Node "${nodeId}" not found.`);
    }

    const result = d.prepare('UPDATE nodes SET namespace = ? WHERE id = ?').run(namespaceName, nodeId);
    return result.changes > 0;
}

/**
 * Map an API key to a namespace. Returns the namespace name, or 'default' if unbound.
 */
export function getNamespaceForApiKey(keyId: string): string {
    const d = getDb();
    const row = d.prepare('SELECT namespace FROM api_keys WHERE id = ?').get(keyId) as { namespace: string | null } | undefined;
    return row?.namespace ?? 'default';
}

/**
 * Bind an API key to a specific namespace.
 */
export function setApiKeyNamespace(keyId: string, namespaceName: string): boolean {
    const d = getDb();

    // Verify namespace exists
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName);
    if (!ns) {
        throw new Error(`Namespace "${namespaceName}" does not exist.`);
    }

    const result = d.prepare('UPDATE api_keys SET namespace = ? WHERE id = ?').run(namespaceName, keyId);
    return result.changes > 0;
}

// =============================================================================
// Chargeback / Usage Tracking
// =============================================================================

/**
 * Record usage metrics for a namespace (typically called per-request or in batch).
 */
export function recordUsage(
    namespaceName: string,
    metrics: {
        gpu_hours?: number;
        vram_hours_gb?: number;
        tokens_generated?: number;
        requests_served?: number;
        power_kwh?: number;
        estimated_cost_usd?: number;
    },
): void {
    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName) as { id: string } | undefined;
    if (!ns) {
        throw new Error(`Namespace "${namespaceName}" not found.`);
    }

    const period = currentPeriod();

    // Upsert: increment existing row or insert new
    const existing = d.prepare(
        'SELECT id FROM namespace_usage WHERE namespace_id = ? AND period = ?',
    ).get(ns.id, period) as { id: string } | undefined;

    if (existing) {
        d.prepare(`
            UPDATE namespace_usage SET
                gpu_hours = gpu_hours + ?,
                vram_hours_gb = vram_hours_gb + ?,
                tokens_generated = tokens_generated + ?,
                requests_served = requests_served + ?,
                power_kwh = power_kwh + ?,
                estimated_cost_usd = estimated_cost_usd + ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            metrics.gpu_hours ?? 0,
            metrics.vram_hours_gb ?? 0,
            metrics.tokens_generated ?? 0,
            metrics.requests_served ?? 0,
            metrics.power_kwh ?? 0,
            metrics.estimated_cost_usd ?? 0,
            nowIso(),
            existing.id,
        );
    } else {
        d.prepare(`
            INSERT INTO namespace_usage (id, namespace_id, period, gpu_hours, vram_hours_gb, tokens_generated, requests_served, power_kwh, estimated_cost_usd, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            generateId(),
            ns.id,
            period,
            metrics.gpu_hours ?? 0,
            metrics.vram_hours_gb ?? 0,
            metrics.tokens_generated ?? 0,
            metrics.requests_served ?? 0,
            metrics.power_kwh ?? 0,
            metrics.estimated_cost_usd ?? 0,
            nowIso(),
        );
    }
}

/**
 * Get usage report for a namespace in a given billing period.
 */
export function getUsageReport(namespaceName: string, period?: string): NamespaceUsage | null {
    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName) as { id: string } | undefined;
    if (!ns) return null;

    const p = period ?? currentPeriod();

    const row = d.prepare(`
        SELECT gpu_hours, vram_hours_gb, tokens_generated, requests_served, power_kwh, estimated_cost_usd
        FROM namespace_usage
        WHERE namespace_id = ? AND period = ?
    `).get(ns.id, p) as any;

    if (!row) {
        return {
            namespace: namespaceName,
            period: p,
            gpu_hours: 0,
            vram_hours_gb: 0,
            tokens_generated: 0,
            requests_served: 0,
            power_kwh: 0,
            estimated_cost_usd: 0,
        };
    }

    return {
        namespace: namespaceName,
        period: p,
        gpu_hours: row.gpu_hours,
        vram_hours_gb: row.vram_hours_gb,
        tokens_generated: row.tokens_generated,
        requests_served: row.requests_served,
        power_kwh: row.power_kwh,
        estimated_cost_usd: row.estimated_cost_usd,
    };
}

/**
 * Export usage data as CSV for finance/billing.
 */
export function exportUsageCSV(namespaceName: string, period?: string): string {
    const d = getDb();
    const ns = d.prepare('SELECT id FROM namespaces WHERE name = ?').get(namespaceName) as { id: string } | undefined;
    if (!ns) {
        throw new Error(`Namespace "${namespaceName}" not found.`);
    }

    let rows: any[];
    if (period) {
        rows = d.prepare(`
            SELECT period, gpu_hours, vram_hours_gb, tokens_generated, requests_served, power_kwh, estimated_cost_usd
            FROM namespace_usage
            WHERE namespace_id = ? AND period = ?
            ORDER BY period
        `).all(ns.id, period);
    } else {
        rows = d.prepare(`
            SELECT period, gpu_hours, vram_hours_gb, tokens_generated, requests_served, power_kwh, estimated_cost_usd
            FROM namespace_usage
            WHERE namespace_id = ?
            ORDER BY period
        `).all(ns.id);
    }

    const header = 'namespace,period,gpu_hours,vram_hours_gb,tokens_generated,requests_served,power_kwh,estimated_cost_usd';
    const lines = rows.map(r =>
        `${namespaceName},${r.period},${r.gpu_hours},${r.vram_hours_gb},${r.tokens_generated},${r.requests_served},${r.power_kwh},${r.estimated_cost_usd}`,
    );

    return [header, ...lines].join('\n');
}

/**
 * Get all usage reports across all namespaces for a given period.
 * Useful for org-wide billing dashboards.
 */
export function getAllUsageReports(period?: string): NamespaceUsage[] {
    const d = getDb();
    const p = period ?? currentPeriod();

    const rows = d.prepare(`
        SELECT n.name as namespace_name, u.gpu_hours, u.vram_hours_gb, u.tokens_generated,
               u.requests_served, u.power_kwh, u.estimated_cost_usd
        FROM namespace_usage u
        JOIN namespaces n ON n.id = u.namespace_id
        WHERE u.period = ?
        ORDER BY u.estimated_cost_usd DESC
    `).all(p) as any[];

    return rows.map(r => ({
        namespace: r.namespace_name,
        period: p,
        gpu_hours: r.gpu_hours,
        vram_hours_gb: r.vram_hours_gb,
        tokens_generated: r.tokens_generated,
        requests_served: r.requests_served,
        power_kwh: r.power_kwh,
        estimated_cost_usd: r.estimated_cost_usd,
    }));
}

// =============================================================================
// Default Namespace Bootstrap
// =============================================================================

/**
 * Ensure the "default" namespace exists. Called on gateway boot.
 * All existing resources (nodes, API keys) with no namespace get assigned to "default".
 */
export function ensureDefaultNamespace(): void {
    const d = getDb();

    const existing = d.prepare('SELECT id FROM namespaces WHERE name = ?').get('default');
    if (!existing) {
        const id = generateId();
        const now = nowIso();

        d.prepare(`
            INSERT INTO namespaces (id, name, display_name, description, labels, created_at, updated_at)
            VALUES (?, 'default', 'Default', 'Default namespace for backward compatibility. All unassigned resources live here.', '{}', ?, ?)
        `).run(id, now, now);

        d.prepare(`
            INSERT INTO namespace_quotas (namespace_id, max_gpus, max_vram_mb, max_models, max_requests_per_min, max_storage_mb)
            VALUES (?, 0, 0, 0, 0, 0)
        `).run(id);

        console.log('[namespaces] Created "default" namespace');
    }

    // Assign any existing nodes without a namespace to "default"
    const updated = d.prepare(
        "UPDATE nodes SET namespace = 'default' WHERE namespace IS NULL OR namespace = ''",
    ).run();
    if (updated.changes > 0) {
        console.log(`[namespaces] Assigned ${updated.changes} existing node(s) to "default" namespace`);
    }

    // Assign any existing API keys without a namespace to "default"
    const keysUpdated = d.prepare(
        "UPDATE api_keys SET namespace = 'default' WHERE namespace IS NULL OR namespace = ''",
    ).run();
    if (keysUpdated.changes > 0) {
        console.log(`[namespaces] Assigned ${keysUpdated.changes} existing API key(s) to "default" namespace`);
    }
}

// =============================================================================
// JSON Helper
// =============================================================================

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}
