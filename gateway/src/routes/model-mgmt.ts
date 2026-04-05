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

// =============================================================================
// Wave 601: Model Quantization — POST /api/v1/models/:model/quantize
// Queues a quantization job on a target node via agent command
// =============================================================================

modelMgmt.post('/api/v1/models/:model/quantize', async (c) => {
    const model = c.req.param('model');
    const body = await c.req.json() as { node_id: string; bits?: number; method?: string };
    if (!body.node_id) return c.json({ error: 'node_id required' }, 400);

    const bits = body.bits || 4;
    const method = body.method || 'Q4_K_M';

    queueCommand(body.node_id, 'quantize_model', { model, bits, method });

    return c.json({
        message: `Quantization queued: ${model} → ${method} (${bits}-bit)`,
        model,
        target_quantization: method,
        bits,
        node_id: body.node_id,
        status: 'queued',
    }, 202);
});

// =============================================================================
// Wave 603: GGUF Conversion — POST /api/v1/models/convert
// Queue GGUF conversion from HuggingFace safetensors
// =============================================================================

modelMgmt.post('/api/v1/models/convert', async (c) => {
    const body = await c.req.json() as { source: string; node_id: string; format?: string; output_name?: string };
    if (!body.source || !body.node_id) return c.json({ error: 'source and node_id required' }, 400);

    const format = body.format || 'gguf';
    queueCommand(body.node_id, 'quantize_model', {
        model: body.source,
        convert: true,
        format,
        output_name: body.output_name,
    });

    return c.json({
        message: `Conversion queued: ${body.source} → ${format}`,
        source: body.source,
        format,
        node_id: body.node_id,
        status: 'queued',
    }, 202);
});

// =============================================================================
// Wave 604: Model Merging — POST /api/v1/models/merge
// Queue model merge (frankenmerge) on a target node
// =============================================================================

modelMgmt.post('/api/v1/models/merge', async (c) => {
    const body = await c.req.json() as { model_a: string; model_b: string; node_id: string; method?: string; output_name?: string };
    if (!body.model_a || !body.model_b || !body.node_id) {
        return c.json({ error: 'model_a, model_b, and node_id required' }, 400);
    }

    const method = body.method || 'slerp';
    queueCommand(body.node_id, 'quantize_model', {
        model: body.model_a,
        merge_with: body.model_b,
        merge_method: method,
        output_name: body.output_name || `${body.model_a.split(':')[0]}-${body.model_b.split(':')[0]}-merge`,
    });

    return c.json({
        message: `Merge queued: ${body.model_a} + ${body.model_b} (${method})`,
        model_a: body.model_a,
        model_b: body.model_b,
        method,
        node_id: body.node_id,
        status: 'queued',
    }, 202);
});

// =============================================================================
// Wave 605: LORA Training — POST /api/v1/models/:model/lora
// Queue LORA fine-tuning on a target node
// =============================================================================

modelMgmt.post('/api/v1/models/:model/lora', async (c) => {
    const model = c.req.param('model');
    const body = await c.req.json() as { node_id: string; data_path: string; epochs?: number; lr?: number; output_name?: string };
    if (!body.node_id || !body.data_path) return c.json({ error: 'node_id and data_path required' }, 400);

    queueCommand(body.node_id, 'quantize_model', {
        model,
        lora_train: true,
        data_path: body.data_path,
        epochs: body.epochs || 3,
        lr: body.lr || 2e-4,
        output_name: body.output_name || `${model.split(':')[0]}-lora`,
    });

    return c.json({
        message: `LORA training queued: ${model} on ${body.data_path}`,
        model,
        data_path: body.data_path,
        epochs: body.epochs || 3,
        node_id: body.node_id,
        status: 'queued',
    }, 202);
});

// =============================================================================
// Wave 606: LORA Library — GET/POST /api/v1/lora
// Manage LORA adapters
// =============================================================================

interface LoraAdapter {
    id: string;
    name: string;
    base_model: string;
    task: string;
    node_id: string;
    created_at: string;
}

const loraAdapters: LoraAdapter[] = [];

modelMgmt.get('/api/v1/lora', (c) => {
    return c.json({ adapters: loraAdapters, count: loraAdapters.length });
});

modelMgmt.post('/api/v1/lora', async (c) => {
    const body = await c.req.json() as { name: string; base_model: string; task: string; node_id: string };
    if (!body.name || !body.base_model) return c.json({ error: 'name and base_model required' }, 400);

    const adapter: LoraAdapter = {
        id: 'lora-' + Date.now().toString(36),
        name: body.name,
        base_model: body.base_model,
        task: body.task || 'general',
        node_id: body.node_id || '',
        created_at: new Date().toISOString(),
    };
    if (loraAdapters.length >= 100) {
        return c.json({ error: 'Maximum 100 LORA adapters. Delete old ones first.' }, 400);
    }
    loraAdapters.push(adapter);
    return c.json({ adapter }, 201);
});

modelMgmt.delete('/api/v1/lora/:id', (c) => {
    const id = c.req.param('id');
    const idx = loraAdapters.findIndex(a => a.id === id);
    if (idx === -1) return c.json({ error: 'Adapter not found' }, 404);
    loraAdapters.splice(idx, 1);
    return c.json({ message: 'Adapter removed' });
});

// =============================================================================
// Wave 613: Model Compare — POST /api/v1/models/compare
// Side-by-side benchmark of two models
// =============================================================================

modelMgmt.post('/api/v1/models/compare', async (c) => {
    const body = await c.req.json() as { model_a: string; model_b: string; prompt?: string };
    if (!body.model_a || !body.model_b) return c.json({ error: 'model_a and model_b required' }, 400);

    // Get benchmark data for both models
    const allBenchmarks = getAllBenchmarks();
    const benchA = allBenchmarks.filter((b: any) => b.model === body.model_a);
    const benchB = allBenchmarks.filter((b: any) => b.model === body.model_b);

    const avgTps = (benches: any[]) => benches.length > 0
        ? benches.reduce((s: number, b: any) => s + (b.tokens_per_second || 0), 0) / benches.length
        : 0;

    return c.json({
        model_a: {
            name: body.model_a,
            avg_tps: Math.round(avgTps(benchA) * 10) / 10,
            benchmark_count: benchA.length,
        },
        model_b: {
            name: body.model_b,
            avg_tps: Math.round(avgTps(benchB) * 10) / 10,
            benchmark_count: benchB.length,
        },
        winner: avgTps(benchA) > avgTps(benchB) ? body.model_a : avgTps(benchB) > avgTps(benchA) ? body.model_b : 'tie',
    });
});

// =============================================================================
// Wave 617: Model Benchmark Leaderboard — GET /api/v1/leaderboard/benchmarks
// Separate from the live leaderboard in misc.ts — this one uses stored benchmarks
// =============================================================================

modelMgmt.get('/api/v1/leaderboard/benchmarks', (c) => {
    const allBenchmarks = getAllBenchmarks();

    // Aggregate by model
    const modelStats: Record<string, { tps_sum: number; count: number; best_tps: number }> = {};
    for (const b of allBenchmarks as any[]) {
        const model = b.model || 'unknown';
        if (!modelStats[model]) modelStats[model] = { tps_sum: 0, count: 0, best_tps: 0 };
        const tps = b.tokens_per_second || 0;
        modelStats[model].tps_sum += tps;
        modelStats[model].count++;
        if (tps > modelStats[model].best_tps) modelStats[model].best_tps = tps;
    }

    const leaderboard = Object.entries(modelStats)
        .map(([model, stats]) => ({
            model,
            avg_tps: Math.round((stats.tps_sum / stats.count) * 10) / 10,
            best_tps: Math.round(stats.best_tps * 10) / 10,
            benchmark_count: stats.count,
        }))
        .sort((a, b) => b.avg_tps - a.avg_tps);

    return c.json({ leaderboard, count: leaderboard.length });
});

// =============================================================================
// Wave 605b: Fine-Tuning Jobs API
// POST /api/v1/finetune/jobs — create a fine-tune job
// GET  /api/v1/finetune/jobs — list fine-tune jobs
// GET  /api/v1/finetune/jobs/:id — get job status
// DELETE /api/v1/finetune/jobs/:id — cancel job
// =============================================================================

interface FinetuneJob {
    id: string;
    model: string;
    node_id: string;
    data_path: string;
    method: 'lora' | 'full' | 'qlora';
    epochs: number;
    lr: number;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    output_model?: string;
    error?: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
}

const finetuneJobs = new Map<string, FinetuneJob>();

modelMgmt.get('/api/v1/finetune/jobs', (c) => {
    const jobs = Array.from(finetuneJobs.values());
    return c.json({ jobs, count: jobs.length });
});

modelMgmt.get('/api/v1/finetune/jobs/:id', (c) => {
    const job = finetuneJobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'Job not found' }, 404);
    return c.json({ job });
});

modelMgmt.post('/api/v1/finetune/jobs', async (c) => {
    const body = await c.req.json() as { model: string; node_id: string; data_path: string; method?: string; epochs?: number; lr?: number };
    if (!body.model || !body.node_id || !body.data_path) {
        return c.json({ error: 'model, node_id, and data_path required' }, 400);
    }

    const job: FinetuneJob = {
        id: 'ft-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        model: body.model,
        node_id: body.node_id,
        data_path: body.data_path,
        method: (body.method as FinetuneJob['method']) || 'lora',
        epochs: body.epochs || 3,
        lr: body.lr || 2e-4,
        status: 'queued',
        created_at: new Date().toISOString(),
    };
    finetuneJobs.set(job.id, job);

    // Prevent memory leak: cap at 100 jobs, evict oldest completed
    if (finetuneJobs.size > 100) {
        for (const [id, j] of finetuneJobs) {
            if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
                finetuneJobs.delete(id);
                if (finetuneJobs.size <= 80) break;
            }
        }
    }

    // Queue the actual command to the agent
    queueCommand(body.node_id, 'quantize_model', {
        model: body.model,
        lora_train: true,
        data_path: body.data_path,
        epochs: job.epochs,
        lr: job.lr,
    });

    return c.json({ job }, 201);
});

modelMgmt.delete('/api/v1/finetune/jobs/:id', (c) => {
    const id = c.req.param('id');
    const job = finetuneJobs.get(id);
    if (!job) return c.json({ error: 'Job not found' }, 404);
    if (job.status === 'completed' || job.status === 'failed') {
        return c.json({ error: 'Job already finished' }, 400);
    }
    job.status = 'cancelled';
    return c.json({ message: 'Job cancelled', job });
});

export default modelMgmt;
