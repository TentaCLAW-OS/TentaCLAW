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
} from './db';

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

// Chat completions proxy — routes to the best available node
app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json();
    const model = body.model;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }

    // Find best node for this model
    const target = findBestNode(model);
    if (!target) {
        return c.json({
            error: {
                message: 'No online node has model "' + model + '" loaded. Deploy it first with POST /api/v1/deploy',
                type: 'model_not_found',
                available_models: getClusterModels().map(m => m.model),
            },
        }, 503);
    }

    // Proxy the request to the target node's Ollama instance
    const ollamaUrl = 'http://' + (target.ip_address || target.hostname) + ':11434/v1/chat/completions';

    try {
        const proxyReq = await fetch(ollamaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

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
                },
            });
        }

        const result = await proxyReq.json() as Record<string, unknown>;
        result._tentaclaw = {
            routed_to: target.node_id,
            hostname: target.hostname,
            gpu_utilization: target.gpu_utilization_avg,
        };
        return c.json(result, proxyReq.status as any);

    } catch (err: any) {
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
    const model = body.model;
    if (!model) return c.json({ error: { message: 'model is required' } }, 400);

    const target = findBestNode(model);
    if (!target) return c.json({ error: { message: 'No node has model "' + model + '" loaded' } }, 503);

    const ollamaUrl = 'http://' + (target.ip_address || target.hostname) + ':11434/v1/embeddings';
    try {
        const proxyReq = await fetch(ollamaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await proxyReq.json() as Record<string, unknown>;
        result._tentaclaw = { routed_to: target.node_id, hostname: target.hostname };
        return c.json(result, proxyReq.status as any);
    } catch (err: any) {
        return c.json({ error: { message: 'Proxy failed: ' + err.message } }, 502);
    }
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

app.use('/dashboard/*', serveStatic({
    root: path.relative(process.cwd(), path.join(__dirname, '..', 'public')),
    rewriteRequestPath: (p) => p.replace('/dashboard', ''),
}));

// Redirect /dashboard to /dashboard/
app.get('/dashboard', (c) => c.redirect('/dashboard/'));

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

console.log(`
\x1b[38;2;0;255;255m        ╭──────────────────────────────────────╮\x1b[0m
\x1b[38;2;0;255;255m   ╭───┤\x1b[0m  \x1b[38;2;140;0;200mTentaCLAW HiveMind Gateway\x1b[0m  \x1b[38;2;0;255;255m├───╮\x1b[0m
\x1b[38;2;0;255;255m   │\x1b[0m  \x1b[38;2;0;140;140mOne mind to rule them all.\x1b[0m       \x1b[38;2;0;255;255m│\x1b[0m
\x1b[38;2;0;255;255m   ╰──────────────────────────────────────╯\x1b[0m
`);

serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
}, (info) => {
    console.log(`[hivemind] Gateway listening on http://${HOST}:${info.port}`);
    console.log(`[hivemind] Dashboard: http://${HOST}:${info.port}/dashboard`);
    console.log(`[hivemind] API: http://${HOST}:${info.port}/api/v1`);
    console.log(`[hivemind] Health: http://${HOST}:${info.port}/health`);
    console.log('');

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
