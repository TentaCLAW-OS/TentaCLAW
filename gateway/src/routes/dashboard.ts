/**
 * Dashboard routes — SSE events, Daphney bridge, static file serving
 */
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import {
    getAllNodes,
    getClusterSummary,
    findBestNode,
    recordRouteResult,
    getClusterModels,
    getRequestStats,
    getHealthScore,
    getClusterPower,
    getFleetReliability,
    getCacheStats,
    getInferenceAnalytics,
    insertPlaygroundHistory,
    getPlaygroundHistory,
    resolveModelAlias,
    logInferenceRequest,
} from '../db';
import { sseClients, daphneyClients, broadcastSSE, broadcastDaphney, log, getQueueStats, type SSEClient } from '../shared';

const routes = new Hono();

// =============================================================================
// SSE Endpoint
// =============================================================================

routes.get('/api/v1/events', (_c) => {
    const stream = new ReadableStream({
        start(controller) {
            const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const client: SSEClient = { id: clientId, controller };
            sseClients.push(client);

            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ client_id: clientId })}\n\n`));
        },
        cancel() {
            // Client disconnected — cleanup happens in broadcastSSE
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        },
    });
});

// =============================================================================
// Daphney Bridge
// =============================================================================

routes.get('/api/v1/daphney/stream', (_c) => {
    const stream = new ReadableStream({
        start(controller) {
            const client: SSEClient = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                controller,
            };
            daphneyClients.push(client);

            const summary = getClusterSummary();
            const allNodes = getAllNodes();
            const payload = `event: cluster_topology\ndata: ${JSON.stringify({
                type: 'cluster_topology',
                timestamp: new Date().toISOString(),
                topology: {
                    total_nodes: summary.total_nodes,
                    online_nodes: summary.online_nodes,
                    total_gpus: summary.total_gpus,
                    nodes: allNodes.map(n => ({
                        id: n.id,
                        hostname: n.hostname,
                        status: n.status,
                        gpu_count: n.gpu_count,
                        farm_hash: n.farm_hash,
                    })),
                },
            })}\n\n`;
            controller.enqueue(new TextEncoder().encode(payload));
        },
        cancel() {},
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
});

// Daphney Character Registry
interface DaphneyCharacter {
    name: string;
    model: string;
    personality: string;
    voice: string;
    emotions: string[];
}

const daphneyCharacters = new Map<string, DaphneyCharacter>();

const DAPHNEY_SUPPORTED_EVENTS = [
    'character_loaded', 'animation_complete', 'player_interaction',
    'scene_change', 'emotion_change', 'voice_complete', 'error',
] as const;

routes.post('/api/v1/daphney/event', async (c) => {
    const body = await c.req.json<{ type: string; character_id?: string; data: unknown }>().catch(() => null);
    if (!body || !body.type) {
        return c.json({ error: 'Missing required field: type' }, 400);
    }
    if (!body.data) {
        return c.json({ error: 'Missing required field: data' }, 400);
    }

    const event = {
        type: body.type,
        character_id: body.character_id ?? null,
        data: body.data,
        received_at: new Date().toISOString(),
    };

    log('info', `Daphney UE5 event received: ${body.type}`, { character_id: body.character_id });

    broadcastSSE('daphney_event', event);
    broadcastDaphney('ue5_event', event);

    return c.json({ ok: true, event });
});

routes.get('/api/v1/daphney/config', (c) => {
    const summary = getClusterSummary();
    const allNodes = getAllNodes();

    const characters: Record<string, DaphneyCharacter> = {};
    for (const [id, char] of daphneyCharacters) {
        characters[id] = char;
    }

    return c.json({
        stream_url: `/api/v1/daphney/stream`,
        event_url: `/api/v1/daphney/event`,
        chat_url: `/api/v1/daphney/chat`,
        characters_url: `/api/v1/daphney/characters`,
        supported_events: DAPHNEY_SUPPORTED_EVENTS,
        characters,
        cluster_info: {
            total_nodes: summary.total_nodes,
            online_nodes: summary.online_nodes,
            total_gpus: summary.total_gpus,
            nodes: allNodes.map(n => ({
                id: n.id, hostname: n.hostname, status: n.status, gpu_count: n.gpu_count,
            })),
        },
    });
});

routes.post('/api/v1/daphney/chat', async (c) => {
    const body = await c.req.json<{
        character_id: string;
        message: string;
        context?: { location?: string; emotion?: string; time_of_day?: string };
    }>().catch(() => null);

    if (!body || !body.character_id || !body.message) {
        return c.json({ error: 'Missing required fields: character_id, message' }, 400);
    }

    const character = daphneyCharacters.get(body.character_id);
    if (!character) {
        return c.json({ error: `Character not found: ${body.character_id}` }, 404);
    }

    let systemPrompt = character.personality;
    if (body.context) {
        const ctxParts: string[] = [];
        if (body.context.location) ctxParts.push(`Current location: ${body.context.location}`);
        if (body.context.emotion) ctxParts.push(`Current emotion: ${body.context.emotion}`);
        if (body.context.time_of_day) ctxParts.push(`Time of day: ${body.context.time_of_day}`);
        if (ctxParts.length > 0) {
            systemPrompt += `\n\n[Scene Context]\n${ctxParts.join('\n')}`;
        }
    }

    const preferredModel = character.model;
    const targetNode = findBestNode(preferredModel);

    if (!targetNode) {
        return c.json({ error: 'No inference nodes available for model: ' + preferredModel }, 503);
    }

    const nodeIp = targetNode.ip_address || 'localhost';
    const backendPort = targetNode.backend_port || 11434;
    const inferenceUrl = `http://${nodeIp}:${backendPort}/api/chat`;

    try {
        const startTime = Date.now();
        const response = await fetch(inferenceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: preferredModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: body.message },
                ],
                stream: false,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `Inference backend error: ${errText}` }, 502);
        }

        const result = await response.json() as { message?: { content?: string } };
        const latencyMs = Date.now() - startTime;
        const responseText = result.message?.content ?? '';

        const detectedEmotion = detectEmotion(responseText, character.emotions);
        const animationHint = emotionToAnimation(detectedEmotion);

        recordRouteResult(targetNode.node_id, preferredModel, latencyMs, true);

        broadcastDaphney('chat_response', {
            character_id: body.character_id,
            emotion: detectedEmotion,
            timestamp: new Date().toISOString(),
        });

        return c.json({
            response: responseText,
            emotion: detectedEmotion,
            animation_hint: animationHint,
            voice_config: { voice_id: character.voice, emotion: detectedEmotion },
            model_used: preferredModel,
            node_id: targetNode.node_id,
            latency_ms: latencyMs,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: `Failed to reach inference backend: ${message}` }, 502);
    }
});

function detectEmotion(text: string, supportedEmotions: string[]): string {
    const lower = text.toLowerCase();
    const emotionKeywords: Record<string, string[]> = {
        happy: ['happy', 'glad', 'joy', 'excited', 'wonderful', 'great', 'smile', 'laugh'],
        sad: ['sad', 'sorry', 'unfortunately', 'grief', 'miss', 'cry', 'tears'],
        angry: ['angry', 'furious', 'rage', 'hate', 'mad', 'annoyed'],
        surprised: ['surprised', 'wow', 'amazing', 'unexpected', 'shocked', 'astonished'],
        fearful: ['afraid', 'scared', 'fear', 'worried', 'anxious', 'nervous'],
        neutral: [],
        thinking: ['hmm', 'perhaps', 'consider', 'maybe', 'wonder', 'think'],
        playful: ['haha', 'hehe', 'tease', 'joke', 'funny', 'silly'],
    };

    for (const emotion of supportedEmotions) {
        const keywords = emotionKeywords[emotion];
        if (keywords && keywords.some(kw => lower.includes(kw))) {
            return emotion;
        }
    }

    return supportedEmotions.includes('neutral') ? 'neutral' : supportedEmotions[0] || 'neutral';
}

function emotionToAnimation(emotion: string): string {
    const animationMap: Record<string, string> = {
        happy: 'anim_smile_nod', sad: 'anim_look_down', angry: 'anim_cross_arms',
        surprised: 'anim_wide_eyes', fearful: 'anim_step_back', neutral: 'anim_idle',
        thinking: 'anim_hand_chin', playful: 'anim_bounce',
    };
    return animationMap[emotion] || 'anim_idle';
}

routes.post('/api/v1/daphney/characters', async (c) => {
    const body = await c.req.json<{
        id: string; name: string; model: string; personality: string; voice: string; emotions: string[];
    }>().catch(() => null);

    if (!body || !body.id || !body.name || !body.model || !body.personality || !body.voice || !body.emotions) {
        return c.json({ error: 'Missing required fields: id, name, model, personality, voice, emotions' }, 400);
    }

    if (body.emotions.length === 0) {
        return c.json({ error: 'emotions array must contain at least one emotion' }, 400);
    }

    const character: DaphneyCharacter = {
        name: body.name, model: body.model, personality: body.personality,
        voice: body.voice, emotions: body.emotions,
    };

    const isUpdate = daphneyCharacters.has(body.id);
    daphneyCharacters.set(body.id, character);

    log('info', `Daphney character ${isUpdate ? 'updated' : 'registered'}: ${body.name} (${body.id})`);

    broadcastDaphney('character_registered', {
        character_id: body.id, name: body.name, model: body.model,
        timestamp: new Date().toISOString(),
    });

    return c.json({
        ok: true, action: isUpdate ? 'updated' : 'created',
        character_id: body.id, character,
    }, isUpdate ? 200 : 201);
});

routes.get('/api/v1/daphney/characters', (c) => {
    const characters: Record<string, DaphneyCharacter & { id: string }> = {};
    for (const [id, char] of daphneyCharacters) {
        characters[id] = { id, ...char };
    }
    return c.json({ characters, total: daphneyCharacters.size });
});

routes.delete('/api/v1/daphney/characters/:id', (c) => {
    const id = c.req.param('id');
    if (!daphneyCharacters.has(id)) {
        return c.json({ error: `Character not found: ${id}` }, 404);
    }

    const character = daphneyCharacters.get(id)!;
    daphneyCharacters.delete(id);

    log('info', `Daphney character removed: ${character.name} (${id})`);

    broadcastDaphney('character_removed', {
        character_id: id, name: character.name, timestamp: new Date().toISOString(),
    });

    return c.json({ ok: true, character_id: id, name: character.name });
});

// =============================================================================
// Dashboard Data Bundle
// =============================================================================

routes.get('/api/v1/dashboard', (c) => {
    const summary = getClusterSummary();
    const health = getHealthScore();
    const models = getClusterModels();
    const stats = getRequestStats();
    const cacheStats = getCacheStats();
    const power = getClusterPower();
    const fleet = getFleetReliability();
    const qStats = getQueueStats();

    return c.json({
        summary,
        health,
        models: models.slice(0, 20),
        inference: {
            ...stats,
            cache: cacheStats,
            queue: qStats,
        },
        power: {
            total_watts: power.total_watts,
            daily_cost: power.daily_cost,
            monthly_cost: power.monthly_cost,
        },
        fleet: fleet.slice(0, 20),
        timestamp: new Date().toISOString(),
    });
});

// =============================================================================
// Playground
// =============================================================================

routes.post('/api/v1/playground/chat', async (c) => {
    const body = await c.req.json();
    const model = body.model;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.messages || !Array.isArray(body.messages)) {
        return c.json({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
    }

    const resolved = resolveModelAlias(model);
    let resolvedModel = resolved.target;

    let target = findBestNode(resolvedModel);
    if (!target && resolved.fallbacks.length > 0) {
        for (const fallback of resolved.fallbacks) {
            target = findBestNode(fallback);
            if (target) { resolvedModel = fallback; break; }
        }
    }

    if (!target) {
        const available = getClusterModels();
        return c.json({
            error: {
                message: 'No online node has model "' + model + '". Deploy it first or try one of the available models.',
                type: 'model_not_found',
                available_models: available.map(m => ({ name: m.model, nodes: m.node_count })),
            },
        }, 503);
    }

    const proxyBody: Record<string, unknown> = {
        model: resolvedModel,
        messages: body.messages,
        stream: false,
    };
    if (body.system_prompt) {
        proxyBody.messages = [{ role: 'system', content: body.system_prompt }, ...body.messages];
    }
    if (body.temperature !== undefined) proxyBody.temperature = body.temperature;
    if (body.top_p !== undefined) proxyBody.top_p = body.top_p;
    if (body.max_tokens !== undefined) proxyBody.max_tokens = body.max_tokens;

    const backendPort = target.backend_port || 11434;
    const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
    const startTime = Date.now();

    try {
        const proxyReq = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyBody),
        });

        const latencyMs = Date.now() - startTime;
        recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
        logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

        const result = await proxyReq.json() as Record<string, unknown>;
        const usage = (result as any).usage || {};
        const tokensIn = usage.prompt_tokens || 0;
        const tokensOut = usage.completion_tokens || 0;

        const choices = (result as any).choices;
        const responseText = choices?.[0]?.message?.content || '';

        const promptPreview = JSON.stringify(body.messages).slice(0, 100);
        insertPlaygroundHistory({
            model: resolvedModel,
            prompt_preview: promptPreview,
            response_preview: typeof responseText === 'string' ? responseText.slice(0, 200) : '',
            latency_ms: latencyMs,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            node_id: target.node_id,
        });

        return c.json({
            response: result,
            metadata: {
                node: { id: target.node_id, hostname: target.hostname },
                model: resolvedModel,
                latency_ms: latencyMs,
                tokens: { prompt: tokensIn, completion: tokensOut, total: tokensIn + tokensOut },
            },
        });

    } catch (err: any) {
        recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
        return c.json({
            error: {
                message: 'Failed to proxy to node ' + target.hostname + ': ' + err.message,
                type: 'proxy_error',
                node_id: target.node_id,
            },
        }, 502);
    }
});

routes.get('/api/v1/playground/models', (c) => {
    const clusterModels = getClusterModels();
    const stats = getRequestStats();

    const models = clusterModels.map(m => ({
        name: m.model,
        nodes: m.node_count,
        avg_latency_ms: stats.avg_latency_ms,
        ready: m.node_count > 0,
    }));

    return c.json({ models });
});

routes.get('/api/v1/playground/history', (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const history = getPlaygroundHistory(limit);
    return c.json({ history, count: history.length });
});

routes.post('/api/v1/playground/compare', async (c) => {
    const body = await c.req.json();

    if (!body.prompt || typeof body.prompt !== 'string') {
        return c.json({ error: { message: 'prompt string is required', type: 'invalid_request_error' } }, 400);
    }
    if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
        return c.json({ error: { message: 'models array is required and must not be empty', type: 'invalid_request_error' } }, 400);
    }
    if (body.models.length > 5) {
        return c.json({ error: { message: 'Maximum 5 models for comparison', type: 'invalid_request_error' } }, 400);
    }

    const messages = [
        ...(body.system_prompt ? [{ role: 'system' as const, content: body.system_prompt }] : []),
        { role: 'user' as const, content: body.prompt },
    ];

    const promises = body.models.map(async (modelName: string) => {
        const resolved = resolveModelAlias(modelName);
        let resolvedModel = resolved.target;
        let target = findBestNode(resolvedModel);

        if (!target && resolved.fallbacks.length > 0) {
            for (const fallback of resolved.fallbacks) {
                target = findBestNode(fallback);
                if (target) { resolvedModel = fallback; break; }
            }
        }

        if (!target) {
            return { model: modelName, error: 'No online node has this model', response: null, latency_ms: 0, tokens: 0 };
        }

        const backendPort = target.backend_port || 11434;
        const backendUrl = 'http://' + (target.ip_address || target.hostname) + ':' + backendPort + '/v1/chat/completions';
        const startTime = Date.now();

        try {
            const proxyReq = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
            });

            const latencyMs = Date.now() - startTime;
            recordRouteResult(target.node_id, resolvedModel, latencyMs, proxyReq.ok);
            logInferenceRequest(target.node_id, resolvedModel, latencyMs, proxyReq.ok);

            const result = await proxyReq.json() as any;
            const usage = result.usage || {};
            const responseText = result.choices?.[0]?.message?.content || '';

            insertPlaygroundHistory({
                model: resolvedModel,
                prompt_preview: body.prompt.slice(0, 100),
                response_preview: typeof responseText === 'string' ? responseText.slice(0, 200) : '',
                latency_ms: latencyMs,
                tokens_in: usage.prompt_tokens || 0,
                tokens_out: usage.completion_tokens || 0,
                node_id: target.node_id,
            });

            return {
                model: resolvedModel, response: responseText, latency_ms: latencyMs,
                tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
                node: target.hostname,
            };
        } catch (err: any) {
            recordRouteResult(target.node_id, resolvedModel, Date.now() - startTime, false);
            return { model: modelName, error: err.message, response: null, latency_ms: Date.now() - startTime, tokens: 0 };
        }
    });

    const results = await Promise.all(promises);
    return c.json({ results, prompt: body.prompt, compared_at: new Date().toISOString() });
});

// =============================================================================
// Static Dashboard Files
// =============================================================================

routes.use('/dashboard/*', serveStatic({
    root: 'public',
    rewriteRequestPath: (p) => p.replace('/dashboard', ''),
}));

routes.get('/dashboard', (c) => c.redirect('/dashboard/'));

export default routes;
