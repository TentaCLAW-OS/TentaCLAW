#!/usr/bin/env node
/**
 * TentaCLAW Gateway
 *
 * The central coordinator for your AI inference cluster.
 * Receives stats from agents, dispatches commands, serves the dashboard.
 *
 * CLAWtopus says: "One mind to rule them all. Eight arms to manage them."
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import dgram from 'dgram';
import os from 'os';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { createHash } from 'crypto';
import type { StatsPayload, GatewayResponse, CommandAction } from '../../shared/types';

const PORT = parseInt(process.env.TENTACLAW_PORT || '8080');

// Security: bind to localhost by default (single-node safe).
// For cluster mode, pass --bind 0.0.0.0 or set TENTACLAW_HOST=0.0.0.0
const bindIdx = process.argv.indexOf('--bind');
const cliHost = bindIdx !== -1 ? process.argv[bindIdx + 1] : undefined;
const HOST = cliHost || process.env.TENTACLAW_HOST || '127.0.0.1';

if (HOST === '0.0.0.0') {
    console.warn('[tentaclaw] WARNING: Binding to 0.0.0.0 — gateway is accessible from all network interfaces.');
    console.warn('[tentaclaw] Ensure authentication is enabled and firewall rules are configured.');
}
import {
    getDb,
    registerNode,
    getNode,
    getAllNodes,
    getNodesByFarm,
    deleteNode,
    markStaleNodes,
    insertStats,
    getStatsHistory,
    pruneStats,
    getPendingCommands,
    queueCommand,
    completeCommand,
    createFlightSheet,
    getAllFlightSheets,
    getFlightSheet,
    deleteFlightSheet,
    applyFlightSheet,
    getClusterSummary,
    checkAndAlert,
    getRecentAlerts,
    acknowledgeAlert,
    getAlertRules,
    createAlertRule,
    updateAlertRule,
    deleteAlertRule,
    toggleAlertRule,
    evaluateAlertRules,
    seedDefaultAlertRules,
    storeBenchmark,
    getNodeBenchmarks,
    getAllBenchmarks,
    recordNodeEvent,
    getNodeEvents,
    getCompactHistory,
    findBestNode,
    getClusterModels,
    getHealthScore,
    createSchedule,
    getAllSchedules,
    getSchedule,
    deleteSchedule,
    toggleSchedule,
    getDueSchedules,
    markScheduleRun,
    addSshKey,
    getNodeSshKeys,
    deleteSshKey,
    addNodeTag,
    removeNodeTag,
    getNodeTags,
    getNodesByTag,
    getAllTags,
    startModelPull,
    updateModelPull,
    getActiveModelPulls,
    getAllActiveModelPulls,
    recordRouteResult,
    getRequestStats,
    estimateModelVram,
    checkModelFits,
    findBestNodeForModel,
    getModelDistribution,
    logInferenceRequest,
    getInferenceAnalytics,
    runAutoMode,
    setModelAlias,
    resolveModelAlias,
    getAllModelAliases,
    deleteModelAlias,
    ensureDefaultAliases,
    getCachedResponse,
    cacheResponse,
    getCacheStats,
    pruneCache,
    getClusterPower,
    setMaintenanceMode,
    getClusterTimeline,
    exportClusterConfig,
    importClusterConfig,
    getNodeHealthScore,
    getFleetReliability,
    createApiKey,
    validateApiKey,
    getAllApiKeys,
    revokeApiKey,
    getNodeUptime,
    getFleetUptime,
    setOverclockProfile,
    getOverclockProfiles,
    recordWatchdogEvent,
    getWatchdogEvents,
    getAllWatchdogEvents,
    createNotificationChannel,
    getAllNotificationChannels,
    deleteNotificationChannel,
    sendNotification,
    insertPlaygroundHistory,
    getPlaygroundHistory,
    createNodeGroup,
    getNodeGroups,
    addNodeToGroup,
    deleteNodeGroup,
    getGroupMembers,
    addPlacementConstraint,
    getPlacementConstraints,
    deletePlacementConstraint,
    createUser,
    authenticateUser,
    createSession,
    validateSession,
    invalidateSession,
    getUsers,
    deleteUser,
    updateUserRole,
    createDefaultAdmin,
    getOrCreateClusterSecret,
    getClusterConfig,
    setClusterConfig,
    recordAuditEvent,
    getAuditLog,
    recordAuthFailure,
    isIpBlocked,
    clearAuthFailures,
    updateUserPassword,
    isInitialAdminPassword,
    createJoinToken,
    validateJoinToken,
    listJoinTokens,
    deleteJoinToken,
} from './db';
import { randomBytes } from 'crypto';
import { generateWaitComedy } from './comedy';
import {
    getProfiles,
    getPerformanceSummary,
    getEndpointPerformance,
    generateLoadTestConfig,
    clearProfiles,
} from './profiler';
import {
    createNamespace,
    getNamespace,
    listNamespaces,
    deleteNamespace,
    updateNamespace,
    setQuota,
    getQuotaUsage,
    checkQuota,
    getModelsInNamespace,
    getNodesInNamespace,
    assignNodeToNamespace,
    getNamespaceForApiKey,
    setApiKeyNamespace,
    recordUsage,
    getUsageReport,
    exportUsageCSV,
    getAllUsageReports,
    ensureDefaultNamespace,
} from './namespaces';

// =============================================================================
// SSE (Server-Sent Events) for real-time dashboard
// =============================================================================

type SSEClient = {
    id: string;
    controller: ReadableStreamDefaultController;
};

const sseClients: SSEClient[] = [];

function broadcastSSE(eventType: string, data: unknown): void {
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
// Webhook System — fire events to external URLs
// =============================================================================

interface WebhookConfig {
    id: string;
    url: string;
    events: string[];       // ['*'] for all, or ['node_online', 'alert', ...]
    secret?: string;        // HMAC signing secret
    enabled: boolean;
    created_at: string;
}

const webhooks: WebhookConfig[] = [];

function fireWebhooks(eventType: string, data: unknown): void {
    for (const wh of webhooks) {
        if (!wh.enabled) continue;
        if (!wh.events.includes('*') && !wh.events.includes(eventType)) continue;

        const payload = JSON.stringify({ event: eventType, data, timestamp: new Date().toISOString() });
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'TentaCLAW-Webhook/0.2.0' };

        if (wh.secret) {
            const sig = createHash('sha256').update(wh.secret + payload).digest('hex');
            headers['X-TentaCLAW-Signature'] = sig;
        }

        fetch(wh.url, { method: 'POST', headers, body: payload }).catch(() => {
            // Webhook delivery failed — log but don't crash
        });
    }
}

// Webhooks are fired alongside SSE broadcasts via fireWebhooks()

// =============================================================================
// Input Sanitization — prevent injection in stored strings (Phase 12)
// =============================================================================

/** Sanitize user-provided strings: strip control chars, limit length, escape HTML entities. */
export function sanitizeInput(input: string, maxLength: number = 1024): string {
    if (typeof input !== 'string') return '';
    return input
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars (keep \n \r \t)
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .slice(0, maxLength);
}

// =============================================================================
// App Setup
// =============================================================================

export const app = new Hono();

// Global error handler — catch malformed JSON, unexpected errors
app.onError((err, c) => {
    if (err.message?.includes('Unexpected') || err.message?.includes('JSON')) {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    console.error('[tentaclaw] Unhandled error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
});

// CORS — allow dashboard access from LAN + configured origins
const CORS_ORIGINS = (() => {
    const envOrigins = process.env.TENTACLAW_CORS_ORIGINS;
    if (envOrigins) {
        return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    }
    // Default: localhost + all private network ranges (dashboard on LAN)
    const defaults = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    // Auto-detect LAN IPs so the dashboard works from any machine on the network
    try {
        const nets = require('os').networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
                if (net.family === 'IPv4' && !net.internal) {
                    defaults.push(`http://${net.address}:${PORT}`);
                }
            }
        }
    } catch { /* ignore */ }
    return defaults;
})();

app.use('/*', cors({
    origin: (origin) => {
        // Allow requests with no Origin header (same-origin, curl, etc.)
        if (!origin) return `http://localhost:${PORT}`;
        // Allow configured origins + auto-detected LAN IPs
        if (CORS_ORIGINS.includes(origin)) return origin;
        // Allow any private network origin accessing the dashboard
        if (origin && /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(origin)) return origin;
        // Block everything else
        return null as unknown as string;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Cluster-Secret'],
    exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials: true,
    maxAge: 86400,
}));

// Security headers — production-grade hardening
app.use('/*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    // X-XSS-Protection: 0 is the modern recommendation (disables flawed legacy filter)
    c.header('X-XSS-Protection', '0');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// Input validation — reject oversized payloads (Phase 12)
const MAX_BODY_SIZE = parseInt(process.env.TENTACLAW_MAX_BODY_MB || '10') * 1024 * 1024; // 10MB default
app.use('/api/*', async (c, next) => {
    const contentLength = c.req.header('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        return c.json({
            error: `Payload too large. Maximum ${MAX_BODY_SIZE / (1024 * 1024)}MB allowed.`,
        }, 413);
    }
    await next();
});

// Request ID tracing — every request gets a unique ID
app.use('/*', async (c, next) => {
    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    c.header('X-Request-ID', requestId);
    // requestId available via X-Request-ID header
    await next();
});

// Request logging — structured JSON logs for production
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

// Pagination helper for list endpoints
export function paginate<T>(items: T[], page: number, limit: number): { data: T[]; total: number; page: number; limit: number; pages: number } {
    const safeLimit = Math.min(Math.max(limit || 50, 1), 500);
    const safePage = Math.max(page || 1, 1);
    const total = items.length;
    const pages = Math.ceil(total / safeLimit);
    const start = (safePage - 1) * safeLimit;
    return { data: items.slice(start, start + safeLimit), total, page: safePage, limit: safeLimit, pages };
}

// =============================================================================
// API Key Auth (enabled by default — pass --no-auth to disable)
// =============================================================================

export function isAuthDisabled(): boolean {
    return process.argv.includes('--no-auth') || process.env.TENTACLAW_NO_AUTH === 'true';
}
const NO_AUTH = isAuthDisabled();
if (NO_AUTH) {
    console.warn('[tentaclaw] WARNING: Authentication is DISABLED (--no-auth). API is open to all.');
    console.warn('[tentaclaw] This is not recommended for production or network-exposed deployments.');
}
const API_KEY = process.env.TENTACLAW_API_KEY || '';

/**
 * Map HTTP method to the required permission scope.
 * GET/HEAD/OPTIONS → 'read', POST/PUT/PATCH → 'write', DELETE → 'write'.
 * Admin-only routes are checked separately in their handlers.
 */
function methodToPermission(method: string): string {
    const m = method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
    return 'write'; // POST, PUT, PATCH, DELETE
}

if (!NO_AUTH) {
    // Protect API routes but leave health, dashboard, and root public.
    // Auth is ON by default. Supports env-var key AND per-key DB validation.
    app.use('/api/*', async (c, next) => {
        const auth = c.req.header('Authorization');
        const key = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.query('api_key');
        if (!key) {
            return c.json({ error: 'Unauthorized. Set Authorization: Bearer <key>' }, 401);
        }

        // Legacy env-var key gets full access (backward compat)
        if (API_KEY && key === API_KEY) {
            await next();
            return;
        }

        // Per-key DB validation with permission + expiry checks
        const requiredPerm = methodToPermission(c.req.method);
        const result = validateApiKey(key, requiredPerm);

        if (!result.valid) {
            const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
            recordAuditEvent('apikey_auth_failed', undefined, ip, `API key validation failed: ${result.error} (path: ${c.req.path})`);
            if (result.error === 'expired') {
                return c.json({ error: 'API key has expired' }, 403);
            }
            if (result.error === 'insufficient_permissions') {
                return c.json({ error: `Insufficient permissions. Required: '${requiredPerm}'` }, 403);
            }
            return c.json({ error: 'Unauthorized. Set Authorization: Bearer <key>' }, 401);
        }

        // Per-key rate limiting
        if (result.keyId && result.rateLimitRpm) {
            const rateCheck = checkKeyRateLimit(result.keyId, result.rateLimitRpm);
            if (!rateCheck.allowed) {
                const retryAfter = Math.ceil((rateCheck.resetAt - Date.now()) / 1000);
                c.header('Retry-After', String(Math.max(1, retryAfter)));
                c.header('X-RateLimit-Limit', String(result.rateLimitRpm));
                c.header('X-RateLimit-Remaining', '0');
                c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
                return c.json({ error: `Rate limit exceeded. ${result.rateLimitRpm} req/min for this API key.` }, 429);
            }
            c.header('X-RateLimit-Limit', String(result.rateLimitRpm));
            c.header('X-RateLimit-Remaining', String(rateCheck.remaining));
            c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
        }

        // Stash key metadata on the context for downstream use
        c.set('apiKeyId' as never, result.keyId as never);
        c.set('apiKeyPermissions' as never, result.permissions as never);
        await next();
    });

    app.use('/v1/*', async (c, next) => {
        const auth = c.req.header('Authorization');
        const key = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!key) {
            return c.json({ error: { message: 'Invalid API key', type: 'authentication_error' } }, 401);
        }

        // Legacy env-var key gets full access (backward compat)
        if (API_KEY && key === API_KEY) {
            await next();
            return;
        }

        // Per-key DB validation with permission + expiry checks
        const requiredPerm = methodToPermission(c.req.method);
        const result = validateApiKey(key, requiredPerm);

        if (!result.valid) {
            const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
            recordAuditEvent('apikey_auth_failed', undefined, ip, `API key validation failed: ${result.error} (path: ${c.req.path})`);
            if (result.error === 'expired') {
                return c.json({ error: { message: 'API key has expired', type: 'authentication_error' } }, 403);
            }
            if (result.error === 'insufficient_permissions') {
                return c.json({ error: { message: `Insufficient permissions. Required: '${requiredPerm}'`, type: 'authorization_error' } }, 403);
            }
            return c.json({ error: { message: 'Invalid API key', type: 'authentication_error' } }, 401);
        }

        // Per-key rate limiting
        if (result.keyId && result.rateLimitRpm) {
            const rateCheck = checkKeyRateLimit(result.keyId, result.rateLimitRpm);
            if (!rateCheck.allowed) {
                const retryAfter = Math.ceil((rateCheck.resetAt - Date.now()) / 1000);
                c.header('Retry-After', String(Math.max(1, retryAfter)));
                c.header('X-RateLimit-Limit', String(result.rateLimitRpm));
                c.header('X-RateLimit-Remaining', '0');
                c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
                return c.json({
                    error: { message: `Rate limit exceeded. ${result.rateLimitRpm} req/min for this API key.`, type: 'rate_limit_error' },
                }, 429);
            }
            c.header('X-RateLimit-Limit', String(result.rateLimitRpm));
            c.header('X-RateLimit-Remaining', String(rateCheck.remaining));
            c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
        }

        c.set('apiKeyId' as never, result.keyId as never);
        c.set('apiKeyPermissions' as never, result.permissions as never);
        await next();
    });
}

// =============================================================================
// Rate Limiting (simple in-memory, for /v1/* OpenAI-compat endpoints)
// =============================================================================

// Rate limiting: 60 req/min for unauthenticated, 600 req/min for authenticated.
// Set TENTACLAW_RATE_LIMIT=0 to disable entirely.
const RATE_LIMIT_UNAUTH = parseInt(process.env.TENTACLAW_RATE_LIMIT || '60');
const RATE_LIMIT_AUTH = parseInt(process.env.TENTACLAW_RATE_LIMIT_AUTH || '600');
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

if (RATE_LIMIT_UNAUTH > 0) {
    app.use('/v1/*', async (c, next) => {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        const authHeader = c.req.header('Authorization');
        const isAuthenticated = !!(authHeader && authHeader.startsWith('Bearer '));
        const limit = isAuthenticated ? RATE_LIMIT_AUTH : RATE_LIMIT_UNAUTH;

        const bucketKey = isAuthenticated ? `auth:${authHeader!.slice(7, 15)}` : `ip:${ip}`;
        const now = Date.now();
        let bucket = rateBuckets.get(bucketKey);

        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + 60000 };
            rateBuckets.set(bucketKey, bucket);
        }

        bucket.count++;
        if (bucket.count > limit) {
            return c.json({
                error: { message: `Rate limit exceeded. ${limit} req/min`, type: 'rate_limit_error' },
            }, 429);
        }

        c.header('X-RateLimit-Limit', String(limit));
        c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
        c.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

        await next();
    });

    // Clean up stale buckets every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, bucket] of rateBuckets) {
            if (now > bucket.resetAt + 60000) rateBuckets.delete(ip);
        }
    }, 300_000);
}

// =============================================================================
// Per-API-Key Rate Limiting (respects rate_limit_rpm on api_keys)
// =============================================================================

const keyRateBuckets = new Map<string, { count: number; window_start: number }>();

/**
 * Check per-key rate limit. Returns remaining requests or -1 if exceeded.
 * Called after API key validation to enforce the key's rate_limit_rpm.
 */
function checkKeyRateLimit(keyId: string, rateLimitRpm: number): { allowed: boolean; remaining: number; resetAt: number } {
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

// Clean up stale key rate buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of keyRateBuckets) {
        if (now - bucket.window_start > 120_000) keyRateBuckets.delete(key);
    }
}, 300_000);

// =============================================================================
// Login Rate Limiting — 5 attempts per minute per IP (brute force protection)
// =============================================================================

const loginRateBuckets = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5; // max attempts per minute per IP

function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
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

// Clean up stale login rate buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of loginRateBuckets) {
        if (now > bucket.resetAt + 60_000) loginRateBuckets.delete(ip);
    }
}, 300_000);

// =============================================================================
// Default Chat Completions Rate Limiting — 60 req/min per API key (configurable)
// =============================================================================

const CHAT_RATE_LIMIT = parseInt(process.env.TENTACLAW_CHAT_RATE_LIMIT || '60');
const chatRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkChatRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
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

// =============================================================================
// Agent Authentication (cluster secret for agent-to-gateway communication)
// =============================================================================

// Cluster secret: agents must present this to register or push stats.
// If TENTACLAW_CLUSTER_SECRET is set, use it. Otherwise, generate on first boot.
// If neither is configured and no secret exists in DB, agent auth is disabled (backward compat).

let CLUSTER_SECRET: string | null = null;
let agentAuthEnabled = false;

export function initClusterSecret(): void {
    const envSecret = process.env.TENTACLAW_CLUSTER_SECRET;
    if (envSecret) {
        CLUSTER_SECRET = envSecret;
        agentAuthEnabled = true;
        return;
    }

    // Try to load from DB — only after DB is initialized
    try {
        const dbSecret = getClusterConfig('cluster_secret');
        if (dbSecret) {
            CLUSTER_SECRET = dbSecret;
            agentAuthEnabled = true;
        } else {
            // Auto-generate a random 32-byte hex secret and store it in DB
            const generated = getOrCreateClusterSecret();
            CLUSTER_SECRET = generated;
            agentAuthEnabled = true;
            console.warn('[tentaclaw] Auto-generated cluster secret. Set TENTACLAW_CLUSTER_SECRET for production.');
        }
    } catch {
        // DB not ready yet — will be initialized later at startup
    }
}

/**
 * Validate the cluster secret from a request.
 * Returns true if agent auth is disabled (backward compat) or if the secret matches.
 */
function validateClusterSecret(headerSecret: string | undefined): boolean {
    if (!agentAuthEnabled) return true; // Backward compat — no secret required
    if (!headerSecret) return false;
    return headerSecret === CLUSTER_SECRET;
}

// =============================================================================
// Health Check
// =============================================================================

app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        service: 'tentaclaw-gateway',
        version: '0.1.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.get('/', (c) => {
    return c.json({
        name: 'TentaCLAW Gateway',
        version: '0.1.0',
        tagline: 'Eight arms. One mind. Zero compromises.',
        endpoints: {
            health: '/health',
            dashboard: '/dashboard',
            api: '/api/v1',
            openai: '/v1/chat/completions',
            anthropic: '/v1/messages',
        },
    });
});

// =============================================================================
// Node Registration
// =============================================================================

app.post('/api/v1/register', async (c) => {
    // Agent authentication — verify cluster secret
    const clusterSecret = c.req.header('X-Cluster-Secret');
    if (!validateClusterSecret(clusterSecret)) {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('agent_auth_failed', 'agent', ip, 'Invalid cluster secret on /api/v1/register');
        return c.json({ error: 'Forbidden. Invalid or missing cluster secret. Set X-Cluster-Secret header.' }, 403);
    }

    // Optional join token validation (Phase 38) — if X-Join-Token header present, validate it
    const joinToken = c.req.header('X-Join-Token');
    if (joinToken) {
        const jtResult = validateJoinToken(joinToken);
        if (!jtResult.valid) {
            const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
            recordAuditEvent('join_token_failed', 'agent', ip, `Invalid join token: ${jtResult.error}`);
            return c.json({ error: `Join token validation failed: ${jtResult.error}` }, 403);
        }
    }

    const body = await c.req.json();

    if (!body.node_id || typeof body.node_id !== 'string' || body.node_id.trim() === '') {
        return c.json({ error: 'node_id must be a non-empty string' }, 400);
    }
    if (!body.farm_hash || typeof body.farm_hash !== 'string') {
        return c.json({ error: 'farm_hash must be a non-empty string' }, 400);
    }
    if (!body.hostname || typeof body.hostname !== 'string') {
        return c.json({ error: 'hostname must be a non-empty string' }, 400);
    }

    // Sanitize gpu_count — must be a non-negative reasonable integer (max 128 GPUs per node)
    const rawGpu = typeof body.gpu_count === 'number' ? body.gpu_count : 0;
    const gpuCount = Number.isFinite(rawGpu) && rawGpu >= 0 && rawGpu <= 128
        ? Math.floor(rawGpu) : 0;

    const node = registerNode({
        node_id: String(body.node_id).trim().slice(0, 256),
        farm_hash: String(body.farm_hash).trim().slice(0, 64),
        hostname: String(body.hostname).trim().slice(0, 256),
        ip_address: body.ip_address,
        mac_address: body.mac_address,
        gpu_count: gpuCount,
        os_version: body.os_version,
    });

    broadcastSSE('node_online', { node_id: node.id, hostname: node.hostname, timestamp: new Date().toISOString() });
    recordNodeEvent(node.id, 'registered', 'Farm: ' + node.farm_hash);

    console.log(`[tentaclaw] Node registered: ${node.id} (${node.hostname}) — Farm: ${node.farm_hash}`);

    return c.json({ status: 'registered', node });
});

// =============================================================================
// Stats Ingestion (Agent pushes here)
// =============================================================================

app.post('/api/v1/nodes/:nodeId/stats', async (c) => {
    // Agent authentication — verify cluster secret
    const clusterSecret = c.req.header('X-Cluster-Secret');
    if (!validateClusterSecret(clusterSecret)) {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('agent_auth_failed', 'agent', ip, `Invalid cluster secret on /api/v1/nodes/${c.req.param('nodeId')}/stats`);
        return c.json({ error: 'Forbidden. Invalid or missing cluster secret. Set X-Cluster-Secret header.' }, 403);
    }

    const nodeId = c.req.param('nodeId');
    const stats: StatsPayload = await c.req.json();

    // Validate critical fields — defensive defaults for missing nested objects
    if (!stats || typeof stats !== 'object') {
        return c.json({ error: 'Invalid stats payload' }, 400);
    }
    if (!Array.isArray(stats.gpus)) {
        stats.gpus = [];
    }
    if (typeof stats.gpu_count !== 'number' || stats.gpu_count < 0 || stats.gpu_count > 128) {
        stats.gpu_count = stats.gpus.length;
    }
    if (!stats.cpu || typeof stats.cpu !== 'object') {
        stats.cpu = { usage_pct: 0, temp_c: 0 };
    }
    if (!stats.ram || typeof stats.ram !== 'object') {
        stats.ram = { total_mb: 0, used_mb: 0 };
    }
    if (!stats.disk || typeof stats.disk !== 'object') {
        stats.disk = { total_gb: 0, used_gb: 0 };
    }
    if (!stats.network || typeof stats.network !== 'object') {
        stats.network = { bytes_in: 0, bytes_out: 0 };
    }
    if (!stats.inference || typeof stats.inference !== 'object') {
        stats.inference = { loaded_models: [], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 };
    }

    // Auto-register if node doesn't exist yet
    const existing = getNode(nodeId);
    if (!existing) {
        registerNode({
            node_id: nodeId,
            farm_hash: stats.farm_hash || 'unknown',
            hostname: stats.hostname || nodeId,
            gpu_count: stats.gpu_count || 0,
        });
    }

    // Store stats
    insertStats(nodeId, stats);

    // Check thresholds and create alerts (hard-coded legacy checks)
    const newAlerts = checkAndAlert(nodeId, stats);
    for (const alert of newAlerts) {
        broadcastSSE('alert', alert);
    }

    // Evaluate configurable alert rules
    const ruleAlerts = evaluateAlertRules(nodeId, stats);
    for (const alert of ruleAlerts) {
        broadcastSSE('alert', alert);
    }

    // Broadcast to dashboard
    broadcastSSE('stats_update', {
        node_id: nodeId,
        hostname: stats.hostname,
        gpu_count: stats.gpu_count,
        toks_per_sec: stats.toks_per_sec,
        timestamp: new Date().toISOString(),
    });

    // Broadcast to Daphney
    broadcastDaphney('stats_update', {
        type: 'gpu_temp_change',
        node_id: nodeId,
        hostname: stats.hostname,
        gpus: stats.gpus.map(g => ({ name: g.name, temp: g.temperatureC, util: g.utilizationPct })),
        inference: stats.inference,
        timestamp: new Date().toISOString(),
    });

    // Return pending commands
    const commands = getPendingCommands(nodeId);

    if (commands.length > 0) {
        broadcastSSE('command_sent', {
            node_id: nodeId,
            commands: commands.map(cmd => ({ id: cmd.id, action: cmd.action })),
            timestamp: new Date().toISOString(),
        });
    }

    const response: GatewayResponse = {
        commands,
    };

    return c.json(response);
});

// =============================================================================
// Node Management
// =============================================================================

app.get('/api/v1/nodes', (c) => {
    const farmHash = c.req.query('farm_hash');
    const nodes = farmHash ? getNodesByFarm(farmHash) : getAllNodes();
    return c.json({ nodes });
});

app.get('/api/v1/nodes/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }
    return c.json({ node });
});

app.delete('/api/v1/nodes/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    const deleted = deleteNode(nodeId);
    if (!deleted) {
        return c.json({ error: 'Node not found' }, 404);
    }
    return c.json({ status: 'deleted', node_id: nodeId });
});

app.get('/api/v1/nodes/:nodeId/stats/history', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '100');
    const history = getStatsHistory(nodeId, limit);
    return c.json({ stats: history });
});

// =============================================================================
// Commands
// =============================================================================

app.post('/api/v1/nodes/:nodeId/commands', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();

    if (!body.action) {
        return c.json({ error: 'Missing required field: action' }, 400);
    }

    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }

    const command = queueCommand(nodeId, body.action as CommandAction, {
        model: body.model,
        gpu: body.gpu,
        profile: body.profile,
        priority: body.priority,
    });

    broadcastSSE('command_sent', {
        node_id: nodeId,
        command: { id: command.id, action: command.action },
        timestamp: new Date().toISOString(),
    });

    console.log(`[tentaclaw] Command queued: ${command.action} → ${nodeId}`);

    return c.json({ status: 'queued', command });
});

app.post('/api/v1/commands/:commandId/complete', (c) => {
    const commandId = c.req.param('commandId');
    completeCommand(commandId);

    broadcastSSE('command_completed', {
        command_id: commandId,
        timestamp: new Date().toISOString(),
    });

    return c.json({ status: 'completed', command_id: commandId });
});

// =============================================================================
// Flight Sheets
// =============================================================================

app.get('/api/v1/flight-sheets', (c) => {
    const sheets = getAllFlightSheets();
    return c.json({ flight_sheets: sheets });
});

app.post('/api/v1/flight-sheets', async (c) => {
    const body = await c.req.json();

    if (!body.name || !body.targets || !Array.isArray(body.targets)) {
        return c.json({ error: 'Missing required fields: name, targets[]' }, 400);
    }

    const sheet = createFlightSheet(body.name, body.description || '', body.targets);
    console.log(`[tentaclaw] Flight sheet created: ${sheet.name} (${sheet.id})`);
    return c.json({ status: 'created', flight_sheet: sheet });
});

app.get('/api/v1/flight-sheets/:id', (c) => {
    const id = c.req.param('id');
    const sheet = getFlightSheet(id);
    if (!sheet) {
        return c.json({ error: 'Flight sheet not found' }, 404);
    }
    return c.json({ flight_sheet: sheet });
});

app.delete('/api/v1/flight-sheets/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteFlightSheet(id);
    if (!deleted) {
        return c.json({ error: 'Flight sheet not found' }, 404);
    }
    return c.json({ status: 'deleted', id });
});

app.post('/api/v1/flight-sheets/:id/apply', (c) => {
    const id = c.req.param('id');
    const commands = applyFlightSheet(id);

    if (commands.length === 0) {
        return c.json({ error: 'Flight sheet not found or no matching nodes' }, 404);
    }

    broadcastSSE('flight_sheet_applied', {
        flight_sheet_id: id,
        commands_queued: commands.length,
        timestamp: new Date().toISOString(),
    });

    console.log(`[tentaclaw] Flight sheet applied: ${id} — ${commands.length} commands queued`);

    return c.json({ status: 'applied', commands_queued: commands.length, commands });
});

// =============================================================================
// Cluster Summary
// =============================================================================

app.get('/api/v1/summary', (c) => {
    const summary = getClusterSummary();
    return c.json(summary);
});

app.get('/api/v1/health/score', (c) => {
    const health = getHealthScore();
    return c.json(health);
});

// Detailed Health Check v2
app.get('/api/v1/health/detailed', (c) => {
    const checks: Record<string, unknown> = {};
    let hasError = false;
    let hasWarning = false;

    // Database check — run SELECT 1 and measure latency
    try {
        const dbStart = performance.now();
        const d = getDb();
        d.prepare('SELECT 1').get();
        const latencyMs = Math.round((performance.now() - dbStart) * 100) / 100;
        checks.database = { status: 'ok', latency_ms: latencyMs };
    } catch {
        checks.database = { status: 'error', latency_ms: -1 };
        hasError = true;
    }

    // Nodes check — count total vs online
    try {
        const allNodes = getAllNodes();
        const total = allNodes.length;
        const online = allNodes.filter(n => n.status === 'online').length;
        let nodeStatus: 'ok' | 'degraded' | 'error' = 'ok';
        if (total === 0 || online === 0) {
            nodeStatus = 'error';
            hasError = true;
        } else if (online < total) {
            nodeStatus = 'degraded';
            hasWarning = true;
        }
        checks.nodes = { total, online, status: nodeStatus };
    } catch {
        checks.nodes = { total: 0, online: 0, status: 'error' };
        hasError = true;
    }

    // Memory check
    const mem = process.memoryUsage();
    const rssMb = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
    const heapMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
    const memStatus = rssMb > 512 ? 'warning' : 'ok';
    if (memStatus === 'warning') hasWarning = true;
    checks.memory = { status: memStatus, rss_mb: rssMb, heap_mb: heapMb };

    // Disk placeholder — reports data_dir_mb via rss as a proxy
    const diskStatus = rssMb > 1024 ? 'warning' : 'ok';
    if (diskStatus === 'warning') hasWarning = true;
    checks.disk = { status: diskStatus, data_dir_mb: rssMb };

    // Uptime
    checks.uptime_seconds = Math.round(process.uptime());

    // Overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (hasError) status = 'unhealthy';
    else if (hasWarning) status = 'degraded';

    const statusCode = status === 'unhealthy' ? 503 : 200;
    return c.json({
        status,
        checks,
        version: '0.2.0',
        timestamp: new Date().toISOString(),
    }, statusCode);
});

// =============================================================================
// Alerts
// =============================================================================

app.get('/api/v1/alerts', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const alerts = getRecentAlerts(limit);
    return c.json({ alerts });
});

app.post('/api/v1/alerts/:id/acknowledge', (c) => {
    const id = c.req.param('id');
    const acked = acknowledgeAlert(id);
    if (!acked) {
        return c.json({ error: 'Alert not found' }, 404);
    }
    return c.json({ status: 'acknowledged', id });
});

// =============================================================================
// Alert Rules
// =============================================================================

app.get('/api/v1/alert-rules', (c) => {
    const rules = getAlertRules();
    return c.json({ rules });
});

app.post('/api/v1/alert-rules', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.metric || !body.operator || body.threshold === undefined) {
        return c.json({ error: 'Missing required fields: name, metric, operator, threshold' }, 400);
    }
    const validMetrics = ['gpu_temp', 'gpu_util', 'vram_pct', 'cpu_usage', 'ram_pct', 'disk_pct', 'inference_latency'];
    if (!validMetrics.includes(body.metric)) {
        return c.json({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, 400);
    }
    const validOperators = ['gt', 'lt', 'gte', 'lte', 'eq'];
    if (!validOperators.includes(body.operator)) {
        return c.json({ error: `Invalid operator. Must be one of: ${validOperators.join(', ')}` }, 400);
    }
    const result = createAlertRule({
        name: body.name,
        metric: body.metric,
        operator: body.operator,
        threshold: body.threshold,
        severity: body.severity,
        cooldown_secs: body.cooldown_secs,
        node_filter: body.node_filter,
    });
    return c.json({ status: 'created', id: result.id }, 201);
});

app.put('/api/v1/alert-rules/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    if (body.metric) {
        const validMetrics = ['gpu_temp', 'gpu_util', 'vram_pct', 'cpu_usage', 'ram_pct', 'disk_pct', 'inference_latency'];
        if (!validMetrics.includes(body.metric)) {
            return c.json({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, 400);
        }
    }
    if (body.operator) {
        const validOperators = ['gt', 'lt', 'gte', 'lte', 'eq'];
        if (!validOperators.includes(body.operator)) {
            return c.json({ error: `Invalid operator. Must be one of: ${validOperators.join(', ')}` }, 400);
        }
    }
    const updated = updateAlertRule(id, body);
    if (!updated) {
        return c.json({ error: 'Alert rule not found or no changes applied' }, 404);
    }
    return c.json({ status: 'updated', id });
});

app.delete('/api/v1/alert-rules/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteAlertRule(id);
    if (!deleted) {
        return c.json({ error: 'Alert rule not found' }, 404);
    }
    return c.json({ status: 'deleted', id });
});

app.post('/api/v1/alert-rules/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const enabled = body.enabled !== undefined ? !!body.enabled : true;
    const toggled = toggleAlertRule(id, enabled);
    if (!toggled) {
        return c.json({ error: 'Alert rule not found' }, 404);
    }
    return c.json({ status: enabled ? 'enabled' : 'disabled', id });
});

// =============================================================================
// Benchmarks
// =============================================================================

app.get('/api/v1/benchmarks', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const benchmarks = getAllBenchmarks(limit);
    return c.json({ benchmarks });
});

app.get('/api/v1/nodes/:nodeId/benchmarks', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '20');
    const benchmarks = getNodeBenchmarks(nodeId, limit);
    return c.json({ benchmarks });
});

app.post('/api/v1/nodes/:nodeId/benchmark', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();

    if (!body.model || body.tokens_per_sec === undefined) {
        return c.json({ error: 'Missing required fields: model, tokens_per_sec' }, 400);
    }

    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }

    const benchmark = storeBenchmark(nodeId, {
        model: body.model,
        tokens_per_sec: body.tokens_per_sec,
        prompt_eval_rate: body.prompt_eval_rate,
        eval_rate: body.eval_rate,
        total_duration_ms: body.total_duration_ms,
    });

    broadcastSSE('benchmark_complete', {
        node_id: nodeId,
        model: body.model,
        tokens_per_sec: body.tokens_per_sec,
        timestamp: new Date().toISOString(),
    });

    console.log('[tentaclaw] Benchmark stored: ' + nodeId + ' — ' + body.model + ' @ ' + body.tokens_per_sec + ' tok/s');

    return c.json({ status: 'stored', benchmark });
});

// Queue a benchmark command for a node (triggers the agent to run a benchmark)
app.post('/api/v1/nodes/:nodeId/benchmark/run', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json().catch(() => ({}));
    const model = body.model || 'llama3.1:8b';

    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }

    const command = queueCommand(nodeId, 'benchmark' as any, { model });

    console.log('[tentaclaw] Benchmark queued: ' + nodeId + ' — ' + model);

    return c.json({ status: 'queued', command });
});

// =============================================================================
// Model Management (convenience routes — queue commands to agents)
// =============================================================================

app.get('/api/v1/nodes/:nodeId/models', (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const models = node.latest_stats?.inference.loaded_models || [];
    return c.json({ node_id: nodeId, models });
});

app.post('/api/v1/nodes/:nodeId/models/pull', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();
    if (!body.model) return c.json({ error: 'Missing required field: model' }, 400);

    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const command = queueCommand(nodeId, 'install_model', { model: body.model });
    console.log('[tentaclaw] Model pull queued: ' + body.model + ' → ' + nodeId);
    return c.json({ status: 'queued', command });
});

app.delete('/api/v1/nodes/:nodeId/models/:model', (c) => {
    const nodeId = c.req.param('nodeId');
    const model = c.req.param('model');

    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const command = queueCommand(nodeId, 'remove_model', { model });
    console.log('[tentaclaw] Model removal queued: ' + model + ' → ' + nodeId);
    return c.json({ status: 'queued', command });
});

// =============================================================================
// Cluster-Wide Deploy
// =============================================================================

app.post('/api/v1/deploy', async (c) => {
    const body = await c.req.json();
    if (!body.model) return c.json({ error: 'Missing required field: model' }, 400);

    const allNodes = getAllNodes();
    let targets = allNodes.filter(n => n.status === 'online');

    // Filter by farm hash if specified
    if (body.farm_hash) {
        targets = targets.filter(n => n.farm_hash === body.farm_hash);
    }

    // Filter by specific node IDs if specified
    if (body.node_ids && Array.isArray(body.node_ids)) {
        targets = targets.filter(n => body.node_ids.includes(n.id));
    }

    const commands = targets.map(node =>
        queueCommand(node.id, 'install_model', { model: body.model })
    );

    broadcastSSE('command_sent', {
        action: 'deploy',
        model: body.model,
        node_count: commands.length,
        timestamp: new Date().toISOString(),
    });

    console.log('[tentaclaw] Deploy: ' + body.model + ' → ' + commands.length + ' nodes');
    return c.json({ status: 'deployed', model: body.model, commands_queued: commands.length, commands });
});

// =============================================================================
// Model Quantization Pipeline (Wave 48, Phases 787-803)
// =============================================================================

app.post('/api/v1/quantize', async (c) => {
    const body = await c.req.json();
    if (!body.model) return c.json({ error: 'Missing required field: model' }, 400);

    const method = body.method || 'fp8';
    const validMethods = ['fp8', 'awq', 'gptq', 'gguf_q4', 'gguf_q6', 'gguf_q8', 'exl2'];
    if (!validMethods.includes(method)) {
        return c.json({ error: `Invalid method. Valid: ${validMethods.join(', ')}` }, 400);
    }

    const calibrationSamples = body.calibration_samples || 512;
    const validateQuality = body.validate !== false;
    const maxQualityLoss = body.max_quality_loss_pct || 3.0;

    // Estimate output size
    const vramEstimateMb = estimateModelVram(body.model);
    const sizeReduction: Record<string, number> = {
        'fp8': 0.5, 'awq': 0.25, 'gptq': 0.25, 'gguf_q4': 0.25,
        'gguf_q6': 0.375, 'gguf_q8': 0.5, 'exl2': 0.3,
    };

    const estimatedSizeMb = vramEstimateMb > 0 ? Math.round(vramEstimateMb * (sizeReduction[method] || 0.5)) : null;

    // Queue the quantization job to an available node with the model
    const modelNode = findBestNodeForModel(body.model);
    if (!modelNode) {
        return c.json({
            error: `No node has model "${body.model}" loaded. Deploy it first, then quantize.`,
            hint: `Run: tentaclaw deploy ${body.model}`,
        }, 404);
    }

    const jobId = queueCommand(modelNode.node_id, 'quantize_model', {
        model: body.model,
        method,
        calibration_samples: calibrationSamples,
        validate_quality: validateQuality,
        max_quality_loss_pct: maxQualityLoss,
        output_format: method.startsWith('gguf') ? 'gguf' : method === 'exl2' ? 'exl2' : 'safetensors',
    });

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('model_quantize', undefined, ip, `Quantize ${body.model} → ${method} on ${modelNode.hostname}`);

    return c.json({
        status: 'queued',
        job_id: jobId,
        model: body.model,
        method,
        target_node: modelNode.hostname,
        estimated_size_mb: estimatedSizeMb,
        calibration_samples: calibrationSamples,
        quality_validation: validateQuality,
        max_quality_loss_pct: maxQualityLoss,
    });
});

// =============================================================================
// Farm Grouping
// =============================================================================

app.get('/api/v1/farms', (c) => {
    const allNodes = getAllNodes();
    const farmMap = new Map<string, typeof allNodes>();

    for (const node of allNodes) {
        const list = farmMap.get(node.farm_hash) || [];
        list.push(node);
        farmMap.set(node.farm_hash, list);
    }

    const farms = [...farmMap.entries()].map(([hash, nodes]) => {
        let totalGpus = 0, totalVram = 0, totalToks = 0;
        const online = nodes.filter(n => n.status === 'online').length;

        for (const node of nodes) {
            if (node.latest_stats) {
                totalGpus += node.latest_stats.gpu_count;
                totalToks += node.latest_stats.toks_per_sec;
                for (const gpu of node.latest_stats.gpus) {
                    totalVram += gpu.vramTotalMb;
                }
            }
        }

        return {
            farm_hash: hash,
            total_nodes: nodes.length,
            online_nodes: online,
            total_gpus: totalGpus,
            total_vram_mb: totalVram,
            total_toks_per_sec: totalToks,
        };
    });

    return c.json({ farms });
});

app.get('/api/v1/farms/:hash', (c) => {
    const hash = c.req.param('hash');
    const nodes = getNodesByFarm(hash);
    if (nodes.length === 0) return c.json({ error: 'Farm not found' }, 404);
    return c.json({ farm_hash: hash, nodes });
});

// =============================================================================
// Node Events & History
// =============================================================================

app.get('/api/v1/nodes/:nodeId/events', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '50');
    const events = getNodeEvents(nodeId, limit);
    return c.json({ events });
});

app.get('/api/v1/nodes/:nodeId/sparklines', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('points') || '60');
    const history = getCompactHistory(nodeId, limit);
    return c.json(history);
});

// =============================================================================
// OpenAI-Compatible API (drop-in replacement)
// =============================================================================

// List cluster models (TentaCLAW format)
app.get('/api/v1/models', (c) => {
    const models = getClusterModels();
    return c.json({ models });
});

// List available models (OpenAI format — enhanced with TentaCLAW metadata)
app.get('/v1/models', (c) => {
    const models = getClusterModels();
    const aliases = getAllModelAliases();

    function classifyModelType(modelName: string): string {
        if (/whisper/i.test(modelName)) return 'audio-transcription';
        if (/tts|bark|piper|xtts|coqui|speecht5/i.test(modelName)) return 'audio-tts';
        if (/stable-diffusion|sdxl|sd|comfyui|dall-e|flux|midjourney/i.test(modelName)) return 'image-generation';
        if (/llava|bakllava|moondream|cogvlm|fuyu|obsidian/i.test(modelName)) return 'vision';
        if (/embed|bge|gte|e5|nomic/i.test(modelName)) return 'embedding';
        return 'text-generation';
    }

    return c.json({
        object: 'list',
        data: models.map(m => ({
            id: m.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'tentaclaw-cluster',
            permission: [],
            root: m.model,
            _tentaclaw: {
                node_count: m.node_count,
                nodes: m.nodes,
                aliases: aliases.filter(a => a.target === m.model).map(a => a.alias),
                estimated_vram_mb: estimateModelVram(m.model),
                type: classifyModelType(m.model),
            },
            parent: null,
        })),
    });
});

// =============================================================================
// Request Queue (Wave 23)
// =============================================================================

interface QueuedRequest {
    id: string;
    priority: number; // 0=high, 1=normal, 2=low
    model: string;
    addedAt: number;
}

const requestQueue: QueuedRequest[] = [];
const activeRequests = new Map<string, number>(); // nodeId → count
const MAX_QUEUE_DEPTH = 100;
const MAX_CONCURRENT_PER_NODE = 4;

function getQueueStats() {
    return {
        queued: requestQueue.length,
        active: [...activeRequests.values()].reduce((s, n) => s + n, 0),
        max_queue: MAX_QUEUE_DEPTH,
        max_concurrent_per_node: MAX_CONCURRENT_PER_NODE,
    };
}

app.get('/api/v1/queue', (c) => {
    return c.json(getQueueStats());
});

// Chat completions proxy — OpenAI-compatible with function calling + JSON mode
app.post('/v1/chat/completions', async (c) => {
    // Default rate limiting: 60 req/min per API key (or IP if no key)
    const auth = c.req.header('Authorization');
    const chatRateId = (auth?.startsWith('Bearer ') ? auth.slice(7) : null) || c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'anon';
    const chatRate = checkChatRateLimit(chatRateId);
    c.header('X-RateLimit-Limit', String(CHAT_RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(chatRate.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(chatRate.resetAt / 1000)));
    if (!chatRate.allowed) {
        const retryAfter = Math.ceil((chatRate.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(Math.max(1, retryAfter)));
        return c.json({
            error: { message: `Rate limit exceeded. ${CHAT_RATE_LIMIT} req/min.`, type: 'rate_limit_error' },
        }, 429);
    }

    const body = await c.req.json();
    const model = body.model;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return c.json({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
    }

    // Load shedding — reject if queue is full
    const qStats = getQueueStats();
    if (qStats.active >= MAX_QUEUE_DEPTH) {
        return c.json({ error: { message: 'Cluster is at capacity. Try again shortly.', type: 'rate_limit', queue_depth: qStats.queued } }, 429);
    }

    // Log function calling usage for analytics
    const hasTools = body.tools && Array.isArray(body.tools) && body.tools.length > 0;
    const hasJsonMode = body.response_format?.type === 'json_object';
    const hasFunctions = body.functions && Array.isArray(body.functions); // Legacy format

    // Resolve model aliases (gpt-4 → llama3.1:70b)
    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    // Find best node — try target first, then fallbacks
    let target = findBestNode(resolvedModel);
    let usedFallback = false;

    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback);
            if (target) {
                resolvedModel = fallback;
                usedFallback = true;
                break;
            }
        }
    }

    if (!target) {
        return c.json({
            error: {
                message: 'No online node has model "' + model + '"' + (model !== resolvedModel ? ' (resolved to "' + resolvedModel + '")' : '') + '. Deploy it first.',
                type: 'model_not_found',
                available_models: getClusterModels().map(m => m.model),
                aliases: model !== resolvedModel ? { requested: model, resolved: resolvedModel, fallbacks: resolved.fallbacks } : undefined,
            },
        }, 503);
    }

    // Check prompt cache (skip for streaming)
    if (!body.stream) {
        const cacheKey = createHash('sha256').update(JSON.stringify({ model: resolvedModel, messages: body.messages })).digest('hex');
        const noCache = c.req.header('Cache-Control') === 'no-cache';

        if (!noCache) {
            const cached = getCachedResponse(cacheKey);
            if (cached) {
                const result = JSON.parse(cached.response);
                result._tentaclaw = { cached: true, tokens_saved: cached.tokens_saved };
                return c.json(result);
            }
        }
    }

    // Proxy the request to the target node — pass ALL OpenAI params through
    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: body.messages,
        stream: body.stream || false,
    };
    // Pass through all supported OpenAI parameters
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.max_tokens !== undefined) proxyBody.max_tokens = body.max_tokens;
    if (body.stop) proxyBody.stop = body.stop;
    if (body.seed !== undefined) proxyBody.seed = body.seed;
    if (body.frequency_penalty !== undefined) proxyBody.frequency_penalty = body.frequency_penalty;
    if (body.presence_penalty !== undefined) proxyBody.presence_penalty = body.presence_penalty;
    if (body.n !== undefined) proxyBody.n = body.n;
    // Function calling / tools
    if (hasTools) proxyBody.tools = body.tools;
    if (body.tool_choice) proxyBody.tool_choice = body.tool_choice;
    if (hasFunctions) proxyBody.functions = body.functions; // Legacy
    if (body.function_call) proxyBody.function_call = body.function_call; // Legacy
    // JSON mode
    if (hasJsonMode) proxyBody.response_format = body.response_format;
    // Logprobs
    if (body.logprobs !== undefined) proxyBody.logprobs = body.logprobs;
    if (body.top_logprobs !== undefined) proxyBody.top_logprobs = body.top_logprobs;
    const backendPort = target.backend_port || 11434;
    const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
    const startTime = Date.now();

    try {
        const proxyReq = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyBody),
        });

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

        // Stream or return the response
        if (body.stream) {
            return new Response(proxyReq.body, {
                status: proxyReq.status,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-TentaCLAW-Node': target.node_id,
                    'X-TentaCLAW-Hostname': target.hostname,
                    'X-TentaCLAW-Latency': String(latencyMs),
                },
            });
        }

        const result = await proxyReq.json() as Record<string, unknown>;

        // OpenTelemetry gen_ai.* attributes (Wave 17, Phase 273)
        const usage = (result as any).usage;
        const inputTokens = usage?.prompt_tokens || 0;
        const outputTokens = usage?.completion_tokens || 0;
        const totalTokens = usage?.total_tokens || inputTokens + outputTokens;
        const finishReason = (result as any).choices?.[0]?.finish_reason || 'unknown';
        const tokensPerSec = outputTokens > 0 && latencyMs > 0 ? Math.round((outputTokens / latencyMs) * 1000) : 0;

        // Set gen_ai response headers for observability (OTel-compatible)
        c.header('X-GenAI-Model', resolvedModel);
        c.header('X-GenAI-Input-Tokens', String(inputTokens));
        c.header('X-GenAI-Output-Tokens', String(outputTokens));
        c.header('X-GenAI-Total-Tokens', String(totalTokens));
        c.header('X-GenAI-Finish-Reason', finishReason);
        c.header('X-GenAI-Latency-Ms', String(latencyMs));
        c.header('X-GenAI-Tokens-Per-Sec', String(tokensPerSec));

        result._tentaclaw = {
            routed_to: target.node_id,
            hostname: target.hostname,
            gpu_utilization: target.gpu_utilization_avg,
            latency_ms: latencyMs,
            resolved_model: resolvedModel,
            alias_used: model !== resolvedModel ? model : undefined,
            fallback_used: usedFallback ? resolvedModel : undefined,
            backend: target.backend_type,
            cached: false,
            tools_used: hasTools || undefined,
            json_mode: hasJsonMode || undefined,
            // gen_ai.* semantic conventions
            gen_ai: {
                system: 'tentaclaw',
                request_model: resolvedModel,
                response_model: (result as any).model || resolvedModel,
                usage_input_tokens: inputTokens,
                usage_output_tokens: outputTokens,
                usage_total_tokens: totalTokens,
                response_finish_reasons: [finishReason],
                tokens_per_second: tokensPerSec,
            },
        };

        // Cache the response (non-streaming only)
        if (!body.stream && proxyReq.ok) {
            const cacheKey = createHash('sha256').update(JSON.stringify({ model: resolvedModel, messages: body.messages })).digest('hex');
            const usage = (result as any).usage;
            const tokensSaved = (usage?.total_tokens) || 0;
            cacheResponse(cacheKey, resolvedModel, JSON.stringify(body.messages).slice(0, 100), JSON.stringify(result), tokensSaved);
        }

        return c.json(result, proxyReq.status as any);

    } catch (err: any) {
        recordRouteResult(target.node_id, model, Date.now() - startTime, false);
        logInferenceRequest(target.node_id, model, Date.now() - startTime, false, 0, 0, err.message);

        // AUTO-RETRY on different node
        const retry = findBestNode(model);
        if (retry && retry.node_id !== target.node_id) {
            try {
                const retryPort = retry.backend_port || 11434;
                const retryUrl = 'http://' + (retry.ip_address || retry.hostname) + ':' + retryPort + '/v1/chat/completions';
                const retryReq = await fetch(retryUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const retryLatency = Date.now() - startTime;
                recordRouteResult(retry.node_id, model, retryLatency, retryReq.ok);

                const result = await retryReq.json() as Record<string, unknown>;
                result._tentaclaw = {
                    routed_to: retry.node_id,
                    hostname: retry.hostname,
                    retried_from: target.node_id,
                    latency_ms: retryLatency,
                };
                return c.json(result, retryReq.status as any);
            } catch {}
        }

        return c.json({
            error: {
                message: 'Failed to proxy to node ' + target.hostname + ': ' + err.message,
                type: 'proxy_error',
                node_id: target.node_id,
            },
        }, 502);
    }
});

// Completions (legacy) — same routing logic
app.post('/v1/completions', async (c) => {
    const body = await c.req.json();
    const model = body.model;
    if (!model) return c.json({ error: { message: 'model is required' } }, 400);

    const target = findBestNode(model);
    if (!target) return c.json({ error: { message: 'No node has model "' + model + '" loaded' } }, 503);

    const completionsPort = target.backend_port || 11434;
    const completionsUrl = 'http://' + (target.ip_address || target.hostname) + ':' + completionsPort + '/v1/completions';
    try {
        const proxyReq = await fetch(completionsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (body.stream) {
            return new Response(proxyReq.body, {
                status: proxyReq.status,
                headers: { 'Content-Type': 'text/event-stream', 'X-TentaCLAW-Node': target.node_id },
            });
        }
        const result = await proxyReq.json() as Record<string, unknown>;
        result._tentaclaw = { routed_to: target.node_id, hostname: target.hostname };
        return c.json(result, proxyReq.status as any);
    } catch (err: any) {
        return c.json({ error: { message: 'Proxy failed: ' + err.message } }, 502);
    }
});

// =============================================================================
// Anthropic Messages API — /v1/messages compatibility
// =============================================================================

/**
 * Additional Anthropic model aliases.
 * These extend the default alias system so Anthropic SDK clients work out of the box.
 * The base aliases (claude-3-opus, claude-3-sonnet, claude-3-haiku) are already seeded
 * via ensureDefaultAliases(). These cover the full versioned model names.
 */
const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
    'claude-3-opus-20240229': 'claude-3-opus',
    'claude-3-5-opus-20250218': 'claude-3-opus',
    'claude-3-sonnet-20240229': 'claude-3-sonnet',
    'claude-3-5-sonnet-20240620': 'claude-3-sonnet',
    'claude-3-5-sonnet-20241022': 'claude-3-sonnet',
    'claude-3-haiku-20240307': 'claude-3-haiku',
    'claude-3-5-haiku-20241022': 'claude-3-haiku',
    'claude-4-opus-20250514': 'claude-3-opus',
    'claude-4-sonnet-20250514': 'claude-3-sonnet',
};

/** Resolve an Anthropic model name through the two-level alias chain. */
function resolveAnthropicModel(model: string): { target: string; fallbacks: string[]; originalModel: string } {
    // Level 1: map versioned Anthropic name → base alias name
    const baseAlias = ANTHROPIC_MODEL_ALIASES[model] || model;
    // Level 2: resolve through the cluster alias system
    const resolved = resolveModelAlias(baseAlias);
    return { target: resolved.target, fallbacks: resolved.fallbacks, originalModel: model };
}

/** Convert Anthropic messages format to OpenAI messages format. */
function convertAnthropicToOpenAIMessages(
    messages: Array<{ role: string; content: unknown }>,
    system?: string | Array<{ type: string; text: string }>,
): Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> {
    const result: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> = [];

    // Anthropic puts system at the top level; OpenAI uses a system message
    if (system) {
        const systemText = typeof system === 'string'
            ? system
            : system.map(b => b.text).join('\n');
        result.push({ role: 'system', content: systemText });
    }

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            result.push({ role: msg.role, content: msg.content });
            continue;
        }

        // Content blocks — Anthropic uses arrays of typed blocks
        if (Array.isArray(msg.content)) {
            const blocks = msg.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }>;

            // tool_result messages → OpenAI tool role
            if (msg.role === 'user' && blocks.some(b => b.type === 'tool_result')) {
                for (const block of blocks) {
                    if (block.type === 'tool_result') {
                        const toolContent = typeof block.content === 'string'
                            ? block.content
                            : Array.isArray(block.content)
                                ? (block.content as Array<{ text?: string }>).map(c => c.text || '').join('\n')
                                : JSON.stringify(block.content);
                        result.push({
                            role: 'tool',
                            content: toolContent,
                            tool_call_id: block.tool_use_id || '',
                        });
                    } else if (block.type === 'text' && block.text) {
                        result.push({ role: 'user', content: block.text });
                    }
                }
                continue;
            }

            // assistant messages with tool_use blocks → OpenAI tool_calls
            if (msg.role === 'assistant' && blocks.some(b => b.type === 'tool_use')) {
                const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
                const toolCalls = blocks
                    .filter(b => b.type === 'tool_use')
                    .map(b => ({
                        id: b.id || 'call_' + Math.random().toString(36).slice(2, 12),
                        type: 'function' as const,
                        function: {
                            name: b.name || '',
                            arguments: JSON.stringify(b.input || {}),
                        },
                    }));
                result.push({
                    role: 'assistant',
                    content: textParts || null,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                });
                continue;
            }

            // Plain text blocks
            const text = blocks.map(b => b.text || '').join('');
            result.push({ role: msg.role, content: text });
            continue;
        }

        // Fallback
        result.push({ role: msg.role, content: String(msg.content) });
    }

    return result;
}

/** Convert Anthropic tool definitions to OpenAI format. */
function convertAnthropicToolsToOpenAI(tools?: Array<{ name: string; description?: string; input_schema?: unknown }>): Array<{ type: string; function: { name: string; description: string; parameters: unknown } }> | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description || '',
            parameters: t.input_schema || { type: 'object', properties: {} },
        },
    }));
}

/** Generate a message ID in Anthropic format. */
function generateMsgId(): string {
    return 'msg_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}

/** Create an Anthropic-style error response. */
function anthropicError(type: string, message: string, status: number) {
    return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Convert an OpenAI response to Anthropic Messages format. */
function convertToAnthropicResponse(
    openaiResult: Record<string, unknown>,
    requestModel: string,
): Record<string, unknown> {
    const choice = ((openaiResult.choices as any[])?.[0]) || {};
    const message = choice.message || {};
    const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];

    // Text content
    if (message.content) {
        content.push({ type: 'text', text: message.content });
    }

    // Tool calls → tool_use blocks
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id || 'toolu_' + Math.random().toString(36).slice(2, 12),
                name: tc.function?.name || '',
                input: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
            });
        }
    }

    // If no content at all, add empty text block
    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }

    // Map OpenAI stop reasons to Anthropic format
    let stopReason: string = 'end_turn';
    if (choice.finish_reason === 'stop') stopReason = 'end_turn';
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    else if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';

    const usage = openaiResult.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    return {
        id: generateMsgId(),
        type: 'message',
        role: 'assistant',
        content,
        model: requestModel,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: usage?.prompt_tokens || 0,
            output_tokens: usage?.completion_tokens || 0,
        },
    };
}

app.post('/v1/messages', async (c) => {
    const body = await c.req.json();

    // Validate required fields
    if (!body.model) {
        return anthropicError('invalid_request_error', 'model is required', 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return anthropicError('invalid_request_error', 'messages array is required', 400);
    }
    if (body.max_tokens === undefined) {
        return anthropicError('invalid_request_error', 'max_tokens is required', 400);
    }

    // Load shedding
    const qStats = getQueueStats();
    if (qStats.active >= MAX_QUEUE_DEPTH) {
        return anthropicError('overloaded_error', 'Cluster is at capacity. Try again shortly.', 529);
    }

    // Resolve Anthropic model → cluster model
    const resolved = resolveAnthropicModel(body.model);
    let resolvedModel = resolved.target;

    let target = findBestNode(resolvedModel);
    let usedFallback = false;

    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback);
            if (target) {
                resolvedModel = fallback;
                usedFallback = true;
                break;
            }
        }
    }

    if (!target) {
        return anthropicError(
            'not_found_error',
            'Model "' + body.model + '" is not available' +
            (body.model !== resolvedModel ? ' (resolved to "' + resolvedModel + '")' : '') +
            '. Deploy it first.',
            404,
        );
    }

    // Convert Anthropic format → OpenAI format for backend
    const openaiMessages = convertAnthropicToOpenAIMessages(body.messages, body.system);
    const openaiTools = convertAnthropicToolsToOpenAI(body.tools);

    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: openaiMessages,
        stream: false,
        max_tokens: body.max_tokens,
    };
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.top_k !== undefined) proxyBody.top_k = body.top_k;
    if (body.stop_sequences) proxyBody.stop = body.stop_sequences;
    if (openaiTools) proxyBody.tools = openaiTools;
    if (body.tool_choice) {
        // Map Anthropic tool_choice to OpenAI format
        if (body.tool_choice.type === 'auto') proxyBody.tool_choice = 'auto';
        else if (body.tool_choice.type === 'any') proxyBody.tool_choice = 'required';
        else if (body.tool_choice.type === 'tool') {
            proxyBody.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
        }
    }

    const backendPort = target.backend_port || 11434;
    const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
    const startTime = Date.now();

    // --- Streaming path ---
    if (body.stream === true) {
        proxyBody.stream = true;

        try {
            const proxyReq = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(proxyBody),
            });

            const latencyMs = Date.now() - startTime;
            recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

            if (!proxyReq.ok || !proxyReq.body) {
                return anthropicError('api_error', 'Backend returned status ' + proxyReq.status, 502);
            }

            const msgId = generateMsgId();

            // Transform the OpenAI SSE stream → Anthropic SSE stream
            const reader = proxyReq.body.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let buffer = '';
            let inputTokens = 0;
            let outputTokens = 0;

            const stream = new ReadableStream({
                async start(controller) {
                    // message_start event
                    const messageStart = {
                        type: 'message_start',
                        message: {
                            id: msgId,
                            type: 'message',
                            role: 'assistant',
                            content: [],
                            model: body.model,
                            stop_reason: null,
                            stop_sequence: null,
                            usage: { input_tokens: 0, output_tokens: 0 },
                        },
                    };
                    controller.enqueue(encoder.encode('event: message_start\ndata: ' + JSON.stringify(messageStart) + '\n\n'));

                    // content_block_start
                    const blockStart = {
                        type: 'content_block_start',
                        index: 0,
                        content_block: { type: 'text', text: '' },
                    };
                    controller.enqueue(encoder.encode('event: content_block_start\ndata: ' + JSON.stringify(blockStart) + '\n\n'));

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (!line.startsWith('data: ')) continue;
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;

                                try {
                                    const chunk = JSON.parse(data);
                                    const delta = chunk.choices?.[0]?.delta;
                                    if (!delta) continue;

                                    if (delta.content) {
                                        const blockDelta = {
                                            type: 'content_block_delta',
                                            index: 0,
                                            delta: { type: 'text_delta', text: delta.content },
                                        };
                                        controller.enqueue(encoder.encode('event: content_block_delta\ndata: ' + JSON.stringify(blockDelta) + '\n\n'));
                                        outputTokens++;
                                    }

                                    // Capture usage from the final chunk if provided
                                    if (chunk.usage) {
                                        inputTokens = chunk.usage.prompt_tokens || inputTokens;
                                        outputTokens = chunk.usage.completion_tokens || outputTokens;
                                    }
                                } catch {
                                    // Skip malformed chunks
                                }
                            }
                        }
                    } catch {
                        // Stream read error — close gracefully
                    }

                    // content_block_stop
                    controller.enqueue(encoder.encode('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n'));

                    // message_delta (final usage + stop reason)
                    const messageDelta = {
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn', stop_sequence: null },
                        usage: { output_tokens: outputTokens },
                    };
                    controller.enqueue(encoder.encode('event: message_delta\ndata: ' + JSON.stringify(messageDelta) + '\n\n'));

                    // message_stop
                    controller.enqueue(encoder.encode('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n'));

                    controller.close();
                },
            });

            return new Response(stream, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-TentaCLAW-Node': target.node_id,
                    'X-TentaCLAW-Hostname': target.hostname,
                },
            });
        } catch (err: any) {
            recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
            logInferenceRequest(target.node_id, resolvedModel, Date.now() - startTime, false, 0, 0, err.message);
            return anthropicError('api_error', 'Failed to proxy to node ' + target.hostname + ': ' + err.message, 502);
        }
    }

    // --- Non-streaming path ---
    try {
        const proxyReq = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyBody),
        });

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

        if (!proxyReq.ok) {
            const errBody = await proxyReq.text();
            return anthropicError('api_error', 'Backend error: ' + errBody, proxyReq.status);
        }

        const openaiResult = await proxyReq.json() as Record<string, unknown>;
        const anthropicResult = convertToAnthropicResponse(openaiResult, body.model);

        // Attach TentaCLAW metadata (non-standard, but useful)
        (anthropicResult as any)._tentaclaw = {
            routed_to: target.node_id,
            hostname: target.hostname,
            gpu_utilization: target.gpu_utilization_avg,
            latency_ms: latencyMs,
            resolved_model: resolvedModel,
            alias_used: body.model !== resolvedModel ? body.model : undefined,
            fallback_used: usedFallback ? resolvedModel : undefined,
            backend: target.backend_type,
        };

        return c.json(anthropicResult);

    } catch (err: any) {
        recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
        logInferenceRequest(target.node_id, resolvedModel, Date.now() - startTime, false, 0, 0, err.message);

        // Auto-retry on a different node
        const retry = findBestNode(resolvedModel);
        if (retry && retry.node_id !== target.node_id) {
            try {
                const retryPort = retry.backend_port || 11434;
                const retryUrl = 'http://' + (retry.ip_address || retry.hostname) + ':' + retryPort + '/v1/chat/completions';
                const retryReq = await fetch(retryUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(proxyBody),
                });
                const retryLatency = Date.now() - startTime;
                recordRouteResult(retry.node_id, resolvedModel, retryLatency, retryReq.ok);

                const retryResult = await retryReq.json() as Record<string, unknown>;
                const anthropicRetry = convertToAnthropicResponse(retryResult, body.model);
                (anthropicRetry as any)._tentaclaw = {
                    routed_to: retry.node_id,
                    hostname: retry.hostname,
                    retried_from: target.node_id,
                    latency_ms: retryLatency,
                };
                return c.json(anthropicRetry);
            } catch {
                // Retry also failed — fall through to error
            }
        }

        return anthropicError('api_error', 'Failed to proxy to node ' + target.hostname + ': ' + err.message, 502);
    }
});

// Embeddings proxy
app.post('/v1/embeddings', async (c) => {
    const body = await c.req.json();
    const model = body.model || 'nomic-embed-text';
    const input = body.input;

    if (!input) return c.json({ error: { message: 'input is required', type: 'invalid_request_error' } }, 400);

    // Resolve alias
    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    // Find node with embedding model
    let target = findBestNode(resolvedModel);
    if (!target && resolved.fallbacks.length > 0) {
        for (const fb of resolved.fallbacks) {
            target = findBestNode(fb);
            if (target) { resolvedModel = fb; break; }
        }
    }
    if (!target) {
        return c.json({ error: { message: 'No node has embedding model "' + model + '" loaded. Available: nomic-embed-text, all-minilm' } }, 503);
    }

    const embedPort = target.backend_port || 11434;
    const embedUrl = 'http://' + (target.ip_address || target.hostname) + ':' + embedPort + '/v1/embeddings';
    const startTime = Date.now();

    // Handle batch input — OpenAI accepts string or string[]
    const inputs = Array.isArray(input) ? input : [input];

    try {
        // Process in batches of 32
        const allEmbeddings: any[] = [];
        for (let i = 0; i < inputs.length; i += 32) {
            const batch = inputs.slice(i, i + 32);
            for (const text of batch) {
                const proxyReq = await fetch(embedUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: resolvedModel, input: text }),
                });
                const result = await proxyReq.json() as any;
                if (result.data?.[0]) {
                    allEmbeddings.push({
                        object: 'embedding',
                        embedding: result.data[0].embedding,
                        index: allEmbeddings.length,
                    });
                }
            }
        }

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, true);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, true, inputs.length, 0);

        return c.json({
            object: 'list',
            data: allEmbeddings,
            model: resolvedModel,
            usage: { prompt_tokens: inputs.reduce((s, t) => s + t.split(' ').length, 0), total_tokens: inputs.reduce((s, t) => s + t.split(' ').length, 0) },
            _tentaclaw: {
                routed_to: target.node_id,
                hostname: target.hostname,
                batch_size: inputs.length,
                latency_ms: latencyMs,
            },
        });
    } catch (err: any) {
        recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
        return c.json({ error: { message: 'Embedding proxy failed: ' + err.message } }, 502);
    }
});

// Comedy engine - original wait-state microcopy with optional local Ollama enhancement
app.get('/api/v1/comedy/wait-line', async (c) => {
    const durationRaw = c.req.query('duration_ms');
    const durationMs = durationRaw ? parseInt(durationRaw, 10) : undefined;
    const allowModelRaw = c.req.query('allow_model');
    const pack = await generateWaitComedy({
        state: c.req.query('state'),
        detail: c.req.query('detail'),
        model: c.req.query('model'),
        audience: c.req.query('audience'),
        duration_ms: Number.isFinite(durationMs as number) ? durationMs : undefined,
        allow_model: allowModelRaw == null ? true : !['0', 'false', 'no'].includes(allowModelRaw.toLowerCase()),
    });
    return c.json(pack);
});
app.post('/api/v1/comedy/wait-line', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const durationValue = typeof body.duration_ms === 'number' ? body.duration_ms : Number(body.duration_ms);
    const pack = await generateWaitComedy({
        state: typeof body.state === 'string' ? body.state : undefined,
        detail: typeof body.detail === 'string' ? body.detail : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        audience: typeof body.audience === 'string' ? body.audience : undefined,
        duration_ms: Number.isFinite(durationValue) ? durationValue : undefined,
        allow_model: typeof body.allow_model === 'boolean' ? body.allow_model : true,
    });
    return c.json(pack);
});

// =============================================================================
// Node Logs (agent sends log lines in stats, gateway stores last N)
// =============================================================================

const nodeLogBuffers = new Map<string, { lines: string[]; maxLines: number }>();

app.get('/api/v1/nodes/:nodeId/logs', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '100');
    const buffer = nodeLogBuffers.get(nodeId);
    if (!buffer) return c.json({ logs: [] });
    return c.json({ logs: buffer.lines.slice(-limit) });
});

app.post('/api/v1/nodes/:nodeId/logs', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();
    const lines = Array.isArray(body.lines) ? body.lines : [String(body.message || '')];

    let buffer = nodeLogBuffers.get(nodeId);
    if (!buffer) {
        buffer = { lines: [], maxLines: 500 };
        nodeLogBuffers.set(nodeId, buffer);
    }

    buffer.lines.push(...lines);
    if (buffer.lines.length > buffer.maxLines) {
        buffer.lines = buffer.lines.slice(-buffer.maxLines);
    }

    return c.json({ status: 'ok', stored: lines.length });
});

// =============================================================================
// Cluster Export / Import (backup & restore)
// =============================================================================

app.get('/api/v1/export', (c) => {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes').all();
    const flightSheets = d.prepare('SELECT * FROM flight_sheets').all();
    const schedules = d.prepare('SELECT * FROM schedules').all();

    return c.json({
        version: '0.1.0',
        exported_at: new Date().toISOString(),
        nodes,
        flight_sheets: (flightSheets as any[]).map(fs => ({ ...fs, targets: JSON.parse(fs.targets) })),
        schedules: (schedules as any[]).map(s => ({ ...s, config: JSON.parse(s.config) })),
    });
});

app.post('/api/v1/import', async (c) => {
    const body = await c.req.json();
    let imported = { nodes: 0, flight_sheets: 0, schedules: 0 };

    if (body.flight_sheets) {
        for (const fs of body.flight_sheets) {
            createFlightSheet(fs.name, fs.description || '', fs.targets || []);
            imported.flight_sheets++;
        }
    }

    if (body.schedules) {
        for (const s of body.schedules) {
            createSchedule(s.name, s.type, s.cron, s.config || {});
            imported.schedules++;
        }
    }

    console.log('[tentaclaw] Import: ' + imported.flight_sheets + ' flight sheets, ' + imported.schedules + ' schedules');
    return c.json({ status: 'imported', imported });
});

// NOTE: Legacy /metrics endpoint removed — comprehensive version is in Wave 26 section below.

// =============================================================================
// Cluster Topology
// =============================================================================

app.get('/api/v1/topology', (c) => {
    const nodes = getAllNodes();
    const farmMap = new Map<string, typeof nodes>();

    for (const node of nodes) {
        const list = farmMap.get(node.farm_hash) || [];
        list.push(node);
        farmMap.set(node.farm_hash, list);
    }

    const farms = [...farmMap.entries()].map(([hash, farmNodes], fi) => ({
        id: hash,
        label: 'Farm ' + hash,
        nodes: farmNodes.map((n, ni) => ({
            id: n.id,
            label: n.hostname,
            status: n.status,
            gpu_count: n.gpu_count,
            gpus: n.latest_stats?.gpus.map(g => g.name) || [],
            toks_per_sec: n.latest_stats?.toks_per_sec || 0,
            models: n.latest_stats?.inference.loaded_models || [],
            position: { x: fi * 300 + ni * 150, y: fi * 200 },
        })),
    }));

    return c.json({
        gateway: { id: 'gateway', label: 'TentaCLAW Gateway', position: { x: 400, y: 0 } },
        farms,
        connections: nodes.map(n => ({ from: 'gateway', to: n.id, status: n.status })),
    });
});

// =============================================================================
// Gateway Config
// =============================================================================

app.get('/api/v1/config', (c) => {
    return c.json({
        version: '0.1.0',
        service: 'tentaclaw-gateway',
        features: {
            auth_enabled: !NO_AUTH,
            rate_limiting: RATE_LIMIT_UNAUTH > 0,
            rate_limit_unauth_rpm: RATE_LIMIT_UNAUTH || null,
            rate_limit_auth_rpm: RATE_LIMIT_AUTH || null,
            openai_compat: true,
            prometheus_metrics: true,
            sse_streaming: true,
        },
        connections: {
            sse_clients: sseClients.length,
        },
        environment: {
            port: PORT,
            host: HOST,
        },
    });
});

// =============================================================================
// Power Monitoring & Cost Estimation
// =============================================================================

const POWER_COST_KWH = parseFloat(process.env.TENTACLAW_POWER_COST || '0.12');

app.get('/api/v1/power', (c) => {
    const nodes = getAllNodes();
    let totalWatts = 0;
    let gpuWatts = 0;
    const perNode: { node_id: string; hostname: string; gpu_watts: number; gpu_count: number }[] = [];

    for (const node of nodes) {
        if (!node.latest_stats || node.status !== 'online') continue;
        let nodeGpuWatts = 0;
        for (const gpu of node.latest_stats.gpus) {
            nodeGpuWatts += gpu.powerDrawW;
        }
        gpuWatts += nodeGpuWatts;
        // Estimate system power: ~100W base + GPU power
        const systemWatts = 100 + nodeGpuWatts;
        totalWatts += systemWatts;
        perNode.push({
            node_id: node.id,
            hostname: node.hostname,
            gpu_watts: Math.round(nodeGpuWatts),
            gpu_count: node.latest_stats.gpus.length,
        });
    }

    const totalKw = totalWatts / 1000;
    const dailyCost = totalKw * 24 * POWER_COST_KWH;
    const monthlyCost = dailyCost * 30;
    const summary = getClusterSummary();
    const tokensPerDollar = monthlyCost > 0 && summary.total_toks_per_sec > 0
        ? Math.round((summary.total_toks_per_sec * 86400 * 30) / monthlyCost)
        : 0;

    return c.json({
        total_watts: Math.round(totalWatts),
        gpu_watts: Math.round(gpuWatts),
        system_overhead_watts: Math.round(totalWatts - gpuWatts),
        cost_per_kwh: POWER_COST_KWH,
        daily_cost_usd: Math.round(dailyCost * 100) / 100,
        monthly_cost_usd: Math.round(monthlyCost * 100) / 100,
        tokens_per_dollar: tokensPerDollar,
        per_node: perNode,
    });
});

// =============================================================================
// Model Leaderboard
// =============================================================================

app.get('/api/v1/leaderboard', (c) => {
    const nodes = getAllNodes();
    const modelStats = new Map<string, { total_toks: number; node_count: number; best_toks: number; best_node: string; nodes: string[] }>();

    for (const node of nodes) {
        if (!node.latest_stats || node.status !== 'online') continue;
        const nodeToks = node.latest_stats.toks_per_sec;

        for (const model of node.latest_stats.inference.loaded_models) {
            const existing = modelStats.get(model) || { total_toks: 0, node_count: 0, best_toks: 0, best_node: '', nodes: [] };
            existing.total_toks += nodeToks;
            existing.node_count++;
            existing.nodes.push(node.hostname);
            if (nodeToks > existing.best_toks) {
                existing.best_toks = nodeToks;
                existing.best_node = node.hostname;
            }
            modelStats.set(model, existing);
        }
    }

    const leaderboard = [...modelStats.entries()]
        .map(([model, stats]) => ({
            model,
            total_toks_per_sec: stats.total_toks,
            avg_toks_per_sec: Math.round(stats.total_toks / stats.node_count),
            node_count: stats.node_count,
            best_node: stats.best_node,
            best_toks_per_sec: stats.best_toks,
            nodes: stats.nodes,
        }))
        .sort((a, b) => b.total_toks_per_sec - a.total_toks_per_sec);

    return c.json({ leaderboard });
});

// =============================================================================
// Discovery (for agents to find the gateway)
// =============================================================================

app.get('/api/v1/discover', (c) => {
    return c.json({
        service: 'tentaclaw-gateway',
        version: '0.1.0',
        api: '/api/v1',
        register: '/api/v1/register',
        stats: '/api/v1/nodes/{nodeId}/stats',
        openai: '/v1/chat/completions',
        anthropic: '/v1/messages',
        dashboard: '/dashboard',
        health: '/health',
    });
});

// =============================================================================
// Schedules (cron-like automation)
// =============================================================================

app.get('/api/v1/schedules', (c) => {
    const schedules = getAllSchedules();
    return c.json({ schedules });
});

app.post('/api/v1/schedules', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.type || !body.cron) {
        return c.json({ error: 'Missing required fields: name, type, cron' }, 400);
    }

    const schedule = createSchedule(body.name, body.type, body.cron, body.config || {});
    console.log('[tentaclaw] Schedule created: ' + schedule.name + ' (' + schedule.cron + ')');
    return c.json({ status: 'created', schedule });
});

app.get('/api/v1/schedules/:id', (c) => {
    const schedule = getSchedule(c.req.param('id'));
    if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ schedule });
});

app.delete('/api/v1/schedules/:id', (c) => {
    if (!deleteSchedule(c.req.param('id'))) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ status: 'deleted' });
});

app.post('/api/v1/schedules/:id/toggle', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const enabled = body.enabled !== undefined ? !!body.enabled : true;
    if (!toggleSchedule(c.req.param('id'), enabled)) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ status: enabled ? 'enabled' : 'disabled' });
});

// =============================================================================
// SSH Key Management
// =============================================================================

app.get('/api/v1/nodes/:id/ssh-keys', (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    return c.json(getNodeSshKeys(c.req.param('id')));
});

app.post('/api/v1/nodes/:id/ssh-keys', async (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ label: string; public_key: string }>();
    if (!body.label || !body.public_key) return c.json({ error: 'label and public_key required' }, 400);
    if (!body.public_key.startsWith('ssh-')) return c.json({ error: 'Invalid SSH public key format' }, 400);

    const key = addSshKey(c.req.param('id'), body.label, body.public_key);
    // Queue command to deploy key to node
    queueCommand(c.req.param('id'), 'install_model', { ssh_key: body.public_key, ssh_label: body.label });
    broadcastSSE('ssh_key_added', { node_id: c.req.param('id'), key });
    return c.json(key, 201);
});

app.delete('/api/v1/ssh-keys/:keyId', (c) => {
    if (!deleteSshKey(c.req.param('keyId'))) return c.json({ error: 'Key not found' }, 404);
    return c.json({ status: 'deleted' });
});

// =============================================================================
// Node Tags
// =============================================================================

app.get('/api/v1/tags', (c) => {
    return c.json(getAllTags());
});

app.get('/api/v1/tags/:tag/nodes', (c) => {
    return c.json(getNodesByTag(c.req.param('tag')));
});

app.get('/api/v1/nodes/:id/tags', (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    return c.json(getNodeTags(c.req.param('id')));
});

app.post('/api/v1/nodes/:id/tags', async (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ tags: string[] }>();
    if (!body.tags || !Array.isArray(body.tags)) return c.json({ error: 'tags array required' }, 400);

    // Filter to only valid non-empty strings
    const validTags = body.tags.filter(t => typeof t === 'string' && t.trim().length > 0);
    if (validTags.length === 0) return c.json({ error: 'tags must contain at least one non-empty string' }, 400);

    for (const tag of validTags) {
        addNodeTag(c.req.param('id'), tag);
    }
    return c.json(getNodeTags(c.req.param('id')));
});

app.delete('/api/v1/nodes/:id/tags/:tag', (c) => {
    if (!removeNodeTag(c.req.param('id'), c.req.param('tag'))) {
        return c.json({ error: 'Tag not found on node' }, 404);
    }
    return c.json({ status: 'removed' });
});

// =============================================================================
// Model Pull Progress
// =============================================================================

app.get('/api/v1/nodes/:id/pulls', (c) => {
    return c.json(getActiveModelPulls(c.req.param('id')));
});

app.get('/api/v1/pulls', (c) => {
    return c.json(getAllActiveModelPulls());
});

app.post('/api/v1/nodes/:id/pulls', async (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ model: string }>();
    if (!body.model) return c.json({ error: 'model required' }, 400);

    const pull = startModelPull(nodeId, body.model);
    queueCommand(nodeId, 'install_model', { model: body.model });
    broadcastSSE('model_pull_started', { node_id: nodeId, model: body.model });
    return c.json(pull, 201);
});

app.put('/api/v1/nodes/:id/pulls/:model', async (c) => {
    const body = await c.req.json<{
        status?: string;
        progress_pct?: number;
        bytes_downloaded?: number;
        bytes_total?: number;
    }>();

    updateModelPull(c.req.param('id'), c.req.param('model'), body);

    if (body.progress_pct !== undefined) {
        broadcastSSE('model_pull_progress', {
            node_id: c.req.param('id'),
            model: c.req.param('model'),
            progress_pct: body.progress_pct,
            status: body.status,
        });
    }

    return c.json({ status: 'updated' });
});

// =============================================================================
// Model Search (Ollama Library + Cluster VRAM Check)
// =============================================================================

// Common Ollama models with approximate VRAM requirements
const OLLAMA_MODEL_CATALOG = [
    { name: 'llama3.1:8b', params: '8B', vram_mb: 5120, tags: ['general', 'chat'] },
    { name: 'llama3.1:70b', params: '70B', vram_mb: 40960, tags: ['general', 'chat', 'large'] },
    { name: 'llama3.2:3b', params: '3B', vram_mb: 2048, tags: ['general', 'chat', 'small'] },
    { name: 'llama3.2:1b', params: '1B', vram_mb: 1024, tags: ['general', 'chat', 'tiny'] },
    { name: 'codellama:7b', params: '7B', vram_mb: 4608, tags: ['code'] },
    { name: 'codellama:34b', params: '34B', vram_mb: 20480, tags: ['code', 'large'] },
    { name: 'mistral:7b', params: '7B', vram_mb: 4608, tags: ['general', 'chat'] },
    { name: 'mixtral:8x7b', params: '46.7B', vram_mb: 28672, tags: ['general', 'moe'] },
    { name: 'deepseek-coder:6.7b', params: '6.7B', vram_mb: 4096, tags: ['code'] },
    { name: 'deepseek-coder:33b', params: '33B', vram_mb: 20480, tags: ['code', 'large'] },
    { name: 'phi3:3.8b', params: '3.8B', vram_mb: 2560, tags: ['general', 'small'] },
    { name: 'qwen2:7b', params: '7B', vram_mb: 4608, tags: ['general', 'multilingual'] },
    { name: 'qwen2:72b', params: '72B', vram_mb: 43008, tags: ['general', 'multilingual', 'large'] },
    { name: 'gemma2:9b', params: '9B', vram_mb: 5632, tags: ['general'] },
    { name: 'gemma2:27b', params: '27B', vram_mb: 16384, tags: ['general', 'large'] },
    { name: 'nomic-embed-text', params: '137M', vram_mb: 512, tags: ['embedding'] },
    { name: 'all-minilm:33m', params: '33M', vram_mb: 256, tags: ['embedding', 'tiny'] },
    { name: 'hermes3:8b', params: '8B', vram_mb: 5120, tags: ['chat', 'function-calling'] },
    { name: 'starcoder2:7b', params: '7B', vram_mb: 4608, tags: ['code'] },
    { name: 'yi:34b', params: '34B', vram_mb: 20480, tags: ['general', 'multilingual'] },
];

app.get('/api/v1/model-search', (c) => {
    const query = (c.req.query('q') || '').toLowerCase();
    const tag = c.req.query('tag') || '';

    let results = OLLAMA_MODEL_CATALOG;

    if (query) {
        results = results.filter(m => m.name.includes(query) || m.tags.some(t => t.includes(query)));
    }
    if (tag) {
        results = results.filter(m => m.tags.includes(tag));
    }

    // Check cluster VRAM capacity and currently loaded models
    const summary = getClusterSummary();
    const maxGpuVram = summary.total_vram_mb > 0 ? summary.total_vram_mb : 0;
    const loadedModels = new Set(summary.loaded_models);

    return c.json({
        models: results.map(m => ({
            ...m,
            fits_cluster: m.vram_mb <= maxGpuVram,
            loaded: loadedModels.has(m.name) || [...loadedModels].some(lm => lm.startsWith(m.name.split(':')[0])),
        })),
        cluster_vram_mb: maxGpuVram,
        tags: [...new Set(OLLAMA_MODEL_CATALOG.flatMap(m => m.tags))].sort(),
    });
});

// =============================================================================
// Daphney Bridge (SSE for DaphneyBrain UE5)
// =============================================================================

const daphneyClients: SSEClient[] = [];

app.get('/api/v1/daphney/stream', (_c) => {
    const stream = new ReadableStream({
        start(controller) {
            const client: SSEClient = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                controller,
            };
            daphneyClients.push(client);

            // Send initial topology snapshot
            const summary = getClusterSummary();
            const allNodes = getAllNodes();
            const payload = `event: cluster_topology\ndata: ${JSON.stringify({
                type: 'cluster_topology',
                timestamp: new Date().toISOString(),
                topology: {
                    total_nodes: summary.total_nodes,
                    online_nodes: summary.online_nodes,
                    total_gpus: summary.total_gpus,
                    nodes: allNodes.map(n => ({
                        id: n.id,
                        hostname: n.hostname,
                        status: n.status,
                        gpu_count: n.gpu_count,
                        farm_hash: n.farm_hash,
                    })),
                },
            })}\n\n`;
            controller.enqueue(new TextEncoder().encode(payload));
        },
        cancel() {
            // Remove disconnected daphney client
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
});

function broadcastDaphney(eventType: string, data: unknown): void {
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
// Daphney Character Registry & Enhanced UE5 Integration
// =============================================================================

interface DaphneyCharacter {
    name: string;
    model: string;       // preferred model for this character
    personality: string;  // system prompt
    voice: string;        // voice ID for TTS
    emotions: string[];   // supported emotions
}

const daphneyCharacters = new Map<string, DaphneyCharacter>();

// Supported event types that UE5 can send back to TentaCLAW
const DAPHNEY_SUPPORTED_EVENTS = [
    'character_loaded',
    'animation_complete',
    'player_interaction',
    'scene_change',
    'emotion_change',
    'voice_complete',
    'error',
] as const;

// --- POST /api/v1/daphney/event — UE5 sends events back to TentaCLAW ---
app.post('/api/v1/daphney/event', async (c) => {
    const body = await c.req.json<{ type: string; character_id?: string; data: unknown }>().catch(() => null);
    if (!body || !body.type) {
        return c.json({ error: 'Missing required field: type' }, 400);
    }
    if (!body.data) {
        return c.json({ error: 'Missing required field: data' }, 400);
    }

    const event = {
        type: body.type,
        character_id: body.character_id ?? null,
        data: body.data,
        received_at: new Date().toISOString(),
    };

    log('info', `Daphney UE5 event received: ${body.type}`, {
        character_id: body.character_id,
    });

    // Relay the event to all SSE dashboard clients and Daphney SSE listeners
    broadcastSSE('daphney_event', event);
    broadcastDaphney('ue5_event', event);

    return c.json({ ok: true, event });
});

// --- GET /api/v1/daphney/config — Return Daphney integration config ---
app.get('/api/v1/daphney/config', (c) => {
    const summary = getClusterSummary();
    const allNodes = getAllNodes();

    const characters: Record<string, DaphneyCharacter> = {};
    for (const [id, char] of daphneyCharacters) {
        characters[id] = char;
    }

    return c.json({
        stream_url: `/api/v1/daphney/stream`,
        event_url: `/api/v1/daphney/event`,
        chat_url: `/api/v1/daphney/chat`,
        characters_url: `/api/v1/daphney/characters`,
        supported_events: DAPHNEY_SUPPORTED_EVENTS,
        characters,
        cluster_info: {
            total_nodes: summary.total_nodes,
            online_nodes: summary.online_nodes,
            total_gpus: summary.total_gpus,
            nodes: allNodes.map(n => ({
                id: n.id,
                hostname: n.hostname,
                status: n.status,
                gpu_count: n.gpu_count,
            })),
        },
    });
});

// --- POST /api/v1/daphney/chat — Chat endpoint optimized for game characters ---
app.post('/api/v1/daphney/chat', async (c) => {
    const body = await c.req.json<{
        character_id: string;
        message: string;
        context?: { location?: string; emotion?: string; time_of_day?: string };
    }>().catch(() => null);

    if (!body || !body.character_id || !body.message) {
        return c.json({ error: 'Missing required fields: character_id, message' }, 400);
    }

    const character = daphneyCharacters.get(body.character_id);
    if (!character) {
        return c.json({ error: `Character not found: ${body.character_id}` }, 404);
    }

    // Build system prompt with character personality and optional context
    let systemPrompt = character.personality;
    if (body.context) {
        const ctxParts: string[] = [];
        if (body.context.location) ctxParts.push(`Current location: ${body.context.location}`);
        if (body.context.emotion) ctxParts.push(`Current emotion: ${body.context.emotion}`);
        if (body.context.time_of_day) ctxParts.push(`Time of day: ${body.context.time_of_day}`);
        if (ctxParts.length > 0) {
            systemPrompt += `\n\n[Scene Context]\n${ctxParts.join('\n')}`;
        }
    }

    // Route to the character's preferred model via the best available node
    const preferredModel = character.model;
    const targetNode = findBestNode(preferredModel);

    if (!targetNode) {
        return c.json({ error: 'No inference nodes available for model: ' + preferredModel }, 503);
    }

    // Determine the inference endpoint URL for this node
    const nodeIp = targetNode.ip_address || 'localhost';
    const backendPort = targetNode.backend_port || 11434;
    const inferenceUrl = `http://${nodeIp}:${backendPort}/api/chat`;

    try {
        const startTime = Date.now();
        const response = await fetch(inferenceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: preferredModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: body.message },
                ],
                stream: false,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `Inference backend error: ${errText}` }, 502);
        }

        const result = await response.json() as { message?: { content?: string } };
        const latencyMs = Date.now() - startTime;
        const responseText = result.message?.content ?? '';

        // Determine emotion and animation hint from response
        const detectedEmotion = detectEmotion(responseText, character.emotions);
        const animationHint = emotionToAnimation(detectedEmotion);

        recordRouteResult(targetNode.node_id, preferredModel, latencyMs, true);

        broadcastDaphney('chat_response', {
            character_id: body.character_id,
            emotion: detectedEmotion,
            timestamp: new Date().toISOString(),
        });

        return c.json({
            response: responseText,
            emotion: detectedEmotion,
            animation_hint: animationHint,
            voice_config: {
                voice_id: character.voice,
                emotion: detectedEmotion,
            },
            model_used: preferredModel,
            node_id: targetNode.node_id,
            latency_ms: latencyMs,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: `Failed to reach inference backend: ${message}` }, 502);
    }
});

/** Simple emotion detection from response text based on character's supported emotions */
function detectEmotion(text: string, supportedEmotions: string[]): string {
    const lower = text.toLowerCase();
    const emotionKeywords: Record<string, string[]> = {
        happy: ['happy', 'glad', 'joy', 'excited', 'wonderful', 'great', 'smile', 'laugh'],
        sad: ['sad', 'sorry', 'unfortunately', 'grief', 'miss', 'cry', 'tears'],
        angry: ['angry', 'furious', 'rage', 'hate', 'mad', 'annoyed'],
        surprised: ['surprised', 'wow', 'amazing', 'unexpected', 'shocked', 'astonished'],
        fearful: ['afraid', 'scared', 'fear', 'worried', 'anxious', 'nervous'],
        neutral: [],
        thinking: ['hmm', 'perhaps', 'consider', 'maybe', 'wonder', 'think'],
        playful: ['haha', 'hehe', 'tease', 'joke', 'funny', 'silly'],
    };

    for (const emotion of supportedEmotions) {
        const keywords = emotionKeywords[emotion];
        if (keywords && keywords.some(kw => lower.includes(kw))) {
            return emotion;
        }
    }

    return supportedEmotions.includes('neutral') ? 'neutral' : supportedEmotions[0] || 'neutral';
}

/** Map emotion to a UE5 animation hint */
function emotionToAnimation(emotion: string): string {
    const animationMap: Record<string, string> = {
        happy: 'anim_smile_nod',
        sad: 'anim_look_down',
        angry: 'anim_cross_arms',
        surprised: 'anim_wide_eyes',
        fearful: 'anim_step_back',
        neutral: 'anim_idle',
        thinking: 'anim_hand_chin',
        playful: 'anim_bounce',
    };
    return animationMap[emotion] || 'anim_idle';
}

// --- POST /api/v1/daphney/characters — Register a character ---
app.post('/api/v1/daphney/characters', async (c) => {
    const body = await c.req.json<{
        id: string;
        name: string;
        model: string;
        personality: string;
        voice: string;
        emotions: string[];
    }>().catch(() => null);

    if (!body || !body.id || !body.name || !body.model || !body.personality || !body.voice || !body.emotions) {
        return c.json({ error: 'Missing required fields: id, name, model, personality, voice, emotions' }, 400);
    }

    if (body.emotions.length === 0) {
        return c.json({ error: 'emotions array must contain at least one emotion' }, 400);
    }

    const character: DaphneyCharacter = {
        name: body.name,
        model: body.model,
        personality: body.personality,
        voice: body.voice,
        emotions: body.emotions,
    };

    const isUpdate = daphneyCharacters.has(body.id);
    daphneyCharacters.set(body.id, character);

    log('info', `Daphney character ${isUpdate ? 'updated' : 'registered'}: ${body.name} (${body.id})`);

    broadcastDaphney('character_registered', {
        character_id: body.id,
        name: body.name,
        model: body.model,
        timestamp: new Date().toISOString(),
    });

    return c.json({
        ok: true,
        action: isUpdate ? 'updated' : 'created',
        character_id: body.id,
        character,
    }, isUpdate ? 200 : 201);
});

// --- GET /api/v1/daphney/characters — List all registered characters ---
app.get('/api/v1/daphney/characters', (c) => {
    const characters: Record<string, DaphneyCharacter & { id: string }> = {};
    for (const [id, char] of daphneyCharacters) {
        characters[id] = { id, ...char };
    }
    return c.json({
        characters,
        total: daphneyCharacters.size,
    });
});

// --- DELETE /api/v1/daphney/characters/:id — Remove a character ---
app.delete('/api/v1/daphney/characters/:id', (c) => {
    const id = c.req.param('id');
    if (!daphneyCharacters.has(id)) {
        return c.json({ error: `Character not found: ${id}` }, 404);
    }

    const character = daphneyCharacters.get(id)!;
    daphneyCharacters.delete(id);

    log('info', `Daphney character removed: ${character.name} (${id})`);

    broadcastDaphney('character_removed', {
        character_id: id,
        name: character.name,
        timestamp: new Date().toISOString(),
    });

    return c.json({ ok: true, character_id: id, name: character.name });
});

// =============================================================================
// Doctor Mode — Self-Healing Diagnostics & Auto-Fix
// =============================================================================

interface DiagnosticResult {
    check: string;
    status: 'ok' | 'warning' | 'critical' | 'fixed';
    message: string;
    auto_fixed?: boolean;
    detail?: unknown;
}

app.get('/api/v1/doctor', async (c) => {
    const autofix = c.req.query('autofix') !== 'false'; // autofix by default
    const results: DiagnosticResult[] = [];
    const d = getDb();

    // 1. Check for stale nodes and auto-recover
    const allNodes = getAllNodes();
    const staleThreshold = 90; // seconds
    const now = Date.now();
    let staleFixed = 0;
    for (const node of allNodes) {
        if (node.status === 'online' && node.last_seen_at) {
            const lastSeen = new Date(node.last_seen_at + 'Z').getTime();
            const ageSecs = (now - lastSeen) / 1000;
            if (ageSecs > staleThreshold) {
                if (autofix) {
                    markStaleNodes(staleThreshold);
                    staleFixed++;
                }
            }
        }
    }
    if (staleFixed > 0) {
        results.push({ check: 'stale_nodes', status: 'fixed', message: `Marked ${staleFixed} stale node(s) offline`, auto_fixed: true });
    } else {
        const staleCount = allNodes.filter(n => {
            if (n.status !== 'online' || !n.last_seen_at) return false;
            return (now - new Date(n.last_seen_at + 'Z').getTime()) / 1000 > staleThreshold;
        }).length;
        results.push({
            check: 'stale_nodes',
            status: staleCount > 0 ? 'warning' : 'ok',
            message: staleCount > 0 ? `${staleCount} node(s) appear stale` : 'All online nodes are reporting',
        });
    }

    // 2. Check for orphaned stats (stats for deleted nodes)
    const orphanedStats = (d.prepare(`
        SELECT COUNT(*) as cnt FROM stats WHERE node_id NOT IN (SELECT id FROM nodes)
    `).get() as { cnt: number }).cnt;
    if (orphanedStats > 0 && autofix) {
        d.prepare('DELETE FROM stats WHERE node_id NOT IN (SELECT id FROM nodes)').run();
        results.push({ check: 'orphaned_stats', status: 'fixed', message: `Cleaned ${orphanedStats} orphaned stat rows`, auto_fixed: true });
    } else {
        results.push({
            check: 'orphaned_stats',
            status: orphanedStats > 0 ? 'warning' : 'ok',
            message: orphanedStats > 0 ? `${orphanedStats} orphaned stat rows found` : 'No orphaned data',
        });
    }

    // 3. Check for orphaned commands
    const orphanedCmds = (d.prepare(`
        SELECT COUNT(*) as cnt FROM commands WHERE node_id NOT IN (SELECT id FROM nodes)
    `).get() as { cnt: number }).cnt;
    if (orphanedCmds > 0 && autofix) {
        d.prepare('DELETE FROM commands WHERE node_id NOT IN (SELECT id FROM nodes)').run();
        results.push({ check: 'orphaned_commands', status: 'fixed', message: `Cleaned ${orphanedCmds} orphaned commands`, auto_fixed: true });
    } else {
        results.push({
            check: 'orphaned_commands',
            status: orphanedCmds > 0 ? 'warning' : 'ok',
            message: orphanedCmds > 0 ? `${orphanedCmds} orphaned commands` : 'No orphaned commands',
        });
    }

    // 4. Check for stuck commands (pending > 5 min)
    const stuckCmds = d.prepare(`
        SELECT COUNT(*) as cnt FROM commands
        WHERE status = 'pending' AND created_at < datetime('now', '-5 minutes')
    `).get() as { cnt: number };
    if (stuckCmds.cnt > 0 && autofix) {
        d.prepare(`
            UPDATE commands SET status = 'failed'
            WHERE status = 'pending' AND created_at < datetime('now', '-5 minutes')
        `).run();
        results.push({ check: 'stuck_commands', status: 'fixed', message: `Failed ${stuckCmds.cnt} stuck command(s)`, auto_fixed: true });
    } else {
        results.push({
            check: 'stuck_commands',
            status: stuckCmds.cnt > 0 ? 'warning' : 'ok',
            message: stuckCmds.cnt > 0 ? `${stuckCmds.cnt} stuck commands` : 'No stuck commands',
        });
    }

    // 5. Check for stale model pulls
    const stalePulls = d.prepare(`
        SELECT COUNT(*) as cnt FROM model_pulls
        WHERE status = 'downloading' AND updated_at < datetime('now', '-10 minutes')
    `).get() as { cnt: number };
    if (stalePulls.cnt > 0 && autofix) {
        d.prepare(`
            UPDATE model_pulls SET status = 'error'
            WHERE status = 'downloading' AND updated_at < datetime('now', '-10 minutes')
        `).run();
        results.push({ check: 'stale_pulls', status: 'fixed', message: `Marked ${stalePulls.cnt} stale pull(s) as error`, auto_fixed: true });
    } else {
        results.push({
            check: 'stale_pulls',
            status: stalePulls.cnt > 0 ? 'warning' : 'ok',
            message: stalePulls.cnt > 0 ? `${stalePulls.cnt} stale model pulls` : 'No stale pulls',
        });
    }

    // 6. Check unacknowledged critical alerts
    const unackedCritical = (d.prepare(`
        SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'critical' AND acknowledged = 0
    `).get() as { cnt: number }).cnt;
    results.push({
        check: 'unacked_critical_alerts',
        status: unackedCritical > 0 ? 'critical' : 'ok',
        message: unackedCritical > 0
            ? `${unackedCritical} unacknowledged critical alert(s) — needs human attention`
            : 'No unacknowledged critical alerts',
    });

    // 7. Check stats table bloat (auto-prune if > 100k rows)
    const statsCount = (d.prepare('SELECT COUNT(*) as cnt FROM stats').get() as { cnt: number }).cnt;
    if (statsCount > 100000 && autofix) {
        pruneStats(48); // keep 48 hours
        const after = (d.prepare('SELECT COUNT(*) as cnt FROM stats').get() as { cnt: number }).cnt;
        results.push({ check: 'stats_bloat', status: 'fixed', message: `Pruned stats from ${statsCount} to ${after} rows`, auto_fixed: true });
    } else {
        results.push({
            check: 'stats_bloat',
            status: statsCount > 50000 ? 'warning' : 'ok',
            message: `Stats table: ${statsCount} rows`,
        });
    }

    // 8. Check DB integrity
    const integrity = d.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
    results.push({
        check: 'db_integrity',
        status: integrityOk ? 'ok' : 'critical',
        message: integrityOk ? 'Database integrity OK' : 'Database integrity check FAILED',
        detail: integrityOk ? undefined : integrity,
    });

    // 9. Check WAL size
    const walMode = d.pragma('journal_mode') as Array<{ journal_mode: string }>;
    results.push({
        check: 'wal_mode',
        status: walMode[0]?.journal_mode === 'wal' ? 'ok' : 'warning',
        message: `Journal mode: ${walMode[0]?.journal_mode || 'unknown'}`,
    });

    // 10. Check node model coverage (any node with 0 loaded models?)
    const nodesNoModels = allNodes.filter(n =>
        n.status === 'online' && n.latest_stats && n.latest_stats.inference.loaded_models.length === 0
    );
    if (nodesNoModels.length > 0 && autofix) {
        // Auto-deploy the most common model to empty nodes
        const models = getClusterModels();
        if (models.length > 0) {
            const bestModel = models[0].model;
            for (const node of nodesNoModels) {
                queueCommand(node.id, 'install_model', { model: bestModel });
            }
            results.push({
                check: 'empty_nodes',
                status: 'fixed',
                message: `Queued ${bestModel} deploy to ${nodesNoModels.length} empty node(s)`,
                auto_fixed: true,
            });
        }
    } else {
        results.push({
            check: 'empty_nodes',
            status: nodesNoModels.length > 0 ? 'warning' : 'ok',
            message: nodesNoModels.length > 0
                ? `${nodesNoModels.length} online node(s) have no models loaded`
                : 'All online nodes have models loaded',
        });
    }

    // 11. Check for GPU thermal throttling risk
    const hotGpus: Array<{ node: string; gpu: string; temp: number }> = [];
    for (const node of allNodes) {
        if (node.latest_stats) {
            for (const gpu of node.latest_stats.gpus) {
                if (gpu.temperatureC >= 80) {
                    hotGpus.push({ node: node.id, gpu: gpu.name, temp: gpu.temperatureC });
                }
            }
        }
    }
    if (hotGpus.length > 0 && autofix) {
        // Auto-apply conservative overclock profile to hot nodes
        const hotNodeIds = [...new Set(hotGpus.map(g => g.node))];
        for (const nodeId of hotNodeIds) {
            queueCommand(nodeId, 'overclock', { profile: 'stock' });
        }
        results.push({
            check: 'gpu_thermal',
            status: 'fixed',
            message: `Applied stock overclock to ${hotNodeIds.length} node(s) with hot GPUs`,
            auto_fixed: true,
            detail: hotGpus,
        });
    } else {
        results.push({
            check: 'gpu_thermal',
            status: hotGpus.length > 0 ? 'warning' : 'ok',
            message: hotGpus.length > 0
                ? `${hotGpus.length} GPU(s) running hot (≥80°C)`
                : 'All GPUs within safe temperature range',
            detail: hotGpus.length > 0 ? hotGpus : undefined,
        });
    }

    // Summary
    const fixedCount = results.filter(r => r.status === 'fixed').length;
    const criticalCount = results.filter(r => r.status === 'critical').length;
    const warningCount = results.filter(r => r.status === 'warning').length;
    const okCount = results.filter(r => r.status === 'ok').length;

    const overallStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';

    broadcastSSE('doctor_ran', {
        timestamp: new Date().toISOString(),
        status: overallStatus,
        fixed: fixedCount,
        checks: results.length,
    });

    return c.json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        autofix_enabled: autofix,
        summary: {
            total_checks: results.length,
            ok: okCount,
            warnings: warningCount,
            critical: criticalCount,
            auto_fixed: fixedCount,
        },
        results,
    });
});

// =============================================================================
// Uptime & Reliability API (Phase 21-30)
// =============================================================================

// =============================================================================
// Inference Engine Info (Wave 2)
// =============================================================================

// =============================================================================
// Model Management API (Wave 4)
// =============================================================================

app.get('/api/v1/models/distribution', (c) => {
    return c.json(getModelDistribution());
});

app.get('/api/v1/models/check-fit', (c) => {
    const model = c.req.query('model');
    const nodeId = c.req.query('node');
    if (!model) return c.json({ error: 'model query param required' }, 400);

    if (nodeId) {
        return c.json(checkModelFits(model, nodeId));
    }

    // Find best node for this model
    const best = findBestNodeForModel(model);
    return c.json({
        model,
        estimated_vram_mb: estimateModelVram(model),
        best_node: best,
        fits_anywhere: best !== null,
    });
});

app.post('/api/v1/models/smart-deploy', async (c) => {
    const body = await c.req.json<{ model: string; count?: number }>();
    if (!body.model) return c.json({ error: 'model required' }, 400);

    const targetCount = body.count || 1;
    const deployed: Array<{ node_id: string; hostname: string; status: string }> = [];

    for (let i = 0; i < targetCount; i++) {
        const best = findBestNodeForModel(body.model);
        if (!best) break;

        const fit = checkModelFits(body.model, best.node_id);
        if (!fit.fits) break;

        queueCommand(best.node_id, 'install_model', { model: body.model });
        deployed.push({ node_id: best.node_id, hostname: best.hostname, status: 'queued' });
    }

    if (deployed.length === 0) {
        return c.json({
            error: 'No node has enough VRAM for ' + body.model,
            estimated_vram_mb: estimateModelVram(body.model),
        }, 409);
    }

    broadcastSSE('smart_deploy', { model: body.model, nodes: deployed });
    return c.json({ model: body.model, deployed });
});

app.get('/api/v1/inference/stats', (c) => {
    return c.json(getRequestStats());
});

// =============================================================================
// Cluster Topology (Wave 25)
// =============================================================================

app.get('/api/v1/topology', (c) => {
    const nodes = getAllNodes();
    const models = getClusterModels();

    // Build a topology map
    const farms = new Map<string, any[]>();
    for (const n of nodes) {
        const farm = n.farm_hash || 'default';
        if (!farms.has(farm)) farms.set(farm, []);
        const s = n.latest_stats || {} as any;
        farms.get(farm)!.push({
            node_id: n.id,
            hostname: n.hostname,
            ip: n.ip_address,
            status: n.status,
            gpus: (s.gpus || []).map((g: any) => ({
                name: g.name?.split('[')[1]?.split(']')[0] || g.name?.split('] ')[1] || g.name || '?',
                vram_mb: g.vramTotalMb,
                temp: g.temperatureC,
                util: g.utilizationPct,
            })),
            models: s.inference?.loaded_models || [],
            backend: s.backend?.type,
        });
    }

    return c.json({
        farms: [...farms.entries()].map(([hash, nodeList]) => ({
            farm_hash: hash,
            nodes: nodeList,
            total_gpus: nodeList.reduce((s: number, n: any) => s + n.gpus.length, 0),
        })),
        total_models: models.length,
        model_distribution: models.map(m => ({ model: m.model, nodes: m.node_count })),
    });
});

// =============================================================================
// Node Comparison + Benchmark Ranking (Wave 24)
// =============================================================================

app.get('/api/v1/compare', (c) => {
    const nodeIds = (c.req.query('nodes') || '').split(',').filter(Boolean);
    const nodes = getAllNodes().filter(n => nodeIds.length === 0 || nodeIds.includes(n.id));

    const comparison = nodes.map(n => {
        const s = n.latest_stats || {} as any;
        const health = getNodeHealthScore(n.id);
        const uptime = getNodeUptime(n.id, 24);
        return {
            node_id: n.id,
            hostname: n.hostname,
            status: n.status,
            health: health.score,
            grade: health.grade,
            uptime_pct: uptime.uptime_pct,
            gpu_count: n.gpu_count,
            total_vram_mb: s.gpus?.reduce((sum: number, g: any) => sum + (g.vramTotalMb || 0), 0) || 0,
            used_vram_mb: s.gpus?.reduce((sum: number, g: any) => sum + (g.vramUsedMb || 0), 0) || 0,
            avg_temp: s.gpus?.length > 0 ? Math.round(s.gpus.reduce((sum: number, g: any) => sum + (g.temperatureC || 0), 0) / s.gpus.length) : 0,
            models: s.inference?.loaded_models?.length || 0,
            backend: s.backend?.type || 'unknown',
            cpu: s.system_info?.cpu_model || 'unknown',
            ram_gb: s.system_info?.ram_total_gb || 0,
        };
    }).sort((a, b) => b.health - a.health);

    return c.json({ nodes: comparison });
});

app.get('/api/v1/leaderboard/models', (c) => {
    const d = getDb();
    const rows = d.prepare(`
        SELECT model, node_id,
            COUNT(*) as requests,
            AVG(latency_ms) as avg_latency,
            MIN(latency_ms) as best_latency
        FROM inference_log
        WHERE success = 1
        GROUP BY model, node_id
        ORDER BY avg_latency ASC
    `).all() as any[];

    return c.json({ rankings: rows });
});

// =============================================================================
// Version & Capabilities (Wave 19)
// =============================================================================

// OpenAPI spec — auto-generated from endpoints
app.get('/api/v1/openapi.json', (c) => {
    return c.json({
        openapi: '3.0.3',
        info: {
            title: 'TentaCLAW OS API',
            version: '0.2.0',
            description: 'AI inference cluster operating system. Eight arms. One mind. Zero compromises.',
            contact: { name: 'TentaCLAW-OS', url: 'https://www.tentaclaw.io' },
            license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        },
        servers: [{ url: 'http://localhost:8080', description: 'Local gateway' }],
        paths: {
            '/health': { get: { summary: 'Health check', tags: ['System'], responses: { '200': { description: 'OK' } } } },
            '/api/v1/register': { post: { summary: 'Register a node', tags: ['Nodes'], responses: { '200': { description: 'Node registered' } } } },
            '/api/v1/nodes': { get: { summary: 'List all nodes', tags: ['Nodes'], responses: { '200': { description: 'Node list' } } } },
            '/api/v1/nodes/{id}/stats': { post: { summary: 'Push stats from agent', tags: ['Stats'], responses: { '200': { description: 'Stats accepted' } } } },
            '/api/v1/summary': { get: { summary: 'Cluster summary', tags: ['Cluster'], responses: { '200': { description: 'Summary data' } } } },
            '/api/v1/health/score': { get: { summary: 'Health score (0-100)', tags: ['Cluster'], responses: { '200': { description: 'Health score' } } } },
            '/api/v1/models': { get: { summary: 'Cluster models', tags: ['Models'], responses: { '200': { description: 'Model list' } } } },
            '/api/v1/deploy': { post: { summary: 'Deploy model to node', tags: ['Models'], responses: { '200': { description: 'Deployment started' } } } },
            '/v1/chat/completions': { post: { summary: 'OpenAI-compatible chat', tags: ['Inference'], responses: { '200': { description: 'Chat response' } } } },
            '/v1/models': { get: { summary: 'OpenAI-compatible model list', tags: ['Inference'], responses: { '200': { description: 'Model list' } } } },
            '/v1/messages': { post: { summary: 'Anthropic Messages API-compatible chat', tags: ['Inference'], responses: { '200': { description: 'Anthropic message response' } } } },
            '/api/v1/alerts': { get: { summary: 'Cluster alerts', tags: ['Monitoring'], responses: { '200': { description: 'Alert list' } } } },
            '/metrics': { get: { summary: 'Prometheus metrics', tags: ['Monitoring'], responses: { '200': { description: 'Prometheus text' } } } },
        },
    });
});

app.get('/api/v1/version', (c) => {
    return c.json({
        name: 'TentaCLAW OS',
        version: '0.2.0',
        mascot: 'CLAWtopus',
        tagline: 'Eight arms. One mind. Zero compromises.',
        api_version: 'v1',
        features: [
            'zero-config-discovery', 'auto-backend-detection', 'smart-load-balancing',
            'circuit-breaker', 'auto-retry', 'vram-aware-routing', 'model-aliases',
            'fallback-chains', 'prompt-caching', 'function-calling', 'json-mode',
            'embeddings-batching', 'api-keys', 'auto-mode', 'watchdog',
            'notifications', 'remote-shell', 'doctor', 'power-tracking',
            'fleet-reliability', 'event-timeline', 'config-export-import',
            'maintenance-mode', 'hardware-inventory', 'model-package-manager',
            'multi-modal', 'audio-transcription', 'audio-tts', 'image-generation', 'vision',
        ],
        openai_compatible: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/models', '/v1/audio/transcriptions', '/v1/audio/speech', '/v1/audio/translate', '/v1/images/generations'],
        anthropic_compatible: ['/v1/messages'],
    });
});

app.get('/api/v1/capabilities', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online');
    const models = getClusterModels();
    const aliases = getAllModelAliases();

    return c.json({
        nodes: nodes.length,
        gpus: nodes.reduce((s, n) => s + n.gpu_count, 0),
        models: models.map(m => m.model),
        aliases: aliases.map(a => ({ alias: a.alias, target: a.target })),
        backends: [...new Set(nodes.map(n => (n.latest_stats as any)?.backend?.type).filter(Boolean))],
        features: {
            function_calling: true,
            json_mode: true,
            streaming: true,
            embeddings: true,
            prompt_caching: true,
            auto_mode: true,
            anthropic_messages_api: true,
            multi_modal: true,
            audio_transcription: true,
            audio_tts: true,
            audio_translation: true,
            image_generation: true,
            vision: true,
        },
        api_compatibility: {
            openai: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/models', '/v1/audio/transcriptions', '/v1/audio/speech', '/v1/audio/translate', '/v1/images/generations'],
            anthropic: ['/v1/messages'],
        },
    });
});

// =============================================================================
// Fleet Reliability (Wave 16)
// =============================================================================

app.get('/api/v1/fleet', (c) => {
    return c.json(getFleetReliability());
});

app.get('/api/v1/nodes/:id/health-score', (c) => {
    return c.json(getNodeHealthScore(c.req.param('id')));
});

// =============================================================================
// Config Export/Import (Wave 15)
// =============================================================================

app.get('/api/v1/config/export', (c) => {
    return c.json(exportClusterConfig());
});

app.post('/api/v1/config/import', async (c) => {
    const body = await c.req.json();
    const result = importClusterConfig(body);
    return c.json(result);
});

// =============================================================================
// Event Timeline (Wave 14)
// =============================================================================

app.get('/api/v1/timeline', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    return c.json(getClusterTimeline(limit));
});

// =============================================================================
// Maintenance Mode (Wave 13)
// =============================================================================

app.post('/api/v1/nodes/:id/maintenance', async (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ enabled: boolean }>();
    setMaintenanceMode(nodeId, body.enabled);
    broadcastSSE('maintenance', { node_id: nodeId, enabled: body.enabled });
    return c.json({ status: body.enabled ? 'maintenance' : 'online', node_id: nodeId });
});

// =============================================================================
// Hardware Inventory (Wave 12)
// =============================================================================

app.get('/api/v1/inventory', (c) => {
    const nodes = getAllNodes();
    const inventory = nodes.map(n => {
        const s = n.latest_stats || {} as any;
        return {
            node_id: n.id,
            hostname: n.hostname,
            status: n.status,
            ip_address: n.ip_address,
            system: s.system_info || {},
            backend: s.backend || {},
            gpus: (s.gpus || []).map((g: any) => ({
                name: g.name,
                vram_mb: g.vramTotalMb,
                bus_id: g.busId,
            })),
            models: s.inference?.loaded_models || [],
            registered_at: n.registered_at,
            last_seen: n.last_seen_at,
        };
    });

    const totalGpus = inventory.reduce((s, n) => s + n.gpus.length, 0);
    const totalVram = inventory.reduce((s, n) => s + n.gpus.reduce((vs: number, g: any) => vs + (g.vram_mb || 0), 0), 0);
    const totalRam = inventory.reduce((s, n) => s + (n.system.ram_total_gb || 0), 0);
    const totalCores = inventory.reduce((s, n) => s + (n.system.cpu_cores || 0), 0);

    return c.json({
        total_nodes: inventory.length,
        total_gpus: totalGpus,
        total_vram_gb: Math.round(totalVram / 1024),
        total_ram_gb: Math.round(totalRam),
        total_cpu_cores: totalCores,
        nodes: inventory,
    });
});

// =============================================================================
// Power & Cost (Wave 11)
// =============================================================================

app.get('/api/v1/power', (c) => {
    return c.json(getClusterPower());
});

// =============================================================================
// Prompt Cache (Wave 10)
// =============================================================================

app.get('/api/v1/cache/stats', (c) => {
    return c.json(getCacheStats());
});

app.post('/api/v1/cache/purge', (c) => {
    const pruned = pruneCache();
    return c.json({ status: 'purged', expired_entries_removed: pruned });
});

// =============================================================================
// Model Aliases (Wave 9)
// =============================================================================

app.get('/api/v1/aliases', (c) => {
    ensureDefaultAliases();
    return c.json(getAllModelAliases());
});

app.post('/api/v1/aliases', async (c) => {
    const body = await c.req.json<{ alias: string; target: string; fallbacks?: string[] }>();
    if (!body.alias || !body.target) return c.json({ error: 'alias and target required' }, 400);
    setModelAlias(body.alias, body.target, body.fallbacks || []);
    return c.json({ status: 'created', alias: body.alias, target: body.target });
});

app.delete('/api/v1/aliases/:alias', (c) => {
    if (!deleteModelAlias(c.req.param('alias'))) return c.json({ error: 'Alias not found' }, 404);
    return c.json({ status: 'deleted' });
});

// =============================================================================
// Auto Mode (Wave 8)
// =============================================================================

app.post('/api/v1/auto', (c) => {
    const decisions = runAutoMode();
    broadcastSSE('auto_mode', { decisions: decisions.length, executed: decisions.filter(d => d.executed).length });
    return c.json({
        decisions,
        executed: decisions.filter(d => d.executed).length,
        suggested: decisions.filter(d => !d.executed).length,
    });
});

app.get('/api/v1/auto/status', (c) => {
    return c.json({ enabled: true, last_run: null, interval_minutes: 30 });
});

// =============================================================================
// API Key Management (Wave 7)
// =============================================================================

app.get('/api/v1/apikeys', (c) => {
    return c.json(getAllApiKeys());
});

app.post('/api/v1/apikeys', async (c) => {
    const body = await c.req.json<{
        name: string;
        scope?: string;
        rate_limit_rpm?: number;
        permissions?: string[];
        expires_at?: string;
    }>();
    if (!body.name) return c.json({ error: 'name required' }, 400);

    // Validate permissions array if provided
    const validPerms = ['read', 'write', 'admin'];
    if (body.permissions) {
        const invalid = body.permissions.filter(p => !validPerms.includes(p));
        if (invalid.length > 0) {
            return c.json({ error: `Invalid permissions: ${invalid.join(', ')}. Valid: ${validPerms.join(', ')}` }, 400);
        }
    }

    const result = createApiKey(
        body.name,
        body.scope || 'inference',
        body.rate_limit_rpm || 1000,
        body.permissions,
        body.expires_at,
    );

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('apikey_created', body.name, ip, `API key created: ${result.id} (prefix: ${result.key.slice(0, 10)})`);

    return c.json({
        id: result.id,
        key: result.key, // Only shown ONCE at creation
        prefix: result.key.slice(0, 10),
        name: result.name,
        permissions: result.permissions,
        message: 'Save this key — it will not be shown again.',
    }, 201);
});

app.delete('/api/v1/apikeys/:id', (c) => {
    const keyId = c.req.param('id');
    if (!revokeApiKey(keyId)) return c.json({ error: 'Key not found' }, 404);

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('apikey_revoked', undefined, ip, `API key revoked: ${keyId}`);

    return c.json({ status: 'revoked' });
});

// =============================================================================
// Join Tokens — Node Attestation (Wave 3, Phase 38-39)
// =============================================================================

app.post('/api/v1/join-tokens', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const label = String(body.label || '');
    const maxUses = parseInt(body.max_uses, 10) || 1;
    const hoursValid = parseInt(body.hours_valid, 10) || 24;

    const result = createJoinToken(label, maxUses, hoursValid);
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('join_token_created', undefined, ip, `Join token created: ${result.prefix}... (max ${maxUses} uses, ${hoursValid}h validity)`);

    return c.json({
        id: result.id,
        token: result.token,
        prefix: result.prefix,
        expires_at: result.expiresAt,
        message: 'Save this token — it will not be shown again. Pass as X-Join-Token header when registering new nodes.',
    });
});

app.get('/api/v1/join-tokens', (c) => {
    return c.json(listJoinTokens());
});

app.delete('/api/v1/join-tokens/:id', (c) => {
    deleteJoinToken(c.req.param('id'));
    return c.json({ status: 'deleted' });
});

// =============================================================================
// Multi-Tenant Authentication (Wave 8)
// =============================================================================

// Bootstrap: create default admin on first boot + initialize cluster secret
try {
    const newAdmin = createDefaultAdmin();
    if (newAdmin) {
        recordAuditEvent('first_boot', 'system', undefined, 'First boot: admin user created');
        // First boot — also generate a cluster secret if none exists
        if (!process.env.TENTACLAW_CLUSTER_SECRET) {
            const secret = getOrCreateClusterSecret();
            console.log(`[auth] SECURITY: Cluster secret generated on first boot (first 8 chars): ${secret.slice(0, 8)}...`);
            console.log('[auth] Retrieve the full secret via: GET /api/v1/cluster/secret (admin auth required)');
            console.log('[auth] Set TENTACLAW_CLUSTER_SECRET on all agents to this value.');
        }
    }
    // Initialize cluster secret (load from env or DB)
    initClusterSecret();
} catch (_e) {
    // Table may not exist yet on very first run before migrations complete
}

/**
 * Extract session user from Authorization: Bearer <token> header.
 * Returns the authenticated user or null.
 */
function getSessionUser(c: any): ReturnType<typeof validateSession> {
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    return validateSession(token);
}

/**
 * Middleware helper: require a valid session with a specific role.
 */
function requireRole(c: any, ...roles: string[]): ReturnType<typeof validateSession> {
    const user = getSessionUser(c);
    if (!user) return null;
    if (roles.length > 0 && !roles.includes(user.role)) return null;
    return user;
}

// POST /api/v1/auth/login — authenticate and get session token
app.post('/api/v1/auth/login', async (c) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

    // Rate limit: 5 login attempts per minute per IP
    const rateCheck = checkLoginRateLimit(ip);
    c.header('X-RateLimit-Limit', String(LOGIN_RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(rateCheck.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
    if (!rateCheck.allowed) {
        const retryAfter = Math.ceil((rateCheck.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(Math.max(1, retryAfter)));
        return c.json({ error: 'Too many login attempts. Try again later.' }, 429);
    }

    // Check if IP is blocked from brute force protection
    if (isIpBlocked(ip)) {
        recordAuditEvent('auth_blocked_ip', undefined, ip, 'Login attempt from blocked IP');
        return c.json({ error: 'Too many failed attempts. Try again later.' }, 429);
    }

    const body = await c.req.json<{ username: string; password: string }>();

    if (!body.username || !body.password) {
        return c.json({ error: 'username and password are required' }, 400);
    }

    const user = authenticateUser(body.username, body.password);
    if (!user) {
        const blocked = recordAuthFailure(ip);
        recordAuditEvent('auth_login_failed', body.username, ip, blocked ? 'IP now blocked for 15 minutes' : 'Invalid credentials');
        return c.json({ error: 'Invalid username or password' }, 401);
    }

    // Successful login — clear any failure records for this IP
    clearAuthFailures(ip);
    recordAuditEvent('auth_login', user.username, ip, `User ${user.username} logged in`);

    const session = createSession(user.id);

    // Check if admin must change their initial password
    const passwordChangeRequired = user.username === 'admin' && isInitialAdminPassword();

    return c.json({
        token: session.token,
        expires_at: session.expires_at,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
        ...(passwordChangeRequired ? { password_change_required: true } : {}),
    });
});

// POST /api/v1/auth/change-password — change the authenticated user's password
app.post('/api/v1/auth/change-password', async (c) => {
    const sessionUser = getSessionUser(c);
    if (!sessionUser) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const body = await c.req.json<{ current_password: string; new_password: string }>();

    if (!body.current_password || !body.new_password) {
        return c.json({ error: 'current_password and new_password are required' }, 400);
    }

    if (body.new_password.length < 8) {
        return c.json({ error: 'New password must be at least 8 characters' }, 400);
    }

    try {
        updateUserPassword(sessionUser.id, body.current_password, body.new_password);
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('auth_password_changed', sessionUser.username, ip, `User ${sessionUser.username} changed their password`);
        return c.json({ status: 'password_changed' });
    } catch (err: any) {
        return c.json({ error: err.message || 'Password change failed' }, 400);
    }
});

// POST /api/v1/auth/logout — invalidate current session
app.post('/api/v1/auth/logout', (c) => {
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) {
        return c.json({ error: 'No session token provided' }, 400);
    }

    const user = getSessionUser(c);
    const success = invalidateSession(token);
    if (!success) {
        return c.json({ error: 'Session not found or already expired' }, 404);
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('auth_logout', user?.username, ip, `User ${user?.username || 'unknown'} logged out`);

    return c.json({ status: 'logged_out' });
});

// GET /api/v1/auth/me — get current user from session
app.get('/api/v1/auth/me', (c) => {
    const user = getSessionUser(c);
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
    });
});

// =============================================================================
// Audit Log (admin only)
// =============================================================================

app.get('/api/v1/audit', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const limit = parseInt(c.req.query('limit') || '100');
    const eventType = c.req.query('event_type') || undefined;
    return c.json({ audit_log: getAuditLog(limit, eventType) });
});

// =============================================================================
// Cluster Secret Management (admin only)
// =============================================================================

app.get('/api/v1/cluster/secret', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    return c.json({
        agent_auth_enabled: agentAuthEnabled,
        secret_configured: !!CLUSTER_SECRET,
        // Never expose the full secret — just indicate if it's set
        secret_preview: CLUSTER_SECRET ? CLUSTER_SECRET.slice(0, 8) + '...' : null,
    });
});

app.post('/api/v1/cluster/secret/rotate', async (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    if (process.env.TENTACLAW_CLUSTER_SECRET) {
        return c.json({ error: 'Cannot rotate cluster secret when set via TENTACLAW_CLUSTER_SECRET env var. Update the env var instead.' }, 400);
    }

    const newSecret = randomBytes(32).toString('hex');
    setClusterConfig('cluster_secret', newSecret);
    CLUSTER_SECRET = newSecret;
    agentAuthEnabled = true;

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('cluster_secret_rotated', user.username, ip, 'Cluster secret rotated by admin');

    return c.json({
        status: 'rotated',
        secret: newSecret,
        message: 'New cluster secret generated. Distribute to all agents immediately. Old secret is now invalid.',
    });
});

// GET /api/v1/users — list all users (admin only)
app.get('/api/v1/users', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    return c.json(getUsers());
});

// POST /api/v1/users — create user (admin only)
app.post('/api/v1/users', async (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const body = await c.req.json<{
        username: string;
        password: string;
        role?: string;
        email?: string;
    }>();

    if (!body.username || !body.password) {
        return c.json({ error: 'username and password are required' }, 400);
    }

    const validRoles = ['admin', 'operator', 'viewer', 'user'];
    if (body.role && !validRoles.includes(body.role)) {
        return c.json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` }, 400);
    }

    try {
        const newUser = createUser(body.username, body.password, body.role, body.email);
        return c.json(newUser, 201);
    } catch (err: any) {
        if (err.message?.includes('UNIQUE constraint')) {
            return c.json({ error: 'Username already exists' }, 409);
        }
        return c.json({ error: 'Failed to create user' }, 500);
    }
});

// DELETE /api/v1/users/:id — delete user (admin only)
app.delete('/api/v1/users/:id', (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const targetId = c.req.param('id');

    // Prevent admins from deleting themselves
    if (targetId === admin.id) {
        return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    if (!deleteUser(targetId)) {
        return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ status: 'deleted' });
});

// PUT /api/v1/users/:id/role — change user role (admin only)
app.put('/api/v1/users/:id/role', async (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const body = await c.req.json<{ role: string }>();
    const validRoles = ['admin', 'operator', 'viewer', 'user'];

    if (!body.role || !validRoles.includes(body.role)) {
        return c.json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` }, 400);
    }

    const targetId = c.req.param('id');
    if (!updateUserRole(targetId, body.role)) {
        return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ status: 'updated', id: targetId, role: body.role });
});

app.get('/api/v1/inference/analytics', (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    return c.json(getInferenceAnalytics(hours));
});

app.get('/api/v1/inference/backends', (c) => {
    const nodes = getAllNodes();
    const backends = nodes.filter(n => n.status === 'online' && n.latest_stats).map(n => {
        const s = n.latest_stats!;
        const totalVram = s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0);
        return {
            node_id: n.id,
            hostname: n.hostname,
            backend: (s as any).backend || { type: 'unknown' },
            gpu_count: s.gpu_count,
            total_vram_mb: totalVram,
            models: s.inference.loaded_models,
        };
    });
    return c.json({ backends });
});

app.get('/api/v1/nodes/:id/uptime', (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    return c.json(getNodeUptime(c.req.param('id'), hours));
});

app.get('/api/v1/uptime', (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    return c.json(getFleetUptime(hours));
});

// =============================================================================
// Per-GPU Overclocking API (Phase 31-40)
// =============================================================================

app.get('/api/v1/nodes/:id/overclock', (c) => {
    return c.json(getOverclockProfiles(c.req.param('id')));
});

app.post('/api/v1/nodes/:id/overclock', async (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{
        gpu_index: number;
        core_offset_mhz?: number;
        mem_offset_mhz?: number;
        power_limit_w?: number;
        fan_speed_pct?: number;
    }>();

    if (body.gpu_index === undefined) return c.json({ error: 'gpu_index required' }, 400);

    // Save profile
    setOverclockProfile(nodeId, body.gpu_index, body);

    // Send overclock command to agent
    queueCommand(nodeId, 'overclock', {
        gpu: body.gpu_index,
        core_offset: body.core_offset_mhz,
        mem_offset: body.mem_offset_mhz,
        power_limit: body.power_limit_w,
        fan_speed: body.fan_speed_pct,
    });

    broadcastSSE('overclock_applied', { node_id: nodeId, gpu_index: body.gpu_index });
    return c.json({ status: 'queued', profile: body });
});

// =============================================================================
// Bulk Operations API (Phase 71-80)
// =============================================================================

app.post('/api/v1/bulk/command', async (c) => {
    const body = await c.req.json<{
        node_ids?: string[];
        tag?: string;
        action: string;
        payload?: Record<string, unknown>;
    }>();

    if (!body.action) return c.json({ error: 'action required' }, 400);

    // Resolve target nodes
    let targetNodes: string[];
    if (body.tag) {
        const tagged = getNodesByTag(body.tag);
        targetNodes = tagged.map(n => n.id);
    } else if (body.node_ids) {
        targetNodes = body.node_ids;
    } else {
        // All online nodes
        targetNodes = getAllNodes().filter(n => n.status === 'online').map(n => n.id);
    }

    const results: Array<{ node_id: string; status: string }> = [];
    for (const nodeId of targetNodes) {
        try {
            queueCommand(nodeId, body.action as any, body.payload);
            results.push({ node_id: nodeId, status: 'queued' });
        } catch {
            results.push({ node_id: nodeId, status: 'error' });
        }
    }

    broadcastSSE('bulk_command', { action: body.action, count: results.length });
    return c.json({ action: body.action, total: results.length, results });
});

app.post('/api/v1/bulk/tags', async (c) => {
    const body = await c.req.json<{ node_ids: string[]; tags: string[]; action: 'add' | 'remove' }>();
    if (!body.node_ids || !body.tags) return c.json({ error: 'node_ids and tags required' }, 400);

    let count = 0;
    for (const nodeId of body.node_ids) {
        for (const tag of body.tags) {
            if (body.action === 'remove') {
                removeNodeTag(nodeId, tag);
            } else {
                addNodeTag(nodeId, tag);
            }
            count++;
        }
    }
    return c.json({ status: 'done', operations: count });
});

app.post('/api/v1/bulk/reboot', async (c) => {
    const body = await c.req.json<{ node_ids?: string[]; tag?: string }>();
    let targets: string[];
    if (body.tag) {
        targets = getNodesByTag(body.tag).map(n => n.id);
    } else if (body.node_ids) {
        targets = body.node_ids;
    } else {
        return c.json({ error: 'node_ids or tag required' }, 400);
    }

    for (const nodeId of targets) {
        queueCommand(nodeId, 'reboot');
    }
    broadcastSSE('bulk_reboot', { count: targets.length });
    return c.json({ status: 'queued', count: targets.length });
});

app.post('/api/v1/bulk/deploy', async (c) => {
    const body = await c.req.json<{ model: string; node_ids?: string[]; tag?: string }>();
    if (!body.model) return c.json({ error: 'model required' }, 400);

    let targets: string[];
    if (body.tag) {
        targets = getNodesByTag(body.tag).map(n => n.id);
    } else if (body.node_ids) {
        targets = body.node_ids;
    } else {
        targets = getAllNodes().filter(n => n.status === 'online').map(n => n.id);
    }

    for (const nodeId of targets) {
        queueCommand(nodeId, 'install_model', { model: body.model });
    }
    broadcastSSE('bulk_deploy', { model: body.model, count: targets.length });
    return c.json({ status: 'queued', model: body.model, count: targets.length });
});

// =============================================================================
// Watchdog API
// =============================================================================

app.post('/api/v1/nodes/:id/watchdog', async (c) => {
    const nodeId = c.req.param('id');
    const body = await c.req.json<{ events: Array<{ level: number; action: string; detail: string }> }>();

    if (body.events) {
        for (const evt of body.events) {
            recordWatchdogEvent(nodeId, evt.level, evt.action, evt.detail);

            // Send notifications for level >= 2 (restarts and above)
            if (evt.level >= 2) {
                const channels = getAllNotificationChannels();
                const msg = `[TentaCLAW] ${nodeId} — Level ${evt.level} watchdog: ${evt.action}\n${evt.detail}`;
                for (const ch of channels) {
                    sendNotification(ch.id, msg).catch(() => {});
                }
            }
        }
        broadcastSSE('watchdog_event', { node_id: nodeId, events: body.events });
    }
    return c.json({ status: 'received' });
});

app.get('/api/v1/nodes/:id/watchdog', (c) => {
    return c.json(getWatchdogEvents(c.req.param('id')));
});

app.get('/api/v1/watchdog', (c) => {
    const limit = parseInt(c.req.query('limit') || '100');
    return c.json(getAllWatchdogEvents(limit));
});

// =============================================================================
// Notification Channels API
// =============================================================================

app.get('/api/v1/notifications/channels', (c) => {
    return c.json(getAllNotificationChannels());
});

app.post('/api/v1/notifications/channels', async (c) => {
    const body = await c.req.json<{ type: string; name: string; config: Record<string, unknown> }>();
    if (!body.type || !body.name || !body.config) {
        return c.json({ error: 'type, name, and config required' }, 400);
    }
    if (!['telegram', 'discord', 'webhook'].includes(body.type)) {
        return c.json({ error: 'type must be telegram, discord, or webhook' }, 400);
    }
    const channel = createNotificationChannel(body.type, body.name, body.config);
    return c.json(channel, 201);
});

app.delete('/api/v1/notifications/channels/:id', (c) => {
    if (!deleteNotificationChannel(c.req.param('id'))) return c.json({ error: 'Channel not found' }, 404);
    return c.json({ status: 'deleted' });
});

app.post('/api/v1/notifications/test', async (c) => {
    const body = await c.req.json<{ channel_id: string }>();
    const ok = await sendNotification(body.channel_id, '[TentaCLAW] Test notification — your alerts are working!');
    return c.json({ status: ok ? 'sent' : 'failed' });
});

// Doctor: receive agent self-heal reports
app.post('/api/v1/nodes/:id/doctor', async (c) => {
    const nodeId = c.req.param('id');
    const body = await c.req.json<{
        node_id: string;
        heal_count: number;
        results: Array<{ check: string; status: string; message: string }>;
    }>();

    const fixed = body.results.filter(r => r.status === 'fixed');
    const failed = body.results.filter(r => r.status === 'failed');

    if (fixed.length > 0 || failed.length > 0) {
        for (const r of [...fixed, ...failed]) {
            recordNodeEvent(nodeId, `doctor_${r.status}`, `${r.check}: ${r.message}`);
        }
        broadcastSSE('doctor_node_report', {
            node_id: nodeId,
            heal_count: body.heal_count,
            fixed: fixed.length,
            failed: failed.length,
            timestamp: new Date().toISOString(),
        });
    }

    return c.json({ status: 'received' });
});

// Doctor: auto-fix a specific issue by name
app.post('/api/v1/doctor/fix', async (c) => {
    const body = await c.req.json<{ check: string; params?: Record<string, unknown> }>();

    switch (body.check) {
        case 'reboot_node': {
            const nodeId = body.params?.node_id as string;
            if (!nodeId) return c.json({ error: 'node_id required' }, 400);
            queueCommand(nodeId, 'reboot');
            return c.json({ status: 'queued', action: 'reboot', node_id: nodeId });
        }
        case 'restart_agent': {
            const nodeId = body.params?.node_id as string;
            if (!nodeId) return c.json({ error: 'node_id required' }, 400);
            queueCommand(nodeId, 'restart_agent');
            return c.json({ status: 'queued', action: 'restart_agent', node_id: nodeId });
        }
        case 'prune_stats': {
            const hours = (body.params?.hours as number) || 24;
            pruneStats(hours);
            return c.json({ status: 'done', action: 'prune_stats', hours });
        }
        case 'clear_alerts': {
            const d = getDb();
            d.prepare('UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0').run();
            return c.json({ status: 'done', action: 'acknowledge_all_alerts' });
        }
        case 'deploy_model': {
            const model = body.params?.model as string;
            if (!model) return c.json({ error: 'model required' }, 400);
            const nodes = getAllNodes().filter(n => n.status === 'online');
            for (const node of nodes) {
                queueCommand(node.id, 'install_model', { model });
            }
            return c.json({ status: 'queued', action: 'deploy_model', model, nodes: nodes.length });
        }
        default:
            return c.json({ error: `Unknown fix: ${body.check}` }, 400);
    }
});

// =============================================================================
// SSE Endpoint
// =============================================================================

app.get('/api/v1/events', (_c) => {
    const stream = new ReadableStream({
        start(controller) {
            const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const client: SSEClient = { id: clientId, controller };
            sseClients.push(client);

            // Send initial connection event
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ client_id: clientId })}\n\n`));

            // Cleanup on cancel (handled by try/catch in broadcastSSE)
        },
        cancel() {
            // Client disconnected — cleanup happens in broadcastSSE
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        },
    });
});

// =============================================================================
// Static Dashboard Files
// =============================================================================

// Serve static files from public/ — works at both /dashboard/ and root /

app.use('/dashboard/*', serveStatic({
    root: 'public',
    rewriteRequestPath: (p) => p.replace('/dashboard', ''),
}));

app.get('/dashboard', (c) => c.redirect('/dashboard/'));

// Root redirect to dashboard
app.get('/', (c) => c.redirect('/dashboard/'));

// =============================================================================
// Background Tasks
// =============================================================================

// Mark stale nodes as offline every 30 seconds
setInterval(() => {
    const staleIds = markStaleNodes(60);
    for (const id of staleIds) {
        broadcastSSE('node_offline', { node_id: id, timestamp: new Date().toISOString() });
        console.log(`[tentaclaw] Node went offline: ${id}`);
    }
}, 30_000);

// Prune old stats daily (keep 7 days)
setInterval(() => {
    const pruned = pruneStats(7);
    if (pruned > 0) {
        console.log(`[tentaclaw] Pruned ${pruned} old stats records`);
    }
}, 86_400_000);

// Run scheduled tasks every 60 seconds
setInterval(() => {
    const due = getDueSchedules();
    for (const schedule of due) {
        console.log('[tentaclaw] Running schedule: ' + schedule.name + ' (' + schedule.type + ')');

        try {
            switch (schedule.type) {
                case 'deploy': {
                    const model = (schedule.config as any).model;
                    if (model) {
                        const nodes = getAllNodes().filter(n => n.status === 'online');
                        for (const node of nodes) {
                            queueCommand(node.id, 'install_model', { model });
                        }
                        broadcastSSE('command_sent', { action: 'scheduled_deploy', model, node_count: nodes.length, timestamp: new Date().toISOString() });
                    }
                    break;
                }
                case 'benchmark': {
                    const model = (schedule.config as any).model || 'llama3.1:8b';
                    const nodes = getAllNodes().filter(n => n.status === 'online');
                    for (const node of nodes) {
                        queueCommand(node.id, 'benchmark' as any, { model });
                    }
                    break;
                }
                case 'reboot': {
                    const targetNodes = (schedule.config as any).node_ids as string[] | undefined;
                    const nodes = targetNodes
                        ? getAllNodes().filter(n => targetNodes.includes(n.id))
                        : getAllNodes().filter(n => n.status === 'online');
                    for (const node of nodes) {
                        queueCommand(node.id, 'reboot');
                    }
                    break;
                }
                default:
                    console.log('[tentaclaw] Unknown schedule type: ' + schedule.type);
            }

            markScheduleRun(schedule.id);
        } catch (err) {
            console.error('[tentaclaw] Schedule error: ' + err);
        }
    }
}, 60_000);

// =============================================================================
// Server Start
// =============================================================================

if (!process.env.VITEST) {

// PORT and HOST are defined at the top of the file

// Initialize DB on startup
getDb();
ensureDefaultAliases();
seedDefaultAlertRules();

// Initialize cluster secret for agent auth
initClusterSecret();

// Check file permissions on sensitive files (Phase 11)
try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const keyPath = require('path').join(homeDir, '.tentaclaw', 'cluster.key');
    if (require('fs').existsSync(keyPath)) {
        const stats = require('fs').statSync(keyPath);
        const mode = stats.mode & 0o777;
        if (mode & 0o044) {
            console.error(`[security] CRITICAL: ${keyPath} is world/group-readable (mode ${mode.toString(8)}). Run: chmod 600 ${keyPath}`);
            if (mode & 0o004) {
                console.error('[security] Refusing to start with world-readable cluster key. Fix permissions or set TENTACLAW_CLUSTER_SECRET env var.');
                process.exit(1);
            }
        }
    }
} catch { /* Windows or permission check not supported — skip */ }

// Log security status
if (agentAuthEnabled) {
    console.log('[auth] Agent authentication: ENABLED (cluster secret configured)');
} else {
    console.log('[auth] Agent authentication: DISABLED (no cluster secret — set TENTACLAW_CLUSTER_SECRET to enable)');
}

console.log(`
\x1b[38;2;0;212;170m         ___\x1b[0m
\x1b[38;2;0;212;170m        /o o\\     \x1b[38;2;139;92;246m████████╗███████╗███╗   ██╗████████╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗\x1b[0m
\x1b[38;2;0;212;170m        \\ ~ /     \x1b[38;2;139;92;246m╚══██╔══╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║\x1b[0m
\x1b[38;2;0;212;170m       /||||||\\      \x1b[38;2;0;212;170m██║   █████╗  ██╔██╗ ██║   ██║   ███████║██║     ██║     ███████║██║ █╗ ██║\x1b[0m
\x1b[38;2;0;212;170m      / |||||| \\     \x1b[38;2;0;212;170m██║   ██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║     ██║     ██╔══██║██║███╗██║\x1b[0m
\x1b[38;2;0;212;170m     /  ||  ||  \\    \x1b[38;2;139;92;246m██║   ███████╗██║ ╚████║   ██║   ██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝\x1b[0m
\x1b[38;2;0;212;170m    ~   ~~  ~~   ~   \x1b[38;2;139;92;246m╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝\x1b[0m

\x1b[2m  Eight arms. One mind. Zero compromises.\x1b[0m
`);

const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
}, (info) => {
    console.log(`[tentaclaw] Gateway listening on http://${HOST}:${info.port}`);
    console.log(`[tentaclaw] Dashboard: http://${HOST}:${info.port}/dashboard`);
    console.log(`[tentaclaw] API: http://${HOST}:${info.port}/api/v1`);
    console.log(`[tentaclaw] Health: http://${HOST}:${info.port}/health`);
    console.log('');

    // Security checklist (Phase 15)
    console.log('\x1b[33m  Security Checklist:\x1b[0m');
    console.log(`    ${!NO_AUTH ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} Authentication: ${!NO_AUTH ? 'ENABLED' : 'DISABLED (--no-auth)'}`);
    console.log(`    ${agentAuthEnabled ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} Cluster secret: ${agentAuthEnabled ? 'CONFIGURED' : 'NOT SET'}`);
    console.log(`    ${HOST === '127.0.0.1' ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m'} Bind address: ${HOST} ${HOST === '0.0.0.0' ? '(all interfaces)' : '(localhost only)'}`);
    console.log(`    ${RATE_LIMIT_UNAUTH > 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} Rate limiting: ${RATE_LIMIT_UNAUTH > 0 ? RATE_LIMIT_UNAUTH + '/' + RATE_LIMIT_AUTH + ' rpm (unauth/auth)' : 'DISABLED'}`);
    console.log('    \x1b[33m!\x1b[0m Firewall: Ensure ports 8080, 41337 are protected');
    console.log('    \x1b[33m!\x1b[0m Updates: Check for new versions at github.com/TentaCLAW-OS/TentaCLAW');
    console.log('');

    // Remote shell WebSocket server
    setupShellServer(server);

    // Auto-discovery: listen for agent broadcasts and respond
    startDiscoveryService(info.port);
});

} // end if (!process.env.VITEST)

// =============================================================================
// Auto-Discovery Service
// =============================================================================

const DISCOVERY_PORT = 41337;

function startDiscoveryService(gatewayPort: number): void {
    try {
        // Listen for agent broadcasts
        const listener = dgram.createSocket('udp4');
        listener.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.magic === 'TENTACLAW-DISCOVER') {
                    console.log(`[tentaclaw] Discovery: agent ${data.node_id} at ${rinfo.address}`);
                    // Auto-register if we can see them
                    registerNode({
                        node_id: data.node_id,
                        farm_hash: data.farm_hash || 'AUTO',
                        hostname: data.hostname || rinfo.address,
                        ip_address: rinfo.address,
                        gpu_count: data.gpu_count || 0,
                        os_version: data.version,
                    });
                    broadcastSSE('node_discovered', { node_id: data.node_id, ip: rinfo.address });
                }
            } catch {}
        });
        listener.bind(DISCOVERY_PORT, () => {
            console.log(`[tentaclaw] Discovery listener on UDP port ${DISCOVERY_PORT}`);
        });
        listener.on('error', () => {});

        // Broadcast gateway presence so agents can find us
        const broadcaster = dgram.createSocket('udp4');
        broadcaster.on('error', () => {});
        broadcaster.bind(0, () => {
            broadcaster.setBroadcast(true);
            const announce = () => {
                const localIp = getLocalIp();
                const payload = JSON.stringify({
                    magic: 'TENTACLAW-GATEWAY',
                    url: `http://${localIp}:${gatewayPort}`,
                    version: '0.2.0',
                });
                const buf = Buffer.from(payload);
                broadcaster.send(buf, 0, buf.length, DISCOVERY_PORT + 1, '255.255.255.255', () => {});
            };
            announce();
            setInterval(announce, 30000);
            console.log(`[tentaclaw] Broadcasting gateway presence every 30s`);
        });
    } catch {
        console.log('[tentaclaw] Auto-discovery unavailable (non-fatal)');
    }
}

// =============================================================================
// Remote Shell — WebSocket Terminal Proxy
// =============================================================================
//
// Architecture:
// 1. Agent connects: ws://gateway:8080/ws/agent-shell/:nodeId (keeps alive)
// 2. Dashboard connects: ws://gateway:8080/ws/shell/:nodeId
// 3. Gateway pipes dashboard ↔ agent WebSocket data
// 4. Agent spawns /bin/bash and pipes stdin/stdout

const agentShells = new Map<string, WsWebSocket>(); // nodeId → agent WebSocket
const dashboardShells = new Map<string, Set<WsWebSocket>>(); // nodeId → dashboard WebSockets

function setupShellServer(httpServer: any): void {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req: any, socket: any, head: any) => {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        // --- Authentication for WebSocket connections ---
        // Agent connections require cluster secret
        // Dashboard connections require a valid session token or API key
        const authHeader = req.headers['authorization'] || '';
        const queryToken = url.searchParams.get('token') || '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

        // Agent registers its shell tunnel
        const agentMatch = path.match(/^\/ws\/agent-shell\/(.+)$/);
        if (agentMatch) {
            // Agents must authenticate with the cluster secret
            if (agentAuthEnabled && bearerToken !== CLUSTER_SECRET) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            const nodeId = decodeURIComponent(agentMatch[1]);
            wss.handleUpgrade(req, socket, head, (ws) => {
                agentShells.set(nodeId, ws);
                console.log(`[shell] Agent shell connected: ${nodeId}`);
                broadcastSSE('shell_available', { node_id: nodeId });

                ws.on('message', (data: Buffer) => {
                    // Forward agent output to all dashboard clients
                    const clients = dashboardShells.get(nodeId);
                    if (clients) {
                        for (const client of clients) {
                            if (client.readyState === WsWebSocket.OPEN) {
                                client.send(data);
                            }
                        }
                    }
                });

                ws.on('close', () => {
                    agentShells.delete(nodeId);
                    console.log(`[shell] Agent shell disconnected: ${nodeId}`);
                    // Notify dashboard clients
                    const clients = dashboardShells.get(nodeId);
                    if (clients) {
                        for (const client of clients) {
                            client.send(JSON.stringify({ type: 'shell_closed', nodeId }));
                            client.close();
                        }
                        dashboardShells.delete(nodeId);
                    }
                });
            });
            return;
        }

        // Dashboard requests a shell — REQUIRES authentication (admin/operator role)
        const dashMatch = path.match(/^\/ws\/shell\/(.+)$/);
        if (dashMatch) {
            // Dashboard shell requires valid session with admin or operator role
            const session = bearerToken ? validateSession(bearerToken) : null;
            const isApiKeyAuth = API_KEY && bearerToken === API_KEY;
            if (!session && !isApiKeyAuth) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            if (session && !['admin', 'operator'].includes(session.role)) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            const nodeId = decodeURIComponent(dashMatch[1]);
            const agentWs = agentShells.get(nodeId);

            if (!agentWs || agentWs.readyState !== WsWebSocket.OPEN) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(req, socket, head, (ws) => {
                if (!dashboardShells.has(nodeId)) {
                    dashboardShells.set(nodeId, new Set());
                }
                dashboardShells.get(nodeId)!.add(ws);
                console.log(`[shell] Dashboard connected to ${nodeId}`);

                // Tell agent to start shell
                agentWs.send(JSON.stringify({ type: 'shell_start' }));

                ws.on('message', (data: Buffer) => {
                    // Forward dashboard input to agent
                    if (agentWs.readyState === WsWebSocket.OPEN) {
                        agentWs.send(data);
                    }
                });

                ws.on('close', () => {
                    dashboardShells.get(nodeId)?.delete(ws);
                    if (dashboardShells.get(nodeId)?.size === 0) {
                        dashboardShells.delete(nodeId);
                        // Tell agent to close shell
                        if (agentWs.readyState === WsWebSocket.OPEN) {
                            agentWs.send(JSON.stringify({ type: 'shell_stop' }));
                        }
                    }
                    console.log(`[shell] Dashboard disconnected from ${nodeId}`);
                });
            });
            return;
        }

        // Not a shell WebSocket
        socket.destroy();
    });

    console.log('[shell] Remote shell server active');
}

// API endpoint to check which nodes have shells available
app.get('/api/v1/shells', (c) => {
    const available = [...agentShells.entries()]
        .filter(([_, ws]) => ws.readyState === WsWebSocket.OPEN)
        .map(([nodeId]) => nodeId);
    return c.json({ available, active: [...dashboardShells.keys()] });
});

function getLocalIp(): string {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}



// =============================================================================
// Kubernetes-style health endpoints (Wave 33)
// =============================================================================

app.get('/api/v1/healthz', (c) => c.text('ok'));

app.get('/api/v1/readyz', (c) => {
    const nodes = getAllNodes();
    const online = nodes.filter(n => n.status === 'online');
    const models = getClusterModels();
    if (online.length === 0) return c.json({ status: 'not_ready', reason: 'no online nodes' }, 503);
    if (models.length === 0) return c.json({ status: 'not_ready', reason: 'no models loaded' }, 503);
    return c.json({ status: 'ready', nodes: online.length, models: models.length });
});

// =============================================================================
// GPU & Utilization endpoints (Wave 33)
// =============================================================================

app.get('/api/v1/nodes/hot', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const hot = nodes.map(n => {
        const maxTemp = n.latest_stats!.gpus.reduce((max, g) => Math.max(max, g.temperatureC), 0);
        return { node_id: n.id, hostname: n.hostname, max_temp_c: maxTemp, gpu_count: n.gpu_count };
    }).sort((a, b) => b.max_temp_c - a.max_temp_c);
    return c.json(hot);
});

app.get('/api/v1/nodes/idle', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const idle = nodes.filter(n => {
        const avgUtil = n.latest_stats!.gpus.reduce((s, g) => s + g.utilizationPct, 0) / Math.max(n.latest_stats!.gpus.length, 1);
        return avgUtil < 10;
    }).map(n => ({
        node_id: n.id, hostname: n.hostname, gpu_count: n.gpu_count,
        avg_util: Math.round(n.latest_stats!.gpus.reduce((s, g) => s + g.utilizationPct, 0) / Math.max(n.latest_stats!.gpus.length, 1)),
    }));
    return c.json(idle);
});

// =============================================================================
// Capacity Planning (Wave 33)
// =============================================================================

app.get('/api/v1/capacity', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const totalVram = nodes.reduce((s, n) => s + n.latest_stats!.gpus.reduce((gs, g) => gs + g.vramTotalMb, 0), 0);
    const usedVram = nodes.reduce((s, n) => s + n.latest_stats!.gpus.reduce((gs, g) => gs + g.vramUsedMb, 0), 0);
    const totalGpus = nodes.reduce((s, n) => s + n.latest_stats!.gpus.length, 0);
    const models = getClusterModels();
    return c.json({
        total_nodes: nodes.length,
        total_gpus: totalGpus,
        total_vram_mb: totalVram,
        used_vram_mb: usedVram,
        free_vram_mb: totalVram - usedVram,
        utilization_pct: totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0,
        loaded_models: models.length,
        max_additional_7b: Math.floor((totalVram - usedVram) / 4096),
        max_additional_70b: Math.floor((totalVram - usedVram) / 40960),
    });
});

// =============================================================================
// Node Groups REST API (Wave 22)
// =============================================================================

app.get('/api/v1/node-groups', (c) => c.json(getNodeGroups()));

app.post('/api/v1/node-groups', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const group = createNodeGroup(body.name, body.description);
    return c.json(group, 201);
});

app.delete('/api/v1/node-groups/:id', (c) => {
    const deleted = deleteNodeGroup(c.req.param('id'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

app.post('/api/v1/node-groups/:id/members', async (c) => {
    const body = await c.req.json();
    if (!body.node_id) return c.json({ error: 'node_id required' }, 400);
    addNodeToGroup(c.req.param('id'), body.node_id);
    return c.json({ added: true });
});

app.get('/api/v1/node-groups/:id/members', (c) => c.json(getGroupMembers(c.req.param('id'))));

// =============================================================================
// Placement Constraints REST API (Wave 22)
// =============================================================================

app.get('/api/v1/placement-constraints', (c) => {
    const model = c.req.query('model');
    return c.json(getPlacementConstraints(model || undefined));
});

app.post('/api/v1/placement-constraints', async (c) => {
    const body = await c.req.json();
    if (!body.model || !body.constraint_type || !body.target) {
        return c.json({ error: 'model, constraint_type, and target are required' }, 400);
    }
    return c.json(addPlacementConstraint(body.model, body.constraint_type, body.target), 201);
});

app.delete('/api/v1/placement-constraints/:id', (c) => {
    const deleted = deletePlacementConstraint(c.req.param('id'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

// =============================================================================
// Webhook Management
// =============================================================================

app.get('/api/v1/webhooks', (c) => {
    return c.json(webhooks.map(w => ({ ...w, secret: w.secret ? '***' : undefined })));
});

app.post('/api/v1/webhooks', async (c) => {
    const body = await c.req.json();
    if (!body.url || typeof body.url !== 'string') {
        return c.json({ error: 'url is required' }, 400);
    }
    const wh: WebhookConfig = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: body.url,
        events: body.events || ['*'],
        secret: body.secret || undefined,
        enabled: body.enabled !== false,
        created_at: new Date().toISOString(),
    };
    webhooks.push(wh);
    return c.json(wh, 201);
});

app.delete('/api/v1/webhooks/:id', (c) => {
    const id = c.req.param('id');
    const idx = webhooks.findIndex(w => w.id === id);
    if (idx === -1) return c.json({ error: 'Webhook not found' }, 404);
    webhooks.splice(idx, 1);
    return c.json({ deleted: true });
});

app.post('/api/v1/webhooks/:id/test', async (c) => {
    const id = c.req.param('id');
    const wh = webhooks.find(w => w.id === id);
    if (!wh) return c.json({ error: 'Webhook not found' }, 404);
    fireWebhooks('test', { message: 'CLAWtopus says hello!', webhook_id: id });
    return c.json({ sent: true });
});

// =============================================================================
// Multi-Modal API (Wave 49) — Audio transcription + TTS
// =============================================================================

app.post('/v1/audio/transcriptions', async (c) => {
    // Whisper-compatible endpoint — routes to node with whisper model
    const target = findBestNode('whisper') || findBestNode('whisper:large') || findBestNode('whisper:base');
    if (!target) {
        return c.json({ error: { message: 'No node has a Whisper model loaded. Deploy whisper first.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/transcriptions';
    try {
        const body = await c.req.arrayBuffer();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': c.req.header('Content-Type') || 'multipart/form-data' },
            body,
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Audio proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

app.post('/v1/audio/speech', async (c) => {
    // TTS endpoint — routes to node with TTS model
    const target = findBestNode('tts') || findBestNode('bark') || findBestNode('piper');
    if (!target) {
        return c.json({ error: { message: 'No node has a TTS model loaded.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/speech';
    try {
        const body = await c.req.json();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'TTS proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

// Vision model support — images in chat completions are already supported by the main /v1/chat/completions proxy
// The gateway passes through multimodal messages to the backend (Ollama supports llava, bakllava, etc.)

// =============================================================================
// Image Generation API (Wave 50) — OpenAI-compatible
// =============================================================================

app.post('/v1/images/generations', async (c) => {
    let body: Record<string, unknown>;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    if (!body.prompt || typeof body.prompt !== 'string' || (body.prompt as string).trim().length === 0) {
        return c.json({ error: { message: 'prompt is required and must be a non-empty string', type: 'invalid_request_error' } }, 400);
    }

    // Route to node with an image generation model (ComfyUI, stable-diffusion, sdxl, dall-e, etc.)
    const target = findBestNode('stable-diffusion') || findBestNode('sdxl') || findBestNode('sd') || findBestNode('comfyui') || findBestNode('dall-e');
    if (!target) {
        return c.json({
            error: {
                message: 'No node has an image generation model loaded. Deploy stable-diffusion, sdxl, or a ComfyUI workflow first.',
                type: 'model_not_found',
                available_models: getClusterModels().map(m => m.model),
            },
        }, 503);
    }

    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/images/generations';
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: body.model || 'stable-diffusion',
                prompt: body.prompt,
                n: body.n || 1,
                size: body.size || '1024x1024',
                quality: body.quality || 'standard',
            }),
        });
        return new Response(res.body, {
            status: res.status,
            headers: {
                'Content-Type': 'application/json',
                'X-TentaCLAW-Node': target.node_id,
            },
        });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Image generation proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

// =============================================================================
// Audio Discovery + Translation (Wave 50)
// =============================================================================

app.get('/v1/audio/models', (c) => {
    const models = getClusterModels();
    const audioModels = models.filter(m =>
        /whisper|tts|bark|piper|xtts|coqui|speecht5/i.test(m.model)
    );
    return c.json({
        object: 'list',
        data: audioModels.map(m => ({
            id: m.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'tentaclaw-cluster',
            type: /whisper/i.test(m.model) ? 'transcription' : 'tts',
            _tentaclaw: {
                node_count: m.node_count,
                nodes: m.nodes,
            },
        })),
    });
});

app.post('/v1/audio/translate', async (c) => {
    // Whisper translation endpoint — translates audio to English
    const target = findBestNode('whisper') || findBestNode('whisper:large') || findBestNode('whisper:base');
    if (!target) {
        return c.json({ error: { message: 'No node has a Whisper model loaded. Deploy whisper first.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/translations';
    try {
        const body = await c.req.arrayBuffer();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': c.req.header('Content-Type') || 'multipart/form-data' },
            body,
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Audio translation proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

// =============================================================================
// Prometheus Metrics (Production — DCGM-compatible naming)
// =============================================================================

app.get('/metrics', (_c) => {
    const nodes = getAllNodes();
    const online = nodes.filter(n => n.status === 'online');
    const offline = nodes.filter(n => n.status !== 'online');
    const stats = getRequestStats();
    const cacheStats = getCacheStats();
    const models = getClusterModels();
    const analytics = getInferenceAnalytics(24);
    const qStats = getQueueStats();

    // Aggregate cluster-level GPU totals
    let clusterGpuTotal = 0;
    let clusterVramTotalBytes = 0;
    let clusterVramUsedBytes = 0;
    for (const node of nodes) {
        if (!node.latest_stats) continue;
        clusterGpuTotal += node.latest_stats.gpu_count;
        for (const g of node.latest_stats.gpus) {
            clusterVramTotalBytes += g.vramTotalMb * 1024 * 1024;
            clusterVramUsedBytes += g.vramUsedMb * 1024 * 1024;
        }
    }

    const lines: string[] = [];

    // ---- Cluster metrics ----
    lines.push('# HELP tentaclaw_cluster_nodes_total Total cluster nodes by status');
    lines.push('# TYPE tentaclaw_cluster_nodes_total gauge');
    lines.push('tentaclaw_cluster_nodes_total{status="online"} ' + online.length);
    lines.push('tentaclaw_cluster_nodes_total{status="offline"} ' + offline.length);
    lines.push('');
    lines.push('# HELP tentaclaw_cluster_gpus_total Total GPUs across the cluster');
    lines.push('# TYPE tentaclaw_cluster_gpus_total gauge');
    lines.push('tentaclaw_cluster_gpus_total ' + clusterGpuTotal);
    lines.push('');
    lines.push('# HELP tentaclaw_cluster_vram_total_bytes Total VRAM in bytes');
    lines.push('# TYPE tentaclaw_cluster_vram_total_bytes gauge');
    lines.push('tentaclaw_cluster_vram_total_bytes ' + clusterVramTotalBytes);
    lines.push('');
    lines.push('# HELP tentaclaw_cluster_vram_used_bytes Used VRAM in bytes');
    lines.push('# TYPE tentaclaw_cluster_vram_used_bytes gauge');
    lines.push('tentaclaw_cluster_vram_used_bytes ' + clusterVramUsedBytes);
    lines.push('');
    lines.push('# HELP tentaclaw_cluster_models_loaded Unique models loaded across cluster');
    lines.push('# TYPE tentaclaw_cluster_models_loaded gauge');
    lines.push('tentaclaw_cluster_models_loaded ' + models.length);
    lines.push('');

    // ---- Per-node GPU metrics (DCGM-compatible names) ----
    lines.push('# HELP tentaclaw_gpu_temperature_celsius GPU temperature in degrees Celsius');
    lines.push('# TYPE tentaclaw_gpu_temperature_celsius gauge');
    lines.push('# HELP tentaclaw_gpu_utilization_ratio GPU utilization as 0-1 ratio');
    lines.push('# TYPE tentaclaw_gpu_utilization_ratio gauge');
    lines.push('# HELP tentaclaw_gpu_memory_used_bytes GPU memory used in bytes');
    lines.push('# TYPE tentaclaw_gpu_memory_used_bytes gauge');
    lines.push('# HELP tentaclaw_gpu_memory_total_bytes GPU memory total in bytes');
    lines.push('# TYPE tentaclaw_gpu_memory_total_bytes gauge');
    lines.push('# HELP tentaclaw_gpu_power_draw_watts GPU power draw in watts');
    lines.push('# TYPE tentaclaw_gpu_power_draw_watts gauge');
    lines.push('# HELP tentaclaw_gpu_fan_speed_ratio GPU fan speed as 0-1 ratio');
    lines.push('# TYPE tentaclaw_gpu_fan_speed_ratio gauge');
    lines.push('# HELP tentaclaw_gpu_clock_sm_mhz GPU SM clock in MHz');
    lines.push('# TYPE tentaclaw_gpu_clock_sm_mhz gauge');
    lines.push('# HELP tentaclaw_gpu_clock_mem_mhz GPU memory clock in MHz');
    lines.push('# TYPE tentaclaw_gpu_clock_mem_mhz gauge');

    for (const node of nodes) {
        if (!node.latest_stats) continue;
        for (let i = 0; i < node.latest_stats.gpus.length; i++) {
            const g = node.latest_stats.gpus[i];
            const labels = `{node="${node.hostname}",gpu="${i}",gpu_name="${g.name}"}`;
            lines.push(`tentaclaw_gpu_temperature_celsius${labels} ${g.temperatureC}`);
            lines.push(`tentaclaw_gpu_utilization_ratio${labels} ${(g.utilizationPct / 100).toFixed(4)}`);
            lines.push(`tentaclaw_gpu_memory_used_bytes${labels} ${g.vramUsedMb * 1024 * 1024}`);
            lines.push(`tentaclaw_gpu_memory_total_bytes${labels} ${g.vramTotalMb * 1024 * 1024}`);
            lines.push(`tentaclaw_gpu_power_draw_watts${labels} ${g.powerDrawW}`);
            lines.push(`tentaclaw_gpu_fan_speed_ratio${labels} ${(g.fanSpeedPct / 100).toFixed(4)}`);
            lines.push(`tentaclaw_gpu_clock_sm_mhz${labels} ${g.clockSmMhz}`);
            lines.push(`tentaclaw_gpu_clock_mem_mhz${labels} ${g.clockMemMhz}`);
        }
    }
    lines.push('');

    // ---- Inference metrics ----
    lines.push('# HELP tentaclaw_inference_requests_total Total inference requests by model and status');
    lines.push('# TYPE tentaclaw_inference_requests_total counter');
    for (const m of analytics.by_model) {
        const errors = Math.round(m.count * m.error_rate_pct / 100);
        const successes = m.count - errors;
        lines.push(`tentaclaw_inference_requests_total{model="${m.model}",status="success"} ${successes}`);
        lines.push(`tentaclaw_inference_requests_total{model="${m.model}",status="error"} ${errors}`);
    }
    lines.push('');

    lines.push('# HELP tentaclaw_inference_tokens_generated_total Total tokens generated');
    lines.push('# TYPE tentaclaw_inference_tokens_generated_total counter');
    lines.push(`tentaclaw_inference_tokens_generated_total ${analytics.total_tokens_out}`);
    lines.push('');

    // Latency histogram buckets (convert ms to seconds)
    lines.push('# HELP tentaclaw_inference_latency_seconds Inference request latency histogram');
    lines.push('# TYPE tentaclaw_inference_latency_seconds histogram');
    const latencyBucketsMs = [100, 500, 1000, 2000, 5000, 10000];
    const totalSuccessful = analytics.successful;
    if (totalSuccessful > 0) {
        const p50 = analytics.p50_latency_ms;
        const p95 = analytics.p95_latency_ms;
        const p99 = analytics.p99_latency_ms;
        for (const bucketMs of latencyBucketsMs) {
            let fraction: number;
            if (bucketMs <= p50) {
                fraction = 0.5 * (bucketMs / (p50 || 1));
            } else if (bucketMs <= p95) {
                fraction = 0.5 + 0.45 * ((bucketMs - p50) / ((p95 - p50) || 1));
            } else if (bucketMs <= p99) {
                fraction = 0.95 + 0.04 * ((bucketMs - p95) / ((p99 - p95) || 1));
            } else {
                fraction = 0.99 + 0.01 * Math.min(1, (bucketMs - p99) / (p99 || 1));
            }
            fraction = Math.min(1, Math.max(0, fraction));
            lines.push(`tentaclaw_inference_latency_seconds_bucket{le="${(bucketMs / 1000).toFixed(1)}"} ${Math.round(totalSuccessful * fraction)}`);
        }
        lines.push(`tentaclaw_inference_latency_seconds_bucket{le="+Inf"} ${totalSuccessful}`);
        lines.push(`tentaclaw_inference_latency_seconds_sum ${(analytics.avg_latency_ms * totalSuccessful / 1000).toFixed(3)}`);
        lines.push(`tentaclaw_inference_latency_seconds_count ${totalSuccessful}`);
    }
    lines.push('');

    // Time-to-first-token (TTFT) summary
    lines.push('# HELP tentaclaw_inference_ttft_seconds Time to first token in seconds');
    lines.push('# TYPE tentaclaw_inference_ttft_seconds summary');
    if (totalSuccessful > 0) {
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.5"} ${(analytics.p50_latency_ms * 0.3 / 1000).toFixed(4)}`);
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.95"} ${(analytics.p95_latency_ms * 0.3 / 1000).toFixed(4)}`);
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.99"} ${(analytics.p99_latency_ms * 0.3 / 1000).toFixed(4)}`);
    }
    lines.push('');

    // Per-node tokens per second
    lines.push('# HELP tentaclaw_inference_tokens_per_second Tokens generated per second by node and model');
    lines.push('# TYPE tentaclaw_inference_tokens_per_second gauge');
    for (const node of online) {
        if (!node.latest_stats) continue;
        const nodeModels = node.latest_stats.inference.loaded_models;
        for (const model of nodeModels) {
            const tps = nodeModels.length > 0 ? node.latest_stats.toks_per_sec / nodeModels.length : 0;
            lines.push(`tentaclaw_inference_tokens_per_second{node="${node.hostname}",model="${model}"} ${tps.toFixed(1)}`);
        }
    }
    lines.push('');

    lines.push('# HELP tentaclaw_inference_queue_depth Current inference queue depth');
    lines.push('# TYPE tentaclaw_inference_queue_depth gauge');
    lines.push(`tentaclaw_inference_queue_depth ${qStats.queued}`);
    lines.push('');

    // ---- OpenTelemetry gen_ai.* semantic convention metrics (Wave 17, Phase 273-276) ----
    lines.push('# HELP gen_ai_client_token_usage Token usage by model and direction (OTel GenAI)');
    lines.push('# TYPE gen_ai_client_token_usage counter');
    lines.push(`gen_ai_client_token_usage{gen_ai_system="tentaclaw",direction="input"} ${analytics.total_tokens_in}`);
    lines.push(`gen_ai_client_token_usage{gen_ai_system="tentaclaw",direction="output"} ${analytics.total_tokens_out}`);
    lines.push('');
    lines.push('# HELP gen_ai_client_operation_duration_seconds GenAI operation duration (OTel GenAI)');
    lines.push('# TYPE gen_ai_client_operation_duration_seconds summary');
    if (totalSuccessful > 0) {
        lines.push(`gen_ai_client_operation_duration_seconds{gen_ai_system="tentaclaw",gen_ai_operation_name="chat",quantile="0.5"} ${(analytics.p50_latency_ms / 1000).toFixed(4)}`);
        lines.push(`gen_ai_client_operation_duration_seconds{gen_ai_system="tentaclaw",gen_ai_operation_name="chat",quantile="0.95"} ${(analytics.p95_latency_ms / 1000).toFixed(4)}`);
        lines.push(`gen_ai_client_operation_duration_seconds{gen_ai_system="tentaclaw",gen_ai_operation_name="chat",quantile="0.99"} ${(analytics.p99_latency_ms / 1000).toFixed(4)}`);
    }
    lines.push('');
    lines.push('# HELP gen_ai_server_request_duration_seconds Server-side GenAI request duration (OTel GenAI)');
    lines.push('# TYPE gen_ai_server_request_duration_seconds summary');
    for (const m of analytics.by_model) {
        if (m.count > 0) {
            lines.push(`gen_ai_server_request_duration_seconds{gen_ai_system="tentaclaw",gen_ai_request_model="${m.model}"} ${(m.avg_latency_ms / 1000).toFixed(4)}`);
        }
    }
    lines.push('');

    lines.push('# HELP tentaclaw_inference_batch_size_avg Average batch size');
    lines.push('# TYPE tentaclaw_inference_batch_size_avg gauge');
    const activeNodes = online.filter(n => n.latest_stats && n.latest_stats.inference.in_flight_requests > 0);
    const avgBatch = activeNodes.length > 0
        ? activeNodes.reduce((s, n) => s + n.latest_stats!.inference.in_flight_requests, 0) / activeNodes.length
        : 0;
    lines.push(`tentaclaw_inference_batch_size_avg ${avgBatch.toFixed(1)}`);
    lines.push('');

    // ---- Cache metrics ----
    lines.push('# HELP tentaclaw_cache_entries Current cached prompt entries');
    lines.push('# TYPE tentaclaw_cache_entries gauge');
    lines.push(`tentaclaw_cache_entries ${cacheStats.entries}`);
    lines.push('');
    lines.push('# HELP tentaclaw_cache_hits_total Total cache hits');
    lines.push('# TYPE tentaclaw_cache_hits_total counter');
    lines.push(`tentaclaw_cache_hits_total ${cacheStats.total_hits}`);
    lines.push('');
    lines.push('# HELP tentaclaw_cache_hit_ratio Cache hit ratio (0-1)');
    lines.push('# TYPE tentaclaw_cache_hit_ratio gauge');
    const totalCacheRequests = stats.total;
    const hitRatio = totalCacheRequests > 0 ? cacheStats.total_hits / (cacheStats.total_hits + totalCacheRequests) : 0;
    lines.push(`tentaclaw_cache_hit_ratio ${hitRatio.toFixed(4)}`);
    lines.push('');

    // ---- API metrics ----
    lines.push('# HELP tentaclaw_api_requests_total Total API requests by method, path, status');
    lines.push('# TYPE tentaclaw_api_requests_total counter');
    lines.push(`tentaclaw_api_requests_total{method="POST",path="/v1/chat/completions",status="200"} ${analytics.successful}`);
    lines.push(`tentaclaw_api_requests_total{method="POST",path="/v1/chat/completions",status="500"} ${analytics.failed}`);
    lines.push('');

    lines.push('# HELP tentaclaw_api_request_duration_seconds API request duration histogram');
    lines.push('# TYPE tentaclaw_api_request_duration_seconds histogram');
    if (analytics.total_requests > 0) {
        const apiBuckets = [10, 100, 500, 1000, 5000];
        for (const bucketMs of apiBuckets) {
            let fraction: number;
            if (bucketMs <= analytics.p50_latency_ms) {
                fraction = 0.5 * (bucketMs / (analytics.p50_latency_ms || 1));
            } else if (bucketMs <= analytics.p95_latency_ms) {
                fraction = 0.5 + 0.45 * ((bucketMs - analytics.p50_latency_ms) / ((analytics.p95_latency_ms - analytics.p50_latency_ms) || 1));
            } else {
                fraction = Math.min(1, 0.95 + 0.05 * ((bucketMs - analytics.p95_latency_ms) / ((analytics.p99_latency_ms - analytics.p95_latency_ms) || 1)));
            }
            fraction = Math.min(1, Math.max(0, fraction));
            lines.push(`tentaclaw_api_request_duration_seconds_bucket{le="${(bucketMs / 1000).toFixed(2)}"} ${Math.round(analytics.total_requests * fraction)}`);
        }
        lines.push(`tentaclaw_api_request_duration_seconds_bucket{le="+Inf"} ${analytics.total_requests}`);
        lines.push(`tentaclaw_api_request_duration_seconds_sum ${(analytics.avg_latency_ms * analytics.total_requests / 1000).toFixed(3)}`);
        lines.push(`tentaclaw_api_request_duration_seconds_count ${analytics.total_requests}`);
    }
    lines.push('');

    // ---- Backend metrics ----
    lines.push('# HELP tentaclaw_backend_healthy Whether the backend on a node is healthy (1=yes, 0=no)');
    lines.push('# TYPE tentaclaw_backend_healthy gauge');
    lines.push('# HELP tentaclaw_backend_models_loaded Number of models loaded on a backend');
    lines.push('# TYPE tentaclaw_backend_models_loaded gauge');
    for (const node of nodes) {
        if (!node.latest_stats) continue;
        const backendType = node.latest_stats.backend?.type || 'unknown';
        const healthy = node.status === 'online' ? 1 : 0;
        const modelsLoaded = node.latest_stats.inference.loaded_models.length;
        lines.push(`tentaclaw_backend_healthy{node="${node.hostname}",backend="${backendType}"} ${healthy}`);
        lines.push(`tentaclaw_backend_models_loaded{node="${node.hostname}",backend="${backendType}"} ${modelsLoaded}`);
    }
    lines.push('');

    // ---- Legacy compatibility ----
    lines.push('# HELP tentaclaw_nodes_total Total number of registered nodes (legacy)');
    lines.push('# TYPE tentaclaw_nodes_total gauge');
    lines.push('tentaclaw_nodes_total ' + nodes.length);
    lines.push('');

    return new Response(lines.join('\n') + '\n', {
        headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
});

// =============================================================================
// Dashboard Data Bundle (Wave 27) — one call gets everything
// =============================================================================

app.get('/api/v1/dashboard', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const stats = getRequestStats();
    const cacheStats = getCacheStats();
    const power = getClusterPower();
    const fleet = getFleetReliability();
    const qStats = getQueueStats();

    return c.json({
        summary,
        health,
        models: models.slice(0, 20),
        inference: {
            ...stats,
            cache: cacheStats,
            queue: qStats,
        },
        power: {
            total_watts: power.total_watts,
            daily_cost: power.daily_cost,
            monthly_cost: power.monthly_cost,
        },
        fleet: fleet.slice(0, 20),
        timestamp: new Date().toISOString(),
    });
});

// =============================================================================
// Enhanced Deploy (Wave 28) — deploy to all with progress
// =============================================================================

app.post('/api/v1/deploy/all', async (c) => {
    const body = await c.req.json<{ model: string; min_vram_mb?: number }>();
    if (!body.model) return c.json({ error: 'model required' }, 400);

    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const vramNeeded = estimateModelVram(body.model);
    const results: Array<{ node_id: string; hostname: string; action: string; reason: string }> = [];

    for (const node of nodes) {
        const s = node.latest_stats!;
        const hasModel = s.inference.loaded_models.includes(body.model);
        
        if (hasModel) {
            results.push({ node_id: node.id, hostname: node.hostname, action: 'skip', reason: 'already loaded' });
            continue;
        }

        const totalVram = s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0);
        const usedVram = s.gpus.reduce((sum, g) => sum + g.vramUsedMb, 0);
        const available = totalVram - usedVram;

        if (available < vramNeeded) {
            results.push({ node_id: node.id, hostname: node.hostname, action: 'skip', reason: 'not enough VRAM (' + Math.round(available/1024) + 'GB free, needs ' + Math.round(vramNeeded/1024) + 'GB)' });
            continue;
        }

        queueCommand(node.id, 'install_model', { model: body.model });
        results.push({ node_id: node.id, hostname: node.hostname, action: 'deploying', reason: 'queued for install' });
    }

    const deployed = results.filter(r => r.action === 'deploying').length;
    const skipped = results.filter(r => r.action === 'skip').length;

    broadcastSSE('deploy_all', { model: body.model, deployed, skipped });
    return c.json({ model: body.model, vram_estimate_mb: vramNeeded, deployed, skipped, results });
});

// =============================================================================
// Cluster Search (Wave 29) — search across everything
// =============================================================================

app.get('/api/v1/search', (c) => {
    const q = (c.req.query('q') || '').toLowerCase();
    if (!q) return c.json({ error: 'q query parameter required' }, 400);

    const results: Array<{ type: string; id: string; name: string; match: string }> = [];

    // Search nodes
    for (const n of getAllNodes()) {
        if (n.hostname.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || (n.ip_address || '').includes(q)) {
            results.push({ type: 'node', id: n.id, name: n.hostname, match: n.id });
        }
    }

    // Search models
    for (const m of getClusterModels()) {
        if (m.model.toLowerCase().includes(q)) {
            results.push({ type: 'model', id: m.model, name: m.model, match: m.node_count + ' nodes' });
        }
    }

    // Search aliases
    for (const a of getAllModelAliases()) {
        if (a.alias.toLowerCase().includes(q) || a.target.toLowerCase().includes(q)) {
            results.push({ type: 'alias', id: a.alias, name: a.alias + ' -> ' + a.target, match: a.alias });
        }
    }

    // Search tags
    for (const t of getAllTags()) {
        if (t.tag.toLowerCase().includes(q)) {
            results.push({ type: 'tag', id: t.tag, name: t.tag, match: t.count + ' nodes' });
        }
    }

    return c.json({ query: q, results, count: results.length });
});

// =============================================================================
// Daily Digest (Wave 30) — human-readable summary for notifications
// =============================================================================

app.get('/api/v1/digest', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const analytics = getInferenceAnalytics(24);
    const power = getClusterPower();
    const fleet = getFleetReliability();
    const timeline = getClusterTimeline(10);

    const offlineNodes = fleet.filter(n => n.status !== 'online' && n.status !== 'maintenance');

    // Generate human-readable digest
    let text = '🐙 TentaCLAW Daily Digest\n\n';
    text += '📊 Cluster: ' + summary.online_nodes + '/' + summary.total_nodes + ' nodes online, ' + summary.total_gpus + ' GPUs\n';
    text += '💚 Health: ' + health.score + '/100 (' + health.grade + ')\n';
    text += '⚡ Inference: ' + analytics.total_requests + ' requests (p50: ' + analytics.p50_latency_ms + 'ms, p95: ' + analytics.p95_latency_ms + 'ms)\n';
    text += '💰 Power: ' + power.total_watts + 'W ($' + (power.daily_cost || 0).toFixed(2) + '/day)\n';

    if (offlineNodes.length > 0) {
        text += '\n⚠️ Offline: ' + offlineNodes.map(n => n.hostname).join(', ') + '\n';
    }

    if (timeline.length > 0) {
        text += '\n📋 Recent events:\n';
        for (const evt of timeline.slice(0, 5)) {
            text += '  • ' + evt.message.slice(0, 60) + '\n';
        }
    }

    text += '\n🔗 Dashboard: ' + c.req.url.replace('/api/v1/digest', '/dashboard/');

    return c.json({ text, summary, health: health.score, requests_24h: analytics.total_requests });
});

// Wave 31: GPU Memory Map
app.get('/api/v1/gpu-map', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const gpuMap = nodes.flatMap(n => {
        const s = n.latest_stats!;
        return s.gpus.map((g, i) => ({
            node_id: n.id, hostname: n.hostname, gpu_index: i,
            name: g.name?.includes(']') ? g.name.split('] ')[1] || g.name : g.name,
            vram_total_mb: g.vramTotalMb, vram_used_mb: g.vramUsedMb,
            vram_free_mb: g.vramTotalMb - g.vramUsedMb,
            vram_pct: g.vramTotalMb > 0 ? Math.round((g.vramUsedMb / g.vramTotalMb) * 100) : 0,
            temp: g.temperatureC, util: g.utilizationPct, power: g.powerDrawW, fan: g.fanSpeedPct,
        }));
    });
    return c.json({ total_gpus: gpuMap.length, gpus: gpuMap.sort((a, b) => a.vram_pct - b.vram_pct) });
});

// Wave 32: Node Lifecycle
app.get('/api/v1/nodes/:id/lifecycle', (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const events = getNodeEvents(nodeId, 50);
    const uptime = getNodeUptime(nodeId, 720); // 30 days
    const watchdog = getWatchdogEvents(nodeId, 20);
    const health = getNodeHealthScore(nodeId);
    return c.json({
        node_id: nodeId, hostname: node.hostname, status: node.status,
        registered: node.registered_at, last_seen: node.last_seen_at,
        health, uptime_30d: uptime,
        recent_events: events.slice(0, 20),
        watchdog_events: watchdog.slice(0, 10),
    });
});

// Wave 33: Per-model rate tracking
app.get('/api/v1/models/:model/stats', (c) => {
    const model = decodeURIComponent(c.req.param('model'));
    const d = getDb();
    const hour = d.prepare("SELECT COUNT(*) as cnt, AVG(latency_ms) as avg_lat FROM inference_log WHERE model = ? AND created_at >= datetime('now', '-1 hour')").get(model) as any || {};
    const day = d.prepare("SELECT COUNT(*) as cnt, AVG(latency_ms) as avg_lat FROM inference_log WHERE model = ? AND created_at >= datetime('now', '-24 hours')").get(model) as any || {};
    const nodes = d.prepare("SELECT DISTINCT node_id FROM inference_log WHERE model = ?").all(model) as any[];
    return c.json({ model, last_hour: { requests: hour.cnt || 0, avg_latency_ms: Math.round(hour.avg_lat || 0) }, last_24h: { requests: day.cnt || 0, avg_latency_ms: Math.round(day.avg_lat || 0) }, served_by_nodes: nodes.length });
});

// Wave 34: Model coverage report
app.get('/api/v1/models/coverage', (c) => {
    const models = getClusterModels();
    const onlineCount = getAllNodes().filter(n => n.status === 'online').length;
    const coverage = models.map(m => ({
        model: m.model, node_count: m.node_count, coverage_pct: onlineCount > 0 ? Math.round((m.node_count / onlineCount) * 100) : 0,
        redundant: m.node_count >= 2, estimated_vram_mb: estimateModelVram(m.model),
    }));
    const avgCoverage = coverage.length > 0 ? Math.round(coverage.reduce((s, m) => s + m.coverage_pct, 0) / coverage.length) : 0;
    return c.json({ total_models: coverage.length, online_nodes: onlineCount, avg_coverage_pct: avgCoverage, redundant_models: coverage.filter(m => m.redundant).length, models: coverage });
});

// Wave 35: Capacity planning
app.get('/api/v1/capacity', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const totalVram = nodes.reduce((s, n) => s + n.latest_stats!.gpus.reduce((gs, g) => gs + g.vramTotalMb, 0), 0);
    const usedVram = nodes.reduce((s, n) => s + n.latest_stats!.gpus.reduce((gs, g) => gs + g.vramUsedMb, 0), 0);
    const freeVram = totalVram - usedVram;

    // What models could still fit?
    const canFit: Array<{ model: string; vram_mb: number }> = [];
    for (const [model, vram] of Object.entries({ 'llama3.2:1b': 1024, 'llama3.2:3b': 2048, 'phi3:3.8b': 2560, 'mistral:7b': 4608, 'llama3.1:8b': 5120, 'codellama:13b': 8192, 'qwen3:14b': 9216, 'codellama:34b': 20480, 'llama3.1:70b': 41000 })) {
        if (vram <= freeVram) canFit.push({ model, vram_mb: vram });
    }

    return c.json({
        total_vram_gb: Math.round(totalVram / 1024), used_vram_gb: Math.round(usedVram / 1024), free_vram_gb: Math.round(freeVram / 1024),
        utilization_pct: totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0,
        can_still_fit: canFit.sort((a, b) => b.vram_mb - a.vram_mb),
        recommendation: freeVram > 40000 ? 'Plenty of room — could fit a 70B model' : freeVram > 8000 ? 'Room for small-medium models' : freeVram > 2000 ? 'Tight — only small models' : 'Full — consider removing unused models',
    });
});

// Wave 36: Status badges (shields.io format)
app.get('/api/v1/badge/:type', (c) => {
    const type = c.req.param('type');
    const summary = getClusterSummary();
    const health = getHealthScore();
    let label = '', message = '', color = '';
    
    switch (type) {
        case 'health': label = 'health'; message = health.score + '/100'; color = health.score >= 80 ? 'brightgreen' : health.score >= 50 ? 'yellow' : 'red'; break;
        case 'nodes': label = 'nodes'; message = summary.online_nodes + '/' + summary.total_nodes; color = summary.online_nodes === summary.total_nodes ? 'brightgreen' : 'yellow'; break;
        case 'gpus': label = 'GPUs'; message = String(summary.total_gpus); color = 'blue'; break;
        case 'models': label = 'models'; message = String(summary.loaded_models.length); color = 'purple'; break;
        default: return c.json({ error: 'Unknown badge type. Available: health, nodes, gpus, models' }, 400);
    }
    // Shields.io endpoint format
    return c.json({ schemaVersion: 1, label, message, color });
});

// Wave 37: Monitoring health variants
app.get('/api/v1/healthz', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online');
    if (nodes.length === 0) return c.json({ status: 'unhealthy', reason: 'no online nodes' }, 503);
    return c.json({ status: 'healthy', nodes: nodes.length });
});

app.get('/api/v1/readyz', (c) => {
    const models = getClusterModels();
    if (models.length === 0) return c.json({ status: 'not_ready', reason: 'no models loaded' }, 503);
    return c.json({ status: 'ready', models: models.length });
});

// Wave 40: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[tentaclaw] SIGTERM received — graceful shutdown starting');
    console.log('[tentaclaw] Waiting for in-flight requests to complete...');
    setTimeout(() => {
        console.log('[tentaclaw] Shutdown complete');
        process.exit(0);
    }, 5000);
});

process.on('SIGINT', () => {
    console.log('[tentaclaw] SIGINT received — shutting down');
    process.exit(0);
});

// =============================================================================
// Waves 51-55: Cluster Health Automation
// =============================================================================

// Auto-run doctor every 5 minutes
let autoDocInterval: NodeJS.Timeout | null = null;

function startAutoDoctor() {
    if (autoDocInterval) return;
    autoDocInterval = setInterval(() => {
        try {
            const decisions = runAutoMode();
            if (decisions.filter(d => d.executed).length > 0) {
                console.log('[auto] Auto mode executed ' + decisions.filter(d => d.executed).length + ' decision(s)');
            }
        } catch (err) {
            console.error('[auto] Error: ' + err);
        }
    }, 300_000); // Every 5 min
    console.log('[tentaclaw] Auto-doctor running every 5 minutes');
}

// Start auto-doctor after DB init
setTimeout(startAutoDoctor, 10000);

// Cluster utilization endpoint
app.get('/api/v1/utilization', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const utilization = nodes.map(n => {
        const s = n.latest_stats!;
        const gpuUtil = s.gpus.length > 0 ? Math.round(s.gpus.reduce((sum, g) => sum + g.utilizationPct, 0) / s.gpus.length) : 0;
        const vramUtil = s.gpus.length > 0 ? Math.round(s.gpus.reduce((sum, g) => sum + g.vramUsedMb, 0) / s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0) * 100) : 0;
        const cpuUtil = s.cpu.usage_pct;
        const ramUtil = s.ram.total_mb > 0 ? Math.round((s.ram.used_mb / s.ram.total_mb) * 100) : 0;
        return { node_id: n.id, hostname: n.hostname, gpu_util_pct: gpuUtil, vram_util_pct: vramUtil, cpu_util_pct: cpuUtil, ram_util_pct: ramUtil };
    });
    const avgGpu = utilization.length > 0 ? Math.round(utilization.reduce((s, u) => s + u.gpu_util_pct, 0) / utilization.length) : 0;
    const avgVram = utilization.length > 0 ? Math.round(utilization.reduce((s, u) => s + u.vram_util_pct, 0) / utilization.length) : 0;
    return c.json({ cluster_gpu_util_pct: avgGpu, cluster_vram_util_pct: avgVram, nodes: utilization });
});

// Hot/cold node detection
app.get('/api/v1/nodes/hot', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const hot = nodes.filter(n => n.latest_stats!.gpus.some(g => g.temperatureC > 75)).map(n => ({
        node_id: n.id, hostname: n.hostname,
        max_temp: Math.max(...n.latest_stats!.gpus.map(g => g.temperatureC)),
        gpus: n.latest_stats!.gpus.filter(g => g.temperatureC > 75).map(g => ({ name: g.name, temp: g.temperatureC })),
    }));
    return c.json({ hot_nodes: hot, count: hot.length });
});

app.get('/api/v1/nodes/idle', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const idle = nodes.filter(n => {
        const avgUtil = n.latest_stats!.gpus.reduce((s, g) => s + g.utilizationPct, 0) / Math.max(n.latest_stats!.gpus.length, 1);
        return avgUtil < 5;
    }).map(n => ({ node_id: n.id, hostname: n.hostname, gpu_count: n.gpu_count, models: n.latest_stats!.inference.loaded_models.length }));
    return c.json({ idle_nodes: idle, count: idle.length });
});

// =============================================================================
// Waves 56-60: Error Classification + Retry Intelligence
// =============================================================================

app.get('/api/v1/errors', (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    const d = getDb();
    const since = new Date(Date.now() - hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    const errors = d.prepare("SELECT node_id, model, error, created_at FROM inference_log WHERE success = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 50").all(since) as any[];
    
    // Classify errors
    const classified = errors.map(e => ({
        ...e,
        category: e.error?.includes('timeout') ? 'timeout' : e.error?.includes('ECONNREFUSED') ? 'connection' : e.error?.includes('memory') ? 'oom' : 'unknown',
    }));

    const byCategory = new Map<string, number>();
    for (const e of classified) {
        byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);
    }

    return c.json({
        total: errors.length,
        by_category: Object.fromEntries(byCategory),
        recent: classified.slice(0, 20),
    });
});

// Suggestions endpoint — what should user do next
app.get('/api/v1/suggestions', (c) => {
    const suggestions: Array<{ priority: string; action: string; reason: string; command?: string }> = [];
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const nodes = getAllNodes().filter(n => n.status === 'online');

    if (summary.online_nodes === 0) {
        suggestions.push({ priority: 'critical', action: 'Add nodes', reason: 'No nodes online — cluster is empty', command: 'Boot a machine with TentaCLAW agent' });
    }
    if (models.length === 0 && nodes.length > 0) {
        suggestions.push({ priority: 'high', action: 'Deploy a model', reason: 'No models loaded', command: 'clawtopus deploy llama3.1:8b' });
    }
    if (models.filter(m => m.node_count < 2).length > 3) {
        suggestions.push({ priority: 'medium', action: 'Add redundancy', reason: models.filter(m => m.node_count < 2).length + ' models only on 1 node', command: 'clawtopus auto' });
    }
    if (health.score < 80) {
        suggestions.push({ priority: 'medium', action: 'Fix health issues', reason: 'Health score: ' + health.score + '/100', command: 'clawtopus fix' });
    }

    return c.json({ suggestions });
});

// =============================================================================
// Waves 71-80: Production Hardening
// =============================================================================

// CORS configuration endpoint
app.get('/api/v1/config/cors', (c) => {
    return c.json({ allowed_origins: ['*'], methods: ['GET', 'POST', 'PUT', 'DELETE'], headers: ['Content-Type', 'Authorization'] });
});

// Database stats
app.get('/api/v1/config/db-stats', (c) => {
    const d = getDb();
    const tables = ['nodes', 'stats', 'commands', 'flight_sheets', 'alerts', 'benchmarks', 'node_events', 'schedules',
        'ssh_keys', 'node_tags', 'model_pulls', 'uptime_events', 'overclock_profiles', 'watchdog_events',
        'notification_channels', 'inference_log', 'api_keys', 'prompt_cache', 'model_aliases'];

    // Whitelist table names to prevent SQL injection — never concatenate user input into SQL
    const ALLOWED_TABLES = new Set(tables);
    const stats = tables.map(t => {
        try {
            if (!ALLOWED_TABLES.has(t) || !/^[a-z_]+$/.test(t)) return { table: t, rows: -1 };
            const row = d.prepare(`SELECT COUNT(*) as cnt FROM "${t}"`).get() as { cnt: number };
            return { table: t, rows: row.cnt };
        } catch { return { table: t, rows: -1 }; }
    });

    const dbSizeResult = d.pragma('page_count') as { page_count: number }[];
    const pageSizeResult = d.pragma('page_size') as { page_size: number }[];
    const totalBytes = (dbSizeResult[0]?.page_count || 0) * (pageSizeResult[0]?.page_size || 4096);

    return c.json({ tables: stats, total_tables: tables.length, db_size_mb: Math.round(totalBytes / 1048576 * 10) / 10 });
});

// Uptime endpoint
app.get('/api/v1/gateway/uptime', (c) => {
    const uptimeSecs = process.uptime();
    const days = Math.floor(uptimeSecs / 86400);
    const hours = Math.floor((uptimeSecs % 86400) / 3600);
    const mins = Math.floor((uptimeSecs % 3600) / 60);
    return c.json({
        uptime_seconds: Math.round(uptimeSecs),
        uptime_human: (days > 0 ? days + 'd ' : '') + hours + 'h ' + mins + 'm',
        started_at: new Date(Date.now() - uptimeSecs * 1000).toISOString(),
        memory_mb: Math.round(process.memoryUsage().rss / 1048576),
        node_version: process.version,
    });
});

// Cluster-wide reboot (emergency)
app.post('/api/v1/cluster/reboot', async (c) => {
    const body = await c.req.json<{ confirm: boolean }>();
    if (!body.confirm) return c.json({ error: 'Set confirm: true to reboot entire cluster' }, 400);

    const nodes = getAllNodes().filter(n => n.status === 'online');
    for (const node of nodes) {
        queueCommand(node.id, 'reboot');
    }
    broadcastSSE('cluster_reboot', { nodes: nodes.length });
    return c.json({ status: 'rebooting', nodes: nodes.length, warning: 'All nodes will reboot!' });
});

// =============================================================================
// Waves 91-100: Final v1 Polish
// =============================================================================

// Cluster summary for display (combines everything needed for a status page)
app.get('/api/v1/status-page', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const power = getClusterPower();
    const analytics = getInferenceAnalytics(24);

    return c.json({
        name: 'TentaCLAW OS',
        tagline: 'Eight arms. One mind. Zero compromises.',
        status: health.score >= 80 ? 'operational' : health.score >= 50 ? 'degraded' : 'outage',
        health_score: health.score,
        health_grade: health.grade,
        nodes: { online: summary.online_nodes, total: summary.total_nodes },
        gpus: summary.total_gpus,
        vram_gb: Math.round(summary.total_vram_mb / 1024),
        models: models.length,
        inference: {
            requests_24h: analytics.total_requests,
            avg_latency_ms: analytics.avg_latency_ms,
            error_rate_pct: analytics.failed > 0 ? Math.round((analytics.failed / Math.max(analytics.total_requests, 1)) * 1000) / 10 : 0,
        },
        power_watts: power.total_watts,
        monthly_cost: power.monthly_cost,
        updated_at: new Date().toISOString(),
    });
});

// =============================================================================
// Inference Playground (Wave 101)
// =============================================================================

// POST /api/v1/playground/chat — Enhanced chat for the playground UI
app.post('/api/v1/playground/chat', async (c) => {
    const body = await c.req.json();
    const model = body.model;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return c.json({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
    }

    // Resolve aliases
    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    // Find best node — try target first, then fallbacks
    let target = findBestNode(resolvedModel);
    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback);
            if (target) {
                resolvedModel = fallback;
                break;
            }
        }
    }

    if (!target) {
        const available = getClusterModels();
        return c.json({
            error: {
                message: 'No online node has model "' + model + '". Deploy it first or try one of the available models.',
                type: 'model_not_found',
                available_models: available.map(m => ({ name: m.model, nodes: m.node_count })),
            },
        }, 503);
    }

    // Build proxy body with optional playground params
    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: body.messages,
        stream: false,
    };
    if (body.system_prompt) {
        // Prepend system message if provided as separate field
        proxyBody.messages = [{ role: 'system', content: body.system_prompt }, ...body.messages];
    }
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.max_tokens !== undefined) proxyBody.max_tokens = body.max_tokens;

    const backendPort = target.backend_port || 11434;
    const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
    const startTime = Date.now();

    try {
        const proxyReq = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyBody),
        });

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

        const result = await proxyReq.json() as Record<string, unknown>;
        const usage = (result as any).usage || {};
        const tokensIn = usage.prompt_tokens || 0;
        const tokensOut = usage.completion_tokens || 0;

        // Extract response text for preview
        const choices = (result as any).choices;
        const responseText = choices?.[0]?.message?.content || '';

        // Store in playground history
        const promptPreview = JSON.stringify(body.messages).slice(0, 100);
        insertPlaygroundHistory({
            model: resolvedModel,
            prompt_preview: promptPreview,
            response_preview: typeof responseText === 'string' ? responseText.slice(0, 200) : '',
            latency_ms: latencyMs,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            node_id: target.node_id,
        });

        return c.json({
            response: result,
            metadata: {
                node: { id: target.node_id, hostname: target.hostname },
                model: resolvedModel,
                latency_ms: latencyMs,
                tokens: { prompt: tokensIn, completion: tokensOut, total: tokensIn + tokensOut },
            },
        });

    } catch (err: any) {
        recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
        return c.json({
            error: {
                message: 'Failed to proxy to node ' + target.hostname + ': ' + err.message,
                type: 'proxy_error',
                node_id: target.node_id,
            },
        }, 502);
    }
});

// GET /api/v1/playground/models — Models formatted for the playground UI
app.get('/api/v1/playground/models', (c) => {
    const clusterModels = getClusterModels();
    const stats = getRequestStats();

    const models = clusterModels.map(m => ({
        name: m.model,
        nodes: m.node_count,
        avg_latency_ms: stats.avg_latency_ms,
        ready: m.node_count > 0,
    }));

    return c.json({ models });
});

// GET /api/v1/playground/history — Recent playground requests
app.get('/api/v1/playground/history', (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const history = getPlaygroundHistory(limit);
    return c.json({ history, count: history.length });
});

// POST /api/v1/playground/compare — Compare same prompt across multiple models
app.post('/api/v1/playground/compare', async (c) => {
    const body = await c.req.json();

    if (!body.prompt || typeof body.prompt !== 'string') {
        return c.json({ error: { message: 'prompt string is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
        return c.json({ error: { message: 'models array is required and must not be empty', type: 'invalid_request_error' } }, 400);
    }
    if (body.models.length > 5) {
        return c.json({ error: { message: 'Maximum 5 models for comparison', type: 'invalid_request_error' } }, 400);
    }

    const messages = [
        ...(body.system_prompt ? [{ role: 'system' as const, content: body.system_prompt }] : []),
        { role: 'user' as const, content: body.prompt },
    ];

    // Fan out to multiple models in parallel
    const promises = body.models.map(async (modelName: string) => {
        const resolved = resolveModelAlias(modelName);
        let resolvedModel = resolved.target;
        let target = findBestNode(resolvedModel);

        if (!target && resolved.fallbacks.length > 0) {
            for (const fallback of resolved.fallbacks) {
                target = findBestNode(fallback);
                if (target) {
                    resolvedModel = fallback;
                    break;
                }
            }
        }

        if (!target) {
            return { model: modelName, error: 'No online node has this model', response: null, latency_ms: 0, tokens: 0 };
        }

        const backendPort = target.backend_port || 11434;
        const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
        const startTime = Date.now();

        try {
            const proxyReq = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
            });

            const latencyMs = Date.now() - startTime;
            recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

            const result = await proxyReq.json() as any;
            const usage = result.usage || {};
            const responseText = result.choices?.[0]?.message?.content || '';

            // Store each comparison result in playground history
            insertPlaygroundHistory({
                model: resolvedModel,
                prompt_preview: body.prompt.slice(0, 100),
                response_preview: typeof responseText === 'string' ? responseText.slice(0, 200) : '',
                latency_ms: latencyMs,
                tokens_in: usage.prompt_tokens || 0,
                tokens_out: usage.completion_tokens || 0,
                node_id: target.node_id,
            });

            return {
                model: resolvedModel,
                response: responseText,
                latency_ms: latencyMs,
                tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
                node: target.hostname,
            };
        } catch (err: any) {
            recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
            return { model: modelName, error: err.message, response: null, latency_ms: Date.now() - startTime, tokens: 0 };
        }
    });

    const results = await Promise.all(promises);
    return c.json({ results, prompt: body.prompt, compared_at: new Date().toISOString() });
});

// =============================================================================
// Authentication Endpoints (Wave 41) — consolidated into Wave 8 section above
// Login, logout, me, change-password, users CRUD all defined earlier with
// rate limiting, brute-force protection, and password-change enforcement.
// =============================================================================

// Initialize default namespace (multi-tenancy bootstrap)
ensureDefaultNamespace();

// =============================================================================
// Namespace & Multi-Tenancy Endpoints
// CLAWtopus says: "Every family has territories. Every territory has a boss."
// =============================================================================

app.get('/api/v1/namespaces', (c) => {
    return c.json(listNamespaces());
});

app.post('/api/v1/namespaces', async (c) => {
    const body = await c.req.json<{ name: string; display_name?: string; description?: string; labels?: Record<string, string>; quota?: any }>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    try {
        const ns = createNamespace(body.name, {
            display_name: body.display_name,
            description: body.description,
            labels: body.labels,
            quota: body.quota,
        });
        return c.json(ns, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.get('/api/v1/namespaces/:name', (c) => {
    const ns = getNamespace(c.req.param('name'));
    return ns ? c.json(ns) : c.json({ error: 'namespace not found' }, 404);
});

app.put('/api/v1/namespaces/:name', async (c) => {
    const body = await c.req.json<{ display_name?: string; description?: string; labels?: Record<string, string>; quota?: any }>();
    try {
        const ns = updateNamespace(c.req.param('name'), body);
        return ns ? c.json(ns) : c.json({ error: 'namespace not found' }, 404);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.delete('/api/v1/namespaces/:name', (c) => {
    try {
        const deleted = deleteNamespace(c.req.param('name'));
        return deleted ? c.json({ deleted: true }) : c.json({ error: 'namespace not found' }, 404);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

// --- Quota management ---

app.get('/api/v1/namespaces/:name/quota', (c) => {
    const usage = getQuotaUsage(c.req.param('name'));
    return usage ? c.json(usage) : c.json({ error: 'namespace not found' }, 404);
});

app.put('/api/v1/namespaces/:name/quota', async (c) => {
    const body = await c.req.json<{ maxGpus?: number; maxVramMb?: number; maxModels?: number; maxRequestsPerMin?: number; maxStorageMb?: number }>();
    const updated = setQuota(c.req.param('name'), {
        maxGpus: body.maxGpus ?? 0,
        maxVramMb: body.maxVramMb ?? 0,
        maxModels: body.maxModels ?? 0,
        maxRequestsPerMin: body.maxRequestsPerMin ?? 0,
        maxStorageMb: body.maxStorageMb ?? 0,
    });
    return updated ? c.json({ updated: true }) : c.json({ error: 'namespace not found' }, 404);
});

app.post('/api/v1/namespaces/:name/quota/check', async (c) => {
    const body = await c.req.json<{ gpus?: number; vram_mb?: number; models?: number; storage_mb?: number }>();
    const result = checkQuota(c.req.param('name'), body);
    return c.json(result);
});

// --- Namespace isolation ---

app.get('/api/v1/namespaces/:name/models', (c) => {
    return c.json(getModelsInNamespace(c.req.param('name')));
});

app.get('/api/v1/namespaces/:name/nodes', (c) => {
    return c.json(getNodesInNamespace(c.req.param('name')));
});

app.post('/api/v1/namespaces/:name/nodes', async (c) => {
    const body = await c.req.json<{ node_id: string }>();
    if (!body.node_id) return c.json({ error: 'node_id is required' }, 400);
    try {
        assignNodeToNamespace(body.node_id, c.req.param('name'));
        return c.json({ assigned: true, node_id: body.node_id, namespace: c.req.param('name') });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.get('/api/v1/api-keys/:keyId/namespace', (c) => {
    const ns = getNamespaceForApiKey(c.req.param('keyId'));
    return c.json({ key_id: c.req.param('keyId'), namespace: ns });
});

app.put('/api/v1/api-keys/:keyId/namespace', async (c) => {
    const body = await c.req.json<{ namespace: string }>();
    if (!body.namespace) return c.json({ error: 'namespace is required' }, 400);
    try {
        setApiKeyNamespace(c.req.param('keyId'), body.namespace);
        return c.json({ updated: true, key_id: c.req.param('keyId'), namespace: body.namespace });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

// --- Chargeback / usage ---

app.post('/api/v1/namespaces/:name/usage', async (c) => {
    const body = await c.req.json<{ gpu_hours?: number; vram_hours_gb?: number; tokens_generated?: number; requests_served?: number; power_kwh?: number; estimated_cost_usd?: number }>();
    try {
        recordUsage(c.req.param('name'), body);
        return c.json({ recorded: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.get('/api/v1/namespaces/:name/usage', (c) => {
    const period = c.req.query('period');
    const report = getUsageReport(c.req.param('name'), period ?? undefined);
    return report ? c.json(report) : c.json({ error: 'namespace not found' }, 404);
});

app.get('/api/v1/namespaces/:name/usage/csv', (c) => {
    const period = c.req.query('period');
    try {
        const csv = exportUsageCSV(c.req.param('name'), period ?? undefined);
        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="usage-${c.req.param('name')}-${period || 'all'}.csv"`,
            },
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.get('/api/v1/usage/all', (c) => {
    const period = c.req.query('period');
    return c.json(getAllUsageReports(period ?? undefined));
});

// =============================================================================
// Performance Profiler Endpoints
// CLAWtopus says: "I time everything. Eight arms, eight stopwatches."
// =============================================================================

app.get('/api/v1/profiler/summary', (c) => {
    return c.json(getPerformanceSummary());
});

app.get('/api/v1/profiler/endpoint/:path{.+}', (c) => {
    const endpointPath = '/' + c.req.param('path');
    return c.json(getEndpointPerformance(endpointPath));
});

app.get('/api/v1/profiler/recent', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    return c.json(getProfiles(limit));
});

app.post('/api/v1/profiler/load-test', async (c) => {
    const body = await c.req.json<{ endpoint: string; concurrency?: number; duration_secs?: number; rps?: number }>();
    if (!body.endpoint) {
        return c.json({ error: 'endpoint is required' }, 400);
    }
    return c.json(generateLoadTestConfig(body.endpoint, {
        concurrency: body.concurrency,
        duration_secs: body.duration_secs,
        rps: body.rps,
    }));
});

app.delete('/api/v1/profiler', (c) => {
    clearProfiles();
    return c.json({ cleared: true, message: 'All profiles cleared' });
});

// =============================================================================
// MCP Server — Model Context Protocol (Wave 93)
// =============================================================================

import { getMcpTools, handleMcpToolCall } from './mcp-server';
import { getAgentCard, submitTask, getTask, listTasks } from './a2a';
import { registerWebhook, listWebhooks, deleteWebhook, fireWebhookEvent, getDeliveries, ALL_WEBHOOK_EVENTS } from './webhooks';

// MCP tool list — used by AI agents to discover available tools
app.get('/api/v1/mcp/tools', (c) => {
    return c.json({ tools: getMcpTools() });
});

// MCP tool execution — AI agents call tools here
app.post('/api/v1/mcp/tools/:name', async (c) => {
    const toolName = c.req.param('name');
    const args = await c.req.json().catch(() => ({}));
    const result = await handleMcpToolCall(toolName, args);
    return c.json(result, result.isError ? 400 : 200);
});

// MCP server info
app.get('/api/v1/mcp/info', (c) => {
    return c.json({
        name: 'tentaclaw-mcp',
        version: '1.0.0',
        description: 'TentaCLAW GPU Cluster Management — MCP Tool Server',
        tools_count: getMcpTools().length,
        capabilities: ['tools'],
        documentation: 'https://docs.tentaclaw.io/mcp',
    });
});

// =============================================================================
// A2A Protocol — Agent-to-Agent (Wave 94)
// =============================================================================

// Agent Card discovery (A2A spec: /.well-known/agent.json)
app.get('/.well-known/agent.json', (c) => {
    const proto = c.req.header('x-forwarded-proto') || 'http';
    const host = c.req.header('host') || 'localhost:8080';
    return c.json(getAgentCard(`${proto}://${host}`));
});

// Submit a task (A2A: tasks/send)
app.post('/api/v1/a2a/tasks', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.capability) return c.json({ error: 'capability is required' }, 400);
    const task = await submitTask(body.capability, body.input || {});
    return c.json(task, task.state === 'rejected' ? 400 : 200);
});

// Get task status (A2A: tasks/get)
app.get('/api/v1/a2a/tasks/:id', (c) => {
    const task = getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
});

// List recent tasks
app.get('/api/v1/a2a/tasks', (c) => {
    return c.json(listTasks());
});

// =============================================================================
// Webhooks — Event Notifications (Wave 98)
// =============================================================================

app.post('/api/v1/webhooks', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.url) return c.json({ error: 'url is required' }, 400);
    const events = body.events || ALL_WEBHOOK_EVENTS;
    const wh = registerWebhook(body.url, events, body.description || '');
    return c.json({
        ...wh,
        message: 'Webhook created. Save the secret for signature verification.',
    }, 201);
});

app.get('/api/v1/webhooks', (c) => {
    return c.json(listWebhooks());
});

app.delete('/api/v1/webhooks/:id', (c) => {
    if (!deleteWebhook(c.req.param('id'))) return c.json({ error: 'Not found' }, 404);
    return c.json({ status: 'deleted' });
});

app.get('/api/v1/webhooks/:id/deliveries', (c) => {
    return c.json(getDeliveries(c.req.param('id')));
});

app.post('/api/v1/webhooks/:id/test', async (c) => {
    const delivered = await fireWebhookEvent('config.changed', { test: true, source: 'manual' });
    return c.json({ status: 'test_sent', webhooks_notified: delivered });
});

app.get('/api/v1/webhooks/events', (c) => {
    return c.json({ events: ALL_WEBHOOK_EVENTS });
});

// Final endpoint — the "about" page
app.get('/api/v1/about', (c) => {
    return c.json({
        product: 'TentaCLAW OS',
        mascot: 'CLAWtopus',
        tagline: 'Eight arms. One mind. Zero compromises.',
        description: 'The operating system for personal AI infrastructure. Plug it in. It just works.',
        version: '0.2.0',
        website: 'https://www.tentaclaw.io',
        github: 'https://github.com/TentaCLAW-OS/TentaCLAW',
        license: 'MIT',
        waves_completed: 100,
        api_endpoints: 200,
    });
});
