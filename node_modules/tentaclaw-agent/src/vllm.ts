/**
 * vLLM Backend Manager
 *
 * Manages vLLM inference servers for GPU-accelerated serving with
 * PagedAttention, continuous batching, and tensor parallelism.
 *
 * CLAWtopus says: "PagedAttention? I've got eight arms for that."
 */

import { execSync, execFileSync } from 'child_process';

// =============================================================================
// Constants
// =============================================================================

/** Default port for the vLLM OpenAI-compatible API server */
const VLLM_DEFAULT_PORT = 8000;

/** vLLM API base URL (OpenAI-compatible) */
const VLLM_BASE_URL = `http://localhost:${VLLM_DEFAULT_PORT}`;

/** Available vLLM-optimized models */
export const VLLM_MODELS = [
    { name: 'meta-llama/Llama-3.1-8B-Instruct', vram_mb: 16000, description: 'Llama 3.1 8B with vLLM optimizations' },
    { name: 'meta-llama/Llama-3.1-70B-Instruct', vram_mb: 140000, description: 'Llama 3.1 70B (needs multi-GPU)' },
    { name: 'mistralai/Mixtral-8x7B-Instruct-v0.1', vram_mb: 90000, description: 'Mixtral MoE' },
    { name: 'Qwen/Qwen2.5-7B-Instruct', vram_mb: 16000, description: 'Qwen 2.5 7B' },
] as const;

// =============================================================================
// Detection
// =============================================================================

/**
 * Check if vLLM is installed (looks for the Python vllm package).
 */
export function isVllmInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import vllm'], {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: 'pipe',
        });
        return true;
    } catch {
        // Fallback: try `python` (some systems alias python3 as python)
        try {
            execFileSync('python', ['-c', 'import vllm'], {
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

/**
 * Check if vLLM server is running on port 8000.
 * Sends a request to the OpenAI-compatible /v1/models endpoint.
 */
export function isVllmRunning(): boolean {
    try {
        const output = execFileSync('curl', ['-s', '--max-time', '2', `${VLLM_BASE_URL}/v1/models`], {
            encoding: 'utf-8',
            timeout: 5000,
        });
        // vLLM returns JSON with a "data" array from /v1/models
        const data = JSON.parse(output);
        return Array.isArray(data?.data);
    } catch {
        return false;
    }
}

// =============================================================================
// Status
// =============================================================================

/**
 * Get comprehensive vLLM server status including loaded models and version.
 */
export function getVllmStatus(): {
    installed: boolean;
    running: boolean;
    port: number;
    models: string[];
    version: string | null;
} {
    const installed = isVllmInstalled();
    const running = isVllmRunning();
    let models: string[] = [];
    let version: string | null = null;

    // Get version from the Python package
    if (installed) {
        try {
            const versionOutput = execFileSync('python3', ['-c', 'import vllm; print(vllm.__version__)'], {
                encoding: 'utf-8',
                timeout: 10000,
                stdio: 'pipe',
            }).trim();
            if (versionOutput) {
                version = versionOutput;
            }
        } catch {
            // Fallback to python
            try {
                const versionOutput = execFileSync('python', ['-c', 'import vllm; print(vllm.__version__)'], {
                    encoding: 'utf-8',
                    timeout: 10000,
                    stdio: 'pipe',
                }).trim();
                if (versionOutput) {
                    version = versionOutput;
                }
            } catch {
                // Version unavailable
            }
        }
    }

    // Get loaded models from the running server
    if (running) {
        try {
            const output = execFileSync('curl', ['-s', '--max-time', '3', `${VLLM_BASE_URL}/v1/models`], {
                encoding: 'utf-8',
                timeout: 5000,
            });
            const data = JSON.parse(output);
            models = data.data?.map((m: { id: string }) => m.id) || [];
        } catch {
            // Server is running but models endpoint failed — non-fatal
        }
    }

    return { installed, running, port: VLLM_DEFAULT_PORT, models, version };
}

// =============================================================================
// Metrics
// =============================================================================

/**
 * Get vLLM metrics from the Prometheus /metrics endpoint (if available).
 * Returns GPU cache usage, running requests, and waiting requests.
 */
export function getVllmMetrics(): {
    gpu_cache_usage_pct: number;
    num_running: number;
    num_waiting: number;
} | null {
    try {
        const output = execFileSync('curl', ['-s', '--max-time', '3', `${VLLM_BASE_URL}/metrics`], {
            encoding: 'utf-8',
            timeout: 5000,
        });

        if (!output || output.length === 0) {
            return null;
        }

        let gpuCacheUsage = 0;
        let numRunning = 0;
        let numWaiting = 0;

        // Parse Prometheus text format for the metrics we care about
        const lines = output.split('\n');
        for (const line of lines) {
            // Skip comments and empty lines
            if (line.startsWith('#') || line.trim().length === 0) {
                continue;
            }

            if (line.startsWith('vllm:gpu_cache_usage_perc')) {
                const value = parseFloat(line.split(/\s+/).pop() || '0');
                if (!isNaN(value)) {
                    gpuCacheUsage = value;
                }
            } else if (line.startsWith('vllm:num_requests_running')) {
                const value = parseInt(line.split(/\s+/).pop() || '0', 10);
                if (!isNaN(value)) {
                    numRunning = value;
                }
            } else if (line.startsWith('vllm:num_requests_waiting')) {
                const value = parseInt(line.split(/\s+/).pop() || '0', 10);
                if (!isNaN(value)) {
                    numWaiting = value;
                }
            }
        }

        return {
            gpu_cache_usage_pct: gpuCacheUsage,
            num_running: numRunning,
            num_waiting: numWaiting,
        };
    } catch {
        return null;
    }
}

// =============================================================================
// Server Lifecycle
// =============================================================================

// Note: startVllmServer uses execSync with shell features (nohup, &, redirection)
// for launching the server as a detached background process. All arguments are
// from function parameters or constants, not user-supplied input, so shell
// injection is not a concern here. This matches the pattern used in bitnet.ts.

/**
 * Start vLLM server with a model.
 *
 * @param model   - HuggingFace model ID to serve (e.g. 'meta-llama/Llama-3.1-8B-Instruct')
 * @param options - Server configuration options
 * @returns true if the server was started (or was already running), false on failure
 */
export function startVllmServer(model: string, options?: {
    tensorParallel?: number;
    maxModelLen?: number;
    quantization?: string;  // 'awq' | 'gptq' | 'squeezellm'
    port?: number;
}): boolean {
    const port = options?.port ?? VLLM_DEFAULT_PORT;

    // Already running? Nothing to do.
    if (isVllmRunning()) {
        console.log(`[vllm] Server already running on port ${port}`);
        return true;
    }

    if (!isVllmInstalled()) {
        console.error('[vllm] Cannot start — vLLM is not installed. Run: pip install vllm');
        return false;
    }

    // Build the command arguments for python3 -m vllm.entrypoints.openai.api_server
    const args: string[] = [
        '-m', 'vllm.entrypoints.openai.api_server',
        '--model', model,
        '--port', String(port),
    ];

    if (options?.tensorParallel && options.tensorParallel > 1) {
        args.push('--tensor-parallel-size', String(options.tensorParallel));
    }

    if (options?.maxModelLen) {
        args.push('--max-model-len', String(options.maxModelLen));
    }

    if (options?.quantization) {
        args.push('--quantization', options.quantization);
    }

    try {
        // Start as a detached background process so it outlives the calling script.
        const cmdArgs = args.map((a) => `"${a}"`).join(' ');
        console.log(`[vllm] Starting server — model=${model}, port=${port}`);
        execSync(
            `nohup python3 ${cmdArgs} > /var/log/vllm-server.log 2>&1 &`,
            { timeout: 10000 }
        );

        // vLLM takes time to load models — wait and poll for readiness
        console.log('[vllm] Waiting for server to load model (this may take a minute)...');
        execFileSync('sleep', ['5']);

        // Poll up to 12 times (60 seconds total) for the server to become ready
        for (let i = 0; i < 12; i++) {
            if (isVllmRunning()) {
                console.log('[vllm] Server started successfully');
                return true;
            }
            execFileSync('sleep', ['5']);
        }

        console.error('[vllm] Server process launched but did not become ready within 60 seconds');
        return false;
    } catch (err) {
        console.error('[vllm] Failed to start server:', err instanceof Error ? err.message : String(err));
        return false;
    }
}

/**
 * Stop vLLM server.
 *
 * Finds the process listening on the vLLM port and sends SIGTERM.
 * @returns true if the server was stopped (or wasn't running), false on failure
 */
export function stopVllmServer(): boolean {
    if (!isVllmRunning()) {
        console.log('[vllm] Server is not running');
        return true;
    }

    try {
        // Find the PID of the process bound to the vLLM port
        const lsofOutput = execFileSync('lsof', ['-ti', `:${VLLM_DEFAULT_PORT}`], {
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();

        if (lsofOutput) {
            const pids = lsofOutput.split('\n').map((p) => p.trim()).filter(Boolean);
            for (const pid of pids) {
                console.log(`[vllm] Sending SIGTERM to PID ${pid}`);
                execFileSync('kill', [pid], { timeout: 5000 });
            }

            // Verify it's actually stopped
            execFileSync('sleep', ['2']);
            if (!isVllmRunning()) {
                console.log('[vllm] Server stopped successfully');
                return true;
            }

            // Force kill if still alive
            console.log('[vllm] Server still running, sending SIGKILL...');
            for (const pid of pids) {
                try {
                    execFileSync('kill', ['-9', pid], { timeout: 5000 });
                } catch {
                    // Process may already be gone
                }
            }
            return !isVllmRunning();
        }

        console.error('[vllm] Could not find process on port ' + VLLM_DEFAULT_PORT);
        return false;
    } catch (err) {
        console.error('[vllm] Failed to stop server:', err instanceof Error ? err.message : String(err));
        return false;
    }
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

    // Max model length depends on available VRAM (after model weights).
    // More VRAM = can handle longer context windows.
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
    };
}
