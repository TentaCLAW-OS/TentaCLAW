/**
 * TentaCLAW Gateway — Node Operations
 */

import type {
    Node,
    NodeWithStats,
    NodeStatus,
} from '../../../shared/types';
import { getDb } from './init';
import { recordUptimeEvent, getNodeUptime } from './misc';
import { safeJsonParse } from './safe-json';

// =============================================================================
// Node Operations
// =============================================================================

export function registerNode(reg: {
    node_id: string;
    farm_hash: string;
    hostname: string;
    ip_address?: string;
    mac_address?: string;
    gpu_count: number;
    os_version?: string;
}): Node {
    const d = getDb();

    const existing = d.prepare('SELECT id FROM nodes WHERE id = ?').get(reg.node_id) as { id: string } | undefined;

    if (existing) {
        d.prepare(`
            UPDATE nodes SET
                farm_hash = ?, hostname = ?, ip_address = ?, mac_address = ?,
                gpu_count = ?, os_version = ?, status = 'online', last_seen_at = datetime('now')
            WHERE id = ?
        `).run(
            reg.farm_hash, reg.hostname, reg.ip_address || null, reg.mac_address || null,
            reg.gpu_count, reg.os_version || null, reg.node_id
        );
    } else {
        d.prepare(`
            INSERT INTO nodes (id, farm_hash, hostname, ip_address, mac_address, gpu_count, os_version, status, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'))
        `).run(
            reg.node_id, reg.farm_hash, reg.hostname,
            reg.ip_address || null, reg.mac_address || null,
            reg.gpu_count, reg.os_version || null
        );
    }

    return d.prepare('SELECT * FROM nodes WHERE id = ?').get(reg.node_id) as Node;
}

export function getNode(nodeId: string): NodeWithStats | null {
    const d = getDb();
    const node = d.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Node | undefined;
    if (!node) return null;

    const latestStat = d.prepare(
        'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(nodeId) as { payload: string } | undefined;

    return {
        ...node,
        latest_stats: latestStat ? safeJsonParse(latestStat.payload, null) : null,
    };
}

export function getAllNodes(): NodeWithStats[] {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes ORDER BY last_seen_at DESC').all() as Node[];

    return nodes.map(node => {
        const latestStat = d.prepare(
            'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(node.id) as { payload: string } | undefined;

        return {
            ...node,
            latest_stats: latestStat ? safeJsonParse(latestStat.payload, null) : null,
        };
    });
}

export function getNodesByFarm(farmHash: string): NodeWithStats[] {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes WHERE farm_hash = ? ORDER BY hostname').all(farmHash) as Node[];

    return nodes.map(node => {
        const latestStat = d.prepare(
            'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(node.id) as { payload: string } | undefined;

        return {
            ...node,
            latest_stats: latestStat ? safeJsonParse(latestStat.payload, null) : null,
        };
    });
}

export function deleteNode(nodeId: string): boolean {
    const d = getDb();
    const result = d.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    return result.changes > 0;
}

export function updateNodeStatus(nodeId: string, status: NodeStatus): void {
    const d = getDb();
    d.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, nodeId);
}

/**
 * Mark nodes as offline if they haven't reported stats in `thresholdSecs` seconds.
 */
export function markStaleNodes(thresholdSecs: number = 60): string[] {
    const d = getDb();
    const cutoff = new Date(Date.now() - thresholdSecs * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const stale = d.prepare(`
        SELECT id FROM nodes
        WHERE status = 'online'
        AND last_seen_at < ?
    `).all(cutoff) as { id: string }[];

    if (stale.length > 0) {
        const stmt = d.prepare("UPDATE nodes SET status = 'offline' WHERE id = ?");
        for (const node of stale) {
            stmt.run(node.id);
            recordUptimeEvent(node.id, 'stale_offline', 'online', 'offline');
        }
        return stale.map(n => n.id);
    }

    return [];
}

// =============================================================================
// Cluster Summary
// =============================================================================

export interface ClusterSummary {
    total_nodes: number;
    online_nodes: number;
    offline_nodes: number;
    total_gpus: number;
    total_vram_mb: number;
    used_vram_mb: number;
    total_toks_per_sec: number;
    loaded_models: string[];
    farm_hashes: string[];
}

export function getClusterSummary(): ClusterSummary {
    const nodes = getAllNodes();
    const onlineNodes = nodes.filter(n => n.status === 'online');

    let totalGpus = 0;
    let totalVram = 0;
    let usedVram = 0;
    let totalToks = 0;
    const modelSet = new Set<string>();
    const farmSet = new Set<string>();

    for (const node of nodes) {
        farmSet.add(node.farm_hash);
        if (node.latest_stats) {
            totalGpus += node.latest_stats.gpu_count;
            totalToks += node.latest_stats.toks_per_sec;
            for (const gpu of node.latest_stats.gpus) {
                totalVram += gpu.vramTotalMb;
                usedVram += gpu.vramUsedMb;
            }
            for (const model of node.latest_stats.inference.loaded_models) {
                modelSet.add(model);
            }
        }
    }

    return {
        total_nodes: nodes.length,
        online_nodes: onlineNodes.length,
        offline_nodes: nodes.length - onlineNodes.length,
        total_gpus: totalGpus,
        total_vram_mb: totalVram,
        used_vram_mb: usedVram,
        total_toks_per_sec: totalToks,
        loaded_models: [...modelSet],
        farm_hashes: [...farmSet],
    };
}

// =============================================================================
// Cluster Health Score (0-100)
// =============================================================================

export interface HealthScore {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    color: 'green' | 'yellow' | 'red';
    factors: {
        nodes_online_pct: number;
        avg_gpu_temp: number;
        avg_vram_headroom_pct: number;
        recent_critical_alerts: number;
        has_loaded_models: boolean;
    };
}

export function getHealthScore(): HealthScore {
    const nodes = getAllNodes();
    if (nodes.length === 0) {
        return {
            score: 0, grade: 'F', color: 'red',
            factors: { nodes_online_pct: 0, avg_gpu_temp: 0, avg_vram_headroom_pct: 100, recent_critical_alerts: 0, has_loaded_models: false },
        };
    }

    const onlinePct = (nodes.filter(n => n.status === 'online').length / nodes.length) * 100;

    let totalTemp = 0, tempCount = 0;
    let totalVramPct = 0, vramCount = 0;
    let hasModels = false;

    for (const node of nodes) {
        if (!node.latest_stats) continue;
        for (const gpu of node.latest_stats.gpus) {
            totalTemp += gpu.temperatureC;
            tempCount++;
            if (gpu.vramTotalMb > 0) {
                totalVramPct += (gpu.vramUsedMb / gpu.vramTotalMb) * 100;
                vramCount++;
            }
        }
        if (node.latest_stats.inference.loaded_models.length > 0) hasModels = true;
    }

    const avgTemp = tempCount > 0 ? totalTemp / tempCount : 0;
    const avgVramUsedPct = vramCount > 0 ? totalVramPct / vramCount : 0;
    const vramHeadroom = 100 - avgVramUsedPct;

    // Count recent critical alerts (last hour)
    const d = getDb();
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').slice(0, 19);
    const criticalAlerts = (d.prepare(
        "SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'critical' AND created_at > ?"
    ).get(oneHourAgo) as { cnt: number }).cnt;

    // Calculate score (100 = perfect)
    let score = 0;

    // Nodes online: 0-30 points
    score += Math.min(30, (onlinePct / 100) * 30);

    // GPU temps: 0-25 points (below 60C = perfect, above 85C = 0)
    if (tempCount > 0) {
        const tempScore = avgTemp < 60 ? 25 : avgTemp > 85 ? 0 : 25 * (1 - (avgTemp - 60) / 25);
        score += Math.max(0, tempScore);
    } else {
        score += 25; // No GPUs = no temp concerns
    }

    // VRAM headroom: 0-20 points (>30% free = perfect, <5% = 0)
    if (vramCount > 0) {
        const vramScore = vramHeadroom > 30 ? 20 : vramHeadroom < 5 ? 0 : 20 * (vramHeadroom / 30);
        score += Math.max(0, vramScore);
    } else {
        score += 20;
    }

    // No critical alerts: 0-15 points
    const alertPenalty = Math.min(15, criticalAlerts * 5);
    score += 15 - alertPenalty;

    // Models loaded: 0-10 points
    if (hasModels) score += 10;

    score = Math.round(Math.max(0, Math.min(100, score)));

    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const color = score > 80 ? 'green' : score > 50 ? 'yellow' : 'red';

    return {
        score, grade, color,
        factors: {
            nodes_online_pct: Math.round(onlinePct),
            avg_gpu_temp: Math.round(avgTemp),
            avg_vram_headroom_pct: Math.round(vramHeadroom),
            recent_critical_alerts: criticalAlerts,
            has_loaded_models: hasModels,
        },
    };
}

// =============================================================================
// Node Events (uptime tracking)
// =============================================================================

export interface NodeEvent {
    id: number;
    node_id: string;
    event: string;
    detail: string | null;
    created_at: string;
}

export function recordNodeEvent(nodeId: string, event: string, detail?: string): void {
    const d = getDb();
    d.prepare('INSERT INTO node_events (node_id, event, detail) VALUES (?, ?, ?)').run(nodeId, event, detail || null);
}

export function getNodeEvents(nodeId: string, limit: number = 50): NodeEvent[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM node_events WHERE node_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(nodeId, limit) as NodeEvent[];
}

// =============================================================================
// Maintenance Mode
// =============================================================================

export function setMaintenanceMode(nodeId: string, enabled: boolean): void {
    const d = getDb();
    if (enabled) {
        d.prepare("UPDATE nodes SET status = 'maintenance' WHERE id = ?").run(nodeId);
        recordNodeEvent(nodeId, 'maintenance_start', 'Node entering maintenance mode');
        recordUptimeEvent(nodeId, 'maintenance_start', 'online', 'maintenance');
    } else {
        d.prepare("UPDATE nodes SET status = 'online' WHERE id = ?").run(nodeId);
        recordNodeEvent(nodeId, 'maintenance_end', 'Node exiting maintenance mode');
        recordUptimeEvent(nodeId, 'maintenance_end', 'maintenance', 'online');
    }
}

export function isInMaintenance(nodeId: string): boolean {
    const d = getDb();
    const row = d.prepare('SELECT status FROM nodes WHERE id = ?').get(nodeId) as any;
    return row?.status === 'maintenance';
}

// =============================================================================
// Fleet Reliability
// =============================================================================

export function getNodeHealthScore(nodeId: string): { score: number; grade: string; factors: Record<string, number> } {
    const node = getNode(nodeId);
    if (!node) return { score: 0, grade: 'F', factors: {} };

    let score = 100;
    const factors: Record<string, number> = {};

    // Factor 1: Online status (25 pts)
    factors.online = node.status === 'online' ? 25 : 0;
    score = score - (25 - factors.online);

    // Factor 2: GPU temps (25 pts)
    if (node.latest_stats && node.latest_stats.gpus.length > 0) {
        const avgTemp = node.latest_stats.gpus.reduce((s, g) => s + g.temperatureC, 0) / node.latest_stats.gpus.length;
        factors.temp = avgTemp < 60 ? 25 : avgTemp < 75 ? 20 : avgTemp < 85 ? 10 : 0;
    } else {
        factors.temp = node.status === 'online' ? 20 : 0;
    }
    score = score - (25 - factors.temp);

    // Factor 3: Uptime (25 pts)
    const uptime = getNodeUptime(nodeId, 24);
    factors.uptime = Math.round(uptime.uptime_pct / 4); // 100% uptime = 25 pts
    score = score - (25 - factors.uptime);

    // Factor 4: Models loaded (15 pts)
    if (node.latest_stats) {
        factors.models = node.latest_stats.inference.loaded_models.length > 0 ? 15 : 0;
    } else {
        factors.models = 0;
    }
    score = score - (15 - factors.models);

    // Factor 5: Recent watchdog events (10 pts -- less is better)
    const d = getDb();
    const recentWatchdog = (d.prepare(
        "SELECT COUNT(*) as cnt FROM watchdog_events WHERE node_id = ? AND created_at >= datetime('now', '-24 hours') AND level >= 2"
    ).get(nodeId) as { cnt: number }).cnt;
    factors.stability = recentWatchdog === 0 ? 10 : recentWatchdog <= 2 ? 5 : 0;
    score = score - (10 - factors.stability);

    score = Math.max(0, Math.min(100, score));
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    return { score, grade, factors };
}

export function getFleetReliability(): Array<{
    node_id: string; hostname: string; health_score: number; grade: string;
    uptime_pct: number; gpu_count: number; models: number; status: string;
}> {
    const nodes = getAllNodes();
    return nodes.map(n => {
        const health = getNodeHealthScore(n.id);
        const uptime = getNodeUptime(n.id, 24);
        const modelCount = n.latest_stats?.inference?.loaded_models?.length || 0;
        return {
            node_id: n.id,
            hostname: n.hostname,
            health_score: health.score,
            grade: health.grade,
            uptime_pct: uptime.uptime_pct,
            gpu_count: n.gpu_count,
            models: modelCount,
            status: n.status,
        };
    }).sort((a, b) => b.health_score - a.health_score);
}

// =============================================================================
// Unified Event Timeline
// =============================================================================

export function getClusterTimeline(limit: number = 50): Array<{
    type: string; source: string; node_id?: string; message: string; severity: string; created_at: string;
}> {
    const d = getDb();
    const events = d.prepare(`
        SELECT 'node_event' as type, 'node' as source, node_id, event || ': ' || COALESCE(detail, '') as message, 'info' as severity, created_at
        FROM node_events
        WHERE created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT 'watchdog' as type, 'watchdog' as source, node_id,
            action || ': ' || COALESCE(detail, '') as message,
            CASE WHEN level >= 3 THEN 'critical' WHEN level >= 2 THEN 'warning' ELSE 'info' END as severity,
            created_at
        FROM watchdog_events
        WHERE created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT 'alert' as type, 'alert' as source, node_id,
            type || ': ' || message as message,
            severity,
            created_at
        FROM alerts
        WHERE created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT 'uptime' as type, 'uptime' as source, node_id,
            event || ': ' || COALESCE(from_status, '?') || ' -> ' || COALESCE(to_status, '?') as message,
            CASE WHEN to_status = 'offline' THEN 'warning' ELSE 'info' END as severity,
            created_at
        FROM uptime_events
        WHERE created_at >= datetime('now', '-7 days')
        ORDER BY created_at DESC
        LIMIT ?
    `).all(limit) as any[];

    return events;
}

// =============================================================================
// Power & Cost Tracking
// =============================================================================

const DEFAULT_ELECTRICITY_RATE = 0.12; // $/kWh -- US average

export function getClusterPower(): {
    total_watts: number;
    per_node: Array<{ node_id: string; hostname: string; watts: number; gpu_watts: number; gpu_count: number }>;
    daily_kwh: number;
    monthly_kwh: number;
    daily_cost: number;
    monthly_cost: number;
    cost_per_request: number;
    cost_per_1k_tokens: number;
    electricity_rate: number;
} {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const rate = DEFAULT_ELECTRICITY_RATE;

    const perNode = nodes.map(n => {
        const s = n.latest_stats!;
        const gpuWatts = s.gpus.reduce((sum, g) => sum + (g.powerDrawW || 0), 0);
        const systemWatts = 100;
        const totalWatts = gpuWatts + systemWatts;
        return {
            node_id: n.id,
            hostname: n.hostname,
            watts: totalWatts,
            gpu_watts: gpuWatts,
            gpu_count: s.gpu_count,
        };
    });

    const totalWatts = perNode.reduce((s, n) => s + n.watts, 0);
    const dailyKwh = (totalWatts * 24) / 1000;
    const monthlyKwh = dailyKwh * 30;
    const dailyCost = dailyKwh * rate;
    const monthlyCost = monthlyKwh * rate;

    const d = getDb();
    const hourlyRequests = (d.prepare(`
        SELECT COUNT(*) as cnt FROM inference_log WHERE created_at >= datetime('now', '-1 hour')
    `).get() as { cnt: number }).cnt;

    const requestsPerDay = hourlyRequests * 24;
    const costPerRequest = requestsPerDay > 0 ? dailyCost / requestsPerDay : 0;

    const hourlyTokens = (d.prepare(`
        SELECT COALESCE(SUM(tokens_out), 0) as total FROM inference_log WHERE created_at >= datetime('now', '-1 hour')
    `).get() as { total: number }).total;
    const tokensPerDay = hourlyTokens * 24;
    const costPer1kTokens = tokensPerDay > 0 ? (dailyCost / tokensPerDay) * 1000 : 0;

    return {
        total_watts: totalWatts,
        per_node: perNode,
        daily_kwh: Math.round(dailyKwh * 10) / 10,
        monthly_kwh: Math.round(monthlyKwh),
        daily_cost: Math.round(dailyCost * 100) / 100,
        monthly_cost: Math.round(monthlyCost * 100) / 100,
        cost_per_request: Math.round(costPerRequest * 10000) / 10000,
        cost_per_1k_tokens: Math.round(costPer1kTokens * 10000) / 10000,
        electricity_rate: rate,
    };
}
