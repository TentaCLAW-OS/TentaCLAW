// F:\tentaclaw-os\gateway\src\analytics.ts
// Platform Analytics — Track Everything That Matters
// CLAWtopus says: "I count every star, every download, every user."

import {
    getDb,
    getAllNodes,
    getClusterPower,
    getClusterSummary,
    getClusterCapacity,
    getNodeUptime,
    getFleetUptime,
} from './db';
import { percentile } from './profiler';
import { getCloudComparison, getCostDashboard } from './cost-intelligence';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface PlatformMetrics {
    // Cluster
    totalNodes: number;
    totalGpus: number;
    totalVramGb: number;
    onlineNodes: number;

    // Inference
    totalRequestsAllTime: number;
    totalTokensAllTime: number;
    requestsToday: number;
    requestsThisWeek: number;
    requestsThisMonth: number;
    avgLatencyMs: number;
    p95LatencyMs: number;

    // Models
    modelsLoaded: number;
    uniqueModelsEverDeployed: number;
    mostPopularModel: string;

    // Users
    totalUsers: number;
    activeUsersToday: number;
    totalApiKeys: number;

    // CLAWHub
    packagesInstalled: number;

    // Uptime
    gatewayUptimePct: number;
    avgNodeUptimePct: number;

    // Cost
    totalPowerWatts: number;
    monthlyCostEstimate: number;
    tokensPerDollar: number;
}

export interface MetricSnapshot {
    id: number;
    snapshot: PlatformMetrics;
    captured_at: string;
}

export type MetricPeriod = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';
export type ExportFormat = 'json' | 'csv' | 'pdf-data';

export interface GrowthTrend {
    metric: string;
    current: number;
    previous: number;
    change_pct: number;
    direction: 'up' | 'down' | 'flat';
    period_days: number;
    summary: string;
}

export interface TopModel {
    model: string;
    request_count: number;
    total_tokens: number;
    avg_latency_ms: number;
    error_rate_pct: number;
}

export interface TopUser {
    namespace: string;
    request_count: number;
    total_tokens: number;
    last_active: string;
}

export interface TopNode {
    node_id: string;
    hostname: string;
    request_count: number;
    avg_latency_ms: number;
    uptime_pct: number;
    gpu_utilization_pct: number;
}

export interface PeakHour {
    hour: number;
    request_count: number;
    avg_latency_ms: number;
    label: string;
}

export interface RequestDistribution {
    by_model: Array<{ model: string; count: number; pct: number }>;
    by_namespace: Array<{ namespace: string; count: number; pct: number }>;
    by_backend: Array<{ backend: string; count: number; pct: number }>;
    by_hour: Array<{ hour: number; count: number }>;
}

export interface UptimeReport {
    period: string;
    cluster_uptime_pct: number;
    nodes: Array<{
        node_id: string;
        hostname: string;
        uptime_pct: number;
        total_online_hours: number;
        total_offline_hours: number;
        outage_count: number;
    }>;
    worst_node: string | null;
    best_node: string | null;
}

export interface Incident {
    id: number;
    node_id: string;
    type: 'node_failure' | 'model_crash' | 'sla_breach' | 'high_error_rate' | 'latency_spike';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    started_at: string;
    resolved_at: string | null;
    duration_s: number;
}

export interface MTBFResult {
    node_id: string;
    hostname: string;
    mtbf_hours: number;
    failure_count: number;
    observation_hours: number;
}

export interface MTTRResult {
    node_id: string;
    hostname: string;
    mttr_minutes: number;
    recovery_count: number;
}

export interface ExecutiveSummary {
    generated_at: string;
    period: string;

    cluster: {
        total_nodes: number;
        total_gpus: number;
        total_vram_gb: number;
        online_nodes: number;
        growth_vs_last_period: string;
    };

    inference: {
        total_requests: number;
        total_tokens: number;
        avg_latency_ms: number;
        p95_latency_ms: number;
        growth_trend: string;
        busiest_hour: string;
    };

    cost: {
        monthly_estimate: number;
        cost_per_million_tokens: number;
        cloud_savings_monthly: number;
        tokens_per_dollar: number;
        currency: string;
    };

    reliability: {
        cluster_uptime_pct: number;
        avg_node_uptime_pct: number;
        incidents_this_period: number;
        mtbf_hours: number;
        mttr_minutes: number;
    };

    top_models: Array<{ model: string; requests: number }>;

    recommendations: string[];
}

export interface WeeklyReportSchedule {
    enabled: boolean;
    email: string | null;
    last_sent_at: string | null;
    next_send_at: string;
}

export interface ExportedAnalytics {
    format: ExportFormat;
    period: MetricPeriod;
    generated_at: string;
    data: unknown;
}

// =============================================================================
// Constants
// =============================================================================

/** Max snapshots to keep in the ring buffer table (90 days at 5-min intervals). */
const MAX_SNAPSHOTS = 90 * 24 * 12; // 25,920

/** Gateway start time, used for uptime calculation. */
const GATEWAY_START = Date.now();

// =============================================================================
// Schema Initialization
// =============================================================================

/**
 * Initialize the platform_metrics_snapshots table and supporting tables.
 * Uses IF NOT EXISTS so it is safe to call repeatedly.
 */
function ensureSchema(): void {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS platform_metrics_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot TEXT NOT NULL,
            captured_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_pms_captured
            ON platform_metrics_snapshots(captured_at DESC);

        CREATE TABLE IF NOT EXISTS platform_incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'warning',
            message TEXT NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            resolved_at TEXT,
            duration_s INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_platform_incidents_time
            ON platform_incidents(started_at DESC);

        CREATE TABLE IF NOT EXISTS weekly_report_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            email TEXT,
            last_sent_at TEXT,
            next_send_at TEXT
        );
    `);
}

let schemaReady = false;

function ensureReady(): void {
    if (!schemaReady) {
        ensureSchema();
        schemaReady = true;
    }
}

// =============================================================================
// Helpers
// =============================================================================

/** Round a number to N decimal places. */
function round(value: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/** Convert a MetricPeriod to hours. */
function periodToHours(period: MetricPeriod): number {
    switch (period) {
        case '1h':  return 1;
        case '6h':  return 6;
        case '24h': return 24;
        case '7d':  return 168;
        case '30d': return 720;
        case '90d': return 2160;
    }
}

/** Convert a MetricPeriod to a human-readable label. */
function periodLabel(period: MetricPeriod): string {
    switch (period) {
        case '1h':  return 'Last 1 hour';
        case '6h':  return 'Last 6 hours';
        case '24h': return 'Last 24 hours';
        case '7d':  return 'Last 7 days';
        case '30d': return 'Last 30 days';
        case '90d': return 'Last 90 days';
    }
}

/** Get an ISO datetime string for N hours ago, formatted for SQLite. */
function sinceHoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** Get the start of today as an ISO datetime string. */
function startOfToday(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Get the start of the current week (Monday) as an ISO datetime string. */
function startOfWeek(): string {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday-based
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Get the start of the current month as an ISO datetime string. */
function startOfMonth(): string {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

// =============================================================================
// 1. Platform Metrics — Collect Everything
// =============================================================================

/**
 * Gather current platform-wide metrics across all subsystems.
 *
 * Combines cluster state, inference stats, user counts, cost data, and
 * uptime information into a single PlatformMetrics snapshot.
 *
 * @returns A fully populated PlatformMetrics object.
 */
export function getPlatformMetrics(): PlatformMetrics {
    ensureReady();
    const db = getDb();
    const summary = getClusterSummary();
    const capacity = getClusterCapacity();
    const power = getClusterPower();

    // --- Cluster ---
    const totalVramGb = round(summary.total_vram_mb / 1024, 1);

    // --- Inference: all-time ---
    const allTimeRow = db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(tokens_in + tokens_out), 0) as tokens
        FROM inference_log
    `).get() as { cnt: number; tokens: number };

    // --- Inference: today ---
    const todayStr = startOfToday();
    const todayRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_log WHERE created_at >= ?
    `).get(todayStr) as { cnt: number };

    // --- Inference: this week ---
    const weekStr = startOfWeek();
    const weekRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_log WHERE created_at >= ?
    `).get(weekStr) as { cnt: number };

    // --- Inference: this month ---
    const monthStr = startOfMonth();
    const monthRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_log WHERE created_at >= ?
    `).get(monthStr) as { cnt: number };

    // --- Latency (last 24h) ---
    const latencyRows = db.prepare(`
        SELECT latency_ms FROM inference_log
        WHERE created_at >= datetime('now', '-24 hours') AND success = 1
        ORDER BY latency_ms
    `).all() as Array<{ latency_ms: number }>;
    const latencies = latencyRows.map(r => r.latency_ms);
    const avgLatency = latencies.length > 0
        ? round(latencies.reduce((a, b) => a + b, 0) / latencies.length, 1)
        : 0;
    const p95Latency = round(percentile(latencies, 95), 1);

    // --- Models ---
    const uniqueModelsRow = db.prepare(`
        SELECT COUNT(DISTINCT model) as cnt FROM inference_log
    `).get() as { cnt: number };

    const popularModelRow = db.prepare(`
        SELECT model, COUNT(*) as cnt FROM inference_log
        GROUP BY model ORDER BY cnt DESC LIMIT 1
    `).get() as { model: string; cnt: number } | undefined;

    // --- Users ---
    const usersRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM users
    `).get() as { cnt: number } | undefined;

    const activeUsersRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM sessions
        WHERE expires_at > datetime('now') AND created_at >= ?
    `).get(todayStr) as { cnt: number } | undefined;

    const apiKeysRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM api_keys WHERE enabled = 1
    `).get() as { cnt: number } | undefined;

    // --- CLAWHub packages (from cluster config if available) ---
    const packagesRow = db.prepare(`
        SELECT value FROM cluster_config WHERE key = 'clawhub_packages_installed'
    `).get() as { value: string } | undefined;

    // --- Uptime ---
    const gatewayUptimeMs = Date.now() - GATEWAY_START;
    const gatewayUptimeHours = gatewayUptimeMs / 3600_000;
    // Gateway uptime: the process has been running continuously since start
    const gatewayUptimePct = round(Math.min(100, (gatewayUptimeHours / Math.max(gatewayUptimeHours, 1)) * 100), 1);

    const fleetUptime = getFleetUptime(24);
    const avgNodeUptime = fleetUptime.length > 0
        ? round(fleetUptime.reduce((s, n) => s + n.uptime_pct, 0) / fleetUptime.length, 1)
        : 100;

    // --- Cost ---
    const cloudComp = getCloudComparison();
    const monthlyEstimate = cloudComp.self_hosted.monthly_cost;
    const tokensThisMonth = cloudComp.self_hosted.tokens_served_this_month;
    const tokensPerDollar = monthlyEstimate > 0
        ? round(tokensThisMonth / monthlyEstimate, 0)
        : 0;

    return {
        totalNodes: summary.total_nodes,
        totalGpus: summary.total_gpus,
        totalVramGb,
        onlineNodes: summary.online_nodes,

        totalRequestsAllTime: allTimeRow.cnt,
        totalTokensAllTime: allTimeRow.tokens,
        requestsToday: todayRow.cnt,
        requestsThisWeek: weekRow.cnt,
        requestsThisMonth: monthRow.cnt,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,

        modelsLoaded: capacity.models_loaded,
        uniqueModelsEverDeployed: uniqueModelsRow.cnt,
        mostPopularModel: popularModelRow?.model ?? 'none',

        totalUsers: usersRow?.cnt ?? 0,
        activeUsersToday: activeUsersRow?.cnt ?? 0,
        totalApiKeys: apiKeysRow?.cnt ?? 0,

        packagesInstalled: packagesRow ? parseInt(packagesRow.value, 10) || 0 : 0,

        gatewayUptimePct,
        avgNodeUptimePct: avgNodeUptime,

        totalPowerWatts: power.total_watts,
        monthlyCostEstimate: monthlyEstimate,
        tokensPerDollar,
    };
}

// =============================================================================
// 2. Time Series — Snapshot & History
// =============================================================================

/**
 * Capture a snapshot of current platform metrics and store it in the
 * platform_metrics_snapshots table. Call this every 5 minutes via a timer.
 *
 * Enforces a ring buffer: old snapshots beyond MAX_SNAPSHOTS (90 days) are pruned.
 *
 * @returns The stored MetricSnapshot.
 */
export function recordMetricSnapshot(): MetricSnapshot {
    ensureReady();
    const db = getDb();
    const metrics = getPlatformMetrics();
    const jsonStr = JSON.stringify(metrics);

    const result = db.prepare(`
        INSERT INTO platform_metrics_snapshots (snapshot) VALUES (?)
    `).run(jsonStr);

    const id = Number(result.lastInsertRowid);
    const captured_at = new Date().toISOString();

    // Prune old snapshots beyond the ring buffer limit
    db.prepare(`
        DELETE FROM platform_metrics_snapshots
        WHERE id NOT IN (
            SELECT id FROM platform_metrics_snapshots
            ORDER BY captured_at DESC
            LIMIT ?
        )
    `).run(MAX_SNAPSHOTS);

    return { id, snapshot: metrics, captured_at };
}

/**
 * Retrieve historical metric snapshots for a given period.
 *
 * @param metric - The PlatformMetrics field to extract (e.g. "requestsToday").
 *                 If null, returns totalRequestsAllTime as a default.
 * @param period - Time period to retrieve.
 * @returns Array of { timestamp, value } points suitable for graphing.
 */
export function getMetricHistory(
    metric: keyof PlatformMetrics | null,
    period: MetricPeriod = '24h',
): Array<{ timestamp: string; value: number }> {
    ensureReady();
    const db = getDb();
    const since = sinceHoursAgo(periodToHours(period));

    const rows = db.prepare(`
        SELECT snapshot, captured_at FROM platform_metrics_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC
    `).all(since) as Array<{ snapshot: string; captured_at: string }>;

    if (!metric) {
        return rows.map(r => {
            const snap = JSON.parse(r.snapshot) as PlatformMetrics;
            return { timestamp: r.captured_at, value: snap.totalRequestsAllTime };
        });
    }

    return rows.map(r => {
        const snap = JSON.parse(r.snapshot) as PlatformMetrics;
        const val = snap[metric];
        return {
            timestamp: r.captured_at,
            value: typeof val === 'number' ? val : 0,
        };
    });
}

/**
 * Calculate the growth trend for a given metric over a specified number of days.
 *
 * Compares the average value in the most recent half of the period against
 * the average value in the first half.
 *
 * @param metric - The PlatformMetrics field to analyze.
 * @param days   - Number of days to look back (default 7).
 * @returns Growth trend with percentage change and a human-readable summary.
 */
export function getGrowthTrend(
    metric: keyof PlatformMetrics,
    days: number = 7,
): GrowthTrend {
    ensureReady();
    const db = getDb();

    const midpoint = new Date(Date.now() - (days / 2) * 86400_000)
        .toISOString().replace('T', ' ').slice(0, 19);
    const start = new Date(Date.now() - days * 86400_000)
        .toISOString().replace('T', ' ').slice(0, 19);

    // First half of the period
    const firstHalfRows = db.prepare(`
        SELECT snapshot FROM platform_metrics_snapshots
        WHERE captured_at >= ? AND captured_at < ?
        ORDER BY captured_at ASC
    `).all(start, midpoint) as Array<{ snapshot: string }>;

    // Second half of the period (recent)
    const secondHalfRows = db.prepare(`
        SELECT snapshot FROM platform_metrics_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC
    `).all(midpoint) as Array<{ snapshot: string }>;

    const extractAvg = (rows: Array<{ snapshot: string }>): number => {
        if (rows.length === 0) return 0;
        let sum = 0;
        for (const r of rows) {
            const snap = JSON.parse(r.snapshot) as PlatformMetrics;
            const val = snap[metric];
            sum += typeof val === 'number' ? val : 0;
        }
        return sum / rows.length;
    };

    const previous = extractAvg(firstHalfRows);
    const current = extractAvg(secondHalfRows);
    const changePct = previous > 0 ? round(((current - previous) / previous) * 100, 1) : 0;
    const direction: GrowthTrend['direction'] =
        changePct > 2 ? 'up' : changePct < -2 ? 'down' : 'flat';

    const directionWord = direction === 'up' ? 'growing' : direction === 'down' ? 'declining' : 'stable';
    const summary = `${String(metric)} is ${directionWord} ${Math.abs(changePct)}% over the last ${days} days`;

    return {
        metric: String(metric),
        current: round(current, 2),
        previous: round(previous, 2),
        change_pct: changePct,
        direction,
        period_days: days,
        summary,
    };
}

// =============================================================================
// 3. Usage Analytics
// =============================================================================

/**
 * Get the most-used models, ranked by request count.
 *
 * @param period - Time period to query (default '24h').
 * @param limit  - Max results (default 10).
 * @returns Ranked list of models with request counts and token usage.
 */
export function getTopModels(
    period: MetricPeriod = '24h',
    limit: number = 10,
): TopModel[] {
    ensureReady();
    const db = getDb();
    const since = sinceHoursAgo(periodToHours(period));

    const rows = db.prepare(`
        SELECT
            model,
            COUNT(*) as request_count,
            COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
            AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) as avg_latency_ms,
            ROUND(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as error_rate_pct
        FROM inference_log
        WHERE created_at >= ?
        GROUP BY model
        ORDER BY request_count DESC
        LIMIT ?
    `).all(since, limit) as Array<{
        model: string;
        request_count: number;
        total_tokens: number;
        avg_latency_ms: number | null;
        error_rate_pct: number;
    }>;

    return rows.map(r => ({
        model: r.model,
        request_count: r.request_count,
        total_tokens: r.total_tokens,
        avg_latency_ms: round(r.avg_latency_ms ?? 0, 1),
        error_rate_pct: r.error_rate_pct,
    }));
}

/**
 * Get the most active users/API key namespaces.
 *
 * Uses inference_traces if available (which tracks namespace),
 * otherwise falls back to api_keys usage counts.
 *
 * @param period - Time period to query (default '24h').
 * @param limit  - Max results (default 10).
 * @returns Ranked list of users/namespaces.
 */
export function getTopUsers(
    period: MetricPeriod = '24h',
    limit: number = 10,
): TopUser[] {
    ensureReady();
    const db = getDb();
    const since = sinceHoursAgo(periodToHours(period));

    // Try inference_traces first (has namespace tracking)
    try {
        const rows = db.prepare(`
            SELECT
                namespace,
                COUNT(*) as request_count,
                COALESCE(SUM(tokens_total), 0) as total_tokens,
                MAX(timestamp) as last_active
            FROM inference_traces
            WHERE timestamp >= ?
            GROUP BY namespace
            ORDER BY request_count DESC
            LIMIT ?
        `).all(since, limit) as Array<{
            namespace: string;
            request_count: number;
            total_tokens: number;
            last_active: string;
        }>;

        if (rows.length > 0) return rows;
    } catch {
        // inference_traces table may not exist yet; fall back
    }

    // Fallback: use api_keys table
    const rows = db.prepare(`
        SELECT
            name as namespace,
            requests_count as request_count,
            tokens_used as total_tokens,
            COALESCE(last_used_at, created_at) as last_active
        FROM api_keys
        WHERE enabled = 1
        ORDER BY requests_count DESC
        LIMIT ?
    `).all(limit) as Array<{
        namespace: string;
        request_count: number;
        total_tokens: number;
        last_active: string;
    }>;

    return rows;
}

/**
 * Get the most utilized nodes in the cluster.
 *
 * @param period - Time period to query (default '24h').
 * @param limit  - Max results (default 10).
 * @returns Ranked list of nodes with request count, latency, and utilization.
 */
export function getTopNodes(
    period: MetricPeriod = '24h',
    limit: number = 10,
): TopNode[] {
    ensureReady();
    const db = getDb();
    const hours = periodToHours(period);
    const since = sinceHoursAgo(hours);

    const rows = db.prepare(`
        SELECT
            node_id,
            COUNT(*) as request_count,
            AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) as avg_latency_ms
        FROM inference_log
        WHERE created_at >= ?
        GROUP BY node_id
        ORDER BY request_count DESC
        LIMIT ?
    `).all(since, limit) as Array<{
        node_id: string;
        request_count: number;
        avg_latency_ms: number | null;
    }>;

    const allNodes = getAllNodes();

    return rows.map(r => {
        const node = allNodes.find(n => n.id === r.node_id);
        const uptime = getNodeUptime(r.node_id, hours);
        const gpuUtil = node?.latest_stats?.gpus
            ? round(
                node.latest_stats.gpus.reduce((s, g) => s + g.utilizationPct, 0)
                    / Math.max(node.latest_stats.gpus.length, 1),
                1,
              )
            : 0;

        return {
            node_id: r.node_id,
            hostname: node?.hostname ?? 'unknown',
            request_count: r.request_count,
            avg_latency_ms: round(r.avg_latency_ms ?? 0, 1),
            uptime_pct: uptime.uptime_pct,
            gpu_utilization_pct: gpuUtil,
        };
    });
}

/**
 * Determine the busiest hours of the day based on inference request volume.
 *
 * Analyzes the last 7 days to find representative peak usage patterns.
 *
 * @returns 24 hourly buckets with request counts, sorted by volume (descending).
 */
export function getPeakHours(): PeakHour[] {
    ensureReady();
    const db = getDb();

    const rows = db.prepare(`
        SELECT
            CAST(strftime('%H', created_at) AS INTEGER) as hour,
            COUNT(*) as request_count,
            AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) as avg_latency_ms
        FROM inference_log
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY hour
        ORDER BY request_count DESC
    `).all() as Array<{
        hour: number;
        request_count: number;
        avg_latency_ms: number | null;
    }>;

    // Build a map from 0..23, filling in missing hours
    const hourMap = new Map<number, PeakHour>();
    for (let h = 0; h < 24; h++) {
        const label = `${h.toString().padStart(2, '0')}:00 - ${((h + 1) % 24).toString().padStart(2, '0')}:00`;
        hourMap.set(h, { hour: h, request_count: 0, avg_latency_ms: 0, label });
    }

    for (const r of rows) {
        const entry = hourMap.get(r.hour)!;
        entry.request_count = r.request_count;
        entry.avg_latency_ms = round(r.avg_latency_ms ?? 0, 1);
    }

    return Array.from(hourMap.values()).sort((a, b) => b.request_count - a.request_count);
}

/**
 * Get the distribution of requests by model, namespace, backend, and hour.
 *
 * @returns Full request distribution breakdown for the last 24 hours.
 */
export function getRequestDistribution(): RequestDistribution {
    ensureReady();
    const db = getDb();

    // By model
    const byModel = db.prepare(`
        SELECT model, COUNT(*) as count
        FROM inference_log
        WHERE created_at >= datetime('now', '-24 hours')
        GROUP BY model ORDER BY count DESC
    `).all() as Array<{ model: string; count: number }>;

    const modelTotal = byModel.reduce((s, r) => s + r.count, 0);

    // By namespace (from inference_traces, or empty if unavailable)
    let byNamespace: Array<{ namespace: string; count: number }> = [];
    try {
        byNamespace = db.prepare(`
            SELECT namespace, COUNT(*) as count
            FROM inference_traces
            WHERE timestamp >= datetime('now', '-24 hours')
            GROUP BY namespace ORDER BY count DESC
        `).all() as Array<{ namespace: string; count: number }>;
    } catch {
        // Table may not exist
    }
    const nsTotal = byNamespace.reduce((s, r) => s + r.count, 0);

    // By backend (from inference_traces, or empty)
    let byBackend: Array<{ backend: string; count: number }> = [];
    try {
        byBackend = db.prepare(`
            SELECT backend, COUNT(*) as count
            FROM inference_traces
            WHERE timestamp >= datetime('now', '-24 hours')
            GROUP BY backend ORDER BY count DESC
        `).all() as Array<{ backend: string; count: number }>;
    } catch {
        // Table may not exist
    }
    const backendTotal = byBackend.reduce((s, r) => s + r.count, 0);

    // By hour
    const byHour = db.prepare(`
        SELECT
            CAST(strftime('%H', created_at) AS INTEGER) as hour,
            COUNT(*) as count
        FROM inference_log
        WHERE created_at >= datetime('now', '-24 hours')
        GROUP BY hour ORDER BY hour ASC
    `).all() as Array<{ hour: number; count: number }>;

    // Fill in missing hours
    const hourMap = new Map<number, number>();
    for (let h = 0; h < 24; h++) hourMap.set(h, 0);
    for (const r of byHour) hourMap.set(r.hour, r.count);

    return {
        by_model: byModel.map(r => ({
            model: r.model,
            count: r.count,
            pct: modelTotal > 0 ? round((r.count / modelTotal) * 100, 1) : 0,
        })),
        by_namespace: byNamespace.map(r => ({
            namespace: r.namespace,
            count: r.count,
            pct: nsTotal > 0 ? round((r.count / nsTotal) * 100, 1) : 0,
        })),
        by_backend: byBackend.map(r => ({
            backend: r.backend,
            count: r.count,
            pct: backendTotal > 0 ? round((r.count / backendTotal) * 100, 1) : 0,
        })),
        by_hour: Array.from(hourMap.entries())
            .map(([hour, count]) => ({ hour, count }))
            .sort((a, b) => a.hour - b.hour),
    };
}

// =============================================================================
// 4. Health Analytics
// =============================================================================

/**
 * Generate an uptime report for a given period.
 *
 * @param period - Time period to report on.
 * @returns Per-node and cluster-wide uptime data.
 */
export function getUptimeReport(period: MetricPeriod = '24h'): UptimeReport {
    ensureReady();
    const db = getDb();
    const hours = periodToHours(period);
    const allNodes = getAllNodes();

    const nodeReports: UptimeReport['nodes'] = [];

    for (const node of allNodes) {
        const uptime = getNodeUptime(node.id, hours);

        // Count outage events (transitions to offline)
        const since = sinceHoursAgo(hours);
        const outageRow = db.prepare(`
            SELECT COUNT(*) as cnt FROM uptime_events
            WHERE node_id = ? AND created_at >= ? AND to_status = 'offline'
        `).get(node.id, since) as { cnt: number };

        nodeReports.push({
            node_id: node.id,
            hostname: node.hostname,
            uptime_pct: uptime.uptime_pct,
            total_online_hours: round(uptime.total_online_s / 3600, 1),
            total_offline_hours: round(uptime.total_offline_s / 3600, 1),
            outage_count: outageRow.cnt,
        });
    }

    const clusterUptime = nodeReports.length > 0
        ? round(nodeReports.reduce((s, n) => s + n.uptime_pct, 0) / nodeReports.length, 1)
        : 100;

    // Find worst and best nodes
    const sorted = [...nodeReports].sort((a, b) => a.uptime_pct - b.uptime_pct);
    const worstNode = sorted.length > 0 ? sorted[0].node_id : null;
    const bestNode = sorted.length > 0 ? sorted[sorted.length - 1].node_id : null;

    return {
        period: periodLabel(period),
        cluster_uptime_pct: clusterUptime,
        nodes: nodeReports,
        worst_node: worstNode,
        best_node: bestNode,
    };
}

/**
 * Get the incident history for a given period.
 *
 * Incidents are recorded in the platform_incidents table (node failures,
 * model crashes, SLA breaches, etc.).
 *
 * @param period - Time period to query.
 * @returns Array of incidents ordered by most recent first.
 */
export function getIncidentHistory(period: MetricPeriod = '24h'): Incident[] {
    ensureReady();
    const db = getDb();
    const since = sinceHoursAgo(periodToHours(period));

    return db.prepare(`
        SELECT * FROM platform_incidents
        WHERE started_at >= ?
        ORDER BY started_at DESC
    `).all(since) as Incident[];
}

/**
 * Record a new platform incident.
 *
 * @param nodeId   - The node involved.
 * @param type     - Incident type.
 * @param severity - Severity level.
 * @param message  - Human-readable description.
 */
export function recordIncident(
    nodeId: string,
    type: Incident['type'],
    severity: Incident['severity'],
    message: string,
): void {
    ensureReady();
    const db = getDb();
    db.prepare(`
        INSERT INTO platform_incidents (node_id, type, severity, message)
        VALUES (?, ?, ?, ?)
    `).run(nodeId, type, severity, message);
}

/**
 * Resolve an open incident by setting its resolved_at timestamp and duration.
 *
 * @param incidentId - The ID of the incident to resolve.
 */
export function resolveIncident(incidentId: number): void {
    ensureReady();
    const db = getDb();
    db.prepare(`
        UPDATE platform_incidents
        SET resolved_at = datetime('now'),
            duration_s = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
        WHERE id = ? AND resolved_at IS NULL
    `).run(incidentId);
}

/**
 * Calculate Mean Time Between Failures (MTBF) per node.
 *
 * MTBF is the average time between consecutive failure events over the
 * observation window (default 30 days).
 *
 * @returns Per-node MTBF data sorted by shortest MTBF first (worst reliability first).
 */
export function getMTBF(): MTBFResult[] {
    ensureReady();
    const allNodes = getAllNodes();
    const observationHours = 720; // 30 days
    const since = sinceHoursAgo(observationHours);
    const db = getDb();

    const results: MTBFResult[] = [];

    for (const node of allNodes) {
        const failureRow = db.prepare(`
            SELECT COUNT(*) as cnt FROM uptime_events
            WHERE node_id = ? AND created_at >= ? AND to_status IN ('offline', 'error')
        `).get(node.id, since) as { cnt: number };

        const failureCount = failureRow.cnt;
        const mtbfHours = failureCount > 0
            ? round(observationHours / failureCount, 1)
            : observationHours; // No failures = MTBF is the full observation window

        results.push({
            node_id: node.id,
            hostname: node.hostname,
            mtbf_hours: mtbfHours,
            failure_count: failureCount,
            observation_hours: observationHours,
        });
    }

    return results.sort((a, b) => a.mtbf_hours - b.mtbf_hours);
}

/**
 * Calculate Mean Time To Recovery (MTTR) per node.
 *
 * MTTR is the average time from a failure event to the next recovery event
 * (transition back to online) over the last 30 days.
 *
 * @returns Per-node MTTR data sorted by longest recovery time first.
 */
export function getMTTR(): MTTRResult[] {
    ensureReady();
    const allNodes = getAllNodes();
    const since = sinceHoursAgo(720); // 30 days
    const db = getDb();

    const results: MTTRResult[] = [];

    for (const node of allNodes) {
        const events = db.prepare(`
            SELECT to_status, created_at FROM uptime_events
            WHERE node_id = ? AND created_at >= ?
            ORDER BY created_at ASC
        `).all(node.id, since) as Array<{ to_status: string; created_at: string }>;

        let totalRecoveryMs = 0;
        let recoveryCount = 0;
        let lastFailureTime: number | null = null;

        for (const evt of events) {
            const evtTime = new Date(evt.created_at + 'Z').getTime();

            if (evt.to_status === 'offline' || evt.to_status === 'error') {
                lastFailureTime = evtTime;
            } else if (evt.to_status === 'online' && lastFailureTime !== null) {
                totalRecoveryMs += evtTime - lastFailureTime;
                recoveryCount++;
                lastFailureTime = null;
            }
        }

        const mttrMinutes = recoveryCount > 0
            ? round(totalRecoveryMs / recoveryCount / 60_000, 1)
            : 0;

        results.push({
            node_id: node.id,
            hostname: node.hostname,
            mttr_minutes: mttrMinutes,
            recovery_count: recoveryCount,
        });
    }

    return results.sort((a, b) => b.mttr_minutes - a.mttr_minutes);
}

// =============================================================================
// 5. Executive Dashboard
// =============================================================================

/**
 * Generate a comprehensive executive summary suitable for management review.
 *
 * Combines cluster size, inference volume, cost savings, uptime, and
 * reliability data into a single one-page summary with actionable
 * recommendations.
 *
 * @returns Executive summary with all key metrics and recommendations.
 */
export function getExecutiveSummary(): ExecutiveSummary {
    ensureReady();
    const metrics = getPlatformMetrics();
    const uptimeReport = getUptimeReport('7d');
    const mtbfData = getMTBF();
    const mttrData = getMTTR();
    const topModels = getTopModels('7d', 5);
    const peakHours = getPeakHours();
    const costDashboard = getCostDashboard();
    const cloudComp = getCloudComparison();
    const incidentCount = getIncidentHistory('7d').length;

    // Growth trend for inference volume
    const requestTrend = getGrowthTrend('totalRequestsAllTime', 7);

    // Average MTBF across all nodes
    const avgMtbf = mtbfData.length > 0
        ? round(mtbfData.reduce((s, n) => s + n.mtbf_hours, 0) / mtbfData.length, 1)
        : 0;

    // Average MTTR across nodes with recoveries
    const nodesWithRecoveries = mttrData.filter(n => n.recovery_count > 0);
    const avgMttr = nodesWithRecoveries.length > 0
        ? round(nodesWithRecoveries.reduce((s, n) => s + n.mttr_minutes, 0) / nodesWithRecoveries.length, 1)
        : 0;

    // Busiest hour label
    const busiestHour = peakHours.length > 0 ? peakHours[0].label : 'N/A';

    // Cloud savings (use the highest savings across providers)
    const maxSavings = Math.max(
        cloudComp.savings['vs_openai'] || 0,
        cloudComp.savings['vs_anthropic'] || 0,
        cloudComp.savings['vs_together'] || 0,
        cloudComp.savings['vs_runpod'] || 0,
    );

    // Cluster growth indicator
    const nodeGrowth = getGrowthTrend('totalNodes', 7);
    const growthLabel = nodeGrowth.direction === 'up'
        ? `+${nodeGrowth.change_pct}% nodes`
        : nodeGrowth.direction === 'down'
            ? `${nodeGrowth.change_pct}% nodes`
            : 'Stable';

    // Generate actionable recommendations
    const recommendations: string[] = [];

    if (uptimeReport.cluster_uptime_pct < 99) {
        recommendations.push(
            `Cluster uptime is ${uptimeReport.cluster_uptime_pct}% — investigate ${uptimeReport.worst_node ?? 'struggling'} nodes.`,
        );
    }
    if (metrics.p95LatencyMs > 5000) {
        recommendations.push(
            `p95 latency is ${metrics.p95LatencyMs}ms — consider adding more nodes or optimizing model placement.`,
        );
    }
    if (metrics.onlineNodes < metrics.totalNodes) {
        const offlineCount = metrics.totalNodes - metrics.onlineNodes;
        recommendations.push(
            `${offlineCount} node(s) offline — check connectivity and agent health.`,
        );
    }
    if (avgMttr > 30) {
        recommendations.push(
            `Average recovery time is ${avgMttr} minutes — automate watchdog recovery or add redundancy.`,
        );
    }
    if (topModels.length > 0 && topModels[0].error_rate_pct > 5) {
        recommendations.push(
            `Top model "${topModels[0].model}" has ${topModels[0].error_rate_pct}% error rate — investigate failures.`,
        );
    }
    if (metrics.modelsLoaded === 0) {
        recommendations.push('No models currently loaded — deploy models via flight sheets or CLAWHub.');
    }
    if (recommendations.length === 0) {
        recommendations.push('All systems nominal. Keep up the good work.');
    }

    return {
        generated_at: new Date().toISOString(),
        period: 'Last 7 days',

        cluster: {
            total_nodes: metrics.totalNodes,
            total_gpus: metrics.totalGpus,
            total_vram_gb: metrics.totalVramGb,
            online_nodes: metrics.onlineNodes,
            growth_vs_last_period: growthLabel,
        },

        inference: {
            total_requests: metrics.requestsThisWeek,
            total_tokens: metrics.totalTokensAllTime,
            avg_latency_ms: metrics.avgLatencyMs,
            p95_latency_ms: metrics.p95LatencyMs,
            growth_trend: requestTrend.summary,
            busiest_hour: busiestHour,
        },

        cost: {
            monthly_estimate: metrics.monthlyCostEstimate,
            cost_per_million_tokens: costDashboard.cost_per_million_tokens,
            cloud_savings_monthly: maxSavings,
            tokens_per_dollar: metrics.tokensPerDollar,
            currency: costDashboard.currency,
        },

        reliability: {
            cluster_uptime_pct: uptimeReport.cluster_uptime_pct,
            avg_node_uptime_pct: metrics.avgNodeUptimePct,
            incidents_this_period: incidentCount,
            mtbf_hours: avgMtbf,
            mttr_minutes: avgMttr,
        },

        top_models: topModels.map(m => ({ model: m.model, requests: m.request_count })),

        recommendations,
    };
}

// =============================================================================
// 6. Export & Scheduled Reports
// =============================================================================

/**
 * Export analytics data in the specified format for a given period.
 *
 * - 'json'     — Returns the full analytics object with summary.
 * - 'csv'      — Returns a CSV-formatted string with metric snapshots.
 * - 'pdf-data' — Returns structured data suitable for PDF rendering.
 *
 * @param format - Output format.
 * @param period - Time period to export.
 * @returns Exported analytics data in the chosen format.
 */
export function exportAnalytics(
    format: ExportFormat,
    period: MetricPeriod = '30d',
): ExportedAnalytics {
    ensureReady();
    const db = getDb();
    const since = sinceHoursAgo(periodToHours(period));

    const snapshots = db.prepare(`
        SELECT snapshot, captured_at FROM platform_metrics_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC
    `).all(since) as Array<{ snapshot: string; captured_at: string }>;

    const parsed = snapshots.map(r => ({
        captured_at: r.captured_at,
        ...(JSON.parse(r.snapshot) as PlatformMetrics),
    }));

    let data: unknown;

    switch (format) {
        case 'json':
            data = {
                period: periodLabel(period),
                snapshot_count: parsed.length,
                snapshots: parsed,
                summary: getExecutiveSummary(),
            };
            break;

        case 'csv': {
            if (parsed.length === 0) {
                data = '';
                break;
            }
            const headers = Object.keys(parsed[0]);
            const csvLines: string[] = [headers.join(',')];
            for (const row of parsed) {
                const values = headers.map(h => {
                    const val = (row as Record<string, unknown>)[h];
                    if (typeof val === 'string' && val.includes(',')) {
                        return `"${val}"`;
                    }
                    return String(val ?? '');
                });
                csvLines.push(values.join(','));
            }
            data = csvLines.join('\n');
            break;
        }

        case 'pdf-data':
            data = {
                title: `TentaCLAW Analytics Report — ${periodLabel(period)}`,
                generated_at: new Date().toISOString(),
                executive_summary: getExecutiveSummary(),
                top_models: getTopModels(period, 10),
                top_nodes: getTopNodes(period, 10),
                uptime_report: getUptimeReport(period),
                peak_hours: getPeakHours(),
                incident_history: getIncidentHistory(period),
                snapshot_count: parsed.length,
            };
            break;
    }

    return {
        format,
        period,
        generated_at: new Date().toISOString(),
        data,
    };
}

/**
 * Schedule a weekly analytics report to be generated every Monday at 09:00.
 *
 * If email is provided, the report target is stored for delivery.
 * The actual sending must be handled by a cron job or timer that calls
 * exportAnalytics('json', '7d') and delivers the result.
 *
 * @param email - Optional email address for report delivery.
 * @returns The current schedule configuration.
 */
export function scheduleWeeklyReport(email?: string): WeeklyReportSchedule {
    ensureReady();
    const db = getDb();

    // Calculate next Monday at 09:00
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    const nextSendAt = nextMonday.toISOString().replace('T', ' ').slice(0, 19);

    const existing = db.prepare('SELECT * FROM weekly_report_config WHERE id = 1').get() as {
        enabled: number;
        email: string | null;
        last_sent_at: string | null;
        next_send_at: string | null;
    } | undefined;

    if (existing) {
        db.prepare(`
            UPDATE weekly_report_config
            SET enabled = 1, email = ?, next_send_at = ?
            WHERE id = 1
        `).run(email ?? existing.email, nextSendAt);
    } else {
        db.prepare(`
            INSERT INTO weekly_report_config (id, enabled, email, next_send_at)
            VALUES (1, 1, ?, ?)
        `).run(email ?? null, nextSendAt);
    }

    return {
        enabled: true,
        email: email ?? existing?.email ?? null,
        last_sent_at: existing?.last_sent_at ?? null,
        next_send_at: nextSendAt,
    };
}

/**
 * Get the current weekly report schedule configuration.
 *
 * @returns Schedule config, or a disabled default if none exists.
 */
export function getWeeklyReportSchedule(): WeeklyReportSchedule {
    ensureReady();
    const db = getDb();

    const row = db.prepare('SELECT * FROM weekly_report_config WHERE id = 1').get() as {
        enabled: number;
        email: string | null;
        last_sent_at: string | null;
        next_send_at: string | null;
    } | undefined;

    if (!row) {
        return {
            enabled: false,
            email: null,
            last_sent_at: null,
            next_send_at: '',
        };
    }

    return {
        enabled: row.enabled === 1,
        email: row.email,
        last_sent_at: row.last_sent_at,
        next_send_at: row.next_send_at ?? '',
    };
}

/**
 * Disable the weekly report schedule.
 */
export function disableWeeklyReport(): void {
    ensureReady();
    const db = getDb();
    db.prepare('UPDATE weekly_report_config SET enabled = 0 WHERE id = 1').run();
}
