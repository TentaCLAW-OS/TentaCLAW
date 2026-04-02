// F:\tentaclaw-os\gateway\src\agents.ts
// AI Agent Runtime for TentaCLAW
// TentaCLAW says: "Agents? I'll orchestrate those with my eight arms."

import {
    getAllNodes,
    getNode,
    getClusterModels,
    getClusterSummary,
    getHealthScore,
    getRecentAlerts,
    queueCommand,
    addNodeTag,
    removeNodeTag,
    getNodeTags,
    getNodeHealthScore,
    findBestNode,
} from './db';

// =============================================================================
// Interfaces
// =============================================================================

export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentConfig {
    id: string;
    name: string;
    model: string;
    system_prompt: string;
    tools: string[];  // tool names
    max_steps: number;
    temperature: number;
}

export interface AgentStep {
    step: number;
    type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
    content: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_result?: unknown;
    timestamp: string;
}

export interface AgentRun {
    id: string;
    agent_id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    steps: AgentStep[];
    input: string;
    output?: string;
    started_at: string;
    completed_at?: string;
}

// =============================================================================
// Built-in Tools
// =============================================================================

function makeTimestamp(): string {
    return new Date().toISOString();
}

const builtinTools: AgentTool[] = [
    {
        name: 'cluster_status',
        description: 'Get a summary of the TentaCLAW cluster including node counts, GPU totals, VRAM usage, and loaded models.',
        parameters: {},
        handler: async () => {
            return getClusterSummary();
        },
    },
    {
        name: 'list_nodes',
        description: 'List all registered nodes with their status and latest stats.',
        parameters: {},
        handler: async () => {
            const nodes = getAllNodes();
            return nodes.map(n => ({
                id: n.id,
                hostname: n.hostname,
                status: n.status,
                ip_address: n.ip_address,
                gpu_count: n.gpu_count,
                last_seen_at: n.last_seen_at,
                loaded_models: n.latest_stats?.inference.loaded_models ?? [],
                toks_per_sec: n.latest_stats?.toks_per_sec ?? 0,
            }));
        },
    },
    {
        name: 'list_models',
        description: 'List all models currently loaded across the cluster with node counts.',
        parameters: {},
        handler: async () => {
            return getClusterModels();
        },
    },
    {
        name: 'deploy_model',
        description: 'Deploy (install) a model onto a specific node by queuing an install_model command.',
        parameters: {
            node_id: { type: 'string', description: 'The target node ID', required: true },
            model: { type: 'string', description: 'The model name to deploy (e.g. "llama3.1:8b")', required: true },
        },
        handler: async (params) => {
            const nodeId = params.node_id as string;
            const model = params.model as string;
            if (!nodeId || !model) {
                return { error: 'node_id and model are required' };
            }
            const node = getNode(nodeId);
            if (!node) {
                return { error: `Node "${nodeId}" not found` };
            }
            const command = queueCommand(nodeId, 'install_model', { model });
            return { success: true, command_id: command.id, node_id: nodeId, model };
        },
    },
    {
        name: 'run_inference',
        description: 'Send a chat completion request to a model running on the cluster. Returns the model response.',
        parameters: {
            model: { type: 'string', description: 'The model to use for inference', required: true },
            prompt: { type: 'string', description: 'The user message / prompt', required: true },
        },
        handler: async (params) => {
            const model = params.model as string;
            const prompt = params.prompt as string;
            if (!model || !prompt) {
                return { error: 'model and prompt are required' };
            }

            const target = findBestNode(model);
            if (!target) {
                return { error: `No online node has model "${model}" loaded` };
            }

            const backendPort = target.backend_port || 11434;
            const backendUrl = `http://${target.ip_address || target.hostname}:${backendPort}/v1/chat/completions`;

            try {
                const response = await fetch(backendUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        stream: false,
                    }),
                });

                if (!response.ok) {
                    return { error: `Backend returned ${response.status}`, node_id: target.node_id };
                }

                const result = await response.json() as Record<string, unknown>;
                return { result, node_id: target.node_id, hostname: target.hostname };
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Inference failed: ${message}`, node_id: target.node_id };
            }
        },
    },
    {
        name: 'check_health',
        description: 'Get the cluster health score (0-100), grade, and contributing factors.',
        parameters: {},
        handler: async () => {
            return getHealthScore();
        },
    },
    {
        name: 'get_alerts',
        description: 'Get recent alerts from the cluster. Returns up to the specified limit.',
        parameters: {
            limit: { type: 'number', description: 'Maximum number of alerts to return (default 20)', required: false },
        },
        handler: async (params) => {
            const limit = typeof params.limit === 'number' ? params.limit : 20;
            return getRecentAlerts(limit);
        },
    },
    {
        name: 'search_models',
        description: 'Search for models loaded in the cluster by name substring.',
        parameters: {
            query: { type: 'string', description: 'Search query to match against model names', required: true },
        },
        handler: async (params) => {
            const query = (params.query as string || '').toLowerCase();
            if (!query) {
                return { error: 'query is required' };
            }
            const models = getClusterModels();
            const matches = models.filter(m => m.model.toLowerCase().includes(query));
            return { query, matches, total_models: models.length };
        },
    },
    {
        name: 'get_node_stats',
        description: 'Get detailed stats for a specific node including GPU temps, VRAM, health score, and loaded models.',
        parameters: {
            node_id: { type: 'string', description: 'The node ID to get stats for', required: true },
        },
        handler: async (params) => {
            const nodeId = params.node_id as string;
            if (!nodeId) {
                return { error: 'node_id is required' };
            }
            const node = getNode(nodeId);
            if (!node) {
                return { error: `Node "${nodeId}" not found` };
            }
            const health = getNodeHealthScore(nodeId);
            const tags = getNodeTags(nodeId);
            return {
                id: node.id,
                hostname: node.hostname,
                status: node.status,
                ip_address: node.ip_address,
                gpu_count: node.gpu_count,
                last_seen_at: node.last_seen_at,
                health,
                tags,
                stats: node.latest_stats ? {
                    gpus: node.latest_stats.gpus,
                    cpu: node.latest_stats.cpu,
                    ram: node.latest_stats.ram,
                    disk: node.latest_stats.disk,
                    inference: node.latest_stats.inference,
                    toks_per_sec: node.latest_stats.toks_per_sec,
                } : null,
            };
        },
    },
    {
        name: 'manage_tags',
        description: 'Add or remove tags on a node. Tags are used for grouping and filtering.',
        parameters: {
            node_id: { type: 'string', description: 'The node ID to manage tags for', required: true },
            action: { type: 'string', description: 'Either "add" or "remove"', required: true },
            tag: { type: 'string', description: 'The tag to add or remove', required: true },
        },
        handler: async (params) => {
            const nodeId = params.node_id as string;
            const action = params.action as string;
            const tag = params.tag as string;
            if (!nodeId || !action || !tag) {
                return { error: 'node_id, action, and tag are required' };
            }
            if (action !== 'add' && action !== 'remove') {
                return { error: 'action must be "add" or "remove"' };
            }
            const node = getNode(nodeId);
            if (!node) {
                return { error: `Node "${nodeId}" not found` };
            }
            if (action === 'add') {
                addNodeTag(nodeId, tag);
                return { success: true, action: 'added', node_id: nodeId, tag };
            } else {
                const removed = removeNodeTag(nodeId, tag);
                return { success: removed, action: 'removed', node_id: nodeId, tag };
            }
        },
    },
];

// =============================================================================
// Tool Registry
// =============================================================================

const toolRegistry = new Map<string, AgentTool>();
for (const tool of builtinTools) {
    toolRegistry.set(tool.name, tool);
}

export function getBuiltinTools(): AgentTool[] {
    return [...builtinTools];
}

export async function executeToolCall(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = toolRegistry.get(toolName);
    if (!tool) {
        return { error: `Unknown tool: "${toolName}"` };
    }
    try {
        return await tool.handler(params);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Tool "${toolName}" failed: ${message}` };
    }
}

// =============================================================================
// Agent Registry
// =============================================================================

const agents = new Map<string, AgentConfig>();
const agentRuns: AgentRun[] = [];

export function createAgent(config: AgentConfig): AgentConfig {
    // Validate that all requested tools exist
    for (const toolName of config.tools) {
        if (!toolRegistry.has(toolName)) {
            throw new Error(`Unknown tool: "${toolName}". Available: ${[...toolRegistry.keys()].join(', ')}`);
        }
    }
    if (config.max_steps < 1 || config.max_steps > 50) {
        throw new Error('max_steps must be between 1 and 50');
    }
    agents.set(config.id, config);
    return config;
}

export function getAgentRuns(agentId?: string): AgentRun[] {
    if (agentId) {
        return agentRuns.filter(r => r.agent_id === agentId);
    }
    return [...agentRuns];
}

// =============================================================================
// Agent Execution
// =============================================================================

/**
 * Build OpenAI-compatible tool definitions from the agent's tool list.
 */
function buildToolDefs(toolNames: string[]): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
    return toolNames
        .map(name => toolRegistry.get(name))
        .filter((t): t is AgentTool => !!t)
        .map(tool => {
            const properties: Record<string, { type: string; description: string }> = {};
            const required: string[] = [];
            for (const [key, param] of Object.entries(tool.parameters)) {
                properties[key] = { type: param.type, description: param.description };
                if (param.required) required.push(key);
            }
            return {
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: {
                        type: 'object',
                        properties,
                        required,
                    },
                },
            };
        });
}

/**
 * Run an agent loop: send messages + tool definitions to /v1/chat/completions,
 * execute any tool_calls, feed results back, repeat until final response or max_steps.
 */
export async function runAgent(agentId: string, input: string): Promise<AgentRun> {
    const config = agents.get(agentId);
    if (!config) {
        throw new Error(`Agent "${agentId}" not found`);
    }

    const run: AgentRun = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        agent_id: agentId,
        status: 'running',
        steps: [],
        input,
        started_at: makeTimestamp(),
    };
    agentRuns.push(run);

    const toolDefs = buildToolDefs(config.tools);

    // Conversation messages for the LLM
    const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: config.system_prompt },
        { role: 'user', content: input },
    ];

    let stepNumber = 0;

    try {
        while (stepNumber < config.max_steps) {
            stepNumber++;

            // Find a node that has the agent's model loaded
            const target = findBestNode(config.model);
            if (!target) {
                run.status = 'failed';
                run.output = `No online node has model "${config.model}" loaded.`;
                run.completed_at = makeTimestamp();
                return run;
            }

            const backendPort = target.backend_port || 11434;
            const backendUrl = `http://${target.ip_address || target.hostname}:${backendPort}/v1/chat/completions`;

            const requestBody: Record<string, unknown> = {
                model: config.model,
                messages,
                temperature: config.temperature,
                stream: false,
            };

            if (toolDefs.length > 0) {
                requestBody.tools = toolDefs;
            }

            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                run.status = 'failed';
                run.output = `LLM request failed with status ${response.status}`;
                run.completed_at = makeTimestamp();
                return run;
            }

            const result = await response.json() as {
                choices?: Array<{
                    message?: {
                        role?: string;
                        content?: string | null;
                        tool_calls?: Array<{
                            id: string;
                            type: string;
                            function: { name: string; arguments: string };
                        }>;
                    };
                    finish_reason?: string;
                }>;
            };

            const choice = result.choices?.[0];
            if (!choice?.message) {
                run.status = 'failed';
                run.output = 'No response from LLM';
                run.completed_at = makeTimestamp();
                return run;
            }

            const assistantMessage = choice.message;
            const toolCalls = assistantMessage.tool_calls;

            // If the model returned tool calls, execute them
            if (toolCalls && toolCalls.length > 0) {
                // Record the thinking step (content may be null when tool calls are present)
                if (assistantMessage.content) {
                    run.steps.push({
                        step: stepNumber,
                        type: 'thinking',
                        content: assistantMessage.content,
                        timestamp: makeTimestamp(),
                    });
                }

                // Add the assistant message (with tool_calls) to conversation
                messages.push({
                    role: 'assistant',
                    content: assistantMessage.content || null,
                    tool_calls: toolCalls,
                });

                // Execute each tool call
                for (const tc of toolCalls) {
                    let toolArgs: Record<string, unknown> = {};
                    try {
                        toolArgs = JSON.parse(tc.function.arguments);
                    } catch {
                        toolArgs = {};
                    }

                    run.steps.push({
                        step: stepNumber,
                        type: 'tool_call',
                        content: `Calling ${tc.function.name}`,
                        tool_name: tc.function.name,
                        tool_args: toolArgs,
                        timestamp: makeTimestamp(),
                    });

                    const toolResult = await executeToolCall(tc.function.name, toolArgs);

                    run.steps.push({
                        step: stepNumber,
                        type: 'tool_result',
                        content: JSON.stringify(toolResult),
                        tool_name: tc.function.name,
                        tool_result: toolResult,
                        timestamp: makeTimestamp(),
                    });

                    // Add tool result to conversation
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: JSON.stringify(toolResult),
                    });
                }

                // Continue the loop — the model will see the tool results
                continue;
            }

            // No tool calls — model gave a final text response
            const finalContent = assistantMessage.content || '';
            run.steps.push({
                step: stepNumber,
                type: 'response',
                content: finalContent,
                timestamp: makeTimestamp(),
            });
            run.status = 'completed';
            run.output = finalContent;
            run.completed_at = makeTimestamp();
            return run;
        }

        // Hit max_steps without a final response
        run.status = 'completed';
        run.output = run.steps.length > 0
            ? run.steps[run.steps.length - 1].content
            : 'Agent reached max steps without producing a response.';
        run.completed_at = makeTimestamp();
        return run;

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        run.status = 'failed';
        run.output = `Agent error: ${message}`;
        run.completed_at = makeTimestamp();
        return run;
    }
}
