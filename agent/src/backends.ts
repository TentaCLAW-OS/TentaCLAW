// F:\tentaclaw-os\agent\src\backends.ts
// Unified Inference Backend Abstraction
// TentaCLAW says: "Ollama, vLLM, SGLang, BitNet — I run 'em all. Eight arms, remember?"

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

import {
    isBitNetInstalled,
    isBitNetRunning,
    getBitNetStatus,
    getOptimalThreads,
    startBitNetServer,
    stopBitNetServer,
} from './bitnet';

import {
    isVllmInstalled,
    getVllmStatus,
    getVllmMetrics,
    launchVllm,
    stopVllm,
} from './vllm';

// =============================================================================
// Types — The contracts every backend must fulfill
// =============================================================================

/**
 * Every inference backend implements this interface.
 * The agent uses this to manage backends uniformly.
 */
export interface InferenceBackend {
    /** Backend identifier */
    readonly type: BackendType;

    /** Default port */
    readonly defaultPort: number;

    /** Check if this backend is installed on the system */
    isInstalled(): boolean;

    /** Check if the backend server is running and healthy */
    isHealthy(): Promise<boolean>;

    /** Get the backend's current status */
    getStatus(): BackendStatus;

    /** Start the backend server */
    start(config: BackendStartConfig): Promise<boolean>;

    /** Stop the backend server */
    stop(): Promise<boolean>;

    /** Restart the backend */
    restart(): Promise<boolean>;

    /** Get loaded models */
    getLoadedModels(): Promise<string[]>;

    /** Load a model */
    loadModel(model: string, options?: ModelLoadOptions): Promise<boolean>;

    /** Unload a model */
    unloadModel(model: string): Promise<boolean>;

    /** Get performance metrics */
    getMetrics(): Promise<BackendMetrics>;

    /** Get the inference endpoint URL */
    getEndpointUrl(): string;

    /** Get supported model formats */
    getSupportedFormats(): string[];

    /** Get backend capabilities */
    getCapabilities(): BackendCapabilities;
}

export type BackendType = 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'bitnet' | 'mlx';

export interface BackendStatus {
    type: BackendType;
    installed: boolean;
    running: boolean;
    healthy: boolean;
    port: number;
    pid?: number;
    uptime_secs?: number;
    version?: string;
    loaded_models: string[];
    gpu_memory_used_mb?: number;
}

export interface BackendStartConfig {
    model?: string;
    port?: number;
    gpuDevices?: number[];
    tensorParallel?: number;
    maxModelLen?: number;
    quantization?: string;
    gpuMemoryFraction?: number;
    enablePrefixCaching?: boolean;
    maxConcurrentRequests?: number;
}

export interface ModelLoadOptions {
    quantization?: string;
    gpuLayers?: number;
    contextLength?: number;
    batchSize?: number;
}

export interface BackendMetrics {
    requests_active: number;
    requests_queued: number;
    tokens_per_second: number;
    cache_hit_rate: number;
    gpu_memory_used_mb: number;
    gpu_memory_total_mb: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    latency_p99_ms: number;
    uptime_secs: number;
}

export interface BackendCapabilities {
    streaming: boolean;
    function_calling: boolean;
    json_mode: boolean;
    vision: boolean;
    embeddings: boolean;
    continuous_batching: boolean;
    prefix_caching: boolean;
    tensor_parallelism: boolean;
    speculative_decoding: boolean;
    supported_formats: string[];  // 'gguf', 'gptq', 'awq', 'safetensors', 'fp16'
}

// =============================================================================
// Helpers
// =============================================================================

/** Default metrics when nothing is available. */
function emptyMetrics(): BackendMetrics {
    return {
        requests_active: 0,
        requests_queued: 0,
        tokens_per_second: 0,
        cache_hit_rate: 0,
        gpu_memory_used_mb: 0,
        gpu_memory_total_mb: 0,
        latency_p50_ms: 0,
        latency_p95_ms: 0,
        latency_p99_ms: 0,
        uptime_secs: 0,
    };
}

/**
 * Simple synchronous HTTP GET using curl.
 * Returns response body or null on failure.
 */
function httpGetSync(url: string, timeoutMs: number): string | null {
    try {
        return execFileSync('curl', ['-s', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
            encoding: 'utf-8',
            timeout: timeoutMs + 2000,
        });
    } catch {
        return null;
    }
}

/**
 * Async HTTP GET using Node builtins.
 * Returns response body or null on failure.
 */
function httpGetAsync(url: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: timeoutMs }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => resolve(body));
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
            resolve(null);
        }
    });
}

/**
 * Find the PID of a process listening on a given port.
 * Returns undefined if not found or if lsof is unavailable.
 */
function findPidOnPort(port: number): number | undefined {
    try {
        const output = execFileSync('lsof', ['-ti', `:${port}`], {
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();
        if (output) {
            const first = output.split('\n')[0].trim();
            const pid = parseInt(first, 10);
            return isNaN(pid) ? undefined : pid;
        }
    } catch {
        // lsof not available or no process on port
    }
    return undefined;
}

/**
 * Query nvidia-smi for GPU memory stats.
 * Returns { used, total } in MB, or null if nvidia-smi unavailable.
 */
function getGpuMemoryFromNvidiaSmi(): { used: number; total: number } | null {
    try {
        const nvsmiOut = execFileSync('nvidia-smi', [
            '--query-gpu=memory.used,memory.total',
            '--format=csv,noheader,nounits',
        ], { encoding: 'utf-8', timeout: 5000 }).trim();
        const lines = nvsmiOut.split('\n');
        let totalUsed = 0;
        let totalMem = 0;
        for (const line of lines) {
            const [used, total] = line.split(',').map((v) => parseFloat(v.trim()));
            if (!isNaN(used)) totalUsed += used;
            if (!isNaN(total)) totalMem += total;
        }
        return { used: totalUsed, total: totalMem };
    } catch {
        return null;
    }
}


// =============================================================================
// OllamaBackend
// =============================================================================

/**
 * OllamaBackend — wraps the Ollama CLI and REST API.
 *
 * Detection: `ollama --version`
 * Health: GET http://localhost:11434/api/tags
 * Models: /api/tags endpoint returns loaded models
 * Start/Stop: systemctl or direct process management
 */
export class OllamaBackend implements InferenceBackend {
    readonly type: BackendType = 'ollama';
    readonly defaultPort = 11434;

    private port: number;
    private _startedAt: number | null = null;

    constructor(port?: number) {
        this.port = port ?? this.defaultPort;
    }

    isInstalled(): boolean {
        try {
            execFileSync('ollama', ['--version'], {
                encoding: 'utf-8',
                timeout: 5000,
                stdio: 'pipe',
            });
            return true;
        } catch {
            return false;
        }
    }

    async isHealthy(): Promise<boolean> {
        const body = await httpGetAsync(`http://localhost:${this.port}/api/tags`, 3000);
        if (!body) return false;
        try {
            const data = JSON.parse(body);
            return Array.isArray(data?.models);
        } catch {
            return false;
        }
    }

    getStatus(): BackendStatus {
        const installed = this.isInstalled();
        let running = false;
        let healthy = false;
        let version: string | undefined;
        let loadedModels: string[] = [];

        if (installed) {
            // Get version
            try {
                const raw = execFileSync('ollama', ['--version'], {
                    encoding: 'utf-8',
                    timeout: 3000,
                    stdio: 'pipe',
                }).trim();
                version = raw.replace('ollama version is ', '');
            } catch {
                // version unavailable
            }

            // Check health + models
            const body = httpGetSync(`http://localhost:${this.port}/api/tags`, 3000);
            if (body) {
                try {
                    const data = JSON.parse(body);
                    if (Array.isArray(data?.models)) {
                        running = true;
                        healthy = true;
                        loadedModels = data.models.map((m: { name: string }) => m.name);
                    }
                } catch {
                    // parse failed but something responded — running but unhealthy
                    running = true;
                }
            }
        }

        const pid = findPidOnPort(this.port);

        return {
            type: this.type,
            installed,
            running,
            healthy,
            port: this.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            version,
            loaded_models: loadedModels,
        };
    }

    // Note: start() uses execSync with shell features (systemctl, nohup, &, redirection)
    // for process management. All arguments are internal constants, not user input.
    async start(_config: BackendStartConfig): Promise<boolean> {
        if (await this.isHealthy()) {
            console.log(`[ollama] Already running on port ${this.port}`);
            return true;
        }

        try {
            // Try systemctl first, fall back to direct launch
            try {
                execSync('systemctl start ollama 2>/dev/null', { timeout: 10000 });
            } catch {
                // systemctl not available or failed — launch directly
                execSync('nohup ollama serve > /var/log/ollama.log 2>&1 &', { timeout: 5000 });
            }

            // Wait for it to come up (poll up to 15 seconds)
            for (let i = 0; i < 15; i++) {
                execFileSync('sleep', ['1']);
                if (await this.isHealthy()) {
                    this._startedAt = Date.now();
                    console.log('[ollama] Server started successfully');
                    return true;
                }
            }

            console.error('[ollama] Server launched but did not become healthy within 15s');
            return false;
        } catch (err) {
            console.error('[ollama] Failed to start:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async stop(): Promise<boolean> {
        if (!(await this.isHealthy())) {
            console.log('[ollama] Server is not running');
            return true;
        }

        try {
            // Try systemctl first, then direct kill
            try {
                execSync('systemctl stop ollama 2>/dev/null', { timeout: 10000 });
            } catch {
                const pid = findPidOnPort(this.port);
                if (pid) {
                    execFileSync('kill', [String(pid)], { timeout: 5000 });
                } else {
                    execSync('pkill -x ollama 2>/dev/null', { timeout: 5000 });
                }
            }

            // Verify
            execFileSync('sleep', ['2']);
            if (!(await this.isHealthy())) {
                this._startedAt = null;
                console.log('[ollama] Server stopped successfully');
                return true;
            }

            // Force kill
            console.log('[ollama] Still running, force killing...');
            execSync('pkill -9 -x ollama 2>/dev/null', { timeout: 5000 });
            execFileSync('sleep', ['1']);
            this._startedAt = null;
            return !(await this.isHealthy());
        } catch (err) {
            console.error('[ollama] Failed to stop:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async restart(): Promise<boolean> {
        await this.stop();
        return this.start({});
    }

    async getLoadedModels(): Promise<string[]> {
        const body = await httpGetAsync(`http://localhost:${this.port}/api/tags`, 3000);
        if (!body) return [];
        try {
            const data = JSON.parse(body);
            return data.models?.map((m: { name: string }) => m.name) ?? [];
        } catch {
            return [];
        }
    }

    async loadModel(model: string, _options?: ModelLoadOptions): Promise<boolean> {
        try {
            console.log(`[ollama] Pulling model ${model}...`);
            execFileSync('ollama', ['pull', model], {
                timeout: 600000, // 10 min for large models
                stdio: 'pipe',
            });

            // Verify it's now in the list
            const models = await this.getLoadedModels();
            return models.some((m) => m === model || m.startsWith(model + ':'));
        } catch (err) {
            console.error(`[ollama] Failed to pull model ${model}:`, err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async unloadModel(model: string): Promise<boolean> {
        try {
            execFileSync('ollama', ['rm', model], {
                timeout: 30000,
                stdio: 'pipe',
            });
            console.log(`[ollama] Removed model ${model}`);
            return true;
        } catch (err) {
            console.error(`[ollama] Failed to remove model ${model}:`, err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async getMetrics(): Promise<BackendMetrics> {
        const metrics = emptyMetrics();

        // Ollama does not expose a Prometheus /metrics endpoint natively.
        // Estimate from GPU stats if available.
        const gpuMem = getGpuMemoryFromNvidiaSmi();
        if (gpuMem) {
            metrics.gpu_memory_used_mb = gpuMem.used;
            metrics.gpu_memory_total_mb = gpuMem.total;
        }

        return metrics;
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.port}`;
    }

    getSupportedFormats(): string[] {
        return ['gguf'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: true,
            json_mode: true,
            vision: true,
            embeddings: true,
            continuous_batching: false,
            prefix_caching: false,
            tensor_parallelism: false,
            speculative_decoding: false,
            supported_formats: ['gguf'],
        };
    }
}

// =============================================================================
// VllmBackend
// =============================================================================

/**
 * VllmBackend — wraps the existing vllm.ts functions behind InferenceBackend.
 *
 * vLLM provides OpenAI-compatible API on port 8000 with PagedAttention,
 * continuous batching, and tensor parallelism.
 */
export class VllmBackend implements InferenceBackend {
    readonly type: BackendType = 'vllm';
    readonly defaultPort = 8000;

    private port: number;
    private _startedAt: number | null = null;

    constructor(port?: number) {
        this.port = port ?? this.defaultPort;
    }

    isInstalled(): boolean {
        return isVllmInstalled();
    }

    async isHealthy(): Promise<boolean> {
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return false;
        try {
            const data = JSON.parse(body);
            return Array.isArray(data?.data);
        } catch {
            return false;
        }
    }

    getStatus(): BackendStatus {
        const status = getVllmStatus();
        const pid = findPidOnPort(this.port);

        return {
            type: this.type,
            installed: status.installed,
            running: status.running,
            healthy: status.running,
            port: this.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            version: status.version ?? undefined,
            loaded_models: status.models,
        };
    }

    async start(config: BackendStartConfig): Promise<boolean> {
        if (await this.isHealthy()) {
            console.log(`[vllm] Already running on port ${this.port}`);
            return true;
        }

        if (!config.model) {
            console.error('[vllm] Cannot start without a model. Provide config.model.');
            return false;
        }

        const result = await launchVllm({
            model: config.model,
            tensorParallel: config.tensorParallel,
            maxModelLen: config.maxModelLen,
            quantization: (config.quantization as 'awq' | 'gptq' | 'squeezellm' | 'fp8') ?? null,
            port: config.port ?? this.port,
        });

        if (result) {
            this._startedAt = Date.now();
        }
        return result;
    }

    async stop(): Promise<boolean> {
        const result = await stopVllm();
        if (result) {
            this._startedAt = null;
        }
        return result;
    }

    async restart(): Promise<boolean> {
        // vLLM restart requires knowing which model was loaded
        const status = this.getStatus();
        await this.stop();
        const model = status.loaded_models[0];
        if (!model) {
            console.error('[vllm] Cannot restart — no model was loaded. Start with a model config instead.');
            return false;
        }
        return this.start({ model });
    }

    async getLoadedModels(): Promise<string[]> {
        const status = getVllmStatus(this.port);
        return status.models;
    }

    async loadModel(model: string, _options?: ModelLoadOptions): Promise<boolean> {
        // vLLM loads one model at startup. To load a different model,
        // we must restart the server with the new model via launchVllm
        // (which handles stopping the current server automatically).
        console.log(`[vllm] Loading model requires server restart...`);
        return this.start({ model });
    }

    async unloadModel(_model: string): Promise<boolean> {
        // vLLM only serves one model — unloading means stopping the server
        console.log('[vllm] Unloading model by stopping server');
        return this.stop();
    }

    async getMetrics(): Promise<BackendMetrics> {
        const metrics = emptyMetrics();
        const vllmMetrics = getVllmMetrics();

        if (vllmMetrics) {
            metrics.requests_active = vllmMetrics.numRequestsRunning;
            metrics.requests_queued = vllmMetrics.numRequestsWaiting;
            if (vllmMetrics.gpuCacheUsagePct > 0) {
                metrics.cache_hit_rate = vllmMetrics.gpuCacheUsagePct;
            }
            if (vllmMetrics.avgGenerationThroughputToksPerSec > 0) {
                metrics.tokens_per_second = vllmMetrics.avgGenerationThroughputToksPerSec;
            }
        }

        const gpuMem = getGpuMemoryFromNvidiaSmi();
        if (gpuMem) {
            metrics.gpu_memory_used_mb = gpuMem.used;
            metrics.gpu_memory_total_mb = gpuMem.total;
        }

        return metrics;
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.port}`;
    }

    getSupportedFormats(): string[] {
        return ['safetensors', 'gptq', 'awq', 'fp16'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: true,
            json_mode: true,
            vision: true,
            embeddings: true,
            continuous_batching: true,
            prefix_caching: true,
            tensor_parallelism: true,
            speculative_decoding: true,
            supported_formats: ['safetensors', 'gptq', 'awq', 'fp16'],
        };
    }
}

// =============================================================================
// SglangBackend
// =============================================================================

/**
 * SglangBackend — wraps SGLang inference server.
 *
 * SGLang provides RadixAttention for fast prefix caching and an
 * OpenAI-compatible API on port 30000 by default.
 */
export class SglangBackend implements InferenceBackend {
    readonly type: BackendType = 'sglang';
    readonly defaultPort = 30000;

    private port: number;
    private _startedAt: number | null = null;

    constructor(port?: number) {
        this.port = port ?? this.defaultPort;
    }

    isInstalled(): boolean {
        try {
            execFileSync('python3', ['-c', 'import sglang'], {
                encoding: 'utf-8',
                timeout: 10000,
                stdio: 'pipe',
            });
            return true;
        } catch {
            try {
                execFileSync('python', ['-c', 'import sglang'], {
                    encoding: 'utf-8',
                    timeout: 10000,
                    stdio: 'pipe',
                });
                return true;
            } catch {
                return false;
            }
        }
    }

    async isHealthy(): Promise<boolean> {
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return false;
        try {
            const data = JSON.parse(body);
            return Array.isArray(data?.data);
        } catch {
            return false;
        }
    }

    getStatus(): BackendStatus {
        const installed = this.isInstalled();
        let running = false;
        let healthy = false;
        let version: string | undefined;
        const loadedModels: string[] = [];

        if (installed) {
            try {
                const versionOutput = execFileSync('python3', ['-c', 'import sglang; print(sglang.__version__)'], {
                    encoding: 'utf-8',
                    timeout: 10000,
                    stdio: 'pipe',
                }).trim();
                if (versionOutput) {
                    version = versionOutput;
                }
            } catch {
                // version unavailable
            }

            const body = httpGetSync(`http://localhost:${this.port}/v1/models`, 3000);
            if (body) {
                try {
                    const data = JSON.parse(body);
                    if (Array.isArray(data?.data)) {
                        running = true;
                        healthy = true;
                        for (const m of data.data) {
                            loadedModels.push(m.id);
                        }
                    }
                } catch {
                    running = true;
                }
            }
        }

        const pid = findPidOnPort(this.port);

        return {
            type: this.type,
            installed,
            running,
            healthy,
            port: this.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            version,
            loaded_models: loadedModels,
        };
    }

    // Note: start() uses execSync with shell features (nohup, &, redirection)
    // for background process management. Arguments are from config params, not user input.
    async start(config: BackendStartConfig): Promise<boolean> {
        if (await this.isHealthy()) {
            console.log(`[sglang] Already running on port ${this.port}`);
            return true;
        }

        if (!config.model) {
            console.error('[sglang] Cannot start without a model. Provide config.model.');
            return false;
        }

        if (!this.isInstalled()) {
            console.error('[sglang] Not installed. Run: pip install "sglang[all]"');
            return false;
        }

        const port = config.port ?? this.port;
        const args: string[] = [
            '-m', 'sglang.launch_server',
            '--model-path', config.model,
            '--port', String(port),
        ];

        if (config.tensorParallel && config.tensorParallel > 1) {
            args.push('--tp', String(config.tensorParallel));
        }
        if (config.maxModelLen) {
            args.push('--context-length', String(config.maxModelLen));
        }
        if (config.quantization) {
            args.push('--quantization', config.quantization);
        }

        try {
            const cmdArgs = args.map((a) => `"${a}"`).join(' ');
            console.log(`[sglang] Starting server — model=${config.model}, port=${port}`);
            execSync(
                `nohup python3 ${cmdArgs} > /var/log/sglang-server.log 2>&1 &`,
                { timeout: 10000 }
            );

            // SGLang takes time to load — poll for up to 90 seconds
            console.log('[sglang] Waiting for server to load model...');
            for (let i = 0; i < 18; i++) {
                execFileSync('sleep', ['5']);
                if (await this.isHealthy()) {
                    this._startedAt = Date.now();
                    console.log('[sglang] Server started successfully');
                    return true;
                }
            }

            console.error('[sglang] Server launched but did not become ready within 90 seconds');
            return false;
        } catch (err) {
            console.error('[sglang] Failed to start:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async stop(): Promise<boolean> {
        if (!(await this.isHealthy())) {
            console.log('[sglang] Server is not running');
            return true;
        }

        try {
            const pid = findPidOnPort(this.port);
            if (pid) {
                execFileSync('kill', [String(pid)], { timeout: 5000 });
                execFileSync('sleep', ['2']);
                if (!(await this.isHealthy())) {
                    this._startedAt = null;
                    console.log('[sglang] Server stopped successfully');
                    return true;
                }
                // Force kill
                try {
                    execFileSync('kill', ['-9', String(pid)], { timeout: 5000 });
                } catch { /* may already be gone */ }
            }
            this._startedAt = null;
            return !(await this.isHealthy());
        } catch (err) {
            console.error('[sglang] Failed to stop:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async restart(): Promise<boolean> {
        const status = this.getStatus();
        await this.stop();
        const model = status.loaded_models[0];
        if (!model) {
            console.error('[sglang] Cannot restart — no model was loaded.');
            return false;
        }
        return this.start({ model });
    }

    async getLoadedModels(): Promise<string[]> {
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return [];
        try {
            const data = JSON.parse(body);
            return data.data?.map((m: { id: string }) => m.id) ?? [];
        } catch {
            return [];
        }
    }

    async loadModel(model: string, _options?: ModelLoadOptions): Promise<boolean> {
        console.log('[sglang] Loading model requires server restart');
        await this.stop();
        return this.start({ model });
    }

    async unloadModel(_model: string): Promise<boolean> {
        console.log('[sglang] Unloading model by stopping server');
        return this.stop();
    }

    async getMetrics(): Promise<BackendMetrics> {
        const metrics = emptyMetrics();

        const gpuMem = getGpuMemoryFromNvidiaSmi();
        if (gpuMem) {
            metrics.gpu_memory_used_mb = gpuMem.used;
            metrics.gpu_memory_total_mb = gpuMem.total;
        }

        return metrics;
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.port}`;
    }

    getSupportedFormats(): string[] {
        return ['safetensors', 'gptq', 'awq', 'fp16'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: true,
            json_mode: true,
            vision: true,
            embeddings: true,
            continuous_batching: true,
            prefix_caching: true,  // RadixAttention
            tensor_parallelism: true,
            speculative_decoding: true,
            supported_formats: ['safetensors', 'gptq', 'awq', 'fp16'],
        };
    }
}

// =============================================================================
// LlamaCppBackend
// =============================================================================

/**
 * LlamaCppBackend — wraps llama.cpp's server mode.
 *
 * llama.cpp runs GGUF models on CPU and GPU with a lightweight HTTP server.
 * Default port 8080.
 */
export class LlamaCppBackend implements InferenceBackend {
    readonly type: BackendType = 'llamacpp';
    readonly defaultPort = 8080;

    private port: number;
    private _startedAt: number | null = null;

    /** Known paths for the llama.cpp server binary. */
    private static readonly BINARY_PATHS = [
        '/usr/local/bin/llama-server',
        '/usr/local/bin/server',          // older builds
        '/opt/llama.cpp/build/bin/server',
        '/opt/llama.cpp/server',
    ];

    constructor(port?: number) {
        this.port = port ?? this.defaultPort;
    }

    private findBinary(): string | null {
        for (const p of LlamaCppBackend.BINARY_PATHS) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        // Check PATH
        try {
            const which = execFileSync('which', ['llama-server'], {
                encoding: 'utf-8',
                timeout: 3000,
                stdio: 'pipe',
            }).trim();
            if (which) return which;
        } catch {
            // not in PATH
        }
        return null;
    }

    isInstalled(): boolean {
        return this.findBinary() !== null;
    }

    async isHealthy(): Promise<boolean> {
        const body = await httpGetAsync(`http://localhost:${this.port}/health`, 3000);
        if (!body) return false;
        try {
            const data = JSON.parse(body);
            return data.status === 'ok' || data.status === 'no slot available';
        } catch {
            // Some versions return plain text "ok"
            return body.trim().toLowerCase() === 'ok';
        }
    }

    getStatus(): BackendStatus {
        const installed = this.isInstalled();
        let running = false;
        let healthy = false;

        const body = httpGetSync(`http://localhost:${this.port}/health`, 3000);
        if (body) {
            running = true;
            try {
                const data = JSON.parse(body);
                healthy = data.status === 'ok' || data.status === 'no slot available';
            } catch {
                healthy = body.trim().toLowerCase() === 'ok';
            }
        }

        const pid = findPidOnPort(this.port);

        return {
            type: this.type,
            installed,
            running,
            healthy,
            port: this.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            loaded_models: [],
        };
    }

    // Note: start() uses execSync with shell features (nohup, &, redirection)
    // for background process management. Binary path and args are from trusted sources.
    async start(config: BackendStartConfig): Promise<boolean> {
        if (await this.isHealthy()) {
            console.log(`[llamacpp] Already running on port ${this.port}`);
            return true;
        }

        const binary = this.findBinary();
        if (!binary) {
            console.error('[llamacpp] No llama-server binary found.');
            return false;
        }

        if (!config.model) {
            console.error('[llamacpp] Cannot start without a model path. Provide config.model.');
            return false;
        }

        const port = config.port ?? this.port;
        const args: string[] = [
            '-m', config.model,
            '--port', String(port),
        ];
        if (config.maxConcurrentRequests) {
            args.push('-np', String(config.maxConcurrentRequests));
        }
        if (config.maxModelLen) {
            args.push('-c', String(config.maxModelLen));
        }

        try {
            const cmdArgs = args.map((a) => `"${a}"`).join(' ');
            console.log(`[llamacpp] Starting server — model=${config.model}, port=${port}`);
            execSync(
                `nohup "${binary}" ${cmdArgs} > /var/log/llamacpp-server.log 2>&1 &`,
                { timeout: 10000 }
            );

            // Poll for readiness
            for (let i = 0; i < 30; i++) {
                execFileSync('sleep', ['1']);
                if (await this.isHealthy()) {
                    this._startedAt = Date.now();
                    console.log('[llamacpp] Server started successfully');
                    return true;
                }
            }

            console.error('[llamacpp] Server launched but did not become healthy within 30s');
            return false;
        } catch (err) {
            console.error('[llamacpp] Failed to start:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async stop(): Promise<boolean> {
        if (!(await this.isHealthy())) {
            console.log('[llamacpp] Server is not running');
            return true;
        }

        try {
            const pid = findPidOnPort(this.port);
            if (pid) {
                execFileSync('kill', [String(pid)], { timeout: 5000 });
                execFileSync('sleep', ['2']);
                if (!(await this.isHealthy())) {
                    this._startedAt = null;
                    console.log('[llamacpp] Server stopped successfully');
                    return true;
                }
                try {
                    execFileSync('kill', ['-9', String(pid)], { timeout: 5000 });
                } catch { /* may already be gone */ }
            }
            this._startedAt = null;
            return !(await this.isHealthy());
        } catch (err) {
            console.error('[llamacpp] Failed to stop:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async restart(): Promise<boolean> {
        await this.stop();
        // Cannot restart without knowing the model; caller must call start() with config
        console.error('[llamacpp] Restart requires calling start() with a model config.');
        return false;
    }

    async getLoadedModels(): Promise<string[]> {
        // llama.cpp server loads one model; check /v1/models if available
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return [];
        try {
            const data = JSON.parse(body);
            return data.data?.map((m: { id: string }) => m.id) ?? [];
        } catch {
            return [];
        }
    }

    async loadModel(_model: string, _options?: ModelLoadOptions): Promise<boolean> {
        console.error('[llamacpp] llama.cpp server loads one model at startup. Restart with the desired model.');
        return false;
    }

    async unloadModel(_model: string): Promise<boolean> {
        return this.stop();
    }

    async getMetrics(): Promise<BackendMetrics> {
        return emptyMetrics();
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.port}`;
    }

    getSupportedFormats(): string[] {
        return ['gguf'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: false,
            json_mode: true,
            vision: true,
            embeddings: true,
            continuous_batching: true,
            prefix_caching: false,
            tensor_parallelism: false,
            speculative_decoding: true,
            supported_formats: ['gguf'],
        };
    }
}

// =============================================================================
// BitNetBackend
// =============================================================================

/**
 * BitNetBackend — wraps the existing bitnet.ts functions behind InferenceBackend.
 *
 * BitNet runs 1-bit quantized models on CPU with 2-6x speedup vs FP16.
 * Perfect for CPU-only nodes where GPU inference isn't an option.
 */
export class BitNetBackend implements InferenceBackend {
    readonly type: BackendType = 'bitnet';
    readonly defaultPort = 8082;

    private _startedAt: number | null = null;

    isInstalled(): boolean {
        return isBitNetInstalled();
    }

    async isHealthy(): Promise<boolean> {
        return isBitNetRunning();
    }

    getStatus(): BackendStatus {
        const status = getBitNetStatus();
        const pid = findPidOnPort(this.defaultPort);

        return {
            type: this.type,
            installed: status.installed,
            running: status.running,
            healthy: status.running,
            port: status.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            version: 'bitnet',
            loaded_models: status.model ? [status.model] : [],
        };
    }

    async start(config: BackendStartConfig): Promise<boolean> {
        const model = config.model ?? 'bitnet-b1.58-2B';
        const threads = getOptimalThreads();
        const result = startBitNetServer(model, threads);
        if (result) {
            this._startedAt = Date.now();
        }
        return result;
    }

    async stop(): Promise<boolean> {
        const result = stopBitNetServer();
        if (result) {
            this._startedAt = null;
        }
        return result;
    }

    async restart(): Promise<boolean> {
        const status = getBitNetStatus();
        await this.stop();
        return this.start({ model: status.model ?? undefined });
    }

    async getLoadedModels(): Promise<string[]> {
        const status = getBitNetStatus();
        return status.model ? [status.model] : [];
    }

    async loadModel(model: string, _options?: ModelLoadOptions): Promise<boolean> {
        // BitNet loads one model at startup; restart with the new model
        await this.stop();
        return this.start({ model });
    }

    async unloadModel(_model: string): Promise<boolean> {
        return this.stop();
    }

    async getMetrics(): Promise<BackendMetrics> {
        const metrics = emptyMetrics();

        // BitNet is CPU-only: no GPU memory
        if (isBitNetRunning()) {
            metrics.requests_active = 1;
        }

        return metrics;
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.defaultPort}`;
    }

    getSupportedFormats(): string[] {
        return ['bitnet'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: false,
            json_mode: false,
            vision: false,
            embeddings: false,
            continuous_batching: false,
            prefix_caching: false,
            tensor_parallelism: false,
            speculative_decoding: false,
            supported_formats: ['bitnet'],
        };
    }
}

// =============================================================================
// MlxBackend
// =============================================================================

/**
 * MlxBackend — wraps Apple MLX inference for Apple Silicon Macs.
 *
 * MLX provides native Metal-accelerated inference on M1/M2/M3/M4 chips
 * with unified memory. Uses mlx-lm serve for OpenAI-compatible API.
 */
export class MlxBackend implements InferenceBackend {
    readonly type: BackendType = 'mlx';
    readonly defaultPort = 8081;

    private port: number;
    private _startedAt: number | null = null;

    constructor(port?: number) {
        this.port = port ?? this.defaultPort;
    }

    isInstalled(): boolean {
        // MLX only works on Apple Silicon
        if (os.platform() !== 'darwin') return false;

        try {
            execFileSync('python3', ['-c', 'import mlx_lm'], {
                encoding: 'utf-8',
                timeout: 10000,
                stdio: 'pipe',
            });
            return true;
        } catch {
            return false;
        }
    }

    async isHealthy(): Promise<boolean> {
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return false;
        try {
            const data = JSON.parse(body);
            return Array.isArray(data?.data);
        } catch {
            return false;
        }
    }

    getStatus(): BackendStatus {
        const installed = this.isInstalled();
        let running = false;
        let healthy = false;
        let version: string | undefined;
        const loadedModels: string[] = [];

        if (installed) {
            try {
                const versionOutput = execFileSync('python3', ['-c', 'import mlx; print(mlx.__version__)'], {
                    encoding: 'utf-8',
                    timeout: 10000,
                    stdio: 'pipe',
                }).trim();
                if (versionOutput) version = versionOutput;
            } catch {
                // version unavailable
            }

            const body = httpGetSync(`http://localhost:${this.port}/v1/models`, 3000);
            if (body) {
                try {
                    const data = JSON.parse(body);
                    if (Array.isArray(data?.data)) {
                        running = true;
                        healthy = true;
                        for (const m of data.data) {
                            loadedModels.push(m.id);
                        }
                    }
                } catch {
                    running = true;
                }
            }
        }

        const pid = findPidOnPort(this.port);

        return {
            type: this.type,
            installed,
            running,
            healthy,
            port: this.port,
            pid,
            uptime_secs: this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : undefined,
            version,
            loaded_models: loadedModels,
        };
    }

    // Note: start() uses execSync with shell features (nohup, &, redirection)
    // for background process management. Arguments are from config params, not user input.
    async start(config: BackendStartConfig): Promise<boolean> {
        if (await this.isHealthy()) {
            console.log(`[mlx] Already running on port ${this.port}`);
            return true;
        }

        if (!this.isInstalled()) {
            console.error('[mlx] Not installed. Run: pip install mlx-lm');
            return false;
        }

        if (!config.model) {
            console.error('[mlx] Cannot start without a model. Provide config.model.');
            return false;
        }

        const port = config.port ?? this.port;

        try {
            console.log(`[mlx] Starting server — model=${config.model}, port=${port}`);
            execSync(
                `nohup python3 -m mlx_lm.server --model "${config.model}" --port ${port} > /var/log/mlx-server.log 2>&1 &`,
                { timeout: 10000 }
            );

            // Poll for readiness
            for (let i = 0; i < 30; i++) {
                execFileSync('sleep', ['2']);
                if (await this.isHealthy()) {
                    this._startedAt = Date.now();
                    console.log('[mlx] Server started successfully');
                    return true;
                }
            }

            console.error('[mlx] Server launched but did not become ready within 60s');
            return false;
        } catch (err) {
            console.error('[mlx] Failed to start:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async stop(): Promise<boolean> {
        if (!(await this.isHealthy())) {
            console.log('[mlx] Server is not running');
            return true;
        }

        try {
            const pid = findPidOnPort(this.port);
            if (pid) {
                execFileSync('kill', [String(pid)], { timeout: 5000 });
                execFileSync('sleep', ['2']);
                if (!(await this.isHealthy())) {
                    this._startedAt = null;
                    console.log('[mlx] Server stopped successfully');
                    return true;
                }
                try {
                    execFileSync('kill', ['-9', String(pid)], { timeout: 5000 });
                } catch { /* may already be gone */ }
            }
            this._startedAt = null;
            return !(await this.isHealthy());
        } catch (err) {
            console.error('[mlx] Failed to stop:', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async restart(): Promise<boolean> {
        const status = this.getStatus();
        await this.stop();
        const model = status.loaded_models[0];
        if (!model) {
            console.error('[mlx] Cannot restart — no model was loaded.');
            return false;
        }
        return this.start({ model });
    }

    async getLoadedModels(): Promise<string[]> {
        const body = await httpGetAsync(`http://localhost:${this.port}/v1/models`, 3000);
        if (!body) return [];
        try {
            const data = JSON.parse(body);
            return data.data?.map((m: { id: string }) => m.id) ?? [];
        } catch {
            return [];
        }
    }

    async loadModel(model: string, _options?: ModelLoadOptions): Promise<boolean> {
        console.log('[mlx] Loading model requires server restart');
        await this.stop();
        return this.start({ model });
    }

    async unloadModel(_model: string): Promise<boolean> {
        return this.stop();
    }

    async getMetrics(): Promise<BackendMetrics> {
        // MLX uses unified memory; no separate GPU memory tracking
        return emptyMetrics();
    }

    getEndpointUrl(): string {
        return `http://localhost:${this.port}`;
    }

    getSupportedFormats(): string[] {
        return ['safetensors', 'gguf', 'fp16'];
    }

    getCapabilities(): BackendCapabilities {
        return {
            streaming: true,
            function_calling: true,
            json_mode: true,
            vision: true,
            embeddings: true,
            continuous_batching: false,
            prefix_caching: false,
            tensor_parallelism: false,
            speculative_decoding: false,
            supported_formats: ['safetensors', 'gguf', 'fp16'],
        };
    }
}

// =============================================================================
// BackendRegistry — The Brain That Manages All Backends
// =============================================================================

/**
 * BackendRegistry manages all known inference backends.
 * Register backends, query their status, and pick the best one for a workload.
 *
 * TentaCLAW says: "I know where every tentacle is at all times."
 */
export class BackendRegistry {
    private backends = new Map<BackendType, InferenceBackend>();

    /** Register a backend implementation. */
    register(backend: InferenceBackend): void {
        this.backends.set(backend.type, backend);
    }

    /** Get a specific backend by type. */
    get(type: BackendType): InferenceBackend | undefined {
        return this.backends.get(type);
    }

    /** Get all registered backends. */
    getAll(): InferenceBackend[] {
        return Array.from(this.backends.values());
    }

    /** Detect which registered backends are actually installed on this system. */
    detectAvailable(): BackendType[] {
        const available: BackendType[] = [];
        for (const [type, backend] of this.backends) {
            if (backend.isInstalled()) {
                available.push(type);
            }
        }
        return available;
    }

    /**
     * Pick the best backend for a given model and available VRAM.
     *
     * Strategy:
     *   1. BitNet models always go to the BitNet backend (CPU-only, no VRAM needed)
     *   2. CPU-only nodes (vramMb <= 0): prefer BitNet, then Ollama CPU mode
     *   3. Apple Silicon with MLX: prefer MLX for unified memory efficiency
     *   4. High VRAM (>=24GB): prefer vLLM or SGLang (continuous batching, prefix caching)
     *   5. Moderate VRAM: prefer Ollama (easiest model management)
     *   6. Fallback: first available backend
     */
    getBestForModel(model: string, vramMb: number): BackendType {
        const available = this.detectAvailable();

        // BitNet models go to BitNet backend
        if (model.toLowerCase().includes('bitnet') && available.includes('bitnet')) {
            return 'bitnet';
        }

        // CPU-only node: prefer BitNet, then Ollama (CPU mode)
        if (vramMb <= 0) {
            if (available.includes('bitnet')) return 'bitnet';
            if (available.includes('ollama')) return 'ollama';
            if (available.includes('llamacpp')) return 'llamacpp';
            return available[0] ?? 'ollama';
        }

        // Apple Silicon with MLX
        if (os.platform() === 'darwin' && available.includes('mlx')) {
            return 'mlx';
        }

        // High VRAM: prefer vLLM or SGLang for production workloads
        if (vramMb >= 24000) {
            if (available.includes('vllm')) return 'vllm';
            if (available.includes('sglang')) return 'sglang';
        }

        // Moderate VRAM: Ollama is easiest
        if (available.includes('ollama')) return 'ollama';

        // Fallback chain
        if (available.includes('vllm')) return 'vllm';
        if (available.includes('sglang')) return 'sglang';
        if (available.includes('llamacpp')) return 'llamacpp';

        return available[0] ?? 'ollama';
    }

    /** Get status for all registered backends. */
    getStatus(): Map<BackendType, BackendStatus> {
        const statuses = new Map<BackendType, BackendStatus>();
        for (const [type, backend] of this.backends) {
            statuses.set(type, backend.getStatus());
        }
        return statuses;
    }
}

// =============================================================================
// Factory — Create a Fully Initialized Registry
// =============================================================================

/**
 * Create and return a fully initialized registry with all known backends.
 * Each backend is registered regardless of whether it's installed — the
 * registry's detectAvailable() method handles filtering.
 */
export function createBackendRegistry(): BackendRegistry {
    const registry = new BackendRegistry();

    registry.register(new OllamaBackend());
    registry.register(new VllmBackend());
    registry.register(new SglangBackend());
    registry.register(new LlamaCppBackend());
    registry.register(new BitNetBackend());
    registry.register(new MlxBackend());

    return registry;
}
