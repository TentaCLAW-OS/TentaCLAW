/**
 * TentaCLAW Gateway — Database Layer (SQLite)
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "I remember everything. Eight arms, one brain."
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type {
    Node,
    NodeWithStats,
    StatsPayload,
    GatewayCommand,
    FlightSheet,
    FlightSheetTarget,
    NodeStatus,
    CommandAction,
} from '../../shared/types';

// =============================================================================
// Database Setup
// =============================================================================

const DB_PATH = process.env.TENTACLAW_DB_PATH || path.join(process.cwd(), 'data', 'hivemind.db');

let db: Database.Database;

export function getDb(): Database.Database {
    if (!db) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema(db);
    }
    return db;
}

function initSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            farm_hash TEXT NOT NULL,
            hostname TEXT NOT NULL,
            ip_address TEXT,
            mac_address TEXT,
            registered_at TEXT DEFAULT (datetime('now')),
            last_seen_at TEXT,
            status TEXT DEFAULT 'online',
            gpu_count INTEGER DEFAULT 0,
            os_version TEXT
        );

        CREATE TABLE IF NOT EXISTS stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            timestamp TEXT DEFAULT (datetime('now')),
            payload TEXT NOT NULL,
            gpu_count INTEGER,
            cpu_usage_pct REAL,
            ram_used_mb INTEGER,
            ram_total_mb INTEGER,
            toks_per_sec REAL
        );

        CREATE INDEX IF NOT EXISTS idx_stats_node_time ON stats(node_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS commands (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            payload TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            sent_at TEXT,
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_commands_node_status ON commands(node_id, status);

        CREATE TABLE IF NOT EXISTS flight_sheets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            targets TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            node_id TEXT,
            severity TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            value REAL,
            threshold REAL,
            acknowledged INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_alerts_node ON alerts(node_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS benchmarks (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            tokens_per_sec REAL NOT NULL,
            prompt_eval_rate REAL DEFAULT 0,
            eval_rate REAL DEFAULT 0,
            total_duration_ms INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_benchmarks_node ON benchmarks(node_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS node_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            event TEXT NOT NULL,
            detail TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_node_events ON node_events(node_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            cron TEXT NOT NULL,
            config TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            last_run TEXT,
            next_run TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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
        latest_stats: latestStat ? JSON.parse(latestStat.payload) : null,
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
            latest_stats: latestStat ? JSON.parse(latestStat.payload) : null,
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
            latest_stats: latestStat ? JSON.parse(latestStat.payload) : null,
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
        }
        return stale.map(n => n.id);
    }

    return [];
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

    // Update node last_seen and status
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

// =============================================================================
// Command Operations
// =============================================================================

export function queueCommand(nodeId: string, action: CommandAction, params?: {
    model?: string;
    gpu?: number;
    profile?: string;
    priority?: string;
}): GatewayCommand {
    const d = getDb();
    const id = generateId();
    const payload = params ? JSON.stringify(params) : null;

    d.prepare(`
        INSERT INTO commands (id, node_id, action, payload, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(id, nodeId, action, payload);

    return {
        id,
        action,
        ...(params || {}),
    };
}

export function getPendingCommands(nodeId: string): GatewayCommand[] {
    const d = getDb();
    const rows = d.prepare(
        "SELECT * FROM commands WHERE node_id = ? AND status = 'pending' ORDER BY created_at"
    ).all(nodeId) as { id: string; action: string; payload: string | null }[];

    // Mark them as sent
    const markSent = d.prepare("UPDATE commands SET status = 'sent', sent_at = datetime('now') WHERE id = ?");
    for (const row of rows) {
        markSent.run(row.id);
    }

    return rows.map(row => {
        const params = row.payload ? JSON.parse(row.payload) : {};
        return {
            id: row.id,
            action: row.action as CommandAction,
            ...params,
        };
    });
}

export function completeCommand(commandId: string): void {
    const d = getDb();
    d.prepare(
        "UPDATE commands SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
    ).run(commandId);
}

// =============================================================================
// Flight Sheet Operations
// =============================================================================

export function createFlightSheet(name: string, description: string, targets: FlightSheetTarget[]): FlightSheet {
    const d = getDb();
    const id = generateId();

    d.prepare(`
        INSERT INTO flight_sheets (id, name, description, targets)
        VALUES (?, ?, ?, ?)
    `).run(id, name, description, JSON.stringify(targets));

    const row = d.prepare('SELECT * FROM flight_sheets WHERE id = ?').get(id) as Omit<FlightSheet, 'targets'> & { targets: string };
    return { ...row, targets: JSON.parse(row.targets) };
}

export function getAllFlightSheets(): FlightSheet[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM flight_sheets ORDER BY created_at DESC').all() as (Omit<FlightSheet, 'targets'> & { targets: string })[];
    return rows.map(r => ({ ...r, targets: JSON.parse(r.targets) }));
}

export function getFlightSheet(id: string): FlightSheet | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM flight_sheets WHERE id = ?').get(id) as (Omit<FlightSheet, 'targets'> & { targets: string }) | undefined;
    if (!row) return null;
    return { ...row, targets: JSON.parse(row.targets) };
}

export function deleteFlightSheet(id: string): boolean {
    const d = getDb();
    const result = d.prepare('DELETE FROM flight_sheets WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Apply a flight sheet: queue install_model commands for each target node.
 */
export function applyFlightSheet(id: string): GatewayCommand[] {
    const sheet = getFlightSheet(id);
    if (!sheet) return [];

    const commands: GatewayCommand[] = [];
    const allNodes = getAllNodes();

    for (const target of sheet.targets) {
        const targetNodes = target.node_id === '*'
            ? allNodes
            : allNodes.filter(n => n.id === target.node_id);

        for (const node of targetNodes) {
            const cmd = queueCommand(node.id, 'install_model', {
                model: target.model,
                gpu: target.gpu,
            });
            commands.push(cmd);
        }
    }

    return commands;
}

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
                `GPU overheating: ${gpu.name} at ${gpu.temperatureC}°C`,
                gpu.temperatureC, 85));
        } else if (gpu.temperatureC > 75) {
            alerts.push(createAlert(nodeId, 'warning', 'gpu_hot',
                `GPU running hot: ${gpu.name} at ${gpu.temperatureC}°C`,
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
// Benchmark Operations
// =============================================================================

export interface BenchmarkRecord {
    id: string;
    node_id: string;
    model: string;
    tokens_per_sec: number;
    prompt_eval_rate: number;
    eval_rate: number;
    total_duration_ms: number;
    created_at: string;
}

export function storeBenchmark(nodeId: string, result: {
    model: string;
    tokens_per_sec: number;
    prompt_eval_rate?: number;
    eval_rate?: number;
    total_duration_ms?: number;
}): BenchmarkRecord {
    const d = getDb();
    const id = generateId();

    d.prepare(`
        INSERT INTO benchmarks (id, node_id, model, tokens_per_sec, prompt_eval_rate, eval_rate, total_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, nodeId, result.model, result.tokens_per_sec, result.prompt_eval_rate || 0, result.eval_rate || 0, result.total_duration_ms || 0);

    return d.prepare('SELECT * FROM benchmarks WHERE id = ?').get(id) as BenchmarkRecord;
}

export function getNodeBenchmarks(nodeId: string, limit: number = 20): BenchmarkRecord[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM benchmarks WHERE node_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(nodeId, limit) as BenchmarkRecord[];
}

export function getAllBenchmarks(limit: number = 50): BenchmarkRecord[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as BenchmarkRecord[];
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
// Inference Routing (find best node for a model)
// =============================================================================

export interface InferenceTarget {
    node_id: string;
    hostname: string;
    ip_address: string | null;
    gpu_utilization_avg: number;
    in_flight_requests: number;
}

/**
 * Find the best node to serve inference for a given model.
 * Strategy: among online nodes with the model loaded, pick the one with lowest average GPU utilization.
 */
export function findBestNode(model: string): InferenceTarget | null {
    const nodes = getAllNodes();
    const candidates: InferenceTarget[] = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;

        const hasModel = node.latest_stats.inference.loaded_models.some(
            m => m === model || m.startsWith(model.split(':')[0])
        );
        if (!hasModel) continue;

        const gpuUtils = node.latest_stats.gpus.map(g => g.utilizationPct);
        const avgUtil = gpuUtils.length > 0 ? gpuUtils.reduce((a, b) => a + b, 0) / gpuUtils.length : 100;

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address,
            gpu_utilization_avg: avgUtil,
            in_flight_requests: node.latest_stats.inference.in_flight_requests,
        });
    }

    if (candidates.length === 0) return null;

    // Sort by in-flight requests first, then GPU utilization
    candidates.sort((a, b) => {
        if (a.in_flight_requests !== b.in_flight_requests) return a.in_flight_requests - b.in_flight_requests;
        return a.gpu_utilization_avg - b.gpu_utilization_avg;
    });

    return candidates[0];
}

/**
 * Get all unique models loaded across the cluster.
 */
export function getClusterModels(): { model: string; node_count: number; nodes: string[] }[] {
    const nodes = getAllNodes();
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

    // GPU temps: 0-25 points (below 60°C = perfect, above 85°C = 0)
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
// Schedules (cron-like tasks)
// =============================================================================

export interface Schedule {
    id: string;
    name: string;
    type: string;        // 'deploy', 'benchmark', 'reboot', 'custom'
    cron: string;        // simplified: '@every 1h', '@daily', '@hourly', '*/30 * * * *'
    config: Record<string, unknown>;
    enabled: boolean;
    last_run: string | null;
    next_run: string | null;
    created_at: string;
}

export function createSchedule(name: string, type: string, cron: string, config: Record<string, unknown>): Schedule {
    const d = getDb();
    const id = generateId();
    const nextRun = computeNextRun(cron);

    d.prepare(`
        INSERT INTO schedules (id, name, type, cron, config, next_run)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, type, cron, JSON.stringify(config), nextRun);

    return getSchedule(id)!;
}

export function getSchedule(id: string): Schedule | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config), enabled: !!row.enabled };
}

export function getAllSchedules(): Schedule[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ ...r, config: JSON.parse(r.config), enabled: !!r.enabled }));
}

export function deleteSchedule(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
}

export function toggleSchedule(id: string, enabled: boolean): boolean {
    const d = getDb();
    return d.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;
}

export function markScheduleRun(id: string): void {
    const d = getDb();
    const schedule = getSchedule(id);
    if (!schedule) return;
    const nextRun = computeNextRun(schedule.cron);
    d.prepare('UPDATE schedules SET last_run = datetime(\'now\'), next_run = ? WHERE id = ?').run(nextRun, id);
}

export function getDueSchedules(): Schedule[] {
    const d = getDb();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const rows = d.prepare(
        'SELECT * FROM schedules WHERE enabled = 1 AND (next_run IS NULL OR next_run <= ?)'
    ).all(now) as any[];
    return rows.map(r => ({ ...r, config: JSON.parse(r.config), enabled: !!r.enabled }));
}

/**
 * Simple cron-to-next-run computation.
 * Supports: @hourly, @daily, @every Nh, @every Nm
 */
function computeNextRun(cron: string): string {
    const now = new Date();
    let next: Date;

    if (cron === '@hourly') {
        next = new Date(now.getTime() + 3600000);
    } else if (cron === '@daily') {
        next = new Date(now.getTime() + 86400000);
    } else if (cron.startsWith('@every ')) {
        const match = cron.match(/@every\s+(\d+)([hms])/);
        if (match) {
            const val = parseInt(match[1]);
            const unit = match[2];
            const ms = unit === 'h' ? val * 3600000 : unit === 'm' ? val * 60000 : val * 1000;
            next = new Date(now.getTime() + ms);
        } else {
            next = new Date(now.getTime() + 3600000); // default 1h
        }
    } else {
        // Default: 1 hour
        next = new Date(now.getTime() + 3600000);
    }

    return next.toISOString().replace('T', ' ').slice(0, 19);
}
