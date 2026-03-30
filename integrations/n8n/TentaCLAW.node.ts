/**
 * TentaCLAW n8n Community Node
 *
 * Manage your GPU inference cluster from n8n workflows.
 * Deploy models, run inference, monitor health, respond to alerts.
 *
 * CLAWtopus says: "n8n builds the workflows. I provide the GPUs."
 *
 * Installation:
 *   npm install n8n-nodes-tentaclaw
 *
 * Or copy this to your n8n custom nodes directory.
 */

// This is a reference implementation for an n8n community node.
// In production, this would be published as an npm package.

export interface ITentaCLAWCredentials {
    gatewayUrl: string;
    apiKey?: string;
}

export const TentaCLAWDescription = {
    displayName: 'TentaCLAW',
    name: 'tentaclaw',
    icon: 'file:tentaclaw.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Manage GPU inference clusters with TentaCLAW OS',
    defaults: { name: 'TentaCLAW' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
        {
            name: 'tentaclawApi',
            required: true,
        },
    ],
    properties: [
        // Operation selector
        {
            displayName: 'Operation',
            name: 'operation',
            type: 'options',
            noDataExpression: true,
            options: [
                { name: 'Chat Completion', value: 'chat', description: 'Send a chat message to a cluster model' },
                { name: 'Deploy Model', value: 'deploy', description: 'Deploy a model to the cluster' },
                { name: 'List Models', value: 'models', description: 'List loaded models' },
                { name: 'List Nodes', value: 'nodes', description: 'List cluster nodes' },
                { name: 'Cluster Status', value: 'status', description: 'Get cluster summary' },
                { name: 'Health Check', value: 'health', description: 'Get cluster health score' },
                { name: 'Get Alerts', value: 'alerts', description: 'Get active alerts' },
                { name: 'Search Models', value: 'search', description: 'Search model catalog' },
                { name: 'Recommend Models', value: 'recommend', description: 'Get model recommendations' },
                { name: 'Estimate VRAM', value: 'estimate', description: 'Estimate VRAM for a model' },
            ],
            default: 'chat',
        },
        // Chat parameters
        {
            displayName: 'Model',
            name: 'model',
            type: 'string',
            default: 'llama3.1:8b',
            displayOptions: { show: { operation: ['chat', 'deploy', 'estimate'] } },
            description: 'Model name (e.g., llama3.1:8b, deepseek-r1:70b)',
        },
        {
            displayName: 'Message',
            name: 'message',
            type: 'string',
            typeOptions: { rows: 4 },
            default: '',
            displayOptions: { show: { operation: ['chat'] } },
            description: 'Message to send to the model',
        },
        {
            displayName: 'System Prompt',
            name: 'systemPrompt',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            displayOptions: { show: { operation: ['chat'] } },
            description: 'Optional system prompt',
        },
        {
            displayName: 'Temperature',
            name: 'temperature',
            type: 'number',
            default: 0.7,
            typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
            displayOptions: { show: { operation: ['chat'] } },
        },
        {
            displayName: 'Max Tokens',
            name: 'maxTokens',
            type: 'number',
            default: 4096,
            displayOptions: { show: { operation: ['chat'] } },
        },
        // Search parameters
        {
            displayName: 'Search Query',
            name: 'query',
            type: 'string',
            default: '',
            displayOptions: { show: { operation: ['search'] } },
            description: 'Search query for model catalog',
        },
    ],
};

/**
 * Execute function — this is what n8n calls when the node runs.
 *
 * In a real n8n node, this would be:
 * async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>
 */
export async function execute(
    operation: string,
    params: Record<string, unknown>,
    credentials: ITentaCLAWCredentials,
): Promise<unknown> {
    const baseUrl = credentials.gatewayUrl.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credentials.apiKey) headers['Authorization'] = `Bearer ${credentials.apiKey}`;

    switch (operation) {
        case 'chat': {
            const messages: Array<{ role: string; content: string }> = [];
            if (params.systemPrompt) messages.push({ role: 'system', content: String(params.systemPrompt) });
            messages.push({ role: 'user', content: String(params.message) });

            const res = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    model: params.model, messages,
                    temperature: params.temperature, max_tokens: params.maxTokens,
                }),
            });
            return res.json();
        }

        case 'deploy':
            return (await fetch(`${baseUrl}/api/v1/deploy`, {
                method: 'POST', headers, body: JSON.stringify({ model: params.model }),
            })).json();

        case 'models':
            return (await fetch(`${baseUrl}/api/v1/models`, { headers })).json();

        case 'nodes':
            return (await fetch(`${baseUrl}/api/v1/nodes`, { headers })).json();

        case 'status':
            return (await fetch(`${baseUrl}/api/v1/summary`, { headers })).json();

        case 'health':
            return (await fetch(`${baseUrl}/api/v1/health/score`, { headers })).json();

        case 'alerts':
            return (await fetch(`${baseUrl}/api/v1/alerts`, { headers })).json();

        case 'search':
            return (await fetch(`${baseUrl}/api/v1/model-search?q=${encodeURIComponent(String(params.query))}`, { headers })).json();

        case 'recommend':
            return (await fetch(`${baseUrl}/api/v1/models/recommend`, { headers })).json();

        case 'estimate':
            return (await fetch(`${baseUrl}/api/v1/models/estimate-vram?model=${encodeURIComponent(String(params.model))}`, { headers })).json();

        default:
            throw new Error(`Unknown operation: ${operation}`);
    }
}
