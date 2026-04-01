/**
 * TentaCLAW Gateway — Stats Operations
 */

import type { StatsPayload, Node, NodeWithStats } from '../../../shared/types';
import { getDb } from './init';
import { recordUptimeEvent } from './misc';

/**
 * Helper: fetch all nodes with their latest stats payload.
 * Inlined here to avoid a circular dependency with nodes.ts.
 */
function _getAllNodesWithStats(): NodeWithStats[] {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes ORDER BY last_seen_at DESC').all() as Node[];
    return nodes.map(node => {
        const latestStat = d.prepare(
            'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(node.id) as { payload: string } | undefined;
        return {
            ...node,
            latest_stats: latestStat ? JSON.parse(latestStat.payload) : null,
        };
    });
}

// =============================================================================
// Stats Operations
// =============================================================================

export function insertStats(nodeId: string, payload: StatsPayload): void {
    const d = getDb();

    d.prepare(`
        INSERT INTO stats (node_id, payload, gpu_count, cpu_usage_pct, ram_used_mb, ram_total_mb, toks_per_sec)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        nodeId,
        JSON.stringify(payload),
        payload.gpu_count,
        payload.cpu.usage_pct,
        payload.ram.used_mb,
        payload.ram.total_mb,
        payload.toks_per_sec
    );

    // Update node last_seen and status -- track state transition for uptime
    const current = d.prepare('SELECT status FROM nodes WHERE id = ?').get(nodeId) as { status: string } | undefined;
    if (current && current.status !== 'online') {
        recordUptimeEvent(nodeId, 'stats_online', current.status, 'online');
    }
    d.prepare(`
        UPDATE nodes SET last_seen_at = datetime('now'), status = 'online', gpu_count = ?
        WHERE id = ?
    `).run(payload.gpu_count, nodeId);
}

export function getStatsHistory(nodeId: string, limit: number = 100): StatsPayload[] {
    const d = getDb();
    const rows = d.prepare(
        'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(nodeId, limit) as { payload: string }[];

    return rows.map(r => JSON.parse(r.payload));
}

/**
 * Prune stats older than `days` days to keep the DB lean.
 */
export function pruneStats(days: number = 7): number {
    const d = getDb();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const result = d.prepare('DELETE FROM stats WHERE timestamp < ?').run(cutoff);
    return result.changes;
}

/**
 * Get a compact stats history for sparklines: last N data points with key fields extracted.
 */
export function getCompactHistory(nodeId: string, limit: number = 60): {
    timestamps: string[];
    gpu_temps: number[][];
    gpu_utils: number[][];
    cpu_usage: number[];
    ram_pct: number[];
    toks_per_sec: number[];
} {
    const d = getDb();
    const rows = d.prepare(
        'SELECT payload, timestamp FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(nodeId, limit) as { payload: string; timestamp: string }[];

    // Reverse so oldest first (for chart rendering)
    rows.reverse();

    const timestamps: string[] = [];
    const gpuTemps: number[][] = [];
    const gpuUtils: number[][] = [];
    const cpuUsage: number[] = [];
    const ramPct: number[] = [];
    const toksSec: number[] = [];

    for (const row of rows) {
        const stats: StatsPayload = JSON.parse(row.payload);
        timestamps.push(row.timestamp);
        cpuUsage.push(stats.cpu.usage_pct);
        ramPct.push(stats.ram.total_mb > 0 ? Math.round((stats.ram.used_mb / stats.ram.total_mb) * 100) : 0);
        toksSec.push(stats.toks_per_sec);

        const temps: number[] = [];
        const utils: number[] = [];
        for (const gpu of stats.gpus) {
            temps.push(gpu.temperatureC);
            utils.push(gpu.utilizationPct);
        }
        gpuTemps.push(temps);
        gpuUtils.push(utils);
    }

    return { timestamps, gpu_temps: gpuTemps, gpu_utils: gpuUtils, cpu_usage: cpuUsage, ram_pct: ramPct, toks_per_sec: toksSec };
}

// =============================================================================
// Inference Analytics
// =============================================================================

export function logInferenceRequest(nodeId: string, model: string, latencyMs: number, success: boolean, tokensIn?: number, tokensOut?: number, error?: string): void {
    const d = getDb();
    d.prepare(`INSERT INTO inference_log (node_id, model, latency_ms, tokens_in, tokens_out, success, error) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        nodeId, model, latencyMs, tokensIn || 0, tokensOut || 0, success ? 1 : 0, error || null
    );
}

export function getInferenceAnalytics(hours: number = 24): {
    total_requests: number;
    successful: number;
    failed: number;
    avg_latency_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
    total_tokens_in: number;
    total_tokens_out: number;
    requests_per_minute: number;
    by_model: Array<{ model: string; count: number; avg_latency_ms: number; error_rate_pct: number }>;
    by_node: Array<{ node_id: string; count: number; avg_latency_ms: number; error_rate_pct: number }>;
} {
    const d = getDb();
    const since = new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

    const rows = d.prepare('SELECT * FROM inference_log WHERE created_at >= ? ORDER BY latency_ms').all(since) as any[];

    const successful = rows.filter(r => r.success);
    const latencies = successful.map(r => r.latency_ms).sort((a: number, b: number) => a - b);

    const p = (pct: number) => latencies.length > 0 ? latencies[Math.floor(latencies.length * pct / 100)] || 0 : 0;

    // By model
    const modelMap = new Map<string, { count: number; totalLatency: number; errors: number }>();
    for (const r of rows) {
        const entry = modelMap.get(r.model) || { count: 0, totalLatency: 0, errors: 0 };
        entry.count++;
        entry.totalLatency += r.latency_ms;
        if (!r.success) entry.errors++;
        modelMap.set(r.model, entry);
    }

    // By node
    const nodeMap = new Map<string, { count: number; totalLatency: number; errors: number }>();
    for (const r of rows) {
        const entry = nodeMap.get(r.node_id) || { count: 0, totalLatency: 0, errors: 0 };
        entry.count++;
        entry.totalLatency += r.latency_ms;
        if (!r.success) entry.errors++;
        nodeMap.set(r.node_id, entry);
    }

    const elapsedMin = Math.max(1, hours * 60);

    return {
        total_requests: rows.length,
        successful: successful.length,
        failed: rows.length - successful.length,
        avg_latency_ms: latencies.length > 0 ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length) : 0,
        p50_latency_ms: p(50),
        p95_latency_ms: p(95),
        p99_latency_ms: p(99),
        total_tokens_in: rows.reduce((s: number, r: any) => s + (r.tokens_in || 0), 0),
        total_tokens_out: rows.reduce((s: number, r: any) => s + (r.tokens_out || 0), 0),
        requests_per_minute: Math.round((rows.length / elapsedMin) * 10) / 10,
        by_model: [...modelMap.entries()].map(([model, v]) => ({
            model,
            count: v.count,
            avg_latency_ms: Math.round(v.totalLatency / v.count),
            error_rate_pct: Math.round((v.errors / v.count) * 1000) / 10,
        })).sort((a, b) => b.count - a.count),
        by_node: [...nodeMap.entries()].map(([node_id, v]) => ({
            node_id,
            count: v.count,
            avg_latency_ms: Math.round(v.totalLatency / v.count),
            error_rate_pct: Math.round((v.errors / v.count) * 1000) / 10,
        })).sort((a, b) => b.count - a.count),
    };
}

// =============================================================================
// Smart Load Balancer -- Circuit Breaker + VRAM-Aware Routing
// =============================================================================

const nodeErrorCounts = new Map<string, { errors: number; lastError: number; blocked: boolean }>();
const requestLog: Array<{ time: number; nodeId: string; model: string; latencyMs: number; success: boolean }> = [];

export function recordRouteResult(nodeId: string, model: string, latencyMs: number, success: boolean): void {
    requestLog.push({ time: Date.now(), nodeId, model, latencyMs, success });
    if (requestLog.length > 10000) requestLog.splice(0, 5000);

    if (!success) {
        const entry = nodeErrorCounts.get(nodeId) || { errors: 0, lastError: 0, blocked: false };
        entry.errors++;
        entry.lastError = Date.now();
        if (entry.errors >= 5) {
            entry.blocked = true;
            console.log(`[lb] Circuit breaker OPEN for ${nodeId} -- ${entry.errors} errors`);
        }
        nodeErrorCounts.set(nodeId, entry);
    } else {
        nodeErrorCounts.delete(nodeId);
    }
}

function isNodeBlocked(nodeId: string): boolean {
    const entry = nodeErrorCounts.get(nodeId);
    if (!entry || !entry.blocked) return false;
    if (Date.now() - entry.lastError > 60000) {
        entry.blocked = false;
        entry.errors = 0;
        return false;
    }
    return true;
}

export function getRequestStats(): { total: number; last_hour: number; avg_latency_ms: number; error_rate_pct: number } {
    const now = Date.now();
    const lastHour = requestLog.filter(r => now - r.time < 3600000);
    const avgLatency = lastHour.length > 0 ? lastHour.reduce((s, r) => s + r.latencyMs, 0) / lastHour.length : 0;
    const errorRate = lastHour.length > 0 ? lastHour.filter(r => !r.success).length / lastHour.length * 100 : 0;
    return { total: requestLog.length, last_hour: lastHour.length, avg_latency_ms: Math.round(avgLatency), error_rate_pct: Math.round(errorRate * 10) / 10 };
}

// =============================================================================
// Latency & Throughput Tracking (Advanced Inference Routing)
// =============================================================================

export function recordRouteLatency(nodeId: string, model: string, latencyMs: number): void {
    const d = getDb();
    d.prepare('INSERT INTO route_latency (node_id, model, latency_ms) VALUES (?, ?, ?)').run(nodeId, model, latencyMs);
    d.prepare(`
        DELETE FROM route_latency WHERE id NOT IN (
            SELECT id FROM route_latency WHERE node_id = ? AND model = ?
            ORDER BY created_at DESC LIMIT 200
        ) AND node_id = ? AND model = ?
    `).run(nodeId, model, nodeId, model);
}

export function getNodeLatencyP50(nodeId: string, model: string): number {
    const d = getDb();
    const rows = d.prepare(
        'SELECT latency_ms FROM route_latency WHERE node_id = ? AND model = ? ORDER BY latency_ms ASC'
    ).all(nodeId, model) as { latency_ms: number }[];
    if (rows.length === 0) return 0;
    const mid = Math.floor(rows.length / 2);
    if (rows.length % 2 === 0) {
        return (rows[mid - 1].latency_ms + rows[mid].latency_ms) / 2;
    }
    return rows[mid].latency_ms;
}

export function recordRouteThroughput(nodeId: string, model: string, tokensPerSec: number): void {
    const d = getDb();
    d.prepare('INSERT INTO route_throughput (node_id, model, tokens_per_sec) VALUES (?, ?, ?)').run(nodeId, model, tokensPerSec);
    d.prepare(`
        DELETE FROM route_throughput WHERE id NOT IN (
            SELECT id FROM route_throughput WHERE node_id = ? AND model = ?
            ORDER BY created_at DESC LIMIT 200
        ) AND node_id = ? AND model = ?
    `).run(nodeId, model, nodeId, model);
}

export function getNodeThroughput(nodeId: string, model: string): number {
    const d = getDb();
    const row = d.prepare(
        'SELECT AVG(tokens_per_sec) as avg_tps FROM route_throughput WHERE node_id = ? AND model = ?'
    ).get(nodeId, model) as { avg_tps: number | null } | undefined;
    return row?.avg_tps ?? 0;
}

// =============================================================================
// Inference Routing (find best node for a model)
// =============================================================================

export interface InferenceTarget {
    node_id: string;
    hostname: string;
    ip_address: string | null;
    gpu_utilization_avg: number;
    in_flight_requests: number;
    backend_type: string;
    backend_port: number;
}

export function findBestNode(model: string): InferenceTarget | null {
    const nodes = _getAllNodesWithStats();
    const candidates: (InferenceTarget & { score: number })[] = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (isNodeBlocked(node.id)) continue;

        const hasModel = node.latest_stats.inference.loaded_models.some(
            (m: string) => m === model || m.startsWith(model.split(':')[0])
        );
        if (!hasModel) continue;

        const gpuUtils = node.latest_stats.gpus.map((g: any) => g.utilizationPct);
        const avgUtil = gpuUtils.length > 0 ? gpuUtils.reduce((a: number, b: number) => a + b, 0) / gpuUtils.length : 100;

        const totalVram = node.latest_stats.gpus.reduce((s: number, g: any) => s + g.vramTotalMb, 0);
        const usedVram = node.latest_stats.gpus.reduce((s: number, g: any) => s + g.vramUsedMb, 0);
        const vramHeadroom = totalVram > 0 ? ((totalVram - usedVram) / totalVram) * 100 : 0;

        const latencyP50 = getNodeLatencyP50(node.id, model);
        const throughput = getNodeThroughput(node.id, model);

        const score = (node.latest_stats.inference.in_flight_requests * 40) +
                      (avgUtil * 0.3) +
                      ((100 - vramHeadroom) * 0.3) +
                      (latencyP50 * 0.1) -
                      (throughput * 0.05);

        const backend = (node.latest_stats as any).backend;
        const backendType = backend?.type || 'ollama';
        const backendPort = backend?.port || 11434;

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address,
            gpu_utilization_avg: avgUtil,
            in_flight_requests: node.latest_stats.inference.in_flight_requests,
            backend_type: backendType,
            backend_port: backendPort,
            score: Math.round(score * 10) / 10,
        });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
}

/**
 * Get all unique models loaded across the cluster.
 */
export function getClusterModels(): { model: string; node_count: number; nodes: string[] }[] {
    const nodes = _getAllNodesWithStats();
    const modelMap = new Map<string, string[]>();

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        for (const model of node.latest_stats.inference.loaded_models) {
            const list = modelMap.get(model) || [];
            list.push(node.id);
            modelMap.set(model, list);
        }
    }

    return [...modelMap.entries()].map(([model, nodeIds]) => ({
        model,
        node_count: nodeIds.length,
        nodes: nodeIds,
    }));
}

/**
 * Get model preload hints -- models likely to be requested next.
 */
export function getModelPreloadHints(): string[] {
    const d = getDb();

    const recentModels = d.prepare(`
        SELECT model, COUNT(*) as cnt
        FROM inference_log
        WHERE created_at >= datetime('now', '-6 hours')
        GROUP BY model
        ORDER BY cnt DESC
        LIMIT 10
    `).all() as { model: string; cnt: number }[];

    if (recentModels.length === 0) return [];

    const loadedModels = new Set<string>();
    const nodes = _getAllNodesWithStats();
    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        for (const m of node.latest_stats.inference.loaded_models) {
            loadedModels.add(m);
        }
    }

    const hints: string[] = [];
    for (const { model } of recentModels) {
        if (!loadedModels.has(model)) {
            hints.push(model);
        }
    }
    return hints;
}
