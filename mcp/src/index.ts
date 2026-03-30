#!/usr/bin/env node
/**
 * TentaCLAW MCP Server
 *
 * Model Context Protocol bridge that lets AI agents (Claude, Cursor, etc.)
 * manage TentaCLAW clusters via tool calls.
 *
 * Zero dependencies — pure Node.js HTTP server + fetch().
 *
 * CLAWtopus says: "Eight arms, infinite tool calls."
 */

import http from 'http';

// =============================================================================
// Configuration
// =============================================================================

const GATEWAY_URL = (process.env.TENTACLAW_GATEWAY || 'http://localhost:8080').replace(/\/$/, '');
const MCP_PORT = parseInt(process.env.MCP_PORT || '3100');
const MCP_HOST = process.env.MCP_HOST || '127.0.0.1';

// =============================================================================
// Gateway Client — all calls go through here
// =============================================================================

interface GatewayResponse {
    status: number;
    data: unknown;
    ok: boolean;
}

async function gatewayFetch(
    path: string,
    options: { method?: string; body?: unknown } = {}
): Promise<GatewayResponse> {
    const url = GATEWAY_URL + path;
    const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
    };
    if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
    }

    try {
        const res = await fetch(url, fetchOptions);
        const data = await res.json();
        return { status: res.status, data, ok: res.ok };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            status: 0,
            data: { error: `Failed to reach TentaCLAW gateway at ${url}: ${message}` },
            ok: false,
        };
    }
}

// =============================================================================
// Tool Definitions
// =============================================================================

interface ToolParameter {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
}

interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, ToolParameter>;
    handler: (params: Record<string, unknown>) => Promise<string>;
}

const tools: ToolDefinition[] = [
    // -------------------------------------------------------------------------
    // cluster_status — overview of the entire cluster
    // -------------------------------------------------------------------------
    {
        name: 'cluster_status',
        description:
            'Returns a summary of the TentaCLAW cluster: node count, GPU count, total/used VRAM, ' +
            'loaded models, and aggregate tokens-per-second throughput.',
        parameters: {},
        handler: async () => {
            const res = await gatewayFetch('/api/v1/summary');
            if (!res.ok) return formatError('cluster_status', res);

            const s = res.data as Record<string, unknown>;
            const lines = [
                '=== TentaCLAW Cluster Status ===',
                `Nodes:    ${s.online_nodes}/${s.total_nodes} online`,
                `GPUs:     ${s.total_gpus}`,
                `VRAM:     ${formatMb(s.used_vram_mb as number)} / ${formatMb(s.total_vram_mb as number)} used`,
                `Tok/s:    ${s.total_toks_per_sec}`,
                `Models:   ${(s.loaded_models as string[])?.join(', ') || 'none'}`,
                `Farms:    ${(s.farm_hashes as string[])?.length || 0}`,
            ];
            return lines.join('\n');
        },
    },

    // -------------------------------------------------------------------------
    // list_nodes — all nodes with status and GPU info
    // -------------------------------------------------------------------------
    {
        name: 'list_nodes',
        description:
            'Returns all nodes in the TentaCLAW cluster with their status, hostname, GPU count, ' +
            'loaded models, and performance metrics.',
        parameters: {},
        handler: async () => {
            const res = await gatewayFetch('/api/v1/nodes');
            if (!res.ok) return formatError('list_nodes', res);

            const data = res.data as { nodes: Array<Record<string, unknown>> };
            if (!data.nodes || data.nodes.length === 0) {
                return 'No nodes registered in the cluster.';
            }

            const lines = [`=== TentaCLAW Nodes (${data.nodes.length}) ===`, ''];
            for (const node of data.nodes) {
                const stats = node.latest_stats as Record<string, unknown> | null;
                const gpus = stats?.gpus as Array<Record<string, unknown>> | undefined;
                const inference = stats?.inference as Record<string, unknown> | undefined;
                const models = (inference?.loaded_models as string[]) || [];

                lines.push(`--- ${node.hostname} (${node.id}) ---`);
                lines.push(`  Status:   ${node.status}`);
                lines.push(`  GPUs:     ${node.gpu_count}`);
                if (gpus && gpus.length > 0) {
                    for (let i = 0; i < gpus.length; i++) {
                        const gpu = gpus[i];
                        lines.push(
                            `    GPU ${i}: ${gpu.name} — ${formatMb(gpu.vramUsedMb as number)}/${formatMb(gpu.vramTotalMb as number)} VRAM, ${gpu.temperatureC}°C, ${gpu.utilizationPct}% util`
                        );
                    }
                }
                lines.push(`  Models:   ${models.length > 0 ? models.join(', ') : 'none'}`);
                if (stats) {
                    lines.push(`  Tok/s:    ${stats.toks_per_sec}`);
                    lines.push(`  Uptime:   ${formatSeconds(stats.uptime_secs as number)}`);
                }
                lines.push('');
            }
            return lines.join('\n');
        },
    },

    // -------------------------------------------------------------------------
    // list_models — all models across the cluster
    // -------------------------------------------------------------------------
    {
        name: 'list_models',
        description:
            'Returns all models currently loaded across the TentaCLAW cluster, ' +
            'including which nodes are running each model.',
        parameters: {},
        handler: async () => {
            const res = await gatewayFetch('/api/v1/models');
            if (!res.ok) return formatError('list_models', res);

            const data = res.data as { models: Array<Record<string, unknown>> };
            if (!data.models || data.models.length === 0) {
                return 'No models currently loaded in the cluster.';
            }

            const lines = [`=== Loaded Models (${data.models.length}) ===`, ''];
            for (const m of data.models) {
                const nodes = m.nodes as string[] | undefined;
                lines.push(`  ${m.model}`);
                lines.push(`    Nodes: ${m.node_count} — ${nodes?.join(', ') || 'unknown'}`);
            }
            return lines.join('\n');
        },
    },

    // -------------------------------------------------------------------------
    // deploy_model — deploy a model to the cluster
    // -------------------------------------------------------------------------
    {
        name: 'deploy_model',
        description:
            'Deploys (pulls/installs) a model to TentaCLAW cluster nodes. ' +
            'If node_id is specified, deploys only to that node. Otherwise deploys to all online nodes.',
        parameters: {
            model: {
                type: 'string',
                description: 'The model name to deploy (e.g. "llama3.1:8b", "mistral:7b")',
                required: true,
            },
            node_id: {
                type: 'string',
                description: 'Optional: specific node ID to deploy to. Omit to deploy to all online nodes.',
            },
        },
        handler: async (params) => {
            const model = params.model as string;
            if (!model) return 'Error: "model" parameter is required.';

            const nodeId = params.node_id as string | undefined;

            if (nodeId) {
                // Deploy to a specific node
                const res = await gatewayFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/models/pull`, {
                    method: 'POST',
                    body: { model },
                });
                if (!res.ok) return formatError('deploy_model', res);
                return `Model "${model}" deployment queued for node ${nodeId}.`;
            } else {
                // Deploy to all online nodes
                const res = await gatewayFetch('/api/v1/deploy', {
                    method: 'POST',
                    body: { model },
                });
                if (!res.ok) return formatError('deploy_model', res);

                const data = res.data as Record<string, unknown>;
                return `Model "${model}" deployed to ${data.commands_queued} node(s).`;
            }
        },
    },

    // -------------------------------------------------------------------------
    // remove_model — remove a model from a specific node
    // -------------------------------------------------------------------------
    {
        name: 'remove_model',
        description:
            'Removes (unloads) a model from a specific node in the TentaCLAW cluster.',
        parameters: {
            model: {
                type: 'string',
                description: 'The model name to remove (e.g. "llama3.1:8b")',
                required: true,
            },
            node_id: {
                type: 'string',
                description: 'The node ID to remove the model from',
                required: true,
            },
        },
        handler: async (params) => {
            const model = params.model as string;
            const nodeId = params.node_id as string;
            if (!model) return 'Error: "model" parameter is required.';
            if (!nodeId) return 'Error: "node_id" parameter is required.';

            const res = await gatewayFetch(
                `/api/v1/nodes/${encodeURIComponent(nodeId)}/models/${encodeURIComponent(model)}`,
                { method: 'DELETE' }
            );
            if (!res.ok) return formatError('remove_model', res);
            return `Model "${model}" removal queued for node ${nodeId}.`;
        },
    },

    // -------------------------------------------------------------------------
    // run_inference — send a chat completion request
    // -------------------------------------------------------------------------
    {
        name: 'run_inference',
        description:
            'Sends a chat completion request to the TentaCLAW cluster (OpenAI-compatible). ' +
            'Routes to the best available node running the specified model.',
        parameters: {
            model: {
                type: 'string',
                description: 'The model to run inference on (e.g. "llama3.1:8b")',
                required: true,
            },
            prompt: {
                type: 'string',
                description: 'The user message / prompt to send',
                required: true,
            },
            system_prompt: {
                type: 'string',
                description: 'Optional system prompt to set the behavior of the model',
            },
        },
        handler: async (params) => {
            const model = params.model as string;
            const prompt = params.prompt as string;
            const systemPrompt = params.system_prompt as string | undefined;
            if (!model) return 'Error: "model" parameter is required.';
            if (!prompt) return 'Error: "prompt" parameter is required.';

            const messages: Array<{ role: string; content: string }> = [];
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            messages.push({ role: 'user', content: prompt });

            const res = await gatewayFetch('/v1/chat/completions', {
                method: 'POST',
                body: { model, messages, stream: false },
            });
            if (!res.ok) return formatError('run_inference', res);

            const data = res.data as Record<string, unknown>;
            const choices = data.choices as Array<Record<string, unknown>> | undefined;
            if (!choices || choices.length === 0) {
                return 'Inference completed but returned no choices.';
            }

            const message = choices[0].message as Record<string, unknown>;
            const content = (message?.content as string) || '';

            // Include usage stats if available
            const usage = data.usage as Record<string, unknown> | undefined;
            const meta = data._tentaclaw as Record<string, unknown> | undefined;

            const lines = [content];
            if (usage) {
                lines.push('');
                lines.push(`--- Usage: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} total tokens ---`);
            }
            if (meta?.node) {
                lines.push(`--- Routed to: ${meta.node} (${meta.latency_ms}ms) ---`);
            }
            return lines.join('\n');
        },
    },

    // -------------------------------------------------------------------------
    // cluster_health — detailed health check
    // -------------------------------------------------------------------------
    {
        name: 'cluster_health',
        description:
            'Returns a detailed health check of the TentaCLAW cluster including database status, ' +
            'node availability, memory usage, and overall health grade.',
        parameters: {},
        handler: async () => {
            const res = await gatewayFetch('/api/v1/health/detailed');

            const data = res.data as Record<string, unknown>;
            const checks = data.checks as Record<string, unknown> | undefined;

            const lines = [
                '=== TentaCLAW Cluster Health ===',
                `Status:    ${data.status || 'unknown'}`,
                `Version:   ${data.version || 'unknown'}`,
                `Timestamp: ${data.timestamp || new Date().toISOString()}`,
            ];

            if (checks) {
                lines.push('');
                // Database
                const db = checks.database as Record<string, unknown> | undefined;
                if (db) {
                    lines.push(`Database:  ${db.status} (${db.latency_ms}ms)`);
                }
                // Nodes
                const nodes = checks.nodes as Record<string, unknown> | undefined;
                if (nodes) {
                    lines.push(`Nodes:     ${nodes.status} — ${nodes.online}/${nodes.total} online`);
                }
                // Memory
                const mem = checks.memory as Record<string, unknown> | undefined;
                if (mem) {
                    lines.push(`Memory:    ${mem.status} — RSS ${mem.rss_mb}MB, Heap ${mem.heap_mb}MB`);
                }
                // Uptime
                if (checks.uptime_seconds !== undefined) {
                    lines.push(`Uptime:    ${formatSeconds(checks.uptime_seconds as number)}`);
                }
            }

            // Also fetch health score
            const scoreRes = await gatewayFetch('/api/v1/health/score');
            if (scoreRes.ok) {
                const score = scoreRes.data as Record<string, unknown>;
                lines.push('');
                lines.push(`Health Score: ${score.score}/100 (Grade: ${score.grade})`);
                const issues = score.issues as Array<Record<string, unknown>> | undefined;
                if (issues && issues.length > 0) {
                    lines.push('Issues:');
                    for (const issue of issues) {
                        lines.push(`  [${issue.severity}] ${issue.message}`);
                    }
                }
                const recs = score.recommendations as string[] | undefined;
                if (recs && recs.length > 0) {
                    lines.push('Recommendations:');
                    for (const rec of recs) {
                        lines.push(`  - ${rec}`);
                    }
                }
            }

            return lines.join('\n');
        },
    },

    // -------------------------------------------------------------------------
    // search_models — search the model catalog
    // -------------------------------------------------------------------------
    {
        name: 'search_models',
        description:
            'Searches the TentaCLAW model catalog for available models. Shows which models ' +
            'fit in the cluster\'s available VRAM and which are already loaded.',
        parameters: {
            query: {
                type: 'string',
                description: 'Search query (e.g. "llama", "code", "small")',
                required: true,
            },
        },
        handler: async (params) => {
            const query = params.query as string;
            if (!query) return 'Error: "query" parameter is required.';

            const res = await gatewayFetch(`/api/v1/model-search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return formatError('search_models', res);

            const data = res.data as Record<string, unknown>;
            const models = data.models as Array<Record<string, unknown>> | undefined;
            const clusterVram = data.cluster_vram_mb as number | undefined;

            if (!models || models.length === 0) {
                return `No models found matching "${query}".`;
            }

            const lines = [
                `=== Model Search: "${query}" (${models.length} results) ===`,
                clusterVram ? `Cluster VRAM: ${formatMb(clusterVram)}` : '',
                '',
            ];

            for (const m of models) {
                const fits = m.fits_cluster ? 'FITS' : 'TOO LARGE';
                const loaded = m.loaded ? ' [LOADED]' : '';
                lines.push(`  ${m.name}${loaded}`);
                lines.push(`    ${m.description || 'No description'}`);
                lines.push(`    Size: ${m.size_gb}GB | VRAM: ${formatMb(m.vram_mb as number)} | Quant: ${m.quantization} | ${fits}`);
                lines.push(`    Tags: ${(m.tags as string[])?.join(', ') || 'none'}`);
                lines.push('');
            }
            return lines.join('\n');
        },
    },
];

// =============================================================================
// MCP Manifest — describes all available tools
// =============================================================================

interface McpToolSchema {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
}

function buildManifest() {
    return {
        name: 'tentaclaw',
        display_name: 'TentaCLAW OS',
        description: 'Manage TentaCLAW distributed AI inference clusters — deploy models, run inference, monitor health.',
        version: '0.1.0',
        tools: tools.map((t) => {
            const properties: McpToolSchema['properties'] = {};
            const required: string[] = [];

            for (const [key, param] of Object.entries(t.parameters)) {
                properties[key] = {
                    type: param.type,
                    description: param.description,
                };
                if (param.enum) {
                    properties[key].enum = param.enum;
                }
                if (param.required) {
                    required.push(key);
                }
            }

            const inputSchema: McpToolSchema = {
                type: 'object',
                properties,
                required,
            };

            return {
                name: t.name,
                description: t.description,
                inputSchema,
            };
        }),
    };
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatMb(mb: number | undefined | null): string {
    if (mb === undefined || mb === null) return '0 MB';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return Math.round(mb) + ' MB';
}

function formatSeconds(secs: number | undefined | null): string {
    if (!secs) return '0s';
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatError(toolName: string, res: GatewayResponse): string {
    const data = res.data as Record<string, unknown>;
    const message = data?.error || data?.message || `HTTP ${res.status}`;
    return `Error in ${toolName}: ${message}`;
}

// =============================================================================
// Request Handling
// =============================================================================

interface McpToolCallRequest {
    method?: string;
    params?: {
        name?: string;
        arguments?: Record<string, unknown>;
    };
    id?: string | number;
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
        return `Unknown tool: "${name}". Available tools: ${tools.map((t) => t.name).join(', ')}`;
    }
    return tool.handler(args);
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

// =============================================================================
// HTTP Server
// =============================================================================

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    // ---- GET /manifest — MCP tool manifest ----
    if (path === '/manifest' && req.method === 'GET') {
        jsonResponse(res, 200, buildManifest());
        return;
    }

    // ---- GET /health — server health ----
    if (path === '/health' && req.method === 'GET') {
        jsonResponse(res, 200, {
            status: 'ok',
            server: 'tentaclaw-mcp',
            version: '0.1.0',
            gateway: GATEWAY_URL,
            tools: tools.map((t) => t.name),
        });
        return;
    }

    // ---- GET /tools — list tools (convenience) ----
    if (path === '/tools' && req.method === 'GET') {
        jsonResponse(res, 200, {
            tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            })),
        });
        return;
    }

    // ---- POST /call — invoke a tool ----
    if (path === '/call' && req.method === 'POST') {
        try {
            const bodyStr = await readBody(req);
            const body = JSON.parse(bodyStr) as McpToolCallRequest;

            const toolName = body.params?.name || (body as Record<string, unknown>).name as string;
            const toolArgs = body.params?.arguments || (body as Record<string, unknown>).arguments as Record<string, unknown> || {};

            if (!toolName) {
                jsonResponse(res, 400, {
                    error: 'Missing tool name. Send { "params": { "name": "tool_name", "arguments": {...} } }',
                });
                return;
            }

            const result = await handleToolCall(toolName, toolArgs);

            jsonResponse(res, 200, {
                jsonrpc: '2.0',
                id: body.id || null,
                result: {
                    content: [{ type: 'text', text: result }],
                },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            jsonResponse(res, 400, {
                jsonrpc: '2.0',
                error: { code: -32700, message: `Parse error: ${message}` },
            });
        }
        return;
    }

    // ---- POST /mcp — JSON-RPC 2.0 MCP endpoint ----
    if (path === '/mcp' && req.method === 'POST') {
        try {
            const bodyStr = await readBody(req);
            const body = JSON.parse(bodyStr) as { method?: string; params?: Record<string, unknown>; id?: string | number };

            // Handle MCP protocol methods
            switch (body.method) {
                case 'initialize': {
                    jsonResponse(res, 200, {
                        jsonrpc: '2.0',
                        id: body.id,
                        result: {
                            protocolVersion: '2024-11-05',
                            capabilities: { tools: {} },
                            serverInfo: {
                                name: 'tentaclaw',
                                version: '0.1.0',
                            },
                        },
                    });
                    return;
                }

                case 'tools/list': {
                    const manifest = buildManifest();
                    jsonResponse(res, 200, {
                        jsonrpc: '2.0',
                        id: body.id,
                        result: { tools: manifest.tools },
                    });
                    return;
                }

                case 'tools/call': {
                    const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
                    const toolName = params?.name;
                    const toolArgs = params?.arguments || {};

                    if (!toolName) {
                        jsonResponse(res, 200, {
                            jsonrpc: '2.0',
                            id: body.id,
                            error: { code: -32602, message: 'Missing tool name in params.name' },
                        });
                        return;
                    }

                    const result = await handleToolCall(toolName, toolArgs);
                    jsonResponse(res, 200, {
                        jsonrpc: '2.0',
                        id: body.id,
                        result: {
                            content: [{ type: 'text', text: result }],
                        },
                    });
                    return;
                }

                case 'notifications/initialized': {
                    // Acknowledgment — no response needed for notifications
                    res.writeHead(204);
                    res.end();
                    return;
                }

                default: {
                    jsonResponse(res, 200, {
                        jsonrpc: '2.0',
                        id: body.id,
                        error: {
                            code: -32601,
                            message: `Unknown method: ${body.method}. Supported: initialize, tools/list, tools/call`,
                        },
                    });
                    return;
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            jsonResponse(res, 400, {
                jsonrpc: '2.0',
                error: { code: -32700, message: `Parse error: ${message}` },
            });
        }
        return;
    }

    // ---- GET / — landing page ----
    if (path === '/' && req.method === 'GET') {
        jsonResponse(res, 200, {
            server: 'TentaCLAW MCP Server',
            version: '0.1.0',
            gateway: GATEWAY_URL,
            endpoints: {
                'GET /':          'This page',
                'GET /health':    'Server health check',
                'GET /manifest':  'MCP tool manifest (tool definitions)',
                'GET /tools':     'List available tools',
                'POST /call':     'Invoke a tool: { "params": { "name": "tool_name", "arguments": {...} } }',
                'POST /mcp':      'JSON-RPC 2.0 MCP endpoint (initialize, tools/list, tools/call)',
            },
            tools: tools.map((t) => t.name),
        });
        return;
    }

    // ---- 404 ----
    jsonResponse(res, 404, { error: 'Not found', path });
});

// =============================================================================
// Start
// =============================================================================

server.listen(MCP_PORT, MCP_HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║     TentaCLAW MCP Server v0.1.0         ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  MCP:     http://${MCP_HOST}:${MCP_PORT}${' '.repeat(Math.max(0, 18 - MCP_HOST.length - String(MCP_PORT).length))}║`);
    console.log(`  ║  Gateway: ${GATEWAY_URL}${' '.repeat(Math.max(0, 27 - GATEWAY_URL.length))}║`);
    console.log(`  ║  Tools:   ${tools.length} available${' '.repeat(18)}║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  Tools:', tools.map((t) => t.name).join(', '));
    console.log('');
});
