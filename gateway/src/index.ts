#!/usr/bin/env node
/**
 * TentaCLAW HiveMind Gateway
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
import path from 'path';
import dgram from 'dgram';
import os from 'os';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { createHash } from 'crypto';
import type { StatsPayload, GatewayResponse, CommandAction } from '../../shared/types';
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
    isInMaintenance,
    getClusterTimeline,
    exportClusterConfig,
    importClusterConfig,
    getNodeHealthScore,
    getFleetReliability,
    createApiKey,
    validateApiKey,
    trackApiKeyTokens,
    getAllApiKeys,
    revokeApiKey,
    deleteApiKey,
    recordUptimeEvent,
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
} from './db';
import { generateWaitComedy } from './comedy';

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
}

// =============================================================================
// App Setup
// =============================================================================

const app = new Hono();

// Global error handler — catch malformed JSON, unexpected errors
app.onError((err, c) => {
    if (err.message?.includes('Unexpected') || err.message?.includes('JSON')) {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    console.error('[hivemind] Unhandled error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
});

// CORS for dashboard (same-origin in production, permissive in dev)
app.use('/*', cors());

// =============================================================================
// API Key Auth (optional — set TENTACLAW_API_KEY to enable)
// =============================================================================

const API_KEY = process.env.TENTACLAW_API_KEY || '';

if (API_KEY) {
    // Protect API routes but leave health, dashboard, and root public
    app.use('/api/*', async (c, next) => {
        const auth = c.req.header('Authorization');
        const key = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.query('api_key');
        if (key !== API_KEY) {
            return c.json({ error: 'Unauthorized. Set Authorization: Bearer <key>' }, 401);
        }
        await next();
    });

    app.use('/v1/*', async (c, next) => {
        const auth = c.req.header('Authorization');
        const key = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
        if (key !== API_KEY) {
            return c.json({ error: { message: 'Invalid API key', type: 'authentication_error' } }, 401);
        }
        await next();
    });
}

// =============================================================================
// Rate Limiting (simple in-memory, for /v1/* OpenAI-compat endpoints)
// =============================================================================

const RATE_LIMIT = parseInt(process.env.TENTACLAW_RATE_LIMIT || '0'); // 0 = disabled
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

    // Clean up stale buckets every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, bucket] of rateBuckets) {
            if (now > bucket.resetAt + 60000) rateBuckets.delete(ip);
        }
    }, 300_000);
}

// =============================================================================
// Health Check
// =============================================================================

app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        service: 'tentaclaw-hivemind',
        version: '0.1.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.get('/', (c) => {
    return c.json({
        name: 'TentaCLAW HiveMind Gateway',
        version: '0.1.0',
        tagline: 'Eight arms. One mind. Zero compromises.',
        endpoints: {
            health: '/health',
            dashboard: '/dashboard',
            api: '/api/v1',
        },
    });
});

// =============================================================================
// Node Registration
// =============================================================================

app.post('/api/v1/register', async (c) => {
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

    console.log(`[hivemind] Node registered: ${node.id} (${node.hostname}) — Farm: ${node.farm_hash}`);

    return c.json({ status: 'registered', node });
});

// =============================================================================
// Stats Ingestion (Agent pushes here)
// =============================================================================

app.post('/api/v1/nodes/:nodeId/stats', async (c) => {
    const nodeId = c.req.param('nodeId');
    const stats: StatsPayload = await c.req.json();

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

    // Check thresholds and create alerts
    const newAlerts = checkAndAlert(nodeId, stats);
    for (const alert of newAlerts) {
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

    console.log(`[hivemind] Command queued: ${command.action} → ${nodeId}`);

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
    console.log(`[hivemind] Flight sheet created: ${sheet.name} (${sheet.id})`);
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

    console.log(`[hivemind] Flight sheet applied: ${id} — ${commands.length} commands queued`);

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

    console.log('[hivemind] Benchmark stored: ' + nodeId + ' — ' + body.model + ' @ ' + body.tokens_per_sec + ' tok/s');

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

    console.log('[hivemind] Benchmark queued: ' + nodeId + ' — ' + model);

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
    console.log('[hivemind] Model pull queued: ' + body.model + ' → ' + nodeId);
    return c.json({ status: 'queued', command });
});

app.delete('/api/v1/nodes/:nodeId/models/:model', (c) => {
    const nodeId = c.req.param('nodeId');
    const model = c.req.param('model');

    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const command = queueCommand(nodeId, 'remove_model', { model });
    console.log('[hivemind] Model removal queued: ' + model + ' → ' + nodeId);
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

    console.log('[hivemind] Deploy: ' + body.model + ' → ' + commands.length + ' nodes');
    return c.json({ status: 'deployed', model: body.model, commands_queued: commands.length, commands });
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

// List available models (OpenAI format)
app.get('/v1/models', (c) => {
    const models = getClusterModels();
    return c.json({
        object: 'list',
        data: models.map(m => ({
            id: m.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'tentaclaw-cluster',
            permission: [],
            root: m.model,
            parent: null,
            _tentaclaw: {
                node_count: m.node_count,
                nodes: m.nodes,
            },
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
    const ollamaUrl = 'http://' + (target.ip_address || target.hostname) + ':11434/v1/chat/completions';
    const startTime = Date.now();

    try {
        const proxyReq = await fetch(ollamaUrl, {
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
        result._tentaclaw = {
            routed_to: target.node_id,
            hostname: target.hostname,
            gpu_utilization: target.gpu_utilization_avg,
            latency_ms: latencyMs,
            resolved_model: resolvedModel,
            alias_used: model !== resolvedModel ? model : undefined,
            fallback_used: usedFallback ? resolvedModel : undefined,
            cached: false,
            tools_used: hasTools || undefined,
            json_mode: hasJsonMode || undefined,
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
                const retryUrl = 'http://' + (retry.ip_address || retry.hostname) + ':11434/v1/chat/completions';
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

    const ollamaUrl = 'http://' + (target.ip_address || target.hostname) + ':11434/v1/completions';
    try {
        const proxyReq = await fetch(ollamaUrl, {
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

    const ollamaUrl = 'http://' + (target.ip_address || target.hostname) + ':11434/v1/embeddings';
    const startTime = Date.now();

    // Handle batch input — OpenAI accepts string or string[]
    const inputs = Array.isArray(input) ? input : [input];

    try {
        // Process in batches of 32
        const allEmbeddings: any[] = [];
        for (let i = 0; i < inputs.length; i += 32) {
            const batch = inputs.slice(i, i + 32);
            for (const text of batch) {
                const proxyReq = await fetch(ollamaUrl, {
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

    console.log('[hivemind] Import: ' + imported.flight_sheets + ' flight sheets, ' + imported.schedules + ' schedules');
    return c.json({ status: 'imported', imported });
});

// =============================================================================
// Prometheus Metrics
// =============================================================================

app.get('/metrics', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const d = getDb();
    const alertCount = (d.prepare('SELECT COUNT(*) as cnt FROM alerts WHERE acknowledged = 0').get() as { cnt: number }).cnt;
    const totalRequests = (() => {
        const nodes = getAllNodes();
        let total = 0;
        for (const n of nodes) {
            if (n.latest_stats) total += n.latest_stats.requests_completed;
        }
        return total;
    })();

    const lines = [
        '# HELP tentaclaw_nodes_total Total number of registered nodes',
        '# TYPE tentaclaw_nodes_total gauge',
        'tentaclaw_nodes_total ' + summary.total_nodes,
        '',
        '# HELP tentaclaw_nodes_online Number of online nodes',
        '# TYPE tentaclaw_nodes_online gauge',
        'tentaclaw_nodes_online ' + summary.online_nodes,
        '',
        '# HELP tentaclaw_gpus_total Total GPUs across cluster',
        '# TYPE tentaclaw_gpus_total gauge',
        'tentaclaw_gpus_total ' + summary.total_gpus,
        '',
        '# HELP tentaclaw_vram_total_bytes Total VRAM in bytes',
        '# TYPE tentaclaw_vram_total_bytes gauge',
        'tentaclaw_vram_total_bytes ' + (summary.total_vram_mb * 1024 * 1024),
        '',
        '# HELP tentaclaw_vram_used_bytes Used VRAM in bytes',
        '# TYPE tentaclaw_vram_used_bytes gauge',
        'tentaclaw_vram_used_bytes ' + (summary.used_vram_mb * 1024 * 1024),
        '',
        '# HELP tentaclaw_toks_per_sec Cluster-wide tokens per second',
        '# TYPE tentaclaw_toks_per_sec gauge',
        'tentaclaw_toks_per_sec ' + summary.total_toks_per_sec,
        '',
        '# HELP tentaclaw_requests_total Total inference requests completed',
        '# TYPE tentaclaw_requests_total counter',
        'tentaclaw_requests_total ' + totalRequests,
        '',
        '# HELP tentaclaw_alerts_active Unacknowledged alerts',
        '# TYPE tentaclaw_alerts_active gauge',
        'tentaclaw_alerts_active ' + alertCount,
        '',
        '# HELP tentaclaw_health_score Cluster health score 0-100',
        '# TYPE tentaclaw_health_score gauge',
        'tentaclaw_health_score ' + health.score,
        '',
        '# HELP tentaclaw_sse_clients Connected dashboard clients',
        '# TYPE tentaclaw_sse_clients gauge',
        'tentaclaw_sse_clients ' + sseClients.length,
        '',
        '# HELP tentaclaw_models_loaded Number of unique models loaded',
        '# TYPE tentaclaw_models_loaded gauge',
        'tentaclaw_models_loaded ' + summary.loaded_models.length,
        '',
    ];

    // Per-node GPU metrics
    const nodes = getAllNodes();
    for (const node of nodes) {
        if (!node.latest_stats) continue;
        for (let i = 0; i < node.latest_stats.gpus.length; i++) {
            const gpu = node.latest_stats.gpus[i];
            const labels = '{node="' + node.hostname + '",gpu="' + i + '",gpu_name="' + gpu.name + '"}';
            lines.push('tentaclaw_gpu_temperature_celsius' + labels + ' ' + gpu.temperatureC);
            lines.push('tentaclaw_gpu_utilization_percent' + labels + ' ' + gpu.utilizationPct);
            lines.push('tentaclaw_gpu_vram_used_bytes' + labels + ' ' + (gpu.vramUsedMb * 1024 * 1024));
            lines.push('tentaclaw_gpu_power_watts' + labels + ' ' + gpu.powerDrawW);
        }
    }

    return c.text(lines.join('\n'), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
});

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
        gateway: { id: 'gateway', label: 'HiveMind Gateway', position: { x: 400, y: 0 } },
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
        service: 'tentaclaw-hivemind',
        features: {
            auth_enabled: !!API_KEY,
            rate_limiting: RATE_LIMIT > 0,
            rate_limit_per_min: RATE_LIMIT || null,
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
        service: 'tentaclaw-hivemind',
        version: '0.1.0',
        api: '/api/v1',
        register: '/api/v1/register',
        stats: '/api/v1/nodes/{nodeId}/stats',
        openai: '/v1/chat/completions',
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
    console.log('[hivemind] Schedule created: ' + schedule.name + ' (' + schedule.cron + ')');
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

    // Check cluster VRAM capacity
    const summary = getClusterSummary();
    const maxGpuVram = summary.total_vram_mb > 0 ? summary.total_vram_mb : 0;

    return c.json({
        models: results.map(m => ({
            ...m,
            fits_cluster: m.vram_mb <= maxGpuVram,
            loaded: false, // TODO: check against currently loaded models
        })),
        cluster_vram_mb: maxGpuVram,
        tags: [...new Set(OLLAMA_MODEL_CATALOG.flatMap(m => m.tags))].sort(),
    });
});

// =============================================================================
// Daphney Bridge (SSE for DaphneyBrain UE5)
// =============================================================================

const daphneyClients: SSEClient[] = [];

app.get('/api/v1/daphney/stream', (c) => {
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
        ],
        openai_compatible: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/models'],
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
    const body = await c.req.json<{ name: string; scope?: string; rate_limit_rpm?: number }>();
    if (!body.name) return c.json({ error: 'name required' }, 400);

    const result = createApiKey(body.name, body.scope || 'inference', body.rate_limit_rpm || 60);
    return c.json({
        id: result.id,
        key: result.key, // Only shown ONCE at creation
        prefix: result.prefix,
        message: 'Save this key — it will not be shown again.',
    }, 201);
});

app.delete('/api/v1/apikeys/:id', (c) => {
    if (!revokeApiKey(c.req.param('id'))) return c.json({ error: 'Key not found' }, 404);
    return c.json({ status: 'revoked' });
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

app.get('/api/v1/events', (c) => {
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
const publicDir = path.resolve(process.cwd(), 'public');

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
        console.log(`[hivemind] Node went offline: ${id}`);
    }
}, 30_000);

// Prune old stats daily (keep 7 days)
setInterval(() => {
    const pruned = pruneStats(7);
    if (pruned > 0) {
        console.log(`[hivemind] Pruned ${pruned} old stats records`);
    }
}, 86_400_000);

// Run scheduled tasks every 60 seconds
setInterval(() => {
    const due = getDueSchedules();
    for (const schedule of due) {
        console.log('[hivemind] Running schedule: ' + schedule.name + ' (' + schedule.type + ')');

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
                    console.log('[hivemind] Unknown schedule type: ' + schedule.type);
            }

            markScheduleRun(schedule.id);
        } catch (err) {
            console.error('[hivemind] Schedule error: ' + err);
        }
    }
}, 60_000);

// =============================================================================
// Server Start
// =============================================================================

const PORT = parseInt(process.env.TENTACLAW_PORT || '8080');
const HOST = process.env.TENTACLAW_HOST || '0.0.0.0';

// Initialize DB on startup
getDb();
ensureDefaultAliases();

console.log(`
\x1b[38;2;0;255;255m        ╭──────────────────────────────────────╮\x1b[0m
\x1b[38;2;0;255;255m   ╭───┤\x1b[0m  \x1b[38;2;140;0;200mTentaCLAW HiveMind Gateway\x1b[0m  \x1b[38;2;0;255;255m├───╮\x1b[0m
\x1b[38;2;0;255;255m   │\x1b[0m  \x1b[38;2;0;140;140mOne mind to rule them all.\x1b[0m       \x1b[38;2;0;255;255m│\x1b[0m
\x1b[38;2;0;255;255m   ╰──────────────────────────────────────╯\x1b[0m
`);

const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
}, (info) => {
    console.log(`[hivemind] Gateway listening on http://${HOST}:${info.port}`);
    console.log(`[hivemind] Dashboard: http://${HOST}:${info.port}/dashboard`);
    console.log(`[hivemind] API: http://${HOST}:${info.port}/api/v1`);
    console.log(`[hivemind] Health: http://${HOST}:${info.port}/health`);
    console.log('');

    // Remote shell WebSocket server
    setupShellServer(server);

    // Auto-discovery: listen for agent broadcasts and respond
    startDiscoveryService(info.port);
});

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
                    console.log(`[hivemind] Discovery: agent ${data.node_id} at ${rinfo.address}`);
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
            console.log(`[hivemind] Discovery listener on UDP port ${DISCOVERY_PORT}`);
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
            console.log(`[hivemind] Broadcasting gateway presence every 30s`);
        });
    } catch {
        console.log('[hivemind] Auto-discovery unavailable (non-fatal)');
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

        // Agent registers its shell tunnel
        const agentMatch = path.match(/^\/ws\/agent-shell\/(.+)$/);
        if (agentMatch) {
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

        // Dashboard requests a shell
        const dashMatch = path.match(/^\/ws\/shell\/(.+)$/);
        if (dashMatch) {
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
// Prometheus Metrics (Wave 26)
// =============================================================================

app.get('/metrics', (c) => {
    const nodes = getAllNodes();
    const online = nodes.filter(n => n.status === 'online');
    const stats = getRequestStats();
    const cacheStats = getCacheStats();

    let metrics = '';
    // Cluster metrics
    metrics += '# HELP tentaclaw_nodes_total Total number of nodes\n';
    metrics += '# TYPE tentaclaw_nodes_total gauge\n';
    metrics += 'tentaclaw_nodes_total ' + nodes.length + '\n';
    metrics += '# HELP tentaclaw_nodes_online Online nodes\n';
    metrics += '# TYPE tentaclaw_nodes_online gauge\n';
    metrics += 'tentaclaw_nodes_online ' + online.length + '\n';

    // GPU metrics per node
    metrics += '# HELP tentaclaw_gpu_temperature_celsius GPU temperature\n';
    metrics += '# TYPE tentaclaw_gpu_temperature_celsius gauge\n';
    metrics += '# HELP tentaclaw_gpu_utilization_percent GPU utilization\n';
    metrics += '# TYPE tentaclaw_gpu_utilization_percent gauge\n';
    metrics += '# HELP tentaclaw_gpu_vram_used_mb GPU VRAM used\n';
    metrics += '# TYPE tentaclaw_gpu_vram_used_mb gauge\n';
    metrics += '# HELP tentaclaw_gpu_vram_total_mb GPU VRAM total\n';
    metrics += '# TYPE tentaclaw_gpu_vram_total_mb gauge\n';
    metrics += '# HELP tentaclaw_gpu_power_watts GPU power draw\n';
    metrics += '# TYPE tentaclaw_gpu_power_watts gauge\n';

    for (const node of online) {
        if (!node.latest_stats) continue;
        for (let i = 0; i < node.latest_stats.gpus.length; i++) {
            const g = node.latest_stats.gpus[i];
            const labels = '{node="' + node.hostname + '",gpu="' + i + '"}';
            metrics += 'tentaclaw_gpu_temperature_celsius' + labels + ' ' + g.temperatureC + '\n';
            metrics += 'tentaclaw_gpu_utilization_percent' + labels + ' ' + g.utilizationPct + '\n';
            metrics += 'tentaclaw_gpu_vram_used_mb' + labels + ' ' + g.vramUsedMb + '\n';
            metrics += 'tentaclaw_gpu_vram_total_mb' + labels + ' ' + g.vramTotalMb + '\n';
            metrics += 'tentaclaw_gpu_power_watts' + labels + ' ' + g.powerDrawW + '\n';
        }
    }

    // Request metrics
    metrics += '# HELP tentaclaw_requests_total Total inference requests\n';
    metrics += '# TYPE tentaclaw_requests_total counter\n';
    metrics += 'tentaclaw_requests_total ' + stats.total + '\n';
    metrics += '# HELP tentaclaw_requests_last_hour Requests in last hour\n';
    metrics += '# TYPE tentaclaw_requests_last_hour gauge\n';
    metrics += 'tentaclaw_requests_last_hour ' + stats.last_hour + '\n';
    metrics += '# HELP tentaclaw_avg_latency_ms Average request latency\n';
    metrics += '# TYPE tentaclaw_avg_latency_ms gauge\n';
    metrics += 'tentaclaw_avg_latency_ms ' + stats.avg_latency_ms + '\n';

    // Cache metrics
    metrics += '# HELP tentaclaw_cache_entries Cached prompt entries\n';
    metrics += '# TYPE tentaclaw_cache_entries gauge\n';
    metrics += 'tentaclaw_cache_entries ' + cacheStats.entries + '\n';
    metrics += '# HELP tentaclaw_cache_hits Total cache hits\n';
    metrics += '# TYPE tentaclaw_cache_hits counter\n';
    metrics += 'tentaclaw_cache_hits ' + cacheStats.total_hits + '\n';

    return new Response(metrics, { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
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

    const onlineNodes = fleet.filter(n => n.status === 'online');
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
