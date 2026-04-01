/**
 * TentaCLAW Gateway — Database Initialization (SQLite)
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "I remember everything. Eight arms, one brain."
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
        runMigrations(db);
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
            permissions TEXT DEFAULT '["read","write","admin"]',
            rate_limit_rpm INTEGER DEFAULT 1000,
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

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playground_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            response_preview TEXT,
            latency_ms INTEGER NOT NULL,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            node_id TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_playground_history_time ON playground_history(created_at DESC);

        CREATE TABLE IF NOT EXISTS route_latency (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            latency_ms REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_route_latency_node_model ON route_latency(node_id, model, created_at DESC);

        CREATE TABLE IF NOT EXISTS route_throughput (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL,
            model TEXT NOT NULL,
            tokens_per_sec REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_route_throughput_node_model ON route_throughput(node_id, model, created_at DESC);

        CREATE TABLE IF NOT EXISTS model_priorities (
            model TEXT PRIMARY KEY,
            priority TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS alert_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            metric TEXT NOT NULL,
            operator TEXT NOT NULL,
            threshold REAL NOT NULL,
            severity TEXT DEFAULT 'warning',
            cooldown_secs INTEGER DEFAULT 300,
            enabled INTEGER DEFAULT 1,
            node_filter TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
}

// =============================================================================
// Migration System
// =============================================================================

interface Migration {
    version: number;
    name: string;
    up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
    {
        version: 1,
        name: 'initial_schema',
        up: (_db: Database.Database) => {
            // Already applied by initSchema — this entry exists so the migration
            // ledger accurately reflects that version 1 corresponds to the
            // original table set.
        },
    },
    {
        version: 2,
        name: 'add_route_tracking',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS route_latency (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    latency_ms INTEGER NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_route_latency_node ON route_latency(node_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_route_latency_model ON route_latency(model, created_at DESC);

                CREATE TABLE IF NOT EXISTS route_throughput (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    tokens_per_sec REAL NOT NULL,
                    requests_in_window INTEGER DEFAULT 0,
                    window_start TEXT DEFAULT (datetime('now')),
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_route_throughput_node ON route_throughput(node_id, created_at DESC);
            `);
        },
    },
    {
        version: 3,
        name: 'add_stats_retention',
        up: (db: Database.Database) => {
            db.exec(`CREATE INDEX IF NOT EXISTS idx_stats_timestamp ON stats(timestamp)`);
        },
    },
    {
        version: 4,
        name: 'add_api_key_permissions',
        up: (db: Database.Database) => {
            const cols = db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[];
            if (!cols.some(c => c.name === 'permissions')) {
                db.exec(`ALTER TABLE api_keys ADD COLUMN permissions TEXT DEFAULT '["read","write","admin"]'`);
            }
            db.exec(`UPDATE api_keys SET rate_limit_rpm = 1000 WHERE rate_limit_rpm = 60`);
        },
    },
    {
        version: 5,
        name: 'add_node_groups_and_placement',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS node_groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS node_group_members (
                    group_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    PRIMARY KEY (group_id, node_id)
                );
                CREATE TABLE IF NOT EXISTS placement_constraints (
                    id TEXT PRIMARY KEY,
                    model TEXT NOT NULL,
                    constraint_type TEXT NOT NULL,
                    target TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS playground_history (
                    id TEXT PRIMARY KEY,
                    model TEXT NOT NULL,
                    prompt_preview TEXT,
                    response_preview TEXT,
                    latency_ms INTEGER,
                    tokens_in INTEGER DEFAULT 0,
                    tokens_out INTEGER DEFAULT 0,
                    node_id TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_playground_created ON playground_history(created_at DESC);
            `);
        },
    },
    {
        version: 6,
        name: 'add_model_priorities',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS model_priorities (
                    model TEXT PRIMARY KEY,
                    priority TEXT NOT NULL DEFAULT 'normal',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );
            `);
        },
    },
    {
        version: 7,
        name: 'add_alert_rules',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS alert_rules (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    metric TEXT NOT NULL,
                    operator TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    severity TEXT DEFAULT 'warning',
                    cooldown_secs INTEGER DEFAULT 300,
                    enabled INTEGER DEFAULT 1,
                    node_filter TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
            `);
        },
    },
    {
        version: 8,
        name: 'add_users_and_sessions',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT,
                    password_hash TEXT,
                    role TEXT DEFAULT 'user',
                    created_at TEXT DEFAULT (datetime('now')),
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            `);
        },
    },
    {
        version: 9,
        name: 'add_cluster_secret_and_audit_log',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS cluster_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    actor TEXT,
                    ip_address TEXT,
                    detail TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at DESC);

                CREATE TABLE IF NOT EXISTS auth_failures (
                    ip_address TEXT NOT NULL,
                    failure_count INTEGER DEFAULT 1,
                    window_start TEXT DEFAULT (datetime('now')),
                    blocked_until TEXT,
                    PRIMARY KEY (ip_address)
                );
            `);
        },
    },
    {
        version: 10,
        name: 'add_namespaces_and_multi_tenancy',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS namespaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    labels TEXT DEFAULT '{}',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_namespaces_name ON namespaces(name);

                CREATE TABLE IF NOT EXISTS namespace_quotas (
                    namespace_id TEXT PRIMARY KEY REFERENCES namespaces(id) ON DELETE CASCADE,
                    max_gpus INTEGER DEFAULT 0,
                    max_vram_mb INTEGER DEFAULT 0,
                    max_models INTEGER DEFAULT 0,
                    max_requests_per_min INTEGER DEFAULT 0,
                    max_storage_mb INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS namespace_usage (
                    id TEXT PRIMARY KEY,
                    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
                    period TEXT NOT NULL,
                    gpu_hours REAL DEFAULT 0,
                    vram_hours_gb REAL DEFAULT 0,
                    tokens_generated INTEGER DEFAULT 0,
                    requests_served INTEGER DEFAULT 0,
                    power_kwh REAL DEFAULT 0,
                    estimated_cost_usd REAL DEFAULT 0,
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_ns_usage_ns_period ON namespace_usage(namespace_id, period);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_ns_usage_unique ON namespace_usage(namespace_id, period);
            `);

            // Add namespace column to nodes table
            const nodeCols = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
            if (!nodeCols.some(c => c.name === 'namespace')) {
                db.exec("ALTER TABLE nodes ADD COLUMN namespace TEXT DEFAULT 'default'");
            }

            // Add namespace column to api_keys table
            const keyCols = db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[];
            if (!keyCols.some(c => c.name === 'namespace')) {
                db.exec("ALTER TABLE api_keys ADD COLUMN namespace TEXT DEFAULT 'default'");
            }

            // Create indexes for namespace lookups
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
                CREATE INDEX IF NOT EXISTS idx_api_keys_namespace ON api_keys(namespace);
            `);
        },
    },
    {
        version: 11,
        name: 'add_join_tokens',
        up: (db: Database.Database) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS join_tokens (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE,
                    token_prefix TEXT NOT NULL,
                    label TEXT DEFAULT '',
                    max_uses INTEGER DEFAULT 1,
                    uses INTEGER DEFAULT 0,
                    expires_at TEXT NOT NULL,
                    created_by TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_join_tokens_hash ON join_tokens(token_hash);
            `);
        },
    },
];

/**
 * Return the highest migration version that has been applied, or 0 if none.
 */
export function getSchemaVersion(): number {
    const d = getDb();
    const row = d.prepare(
        'SELECT MAX(version) as v FROM schema_migrations'
    ).get() as { v: number | null } | undefined;
    return row?.v ?? 0;
}

/**
 * Run all pending migrations in version order.
 * Called automatically from getDb() after schema creation.
 */
function runMigrations(db: Database.Database): void {
    const current = (db.prepare(
        'SELECT MAX(version) as v FROM schema_migrations'
    ).get() as { v: number | null })?.v ?? 0;

    const pending = MIGRATIONS.filter(m => m.version > current).sort(
        (a, b) => a.version - b.version,
    );

    if (pending.length === 0) return;

    const insertMigration = db.prepare(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
    );

    for (const migration of pending) {
        console.log(
            `[db] Applying migration v${migration.version}: ${migration.name}`,
        );
        db.transaction(() => {
            migration.up(db);
            insertMigration.run(migration.version, migration.name);
        })();
        console.log(
            `[db] Migration v${migration.version} applied successfully`,
        );
    }
}

// =============================================================================
// Helpers (shared across modules)
// =============================================================================

export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Delete stats rows whose `timestamp` is older than `days` days.
 * Uses the idx_stats_timestamp index added in migration v3.
 */
export function pruneOldStats(days: number): number {
    const d = getDb();
    const cutoff = new Date(Date.now() - days * 86_400_000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    const result = d.prepare('DELETE FROM stats WHERE timestamp < ?').run(cutoff);
    return result.changes;
}

/** Re-export DB_PATH for modules that need it (e.g., auth writing password files). */
export const dbPath = DB_PATH;
