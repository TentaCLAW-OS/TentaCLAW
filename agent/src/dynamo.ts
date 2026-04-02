/**
 * NVIDIA Dynamo Backend — Disaggregated Inference (Wave 41)
 *
 * Integration with NVIDIA Dynamo 1.0 for datacenter-scale inference:
 *   - Disaggregated prefill/decode (separate GPU pools)
 *   - NIXL KV cache transfer (GPU-to-GPU at wire speed)
 *   - NATS-based request routing
 *   - Dynamic worker scaling
 *   - 7x throughput on Blackwell hardware
 *
 * Dynamo is the inference OS adopted by AWS, Azure, and GCP.
 * This backend integrates TentaCLAW's orchestration with Dynamo's execution.
 *
 * TentaCLAW says: "Disaggregated? I've been doing that with 8 arms since birth."
 */

import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

// =============================================================================
// Types
// =============================================================================

/** Configuration for a Dynamo-managed inference deployment */
export interface DynamoConfig {
    /** Model to serve (HuggingFace ID or local path) */
    model: string;
    /** NATS server URL for request routing */
    natsUrl: string;
    /** Number of prefill worker GPUs */
    prefillWorkers: number;
    /** Number of decode worker GPUs */
    decodeWorkers: number;
    /** GPU indices for prefill pool (e.g., [0, 1]) */
    prefillGpuIds: number[];
    /** GPU indices for decode pool (e.g., [2, 3]) */
    decodeGpuIds: number[];
    /** Enable NIXL for GPU-to-GPU KV cache transfer */
    enableNixl: boolean;
    /** Tensor parallel degree per worker */
    tensorParallel: number;
    /** Maximum model length (context window) */
    maxModelLen: number;
    /** Quantization method */
    quantization: 'fp8' | 'fp4' | 'awq' | 'none';
    /** KV cache dtype (fp8_e5m2 for Hopper+, fp4 for Blackwell) */
    kvCacheDtype: 'auto' | 'fp8_e5m2' | 'fp8_e4m3' | 'fp4';
    /** Port for Dynamo HTTP API */
    port: number;
    /** Extra arguments passed to dynamo-run */
    extraArgs: string[];
}

/** State of the Dynamo cluster */
export type DynamoState = 'stopped' | 'starting' | 'running' | 'degraded' | 'stopping';

/** Dynamo health information */
export interface DynamoHealth {
    state: DynamoState;
    prefillWorkersHealthy: number;
    decodeWorkersHealthy: number;
    natsConnected: boolean;
    nixlEnabled: boolean;
    kvCacheTransferLatencyMs: number;
    throughputToksPerSec: number;
    ttftP50Ms: number;
    ttftP99Ms: number;
}

/** Dynamo metrics scraped from the running cluster */
export interface DynamoMetrics {
    prefillQueueDepth: number;
    decodeQueueDepth: number;
    activeRequests: number;
    completedRequests: number;
    kvCacheHitRate: number;
    kvCacheTransferBytes: number;
    gpuUtilizationPrefill: number[];
    gpuUtilizationDecode: number[];
}

// =============================================================================
// Module state
// =============================================================================

let dynamoProcess: ChildProcess | null = null;
let currentConfig: DynamoConfig | null = null;
let currentState: DynamoState = 'stopped';
let startedAt: number = 0;
const LOG_PREFIX = '[dynamo]';

// =============================================================================
// Detection
// =============================================================================

/** Check if Dynamo is installed (dynamo-run binary available) */
export function isDynamoInstalled(): boolean {
    try {
        execFileSync('dynamo-run', ['--version'], { stdio: 'pipe', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/** Get Dynamo version string */
export function getDynamoVersion(): string | null {
    try {
        return execFileSync('dynamo-run', ['--version'], { stdio: 'pipe', timeout: 5000 })
            .toString().trim();
    } catch {
        return null;
    }
}

/** Check if NATS server is reachable */
export async function isNatsReachable(url: string = 'nats://localhost:4222'): Promise<boolean> {
    try {
        const host = url.replace('nats://', '').split(':')[0];
        const port = parseInt(url.split(':')[2] || '4222', 10);
        // Simple TCP connect check
        return new Promise((resolve) => {
            const net = require('net');
            const sock = net.createConnection({ host, port, timeout: 2000 }, () => {
                sock.destroy();
                resolve(true);
            });
            sock.on('error', () => { sock.destroy(); resolve(false); });
            sock.on('timeout', () => { sock.destroy(); resolve(false); });
        });
    } catch {
        return false;
    }
}

/** Check if NIXL is available (nvidia_peermem kernel module loaded) */
export function isNixlAvailable(): boolean {
    try {
        const modules = fs.readFileSync('/proc/modules', 'utf-8');
        return modules.includes('nvidia_peermem');
    } catch {
        // Non-Linux or /proc not available
        return false;
    }
}

// =============================================================================
// Lifecycle
// =============================================================================

/** Launch Dynamo with disaggregated prefill/decode configuration */
export async function launchDynamo(config: DynamoConfig): Promise<boolean> {
    if (currentState === 'running' || currentState === 'starting') {
        console.log(`${LOG_PREFIX} Dynamo already ${currentState}`);
        return false;
    }

    currentState = 'starting';
    currentConfig = config;
    console.log(`${LOG_PREFIX} Starting Dynamo for ${config.model}`);
    console.log(`${LOG_PREFIX}   Prefill workers: ${config.prefillWorkers} (GPUs: ${config.prefillGpuIds.join(',')})`);
    console.log(`${LOG_PREFIX}   Decode workers: ${config.decodeWorkers} (GPUs: ${config.decodeGpuIds.join(',')})`);
    console.log(`${LOG_PREFIX}   NIXL: ${config.enableNixl ? 'ENABLED' : 'DISABLED'}`);
    console.log(`${LOG_PREFIX}   NATS: ${config.natsUrl}`);

    const args: string[] = [
        '--model', config.model,
        '--port', String(config.port),
        '--prefill-workers', String(config.prefillWorkers),
        '--decode-workers', String(config.decodeWorkers),
        '--tensor-parallel', String(config.tensorParallel),
    ];

    if (config.maxModelLen > 0) {
        args.push('--max-model-len', String(config.maxModelLen));
    }
    if (config.quantization !== 'none') {
        args.push('--quantization', config.quantization);
    }
    if (config.kvCacheDtype !== 'auto') {
        args.push('--kv-cache-dtype', config.kvCacheDtype);
    }
    if (config.enableNixl) {
        args.push('--enable-nixl');
    }
    args.push('--nats-url', config.natsUrl);

    // Set GPU visibility per pool
    const env = {
        ...process.env,
        CUDA_VISIBLE_DEVICES: [...config.prefillGpuIds, ...config.decodeGpuIds].join(','),
        DYNAMO_PREFILL_GPUS: config.prefillGpuIds.join(','),
        DYNAMO_DECODE_GPUS: config.decodeGpuIds.join(','),
    };

    if (config.extraArgs.length > 0) {
        args.push(...config.extraArgs);
    }

    try {
        dynamoProcess = spawn('dynamo-run', args, {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        dynamoProcess.stdout?.on('data', (data: Buffer) => {
            const line = data.toString().trim();
            if (line) console.log(`${LOG_PREFIX} ${line}`);
            if (line.includes('ready') || line.includes('serving')) {
                currentState = 'running';
                startedAt = Date.now();
                console.log(`${LOG_PREFIX} Dynamo is RUNNING — disaggregated prefill/decode active`);
            }
        });

        dynamoProcess.stderr?.on('data', (data: Buffer) => {
            console.error(`${LOG_PREFIX} [stderr] ${data.toString().trim()}`);
        });

        dynamoProcess.on('exit', (code) => {
            console.log(`${LOG_PREFIX} Dynamo process exited with code ${code}`);
            currentState = 'stopped';
            dynamoProcess = null;
        });

        // Wait for startup (max 120 seconds for large models)
        const started = await waitForReady(config.port, 120000);
        if (!started) {
            console.error(`${LOG_PREFIX} Dynamo failed to start within timeout`);
            await stopDynamo();
            return false;
        }

        return true;
    } catch (err) {
        console.error(`${LOG_PREFIX} Failed to launch Dynamo:`, err);
        currentState = 'stopped';
        return false;
    }
}

/** Stop the Dynamo cluster */
export async function stopDynamo(): Promise<boolean> {
    if (!dynamoProcess) {
        currentState = 'stopped';
        return true;
    }

    currentState = 'stopping';
    console.log(`${LOG_PREFIX} Stopping Dynamo...`);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn(`${LOG_PREFIX} SIGTERM timeout — sending SIGKILL`);
            dynamoProcess?.kill('SIGKILL');
        }, 30000);

        dynamoProcess!.on('exit', () => {
            clearTimeout(timeout);
            dynamoProcess = null;
            currentState = 'stopped';
            console.log(`${LOG_PREFIX} Dynamo stopped`);
            resolve(true);
        });

        dynamoProcess!.kill('SIGTERM');
    });
}

// =============================================================================
// Health
// =============================================================================

/** Get Dynamo health status */
export function getDynamoHealth(): DynamoHealth & { uptimeMs: number } {
    return {
        state: currentState,
        prefillWorkersHealthy: currentConfig?.prefillWorkers || 0,
        decodeWorkersHealthy: currentConfig?.decodeWorkers || 0,
        natsConnected: currentState === 'running',
        nixlEnabled: currentConfig?.enableNixl || false,
        kvCacheTransferLatencyMs: 0,
        throughputToksPerSec: 0,
        ttftP50Ms: 0,
        ttftP99Ms: 0,
        uptimeMs: startedAt > 0 ? Date.now() - startedAt : 0,
    };
}

/** Get current Dynamo state */
export function getDynamoState(): DynamoState {
    return currentState;
}

/** Check if Dynamo is healthy */
export function isDynamoHealthy(): boolean {
    return currentState === 'running';
}

// =============================================================================
// Metrics
// =============================================================================

/** Get Dynamo metrics (scraped from running cluster) */
export async function getDynamoMetrics(port?: number): Promise<DynamoMetrics | null> {
    const p = port || currentConfig?.port || 8080;
    try {
        const res = await fetch(`http://localhost:${p}/metrics`);
        if (!res.ok) return null;
        const text = await res.text();
        // Parse Prometheus metrics from Dynamo
        return parseDynamoMetrics(text);
    } catch {
        return null;
    }
}

function parseDynamoMetrics(text: string): DynamoMetrics {
    const getMetric = (name: string): number => {
        const match = text.match(new RegExp(`${name}\\s+(\\d+\\.?\\d*)`));
        return match ? parseFloat(match[1]) : 0;
    };

    return {
        prefillQueueDepth: getMetric('dynamo_prefill_queue_depth'),
        decodeQueueDepth: getMetric('dynamo_decode_queue_depth'),
        activeRequests: getMetric('dynamo_active_requests'),
        completedRequests: getMetric('dynamo_completed_requests_total'),
        kvCacheHitRate: getMetric('dynamo_kv_cache_hit_rate'),
        kvCacheTransferBytes: getMetric('dynamo_kv_cache_transfer_bytes_total'),
        gpuUtilizationPrefill: [],
        gpuUtilizationDecode: [],
    };
}

// =============================================================================
// Utility
// =============================================================================

async function waitForReady(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://localhost:${port}/health`);
            if (res.ok) return true;
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

/** Get a recommendation for Dynamo configuration based on available GPUs */
export function getDynamoRecommendation(gpuCount: number, totalVramMb: number): {
    recommended: boolean;
    reason: string;
    config: Partial<DynamoConfig>;
} {
    if (gpuCount < 2) {
        return {
            recommended: false,
            reason: 'Dynamo disaggregated mode requires at least 2 GPUs (1 prefill + 1 decode). Use vLLM or SGLang for single-GPU.',
            config: {},
        };
    }

    if (gpuCount < 4) {
        return {
            recommended: true,
            reason: `${gpuCount} GPUs: recommended split is 1 prefill + ${gpuCount - 1} decode`,
            config: {
                prefillWorkers: 1,
                decodeWorkers: gpuCount - 1,
                prefillGpuIds: [0],
                decodeGpuIds: Array.from({ length: gpuCount - 1 }, (_, i) => i + 1),
                enableNixl: true,
            },
        };
    }

    // 4+ GPUs: split evenly between prefill and decode
    const prefill = Math.floor(gpuCount / 3);     // ~33% prefill (compute-bound)
    const decode = gpuCount - prefill;              // ~67% decode (memory-bound)
    return {
        recommended: true,
        reason: `${gpuCount} GPUs: optimal split is ${prefill} prefill + ${decode} decode (compute/memory balanced)`,
        config: {
            prefillWorkers: prefill,
            decodeWorkers: decode,
            prefillGpuIds: Array.from({ length: prefill }, (_, i) => i),
            decodeGpuIds: Array.from({ length: decode }, (_, i) => i + prefill),
            enableNixl: true,
            kvCacheDtype: totalVramMb > 80000 ? 'fp8_e5m2' : 'auto', // FP8 KV cache if Hopper+ (80GB+ VRAM)
        },
    };
}

/** Reset module state (for testing) */
export function _resetDynamo(): void {
    dynamoProcess = null;
    currentConfig = null;
    currentState = 'stopped';
    startedAt = 0;
}
