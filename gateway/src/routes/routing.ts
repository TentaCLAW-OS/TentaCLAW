/**
 * TentaCLAW Gateway — Routing Intelligence API
 *
 * Wave 468: Hot standby — preload models on specific nodes
 * Wave 470: Routing rules — custom routing logic
 * Wave 471: Routing telemetry — log of all routing decisions
 * Wave 472: Route explain — explain what decision would be made for a given request
 */
import { Hono } from 'hono';
import {
    findNodesForModel,
    resolveModelAlias,
    estimateModelVram,
    getRoutingLog,
    getClusterModels,
    getAllNodes,
    clearStickySession,
    queueCommand,
} from '../db';

const routes = new Hono();

// =============================================================================
// Wave 471 — Routing Telemetry
// GET /api/v1/routing/telemetry
// =============================================================================

routes.get('/api/v1/routing/telemetry', (c) => {
    const limit = Math.min(500, parseInt(c.req.query('limit') || '100', 10) || 100);
    const decisions = getRoutingLog(limit);
    return c.json({
        decisions,
        total: decisions.length,
        _meta: {
            description: 'Last routing decisions made by the cluster router.',
            fields: 'time, nodeId, hostname, model, score, reason, vramFree_mb, inFlight, taskType, priority',
        },
    });
});

// =============================================================================
// Wave 472 — Route Explain
// POST /api/v1/routing/explain
// Body: { model: string, task_type?: string, priority?: string, session_id?: string }
// =============================================================================

routes.post('/api/v1/routing/explain', async (c) => {
    const body = await c.req.json();
    const model = body.model as string;
    if (!model) return c.json({ error: 'model is required' }, 400);

    const taskType = body.task_type as string | undefined;
    const priority = (body.priority === 'cost' || body.priority === 'speed') ? body.priority : 'balanced';
    const opts = { taskType, priority: priority as 'cost' | 'speed' | 'balanced' };

    const resolved = resolveModelAlias(model);
    const resolvedModel = resolved.target;

    const allCandidates = findNodesForModel(resolvedModel, opts);
    const best = allCandidates[0] ?? null;

    const estimatedVram = estimateModelVram(resolvedModel);

    const explanation: Record<string, unknown> = {
        request: { model, resolved_model: resolvedModel, task_type: taskType, priority },
        decision: best ? {
            chosen_node: best.node_id,
            hostname: best.hostname,
            score: (best as any).score ?? null,
            backend: best.backend_type,
            gpu_utilization: best.gpu_utilization_avg,
            in_flight: best.in_flight_requests,
        } : null,
        all_candidates: allCandidates.map(n => ({
            node_id: n.node_id,
            hostname: n.hostname,
            score: (n as any).score ?? null,
            backend: n.backend_type,
            gpu_util: n.gpu_utilization_avg,
            in_flight: n.in_flight_requests,
        })),
        model_info: {
            estimated_vram_mb: estimatedVram,
            alias_chain: resolved.target !== model ? { alias: model, resolves_to: resolved.target, fallbacks: resolved.fallbacks } : null,
        },
        scoring_factors: [
            'vramFitPenalty: +200 if free VRAM < estimated model size (Wave 461)',
            'vramPressure: 0-50 proportional to VRAM used% (Wave 461)',
            'healthPenalty: +15 if maxGpuTemp>75°C, +50 if >85°C (Wave 466)',
            'inFlightPenalty: +40 per in-flight request (Wave 473)',
            'gpuUtilPenalty: +0.3 * avgGpuUtil% (minor)',
            'latencyBonus: +0.01 * p50latencyMs (minor)',
            'throughputBonus: -0.05 * avgTokPerSec (minor)',
            'costModifier: +0.05 * totalGpuWatts if priority=cost (Wave 475)',
            'speedModifier: -0.3 * avgTokPerSec if priority=speed (Wave 475)',
            'lower score = better node',
        ],
        no_node_reason: !best
            ? (allCandidates.length === 0
                ? `No online node has "${resolvedModel}" loaded. Available models: ${getClusterModels().map(m => m.model).join(', ') || 'none'}`
                : 'All nodes are circuit-breaker blocked')
            : null,
    };

    if (!explanation.decision) {
        return c.json(explanation, 503);
    }
    return c.json(explanation);
});

// =============================================================================
// Wave 470 — Routing Rules API
// In-memory rules: GET / POST / DELETE /api/v1/routing/rules
// Rules are evaluated before standard routing
// =============================================================================

interface RoutingRule {
    id: string;
    name: string;
    match: { model?: string; task_type?: string; session_pattern?: string };
    action: { pin_node?: string; force_model?: string; priority?: 'cost' | 'speed' | 'balanced'; reject?: boolean };
    created_at: string;
}

const routingRules = new Map<string, RoutingRule>();
let ruleIdCounter = 1;

routes.get('/api/v1/routing/rules', (c) => {
    return c.json({ rules: [...routingRules.values()], count: routingRules.size });
});

routes.post('/api/v1/routing/rules', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    if (!body.match || typeof body.match !== 'object') return c.json({ error: 'match object is required' }, 400);
    if (!body.action || typeof body.action !== 'object') return c.json({ error: 'action object is required' }, 400);

    const id = `rule-${ruleIdCounter++}`;
    const rule: RoutingRule = {
        id,
        name: String(body.name),
        match: body.match,
        action: body.action,
        created_at: new Date().toISOString(),
    };
    routingRules.set(id, rule);
    return c.json({ rule, message: `Routing rule "${rule.name}" created (id: ${id})` }, 201);
});

routes.delete('/api/v1/routing/rules/:id', (c) => {
    const id = c.req.param('id');
    if (!routingRules.has(id)) return c.json({ error: `Rule "${id}" not found` }, 404);
    routingRules.delete(id);
    return c.json({ message: `Rule "${id}" deleted` });
});

routes.get('/api/v1/routing/rules/:id', (c) => {
    const id = c.req.param('id');
    const rule = routingRules.get(id);
    if (!rule) return c.json({ error: `Rule "${id}" not found` }, 404);
    return c.json({ rule });
});

/**
 * Evaluate routing rules for a given request context.
 * Returns the first matching rule's action, or null.
 * Exported for use in inference.ts if needed.
 */
export function evaluateRoutingRules(ctx: { model: string; taskType?: string; sessionId?: string }): RoutingRule['action'] | null {
    for (const rule of routingRules.values()) {
        const { match, action } = rule;
        let matches = true;
        if (match.model && !ctx.model.includes(match.model)) matches = false;
        if (match.task_type && ctx.taskType !== match.task_type) matches = false;
        if (match.session_pattern && ctx.sessionId && !ctx.sessionId.includes(match.session_pattern)) matches = false;
        if (matches) return action;
    }
    return null;
}

// =============================================================================
// Wave 468 — Hot Standby
// POST /api/v1/routing/hotstandby  — trigger preload of a model on a node
// GET  /api/v1/routing/hotstandby  — list warm nodes per model
// =============================================================================

routes.get('/api/v1/routing/hotstandby', (c) => {
    const nodes = getAllNodes();
    const warmMap: Record<string, string[]> = {};

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        for (const model of node.latest_stats.inference.loaded_models) {
            if (!warmMap[model]) warmMap[model] = [];
            warmMap[model].push(node.id);
        }
    }

    const entries = Object.entries(warmMap).map(([model, nodeIds]) => ({
        model,
        warm_nodes: nodeIds.length,
        node_ids: nodeIds,
        estimated_vram_mb: estimateModelVram(model),
    }));
    entries.sort((a, b) => b.warm_nodes - a.warm_nodes);

    return c.json({ hot_standby: entries, total_models: entries.length });
});

routes.post('/api/v1/routing/hotstandby', async (c) => {
    const body = await c.req.json();
    const model = body.model as string;
    const nodeId = body.node_id as string;

    if (!model) return c.json({ error: 'model is required' }, 400);
    if (!nodeId) return c.json({ error: 'node_id is required' }, 400);

    const nodes = getAllNodes();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return c.json({ error: `Node "${nodeId}" not found` }, 404);
    if (node.status !== 'online') return c.json({ error: `Node "${nodeId}" is ${node.status}` }, 409);

    // Queue a preload command to the node via the command queue
    queueCommand(nodeId, 'install_model', { model });

    return c.json({
        message: `Hot standby preload queued: "${model}" → ${node.hostname} (${nodeId})`,
        node_id: nodeId,
        model,
        estimated_vram_mb: estimateModelVram(model),
    }, 202);
});

// =============================================================================
// Wave 467 — Session Management
// DELETE /api/v1/routing/sessions/:sessionId — clear sticky session
// =============================================================================

routes.delete('/api/v1/routing/sessions/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    clearStickySession(sessionId);
    return c.json({ message: `Sticky session "${sessionId}" cleared` });
});

export default routes;
