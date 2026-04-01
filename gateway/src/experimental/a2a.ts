/**
 * TentaCLAW Gateway — A2A Protocol Support (Wave 94)
 *
 * Implements Google's Agent-to-Agent (A2A) protocol v0.3:
 *   - Agent Card publication at /.well-known/agent.json
 *   - Task negotiation (accept/reject based on capacity)
 *   - Task execution (inference, deployment, monitoring)
 *   - Task status tracking
 *
 * A2A enables inter-agent communication: monitoring agents can delegate
 * inference tasks to TentaCLAW, orchestration agents can request deployments.
 *
 * CLAWtopus says: "Agent-to-agent? More like arm-to-arm coordination."
 */

import { getClusterSummary, getClusterModels, findBestNodeForModel } from './db';
import { executeMcpTool } from './mcp-server';

// =============================================================================
// Types (A2A Protocol v0.3)
// =============================================================================

export interface AgentCard {
    name: string;
    description: string;
    url: string;
    version: string;
    protocol_version: string;
    capabilities: AgentCapability[];
    authentication: { type: string; description: string };
    contact: { email: string; url: string };
}

export interface AgentCapability {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
}

export type A2ATaskState = 'submitted' | 'accepted' | 'working' | 'completed' | 'failed' | 'rejected';

export interface A2ATask {
    id: string;
    capability: string;
    input: Record<string, unknown>;
    state: A2ATaskState;
    output?: Record<string, unknown>;
    error?: string;
    created_at: string;
    updated_at: string;
}

// =============================================================================
// State
// =============================================================================

const tasks = new Map<string, A2ATask>();
let taskCounter = 0;

// =============================================================================
// Agent Card
// =============================================================================

/** Generate the A2A Agent Card for this TentaCLAW instance */
export function getAgentCard(baseUrl: string): AgentCard {
    const summary = getClusterSummary();
    const models = getClusterModels();

    return {
        name: 'TentaCLAW GPU Cluster',
        description: `AI inference cluster with ${summary.online_nodes || 0} nodes, ${summary.total_gpus || 0} GPUs, ${models.length} models. Capabilities: inference, model deployment, GPU monitoring, benchmarking, compliance reporting.`,
        url: baseUrl,
        version: '0.3.0',
        protocol_version: '0.3',
        capabilities: [
            {
                name: 'inference',
                description: 'Run AI inference on deployed models (OpenAI-compatible)',
                input_schema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string' }, max_tokens: { type: 'number' } }, required: ['model', 'prompt'] },
                output_schema: { type: 'object', properties: { response: { type: 'string' }, tokens_used: { type: 'number' }, latency_ms: { type: 'number' } } },
            },
            {
                name: 'deploy_model',
                description: 'Deploy an AI model to available GPU nodes',
                input_schema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] },
                output_schema: { type: 'object', properties: { status: { type: 'string' }, node: { type: 'string' } } },
            },
            {
                name: 'cluster_status',
                description: 'Get cluster health, GPU metrics, and model inventory',
                input_schema: { type: 'object', properties: {} },
                output_schema: { type: 'object', properties: { nodes: { type: 'number' }, gpus: { type: 'number' }, health: { type: 'string' } } },
            },
            {
                name: 'compliance_check',
                description: 'Generate EU AI Act compliance report',
                input_schema: { type: 'object', properties: { period_days: { type: 'number' } } },
                output_schema: { type: 'object', properties: { framework: { type: 'string' }, articles: { type: 'object' } } },
            },
        ],
        authentication: {
            type: 'bearer',
            description: 'API key required. Create via POST /api/v1/apikeys',
        },
        contact: {
            email: 'support@tentaclaw.io',
            url: 'https://tentaclaw.io',
        },
    };
}

// =============================================================================
// Task Management
// =============================================================================

function generateTaskId(): string {
    return `task-${++taskCounter}-${Date.now().toString(36)}`;
}

/** Submit a task to TentaCLAW (A2A task/send) */
export async function submitTask(capability: string, input: Record<string, unknown>): Promise<A2ATask> {
    const id = generateTaskId();
    const now = new Date().toISOString();

    // Check if we can handle this capability
    const validCapabilities = ['inference', 'deploy_model', 'cluster_status', 'compliance_check'];
    if (!validCapabilities.includes(capability)) {
        const task: A2ATask = { id, capability, input, state: 'rejected', error: `Unknown capability: ${capability}`, created_at: now, updated_at: now };
        tasks.set(id, task);
        return task;
    }

    // Check capacity for inference
    if (capability === 'inference') {
        const model = input.model as string;
        if (model && !findBestNodeForModel(model)) {
            const task: A2ATask = { id, capability, input, state: 'rejected', error: `Model "${model}" not available`, created_at: now, updated_at: now };
            tasks.set(id, task);
            return task;
        }
    }

    // Accept the task
    const task: A2ATask = { id, capability, input, state: 'accepted', created_at: now, updated_at: now };
    tasks.set(id, task);

    // Execute asynchronously
    executeTask(task).catch(() => {});

    return task;
}

/** Execute an accepted task */
async function executeTask(task: A2ATask): Promise<void> {
    task.state = 'working';
    task.updated_at = new Date().toISOString();

    try {
        let result: Record<string, unknown>;

        switch (task.capability) {
            case 'inference': {
                const mcpResult = await executeMcpTool('tentaclaw_run_inference', {
                    model: String(task.input.model || ''),
                    prompt: String(task.input.prompt || ''),
                    max_tokens: String(task.input.max_tokens || 512),
                });
                result = { response: mcpResult.content[0]?.text, error: mcpResult.isError };
                break;
            }
            case 'deploy_model': {
                const mcpResult = await executeMcpTool('tentaclaw_deploy_model', {
                    model: String(task.input.model || ''),
                });
                result = { response: mcpResult.content[0]?.text };
                break;
            }
            case 'cluster_status': {
                const mcpResult = await executeMcpTool('tentaclaw_get_health', {});
                result = JSON.parse(mcpResult.content[0]?.text || '{}');
                break;
            }
            case 'compliance_check': {
                const mcpResult = await executeMcpTool('tentaclaw_compliance_report', {
                    period_days: String(task.input.period_days || 30),
                });
                result = JSON.parse(mcpResult.content[0]?.text || '{}');
                break;
            }
            default:
                result = { error: 'Unknown capability' };
        }

        task.state = 'completed';
        task.output = result;
    } catch (err) {
        task.state = 'failed';
        task.error = (err as Error).message;
    }
    task.updated_at = new Date().toISOString();
}

/** Get task status */
export function getTask(id: string): A2ATask | undefined {
    return tasks.get(id);
}

/** List recent tasks */
export function listTasks(limit: number = 50): A2ATask[] {
    return Array.from(tasks.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);
}

/** Reset state (for testing) */
export function _resetA2A(): void {
    tasks.clear();
    taskCounter = 0;
}
