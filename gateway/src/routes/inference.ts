/**
 * Inference routes — OpenAI-compatible and Anthropic Messages API
 * /v1/chat/completions, /v1/completions, /v1/messages, /v1/embeddings, /v1/models
 * Also: audio transcription, TTS, image generation, audio translation
 */
import { Hono } from 'hono';
import { createHash } from 'crypto';
import {
    getClusterModels,
    findBestNode,
    findNodesForModel,
    resolveModelAlias,
    getAllModelAliases,
    estimateModelVram,
    recordRouteResult,
    logInferenceRequest,
    getCachedResponse,
    cacheResponse,
    getStickyNode,
    setStickyNode,
    getNode,
} from '../db';
import { checkChatRateLimit, CHAT_RATE_LIMIT, getQueueStats, MAX_QUEUE_DEPTH } from '../shared';

const INFERENCE_TIMEOUT_MS = 120_000; // 2 min — long enough for slow models

async function fetchWithTimeout(url: string, body: unknown, timeoutMs = INFERENCE_TIMEOUT_MS): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
}

const routes = new Hono();

// =============================================================================
// OpenAI Models list (enhanced)
// =============================================================================

routes.get('/v1/models', (c) => {
    const models = getClusterModels();
    const aliases = getAllModelAliases();

    function classifyModelType(modelName: string): string {
        if (/whisper/i.test(modelName)) return 'audio-transcription';
        if (/tts|bark|piper|xtts|coqui|speecht5/i.test(modelName)) return 'audio-tts';
        if (/stable-diffusion|sdxl|sd|comfyui|dall-e|flux|midjourney/i.test(modelName)) return 'image-generation';
        if (/llava|bakllava|moondream|cogvlm|fuyu|obsidian/i.test(modelName)) return 'vision';
        if (/embed|bge|gte|e5|nomic/i.test(modelName)) return 'embedding';
        return 'text-generation';
    }

    return c.json({
        object: 'list',
        data: models.map(m => ({
            id: m.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'tentaclaw-cluster',
            permission: [],
            root: m.model,
            _tentaclaw: {
                node_count: m.node_count,
                nodes: m.nodes,
                aliases: aliases.filter(a => a.target === m.model).map(a => a.alias),
                estimated_vram_mb: estimateModelVram(m.model),
                type: classifyModelType(m.model),
            },
            parent: null,
        })),
    });
});

// =============================================================================
// Chat completions proxy
// =============================================================================

routes.post('/v1/chat/completions', async (c) => {
    const auth = c.req.header('Authorization');
    const chatRateId = (auth?.startsWith('Bearer ') ? auth.slice(7) : null) || c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'anon';
    const chatRate = checkChatRateLimit(chatRateId);
    c.header('X-RateLimit-Limit', String(CHAT_RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(chatRate.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(chatRate.resetAt / 1000)));
    if (!chatRate.allowed) {
        const retryAfter = Math.ceil((chatRate.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(Math.max(1, retryAfter)));
        return c.json({
            error: { message: `Rate limit exceeded. ${CHAT_RATE_LIMIT} req/min.`, type: 'rate_limit_error' },
        }, 429);
    }

    const body = await c.req.json();
    const model = body.model;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return c.json({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
    }

    const qStats = getQueueStats();
    if (qStats.active >= MAX_QUEUE_DEPTH) {
        return c.json({ error: { message: 'Cluster is at capacity. Try again shortly.', type: 'rate_limit', queue_depth: qStats.queued } }, 429);
    }

    const hasTools = body.tools && Array.isArray(body.tools) && body.tools.length > 0;
    const hasJsonMode = body.response_format?.type === 'json_object';
    const hasFunctions = body.functions && Array.isArray(body.functions);

    // X-Node-Id header lets callers pin to a specific node (benchmark, testing)
    const pinnedNodeId = c.req.header('x-node-id');

    // Wave 464: task-type routing — caller can hint at task type via header or body field
    const taskType = c.req.header('x-task-type') || body.task_type as string | undefined || undefined;

    // Wave 475: routing priority — cost (lowest power), speed (highest tok/s), balanced (default)
    const rawPriority = c.req.header('x-routing-priority') || body.routing_priority as string | undefined;
    const routingPriority = (rawPriority === 'cost' || rawPriority === 'speed') ? rawPriority : 'balanced';

    // Wave 467: sticky session — x-session-id keeps the user on the same node
    const sessionId = c.req.header('x-session-id');

    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    // Wave 464: if task type is 'code', prefer coder model aliases
    if (taskType === 'code' && resolvedModel === model) {
        const coderAliasNames = ['code-fast', 'code', 'coder', 'code-quality'];
        for (const alias of coderAliasNames) {
            const aliasResolved = resolveModelAlias(alias);
            if (aliasResolved.target !== alias) { resolvedModel = aliasResolved.target; break; }
        }
    }

    const routingOpts = { taskType, priority: routingPriority as 'cost' | 'speed' | 'balanced' };
    let target: import('../db/stats').InferenceTarget | null = null;
    let usedFallback = false;

    if (pinnedNodeId) {
        // Try to find the node in the routing table (model loaded)
        target = findNodesForModel(resolvedModel, routingOpts).find(n => n.node_id === pinnedNodeId) ?? null;
        // Fallback: build target from node registration even if model not in loaded_models
        // (Ollama will auto-load from its model store)
        if (!target) {
            const nodeRow = getNode(pinnedNodeId);
            if (nodeRow) {
                // Allow routing to any registered node — even offline ones (benchmark/direct test use)
                const stats = nodeRow.latest_stats as any;
                const backend = stats?.backend;
                target = {
                    node_id: nodeRow.id,
                    hostname: nodeRow.hostname,
                    ip_address: nodeRow.ip_address,
                    gpu_utilization_avg: 0,
                    in_flight_requests: 0,
                    backend_type: backend?.type || 'ollama',
                    backend_port: backend?.port || 11434,
                };
            }
        }
    } else if (sessionId) {
        // Wave 467: sticky session — try to route to the same node as last time
        const stickyNodeId = getStickyNode(sessionId);
        if (stickyNodeId) {
            target = findNodesForModel(resolvedModel, routingOpts).find(n => n.node_id === stickyNodeId) ?? null;
        }
        if (!target) target = findBestNode(resolvedModel, routingOpts);
    } else {
        target = findBestNode(resolvedModel, routingOpts);
    }

    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback, routingOpts);
            if (target) {
                resolvedModel = fallback;
                usedFallback = true;
                break;
            }
        }
    }

    // Wave 467: persist sticky session after routing decision
    if (sessionId && target) {
        setStickyNode(sessionId, target.node_id);
    }

    if (!target) {
        return c.json({
            error: {
                message: 'No online node has model "' + model + '"' + (model !== resolvedModel ? ' (resolved to "' + resolvedModel + '")' : '') + '. Deploy it first.',
                type: 'model_not_found',
                available_models: getClusterModels().map(m => m.model),
                aliases: model !== resolvedModel ? { requested: model, resolved: resolvedModel, fallbacks: resolved.fallbacks } : undefined,
            },
        }, 503);
    }

    if (!body.stream) {
        const cacheKey = createHash('sha256').update(JSON.stringify({ model: resolvedModel, messages: body.messages })).digest('hex');
        const noCache = c.req.header('Cache-Control') === 'no-cache';

        if (!noCache) {
            const cached = getCachedResponse(cacheKey);
            if (cached) {
                const result = JSON.parse(cached.response);
                result._tentaclaw = { cached: true, tokens_saved: cached.tokens_saved };
                return c.json(result);
            }
        }
    }

    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: body.messages,
        stream: body.stream || false,
    };
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.max_tokens !== undefined) proxyBody.max_tokens = body.max_tokens;
    if (body.stop) proxyBody.stop = body.stop;
    if (body.seed !== undefined) proxyBody.seed = body.seed;
    if (body.frequency_penalty !== undefined) proxyBody.frequency_penalty = body.frequency_penalty;
    if (body.presence_penalty !== undefined) proxyBody.presence_penalty = body.presence_penalty;
    if (body.n !== undefined) proxyBody.n = body.n;
    if (hasTools) proxyBody.tools = body.tools;
    if (body.tool_choice) proxyBody.tool_choice = body.tool_choice;
    if (hasFunctions) proxyBody.functions = body.functions;
    if (body.function_call) proxyBody.function_call = body.function_call;
    if (hasJsonMode) proxyBody.response_format = body.response_format;
    if (body.logprobs !== undefined) proxyBody.logprobs = body.logprobs;
    if (body.top_logprobs !== undefined) proxyBody.top_logprobs = body.top_logprobs;
    const startTime = Date.now();

    // Failover loop — try all candidates in score order until one succeeds
    const candidates = [target, ...findNodesForModel(resolvedModel).filter((n: { node_id: string }) => n.node_id !== target.node_id)];
    let lastErr = '';

    for (const candidate of candidates) {
        const candidatePort = candidate.backend_port || 11434;
        const candidateUrl = 'http://' + (candidate.ip_address || candidate.hostname) + ':' + candidatePort + '/v1/chat/completions';

        try {
            const proxyReq = await fetchWithTimeout(candidateUrl, proxyBody);

            const latencyMs = Date.now() - startTime;
            recordRouteResult(candidate.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(candidate.node_id, resolvedModel, latencyMs, proxyReq.ok);

            if (body.stream) {
                return new Response(proxyReq.body, {
                    status: proxyReq.status,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'X-TentaCLAW-Node': candidate.node_id,
                        'X-TentaCLAW-Hostname': candidate.hostname,
                        'X-TentaCLAW-Latency': String(latencyMs),
                    },
                });
            }

            if (!proxyReq.ok) {
                const errText = await proxyReq.text();
                lastErr = `Backend returned ${proxyReq.status}: ${errText.slice(0, 200)}`;
                console.warn(`[failover] Node ${candidate.hostname} returned ${proxyReq.status} — trying next`);
                continue;
            }

            const result = await proxyReq.json() as Record<string, unknown>;

            // Some backends return 200 with an error object
            if (result.error) {
                lastErr = `Backend returned error: ${JSON.stringify(result.error).slice(0, 200)}`;
                console.warn(`[failover] Node ${candidate.hostname} returned error in body — trying next`);
                continue;
            }

            result._tentaclaw = {
                routed_to: candidate.node_id,
                hostname: candidate.hostname,
                gpu_utilization: candidate.gpu_utilization_avg,
                latency_ms: latencyMs,
                resolved_model: resolvedModel,
                alias_used: model !== resolvedModel ? model : undefined,
                fallback_used: usedFallback ? resolvedModel : undefined,
                failover_from: candidate.node_id !== target.node_id ? target.node_id : undefined,
                backend: candidate.backend_type,
                cached: false,
                tools_used: hasTools || undefined,
                json_mode: hasJsonMode || undefined,
                task_type: taskType || undefined,              // Wave 464
                routing_priority: routingPriority !== 'balanced' ? routingPriority : undefined, // Wave 475
                sticky_session: sessionId ? true : undefined,  // Wave 467
            };

            const cacheKey = createHash('sha256').update(JSON.stringify({ model: resolvedModel, messages: body.messages })).digest('hex');
            const usage = (result as any).usage;
            cacheResponse(cacheKey, resolvedModel, JSON.stringify(body.messages).slice(0, 100), JSON.stringify(result), (usage?.total_tokens) || 0);

            return c.json(result);

        } catch (err: any) {
            lastErr = err.message;
            recordRouteResult(candidate.node_id, resolvedModel, Date.now() - startTime, false);
            logInferenceRequest(candidate.node_id, resolvedModel, Date.now() - startTime, false, 0, 0, err.message);
            console.warn(`[failover] Node ${candidate.hostname} failed (${err.message}) — trying next`);
        }
    }

    return c.json({
        error: {
            message: `All ${candidates.length} node(s) with "${resolvedModel}" failed. Last error: ${lastErr}`,
            type: 'proxy_error',
            nodes_tried: candidates.map(n => n.node_id),
        },
    }, 502);
});

// =============================================================================
// Completions (legacy)
// =============================================================================

routes.post('/v1/completions', async (c) => {
    const body = await c.req.json();
    const model = body.model;
    if (!model) return c.json({ error: { message: 'model is required' } }, 400);

    const target = findBestNode(model);
    if (!target) return c.json({ error: { message: 'No node has model "' + model + '" loaded' } }, 503);

    const completionsPort = target.backend_port || 11434;
    const completionsUrl = 'http://' + (target.ip_address || target.hostname) + ':' + completionsPort + '/v1/completions';
    try {
        const proxyReq = await fetch(completionsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (body.stream) {
            return new Response(proxyReq.body, {
                status: proxyReq.status,
                headers: { 'Content-Type': 'text/event-stream', 'X-TentaCLAW-Node': target.node_id },
            });
        }
        const result = await proxyReq.json() as Record<string, unknown>;
        result._tentaclaw = { routed_to: target.node_id, hostname: target.hostname };
        return c.json(result, proxyReq.status as any);
    } catch (err: any) {
        return c.json({ error: { message: 'Proxy failed: ' + err.message } }, 502);
    }
});

// =============================================================================
// Anthropic Messages API
// =============================================================================

const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
    'claude-3-opus-20240229': 'claude-3-opus',
    'claude-3-5-opus-20250218': 'claude-3-opus',
    'claude-3-sonnet-20240229': 'claude-3-sonnet',
    'claude-3-5-sonnet-20240620': 'claude-3-sonnet',
    'claude-3-5-sonnet-20241022': 'claude-3-sonnet',
    'claude-3-haiku-20240307': 'claude-3-haiku',
    'claude-3-5-haiku-20241022': 'claude-3-haiku',
    'claude-4-opus-20250514': 'claude-3-opus',
    'claude-4-sonnet-20250514': 'claude-3-sonnet',
};

function resolveAnthropicModel(model: string): { target: string; fallbacks: string[]; originalModel: string } {
    const baseAlias = ANTHROPIC_MODEL_ALIASES[model] || model;
    const resolved = resolveModelAlias(baseAlias);
    return { target: resolved.target, fallbacks: resolved.fallbacks, originalModel: model };
}

function convertAnthropicToOpenAIMessages(
    messages: Array<{ role: string; content: unknown }>,
    system?: string | Array<{ type: string; text: string }>,
): Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> {
    const result: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> = [];

    if (system) {
        const systemText = typeof system === 'string'
            ? system
            : system.map(b => b.text).join('\n');
        result.push({ role: 'system', content: systemText });
    }

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            result.push({ role: msg.role, content: msg.content });
            continue;
        }

        if (Array.isArray(msg.content)) {
            const blocks = msg.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }>;

            if (msg.role === 'user' && blocks.some(b => b.type === 'tool_result')) {
                for (const block of blocks) {
                    if (block.type === 'tool_result') {
                        const toolContent = typeof block.content === 'string'
                            ? block.content
                            : Array.isArray(block.content)
                                ? (block.content as Array<{ text?: string }>).map(c => c.text || '').join('\n')
                                : JSON.stringify(block.content);
                        result.push({
                            role: 'tool',
                            content: toolContent,
                            tool_call_id: block.tool_use_id || '',
                        });
                    } else if (block.type === 'text' && block.text) {
                        result.push({ role: 'user', content: block.text });
                    }
                }
                continue;
            }

            if (msg.role === 'assistant' && blocks.some(b => b.type === 'tool_use')) {
                const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
                const toolCalls = blocks
                    .filter(b => b.type === 'tool_use')
                    .map(b => ({
                        id: b.id || 'call_' + Math.random().toString(36).slice(2, 12),
                        type: 'function' as const,
                        function: {
                            name: b.name || '',
                            arguments: JSON.stringify(b.input || {}),
                        },
                    }));
                result.push({
                    role: 'assistant',
                    content: textParts || null,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                });
                continue;
            }

            const text = blocks.map(b => b.text || '').join('');
            result.push({ role: msg.role, content: text });
            continue;
        }

        result.push({ role: msg.role, content: String(msg.content) });
    }

    return result;
}

function convertAnthropicToolsToOpenAI(tools?: Array<{ name: string; description?: string; input_schema?: unknown }>): Array<{ type: string; function: { name: string; description: string; parameters: unknown } }> | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description || '',
            parameters: t.input_schema || { type: 'object', properties: {} },
        },
    }));
}

function generateMsgId(): string {
    return 'msg_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}

function anthropicError(type: string, message: string, status: number) {
    return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function convertToAnthropicResponse(
    openaiResult: Record<string, unknown>,
    requestModel: string,
): Record<string, unknown> {
    const choice = ((openaiResult.choices as any[])?.[0]) || {};
    const message = choice.message || {};
    const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];

    if (message.content) {
        content.push({ type: 'text', text: message.content });
    }

    if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id || 'toolu_' + Math.random().toString(36).slice(2, 12),
                name: tc.function?.name || '',
                input: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
            });
        }
    }

    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }

    let stopReason: string = 'end_turn';
    if (choice.finish_reason === 'stop') stopReason = 'end_turn';
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    else if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';

    const usage = openaiResult.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    return {
        id: generateMsgId(),
        type: 'message',
        role: 'assistant',
        content,
        model: requestModel,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: usage?.prompt_tokens || 0,
            output_tokens: usage?.completion_tokens || 0,
        },
    };
}

routes.post('/v1/messages', async (c) => {
    const body = await c.req.json();

    if (!body.model) {
        return anthropicError('invalid_request_error', 'model is required', 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return anthropicError('invalid_request_error', 'messages array is required', 400);
    }
    if (body.max_tokens === undefined) {
        return anthropicError('invalid_request_error', 'max_tokens is required', 400);
    }

    const qStats = getQueueStats();
    if (qStats.active >= MAX_QUEUE_DEPTH) {
        return anthropicError('overloaded_error', 'Cluster is at capacity. Try again shortly.', 529);
    }

    const resolved = resolveAnthropicModel(body.model);
    let resolvedModel = resolved.target;

    let target = findBestNode(resolvedModel);
    let usedFallback = false;

    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback);
            if (target) {
                resolvedModel = fallback;
                usedFallback = true;
                break;
            }
        }
    }

    if (!target) {
        return anthropicError(
            'not_found_error',
            'Model "' + body.model + '" is not available' +
            (body.model !== resolvedModel ? ' (resolved to "' + resolvedModel + '")' : '') +
            '. Deploy it first.',
            404,
        );
    }

    const openaiMessages = convertAnthropicToOpenAIMessages(body.messages, body.system);
    const openaiTools = convertAnthropicToolsToOpenAI(body.tools);

    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: openaiMessages,
        stream: false,
        max_tokens: body.max_tokens,
    };
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.top_k !== undefined) proxyBody.top_k = body.top_k;
    if (body.stop_sequences) proxyBody.stop = body.stop_sequences;
    if (openaiTools) proxyBody.tools = openaiTools;
    if (body.tool_choice) {
        if (body.tool_choice.type === 'auto') proxyBody.tool_choice = 'auto';
        else if (body.tool_choice.type === 'any') proxyBody.tool_choice = 'required';
        else if (body.tool_choice.type === 'tool') {
            proxyBody.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
        }
    }

    const backendPort = target.backend_port || 11434;
    const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
    const startTime = Date.now();

    // --- Streaming path ---
    if (body.stream === true) {
        proxyBody.stream = true;

        try {
            const proxyReq = await fetchWithTimeout(backendUrl, proxyBody);

            const latencyMs = Date.now() - startTime;
            recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

            if (!proxyReq.ok || !proxyReq.body) {
                return anthropicError('api_error', 'Backend returned status ' + proxyReq.status, 502);
            }

            const msgId = generateMsgId();

            const reader = proxyReq.body.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let buffer = '';
            let inputTokens = 0;
            let outputTokens = 0;

            const stream = new ReadableStream({
                async start(controller) {
                    const messageStart = {
                        type: 'message_start',
                        message: {
                            id: msgId, type: 'message', role: 'assistant', content: [],
                            model: body.model, stop_reason: null, stop_sequence: null,
                            usage: { input_tokens: 0, output_tokens: 0 },
                        },
                    };
                    controller.enqueue(encoder.encode('event: message_start\ndata: ' + JSON.stringify(messageStart) + '\n\n'));

                    const blockStart = {
                        type: 'content_block_start', index: 0,
                        content_block: { type: 'text', text: '' },
                    };
                    controller.enqueue(encoder.encode('event: content_block_start\ndata: ' + JSON.stringify(blockStart) + '\n\n'));

                    try {
                        let doneReading = false;
                        while (!doneReading) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (!line.startsWith('data: ')) continue;
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') {
                                    doneReading = true;
                                    break;
                                }

                                try {
                                    const chunk = JSON.parse(data);
                                    const delta = chunk.choices?.[0]?.delta;
                                    if (!delta) continue;

                                    if (delta.content) {
                                        const blockDelta = {
                                            type: 'content_block_delta', index: 0,
                                            delta: { type: 'text_delta', text: delta.content },
                                        };
                                        controller.enqueue(encoder.encode('event: content_block_delta\ndata: ' + JSON.stringify(blockDelta) + '\n\n'));
                                    }

                                    if (chunk.usage) {
                                        inputTokens = chunk.usage.prompt_tokens || inputTokens;
                                        outputTokens = chunk.usage.completion_tokens || outputTokens;
                                    }
                                } catch {}
                            }
                        }
                    } catch {}

                    controller.enqueue(encoder.encode('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n'));

                    const messageDelta = {
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn', stop_sequence: null },
                        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
                    };
                    controller.enqueue(encoder.encode('event: message_delta\ndata: ' + JSON.stringify(messageDelta) + '\n\n'));

                    controller.enqueue(encoder.encode('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n'));

                    controller.close();
                },
            });

            return new Response(stream, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-TentaCLAW-Node': target.node_id,
                    'X-TentaCLAW-Hostname': target.hostname,
                },
            });
        } catch (err: any) {
            recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
            logInferenceRequest(target.node_id, resolvedModel, Date.now() - startTime, false, 0, 0, err.message);
            return anthropicError('api_error', 'Failed to proxy to node ' + target.hostname + ': ' + err.message, 502);
        }
    }

    // --- Non-streaming path — failover loop ---
    const msgCandidates = [target, ...findNodesForModel(resolvedModel).filter((n: { node_id: string }) => n.node_id !== target.node_id)];
    let msgLastErr = '';

    for (const candidate of msgCandidates) {
        const candidatePort = candidate.backend_port || 11434;
        const candidateUrl = 'http://' + (candidate.ip_address || candidate.hostname) + ':' + candidatePort + '/v1/chat/completions';

        try {
            const proxyReq = await fetchWithTimeout(candidateUrl, proxyBody);

            const latencyMs = Date.now() - startTime;
            recordRouteResult(candidate.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(candidate.node_id, resolvedModel, latencyMs, proxyReq.ok);

            if (!proxyReq.ok) {
                const errBody = await proxyReq.text();
                return anthropicError('api_error', 'Backend error: ' + errBody, proxyReq.status);
            }

            const openaiResult = await proxyReq.json() as Record<string, unknown>;
            const anthropicResult = convertToAnthropicResponse(openaiResult, body.model);

            (anthropicResult as any)._tentaclaw = {
                routed_to: candidate.node_id,
                hostname: candidate.hostname,
                gpu_utilization: candidate.gpu_utilization_avg,
                latency_ms: latencyMs,
                resolved_model: resolvedModel,
                alias_used: body.model !== resolvedModel ? body.model : undefined,
                fallback_used: usedFallback ? resolvedModel : undefined,
                failover_from: candidate.node_id !== target.node_id ? target.node_id : undefined,
                backend: candidate.backend_type,
            };

            return c.json(anthropicResult);

        } catch (err: any) {
            msgLastErr = err.message;
            recordRouteResult(candidate.node_id, resolvedModel, Date.now() - startTime, false);
            logInferenceRequest(candidate.node_id, resolvedModel, Date.now() - startTime, false, 0, 0, err.message);
            console.warn(`[failover] Node ${candidate.hostname} failed (${err.message}) — trying next`);
        }
    }

    return anthropicError('api_error', `All ${msgCandidates.length} node(s) failed. Last error: ${msgLastErr}`, 502);
});

// =============================================================================
// Embeddings
// =============================================================================

routes.post('/v1/embeddings', async (c) => {
    const body = await c.req.json();
    const model = body.model || 'nomic-embed-text';
    const input = body.input;

    if (!input) return c.json({ error: { message: 'input is required', type: 'invalid_request_error' } }, 400);

    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    let target = findBestNode(resolvedModel);
    if (!target && resolved.fallbacks.length > 0) {
        for (const fb of resolved.fallbacks) {
            target = findBestNode(fb);
            if (target) { resolvedModel = fb; break; }
        }
    }
    if (!target) {
        return c.json({ error: { message: 'No node has embedding model "' + model + '" loaded. Available: nomic-embed-text, all-minilm' } }, 503);
    }

    const embedPort = target.backend_port || 11434;
    const embedUrl = 'http://' + (target.ip_address || target.hostname) + ':' + embedPort + '/v1/embeddings';
    const startTime = Date.now();

    const inputs = Array.isArray(input) ? input : [input];

    try {
        const allEmbeddings: any[] = [];
        let globalIdx = 0;
        for (let i = 0; i < inputs.length; i += 32) {
            const batch = inputs.slice(i, i + 32);
            try {
                const proxyReq = await fetchWithTimeout(embedUrl, { model: resolvedModel, input: batch }, 30_000);
                const result = await proxyReq.json() as any;
                if (result.data && Array.isArray(result.data)) {
                    for (const item of result.data) {
                        allEmbeddings.push({
                            object: 'embedding',
                            embedding: item.embedding,
                            index: globalIdx++,
                        });
                    }
                }
            } catch {
                for (let j = 0; j < batch.length; j++) {
                    allEmbeddings.push({
                        object: 'embedding',
                        embedding: [],
                        index: globalIdx++,
                    });
                }
            }
        }

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, true);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, true, inputs.length, 0);

        const estimatedTokens = inputs.reduce((s: number, t: string) => s + Math.ceil(t.length / 4), 0);
        return c.json({
            object: 'list',
            data: allEmbeddings,
            model: resolvedModel,
            usage: { prompt_tokens: estimatedTokens, total_tokens: estimatedTokens },
            _tentaclaw: {
                routed_to: target.node_id,
                hostname: target.hostname,
                batch_size: inputs.length,
                latency_ms: latencyMs,
            },
        });
    } catch (err: any) {
        recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
        return c.json({ error: { message: 'Embedding proxy failed: ' + err.message } }, 502);
    }
});

// =============================================================================
// Multi-Modal: Audio, Image, Translation
// =============================================================================

routes.post('/v1/audio/transcriptions', async (c) => {
    const target = findBestNode('whisper') || findBestNode('whisper:large') || findBestNode('whisper:base');
    if (!target) {
        return c.json({ error: { message: 'No node has a Whisper model loaded. Deploy whisper first.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/transcriptions';
    try {
        const body = await c.req.arrayBuffer();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': c.req.header('Content-Type') || 'multipart/form-data' },
            body,
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Audio proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

routes.post('/v1/audio/speech', async (c) => {
    const target = findBestNode('tts') || findBestNode('bark') || findBestNode('piper');
    if (!target) {
        return c.json({ error: { message: 'No node has a TTS model loaded.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/speech';
    try {
        const body = await c.req.json();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'TTS proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

routes.post('/v1/images/generations', async (c) => {
    let body: Record<string, unknown>;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    if (!body.prompt || typeof body.prompt !== 'string' || (body.prompt as string).trim().length === 0) {
        return c.json({ error: { message: 'prompt is required and must be a non-empty string', type: 'invalid_request_error' } }, 400);
    }

    const target = findBestNode('stable-diffusion') || findBestNode('sdxl') || findBestNode('sd') || findBestNode('comfyui') || findBestNode('dall-e');
    if (!target) {
        return c.json({
            error: {
                message: 'No node has an image generation model loaded. Deploy stable-diffusion, sdxl, or a ComfyUI workflow first.',
                type: 'model_not_found',
                available_models: getClusterModels().map(m => m.model),
            },
        }, 503);
    }

    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/images/generations';
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: body.model || 'stable-diffusion',
                prompt: body.prompt,
                n: body.n || 1,
                size: body.size || '1024x1024',
                quality: body.quality || 'standard',
            }),
        });
        return new Response(res.body, {
            status: res.status,
            headers: { 'Content-Type': 'application/json', 'X-TentaCLAW-Node': target.node_id },
        });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Image generation proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

routes.get('/v1/audio/models', (c) => {
    const models = getClusterModels();
    const audioModels = models.filter(m =>
        /whisper|tts|bark|piper|xtts|coqui|speecht5/i.test(m.model)
    );
    return c.json({
        object: 'list',
        data: audioModels.map(m => ({
            id: m.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'tentaclaw-cluster',
            type: /whisper/i.test(m.model) ? 'transcription' : 'tts',
            _tentaclaw: { node_count: m.node_count, nodes: m.nodes },
        })),
    });
});

routes.post('/v1/audio/translate', async (c) => {
    const target = findBestNode('whisper') || findBestNode('whisper:large') || findBestNode('whisper:base');
    if (!target) {
        return c.json({ error: { message: 'No node has a Whisper model loaded. Deploy whisper first.', type: 'model_not_found' } }, 503);
    }
    const backendPort = target.backend_port || 11434;
    const url = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/audio/translations';
    try {
        const body = await c.req.arrayBuffer();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': c.req.header('Content-Type') || 'multipart/form-data' },
            body,
        });
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'X-TentaCLAW-Node': target.node_id } });
    } catch (err: unknown) {
        return c.json({ error: { message: 'Audio translation proxy failed: ' + (err instanceof Error ? err.message : String(err)) } }, 502);
    }
});

export default routes;
