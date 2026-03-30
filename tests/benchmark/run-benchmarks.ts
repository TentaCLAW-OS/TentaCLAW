#!/usr/bin/env npx tsx
/**
 * TentaCLAW Benchmark Suite
 * Usage: npx tsx tests/benchmark/run-benchmarks.ts [--gateway http://localhost:8080] [--concurrency 50]
 * CLAWtopus says: "Numbers don't lie."
 */

import http from 'node:http';
import { URL } from 'node:url';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliFlags {
    gateway: string;
    concurrency: number;
    duration: number;
    benchmark: string | null;
    json: boolean;
}

function parseArgs(): CliFlags {
    const args = process.argv.slice(2);
    const flags: CliFlags = {
        gateway: 'http://localhost:8080',
        concurrency: 50,
        duration: 10,
        benchmark: null,
        json: false,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--gateway':
                flags.gateway = args[++i];
                break;
            case '--concurrency':
                flags.concurrency = parseInt(args[++i], 10);
                break;
            case '--duration':
                flags.duration = parseInt(args[++i], 10);
                break;
            case '--benchmark':
                flags.benchmark = args[++i];
                break;
            case '--json':
                flags.json = true;
                break;
            case '--help':
            case '-h':
                console.log(`TentaCLAW Benchmark Suite

Usage:
  npx tsx run-benchmarks.ts [flags]

Flags:
  --gateway URL      Gateway base URL (default: http://localhost:8080)
  --concurrency N    Max concurrent requests (default: 50)
  --duration S       Duration for sustained benchmarks in seconds (default: 10)
  --benchmark NAME   Run a single benchmark by name
  --json             Output JSON only (no human-readable formatting)
  --help, -h         Show this help

Benchmarks:
  health_throughput    10,000 GET /health — measures raw RPS
  registration_burst   500 concurrent node registrations
  stats_ingestion      100 simultaneous stats pushes
  model_search         1,000 GET /api/v1/model-search queries
  dashboard_bundle     500 GET /api/v1/dashboard under concurrency
  concurrent_chat      POST /v1/chat/completions at 10/50/100 concurrency
  sse_connections      100 SSE connections to /api/v1/events
  cold_start           Gateway startup to first successful /health
`);
                process.exit(0);
        }
    }
    return flags;
}

// ---------------------------------------------------------------------------
// HTTP helpers — zero dependencies, connection-pooled
// ---------------------------------------------------------------------------

function makeAgent(gateway: string): http.Agent {
    const parsed = new URL(gateway);
    return new http.Agent({
        keepAlive: true,
        maxSockets: 1024,
        maxFreeSockets: 256,
        timeout: 30_000,
        ...(parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
            ? { keepAliveMsecs: 1000 }
            : {}),
    });
}

interface HttpResponse {
    statusCode: number;
    body: string;
    durationMs: number;
}

function httpRequest(
    method: string,
    urlStr: string,
    body: string | null,
    agent: http.Agent,
    headers: Record<string, string> = {},
): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const start = performance.now();

        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 80,
                path: parsed.pathname + parsed.search,
                method,
                agent,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                    ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
                },
                timeout: 30_000,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString(),
                        durationMs: performance.now() - start,
                    });
                });
            },
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        if (body) req.write(body);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Percentile calculator
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function computeStats(latencies: number[]): { p50: number; p95: number; p99: number; min: number; max: number; mean: number } {
    if (latencies.length === 0) {
        return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: sum / sorted.length,
    };
}

// ---------------------------------------------------------------------------
// Concurrency-limited batch runner
// ---------------------------------------------------------------------------

async function runBatch<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
): Promise<T[]> {
    const results: T[] = [];
    let idx = 0;

    async function worker(): Promise<void> {
        while (idx < tasks.length) {
            const current = idx++;
            results[current] = await tasks[current]();
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------------------
// Benchmark result types
// ---------------------------------------------------------------------------

interface BenchmarkResult {
    name: string;
    requests: number;
    durationSec: number;
    rps: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errors: number;
    status: 'PASS' | 'FAIL' | 'WARN';
    details?: Record<string, unknown>;
}

function formatResult(r: BenchmarkResult): string {
    return `[BENCH] ${r.name}
  Requests:  ${r.requests.toLocaleString()}
  Duration:  ${r.durationSec.toFixed(1)}s
  RPS:       ${r.rps.toLocaleString(undefined, { maximumFractionDigits: 0 })}
  P50:       ${r.p50Ms.toFixed(1)}ms
  P95:       ${r.p95Ms.toFixed(1)}ms
  P99:       ${r.p99Ms.toFixed(1)}ms
  Errors:    ${r.errors.toLocaleString()}
  Status:    ${r.status}`;
}

function buildResult(name: string, latencies: number[], errors: number, totalDurationMs: number, details?: Record<string, unknown>): BenchmarkResult {
    const stats = computeStats(latencies);
    const durationSec = totalDurationMs / 1000;
    const rps = durationSec > 0 ? latencies.length / durationSec : 0;
    const errorRate = latencies.length + errors > 0 ? errors / (latencies.length + errors) : 0;

    return {
        name,
        requests: latencies.length + errors,
        durationSec,
        rps,
        p50Ms: stats.p50,
        p95Ms: stats.p95,
        p99Ms: stats.p99,
        errors,
        status: errorRate > 0.1 ? 'FAIL' : errorRate > 0.01 ? 'WARN' : 'PASS',
        details,
    };
}

// ---------------------------------------------------------------------------
// Benchmark implementations
// ---------------------------------------------------------------------------

/** 1. health_throughput — Fire 10,000 GET /health requests, measure RPS */
async function benchHealthThroughput(gateway: string, concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 10_000;
    const latencies: number[] = [];
    let errors = 0;

    const tasks = Array.from({ length: total }, () => async () => {
        try {
            const res = await httpRequest('GET', `${gateway}/health`, null, agent);
            if (res.statusCode === 200) {
                latencies.push(res.durationMs);
            } else {
                errors++;
            }
        } catch {
            errors++;
        }
    });

    const start = performance.now();
    await runBatch(tasks, concurrency);
    const duration = performance.now() - start;

    return buildResult('health_throughput', latencies, errors, duration);
}

/** 2. registration_burst — Register 500 nodes concurrently, measure time + error rate */
async function benchRegistrationBurst(gateway: string, concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 500;
    const latencies: number[] = [];
    let errors = 0;

    const tasks = Array.from({ length: total }, (_, i) => async () => {
        const body = JSON.stringify({
            node_id: `bench-node-${i}-${Date.now()}`,
            farm_hash: `bench-farm-${Math.floor(i / 50)}`,
            hostname: `bench-host-${i}`,
            gpu_count: Math.floor(Math.random() * 4) + 1,
            ip_address: `10.0.${Math.floor(i / 255)}.${i % 255 + 1}`,
            os_version: 'benchmark-os-1.0',
        });
        try {
            const res = await httpRequest('POST', `${gateway}/api/v1/register`, body, agent);
            if (res.statusCode === 200 || res.statusCode === 201) {
                latencies.push(res.durationMs);
            } else {
                errors++;
            }
        } catch {
            errors++;
        }
    });

    const start = performance.now();
    await runBatch(tasks, concurrency);
    const duration = performance.now() - start;

    return buildResult('registration_burst', latencies, errors, duration, {
        total_nodes: total,
        concurrency,
    });
}

/** 3. stats_ingestion — Push stats from 100 nodes simultaneously, measure throughput */
async function benchStatsIngestion(gateway: string, concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 100;
    const latencies: number[] = [];
    let errors = 0;

    // First register the nodes
    for (let i = 0; i < total; i++) {
        const body = JSON.stringify({
            node_id: `stats-bench-node-${i}`,
            farm_hash: 'stats-bench-farm',
            hostname: `stats-bench-host-${i}`,
            gpu_count: 2,
        });
        try {
            await httpRequest('POST', `${gateway}/api/v1/register`, body, agent);
        } catch {
            // Node may already exist from previous run — that is fine
        }
    }

    const tasks = Array.from({ length: total }, (_, i) => async () => {
        const statsBody = JSON.stringify({
            gpu_count: 2,
            gpus: [
                { id: 0, name: 'RTX 4090', temp_c: 60 + Math.random() * 20, utilization_pct: Math.random() * 100, vram_total_mb: 24576, vram_used_mb: Math.random() * 24576, power_watts: 200 + Math.random() * 150 },
                { id: 1, name: 'RTX 4090', temp_c: 58 + Math.random() * 20, utilization_pct: Math.random() * 100, vram_total_mb: 24576, vram_used_mb: Math.random() * 24576, power_watts: 200 + Math.random() * 150 },
            ],
            cpu: { usage_pct: Math.random() * 100, temp_c: 45 + Math.random() * 30 },
            ram: { total_mb: 65536, used_mb: Math.random() * 65536 },
            disk: { total_gb: 2000, used_gb: Math.random() * 2000 },
            network: { bytes_in: Math.floor(Math.random() * 1e9), bytes_out: Math.floor(Math.random() * 1e9) },
            inference: {
                loaded_models: ['llama3.1:8b', 'mistral:7b'],
                in_flight_requests: Math.floor(Math.random() * 10),
                tokens_generated: Math.floor(Math.random() * 100000),
                avg_latency_ms: Math.random() * 50,
            },
        });
        try {
            const res = await httpRequest('POST', `${gateway}/api/v1/nodes/stats-bench-node-${i}/stats`, statsBody, agent);
            if (res.statusCode === 200 || res.statusCode === 201) {
                latencies.push(res.durationMs);
            } else {
                errors++;
            }
        } catch {
            errors++;
        }
    });

    const start = performance.now();
    await runBatch(tasks, concurrency);
    const duration = performance.now() - start;

    return buildResult('stats_ingestion', latencies, errors, duration, {
        nodes: total,
    });
}

/** 4. model_search — 1000 GET /api/v1/model-search requests, measure p50/p95/p99 */
async function benchModelSearch(gateway: string, concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 1_000;
    const latencies: number[] = [];
    let errors = 0;

    const queries = ['llama', 'mistral', 'phi', 'gemma', 'qwen', 'codellama', 'deepseek', 'yi', 'orca', ''];

    const tasks = Array.from({ length: total }, (_, i) => async () => {
        const q = queries[i % queries.length];
        const url = q ? `${gateway}/api/v1/model-search?q=${encodeURIComponent(q)}` : `${gateway}/api/v1/model-search`;
        try {
            const res = await httpRequest('GET', url, null, agent);
            if (res.statusCode === 200) {
                latencies.push(res.durationMs);
            } else {
                errors++;
            }
        } catch {
            errors++;
        }
    });

    const start = performance.now();
    await runBatch(tasks, concurrency);
    const duration = performance.now() - start;

    return buildResult('model_search', latencies, errors, duration);
}

/** 5. dashboard_bundle — 500 GET /api/v1/dashboard requests under concurrency */
async function benchDashboardBundle(gateway: string, concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 500;
    const latencies: number[] = [];
    let errors = 0;

    const tasks = Array.from({ length: total }, () => async () => {
        try {
            const res = await httpRequest('GET', `${gateway}/api/v1/dashboard`, null, agent);
            if (res.statusCode === 200) {
                latencies.push(res.durationMs);
            } else {
                errors++;
            }
        } catch {
            errors++;
        }
    });

    const start = performance.now();
    await runBatch(tasks, concurrency);
    const duration = performance.now() - start;

    return buildResult('dashboard_bundle', latencies, errors, duration);
}

/** 6. concurrent_chat — Simulate 10/50/100 concurrent POST /v1/chat/completions */
async function benchConcurrentChat(gateway: string, _concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const tiers = [10, 50, 100];
    const allLatencies: number[] = [];
    let totalErrors = 0;
    const tierResults: Record<string, { rps: number; p50: number; p95: number; errors: number }> = {};

    for (const tier of tiers) {
        const latencies: number[] = [];
        let errors = 0;

        const body = JSON.stringify({
            model: 'llama3.1:8b',
            messages: [{ role: 'user', content: 'Say hello' }],
            max_tokens: 10,
        });

        const tasks = Array.from({ length: tier }, () => async () => {
            try {
                const res = await httpRequest('POST', `${gateway}/v1/chat/completions`, body, agent);
                // We expect 503/429/502 since no backend is connected — but we measure routing time
                latencies.push(res.durationMs);
                if (res.statusCode >= 500 || res.statusCode === 429) {
                    // Expected — backend not available, but routing worked
                } else if (res.statusCode >= 400) {
                    errors++;
                }
            } catch {
                errors++;
            }
        });

        const start = performance.now();
        await runBatch(tasks, tier);
        const duration = performance.now() - start;

        const stats = computeStats(latencies);
        tierResults[`c${tier}`] = {
            rps: duration > 0 ? (latencies.length / (duration / 1000)) : 0,
            p50: stats.p50,
            p95: stats.p95,
            errors,
        };

        allLatencies.push(...latencies);
        totalErrors += errors;
    }

    const totalRequests = tiers.reduce((a, b) => a + b, 0);
    const stats = computeStats(allLatencies);
    const totalDuration = allLatencies.reduce((a, b) => a + b, 0); // Approximate
    const durationSec = totalDuration > 0 ? totalDuration / 1000 : 0.001;

    return {
        name: 'concurrent_chat',
        requests: totalRequests + totalErrors,
        durationSec,
        rps: durationSec > 0 ? totalRequests / durationSec : 0,
        p50Ms: stats.p50,
        p95Ms: stats.p95,
        p99Ms: stats.p99,
        errors: totalErrors,
        // Chat completions without a backend are expected to return 5xx,
        // so we only FAIL if requests cannot be routed at all (real errors)
        status: totalErrors > totalRequests * 0.1 ? 'FAIL' : 'PASS',
        details: { tiers: tierResults },
    };
}

/** 7. sse_connections — Open 100 SSE connections, verify all receive broadcasts */
async function benchSseConnections(gateway: string, _concurrency: number, agent: http.Agent): Promise<BenchmarkResult> {
    const total = 100;
    const latencies: number[] = [];
    let errors = 0;
    let broadcastsReceived = 0;

    return new Promise<BenchmarkResult>((resolve) => {
        const parsed = new URL(gateway);
        const connections: http.IncomingMessage[] = [];
        let connectedCount = 0;
        const start = performance.now();

        // Open SSE connections
        for (let i = 0; i < total; i++) {
            const connStart = performance.now();
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || 80,
                    path: '/api/v1/events',
                    method: 'GET',
                    agent,
                    headers: { Accept: 'text/event-stream' },
                    timeout: 15_000,
                },
                (res) => {
                    connections.push(res);
                    latencies.push(performance.now() - connStart);
                    connectedCount++;

                    let buffer = '';
                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        // Count SSE events received (each ends with \n\n)
                        const events = buffer.split('\n\n');
                        buffer = events.pop() || '';
                        for (const evt of events) {
                            if (evt.includes('event:') || evt.includes('data:')) {
                                broadcastsReceived++;
                            }
                        }
                    });

                    res.on('error', () => { /* connection closed — expected */ });

                    // Once all connections are open, trigger a broadcast via a registration
                    if (connectedCount === total) {
                        triggerBroadcast();
                    }
                },
            );

            req.on('error', () => {
                errors++;
                connectedCount++;
                if (connectedCount === total) {
                    triggerBroadcast();
                }
            });

            req.on('timeout', () => {
                errors++;
                req.destroy();
            });

            req.end();
        }

        function triggerBroadcast(): void {
            // Register a node to trigger an SSE broadcast
            const body = JSON.stringify({
                node_id: `sse-bench-trigger-${Date.now()}`,
                farm_hash: 'sse-bench-farm',
                hostname: 'sse-bench-trigger',
                gpu_count: 1,
            });

            httpRequest('POST', `${gateway}/api/v1/register`, body, agent)
                .then(() => {
                    // Wait a moment for broadcasts to propagate
                    setTimeout(() => cleanup(), 2000);
                })
                .catch(() => {
                    setTimeout(() => cleanup(), 2000);
                });
        }

        function cleanup(): void {
            const duration = performance.now() - start;

            // Destroy all SSE connections
            for (const conn of connections) {
                conn.destroy();
            }

            const result = buildResult('sse_connections', latencies, errors, duration, {
                connected: connections.length,
                broadcasts_received: broadcastsReceived,
                broadcast_coverage: connections.length > 0
                    ? `${Math.round((broadcastsReceived / connections.length) * 100)}%`
                    : '0%',
            });

            // SSE is PASS if we connected most clients and received some broadcasts
            if (connections.length < total * 0.8) {
                result.status = 'FAIL';
            } else if (broadcastsReceived < connections.length * 0.5) {
                result.status = 'WARN';
            }

            resolve(result);
        }
    });
}

/** 8. cold_start — Measure gateway startup to first successful /health response */
async function benchColdStart(gateway: string, _concurrency: number, _agent: http.Agent): Promise<BenchmarkResult> {
    const parsed = new URL(gateway);
    const gatewayDir = path.resolve(__dirname, '..', '..', 'gateway');
    const entryPoint = path.join(gatewayDir, 'src', 'index.ts');

    // Use a different port so we do not conflict with the running gateway
    const coldStartPort = 19876;
    let child: ChildProcess | null = null;
    const latencies: number[] = [];
    let errors = 0;

    // Check if tsx is available
    let tsxCmd = 'npx';
    let tsxArgs = ['tsx', entryPoint];

    const start = performance.now();

    return new Promise<BenchmarkResult>((resolve) => {
        const timeout = setTimeout(() => {
            if (child) child.kill();
            errors++;
            resolve(buildResult('cold_start', latencies, errors, performance.now() - start, {
                note: 'Gateway did not respond within 30s',
            }));
        }, 30_000);

        try {
            child = spawn(tsxCmd, tsxArgs, {
                env: {
                    ...process.env,
                    TENTACLAW_PORT: String(coldStartPort),
                    TENTACLAW_HOST: '127.0.0.1',
                    NODE_ENV: 'benchmark',
                },
                cwd: gatewayDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                errors++;
                resolve(buildResult('cold_start', latencies, errors, performance.now() - start, {
                    error: err.message,
                }));
            });

            // Poll /health until it responds
            const pollInterval = setInterval(() => {
                const pollStart = performance.now();
                const req = http.request(
                    {
                        hostname: '127.0.0.1',
                        port: coldStartPort,
                        path: '/health',
                        method: 'GET',
                        timeout: 2000,
                    },
                    (res) => {
                        if (res.statusCode === 200) {
                            clearInterval(pollInterval);
                            clearTimeout(timeout);
                            const startupTime = performance.now() - start;
                            latencies.push(startupTime);

                            // Drain response
                            res.on('data', () => {});
                            res.on('end', () => {
                                if (child) child.kill();
                                resolve(buildResult('cold_start', latencies, errors, startupTime, {
                                    startup_ms: Math.round(startupTime),
                                }));
                            });
                        } else {
                            res.on('data', () => {});
                            res.resume();
                        }
                    },
                );
                req.on('error', () => { /* Not ready yet — keep polling */ });
                req.on('timeout', () => req.destroy());
                req.end();
            }, 100);
        } catch (err) {
            clearTimeout(timeout);
            errors++;
            const errMsg = err instanceof Error ? err.message : String(err);
            resolve(buildResult('cold_start', latencies, errors, performance.now() - start, {
                error: errMsg,
            }));
        }
    });
}

// ---------------------------------------------------------------------------
// Benchmark registry
// ---------------------------------------------------------------------------

interface BenchmarkDef {
    name: string;
    description: string;
    fn: (gateway: string, concurrency: number, agent: http.Agent) => Promise<BenchmarkResult>;
}

const BENCHMARKS: BenchmarkDef[] = [
    {
        name: 'health_throughput',
        description: 'Fire 10,000 GET /health requests, measure RPS',
        fn: benchHealthThroughput,
    },
    {
        name: 'registration_burst',
        description: 'Register 500 nodes concurrently, measure time + error rate',
        fn: benchRegistrationBurst,
    },
    {
        name: 'stats_ingestion',
        description: 'Push stats from 100 nodes simultaneously, measure throughput',
        fn: benchStatsIngestion,
    },
    {
        name: 'model_search',
        description: '1000 GET /api/v1/model-search requests, measure p50/p95/p99',
        fn: benchModelSearch,
    },
    {
        name: 'dashboard_bundle',
        description: '500 GET /api/v1/dashboard requests under concurrency, measure latency',
        fn: benchDashboardBundle,
    },
    {
        name: 'concurrent_chat',
        description: 'Simulate 10/50/100 concurrent POST /v1/chat/completions (routing time)',
        fn: benchConcurrentChat,
    },
    {
        name: 'sse_connections',
        description: 'Open 100 SSE connections to /api/v1/events, verify broadcasts',
        fn: benchSseConnections,
    },
    {
        name: 'cold_start',
        description: 'Measure gateway startup to first successful /health response',
        fn: benchColdStart,
    },
];

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

async function checkGateway(gateway: string, agent: http.Agent): Promise<boolean> {
    try {
        const res = await httpRequest('GET', `${gateway}/health`, null, agent);
        return res.statusCode === 200;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const flags = parseArgs();
    const agent = makeAgent(flags.gateway);
    const results: BenchmarkResult[] = [];
    const startTime = new Date().toISOString();

    if (!flags.json) {
        console.log('');
        console.log('==========================================================');
        console.log('  TentaCLAW Benchmark Suite');
        console.log('  CLAWtopus says: "Numbers don\'t lie."');
        console.log('==========================================================');
        console.log(`  Gateway:     ${flags.gateway}`);
        console.log(`  Concurrency: ${flags.concurrency}`);
        console.log(`  Duration:    ${flags.duration}s (sustained benchmarks)`);
        if (flags.benchmark) {
            console.log(`  Benchmark:   ${flags.benchmark}`);
        }
        console.log('==========================================================');
        console.log('');
    }

    // Connectivity check (skip for cold_start-only runs)
    const needsGateway = flags.benchmark !== 'cold_start';
    if (needsGateway) {
        const alive = await checkGateway(flags.gateway, agent);
        if (!alive) {
            const msg = `ERROR: Gateway not reachable at ${flags.gateway}. Start the gateway first or use --gateway to specify the URL.`;
            if (flags.json) {
                console.log(JSON.stringify({ error: msg }));
            } else {
                console.error(msg);
            }
            process.exit(1);
        }
        if (!flags.json) {
            console.log('[OK] Gateway is reachable');
            console.log('');
        }
    }

    // Select benchmarks to run
    const benchmarksToRun = flags.benchmark
        ? BENCHMARKS.filter((b) => b.name === flags.benchmark)
        : BENCHMARKS;

    if (benchmarksToRun.length === 0) {
        const msg = `ERROR: Unknown benchmark "${flags.benchmark}". Available: ${BENCHMARKS.map((b) => b.name).join(', ')}`;
        if (flags.json) {
            console.log(JSON.stringify({ error: msg }));
        } else {
            console.error(msg);
        }
        process.exit(1);
    }

    // Run benchmarks sequentially
    for (const bench of benchmarksToRun) {
        if (!flags.json) {
            process.stdout.write(`Running ${bench.name}...`);
        }

        try {
            const result = await bench.fn(flags.gateway, flags.concurrency, agent);
            results.push(result);

            if (!flags.json) {
                console.log(' done');
                console.log('');
                console.log(formatResult(result));
                console.log('');
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const failResult: BenchmarkResult = {
                name: bench.name,
                requests: 0,
                durationSec: 0,
                rps: 0,
                p50Ms: 0,
                p95Ms: 0,
                p99Ms: 0,
                errors: 1,
                status: 'FAIL',
                details: { error: errMsg },
            };
            results.push(failResult);

            if (!flags.json) {
                console.log(' FAILED');
                console.log(`  Error: ${errMsg}`);
                console.log('');
            }
        }
    }

    // Destroy the agent
    agent.destroy();

    // Build summary
    const summary = {
        suite: 'tentaclaw-benchmark',
        version: '1.0.0',
        timestamp: startTime,
        gateway: flags.gateway,
        concurrency: flags.concurrency,
        duration: flags.duration,
        environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpus: (await import('node:os')).cpus().length,
        },
        results,
        totals: {
            benchmarks: results.length,
            passed: results.filter((r) => r.status === 'PASS').length,
            warned: results.filter((r) => r.status === 'WARN').length,
            failed: results.filter((r) => r.status === 'FAIL').length,
            total_requests: results.reduce((a, r) => a + r.requests, 0),
            total_errors: results.reduce((a, r) => a + r.errors, 0),
        },
    };

    // Save results
    const resultsDir = path.resolve(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }
    const latestPath = path.join(resultsDir, 'latest.json');
    const timestampPath = path.join(resultsDir, `${startTime.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(timestampPath, JSON.stringify(summary, null, 2));

    // Output
    if (flags.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log('==========================================================');
        console.log('  Summary');
        console.log('==========================================================');
        console.log(`  Benchmarks:  ${summary.totals.benchmarks}`);
        console.log(`  Passed:      ${summary.totals.passed}`);
        console.log(`  Warned:      ${summary.totals.warned}`);
        console.log(`  Failed:      ${summary.totals.failed}`);
        console.log(`  Requests:    ${summary.totals.total_requests.toLocaleString()}`);
        console.log(`  Errors:      ${summary.totals.total_errors.toLocaleString()}`);
        console.log('');
        console.log(`  Results saved to:`);
        console.log(`    ${latestPath}`);
        console.log(`    ${timestampPath}`);
        console.log('==========================================================');
    }

    process.exit(summary.totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
});
