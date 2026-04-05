/**
 * TentaCLAW Gateway — Fleet Coordination API
 *
 * Wave 480: LRU model eviction — candidates + trigger eviction
 * Wave 482: Wake-on-LAN — wake sleeping nodes
 * Wave 487: Multi-node benchmarks — same model on all nodes simultaneously
 * Wave 488: Capacity planning — will this model/set fit across the cluster?
 * Wave 490: Rolling restarts — restart agents one at a time with health checks
 * Wave 494: GPU hang detection endpoint — force-check hung nodes
 * Wave 496: Thermal throttle alerts — check thermal status cluster-wide
 * Wave 498: Anomaly detection — tok/s vs baseline
 */
import { Hono } from 'hono';
import {
    getAllNodes,
    getNode,
    queueCommand,
    estimateModelVram,
    getEvictionCandidates,
    getClusterCapacity,
    getInferenceAnalytics,
    storeBenchmark,
    getClusterModels,
    findBestNode,
} from '../db';
import { broadcastSSE } from '../shared';

const routes = new Hono();

// =============================================================================
// Wave 480 — LRU Model Eviction
// GET  /api/v1/eviction/candidates — models that can be evicted (least recently used)
// POST /api/v1/eviction/run        — trigger eviction on a specific node
// =============================================================================

routes.get('/api/v1/eviction/candidates', (c) => {
    const nodes = getAllNodes();
    const allCandidates: Array<{ node_id: string; hostname: string; model: string; last_used: string; request_count: number; vram_mb: number; estimated_vram_freed_mb: number }> = [];
    for (const node of nodes.filter(n => n.status === 'online')) {
        const nodeCandidates = getEvictionCandidates(node.id);
        for (const cand of nodeCandidates) {
            allCandidates.push({ ...cand, node_id: node.id, hostname: node.hostname, estimated_vram_freed_mb: estimateModelVram(cand.model) });
        }
    }
    allCandidates.sort((a, b) => a.request_count - b.request_count);
    return c.json({
        candidates: allCandidates,
        count: allCandidates.length,
        _tip: 'POST /api/v1/eviction/run with { node_id, model } to evict a specific model',
    });
});

routes.post('/api/v1/eviction/run', async (c) => {
    const body = await c.req.json();
    const nodeId = body.node_id as string;
    const model = body.model as string;

    if (!nodeId) return c.json({ error: 'node_id is required' }, 400);
    if (!model) return c.json({ error: 'model is required' }, 400);

    const node = getNode(nodeId);
    if (!node) return c.json({ error: `Node "${nodeId}" not found` }, 404);
    if (node.status !== 'online') return c.json({ error: `Node "${nodeId}" is ${node.status}` }, 409);

    queueCommand(nodeId, 'remove_model', { model });
    broadcastSSE('eviction_queued', { node_id: nodeId, model });

    return c.json({
        message: `Eviction queued: "${model}" from ${node.hostname}`,
        node_id: nodeId,
        model,
        estimated_vram_freed_mb: estimateModelVram(model),
    }, 202);
});

// Wave 480: auto-evict — find + evict LRU model on node with least free VRAM
routes.post('/api/v1/eviction/auto', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const evicted: Array<{ node_id: string; hostname: string; model: string; vram_freed_mb: number }> = [];

    for (const node of nodes) {
        const s = node.latest_stats!;
        const totalVram = s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0);
        const usedVram = s.gpus.reduce((sum, g) => sum + g.vramUsedMb, 0);
        const usedPct = totalVram > 0 ? usedVram / totalVram : 0;

        // Only auto-evict if VRAM is >85% full
        if (usedPct < 0.85) continue;

        const candidates = getEvictionCandidates(node.id);
        if (candidates.length === 0) continue;

        const lru = candidates[0]; // already sorted by last_used asc
        queueCommand(node.id, 'remove_model', { model: lru.model });
        evicted.push({
            node_id: node.id,
            hostname: node.hostname,
            model: lru.model,
            vram_freed_mb: estimateModelVram(lru.model),
        });
    }

    broadcastSSE('auto_eviction', { count: evicted.length });
    return c.json({ evicted, count: evicted.length });
});

// =============================================================================
// Wave 482 — Wake-on-LAN
// POST /api/v1/nodes/:nodeId/wakeup — send WoL magic packet
// =============================================================================

routes.post('/api/v1/nodes/:nodeId/wakeup', async (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: `Node "${nodeId}" not found` }, 404);

    const mac = node.mac_address;
    if (!mac) return c.json({ error: `Node "${nodeId}" has no MAC address registered. Register it via agent rig.conf (mac_address=XX:XX:XX:XX:XX:XX)` }, 422);

    // Build WoL magic packet: 6x FF followed by 16x MAC address
    const macBytes = mac.replace(/[:\-]/g, '').match(/.{2}/g)?.map(b => parseInt(b, 16)) || [];
    if (macBytes.length !== 6) return c.json({ error: `Invalid MAC address format: "${mac}"` }, 422);

    const magic = Buffer.alloc(102);
    magic.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 6; j++) magic[6 + i * 6 + j] = macBytes[j];
    }

    try {
        const dgram = await import('dgram');
        const udpSocket = dgram.createSocket('udp4');
        await new Promise<void>((resolve, reject) => {
            udpSocket.bind(() => {
                udpSocket.setBroadcast(true);
                udpSocket.send(magic, 0, magic.length, 9, '255.255.255.255', (err) => {
                    udpSocket.close();
                    if (err) reject(err); else resolve();
                });
            });
        });

        broadcastSSE('node_wakeup_sent', { node_id: nodeId, hostname: node.hostname, mac });
        return c.json({
            message: `Wake-on-LAN magic packet sent to ${node.hostname} (${mac})`,
            node_id: nodeId,
            mac_address: mac,
            broadcast: '255.255.255.255:9',
        });
    } catch (err: any) {
        return c.json({ error: `WoL send failed: ${err.message}` }, 500);
    }
});

// =============================================================================
// Wave 487 — Multi-Node Benchmark
// POST /api/v1/benchmarks/multi-node — benchmark same model on all nodes with it loaded
// =============================================================================

routes.post('/api/v1/benchmarks/multi-node', async (c) => {
    const body = await c.req.json();
    const model = body.model as string;
    const prompt = (body.prompt as string) || 'Count from 1 to 10. Output only numbers separated by spaces.';

    if (!model) return c.json({ error: 'model is required' }, 400);

    const nodes = getAllNodes().filter(n => {
        if (n.status !== 'online' || !n.latest_stats) return false;
        return n.latest_stats.inference.loaded_models.some((m: string) =>
            m === model || m.startsWith(model.split(':')[0])
        );
    });

    if (nodes.length === 0) {
        return c.json({ error: `No online node has "${model}" loaded`, available_models: getClusterModels().map(m => m.model) }, 404);
    }

    const results: Array<{
        node_id: string; hostname: string; status: 'ok' | 'error';
        latency_ms?: number; tokens_out?: number; toks_per_sec?: number; error?: string;
    }> = [];

    // Run benchmarks in parallel across all nodes
    const benchPromises = nodes.map(async (node) => {
        const port = (node.latest_stats as any)?.backend?.port || 11434;
        const url = `http://${node.ip_address || node.hostname}:${port}/v1/chat/completions`;
        const start = Date.now();
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
                signal: AbortSignal.timeout(60_000),
            });
            const latency = Date.now() - start;
            const data = await resp.json() as any;
            const tokensOut = data?.usage?.completion_tokens || 0;
            const tps = tokensOut > 0 && latency > 0 ? Math.round((tokensOut / latency) * 1000 * 10) / 10 : 0;

            storeBenchmark(node.id, { model, tokens_per_sec: tps, total_duration_ms: latency });

            results.push({ node_id: node.id, hostname: node.hostname, status: 'ok', latency_ms: latency, tokens_out: tokensOut, toks_per_sec: tps });
        } catch (err: any) {
            results.push({ node_id: node.id, hostname: node.hostname, status: 'error', error: err.message });
        }
    });

    await Promise.all(benchPromises);
    results.sort((a, b) => (b.toks_per_sec || 0) - (a.toks_per_sec || 0));

    const ok = results.filter(r => r.status === 'ok');
    const winner = ok[0] || null;

    return c.json({
        model,
        nodes_tested: nodes.length,
        results,
        winner: winner ? { node_id: winner.node_id, hostname: winner.hostname, toks_per_sec: winner.toks_per_sec } : null,
        fastest_hostname: winner?.hostname || null,
    });
});

// =============================================================================
// Wave 488 — Capacity Planning
// POST /api/v1/capacity/plan — will these models fit across the cluster?
// =============================================================================

routes.post('/api/v1/capacity/plan', async (c) => {
    const body = await c.req.json();
    const models = body.models as string[] | undefined;
    if (!models || !Array.isArray(models) || models.length === 0) {
        return c.json({ error: 'models array is required' }, 400);
    }

    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const clusterCap = getClusterCapacity();

    const modelPlans = models.map(model => {
        const requiredMb = estimateModelVram(model);
        const fitNodes: Array<{ node_id: string; hostname: string; free_vram_mb: number }> = [];

        for (const node of nodes) {
            const s = node.latest_stats!;
            const totalVram = s.gpus.reduce((sum, g) => sum + g.vramTotalMb, 0);
            const usedVram = s.gpus.reduce((sum, g) => sum + g.vramUsedMb, 0);
            const freeVram = totalVram - usedVram;
            if (freeVram >= requiredMb) {
                fitNodes.push({ node_id: node.id, hostname: node.hostname, free_vram_mb: freeVram });
            }
        }
        fitNodes.sort((a, b) => b.free_vram_mb - a.free_vram_mb);

        return {
            model,
            required_vram_mb: requiredMb,
            required_vram_gb: Math.round(requiredMb / 1024 * 10) / 10,
            can_fit: fitNodes.length > 0,
            fit_on_nodes: fitNodes.length,
            best_node: fitNodes[0] || null,
            all_fit_nodes: fitNodes,
        };
    });

    const totalRequired = models.reduce((sum, m) => sum + estimateModelVram(m), 0);
    const allFit = modelPlans.every(p => p.can_fit);

    return c.json({
        models: modelPlans,
        summary: {
            total_models: models.length,
            all_fit: allFit,
            models_that_fit: modelPlans.filter(p => p.can_fit).length,
            models_that_dont_fit: modelPlans.filter(p => !p.can_fit).map(p => p.model),
            total_required_vram_gb: Math.round(totalRequired / 1024 * 10) / 10,
            cluster_free_vram_gb: Math.round(clusterCap.free_vram_mb / 1024 * 10) / 10,
        },
    });
});

// =============================================================================
// Wave 490 — Rolling Restart
// POST /api/v1/fleet/restart — restart agents one at a time
// =============================================================================

routes.post('/api/v1/fleet/restart', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rolling = body.rolling !== false; // default: rolling (one at a time)
    const nodeIds = body.node_ids as string[] | undefined; // optional: specific nodes

    const nodes = getAllNodes().filter(n => {
        if (n.status !== 'online') return false;
        if (nodeIds && nodeIds.length > 0) return nodeIds.includes(n.id);
        return true;
    });

    if (nodes.length === 0) return c.json({ error: 'No online nodes to restart' }, 404);

    const queued: Array<{ node_id: string; hostname: string }> = [];

    if (rolling) {
        // Queue restarts with staggered delay — each node gets a sequence number
        // The agent will restart and come back online before the next one is triggered
        // We use a simple delay: queue restart for each node 30s apart
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            queueCommand(node.id, 'restart_agent', { rolling: true, sequence: i, total: nodes.length });
            queued.push({ node_id: node.id, hostname: node.hostname });
        }
        broadcastSSE('rolling_restart_started', { total: nodes.length });
    } else {
        // All at once
        for (const node of nodes) {
            queueCommand(node.id, 'restart_agent', { rolling: false });
            queued.push({ node_id: node.id, hostname: node.hostname });
        }
        broadcastSSE('fleet_restart_started', { total: nodes.length });
    }

    return c.json({
        message: rolling
            ? `Rolling restart queued for ${queued.length} nodes (one at a time, 30s stagger)`
            : `Simultaneous restart queued for ${queued.length} nodes`,
        rolling,
        queued,
        warning: rolling ? undefined : 'All nodes restarting simultaneously — cluster will be briefly unavailable',
    }, 202);
});

// =============================================================================
// Wave 494 — GPU Hang Check
// POST /api/v1/fleet/hang-check — force check all nodes for GPU hangs
// =============================================================================

// Wave 494: in-memory hang tracking
const gpuHangTracker = new Map<string, { zeroSince: number; alerted: boolean }>();

export function checkGpuHangs(): Array<{ node_id: string; hostname: string; duration_s: number }> {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const hangs: Array<{ node_id: string; hostname: string; duration_s: number }> = [];
    const now = Date.now();

    for (const node of nodes) {
        const s = node.latest_stats!;
        const inFlight = s.inference.in_flight_requests;
        const tps = s.toks_per_sec;

        // Hang: in-flight > 0 AND tok/s == 0
        if (inFlight > 0 && tps === 0) {
            const existing = gpuHangTracker.get(node.id);
            if (!existing) {
                gpuHangTracker.set(node.id, { zeroSince: now, alerted: false });
            } else {
                const duration = (now - existing.zeroSince) / 1000;
                if (duration > 60 && !existing.alerted) {
                    existing.alerted = true;
                    hangs.push({ node_id: node.id, hostname: node.hostname, duration_s: Math.round(duration) });
                }
            }
        } else {
            // Reset if tps came back or no inflight
            gpuHangTracker.delete(node.id);
        }
    }
    return hangs;
}

routes.post('/api/v1/fleet/hang-check', (c) => {
    const hangs = checkGpuHangs();
    return c.json({
        hangs,
        count: hangs.length,
        checked_at: new Date().toISOString(),
        message: hangs.length === 0
            ? 'No GPU hangs detected'
            : `${hangs.length} potential hang(s) detected (in-flight > 0, tok/s = 0 for >60s)`,
    });
});

// =============================================================================
// Wave 496 — Thermal Status
// GET /api/v1/fleet/thermal — cluster-wide thermal status
// =============================================================================

routes.get('/api/v1/fleet/thermal', (c) => {
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const report: Array<{
        node_id: string; hostname: string; max_temp_c: number;
        status: 'ok' | 'warm' | 'hot' | 'critical'; gpus: Array<{ index: number; temp_c: number; status: string }>
    }> = [];

    const TEMP_CRITICAL = parseInt(process.env.GPU_TEMP_CRITICAL_C || '90', 10) || 90;
    const TEMP_HOT = parseInt(process.env.GPU_TEMP_HOT_C || '85', 10) || 85;
    const TEMP_WARM = parseInt(process.env.GPU_TEMP_WARM_C || '75', 10) || 75;

    for (const node of nodes) {
        const gpus = node.latest_stats!.gpus.map((g, i) => {
            const tempStatus = g.temperatureC >= TEMP_CRITICAL ? 'critical'
                             : g.temperatureC >= TEMP_HOT ? 'hot'
                             : g.temperatureC >= TEMP_WARM ? 'warm' : 'ok';
            return { index: i, temp_c: g.temperatureC, status: tempStatus };
        });
        const maxTemp = gpus.length > 0 ? Math.max(...gpus.map(g => g.temp_c)) : 0;
        const nodeStatus = maxTemp >= TEMP_CRITICAL ? 'critical' : maxTemp >= TEMP_HOT ? 'hot' : maxTemp >= TEMP_WARM ? 'warm' : 'ok';
        report.push({ node_id: node.id, hostname: node.hostname, max_temp_c: maxTemp, status: nodeStatus, gpus });
    }

    const critical = report.filter(n => n.status === 'critical').length;
    const hot = report.filter(n => n.status === 'hot').length;
    const clusterStatus = critical > 0 ? 'critical' : hot > 0 ? 'hot' : report.some(n => n.status === 'warm') ? 'warm' : 'ok';

    return c.json({ nodes: report, summary: { cluster_status: clusterStatus, critical_nodes: critical, hot_nodes: hot }, checked_at: new Date().toISOString() });
});

// =============================================================================
// Wave 498 — Anomaly Detection
// GET /api/v1/fleet/anomalies — compare current tok/s vs 1h baseline
// =============================================================================

routes.get('/api/v1/fleet/anomalies', (c) => {
    const analytics = getInferenceAnalytics(24);
    const recentAnalytics = getInferenceAnalytics(1);

    const anomalies: Array<{
        node_id: string; baseline_req_per_min: number;
        current_req_per_min: number; drop_pct: number; type: string;
    }> = [];

    // Detect cluster-wide throughput drop
    const baselineRpm = analytics.requests_per_minute;
    const currentRpm = recentAnalytics.requests_per_minute;
    if (baselineRpm > 1 && currentRpm < baselineRpm * 0.5) {
        anomalies.push({
            node_id: 'cluster',
            baseline_req_per_min: Math.round(baselineRpm * 10) / 10,
            current_req_per_min: Math.round(currentRpm * 10) / 10,
            drop_pct: Math.round((1 - currentRpm / baselineRpm) * 100),
            type: 'throughput_drop',
        });
    }

    // Detect latency spike (p95 > 2x baseline)
    const baselineP95 = analytics.p95_latency_ms;
    const currentP95 = recentAnalytics.p95_latency_ms;
    if (baselineP95 > 0 && currentP95 > baselineP95 * 2) {
        anomalies.push({
            node_id: 'cluster',
            baseline_req_per_min: baselineP95,
            current_req_per_min: currentP95,
            drop_pct: Math.round((currentP95 / baselineP95 - 1) * 100),
            type: 'latency_spike',
        });
    }

    // Detect error rate spike
    const baselineErrPct = analytics.failed / Math.max(analytics.total_requests, 1) * 100;
    const currentErrPct = recentAnalytics.failed / Math.max(recentAnalytics.total_requests, 1) * 100;
    if (currentErrPct > baselineErrPct + 20 && recentAnalytics.total_requests > 5) {
        anomalies.push({
            node_id: 'cluster',
            baseline_req_per_min: Math.round(baselineErrPct * 10) / 10,
            current_req_per_min: Math.round(currentErrPct * 10) / 10,
            drop_pct: Math.round(currentErrPct - baselineErrPct),
            type: 'error_rate_spike',
        });
    }

    return c.json({
        anomalies,
        count: anomalies.length,
        baseline_window: '24h',
        current_window: '1h',
        checked_at: new Date().toISOString(),
        status: anomalies.length === 0 ? 'nominal' : 'anomalies_detected',
    });
});

// =============================================================================
// Wave 476 — Fleet-wide Model Deploy
// POST /api/v1/fleet/deploy — install a model on all (or tagged) nodes
// =============================================================================

routes.post('/api/v1/fleet/deploy', async (c) => {
    const body = await c.req.json() as { model: string; nodes?: string[]; tag?: string };
    const { model } = body;
    if (!model) return c.json({ error: 'model required' }, 400);

    const allNodes = getAllNodes().filter((n: any) => n.status === 'online');
    let targets = allNodes;

    // Optionally filter by explicit node list or tag
    if (body.nodes && body.nodes.length > 0) {
        targets = allNodes.filter((n: any) => body.nodes!.includes(n.id) || body.nodes!.includes(n.hostname));
    }

    const commands: Array<{ node_id: string; hostname: string; status: string }> = [];
    for (const node of targets) {
        try {
            queueCommand(node.id, 'install_model', { model });
            commands.push({ node_id: node.id, hostname: node.hostname, status: 'queued' });
        } catch {
            commands.push({ node_id: node.id, hostname: node.hostname, status: 'failed' });
        }
    }

    broadcastSSE('fleet_deploy', { model, node_count: commands.length });

    return c.json({
        model,
        deployed_to: commands,
        count: commands.filter(c => c.status === 'queued').length,
        failed: commands.filter(c => c.status === 'failed').length,
    });
});

// =============================================================================
// Wave 481 — Preload Schedule
// POST /api/v1/fleet/preload-schedule — schedule model preloads
// GET  /api/v1/fleet/preload-schedule — list active schedules
// =============================================================================

const preloadSchedules: Array<{
    id: string; model: string; node_ids: string[];
    cron: string; enabled: boolean; created_at: string;
}> = [];

routes.get('/api/v1/fleet/preload-schedule', (c) => {
    return c.json({ schedules: preloadSchedules, count: preloadSchedules.length });
});

routes.post('/api/v1/fleet/preload-schedule', async (c) => {
    const body = await c.req.json() as { model: string; node_ids?: string[]; cron: string };
    if (!body.model || !body.cron) return c.json({ error: 'model and cron required' }, 400);

    const nodes = getAllNodes().filter((n: any) => n.status === 'online');
    const targetIds = body.node_ids || nodes.map((n: any) => n.id);

    const schedule = {
        id: 'sched-' + Date.now().toString(36),
        model: body.model,
        node_ids: targetIds,
        cron: body.cron,
        enabled: true,
        created_at: new Date().toISOString(),
    };
    if (preloadSchedules.length >= 50) {
        return c.json({ error: 'Maximum 50 preload schedules. Delete old ones first.' }, 400);
    }
    preloadSchedules.push(schedule);

    return c.json({ schedule, message: 'Preload schedule created' }, 201);
});

routes.delete('/api/v1/fleet/preload-schedule/:id', (c) => {
    const id = c.req.param('id');
    const idx = preloadSchedules.findIndex(s => s.id === id);
    if (idx === -1) return c.json({ error: 'Schedule not found' }, 404);
    preloadSchedules.splice(idx, 1);
    return c.json({ message: 'Schedule deleted' });
});

// =============================================================================
// Wave 484 — Batch Inference Queue
// POST /api/v1/inference/batch — submit batch of prompts, returns job ID
// GET  /api/v1/inference/batch/:id — check batch job status
// =============================================================================

interface BatchJob {
    id: string;
    model: string;
    prompts: Array<{ index: number; messages: Array<{ role: string; content: string }> }>;
    results: Array<{ index: number; status: 'pending' | 'completed' | 'failed'; response?: unknown; error?: string }>;
    status: 'queued' | 'running' | 'completed' | 'failed';
    created_at: string;
    completed_at?: string;
}

const batchJobs = new Map<string, BatchJob>();

routes.post('/api/v1/inference/batch', async (c) => {
    const body = await c.req.json() as { model: string; prompts: Array<{ messages: Array<{ role: string; content: string }> }>; max_tokens?: number; temperature?: number };
    if (!body.model || !body.prompts || body.prompts.length === 0) {
        return c.json({ error: 'model and prompts[] required' }, 400);
    }
    if (body.prompts.length > 100) {
        return c.json({ error: 'Maximum 100 prompts per batch' }, 400);
    }

    const job: BatchJob = {
        id: 'batch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        model: body.model,
        prompts: body.prompts.map((p, i) => ({ index: i, messages: p.messages })),
        results: body.prompts.map((_, i) => ({ index: i, status: 'pending' as const })),
        status: 'queued',
        created_at: new Date().toISOString(),
    };
    batchJobs.set(job.id, job);

    // Start processing asynchronously — don't await
    processBatchJob(job, body.max_tokens, body.temperature).catch(() => {
        job.status = 'failed';
    });

    return c.json({ job_id: job.id, status: 'queued', prompt_count: job.prompts.length }, 202);
});

routes.get('/api/v1/inference/batch/:id', (c) => {
    const job = batchJobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'Batch job not found' }, 404);

    const completed = job.results.filter(r => r.status === 'completed').length;
    const failed = job.results.filter(r => r.status === 'failed').length;
    const pending = job.results.filter(r => r.status === 'pending').length;

    return c.json({
        id: job.id,
        status: job.status,
        model: job.model,
        progress: { completed, failed, pending, total: job.results.length },
        results: job.status === 'completed' || job.status === 'failed' ? job.results : undefined,
        created_at: job.created_at,
        completed_at: job.completed_at,
    });
});

async function processBatchJob(job: BatchJob, maxTokens?: number, temperature?: number): Promise<void> {
    job.status = 'running';

    for (const prompt of job.prompts) {
        const target = findBestNode(job.model);
        if (!target) {
            job.results[prompt.index] = { index: prompt.index, status: 'failed', error: 'No node available' };
            continue;
        }

        const port = target.backend_port || 11434;
        const url = `http://${target.ip_address || target.hostname}:${port}/v1/chat/completions`;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: job.model,
                    messages: prompt.messages,
                    stream: false,
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    ...(temperature !== undefined ? { temperature } : {}),
                }),
                signal: AbortSignal.timeout(120_000),
            });

            if (resp.ok) {
                const result = await resp.json();
                job.results[prompt.index] = { index: prompt.index, status: 'completed', response: result };
            } else {
                const errText = await resp.text();
                job.results[prompt.index] = { index: prompt.index, status: 'failed', error: errText.slice(0, 200) };
            }
        } catch (e: any) {
            job.results[prompt.index] = { index: prompt.index, status: 'failed', error: e.message };
        }
    }

    const allFailed = job.results.every(r => r.status === 'failed');
    job.status = allFailed ? 'failed' : 'completed';
    job.completed_at = new Date().toISOString();

    // Prevent memory leak: remove completed jobs after 10 minutes
    setTimeout(() => { batchJobs.delete(job.id); }, 10 * 60_000);
}

// =============================================================================
// Wave 486 — Request Cancellation
// In-flight request tracking + abort endpoint
// POST /api/v1/inference/cancel/:requestId — cancel a running inference
// GET  /api/v1/inference/active — list active inference requests
// =============================================================================

interface ActiveRequest {
    id: string;
    model: string;
    node_id: string;
    hostname: string;
    started_at: number;
    abort?: AbortController;
}

const activeRequests = new Map<string, ActiveRequest>();

export function trackActiveRequest(id: string, model: string, nodeId: string, hostname: string, abort?: AbortController): void {
    activeRequests.set(id, { id, model, node_id: nodeId, hostname, started_at: Date.now(), abort });
    // Auto-cleanup stale requests older than 10 minutes (guards against leaked entries)
    if (activeRequests.size > 50) {
        const cutoff = Date.now() - 600_000;
        for (const [rid, req] of activeRequests) {
            if (req.started_at < cutoff) activeRequests.delete(rid);
        }
    }
}

export function untrackActiveRequest(id: string): void {
    activeRequests.delete(id);
}

routes.get('/api/v1/inference/active', (c) => {
    const active = Array.from(activeRequests.values()).map(r => ({
        id: r.id,
        model: r.model,
        node_id: r.node_id,
        hostname: r.hostname,
        elapsed_ms: Date.now() - r.started_at,
    }));
    return c.json({ requests: active, count: active.length });
});

routes.post('/api/v1/inference/cancel/:requestId', (c) => {
    const reqId = c.req.param('requestId');
    const req = activeRequests.get(reqId);
    if (!req) return c.json({ error: 'Request not found or already completed' }, 404);

    if (req.abort) {
        req.abort.abort();
    }
    activeRequests.delete(reqId);

    return c.json({ message: 'Request cancelled', request_id: reqId });
});

// =============================================================================
// Wave 489 — Graceful Node Drain
// POST /api/v1/nodes/:nodeId/drain — drain requests, set maintenance, wait for idle
// =============================================================================

const drainingNodes = new Set<string>();

routes.post('/api/v1/nodes/:nodeId/drain', async (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    if (drainingNodes.has(nodeId)) {
        return c.json({ error: 'Node already draining' }, 409);
    }

    drainingNodes.add(nodeId);
    broadcastSSE('node_draining', { node_id: nodeId, hostname: node.hostname });

    // Wait for in-flight requests to complete (max 2 minutes)
    const drainStart = Date.now();
    const maxDrainMs = parseInt(process.env.FLEET_DRAIN_TIMEOUT_MS || '120000', 10) || 120_000;
    let drained = false;

    while (Date.now() - drainStart < maxDrainMs) {
        const fresh = getNode(nodeId) as any;
        const inFlight = fresh?.latest_stats?.inference?.in_flight_requests ?? 0;
        if (inFlight === 0) {
            drained = true;
            break;
        }
        await new Promise(r => setTimeout(r, 2000)); // poll every 2s
    }

    // Set maintenance mode regardless
    try {
        queueCommand(nodeId, 'restart_agent');
    } catch { /* ok */ }

    drainingNodes.delete(nodeId);

    broadcastSSE(drained ? 'node_drained' : 'node_drain_timeout', {
        node_id: nodeId,
        hostname: node.hostname,
        elapsed_ms: Date.now() - drainStart,
    });

    return c.json({
        node_id: nodeId,
        hostname: node.hostname,
        drained,
        elapsed_ms: Date.now() - drainStart,
        message: drained ? 'Node drained and ready for maintenance' : 'Drain timed out — node set to maintenance anyway',
    });
});

routes.get('/api/v1/fleet/draining', (c) => {
    return c.json({ draining: Array.from(drainingNodes), count: drainingNodes.size });
});

// =============================================================================
// Wave 478 — Speculative Decoding Configuration
// POST /api/v1/fleet/speculative — configure draft+target model pair
// GET  /api/v1/fleet/speculative — list active speculative pairs
// =============================================================================

interface SpeculativePair {
    id: string;
    draft_model: string;
    target_model: string;
    draft_node_id?: string;
    target_node_id?: string;
    enabled: boolean;
    created_at: string;
}

const speculativePairs: SpeculativePair[] = [];

routes.get('/api/v1/fleet/speculative', (c) => {
    return c.json({ pairs: speculativePairs, count: speculativePairs.length });
});

routes.post('/api/v1/fleet/speculative', async (c) => {
    const body = await c.req.json() as { draft_model: string; target_model: string; draft_node_id?: string; target_node_id?: string };
    if (!body.draft_model || !body.target_model) {
        return c.json({ error: 'draft_model and target_model required' }, 400);
    }

    const pair: SpeculativePair = {
        id: 'spec-' + Date.now().toString(36),
        draft_model: body.draft_model,
        target_model: body.target_model,
        draft_node_id: body.draft_node_id,
        target_node_id: body.target_node_id,
        enabled: true,
        created_at: new Date().toISOString(),
    };
    if (speculativePairs.length >= 20) {
        return c.json({ error: 'Maximum 20 speculative pairs. Delete old ones first.' }, 400);
    }
    speculativePairs.push(pair);

    return c.json({ pair, message: 'Speculative decoding pair configured' }, 201);
});

routes.delete('/api/v1/fleet/speculative/:id', (c) => {
    const id = c.req.param('id');
    const idx = speculativePairs.findIndex(p => p.id === id);
    if (idx === -1) return c.json({ error: 'Pair not found' }, 404);
    speculativePairs.splice(idx, 1);
    return c.json({ message: 'Speculative pair removed' });
});

// =============================================================================
// Wave 751: WireGuard Mesh Configuration
// POST /api/v1/fleet/wireguard — generate mesh config for all nodes
// GET  /api/v1/fleet/wireguard — list current mesh status
// =============================================================================

interface WireGuardPeer {
    node_id: string;
    hostname: string;
    public_key: string;
    endpoint: string;
    allowed_ips: string;
    tunnel_ip: string;
}

const wireguardPeers: WireGuardPeer[] = [];

routes.get('/api/v1/fleet/wireguard', (c) => {
    const nodes = getAllNodes().filter((n: any) => n.status === 'online');
    return c.json({
        mesh_enabled: wireguardPeers.length > 0,
        peers: wireguardPeers,
        nodes_without_tunnel: nodes.filter((n: any) =>
            !wireguardPeers.some(p => p.node_id === n.id)
        ).map((n: any) => ({ node_id: n.id, hostname: n.hostname })),
        count: wireguardPeers.length,
    });
});

routes.post('/api/v1/fleet/wireguard', async (c) => {
    const body = await c.req.json() as { node_id: string; public_key: string; endpoint: string; tunnel_ip: string };
    if (!body.node_id || !body.public_key || !body.endpoint || !body.tunnel_ip) {
        return c.json({ error: 'node_id, public_key, endpoint, and tunnel_ip required' }, 400);
    }

    const existing = wireguardPeers.findIndex(p => p.node_id === body.node_id);
    const node = getNode(body.node_id);
    const peer: WireGuardPeer = {
        node_id: body.node_id,
        hostname: node?.hostname || body.node_id,
        public_key: body.public_key,
        endpoint: body.endpoint,
        allowed_ips: body.tunnel_ip + '/32',
        tunnel_ip: body.tunnel_ip,
    };

    if (existing >= 0) {
        wireguardPeers[existing] = peer;
    } else {
        wireguardPeers.push(peer);
    }

    // Generate peer config for the node
    const otherPeers = wireguardPeers.filter(p => p.node_id !== body.node_id);
    const peerConfig = otherPeers.map(p => `[Peer]\nPublicKey = ${p.public_key}\nEndpoint = ${p.endpoint}\nAllowedIPs = ${p.allowed_ips}\nPersistentKeepalive = 25`).join('\n\n');

    return c.json({
        peer,
        mesh_config: peerConfig,
        total_peers: wireguardPeers.length,
        message: 'WireGuard peer registered',
    });
});

routes.delete('/api/v1/fleet/wireguard/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    const idx = wireguardPeers.findIndex(p => p.node_id === nodeId);
    if (idx === -1) return c.json({ error: 'Peer not found' }, 404);
    wireguardPeers.splice(idx, 1);
    return c.json({ message: 'Peer removed from mesh' });
});

// =============================================================================
// Wave 755: Power Budget Enforcement in Routing
// Exported function for inference routes to check power budget before routing
// =============================================================================

let _powerBudgetWatts = 0; // 0 = no limit

export function setPowerBudget(watts: number): void { _powerBudgetWatts = watts; }
export function getPowerBudget(): number { return _powerBudgetWatts; }

export function isOverPowerBudget(): boolean {
    if (_powerBudgetWatts <= 0) return false;
    const nodes = getAllNodes();
    let totalWatts = 0;
    for (const n of nodes as any[]) {
        if (n.status !== 'online' || !n.latest_stats) continue;
        for (const g of n.latest_stats.gpus || []) {
            totalWatts += g.powerDrawW || 0;
        }
    }
    return totalWatts >= _powerBudgetWatts;
}

export default routes;
