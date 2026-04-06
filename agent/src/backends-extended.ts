/**
 * Extended Inference Backends — Aphrodite, KoboldCpp, ExLlamaV2, LM Studio, TabbyAPI, TensorRT-LLM
 * These backends are detected via their running HTTP endpoints, not CLI probing.
 * TentaCLAW says: "Twelve arms? Even better."
 */
import { type InferenceBackend, type BackendType, type BackendStatus, type BackendMetrics, type BackendCapabilities } from './backends';
import * as fs from 'fs';

/** Detect installation by checking for known file paths */
function fileExists(path: string): boolean {
    try { return fs.existsSync(path); } catch { return false; }
}

/** Probe an HTTP endpoint to check if a backend is running */
async function probeEndpoint(port: number, path: string, timeout = 3000): Promise<boolean> {
    try {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeout) });
        return r.ok || r.status === 422;
    } catch { return false; }
}

/** Fetch model list from an OpenAI-compatible /v1/models endpoint */
async function fetchModels(port: number, path = '/v1/models'): Promise<string[]> {
    try {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) });
        const d = await r.json() as any;
        return (d.data || []).map((m: any) => m.id);
    } catch { return []; }
}

const zeroMetrics: BackendMetrics = { requests_active: 0, requests_queued: 0, tokens_per_second: 0, cache_hit_rate: 0, gpu_memory_used_mb: 0, gpu_memory_total_mb: 0, latency_p50_ms: 0, latency_p95_ms: 0, latency_p99_ms: 0, uptime_secs: 0 };
const noop = async () => false;

function makeStatus(type: BackendType, port: number, installed: boolean): BackendStatus {
    return { type, installed, running: false, healthy: false, port, loaded_models: [] };
}

// --- Aphrodite Engine (port 2242) — EXL2/GPTQ/AWQ/GGUF, advanced sampling ---
export class AphroditeBackend implements InferenceBackend {
    readonly type: BackendType = 'aphrodite';
    readonly defaultPort = 2242;
    isInstalled(): boolean { return fileExists('/usr/local/bin/aphrodite') || fileExists('/opt/aphrodite'); }
    async isHealthy(): Promise<boolean> { return probeEndpoint(this.defaultPort, '/v1/models'); }
    getStatus(): BackendStatus { return makeStatus('aphrodite', this.defaultPort, this.isInstalled()); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> { return fetchModels(this.defaultPort); }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['exl2', 'gptq', 'awq', 'gguf', 'fp16']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: false, json_mode: false, vision: false, embeddings: false, continuous_batching: true, prefix_caching: false, tensor_parallelism: false, speculative_decoding: false, supported_formats: ['exl2', 'gptq', 'awq', 'gguf'] }; }
}

// --- KoboldCpp (port 5001) — llama.cpp fork, KoboldAI + OpenAI APIs ---
export class KoboldCppBackend implements InferenceBackend {
    readonly type: BackendType = 'koboldcpp';
    readonly defaultPort = 5001;
    isInstalled(): boolean { return fileExists('/usr/local/bin/koboldcpp') || fileExists('/opt/koboldcpp/koboldcpp.py'); }
    async isHealthy(): Promise<boolean> { return probeEndpoint(this.defaultPort, '/api/v1/model'); }
    getStatus(): BackendStatus { return makeStatus('koboldcpp', this.defaultPort, this.isInstalled()); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> {
        try {
            const r = await fetch(`http://127.0.0.1:${this.defaultPort}/api/v1/model`, { signal: AbortSignal.timeout(3000) });
            const d = await r.json() as any;
            return d.result ? [d.result] : [];
        } catch { return []; }
    }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['gguf', 'ggml', 'exl2']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: false, json_mode: false, vision: true, embeddings: false, continuous_batching: false, prefix_caching: false, tensor_parallelism: false, speculative_decoding: false, supported_formats: ['gguf', 'ggml'] }; }
}

// --- ExLlamaV2 (port 5000) — SOTA quantized inference for NVIDIA ---
export class ExLlamaV2Backend implements InferenceBackend {
    readonly type: BackendType = 'exllamav2';
    readonly defaultPort = 5000;
    isInstalled(): boolean { return fileExists('/opt/exllamav2') || fileExists('/usr/local/lib/python3.11/dist-packages/exllamav2'); }
    async isHealthy(): Promise<boolean> { return probeEndpoint(this.defaultPort, '/v1/models'); }
    getStatus(): BackendStatus { return makeStatus('exllamav2', this.defaultPort, this.isInstalled()); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> { return fetchModels(this.defaultPort); }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['exl2', 'gptq']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: false, json_mode: false, vision: false, embeddings: false, continuous_batching: true, prefix_caching: false, tensor_parallelism: false, speculative_decoding: false, supported_formats: ['exl2', 'gptq'] }; }
}

// --- LM Studio (port 1234) — Desktop GUI, OpenAI-compatible ---
export class LmStudioBackend implements InferenceBackend {
    readonly type: BackendType = 'lmstudio';
    readonly defaultPort = 1234;
    isInstalled(): boolean { return false; /* Desktop app — detect via running server */ }
    async isHealthy(): Promise<boolean> { return probeEndpoint(this.defaultPort, '/v1/models'); }
    getStatus(): BackendStatus { return makeStatus('lmstudio', this.defaultPort, false); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> { return fetchModels(this.defaultPort); }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['gguf']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: false, json_mode: false, vision: false, embeddings: true, continuous_batching: false, prefix_caching: false, tensor_parallelism: false, speculative_decoding: false, supported_formats: ['gguf'] }; }
}

// --- TabbyAPI (port 5000) — ExLlamaV2 wrapper, token encoding ---
export class TabbyApiBackend implements InferenceBackend {
    readonly type: BackendType = 'tabbyapi';
    readonly defaultPort = 5000;
    isInstalled(): boolean { return fileExists('/opt/tabbyAPI') || fileExists('/opt/tabbyapi'); }
    async isHealthy(): Promise<boolean> {
        try {
            const r = await fetch(`http://127.0.0.1:${this.defaultPort}/v1/token/encode`, { method: 'POST', signal: AbortSignal.timeout(3000) });
            return r.status === 422 || r.ok;
        } catch { return false; }
    }
    getStatus(): BackendStatus { return makeStatus('tabbyapi', this.defaultPort, this.isInstalled()); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> { return fetchModels(this.defaultPort); }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['exl2', 'gptq']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: false, json_mode: false, vision: false, embeddings: false, continuous_batching: true, prefix_caching: false, tensor_parallelism: false, speculative_decoding: false, supported_formats: ['exl2', 'gptq'] }; }
}

// --- TensorRT-LLM (port 8000) — NVIDIA optimized ---
export class TensorRtBackend implements InferenceBackend {
    readonly type: BackendType = 'tensorrt';
    readonly defaultPort = 8000;
    isInstalled(): boolean { return fileExists('/usr/local/bin/trtllm-build') || fileExists('/opt/tensorrt-llm'); }
    async isHealthy(): Promise<boolean> { return probeEndpoint(this.defaultPort, '/v1/models'); }
    getStatus(): BackendStatus { return makeStatus('tensorrt', this.defaultPort, this.isInstalled()); }
    start = noop; stop = noop; restart = noop; loadModel = noop; unloadModel = noop;
    async getLoadedModels(): Promise<string[]> { return fetchModels(this.defaultPort); }
    async getMetrics(): Promise<BackendMetrics> { return zeroMetrics; }
    getEndpointUrl(): string { return `http://127.0.0.1:${this.defaultPort}`; }
    getSupportedFormats(): string[] { return ['trt-engine', 'safetensors']; }
    getCapabilities(): BackendCapabilities { return { streaming: true, function_calling: true, json_mode: true, vision: false, embeddings: false, continuous_batching: true, prefix_caching: false, tensor_parallelism: true, speculative_decoding: false, supported_formats: ['fp8', 'int8', 'int4'] }; }
}
