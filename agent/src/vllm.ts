/**
 * vLLM Backend — Production Process Manager
 *
 * Full lifecycle management for vLLM inference servers with:
 *   - Process lifecycle (launch, stop, restart, health checks)
 *   - Auto-restart on crash with exponential backoff
 *   - Model management (load, unload, VRAM estimation)
 *   - Prometheus metrics parsing into structured objects
 *   - HuggingFace model support (GPTQ, AWQ, SafeTensors, FP16)
 *   - Configuration via environment variables + auto-detection
 *
 * CLAWtopus says: "PagedAttention? I've got eight arms for that."
 */

import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/** Configuration for launching a vLLM server */
export interface VllmLaunchConfig {
    model: string;
    port?: number;
    host?: string;
    tensorParallel?: number;
    maxModelLen?: number;
    quantization?: 'awq' | 'gptq' | 'squeezellm' | 'fp8' | null;
    gpuMemoryFraction?: number;
    dtype?: 'auto' | 'half' | 'float16' | 'bfloat16' | 'float' | 'float32';
    enforceEager?: boolean;
    enablePrefixCaching?: boolean;
    cudaVisibleDevices?: string;
    extraArgs?: string[];
}

/** Current state of the vLLM server process */
export type VllmProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/** Health check result */
export interface VllmHealthResult {
    healthy: boolean;
    latencyMs: number;
    error?: string;
}

/** Information about the currently loaded model */
export interface VllmModelInfo {
    model: string;
    quantization: string | null;
    dtype: string;
    tensorParallel: number;
    maxModelLen: number;
    gpuMemoryFraction: number;
    port: number;
    pid: number | null;
    state: VllmProcessState;
    uptimeMs: number;
    restartCount: number;
}

/** Structured metrics parsed from Prometheus /metrics endpoint */
export interface VllmMetrics {
    numRequestsRunning: number;
    numRequestsWaiting: number;
    gpuCacheUsagePct: number;
    cpuCacheUsagePct: number;
    numPreemptions: number;
    promptTokensTotal: number;
    generationTokensTotal: number;
    e2eRequestLatencySeconds: {
        buckets: Array<{ le: string; count: number }>;
        count: number;
        sum: number;
    };
    timeToFirstTokenSeconds: {
        buckets: Array<{ le: string; count: number }>;
        count: number;
        sum: number;
    };
    avgPromptThroughputToksPerSec: number;
    avgGenerationThroughputToksPerSec: number;
}

/** Comprehensive vLLM server status */
export interface VllmStatus {
    installed: boolean;
    running: boolean;
    port: number;
    models: string[];
    version: string | null;
    state: VllmProcessState;
    pid: number | null;
    uptimeMs: number;
    restartCount: number;
}

/** VRAM estimation result */
export interface VramEstimate {
    modelWeightsMb: number;
    kvCacheMb: number;
    overheadMb: number;
    totalMb: number;
    fitsInVram: boolean;
    availableVramMb: number;
}

/** Available vLLM-optimized models with metadata */
export const VLLM_MODELS = [
    { name: 'meta-llama/Llama-3.1-8B-Instruct', vram_mb: 16000, params_b: 8, description: 'Llama 3.1 8B with vLLM optimizations' },
    { name: 'meta-llama/Llama-3.1-70B-Instruct', vram_mb: 140000, params_b: 70, description: 'Llama 3.1 70B (needs multi-GPU)' },
    { name: 'mistralai/Mixtral-8x7B-Instruct-v0.1', vram_mb: 90000, params_b: 47, description: 'Mixtral MoE' },
    { name: 'Qwen/Qwen2.5-7B-Instruct', vram_mb: 16000, params_b: 7, description: 'Qwen 2.5 7B' },
    { name: 'microsoft/Phi-3-mini-4k-instruct', vram_mb: 8000, params_b: 3.8, description: 'Phi-3 Mini 3.8B' },
    { name: 'google/gemma-2-9b-it', vram_mb: 20000, params_b: 9, description: 'Gemma 2 9B' },
] as const;

// =============================================================================
// Constants & Configuration
// =============================================================================

const LOG_PREFIX = '[vllm]';

function getConfig() {
    return {
        port: parseInt(process.env.VLLM_PORT || '', 10) || 8000,
        host: process.env.VLLM_HOST || '127.0.0.1',
        gpuMemoryFraction: parseFloat(process.env.VLLM_GPU_MEMORY_FRACTION || '') || 0.9,
        maxModelLen: parseInt(process.env.VLLM_MAX_MODEL_LEN || '', 10) || 0, // 0 = auto
        logDir: process.env.VLLM_LOG_DIR || '/var/log/tentaclaw',
    };
}

function getBaseUrl(port?: number): string {
    const p = port ?? getConfig().port;
    return `http://localhost:${p}`;
}

/** Resolve python binary: prefer python3, fall back to python */
function getPythonBin(): string {
    try {
        execFileSync('python3', ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        return 'python3';
    } catch {
        try {
            execFileSync('python', ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
            return 'python';
        } catch {
            return 'python3'; // default, will fail downstream with clear error
        }
    }
}

// =============================================================================
// Module State
// =============================================================================

/** Internal process manager state — singleton per agent process */
let _process: ChildProcess | null = null;
let _state: VllmProcessState = 'stopped';
let _config: VllmLaunchConfig | null = null;
let _startedAt: number = 0;
let _restartCount: number = 0;
let _backoffMs: number = 1000;
let _autoRestartEnabled: boolean = true;
let _restartTimer: ReturnType<typeof setTimeout> | null = null;
let _logStream: fs.WriteStream | null = null;

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60000;
const BACKOFF_MULTIPLIER = 2;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const STARTUP_POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 300000; // 5 min for large models

// =============================================================================
// Detection
// =============================================================================

/**
 * Check if vLLM is installed (looks for the Python vllm package).
 */
export function isVllmInstalled(): boolean {
    const python = getPythonBin();
    try {
        execFileSync(python, ['-c', 'import vllm'], {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: 'pipe',
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the installed vLLM version.
 * Returns null if vLLM is not installed.
 */
export function getVllmVersion(): string | null {
    const python = getPythonBin();
    try {
        const output = execFileSync(python, ['-c', 'import vllm; print(vllm.__version__)'], {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: 'pipe',
        }).trim();
        return output || null;
    } catch {
        return null;
    }
}

// =============================================================================
// Health Checking
// =============================================================================

/**
 * Check if the vLLM server is healthy by hitting the /health endpoint.
 * Returns health status and latency in milliseconds.
 */
export function isVllmHealthy(port?: number): VllmHealthResult {
    const baseUrl = getBaseUrl(port);
    const startTime = Date.now();
    try {
        execFileSync('curl', [
            '-sf',
            '--max-time', String(HEALTH_CHECK_TIMEOUT_MS / 1000),
            `${baseUrl}/health`,
        ], {
            encoding: 'utf-8',
            timeout: HEALTH_CHECK_TIMEOUT_MS + 1000,
            stdio: 'pipe',
        });
        return { healthy: true, latencyMs: Date.now() - startTime };
    } catch {
        // Fall back to /v1/models which also indicates readiness
        try {
            const output = execFileSync('curl', [
                '-sf',
                '--max-time', String(HEALTH_CHECK_TIMEOUT_MS / 1000),
                `${baseUrl}/v1/models`,
            ], {
                encoding: 'utf-8',
                timeout: HEALTH_CHECK_TIMEOUT_MS + 1000,
                stdio: 'pipe',
            });
            const data = JSON.parse(output);
            if (Array.isArray(data?.data)) {
                return { healthy: true, latencyMs: Date.now() - startTime };
            }
            return { healthy: false, latencyMs: Date.now() - startTime, error: 'Invalid /v1/models response' };
        } catch (e) {
            return {
                healthy: false,
                latencyMs: Date.now() - startTime,
                error: e instanceof Error ? e.message : 'Health check failed',
            };
        }
    }
}

/**
 * Legacy compatibility: Check if vLLM server is running on a given port.
 */
export function isVllmRunning(port?: number): boolean {
    return isVllmHealthy(port).healthy;
}

// =============================================================================
// Process Lifecycle Management
// =============================================================================

/**
 * Launch the vLLM server as a managed child process.
 *
 * Features:
 *   - Spawns python -m vllm.entrypoints.openai.api_server
 *   - Sets CUDA_VISIBLE_DEVICES if specified
 *   - Captures stdout/stderr to a log file
 *   - Polls /health until the server is ready
 *   - Auto-restarts on crash with exponential backoff
 *
 * @returns Promise that resolves to true when the server is ready, false on failure
 */
export async function launchVllm(config: VllmLaunchConfig): Promise<boolean> {
    // If already running with the same model, just return success
    if (_state === 'running' && _config?.model === config.model) {
        console.log(`${LOG_PREFIX} Server already running with model ${config.model}`);
        return true;
    }

    // If running with a different model, stop first
    if (_state === 'running' || _state === 'starting') {
        console.log(`${LOG_PREFIX} Stopping current server before launching with new config`);
        await stopVllm();
    }

    if (!isVllmInstalled()) {
        console.error(`${LOG_PREFIX} Cannot start — vLLM is not installed. Run: pip install vllm`);
        return false;
    }

    const envConfig = getConfig();
    const port = config.port ?? envConfig.port;
    const host = config.host ?? envConfig.host;
    const gpuMemFrac = config.gpuMemoryFraction ?? envConfig.gpuMemoryFraction;
    const maxModelLen = config.maxModelLen ?? envConfig.maxModelLen;

    // Build the command arguments
    const args: string[] = [
        '-m', 'vllm.entrypoints.openai.api_server',
        '--model', config.model,
        '--port', String(port),
        '--host', host,
        '--gpu-memory-utilization', String(gpuMemFrac),
    ];

    if (config.tensorParallel && config.tensorParallel > 1) {
        args.push('--tensor-parallel-size', String(config.tensorParallel));
    }

    if (maxModelLen > 0) {
        args.push('--max-model-len', String(maxModelLen));
    }

    if (config.quantization) {
        args.push('--quantization', config.quantization);
    }

    if (config.dtype && config.dtype !== 'auto') {
        args.push('--dtype', config.dtype);
    }

    if (config.enforceEager) {
        args.push('--enforce-eager');
    }

    if (config.enablePrefixCaching) {
        args.push('--enable-prefix-caching');
    }

    if (config.extraArgs) {
        args.push(...config.extraArgs);
    }

    // Build environment
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (config.cudaVisibleDevices !== undefined) {
        env['CUDA_VISIBLE_DEVICES'] = config.cudaVisibleDevices;
    }

    // Ensure log directory exists
    const logDir = envConfig.logDir;
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch {
        // Log dir may already exist or be inaccessible — we'll handle below
    }

    const logPath = path.join(logDir, `vllm-${port}.log`);

    // Store config for restarts
    _config = { ...config, port, host };
    _state = 'starting';
    _startedAt = Date.now();
    _autoRestartEnabled = true;

    const python = getPythonBin();

    console.log(`${LOG_PREFIX} Launching: ${python} ${args.join(' ')}`);
    if (config.cudaVisibleDevices !== undefined) {
        console.log(`${LOG_PREFIX} CUDA_VISIBLE_DEVICES=${config.cudaVisibleDevices}`);
    }
    console.log(`${LOG_PREFIX} Log file: ${logPath}`);

    try {
        // Open log file stream
        try {
            _logStream = fs.createWriteStream(logPath, { flags: 'a' });
            _logStream.write(`\n--- vLLM started at ${new Date().toISOString()} ---\n`);
            _logStream.write(`Command: ${python} ${args.join(' ')}\n`);
            _logStream.write(`Model: ${config.model}\n\n`);
        } catch {
            // If we can't write logs, continue without — not fatal
            console.warn(`${LOG_PREFIX} Could not open log file at ${logPath}, continuing without file logging`);
            _logStream = null;
        }

        // Spawn the vLLM process
        _process = spawn(python, args, {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false, // Keep as child — we manage lifecycle
        });

        // Capture stdout
        _process.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            if (_logStream) {
                _logStream.write(text);
            }
            // Log key events to console
            if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
                console.log(`${LOG_PREFIX} Server reports ready`);
            }
        });

        // Capture stderr
        _process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            if (_logStream) {
                _logStream.write(text);
            }
            // Detect common errors early
            if (text.includes('OutOfMemoryError') || text.includes('CUDA out of memory')) {
                console.error(`${LOG_PREFIX} GPU out of memory — model may be too large for available VRAM`);
            }
            if (text.includes('Error') || text.includes('error')) {
                // Only log short error snippets to avoid flooding console
                const firstLine = text.split('\n')[0].trim();
                if (firstLine.length > 0 && firstLine.length < 200) {
                    console.error(`${LOG_PREFIX} stderr: ${firstLine}`);
                }
            }
        });

        // Handle process exit
        _process.on('exit', (code, signal) => {
            const wasStopping = _state === 'stopping';

            if (_logStream) {
                _logStream.write(`\n--- vLLM exited: code=${code}, signal=${signal} at ${new Date().toISOString()} ---\n`);
            }

            // Clean up
            _process = null;
            if (_logStream) {
                _logStream.end();
                _logStream = null;
            }

            if (wasStopping) {
                // Expected shutdown
                _state = 'stopped';
                console.log(`${LOG_PREFIX} Server stopped (code=${code}, signal=${signal})`);
                return;
            }

            // Unexpected exit
            _state = 'crashed';
            console.error(`${LOG_PREFIX} Server exited unexpectedly (code=${code}, signal=${signal})`);

            if (_autoRestartEnabled && _config) {
                scheduleRestart();
            }
        });

        _process.on('error', (err) => {
            console.error(`${LOG_PREFIX} Failed to spawn process: ${err.message}`);
            _state = 'crashed';
            _process = null;
            if (_logStream) {
                _logStream.end();
                _logStream = null;
            }

            if (_autoRestartEnabled && _config) {
                scheduleRestart();
            }
        });

        // Poll for readiness
        const ready = await pollForReady(port);
        if (ready) {
            _state = 'running';
            _backoffMs = BACKOFF_MIN_MS; // Reset backoff on success
            console.log(`${LOG_PREFIX} Server is ready on port ${port} (PID: ${_process?.pid ?? 'unknown'})`);
            return true;
        }

        // Startup timed out
        console.error(`${LOG_PREFIX} Server did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s`);
        await stopVllm();
        return false;

    } catch (err) {
        _state = 'stopped';
        console.error(`${LOG_PREFIX} Failed to launch: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

/**
 * Stop the vLLM server gracefully.
 *
 * Sends SIGTERM, waits up to 10 seconds, then SIGKILL if necessary.
 */
export async function stopVllm(): Promise<boolean> {
    // Cancel any pending restart
    if (_restartTimer) {
        clearTimeout(_restartTimer);
        _restartTimer = null;
    }

    _autoRestartEnabled = false;

    if (!_process) {
        // Process is not tracked — try to find and kill by port
        if (_config?.port && isVllmRunning(_config.port)) {
            return killByPort(_config.port);
        }
        _state = 'stopped';
        return true;
    }

    const pid = _process.pid;
    if (!pid) {
        _state = 'stopped';
        _process = null;
        return true;
    }

    _state = 'stopping';
    console.log(`${LOG_PREFIX} Sending SIGTERM to PID ${pid}`);

    // Send SIGTERM for graceful shutdown
    try {
        _process.kill('SIGTERM');
    } catch {
        // Process may already be dead
        _state = 'stopped';
        _process = null;
        return true;
    }

    // Wait for graceful exit
    const exited = await waitForExit(GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    if (exited) {
        _state = 'stopped';
        console.log(`${LOG_PREFIX} Server stopped gracefully`);
        return true;
    }

    // Force kill
    console.log(`${LOG_PREFIX} Graceful shutdown timed out, sending SIGKILL to PID ${pid}`);
    try {
        _process?.kill('SIGKILL');
    } catch {
        // Already dead
    }

    const killed = await waitForExit(5000);
    _state = 'stopped';
    _process = null;

    if (killed) {
        console.log(`${LOG_PREFIX} Server force-killed`);
    } else {
        console.error(`${LOG_PREFIX} Server PID ${pid} could not be killed — zombie process possible`);
    }

    return killed;
}

/**
 * Restart the vLLM server with the same configuration.
 * Returns false if no configuration is stored (never started).
 */
export async function restartVllm(): Promise<boolean> {
    if (!_config) {
        console.error(`${LOG_PREFIX} Cannot restart — no previous configuration`);
        return false;
    }

    console.log(`${LOG_PREFIX} Restarting server...`);
    const config = { ..._config };
    await stopVllm();

    // Brief pause between stop and start
    await sleep(1000);

    _restartCount++;
    return launchVllm(config);
}

// =============================================================================
// Model Management
// =============================================================================

/**
 * Load a model by starting the vLLM server with it.
 *
 * Accepts HuggingFace model IDs directly (e.g., "meta-llama/Llama-3.1-8B-Instruct").
 * Supports GPTQ, AWQ, SafeTensors, and FP16 formats.
 * Auto-detects quantization from model name when not specified.
 */
export async function loadModel(model: string, options?: {
    tensorParallel?: number;
    maxModelLen?: number;
    quantization?: 'awq' | 'gptq' | 'squeezellm' | 'fp8' | null;
    gpuMemoryFraction?: number;
    dtype?: 'auto' | 'half' | 'float16' | 'bfloat16' | 'float' | 'float32';
    enforceEager?: boolean;
    enablePrefixCaching?: boolean;
    cudaVisibleDevices?: string;
}): Promise<boolean> {
    // Auto-detect quantization from model name
    const quantization = options?.quantization !== undefined
        ? options.quantization
        : detectQuantizationFromModel(model);

    const config: VllmLaunchConfig = {
        model,
        tensorParallel: options?.tensorParallel,
        maxModelLen: options?.maxModelLen,
        quantization: quantization ?? undefined,
        gpuMemoryFraction: options?.gpuMemoryFraction,
        dtype: options?.dtype,
        enforceEager: options?.enforceEager,
        enablePrefixCaching: options?.enablePrefixCaching,
        cudaVisibleDevices: options?.cudaVisibleDevices,
    };

    console.log(`${LOG_PREFIX} Loading model: ${model}`);
    if (quantization) {
        console.log(`${LOG_PREFIX} Detected quantization: ${quantization}`);
    }

    return launchVllm(config);
}

/**
 * Unload the current model by stopping the vLLM process.
 * This frees all GPU memory held by the model.
 */
export async function unloadModel(): Promise<boolean> {
    if (_state === 'stopped') {
        console.log(`${LOG_PREFIX} No model loaded`);
        return true;
    }

    console.log(`${LOG_PREFIX} Unloading model — freeing GPU memory`);
    return stopVllm();
}

/**
 * Get information about the currently loaded model.
 * Returns null if no model is loaded.
 */
export function getLoadedModel(): VllmModelInfo | null {
    if (!_config) {
        return null;
    }

    return {
        model: _config.model,
        quantization: _config.quantization ?? null,
        dtype: _config.dtype ?? 'auto',
        tensorParallel: _config.tensorParallel ?? 1,
        maxModelLen: _config.maxModelLen ?? 0,
        gpuMemoryFraction: _config.gpuMemoryFraction ?? getConfig().gpuMemoryFraction,
        port: _config.port ?? getConfig().port,
        pid: _process?.pid ?? null,
        state: _state,
        uptimeMs: _state === 'running' ? Date.now() - _startedAt : 0,
        restartCount: _restartCount,
    };
}

/**
 * Estimate the VRAM required to serve a model.
 *
 * Uses a heuristic based on parameter count and quantization:
 *   - FP16: ~2 bytes/param
 *   - GPTQ/AWQ 4-bit: ~0.5 bytes/param
 *   - FP8: ~1 byte/param
 *   - Plus KV cache overhead (depends on max_model_len)
 *   - Plus ~500MB fixed overhead for vLLM engine
 *
 * @param model - HuggingFace model ID or known model name
 * @param quantization - Quantization method (null for FP16)
 * @param maxModelLen - Maximum context length (default 4096)
 * @param availableVramMb - Available VRAM in MB (for fits_in_vram check)
 */
export function estimateVramRequirement(
    model: string,
    quantization?: string | null,
    maxModelLen: number = 4096,
    availableVramMb: number = 0,
): VramEstimate {
    // Try to resolve parameter count from known models
    const paramsBillions = resolveParamCount(model);

    // Bytes per parameter based on quantization
    let bytesPerParam: number;
    if (!quantization || quantization === 'fp16' || quantization === 'float16') {
        bytesPerParam = 2.0; // FP16
    } else if (quantization === 'awq' || quantization === 'gptq') {
        bytesPerParam = 0.55; // 4-bit + overhead
    } else if (quantization === 'fp8') {
        bytesPerParam = 1.05; // FP8 + overhead
    } else if (quantization === 'squeezellm') {
        bytesPerParam = 0.5;
    } else {
        bytesPerParam = 2.0; // Default to FP16
    }

    const modelWeightsMb = Math.ceil((paramsBillions * 1e9 * bytesPerParam) / (1024 * 1024));

    // KV cache estimation: roughly 2 * num_layers * hidden_size * max_seq_len * 2bytes per token
    // Simplified heuristic: ~0.5MB per 1K context tokens per billion params
    const kvCacheMb = Math.ceil(paramsBillions * (maxModelLen / 1024) * 0.5);

    // Fixed vLLM overhead (CUDA contexts, PagedAttention data structures, etc.)
    const overheadMb = 500;

    const totalMb = modelWeightsMb + kvCacheMb + overheadMb;

    return {
        modelWeightsMb,
        kvCacheMb,
        overheadMb,
        totalMb,
        fitsInVram: availableVramMb > 0 ? totalMb <= availableVramMb : true,
        availableVramMb,
    };
}

// =============================================================================
// Metrics Collection
// =============================================================================

/**
 * Parse the vLLM Prometheus /metrics endpoint into a structured object.
 *
 * Extracts key inference metrics:
 *   - num_requests_running, num_requests_waiting
 *   - gpu_cache_usage_pct, cpu_cache_usage_pct
 *   - num_preemptions
 *   - prompt_tokens_total, generation_tokens_total
 *   - e2e_request_latency_seconds (histogram with buckets)
 *   - time_to_first_token_seconds (histogram with buckets)
 *   - avg throughput (prompt & generation)
 */
export function getVllmMetrics(port?: number): VllmMetrics | null {
    const baseUrl = getBaseUrl(port);
    let output: string;
    try {
        output = execFileSync('curl', ['-sf', '--max-time', '3', `${baseUrl}/metrics`], {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: 'pipe',
        });
    } catch {
        return null;
    }

    if (!output || output.length === 0) {
        return null;
    }

    const metrics: VllmMetrics = {
        numRequestsRunning: 0,
        numRequestsWaiting: 0,
        gpuCacheUsagePct: 0,
        cpuCacheUsagePct: 0,
        numPreemptions: 0,
        promptTokensTotal: 0,
        generationTokensTotal: 0,
        e2eRequestLatencySeconds: { buckets: [], count: 0, sum: 0 },
        timeToFirstTokenSeconds: { buckets: [], count: 0, sum: 0 },
        avgPromptThroughputToksPerSec: 0,
        avgGenerationThroughputToksPerSec: 0,
    };

    const lines = output.split('\n');
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || line.trim().length === 0) {
            continue;
        }

        // Gauge metrics — match both vllm: and vllm_ prefixed names
        if (matchMetricName(line, 'num_requests_running')) {
            metrics.numRequestsRunning = parseMetricValue(line);
        } else if (matchMetricName(line, 'num_requests_waiting')) {
            metrics.numRequestsWaiting = parseMetricValue(line);
        } else if (matchMetricName(line, 'gpu_cache_usage_perc')) {
            metrics.gpuCacheUsagePct = parseMetricValue(line);
        } else if (matchMetricName(line, 'cpu_cache_usage_perc')) {
            metrics.cpuCacheUsagePct = parseMetricValue(line);
        } else if (matchMetricName(line, 'num_preemptions_total')) {
            metrics.numPreemptions = parseMetricValue(line);
        } else if (matchMetricName(line, 'prompt_tokens_total')) {
            metrics.promptTokensTotal = parseMetricValue(line);
        } else if (matchMetricName(line, 'generation_tokens_total')) {
            metrics.generationTokensTotal = parseMetricValue(line);
        } else if (matchMetricName(line, 'avg_prompt_throughput_toks_per_s')) {
            metrics.avgPromptThroughputToksPerSec = parseMetricValue(line);
        } else if (matchMetricName(line, 'avg_generation_throughput_toks_per_s')) {
            metrics.avgGenerationThroughputToksPerSec = parseMetricValue(line);
        }

        // Histogram buckets for e2e_request_latency_seconds
        const e2eBucket = parseHistogramBucket(line, 'e2e_request_latency_seconds');
        if (e2eBucket) {
            metrics.e2eRequestLatencySeconds.buckets.push(e2eBucket);
        } else if (matchMetricName(line, 'e2e_request_latency_seconds_count')) {
            metrics.e2eRequestLatencySeconds.count = parseMetricValue(line);
        } else if (matchMetricName(line, 'e2e_request_latency_seconds_sum')) {
            metrics.e2eRequestLatencySeconds.sum = parseMetricValue(line);
        }

        // Histogram buckets for time_to_first_token_seconds
        const ttftBucket = parseHistogramBucket(line, 'time_to_first_token_seconds');
        if (ttftBucket) {
            metrics.timeToFirstTokenSeconds.buckets.push(ttftBucket);
        } else if (matchMetricName(line, 'time_to_first_token_seconds_count')) {
            metrics.timeToFirstTokenSeconds.count = parseMetricValue(line);
        } else if (matchMetricName(line, 'time_to_first_token_seconds_sum')) {
            metrics.timeToFirstTokenSeconds.sum = parseMetricValue(line);
        }
    }

    return metrics;
}

// =============================================================================
// Status
// =============================================================================

/**
 * Get comprehensive vLLM server status including loaded models and version.
 */
export function getVllmStatus(port?: number): VllmStatus {
    const p = port ?? _config?.port ?? getConfig().port;
    const installed = isVllmInstalled();
    const health = isVllmHealthy(p);
    const running = health.healthy;
    let models: string[] = [];
    const version = installed ? getVllmVersion() : null;

    // Get loaded models from the running server
    if (running) {
        try {
            const output = execFileSync('curl', ['-sf', '--max-time', '3', `${getBaseUrl(p)}/v1/models`], {
                encoding: 'utf-8',
                timeout: 5000,
                stdio: 'pipe',
            });
            const data = JSON.parse(output);
            models = data.data?.map((m: { id: string }) => m.id) || [];
        } catch {
            // Server is running but models endpoint failed — non-fatal
        }
    }

    return {
        installed,
        running,
        port: p,
        models,
        version,
        state: _state,
        pid: _process?.pid ?? null,
        uptimeMs: _state === 'running' ? Date.now() - _startedAt : 0,
        restartCount: _restartCount,
    };
}

// =============================================================================
// Recommendations
// =============================================================================

/**
 * Get recommended vLLM configuration for a given GPU setup.
 *
 * @param gpuCount    - Number of GPUs available
 * @param totalVramMb - Total VRAM across all GPUs in MB
 * @returns Recommended tensor parallelism, max model length, and model list
 */
export function getVllmRecommendation(gpuCount: number, totalVramMb: number): {
    tensor_parallel: number;
    max_model_len: number;
    recommended_models: string[];
    gpu_memory_fraction: number;
    enable_prefix_caching: boolean;
} {
    // Tensor parallelism should not exceed GPU count; use powers of 2 for efficiency
    let tensorParallel = 1;
    if (gpuCount >= 8) {
        tensorParallel = 8;
    } else if (gpuCount >= 4) {
        tensorParallel = 4;
    } else if (gpuCount >= 2) {
        tensorParallel = 2;
    }

    // Max model length depends on available VRAM (after model weights)
    let maxModelLen: number;
    if (totalVramMb >= 160000) {
        maxModelLen = 32768;
    } else if (totalVramMb >= 80000) {
        maxModelLen = 16384;
    } else if (totalVramMb >= 40000) {
        maxModelLen = 8192;
    } else if (totalVramMb >= 16000) {
        maxModelLen = 4096;
    } else {
        maxModelLen = 2048;
    }

    // GPU memory fraction — leave some headroom for system/CUDA overhead
    const gpuMemFrac = totalVramMb >= 40000 ? 0.92 : 0.88;

    // Recommend models that fit in the available VRAM
    const recommendedModels: string[] = [];
    for (const model of VLLM_MODELS) {
        if (model.vram_mb <= totalVramMb) {
            recommendedModels.push(model.name);
        }
    }

    // Always recommend at least the smallest model if nothing else fits
    if (recommendedModels.length === 0 && VLLM_MODELS.length > 0) {
        const smallest = [...VLLM_MODELS].sort((a, b) => a.vram_mb - b.vram_mb)[0];
        recommendedModels.push(smallest.name);
    }

    return {
        tensor_parallel: tensorParallel,
        max_model_len: maxModelLen,
        recommended_models: recommendedModels,
        gpu_memory_fraction: gpuMemFrac,
        enable_prefix_caching: totalVramMb >= 24000, // Enable for larger VRAM
    };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Poll the health endpoint until the server is ready or timeout */
async function pollForReady(port: number): Promise<boolean> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let attempts = 0;

    while (Date.now() < deadline) {
        await sleep(STARTUP_POLL_INTERVAL_MS);
        attempts++;

        // Check if the process died during startup
        if (!_process || _process.exitCode !== null) {
            console.error(`${LOG_PREFIX} Process exited during startup`);
            return false;
        }

        const health = isVllmHealthy(port);
        if (health.healthy) {
            console.log(`${LOG_PREFIX} Health check passed after ${attempts} attempts (${health.latencyMs}ms latency)`);
            return true;
        }

        if (attempts % 10 === 0) {
            console.log(`${LOG_PREFIX} Still waiting for server (attempt ${attempts}, ${Math.round((deadline - Date.now()) / 1000)}s remaining)...`);
        }
    }

    return false;
}

/** Wait for the child process to exit */
function waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        if (!_process) {
            resolve(true);
            return;
        }

        const timer = setTimeout(() => {
            resolve(false);
        }, timeoutMs);

        _process.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

/** Schedule an auto-restart with exponential backoff */
function scheduleRestart(): void {
    if (!_autoRestartEnabled || !_config) {
        return;
    }

    console.log(`${LOG_PREFIX} Scheduling restart in ${_backoffMs}ms (attempt #${_restartCount + 1})`);

    _restartTimer = setTimeout(async () => {
        _restartTimer = null;
        if (!_autoRestartEnabled || !_config) {
            return;
        }

        _restartCount++;
        console.log(`${LOG_PREFIX} Auto-restarting (attempt #${_restartCount})`);

        const success = await launchVllm(_config);
        if (!success) {
            // Increase backoff for next attempt
            _backoffMs = Math.min(_backoffMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
            // The process exit handler will schedule the next restart
        }
    }, _backoffMs);

    // Increase backoff for next time
    _backoffMs = Math.min(_backoffMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
}

/** Kill vLLM process(es) by port (fallback when we don't track the ChildProcess) */
function killByPort(port: number): boolean {
    try {
        // Try lsof on Linux/macOS
        const lsofOutput = execFileSync('lsof', ['-ti', `:${port}`], {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: 'pipe',
        }).trim();

        if (lsofOutput) {
            const pids = lsofOutput.split('\n').map(p => p.trim()).filter(Boolean);
            for (const pid of pids) {
                console.log(`${LOG_PREFIX} Sending SIGTERM to orphan PID ${pid}`);
                try {
                    execFileSync('kill', [pid], { timeout: 5000, stdio: 'pipe' });
                } catch {
                    // Process may already be gone
                }
            }
            return true;
        }
    } catch {
        // lsof not available (Windows) — try netstat approach
        try {
            if (process.platform === 'win32') {
                const netstatOutput = execFileSync('netstat', ['-ano'], {
                    encoding: 'utf-8',
                    timeout: 5000,
                    stdio: 'pipe',
                });
                const lines = netstatOutput.split('\n');
                for (const line of lines) {
                    if (line.includes(`:${port}`) && line.includes('LISTENING')) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parts[parts.length - 1];
                        if (pid && /^\d+$/.test(pid)) {
                            console.log(`${LOG_PREFIX} Sending taskkill to orphan PID ${pid}`);
                            try {
                                execFileSync('taskkill', ['/PID', pid, '/F'], { timeout: 5000, stdio: 'pipe' });
                            } catch {
                                // Process may already be gone
                            }
                        }
                    }
                }
                return true;
            }
        } catch {
            // netstat also failed
        }
    }

    console.error(`${LOG_PREFIX} Could not find process on port ${port}`);
    return false;
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse a numeric value from a Prometheus metric line */
function parseMetricValue(line: string): number {
    // Prometheus format: metric_name{labels} value [timestamp]
    // or: metric_name value [timestamp]
    const parts = line.split(/\s+/);
    // Value is always the second-to-last or last token
    for (let i = parts.length - 1; i >= 0; i--) {
        const val = parseFloat(parts[i]);
        if (!isNaN(val)) {
            return val;
        }
    }
    return 0;
}

/** Check if a Prometheus metric line matches a metric name (handles both : and _ separators) */
function matchMetricName(line: string, name: string): boolean {
    // vLLM uses both vllm:metric_name and vllm_metric_name formats
    return line.startsWith(`vllm:${name}`) ||
           line.startsWith(`vllm_${name}`) ||
           line.startsWith(name);
}

/** Parse a histogram bucket from a Prometheus metric line */
function parseHistogramBucket(line: string, metricName: string): { le: string; count: number } | null {
    // Match: vllm:metric_name_bucket{le="0.5",...} 123
    // or: vllm_metric_name_bucket{le="0.5",...} 123
    const bucketName = `${metricName}_bucket`;
    if (!matchMetricName(line, bucketName)) {
        return null;
    }

    const leMatch = line.match(/le="([^"]+)"/);
    if (!leMatch) {
        return null;
    }

    return {
        le: leMatch[1],
        count: parseMetricValue(line),
    };
}

/** Auto-detect quantization format from model name/ID */
function detectQuantizationFromModel(model: string): 'awq' | 'gptq' | null {
    const lower = model.toLowerCase();

    if (lower.includes('-awq') || lower.includes('_awq') || lower.includes('.awq')) {
        return 'awq';
    }
    if (lower.includes('-gptq') || lower.includes('_gptq') || lower.includes('.gptq')) {
        return 'gptq';
    }

    return null;
}

/** Resolve parameter count in billions from model name */
function resolveParamCount(model: string): number {
    // Check known models first
    for (const known of VLLM_MODELS) {
        if (model === known.name || model.includes(known.name)) {
            return known.params_b;
        }
    }

    // Try to parse from model name: e.g. "Llama-3.1-8B", "Qwen2.5-72B", "phi-3-mini-3.8B"
    const lower = model.toLowerCase();

    // Match patterns like "70b", "8b", "3.8b", "1.5b"
    const paramMatch = lower.match(/[\-_](\d+\.?\d*)b[\-_.\s]/i) ||
                        lower.match(/[\-_](\d+\.?\d*)b$/i) ||
                        lower.match(/(\d+\.?\d*)b[\-_]/i);
    if (paramMatch) {
        const val = parseFloat(paramMatch[1]);
        if (!isNaN(val) && val > 0 && val < 1000) {
            return val;
        }
    }

    // Match "8x7B" pattern (MoE) — total params ≈ num_experts * expert_size * 0.6 (sparse)
    const moeMatch = lower.match(/(\d+)x(\d+\.?\d*)b/i);
    if (moeMatch) {
        const numExperts = parseInt(moeMatch[1], 10);
        const expertSize = parseFloat(moeMatch[2]);
        if (!isNaN(numExperts) && !isNaN(expertSize)) {
            // MoE total weight is roughly num_experts * expert_size (all experts loaded)
            return numExperts * expertSize;
        }
    }

    // Default: assume 7B if we can't determine
    return 7;
}

/**
 * Reset the module state — primarily for testing.
 * Does NOT kill any running processes; use stopVllm() for that.
 */
export function _resetState(): void {
    _process = null;
    _state = 'stopped';
    _config = null;
    _startedAt = 0;
    _restartCount = 0;
    _backoffMs = BACKOFF_MIN_MS;
    _autoRestartEnabled = true;
    _restartTimer = null;
    _logStream = null;
}

/**
 * Get the current process state — exposed for testing and monitoring.
 */
export function getProcessState(): VllmProcessState {
    return _state;
}

/**
 * Disable auto-restart — useful before intentional shutdown.
 */
export function disableAutoRestart(): void {
    _autoRestartEnabled = false;
    if (_restartTimer) {
        clearTimeout(_restartTimer);
        _restartTimer = null;
    }
}

/**
 * Enable auto-restart after it has been disabled.
 */
export function enableAutoRestart(): void {
    _autoRestartEnabled = true;
}
