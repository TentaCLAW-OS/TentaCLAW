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
    const rateKwh = parseFloat(c.req.query('rate_kwh') || '0.12'); // $/kWh default
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
    const budgetW = budget ? parseInt(String(budget), 10) : 0;
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

export default platform;
