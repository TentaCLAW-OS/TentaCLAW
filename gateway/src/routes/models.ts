/**
 * Model management routes — cluster models, model distribution, smart deploy,
 * per-node model operations, aliases, model search, etc.
 */
import { Hono } from 'hono';
import {
    getDb,
    getNode,
    getAllNodes,
    getClusterModels,
    getClusterSummary,
    queueCommand,
    estimateModelVram,
    checkModelFits,
    findBestNodeForModel,
    getModelDistribution,
    getRequestStats,
    setModelAlias,
    getAllModelAliases,
    deleteModelAlias,
    ensureDefaultAliases,
    getInferenceAnalytics,
} from '../db';
import { broadcastSSE } from '../shared';

const routes = new Hono();

// Cluster model listing (TentaCLAW format)
routes.get('/api/v1/models', (c) => {
    const models = getClusterModels();
    return c.json({ models });
});

// Per-node models
routes.get('/api/v1/nodes/:nodeId/models', (c) => {
    const nodeId = c.req.param('nodeId');
    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const models = node.latest_stats?.inference.loaded_models || [];
    return c.json({ node_id: nodeId, models });
});

routes.post('/api/v1/nodes/:nodeId/models/pull', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();
    if (!body.model) return c.json({ error: 'Missing required field: model' }, 400);

    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const command = queueCommand(nodeId, 'install_model', { model: body.model });
    console.log('[tentaclaw] Model pull queued: ' + body.model + ' → ' + nodeId);
    return c.json({ status: 'queued', command });
});

routes.delete('/api/v1/nodes/:nodeId/models/:model', (c) => {
    const nodeId = c.req.param('nodeId');
    const model = c.req.param('model');

    const node = getNode(nodeId);
    if (!node) return c.json({ error: 'Node not found' }, 404);

    const command = queueCommand(nodeId, 'remove_model', { model });
    console.log('[tentaclaw] Model removal queued: ' + model + ' → ' + nodeId);
    return c.json({ status: 'queued', command });
});

// Cluster-wide deploy
routes.post('/api/v1/deploy', async (c) => {
    const body = await c.req.json();
    if (!body.model) return c.json({ error: 'Missing required field: model' }, 400);

    const allNodes = getAllNodes();
    let targets = allNodes.filter(n => n.status === 'online');

    if (body.farm_hash) {
        targets = targets.filter(n => n.farm_hash === body.farm_hash);
    }
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

// Model distribution
routes.get('/api/v1/models/distribution', (c) => {
    return c.json(getModelDistribution());
});

routes.get('/api/v1/models/check-fit', (c) => {
    const model = c.req.query('model');
    const nodeId = c.req.query('node');
    if (!model) return c.json({ error: 'model query param required' }, 400);

    if (nodeId) {
        return c.json(checkModelFits(model, nodeId));
    }

    const best = findBestNodeForModel(model);
    return c.json({
        model,
        estimated_vram_mb: estimateModelVram(model),
        best_node: best,
        fits_anywhere: best !== null,
    });
});

routes.post('/api/v1/models/smart-deploy', async (c) => {
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

// Inference stats
routes.get('/api/v1/inference/stats', (c) => {
    return c.json(getRequestStats());
});

routes.get('/api/v1/inference/analytics', (c) => {
    const hours = parseInt(c.req.query('hours') || '24') || 24;
    return c.json(getInferenceAnalytics(hours));
});

routes.get('/api/v1/inference/backends', (c) => {
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

// Model aliases
routes.get('/api/v1/aliases', (c) => {
    ensureDefaultAliases();
    return c.json(getAllModelAliases());
});

routes.post('/api/v1/aliases', async (c) => {
    const body = await c.req.json<{ alias: string; target: string; fallbacks?: string[] }>();
    if (!body.alias || !body.target) return c.json({ error: 'alias and target required' }, 400);
    setModelAlias(body.alias, body.target, body.fallbacks || []);
    return c.json({ status: 'created', alias: body.alias, target: body.target });
});

routes.delete('/api/v1/aliases/:alias', (c) => {
    if (!deleteModelAlias(c.req.param('alias'))) return c.json({ error: 'Alias not found' }, 404);
    return c.json({ status: 'deleted' });
});

// Model search
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

routes.get('/api/v1/model-search', (c) => {
    const query = (c.req.query('q') || '').toLowerCase();
    const tag = c.req.query('tag') || '';

    let results = OLLAMA_MODEL_CATALOG;

    if (query) {
        results = results.filter(m => m.name.includes(query) || m.tags.some(t => t.includes(query)));
    }
    if (tag) {
        results = results.filter(m => m.tags.includes(tag));
    }

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

// Model pull progress
routes.get('/api/v1/nodes/:id/pulls', (c) => {
    const { getActiveModelPulls } = require('../db');
    return c.json(getActiveModelPulls(c.req.param('id')));
});

routes.get('/api/v1/pulls', (c) => {
    const { getAllActiveModelPulls } = require('../db');
    return c.json(getAllActiveModelPulls());
});

routes.post('/api/v1/nodes/:id/pulls', async (c) => {
    const { startModelPull } = require('../db');
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

routes.put('/api/v1/nodes/:id/pulls/:model', async (c) => {
    const { updateModelPull } = require('../db');
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

// Deploy to all with VRAM check
routes.post('/api/v1/deploy/all', async (c) => {
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

// Model coverage — MUST be before :model wildcard
routes.get('/api/v1/models/coverage', (c) => {
    const models = getClusterModels();
    const onlineCount = getAllNodes().filter(n => n.status === 'online').length;
    const coverage = models.map(m => ({
        model: m.model, node_count: m.node_count, coverage_pct: onlineCount > 0 ? Math.round((m.node_count / onlineCount) * 100) : 0,
        redundant: m.node_count >= 2, estimated_vram_mb: estimateModelVram(m.model),
    }));
    const avgCoverage = coverage.length > 0 ? Math.round(coverage.reduce((s, m) => s + m.coverage_pct, 0) / coverage.length) : 0;
    return c.json({ total_models: coverage.length, online_nodes: onlineCount, avg_coverage_pct: avgCoverage, redundant_models: coverage.filter(m => m.redundant).length, models: coverage });
});

// VRAM estimation endpoint — MUST be before :model wildcard
routes.get('/api/v1/models/estimate-vram', (c) => {
    const model = c.req.query('model');
    if (!model) return c.json({ error: 'model query parameter required' }, 400);
    const quantization = c.req.query('quantization') || 'Q4_K_M';
    const weightsMb = estimateModelVram(model);
    // KV cache rough estimate: ~10-15% of model weights for Q4
    const kvCacheMb = Math.round(weightsMb * 0.12);
    const totalMb = weightsMb + kvCacheMb;
    const format = quantization.startsWith('Q') ? 'GGUF' : 'safetensors';
    const backends = ['ollama', 'vllm'];
    if (format === 'GGUF') backends.unshift('llamacpp');
    return c.json({
        model, quantization, format,
        recommended_backends: backends,
        vram: { model_weights_mb: weightsMb, kv_cache_mb: kvCacheMb, total_mb: totalMb },
    });
});

// Model recommendations based on cluster VRAM — MUST be before :model wildcard
routes.get('/api/v1/models/recommend', (c) => {
    const vramParam = c.req.query('vram_mb');
    let availableVram: number;
    if (vramParam) {
        availableVram = parseInt(vramParam, 10);
        if (isNaN(availableVram) || availableVram < 0) availableVram = 0;
    } else {
        const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
        if (nodes.length === 0) return c.json({ recommendations: [], available_vram_mb: 0, message: 'No nodes online' });
        // Use the largest single-node VRAM as the budget
        availableVram = Math.max(...nodes.map(n => {
            const stats = n.latest_stats!;
            return stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0) - stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        }));
    }
    const catalog: Array<{ model: string; quantization: string; vram_required_mb: number; use_case: string; description: string }> = [
        { model: 'llama3.2:1b', quantization: 'Q4_K_M', vram_required_mb: 1024, use_case: 'edge', description: 'Ultra-light chat for edge devices' },
        { model: 'llama3.2:3b', quantization: 'Q4_K_M', vram_required_mb: 2048, use_case: 'chat', description: 'Lightweight general-purpose chat' },
        { model: 'phi3:3.8b', quantization: 'Q4_K_M', vram_required_mb: 2560, use_case: 'reasoning', description: 'Microsoft compact reasoning model' },
        { model: 'mistral:7b', quantization: 'Q4_K_M', vram_required_mb: 4608, use_case: 'chat', description: 'Fast and efficient all-rounder' },
        { model: 'llama3.1:8b', quantization: 'Q4_K_M', vram_required_mb: 5120, use_case: 'general', description: 'Meta Llama 3.1 — great all-rounder' },
        { model: 'deepseek-r1:8b', quantization: 'Q4_K_M', vram_required_mb: 5120, use_case: 'reasoning', description: 'DeepSeek R1 — deep reasoning' },
        { model: 'codellama:7b', quantization: 'Q4_K_M', vram_required_mb: 4608, use_case: 'code', description: 'Code Llama — code generation' },
        { model: 'gemma2:9b', quantization: 'Q4_K_M', vram_required_mb: 5632, use_case: 'chat', description: 'Google Gemma 2 — efficient' },
        { model: 'deepseek-coder-v2:16b', quantization: 'Q4_K_M', vram_required_mb: 10240, use_case: 'code', description: 'DeepSeek Coder V2 — advanced coding' },
        { model: 'llama3.1:70b', quantization: 'Q4_K_M', vram_required_mb: 41984, use_case: 'production', description: 'Meta Llama 3.1 70B — production quality' },
    ];
    const recommendations = catalog.filter(m => m.vram_required_mb <= availableVram);
    return c.json({ recommendations, available_vram_mb: availableVram, count: recommendations.length });
});

// Per-model rate tracking — wildcard MUST come after specific /models/* routes
routes.get('/api/v1/models/:model/stats', (c) => {
    const model = decodeURIComponent(c.req.param('model'));
    const d = getDb();
    const hour = d.prepare("SELECT COUNT(*) as cnt, AVG(latency_ms) as avg_lat FROM inference_log WHERE model = ? AND created_at >= datetime('now', '-1 hour')").get(model) as any || {};
    const day = d.prepare("SELECT COUNT(*) as cnt, AVG(latency_ms) as avg_lat FROM inference_log WHERE model = ? AND created_at >= datetime('now', '-24 hours')").get(model) as any || {};
    const nodes = d.prepare("SELECT DISTINCT node_id FROM inference_log WHERE model = ?").all(model) as any[];
    return c.json({ model, last_hour: { requests: hour.cnt || 0, avg_latency_ms: Math.round(hour.avg_lat || 0) }, last_24h: { requests: day.cnt || 0, avg_latency_ms: Math.round(day.avg_lat || 0) }, served_by_nodes: nodes.length });
});

routes.get('/api/v1/estimate', (c) => {
    const qs = c.req.url.split('?')[1] || '';
    return c.redirect('/api/v1/models/estimate-vram' + (qs ? '?' + qs : ''), 307);
});

routes.get('/api/v1/recommend', (c) => {
    const qs = c.req.url.split('?')[1] || '';
    return c.redirect('/api/v1/models/recommend' + (qs ? '?' + qs : ''), 307);
});

export default routes;
