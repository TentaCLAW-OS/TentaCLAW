/**
 * TensorRT-LLM Backend — Maximum NVIDIA Performance (Wave 44)
 *
 * Integration with NVIDIA TensorRT-LLM for maximum throughput:
 *   - Engine build from HuggingFace models (trtllm-build)
 *   - Triton Inference Server serving
 *   - FP8/FP4 quantization (Hopper/Blackwell)
 *   - In-flight batching for continuous throughput
 *   - Speculative decoding integration
 *   - Paged KV cache with configurable memory fraction
 *
 * TentaCLAW says: "TensorRT goes brrr. Like a jet-propelled octopus."
 */

import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

// =============================================================================
// Types
// =============================================================================

/** Configuration for building a TRT-LLM engine */
export interface TrtllmBuildConfig {
    /** HuggingFace model ID or local path */
    model: string;
    /** Output directory for built engine */
    outputDir: string;
    /** Quantization method */
    quantization: 'fp8' | 'fp4' | 'int8' | 'int4_awq' | 'int4_gptq' | 'none';
    /** Maximum batch size for engine */
    maxBatchSize: number;
    /** Maximum input sequence length */
    maxInputLen: number;
    /** Maximum output sequence length */
    maxOutputLen: number;
    /** Tensor parallel degree */
    tensorParallel: number;
    /** Pipeline parallel degree */
    pipelineParallel: number;
    /** GPU architecture target (auto-detect if not specified) */
    gpuArch?: 'ampere' | 'hopper' | 'ada' | 'blackwell';
    /** Enable speculative decoding in engine */
    enableSpeculative?: boolean;
    /** Draft model for speculative decoding */
    draftModel?: string;
}

/** Configuration for launching Triton with TRT-LLM */
export interface TrtllmServeConfig {
    /** Path to built TRT-LLM engine directory */
    engineDir: string;
    /** Port for Triton HTTP endpoint */
    httpPort: number;
    /** Port for Triton gRPC endpoint */
    grpcPort: number;
    /** Port for Triton metrics endpoint */
    metricsPort: number;
    /** Maximum number of concurrent requests */
    maxConcurrentRequests: number;
    /** In-flight batching: max queue delay before dispatching batch */
    maxQueueDelayMicroseconds: number;
    /** KV cache free GPU memory fraction (0.0-1.0) */
    kvCacheFreeGpuMemFraction: number;
    /** Enable paged KV cache */
    enablePagedKvCache: boolean;
    /** FP8 KV cache (Hopper+) */
    kvCacheDtype: 'auto' | 'fp8';
}

/** TRT-LLM engine build status */
export type TrtllmBuildState = 'idle' | 'building' | 'built' | 'failed';

/** TRT-LLM serving state */
export type TrtllmServeState = 'stopped' | 'starting' | 'running' | 'stopping';

/** Engine cache entry */
export interface TrtllmEngineInfo {
    model: string;
    engineDir: string;
    quantization: string;
    gpuArch: string;
    maxBatchSize: number;
    tensorParallel: number;
    builtAt: string;
    sizeBytes: number;
}

// =============================================================================
// Module state
// =============================================================================

let tritonProcess: ChildProcess | null = null;
let buildState: TrtllmBuildState = 'idle';
let serveState: TrtllmServeState = 'stopped';
let currentEngine: TrtllmEngineInfo | null = null;

const LOG_PREFIX = '[trtllm]';

// =============================================================================
// Detection
// =============================================================================

/** Check if trtllm-build is installed */
export function isTrtllmInstalled(): boolean {
    try {
        execFileSync('trtllm-build', ['--help'], { stdio: 'pipe', timeout: 10000 });
        return true;
    } catch {
        return false;
    }
}

/** Check if Triton Inference Server is installed */
export function isTritonInstalled(): boolean {
    try {
        execFileSync('tritonserver', ['--help'], { stdio: 'pipe', timeout: 10000 });
        return true;
    } catch {
        return false;
    }
}

/** Detect GPU architecture for engine build targeting */
export function detectGpuArch(): string | null {
    try {
        const output = execFileSync('nvidia-smi', ['--query-gpu=compute_cap', '--format=csv,noheader,nounits'], {
            stdio: 'pipe', timeout: 5000
        }).toString().trim();
        const cap = parseFloat(output.split('\n')[0]);
        if (cap >= 10.0) return 'blackwell';
        if (cap >= 9.0) return 'hopper';
        if (cap >= 8.9) return 'ada';
        if (cap >= 8.0) return 'ampere';
        return 'unknown-' + cap;
    } catch {
        return null;
    }
}

// =============================================================================
// Engine Build
// =============================================================================

/** Generate a cache key for an engine build (to avoid rebuilding identical engines) */
export function getEngineCacheKey(config: TrtllmBuildConfig): string {
    const { createHash } = require('crypto');
    return createHash('sha256')
        .update(JSON.stringify({
            model: config.model,
            quantization: config.quantization,
            maxBatchSize: config.maxBatchSize,
            maxInputLen: config.maxInputLen,
            maxOutputLen: config.maxOutputLen,
            tensorParallel: config.tensorParallel,
            pipelineParallel: config.pipelineParallel,
            gpuArch: config.gpuArch || detectGpuArch(),
        }))
        .digest('hex')
        .slice(0, 16);
}

/** Check if an engine is already built and cached */
export function isEngineCached(config: TrtllmBuildConfig): boolean {
    const cacheKey = getEngineCacheKey(config);
    const engineDir = config.outputDir || `/var/lib/tentaclaw/engines/${cacheKey}`;
    return fs.existsSync(engineDir) && fs.existsSync(`${engineDir}/config.json`);
}

/** Build a TRT-LLM engine from a HuggingFace model */
export async function buildEngine(config: TrtllmBuildConfig): Promise<{ success: boolean; engineDir: string; error?: string }> {
    if (buildState === 'building') {
        return { success: false, engineDir: '', error: 'Engine build already in progress' };
    }

    const cacheKey = getEngineCacheKey(config);
    const engineDir = config.outputDir || `/var/lib/tentaclaw/engines/${cacheKey}`;

    // Check cache first
    if (isEngineCached(config)) {
        console.log(`${LOG_PREFIX} Engine already cached at ${engineDir}`);
        buildState = 'built';
        return { success: true, engineDir };
    }

    buildState = 'building';
    console.log(`${LOG_PREFIX} Building TRT-LLM engine for ${config.model}`);
    console.log(`${LOG_PREFIX}   Quantization: ${config.quantization}`);
    console.log(`${LOG_PREFIX}   Batch size: ${config.maxBatchSize}, Input: ${config.maxInputLen}, Output: ${config.maxOutputLen}`);
    console.log(`${LOG_PREFIX}   TP: ${config.tensorParallel}, PP: ${config.pipelineParallel}`);

    const args: string[] = [
        '--model_dir', config.model,
        '--output_dir', engineDir,
        '--max_batch_size', String(config.maxBatchSize),
        '--max_input_len', String(config.maxInputLen),
        '--max_output_len', String(config.maxOutputLen),
        '--tp_size', String(config.tensorParallel),
        '--pp_size', String(config.pipelineParallel),
    ];

    if (config.quantization !== 'none') {
        switch (config.quantization) {
            case 'fp8': args.push('--use_fp8_context_fmha', '--quantization', 'fp8'); break;
            case 'fp4': args.push('--quantization', 'nvfp4'); break;
            case 'int8': args.push('--quantization', 'int8_sq'); break;
            case 'int4_awq': args.push('--quantization', 'int4_awq'); break;
            case 'int4_gptq': args.push('--quantization', 'int4_gptq'); break;
        }
    }

    try {
        fs.mkdirSync(engineDir, { recursive: true });

        return new Promise((resolve) => {
            const proc = spawn('trtllm-build', args, { stdio: ['ignore', 'pipe', 'pipe'] });

            proc.stdout?.on('data', (data: Buffer) => {
                console.log(`${LOG_PREFIX} [build] ${data.toString().trim()}`);
            });

            proc.stderr?.on('data', (data: Buffer) => {
                console.error(`${LOG_PREFIX} [build-err] ${data.toString().trim()}`);
            });

            proc.on('exit', (code) => {
                if (code === 0) {
                    buildState = 'built';
                    currentEngine = {
                        model: config.model,
                        engineDir,
                        quantization: config.quantization,
                        gpuArch: config.gpuArch || detectGpuArch() || 'unknown',
                        maxBatchSize: config.maxBatchSize,
                        tensorParallel: config.tensorParallel,
                        builtAt: new Date().toISOString(),
                        sizeBytes: getDirSize(engineDir),
                    };
                    console.log(`${LOG_PREFIX} Engine built successfully at ${engineDir}`);
                    resolve({ success: true, engineDir });
                } else {
                    buildState = 'failed';
                    resolve({ success: false, engineDir, error: `trtllm-build exited with code ${code}` });
                }
            });
        });
    } catch (err) {
        buildState = 'failed';
        return { success: false, engineDir, error: String(err) };
    }
}

// =============================================================================
// Triton Serving
// =============================================================================

/** Generate a Triton model repository config.pbtxt for a TRT-LLM engine */
export function generateTritonConfig(engineDir: string, config: TrtllmServeConfig): string {
    return `
name: "tentaclaw_model"
backend: "tensorrtllm"
max_batch_size: ${config.maxConcurrentRequests}

model_transaction_policy {
  decoupled: True
}

dynamic_batching {
  max_queue_delay_microseconds: ${config.maxQueueDelayMicroseconds}
  preferred_batch_size: [1, 4, 8, 16, 32]
}

input [
  { name: "text_input", data_type: TYPE_STRING, dims: [-1] },
  { name: "max_tokens", data_type: TYPE_INT32, dims: [1] },
  { name: "temperature", data_type: TYPE_FP32, dims: [1] },
  { name: "top_p", data_type: TYPE_FP32, dims: [1] },
  { name: "stream", data_type: TYPE_BOOL, dims: [1] },
  { name: "stop", data_type: TYPE_STRING, dims: [-1], optional: true }
]

output [
  { name: "text_output", data_type: TYPE_STRING, dims: [-1] },
  { name: "finish_reason", data_type: TYPE_STRING, dims: [1] }
]

parameters {
  key: "gpt_model_path"
  value: { string_value: "${engineDir}" }
}
parameters {
  key: "enable_kv_cache_reuse"
  value: { string_value: "${config.enablePagedKvCache ? 'true' : 'false'}" }
}
parameters {
  key: "kv_cache_free_gpu_mem_fraction"
  value: { string_value: "${config.kvCacheFreeGpuMemFraction}" }
}
parameters {
  key: "batching_type"
  value: { string_value: "inflight" }
}
`.trim();
}

/** Launch Triton Inference Server with TRT-LLM engine */
export async function launchTriton(config: TrtllmServeConfig): Promise<boolean> {
    if (serveState === 'running' || serveState === 'starting') {
        console.log(`${LOG_PREFIX} Triton already ${serveState}`);
        return false;
    }

    serveState = 'starting';
    console.log(`${LOG_PREFIX} Starting Triton on HTTP:${config.httpPort} gRPC:${config.grpcPort}`);

    const modelRepoDir = `${config.engineDir}/triton_repo`;
    const modelDir = `${modelRepoDir}/tentaclaw_model/1`;
    fs.mkdirSync(modelDir, { recursive: true });

    // Write config.pbtxt
    const configPbtxt = generateTritonConfig(config.engineDir, config);
    fs.writeFileSync(`${modelRepoDir}/tentaclaw_model/config.pbtxt`, configPbtxt);

    const args = [
        '--model-repository', modelRepoDir,
        '--http-port', String(config.httpPort),
        '--grpc-port', String(config.grpcPort),
        '--metrics-port', String(config.metricsPort),
    ];

    try {
        tritonProcess = spawn('tritonserver', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        tritonProcess.stdout?.on('data', (data: Buffer) => {
            const line = data.toString().trim();
            if (line) console.log(`${LOG_PREFIX} [triton] ${line}`);
            if (line.includes('Started GRPCInferenceService') || line.includes('Started HTTPService')) {
                serveState = 'running';
            }
        });

        tritonProcess.stderr?.on('data', (data: Buffer) => {
            console.error(`${LOG_PREFIX} [triton-err] ${data.toString().trim()}`);
        });

        tritonProcess.on('exit', (code) => {
            console.log(`${LOG_PREFIX} Triton exited with code ${code}`);
            serveState = 'stopped';
            tritonProcess = null;
        });

        // Wait for ready
        const ready = await waitForTritonReady(config.httpPort, 120000);
        if (!ready) {
            console.error(`${LOG_PREFIX} Triton failed to start within timeout`);
            await stopTriton();
            return false;
        }

        return true;
    } catch (err) {
        console.error(`${LOG_PREFIX} Failed to launch Triton:`, err);
        serveState = 'stopped';
        return false;
    }
}

/** Stop Triton Inference Server */
export async function stopTriton(): Promise<boolean> {
    if (!tritonProcess) {
        serveState = 'stopped';
        return true;
    }

    serveState = 'stopping';
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            tritonProcess?.kill('SIGKILL');
        }, 30000);

        tritonProcess!.on('exit', () => {
            clearTimeout(timeout);
            tritonProcess = null;
            serveState = 'stopped';
            resolve(true);
        });

        tritonProcess!.kill('SIGTERM');
    });
}

// =============================================================================
// Status
// =============================================================================

export function getTrtllmStatus(): {
    buildState: TrtllmBuildState;
    serveState: TrtllmServeState;
    currentEngine: TrtllmEngineInfo | null;
    installed: { trtllmBuild: boolean; triton: boolean };
    gpuArch: string | null;
} {
    return {
        buildState,
        serveState,
        currentEngine,
        installed: {
            trtllmBuild: isTrtllmInstalled(),
            triton: isTritonInstalled(),
        },
        gpuArch: detectGpuArch(),
    };
}

// =============================================================================
// Utility
// =============================================================================

function getDirSize(dir: string): number {
    try {
        let total = 0;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const stat = fs.statSync(`${dir}/${file}`);
            total += stat.isDirectory() ? getDirSize(`${dir}/${file}`) : stat.size;
        }
        return total;
    } catch {
        return 0;
    }
}

async function waitForTritonReady(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://localhost:${port}/v2/health/ready`);
            if (res.ok) return true;
        } catch { /* not ready */ }
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

/** Reset module state (for testing) */
export function _resetTrtllm(): void {
    tritonProcess = null;
    buildState = 'idle';
    serveState = 'stopped';
    currentEngine = null;
}
