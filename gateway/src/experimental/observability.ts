// F:\tentaclaw-os\gateway\src\observability.ts
// AI Observability — Trace Every Inference Request
// TentaCLAW says: "I see everything. Every token. Every millisecond."

import { getDb } from './db';
import { percentile } from './profiler';
import { randomBytes } from 'crypto';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface InferenceTrace {
    traceId: string;
    requestId: string;
    model: string;
    namespace: string;
    nodeId: string;
    backend: string;

    // Timing breakdown
    timing: {
        total_ms: number;
        routing_ms: number;        // time to pick node
        queue_ms: number;           // time in queue
        ttft_ms: number;            // time to first token
        generation_ms: number;      // token generation time
        network_ms: number;         // network overhead
    };

    // Token usage
    tokens: {
        prompt: number;
        completion: number;
        total: number;
        tokens_per_second: number;
    };

    // Request details
    request: {
        messages_count: number;
        system_prompt_length: number;
        has_tools: boolean;
        has_images: boolean;
        stream: boolean;
        temperature: number;
    };

    // Response quality signals
    quality: {
        finish_reason: string;
        cache_hit: boolean;
        retry_count: number;
        error?: string;
    };

    // Cost
    cost: {
        electricity_usd: number;
        cloud_equivalent_usd: number;
        savings_usd: number;
    };

    timestamp: string;
}

export interface TraceFilters {
    model?: string;
    namespace?: string;
    nodeId?: string;
    backend?: string;
    minLatency?: number;
    maxLatency?: number;
    hasError?: boolean;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
}

export interface TraceStats {
    period: string;
    total_requests: number;
    avg_total_ms: number;
    avg_ttft_ms: number;
    avg_tokens_per_second: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    error_count: number;
    error_rate_pct: number;
    cache_hit_rate_pct: number;
    total_electricity_usd: number;
    total_savings_usd: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
}

export interface LangfuseConfig {
    host: string;
    publicKey: string;
    secretKey: string;
    enabled: boolean;
    batchSize: number;
    flushIntervalMs: number;
}

export interface AnomalyReport {
    type: 'latency_spike' | 'error_rate_increase' | 'throughput_drop' | 'cost_anomaly';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    current_value: number;
    baseline_value: number;
    deviation_pct: number;
    detected_at: string;
}

export interface ModelPerformance {
    model: string;
    request_count: number;
    avg_total_ms: number;
    avg_ttft_ms: number;
    avg_tokens_per_second: number;
    error_rate_pct: number;
    avg_prompt_tokens: number;
    avg_completion_tokens: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
}

export interface NodePerformance {
    nodeId: string;
    request_count: number;
    avg_total_ms: number;
    avg_ttft_ms: number;
    avg_tokens_per_second: number;
    error_rate_pct: number;
    models_served: string[];
    p50_latency_ms: number;
    p95_latency_ms: number;
}

export interface UsagePattern {
    peak_hours: Array<{ hour: number; request_count: number }>;
    popular_models: Array<{ model: string; request_count: number; token_count: number }>;
    request_distribution: {
        by_namespace: Array<{ namespace: string; count: number }>;
        by_backend: Array<{ backend: string; count: number }>;
        streaming_pct: number;
        tool_use_pct: number;
        image_pct: number;
    };
}

export interface ObservabilityDashboard {
    volume: {
        last_1h: number;
        last_24h: number;
        last_7d: number;
    };
    latency_percentiles: {
        p50_ms: number;
        p95_ms: number;
        p99_ms: number;
    };
    latency_trend: Array<{ period: string; p50: number; p95: number; p99: number }>;
    error_rate_trend: Array<{ period: string; error_rate_pct: number }>;
    top_models: Array<{ model: string; request_count: number; avg_latency_ms: number }>;
    top_users_by_tokens: Array<{ namespace: string; total_tokens: number }>;
    slowest_requests: Array<{ traceId: string; model: string; total_ms: number; timestamp: string }>;
    cost_breakdown: {
        total_electricity_usd: number;
        total_cloud_equivalent_usd: number;
        total_savings_usd: number;
    };
}

// =============================================================================
// Constants
// =============================================================================

const MAX_TRACES = 10_000;
const ANOMALY_LOOKBACK_HOURS = 24;
const ANOMALY_DEVIATION_THRESHOLD = 2.0; // 2x standard deviation

// =============================================================================
// Schema Initialization
// =============================================================================

/**
 * Initialize the inference_traces table. Called on first use.
 * Uses IF NOT EXISTS so it's safe to call repeatedly.
 */
function ensureSchema(): void {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS inference_traces (
            trace_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            model TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            node_id TEXT NOT NULL,
            backend TEXT NOT NULL DEFAULT 'ollama',

            -- Timing breakdown
            timing_total_ms REAL NOT NULL DEFAULT 0,
            timing_routing_ms REAL NOT NULL DEFAULT 0,
            timing_queue_ms REAL NOT NULL DEFAULT 0,
            timing_ttft_ms REAL NOT NULL DEFAULT 0,
            timing_generation_ms REAL NOT NULL DEFAULT 0,
            timing_network_ms REAL NOT NULL DEFAULT 0,

            -- Token usage
            tokens_prompt INTEGER NOT NULL DEFAULT 0,
            tokens_completion INTEGER NOT NULL DEFAULT 0,
            tokens_total INTEGER NOT NULL DEFAULT 0,
            tokens_per_second REAL NOT NULL DEFAULT 0,

            -- Request details
            req_messages_count INTEGER NOT NULL DEFAULT 0,
            req_system_prompt_length INTEGER NOT NULL DEFAULT 0,
            req_has_tools INTEGER NOT NULL DEFAULT 0,
            req_has_images INTEGER NOT NULL DEFAULT 0,
            req_stream INTEGER NOT NULL DEFAULT 0,
            req_temperature REAL NOT NULL DEFAULT 0.7,

            -- Response quality signals
            quality_finish_reason TEXT NOT NULL DEFAULT 'stop',
            quality_cache_hit INTEGER NOT NULL DEFAULT 0,
            quality_retry_count INTEGER NOT NULL DEFAULT 0,
            quality_error TEXT,

            -- Cost
            cost_electricity_usd REAL NOT NULL DEFAULT 0,
            cost_cloud_equivalent_usd REAL NOT NULL DEFAULT 0,
            cost_savings_usd REAL NOT NULL DEFAULT 0,

            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON inference_traces(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_traces_model ON inference_traces(model, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_traces_namespace ON inference_traces(namespace, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_traces_node ON inference_traces(node_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_traces_latency ON inference_traces(timing_total_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_traces_error ON inference_traces(quality_error, timestamp DESC);
    `);

    // Langfuse config table
    db.exec(`
        CREATE TABLE IF NOT EXISTS langfuse_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            host TEXT NOT NULL DEFAULT 'https://cloud.langfuse.com',
            public_key TEXT NOT NULL DEFAULT '',
            secret_key TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 0,
            batch_size INTEGER NOT NULL DEFAULT 10,
            flush_interval_ms INTEGER NOT NULL DEFAULT 5000
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
// Helper: serialize / deserialize traces
// =============================================================================

interface TraceRow {
    trace_id: string;
    request_id: string;
    model: string;
    namespace: string;
    node_id: string;
    backend: string;
    timing_total_ms: number;
    timing_routing_ms: number;
    timing_queue_ms: number;
    timing_ttft_ms: number;
    timing_generation_ms: number;
    timing_network_ms: number;
    tokens_prompt: number;
    tokens_completion: number;
    tokens_total: number;
    tokens_per_second: number;
    req_messages_count: number;
    req_system_prompt_length: number;
    req_has_tools: number;
    req_has_images: number;
    req_stream: number;
    req_temperature: number;
    quality_finish_reason: string;
    quality_cache_hit: number;
    quality_retry_count: number;
    quality_error: string | null;
    cost_electricity_usd: number;
    cost_cloud_equivalent_usd: number;
    cost_savings_usd: number;
    timestamp: string;
}

function rowToTrace(row: TraceRow): InferenceTrace {
    return {
        traceId: row.trace_id,
        requestId: row.request_id,
        model: row.model,
        namespace: row.namespace,
        nodeId: row.node_id,
        backend: row.backend,
        timing: {
            total_ms: row.timing_total_ms,
            routing_ms: row.timing_routing_ms,
            queue_ms: row.timing_queue_ms,
            ttft_ms: row.timing_ttft_ms,
            generation_ms: row.timing_generation_ms,
            network_ms: row.timing_network_ms,
        },
        tokens: {
            prompt: row.tokens_prompt,
            completion: row.tokens_completion,
            total: row.tokens_total,
            tokens_per_second: row.tokens_per_second,
        },
        request: {
            messages_count: row.req_messages_count,
            system_prompt_length: row.req_system_prompt_length,
            has_tools: row.req_has_tools === 1,
            has_images: row.req_has_images === 1,
            stream: row.req_stream === 1,
            temperature: row.req_temperature,
        },
        quality: {
            finish_reason: row.quality_finish_reason,
            cache_hit: row.quality_cache_hit === 1,
            retry_count: row.quality_retry_count,
            error: row.quality_error ?? undefined,
        },
        cost: {
            electricity_usd: row.cost_electricity_usd,
            cloud_equivalent_usd: row.cost_cloud_equivalent_usd,
            savings_usd: row.cost_savings_usd,
        },
        timestamp: row.timestamp,
    };
}

// =============================================================================
// Trace Recording (Ring Buffer — last 10K traces)
// =============================================================================

/**
 * Record a new inference trace. Enforces the 10K ring buffer by deleting
 * the oldest traces when the limit is exceeded.
 */
export function recordTrace(trace: InferenceTrace): void {
    ensureReady();
    const db = getDb();

    // Generate traceId if not provided
    const traceId = trace.traceId || randomBytes(16).toString('hex');

    db.prepare(`
        INSERT INTO inference_traces (
            trace_id, request_id, model, namespace, node_id, backend,
            timing_total_ms, timing_routing_ms, timing_queue_ms,
            timing_ttft_ms, timing_generation_ms, timing_network_ms,
            tokens_prompt, tokens_completion, tokens_total, tokens_per_second,
            req_messages_count, req_system_prompt_length,
            req_has_tools, req_has_images, req_stream, req_temperature,
            quality_finish_reason, quality_cache_hit, quality_retry_count, quality_error,
            cost_electricity_usd, cost_cloud_equivalent_usd, cost_savings_usd,
            timestamp
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?
        )
    `).run(
        traceId, trace.requestId, trace.model, trace.namespace, trace.nodeId, trace.backend,
        trace.timing.total_ms, trace.timing.routing_ms, trace.timing.queue_ms,
        trace.timing.ttft_ms, trace.timing.generation_ms, trace.timing.network_ms,
        trace.tokens.prompt, trace.tokens.completion, trace.tokens.total, trace.tokens.tokens_per_second,
        trace.request.messages_count, trace.request.system_prompt_length,
        trace.request.has_tools ? 1 : 0, trace.request.has_images ? 1 : 0,
        trace.request.stream ? 1 : 0, trace.request.temperature,
        trace.quality.finish_reason, trace.quality.cache_hit ? 1 : 0,
        trace.quality.retry_count, trace.quality.error ?? null,
        trace.cost.electricity_usd, trace.cost.cloud_equivalent_usd, trace.cost.savings_usd,
        trace.timestamp || new Date().toISOString(),
    );

    // Ring buffer enforcement: delete oldest traces when exceeding MAX_TRACES
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM inference_traces').get() as { cnt: number };
    if (countRow.cnt > MAX_TRACES) {
        const excess = countRow.cnt - MAX_TRACES;
        db.prepare(`
            DELETE FROM inference_traces WHERE trace_id IN (
                SELECT trace_id FROM inference_traces
                ORDER BY timestamp ASC
                LIMIT ?
            )
        `).run(excess);
    }
}

/**
 * Get a single trace by its traceId.
 */
export function getTrace(traceId: string): InferenceTrace | null {
    ensureReady();
    const db = getDb();
    const row = db.prepare('SELECT * FROM inference_traces WHERE trace_id = ?').get(traceId) as TraceRow | undefined;
    return row ? rowToTrace(row) : null;
}

/**
 * List traces with optional filters: model, namespace, node, time range, latency range.
 */
export function listTraces(filters?: TraceFilters): InferenceTrace[] {
    ensureReady();
    const db = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.model) {
        conditions.push('model = ?');
        params.push(filters.model);
    }
    if (filters?.namespace) {
        conditions.push('namespace = ?');
        params.push(filters.namespace);
    }
    if (filters?.nodeId) {
        conditions.push('node_id = ?');
        params.push(filters.nodeId);
    }
    if (filters?.backend) {
        conditions.push('backend = ?');
        params.push(filters.backend);
    }
    if (filters?.minLatency !== undefined) {
        conditions.push('timing_total_ms >= ?');
        params.push(filters.minLatency);
    }
    if (filters?.maxLatency !== undefined) {
        conditions.push('timing_total_ms <= ?');
        params.push(filters.maxLatency);
    }
    if (filters?.hasError === true) {
        conditions.push('quality_error IS NOT NULL');
    } else if (filters?.hasError === false) {
        conditions.push('quality_error IS NULL');
    }
    if (filters?.startTime) {
        conditions.push('timestamp >= ?');
        params.push(filters.startTime);
    }
    if (filters?.endTime) {
        conditions.push('timestamp <= ?');
        params.push(filters.endTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;

    const rows = db.prepare(
        `SELECT * FROM inference_traces ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as TraceRow[];

    return rows.map(rowToTrace);
}

/**
 * Aggregated trace stats for a time period.
 * @param period - 'hour', 'day', or 'week'
 */
export function getTraceStats(period: 'hour' | 'day' | 'week'): TraceStats[] {
    ensureReady();
    const db = getDb();

    const intervalMap: Record<string, string> = {
        hour: "strftime('%Y-%m-%d %H:00', timestamp)",
        day: "strftime('%Y-%m-%d', timestamp)",
        week: "strftime('%Y-W%W', timestamp)",
    };
    const groupExpr = intervalMap[period];

    // Get aggregated data grouped by period
    const rows = db.prepare(`
        SELECT
            ${groupExpr} as period,
            COUNT(*) as total_requests,
            AVG(timing_total_ms) as avg_total_ms,
            AVG(timing_ttft_ms) as avg_ttft_ms,
            AVG(tokens_per_second) as avg_tokens_per_second,
            SUM(tokens_prompt) as total_prompt_tokens,
            SUM(tokens_completion) as total_completion_tokens,
            SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
            SUM(CASE WHEN quality_cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
            SUM(cost_electricity_usd) as total_electricity_usd,
            SUM(cost_savings_usd) as total_savings_usd
        FROM inference_traces
        GROUP BY ${groupExpr}
        ORDER BY period DESC
        LIMIT 100
    `).all() as Array<{
        period: string;
        total_requests: number;
        avg_total_ms: number;
        avg_ttft_ms: number;
        avg_tokens_per_second: number;
        total_prompt_tokens: number;
        total_completion_tokens: number;
        error_count: number;
        cache_hits: number;
        total_electricity_usd: number;
        total_savings_usd: number;
    }>;

    // For each period, also compute latency percentiles
    return rows.map(row => {
        const latencies = db.prepare(`
            SELECT timing_total_ms FROM inference_traces
            WHERE ${groupExpr} = ?
            ORDER BY timing_total_ms
        `).all(row.period) as Array<{ timing_total_ms: number }>;

        const latencyValues = latencies.map(l => l.timing_total_ms);

        return {
            period: row.period,
            total_requests: row.total_requests,
            avg_total_ms: Math.round(row.avg_total_ms * 100) / 100,
            avg_ttft_ms: Math.round(row.avg_ttft_ms * 100) / 100,
            avg_tokens_per_second: Math.round(row.avg_tokens_per_second * 100) / 100,
            total_prompt_tokens: row.total_prompt_tokens,
            total_completion_tokens: row.total_completion_tokens,
            error_count: row.error_count,
            error_rate_pct: row.total_requests > 0
                ? Math.round((row.error_count / row.total_requests) * 10000) / 100
                : 0,
            cache_hit_rate_pct: row.total_requests > 0
                ? Math.round((row.cache_hits / row.total_requests) * 10000) / 100
                : 0,
            total_electricity_usd: Math.round(row.total_electricity_usd * 10000) / 10000,
            total_savings_usd: Math.round(row.total_savings_usd * 10000) / 10000,
            p50_latency_ms: Math.round(percentile(latencyValues, 50) * 100) / 100,
            p95_latency_ms: Math.round(percentile(latencyValues, 95) * 100) / 100,
            p99_latency_ms: Math.round(percentile(latencyValues, 99) * 100) / 100,
        };
    });
}

// =============================================================================
// Langfuse Export (optional, when configured)
// =============================================================================

/**
 * Configure Langfuse integration.
 */
export function configureLangfuse(config: {
    host: string;
    publicKey: string;
    secretKey: string;
    batchSize?: number;
    flushIntervalMs?: number;
}): void {
    ensureReady();
    const db = getDb();

    // Upsert the single config row
    db.prepare(`
        INSERT INTO langfuse_config (id, host, public_key, secret_key, enabled, batch_size, flush_interval_ms)
        VALUES (1, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            host = excluded.host,
            public_key = excluded.public_key,
            secret_key = excluded.secret_key,
            enabled = 1,
            batch_size = excluded.batch_size,
            flush_interval_ms = excluded.flush_interval_ms
    `).run(
        config.host,
        config.publicKey,
        config.secretKey,
        config.batchSize ?? 10,
        config.flushIntervalMs ?? 5000,
    );
}

/**
 * Get current Langfuse configuration.
 */
export function getLangfuseConfig(): LangfuseConfig | null {
    ensureReady();
    const db = getDb();
    const row = db.prepare('SELECT * FROM langfuse_config WHERE id = 1').get() as {
        host: string;
        public_key: string;
        secret_key: string;
        enabled: number;
        batch_size: number;
        flush_interval_ms: number;
    } | undefined;

    if (!row) return null;

    return {
        host: row.host,
        publicKey: row.public_key,
        secretKey: row.secret_key,
        enabled: row.enabled === 1,
        batchSize: row.batch_size,
        flushIntervalMs: row.flush_interval_ms,
    };
}

/**
 * Check if Langfuse is configured and enabled.
 */
export function isLangfuseEnabled(): boolean {
    const config = getLangfuseConfig();
    return config !== null && config.enabled && config.publicKey.length > 0 && config.secretKey.length > 0;
}

/**
 * Export a trace to Langfuse in their ingestion format.
 * Uses the Langfuse REST API (POST /api/public/ingestion).
 * Returns true on success, false on failure.
 */
export async function exportToLangfuse(trace: InferenceTrace): Promise<boolean> {
    const config = getLangfuseConfig();
    if (!config || !config.enabled) return false;

    const langfuseTrace = {
        batch: [
            {
                id: trace.traceId,
                type: 'trace-create' as const,
                timestamp: trace.timestamp,
                body: {
                    id: trace.traceId,
                    name: `inference/${trace.model}`,
                    metadata: {
                        namespace: trace.namespace,
                        nodeId: trace.nodeId,
                        backend: trace.backend,
                        request: trace.request,
                        quality: trace.quality,
                        cost: trace.cost,
                    },
                    input: {
                        messages_count: trace.request.messages_count,
                        system_prompt_length: trace.request.system_prompt_length,
                        has_tools: trace.request.has_tools,
                        has_images: trace.request.has_images,
                        stream: trace.request.stream,
                        temperature: trace.request.temperature,
                    },
                    output: {
                        finish_reason: trace.quality.finish_reason,
                        error: trace.quality.error,
                    },
                },
            },
            {
                id: `${trace.traceId}-gen`,
                type: 'generation-create' as const,
                timestamp: trace.timestamp,
                body: {
                    traceId: trace.traceId,
                    name: trace.model,
                    model: trace.model,
                    startTime: trace.timestamp,
                    completionStartTime: new Date(
                        new Date(trace.timestamp).getTime() + trace.timing.ttft_ms
                    ).toISOString(),
                    endTime: new Date(
                        new Date(trace.timestamp).getTime() + trace.timing.total_ms
                    ).toISOString(),
                    usage: {
                        promptTokens: trace.tokens.prompt,
                        completionTokens: trace.tokens.completion,
                        totalTokens: trace.tokens.total,
                    },
                    metadata: {
                        timing: trace.timing,
                        tokens_per_second: trace.tokens.tokens_per_second,
                        cache_hit: trace.quality.cache_hit,
                        retry_count: trace.quality.retry_count,
                    },
                },
            },
        ],
    };

    try {
        const authHeader = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');
        const response = await fetch(`${config.host}/api/public/ingestion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authHeader}`,
                'User-Agent': 'TentaCLAW-Observability/0.1.0',
            },
            body: JSON.stringify(langfuseTrace),
        });

        return response.ok;
    } catch {
        // Langfuse export failed — log but don't crash inference pipeline
        console.error('[observability] Langfuse export failed for trace', trace.traceId);
        return false;
    }
}

// =============================================================================
// Smart Analytics
// =============================================================================

/**
 * Get requests above a latency threshold, sorted by slowest first.
 */
export function getSlowRequests(thresholdMs?: number, limit?: number): InferenceTrace[] {
    ensureReady();
    const db = getDb();
    const threshold = thresholdMs ?? 5000;
    const maxResults = limit ?? 50;

    const rows = db.prepare(`
        SELECT * FROM inference_traces
        WHERE timing_total_ms >= ?
        ORDER BY timing_total_ms DESC
        LIMIT ?
    `).all(threshold, maxResults) as TraceRow[];

    return rows.map(rowToTrace);
}

/**
 * Error breakdown by type, model, and node for a given period.
 */
export function getErrorAnalysis(period: 'hour' | 'day' | 'week'): {
    total_errors: number;
    by_error: Array<{ error: string; count: number }>;
    by_model: Array<{ model: string; error_count: number; total_count: number; error_rate_pct: number }>;
    by_node: Array<{ nodeId: string; error_count: number; total_count: number; error_rate_pct: number }>;
} {
    ensureReady();
    const db = getDb();

    const cutoffMap: Record<string, string> = {
        hour: "datetime('now', '-1 hour')",
        day: "datetime('now', '-1 day')",
        week: "datetime('now', '-7 days')",
    };
    const cutoff = cutoffMap[period];

    const totalErrors = (db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_traces
        WHERE quality_error IS NOT NULL AND timestamp >= ${cutoff}
    `).get() as { cnt: number }).cnt;

    const byError = db.prepare(`
        SELECT quality_error as error, COUNT(*) as count
        FROM inference_traces
        WHERE quality_error IS NOT NULL AND timestamp >= ${cutoff}
        GROUP BY quality_error
        ORDER BY count DESC
        LIMIT 20
    `).all() as Array<{ error: string; count: number }>;

    const byModel = db.prepare(`
        SELECT
            model,
            SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
            COUNT(*) as total_count
        FROM inference_traces
        WHERE timestamp >= ${cutoff}
        GROUP BY model
        HAVING error_count > 0
        ORDER BY error_count DESC
    `).all() as Array<{ model: string; error_count: number; total_count: number }>;

    const byNode = db.prepare(`
        SELECT
            node_id as nodeId,
            SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
            COUNT(*) as total_count
        FROM inference_traces
        WHERE timestamp >= ${cutoff}
        GROUP BY node_id
        HAVING error_count > 0
        ORDER BY error_count DESC
    `).all() as Array<{ nodeId: string; error_count: number; total_count: number }>;

    return {
        total_errors: totalErrors,
        by_error: byError,
        by_model: byModel.map(r => ({
            ...r,
            error_rate_pct: Math.round((r.error_count / r.total_count) * 10000) / 100,
        })),
        by_node: byNode.map(r => ({
            ...r,
            error_rate_pct: Math.round((r.error_count / r.total_count) * 10000) / 100,
        })),
    };
}

/**
 * Side-by-side performance comparison across all models.
 */
export function getModelPerformanceComparison(): ModelPerformance[] {
    ensureReady();
    const db = getDb();

    const rows = db.prepare(`
        SELECT
            model,
            COUNT(*) as request_count,
            AVG(timing_total_ms) as avg_total_ms,
            AVG(timing_ttft_ms) as avg_ttft_ms,
            AVG(tokens_per_second) as avg_tokens_per_second,
            SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
            AVG(tokens_prompt) as avg_prompt_tokens,
            AVG(tokens_completion) as avg_completion_tokens
        FROM inference_traces
        GROUP BY model
        ORDER BY request_count DESC
    `).all() as Array<{
        model: string;
        request_count: number;
        avg_total_ms: number;
        avg_ttft_ms: number;
        avg_tokens_per_second: number;
        error_count: number;
        avg_prompt_tokens: number;
        avg_completion_tokens: number;
    }>;

    return rows.map(row => {
        // Get latency values for percentile computation
        const latencies = db.prepare(`
            SELECT timing_total_ms FROM inference_traces WHERE model = ? ORDER BY timing_total_ms
        `).all(row.model) as Array<{ timing_total_ms: number }>;
        const latencyValues = latencies.map(l => l.timing_total_ms);

        return {
            model: row.model,
            request_count: row.request_count,
            avg_total_ms: Math.round(row.avg_total_ms * 100) / 100,
            avg_ttft_ms: Math.round(row.avg_ttft_ms * 100) / 100,
            avg_tokens_per_second: Math.round(row.avg_tokens_per_second * 100) / 100,
            error_rate_pct: row.request_count > 0
                ? Math.round((row.error_count / row.request_count) * 10000) / 100
                : 0,
            avg_prompt_tokens: Math.round(row.avg_prompt_tokens),
            avg_completion_tokens: Math.round(row.avg_completion_tokens),
            p50_latency_ms: Math.round(percentile(latencyValues, 50) * 100) / 100,
            p95_latency_ms: Math.round(percentile(latencyValues, 95) * 100) / 100,
        };
    });
}

/**
 * Side-by-side performance comparison across all nodes.
 */
export function getNodePerformanceComparison(): NodePerformance[] {
    ensureReady();
    const db = getDb();

    const rows = db.prepare(`
        SELECT
            node_id,
            COUNT(*) as request_count,
            AVG(timing_total_ms) as avg_total_ms,
            AVG(timing_ttft_ms) as avg_ttft_ms,
            AVG(tokens_per_second) as avg_tokens_per_second,
            SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) as error_count
        FROM inference_traces
        GROUP BY node_id
        ORDER BY request_count DESC
    `).all() as Array<{
        node_id: string;
        request_count: number;
        avg_total_ms: number;
        avg_ttft_ms: number;
        avg_tokens_per_second: number;
        error_count: number;
    }>;

    return rows.map(row => {
        // Get distinct models served by this node
        const models = db.prepare(`
            SELECT DISTINCT model FROM inference_traces WHERE node_id = ?
        `).all(row.node_id) as Array<{ model: string }>;

        // Get latencies for percentile computation
        const latencies = db.prepare(`
            SELECT timing_total_ms FROM inference_traces WHERE node_id = ? ORDER BY timing_total_ms
        `).all(row.node_id) as Array<{ timing_total_ms: number }>;
        const latencyValues = latencies.map(l => l.timing_total_ms);

        return {
            nodeId: row.node_id,
            request_count: row.request_count,
            avg_total_ms: Math.round(row.avg_total_ms * 100) / 100,
            avg_ttft_ms: Math.round(row.avg_ttft_ms * 100) / 100,
            avg_tokens_per_second: Math.round(row.avg_tokens_per_second * 100) / 100,
            error_rate_pct: row.request_count > 0
                ? Math.round((row.error_count / row.request_count) * 10000) / 100
                : 0,
            models_served: models.map(m => m.model),
            p50_latency_ms: Math.round(percentile(latencyValues, 50) * 100) / 100,
            p95_latency_ms: Math.round(percentile(latencyValues, 95) * 100) / 100,
        };
    });
}

/**
 * Detect anomalies: unusual latency spikes, error rate increases, throughput drops.
 * Compares the last hour against the previous 24-hour baseline.
 */
export function detectAnomalies(): AnomalyReport[] {
    ensureReady();
    const db = getDb();
    const anomalies: AnomalyReport[] = [];
    const now = new Date().toISOString();

    // Baseline: previous ANOMALY_LOOKBACK_HOURS hours (excluding last hour)
    const baselineStats = db.prepare(`
        SELECT
            AVG(timing_total_ms) as avg_latency,
            AVG(tokens_per_second) as avg_throughput,
            CAST(SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) as error_rate,
            COUNT(*) as request_count
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-${ANOMALY_LOOKBACK_HOURS} hours')
          AND timestamp < datetime('now', '-1 hour')
    `).get() as {
        avg_latency: number | null;
        avg_throughput: number | null;
        error_rate: number | null;
        request_count: number;
    };

    // Recent: last hour
    const recentStats = db.prepare(`
        SELECT
            AVG(timing_total_ms) as avg_latency,
            AVG(tokens_per_second) as avg_throughput,
            CAST(SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) as error_rate,
            COUNT(*) as request_count
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 hour')
    `).get() as {
        avg_latency: number | null;
        avg_throughput: number | null;
        error_rate: number | null;
        request_count: number;
    };

    // Need data in both windows to compare
    if (!baselineStats.avg_latency || !recentStats.avg_latency ||
        baselineStats.request_count < 10 || recentStats.request_count < 5) {
        return anomalies;
    }

    // Check latency spike
    if (baselineStats.avg_latency > 0) {
        const latencyRatio = recentStats.avg_latency / baselineStats.avg_latency;
        if (latencyRatio > ANOMALY_DEVIATION_THRESHOLD) {
            const deviationPct = Math.round((latencyRatio - 1) * 10000) / 100;
            anomalies.push({
                type: 'latency_spike',
                severity: latencyRatio > 3 ? 'critical' : 'warning',
                message: `Average latency spiked to ${Math.round(recentStats.avg_latency)}ms (baseline: ${Math.round(baselineStats.avg_latency)}ms)`,
                current_value: Math.round(recentStats.avg_latency * 100) / 100,
                baseline_value: Math.round(baselineStats.avg_latency * 100) / 100,
                deviation_pct: deviationPct,
                detected_at: now,
            });
        }
    }

    // Check error rate increase
    if (baselineStats.error_rate !== null && recentStats.error_rate !== null) {
        const baseErrorPct = baselineStats.error_rate * 100;
        const recentErrorPct = recentStats.error_rate * 100;
        // Flag if error rate more than doubled and is at least 5%
        if (recentErrorPct > 5 && baseErrorPct > 0 && (recentErrorPct / baseErrorPct) > ANOMALY_DEVIATION_THRESHOLD) {
            anomalies.push({
                type: 'error_rate_increase',
                severity: recentErrorPct > 20 ? 'critical' : 'warning',
                message: `Error rate increased to ${Math.round(recentErrorPct * 100) / 100}% (baseline: ${Math.round(baseErrorPct * 100) / 100}%)`,
                current_value: Math.round(recentErrorPct * 100) / 100,
                baseline_value: Math.round(baseErrorPct * 100) / 100,
                deviation_pct: Math.round(((recentErrorPct / baseErrorPct) - 1) * 10000) / 100,
                detected_at: now,
            });
        }
    }

    // Check throughput drop
    if (baselineStats.avg_throughput && baselineStats.avg_throughput > 0 && recentStats.avg_throughput !== null) {
        const throughputRatio = recentStats.avg_throughput / baselineStats.avg_throughput;
        if (throughputRatio < (1 / ANOMALY_DEVIATION_THRESHOLD)) {
            const dropPct = Math.round((1 - throughputRatio) * 10000) / 100;
            anomalies.push({
                type: 'throughput_drop',
                severity: throughputRatio < 0.25 ? 'critical' : 'warning',
                message: `Throughput dropped to ${Math.round(recentStats.avg_throughput * 100) / 100} tok/s (baseline: ${Math.round(baselineStats.avg_throughput * 100) / 100} tok/s)`,
                current_value: Math.round(recentStats.avg_throughput * 100) / 100,
                baseline_value: Math.round(baselineStats.avg_throughput * 100) / 100,
                deviation_pct: dropPct,
                detected_at: now,
            });
        }
    }

    return anomalies;
}

/**
 * Usage patterns: peak hours, popular models, request distribution.
 */
export function getUsagePatterns(): UsagePattern {
    ensureReady();
    const db = getDb();

    // Peak hours (last 7 days)
    const peakHours = db.prepare(`
        SELECT
            CAST(strftime('%H', timestamp) AS INTEGER) as hour,
            COUNT(*) as request_count
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-7 days')
        GROUP BY hour
        ORDER BY request_count DESC
    `).all() as Array<{ hour: number; request_count: number }>;

    // Popular models
    const popularModels = db.prepare(`
        SELECT
            model,
            COUNT(*) as request_count,
            SUM(tokens_total) as token_count
        FROM inference_traces
        GROUP BY model
        ORDER BY request_count DESC
        LIMIT 20
    `).all() as Array<{ model: string; request_count: number; token_count: number }>;

    // Request distribution by namespace
    const byNamespace = db.prepare(`
        SELECT namespace, COUNT(*) as count
        FROM inference_traces
        GROUP BY namespace
        ORDER BY count DESC
    `).all() as Array<{ namespace: string; count: number }>;

    // Request distribution by backend
    const byBackend = db.prepare(`
        SELECT backend, COUNT(*) as count
        FROM inference_traces
        GROUP BY backend
        ORDER BY count DESC
    `).all() as Array<{ backend: string; count: number }>;

    // Feature usage percentages
    const totalCount = (db.prepare('SELECT COUNT(*) as cnt FROM inference_traces').get() as { cnt: number }).cnt;
    const streamingCount = (db.prepare('SELECT COUNT(*) as cnt FROM inference_traces WHERE req_stream = 1').get() as { cnt: number }).cnt;
    const toolUseCount = (db.prepare('SELECT COUNT(*) as cnt FROM inference_traces WHERE req_has_tools = 1').get() as { cnt: number }).cnt;
    const imageCount = (db.prepare('SELECT COUNT(*) as cnt FROM inference_traces WHERE req_has_images = 1').get() as { cnt: number }).cnt;

    return {
        peak_hours: peakHours,
        popular_models: popularModels,
        request_distribution: {
            by_namespace: byNamespace,
            by_backend: byBackend,
            streaming_pct: totalCount > 0 ? Math.round((streamingCount / totalCount) * 10000) / 100 : 0,
            tool_use_pct: totalCount > 0 ? Math.round((toolUseCount / totalCount) * 10000) / 100 : 0,
            image_pct: totalCount > 0 ? Math.round((imageCount / totalCount) * 10000) / 100 : 0,
        },
    };
}

// =============================================================================
// Dashboard Data
// =============================================================================

/**
 * All-in-one dashboard data endpoint. Provides everything a dashboard needs
 * in a single call to minimize round trips.
 */
export function getObservabilityDashboard(): ObservabilityDashboard {
    ensureReady();
    const db = getDb();

    // Request volume for different time windows
    const vol1h = (db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_traces WHERE timestamp >= datetime('now', '-1 hour')
    `).get() as { cnt: number }).cnt;

    const vol24h = (db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_traces WHERE timestamp >= datetime('now', '-1 day')
    `).get() as { cnt: number }).cnt;

    const vol7d = (db.prepare(`
        SELECT COUNT(*) as cnt FROM inference_traces WHERE timestamp >= datetime('now', '-7 days')
    `).get() as { cnt: number }).cnt;

    // Overall latency percentiles (last 24h)
    const allLatencies = db.prepare(`
        SELECT timing_total_ms FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 day')
        ORDER BY timing_total_ms
    `).all() as Array<{ timing_total_ms: number }>;
    const latencyValues = allLatencies.map(l => l.timing_total_ms);

    // Latency trend (hourly, last 24h)
    const latencyTrend = db.prepare(`
        SELECT
            strftime('%Y-%m-%d %H:00', timestamp) as period,
            GROUP_CONCAT(timing_total_ms) as latencies
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 day')
        GROUP BY period
        ORDER BY period ASC
    `).all() as Array<{ period: string; latencies: string }>;

    const latencyTrendParsed = latencyTrend.map(row => {
        const vals = row.latencies.split(',').map(Number);
        return {
            period: row.period,
            p50: Math.round(percentile(vals, 50) * 100) / 100,
            p95: Math.round(percentile(vals, 95) * 100) / 100,
            p99: Math.round(percentile(vals, 99) * 100) / 100,
        };
    });

    // Error rate trend (hourly, last 24h)
    const errorTrend = db.prepare(`
        SELECT
            strftime('%Y-%m-%d %H:00', timestamp) as period,
            CAST(SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) * 100 as error_rate_pct
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 day')
        GROUP BY period
        ORDER BY period ASC
    `).all() as Array<{ period: string; error_rate_pct: number }>;

    // Top models by usage
    const topModels = db.prepare(`
        SELECT model, COUNT(*) as request_count, AVG(timing_total_ms) as avg_latency_ms
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 day')
        GROUP BY model
        ORDER BY request_count DESC
        LIMIT 10
    `).all() as Array<{ model: string; request_count: number; avg_latency_ms: number }>;

    // Top users (namespaces) by tokens
    const topUsers = db.prepare(`
        SELECT namespace, SUM(tokens_total) as total_tokens
        FROM inference_traces
        GROUP BY namespace
        ORDER BY total_tokens DESC
        LIMIT 10
    `).all() as Array<{ namespace: string; total_tokens: number }>;

    // Slowest requests (last 24h)
    const slowest = db.prepare(`
        SELECT trace_id, model, timing_total_ms, timestamp
        FROM inference_traces
        WHERE timestamp >= datetime('now', '-1 day')
        ORDER BY timing_total_ms DESC
        LIMIT 10
    `).all() as Array<{ trace_id: string; model: string; timing_total_ms: number; timestamp: string }>;

    // Cost breakdown
    const costRow = db.prepare(`
        SELECT
            SUM(cost_electricity_usd) as total_electricity_usd,
            SUM(cost_cloud_equivalent_usd) as total_cloud_equivalent_usd,
            SUM(cost_savings_usd) as total_savings_usd
        FROM inference_traces
    `).get() as {
        total_electricity_usd: number | null;
        total_cloud_equivalent_usd: number | null;
        total_savings_usd: number | null;
    };

    return {
        volume: {
            last_1h: vol1h,
            last_24h: vol24h,
            last_7d: vol7d,
        },
        latency_percentiles: {
            p50_ms: Math.round(percentile(latencyValues, 50) * 100) / 100,
            p95_ms: Math.round(percentile(latencyValues, 95) * 100) / 100,
            p99_ms: Math.round(percentile(latencyValues, 99) * 100) / 100,
        },
        latency_trend: latencyTrendParsed,
        error_rate_trend: errorTrend.map(r => ({
            period: r.period,
            error_rate_pct: Math.round(r.error_rate_pct * 100) / 100,
        })),
        top_models: topModels.map(m => ({
            model: m.model,
            request_count: m.request_count,
            avg_latency_ms: Math.round(m.avg_latency_ms * 100) / 100,
        })),
        top_users_by_tokens: topUsers,
        slowest_requests: slowest.map(s => ({
            traceId: s.trace_id,
            model: s.model,
            total_ms: s.timing_total_ms,
            timestamp: s.timestamp,
        })),
        cost_breakdown: {
            total_electricity_usd: Math.round((costRow.total_electricity_usd ?? 0) * 10000) / 10000,
            total_cloud_equivalent_usd: Math.round((costRow.total_cloud_equivalent_usd ?? 0) * 10000) / 10000,
            total_savings_usd: Math.round((costRow.total_savings_usd ?? 0) * 10000) / 10000,
        },
    };
}
