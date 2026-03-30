#!/usr/bin/env node
/**
 * TentaCLAW Agent — Multi-Node Spawner
 *
 * Launches multiple mock agents to simulate a large cluster.
 * Each agent gets unique GPU configs, hostnames, and farm hashes.
 *
 * Usage:
 *   npx tsx src/spawner.ts                      # 4 mock nodes
 *   npx tsx src/spawner.ts --nodes 8            # 8 mock nodes
 *   npx tsx src/spawner.ts --nodes 12 --gateway http://10.0.0.1:8080
 *
 * CLAWtopus says: "Deploy the swarm."
 */

import { fork } from 'child_process';
import path from 'path';

const args = process.argv.slice(2);

const NODE_COUNT = (() => {
    const idx = args.indexOf('--nodes');
    return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 4;
})();

const GATEWAY = (() => {
    const idx = args.indexOf('--gateway');
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : 'http://localhost:8080';
})();

// Node presets — realistic cluster configurations
const NODE_PRESETS = [
    { name: 'gpu-rig-01', gpus: 2, farm: 'FARM7K3P' },
    { name: 'gpu-rig-02', gpus: 4, farm: 'FARM7K3P' },
    { name: 'gpu-rig-03', gpus: 1, farm: 'FARM7K3P' },
    { name: 'inference-01', gpus: 2, farm: 'FARM7K3P' },
    { name: 'pve-gpu', gpus: 1, farm: 'FARMPR0X' },
    { name: 'pve-vega2', gpus: 1, farm: 'FARMPR0X' },
    { name: 'workstation-01', gpus: 2, farm: 'FARMW0RK' },
    { name: 'dl-box-01', gpus: 8, farm: 'FARMDEEP' },
    { name: 'edge-node-01', gpus: 1, farm: 'FARMEDGE' },
    { name: 'edge-node-02', gpus: 1, farm: 'FARMEDGE' },
    { name: 'render-farm-01', gpus: 4, farm: 'FARMRNDR' },
    { name: 'render-farm-02', gpus: 4, farm: 'FARMRNDR' },
    { name: 'bitnet-cpu-01', gpus: 0, farm: 'FARMB1TN' },
    { name: 'bitnet-cpu-02', gpus: 0, farm: 'FARMB1TN' },
    { name: 'lab-node-01', gpus: 1, farm: 'FARMLAB0' },
    { name: 'lab-node-02', gpus: 2, farm: 'FARMLAB0' },
];

const CYAN = '\x1b[38;2;0;255;255m';
const PURPLE = '\x1b[38;2;140;0;200m';
const GREEN = '\x1b[38;2;0;255;136m';
const YELLOW = '\x1b[38;2;255;220;50m';
const RESET = '\x1b[0m';

console.log(`
${CYAN}╭──────────────────────────────────────────╮${RESET}
${CYAN}│${RESET}  ${PURPLE}TentaCLAW Swarm Spawner${RESET}                 ${CYAN}│${RESET}
${CYAN}│${RESET}  Deploying ${YELLOW}${NODE_COUNT}${RESET} mock nodes...              ${CYAN}│${RESET}
${CYAN}│${RESET}  Gateway: ${GREEN}${GATEWAY}${RESET}         ${CYAN}│${RESET}
${CYAN}╰──────────────────────────────────────────╯${RESET}
`);

const agentScript = path.join(__dirname, 'index.ts');
const children: ReturnType<typeof fork>[] = [];

async function spawnAll() {
for (let i = 0; i < NODE_COUNT; i++) {
    const preset = NODE_PRESETS[i % NODE_PRESETS.length];
    // Add suffix if we've wrapped around
    const suffix = i >= NODE_PRESETS.length ? '-' + Math.floor(i / NODE_PRESETS.length) : '';
    const name = preset.name + suffix;
    const gpus = preset.gpus || 1;
    const interval = 3 + Math.floor(Math.random() * 5); // Stagger intervals 3-7s

    const child = fork(agentScript, [
        '--mock',
        '--name', name,
        '--gpus', String(gpus),
        '--gateway', GATEWAY,
        '--interval', String(interval),
    ], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, FARM_HASH: preset.farm },
    });

    // Prefix child output with node name
    const prefix = `${CYAN}[${name}]${RESET} `;
    child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
            // Skip the big ASCII banner per-node, just show important lines
            if (line.includes('─') || line.includes('│') || line.includes('╭') || line.includes('╰') || line.includes('├') || line.trim() === '') continue;
            process.stdout.write(prefix + line + '\n');
        }
    });

    child.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(prefix + data.toString());
    });

    children.push(child);

    const gpuLabel = gpus === 0 ? 'CPU-only' : gpus + ' GPU' + (gpus > 1 ? 's' : '');
    console.log(`${GREEN}  ✓${RESET} Spawned ${CYAN}${name}${RESET} (${gpuLabel}, farm: ${preset.farm}, interval: ${interval}s)`);

    // Stagger launches to avoid hammering the gateway
    await new Promise(resolve => setTimeout(resolve, 200));
}

console.log('\n' + GREEN + 'All ' + NODE_COUNT + ' nodes deployed.' + RESET + ' Open ' + CYAN + GATEWAY + '/dashboard' + RESET + ' to see them.\n');
}

spawnAll();

// Graceful shutdown
function shutdown() {
    console.log(`\n${YELLOW}Shutting down ${children.length} nodes...${RESET}`);
    for (const child of children) {
        child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
