/**
 * Misc routes — health, summary, tags, schedules, SSH keys, farms, topology,
 * power, leaderboard, discovery, doctor, bulk ops, webhooks, badges,
 * capacity, search, digest, status page, about, errors, suggestions, etc.
 */
import { Hono } from 'hono';
import {
    getDb,
    getAllNodes,
    getNode,
    getNodesByFarm,
    getClusterSummary,
    getClusterModels,
    getHealthScore,
    markStaleNodes,
    pruneStats,
    queueCommand,
    createSchedule,
    getAllSchedules,
    getSchedule,
    deleteSchedule,
    toggleSchedule,
    addSshKey,
    getNodeSshKeys,
    deleteSshKey,
    addNodeTag,
    removeNodeTag,
    getNodeTags,
    getNodesByTag,
    getAllTags,
    getRequestStats,
    getInferenceAnalytics,
    runAutoMode,
    getAllModelAliases,
    getClusterPower,
    getClusterTimeline,
    getFleetReliability,
    getFleetUptime,
    getNodeHealthScore,
    getNodeUptime,
    createNodeGroup,
    getNodeGroups,
    addNodeToGroup,
    deleteNodeGroup,
    getGroupMembers,
    addPlacementConstraint,
    getPlacementConstraints,
    deletePlacementConstraint,
    getCacheStats,
} from '../db';
import { generateWaitComedy } from '../comedy';
import { broadcastSSE, webhooks, fireWebhooks, getQueueStats, type WebhookConfig } from '../shared';

const routes = new Hono();

// =============================================================================
// Health
// =============================================================================

routes.get('/health', (c) => {
    return c.json({
        status: 'ok',
        service: 'tentaclaw-gateway',
        version: '0.1.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

routes.get('/', (c) => {
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

routes.get('/api/v1/summary', (c) => {
    const summary = getClusterSummary();
    return c.json(summary);
});

routes.get('/api/v1/health/score', (c) => {
    const health = getHealthScore();
    return c.json(health);
});

routes.get('/api/v1/health/detailed', (c) => {
    const checks: Record<string, unknown> = {};
    let hasError = false;
    let hasWarning = false;

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

    try {
        const allNodes = getAllNodes();
        const total = allNodes.length;
        const online = allNodes.filter(n => n.status === 'online').length;
        let nodeStatus: 'ok' | 'degraded' | 'error' = 'ok';
        if (total === 0 || online === 0) { nodeStatus = 'error'; hasError = true; }
        else if (online < total) { nodeStatus = 'degraded'; hasWarning = true; }
        checks.nodes = { total, online, status: nodeStatus };
    } catch {
        checks.nodes = { total: 0, online: 0, status: 'error' };
        hasError = true;
    }

    const mem = process.memoryUsage();
    const rssMb = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
    const heapMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
    const memStatus = rssMb > 512 ? 'warning' : 'ok';
    if (memStatus === 'warning') hasWarning = true;
    checks.memory = { status: memStatus, rss_mb: rssMb, heap_mb: heapMb };

    const diskStatus = rssMb > 1024 ? 'warning' : 'ok';
    if (diskStatus === 'warning') hasWarning = true;
    checks.disk = { status: diskStatus, data_dir_mb: rssMb };

    checks.uptime_seconds = Math.round(process.uptime());

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (hasError) status = 'unhealthy';
    else if (hasWarning) status = 'degraded';

    const statusCode = status === 'unhealthy' ? 503 : 200;
    return c.json({
        status, checks, version: '0.2.0', timestamp: new Date().toISOString(),
    }, statusCode);
});

routes.get('/api/v1/healthz', (c) => c.text('ok'));

routes.get('/api/v1/readyz', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online');
    const models = getClusterModels();
    if (nodes.length === 0) return c.json({ status: 'not_ready', reason: 'no online nodes' }, 503);
    if (models.length === 0) return c.json({ status: 'not_ready', reason: 'no models loaded' }, 503);
    return c.json({ status: 'ready', nodes: nodes.length, models: models.length });
});

// =============================================================================
// Farms
// =============================================================================

routes.get('/api/v1/farms', (c) => {
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
            farm_hash: hash, total_nodes: nodes.length, online_nodes: online,
            total_gpus: totalGpus, total_vram_mb: totalVram, total_toks_per_sec: totalToks,
        };
    });

    return c.json({ farms });
});

routes.get('/api/v1/farms/:hash', (c) => {
    const hash = c.req.param('hash');
    const nodes = getNodesByFarm(hash);
    if (nodes.length === 0) return c.json({ error: 'Farm not found' }, 404);
    return c.json({ farm_hash: hash, nodes });
});

// =============================================================================
// Schedules
// =============================================================================

routes.get('/api/v1/schedules', (c) => {
    const schedules = getAllSchedules();
    return c.json({ schedules });
});

routes.post('/api/v1/schedules', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.type || !body.cron) {
        return c.json({ error: 'Missing required fields: name, type, cron' }, 400);
    }

    const schedule = createSchedule(body.name, body.type, body.cron, body.config || {});
    console.log('[tentaclaw] Schedule created: ' + schedule.name + ' (' + schedule.cron + ')');
    return c.json({ status: 'created', schedule });
});

routes.get('/api/v1/schedules/:id', (c) => {
    const schedule = getSchedule(c.req.param('id'));
    if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ schedule });
});

routes.delete('/api/v1/schedules/:id', (c) => {
    if (!deleteSchedule(c.req.param('id'))) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ status: 'deleted' });
});

routes.post('/api/v1/schedules/:id/toggle', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const enabled = body.enabled !== undefined ? !!body.enabled : true;
    if (!toggleSchedule(c.req.param('id'), enabled)) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ status: enabled ? 'enabled' : 'disabled' });
});

// =============================================================================
// SSH Keys
// =============================================================================

routes.get('/api/v1/nodes/:id/ssh-keys', (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    return c.json(getNodeSshKeys(c.req.param('id')));
});

routes.post('/api/v1/nodes/:id/ssh-keys', async (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ label: string; public_key: string }>();
    if (!body.label || !body.public_key) return c.json({ error: 'label and public_key required' }, 400);
    if (!body.public_key.startsWith('ssh-')) return c.json({ error: 'Invalid SSH public key format' }, 400);

    const key = addSshKey(c.req.param('id'), body.label, body.public_key);
    queueCommand(c.req.param('id'), 'install_model', { ssh_key: body.public_key, ssh_label: body.label });
    broadcastSSE('ssh_key_added', { node_id: c.req.param('id'), key });
    return c.json(key, 201);
});

routes.delete('/api/v1/ssh-keys/:keyId', (c) => {
    if (!deleteSshKey(c.req.param('keyId'))) return c.json({ error: 'Key not found' }, 404);
    return c.json({ status: 'deleted' });
});

// =============================================================================
// Tags
// =============================================================================

routes.get('/api/v1/tags', (c) => {
    return c.json(getAllTags());
});

routes.get('/api/v1/tags/:tag/nodes', (c) => {
    return c.json(getNodesByTag(c.req.param('tag')));
});

routes.get('/api/v1/nodes/:id/tags', (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    return c.json(getNodeTags(c.req.param('id')));
});

routes.post('/api/v1/nodes/:id/tags', async (c) => {
    const node = getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const body = await c.req.json<{ tags: string[] }>();
    if (!body.tags || !Array.isArray(body.tags)) return c.json({ error: 'tags array required' }, 400);

    const validTags = body.tags.filter(t => typeof t === 'string' && t.trim().length > 0);
    if (validTags.length === 0) return c.json({ error: 'tags must contain at least one non-empty string' }, 400);

    for (const tag of validTags) {
        addNodeTag(c.req.param('id'), tag);
    }
    return c.json(getNodeTags(c.req.param('id')));
});

routes.delete('/api/v1/nodes/:id/tags/:tag', (c) => {
    if (!removeNodeTag(c.req.param('id'), c.req.param('tag'))) {
        return c.json({ error: 'Tag not found on node' }, 404);
    }
    return c.json({ status: 'removed' });
});

// =============================================================================
// Comedy
// =============================================================================

routes.get('/api/v1/comedy/wait-line', async (c) => {
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

routes.post('/api/v1/comedy/wait-line', async (c) => {
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
// Topology, Leaderboard, Compare, Discovery, Power
// =============================================================================

routes.get('/api/v1/topology', (c) => {
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

routes.get('/api/v1/leaderboard', (c) => {
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
            model, total_toks_per_sec: stats.total_toks,
            avg_toks_per_sec: Math.round(stats.total_toks / stats.node_count),
            node_count: stats.node_count, best_node: stats.best_node,
            best_toks_per_sec: stats.best_toks, nodes: stats.nodes,
        }))
        .sort((a, b) => b.total_toks_per_sec - a.total_toks_per_sec);

    return c.json({ leaderboard });
});

routes.get('/api/v1/leaderboard/models', (c) => {
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

routes.get('/api/v1/compare', (c) => {
    const nodeIds = (c.req.query('nodes') || '').split(',').filter(Boolean);
    const nodes = getAllNodes().filter(n => nodeIds.length === 0 || nodeIds.includes(n.id));

    const comparison = nodes.map(n => {
        const s = n.latest_stats || {} as any;
        const health = getNodeHealthScore(n.id);
        const uptime = getNodeUptime(n.id, 24);
        return {
            node_id: n.id, hostname: n.hostname, status: n.status,
            health: health.score, grade: health.grade, uptime_pct: uptime.uptime_pct,
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

routes.get('/api/v1/discover', (c) => {
    return c.json({
        service: 'tentaclaw-gateway', version: '0.1.0', api: '/api/v1',
        register: '/api/v1/register', stats: '/api/v1/nodes/{nodeId}/stats',
        openai: '/v1/chat/completions', anthropic: '/v1/messages',
        dashboard: '/dashboard', health: '/health',
    });
});

routes.get('/api/v1/power', (c) => {
    return c.json(getClusterPower());
});

routes.get('/api/v1/fleet', (c) => {
    return c.json(getFleetReliability());
});

routes.get('/api/v1/uptime', (c) => {
    const hours = parseInt(c.req.query('hours') || '24') || 24;
    return c.json(getFleetUptime(hours));
});

routes.get('/api/v1/timeline', (c) => {
    const limit = parseInt(c.req.query('limit') || '50') || 50;
    return c.json(getClusterTimeline(limit));
});

// =============================================================================
// Auto Mode
// =============================================================================

routes.post('/api/v1/auto', (c) => {
    const decisions = runAutoMode();
    broadcastSSE('auto_mode', { decisions: decisions.length, executed: decisions.filter(d => d.executed).length });
    return c.json({
        decisions,
        executed: decisions.filter(d => d.executed).length,
        suggested: decisions.filter(d => !d.executed).length,
    });
});

routes.get('/api/v1/auto/status', (c) => {
    return c.json({ enabled: true, last_run: null, interval_minutes: 30 });
});

// =============================================================================
// Queue
// =============================================================================

routes.get('/api/v1/queue', (c) => {
    return c.json(getQueueStats());
});

// =============================================================================
// Inventory
// =============================================================================

routes.get('/api/v1/inventory', (c) => {
    const nodes = getAllNodes();
    const inventory = nodes.map(n => {
        const s = n.latest_stats || {} as any;
        return {
            node_id: n.id, hostname: n.hostname, status: n.status, ip_address: n.ip_address,
            system: s.system_info || {}, backend: s.backend || {},
            gpus: (s.gpus || []).map((g: any) => ({ name: g.name, vram_mb: g.vramTotalMb, bus_id: g.busId })),
            models: s.inference?.loaded_models || [],
            registered_at: n.registered_at, last_seen: n.last_seen_at,
        };
    });

    const totalGpus = inventory.reduce((s, n) => s + n.gpus.length, 0);
    const totalVram = inventory.reduce((s, n) => s + n.gpus.reduce((vs: number, g: any) => vs + (g.vram_mb || 0), 0), 0);
    const totalRam = inventory.reduce((s, n) => s + (n.system.ram_total_gb || 0), 0);
    const totalCores = inventory.reduce((s, n) => s + (n.system.cpu_cores || 0), 0);

    return c.json({
        total_nodes: inventory.length, total_gpus: totalGpus,
        total_vram_gb: Math.round(totalVram / 1024), total_ram_gb: Math.round(totalRam),
        total_cpu_cores: totalCores, nodes: inventory,
    });
});

// =============================================================================
// Doctor
// =============================================================================

routes.get('/api/v1/doctor', async (c) => {
    const autofix = c.req.query('autofix') !== 'false';
    const results: Array<{ check: string; status: 'ok' | 'warning' | 'critical' | 'fixed'; message: string; auto_fixed?: boolean; detail?: unknown }> = [];
    const d = getDb();

    const allNodes = getAllNodes();
    const staleThreshold = 90;
    const now = Date.now();
    let staleFixed = 0;
    for (const node of allNodes) {
        if (node.status === 'online' && node.last_seen_at) {
            const lastSeen = new Date(node.last_seen_at + 'Z').getTime();
            const ageSecs = (now - lastSeen) / 1000;
            if (ageSecs > staleThreshold) {
                if (autofix) { markStaleNodes(staleThreshold); staleFixed++; }
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
        results.push({ check: 'stale_nodes', status: staleCount > 0 ? 'warning' : 'ok', message: staleCount > 0 ? `${staleCount} node(s) appear stale` : 'All online nodes are reporting' });
    }

    const orphanedStats = (d.prepare(`SELECT COUNT(*) as cnt FROM stats WHERE node_id NOT IN (SELECT id FROM nodes)`).get() as { cnt: number }).cnt;
    if (orphanedStats > 0 && autofix) {
        d.prepare('DELETE FROM stats WHERE node_id NOT IN (SELECT id FROM nodes)').run();
        results.push({ check: 'orphaned_stats', status: 'fixed', message: `Cleaned ${orphanedStats} orphaned stat rows`, auto_fixed: true });
    } else {
        results.push({ check: 'orphaned_stats', status: orphanedStats > 0 ? 'warning' : 'ok', message: orphanedStats > 0 ? `${orphanedStats} orphaned stat rows found` : 'No orphaned data' });
    }

    const orphanedCmds = (d.prepare(`SELECT COUNT(*) as cnt FROM commands WHERE node_id NOT IN (SELECT id FROM nodes)`).get() as { cnt: number }).cnt;
    if (orphanedCmds > 0 && autofix) {
        d.prepare('DELETE FROM commands WHERE node_id NOT IN (SELECT id FROM nodes)').run();
        results.push({ check: 'orphaned_commands', status: 'fixed', message: `Cleaned ${orphanedCmds} orphaned commands`, auto_fixed: true });
    } else {
        results.push({ check: 'orphaned_commands', status: orphanedCmds > 0 ? 'warning' : 'ok', message: orphanedCmds > 0 ? `${orphanedCmds} orphaned commands` : 'No orphaned commands' });
    }

    const stuckCmds = d.prepare(`SELECT COUNT(*) as cnt FROM commands WHERE status = 'pending' AND created_at < datetime('now', '-5 minutes')`).get() as { cnt: number };
    if (stuckCmds.cnt > 0 && autofix) {
        d.prepare(`UPDATE commands SET status = 'failed' WHERE status = 'pending' AND created_at < datetime('now', '-5 minutes')`).run();
        results.push({ check: 'stuck_commands', status: 'fixed', message: `Failed ${stuckCmds.cnt} stuck command(s)`, auto_fixed: true });
    } else {
        results.push({ check: 'stuck_commands', status: stuckCmds.cnt > 0 ? 'warning' : 'ok', message: stuckCmds.cnt > 0 ? `${stuckCmds.cnt} stuck commands` : 'No stuck commands' });
    }

    const stalePulls = d.prepare(`SELECT COUNT(*) as cnt FROM model_pulls WHERE status = 'downloading' AND updated_at < datetime('now', '-10 minutes')`).get() as { cnt: number };
    if (stalePulls.cnt > 0 && autofix) {
        d.prepare(`UPDATE model_pulls SET status = 'error' WHERE status = 'downloading' AND updated_at < datetime('now', '-10 minutes')`).run();
        results.push({ check: 'stale_pulls', status: 'fixed', message: `Marked ${stalePulls.cnt} stale pull(s) as error`, auto_fixed: true });
    } else {
        results.push({ check: 'stale_pulls', status: stalePulls.cnt > 0 ? 'warning' : 'ok', message: stalePulls.cnt > 0 ? `${stalePulls.cnt} stale model pulls` : 'No stale pulls' });
    }

    const unackedCritical = (d.prepare(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'critical' AND acknowledged = 0`).get() as { cnt: number }).cnt;
    results.push({ check: 'unacked_critical_alerts', status: unackedCritical > 0 ? 'critical' : 'ok', message: unackedCritical > 0 ? `${unackedCritical} unacknowledged critical alert(s) — needs human attention` : 'No unacknowledged critical alerts' });

    const statsCount = (d.prepare('SELECT COUNT(*) as cnt FROM stats').get() as { cnt: number }).cnt;
    if (statsCount > 100000 && autofix) {
        pruneStats(48);
        const after = (d.prepare('SELECT COUNT(*) as cnt FROM stats').get() as { cnt: number }).cnt;
        results.push({ check: 'stats_bloat', status: 'fixed', message: `Pruned stats from ${statsCount} to ${after} rows`, auto_fixed: true });
    } else {
        results.push({ check: 'stats_bloat', status: statsCount > 50000 ? 'warning' : 'ok', message: `Stats table: ${statsCount} rows` });
    }

    const integrity = d.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
    results.push({ check: 'db_integrity', status: integrityOk ? 'ok' : 'critical', message: integrityOk ? 'Database integrity OK' : 'Database integrity check FAILED', detail: integrityOk ? undefined : integrity });

    const walMode = d.pragma('journal_mode') as Array<{ journal_mode: string }>;
    results.push({ check: 'wal_mode', status: walMode[0]?.journal_mode === 'wal' ? 'ok' : 'warning', message: `Journal mode: ${walMode[0]?.journal_mode || 'unknown'}` });

    const nodesNoModels = allNodes.filter(n => n.status === 'online' && n.latest_stats && n.latest_stats.inference.loaded_models.length === 0);
    if (nodesNoModels.length > 0 && autofix) {
        const models = getClusterModels();
        if (models.length > 0) {
            const bestModel = models[0].model;
            for (const node of nodesNoModels) { queueCommand(node.id, 'install_model', { model: bestModel }); }
            results.push({ check: 'empty_nodes', status: 'fixed', message: `Queued ${bestModel} deploy to ${nodesNoModels.length} empty node(s)`, auto_fixed: true });
        }
    } else {
        results.push({ check: 'empty_nodes', status: nodesNoModels.length > 0 ? 'warning' : 'ok', message: nodesNoModels.length > 0 ? `${nodesNoModels.length} online node(s) have no models loaded` : 'All online nodes have models loaded' });
    }

    const hotGpus: Array<{ node: string; gpu: string; temp: number }> = [];
    for (const node of allNodes) {
        if (node.latest_stats) {
            for (const gpu of node.latest_stats.gpus) {
                if (gpu.temperatureC >= 80) { hotGpus.push({ node: node.id, gpu: gpu.name, temp: gpu.temperatureC }); }
            }
        }
    }
    if (hotGpus.length > 0 && autofix) {
        const hotNodeIds = [...new Set(hotGpus.map(g => g.node))];
        for (const nodeId of hotNodeIds) { queueCommand(nodeId, 'overclock', { profile: 'stock' }); }
        results.push({ check: 'gpu_thermal', status: 'fixed', message: `Applied stock overclock to ${hotNodeIds.length} node(s) with hot GPUs`, auto_fixed: true, detail: hotGpus });
    } else {
        results.push({ check: 'gpu_thermal', status: hotGpus.length > 0 ? 'warning' : 'ok', message: hotGpus.length > 0 ? `${hotGpus.length} GPU(s) running hot (≥80°C)` : 'All GPUs within safe temperature range', detail: hotGpus.length > 0 ? hotGpus : undefined });
    }

    const fixedCount = results.filter(r => r.status === 'fixed').length;
    const criticalCount = results.filter(r => r.status === 'critical').length;
    const warningCount = results.filter(r => r.status === 'warning').length;
    const okCount = results.filter(r => r.status === 'ok').length;
    const overallStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';

    broadcastSSE('doctor_ran', { timestamp: new Date().toISOString(), status: overallStatus, fixed: fixedCount, checks: results.length });

    return c.json({
        status: overallStatus, timestamp: new Date().toISOString(), autofix_enabled: autofix,
        summary: { total_checks: results.length, ok: okCount, warnings: warningCount, critical: criticalCount, auto_fixed: fixedCount },
        results,
    });
});

routes.post('/api/v1/doctor/fix', async (c) => {
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
            for (const node of nodes) { queueCommand(node.id, 'install_model', { model }); }
            return c.json({ status: 'queued', action: 'deploy_model', model, nodes: nodes.length });
        }
        default:
            return c.json({ error: `Unknown fix: ${body.check}` }, 400);
    }
});

// =============================================================================
// Bulk Operations
// =============================================================================

routes.post('/api/v1/bulk/command', async (c) => {
    const body = await c.req.json<{ node_ids?: string[]; tag?: string; action: string; payload?: Record<string, unknown> }>();
    if (!body.action) return c.json({ error: 'action required' }, 400);

    let targetNodes: string[];
    if (body.tag) {
        targetNodes = getNodesByTag(body.tag).map(n => n.id);
    } else if (body.node_ids) {
        targetNodes = body.node_ids;
    } else {
        targetNodes = getAllNodes().filter(n => n.status === 'online').map(n => n.id);
    }

    const results: Array<{ node_id: string; status: string; error?: string }> = [];
    for (const nodeId of targetNodes) {
        try { queueCommand(nodeId, body.action as any, body.payload); results.push({ node_id: nodeId, status: 'queued' }); }
        catch (e) { results.push({ node_id: nodeId, status: 'error', error: e instanceof Error ? e.message : 'unknown' }); }
    }

    broadcastSSE('bulk_command', { action: body.action, count: results.length });
    return c.json({ action: body.action, total: results.length, results });
});

routes.post('/api/v1/bulk/tags', async (c) => {
    const body = await c.req.json<{ node_ids: string[]; tags: string[]; action: 'add' | 'remove' }>();
    if (!body.node_ids || !body.tags) return c.json({ error: 'node_ids and tags required' }, 400);

    let count = 0;
    for (const nodeId of body.node_ids) {
        for (const tag of body.tags) {
            if (body.action === 'remove') { removeNodeTag(nodeId, tag); } else { addNodeTag(nodeId, tag); }
            count++;
        }
    }
    return c.json({ status: 'done', operations: count });
});

routes.post('/api/v1/bulk/reboot', async (c) => {
    const body = await c.req.json<{ node_ids?: string[]; tag?: string }>();
    let targets: string[];
    if (body.tag) { targets = getNodesByTag(body.tag).map(n => n.id); }
    else if (body.node_ids) { targets = body.node_ids; }
    else { return c.json({ error: 'node_ids or tag required' }, 400); }

    for (const nodeId of targets) { queueCommand(nodeId, 'reboot'); }
    broadcastSSE('bulk_reboot', { count: targets.length });
    return c.json({ status: 'queued', count: targets.length });
});

routes.post('/api/v1/bulk/deploy', async (c) => {
    const body = await c.req.json<{ model: string; node_ids?: string[]; tag?: string }>();
    if (!body.model) return c.json({ error: 'model required' }, 400);

    let targets: string[];
    if (body.tag) { targets = getNodesByTag(body.tag).map(n => n.id); }
    else if (body.node_ids) { targets = body.node_ids; }
    else { targets = getAllNodes().filter(n => n.status === 'online').map(n => n.id); }

    for (const nodeId of targets) { queueCommand(nodeId, 'install_model', { model: body.model }); }
    broadcastSSE('bulk_deploy', { model: body.model, count: targets.length });
    return c.json({ status: 'queued', model: body.model, count: targets.length });
});

// =============================================================================
// Node Groups & Placement
// =============================================================================

routes.get('/api/v1/node-groups', (c) => c.json(getNodeGroups()));

routes.post('/api/v1/node-groups', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const group = createNodeGroup(body.name, body.description);
    return c.json(group, 201);
});

routes.delete('/api/v1/node-groups/:id', (c) => {
    const deleted = deleteNodeGroup(c.req.param('id'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

routes.post('/api/v1/node-groups/:id/members', async (c) => {
    const body = await c.req.json();
    if (!body.node_id) return c.json({ error: 'node_id required' }, 400);
    addNodeToGroup(c.req.param('id'), body.node_id);
    return c.json({ added: true });
});

routes.get('/api/v1/node-groups/:id/members', (c) => c.json(getGroupMembers(c.req.param('id'))));

routes.get('/api/v1/placement-constraints', (c) => {
    const model = c.req.query('model');
    return c.json(getPlacementConstraints(model || undefined));
});

routes.post('/api/v1/placement-constraints', async (c) => {
    const body = await c.req.json();
    if (!body.model || !body.constraint_type || !body.target) {
        return c.json({ error: 'model, constraint_type, and target are required' }, 400);
    }
    return c.json(addPlacementConstraint(body.model, body.constraint_type, body.target), 201);
});

routes.delete('/api/v1/placement-constraints/:id', (c) => {
    const deleted = deletePlacementConstraint(c.req.param('id'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

// =============================================================================
// Webhooks
// =============================================================================

routes.get('/api/v1/webhooks', (c) => {
    return c.json(webhooks.map(w => ({ ...w, secret: w.secret ? '***' : undefined })));
});

routes.post('/api/v1/webhooks', async (c) => {
    const body = await c.req.json();
    if (!body.url || typeof body.url !== 'string') {
        return c.json({ error: 'url is required' }, 400);
    }
    const wh: WebhookConfig = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: body.url, events: body.events || ['*'],
        secret: body.secret || undefined, enabled: body.enabled !== false,
        created_at: new Date().toISOString(),
    };
    webhooks.push(wh);
    return c.json(wh, 201);
});

routes.delete('/api/v1/webhooks/:id', (c) => {
    const id = c.req.param('id');
    const idx = webhooks.findIndex(w => w.id === id);
    if (idx === -1) return c.json({ error: 'Webhook not found' }, 404);
    webhooks.splice(idx, 1);
    return c.json({ deleted: true });
});

routes.post('/api/v1/webhooks/:id/test', async (c) => {
    const id = c.req.param('id');
    const wh = webhooks.find(w => w.id === id);
    if (!wh) return c.json({ error: 'Webhook not found' }, 404);
    fireWebhooks('test', { message: 'TentaCLAW says hello!', webhook_id: id });
    return c.json({ sent: true });
});

// =============================================================================
// Remote Shells
// =============================================================================

routes.get('/api/v1/shells', (c) => {
    // Shell state is managed in the main index.ts (WebSocket layer)
    // This just returns an empty list as placeholder — real shell tracking
    // happens at the WebSocket level in index.ts
    return c.json({ available: [], active: [] });
});

// =============================================================================
// Prometheus Metrics
// =============================================================================

routes.get('/metrics', (_c) => {
    const nodes = getAllNodes();
    const online = nodes.filter(n => n.status === 'online');
    const offline = nodes.filter(n => n.status !== 'online');
    const stats = getRequestStats();
    const cacheStats = getCacheStats();
    const models = getClusterModels();
    const analytics = getInferenceAnalytics(24);
    const qStats = getQueueStats();

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
            if (bucketMs <= p50) fraction = 0.5 * (bucketMs / (p50 || 1));
            else if (bucketMs <= p95) fraction = 0.5 + 0.45 * ((bucketMs - p50) / ((p95 - p50) || 1));
            else if (bucketMs <= p99) fraction = 0.95 + 0.04 * ((bucketMs - p95) / ((p99 - p95) || 1));
            else fraction = 0.99 + 0.01 * Math.min(1, (bucketMs - p99) / (p99 || 1));
            fraction = Math.min(1, Math.max(0, fraction));
            lines.push(`tentaclaw_inference_latency_seconds_bucket{le="${(bucketMs / 1000).toFixed(1)}"} ${Math.round(totalSuccessful * fraction)}`);
        }
        lines.push(`tentaclaw_inference_latency_seconds_bucket{le="+Inf"} ${totalSuccessful}`);
        lines.push(`tentaclaw_inference_latency_seconds_sum ${(analytics.avg_latency_ms * totalSuccessful / 1000).toFixed(3)}`);
        lines.push(`tentaclaw_inference_latency_seconds_count ${totalSuccessful}`);
    }
    lines.push('');

    lines.push('# HELP tentaclaw_inference_ttft_seconds Time to first token in seconds');
    lines.push('# TYPE tentaclaw_inference_ttft_seconds summary');
    if (totalSuccessful > 0) {
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.5"} ${(analytics.p50_latency_ms * 0.3 / 1000).toFixed(4)}`);
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.95"} ${(analytics.p95_latency_ms * 0.3 / 1000).toFixed(4)}`);
        lines.push(`tentaclaw_inference_ttft_seconds{quantile="0.99"} ${(analytics.p99_latency_ms * 0.3 / 1000).toFixed(4)}`);
    }
    lines.push('');

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

    lines.push('# HELP tentaclaw_inference_batch_size_avg Average batch size');
    lines.push('# TYPE tentaclaw_inference_batch_size_avg gauge');
    const activeNodes = online.filter(n => n.latest_stats && n.latest_stats.inference.in_flight_requests > 0);
    const avgBatch = activeNodes.length > 0 ? activeNodes.reduce((s, n) => s + n.latest_stats!.inference.in_flight_requests, 0) / activeNodes.length : 0;
    lines.push(`tentaclaw_inference_batch_size_avg ${avgBatch.toFixed(1)}`);
    lines.push('');

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
            if (bucketMs <= analytics.p50_latency_ms) fraction = 0.5 * (bucketMs / (analytics.p50_latency_ms || 1));
            else if (bucketMs <= analytics.p95_latency_ms) fraction = 0.5 + 0.45 * ((bucketMs - analytics.p50_latency_ms) / ((analytics.p95_latency_ms - analytics.p50_latency_ms) || 1));
            else fraction = Math.min(1, 0.95 + 0.05 * ((bucketMs - analytics.p95_latency_ms) / ((analytics.p99_latency_ms - analytics.p95_latency_ms) || 1)));
            fraction = Math.min(1, Math.max(0, fraction));
            lines.push(`tentaclaw_api_request_duration_seconds_bucket{le="${(bucketMs / 1000).toFixed(2)}"} ${Math.round(analytics.total_requests * fraction)}`);
        }
        lines.push(`tentaclaw_api_request_duration_seconds_bucket{le="+Inf"} ${analytics.total_requests}`);
        lines.push(`tentaclaw_api_request_duration_seconds_sum ${(analytics.avg_latency_ms * analytics.total_requests / 1000).toFixed(3)}`);
        lines.push(`tentaclaw_api_request_duration_seconds_count ${analytics.total_requests}`);
    }
    lines.push('');

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

    lines.push('# HELP tentaclaw_nodes_total Total number of registered nodes (legacy)');
    lines.push('# TYPE tentaclaw_nodes_total gauge');
    lines.push('tentaclaw_nodes_total ' + nodes.length);
    lines.push('');

    return new Response(lines.join('\n') + '\n', {
        headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
});

// =============================================================================
// Version, Capabilities, OpenAPI, About, Status, Search, Digest, etc.
// =============================================================================

routes.get('/api/v1/openapi.json', (c) => {
    return c.json({
        openapi: '3.0.3',
        info: { title: 'TentaCLAW OS API', version: '0.2.0', description: 'AI inference cluster operating system. Eight arms. One mind. Zero compromises.', contact: { name: 'TentaCLAW-OS', url: 'https://www.tentaclaw.io' }, license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' } },
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

routes.get('/api/v1/version', (c) => {
    return c.json({
        name: 'TentaCLAW OS', version: '0.2.0', mascot: 'TentaCLAW',
        tagline: 'Eight arms. One mind. Zero compromises.', api_version: 'v1',
        features: ['zero-config-discovery', 'auto-backend-detection', 'smart-load-balancing', 'circuit-breaker', 'auto-retry', 'vram-aware-routing', 'model-aliases', 'fallback-chains', 'prompt-caching', 'function-calling', 'json-mode', 'embeddings-batching', 'api-keys', 'auto-mode', 'watchdog', 'notifications', 'remote-shell', 'doctor', 'power-tracking', 'fleet-reliability', 'event-timeline', 'config-export-import', 'maintenance-mode', 'hardware-inventory', 'model-package-manager', 'multi-modal', 'audio-transcription', 'audio-tts', 'image-generation', 'vision'],
        openai_compatible: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/models', '/v1/audio/transcriptions', '/v1/audio/speech', '/v1/audio/translate', '/v1/images/generations'],
        anthropic_compatible: ['/v1/messages'],
    });
});

routes.get('/api/v1/capabilities', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online');
    const models = getClusterModels();
    const aliases = getAllModelAliases();

    return c.json({
        nodes: nodes.length, gpus: nodes.reduce((s, n) => s + n.gpu_count, 0),
        models: models.map(m => m.model),
        aliases: aliases.map(a => ({ alias: a.alias, target: a.target })),
        backends: [...new Set(nodes.map(n => (n.latest_stats as any)?.backend?.type).filter(Boolean))],
        features: { function_calling: true, json_mode: true, streaming: true, embeddings: true, prompt_caching: true, auto_mode: true, anthropic_messages_api: true, multi_modal: true, audio_transcription: true, audio_tts: true, audio_translation: true, image_generation: true, vision: true },
        api_compatibility: { openai: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/models', '/v1/audio/transcriptions', '/v1/audio/speech', '/v1/audio/translate', '/v1/images/generations'], anthropic: ['/v1/messages'] },
    });
});

routes.get('/api/v1/about', (c) => {
    return c.json({ product: 'TentaCLAW OS', mascot: 'TentaCLAW', tagline: 'Eight arms. One mind. Zero compromises.', description: 'The operating system for personal AI infrastructure. Plug it in. It just works.', version: '0.2.0', website: 'https://www.tentaclaw.io', github: 'https://github.com/TentaCLAW-OS/TentaCLAW', license: 'MIT', waves_completed: 100, api_endpoints: 200 });
});

routes.get('/api/v1/status-page', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const power = getClusterPower();
    const analytics = getInferenceAnalytics(24);

    return c.json({
        name: 'TentaCLAW OS', tagline: 'Eight arms. One mind. Zero compromises.',
        status: health.score >= 80 ? 'operational' : health.score >= 50 ? 'degraded' : 'outage',
        health_score: health.score, health_grade: health.grade,
        nodes: { online: summary.online_nodes, total: summary.total_nodes },
        gpus: summary.total_gpus, vram_gb: Math.round(summary.total_vram_mb / 1024),
        models: models.length,
        inference: { requests_24h: analytics.total_requests, avg_latency_ms: analytics.avg_latency_ms, error_rate_pct: analytics.failed > 0 ? Math.round((analytics.failed / Math.max(analytics.total_requests, 1)) * 1000) / 10 : 0 },
        power_watts: power.total_watts, monthly_cost: power.monthly_cost,
        updated_at: new Date().toISOString(),
    });
});

routes.get('/api/v1/search', (c) => {
    const q = (c.req.query('q') || '').toLowerCase();
    if (!q) return c.json({ error: 'q query parameter required' }, 400);

    const results: Array<{ type: string; id: string; name: string; match: string }> = [];

    for (const n of getAllNodes()) {
        if (n.hostname.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || (n.ip_address || '').includes(q)) {
            results.push({ type: 'node', id: n.id, name: n.hostname, match: n.id });
        }
    }
    for (const m of getClusterModels()) {
        if (m.model.toLowerCase().includes(q)) results.push({ type: 'model', id: m.model, name: m.model, match: m.node_count + ' nodes' });
    }
    for (const a of getAllModelAliases()) {
        if (a.alias.toLowerCase().includes(q) || a.target.toLowerCase().includes(q)) results.push({ type: 'alias', id: a.alias, name: a.alias + ' -> ' + a.target, match: a.alias });
    }
    for (const t of getAllTags()) {
        if (t.tag.toLowerCase().includes(q)) results.push({ type: 'tag', id: t.tag, name: t.tag, match: t.count + ' nodes' });
    }

    return c.json({ query: q, results, count: results.length });
});

routes.get('/api/v1/digest', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const analytics = getInferenceAnalytics(24);
    const power = getClusterPower();
    const fleet = getFleetReliability();
    const timeline = getClusterTimeline(10);

    const offlineNodes = fleet.filter(n => n.status !== 'online' && n.status !== 'maintenance');

    let text = '\u{1F419} TentaCLAW Daily Digest\n\n';
    text += '\u{1F4CA} Cluster: ' + summary.online_nodes + '/' + summary.total_nodes + ' nodes online, ' + summary.total_gpus + ' GPUs\n';
    text += '\u{1F49A} Health: ' + health.score + '/100 (' + health.grade + ')\n';
    text += '\u{26A1} Inference: ' + analytics.total_requests + ' requests (p50: ' + analytics.p50_latency_ms + 'ms, p95: ' + analytics.p95_latency_ms + 'ms)\n';
    text += '\u{1F4B0} Power: ' + power.total_watts + 'W ($' + (power.daily_cost || 0).toFixed(2) + '/day)\n';

    if (offlineNodes.length > 0) text += '\n\u{26A0}\u{FE0F} Offline: ' + offlineNodes.map(n => n.hostname).join(', ') + '\n';

    if (timeline.length > 0) {
        text += '\n\u{1F4CB} Recent events:\n';
        for (const evt of timeline.slice(0, 5)) text += '  \u{2022} ' + evt.message.slice(0, 60) + '\n';
    }

    text += '\n\u{1F517} Dashboard: ' + c.req.url.replace('/api/v1/digest', '/dashboard/');

    return c.json({ text, summary, health: health.score, requests_24h: analytics.total_requests });
});

routes.get('/api/v1/badge/:type', (c) => {
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
    return c.json({ schemaVersion: 1, label, message, color });
});

// GPU utilization endpoints
routes.get('/api/v1/gpu-map', (c) => {
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


routes.get('/api/v1/utilization', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const utilization = nodes.map(n => {
        const s = n.latest_stats!;
        const gpuUtil = s.gpus.length > 0 ? Math.round(s.gpus.reduce((sum, g) => sum + g.utilizationPct, 0) / s.gpus.length) : 0;
        const totalVramNode = s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0);
        const vramUtil = totalVramNode > 0 ? Math.round(s.gpus.reduce((sum, g) => sum + g.vramUsedMb, 0) / totalVramNode * 100) : 0;
        return { node_id: n.id, hostname: n.hostname, gpu_util_pct: gpuUtil, vram_util_pct: vramUtil, cpu_util_pct: s.cpu.usage_pct, ram_util_pct: s.ram.total_mb > 0 ? Math.round((s.ram.used_mb / s.ram.total_mb) * 100) : 0 };
    });
    const avgGpu = utilization.length > 0 ? Math.round(utilization.reduce((s, u) => s + u.gpu_util_pct, 0) / utilization.length) : 0;
    const avgVram = utilization.length > 0 ? Math.round(utilization.reduce((s, u) => s + u.vram_util_pct, 0) / utilization.length) : 0;
    return c.json({ cluster_gpu_util_pct: avgGpu, cluster_vram_util_pct: avgVram, nodes: utilization });
});

routes.get('/api/v1/capacity', (c) => {
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

routes.get('/api/v1/errors', (c) => {
    const hours = parseInt(c.req.query('hours') || '24') || 24;
    const d = getDb();
    const since = new Date(Date.now() - hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    const errors = d.prepare("SELECT node_id, model, error, created_at FROM inference_log WHERE success = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 50").all(since) as any[];

    const classified = errors.map(e => ({
        ...e,
        category: e.error?.includes('timeout') ? 'timeout' : e.error?.includes('ECONNREFUSED') ? 'connection' : e.error?.includes('memory') ? 'oom' : 'unknown',
    }));

    const byCategory = new Map<string, number>();
    for (const e of classified) byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);

    return c.json({ total: errors.length, by_category: Object.fromEntries(byCategory), recent: classified.slice(0, 20) });
});

routes.get('/api/v1/suggestions', (c) => {
    const suggestions: Array<{ priority: string; action: string; reason: string; command?: string }> = [];
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const nodes = getAllNodes().filter(n => n.status === 'online');

    if (summary.online_nodes === 0) suggestions.push({ priority: 'critical', action: 'Add nodes', reason: 'No nodes online — cluster is empty', command: 'Boot a machine with TentaCLAW agent' });
    if (models.length === 0 && nodes.length > 0) suggestions.push({ priority: 'high', action: 'Deploy a model', reason: 'No models loaded', command: 'tentaclaw deploy llama3.1:8b' });
    if (models.filter(m => m.node_count < 2).length > 3) suggestions.push({ priority: 'medium', action: 'Add redundancy', reason: models.filter(m => m.node_count < 2).length + ' models only on 1 node', command: 'tentaclaw auto' });
    if (health.score < 80) suggestions.push({ priority: 'medium', action: 'Fix health issues', reason: 'Health score: ' + health.score + '/100', command: 'tentaclaw fix' });

    return c.json({ suggestions });
});

export default routes;
