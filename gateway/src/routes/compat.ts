/**
 * API Compatibility Routes — Google Gemini, Ollama Native, KoboldAI, Mistral, OpenRouter
 * These translate external API formats into TentaCLAW's internal routing system.
 */
import { Hono } from 'hono';
import {
    getClusterModels,
    findBestNode,
    resolveModelAlias,
    recordRouteResult,
    logInferenceRequest,
} from '../db';

const routes = new Hono();
const INFERENCE_TIMEOUT_MS = 120_000;

async function proxyToNode(nodeIp: string, port: number, path: string, body: unknown): Promise<Response> {
    return fetch(`http://${nodeIp}:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
}

// =============================================================================
// Google Gemini API — /v1beta/models/{model}:generateContent
// Translates Gemini requests into OpenAI format, routes through TentaCLAW
// =============================================================================

routes.post('/v1beta/models/:model\\:generateContent', async (c) => {
    const modelParam = c.req.param('model') || '';
    let body: Record<string, any>;
    try { body = await c.req.json(); } catch {
        return c.json({ error: { code: 400, message: 'Invalid JSON', status: 'INVALID_ARGUMENT' } }, 400);
    }

    // Resolve model — strip "models/" prefix if present
    const modelName = modelParam.replace(/^models\//, '');
    const resolved = resolveModelAlias(modelName);
    const target = findBestNode(resolved.target);

    if (!target) {
        return c.json({
            error: { code: 404, message: `Model "${modelName}" not found in cluster`, status: 'NOT_FOUND',
                available_models: getClusterModels().map(m => m.model) }
        }, 404);
    }

    // Convert Gemini format to OpenAI format
    const contents = body.contents || [];
    const messages: { role: string; content: string }[] = [];

    // System instruction
    if (body.systemInstruction?.parts) {
        messages.push({ role: 'system', content: body.systemInstruction.parts.map((p: any) => p.text).join('\n') });
    }

    // Convert Gemini content parts to OpenAI messages
    for (const content of contents) {
        const role = content.role === 'model' ? 'assistant' : 'user';
        const text = (content.parts || []).map((p: any) => p.text || '').join('\n');
        if (text) messages.push({ role, content: text });
    }

    if (messages.length === 0) {
        return c.json({ error: { code: 400, message: 'contents is required', status: 'INVALID_ARGUMENT' } }, 400);
    }

    // Build proxy request
    const proxyBody: Record<string, any> = {
        model: resolved.target,
        messages,
        stream: false,
    };

    // Map Gemini generation config to OpenAI params
    const genConfig = body.generationConfig || {};
    if (genConfig.temperature !== undefined) proxyBody.temperature = genConfig.temperature;
    if (genConfig.topP !== undefined) proxyBody.top_p = genConfig.topP;
    if (genConfig.maxOutputTokens !== undefined) proxyBody.max_tokens = genConfig.maxOutputTokens;
    if (genConfig.stopSequences) proxyBody.stop = genConfig.stopSequences;

    const startTime = Date.now();
    const port = target.backend_port || 11434;

    try {
        const resp = await proxyToNode(target.ip_address || target.hostname, port, '/v1/chat/completions', proxyBody);
        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolved.target, latencyMs, resp.ok);
        logInferenceRequest(target.node_id, resolved.target, latencyMs, resp.ok);

        if (!resp.ok) {
            const errText = await resp.text();
            return c.json({ error: { code: resp.status, message: errText.slice(0, 300), status: 'INTERNAL' } }, resp.status as any);
        }

        const result = await resp.json() as any;

        // Convert OpenAI response to Gemini format
        const choice = result.choices?.[0];
        return c.json({
            candidates: [{
                content: {
                    parts: [{ text: choice?.message?.content || '' }],
                    role: 'model',
                },
                finishReason: choice?.finish_reason === 'stop' ? 'STOP' : choice?.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP',
                index: 0,
            }],
            usageMetadata: {
                promptTokenCount: result.usage?.prompt_tokens || 0,
                candidatesTokenCount: result.usage?.completion_tokens || 0,
                totalTokenCount: result.usage?.total_tokens || 0,
            },
            modelVersion: resolved.target,
            _tentaclaw: { routed_to: target.node_id, hostname: target.hostname, latency_ms: latencyMs },
        });
    } catch (err) {
        return c.json({ error: { code: 500, message: err instanceof Error ? err.message : String(err), status: 'INTERNAL' } }, 500);
    }
});

// Gemini models list
routes.get('/v1beta/models', (c) => {
    const models = getClusterModels();
    return c.json({
        models: models.map(m => ({
            name: `models/${m.model}`,
            version: '001',
            displayName: m.model,
            description: `TentaCLAW cluster model: ${m.model}`,
            inputTokenLimit: 32768,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
        })),
    });
});

// =============================================================================
// Ollama Native API — /api/generate, /api/chat, /api/tags, /api/show
// Makes TentaCLAW a drop-in replacement for Ollama
// =============================================================================

routes.get('/api/tags', (c) => {
    const models = getClusterModels();
    return c.json({
        models: models.map(m => ({
            name: m.model,
            model: m.model,
            modified_at: new Date().toISOString(),
            size: 0,
            digest: '',
            details: { parent_model: '', format: 'gguf', family: '', families: [], parameter_size: '', quantization_level: '' },
        })),
    });
});

routes.post('/api/chat', async (c) => {
    let body: Record<string, any>;
    try { body = await c.req.json(); } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }

    const model = body.model;
    if (!model) return c.json({ error: 'model is required' }, 400);

    const resolved = resolveModelAlias(model);
    const target = findBestNode(resolved.target);
    if (!target) return c.json({ error: `model "${model}" not found` }, 404);

    // Convert Ollama chat format to OpenAI
    const messages = (body.messages || []).map((m: any) => ({
        role: m.role,
        content: m.content,
    }));

    const proxyBody: Record<string, any> = {
        model: resolved.target,
        messages,
        stream: body.stream ?? false,
    };
    if (body.options?.temperature !== undefined) proxyBody.temperature = body.options.temperature;
    if (body.options?.top_p !== undefined) proxyBody.top_p = body.options.top_p;
    if (body.options?.num_predict !== undefined) proxyBody.max_tokens = body.options.num_predict;

    const startTime = Date.now();
    const port = target.backend_port || 11434;

    try {
        const resp = await proxyToNode(target.ip_address || target.hostname, port, '/v1/chat/completions', proxyBody);
        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolved.target, latencyMs, resp.ok);

        if (body.stream) {
            return new Response(resp.body, { status: resp.status, headers: { 'Content-Type': 'application/x-ndjson' } });
        }

        const result = await resp.json() as any;
        const choice = result.choices?.[0];

        // Convert OpenAI response to Ollama format
        return c.json({
            model: resolved.target,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: choice?.message?.content || '' },
            done: true,
            total_duration: latencyMs * 1_000_000, // ns
            prompt_eval_count: result.usage?.prompt_tokens || 0,
            eval_count: result.usage?.completion_tokens || 0,
            eval_duration: latencyMs * 500_000,
        });
    } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

routes.post('/api/generate', async (c) => {
    let body: Record<string, any>;
    try { body = await c.req.json(); } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }

    const model = body.model;
    if (!model) return c.json({ error: 'model is required' }, 400);

    const resolved = resolveModelAlias(model);
    const target = findBestNode(resolved.target);
    if (!target) return c.json({ error: `model "${model}" not found` }, 404);

    // Convert Ollama generate to OpenAI chat
    const messages: { role: string; content: string }[] = [];
    if (body.system) messages.push({ role: 'system', content: body.system });
    messages.push({ role: 'user', content: body.prompt || '' });

    const proxyBody: Record<string, any> = { model: resolved.target, messages, stream: false };
    if (body.options?.temperature !== undefined) proxyBody.temperature = body.options.temperature;

    const startTime = Date.now();
    const port = target.backend_port || 11434;

    try {
        const resp = await proxyToNode(target.ip_address || target.hostname, port, '/v1/chat/completions', proxyBody);
        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolved.target, latencyMs, resp.ok);

        const result = await resp.json() as any;
        const choice = result.choices?.[0];

        return c.json({
            model: resolved.target,
            created_at: new Date().toISOString(),
            response: choice?.message?.content || '',
            done: true,
            total_duration: latencyMs * 1_000_000,
            eval_count: result.usage?.completion_tokens || 0,
        });
    } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

routes.post('/api/show', async (c) => {
    let body: Record<string, any>;
    try { body = await c.req.json(); } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }
    const models = getClusterModels();
    const found = models.find(m => m.model === body.name || m.model === body.model);
    if (!found) return c.json({ error: 'model not found' }, 404);
    return c.json({
        modelfile: `FROM ${found.model}`,
        parameters: '',
        template: '',
        details: { parent_model: '', format: 'gguf', family: '', families: [], parameter_size: '', quantization_level: '' },
        model_info: {},
    });
});

// =============================================================================
// KoboldAI API — /api/v1/generate, /api/v1/model, /api/v1/config/max_context_length
// Used by SillyTavern, TavernAI, and creative writing tools
// =============================================================================

routes.post('/api/v1/generate', async (c) => {
    let body: Record<string, any>;
    try { body = await c.req.json(); } catch {
        return c.json({ error: { message: 'Invalid JSON' } }, 400);
    }

    const prompt = body.prompt;
    if (!prompt) return c.json({ error: { message: 'prompt is required' } }, 400);

    // KoboldAI doesn't specify model in the request — use whatever's loaded
    const models = getClusterModels();
    const modelName = models[0]?.model;
    if (!modelName) return c.json({ error: { message: 'No models loaded in cluster' } }, 503);

    const resolved = resolveModelAlias(modelName);
    const target = findBestNode(resolved.target);
    if (!target) return c.json({ error: { message: 'No nodes available' } }, 503);

    const messages = [{ role: 'user', content: prompt }];
    const proxyBody: Record<string, any> = { model: resolved.target, messages, stream: false };
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.max_length !== undefined) proxyBody.max_tokens = body.max_length;
    if (body.max_context_length !== undefined) proxyBody.max_tokens = Math.min(body.max_length || 512, body.max_context_length);
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.stop_sequence) proxyBody.stop = body.stop_sequence;
    if (body.rep_pen !== undefined) proxyBody.frequency_penalty = Math.max(0, (body.rep_pen - 1) * 2); // rough mapping

    const startTime = Date.now();
    const port = target.backend_port || 11434;

    try {
        const resp = await proxyToNode(target.ip_address || target.hostname, port, '/v1/chat/completions', proxyBody);
        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolved.target, latencyMs, resp.ok);

        const result = await resp.json() as any;
        const text = result.choices?.[0]?.message?.content || '';

        // KoboldAI response format
        return c.json({ results: [{ text }] });
    } catch (err) {
        return c.json({ error: { message: err instanceof Error ? err.message : String(err) } }, 500);
    }
});

routes.get('/api/v1/model', (c) => {
    const models = getClusterModels();
    return c.json({ result: models[0]?.model || 'none' });
});

routes.get('/api/v1/config/max_context_length', (c) => {
    return c.json({ value: 32768 });
});

routes.get('/api/v1/config/max_length', (c) => {
    return c.json({ value: 8192 });
});

// KoboldAI version — some clients check this
routes.get('/api/extra/version', (c) => {
    return c.json({ result: 'TentaCLAW', version: '1.0.0' });
});

// =============================================================================
// Mistral API — /v1/chat/completions (same as OpenAI with minor differences)
// Already handled by the existing OpenAI endpoint, but Mistral-specific
// features like safe_prompt need handling
// =============================================================================

// Mistral uses the same /v1/chat/completions but adds:
// - safe_prompt: boolean (wraps system prompt in safety template)
// - response_format: { type: "json_object" } (same as OpenAI)
// - tool_choice: "auto" | "any" | "none" | { type: "function", function: { name: "..." } }
// This is already handled by the existing OpenAI-compatible route.
// No additional routes needed — just document that Mistral clients work out of the box.

// =============================================================================
// OpenRouter Compatibility
// OpenRouter uses standard OpenAI format with model names like "meta-llama/llama-3.1-70b-instruct"
// TentaCLAW already handles this via model aliasing.
// Add an /api/v1/auth/key endpoint that OpenRouter clients check.
// =============================================================================

routes.get('/api/v1/auth/key', (c) => {
    return c.json({
        data: {
            label: 'TentaCLAW Cluster',
            usage: 0,
            limit: null,
            is_free_tier: true,
            rate_limit: { requests: 60, interval: '1m' },
        },
    });
});

export default routes;
