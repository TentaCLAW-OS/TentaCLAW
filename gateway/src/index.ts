#!/usr/bin/env node
/**
 * TentaCLAW Gateway
 *
 * The central coordinator for your AI inference cluster.
 * Receives stats from agents, dispatches commands, serves the dashboard.
 *
 * TentaCLAW says: "One mind to rule them all. Eight arms to manage them."
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import dgram from 'dgram';
import os from 'os';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';

const PORT = parseInt(process.env.TENTACLAW_PORT || '8080');
const HOST = process.env.TENTACLAW_HOST || '0.0.0.0';

import {
    getDb,
    registerNode,
    getAllNodes,
    markStaleNodes,
    pruneStats,
    queueCommand,
    getDueSchedules,
    markScheduleRun,
    seedDefaultAlertRules,
    ensureDefaultAliases,
    validateApiKey,
    validateSession,
    recordAuditEvent,
    createDefaultAdmin,
    getOrCreateClusterSecret,
    runAutoMode,
} from './db';
import { ensureDefaultNamespace } from './namespaces';

// Import shared state and utilities
import {
    broadcastSSE,
    initClusterSecret,
    isAuthDisabled,
    CLUSTER_SECRET,
    agentAuthEnabled,
    checkKeyRateLimit,
    log,
    paginate,
} from './shared';

// Import route modules
import nodeRoutes from './routes/nodes';
import inferenceRoutes from './routes/inference';
import alertRoutes from './routes/alerts';
import flightSheetRoutes from './routes/flight-sheets';
import modelRoutes from './routes/models';
import adminRoutes from './routes/admin';
import dashboardRoutes from './routes/dashboard';
import namespaceRoutes from './routes/namespaces';
import miscRoutes from './routes/misc';
import routingRoutes from './routes/routing'; // Wave 468-472
import fleetRoutes, { checkGpuHangs } from './routes/fleet'; // Wave 480-498
import observabilityRoutes from './routes/observability'; // Wave 491-500
import modelMgmtRoutes from './routes/model-mgmt'; // Wave 607-628 Phase 4
import platformRoutes from './routes/platform'; // Wave 686-730 Phase 5-7

// Re-export for tests
export { app, initClusterSecret, isAuthDisabled, log, paginate };

// =============================================================================
// App Setup
// =============================================================================

const app = new Hono();

// Global error handler
app.onError((err, c) => {
    if (err.message?.includes('Unexpected') || err.message?.includes('JSON')) {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    console.error('[tentaclaw] Unhandled error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
});

// CORS
const CORS_ORIGINS = (() => {
    const envOrigins = process.env.TENTACLAW_CORS_ORIGINS;
    if (envOrigins) {
        return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    }
    const defaults = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
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
        if (!origin) return `http://localhost:${PORT}`;
        if (CORS_ORIGINS.includes(origin)) return origin;
        if (origin && /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(origin)) return origin;
        return null as unknown as string;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Cluster-Secret'],
    exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials: true,
    maxAge: 86400,
}));

// Security headers
app.use('/*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '0');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// Request ID tracing
app.use('/*', async (c, next) => {
    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    c.header('X-Request-ID', requestId);
    await next();
});

// =============================================================================
// API Key Auth (optional — set TENTACLAW_API_KEY to enable)
// =============================================================================

const API_KEY = process.env.TENTACLAW_API_KEY || '';

function methodToPermission(method: string): string {
    const m = method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
    return 'write';
}

if (API_KEY) {
    app.use('/api/*', async (c, next) => {
        const auth = c.req.header('Authorization');
        const key = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.query('api_key');
        if (!key) {
            return c.json({ error: 'Unauthorized. Set Authorization: Bearer <key>' }, 401);
        }

        if (key === API_KEY) {
            await next();
            return;
        }

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

        if (key === API_KEY) {
            await next();
            return;
        }

        const session = validateSession(key);
        if (session) {
            await next();
            return;
        }

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

const RATE_LIMIT = parseInt(process.env.TENTACLAW_RATE_LIMIT || '0');
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

if (RATE_LIMIT > 0) {
    app.use('/v1/*', async (c, next) => {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        const now = Date.now();
        let bucket = rateBuckets.get(ip);

        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + 60000 };
            rateBuckets.set(ip, bucket);
        }

        bucket.count++;
        if (bucket.count > RATE_LIMIT) {
            return c.json({
                error: { message: 'Rate limit exceeded. ' + RATE_LIMIT + ' req/min', type: 'rate_limit_error' },
            }, 429);
        }

        c.header('X-RateLimit-Limit', String(RATE_LIMIT));
        c.header('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT - bucket.count)));
        c.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

        await next();
    });

    const _rateBucketCleanup = setInterval(() => {
        const now = Date.now();
        for (const [ip, bucket] of rateBuckets) {
            if (now > bucket.resetAt + 60000) rateBuckets.delete(ip);
        }
    }, 300_000);
    _rateBucketCleanup.unref(); // don't prevent process exit
}

// =============================================================================
// Bootstrap: create default admin + initialize cluster secret
// =============================================================================

try {
    const newAdmin = createDefaultAdmin();
    if (newAdmin) {
        recordAuditEvent('first_boot', 'system', undefined, 'First boot: admin user created');
        if (!process.env.TENTACLAW_CLUSTER_SECRET) {
            const secret = getOrCreateClusterSecret();
            console.log(`[auth] SECURITY: Cluster secret generated on first boot (first 8 chars): ${secret.slice(0, 8)}...`);
            console.log('[auth] Retrieve the full secret via: GET /api/v1/cluster/secret (admin auth required)');
            console.log('[auth] Set TENTACLAW_CLUSTER_SECRET on all agents to this value.');
        }
    }
    initClusterSecret();
} catch (_e) {
    // Table may not exist yet on very first run before migrations complete
}

// =============================================================================
// Mount Route Modules
// =============================================================================

app.route('/', nodeRoutes);
app.route('/', inferenceRoutes);
app.route('/', alertRoutes);
app.route('/', flightSheetRoutes);
app.route('/', modelRoutes);
app.route('/', adminRoutes);
app.route('/', dashboardRoutes);
app.route('/', namespaceRoutes);
app.route('/', routingRoutes); // Wave 468-472
app.route('/', fleetRoutes);           // Wave 480-498
app.route('/', observabilityRoutes);   // Wave 491-500
app.route('/', modelMgmtRoutes);       // Wave 607-628 Phase 4
app.route('/', platformRoutes);        // Wave 686-730 Phase 5-7
app.route('/', miscRoutes);

// Root: serve website for tentaclaw.io, redirect to dashboard for local access
app.get('/', (c) => {
    const host = c.req.header('host') || '';
    if (host.includes('tentaclaw.io')) {
        // Serve website index.html for the public domain
        const fs = require('fs');
        const path = require('path');
        const htmlPath = path.join(__dirname, '..', '..', '..', 'website', 'index.html');
        try {
            const html = fs.readFileSync(htmlPath, 'utf-8');
            return c.html(html);
        } catch { return c.redirect('/dashboard/'); }
    }
    return c.redirect('/dashboard/');
});

// Initialize default namespace
ensureDefaultNamespace();

// =============================================================================
// Background Tasks
// =============================================================================

// Track all intervals for clean shutdown
const _intervals: NodeJS.Timeout[] = [];

// Mark stale nodes as offline every 30 seconds
_intervals.push(setInterval(() => {
    const staleIds = markStaleNodes(60);
    for (const id of staleIds) {
        broadcastSSE('node_offline', { node_id: id, timestamp: new Date().toISOString() });
        console.log(`[tentaclaw] Node went offline: ${id}`);
    }
}, 30_000));

// Prune old stats daily (keep 7 days)
_intervals.push(setInterval(() => {
    const pruned = pruneStats(7);
    if (pruned > 0) {
        console.log(`[tentaclaw] Pruned ${pruned} old stats records`);
    }
}, 86_400_000));

// Wave 494: GPU hang detection — check every 60s, alert if in-flight > 0 and tok/s = 0 for >60s
_intervals.push(setInterval(() => {
    const hangs = checkGpuHangs();
    for (const hang of hangs) {
        console.warn(`[tentaclaw] GPU hang detected: ${hang.hostname} (${hang.node_id}) — ${hang.duration_s}s stalled`);
        broadcastSSE('gpu_hang', { node_id: hang.node_id, hostname: hang.hostname, duration_s: hang.duration_s });
    }
}, 60_000));

// Run scheduled tasks every 60 seconds
_intervals.push(setInterval(() => {
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
}, 60_000));

// Auto-doctor every 5 minutes
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
    }, 300_000);
    console.log('[tentaclaw] Auto-doctor running every 5 minutes');
}

setTimeout(startAutoDoctor, 10000);

// Graceful shutdown — clear all intervals to prevent leaks
function cleanupIntervals() {
    for (const iv of _intervals) clearInterval(iv);
    _intervals.length = 0;
    if (autoDocInterval) { clearInterval(autoDocInterval); autoDocInterval = null; }
}

process.on('SIGTERM', () => {
    console.log('[tentaclaw] SIGTERM received — graceful shutdown starting');
    cleanupIntervals();
    console.log('[tentaclaw] Waiting for in-flight requests to complete...');
    setTimeout(() => {
        console.log('[tentaclaw] Shutdown complete');
        process.exit(0);
    }, 5000);
});

process.on('SIGINT', () => {
    console.log('[tentaclaw] SIGINT received — shutting down');
    cleanupIntervals();
    process.exit(0);
});

// =============================================================================
// Server Start
// =============================================================================

if (!process.env.VITEST) {

getDb();
ensureDefaultAliases();
seedDefaultAlertRules();
initClusterSecret();

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
    const T = (s: string) => `\x1b[38;2;0;212;170m${s}\x1b[0m`;
    const P = (s: string) => `\x1b[38;2;139;92;246m${s}\x1b[0m`;
    const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
    const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
    console.log('');
    console.log(T([
        '                          ___',
        "                       .-'   `'.",
        '                      /         \\',
        '                      |         ;',
        '                      |         |           ___.--,',
        "             _.._     |0) ~ (0) |    _.---'`__.-( (_.",
        "      __.--'`_.. '.__.\\.    '--. \\_.-' ,.--'`     `\"\"` ",
        "     ( ,.--'`   ',__/|)  `-. '.  `.   /   _",
        "     _`) )  .---.__.' /   `. `. \\_  `-'  /`.)  ",
        '    `)_\')  /        /     `.  `\\  \\ `\'  /',
        "     `'''  |  _    |       `. `. `.  /`",
        '            ;  \\   \'.        `. `. `./',
        '             \\  \'.   \\         `. `.  `-._     _',
        "              '.  `'. `.         `-. `.    `.__/",
        "                `'.  `\\ `.         `.  `-.",
        "                   `'  \\ `;          `-._`.",
        "                        ` \\               `'",
    ].join('\n')));
    console.log('');
    console.log(`  ${P('╭──────────────────────────────────────────────────────╮')}`);
    console.log(`  ${P('│')}                                                      ${P('│')}`);
    console.log(`  ${P('│')}   ${T(B('TentaCLAW Gateway'))}  ${D('v1.0.0')}                          ${P('│')}`);
    console.log(`  ${P('│')}   ${D('The AI inference cluster operating system')}          ${P('│')}`);
    console.log(`  ${P('│')}                                                      ${P('│')}`);
    console.log(`  ${P('│')}   ${D(`Dashboard  →  http://localhost:${info.port}/dashboard`)}      ${P('│')}`);
    console.log(`  ${P('│')}   ${D(`API        →  http://localhost:${info.port}/api/v1`)}          ${P('│')}`);
    console.log(`  ${P('│')}                                                      ${P('│')}`);
    console.log(`  ${P('╰──────────────────────────────────────────────────────╯')}`);
    console.log('');

    setupShellServer(server);
    startDiscoveryService(info.port);
});

} // end if (!process.env.VITEST)

// =============================================================================
// Auto-Discovery Service
// =============================================================================

const DISCOVERY_PORT = 41337;

function startDiscoveryService(gatewayPort: number): void {
    try {
        const listener = dgram.createSocket('udp4');
        listener.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.magic === 'TENTACLAW-DISCOVER') {
                    console.log(`[tentaclaw] Discovery: agent ${data.node_id} at ${rinfo.address}`);
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
            _intervals.push(setInterval(announce, 30000));
            console.log(`[tentaclaw] Broadcasting gateway presence every 30s`);
        });
    } catch {
        console.log('[tentaclaw] Auto-discovery unavailable (non-fatal)');
    }
}

// =============================================================================
// Remote Shell — WebSocket Terminal Proxy
// =============================================================================

const agentShells = new Map<string, WsWebSocket>();
const dashboardShells = new Map<string, Set<WsWebSocket>>();

function setupShellServer(httpServer: any): void {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req: any, socket: any, head: any) => {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        const authHeader = req.headers['authorization'] || '';
        const queryToken = url.searchParams.get('token') || '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

        const agentMatch = path.match(/^\/ws\/agent-shell\/(.+)$/);
        if (agentMatch) {
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

        const dashMatch = path.match(/^\/ws\/shell\/(.+)$/);
        if (dashMatch) {
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

                agentWs.send(JSON.stringify({ type: 'shell_start' }));

                ws.on('message', (data: Buffer) => {
                    if (agentWs.readyState === WsWebSocket.OPEN) {
                        agentWs.send(data);
                    }
                });

                ws.on('close', () => {
                    dashboardShells.get(nodeId)?.delete(ws);
                    if (dashboardShells.get(nodeId)?.size === 0) {
                        dashboardShells.delete(nodeId);
                        if (agentWs.readyState === WsWebSocket.OPEN) {
                            agentWs.send(JSON.stringify({ type: 'shell_stop' }));
                        }
                    }
                    console.log(`[shell] Dashboard disconnected from ${nodeId}`);
                });
            });
            return;
        }

        socket.destroy();
    });

    console.log('[shell] Remote shell server active');
}

// Override shells endpoint to use actual WebSocket state
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
