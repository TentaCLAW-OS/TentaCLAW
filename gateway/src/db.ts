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
    SshKey,
    NodeTag,
    ModelPullProgress,
} from '../../shared/types';

// =============================================================================
// Database Setup
// =============================================================================

const DB_PATH = process.env.TENTACLAW_DB_PATH || path.join(process.cwd(), 'data', 'tentaclaw.db');

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

        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            public_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ssh_keys_node ON ssh_keys(node_id);

        CREATE TABLE IF NOT EXISTS uptime_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            event TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_uptime_node ON uptime_events(node_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS overclock_profiles (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            gpu_index INTEGER NOT NULL,
            core_offset_mhz INTEGER DEFAULT 0,
            mem_offset_mhz INTEGER DEFAULT 0,
            power_limit_w INTEGER DEFAULT 0,
            fan_speed_pct INTEGER DEFAULT 0,
            applied_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_oc_node ON overclock_profiles(node_id);

        CREATE TABLE IF NOT EXISTS prompt_cache (
            hash TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            response TEXT NOT NULL,
            tokens_saved INTEGER DEFAULT 0,
            hits INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_cache_model ON prompt_cache(model);

        CREATE TABLE IF NOT EXISTS model_aliases (
            alias TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            fallbacks TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            scope TEXT DEFAULT 'inference',
            rate_limit_rpm INTEGER DEFAULT 60,
            monthly_token_limit INTEGER DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            requests_count INTEGER DEFAULT 0,
            last_used_at TEXT,
            expires_at TEXT,
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

        CREATE TABLE IF NOT EXISTS inference_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            success INTEGER DEFAULT 1,
            error TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_inference_log_time ON inference_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inference_log_model ON inference_log(model, created_at DESC);

        CREATE TABLE IF NOT EXISTS watchdog_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            level INTEGER NOT NULL,
            action TEXT NOT NULL,
            detail TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_watchdog_node ON watchdog_events(node_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS notification_channels (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            config TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS node_tags (
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (node_id, tag)
        );

        CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);

        CREATE TABLE IF NOT EXISTS model_pulls (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            status TEXT DEFAULT 'downloading',
            progress_pct REAL DEFAULT 0,
            bytes_downloaded INTEGER DEFAULT 0,
            bytes_total INTEGER DEFAULT 0,
            started_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_model_pulls_node ON model_pulls(node_id);
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
            recordUptimeEvent(node.id, 'stale_offline', 'online', 'offline');
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

    // Update node last_seen and status — track state transition for uptime
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

// =============================================================================
// Command Operations
// =============================================================================

export function queueCommand(nodeId: string, action: CommandAction, params?: Record<string, unknown> & {
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
// =============================================================================
// Smart Load Balancer (Wave 3) — Circuit Breaker + VRAM-Aware Routing
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
            console.log(`[lb] Circuit breaker OPEN for ${nodeId} — ${entry.errors} errors`);
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

export function findBestNode(model: string): InferenceTarget | null {
    const nodes = getAllNodes();
    const candidates: (InferenceTarget & { score: number })[] = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (isNodeBlocked(node.id)) continue;

        const hasModel = node.latest_stats.inference.loaded_models.some(
            m => m === model || m.startsWith(model.split(':')[0])
        );
        if (!hasModel) continue;

        const gpuUtils = node.latest_stats.gpus.map(g => g.utilizationPct);
        const avgUtil = gpuUtils.length > 0 ? gpuUtils.reduce((a, b) => a + b, 0) / gpuUtils.length : 100;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const vramHeadroom = totalVram > 0 ? ((totalVram - usedVram) / totalVram) * 100 : 0;

        // Composite score: lower = better
        const score = (node.latest_stats.inference.in_flight_requests * 40) +
                      (avgUtil * 0.3) +
                      ((100 - vramHeadroom) * 0.3);

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address,
            gpu_utilization_avg: avgUtil,
            in_flight_requests: node.latest_stats.inference.in_flight_requests,
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
// Smart Model Management (Wave 4)
// =============================================================================

// Known model VRAM requirements (approximate, in MB)
const MODEL_VRAM_MAP: Record<string, number> = {
    'llama3.1:8b': 5120, 'llama3.1:70b': 41000, 'llama3.2:3b': 2048, 'llama3.2:1b': 1024,
    'codellama:7b': 4608, 'codellama:13b': 8192, 'codellama:34b': 20480,
    'mistral:7b': 4608, 'mixtral:8x7b': 28672,
    'qwen2.5:7b': 4608, 'qwen2.5:3b': 2048, 'qwen3:14b': 9216,
    'gemma2:9b': 5632, 'phi3:3.8b': 2560,
    'deepseek-coder-v2:16b': 10240, 'hermes3:8b': 5120,
    'nomic-embed-text': 512, 'dolphin-mistral': 4096,
};

export function estimateModelVram(model: string): number {
    // Exact match
    if (MODEL_VRAM_MAP[model]) return MODEL_VRAM_MAP[model];
    // Partial match (without quantization suffix)
    const base = model.split(':')[0];
    for (const [key, vram] of Object.entries(MODEL_VRAM_MAP)) {
        if (key.startsWith(base)) return vram;
    }
    // Heuristic: parse parameter count from name
    const paramMatch = model.match(/(\d+)b/i);
    if (paramMatch) {
        const params = parseInt(paramMatch[1]);
        return params * 600; // ~600MB per billion params (Q4 quantized)
    }
    return 4096; // Default 4GB estimate
}

export function checkModelFits(model: string, nodeId: string): { fits: boolean; required_mb: number; available_mb: number; node: string } {
    const node = getNode(nodeId);
    if (!node || !node.latest_stats) return { fits: false, required_mb: 0, available_mb: 0, node: nodeId };

    const required = estimateModelVram(model);
    const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
    const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
    const available = totalVram - usedVram;

    return { fits: available >= required, required_mb: required, available_mb: available, node: nodeId };
}

export function findBestNodeForModel(model: string): { node_id: string; hostname: string; available_mb: number } | null {
    const nodes = getAllNodes();
    const required = estimateModelVram(model);

    const candidates: Array<{ node_id: string; hostname: string; available_mb: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;

        // Skip nodes that already have this model
        if (node.latest_stats.inference.loaded_models.includes(model)) continue;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const available = totalVram - usedVram;

        if (available >= required) {
            candidates.push({ node_id: node.id, hostname: node.hostname, available_mb: available });
        }
    }

    if (candidates.length === 0) return null;
    // Pick node with most available VRAM
    candidates.sort((a, b) => b.available_mb - a.available_mb);
    return candidates[0];
}

export function getModelDistribution(): Array<{
    model: string;
    estimated_vram_mb: number;
    nodes: Array<{ node_id: string; hostname: string }>;
    coverage: number; // % of online nodes that have this model
}> {
    const models = getClusterModels();
    const onlineCount = getAllNodes().filter(n => n.status === 'online').length;

    return models.map(m => ({
        model: m.model,
        estimated_vram_mb: estimateModelVram(m.model),
        nodes: m.nodes.map(nid => {
            const n = getAllNodes().find(x => x.id === nid);
            return { node_id: nid, hostname: n?.hostname || '?' };
        }),
        coverage: onlineCount > 0 ? Math.round((m.node_count / onlineCount) * 100) : 0,
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

// =============================================================================
// SSH Key Management
// =============================================================================

export function addSshKey(nodeId: string, label: string, publicKey: string): SshKey {
    const d = getDb();
    const id = generateId();
    // Compute a simple fingerprint from the key (SHA-256 of the base64 portion)
    const keyParts = publicKey.trim().split(/\s+/);
    const keyData = keyParts.length >= 2 ? keyParts[1] : keyParts[0];
    // Simple hash for fingerprint — just first 16 chars of base64
    const fingerprint = 'SHA256:' + keyData.slice(0, 43).replace(/[+/=]/g, '');

    d.prepare(`
        INSERT INTO ssh_keys (id, node_id, label, public_key, fingerprint)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, nodeId, label, publicKey.trim(), fingerprint);

    return d.prepare('SELECT * FROM ssh_keys WHERE id = ?').get(id) as SshKey;
}

export function getNodeSshKeys(nodeId: string): SshKey[] {
    const d = getDb();
    return d.prepare('SELECT * FROM ssh_keys WHERE node_id = ? ORDER BY created_at DESC').all(nodeId) as SshKey[];
}

export function deleteSshKey(keyId: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM ssh_keys WHERE id = ?').run(keyId).changes > 0;
}

// =============================================================================
// Node Tags
// =============================================================================

export function addNodeTag(nodeId: string, tag: string): void {
    const d = getDb();
    d.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)').run(nodeId, tag.toLowerCase().trim());
}

export function removeNodeTag(nodeId: string, tag: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM node_tags WHERE node_id = ? AND tag = ?').run(nodeId, tag.toLowerCase().trim()).changes > 0;
}

export function getNodeTags(nodeId: string): string[] {
    const d = getDb();
    const rows = d.prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag').all(nodeId) as { tag: string }[];
    return rows.map(r => r.tag);
}

export function getNodesByTag(tag: string): NodeWithStats[] {
    const d = getDb();
    const nodeIds = d.prepare(
        'SELECT node_id FROM node_tags WHERE tag = ?'
    ).all(tag.toLowerCase().trim()) as { node_id: string }[];

    return nodeIds.map(r => getNode(r.node_id)).filter((n): n is NodeWithStats => n !== null);
}

export function getAllTags(): Array<{ tag: string; count: number }> {
    const d = getDb();
    return d.prepare(
        'SELECT tag, COUNT(*) as count FROM node_tags GROUP BY tag ORDER BY count DESC'
    ).all() as Array<{ tag: string; count: number }>;
}

// =============================================================================
// Fleet Reliability (Wave 16)
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

    // Factor 5: Recent watchdog events (10 pts — less is better)
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
// Config Export/Import (Wave 15)
// =============================================================================

export function exportClusterConfig(): Record<string, unknown> {
    return {
        version: '0.2.0',
        exported_at: new Date().toISOString(),
        aliases: getAllModelAliases(),
        flight_sheets: getAllFlightSheets(),
        schedules: getAllSchedules(),
        tags: getAllTags(),
        notification_channels: getAllNotificationChannels(),
        node_tags: (() => {
            const d = getDb();
            return d.prepare('SELECT * FROM node_tags').all();
        })(),
    };
}

export function importClusterConfig(config: Record<string, any>): { imported: string[]; errors: string[] } {
    const imported: string[] = [];
    const errors: string[] = [];

    // Import aliases
    if (config.aliases && Array.isArray(config.aliases)) {
        for (const a of config.aliases) {
            try {
                setModelAlias(a.alias, a.target, a.fallbacks || []);
                imported.push('alias:' + a.alias);
            } catch (e) { errors.push('alias:' + a.alias + ': ' + e); }
        }
    }

    // Import flight sheets
    if (config.flight_sheets && Array.isArray(config.flight_sheets)) {
        for (const fs of config.flight_sheets) {
            try {
                createFlightSheet(fs.name, fs.description || '', fs.targets || []);
                imported.push('flight_sheet:' + fs.name);
            } catch (e) { errors.push('flight_sheet:' + fs.name + ': ' + e); }
        }
    }

    // Import schedules
    if (config.schedules && Array.isArray(config.schedules)) {
        for (const s of config.schedules) {
            try {
                createSchedule(s.name, s.type, s.cron, s.config || {});
                imported.push('schedule:' + s.name);
            } catch (e) { errors.push('schedule:' + s.name + ': ' + e); }
        }
    }

    // Import notification channels
    if (config.notification_channels && Array.isArray(config.notification_channels)) {
        for (const ch of config.notification_channels) {
            try {
                createNotificationChannel(ch.type, ch.name, ch.config || {});
                imported.push('notification:' + ch.name);
            } catch (e) { errors.push('notification:' + ch.name + ': ' + e); }
        }
    }

    return { imported, errors };
}

// =============================================================================
// Unified Event Timeline (Wave 14)
// =============================================================================

export function getClusterTimeline(limit: number = 50): Array<{
    type: string; source: string; node_id?: string; message: string; severity: string; created_at: string;
}> {
    const d = getDb();
    // Union across multiple event tables for a unified timeline
    const events = d.prepare(`
        SELECT 'node_event' as type, 'node' as source, node_id, event || ': ' || COALESCE(detail, '') as message, 'info' as severity, created_at
        FROM node_events
        UNION ALL
        SELECT 'watchdog' as type, 'watchdog' as source, node_id,
            action || ': ' || COALESCE(detail, '') as message,
            CASE WHEN level >= 3 THEN 'critical' WHEN level >= 2 THEN 'warning' ELSE 'info' END as severity,
            created_at
        FROM watchdog_events
        UNION ALL
        SELECT 'alert' as type, 'alert' as source, node_id,
            type || ': ' || message as message,
            severity,
            created_at
        FROM alerts
        UNION ALL
        SELECT 'uptime' as type, 'uptime' as source, node_id,
            event || ': ' || COALESCE(from_status, '?') || ' -> ' || COALESCE(to_status, '?') as message,
            CASE WHEN to_status = 'offline' THEN 'warning' ELSE 'info' END as severity,
            created_at
        FROM uptime_events
        ORDER BY created_at DESC
        LIMIT ?
    `).all(limit) as any[];

    return events;
}

// =============================================================================
// Maintenance Mode (Wave 13)
// =============================================================================

export function setMaintenanceMode(nodeId: string, enabled: boolean): void {
    const d = getDb();
    if (enabled) {
        // Mark node as "maintenance" — stop routing requests to it
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
// Power & Cost Tracking (Wave 11)
// =============================================================================

const DEFAULT_ELECTRICITY_RATE = 0.12; // $/kWh — US average

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
        // Estimate system power: CPU ~65W + RAM ~10W + misc ~25W = ~100W baseline
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

    // Cost per request from analytics
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

// =============================================================================
// Prompt Cache (Wave 10)
// =============================================================================

export function getCachedResponse(promptHash: string): { response: string; tokens_saved: number } | null {
    const d = getDb();
    const row = d.prepare(`
        SELECT response, tokens_saved FROM prompt_cache
        WHERE hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(promptHash) as any;

    if (row) {
        d.prepare('UPDATE prompt_cache SET hits = hits + 1 WHERE hash = ?').run(promptHash);
        return { response: row.response, tokens_saved: row.tokens_saved || 0 };
    }
    return null;
}

export function cacheResponse(promptHash: string, model: string, promptPreview: string, response: string, tokensSaved: number, ttlMinutes: number = 60): void {
    const d = getDb();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString().replace('T', ' ').slice(0, 19);
    d.prepare(`INSERT OR REPLACE INTO prompt_cache (hash, model, prompt_preview, response, tokens_saved, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        promptHash, model, promptPreview.slice(0, 100), response, tokensSaved, expiresAt
    );
}

export function getCacheStats(): { entries: number; total_hits: number; total_tokens_saved: number } {
    const d = getDb();
    const stats = d.prepare(`
        SELECT COUNT(*) as entries, COALESCE(SUM(hits), 0) as total_hits, COALESCE(SUM(tokens_saved * hits), 0) as total_tokens_saved
        FROM prompt_cache WHERE expires_at IS NULL OR expires_at > datetime('now')
    `).get() as any;
    return stats;
}

export function pruneCache(): number {
    const d = getDb();
    const result = d.prepare("DELETE FROM prompt_cache WHERE expires_at <= datetime('now')").run();
    return result.changes;
}

// =============================================================================
// Model Aliases & Fallback Chains (Wave 9)
// =============================================================================

export function setModelAlias(alias: string, target: string, fallbacks: string[] = []): void {
    const d = getDb();
    d.prepare('INSERT OR REPLACE INTO model_aliases (alias, target, fallbacks) VALUES (?, ?, ?)').run(
        alias, target, JSON.stringify(fallbacks)
    );
}

export function resolveModelAlias(model: string): { target: string; fallbacks: string[] } {
    const d = getDb();
    const row = d.prepare('SELECT target, fallbacks FROM model_aliases WHERE alias = ?').get(model) as any;
    if (row) {
        return { target: row.target, fallbacks: JSON.parse(row.fallbacks || '[]') };
    }
    return { target: model, fallbacks: [] };
}

export function getAllModelAliases(): Array<{ alias: string; target: string; fallbacks: string[]; created_at: string }> {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM model_aliases ORDER BY alias').all() as any[];
    return rows.map(r => ({ ...r, fallbacks: JSON.parse(r.fallbacks || '[]') }));
}

export function deleteModelAlias(alias: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM model_aliases WHERE alias = ?').run(alias).changes > 0;
}

// Default aliases — set on first use
export function ensureDefaultAliases(): void {
    const d = getDb();
    const count = (d.prepare('SELECT COUNT(*) as cnt FROM model_aliases').get() as { cnt: number }).cnt;
    if (count > 0) return;

    const defaults: Array<[string, string, string[]]> = [
        ['gpt-4', 'llama3.1:70b', ['llama3.1:8b', 'mistral:7b']],
        ['gpt-4o', 'llama3.1:70b', ['qwen3:14b', 'llama3.1:8b']],
        ['gpt-3.5-turbo', 'llama3.1:8b', ['mistral:7b', 'llama3.2:3b']],
        ['gpt-4o-mini', 'llama3.2:3b', ['llama3.2:1b', 'phi3:3.8b']],
        ['claude-3-opus', 'llama3.1:70b', ['qwen3:14b', 'llama3.1:8b']],
        ['claude-3-sonnet', 'llama3.1:8b', ['mistral:7b', 'qwen2.5:7b']],
        ['claude-3-haiku', 'llama3.2:3b', ['llama3.2:1b']],
        ['codex', 'codellama:13b', ['codellama:7b', 'qwen2.5-coder:7b']],
        ['text-embedding-ada-002', 'nomic-embed-text', []],
    ];

    for (const [alias, target, fallbacks] of defaults) {
        setModelAlias(alias, target, fallbacks);
    }
}

// =============================================================================
// Auto Mode (Wave 8) — System decides everything
// =============================================================================

export interface AutoModeDecision {
    action: string;
    reason: string;
    target?: string;
    model?: string;
    executed: boolean;
}

export function runAutoMode(): AutoModeDecision[] {
    const decisions: AutoModeDecision[] = [];
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const models = getClusterModels();

    if (nodes.length === 0) return decisions;

    // Decision 1: Empty nodes should get the most popular model
    for (const node of nodes) {
        if (!node.latest_stats) continue;
        const loadedCount = node.latest_stats.inference.loaded_models.length;
        if (loadedCount === 0) {
            // Find most popular model (most nodes have it)
            const popular = models.sort((a, b) => b.node_count - a.node_count)[0];
            const fallbackModel = popular?.model || 'llama3.2:3b';

            const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
            const recommended = getAutoModelForVram(totalVram);

            const model = recommended || fallbackModel;
            const fit = checkModelFits(model, node.id);
            if (fit.fits) {
                queueCommand(node.id, 'install_model', { model });
                decisions.push({
                    action: 'deploy_model',
                    reason: `Node ${node.hostname} has no models — deploying ${model} (${fit.required_mb}MB, ${fit.available_mb}MB free)`,
                    target: node.id,
                    model,
                    executed: true,
                });
            }
        }
    }

    // Decision 2: High-demand models should have redundancy
    const d = getDb();
    const recentRequests = d.prepare(`
        SELECT model, COUNT(*) as cnt FROM inference_log
        WHERE created_at >= datetime('now', '-1 hour')
        GROUP BY model ORDER BY cnt DESC LIMIT 5
    `).all() as Array<{ model: string; cnt: number }>;

    for (const req of recentRequests) {
        const modelInfo = models.find(m => m.model === req.model);
        if (modelInfo && modelInfo.node_count < 2 && req.cnt >= 10) {
            // Popular model on only 1 node — add redundancy
            const best = findBestNodeForModel(req.model);
            if (best) {
                queueCommand(best.node_id, 'install_model', { model: req.model });
                decisions.push({
                    action: 'add_redundancy',
                    reason: `${req.model} got ${req.cnt} requests/hr but only on 1 node — deploying to ${best.hostname}`,
                    target: best.node_id,
                    model: req.model,
                    executed: true,
                });
            }
        }
    }

    // Decision 3: Remove models unused for 7+ days
    // (We'd need per-model last-used tracking — simplified version using inference_log)
    for (const model of models) {
        const lastUsed = d.prepare(`
            SELECT MAX(created_at) as last_used FROM inference_log WHERE model = ?
        `).get(model.model) as { last_used: string | null } | undefined;

        if (lastUsed?.last_used) {
            const daysSinceUse = (Date.now() - new Date(lastUsed.last_used + 'Z').getTime()) / 86400000;
            if (daysSinceUse > 7 && model.node_count > 0) {
                decisions.push({
                    action: 'suggest_remove',
                    reason: `${model.model} hasn't been used in ${Math.round(daysSinceUse)} days`,
                    model: model.model,
                    executed: false, // Don't auto-remove, just suggest
                });
            }
        }
    }

    return decisions;
}

function getAutoModelForVram(totalVramMb: number): string | null {
    if (totalVramMb >= 40000) return 'llama3.1:70b';
    if (totalVramMb >= 16000) return 'llama3.1:8b';
    if (totalVramMb >= 8000) return 'llama3.2:3b';
    if (totalVramMb >= 4000) return 'llama3.2:1b';
    if (totalVramMb >= 2000) return 'phi3:3.8b';
    return null;
}

// =============================================================================
// API Key Management (Wave 7)
// =============================================================================

import { createHash, randomBytes } from 'crypto';

export function createApiKey(name: string, scope: string = 'inference', rateLimitRpm: number = 60): { id: string; key: string; prefix: string } {
    const d = getDb();
    const id = generateId();
    const rawKey = 'tc_' + randomBytes(24).toString('hex'); // tc_<48 hex chars>
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 10);

    d.prepare(`INSERT INTO api_keys (id, name, key_hash, key_prefix, scope, rate_limit_rpm) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id, name, keyHash, prefix, scope, rateLimitRpm
    );

    return { id, key: rawKey, prefix };
}

export function validateApiKey(rawKey: string): { valid: boolean; keyId?: string; name?: string; scope?: string; rateLimitRpm?: number } {
    const d = getDb();
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const row = d.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1').get(keyHash) as any;

    if (!row) return { valid: false };

    // Check expiration
    if (row.expires_at && new Date(row.expires_at + 'Z') < new Date()) {
        return { valid: false };
    }

    // Update last used
    d.prepare("UPDATE api_keys SET last_used_at = datetime('now'), requests_count = requests_count + 1 WHERE id = ?").run(row.id);

    return { valid: true, keyId: row.id, name: row.name, scope: row.scope, rateLimitRpm: row.rate_limit_rpm };
}

export function trackApiKeyTokens(keyId: string, tokens: number): void {
    const d = getDb();
    d.prepare('UPDATE api_keys SET tokens_used = tokens_used + ? WHERE id = ?').run(tokens, keyId);
}

export function getAllApiKeys(): any[] {
    const d = getDb();
    return d.prepare('SELECT id, name, key_prefix, scope, rate_limit_rpm, monthly_token_limit, tokens_used, requests_count, last_used_at, expires_at, enabled, created_at FROM api_keys ORDER BY created_at DESC').all() as any[];
}

export function revokeApiKey(id: string): boolean {
    const d = getDb();
    return d.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').run(id).changes > 0;
}

export function deleteApiKey(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM api_keys WHERE id = ?').run(id).changes > 0;
}

// =============================================================================
// Inference Analytics (Wave 6)
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
    const latencies = successful.map(r => r.latency_ms).sort((a, b) => a - b);

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
        avg_latency_ms: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        p50_latency_ms: p(50),
        p95_latency_ms: p(95),
        p99_latency_ms: p(99),
        total_tokens_in: rows.reduce((s, r) => s + (r.tokens_in || 0), 0),
        total_tokens_out: rows.reduce((s, r) => s + (r.tokens_out || 0), 0),
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
// Model Pull Progress
// =============================================================================

export function startModelPull(nodeId: string, model: string): ModelPullProgress {
    const d = getDb();
    const id = generateId();
    d.prepare(`
        INSERT INTO model_pulls (id, node_id, model) VALUES (?, ?, ?)
    `).run(id, nodeId, model);
    return d.prepare('SELECT * FROM model_pulls WHERE id = ?').get(id) as ModelPullProgress;
}

export function updateModelPull(nodeId: string, model: string, progress: {
    status?: string;
    progress_pct?: number;
    bytes_downloaded?: number;
    bytes_total?: number;
}): void {
    const d = getDb();
    const sets: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];

    if (progress.status) { sets.push('status = ?'); vals.push(progress.status); }
    if (progress.progress_pct !== undefined) { sets.push('progress_pct = ?'); vals.push(progress.progress_pct); }
    if (progress.bytes_downloaded !== undefined) { sets.push('bytes_downloaded = ?'); vals.push(progress.bytes_downloaded); }
    if (progress.bytes_total !== undefined) { sets.push('bytes_total = ?'); vals.push(progress.bytes_total); }

    vals.push(nodeId, model);
    d.prepare(`UPDATE model_pulls SET ${sets.join(', ')} WHERE node_id = ? AND model = ? AND status = 'downloading'`).run(...vals);
}

export function getActiveModelPulls(nodeId: string): ModelPullProgress[] {
    const d = getDb();
    return d.prepare(
        "SELECT * FROM model_pulls WHERE node_id = ? AND status IN ('downloading', 'verifying') ORDER BY started_at DESC"
    ).all(nodeId) as ModelPullProgress[];
}

export function getAllActiveModelPulls(): ModelPullProgress[] {
    const d = getDb();
    return d.prepare(
        "SELECT * FROM model_pulls WHERE status IN ('downloading', 'verifying') ORDER BY started_at DESC"
    ).all() as ModelPullProgress[];
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

// =============================================================================
// Uptime Tracking
// =============================================================================

export function recordUptimeEvent(nodeId: string, event: string, fromStatus?: string, toStatus?: string): void {
    const d = getDb();
    d.prepare('INSERT INTO uptime_events (node_id, event, from_status, to_status) VALUES (?, ?, ?, ?)').run(nodeId, event, fromStatus || null, toStatus || null);
}

export function getNodeUptime(nodeId: string, hours: number = 24): { uptime_pct: number; total_online_s: number; total_offline_s: number; events: number } {
    const d = getDb();
    const since = new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

    const events = d.prepare(
        'SELECT * FROM uptime_events WHERE node_id = ? AND created_at >= ? ORDER BY created_at'
    ).all(nodeId, since) as any[];

    // Simple calculation: count time in each state
    let onlineMs = 0;
    let offlineMs = 0;
    let lastTime = Date.now() - hours * 3600_000;
    let lastStatus = 'offline';

    // Check if node was online before the window
    const node = d.prepare('SELECT status FROM nodes WHERE id = ?').get(nodeId) as any;
    if (node) lastStatus = node.status === 'online' ? 'online' : 'offline';

    for (const evt of events) {
        const evtTime = new Date(evt.created_at + 'Z').getTime();
        const elapsed = evtTime - lastTime;
        if (lastStatus === 'online') onlineMs += elapsed;
        else offlineMs += elapsed;

        if (evt.to_status) lastStatus = evt.to_status;
        lastTime = evtTime;
    }

    // Account for time since last event
    const remaining = Date.now() - lastTime;
    if (lastStatus === 'online') onlineMs += remaining;
    else offlineMs += remaining;

    const total = onlineMs + offlineMs;
    return {
        uptime_pct: total > 0 ? Math.round((onlineMs / total) * 1000) / 10 : 0,
        total_online_s: Math.round(onlineMs / 1000),
        total_offline_s: Math.round(offlineMs / 1000),
        events: events.length,
    };
}

export function getFleetUptime(hours: number = 24): Array<{ node_id: string; hostname: string; uptime_pct: number }> {
    const d = getDb();
    const nodes = d.prepare('SELECT id, hostname FROM nodes').all() as any[];
    return nodes.map(n => {
        const uptime = getNodeUptime(n.id, hours);
        return { node_id: n.id, hostname: n.hostname, uptime_pct: uptime.uptime_pct };
    });
}

// =============================================================================
// Overclock Profiles
// =============================================================================

export function setOverclockProfile(nodeId: string, gpuIndex: number, profile: {
    core_offset_mhz?: number;
    mem_offset_mhz?: number;
    power_limit_w?: number;
    fan_speed_pct?: number;
}): void {
    const d = getDb();
    const id = `${nodeId}:${gpuIndex}`;
    const existing = d.prepare('SELECT id FROM overclock_profiles WHERE id = ?').get(id);

    if (existing) {
        const sets: string[] = ["applied_at = datetime('now')"];
        const vals: unknown[] = [];
        if (profile.core_offset_mhz !== undefined) { sets.push('core_offset_mhz = ?'); vals.push(profile.core_offset_mhz); }
        if (profile.mem_offset_mhz !== undefined) { sets.push('mem_offset_mhz = ?'); vals.push(profile.mem_offset_mhz); }
        if (profile.power_limit_w !== undefined) { sets.push('power_limit_w = ?'); vals.push(profile.power_limit_w); }
        if (profile.fan_speed_pct !== undefined) { sets.push('fan_speed_pct = ?'); vals.push(profile.fan_speed_pct); }
        vals.push(id);
        d.prepare(`UPDATE overclock_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    } else {
        d.prepare(`INSERT INTO overclock_profiles (id, node_id, gpu_index, core_offset_mhz, mem_offset_mhz, power_limit_w, fan_speed_pct) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            id, nodeId, gpuIndex,
            profile.core_offset_mhz || 0, profile.mem_offset_mhz || 0,
            profile.power_limit_w || 0, profile.fan_speed_pct || 0,
        );
    }
}

export function getOverclockProfiles(nodeId: string): any[] {
    const d = getDb();
    return d.prepare('SELECT * FROM overclock_profiles WHERE node_id = ? ORDER BY gpu_index').all(nodeId) as any[];
}

// =============================================================================
// Watchdog Events
// =============================================================================

export function recordWatchdogEvent(nodeId: string, level: number, action: string, detail: string): void {
    const d = getDb();
    d.prepare('INSERT INTO watchdog_events (node_id, level, action, detail) VALUES (?, ?, ?, ?)').run(nodeId, level, action, detail);
}

export function getWatchdogEvents(nodeId: string, limit: number = 50): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> {
    const d = getDb();
    return d.prepare('SELECT * FROM watchdog_events WHERE node_id = ? ORDER BY created_at DESC LIMIT ?').all(nodeId, limit) as any[];
}

export function getAllWatchdogEvents(limit: number = 100): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> {
    const d = getDb();
    return d.prepare('SELECT * FROM watchdog_events ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

// =============================================================================
// Notification Channels
// =============================================================================

export function createNotificationChannel(type: string, name: string, config: Record<string, unknown>): any {
    const d = getDb();
    const id = generateId();
    d.prepare('INSERT INTO notification_channels (id, type, name, config) VALUES (?, ?, ?, ?)').run(id, type, name, JSON.stringify(config));
    return d.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id);
}

export function getAllNotificationChannels(): any[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM notification_channels ORDER BY created_at').all() as any[];
    return rows.map(r => ({ ...r, config: JSON.parse(r.config), enabled: !!r.enabled }));
}

export function deleteNotificationChannel(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes > 0;
}

export async function sendNotification(channelId: string, message: string): Promise<boolean> {
    const d = getDb();
    const channel = d.prepare('SELECT * FROM notification_channels WHERE id = ? AND enabled = 1').get(channelId) as any;
    if (!channel) return false;

    const config = JSON.parse(channel.config);

    try {
        switch (channel.type) {
            case 'telegram': {
                const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: config.chat_id, text: message, parse_mode: 'HTML' }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            case 'discord': {
                const resp = await fetch(config.webhook_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: message }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            case 'webhook': {
                const resp = await fetch(config.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, timestamp: new Date().toISOString() }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            default:
                return false;
        }
    } catch {
        d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, 'error');
        return false;
    }
}

