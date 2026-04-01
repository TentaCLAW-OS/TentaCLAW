/**
 * Shared state and utilities used across route modules.
 * This module holds SSE clients, webhook config, rate limiters,
 * and helper functions that multiple route files need.
 */
import { createHash } from 'crypto';
import {
    getClusterConfig,
    getOrCreateClusterSecret,
    validateSession,
} from './db';

// =============================================================================
// SSE (Server-Sent Events) for real-time dashboard
// =============================================================================

export type SSEClient = {
    id: string;
    controller: ReadableStreamDefaultController;
};

export const sseClients: SSEClient[] = [];

export function broadcastSSE(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(payload);

    for (let i = sseClients.length - 1; i >= 0; i--) {
        try {
            sseClients[i].controller.enqueue(encoded);
        } catch {
            // Client disconnected
            sseClients.splice(i, 1);
        }
    }

    // Fire webhooks for this event
    fireWebhooks(eventType, data);
}

// =============================================================================
// Webhook System
// =============================================================================

export interface WebhookConfig {
    id: string;
    url: string;
    events: string[];
    secret?: string;
    enabled: boolean;
    created_at: string;
}

export const webhooks: WebhookConfig[] = [];

export function fireWebhooks(eventType: string, data: unknown): void {
    for (const wh of webhooks) {
        if (!wh.enabled) continue;
        if (!wh.events.includes('*') && !wh.events.includes(eventType)) continue;

        const payload = JSON.stringify({ event: eventType, data, timestamp: new Date().toISOString() });
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'TentaCLAW-Webhook/0.2.0' };

        if (wh.secret) {
            const sig = createHash('sha256').update(wh.secret + payload).digest('hex');
            headers['X-TentaCLAW-Signature'] = sig;
        }

        fetch(wh.url, { method: 'POST', headers, body: payload }).catch(() => {});
    }
}

// =============================================================================
// Daphney Bridge (SSE for DaphneyBrain UE5)
// =============================================================================

export const daphneyClients: SSEClient[] = [];

export function broadcastDaphney(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(payload);
    for (let i = daphneyClients.length - 1; i >= 0; i--) {
        try {
            daphneyClients[i].controller.enqueue(encoded);
        } catch {
            daphneyClients.splice(i, 1);
        }
    }
}

// =============================================================================
// Cluster Secret / Agent Authentication
// =============================================================================

export let CLUSTER_SECRET: string | null = null;
export let agentAuthEnabled = false;

export function isAuthDisabled(): boolean {
    return process.env.TENTACLAW_NO_AUTH === 'true';
}

export function initClusterSecret(): void {
    const envSecret = process.env.TENTACLAW_CLUSTER_SECRET;
    if (envSecret) {
        CLUSTER_SECRET = envSecret;
        agentAuthEnabled = true;
        return;
    }

    try {
        const dbSecret = getClusterConfig('cluster_secret');
        if (dbSecret) {
            CLUSTER_SECRET = dbSecret;
            agentAuthEnabled = true;
        } else {
            const generated = getOrCreateClusterSecret();
            CLUSTER_SECRET = generated;
            agentAuthEnabled = true;
            console.warn('[tentaclaw] Auto-generated cluster secret. Set TENTACLAW_CLUSTER_SECRET for production.');
        }
    } catch {
        // DB not ready yet
    }
}

export function validateClusterSecret(headerSecret: string | undefined): boolean {
    if (isAuthDisabled()) return true;
    if (!agentAuthEnabled) return true;
    if (!headerSecret) return false;
    return headerSecret === CLUSTER_SECRET;
}

export function setClusterSecretValue(secret: string): void {
    CLUSTER_SECRET = secret;
    agentAuthEnabled = true;
}

// =============================================================================
// Logging
// =============================================================================

const LOG_LEVEL = process.env.TENTACLAW_LOG_LEVEL || 'info';
const LOG_JSON = process.env.TENTACLAW_LOG_FORMAT === 'json';

export function log(level: string, msg: string, data?: Record<string, unknown>) {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) < levels.indexOf(LOG_LEVEL)) return;
    if (LOG_JSON) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }));
    } else {
        const prefix = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '';
        const reset = prefix ? '\x1b[0m' : '';
        console.log(`${prefix}[tentaclaw] ${msg}${reset}` + (data ? ' ' + JSON.stringify(data) : ''));
    }
}

// =============================================================================
// Pagination helper
// =============================================================================

export function paginate<T>(items: T[], page: number, limit: number): { data: T[]; total: number; page: number; limit: number; pages: number } {
    const safeLimit = Math.min(Math.max(limit || 50, 1), 500);
    const safePage = Math.max(page || 1, 1);
    const total = items.length;
    const pages = Math.ceil(total / safeLimit);
    const start = (safePage - 1) * safeLimit;
    return { data: items.slice(start, start + safeLimit), total, page: safePage, limit: safeLimit, pages };
}

// =============================================================================
// Rate Limiting helpers
// =============================================================================

const CHAT_RATE_LIMIT = parseInt(process.env.TENTACLAW_CHAT_RATE_LIMIT || '60');
const chatRateBuckets = new Map<string, { count: number; resetAt: number }>();

export { CHAT_RATE_LIMIT };

export function checkChatRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let bucket = chatRateBuckets.get(identifier);

    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + 60_000 };
        chatRateBuckets.set(identifier, bucket);
    }

    bucket.count++;
    const remaining = Math.max(0, CHAT_RATE_LIMIT - bucket.count);

    if (bucket.count > CHAT_RATE_LIMIT) {
        return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    return { allowed: true, remaining, resetAt: bucket.resetAt };
}

// Clean up stale chat rate buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of chatRateBuckets) {
        if (now > bucket.resetAt + 60_000) chatRateBuckets.delete(key);
    }
}, 300_000);

// Login rate limiting
const loginRateBuckets = new Map<string, { count: number; resetAt: number }>();
export const LOGIN_RATE_LIMIT = 5;

export function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let bucket = loginRateBuckets.get(ip);

    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + 60_000 };
        loginRateBuckets.set(ip, bucket);
    }

    bucket.count++;
    const remaining = Math.max(0, LOGIN_RATE_LIMIT - bucket.count);

    if (bucket.count > LOGIN_RATE_LIMIT) {
        return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    return { allowed: true, remaining, resetAt: bucket.resetAt };
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of loginRateBuckets) {
        if (now > bucket.resetAt + 60_000) loginRateBuckets.delete(ip);
    }
}, 300_000);

// Per-key rate limiting
const keyRateBuckets = new Map<string, { count: number; window_start: number }>();

export function checkKeyRateLimit(keyId: string, rateLimitRpm: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let bucket = keyRateBuckets.get(keyId);

    if (!bucket || now - bucket.window_start > 60_000) {
        bucket = { count: 0, window_start: now };
        keyRateBuckets.set(keyId, bucket);
    }

    bucket.count++;
    const remaining = Math.max(0, rateLimitRpm - bucket.count);
    const resetAt = bucket.window_start + 60_000;

    if (bucket.count > rateLimitRpm) {
        return { allowed: false, remaining: 0, resetAt };
    }

    return { allowed: true, remaining, resetAt };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of keyRateBuckets) {
        if (now - bucket.window_start > 120_000) keyRateBuckets.delete(key);
    }
}, 300_000);

// =============================================================================
// Request Queue
// =============================================================================

interface QueuedRequest {
    id: string;
    priority: number;
    model: string;
    addedAt: number;
}

export const requestQueue: QueuedRequest[] = [];
export const activeRequests = new Map<string, number>();
export const MAX_QUEUE_DEPTH = 100;
export const MAX_CONCURRENT_PER_NODE = 4;

export function getQueueStats() {
    return {
        queued: requestQueue.length,
        active: [...activeRequests.values()].reduce((s, n) => s + n, 0),
        max_queue: MAX_QUEUE_DEPTH,
        max_concurrent_per_node: MAX_CONCURRENT_PER_NODE,
    };
}

// =============================================================================
// Auth helpers
// =============================================================================

export function getSessionUser(c: any): ReturnType<typeof validateSession> {
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    return validateSession(token);
}

export function requireRole(c: any, ...roles: string[]): ReturnType<typeof validateSession> {
    const user = getSessionUser(c);
    if (!user) return null;
    if (roles.length > 0 && !roles.includes(user.role)) return null;
    return user;
}
