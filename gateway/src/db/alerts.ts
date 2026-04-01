/**
 * TentaCLAW Gateway — Alert Operations
 */

import type { StatsPayload } from '../../../shared/types';
import { getDb, generateId } from './init';

// =============================================================================
// Alert Operations
// =============================================================================

export interface Alert {
    id: string;
    node_id: string;
    severity: 'warning' | 'critical';
    type: string;
    message: string;
    value: number;
    threshold: number;
    acknowledged: number;
    created_at: string;
}

export function createAlert(
    nodeId: string,
    severity: 'warning' | 'critical',
    type: string,
    message: string,
    value: number,
    threshold: number,
): Alert {
    const d = getDb();
    const id = generateId();

    d.prepare(`
        INSERT INTO alerts (id, node_id, severity, type, message, value, threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, nodeId, severity, type, message, value, threshold);

    return d.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Alert;
}

export function getRecentAlerts(limit: number = 50): Alert[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Alert[];
}

export function acknowledgeAlert(alertId: string): boolean {
    const d = getDb();
    const result = d.prepare(
        'UPDATE alerts SET acknowledged = 1 WHERE id = ?'
    ).run(alertId);
    return result.changes > 0;
}

export function checkAndAlert(nodeId: string, stats: StatsPayload): Alert[] {
    const alerts: Alert[] = [];

    // GPU temperature checks
    for (const gpu of stats.gpus) {
        if (gpu.temperatureC > 85) {
            alerts.push(createAlert(nodeId, 'critical', 'gpu_overheat',
                `GPU overheating: ${gpu.name} at ${gpu.temperatureC}\u00b0C`,
                gpu.temperatureC, 85));
        } else if (gpu.temperatureC > 75) {
            alerts.push(createAlert(nodeId, 'warning', 'gpu_hot',
                `GPU running hot: ${gpu.name} at ${gpu.temperatureC}\u00b0C`,
                gpu.temperatureC, 75));
        }

        // VRAM usage check
        const vramPct = (gpu.vramUsedMb / gpu.vramTotalMb) * 100;
        if (vramPct > 95) {
            alerts.push(createAlert(nodeId, 'warning', 'vram_full',
                `VRAM nearly full: ${gpu.name} at ${vramPct.toFixed(1)}%`,
                vramPct, 95));
        }
    }

    // CPU usage check
    if (stats.cpu.usage_pct > 95) {
        alerts.push(createAlert(nodeId, 'warning', 'cpu_saturated',
            `CPU saturated at ${stats.cpu.usage_pct}%`,
            stats.cpu.usage_pct, 95));
    }

    // RAM usage check
    const ramPct = (stats.ram.used_mb / stats.ram.total_mb) * 100;
    if (ramPct > 90) {
        alerts.push(createAlert(nodeId, 'warning', 'ram_pressure',
            `RAM pressure at ${ramPct.toFixed(1)}%`,
            ramPct, 90));
    }

    // Disk usage check
    const diskPct = (stats.disk.used_gb / stats.disk.total_gb) * 100;
    if (diskPct > 90) {
        alerts.push(createAlert(nodeId, 'critical', 'disk_full',
            `Disk nearly full at ${diskPct.toFixed(1)}%`,
            diskPct, 90));
    }

    return alerts;
}

// =============================================================================
// Alert Rules Engine
// =============================================================================

export interface AlertRule {
    id: string;
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    severity: string;
    cooldown_secs: number;
    enabled: number;
    node_filter: string | null;
    created_at: string;
}

// In-memory cooldown tracker: key = `${ruleId}:${nodeId}`, value = timestamp of last fire
const alertCooldowns = new Map<string, number>();

export function createAlertRule(rule: {
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    severity?: string;
    cooldown_secs?: number;
    node_filter?: string;
}): { id: string } {
    const d = getDb();
    const id = generateId();
    d.prepare(`
        INSERT INTO alert_rules (id, name, metric, operator, threshold, severity, cooldown_secs, node_filter)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        rule.name,
        rule.metric,
        rule.operator,
        rule.threshold,
        rule.severity ?? 'warning',
        rule.cooldown_secs ?? 300,
        rule.node_filter ?? null,
    );
    return { id };
}

export function getAlertRules(): AlertRule[] {
    const d = getDb();
    return d.prepare('SELECT * FROM alert_rules ORDER BY created_at ASC').all() as AlertRule[];
}

export function updateAlertRule(id: string, updates: Partial<AlertRule>): boolean {
    const d = getDb();
    const allowed = ['name', 'metric', 'operator', 'threshold', 'severity', 'cooldown_secs', 'enabled', 'node_filter'];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
        if (key in updates) {
            setClauses.push(`${key} = ?`);
            values.push((updates as Record<string, unknown>)[key]);
        }
    }
    if (setClauses.length === 0) return false;
    values.push(id);
    const result = d.prepare(
        `UPDATE alert_rules SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...values);
    return result.changes > 0;
}

export function deleteAlertRule(id: string): boolean {
    const d = getDb();
    const result = d.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
    return result.changes > 0;
}

export function toggleAlertRule(id: string, enabled: boolean): boolean {
    const d = getDb();
    const result = d.prepare('UPDATE alert_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return result.changes > 0;
}

/**
 * Extract the numeric value for a given metric from the stats payload.
 */
function extractMetricValues(stats: StatsPayload, metric: string): Array<{ label: string; value: number }> {
    switch (metric) {
        case 'gpu_temp':
            return stats.gpus.map(g => ({ label: g.name, value: g.temperatureC }));
        case 'gpu_util':
            return stats.gpus.map(g => ({ label: g.name, value: g.utilizationPct }));
        case 'vram_pct':
            return stats.gpus.map(g => ({
                label: g.name,
                value: g.vramTotalMb > 0 ? (g.vramUsedMb / g.vramTotalMb) * 100 : 0,
            }));
        case 'cpu_usage':
            return [{ label: 'CPU', value: stats.cpu.usage_pct }];
        case 'ram_pct':
            return [{ label: 'RAM', value: stats.ram.total_mb > 0 ? (stats.ram.used_mb / stats.ram.total_mb) * 100 : 0 }];
        case 'disk_pct':
            return [{ label: 'Disk', value: stats.disk.total_gb > 0 ? (stats.disk.used_gb / stats.disk.total_gb) * 100 : 0 }];
        case 'inference_latency':
            return [{ label: 'Inference', value: stats.inference.avg_latency_ms }];
        default:
            return [];
    }
}

function compareValue(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
        case 'gt': return value > threshold;
        case 'lt': return value < threshold;
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'eq': return value === threshold;
        default: return false;
    }
}

const OPERATOR_LABELS: Record<string, string> = {
    gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==',
};

/**
 * Evaluate all enabled alert rules against the incoming stats for a node.
 */
export function evaluateAlertRules(nodeId: string, stats: StatsPayload): Alert[] {
    const d = getDb();
    const rules = d.prepare(
        'SELECT * FROM alert_rules WHERE enabled = 1'
    ).all() as AlertRule[];

    const fired: Alert[] = [];
    const now = Date.now();

    for (const rule of rules) {
        if (rule.node_filter) {
            const allowed = rule.node_filter.split(',').map(s => s.trim());
            if (!allowed.includes(nodeId)) continue;
        }

        const metricValues = extractMetricValues(stats, rule.metric);
        for (const { label, value } of metricValues) {
            if (!compareValue(value, rule.operator, rule.threshold)) continue;

            const cooldownKey = `${rule.id}:${nodeId}:${label}`;
            const lastFired = alertCooldowns.get(cooldownKey);
            if (lastFired && (now - lastFired) < rule.cooldown_secs * 1000) continue;

            const opLabel = OPERATOR_LABELS[rule.operator] || rule.operator;
            const message = `[${rule.name}] ${label} ${rule.metric} = ${value.toFixed(1)} (${opLabel} ${rule.threshold})`;
            const alert = createAlert(
                nodeId,
                rule.severity as 'warning' | 'critical',
                `rule:${rule.id}`,
                message,
                value,
                rule.threshold,
            );
            fired.push(alert);
            alertCooldowns.set(cooldownKey, now);
        }
    }

    return fired;
}

/**
 * Seed default alert rules on first boot (only if the alert_rules table is empty).
 */
export function seedDefaultAlertRules(): void {
    const d = getDb();
    const count = (d.prepare('SELECT COUNT(*) as cnt FROM alert_rules').get() as { cnt: number }).cnt;
    if (count > 0) return;

    const defaults: Array<{ name: string; metric: string; operator: string; threshold: number; severity: string }> = [
        { name: 'GPU Temp Warning', metric: 'gpu_temp', operator: 'gt', threshold: 85, severity: 'warning' },
        { name: 'GPU Temp Critical', metric: 'gpu_temp', operator: 'gt', threshold: 95, severity: 'critical' },
        { name: 'VRAM High', metric: 'vram_pct', operator: 'gt', threshold: 90, severity: 'warning' },
        { name: 'CPU Saturated', metric: 'cpu_usage', operator: 'gt', threshold: 95, severity: 'warning' },
        { name: 'Disk Nearly Full', metric: 'disk_pct', operator: 'gt', threshold: 90, severity: 'warning' },
        { name: 'RAM Critical', metric: 'ram_pct', operator: 'gt', threshold: 95, severity: 'critical' },
    ];

    for (const rule of defaults) {
        createAlertRule(rule);
    }
}
