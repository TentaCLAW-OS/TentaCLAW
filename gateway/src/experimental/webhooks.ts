/**
 * TentaCLAW Gateway — Webhook System (Wave 98)
 *
 * Event-driven notifications with HMAC-SHA256 signed payloads,
 * retry with exponential backoff, and delivery logging.
 *
 * TentaCLAW says: "I push, you catch. That is how eight arms delegate."
 */

import { createHmac, randomBytes } from 'crypto';
import { getDb } from './db';

// =============================================================================
// Types
// =============================================================================

export type WebhookEvent =
    | 'model.deployed' | 'model.undeployed' | 'model.failed'
    | 'node.joined' | 'node.left' | 'node.unhealthy'
    | 'alert.triggered' | 'alert.resolved'
    | 'inference.error' | 'inference.slow'
    | 'key.created' | 'key.revoked'
    | 'config.changed'
    | 'scale.up' | 'scale.down';

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
    'model.deployed', 'model.undeployed', 'model.failed',
    'node.joined', 'node.left', 'node.unhealthy',
    'alert.triggered', 'alert.resolved',
    'inference.error', 'inference.slow',
    'key.created', 'key.revoked',
    'config.changed', 'scale.up', 'scale.down',
];

export interface WebhookRegistration {
    id: string;
    url: string;
    events: WebhookEvent[];
    secret: string;
    enabled: boolean;
    description: string;
    created_at: string;
}

// =============================================================================
// Schema
// =============================================================================

let schemaInit = false;

function ensureSchema(): void {
    if (schemaInit) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks_v2 (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            events TEXT NOT NULL,
            secret TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            description TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS webhook_deliveries_v2 (
            id TEXT PRIMARY KEY,
            webhook_id TEXT NOT NULL,
            event TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            status_code INTEGER,
            attempts INTEGER DEFAULT 0,
            last_attempt_at TEXT,
            payload_preview TEXT,
            error TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_wh_del_v2 ON webhook_deliveries_v2(webhook_id, created_at DESC);
    `);
    schemaInit = true;
}

function genId(): string { return randomBytes(12).toString('hex'); }

// =============================================================================
// Registration
// =============================================================================

/** Register a new webhook endpoint */
export function registerWebhook(url: string, events: WebhookEvent[], description: string = ''): WebhookRegistration {
    ensureSchema();
    const db = getDb();
    const id = 'wh_' + genId();
    const secret = 'whsec_' + randomBytes(24).toString('hex');
    db.prepare('INSERT INTO webhooks_v2 (id, url, events, secret, description) VALUES (?, ?, ?, ?, ?)')
        .run(id, url, JSON.stringify(events), secret, description);
    return { id, url, events, secret, enabled: true, description, created_at: new Date().toISOString() };
}

/** List webhooks (secrets masked) */
export function listWebhooks(): any[] {
    ensureSchema();
    const db = getDb();
    return (db.prepare('SELECT * FROM webhooks_v2 ORDER BY created_at DESC').all() as any[]).map(r => ({
        ...r, events: JSON.parse(r.events), enabled: !!r.enabled, secret: r.secret.slice(0, 12) + '...',
    }));
}

/** Delete a webhook */
export function deleteWebhook(id: string): boolean {
    ensureSchema();
    return getDb().prepare('DELETE FROM webhooks_v2 WHERE id = ?').run(id).changes > 0;
}

// =============================================================================
// Delivery
// =============================================================================

/** Fire event to all matching webhooks */
export async function fireWebhookEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<number> {
    ensureSchema();
    const db = getDb();
    const webhooks = db.prepare('SELECT * FROM webhooks_v2 WHERE enabled = 1').all() as any[];
    let delivered = 0;

    for (const wh of webhooks) {
        const events: string[] = JSON.parse(wh.events);
        if (!events.includes(event)) continue;

        const deliveryId = 'del_' + genId();
        const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

        db.prepare('INSERT INTO webhook_deliveries_v2 (id, webhook_id, event, payload_preview) VALUES (?, ?, ?, ?)')
            .run(deliveryId, wh.id, event, body.slice(0, 200));

        // Attempt delivery (fire and forget for now)
        attemptDelivery(wh.url, wh.secret, body, deliveryId).then(ok => { if (ok) delivered++; }).catch(() => {});
    }
    return delivered;
}

async function attemptDelivery(url: string, secret: string, body: string, deliveryId: string): Promise<boolean> {
    const db = getDb();
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-TentaCLAW-Signature': `sha256=${signature}`,
                    'X-TentaCLAW-Delivery': deliveryId,
                    'User-Agent': 'TentaCLAW-Webhooks/1.0',
                },
                body,
                signal: AbortSignal.timeout(10000),
            });

            db.prepare('UPDATE webhook_deliveries_v2 SET status = ?, status_code = ?, attempts = ?, last_attempt_at = datetime("now") WHERE id = ?')
                .run(res.ok ? 'delivered' : 'failed', res.status, attempt, deliveryId);

            if (res.ok) return true;
        } catch (err) {
            db.prepare('UPDATE webhook_deliveries_v2 SET attempts = ?, error = ?, last_attempt_at = datetime("now") WHERE id = ?')
                .run(attempt, (err as Error).message, deliveryId);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, Math.pow(10, attempt - 1) * 1000));
    }
    db.prepare('UPDATE webhook_deliveries_v2 SET status = "failed" WHERE id = ?').run(deliveryId);
    return false;
}

/** Get delivery history */
export function getDeliveries(webhookId: string, limit: number = 50): any[] {
    ensureSchema();
    return getDb().prepare('SELECT * FROM webhook_deliveries_v2 WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(webhookId, limit);
}

/** Verify a webhook signature */
export function verifySignature(secret: string, body: string, signature: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    return expected === signature;
}

/** Reset (for testing) */
export function _resetWebhooks(): void {
    schemaInit = false;
    try {
        const db = getDb();
        db.exec('DELETE FROM webhooks_v2; DELETE FROM webhook_deliveries_v2;');
    } catch { /* tables may not exist */ }
}
