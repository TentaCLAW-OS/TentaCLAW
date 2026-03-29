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

    if (!body.node_id || !body.farm_hash || !body.hostname) {
        return c.json({ error: 'Missing required fields: node_id, farm_hash, hostname' }, 400);
    }

    const node = registerNode({
        node_id: body.node_id,
        farm_hash: body.farm_hash,
        hostname: body.hostname,
        ip_address: body.ip_address,
        mac_address: body.mac_address,
        gpu_count: body.gpu_count || 0,
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
});
