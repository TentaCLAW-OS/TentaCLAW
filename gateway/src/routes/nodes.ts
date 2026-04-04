/**
 * Node routes — registration, stats, commands, benchmarks, events, logs, etc.
 */
import { Hono } from 'hono';
import type { StatsPayload, GatewayResponse, CommandAction } from '../../../shared/types';
import {
    registerNode,
    getNode,
    getAllNodes,
    getNodesByFarm,
    deleteNode,
    insertStats,
    getStatsHistory,
    getPendingCommands,
    ackCommand,
    queueCommand,
    completeCommand,
    checkAndAlert,
    evaluateAlertRules,
    storeBenchmark,
    getNodeBenchmarks,
    getAllBenchmarks,
    recordNodeEvent,
    getNodeEvents,
    getCompactHistory,
    getNodeHealthScore,
    getNodeUptime,
    setOverclockProfile,
    getOverclockProfiles,
    recordWatchdogEvent,
    getWatchdogEvents,
    getAllWatchdogEvents,
    setMaintenanceMode,
    recordAuditEvent,
} from '../db';
import { broadcastSSE, broadcastDaphney, validateClusterSecret } from '../shared';

const routes = new Hono();

// =============================================================================
// Node Registration
// =============================================================================

routes.post('/api/v1/register', async (c) => {
    const clusterSecret = c.req.header('X-Cluster-Secret');
    if (!validateClusterSecret(clusterSecret)) {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('agent_auth_failed', 'agent', ip, 'Invalid cluster secret on /api/v1/register');
        return c.json({ error: 'Forbidden. Invalid or missing cluster secret. Set X-Cluster-Secret header.' }, 403);
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
// Stats Ingestion
// =============================================================================

routes.post('/api/v1/nodes/:nodeId/stats', async (c) => {
    const clusterSecret = c.req.header('X-Cluster-Secret');
    if (!validateClusterSecret(clusterSecret)) {
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('agent_auth_failed', 'agent', ip, `Invalid cluster secret on /api/v1/nodes/${c.req.param('nodeId')}/stats`);
        return c.json({ error: 'Forbidden. Invalid or missing cluster secret. Set X-Cluster-Secret header.' }, 403);
    }

    const nodeId = c.req.param('nodeId');
    const stats: StatsPayload = await c.req.json();

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

    // Validate numeric fields — prevent NaN/Infinity from entering the DB
    if (!Number.isFinite(stats.toks_per_sec) || stats.toks_per_sec < 0) stats.toks_per_sec = 0;
    if (stats.cpu && (!Number.isFinite(stats.cpu.usage_pct) || stats.cpu.usage_pct < 0)) stats.cpu.usage_pct = 0;
    for (const gpu of (stats.gpus || [])) {
        if (!Number.isFinite(gpu.vramTotalMb) || gpu.vramTotalMb < 0) gpu.vramTotalMb = 0;
        if (!Number.isFinite(gpu.vramUsedMb) || gpu.vramUsedMb < 0) gpu.vramUsedMb = 0;
        if (gpu.vramUsedMb > gpu.vramTotalMb) gpu.vramUsedMb = gpu.vramTotalMb;
        if (!Number.isFinite(gpu.temperatureC)) gpu.temperatureC = 0;
        if (!Number.isFinite(gpu.utilizationPct) || gpu.utilizationPct < 0 || gpu.utilizationPct > 100) gpu.utilizationPct = 0;
    }

    const existing = getNode(nodeId);
    if (!existing) {
        registerNode({
            node_id: nodeId,
            farm_hash: stats.farm_hash || 'unknown',
            hostname: stats.hostname || nodeId,
            gpu_count: stats.gpu_count || 0,
        });
    } else if (stats.farm_hash && stats.farm_hash !== existing.farm_hash && existing.farm_hash !== 'unknown') {
        console.warn(`[nodes] Ignoring farm_hash change for ${nodeId}: ${existing.farm_hash} → ${stats.farm_hash}`);
    }

    insertStats(nodeId, stats);

    const newAlerts = checkAndAlert(nodeId, stats);
    for (const alert of newAlerts) {
        broadcastSSE('alert', alert);
    }

    const ruleAlerts = evaluateAlertRules(nodeId, stats);
    for (const alert of ruleAlerts) {
        broadcastSSE('alert', alert);
    }

    broadcastSSE('stats_update', {
        node_id: nodeId,
        hostname: stats.hostname,
        gpu_count: stats.gpu_count,
        toks_per_sec: stats.toks_per_sec,
        timestamp: new Date().toISOString(),
    });

    broadcastDaphney('stats_update', {
        type: 'gpu_temp_change',
        node_id: nodeId,
        hostname: stats.hostname,
        gpus: stats.gpus.map(g => ({ name: g.name, temp: g.temperatureC, util: g.utilizationPct })),
        inference: stats.inference,
        timestamp: new Date().toISOString(),
    });

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

routes.get('/api/v1/nodes', (c) => {
    const farmHash = c.req.query('farm_hash');
    const nodes = farmHash ? getNodesByFarm(farmHash) : getAllNodes();
    return c.json({ nodes });
});

routes.get('/api/v1/nodes/hot', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const hot = nodes.filter(n => n.latest_stats!.gpus.some(g => g.temperatureC > 75)).map(n => ({
        node_id: n.id, hostname: n.hostname,
        max_temp: Math.max(...n.latest_stats!.gpus.map(g => g.temperatureC)),
        gpus: n.latest_stats!.gpus.filter(g => g.temperatureC > 75).map(g => ({ name: g.name, temp: g.temperatureC })),
    }));
    return c.json({ hot_nodes: hot, count: hot.length });
});

routes.get('/api/v1/nodes/idle', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const idle = nodes.filter(n => {
        const avgUtil = n.latest_stats!.gpus.reduce((s, g) => s + g.utilizationPct, 0) / Math.max(n.latest_stats!.gpus.length, 1);
        return avgUtil < 5;
    }).map(n => ({ node_id: n.id, hostname: n.hostname, gpu_count: n.gpu_count, models: n.latest_stats!.inference.loaded_models.length }));
    return c.json({ idle_nodes: idle, count: idle.length });
});

routes.get('/api/v1/nodes/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }
    return c.json({ node });
});

routes.delete('/api/v1/nodes/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    const deleted = deleteNode(nodeId);
    if (!deleted) {
        return c.json({ error: 'Node not found' }, 404);
    }
    return c.json({ status: 'deleted', node_id: nodeId });
});

routes.get('/api/v1/nodes/:nodeId/stats/history', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '100');
    const history = getStatsHistory(nodeId, limit);
    return c.json({ stats: history });
});

// =============================================================================
// Commands
// =============================================================================

routes.post('/api/v1/nodes/:nodeId/commands', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();

    if (!body.action) {
        return c.json({ error: 'Missing required field: action' }, 400);
    }

    const node = getNode(nodeId);
    if (!node) {
        return c.json({ error: 'Node not found' }, 404);
    }
    if (node.status !== 'online') {
        return c.json({ error: 'Node is offline', status: node.status }, 409);
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

routes.post('/api/v1/commands/:commandId/ack', (c) => {
    const commandId = c.req.param('commandId');
    ackCommand(commandId);
    return c.json({ status: 'acknowledged', id: commandId });
});

routes.post('/api/v1/commands/:commandId/complete', (c) => {
    const commandId = c.req.param('commandId');
    completeCommand(commandId);

    broadcastSSE('command_completed', {
        command_id: commandId,
        timestamp: new Date().toISOString(),
    });

    return c.json({ status: 'completed', command_id: commandId });
});

// =============================================================================
// Benchmarks
// =============================================================================

routes.get('/api/v1/benchmarks', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const benchmarks = getAllBenchmarks(limit);
    return c.json({ benchmarks });
});

routes.get('/api/v1/nodes/:nodeId/benchmarks', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '20');
    const benchmarks = getNodeBenchmarks(nodeId, limit);
    return c.json({ benchmarks });
});

routes.post('/api/v1/nodes/:nodeId/benchmark', async (c) => {
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

routes.post('/api/v1/nodes/:nodeId/benchmark/run', async (c) => {
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
// Node Events & History
// =============================================================================

routes.get('/api/v1/nodes/:nodeId/events', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '50');
    const events = getNodeEvents(nodeId, limit);
    return c.json({ events });
});

routes.get('/api/v1/nodes/:nodeId/sparklines', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('points') || '60');
    const history = getCompactHistory(nodeId, limit);
    return c.json(history);
});

// =============================================================================
// Node Logs
// =============================================================================

const nodeLogBuffers = new Map<string, { lines: string[]; maxLines: number }>();

routes.get('/api/v1/nodes/:nodeId/logs', (c) => {
    const nodeId = c.req.param('nodeId');
    const limit = parseInt(c.req.query('limit') || '100');
    const buffer = nodeLogBuffers.get(nodeId);
    if (!buffer) return c.json({ logs: [] });
    return c.json({ logs: buffer.lines.slice(-limit) });
});

routes.post('/api/v1/nodes/:nodeId/logs', async (c) => {
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
// Node Health, Uptime, Overclocking
// =============================================================================

routes.get('/api/v1/nodes/:id/health-score', (c) => {
    return c.json(getNodeHealthScore(c.req.param('id')));
});

routes.get('/api/v1/nodes/:id/uptime', (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    return c.json(getNodeUptime(c.req.param('id'), hours));
});

routes.get('/api/v1/nodes/:id/overclock', (c) => {
    return c.json(getOverclockProfiles(c.req.param('id')));
});

routes.post('/api/v1/nodes/:id/overclock', async (c) => {
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

    setOverclockProfile(nodeId, body.gpu_index, body);

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
// Maintenance Mode
// =============================================================================

routes.post('/api/v1/nodes/:id/maintenance', async (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ enabled: boolean }>();
    setMaintenanceMode(nodeId, body.enabled);
    broadcastSSE('maintenance', { node_id: nodeId, enabled: body.enabled });
    return c.json({ status: body.enabled ? 'maintenance' : 'online', node_id: nodeId });
});

// =============================================================================
// Watchdog
// =============================================================================

routes.post('/api/v1/nodes/:id/watchdog', async (c) => {
    const nodeId = c.req.param('id');
    const body = await c.req.json<{ events: Array<{ level: number; action: string; detail: string }> }>();
    const { getAllNotificationChannels, sendNotification } = await import('../db');

    if (body.events) {
        for (const evt of body.events) {
            recordWatchdogEvent(nodeId, evt.level, evt.action, evt.detail);

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

routes.get('/api/v1/nodes/:id/watchdog', (c) => {
    return c.json(getWatchdogEvents(c.req.param('id')));
});

routes.get('/api/v1/watchdog', (c) => {
    const limit = parseInt(c.req.query('limit') || '100');
    return c.json(getAllWatchdogEvents(limit));
});

// =============================================================================
// Doctor: receive agent self-heal reports
// =============================================================================

routes.post('/api/v1/nodes/:id/doctor', async (c) => {
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

// =============================================================================
// Node Lifecycle
// =============================================================================

routes.get('/api/v1/nodes/:id/lifecycle', (c) => {
    const nodeId = c.req.param('id');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const events = getNodeEvents(nodeId, 50);
    const uptime = getNodeUptime(nodeId, 720);
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

export default routes;
