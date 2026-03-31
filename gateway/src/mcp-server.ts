/**
 * TentaCLAW Gateway — MCP Server (Wave 93)
 *
 * Exposes TentaCLAW cluster management as Model Context Protocol tools.
 * AI agents (Claude Code, Cursor, etc.) can manage your GPU cluster via MCP.
 *
 * Tools exposed:
 *   1. tentaclaw_list_nodes — List all cluster nodes with GPU info
 *   2. tentaclaw_list_models — List deployed models
 *   3. tentaclaw_deploy_model — Deploy a model to the cluster
 *   4. tentaclaw_undeploy_model — Remove a model from cluster
 *   5. tentaclaw_run_inference — Run inference on a model
 *   6. tentaclaw_get_health — Get cluster health status
 *   7. tentaclaw_get_metrics — Get GPU and inference metrics
 *   8. tentaclaw_run_benchmark — Run performance benchmark
 *   9. tentaclaw_get_cost — Get GPU cost report
 *  10. tentaclaw_manage_keys — Create/list/revoke API keys
 *  11. tentaclaw_compliance_report — Generate EU AI Act compliance report
 *  12. tentaclaw_chaos_test — Run chaos engineering experiment
 *
 * CLAWtopus says: "MCP? Model Context Protocol? More like My Cluster, Perfectly managed."
 */

import {
    getAllNodes, getClusterSummary, getClusterModels,
    queueCommand, getHealthScore, createApiKey, getAllApiKeys,
    revokeApiKey, getClusterPower, getInferenceAnalytics,
    findBestNodeForModel,
} from './db';
import { generateComplianceReport } from './compliance';
import { createExperiment, injectChaos, listActions } from './chaos';

// =============================================================================
// Types
// =============================================================================

export interface McpTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required?: string[];
    };
}

export interface McpToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

// =============================================================================
// Tool Definitions
// =============================================================================

export function getMcpTools(): McpTool[] {
    return [
        {
            name: 'tentaclaw_list_nodes',
            description: 'List all nodes in the TentaCLAW GPU cluster with hostname, GPU count, VRAM, health status, and loaded models.',
            inputSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'Filter by status', enum: ['online', 'offline', 'all'] },
                },
            },
        },
        {
            name: 'tentaclaw_list_models',
            description: 'List all models currently deployed across the cluster with node assignments, VRAM usage, and request counts.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'tentaclaw_deploy_model',
            description: 'Deploy an AI model to the cluster. Auto-selects the best GPU node based on available VRAM. Supports HuggingFace model IDs.',
            inputSchema: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: 'Model name or HuggingFace ID (e.g., "llama3.1:8b", "microsoft/phi-4-mini")' },
                    node_id: { type: 'string', description: 'Optional: specific node to deploy to. If omitted, auto-selects best node.' },
                },
                required: ['model'],
            },
        },
        {
            name: 'tentaclaw_undeploy_model',
            description: 'Remove a deployed model from the cluster, freeing GPU VRAM.',
            inputSchema: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: 'Model name to undeploy' },
                    node_id: { type: 'string', description: 'Optional: specific node. If omitted, removes from all nodes.' },
                },
                required: ['model'],
            },
        },
        {
            name: 'tentaclaw_run_inference',
            description: 'Run inference on a deployed model. Returns the model response. Supports system prompts and temperature control.',
            inputSchema: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: 'Model to use for inference' },
                    prompt: { type: 'string', description: 'User message / prompt' },
                    system: { type: 'string', description: 'Optional system prompt' },
                    max_tokens: { type: 'string', description: 'Maximum tokens to generate (default: 512)' },
                    temperature: { type: 'string', description: 'Temperature (0.0-2.0, default: 0.7)' },
                },
                required: ['model', 'prompt'],
            },
        },
        {
            name: 'tentaclaw_get_health',
            description: 'Get cluster health status including node count, GPU count, total VRAM, health grade (A-F), and any active alerts.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'tentaclaw_get_metrics',
            description: 'Get GPU metrics: utilization, temperature, VRAM usage, power draw, and inference statistics (tokens/sec, latency).',
            inputSchema: {
                type: 'object',
                properties: {
                    period_hours: { type: 'string', description: 'Period in hours for analytics (default: 24)' },
                },
            },
        },
        {
            name: 'tentaclaw_get_cost',
            description: 'Get GPU cost report: power consumption, electricity cost, per-model cost breakdown.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'tentaclaw_manage_keys',
            description: 'Create, list, or revoke API keys for cluster access.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action to perform', enum: ['create', 'list', 'revoke'] },
                    name: { type: 'string', description: 'Key name (for create)' },
                    key_id: { type: 'string', description: 'Key ID (for revoke)' },
                },
                required: ['action'],
            },
        },
        {
            name: 'tentaclaw_compliance_report',
            description: 'Generate an EU AI Act compliance report covering Articles 12-15 and 50. Shows compliance status per article with recommendations.',
            inputSchema: {
                type: 'object',
                properties: {
                    period_days: { type: 'string', description: 'Report period in days (default: 30)' },
                },
            },
        },
        {
            name: 'tentaclaw_chaos_test',
            description: 'Run a chaos engineering experiment to test cluster resilience. Supports: kill-node, kill-gpu, network-partition, backend-crash.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Chaos action', enum: ['kill-node', 'kill-gpu', 'network-partition', 'backend-crash', 'list-actions'] },
                    target: { type: 'string', description: 'Target node ID (or "random")' },
                    dry_run: { type: 'string', description: 'Dry run mode (true/false, default: true)' },
                },
                required: ['action'],
            },
        },
        {
            name: 'tentaclaw_quantize',
            description: 'Quantize a model for faster inference. Supports FP8, AWQ, GPTQ, GGUF formats.',
            inputSchema: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: 'Model to quantize' },
                    method: { type: 'string', description: 'Quantization method', enum: ['fp8', 'awq', 'gptq', 'gguf_q4', 'gguf_q6', 'exl2'] },
                },
                required: ['model'],
            },
        },
    ];
}

// =============================================================================
// Tool Execution
// =============================================================================

export async function executeMcpTool(name: string, args: Record<string, string>): Promise<McpToolResult> {
    try {
        switch (name) {
            case 'tentaclaw_list_nodes': {
                const nodes = getAllNodes();
                const filtered = args.status === 'online' ? nodes.filter(n => n.status === 'online') :
                    args.status === 'offline' ? nodes.filter(n => n.status !== 'online') : nodes;
                const summary = filtered.map(n => ({
                    id: n.id,
                    hostname: n.hostname,
                    status: n.status,
                    gpus: n.gpu_count,
                    vram_mb: n.latest_stats?.gpus?.reduce((s: number, g: any) => s + (g.vramTotalMb || 0), 0) || 0,
                    models: n.latest_stats?.inference?.loaded_models || [],
                }));
                return text(JSON.stringify(summary, null, 2));
            }

            case 'tentaclaw_list_models': {
                const models = getClusterModels();
                return text(JSON.stringify(models, null, 2));
            }

            case 'tentaclaw_deploy_model': {
                if (!args.model) return error('model is required');
                const node = args.node_id ?
                    getAllNodes().find(n => n.id === args.node_id) :
                    (() => { const best = findBestNodeForModel(args.model); return best ? getAllNodes().find(n => n.id === best.node_id) : null; })();

                if (!node) return error(`No suitable node found for model "${args.model}". Check available VRAM.`);

                const cmdId = queueCommand(node.id, 'install_model', { model: args.model });
                return text(`Deploying ${args.model} to ${node.hostname} (${node.id}). Command ID: ${cmdId}`);
            }

            case 'tentaclaw_undeploy_model': {
                if (!args.model) return error('model is required');
                const nodes = getAllNodes().filter(n => n.status === 'online');
                let removed = 0;
                for (const n of nodes) {
                    if (!args.node_id || n.id === args.node_id) {
                        queueCommand(n.id, 'remove_model', { model: args.model });
                        removed++;
                    }
                }
                return text(`Undeploying ${args.model} from ${removed} node(s).`);
            }

            case 'tentaclaw_run_inference': {
                if (!args.model || !args.prompt) return error('model and prompt are required');
                const target = findBestNodeForModel(args.model);
                if (!target) return error(`Model "${args.model}" not found on any node. Deploy it first.`);

                const node = getAllNodes().find(n => n.id === target.node_id);
                const port = (node?.latest_stats as any)?.backend?.port || 11434;
                const url = `http://${node?.ip_address || node?.hostname}:${port}/v1/chat/completions`;

                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: args.model,
                            messages: [
                                ...(args.system ? [{ role: 'system', content: args.system }] : []),
                                { role: 'user', content: args.prompt },
                            ],
                            max_tokens: parseInt(args.max_tokens || '512', 10),
                            temperature: parseFloat(args.temperature || '0.7'),
                        }),
                    });
                    const data = await res.json() as any;
                    return text(data.choices?.[0]?.message?.content || JSON.stringify(data));
                } catch (e) {
                    return error(`Inference failed: ${(e as Error).message}`);
                }
            }

            case 'tentaclaw_get_health': {
                const summary = getClusterSummary();
                const health = getHealthScore();
                return text(JSON.stringify({ ...summary, health }, null, 2));
            }

            case 'tentaclaw_get_metrics': {
                const hours = parseInt(args.period_hours || '24', 10);
                const analytics = getInferenceAnalytics(hours);
                return text(JSON.stringify(analytics, null, 2));
            }

            case 'tentaclaw_get_cost': {
                const power = getClusterPower();
                return text(JSON.stringify(power, null, 2));
            }

            case 'tentaclaw_manage_keys': {
                if (args.action === 'list') {
                    const keys = getAllApiKeys();
                    return text(JSON.stringify(keys.map(k => ({ id: k.id, name: k.name, prefix: k.key_prefix, scope: k.scope })), null, 2));
                }
                if (args.action === 'create') {
                    const result = createApiKey(args.name || 'mcp-key', 'inference');
                    return text(`API key created:\n  Key: ${result.key}\n  ID: ${result.id}\n  Save this key — it will not be shown again.`);
                }
                if (args.action === 'revoke' && args.key_id) {
                    revokeApiKey(args.key_id);
                    return text(`Key ${args.key_id} revoked.`);
                }
                return error('Invalid action. Use: create, list, or revoke');
            }

            case 'tentaclaw_compliance_report': {
                const days = parseInt(args.period_days || '30', 10);
                const report = generateComplianceReport(days);
                return text(JSON.stringify(report, null, 2));
            }

            case 'tentaclaw_chaos_test': {
                if (args.action === 'list-actions') {
                    return text(JSON.stringify(listActions(), null, 2));
                }
                const dryRun = args.dry_run !== 'false';
                const exp = createExperiment(args.action as any, args.target || 'random', {}, { dryRun });
                const result = await injectChaos(exp.id);
                return text(JSON.stringify({ experiment_id: exp.id, ...result }, null, 2));
            }

            case 'tentaclaw_quantize': {
                if (!args.model) return error('model is required');
                const node = findBestNodeForModel(args.model);
                if (!node) return error(`Model "${args.model}" not found. Deploy first.`);
                const cmdId = queueCommand(node.node_id, 'quantize_model', {
                    model: args.model, method: args.method || 'fp8',
                });
                return text(`Quantization queued: ${args.model} -> ${args.method || 'fp8'} on ${node.hostname}. Job: ${cmdId}`);
            }

            default:
                return error(`Unknown tool: ${name}`);
        }
    } catch (e) {
        return error(`Tool execution failed: ${(e as Error).message}`);
    }
}

// =============================================================================
// HTTP Handlers (for mounting on Hono app)
// =============================================================================

/** Handle MCP tool list request */
export function handleMcpToolList(): { tools: McpTool[] } {
    return { tools: getMcpTools() };
}

/** Handle MCP tool call request */
export async function handleMcpToolCall(toolName: string, args: Record<string, string>): Promise<McpToolResult> {
    return executeMcpTool(toolName, args);
}

// =============================================================================
// Helpers
// =============================================================================

function text(content: string): McpToolResult {
    return { content: [{ type: 'text', text: content }] };
}

function error(message: string): McpToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
