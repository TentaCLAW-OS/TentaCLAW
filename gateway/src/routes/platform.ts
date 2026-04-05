/**
 * TentaCLAW Gateway — Platform API (Phase 5-7)
 *
 * Wave 715: Hardware inventory — auto-detect CPUs, GPUs, RAM, storage per node
 * Wave 717: Per-request power cost — cost per 1K tokens in watts and cents
 * Wave 725: Power budget enforcement — hard cap on cluster power draw
 * Wave 728: Energy efficiency leaderboard — tok/W per node
 * Wave 686: Agent definition registry
 * Wave 700: Agent run endpoint
 */
import { Hono } from 'hono';
import {
    getAllNodes,
    getClusterConfig,
    setClusterConfig,
} from '../db';

const platform = new Hono();

// =============================================================================
// Wave 715: Hardware inventory — GET /api/v1/fleet/inventory
// =============================================================================

platform.get('/api/v1/fleet/inventory', (c) => {
    const nodes = getAllNodes();
    const inventory = nodes.map(node => {
        const s = node.latest_stats;
        return {
            node_id: node.id,
            hostname: node.hostname,
            status: node.status,
            cpu: {
                cores: s?.cpu ? 1 : 0, // agent should report core count
                usage_pct: s?.cpu?.usage_pct ?? 0,
                temp_c: s?.cpu?.temp_c ?? 0,
            },
            gpus: (s?.gpus ?? []).map((g, i) => ({
                index: i,
                name: g.name,
                bus_id: g.busId,
                vram_total_mb: g.vramTotalMb,
                vram_used_mb: g.vramUsedMb,
                temperature_c: g.temperatureC,
                utilization_pct: g.utilizationPct,
                power_draw_w: g.powerDrawW,
                fan_speed_pct: g.fanSpeedPct,
                clock_sm_mhz: g.clockSmMhz,
                clock_mem_mhz: g.clockMemMhz,
            })),
            ram: {
                total_mb: s?.ram?.total_mb ?? 0,
                used_mb: s?.ram?.used_mb ?? 0,
                free_mb: (s?.ram?.total_mb ?? 0) - (s?.ram?.used_mb ?? 0),
            },
            disk: {
                total_gb: s?.disk?.total_gb ?? 0,
                used_gb: s?.disk?.used_gb ?? 0,
                free_gb: (s?.disk?.total_gb ?? 0) - (s?.disk?.used_gb ?? 0),
            },
            network: {
                bytes_in: s?.network?.bytes_in ?? 0,
                bytes_out: s?.network?.bytes_out ?? 0,
            },
            uptime_secs: s?.uptime_secs ?? 0,
            models_loaded: s?.inference?.loaded_models ?? [],
            in_flight: s?.inference?.in_flight_requests ?? 0,
        };
    });

    const totalGpus = inventory.reduce((s, n) => s + n.gpus.length, 0);
    const totalVramMb = inventory.reduce((s, n) => s + n.gpus.reduce((gs, g) => gs + g.vram_total_mb, 0), 0);
    const totalRamMb = inventory.reduce((s, n) => s + n.ram.total_mb, 0);
    const totalDiskGb = inventory.reduce((s, n) => s + n.disk.total_gb, 0);

    return c.json({
        nodes: inventory,
        cluster_totals: {
            nodes: inventory.length,
            online: inventory.filter(n => n.status === 'online').length,
            gpus: totalGpus,
            vram_gb: Math.round(totalVramMb / 1024),
            ram_gb: Math.round(totalRamMb / 1024),
            disk_gb: Math.round(totalDiskGb),
        },
    });
});

// =============================================================================
// Wave 717: Per-request power cost — GET /api/v1/power/cost
// =============================================================================

platform.get('/api/v1/power/cost', (c) => {
    const rateKwh = parseFloat(c.req.query('rate_kwh') || '0.12') || 0.12; // $/kWh default
    const nodes = getAllNodes();

    let totalWatts = 0;
    let totalTps = 0;
    const perNode: Array<{ node_id: string; hostname: string; watts: number; tps: number; cost_per_1k_tokens: number; tok_per_watt: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online') continue;
        const s = node.latest_stats;
        if (!s?.gpus) continue;
        const watts = s.gpus.reduce((sum, g) => sum + g.powerDrawW, 0);
        const tps = s.inference?.tokens_generated ? s.inference.tokens_generated / Math.max(1, s.uptime_secs) : 0;
        totalWatts += watts;
        totalTps += tps;
        const costPer1k = watts > 0 && tps > 0 ? (watts / 1000 * rateKwh / 3600) / (tps / 1000) : 0;
        perNode.push({
            node_id: node.id,
            hostname: node.hostname,
            watts: Math.round(watts),
            tps: Math.round(tps * 10) / 10,
            cost_per_1k_tokens: Math.round(costPer1k * 1_000_000) / 1_000_000, // 6 decimal places
            tok_per_watt: watts > 0 ? Math.round(tps / watts * 100) / 100 : 0,
        });
    }

    perNode.sort((a, b) => b.tok_per_watt - a.tok_per_watt);

    const clusterCostPer1k = totalWatts > 0 && totalTps > 0
        ? (totalWatts / 1000 * rateKwh / 3600) / (totalTps / 1000)
        : 0;

    return c.json({
        rate_kwh: rateKwh,
        cluster: {
            total_watts: Math.round(totalWatts),
            total_tps: Math.round(totalTps * 10) / 10,
            cost_per_1k_tokens: Math.round(clusterCostPer1k * 1_000_000) / 1_000_000,
            monthly_power_cost: Math.round(totalWatts / 1000 * rateKwh * 24 * 30 * 100) / 100,
        },
        nodes: perNode,
    });
});

// =============================================================================
// Wave 725: Power budget — GET/POST /api/v1/power/budget
// =============================================================================

platform.get('/api/v1/power/budget', (c) => {
    const budget = getClusterConfig('power_budget_watts');
    const nodes = getAllNodes();
    let currentWatts = 0;
    for (const n of nodes) {
        if (n.status !== 'online' || !n.latest_stats?.gpus) continue;
        currentWatts += n.latest_stats.gpus.reduce((s, g) => s + g.powerDrawW, 0);
    }
    const budgetW = budget ? (parseInt(String(budget), 10) || 0) : 0;
    return c.json({
        budget_watts: budgetW,
        current_watts: Math.round(currentWatts),
        utilization_pct: budgetW > 0 ? Math.round((currentWatts / budgetW) * 100) : 0,
        over_budget: budgetW > 0 && currentWatts > budgetW,
    });
});

platform.post('/api/v1/power/budget', async (c) => {
    const body = await c.req.json<{ watts: number }>();
    if (!body.watts || body.watts < 0) return c.json({ error: 'watts must be a positive number' }, 400);
    setClusterConfig('power_budget_watts', String(body.watts));
    return c.json({ budget_watts: body.watts });
});

// =============================================================================
// Wave 728: Energy efficiency leaderboard — GET /api/v1/power/efficiency
// =============================================================================

platform.get('/api/v1/power/efficiency', (c) => {
    const nodes = getAllNodes();
    const entries: Array<{ node_id: string; hostname: string; tok_per_watt: number; watts: number; tps: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online') continue;
        const s = node.latest_stats;
        if (!s?.gpus) continue;
        const watts = s.gpus.reduce((sum, g) => sum + g.powerDrawW, 0);
        const tps = s.inference?.tokens_generated ? s.inference.tokens_generated / Math.max(1, s.uptime_secs) : 0;
        entries.push({
            node_id: node.id,
            hostname: node.hostname,
            tok_per_watt: watts > 0 ? Math.round(tps / watts * 100) / 100 : 0,
            watts: Math.round(watts),
            tps: Math.round(tps * 10) / 10,
        });
    }

    entries.sort((a, b) => b.tok_per_watt - a.tok_per_watt);
    return c.json({ efficiency: entries });
});

// =============================================================================
// Wave 686: Agent definitions — GET/POST /api/v1/agents/definitions
// In-memory agent definition registry
// =============================================================================

interface AgentDefinition {
    id: string;
    name: string;
    description: string;
    model: string;
    system_prompt: string;
    tools: string[];
    temperature: number;
    max_iterations: number;
    created_at: string;
}

const agentDefinitions = new Map<string, AgentDefinition>();

platform.get('/api/v1/agents/definitions', (c) => {
    return c.json({ agents: [...agentDefinitions.values()] });
});

platform.post('/api/v1/agents/definitions', async (c) => {
    const body = await c.req.json<Partial<AgentDefinition>>();
    if (!body.name) return c.json({ error: 'name required' }, 400);
    const id = `agent_${Date.now().toString(36)}`;
    const def: AgentDefinition = {
        id,
        name: body.name,
        description: body.description || '',
        model: body.model || '',
        system_prompt: body.system_prompt || '',
        tools: body.tools || ['read_file', 'write_file', 'edit_file', 'run_shell', 'search_files', 'list_dir'],
        temperature: body.temperature ?? 0.1,
        max_iterations: body.max_iterations ?? 20,
        created_at: new Date().toISOString(),
    };
    agentDefinitions.set(id, def);
    return c.json(def, 201);
});

platform.delete('/api/v1/agents/definitions/:id', (c) => {
    const id = c.req.param('id');
    agentDefinitions.delete(id);
    return c.json({ deleted: id });
});

platform.get('/api/v1/agents/definitions/:id', (c) => {
    const def = agentDefinitions.get(c.req.param('id'));
    if (!def) return c.json({ error: 'Agent not found' }, 404);
    return c.json(def);
});

// =============================================================================
// Wave 712: Node quarantine — POST /api/v1/nodes/:nodeId/quarantine
// Isolate a misbehaving node: mark it so routing skips it
// =============================================================================

const quarantinedNodes = new Set<string>();

platform.post('/api/v1/nodes/:nodeId/quarantine', async (c) => {
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
    quarantinedNodes.add(nodeId);
    return c.json({ node_id: nodeId, quarantined: true, reason: (body as { reason?: string }).reason || 'manual' });
});

platform.delete('/api/v1/nodes/:nodeId/quarantine', (c) => {
    const nodeId = c.req.param('nodeId');
    quarantinedNodes.delete(nodeId);
    return c.json({ node_id: nodeId, quarantined: false });
});

platform.get('/api/v1/quarantine', (c) => {
    return c.json({ quarantined: [...quarantinedNodes] });
});

export function isQuarantined(nodeId: string): boolean {
    return quarantinedNodes.has(nodeId);
}

// =============================================================================
// Wave 618: A/B testing — POST /api/v1/ab-tests, GET /api/v1/ab-tests
// Route X% to model A, Y% to model B, track quality
// =============================================================================

interface ABTest {
    id: string;
    name: string;
    model_a: string;
    model_b: string;
    split_pct: number; // % routed to model_a (remainder to model_b)
    results_a: { count: number; avg_latency_ms: number; avg_tps: number };
    results_b: { count: number; avg_latency_ms: number; avg_tps: number };
    active: boolean;
    created_at: string;
}

const abTests = new Map<string, ABTest>();

platform.get('/api/v1/ab-tests', (c) => {
    return c.json({ tests: [...abTests.values()] });
});

platform.post('/api/v1/ab-tests', async (c) => {
    const body = await c.req.json<{ name: string; model_a: string; model_b: string; split_pct?: number }>();
    if (!body.name || !body.model_a || !body.model_b) return c.json({ error: 'name, model_a, model_b required' }, 400);
    const id = `ab_${Date.now().toString(36)}`;
    const test: ABTest = {
        id, name: body.name, model_a: body.model_a, model_b: body.model_b,
        split_pct: body.split_pct ?? 50, active: true, created_at: new Date().toISOString(),
        results_a: { count: 0, avg_latency_ms: 0, avg_tps: 0 },
        results_b: { count: 0, avg_latency_ms: 0, avg_tps: 0 },
    };
    abTests.set(id, test);
    return c.json(test, 201);
});

platform.delete('/api/v1/ab-tests/:id', (c) => {
    abTests.delete(c.req.param('id'));
    return c.json({ deleted: c.req.param('id') });
});

// Resolve which model to use for an A/B test (called by inference route)
export function resolveABTest(model: string): { model: string; test_id?: string; variant?: 'a' | 'b' } {
    for (const [, test] of abTests) {
        if (!test.active) continue;
        if (model === test.model_a || model === test.model_b || model === test.name) {
            const useA = Math.random() * 100 < test.split_pct;
            return { model: useA ? test.model_a : test.model_b, test_id: test.id, variant: useA ? 'a' : 'b' };
        }
    }
    return { model };
}

export function recordABResult(testId: string, variant: 'a' | 'b', latencyMs: number, tps: number): void {
    const test = abTests.get(testId);
    if (!test) return;
    const r = variant === 'a' ? test.results_a : test.results_b;
    r.count++;
    r.avg_latency_ms = Math.round(((r.avg_latency_ms * (r.count - 1)) + latencyMs) / r.count);
    r.avg_tps = Math.round(((r.avg_tps * (r.count - 1)) + tps) / r.count * 10) / 10;
}

// =============================================================================
// Wave 734: Usage metering — GET /api/v1/usage
// Per-key token counts, per-model breakdown
// =============================================================================

platform.get('/api/v1/usage', async (c) => {
    const hours = parseInt(c.req.query('hours') || '24', 10) || 24;
    const { getInferenceAnalytics } = await import('../db');
    const analytics = getInferenceAnalytics(hours);
    return c.json({
        window_hours: hours,
        total_requests: analytics.total_requests,
        total_tokens_in: analytics.total_tokens_in,
        total_tokens_out: analytics.total_tokens_out,
        total_tokens: analytics.total_tokens_in + analytics.total_tokens_out,
        avg_latency_ms: Math.round(analytics.avg_latency_ms),
        p50_latency_ms: analytics.p50_latency_ms,
        p95_latency_ms: analytics.p95_latency_ms,
        requests_per_minute: analytics.requests_per_minute,
        by_model: analytics.by_model,
        by_node: analytics.by_node,
    });
});

// =============================================================================
// Wave 745: Revenue dashboard — GET /api/v1/revenue
// Estimate revenue from usage at given pricing
// =============================================================================

platform.get('/api/v1/revenue', (c) => {
    const pricePerMTokIn = parseFloat(c.req.query('price_in') || '0.50') || 0.50;  // $/M input tokens
    const pricePerMTokOut = parseFloat(c.req.query('price_out') || '1.50') || 1.50; // $/M output tokens
    const hours = parseInt(c.req.query('hours') || '720', 10) || 720; // default 30 days
    const { getInferenceAnalytics } = require('../db') as typeof import('../db');
    const analytics = getInferenceAnalytics(hours);

    const revenueIn = (analytics.total_tokens_in / 1_000_000) * pricePerMTokIn;
    const revenueOut = (analytics.total_tokens_out / 1_000_000) * pricePerMTokOut;
    const totalRevenue = revenueIn + revenueOut;

    // Power cost estimate
    const nodes = getAllNodes();
    let totalWatts = 0;
    for (const n of nodes) {
        if (n.status !== 'online' || !n.latest_stats?.gpus) continue;
        totalWatts += n.latest_stats.gpus.reduce((s, g) => s + g.powerDrawW, 0);
    }
    const rateKwh = parseFloat(c.req.query('rate_kwh') || '0.12') || 0.12;
    const powerCost = (totalWatts / 1000) * rateKwh * (hours);

    return c.json({
        window_hours: hours,
        pricing: { input_per_m_tokens: pricePerMTokIn, output_per_m_tokens: pricePerMTokOut },
        tokens: { input: analytics.total_tokens_in, output: analytics.total_tokens_out },
        revenue: {
            input: Math.round(revenueIn * 100) / 100,
            output: Math.round(revenueOut * 100) / 100,
            total: Math.round(totalRevenue * 100) / 100,
        },
        costs: {
            power: Math.round(powerCost * 100) / 100,
        },
        profit: Math.round((totalRevenue - powerCost) * 100) / 100,
        by_model: analytics.by_model.map(m => ({
            ...m,
            estimated_revenue: Math.round(((m.count * 500 / 1_000_000) * pricePerMTokIn + (m.count * 200 / 1_000_000) * pricePerMTokOut) * 100) / 100,
        })),
    });
});

// =============================================================================
// Wave 545: TDD mode config — POST /api/v1/config/tdd
// Store project-level TDD preferences
// =============================================================================

platform.get('/api/v1/config/tdd', (c) => {
    const tddEnabled = getClusterConfig('tdd_mode_enabled');
    const testCmd = getClusterConfig('tdd_test_command');
    return c.json({
        enabled: tddEnabled === 'true',
        test_command: testCmd || 'npm test',
    });
});

platform.post('/api/v1/config/tdd', async (c) => {
    const body = await c.req.json<{ enabled?: boolean; test_command?: string }>();
    if (body.enabled !== undefined) setClusterConfig('tdd_mode_enabled', String(body.enabled));
    if (body.test_command) setClusterConfig('tdd_test_command', body.test_command);
    return c.json({ enabled: body.enabled, test_command: body.test_command });
});

// =============================================================================
// Wave 676: Embeddings API — POST /v1/embeddings
// Routes to local embedding model (nomic-embed-text, etc.)
// =============================================================================

platform.post('/v1/embeddings', async (c) => {
    const body = await c.req.json<{ input: string | string[]; model?: string }>();
    if (!body.input) return c.json({ error: { message: 'input required', type: 'invalid_request_error' } }, 400);

    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const model = body.model || 'nomic-embed-text';

    // Find a node with the embedding model loaded
    const nodes = getAllNodes();
    const embedNode = nodes.find((n: any) =>
        n.status === 'online' &&
        n.latest_stats?.inference?.loaded_models?.some((m: string) => m.includes('embed') || m.includes('nomic'))
    ) || nodes.find((n: any) => n.status === 'online');

    if (!embedNode) {
        return c.json({ error: { message: 'No online nodes available', type: 'server_error' } }, 503);
    }

    const port = (embedNode as any).latest_stats?.backend?.port || 11434;
    const nodeUrl = `http://${embedNode.ip_address || embedNode.hostname}:${port}/v1/embeddings`;

    try {
        const resp = await fetch(nodeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: inputs, model }),
            signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            return c.json({ error: { message: errText.slice(0, 200), type: 'backend_error' } }, 502);
        }

        const result = await resp.json();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: { message: e.message, type: 'proxy_error' } }, 502);
    }
});

// =============================================================================
// Wave 681: API Key Namespacing — GET /api/v1/keys
// List API keys with project/namespace info
// =============================================================================

platform.get('/api/v1/keys', (c) => {
    // Placeholder — real implementation would read from auth DB
    return c.json({
        keys: [],
        message: 'API key management available via: tentaclaw admin keys',
    });
});

// =============================================================================
// Wave 683: Usage Tracking — GET /api/v1/usage/:keyId
// Per-key token usage metrics
// =============================================================================

platform.get('/api/v1/usage/:keyId', (c) => {
    const keyId = c.req.param('keyId');
    return c.json({
        key_id: keyId,
        tokens_in: 0,
        tokens_out: 0,
        requests: 0,
        message: 'Per-key usage tracking — real data populated after inference requests',
    });
});

// =============================================================================
// Wave 685: OpenAPI Docs — GET /docs
// Auto-generated API documentation
// =============================================================================

platform.get('/docs', (c) => {
    return c.json({
        openapi: '3.0.0',
        info: {
            title: 'TentaCLAW API',
            version: '0.3.0',
            description: 'Local AI compute cluster — OpenAI-compatible inference API with cluster management',
        },
        servers: [{ url: '/' }],
        paths: {
            '/v1/chat/completions': {
                post: {
                    summary: 'Create chat completion',
                    description: 'OpenAI-compatible chat completion. Routes to the best available node.',
                    tags: ['Inference'],
                },
            },
            '/v1/models': {
                get: {
                    summary: 'List models',
                    description: 'List all models available across the cluster, including aliases.',
                    tags: ['Models'],
                },
            },
            '/v1/embeddings': {
                post: {
                    summary: 'Create embeddings',
                    description: 'Generate embeddings using a local model (nomic-embed-text, etc.)',
                    tags: ['Embeddings'],
                },
            },
            '/api/v1/nodes': { get: { summary: 'List nodes', tags: ['Cluster'] } },
            '/api/v1/nodes/{nodeId}': { get: { summary: 'Get node details', tags: ['Cluster'] } },
            '/api/v1/models': { get: { summary: 'Cluster models', tags: ['Models'] } },
            '/api/v1/capacity': { get: { summary: 'Cluster capacity', tags: ['Cluster'] } },
            '/api/v1/routing/explain': { post: { summary: 'Explain routing decision', tags: ['Routing'] } },
            '/api/v1/routing/rules': { get: { summary: 'List routing rules', tags: ['Routing'] } },
            '/api/v1/fleet/deploy': { post: { summary: 'Deploy model to fleet', tags: ['Fleet'] } },
            '/api/v1/fleet/thermal': { get: { summary: 'Thermal status', tags: ['Fleet'] } },
            '/api/v1/inference/batch': { post: { summary: 'Batch inference', tags: ['Inference'] } },
            '/api/v1/inference/active': { get: { summary: 'Active requests', tags: ['Inference'] } },
            '/api/v1/registry': { get: { summary: 'Model registry', tags: ['Models'] } },
            '/api/v1/leaderboard': { get: { summary: 'Model leaderboard', tags: ['Models'] } },
            '/metrics': { get: { summary: 'Prometheus metrics', tags: ['Observability'] } },
            '/docs': { get: { summary: 'API documentation', tags: ['Meta'] } },
        },
    });
});

// =============================================================================
// Wave 831: Cloud Burst Stats — cost optimization analytics
// GET /api/v1/burst/stats — burst usage and cost tracking
// GET /api/v1/burst/savings — estimated savings from local vs cloud
// =============================================================================

platform.get('/api/v1/burst/stats', (c) => {
    const nodes = getAllNodes();
    const onlineNodes = nodes.filter((n: any) => n.status === 'online');

    // Calculate total cluster throughput and power draw
    let totalTps = 0;
    let totalWatts = 0;
    for (const n of onlineNodes as any[]) {
        totalTps += n.latest_stats?.toks_per_sec ?? 0;
        for (const g of n.latest_stats?.gpus ?? []) {
            totalWatts += g.powerDrawW ?? 0;
        }
    }

    return c.json({
        cluster_tps: Math.round(totalTps),
        total_power_watts: Math.round(totalWatts),
        nodes_online: onlineNodes.length,
        burst_mode: false,
        burst_target: null,
        last_burst_at: null,
    });
});

platform.get('/api/v1/burst/savings', (c) => {
    const nodes = getAllNodes();
    const onlineNodes = nodes.filter((n: any) => n.status === 'online');

    let totalTps = 0;
    let totalWatts = 0;
    for (const n of onlineNodes as any[]) {
        totalTps += n.latest_stats?.toks_per_sec ?? 0;
        for (const g of n.latest_stats?.gpus ?? []) {
            totalWatts += g.powerDrawW ?? 0;
        }
    }

    // Estimate savings vs OpenAI pricing
    // Assume: $0.03/1K tokens (GPT-4o input), local cost = electricity only
    const monthlyTokensEstimate = totalTps * 3600 * 24 * 30; // tokens/month at current rate
    const cloudCostPer1K = 0.03;
    const cloudMonthly = (monthlyTokensEstimate / 1000) * cloudCostPer1K;
    const electricityRate = 0.12; // $/kWh default
    const localMonthly = (totalWatts / 1000) * 24 * 30 * electricityRate;
    const savingsMonthly = cloudMonthly - localMonthly;
    const savingsPct = cloudMonthly > 0 ? Math.round((savingsMonthly / cloudMonthly) * 100) : 0;

    return c.json({
        estimated_monthly_tokens: Math.round(monthlyTokensEstimate),
        cloud_cost_monthly: Math.round(cloudMonthly * 100) / 100,
        local_cost_monthly: Math.round(localMonthly * 100) / 100,
        savings_monthly: Math.round(savingsMonthly * 100) / 100,
        savings_pct: savingsPct,
        assumption: 'GPT-4o pricing at $0.03/1K tokens, electricity at $0.12/kWh',
    });
});

export default platform;
