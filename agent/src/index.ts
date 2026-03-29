#!/usr/bin/env node
/**
 * TentaCLAW Agent — Node Daemon
 *
 * The daemon that runs on each TentaCLAW OS node.
 * Pushes stats to HiveMind gateway, receives commands.
 *
 * Usage:
 *   tentaclaw-agent                     # Production (reads /etc/tentaclaw/rig.conf)
 *   tentaclaw-agent --mock              # Mock mode (fake GPUs, works on any OS)
 *   tentaclaw-agent --mock --gpus 4     # Mock with 4 fake GPUs
 *   tentaclaw-agent --gateway http://localhost:8080  # Override gateway URL
 *
 * CLAWtopus says: "I'm the arm that never sleeps."
 */

import * as fs from 'fs';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';
import * as https from 'https';
import * as http from 'http';

// =============================================================================
// CLI Args
// =============================================================================

const args = process.argv.slice(2);
const MOCK_MODE = args.includes('--mock');
const MOCK_GPU_COUNT = (() => {
    const idx = args.indexOf('--gpus');
    return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 2;
})();
const GATEWAY_OVERRIDE = (() => {
    const idx = args.indexOf('--gateway');
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : '';
})();
const INTERVAL_OVERRIDE = (() => {
    const idx = args.indexOf('--interval');
    return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 0;
})();
const NODE_NAME_OVERRIDE = (() => {
    const idx = args.indexOf('--name');
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : '';
})();

// =============================================================================
// Configuration
// =============================================================================

interface AgentConfig {
    nodeId: string;
    farmHash: string;
    hostname: string;
    gatewayUrl: string;
    agentInterval: number;
    statsUrl: string;
    mockMode: boolean;
}

function parseRigConf(content: string): Record<string, string> {
    const config: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                config[key.trim()] = valueParts.join('=').trim();
            }
        }
    }
    return config;
}

function loadConfig(): AgentConfig {
    if (MOCK_MODE) {
        const hostname = NODE_NAME_OVERRIDE || ('mock-' + os.hostname());
        const farmHash = 'FARMM0CK';
        const nodeId = 'TENTACLAW-' + farmHash + '-' + hostname;
        const gatewayUrl = GATEWAY_OVERRIDE || process.env['GATEWAY_URL'] || 'http://localhost:8080';
        const agentInterval = INTERVAL_OVERRIDE || 5;

        return {
            nodeId, farmHash, hostname, gatewayUrl, agentInterval,
            statsUrl: gatewayUrl + '/api/v1/nodes/' + nodeId + '/stats',
            mockMode: true,
        };
    }

    const configPath = '/etc/tentaclaw/rig.conf';

    if (!fs.existsSync(configPath)) {
        const nodeId = process.env['NODE_ID'];
        const gatewayUrl = GATEWAY_OVERRIDE || process.env['GATEWAY_URL'];

        if (nodeId && gatewayUrl) {
            const farmHash = process.env['FARM_HASH'] || 'FARM0000';
            const hostname = NODE_NAME_OVERRIDE || os.hostname();
            return {
                nodeId, farmHash, hostname, gatewayUrl,
                agentInterval: INTERVAL_OVERRIDE || parseInt(process.env['AGENT_INTERVAL'] || '10'),
                statsUrl: gatewayUrl + '/api/v1/nodes/' + nodeId + '/stats',
                mockMode: false,
            };
        }

        console.error('[agent] No config found at /etc/tentaclaw/rig.conf');
        console.error('[agent] Use --mock for development, or set NODE_ID + GATEWAY_URL env vars');
        process.exit(1);
    }

    const config = parseRigConf(fs.readFileSync(configPath, 'utf-8'));
    const nodeId = config['NODE_ID'] || process.env['NODE_ID'] || 'unknown';
    const farmHash = config['FARM_HASH'] || process.env['FARM_HASH'] || 'unknown';
    const hostname = NODE_NAME_OVERRIDE || config['NODE_HOSTNAME'] || os.hostname();
    const gatewayUrl = GATEWAY_OVERRIDE || config['GATEWAY_URL'] || process.env['GATEWAY_URL'] || '';
    const agentInterval = INTERVAL_OVERRIDE || parseInt(config['AGENT_INTERVAL'] || '10');
    const statsUrl = config['AGENT_STATS_URL'] || (gatewayUrl + '/api/v1/nodes/' + nodeId + '/stats');

    return { nodeId, farmHash, hostname, gatewayUrl, agentInterval, statsUrl, mockMode: false };
}

// =============================================================================
// GPU Stats
// =============================================================================

interface GpuStats {
    busId: string;
    name: string;
    vramTotalMb: number;
    vramUsedMb: number;
    temperatureC: number;
    utilizationPct: number;
    powerDrawW: number;
    fanSpeedPct: number;
    clockSmMhz: number;
    clockMemMhz: number;
}

interface StatsPayload {
    farm_hash: string;
    node_id: string;
    hostname: string;
    uptime_secs: number;
    gpu_count: number;
    gpus: GpuStats[];
    cpu: { usage_pct: number; temp_c: number };
    ram: { total_mb: number; used_mb: number };
    disk: { total_gb: number; used_gb: number };
    network: { bytes_in: number; bytes_out: number };
    inference: {
        loaded_models: string[];
        in_flight_requests: number;
        tokens_generated: number;
        avg_latency_ms: number;
    };
    toks_per_sec: number;
    requests_completed: number;
}

const MOCK_GPU_PRESETS = [
    { name: 'NVIDIA GeForce RTX 3090', vramTotalMb: 24576, powerMax: 350, clockBase: 1800, memClock: 9750 },
    { name: 'NVIDIA GeForce RTX 4070 Ti Super', vramTotalMb: 16384, powerMax: 285, clockBase: 2310, memClock: 10500 },
    { name: 'NVIDIA GeForce RTX 4090', vramTotalMb: 24576, powerMax: 450, clockBase: 2520, memClock: 11250 },
    { name: 'NVIDIA A100-SXM4-80GB', vramTotalMb: 81920, powerMax: 400, clockBase: 1410, memClock: 1593 },
    { name: 'NVIDIA GeForce RTX 3080', vramTotalMb: 10240, powerMax: 320, clockBase: 1710, memClock: 9500 },
    { name: 'NVIDIA GeForce RTX 3060', vramTotalMb: 12288, powerMax: 170, clockBase: 1777, memClock: 7500 },
];

const MOCK_MODELS = ['llama3.1:8b', 'hermes3:8b', 'codellama:7b', 'dolphin-mistral:7b', 'phi3:mini'];

function getMockGpuStats(): GpuStats[] {
    const gpus: GpuStats[] = [];
    for (let i = 0; i < MOCK_GPU_COUNT; i++) {
        const preset = MOCK_GPU_PRESETS[i % MOCK_GPU_PRESETS.length];
        const utilization = 30 + Math.random() * 60;
        gpus.push({
            busId: '0000:0' + (i + 1) + ':00.0',
            name: preset.name,
            vramTotalMb: preset.vramTotalMb,
            vramUsedMb: Math.round(preset.vramTotalMb * (0.3 + Math.random() * 0.5)),
            temperatureC: Math.round(45 + Math.random() * 30),
            utilizationPct: Math.round(utilization),
            powerDrawW: Math.round(preset.powerMax * (utilization / 100) * (0.8 + Math.random() * 0.2)),
            fanSpeedPct: Math.round(30 + Math.random() * 50),
            clockSmMhz: Math.round(preset.clockBase * (0.95 + Math.random() * 0.1)),
            clockMemMhz: preset.memClock,
        });
    }
    return gpus;
}

function getNvidiaStats(): GpuStats[] {
    try {
        // Static command — no user input, safe to use execFileSync
        const output = execFileSync('nvidia-smi', [
            '--query-gpu=index,pci.bus_id,name,memory.used,memory.total,temperature.gpu,utilization.gpu,power.draw,fan.speed,clocks.sm,clocks.mem',
            '--format=csv,noheader,nounits'
        ], { encoding: 'utf-8' });

        return output.trim().split('\n').filter(line => line).map(line => {
            const [_idx, busId, name, vramUsed, vramTotal, temp, util, power, fan, clockSm, clockMem] = line.split(',').map(s => s.trim());
            return {
                busId: busId || 'unknown',
                name: name || 'Unknown GPU',
                vramTotalMb: parseInt(vramTotal) || 0,
                vramUsedMb: parseInt(vramUsed) || 0,
                temperatureC: parseInt(temp) || 0,
                utilizationPct: parseInt(util) || 0,
                powerDrawW: parseFloat(power) || 0,
                fanSpeedPct: parseInt(fan) || 0,
                clockSmMhz: parseInt(clockSm) || 0,
                clockMemMhz: parseInt(clockMem) || 0,
            };
        });
    } catch {
        return [];
    }
}

function getMockSystemStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
        cpu: { usage_pct: Math.round(20 + Math.random() * 40), temp_c: Math.round(40 + Math.random() * 20) },
        ram: { total_mb: Math.round(totalMem / 1024 / 1024), used_mb: Math.round((totalMem - freeMem) / 1024 / 1024) },
        disk: { total_gb: Math.round(500 + Math.random() * 500), used_gb: Math.round(100 + Math.random() * 300) },
        network: { bytes_in: Math.round(Math.random() * 10000000000), bytes_out: Math.round(Math.random() * 5000000000) },
    };
}

function getLinuxSystemStats() {
    try {
        // These are static shell pipelines with no user input
        const cpuIdle = parseFloat(execSync("grep 'cpu ' /proc/stat | awk '{print ($5/($2+$3+$4+$5+$6+$7+$8))*100}'", { encoding: 'utf-8' }));
        const memInfo = fs.readFileSync('/proc/meminfo', 'utf-8');
        const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0');
        const memAvailable = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0');
        const diskOutput = execSync("df -k / | tail -1 | awk '{print $2,$3}'", { encoding: 'utf-8' });
        const [diskTotal, diskUsed] = diskOutput.trim().split(' ').map(s => Math.round(parseInt(s) / 1024 / 1024));
        const networkOutput = execSync("cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes 2>/dev/null || echo '0\n0'", { encoding: 'utf-8' });
        const [bytesIn, bytesOut] = networkOutput.trim().split('\n').map(s => parseInt(s) || 0);

        return {
            cpu: { usage_pct: Math.round(100 - cpuIdle), temp_c: 0 },
            ram: { total_mb: Math.round(memTotal / 1024), used_mb: Math.round((memTotal - memAvailable) / 1024) },
            disk: { total_gb: diskTotal, used_gb: diskUsed },
            network: { bytes_in: bytesIn, bytes_out: bytesOut },
        };
    } catch {
        return getMockSystemStats();
    }
}

function getInferenceStats(mockMode: boolean) {
    if (mockMode) {
        const count = 1 + Math.floor(Math.random() * 3);
        return {
            loaded_models: MOCK_MODELS.slice(0, count),
            in_flight_requests: Math.floor(Math.random() * 5),
            tokens_generated: 0,
            avg_latency_ms: Math.round(20 + Math.random() * 60),
        };
    }
    try {
        const output = execFileSync('curl', ['-s', 'http://localhost:11434/api/tags'], { encoding: 'utf-8' });
        const data = JSON.parse(output);
        return {
            loaded_models: data.models?.map((m: { name: string }) => m.name) || [],
            in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0,
        };
    } catch {
        return { loaded_models: [], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 };
    }
}

function collectStats(config: AgentConfig): StatsPayload {
    const gpus = config.mockMode ? getMockGpuStats() : getNvidiaStats();
    const system = config.mockMode ? getMockSystemStats() : getLinuxSystemStats();
    const inference = getInferenceStats(config.mockMode);

    return {
        farm_hash: config.farmHash,
        node_id: config.nodeId,
        hostname: config.hostname,
        uptime_secs: Math.round(os.uptime()),
        gpu_count: gpus.length,
        gpus,
        cpu: system.cpu,
        ram: system.ram,
        disk: system.disk,
        network: system.network,
        inference,
        toks_per_sec: config.mockMode ? Math.round(50 + Math.random() * 200) : 0,
        requests_completed: 0,
    };
}

// =============================================================================
// Stats Pusher
// =============================================================================

interface GatewayCommand { id: string; action: string; model?: string; gpu?: number; profile?: string; priority?: string; }
interface GatewayResponse { commands: GatewayCommand[]; config_hash?: string; }

async function pushStats(config: AgentConfig, stats: StatsPayload): Promise<GatewayResponse | null> {
    if (!config.gatewayUrl) return null;

    return new Promise((resolve) => {
        const url = new URL(config.statsUrl);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'TentaCLAW-Agent/0.1.0' },
            timeout: 10000,
        };

        const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 && data) {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                } else { resolve(null); }
            });
        });

        req.on('error', (err) => { console.error('[agent] Stats push failed: ' + err.message); resolve(null); });
        req.on('timeout', () => { req.destroy(); console.error('[agent] Stats push timed out'); resolve(null); });
        req.write(JSON.stringify(stats));
        req.end();
    });
}

// =============================================================================
// Benchmark Runner
// =============================================================================

async function runBenchmark(command: GatewayCommand, mockMode: boolean): Promise<void> {
    const model = command.model || 'llama3.1:8b';
    console.log('[agent] Running benchmark: ' + model);

    let result: { tokens_per_sec: number; prompt_eval_rate: number; eval_rate: number; total_duration_ms: number };

    if (mockMode) {
        // Simulate benchmark (1-3 seconds)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        result = {
            tokens_per_sec: Math.round(80 + Math.random() * 180),
            prompt_eval_rate: Math.round(100 + Math.random() * 200),
            eval_rate: Math.round(80 + Math.random() * 180),
            total_duration_ms: Math.round(3000 + Math.random() * 7000),
        };
        console.log('[agent] [mock] Benchmark complete: ' + result.tokens_per_sec + ' tok/s');
    } else {
        try {
            const start = Date.now();
            // Run a short generation to measure throughput
            const output = execFileSync('curl', [
                '-s', 'http://localhost:11434/api/generate',
                '-d', JSON.stringify({
                    model,
                    prompt: 'Write a short paragraph about artificial intelligence.',
                    stream: false,
                }),
            ], { encoding: 'utf-8', timeout: 60000 });

            const elapsed = Date.now() - start;
            const data = JSON.parse(output);

            result = {
                tokens_per_sec: data.eval_count && data.eval_duration
                    ? Math.round((data.eval_count / data.eval_duration) * 1e9)
                    : 0,
                prompt_eval_rate: data.prompt_eval_count && data.prompt_eval_duration
                    ? Math.round((data.prompt_eval_count / data.prompt_eval_duration) * 1e9)
                    : 0,
                eval_rate: data.eval_count && data.eval_duration
                    ? Math.round((data.eval_count / data.eval_duration) * 1e9)
                    : 0,
                total_duration_ms: elapsed,
            };

            console.log('[agent] Benchmark complete: ' + result.tokens_per_sec + ' tok/s (' + elapsed + 'ms)');
        } catch (e) {
            console.error('[agent] Benchmark failed: ' + e);
            return;
        }
    }

    // Post result back to gateway
    await postBenchmarkResult(model, result);
}

async function postBenchmarkResult(model: string, result: {
    tokens_per_sec: number;
    prompt_eval_rate: number;
    eval_rate: number;
    total_duration_ms: number;
}): Promise<void> {
    const config = loadConfig();
    if (!config.gatewayUrl) return;

    const url = config.gatewayUrl + '/api/v1/nodes/' + config.nodeId + '/benchmark';

    return new Promise((resolve) => {
        const parsed = new URL(url);
        const req = (parsed.protocol === 'https:' ? https : http).request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'TentaCLAW-Agent/0.1.0' },
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('[agent] Benchmark result posted to gateway');
                }
                resolve();
            });
        });

        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.write(JSON.stringify({ model, ...result }));
        req.end();
    });
}

// =============================================================================
// Command Executor — uses execFileSync for all dynamic input
// =============================================================================

async function executeCommand(command: GatewayCommand, mockMode: boolean): Promise<void> {
    const label = command.model ? command.action + ' (' + command.model + ')' : command.action;
    console.log('[agent] Executing: ' + label);

    if (command.action === 'benchmark') {
        await runBenchmark(command, mockMode);
        return;
    }

    if (mockMode) {
        console.log('[agent] [mock] Simulated: ' + label);
        return;
    }

    switch (command.action) {
        case 'reload_model':
            if (command.model) {
                try {
                    execFileSync('curl', ['-s', 'http://localhost:11434/api/load', '-d', JSON.stringify({ model: command.model })], { stdio: 'ignore' });
                    console.log('[agent] Model reloaded: ' + command.model);
                } catch (e) { console.error('[agent] Failed to reload model: ' + e); }
            }
            break;

        case 'install_model':
            if (command.model) {
                try {
                    execFileSync('ollama', ['pull', command.model], { stdio: 'ignore' });
                    console.log('[agent] Model installed: ' + command.model);
                } catch (e) { console.error('[agent] Failed to install model: ' + e); }
            }
            break;

        case 'remove_model':
            if (command.model) {
                try {
                    execFileSync('ollama', ['rm', command.model], { stdio: 'ignore' });
                    console.log('[agent] Model removed: ' + command.model);
                } catch (e) { console.error('[agent] Failed to remove model: ' + e); }
            }
            break;

        case 'restart_agent':
            console.log('[agent] Restart requested. Exiting (systemd will restart).');
            process.exit(0);
            break;

        case 'reboot':
            console.log('[agent] Reboot requested.');
            try { execFileSync('reboot', [], { stdio: 'ignore' }); } catch { /* non-root */ }
            break;

        default:
            console.log('[agent] Unknown command: ' + command.action);
    }
}

// =============================================================================
// Main
// =============================================================================

let totalTokens = 0;
let totalRequests = 0;

async function main() {
    const config = loadConfig();

    console.log(
        '\n\x1b[38;2;0;255;255m        \u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E\x1b[0m\n' +
        '\x1b[38;2;0;255;255m   \u256D\u2500\u2500\u2500\u2524\x1b[0m  \x1b[38;2;140;0;200mTentaCLAW Agent\x1b[0m  \x1b[38;2;0;255;255m\u251C\u2500\u2500\u2500\u256E\x1b[0m\n' +
        '\x1b[38;2;0;255;255m   \u2502\x1b[0m  \x1b[38;2;0;140;140mEight arms. One mind.\x1b[0m  \x1b[38;2;0;255;255m\u2502\x1b[0m\n' +
        '\x1b[38;2;0;255;255m   \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F\x1b[0m\n'
    );

    console.log('[agent] TentaCLAW Agent v0.1.0');
    if (config.mockMode) {
        console.log('[agent] \x1b[38;2;255;220;50mMOCK MODE\x1b[0m \u2014 Generating fake stats (' + MOCK_GPU_COUNT + ' GPUs)');
    }
    console.log('[agent] Node ID:   ' + config.nodeId);
    console.log('[agent] Farm Hash: ' + config.farmHash);
    console.log('[agent] Hostname:  ' + config.hostname);
    console.log('[agent] Gateway:   ' + (config.gatewayUrl || 'none (standalone)'));
    console.log('[agent] Interval:  ' + config.agentInterval + 's');
    console.log('');

    const stats = collectStats(config);
    console.log('[agent] GPU count: ' + stats.gpu_count);
    for (const gpu of stats.gpus) {
        console.log('[agent]   ' + gpu.name + ' \u2014 ' + gpu.vramUsedMb + '/' + gpu.vramTotalMb + 'MB VRAM, ' + gpu.temperatureC + '\u00B0C, ' + gpu.utilizationPct + '% util');
    }
    console.log('[agent] CPU: ' + stats.cpu.usage_pct + '% | RAM: ' + stats.ram.used_mb + '/' + stats.ram.total_mb + 'MB');
    console.log('[agent] Models: ' + (stats.inference.loaded_models.join(', ') || 'none'));
    console.log('');

    let pushCount = 0;
    while (true) {
        try {
            const currentStats = collectStats(config);
            if (pushCount > 0 && pushCount % 6 === 0) {
                totalTokens += Math.floor(Math.random() * 1000);
                totalRequests += Math.floor(Math.random() * 10);
            }
            currentStats.inference.tokens_generated = totalTokens;
            currentStats.requests_completed = totalRequests;

            const response = await pushStats(config, currentStats);
            if (response?.commands && response.commands.length > 0) {
                console.log('[agent] Received ' + response.commands.length + ' command(s)');
                for (const cmd of response.commands) {
                    await executeCommand(cmd, config.mockMode);
                }
            }

            pushCount++;
            if (pushCount % 10 === 0) {
                console.log('[agent] Pushed ' + pushCount + 'x | tok/s: ' + currentStats.toks_per_sec + ' | tokens: ' + totalTokens + ' | reqs: ' + totalRequests);
            }
        } catch (error) {
            console.error('[agent] Error: ' + error);
        }

        await new Promise(resolve => setTimeout(resolve, config.agentInterval * 1000));
    }
}

process.on('SIGINT', () => { console.log('\n[agent] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[agent] Shutting down...'); process.exit(0); });
main().catch(error => { console.error('[agent] Fatal: ' + error); process.exit(1); });
