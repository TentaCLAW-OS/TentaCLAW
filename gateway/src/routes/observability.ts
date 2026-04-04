/**
 * TentaCLAW Gateway — Observability API
 *
 * Wave 491: Prometheus /metrics endpoint
 * Wave 493: Alert webhooks (Discord/Telegram/generic)
 * Wave 495: OOM recovery detection
 * Wave 497: Historical metrics (30-day tok/s, util, error rate per node)
 * Wave 499: Uptime tracking (7/30/90 day per node)
 * Wave 500: Cluster-wide GPU live snapshot
 */
import { Hono } from 'hono';
import {
    getAllNodes,
    getRequestStats,
    getInferenceAnalytics,
    getClusterCapacity,
    getFleetUptime,
    getAllNotificationChannels,
    sendNotification,
} from '../db';
import { broadcastSSE } from '../shared';

const observability = new Hono();

// =============================================================================
// Wave 491: Prometheus metrics endpoint — GET /metrics
// =============================================================================

observability.get('/metrics', (c) => {
    const nodes = getAllNodes();
    const reqStats = getRequestStats();
    const capacity = getClusterCapacity();
    const lines: string[] = [];

    lines.push('# HELP tentaclaw_cluster_nodes_total Total number of registered nodes');
    lines.push('# TYPE tentaclaw_cluster_nodes_total gauge');
    lines.push(`tentaclaw_cluster_nodes_total ${nodes.length}`);

    const online = nodes.filter(n => n.status === 'online').length;
    lines.push('# HELP tentaclaw_nodes_online Number of online nodes');
    lines.push('# TYPE tentaclaw_nodes_online gauge');
    lines.push(`tentaclaw_nodes_online ${online}`);

    lines.push('# HELP tentaclaw_requests_total Total inference requests');
    lines.push('# TYPE tentaclaw_requests_total counter');
    lines.push(`tentaclaw_requests_total ${reqStats.total}`);

    lines.push('# HELP tentaclaw_requests_last_hour Requests in the last hour');
    lines.push('# TYPE tentaclaw_requests_last_hour gauge');
    lines.push(`tentaclaw_requests_last_hour ${reqStats.last_hour}`);

    lines.push('# HELP tentaclaw_avg_latency_ms Average inference latency in ms');
    lines.push('# TYPE tentaclaw_avg_latency_ms gauge');
    lines.push(`tentaclaw_avg_latency_ms ${reqStats.avg_latency_ms}`);

    lines.push('# HELP tentaclaw_error_rate Error rate percentage');
    lines.push('# TYPE tentaclaw_error_rate gauge');
    lines.push(`tentaclaw_error_rate ${reqStats.error_rate_pct}`);

    lines.push('# HELP tentaclaw_vram_total_mb Total cluster VRAM in MB');
    lines.push('# TYPE tentaclaw_vram_total_mb gauge');
    lines.push(`tentaclaw_vram_total_mb ${capacity.total_vram_mb}`);

    lines.push('# HELP tentaclaw_vram_used_mb Used cluster VRAM in MB');
    lines.push('# TYPE tentaclaw_vram_used_mb gauge');
    lines.push(`tentaclaw_vram_used_mb ${capacity.used_vram_mb}`);

    lines.push('# HELP tentaclaw_vram_free_mb Free cluster VRAM in MB');
    lines.push('# TYPE tentaclaw_vram_free_mb gauge');
    lines.push(`tentaclaw_vram_free_mb ${capacity.free_vram_mb}`);

    lines.push('# HELP tentaclaw_models_loaded Number of models loaded');
    lines.push('# TYPE tentaclaw_models_loaded gauge');
    lines.push(`tentaclaw_models_loaded ${capacity.models_loaded}`);

    // Per-node metrics
    lines.push('# HELP tentaclaw_node_gpu_util GPU utilization per node');
    lines.push('# TYPE tentaclaw_node_gpu_util gauge');
    lines.push('# HELP tentaclaw_node_gpu_temp_c GPU temperature per node');
    lines.push('# TYPE tentaclaw_node_gpu_temp_c gauge');
    lines.push('# HELP tentaclaw_node_gpu_vram_used_mb GPU VRAM used per node');
    lines.push('# TYPE tentaclaw_node_gpu_vram_used_mb gauge');
    lines.push('# HELP tentaclaw_node_gpu_vram_total_mb GPU VRAM total per node');
    lines.push('# TYPE tentaclaw_node_gpu_vram_total_mb gauge');
    lines.push('# HELP tentaclaw_node_in_flight In-flight requests per node');
    lines.push('# TYPE tentaclaw_node_in_flight gauge');

    for (const node of nodes) {
        const labels = `node_id="${node.id}",hostname="${node.hostname}"`;
        const nd = node.latest_stats;
        if (nd?.gpus) {
            for (let gi = 0; gi < nd.gpus.length; gi++) {
                const gpu = nd.gpus[gi]!;
                const gl = `${labels},gpu="${gi}"`;
                lines.push(`tentaclaw_node_gpu_util{${gl}} ${gpu.utilizationPct}`);
                lines.push(`tentaclaw_node_gpu_temp_c{${gl}} ${gpu.temperatureC}`);
                lines.push(`tentaclaw_node_gpu_vram_used_mb{${gl}} ${gpu.vramUsedMb}`);
                lines.push(`tentaclaw_node_gpu_vram_total_mb{${gl}} ${gpu.vramTotalMb}`);
            }
        }
        lines.push(`tentaclaw_node_in_flight{${labels}} ${nd?.inference?.in_flight_requests ?? 0}`);
    }

    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return c.text(lines.join('\n') + '\n');
});

// Wave 493: webhook routes already exist in misc.ts — fireAlertWebhooks exported below for use by alerting

export async function fireAlertWebhooks(message: string, severity: string = 'warning'): Promise<void> {
    for (const ch of getAllNotificationChannels()) {
        try { await sendNotification(ch.id, `[${severity.toUpperCase()}] ${message}`); } catch { /* best-effort */ }
    }
}

// =============================================================================
// Wave 495: OOM recovery — POST /api/v1/fleet/oom-check
// =============================================================================

const oomRecoveryLog: Array<{ node_id: string; hostname: string; detected_at: string; action: string }> = [];

observability.get('/api/v1/fleet/oom-recovery', (c) => {
    return c.json({ recoveries: oomRecoveryLog.slice(-50) });
});

observability.post('/api/v1/fleet/oom-check', (c) => {
    const detected: typeof oomRecoveryLog = [];
    for (const node of getAllNodes()) {
        if (node.status !== 'online') continue;
        const stats = node.latest_stats;
        if (!stats?.gpus || stats.gpus.length === 0) continue;

        const totalVram = stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram = stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const models = stats.inference?.loaded_models ?? [];
        const vramUtilPct = totalVram > 0 ? (usedVram / totalVram) * 100 : 0;

        if (totalVram > 1000 && vramUtilPct < 5 && models.length === 0) {
            const entry = { node_id: node.id, hostname: node.hostname, detected_at: new Date().toISOString(), action: 'suspected_oom_restart' };
            detected.push(entry);
            oomRecoveryLog.push(entry);
            broadcastSSE('oom_detected', { node_id: node.id, hostname: node.hostname });
        }
    }
    while (oomRecoveryLog.length > 200) oomRecoveryLog.shift();
    return c.json({ detected, count: detected.length });
});

// =============================================================================
// Wave 497: Historical metrics — GET /api/v1/metrics/history
// =============================================================================

observability.get('/api/v1/metrics/history', (c) => {
    const hours = Math.min(720, Math.max(1, parseInt(c.req.query('hours') || '24', 10) || 24));
    const analytics = getInferenceAnalytics(hours);
    const perNode = getAllNodes().map(node => {
        const stats = node.latest_stats;
        const gpus = stats?.gpus ?? [];
        return {
            node_id: node.id,
            hostname: node.hostname,
            avg_util_pct: gpus.length ? Math.round(gpus.reduce((s, g) => s + g.utilizationPct, 0) / gpus.length) : 0,
            avg_temp_c: gpus.length ? Math.round(gpus.reduce((s, g) => s + g.temperatureC, 0) / gpus.length) : 0,
            models_loaded: (stats?.inference?.loaded_models ?? []).length,
        };
    });

    return c.json({
        window_hours: hours,
        cluster: {
            total_requests: analytics.total_requests,
            avg_latency_ms: Math.round(analytics.avg_latency_ms),
            error_rate_pct: analytics.total_requests > 0 ? Math.round((analytics.failed / analytics.total_requests) * 10000) / 100 : 0,
            top_models: analytics.by_model.slice(0, 10),
            requests_per_minute: analytics.requests_per_minute,
        },
        nodes: perNode,
    });
});

// =============================================================================
// Wave 499: Uptime tracking — GET /api/v1/fleet/uptime
// =============================================================================

observability.get('/api/v1/fleet/uptime', (c) => {
    const window = c.req.query('window') || '7d';
    let hours = 168;
    if (window === '30d') hours = 720;
    else if (window === '90d') hours = 2160;
    else if (window === '24h') hours = 24;
    else if (window.endsWith('h')) hours = parseInt(window, 10) || 168;
    else if (window.endsWith('d')) hours = (parseInt(window, 10) || 7) * 24;

    const fleet = getFleetUptime(hours);
    const clusterAvg = fleet.length > 0
        ? Math.round(fleet.reduce((s, n) => s + n.uptime_pct, 0) / fleet.length * 100) / 100
        : 0;

    return c.json({ window, window_hours: hours, cluster_uptime_pct: clusterAvg, nodes: fleet });
});

// =============================================================================
// Wave 500: Cluster-wide GPU live snapshot — GET /api/v1/fleet/gpus
// =============================================================================

observability.get('/api/v1/fleet/gpus', (c) => {
    const gpus: Array<{
        node_id: string; hostname: string; gpu_index: number; name: string;
        util_pct: number; temp_c: number; vram_used_mb: number; vram_total_mb: number;
        fan_pct: number; model_loaded: string;
    }> = [];

    for (const node of getAllNodes()) {
        if (node.status !== 'online') continue;
        const stats = node.latest_stats;
        if (!stats?.gpus) continue;
        const models = stats.inference?.loaded_models ?? [];

        for (let gi = 0; gi < stats.gpus.length; gi++) {
            const g = stats.gpus[gi]!;
            gpus.push({
                node_id: node.id, hostname: node.hostname, gpu_index: gi,
                name: g.name, util_pct: g.utilizationPct, temp_c: g.temperatureC,
                vram_used_mb: g.vramUsedMb, vram_total_mb: g.vramTotalMb,
                fan_pct: g.fanSpeedPct, model_loaded: models[gi] ?? models[0] ?? '',
            });
        }
    }

    gpus.sort((a, b) => b.util_pct - a.util_pct);
    return c.json({
        gpus, total_gpus: gpus.length,
        total_vram_mb: gpus.reduce((s, g) => s + g.vram_total_mb, 0),
        used_vram_mb: gpus.reduce((s, g) => s + g.vram_used_mb, 0),
    });
});

export default observability;
