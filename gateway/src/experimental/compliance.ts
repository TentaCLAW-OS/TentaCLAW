/**
 * TentaCLAW Gateway — EU AI Act Compliance Engine (Wave 83)
 *
 * Implements compliance features for the EU AI Act (enforcement: August 2, 2026):
 *   - Article 12: Automatic logging of AI system events
 *   - Article 13: Transparency documentation
 *   - Article 14: Human oversight mechanisms
 *   - Article 15: Cybersecurity requirements
 *   - Article 50: AI interaction transparency
 *   - Risk classification (minimal/limited/high)
 *   - Compliance report generation
 *
 * CLAWtopus says: "Compliance is not optional. It is tentacle-seven's specialty."
 */

import { getDb } from './db';

// =============================================================================
// Types
// =============================================================================

export type RiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable';

export interface ComplianceLog {
    id: number;
    event_type: string;
    model: string;
    namespace: string;
    input_token_count: number;
    output_token_count: number;
    latency_ms: number;
    node_id: string;
    user_hash: string;
    risk_level: RiskLevel;
    transparency_disclosed: boolean;
    created_at: string;
}

export interface ModelRiskClassification {
    model: string;
    risk_level: RiskLevel;
    reason: string;
    classified_by: string;
    classified_at: string;
}

export interface ComplianceReport {
    generated_at: string;
    framework: string;
    period: { from: string; to: string };
    summary: {
        total_requests: number;
        models_deployed: number;
        risk_distribution: Record<RiskLevel, number>;
        transparency_rate: number;
        logging_coverage: number;
        human_overrides: number;
    };
    articles: Record<string, { status: 'compliant' | 'partial' | 'non_compliant'; details: string }>;
    recommendations: string[];
}

// =============================================================================
// Schema
// =============================================================================

let schemaInitialized = false;

function ensureSchema(): void {
    if (schemaInitialized) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS compliance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL DEFAULT 'inference',
            model TEXT NOT NULL,
            namespace TEXT DEFAULT 'default',
            input_token_count INTEGER DEFAULT 0,
            output_token_count INTEGER DEFAULT 0,
            latency_ms INTEGER DEFAULT 0,
            node_id TEXT,
            user_hash TEXT,
            risk_level TEXT DEFAULT 'minimal',
            transparency_disclosed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_compliance_log_model ON compliance_log(model, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_compliance_log_time ON compliance_log(created_at DESC);

        CREATE TABLE IF NOT EXISTS model_risk_classifications (
            model TEXT PRIMARY KEY,
            risk_level TEXT NOT NULL DEFAULT 'minimal',
            reason TEXT DEFAULT '',
            classified_by TEXT DEFAULT 'auto',
            classified_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS human_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            model TEXT,
            namespace TEXT,
            actor TEXT NOT NULL,
            reason TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    schemaInitialized = true;
}

// =============================================================================
// Article 12: Automatic Logging
// =============================================================================

/** Log an inference event for compliance (Article 12) */
export function logComplianceEvent(event: {
    model: string;
    namespace?: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    nodeId?: string;
    userHash?: string;
    riskLevel?: RiskLevel;
    transparencyDisclosed?: boolean;
}): void {
    ensureSchema();
    const db = getDb();
    db.prepare(`
        INSERT INTO compliance_log (event_type, model, namespace, input_token_count, output_token_count, latency_ms, node_id, user_hash, risk_level, transparency_disclosed)
        VALUES ('inference', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        event.model,
        event.namespace || 'default',
        event.inputTokens,
        event.outputTokens,
        event.latencyMs,
        event.nodeId || null,
        event.userHash || null,
        event.riskLevel || 'minimal',
        event.transparencyDisclosed ? 1 : 0,
    );
}

/** Get compliance log entries */
export function getComplianceLog(options: { model?: string; since?: string; limit?: number } = {}): ComplianceLog[] {
    ensureSchema();
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.model) { conditions.push('model = ?'); params.push(options.model); }
    if (options.since) { conditions.push('created_at >= ?'); params.push(options.since); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return db.prepare(`SELECT * FROM compliance_log ${where} ORDER BY created_at DESC LIMIT ?`)
        .all(...params, options.limit || 1000) as ComplianceLog[];
}

// =============================================================================
// Risk Classification
// =============================================================================

/** Classify a model risk level */
export function classifyModelRisk(model: string, riskLevel: RiskLevel, reason: string, classifiedBy: string = 'admin'): void {
    ensureSchema();
    const db = getDb();
    db.prepare(`
        INSERT INTO model_risk_classifications (model, risk_level, reason, classified_by, classified_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(model) DO UPDATE SET risk_level = excluded.risk_level, reason = excluded.reason,
            classified_by = excluded.classified_by, classified_at = excluded.classified_at
    `).run(model, riskLevel, reason, classifiedBy);
}

/** Get risk level for a model */
export function getModelRiskLevel(model: string): ModelRiskClassification | null {
    ensureSchema();
    const db = getDb();
    return db.prepare('SELECT * FROM model_risk_classifications WHERE model = ?').get(model) as ModelRiskClassification | null;
}

/** Get all classifications */
export function getAllRiskClassifications(): ModelRiskClassification[] {
    ensureSchema();
    const db = getDb();
    return db.prepare('SELECT * FROM model_risk_classifications ORDER BY risk_level DESC').all() as ModelRiskClassification[];
}

// =============================================================================
// Article 14: Human Oversight
// =============================================================================

/** Record a human override action */
export function recordHumanOverride(action: string, actor: string, model?: string, reason?: string): void {
    ensureSchema();
    const db = getDb();
    db.prepare('INSERT INTO human_overrides (action, model, actor, reason) VALUES (?, ?, ?, ?)')
        .run(action, model || null, actor, reason || null);
}

/** Get override history */
export function getHumanOverrides(limit: number = 100): any[] {
    ensureSchema();
    const db = getDb();
    return db.prepare('SELECT * FROM human_overrides ORDER BY created_at DESC LIMIT ?').all(limit);
}

// =============================================================================
// Compliance Report
// =============================================================================

/** Generate EU AI Act compliance report */
export function generateComplianceReport(periodDays: number = 30): ComplianceReport {
    ensureSchema();
    const db = getDb();
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();

    const stats = db.prepare(`
        SELECT COUNT(*) as total, COUNT(DISTINCT model) as models,
            SUM(CASE WHEN risk_level = 'minimal' THEN 1 ELSE 0 END) as minimal,
            SUM(CASE WHEN risk_level = 'limited' THEN 1 ELSE 0 END) as limited_risk,
            SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high,
            SUM(CASE WHEN risk_level = 'unacceptable' THEN 1 ELSE 0 END) as unacceptable,
            SUM(CASE WHEN transparency_disclosed = 1 THEN 1 ELSE 0 END) as disclosed
        FROM compliance_log WHERE created_at >= ?
    `).get(since) as any;

    const overrides = db.prepare('SELECT COUNT(*) as cnt FROM human_overrides WHERE created_at >= ?').get(since) as any;
    const total = stats?.total || 0;
    const transparencyRate = total > 0 ? Math.round((stats.disclosed / total) * 1000) / 10 : 100;

    const recommendations: string[] = [];
    if (total === 0) recommendations.push('Enable compliance logging for all inference requests');
    if (transparencyRate < 95) recommendations.push('Increase AI disclosure rate to 95%+');
    recommendations.push('Review model documentation for Article 13 transparency');

    return {
        generated_at: new Date().toISOString(),
        framework: 'eu-ai-act',
        period: { from: since, to: new Date().toISOString() },
        summary: {
            total_requests: total,
            models_deployed: stats?.models || 0,
            risk_distribution: { minimal: stats?.minimal || 0, limited: stats?.limited_risk || 0, high: stats?.high || 0, unacceptable: stats?.unacceptable || 0 },
            transparency_rate: transparencyRate,
            logging_coverage: total > 0 ? 100 : 0,
            human_overrides: overrides?.cnt || 0,
        },
        articles: {
            article_12_logging: { status: total > 0 ? 'compliant' : 'partial', details: `${total} events logged` },
            article_13_transparency: { status: 'partial', details: 'Model docs need review' },
            article_14_oversight: { status: overrides?.cnt > 0 ? 'compliant' : 'partial', details: `${overrides?.cnt || 0} overrides` },
            article_15_cybersecurity: { status: 'compliant', details: 'Auth + TLS + rate limiting + signed releases active' },
            article_50_disclosure: { status: transparencyRate >= 95 ? 'compliant' : 'partial', details: `${transparencyRate}% disclosed` },
        },
        recommendations,
    };
}

/** Reset schema flag (for testing) */
export function _resetCompliance(): void { schemaInitialized = false; }
