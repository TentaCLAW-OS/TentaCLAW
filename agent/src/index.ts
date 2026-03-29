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
import * as dgram from 'dgram';
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

// =============================================================================
// GPU Auto-Detection — NVIDIA (nvidia-smi) / AMD (sysfs+amdgpu) / Intel
// =============================================================================

type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'unknown';

function detectGpuVendor(): GpuVendor {
    try {
        const lspci = execSync('lspci 2>/dev/null | grep -i "vga\\|3d\\|display"', { encoding: 'utf-8' });
        if (lspci.toLowerCase().includes('nvidia')) return 'nvidia';
        if (lspci.toLowerCase().includes('amd') || lspci.toLowerCase().includes('radeon')) return 'amd';
        if (lspci.toLowerCase().includes('intel')) return 'intel';
    } catch {}
    // Fallback: check for driver presence
    try {
        if (fs.existsSync('/dev/nvidiactl')) return 'nvidia';
        if (fs.existsSync('/dev/kfd')) return 'amd';
    } catch {}
    return 'unknown';
}

function getGpuStats(): GpuStats[] {
    const vendor = detectGpuVendor();
    console.log('[agent] GPU vendor: ' + vendor);
    switch (vendor) {
        case 'nvidia': return getNvidiaStats();
        case 'amd': return getAmdGpuStats();
        case 'intel': return getIntelGpuStats();
        default: return [];
    }
}

function getNvidiaStats(): GpuStats[] {
    try {
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

function getAmdGpuStats(): GpuStats[] {
    // Uses amdgpu kernel driver sysfs interface — no ROCm needed
    const gpus: GpuStats[] = [];
    try {
        const cards = fs.readdirSync('/sys/class/drm').filter(d => /^card\d+$/.test(d));
        for (const card of cards) {
            const base = `/sys/class/drm/${card}/device`;
            if (!fs.existsSync(base + '/gpu_busy_percent')) continue; // Not an amdgpu device

            const readSysfs = (file: string): string => {
                try { return fs.readFileSync(`${base}/${file}`, 'utf-8').trim(); } catch { return ''; }
            };

            // GPU name from lspci for this device
            let name = 'AMD GPU';
            try {
                const uevent = readSysfs('uevent');
                const pciSlot = uevent.match(/PCI_SLOT_NAME=(.*)/)?.[1] || '';
                if (pciSlot) {
                    const lspciOut = execSync(`lspci -s ${pciSlot} 2>/dev/null`, { encoding: 'utf-8' });
                    const match = lspciOut.match(/:\s+(.*)/);
                    if (match) name = match[1].replace(/\(rev.*\)/, '').trim();
                }
            } catch {}

            // VRAM from hwmon or mem_info
            let vramTotal = 0, vramUsed = 0;
            try {
                vramTotal = Math.round(parseInt(readSysfs('mem_info_vram_total')) / 1048576);
                vramUsed = Math.round(parseInt(readSysfs('mem_info_vram_used')) / 1048576);
            } catch {}

            // Temperature from hwmon
            let temp = 0;
            try {
                const hwmonDir = fs.readdirSync(`${base}/hwmon`)[0];
                if (hwmonDir) {
                    const tempStr = fs.readFileSync(`${base}/hwmon/${hwmonDir}/temp1_input`, 'utf-8').trim();
                    temp = Math.round(parseInt(tempStr) / 1000);
                }
            } catch {}

            // Utilization
            const util = parseInt(readSysfs('gpu_busy_percent')) || 0;

            // Power
            let power = 0;
            try {
                const hwmonDir = fs.readdirSync(`${base}/hwmon`)[0];
                if (hwmonDir) {
                    const powerStr = fs.readFileSync(`${base}/hwmon/${hwmonDir}/power1_average`, 'utf-8').trim();
                    power = Math.round(parseInt(powerStr) / 1000000); // microwatts to watts
                }
            } catch {}

            // Fan
            let fan = 0;
            try {
                const hwmonDir = fs.readdirSync(`${base}/hwmon`)[0];
                if (hwmonDir) {
                    const pwm = parseInt(fs.readFileSync(`${base}/hwmon/${hwmonDir}/pwm1`, 'utf-8').trim());
                    fan = Math.round((pwm / 255) * 100);
                }
            } catch {}

            // Clocks
            let clockGfx = 0, clockMem = 0;
            try {
                const gfxClk = readSysfs('pp_dpm_sclk');
                const activeLine = gfxClk.split('\n').find(l => l.includes('*'));
                if (activeLine) clockGfx = parseInt(activeLine.match(/(\d+)Mhz/)?.[1] || '0');
            } catch {}
            try {
                const memClk = readSysfs('pp_dpm_mclk');
                const activeLine = memClk.split('\n').find(l => l.includes('*'));
                if (activeLine) clockMem = parseInt(activeLine.match(/(\d+)Mhz/)?.[1] || '0');
            } catch {}

            const pciSlot = readSysfs('uevent').match(/PCI_SLOT_NAME=(.*)/)?.[1] || card;

            gpus.push({
                busId: pciSlot,
                name,
                vramTotalMb: vramTotal,
                vramUsedMb: vramUsed,
                temperatureC: temp,
                utilizationPct: util,
                powerDrawW: power,
                fanSpeedPct: fan,
                clockSmMhz: clockGfx,
                clockMemMhz: clockMem,
            });
        }
    } catch (err) {
        console.error('[agent] AMD GPU detection error: ' + err);
    }
    return gpus;
}

function getIntelGpuStats(): GpuStats[] {
    // Basic Intel iGPU detection via sysfs
    try {
        const cards = fs.readdirSync('/sys/class/drm').filter(d => /^card\d+$/.test(d));
        for (const card of cards) {
            const base = `/sys/class/drm/${card}/device`;
            try {
                const vendor = fs.readFileSync(`${base}/vendor`, 'utf-8').trim();
                if (vendor === '0x8086') {
                    return [{
                        busId: card,
                        name: 'Intel Integrated GPU',
                        vramTotalMb: 0, vramUsedMb: 0,
                        temperatureC: 0, utilizationPct: 0,
                        powerDrawW: 0, fanSpeedPct: 0,
                        clockSmMhz: 0, clockMemMhz: 0,
                    }];
                }
            } catch {}
        }
    } catch {}
    return [];
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
    const gpus = config.mockMode ? getMockGpuStats() : getGpuStats();
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
// System Info (collected once on startup for registration)
// =============================================================================

function getSystemInfo(mockMode: boolean): Record<string, string> {
    if (mockMode) {
        return {
            cpu_model: 'AMD Ryzen 9 7950X 16-Core Processor',
            cpu_cores: String(os.cpus().length),
            total_ram_mb: String(Math.round(os.totalmem() / 1024 / 1024)),
            os_platform: os.platform(),
            os_release: os.release(),
            arch: os.arch(),
            node_version: process.version,
            agent_version: '0.1.0',
        };
    }

    const info: Record<string, string> = {
        cpu_cores: String(os.cpus().length),
        total_ram_mb: String(Math.round(os.totalmem() / 1024 / 1024)),
        os_platform: os.platform(),
        os_release: os.release(),
        arch: os.arch(),
        node_version: process.version,
        agent_version: '0.1.0',
    };

    try {
        info.cpu_model = os.cpus()[0]?.model || 'unknown';
    } catch { info.cpu_model = 'unknown'; }

    try {
        info.kernel = execFileSync('uname', ['-r'], { encoding: 'utf-8' }).trim();
    } catch { /* not linux */ }

    return info;
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

    if (command.action === 'overclock') {
        await applyOverclockProfile(command, mockMode);
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
// GPU Overclock Profiles
// =============================================================================

const OC_PROFILES: Record<string, { power_limit_pct: number; core_offset_mhz: number; mem_offset_mhz: number; fan_speed_pct: number }> = {
    stock:     { power_limit_pct: 100, core_offset_mhz: 0,    mem_offset_mhz: 0,    fan_speed_pct: 0 },
    gaming:    { power_limit_pct: 110, core_offset_mhz: 100,  mem_offset_mhz: 500,  fan_speed_pct: 70 },
    mining:    { power_limit_pct: 70,  core_offset_mhz: -200, mem_offset_mhz: 1000, fan_speed_pct: 80 },
    inference: { power_limit_pct: 90,  core_offset_mhz: 50,   mem_offset_mhz: 200,  fan_speed_pct: 60 },
};

async function applyOverclockProfile(command: GatewayCommand, mockMode: boolean): Promise<void> {
    const profile = command.profile || 'stock';
    const gpuIdx = command.gpu !== undefined ? command.gpu : -1; // -1 = all GPUs
    const settings = OC_PROFILES[profile] || OC_PROFILES['stock'];

    console.log('[agent] Applying overclock profile: ' + profile + (gpuIdx >= 0 ? ' (GPU ' + gpuIdx + ')' : ' (all GPUs)'));

    if (mockMode) {
        console.log('[agent] [mock] OC profile: power=' + settings.power_limit_pct + '%, core=' +
            (settings.core_offset_mhz >= 0 ? '+' : '') + settings.core_offset_mhz + 'MHz, mem=' +
            (settings.mem_offset_mhz >= 0 ? '+' : '') + settings.mem_offset_mhz + 'MHz, fan=' +
            (settings.fan_speed_pct > 0 ? settings.fan_speed_pct + '%' : 'auto'));
        return;
    }

    try {
        const gpuTarget = gpuIdx >= 0 ? String(gpuIdx) : '0'; // TODO: iterate all GPUs

        // Set power limit (nvidia-smi takes absolute watts, we need to calculate)
        // First get the default power limit
        const defaultPower = execFileSync('nvidia-smi', [
            '--query-gpu=power.default_limit', '--format=csv,noheader,nounits', '-i', gpuTarget
        ], { encoding: 'utf-8' }).trim();
        const targetPower = Math.round(parseFloat(defaultPower) * settings.power_limit_pct / 100);

        execFileSync('nvidia-smi', ['-i', gpuTarget, '-pl', String(targetPower)], { stdio: 'ignore' });
        console.log('[agent] Power limit set to ' + targetPower + 'W (' + settings.power_limit_pct + '%)');

        // Set clock offsets
        if (settings.core_offset_mhz !== 0) {
            execFileSync('nvidia-settings', [
                '-a', '[gpu:' + gpuTarget + ']/GPUGraphicsClockOffsetAllPerformanceLevels=' + settings.core_offset_mhz
            ], { stdio: 'ignore' });
            console.log('[agent] Core offset: ' + (settings.core_offset_mhz >= 0 ? '+' : '') + settings.core_offset_mhz + 'MHz');
        }

        if (settings.mem_offset_mhz !== 0) {
            execFileSync('nvidia-settings', [
                '-a', '[gpu:' + gpuTarget + ']/GPUMemoryTransferRateOffsetAllPerformanceLevels=' + settings.mem_offset_mhz
            ], { stdio: 'ignore' });
            console.log('[agent] Memory offset: +' + settings.mem_offset_mhz + 'MHz');
        }

        // Set fan speed
        if (settings.fan_speed_pct > 0) {
            execFileSync('nvidia-settings', [
                '-a', '[gpu:' + gpuTarget + ']/GPUFanControlState=1',
                '-a', '[fan:' + gpuTarget + ']/GPUTargetFanSpeed=' + settings.fan_speed_pct
            ], { stdio: 'ignore' });
            console.log('[agent] Fan speed: ' + settings.fan_speed_pct + '%');
        } else {
            execFileSync('nvidia-settings', [
                '-a', '[gpu:' + gpuTarget + ']/GPUFanControlState=0'
            ], { stdio: 'ignore' });
            console.log('[agent] Fan speed: auto');
        }

        console.log('[agent] Overclock profile "' + profile + '" applied successfully');
    } catch (e) {
        console.error('[agent] Overclock failed: ' + e);
        console.error('[agent] Note: overclocking requires nvidia-settings and root access');
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

    // Start self-heal loop (doctor mode)
    startSelfHealLoop(config);

    // Start auto-discovery
    startDiscoveryBroadcast(config);
    if (!config.gatewayUrl) {
        console.log('[agent] No gateway configured — listening for discovery...');
        startDiscoveryListener((url) => {
            (config as any).gatewayUrl = url;
            console.log('[agent] Gateway auto-discovered: ' + url);
        });
    }

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

// =============================================================================
// Doctor Mode — Agent Self-Heal Loop
// =============================================================================

interface SelfHealResult {
    check: string;
    status: 'ok' | 'warning' | 'fixed' | 'failed';
    message: string;
}

async function runSelfHeal(config: ReturnType<typeof loadConfig>): Promise<SelfHealResult[]> {
    const results: SelfHealResult[] = [];

    // 1. Check gateway connectivity
    if (config.gatewayUrl) {
        try {
            const resp = await httpGet(config.gatewayUrl + '/health');
            if (resp.includes('"ok"')) {
                results.push({ check: 'gateway_connectivity', status: 'ok', message: 'Gateway reachable' });
            } else {
                results.push({ check: 'gateway_connectivity', status: 'warning', message: 'Gateway returned unexpected response' });
            }
        } catch {
            results.push({ check: 'gateway_connectivity', status: 'warning', message: 'Cannot reach gateway — will retry on next push' });
        }
    }

    // 2. Check disk space (Linux only)
    if (process.platform === 'linux') {
        try {
            const dfOut = execSync('df -h / | tail -1', { encoding: 'utf-8', timeout: 5000 });
            const parts = dfOut.trim().split(/\s+/);
            const usePct = parseInt(parts[4]);
            if (usePct > 95) {
                // Auto-fix: clear old logs and temp files
                try {
                    execSync('find /tmp -type f -mtime +1 -delete 2>/dev/null; journalctl --vacuum-time=1d 2>/dev/null', { timeout: 10000 });
                    results.push({ check: 'disk_space', status: 'fixed', message: `Disk ${usePct}% full — cleared temp files and old logs` });
                } catch {
                    results.push({ check: 'disk_space', status: 'failed', message: `Disk ${usePct}% full — cleanup failed` });
                }
            } else if (usePct > 90) {
                results.push({ check: 'disk_space', status: 'warning', message: `Disk ${usePct}% full` });
            } else {
                results.push({ check: 'disk_space', status: 'ok', message: `Disk ${usePct}% used` });
            }
        } catch {
            results.push({ check: 'disk_space', status: 'ok', message: 'Disk check skipped (non-Linux)' });
        }
    }

    // 3. Check Ollama process (Linux only, skip in mock mode)
    if (process.platform === 'linux' && !config.mockMode) {
        try {
            execSync('pgrep -x ollama', { timeout: 5000 });
            results.push({ check: 'ollama_process', status: 'ok', message: 'Ollama is running' });
        } catch {
            // Auto-fix: restart Ollama
            try {
                execSync('systemctl restart ollama 2>/dev/null || ollama serve &', { timeout: 10000 });
                results.push({ check: 'ollama_process', status: 'fixed', message: 'Ollama was down — restarted' });
            } catch {
                results.push({ check: 'ollama_process', status: 'failed', message: 'Ollama is down and restart failed' });
            }
        }
    }

    // 4. Check GPU driver (Linux only, skip in mock mode)
    if (process.platform === 'linux' && !config.mockMode) {
        const vendor = detectGpuVendor();
        if (vendor === 'nvidia') {
            try {
                execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 5000 });
                results.push({ check: 'gpu_driver', status: 'ok', message: 'NVIDIA driver responding' });
            } catch {
                results.push({ check: 'gpu_driver', status: 'failed', message: 'nvidia-smi failed — GPU driver may be crashed' });
            }
        } else if (vendor === 'amd') {
            try {
                const kfd = fs.existsSync('/dev/kfd');
                const drm = fs.readdirSync('/sys/class/drm').some(d => /^card\d+$/.test(d));
                if (kfd && drm) {
                    results.push({ check: 'gpu_driver', status: 'ok', message: 'AMD amdgpu driver active (/dev/kfd present)' });
                } else {
                    results.push({ check: 'gpu_driver', status: 'failed', message: 'AMD GPU detected but /dev/kfd missing' });
                }
            } catch {
                results.push({ check: 'gpu_driver', status: 'failed', message: 'AMD GPU driver check failed' });
            }
        } else {
            results.push({ check: 'gpu_driver', status: 'ok', message: `GPU vendor: ${vendor}` });
        }
    }

    // 5. Check memory pressure
    const memUsage = process.memoryUsage();
    const heapPct = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    if (heapPct > 90) {
        // Force GC if available
        if (global.gc) {
            global.gc();
            results.push({ check: 'memory_pressure', status: 'fixed', message: `Heap ${heapPct}% — forced GC` });
        } else {
            results.push({ check: 'memory_pressure', status: 'warning', message: `Heap ${heapPct}% — high memory pressure` });
        }
    } else {
        results.push({ check: 'memory_pressure', status: 'ok', message: `Heap ${heapPct}% used (${Math.round(memUsage.heapUsed / 1048576)}MB)` });
    }

    return results;
}

function httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https') ? https : http;
        const req = transport.get(url, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// Run self-heal every 60 seconds
function startSelfHealLoop(config: ReturnType<typeof loadConfig>): void {
    const HEAL_INTERVAL = 60_000;
    let healCount = 0;

    setInterval(async () => {
        try {
            const results = await runSelfHeal(config);
            healCount++;
            const fixed = results.filter(r => r.status === 'fixed').length;
            const failed = results.filter(r => r.status === 'failed').length;

            if (fixed > 0 || failed > 0) {
                console.log(`[doctor] Self-heal #${healCount}: ${fixed} fixed, ${failed} failed`);
                for (const r of results.filter(r => r.status !== 'ok')) {
                    console.log(`[doctor]   ${r.status === 'fixed' ? '\u2714' : '\u2718'} ${r.check}: ${r.message}`);
                }
            }

            // Report to gateway
            if (config.gatewayUrl) {
                try {
                    const body = JSON.stringify({
                        node_id: config.nodeId,
                        heal_count: healCount,
                        results,
                    });
                    const parsed = new URL(config.gatewayUrl + '/api/v1/nodes/' + encodeURIComponent(config.nodeId) + '/doctor');
                    const transport = parsed.protocol === 'https:' ? https : http;
                    const req = transport.request({
                        hostname: parsed.hostname,
                        port: parsed.port,
                        path: parsed.pathname,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 5000,
                    });
                    req.write(body);
                    req.end();
                    req.on('error', () => {});
                } catch {}
            }
        } catch (err) {
            console.error('[doctor] Self-heal error: ' + err);
        }
    }, HEAL_INTERVAL);

    console.log('[doctor] Self-heal loop active (every 60s)');
}

// =============================================================================
// Auto-Discovery — UDP Broadcast
// =============================================================================

const DISCOVERY_PORT = 41337;
const DISCOVERY_MAGIC = 'TENTACLAW-DISCOVER';

function startDiscoveryBroadcast(config: ReturnType<typeof loadConfig>): void {
    try {
        const sock = dgram.createSocket('udp4');
        sock.on('error', () => {}); // Silently ignore broadcast errors

        sock.bind(0, () => {
            sock.setBroadcast(true);

            const announce = () => {
                const payload = JSON.stringify({
                    magic: DISCOVERY_MAGIC,
                    node_id: config.nodeId,
                    farm_hash: config.farmHash,
                    hostname: config.hostname,
                    gpu_count: MOCK_MODE ? MOCK_GPU_COUNT : 0,
                    ip: getLocalIp(),
                    port: 0,  // Agent doesn't listen, it pushes to gateway
                    version: '0.2.0',
                });
                const buf = Buffer.from(payload);
                sock.send(buf, 0, buf.length, DISCOVERY_PORT, '255.255.255.255', () => {});
            };

            announce();
            setInterval(announce, 30000); // Broadcast every 30s
            console.log('[agent] Auto-discovery broadcast active on port ' + DISCOVERY_PORT);
        });
    } catch {
        console.log('[agent] Auto-discovery broadcast unavailable (non-fatal)');
    }
}

function startDiscoveryListener(onGatewayFound: (url: string) => void): void {
    try {
        const sock = dgram.createSocket('udp4');
        sock.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.magic === 'TENTACLAW-GATEWAY' && data.url) {
                    console.log('[agent] Discovered gateway at ' + data.url + ' from ' + rinfo.address);
                    onGatewayFound(data.url);
                }
            } catch {}
        });
        sock.bind(DISCOVERY_PORT + 1, () => {
            console.log('[agent] Listening for gateway discovery on port ' + (DISCOVERY_PORT + 1));
        });
        sock.on('error', () => {});
    } catch {}
}

function getLocalIp(): string {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

process.on('SIGINT', () => { console.log('\n[agent] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[agent] Shutting down...'); process.exit(0); });
main().catch(error => { console.error('[agent] Fatal: ' + error); process.exit(1); });
