/**
 * @tentaclaw/sdk — TentaCLAW OS TypeScript SDK
 *
 * Manage your GPU inference cluster programmatically.
 * TentaCLAW says: "Eight arms. One SDK. Zero hassle."
 *
 * Usage:
 *   import { TentaCLAW } from '@tentaclaw/sdk';
 *   const tc = new TentaCLAW('http://localhost:8080');
 *   const nodes = await tc.nodes.list();
 *   const response = await tc.inference.chat('llama3.1:8b', 'Hello!');
 */

// =============================================================================
// Types
// =============================================================================

export interface Node {
    id: string;
    hostname: string;
    farm_hash: string;
    status: string;
    gpu_count: number;
    ip_address: string | null;
    registered_at: string;
    last_seen_at: string | null;
    latest_stats?: Record<string, unknown>;
}

export interface ClusterSummary {
    total_nodes: number;
    online_nodes: number;
    total_gpus: number;
    total_vram_mb: number;
    loaded_models: string[];
}

export interface HealthScore {
    score: number;
    grade: string;
    issues: Array<{ severity: string; message: string }>;
}

export interface Model {
    model: string;
    node_count: number;
    nodes: string[];
}

export interface ChatResponse {
    id: string;
    object: string;
    choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    _tentaclaw?: Record<string, unknown>;
}

export interface Alert {
    id: string;
    node_id: string;
    severity: string;
    type: string;
    message: string;
    created_at: string;
}

export interface ApiKey {
    id: string;
    key?: string;
    name: string;
    permissions: string[];
}

export interface SDKOptions {
    apiKey?: string;
    timeout?: number;
}

// =============================================================================
// HTTP Client
// =============================================================================

class HttpClient {
    constructor(
        private baseUrl: string,
        private options: SDKOptions = {},
    ) {}

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = this.baseUrl + path;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'TentaCLAW-SDK/0.1.0',
        };
        if (this.options.apiKey) {
            headers['Authorization'] = 'Bearer ' + this.options.apiKey;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeout || 30000);

        try {
            const res = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new TentaCLAWError(res.status, errBody, path);
            }

            return await res.json() as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
    post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('POST', path, body); }
    put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('PUT', path, body); }
    del<T>(path: string): Promise<T> { return this.request<T>('DELETE', path); }
}

// =============================================================================
// Error
// =============================================================================

export class TentaCLAWError extends Error {
    constructor(
        public statusCode: number,
        public body: string,
        public path: string,
    ) {
        super(`TentaCLAW API error ${statusCode} on ${path}: ${body}`);
        this.name = 'TentaCLAWError';
    }
}

// =============================================================================
// Resource Clients
// =============================================================================

class NodesClient {
    constructor(private http: HttpClient) {}

    list(): Promise<Node[]> {
        return this.http.get('/api/v1/nodes');
    }

    get(id: string): Promise<Node> {
        return this.http.get('/api/v1/nodes/' + encodeURIComponent(id));
    }

    register(params: { node_id: string; farm_hash: string; hostname: string; gpu_count?: number }): Promise<{ status: string; node: Node }> {
        return this.http.post('/api/v1/register', params);
    }

    delete(id: string): Promise<{ deleted: boolean }> {
        return this.http.del('/api/v1/nodes/' + encodeURIComponent(id));
    }

    tags(id: string): Promise<string[]> {
        return this.http.get('/api/v1/nodes/' + encodeURIComponent(id) + '/tags');
    }

    addTag(id: string, tag: string): Promise<{ tags: string[] }> {
        return this.http.post('/api/v1/nodes/' + encodeURIComponent(id) + '/tags', { tags: [tag] });
    }
}

class ModelsClient {
    constructor(private http: HttpClient) {}

    list(): Promise<{ models: Model[] }> {
        return this.http.get('/api/v1/models');
    }

    deploy(model: string, nodeId?: string): Promise<Record<string, unknown>> {
        return this.http.post('/api/v1/deploy', { model, node_id: nodeId });
    }

    search(query: string): Promise<unknown[]> {
        return this.http.get('/api/v1/model-search?q=' + encodeURIComponent(query));
    }

    checkFit(model: string, nodeId?: string): Promise<Record<string, unknown>> {
        const params = nodeId ? `?model=${encodeURIComponent(model)}&node=${encodeURIComponent(nodeId)}` : `?model=${encodeURIComponent(model)}`;
        return this.http.get('/api/v1/models/check-fit' + params);
    }

    smartDeploy(model: string, count?: number): Promise<Record<string, unknown>> {
        return this.http.post('/api/v1/models/smart-deploy', { model, count });
    }
}

class InferenceClient {
    constructor(private http: HttpClient) {}

    chat(model: string, message: string, options?: { system_prompt?: string; temperature?: number; max_tokens?: number; stream?: boolean }): Promise<ChatResponse> {
        const messages: Array<{ role: string; content: string }> = [];
        if (options?.system_prompt) {
            messages.push({ role: 'system', content: options.system_prompt });
        }
        messages.push({ role: 'user', content: message });

        return this.http.post('/v1/chat/completions', {
            model,
            messages,
            temperature: options?.temperature,
            max_tokens: options?.max_tokens,
            stream: options?.stream || false,
        });
    }

    complete(model: string, prompt: string): Promise<Record<string, unknown>> {
        return this.http.post('/v1/completions', { model, prompt });
    }

    embed(model: string, input: string | string[]): Promise<Record<string, unknown>> {
        return this.http.post('/v1/embeddings', { model, input });
    }

    models(): Promise<{ data: Array<{ id: string }> }> {
        return this.http.get('/v1/models');
    }
}

class ClusterClient {
    constructor(private http: HttpClient) {}

    summary(): Promise<ClusterSummary> {
        return this.http.get('/api/v1/summary');
    }

    health(): Promise<HealthScore> {
        return this.http.get('/api/v1/health/score');
    }

    healthDetailed(): Promise<Record<string, unknown>> {
        return this.http.get('/api/v1/health/detailed');
    }

    power(): Promise<Record<string, unknown>> {
        return this.http.get('/api/v1/power');
    }

    dashboard(): Promise<Record<string, unknown>> {
        return this.http.get('/api/v1/dashboard');
    }

    export(): Promise<Record<string, unknown>> {
        return this.http.get('/api/v1/export');
    }

    import(config: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.http.post('/api/v1/import', config);
    }
}

class AlertsClient {
    constructor(private http: HttpClient) {}

    list(): Promise<Alert[]> {
        return this.http.get('/api/v1/alerts');
    }

    rules(): Promise<unknown[]> {
        return this.http.get('/api/v1/alert-rules');
    }

    createRule(rule: { name: string; metric: string; operator: string; threshold: number; severity?: string }): Promise<{ id: string }> {
        return this.http.post('/api/v1/alert-rules', rule);
    }
}

class ApiKeysClient {
    constructor(private http: HttpClient) {}

    list(): Promise<ApiKey[]> {
        return this.http.get('/api/v1/apikeys');
    }

    create(name: string, permissions?: string[]): Promise<ApiKey> {
        return this.http.post('/api/v1/apikeys', { name, permissions });
    }

    revoke(id: string): Promise<{ revoked: boolean }> {
        return this.http.post('/api/v1/apikeys/' + encodeURIComponent(id) + '/revoke', {});
    }
}

// =============================================================================
// Main Client
// =============================================================================

export class TentaCLAW {
    private http: HttpClient;

    public nodes: NodesClient;
    public models: ModelsClient;
    public inference: InferenceClient;
    public cluster: ClusterClient;
    public alerts: AlertsClient;
    public apiKeys: ApiKeysClient;

    constructor(gatewayUrl: string = 'http://localhost:8080', options?: SDKOptions) {
        this.http = new HttpClient(gatewayUrl.replace(/\/$/, ''), options || {});
        this.nodes = new NodesClient(this.http);
        this.models = new ModelsClient(this.http);
        this.inference = new InferenceClient(this.http);
        this.cluster = new ClusterClient(this.http);
        this.alerts = new AlertsClient(this.http);
        this.apiKeys = new ApiKeysClient(this.http);
    }

    /** Quick health check — returns true if gateway is reachable */
    async ping(): Promise<boolean> {
        try {
            await this.http.get('/health');
            return true;
        } catch {
            return false;
        }
    }

    /** Get gateway version info */
    version(): Promise<Record<string, unknown>> {
        return this.http.get('/api/v1/version');
    }
}

// Default export
export default TentaCLAW;
