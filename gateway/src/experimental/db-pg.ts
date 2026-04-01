/**
 * TentaCLAW Gateway — PostgreSQL Database Driver
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "SQLite for homelabs. Postgres for empires."
 *
 * This module defines the full interface contract for PostgreSQL support,
 * enabling production-grade HA deployments with connection pooling, read
 * replicas, and multi-instance gateway clusters.
 *
 * Activate via:
 *   TENTACLAW_DB=postgres TENTACLAW_PG_URL=postgres://user:pass@host:5432/tentaclaw
 *
 * When TENTACLAW_DB=postgres is set, the gateway instantiates PgDatabase
 * instead of the default SQLite backend. Both implement DatabaseDriver so
 * every route handler is driver-agnostic.
 *
 * NOTE: The `pg` package is NOT installed yet. This file compiles as a
 * standalone type/interface module. To activate:
 *   npm install pg @types/pg
 *   Then swap `db.ts` imports to `db-pg.ts` in index.ts (or use the
 *   driver factory in isPgMode()).
 */

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
    ModelPullProgress,
} from '../../shared/types';

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Returns true when the gateway should use PostgreSQL instead of SQLite.
 * Checks TENTACLAW_DB environment variable.
 */
export function isPgMode(): boolean {
    return (process.env.TENTACLAW_DB || '').toLowerCase() === 'postgres';
}

/**
 * Returns the PostgreSQL connection URL from environment, or null.
 */
export function getPgUrl(): string | null {
    return process.env.TENTACLAW_PG_URL || process.env.DATABASE_URL || null;
}

// =============================================================================
// Connection Pool Configuration
// =============================================================================

export interface PgConfig {
    /** Full connection string: postgres://user:pass@host:5432/tentaclaw */
    connectionString: string;

    /** Maximum number of clients in the pool (default: 10) */
    poolSize: number;

    /** Milliseconds a client can sit idle before being closed (default: 30000) */
    idleTimeout: number;

    /** Milliseconds to wait for a connection before erroring (default: 5000) */
    connectionTimeout: number;

    /** Enable SSL/TLS connection to the server (default: false) */
    ssl: boolean;

    /** Statement timeout in milliseconds, 0 = no timeout (default: 30000) */
    statementTimeout: number;

    /** Application name reported to pg_stat_activity (default: 'tentaclaw-gateway') */
    applicationName: string;
}

/**
 * Create a PgConfig from environment variables with sensible defaults.
 */
export function buildPgConfig(urlOverride?: string): PgConfig {
    const url = urlOverride || getPgUrl();
    if (!url) {
        throw new Error(
            '[db-pg] No PostgreSQL URL configured. Set TENTACLAW_PG_URL or DATABASE_URL.',
        );
    }

    return {
        connectionString: url,
        poolSize: parseInt(process.env.TENTACLAW_PG_POOL_SIZE || '10', 10),
        idleTimeout: parseInt(process.env.TENTACLAW_PG_IDLE_TIMEOUT || '30000', 10),
        connectionTimeout: parseInt(process.env.TENTACLAW_PG_CONN_TIMEOUT || '5000', 10),
        ssl: (process.env.TENTACLAW_PG_SSL || 'false').toLowerCase() === 'true',
        statementTimeout: parseInt(process.env.TENTACLAW_PG_STMT_TIMEOUT || '30000', 10),
        applicationName: process.env.TENTACLAW_PG_APP_NAME || 'tentaclaw-gateway',
    };
}

// =============================================================================
// SQL Syntax Mapping: SQLite -> PostgreSQL
// =============================================================================

/**
 * Documents every SQL syntax difference between the SQLite schema in db.ts
 * and its PostgreSQL equivalent. Used during schema migration generation.
 */
export const SQL_DIALECT_MAP: Record<string, { sqlite: string; postgres: string; notes: string }> = {
    auto_id: {
        sqlite: 'TEXT PRIMARY KEY',
        postgres: 'TEXT PRIMARY KEY DEFAULT gen_random_uuid()',
        notes: 'UUID generation; app-generated IDs override the default',
    },
    autoincrement: {
        sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        postgres: 'SERIAL PRIMARY KEY',
        notes: 'Auto-incrementing integer PK',
    },
    datetime_now: {
        sqlite: "datetime('now')",
        postgres: 'NOW()',
        notes: 'Current timestamp expression',
    },
    datetime_default: {
        sqlite: "DEFAULT (datetime('now'))",
        postgres: 'DEFAULT NOW()',
        notes: 'Column default for created_at / updated_at',
    },
    datetime_offset: {
        sqlite: "datetime('now', '-N hours')",
        postgres: "NOW() - INTERVAL 'N hours'",
        notes: 'Time offset (replace N with actual value)',
    },
    boolean_col: {
        sqlite: 'INTEGER DEFAULT 0',
        postgres: 'BOOLEAN DEFAULT FALSE',
        notes: 'Boolean columns (enabled, acknowledged)',
    },
    boolean_true: {
        sqlite: '1',
        postgres: 'TRUE',
        notes: 'Boolean literal true',
    },
    boolean_false: {
        sqlite: '0',
        postgres: 'FALSE',
        notes: 'Boolean literal false',
    },
    json_col: {
        sqlite: 'TEXT',
        postgres: 'JSONB',
        notes: 'JSON payload columns — JSONB enables indexing and operators',
    },
    upsert: {
        sqlite: 'INSERT OR REPLACE INTO',
        postgres: 'INSERT INTO ... ON CONFLICT ... DO UPDATE SET',
        notes: 'SQLite REPLACE becomes Postgres upsert; already used for some tables',
    },
    ignore_conflict: {
        sqlite: 'INSERT OR IGNORE INTO',
        postgres: 'INSERT INTO ... ON CONFLICT DO NOTHING',
        notes: 'Used for node_tags, node_group_members',
    },
    concat: {
        sqlite: "col1 || ': ' || col2",
        postgres: "col1 || ': ' || col2",
        notes: 'String concatenation is the same in both dialects',
    },
    coalesce: {
        sqlite: "COALESCE(col, '')",
        postgres: "COALESCE(col, '')",
        notes: 'COALESCE works identically',
    },
    pragma_wal: {
        sqlite: "PRAGMA journal_mode = WAL",
        postgres: '-- N/A (WAL is default in PostgreSQL)',
        notes: 'PostgreSQL always uses WAL',
    },
    pragma_fk: {
        sqlite: "PRAGMA foreign_keys = ON",
        postgres: '-- N/A (foreign keys always enforced in PostgreSQL)',
        notes: 'FK enforcement is always on',
    },
    real_type: {
        sqlite: 'REAL',
        postgres: 'DOUBLE PRECISION',
        notes: 'Floating-point type mapping',
    },
    text_type: {
        sqlite: 'TEXT',
        postgres: 'TEXT',
        notes: 'Text type is identical',
    },
    integer_type: {
        sqlite: 'INTEGER',
        postgres: 'INTEGER',
        notes: 'Integer type is identical (32-bit)',
    },
};

// =============================================================================
// PostgreSQL Schema DDL
// =============================================================================

/**
 * Returns an array of CREATE TABLE statements for PostgreSQL.
 * Converted from the SQLite schema in db.ts initSchema() + migrations.
 *
 * Key differences from SQLite:
 *   - AUTOINCREMENT -> SERIAL
 *   - datetime('now') -> NOW()
 *   - INTEGER booleans -> BOOLEAN
 *   - TEXT for JSON -> JSONB
 *   - REAL -> DOUBLE PRECISION
 */
export function getPostgresSchema(): string[] {
    return [
        // --- Core tables ---
        `CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            farm_hash TEXT NOT NULL,
            hostname TEXT NOT NULL,
            ip_address TEXT,
            mac_address TEXT,
            registered_at TIMESTAMPTZ DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ,
            status TEXT DEFAULT 'online',
            gpu_count INTEGER DEFAULT 0,
            os_version TEXT
        )`,

        `CREATE TABLE IF NOT EXISTS stats (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            timestamp TIMESTAMPTZ DEFAULT NOW(),
            payload JSONB NOT NULL,
            gpu_count INTEGER,
            cpu_usage_pct DOUBLE PRECISION,
            ram_used_mb INTEGER,
            ram_total_mb INTEGER,
            toks_per_sec DOUBLE PRECISION
        )`,
        `CREATE INDEX IF NOT EXISTS idx_stats_node_time ON stats(node_id, timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_stats_timestamp ON stats(timestamp)`,

        `CREATE TABLE IF NOT EXISTS commands (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            payload JSONB,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            sent_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
        )`,
        `CREATE INDEX IF NOT EXISTS idx_commands_node_status ON commands(node_id, status)`,

        `CREATE TABLE IF NOT EXISTS flight_sheets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            targets JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )`,

        `CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            node_id TEXT,
            severity TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            value DOUBLE PRECISION,
            threshold DOUBLE PRECISION,
            acknowledged BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_alerts_node ON alerts(node_id, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS benchmarks (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            tokens_per_sec DOUBLE PRECISION NOT NULL,
            prompt_eval_rate DOUBLE PRECISION DEFAULT 0,
            eval_rate DOUBLE PRECISION DEFAULT 0,
            total_duration_ms INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_benchmarks_node ON benchmarks(node_id, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS node_events (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            event TEXT NOT NULL,
            detail TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_node_events ON node_events(node_id, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            cron TEXT NOT NULL,
            config JSONB NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            last_run TIMESTAMPTZ,
            next_run TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        `CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            public_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_ssh_keys_node ON ssh_keys(node_id)`,

        `CREATE TABLE IF NOT EXISTS uptime_events (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            event TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_uptime_node ON uptime_events(node_id, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS overclock_profiles (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            gpu_index INTEGER NOT NULL,
            core_offset_mhz INTEGER DEFAULT 0,
            mem_offset_mhz INTEGER DEFAULT 0,
            power_limit_w INTEGER DEFAULT 0,
            fan_speed_pct INTEGER DEFAULT 0,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_oc_node ON overclock_profiles(node_id)`,

        `CREATE TABLE IF NOT EXISTS prompt_cache (
            hash TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            response TEXT NOT NULL,
            tokens_saved INTEGER DEFAULT 0,
            hits INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ
        )`,
        `CREATE INDEX IF NOT EXISTS idx_cache_model ON prompt_cache(model)`,

        `CREATE TABLE IF NOT EXISTS model_aliases (
            alias TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            fallbacks JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // --- Migration v2: Route tracking ---
        `CREATE TABLE IF NOT EXISTS route_latency (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            latency_ms DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_route_latency_node_model ON route_latency(node_id, model, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS route_throughput (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            tokens_per_sec DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_route_throughput_node_model ON route_throughput(node_id, model, created_at DESC)`,

        // --- Migration v4: API keys ---
        `CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            scope TEXT DEFAULT 'inference',
            permissions JSONB DEFAULT '["read","write","admin"]'::jsonb,
            rate_limit_rpm INTEGER DEFAULT 1000,
            monthly_token_limit INTEGER DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            requests_count INTEGER DEFAULT 0,
            last_used_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,

        // --- Migration v5: Node groups & placement ---
        `CREATE TABLE IF NOT EXISTS node_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        `CREATE TABLE IF NOT EXISTS node_group_members (
            group_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            PRIMARY KEY (group_id, node_id)
        )`,

        `CREATE TABLE IF NOT EXISTS placement_constraints (
            id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            constraint_type TEXT NOT NULL,
            target TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // --- Migration v5: Playground history ---
        `CREATE TABLE IF NOT EXISTS playground_history (
            id SERIAL PRIMARY KEY,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            response_preview TEXT,
            latency_ms INTEGER NOT NULL,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            node_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_playground_history_time ON playground_history(created_at DESC)`,

        // --- Migration v6: Model priorities ---
        `CREATE TABLE IF NOT EXISTS model_priorities (
            model TEXT PRIMARY KEY,
            priority TEXT NOT NULL DEFAULT 'normal',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // --- Migration v7: Alert rules ---
        `CREATE TABLE IF NOT EXISTS alert_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            metric TEXT NOT NULL,
            operator TEXT NOT NULL,
            threshold DOUBLE PRECISION NOT NULL,
            severity TEXT DEFAULT 'warning',
            cooldown_secs INTEGER DEFAULT 300,
            enabled BOOLEAN DEFAULT TRUE,
            node_filter TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // --- Migration v8: Users & sessions ---
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
        )`,

        `CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,

        // --- Migration v9: Cluster config & audit log ---
        `CREATE TABLE IF NOT EXISTS cluster_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        `CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            actor TEXT,
            ip_address TEXT,
            detail TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS auth_failures (
            ip_address TEXT PRIMARY KEY,
            failure_count INTEGER DEFAULT 1,
            window_start TIMESTAMPTZ DEFAULT NOW(),
            blocked_until TIMESTAMPTZ
        )`,

        // --- Inference log ---
        `CREATE TABLE IF NOT EXISTS inference_log (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            success BOOLEAN DEFAULT TRUE,
            error TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_inference_log_time ON inference_log(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_inference_log_model ON inference_log(model, created_at DESC)`,

        // --- Watchdog events ---
        `CREATE TABLE IF NOT EXISTS watchdog_events (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            level INTEGER NOT NULL,
            action TEXT NOT NULL,
            detail TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_watchdog_node ON watchdog_events(node_id, created_at DESC)`,

        // --- Notification channels ---
        `CREATE TABLE IF NOT EXISTS notification_channels (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            config JSONB NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // --- Node tags ---
        `CREATE TABLE IF NOT EXISTS node_tags (
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (node_id, tag)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag)`,

        // --- Model pulls ---
        `CREATE TABLE IF NOT EXISTS model_pulls (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            status TEXT DEFAULT 'downloading',
            progress_pct DOUBLE PRECISION DEFAULT 0,
            bytes_downloaded INTEGER DEFAULT 0,
            bytes_total INTEGER DEFAULT 0,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_model_pulls_node ON model_pulls(node_id)`,

        // --- Schema migrations ledger ---
        `CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )`,
    ];
}

// =============================================================================
// Exported Interface Types (mirrored from db.ts)
// =============================================================================

/** Alert as returned by the database. */
export interface Alert {
    id: string;
    node_id: string;
    severity: 'warning' | 'critical';
    type: string;
    message: string;
    value: number;
    threshold: number;
    acknowledged: boolean;  // BOOLEAN in PG, not INTEGER
    created_at: string;
}

/** Custom alert rule definition. */
export interface AlertRule {
    id: string;
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    severity: string;
    cooldown_secs: number;
    enabled: boolean;  // BOOLEAN in PG, not INTEGER
    node_filter: string | null;
    created_at: string;
}

/** Benchmark record for a node. */
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

/** Cluster-wide summary statistics. */
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

/** A single node lifecycle event. */
export interface NodeEvent {
    id: number;
    node_id: string;
    event: string;
    detail: string | null;
    created_at: string;
}

/** Best node for inference routing. */
export interface InferenceTarget {
    node_id: string;
    hostname: string;
    ip_address: string | null;
    gpu_utilization_avg: number;
    in_flight_requests: number;
    backend_type: string;
    backend_port: number;
}

/** Cluster health score (0-100). */
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

/** Scheduled task definition. */
export interface Schedule {
    id: string;
    name: string;
    type: string;
    cron: string;
    config: Record<string, unknown>;
    enabled: boolean;
    last_run: string | null;
    next_run: string | null;
    created_at: string;
}

/** Auto-mode decision record. */
export interface AutoModeDecision {
    action: string;
    reason: string;
    target?: string;
    model?: string;
    executed: boolean;
}

/** API key validation result. */
export interface ApiKeyValidationResult {
    valid: boolean;
    error?: 'not_found' | 'expired' | 'insufficient_permissions';
    keyId?: string;
    name?: string;
    scope?: string;
    permissions?: string[];
    rateLimitRpm?: number;
}

/** User record (without password hash). */
export interface User {
    id: string;
    username: string;
    email: string | null;
    role: string;
    created_at: string;
    last_login_at: string | null;
}

/** Session record. */
export interface Session {
    id: string;
    user_id: string;
    token: string;
    expires_at: string;
    created_at: string;
}

/** Audit log entry. */
export interface AuditEntry {
    id: number;
    event_type: string;
    actor: string | null;
    ip_address: string | null;
    detail: string | null;
    created_at: string;
}

// =============================================================================
// DatabaseDriver Interface — Complete Contract
// =============================================================================

/**
 * The DatabaseDriver interface mirrors every exported function from db.ts.
 * Both SQLite (db.ts) and PostgreSQL (this file) must implement this contract
 * so route handlers remain driver-agnostic.
 *
 * Total: 120+ methods covering all gateway subsystems.
 */
export interface DatabaseDriver {

    // ---- Database lifecycle ----
    /** Initialize the database connection and run migrations. */
    initialize(): Promise<void>;
    /** Gracefully close the database connection / pool. */
    close(): Promise<void>;
    /** Return the current schema migration version. */
    getSchemaVersion(): number | Promise<number>;

    // ---- Stats pruning ----
    pruneOldStats(days: number): number | Promise<number>;

    // ---- Node operations ----
    registerNode(reg: {
        node_id: string;
        farm_hash: string;
        hostname: string;
        ip_address?: string;
        mac_address?: string;
        gpu_count: number;
        os_version?: string;
    }): Node | Promise<Node>;

    getNode(nodeId: string): NodeWithStats | null | Promise<NodeWithStats | null>;
    getAllNodes(): NodeWithStats[] | Promise<NodeWithStats[]>;
    getNodesByFarm(farmHash: string): NodeWithStats[] | Promise<NodeWithStats[]>;
    deleteNode(nodeId: string): boolean | Promise<boolean>;
    updateNodeStatus(nodeId: string, status: NodeStatus): void | Promise<void>;
    markStaleNodes(thresholdSecs?: number): string[] | Promise<string[]>;

    // ---- Stats operations ----
    insertStats(nodeId: string, payload: StatsPayload): void | Promise<void>;
    getStatsHistory(nodeId: string, limit?: number): StatsPayload[] | Promise<StatsPayload[]>;
    pruneStats(days?: number): number | Promise<number>;

    // ---- Command operations ----
    queueCommand(
        nodeId: string,
        action: CommandAction,
        params?: Record<string, unknown> & {
            model?: string;
            gpu?: number;
            profile?: string;
            priority?: string;
        },
    ): GatewayCommand | Promise<GatewayCommand>;
    getPendingCommands(nodeId: string): GatewayCommand[] | Promise<GatewayCommand[]>;
    completeCommand(commandId: string): void | Promise<void>;

    // ---- Flight sheet operations ----
    createFlightSheet(name: string, description: string, targets: FlightSheetTarget[]): FlightSheet | Promise<FlightSheet>;
    getAllFlightSheets(): FlightSheet[] | Promise<FlightSheet[]>;
    getFlightSheet(id: string): FlightSheet | null | Promise<FlightSheet | null>;
    deleteFlightSheet(id: string): boolean | Promise<boolean>;
    applyFlightSheet(id: string): GatewayCommand[] | Promise<GatewayCommand[]>;

    // ---- Alert operations ----
    createAlert(
        nodeId: string,
        severity: 'warning' | 'critical',
        type: string,
        message: string,
        value: number,
        threshold: number,
    ): Alert | Promise<Alert>;
    getRecentAlerts(limit?: number): Alert[] | Promise<Alert[]>;
    acknowledgeAlert(alertId: string): boolean | Promise<boolean>;
    checkAndAlert(nodeId: string, stats: StatsPayload): Alert[] | Promise<Alert[]>;

    // ---- Alert rules engine ----
    createAlertRule(rule: {
        name: string;
        metric: string;
        operator: string;
        threshold: number;
        severity?: string;
        cooldown_secs?: number;
        node_filter?: string;
    }): { id: string } | Promise<{ id: string }>;
    getAlertRules(): AlertRule[] | Promise<AlertRule[]>;
    updateAlertRule(id: string, updates: Partial<AlertRule>): boolean | Promise<boolean>;
    deleteAlertRule(id: string): boolean | Promise<boolean>;
    toggleAlertRule(id: string, enabled: boolean): boolean | Promise<boolean>;
    evaluateAlertRules(nodeId: string, stats: StatsPayload): Alert[] | Promise<Alert[]>;
    seedDefaultAlertRules(): void | Promise<void>;

    // ---- Benchmark operations ----
    storeBenchmark(nodeId: string, result: {
        model: string;
        tokens_per_sec: number;
        prompt_eval_rate?: number;
        eval_rate?: number;
        total_duration_ms?: number;
    }): BenchmarkRecord | Promise<BenchmarkRecord>;
    getNodeBenchmarks(nodeId: string, limit?: number): BenchmarkRecord[] | Promise<BenchmarkRecord[]>;
    getAllBenchmarks(limit?: number): BenchmarkRecord[] | Promise<BenchmarkRecord[]>;

    // ---- Cluster summary ----
    getClusterSummary(): ClusterSummary | Promise<ClusterSummary>;

    // ---- Node events ----
    recordNodeEvent(nodeId: string, event: string, detail?: string): void | Promise<void>;
    getNodeEvents(nodeId: string, limit?: number): NodeEvent[] | Promise<NodeEvent[]>;
    getCompactHistory(nodeId: string, limit?: number): {
        timestamps: string[];
        gpu_temps: number[][];
        gpu_utils: number[][];
        cpu_usage: number[];
        ram_pct: number[];
        toks_per_sec: number[];
    } | Promise<{
        timestamps: string[];
        gpu_temps: number[][];
        gpu_utils: number[][];
        cpu_usage: number[];
        ram_pct: number[];
        toks_per_sec: number[];
    }>;

    // ---- Inference routing ----
    recordRouteResult(nodeId: string, model: string, latencyMs: number, success: boolean): void;
    getRequestStats(): { total: number; last_hour: number; avg_latency_ms: number; error_rate_pct: number };
    recordRouteLatency(nodeId: string, model: string, latencyMs: number): void | Promise<void>;
    getNodeLatencyP50(nodeId: string, model: string): number | Promise<number>;
    recordRouteThroughput(nodeId: string, model: string, tokensPerSec: number): void | Promise<void>;
    getNodeThroughput(nodeId: string, model: string): number | Promise<number>;
    findBestNode(model: string): InferenceTarget | null | Promise<InferenceTarget | null>;
    getClusterModels(): { model: string; node_count: number; nodes: string[] }[] | Promise<{ model: string; node_count: number; nodes: string[] }[]>;
    getModelPreloadHints(): string[] | Promise<string[]>;

    // ---- Smart model management ----
    estimateModelVram(model: string): number;
    checkModelFits(model: string, nodeId: string): { fits: boolean; required_mb: number; available_mb: number; node: string } | Promise<{ fits: boolean; required_mb: number; available_mb: number; node: string }>;
    findBestNodeForModel(model: string): { node_id: string; hostname: string; available_mb: number } | null | Promise<{ node_id: string; hostname: string; available_mb: number } | null>;
    getModelDistribution(): Array<{
        model: string;
        estimated_vram_mb: number;
        nodes: Array<{ node_id: string; hostname: string }>;
        coverage: number;
    }> | Promise<Array<{
        model: string;
        estimated_vram_mb: number;
        nodes: Array<{ node_id: string; hostname: string }>;
        coverage: number;
    }>>;

    // ---- Cluster health score ----
    getHealthScore(): HealthScore | Promise<HealthScore>;

    // ---- Schedule operations ----
    createSchedule(name: string, type: string, cron: string, config: Record<string, unknown>): Schedule | Promise<Schedule>;
    getSchedule(id: string): Schedule | null | Promise<Schedule | null>;
    getAllSchedules(): Schedule[] | Promise<Schedule[]>;
    deleteSchedule(id: string): boolean | Promise<boolean>;
    toggleSchedule(id: string, enabled: boolean): boolean | Promise<boolean>;
    markScheduleRun(id: string): void | Promise<void>;
    getDueSchedules(): Schedule[] | Promise<Schedule[]>;

    // ---- SSH key management ----
    addSshKey(nodeId: string, label: string, publicKey: string): SshKey | Promise<SshKey>;
    getNodeSshKeys(nodeId: string): SshKey[] | Promise<SshKey[]>;
    deleteSshKey(keyId: string): boolean | Promise<boolean>;

    // ---- Node tags ----
    addNodeTag(nodeId: string, tag: string): void | Promise<void>;
    removeNodeTag(nodeId: string, tag: string): boolean | Promise<boolean>;
    getNodeTags(nodeId: string): string[] | Promise<string[]>;
    getNodesByTag(tag: string): NodeWithStats[] | Promise<NodeWithStats[]>;
    getAllTags(): Array<{ tag: string; count: number }> | Promise<Array<{ tag: string; count: number }>>;

    // ---- Fleet reliability ----
    getNodeHealthScore(nodeId: string): { score: number; grade: string; factors: Record<string, number> } | Promise<{ score: number; grade: string; factors: Record<string, number> }>;
    getFleetReliability(): Array<{
        node_id: string; hostname: string; health_score: number; grade: string;
        uptime_pct: number; gpu_count: number; models: number; status: string;
    }> | Promise<Array<{
        node_id: string; hostname: string; health_score: number; grade: string;
        uptime_pct: number; gpu_count: number; models: number; status: string;
    }>>;

    // ---- Config export/import ----
    exportClusterConfig(): Record<string, unknown> | Promise<Record<string, unknown>>;
    importClusterConfig(config: Record<string, any>): { imported: string[]; errors: string[] } | Promise<{ imported: string[]; errors: string[] }>;

    // ---- Cluster timeline ----
    getClusterTimeline(limit?: number): Array<{
        type: string; source: string; node_id?: string; message: string; severity: string; created_at: string;
    }> | Promise<Array<{
        type: string; source: string; node_id?: string; message: string; severity: string; created_at: string;
    }>>;

    // ---- Maintenance mode ----
    setMaintenanceMode(nodeId: string, enabled: boolean): void | Promise<void>;
    isInMaintenance(nodeId: string): boolean | Promise<boolean>;

    // ---- Power & cost tracking ----
    getClusterPower(): {
        total_watts: number;
        per_node: Array<{ node_id: string; hostname: string; watts: number; gpu_watts: number; gpu_count: number }>;
        daily_kwh: number;
        monthly_kwh: number;
        daily_cost: number;
        monthly_cost: number;
        cost_per_request: number;
        cost_per_1k_tokens: number;
        electricity_rate: number;
    } | Promise<{
        total_watts: number;
        per_node: Array<{ node_id: string; hostname: string; watts: number; gpu_watts: number; gpu_count: number }>;
        daily_kwh: number;
        monthly_kwh: number;
        daily_cost: number;
        monthly_cost: number;
        cost_per_request: number;
        cost_per_1k_tokens: number;
        electricity_rate: number;
    }>;

    // ---- Prompt cache ----
    getCachedResponse(promptHash: string): { response: string; tokens_saved: number } | null | Promise<{ response: string; tokens_saved: number } | null>;
    cacheResponse(promptHash: string, model: string, promptPreview: string, response: string, tokensSaved: number, ttlMinutes?: number): void | Promise<void>;
    getCacheStats(): { entries: number; total_hits: number; total_tokens_saved: number } | Promise<{ entries: number; total_hits: number; total_tokens_saved: number }>;
    pruneCache(): number | Promise<number>;

    // ---- Model aliases & fallback chains ----
    setModelAlias(alias: string, target: string, fallbacks?: string[]): void | Promise<void>;
    resolveModelAlias(model: string): { target: string; fallbacks: string[] } | Promise<{ target: string; fallbacks: string[] }>;
    getAllModelAliases(): Array<{ alias: string; target: string; fallbacks: string[]; created_at: string }> | Promise<Array<{ alias: string; target: string; fallbacks: string[]; created_at: string }>>;
    deleteModelAlias(alias: string): boolean | Promise<boolean>;
    ensureDefaultAliases(): void | Promise<void>;

    // ---- Node groups ----
    createNodeGroup(name: string, description?: string): { id: string; name: string } | Promise<{ id: string; name: string }>;
    getNodeGroups(): Array<{ id: string; name: string; description: string | null; member_count: number }> | Promise<Array<{ id: string; name: string; description: string | null; member_count: number }>>;
    addNodeToGroup(groupId: string, nodeId: string): void | Promise<void>;
    removeNodeFromGroup(groupId: string, nodeId: string): void | Promise<void>;
    getGroupMembers(groupId: string): string[] | Promise<string[]>;
    deleteNodeGroup(id: string): boolean | Promise<boolean>;

    // ---- Placement constraints ----
    addPlacementConstraint(model: string, constraintType: string, target: string): { id: string } | Promise<{ id: string }>;
    getPlacementConstraints(model?: string): Array<{ id: string; model: string; constraint_type: string; target: string }> | Promise<Array<{ id: string; model: string; constraint_type: string; target: string }>>;
    deletePlacementConstraint(id: string): boolean | Promise<boolean>;

    // ---- Auto mode ----
    runAutoMode(): AutoModeDecision[] | Promise<AutoModeDecision[]>;

    // ---- API key management ----
    createApiKey(
        name: string,
        scope?: string,
        rateLimitRpm?: number,
        permissions?: string[],
        expiresAt?: string,
    ): { id: string; key: string; name: string; prefix: string; permissions: string[] } | Promise<{ id: string; key: string; name: string; prefix: string; permissions: string[] }>;
    validateApiKey(rawKey: string, requiredPermission?: string): ApiKeyValidationResult | Promise<ApiKeyValidationResult>;
    trackApiKeyTokens(keyId: string, tokens: number): void | Promise<void>;
    getAllApiKeys(): any[] | Promise<any[]>;
    revokeApiKey(id: string): boolean | Promise<boolean>;
    deleteApiKey(id: string): boolean | Promise<boolean>;

    // ---- Inference analytics ----
    logInferenceRequest(nodeId: string, model: string, latencyMs: number, success: boolean, tokensIn?: number, tokensOut?: number, error?: string): void | Promise<void>;
    getInferenceAnalytics(hours?: number): {
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
    } | Promise<{
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
    }>;

    // ---- Model pull progress ----
    startModelPull(nodeId: string, model: string): ModelPullProgress | Promise<ModelPullProgress>;
    updateModelPull(nodeId: string, model: string, progress: {
        status?: string;
        progress_pct?: number;
        bytes_downloaded?: number;
        bytes_total?: number;
    }): void | Promise<void>;
    getActiveModelPulls(nodeId: string): ModelPullProgress[] | Promise<ModelPullProgress[]>;
    getAllActiveModelPulls(): ModelPullProgress[] | Promise<ModelPullProgress[]>;

    // ---- Uptime tracking ----
    recordUptimeEvent(nodeId: string, event: string, fromStatus?: string, toStatus?: string): void | Promise<void>;
    getNodeUptime(nodeId: string, hours?: number): { uptime_pct: number; total_online_s: number; total_offline_s: number; events: number } | Promise<{ uptime_pct: number; total_online_s: number; total_offline_s: number; events: number }>;
    getFleetUptime(hours?: number): Array<{ node_id: string; hostname: string; uptime_pct: number }> | Promise<Array<{ node_id: string; hostname: string; uptime_pct: number }>>;

    // ---- Overclock profiles ----
    setOverclockProfile(nodeId: string, gpuIndex: number, profile: {
        core_offset_mhz?: number;
        mem_offset_mhz?: number;
        power_limit_w?: number;
        fan_speed_pct?: number;
    }): void | Promise<void>;
    getOverclockProfiles(nodeId: string): any[] | Promise<any[]>;

    // ---- Watchdog events ----
    recordWatchdogEvent(nodeId: string, level: number, action: string, detail: string): void | Promise<void>;
    getWatchdogEvents(nodeId: string, limit?: number): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> | Promise<Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }>>;
    getAllWatchdogEvents(limit?: number): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> | Promise<Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }>>;

    // ---- Notification channels ----
    createNotificationChannel(type: string, name: string, config: Record<string, unknown>): any | Promise<any>;
    getAllNotificationChannels(): any[] | Promise<any[]>;
    deleteNotificationChannel(id: string): boolean | Promise<boolean>;
    sendNotification(channelId: string, message: string): Promise<boolean>;

    // ---- Playground history ----
    insertPlaygroundHistory(entry: {
        model: string;
        prompt_preview: string;
        response_preview: string;
        latency_ms: number;
        tokens_in?: number;
        tokens_out?: number;
        node_id?: string;
    }): void | Promise<void>;
    getPlaygroundHistory(limit?: number): Array<{
        id: number;
        model: string;
        prompt_preview: string;
        response_preview: string;
        latency_ms: number;
        tokens_in: number;
        tokens_out: number;
        node_id: string | null;
        created_at: string;
    }> | Promise<Array<{
        id: number;
        model: string;
        prompt_preview: string;
        response_preview: string;
        latency_ms: number;
        tokens_in: number;
        tokens_out: number;
        node_id: string | null;
        created_at: string;
    }>>;

    // ---- Model scheduling engine ----
    getEvictionCandidates(nodeId: string): Array<{ model: string; last_used: string; request_count: number; vram_mb: number }> | Promise<Array<{ model: string; last_used: string; request_count: number; vram_mb: number }>>;
    scheduleModelDeployment(model: string, count?: number): Array<{ node_id: string; hostname: string; available_vram_mb: number; evictions_needed: string[] }> | Promise<Array<{ node_id: string; hostname: string; available_vram_mb: number; evictions_needed: string[] }>>;
    setModelPriority(model: string, priority: 'critical' | 'normal' | 'low'): void | Promise<void>;
    getModelPriority(model: string): ('critical' | 'normal' | 'low') | Promise<'critical' | 'normal' | 'low'>;
    getModelPriorities(): Array<{ model: string; priority: string }> | Promise<Array<{ model: string; priority: string }>>;
    getIdleModels(minutesIdle?: number): Array<{ model: string; node_id: string; last_used: string; idle_minutes: number }> | Promise<Array<{ model: string; node_id: string; last_used: string; idle_minutes: number }>>;
    getClusterCapacity(): { total_vram_mb: number; used_vram_mb: number; free_vram_mb: number; models_loaded: number; max_additional_models: number } | Promise<{ total_vram_mb: number; used_vram_mb: number; free_vram_mb: number; models_loaded: number; max_additional_models: number }>;

    // ---- Multi-tenant authentication ----
    createUser(username: string, password: string, role?: string, email?: string): User | Promise<User>;
    authenticateUser(username: string, password: string): User | null | Promise<User | null>;
    createSession(userId: string): { token: string; expires_at: string } | Promise<{ token: string; expires_at: string }>;
    validateSession(token: string): User | null | Promise<User | null>;
    invalidateSession(token: string): boolean | Promise<boolean>;
    getUsers(): User[] | Promise<User[]>;
    deleteUser(id: string): boolean | Promise<boolean>;
    updateUserRole(id: string, role: string): boolean | Promise<boolean>;
    createDefaultAdmin(): User | null | Promise<User | null>;

    // ---- Cluster config ----
    getClusterConfig(key: string): string | null | Promise<string | null>;
    setClusterConfig(key: string, value: string): void | Promise<void>;
    getOrCreateClusterSecret(): string | Promise<string>;

    // ---- Audit logging ----
    recordAuditEvent(eventType: string, actor?: string, ipAddress?: string, detail?: string): void | Promise<void>;
    getAuditLog(limit?: number, eventType?: string): AuditEntry[] | Promise<AuditEntry[]>;

    // ---- Auth failure tracking ----
    recordAuthFailure(ipAddress: string): boolean | Promise<boolean>;
    isIpBlocked(ipAddress: string): boolean | Promise<boolean>;
    clearAuthFailures(ipAddress: string): void | Promise<void>;
}

// =============================================================================
// Connection Pool Management (stub — requires `pg` package)
// =============================================================================

/**
 * Pool wrapper. When `pg` is installed, this manages the connection pool.
 * Currently a stub interface that documents the expected API.
 */

/** Placeholder type for pg.Pool — replaced by actual import when pg is installed. */
type PgPool = {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
    connect(): Promise<{ release(): void; query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> }>;
    end(): Promise<void>;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
};

let _pool: PgPool | null = null;

/**
 * Create and store the PostgreSQL connection pool.
 * Call once at gateway startup when isPgMode() returns true.
 *
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * import { buildPgConfig, createPool } from './db-pg';
 *
 * const config = buildPgConfig();
 * const pgPool = new Pool({
 *     connectionString: config.connectionString,
 *     max: config.poolSize,
 *     idleTimeoutMillis: config.idleTimeout,
 *     connectionTimeoutMillis: config.connectionTimeout,
 *     ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
 *     application_name: config.applicationName,
 * });
 * createPool(pgPool as any);
 * ```
 */
export function createPool(pool: PgPool): void {
    _pool = pool;
    console.log('[db-pg] PostgreSQL connection pool created');
}

/**
 * Get the active connection pool.
 * Throws if createPool() has not been called.
 */
export function getPool(): PgPool {
    if (!_pool) {
        throw new Error('[db-pg] PostgreSQL pool not initialized. Call createPool() first.');
    }
    return _pool;
}

/**
 * Gracefully shut down the connection pool.
 * Call during gateway shutdown.
 */
export async function closePool(): Promise<void> {
    if (_pool) {
        await _pool.end();
        _pool = null;
        console.log('[db-pg] PostgreSQL connection pool closed');
    }
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check the health of the PostgreSQL connection.
 * Returns pool statistics and connection latency.
 */
export async function checkPgHealth(): Promise<{
    connected: boolean;
    latency_ms: number;
    pool_size: number;
    idle: number;
    waiting: number;
}> {
    if (!_pool) {
        return { connected: false, latency_ms: -1, pool_size: 0, idle: 0, waiting: 0 };
    }

    const start = Date.now();
    try {
        await _pool.query('SELECT 1');
        return {
            connected: true,
            latency_ms: Date.now() - start,
            pool_size: _pool.totalCount,
            idle: _pool.idleCount,
            waiting: _pool.waitingCount,
        };
    } catch {
        return {
            connected: false,
            latency_ms: Date.now() - start,
            pool_size: _pool.totalCount,
            idle: _pool.idleCount,
            waiting: _pool.waitingCount,
        };
    }
}

// =============================================================================
// Driver Factory
// =============================================================================

/**
 * Create the appropriate database driver based on environment configuration.
 *
 * Usage in index.ts:
 * ```typescript
 * import { isPgMode } from './db-pg';
 *
 * if (isPgMode()) {
 *     // PostgreSQL mode — requires `pg` package
 *     const { Pool } = await import('pg');
 *     const { buildPgConfig, createPool } = await import('./db-pg');
 *     const config = buildPgConfig();
 *     createPool(new Pool({ ... }) as any);
 *     console.log('[gateway] Using PostgreSQL backend');
 * } else {
 *     // SQLite mode (default) — single instance
 *     const { getDb } = await import('./db');
 *     getDb(); // Initialize
 *     console.log('[gateway] Using SQLite backend');
 * }
 * ```
 */
export function getDriverInfo(): {
    driver: 'sqlite' | 'postgres';
    url: string | null;
    poolSize: number;
    ssl: boolean;
} {
    if (isPgMode()) {
        const config = buildPgConfig();
        // Mask password in URL for logging
        const maskedUrl = config.connectionString.replace(
            /\/\/([^:]+):([^@]+)@/,
            '//$1:****@',
        );
        return {
            driver: 'postgres',
            url: maskedUrl,
            poolSize: config.poolSize,
            ssl: config.ssl,
        };
    }
    return {
        driver: 'sqlite',
        url: null,
        poolSize: 1,
        ssl: false,
    };
}

// =============================================================================
// PostgreSQL-specific Query Helpers
// =============================================================================

/**
 * Helper to convert SQLite datetime('now') calls in SQL strings to NOW().
 * Used during the transition period when porting queries from db.ts.
 */
export function sqliteToPostgres(sql: string): string {
    return sql
        // datetime('now') -> NOW()
        .replace(/datetime\('now'\)/gi, 'NOW()')
        // datetime('now', '-N hours') -> NOW() - INTERVAL 'N hours'
        .replace(/datetime\('now',\s*'-(\d+)\s+hours?'\)/gi, "NOW() - INTERVAL '$1 hours'")
        // datetime('now', '-N minutes') -> NOW() - INTERVAL 'N minutes'
        .replace(/datetime\('now',\s*'-(\d+)\s+minutes?'\)/gi, "NOW() - INTERVAL '$1 minutes'")
        // INSERT OR REPLACE INTO -> INSERT INTO ... ON CONFLICT ... DO UPDATE SET
        // (manual conversion needed per-table — this just flags it)
        .replace(/INSERT OR REPLACE INTO/gi, '/* TODO: convert to ON CONFLICT upsert */ INSERT INTO')
        // INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
        .replace(/INSERT OR IGNORE INTO/gi, '/* TODO: convert to ON CONFLICT DO NOTHING */ INSERT INTO')
        // INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
}

/**
 * Parameterized query helper that uses $1, $2, ... (Postgres style)
 * instead of ? (SQLite style).
 */
export function convertPlaceholders(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => {
        index++;
        return `$${index}`;
    });
}
