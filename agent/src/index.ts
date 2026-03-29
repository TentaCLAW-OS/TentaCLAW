#!/usr/bin/env node
/**
 * TentaCLAW Agent — Node Daemon
 * 
 * The daemon that runs on each TentaCLAW OS node.
 * Pushes stats to HiveMind gateway, receives commands.
 * 
 * CLAWtopus says: "I'm the arm that never sleeps."
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import * as https from 'https';
import * as http from 'http';

// =============================================================================
// Configuration
// =============================================================================

interface AgentConfig {
    nodeId: string;
    farmHash: string;
    hostname: string;
    gatewayUrl: string;
    agentInterval: number;  // seconds between stats pushes
    statsUrl: string;
}

function loadConfig(): AgentConfig {
    const configPath = '/etc/tentaclaw/rig.conf';
    
    if (!fs.existsSync(configPath)) {
        console.error('[agent] No config found at /etc/tentaclaw/rig.conf');
        console.error('[agent] Run 03-hive-registration.sh first');
        process.exit(1);
    }

    const config: Record<string, string> = {};
    const content = fs.readFileSync(configPath, 'utf-8');
    
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                config[key.trim()] = valueParts.join('=').trim();
            }
        }
    }

    const nodeId = config['NODE_ID'] || process.env['NODE_ID'] || 'unknown';
    const farmHash = config['FARM_HASH'] || process.env['FARM_HASH'] || 'unknown';
    const hostname = config['NODE_HOSTNAME'] || os.hostname();
    const gatewayUrl = config['GATEWAY_URL'] || process.env['GATEWAY_URL'] || '';
    const agentInterval = parseInt(config['AGENT_INTERVAL'] || '10');
    const statsUrl = config['AGENT_STATS_URL'] || `${gatewayUrl}/api/v1/nodes/${nodeId}/stats`;

    return {
        nodeId,
        farmHash,
        hostname,
        gatewayUrl,
        agentInterval,
        statsUrl
    };
}

// =============================================================================
// GPU Stats Collection
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
    cpu: {
        usage_pct: number;
        temp_c: number;
    };
    ram: {
        total_mb: number;
        used_mb: number;
    };
    disk: {
        total_gb: number;
        used_gb: number;
    };
    network: {
        bytes_in: number;
        bytes_out: number;
    };
    inference: {
        loaded_models: string[];
        in_flight_requests: number;
        tokens_generated: number;
        avg_latency_ms: number;
    };
    toks_per_sec: number;
    requests_completed: number;
}

function getNvidiaStats(): GpuStats[] {
    try {
        const output = execSync('nvidia-smi --query-gpu=index,pci.bus_id,name,memory.used,memory.total,temperature.gpu,utilization.gpu,power.draw,fan.speed,clocks.sm.clock,clocks.mem.clock --format=csv,noheader,nounits', { encoding: 'utf-8' });
        
        return output.trim().split('\n').filter(line => line).map(line => {
            const [idx, busId, name, vramUsed, vramTotal, temp, util, power, fan, clockSm, clockMem] = line.split(',').map(s => s.trim());
            
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
                clockMemMhz: parseInt(clockMem) || 0
            };
        });
    } catch (error) {
        // nvidia-smi not available or failed
        return [];
    }
}

function getSystemStats(): { cpu: { usage_pct: number; temp_c: number }; ram: { total_mb: number; used_mb: number }; disk: { total_gb: number; used_gb: number }; network: { bytes_in: number; bytes_out: number } } {
    try {
        // CPU usage
        const cpuIdle = parseFloat(execSync("grep 'cpu ' /proc/stat | awk '{print ($5/($2+$3+$4+$5+$6+$7+$8))*100}'", { encoding: 'utf-8' }));
        const cpuUsage = 100 - cpuIdle;

        // RAM
        const memInfo = fs.readFileSync('/proc/meminfo', 'utf-8');
        const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0');
        const memAvailable = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0');
        const memUsed = memTotal - memAvailable;

        // Disk
        const diskOutput = execSync("df -k / | tail -1 | awk '{print $2,$3}'", { encoding: 'utf-8' });
        const [diskTotal, diskUsed] = diskOutput.trim().split(' ').map(s => Math.round(parseInt(s) / 1024 / 1024));

        // Network (simplified)
        const networkOutput = execSync("cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes 2>/dev/null || echo '0 0'", { encoding: 'utf-8' });
        const [bytesIn, bytesOut] = networkOutput.trim().split('\n').map(s => parseInt(s) || 0);

        return {
            cpu: { usage_pct: Math.round(cpuUsage), temp_c: 0 },
            ram: { total_mb: Math.round(memTotal / 1024), used_mb: Math.round(memUsed / 1024) },
            disk: { total_gb: diskTotal, used_gb: diskUsed },
            network: { bytes_in: bytesIn, bytes_out: bytesOut }
        };
    } catch (error) {
        return {
            cpu: { usage_pct: 0, temp_c: 0 },
            ram: { total_mb: 0, used_mb: 0 },
            disk: { total_gb: 0, used_gb: 0 },
            network: { bytes_in: 0, bytes_out: 0 }
        };
    }
}

function getInferenceStats(): { loaded_models: string[]; in_flight_requests: number; tokens_generated: number; avg_latency_ms: number } {
    // Check if ollama is running and get loaded models
    try {
        const ollamaOutput = execSync('curl -s http://localhost:11434/api/tags 2>/dev/null || echo "{}"', { encoding: 'utf-8' });
        const ollamaData = JSON.parse(ollamaOutput);
        const models = ollamaData.models?.map((m: { name: string }) => m.name) || [];
        
        return {
            loaded_models: models,
            in_flight_requests: 0,
            tokens_generated: 0,
            avg_latency_ms: 0
        };
    } catch {
        return {
            loaded_models: [],
            in_flight_requests: 0,
            tokens_generated: 0,
            avg_latency_ms: 0
        };
    }
}

function collectStats(config: AgentConfig): StatsPayload {
    const gpus = getNvidiaStats();
    const system = getSystemStats();
    const inference = getInferenceStats();
    const uptime = os.uptime();

    return {
        farm_hash: config.farmHash,
        node_id: config.nodeId,
        hostname: config.hostname,
        uptime_secs: Math.round(uptime),
        gpu_count: gpus.length,
        gpus,
        cpu: system.cpu,
        ram: system.ram,
        disk: system.disk,
        network: system.network,
        inference,
        toks_per_sec: 0,
        requests_completed: 0
    };
}

// =============================================================================
// Stats Pusher
// =============================================================================

interface GatewayCommand {
    id: string;
    action: string;
    model?: string;
    gpu?: number;
    profile?: string;
    priority?: string;
}

interface GatewayResponse {
    commands: GatewayCommand[];
    config_hash?: string;
}

async function pushStats(config: AgentConfig, stats: StatsPayload): Promise<GatewayResponse | null> {
    if (!config.gatewayUrl) {
        return null;
    }

    return new Promise((resolve) => {
        const url = new URL(config.statsUrl);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'TentaCLAW-Agent/0.1.0'
            },
            timeout: 10000
        };

        const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 && data) {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[agent] Failed to push stats: ${error.message}`);
            resolve(null);
        });

        req.on('timeout', () => {
            req.destroy();
            console.error('[agent] Stats push timed out');
            resolve(null);
        });

        req.write(JSON.stringify(stats));
        req.end();
    });
}

// =============================================================================
// Command Executor
// =============================================================================

async function executeCommand(command: GatewayCommand): Promise<void> {
    console.log(`[agent] Executing command: ${command.action}`);

    switch (command.action) {
        case 'reload_model':
            if (command.model) {
                console.log(`[agent] Reloading model: ${command.model}`);
                try {
                    execSync(`curl -s http://localhost:11434/api/load -d '{"model":"${command.model}"}'`, { stdio: 'ignore' });
                    console.log(`[agent] Model reloaded: ${command.model}`);
                } catch (error) {
                    console.error(`[agent] Failed to reload model: ${error}`);
                }
            }
            break;

        case 'overclock':
            console.log(`[agent] Overclocking GPU ${command.gpu} with profile ${command.profile}`);
            // TODO: Implement overclocking
            break;

        case 'install_model':
            if (command.model) {
                console.log(`[agent] Installing model: ${command.model}`);
                try {
                    execSync(`ollama pull ${command.model}`, { stdio: 'ignore' });
                    console.log(`[agent] Model installed: ${command.model}`);
                } catch (error) {
                    console.error(`[agent] Failed to install model: ${error}`);
                }
            }
            break;

        default:
            console.log(`[agent] Unknown command: ${command.action}`);
    }
}

// =============================================================================
// Main Loop
// =============================================================================

let tokensGenerated = 0;
let requestsCompleted = 0;

async function main() {
    console.log(`
${'\x1b[38;2;0;255;255m'}        ╭──────────────────────────────────────╮${'\x1b[0m'}
${'\x1b[38;2;0;255;255m'}   ╭───┤${'\x1b[0m'}  ${'\x1b[38;2;140;0;200m'}TentaCLAW Agent${'\x1b[0m'}  ${'\x1b[38;2;0;255;255m'}├───╮${'\x1b[0m'}
${'\x1b[38;2;0;255;255m'}   │${'\x1b[0m'}  ${'\x1b[38;2;0;140;140m'}Eight arms. One mind.${'\x1b[0m'}  ${'\x1b[38;2;0;255;255m'}│${'\x1b[0m'}
${'\x1b[38;2;0;255;255m'}   ╰──────────────────────────────────────╯${'\x1b[0m'}
    `);

    const config = loadConfig();
    
    console.log(`[agent] TentaCLAW Agent starting...`);
    console.log(`[agent] Node ID: ${config.nodeId}`);
    console.log(`[agent] Farm Hash: ${config.farmHash}`);
    console.log(`[agent] Gateway: ${config.gatewayUrl || 'none (standalone)'}`);
    console.log(`[agent] Stats interval: ${config.agentInterval}s`);
    console.log('');

    // Initial stats push
    const stats = collectStats(config);
    console.log(`[agent] GPU count: ${stats.gpu_count}`);
    console.log(`[agent] CPU: ${stats.cpu.usage_pct}%`);
    console.log(`[agent] RAM: ${stats.ram.used_mb}/${stats.ram.total_mb}MB`);
    
    if (stats.gpus.length > 0) {
        for (const gpu of stats.gpus) {
            console.log(`[agent] GPU: ${gpu.name} (${gpu.vramUsedMb}/${gpu.vramTotalMb}MB VRAM, ${gpu.temperatureC}°C)`);
        }
    }

    console.log('');

    // Main loop
    let pushCount = 0;
    while (true) {
        try {
            const currentStats = collectStats(config);
            
            // Simulate inference stats for demo
            if (pushCount > 0 && pushCount % 6 === 0) {
                tokensGenerated += Math.floor(Math.random() * 1000);
                requestsCompleted += Math.floor(Math.random() * 10);
            }
            currentStats.inference.tokens_generated = tokensGenerated;
            currentStats.inference.in_flight_requests = Math.floor(Math.random() * 3);

            const response = await pushStats(config, currentStats);
            
            if (response?.commands && response.commands.length > 0) {
                console.log(`[agent] Received ${response.commands.length} command(s)`);
                for (const cmd of response.commands) {
                    await executeCommand(cmd);
                }
            }

            pushCount++;

            // Log every 10 pushes
            if (pushCount % 10 === 0) {
                console.log(`[agent] Stats pushed ${pushCount} times. Tokens: ${tokensGenerated}, Requests: ${requestsCompleted}`);
            }

        } catch (error) {
            console.error(`[agent] Error in main loop: ${error}`);
        }

        await new Promise(resolve => setTimeout(resolve, config.agentInterval * 1000));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[agent] Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[agent] Shutting down...');
    process.exit(0);
});

// Run
main().catch(error => {
    console.error('[agent] Fatal error:', error);
    process.exit(1);
});
