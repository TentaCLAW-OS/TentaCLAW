/**
 * TentaCLAW Gateway — Model Management API (Phase 4)
 *
 * Wave 607: Model registry — local catalog with metadata
 * Wave 616: Task classifier — auto-detect prompt type
 * Wave 617: Model leaderboard — track wins per model per task
 * Wave 619: Context-length-aware routing
 * Wave 627: Model warmup — pre-run on load
 * Wave 628: Idle model unloading schedule
 */
import { Hono } from 'hono';
import {
    queueCommand,
    getClusterModels,
    getAllBenchmarks,
} from '../db';

const modelMgmt = new Hono();

// =============================================================================
// Wave 607: Model registry — GET /api/v1/registry
// In-memory model metadata catalog (persists to DB in future)
// =============================================================================

interface ModelRegistryEntry {
    name: string;
    nodes: string[];
    family: string;
    parameter_size: string;
    quantization: string;
    context_length: number;
    tags: string[];
    last_used: string;
    benchmark_tps: number;
}

const modelRegistry = new Map<string, ModelRegistryEntry>();

modelMgmt.get('/api/v1/registry', (c) => {
    // Build registry from live cluster state + benchmarks
    const clusterModels = getClusterModels();
    const benchmarks = getAllBenchmarks();

    const entries: ModelRegistryEntry[] = clusterModels.map(cm => {
        const existing = modelRegistry.get(cm.model);
        const bench = benchmarks.find(b => b.model === cm.model);
        return {
            name: cm.model,
            nodes: cm.nodes,
            family: existing?.family || inferModelFamily(cm.model),
            parameter_size: existing?.parameter_size || inferParamSize(cm.model),
            quantization: existing?.quantization || inferQuantization(cm.model),
            context_length: existing?.context_length || inferContextLength(cm.model),
            tags: existing?.tags || inferTags(cm.model),
            last_used: existing?.last_used || new Date().toISOString(),
            benchmark_tps: bench?.tokens_per_sec ?? existing?.benchmark_tps ?? 0,
        };
    });

    return c.json({ models: entries, count: entries.length });
});

modelMgmt.post('/api/v1/registry/:model/tags', async (c) => {
    const model = c.req.param('model');
    const body = await c.req.json<{ tags: string[] }>();
    const entry = modelRegistry.get(model);
    if (entry) {
        entry.tags = [...new Set([...entry.tags, ...(body.tags || [])])];
    } else {
        modelRegistry.set(model, {
            name: model, nodes: [], family: inferModelFamily(model),
            parameter_size: inferParamSize(model), quantization: inferQuantization(model),
            context_length: inferContextLength(model), tags: body.tags || [],
            last_used: new Date().toISOString(), benchmark_tps: 0,
        });
    }
    return c.json({ model, tags: modelRegistry.get(model)!.tags });
});

// =============================================================================
// Wave 616: Task classifier — POST /api/v1/classify
// Heuristic-based prompt classification (no model needed)
// =============================================================================

modelMgmt.post('/api/v1/classify', async (c) => {
    const body = await c.req.json<{ prompt: string }>();
    const prompt = (body.prompt || '').toLowerCase();
    const classification = classifyPrompt(prompt);
    return c.json(classification);
});

export function classifyPrompt(prompt: string): { task_type: string; confidence: number; reasoning: string } {
    const p = prompt.toLowerCase();

    // Code patterns
    const codeSignals = [
        /\b(function|class|def |import |const |let |var |return |if \(|for \(|while \()\b/,
        /\b(write|create|build|implement|code|program|script|fix|debug|refactor)\b.*\b(function|class|module|api|endpoint|component)\b/,
        /\b(typescript|javascript|python|rust|go|java|c\+\+|html|css|sql)\b/,
        /```[\s\S]*```/,
        /\b(npm|pip|cargo|git|docker|webpack|vite|eslint)\b/,
    ];
    const codeScore = codeSignals.filter(r => r.test(p)).length;

    // Math/reasoning patterns
    const mathSignals = [
        /\b(calculate|compute|solve|equation|formula|proof|theorem|integral|derivative)\b/,
        /\d+\s*[\+\-\*\/\^]\s*\d+/,
        /\b(probability|statistics|regression|matrix|vector)\b/,
    ];
    const mathScore = mathSignals.filter(r => r.test(p)).length;

    // Chat patterns
    const chatSignals = [
        /\b(explain|describe|what is|how does|why|tell me|summarize|compare)\b/,
        /\b(opinion|think|feel|believe|recommend)\b/,
        /\b(hello|hi|hey|thanks|please)\b/,
    ];
    const chatScore = chatSignals.filter(r => r.test(p)).length;

    // Reasoning patterns
    const reasoningSignals = [
        /\b(analyze|evaluate|argue|debate|pros and cons|tradeoffs?|decision)\b/,
        /\b(step by step|chain of thought|reasoning|logic|inference)\b/,
    ];
    const reasoningScore = reasoningSignals.filter(r => r.test(p)).length;

    const scores: Array<[string, number]> = [
        ['code', codeScore * 2],     // weight code higher
        ['math', mathScore * 2],
        ['reasoning', reasoningScore * 1.5],
        ['chat', chatScore],
    ];
    scores.sort((a, b) => b[1] - a[1]);

    const best = scores[0]!;
    const total = scores.reduce((s, [, v]) => s + v, 0);
    const confidence = total > 0 ? Math.round((best[1] / total) * 100) / 100 : 0.5;

    return {
        task_type: best[1] > 0 ? best[0] : 'chat',
        confidence: Math.max(0.3, confidence),
        reasoning: best[1] > 0
            ? `Detected ${best[1]} ${best[0]} signal(s) in prompt`
            : 'No strong signals — defaulting to chat',
    };
}

// =============================================================================
// Wave 617: Model leaderboard — GET /api/v1/leaderboard
// =============================================================================

interface LeaderboardEntry {
    model: string;
    task_type: string;
    wins: number;
    avg_tps: number;
    avg_latency_ms: number;
    total_requests: number;
}

const leaderboard = new Map<string, LeaderboardEntry>();

export function recordLeaderboardResult(model: string, taskType: string, tps: number, latencyMs: number): void {
    const key = `${model}:${taskType}`;
    const entry = leaderboard.get(key) || { model, task_type: taskType, wins: 0, avg_tps: 0, avg_latency_ms: 0, total_requests: 0 };
    entry.total_requests++;
    entry.avg_tps = Math.round(((entry.avg_tps * (entry.total_requests - 1)) + tps) / entry.total_requests * 10) / 10;
    entry.avg_latency_ms = Math.round(((entry.avg_latency_ms * (entry.total_requests - 1)) + latencyMs) / entry.total_requests);
    leaderboard.set(key, entry);
}

// Note: GET /api/v1/leaderboard already exists in misc.ts (uses live node stats)
// recordLeaderboardResult can be called from inference routes for additional tracking

// =============================================================================
// Wave 619: Context-length-aware routing — GET /api/v1/models/context-fit
// Check which models can handle a given prompt length
// =============================================================================

modelMgmt.post('/api/v1/models/context-fit', async (c) => {
    const body = await c.req.json<{ prompt_tokens: number; model?: string }>();
    const promptTokens = body.prompt_tokens || 0;
    const clusterModels = getClusterModels();

    const fits = clusterModels.map(cm => {
        const ctxLen = inferContextLength(cm.model);
        const fits = ctxLen > promptTokens * 1.2; // 20% headroom for response
        return { model: cm.model, context_length: ctxLen, fits, headroom: ctxLen - promptTokens, nodes: cm.nodes };
    });

    fits.sort((a, b) => (b.fits ? 1 : 0) - (a.fits ? 1 : 0) || b.headroom - a.headroom);

    return c.json({ prompt_tokens: promptTokens, models: fits });
});

// =============================================================================
// Wave 627: Model warmup — POST /api/v1/models/:model/warmup
// Send a minimal inference to warm up KV cache
// =============================================================================

modelMgmt.post('/api/v1/models/:model/warmup', async (c) => {
    const model = c.req.param('model');
    const clusterModels = getClusterModels();
    const cm = clusterModels.find(m => m.model === model);
    if (!cm || cm.nodes.length === 0) return c.json({ error: 'Model not loaded on any node' }, 404);

    // Queue warmup on all nodes that have the model
    const warmups: string[] = [];
    for (const nodeId of cm.nodes) {
        queueCommand(nodeId, 'reload_model', { model });
        warmups.push(nodeId);
    }

    return c.json({ model, warmed_nodes: warmups, count: warmups.length });
});

// =============================================================================
// Wave 628: Idle model unloading — POST /api/v1/models/unload-idle
// =============================================================================

modelMgmt.post('/api/v1/models/unload-idle', async (c) => {
    const body = await c.req.json<{ idle_minutes?: number }>().catch(() => ({}));
    const idleMinutes = (body as { idle_minutes?: number }).idle_minutes || 30;
    const now = Date.now();
    const cutoff = now - (idleMinutes * 60_000);

    const unloaded: Array<{ model: string; node_id: string }> = [];
    for (const [, entry] of modelRegistry) {
        const lastUsedTs = new Date(entry.last_used).getTime();
        if (lastUsedTs < cutoff && entry.nodes.length > 0) {
            for (const nodeId of entry.nodes) {
                queueCommand(nodeId, 'remove_model', { model: entry.name });
                unloaded.push({ model: entry.name, node_id: nodeId });
            }
        }
    }

    return c.json({ idle_minutes: idleMinutes, unloaded, count: unloaded.length });
});

// =============================================================================
// Helpers — infer model metadata from name conventions
// =============================================================================

function inferModelFamily(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('llama')) return 'llama';
    if (n.includes('qwen')) return 'qwen';
    if (n.includes('hermes')) return 'hermes';
    if (n.includes('mistral')) return 'mistral';
    if (n.includes('gemma')) return 'gemma';
    if (n.includes('phi')) return 'phi';
    if (n.includes('deepseek')) return 'deepseek';
    if (n.includes('codestral')) return 'codestral';
    if (n.includes('starcoder')) return 'starcoder';
    if (n.includes('command')) return 'command-r';
    return 'unknown';
}

function inferParamSize(name: string): string {
    const m = name.match(/(\d+\.?\d*)[bB]/);
    return m ? `${m[1]}B` : 'unknown';
}

function inferQuantization(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('q4_k_m') || n.includes('q4km')) return 'Q4_K_M';
    if (n.includes('q4_0') || n.includes('q4')) return 'Q4_0';
    if (n.includes('q5_k_m') || n.includes('q5km')) return 'Q5_K_M';
    if (n.includes('q8_0') || n.includes('q8')) return 'Q8_0';
    if (n.includes('fp16') || n.includes('f16')) return 'FP16';
    return 'default';
}

function inferContextLength(name: string): number {
    const n = name.toLowerCase();
    // Known model families and their typical context lengths
    if (n.includes('qwen2.5')) return 32768;
    if (n.includes('qwen3')) return 32768;
    if (n.includes('llama3') || n.includes('llama-3')) return 8192;
    if (n.includes('hermes3')) return 8192;
    if (n.includes('mistral')) return 32768;
    if (n.includes('gemma')) return 8192;
    if (n.includes('deepseek-coder') || n.includes('deepseek-v2')) return 16384;
    if (n.includes('deepseek-r1')) return 65536;
    if (n.includes('phi3') || n.includes('phi4')) return 4096;
    if (n.includes('codestral')) return 32768;
    if (n.includes('command-r')) return 131072;
    // Fallback: Ollama default
    return 4096;
}

function inferTags(name: string): string[] {
    const n = name.toLowerCase();
    const tags: string[] = [];
    if (n.includes('code') || n.includes('coder') || n.includes('starcoder')) tags.push('coding');
    if (n.includes('chat') || n.includes('instruct')) tags.push('chat');
    if (n.includes('math') || n.includes('qwq')) tags.push('math');
    if (n.includes('vision') || n.includes('vl') || n.includes('llava')) tags.push('vision');
    if (n.includes('embed') || n.includes('nomic')) tags.push('embedding');
    if (tags.length === 0) tags.push('general');
    return tags;
}

export default modelMgmt;
