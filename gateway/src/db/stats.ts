/**
 * TentaCLAW Gateway — Stats Operations
 */

import type { StatsPayload, Node, NodeWithStats } from '../../../shared/types';
import { getDb } from './init';
import { recordUptimeEvent } from './misc';
import { safeJsonParse } from './safe-json';

/**
 * Helper: fetch all nodes with their latest stats payload.
 * Inlined here to avoid a circular dependency with nodes.ts.
 */
function _normalizeStats(stats: any): any {
    if (!stats) return null;
    if (!stats.inference || typeof stats.inference !== 'object') {
        stats.inference = { loaded_models: [], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 };
    }
    if (!Array.isArray(stats.inference.loaded_models)) {
        stats.inference.loaded_models = [];
    }
    if (!Array.isArray(stats.gpus)) {
        stats.gpus = [];
    }
    return stats;
}

function _getAllNodesWithStats(): NodeWithStats[] {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes ORDER BY last_seen_at DESC').all() as Node[];
    return nodes.map(node => {
        const latestStat = d.prepare(
            'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(node.id) as { payload: string } | undefined;
        return {
            ...node,
            latest_stats: latestStat ? _normalizeStats(safeJsonParse(latestStat.payload, null)) : null,
        };
    });
}

// =============================================================================
// Stats Operations
// =============================================================================

export function insertStats(nodeId: string, payload: StatsPayload): void {
    const d = getDb();
    const txn = d.transaction(() => {
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
    });
    txn();
}

export function getStatsHistory(nodeId: string, limit: number = 100): StatsPayload[] {
    const d = getDb();
    const rows = d.prepare(
        'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(nodeId, limit) as { payload: string }[];

    return rows.map(r => safeJsonParse(r.payload, {} as StatsPayload));
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
        const stats: StatsPayload = safeJsonParse(row.payload, null as any);
        if (!stats || !stats.cpu || !stats.ram || !stats.gpus) continue;
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

// Purge stale nodeErrorCounts entries every 5 minutes to prevent memory leak
const NODE_ERROR_STALE_MS = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
    const cutoff = Date.now() - NODE_ERROR_STALE_MS;
    for (const [nodeId, entry] of nodeErrorCounts) {
        if (entry.lastError < cutoff) {
            nodeErrorCounts.delete(nodeId);
        }
    }
}, 5 * 60 * 1000).unref();

// Wave 471: routing telemetry log — persisted in-memory, last 500 decisions
export interface RoutingDecision {
    time: number;
    nodeId: string;
    hostname: string;
    model: string;
    latencyMs: number;
    success: boolean;
    score: number;
    reason: string;
    vramFree_mb: number;
    inFlight: number;
    taskType?: string;
    priority?: string;
}
const routingLog: RoutingDecision[] = [];

// Wave 467: sticky session map — user stays on same node for conversation context
const stickySessions = new Map<string, { nodeId: string; expiry: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getStickyNode(sessionKey: string): string | null {
    const entry = stickySessions.get(sessionKey);
    if (!entry) return null;
    if (Date.now() > entry.expiry) { stickySessions.delete(sessionKey); return null; }
    return entry.nodeId;
}

export function setStickyNode(sessionKey: string, nodeId: string): void {
    stickySessions.set(sessionKey, { nodeId, expiry: Date.now() + SESSION_TTL_MS });
}

export function clearStickySession(sessionKey: string): void {
    stickySessions.delete(sessionKey);
}

// Wave 471: expose routing telemetry
export function getRoutingLog(limit = 100): RoutingDecision[] {
    return routingLog.slice(-limit).reverse();
}

// Wave 461: inline VRAM estimation for routing (avoids circular dep with models.ts)
function _estimateVramForRouting(modelName: string): number {
    const known: Record<string, number> = {
        'llama3.1:8b': 5120, 'llama3.1:70b': 41000, 'llama3.2:3b': 2048, 'llama3.2:1b': 1024,
        'codellama:7b': 4608, 'codellama:13b': 8192, 'codellama:34b': 20480,
        'mistral:7b': 4608, 'mixtral:8x7b': 28672, 'qwen2.5:7b': 4608,
        'qwen2.5:3b': 2048, 'qwen3:14b': 9216, 'gemma2:9b': 5632,
        'phi3:3.8b': 2560, 'deepseek-coder-v2:16b': 10240, 'hermes3:8b': 5120,
        'nomic-embed-text': 512, 'dolphin-mistral': 4096,
    };
    if (known[modelName]) return known[modelName];
    const base = modelName.split(':')[0];
    for (const [k, v] of Object.entries(known)) { if (k.startsWith(base)) return v; }
    const m = modelName.match(/(\d+)b/i);
    return m ? parseInt(m[1]) * 600 : 4096;
}

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
    const latencyCount = d.prepare(
        'SELECT COUNT(*) as cnt FROM route_latency WHERE node_id = ? AND model = ?'
    ).get(nodeId, model) as { cnt: number };
    if (latencyCount.cnt > 250) {
        d.prepare(`
            DELETE FROM route_latency WHERE id IN (
                SELECT id FROM route_latency WHERE node_id = ? AND model = ?
                ORDER BY created_at ASC LIMIT ?
            )
        `).run(nodeId, model, latencyCount.cnt - 200);
    }
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
    const throughputCount = d.prepare(
        'SELECT COUNT(*) as cnt FROM route_throughput WHERE node_id = ? AND model = ?'
    ).get(nodeId, model) as { cnt: number };
    if (throughputCount.cnt > 250) {
        d.prepare(`
            DELETE FROM route_throughput WHERE id IN (
                SELECT id FROM route_throughput WHERE node_id = ? AND model = ?
                ORDER BY created_at ASC LIMIT ?
            )
        `).run(nodeId, model, throughputCount.cnt - 200);
    }
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

export function findBestNode(model: string, opts?: { taskType?: string; priority?: 'cost' | 'speed' | 'balanced' }): InferenceTarget | null {
    const nodes = _getAllNodesWithStats();
    const candidates: (InferenceTarget & { score: number; vramFree_mb: number; scoreReason: string })[] = [];

    // Wave 461: VRAM-primary routing — estimate required VRAM for this model
    const requiredVramMb = _estimateVramForRouting(model);

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
        const freeVramMb = totalVram - usedVram;

        const latencyP50 = getNodeLatencyP50(node.id, model);
        const throughput = getNodeThroughput(node.id, model);

        // Wave 461: heavy penalty if model likely won't fit in free VRAM
        const vramFitPenalty = (totalVram > 0 && freeVramMb < requiredVramMb) ? 200 : 0;

        // Wave 462: VRAM pressure as primary continuous factor (0-50 pts)
        const vramPressure = totalVram > 0 ? (usedVram / totalVram) * 50 : 50;

        // Wave 466: health penalty — thermal throttle zone
        let healthPenalty = 0;
        if (node.latest_stats.gpus.length > 0) {
            const maxTemp = Math.max(...node.latest_stats.gpus.map((g: any) => g.temperatureC as number));
            if (maxTemp > 85) healthPenalty = 50;      // throttling territory
            else if (maxTemp > 75) healthPenalty = 15; // approaching throttle
        }

        // Wave 475: priority-based routing modifier
        let priorityModifier = 0;
        if (opts?.priority === 'cost') {
            // Prefer lowest power draw — penalize high-watt nodes
            const totalWatts = node.latest_stats.gpus.reduce((s: number, g: any) => s + (g.powerDrawW || 0), 0);
            priorityModifier = totalWatts * 0.05;
        } else if (opts?.priority === 'speed') {
            // Prefer highest throughput — bonus for high tok/s nodes
            priorityModifier = throughput > 0 ? -(throughput * 0.3) : 0;
        }

        // Wave 469: GPU-level routing — on multi-GPU nodes, score the best individual GPU
        // This prefers nodes where at least one GPU has significant free VRAM and low utilization
        let gpuLevelBonus = 0;
        if (node.latest_stats.gpus.length > 1) {
            const bestGpu = node.latest_stats.gpus.reduce((best: any, g: any) => {
                const free = g.vramTotalMb - g.vramUsedMb;
                const bestFree = best.vramTotalMb - best.vramUsedMb;
                return free > bestFree ? g : best;
            }, node.latest_stats.gpus[0]);
            const bestGpuFree = bestGpu.vramTotalMb - bestGpu.vramUsedMb;
            // Bonus if best GPU alone can fit the model (single-GPU placement preferred)
            if (bestGpuFree >= requiredVramMb) gpuLevelBonus = -20;
        }

        const score = vramFitPenalty +
                      vramPressure +
                      healthPenalty +
                      gpuLevelBonus +
                      (node.latest_stats.inference.in_flight_requests * 40) +
                      (avgUtil * 0.3) +
                      (latencyP50 * 0.01) -
                      (throughput * 0.05) +
                      priorityModifier;

        const backend = (node.latest_stats as any).backend;
        const parts: string[] = [];
        if (vramFitPenalty > 0) parts.push('vram-tight');
        if (healthPenalty > 0) parts.push('thermal');
        if (node.latest_stats.inference.in_flight_requests > 0) parts.push(`${node.latest_stats.inference.in_flight_requests}-inflight`);
        if (opts?.priority && opts.priority !== 'balanced') parts.push(opts.priority);
        const scoreReason = parts.length > 0 ? parts.join(',') : 'healthy';

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address,
            gpu_utilization_avg: avgUtil,
            in_flight_requests: node.latest_stats.inference.in_flight_requests,
            backend_type: backend?.type || 'ollama',
            backend_port: backend?.port || 11434,
            score: Math.round(score * 10) / 10,
            vramFree_mb: freeVramMb,
            scoreReason,
        });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    // Wave 471: log routing decision
    routingLog.push({
        time: Date.now(), nodeId: best.node_id, hostname: best.hostname,
        model, latencyMs: 0, success: true, score: best.score,
        reason: best.scoreReason, vramFree_mb: best.vramFree_mb,
        inFlight: best.in_flight_requests, taskType: opts?.taskType, priority: opts?.priority,
    });
    if (routingLog.length > 500) routingLog.splice(0, 250);

    return best;
}

/**
 * Return ALL online nodes that have the model loaded, sorted by score (best first).
 * Used by the failover loop to try each candidate in order.
 * Wave 461/462/466: same scoring logic as findBestNode.
 */
export function findNodesForModel(model: string, opts?: { taskType?: string; priority?: 'cost' | 'speed' | 'balanced' }): InferenceTarget[] {
    const nodes = _getAllNodesWithStats();
    const candidates: (InferenceTarget & { score: number })[] = [];
    const requiredVramMb = _estimateVramForRouting(model);

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
        const freeVramMb = totalVram - usedVram;
        const latencyP50 = getNodeLatencyP50(node.id, model);
        const throughput = getNodeThroughput(node.id, model);

        // Wave 461: VRAM fit penalty
        const vramFitPenalty = (totalVram > 0 && freeVramMb < requiredVramMb) ? 200 : 0;
        const vramPressure = totalVram > 0 ? (usedVram / totalVram) * 50 : 50;

        // Wave 466: thermal health penalty
        let healthPenalty = 0;
        if (node.latest_stats.gpus.length > 0) {
            const maxTemp = Math.max(...node.latest_stats.gpus.map((g: any) => g.temperatureC as number));
            if (maxTemp > 85) healthPenalty = 50;
            else if (maxTemp > 75) healthPenalty = 15;
        }

        // Wave 475: priority modifier
        let priorityModifier = 0;
        if (opts?.priority === 'cost') {
            const totalWatts = node.latest_stats.gpus.reduce((s: number, g: any) => s + (g.powerDrawW || 0), 0);
            priorityModifier = totalWatts * 0.05;
        } else if (opts?.priority === 'speed') {
            priorityModifier = throughput > 0 ? -(throughput * 0.3) : 0;
        }

        const score = vramFitPenalty + vramPressure + healthPenalty +
                      (node.latest_stats.inference.in_flight_requests * 40) +
                      (avgUtil * 0.3) + (latencyP50 * 0.01) -
                      (throughput * 0.05) + priorityModifier;

        const backend = (node.latest_stats as any).backend;
        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address,
            gpu_utilization_avg: avgUtil,
            in_flight_requests: node.latest_stats.inference.in_flight_requests,
            backend_type: backend?.type || 'ollama',
            backend_port: backend?.port || 11434,
            score: Math.round(score * 10) / 10,
        });
    }

    candidates.sort((a, b) => a.score - b.score);
    return candidates;
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
