#!/usr/bin/env node
/**
 * CLAWtopus CLI — Eight arms. One mind. Zero compromises.
 *
 * Inference router + cluster management for TentaCLAW OS.
 * Talks to the HiveMind Gateway API. Pure Node.js, zero dependencies.
 *
 * Usage:
 *   clawtopus status                                  # Cluster overview
 *   clawtopus nodes                                   # List all nodes
 *   clawtopus models                                  # List cluster models
 *   clawtopus health                                  # Cluster health score
 *   clawtopus chat --model llama3.1:8b                # Interactive chat
 *   clawtopus deploy <model>                          # Deploy model to all nodes
 *   clawtopus deploy <model> <nodeId>                 # Deploy to specific node
 *   clawtopus alerts                                  # View cluster alerts
 *   clawtopus benchmarks                              # View benchmarks
 *   clawtopus tags list                               # List all tags
 *   clawtopus tags add <nodeId> <tag>                 # Tag a node
 *   clawtopus command <nodeId> <action> [--model m]   # Send command
 *   clawtopus flight-sheets                           # List flight sheets
 *   clawtopus apply <flightSheetId>                   # Apply a flight sheet
 *   clawtopus help                                    # Show help
 */

import * as http from 'http';
import * as https from 'https';

// =============================================================================
// Brand Colors (ANSI true-color escape sequences)
// =============================================================================

const C = {
    cyan:    (s: string) => `\x1b[38;2;0;255;255m${s}\x1b[0m`,
    purple:  (s: string) => `\x1b[38;2;140;0;200m${s}\x1b[0m`,
    green:   (s: string) => `\x1b[38;2;0;255;136m${s}\x1b[0m`,
    red:     (s: string) => `\x1b[38;2;255;70;70m${s}\x1b[0m`,
    yellow:  (s: string) => `\x1b[38;2;255;220;0m${s}\x1b[0m`,
    dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
    bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
    white:   (s: string) => `\x1b[97m${s}\x1b[0m`,
};

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

function formatMb(mb: number): string {
    if (mb >= 1024) {
        return (mb / 1024).toFixed(1) + ' GB';
    }
    return formatNumber(mb) + ' MB';
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}

function formatToksPerSec(toks: number): string {
    if (toks === 0) return C.dim('0 tok/s');
    return C.green(formatNumber(Math.round(toks)) + ' tok/s');
}

function statusBadge(status: string): string {
    switch (status) {
        case 'online':    return C.green('\u25CF online');
        case 'offline':   return C.red('\u25CF offline');
        case 'error':     return C.red('\u25CF error');
        case 'rebooting': return C.yellow('\u25CF rebooting');
        default:          return C.dim('\u25CF ' + status);
    }
}

function padRight(s: string, len: number): string {
    // Strip ANSI codes to measure visible length
    const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, len - visible.length);
    return s + ' '.repeat(pad);
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface ParsedArgs {
    command: string;
    positional: string[];
    flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
    const raw = argv.slice(2);
    const positional: string[] = [];
    const flags: Record<string, string> = {};

    for (let i = 0; i < raw.length; i++) {
        const arg = raw[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = raw[i + 1];
            if (next && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = 'true';
            }
        } else {
            positional.push(arg);
        }
    }

    return {
        command: positional[0] || 'help',
        positional: positional.slice(1),
        flags,
    };
}

// =============================================================================
// Gateway URL Resolution
// =============================================================================

function getGatewayUrl(flags: Record<string, string>): string {
    return flags['gateway']
        || process.env['TENTACLAW_GATEWAY']
        || 'http://localhost:8080';
}

// =============================================================================
// HTTP Client — Pure Node.js
// =============================================================================

interface ApiResponse {
    status: number;
    data: unknown;
}

function apiRequest(method: string, url: string, body?: unknown): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options: http.RequestOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'CLAWtopus-CLI/0.2.0',
                'Accept': 'application/json',
            },
            timeout: 15000,
        };

        const transport = parsed.protocol === 'https:' ? https : http;

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode || 0, data: parsed });
                } catch {
                    resolve({ status: res.statusCode || 0, data: { raw: data } });
                }
            });
        });

        req.on('error', (err: Error) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out after 15s'));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function apiGet(baseUrl: string, path: string): Promise<unknown> {
    const url = baseUrl.replace(/\/+$/, '') + path;
    try {
        const resp = await apiRequest('GET', url);
        if (resp.status >= 400) {
            const errData = resp.data as Record<string, unknown>;
            throw new Error(String(errData['error'] || `HTTP ${resp.status}`));
        }
        return resp.data;
    } catch (err) {
        handleConnectionError(err, baseUrl);
        process.exit(1);
    }
}

async function apiPost(baseUrl: string, path: string, body?: unknown): Promise<unknown> {
    const url = baseUrl.replace(/\/+$/, '') + path;
    try {
        const resp = await apiRequest('POST', url, body);
        if (resp.status >= 400) {
            const errData = resp.data as Record<string, unknown>;
            throw new Error(String(errData['error'] || `HTTP ${resp.status}`));
        }
        return resp.data;
    } catch (err) {
        handleConnectionError(err, baseUrl);
        process.exit(1);
    }
}

function handleConnectionError(err: unknown, baseUrl: string): void {
    if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException).code || '';
        const msg = err.message + ' ' + code;

        if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND') || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
            console.error('');
            console.error(C.red('  \u2718 Cannot connect to HiveMind Gateway'));
            console.error('');
            console.error(`    Gateway URL: ${C.yellow(baseUrl)}`);
            console.error('');
            console.error('    Make sure the gateway is running:');
            console.error(C.dim('      cd gateway && npm run dev'));
            console.error('');
            console.error('    Or specify a different gateway:');
            console.error(C.dim('      clawtopus status --gateway http://192.168.1.100:8080'));
            console.error(C.dim('      TENTACLAW_GATEWAY=http://host:port clawtopus status'));
            console.error('');
            return;
        }
        if (msg.includes('timed out') || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
            console.error('');
            console.error(C.red('  \u2718 Request timed out'));
            console.error(C.dim(`    Gateway: ${baseUrl}`));
            console.error('');
            return;
        }
        // Re-throw non-connection errors
        throw err;
    }
    throw err;
}

// =============================================================================
// Type Guards for API Responses
// =============================================================================

interface ClusterSummary {
    total_nodes: number;
    online_nodes: number;
    offline_nodes: number;
    total_gpus: number;
    total_vram_mb: number;
    used_vram_mb: number;
    total_toks_per_sec: number;
    loaded_models: string[];
    farm_hashes: string[];
}

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

interface NodeWithStats {
    id: string;
    farm_hash: string;
    hostname: string;
    ip_address: string | null;
    mac_address: string | null;
    registered_at: string;
    last_seen_at: string | null;
    status: string;
    gpu_count: number;
    os_version: string | null;
    latest_stats: StatsPayload | null;
}

interface FlightSheetTarget {
    node_id: string;
    model: string;
    gpu?: number;
}

interface FlightSheet {
    id: string;
    name: string;
    description: string;
    targets: FlightSheetTarget[];
    created_at: string;
    updated_at: string | null;
}

// =============================================================================
// ASCII Art
// =============================================================================

const CLAWTOPUS_FACE = [
    C.cyan('       .-\'"\'-.      '),
    C.cyan('      /       \\     '),
    C.purple('     |  ') + C.green('O') + C.purple('   ') + C.green('O') + C.purple('  |    '),
    C.purple('     |   ') + C.cyan('\\_/') + C.purple('   |    '),
    C.cyan('      \\_______/     '),
    C.purple('     /||') + C.cyan('|') + C.purple('||') + C.cyan('|') + C.purple('||\\    '),
    C.purple('    / ||') + C.cyan('|') + C.purple('||') + C.cyan('|') + C.purple('|| \\   '),
];

// =============================================================================
// Commands
// =============================================================================

async function cmdStatus(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/summary') as ClusterSummary;

    console.log('');
    for (const line of CLAWTOPUS_FACE) {
        console.log('  ' + line);
    }
    console.log('');
    console.log('  ' + C.purple(C.bold('TentaCLAW Cluster Status')));
    console.log('  ' + C.dim('Gateway: ' + gateway));
    console.log('');

    // Nodes
    const nodesOnline = data.online_nodes;
    const nodesTotal = data.total_nodes;
    const nodesColor = nodesOnline === nodesTotal && nodesTotal > 0 ? C.green : (nodesOnline === 0 ? C.red : C.yellow);
    console.log('  ' + C.cyan('\u2502') + ' Nodes     ' + nodesColor(`${nodesOnline}/${nodesTotal} online`));

    // GPUs
    console.log('  ' + C.cyan('\u2502') + ' GPUs      ' + C.white(formatNumber(data.total_gpus) + ' total'));

    // VRAM
    const vramPct = data.total_vram_mb > 0 ? Math.round((data.used_vram_mb / data.total_vram_mb) * 100) : 0;
    console.log('  ' + C.cyan('\u2502') + ' VRAM      ' + C.white(formatMb(data.used_vram_mb) + ' / ' + formatMb(data.total_vram_mb)) + C.dim(` (${vramPct}%)`));

    // Throughput
    console.log('  ' + C.cyan('\u2502') + ' Throughput ' + formatToksPerSec(data.total_toks_per_sec));

    // Models
    const models = data.loaded_models.length > 0 ? data.loaded_models.join(', ') : C.dim('none');
    console.log('  ' + C.cyan('\u2502') + ' Models    ' + models);

    // Farms
    if (data.farm_hashes.length > 0) {
        console.log('  ' + C.cyan('\u2502') + ' Farms     ' + data.farm_hashes.join(', '));
    }

    console.log('');
}

async function cmdNodes(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/nodes') as { nodes: NodeWithStats[] };
    const nodes = data.nodes;

    if (nodes.length === 0) {
        console.log('');
        console.log(C.yellow('  No nodes registered yet.'));
        console.log(C.dim('  Start an agent: cd agent && npm run dev -- --mock'));
        console.log('');
        return;
    }

    console.log('');
    console.log('  ' + C.purple(C.bold('Cluster Nodes')) + C.dim(` (${nodes.length} total)`));
    console.log('');

    // Table header
    const hdr =
        padRight(C.dim('STATUS'), 20) +
        padRight(C.dim('HOSTNAME'), 22) +
        padRight(C.dim('GPUs'), 8) +
        padRight(C.dim('VRAM'), 20) +
        padRight(C.dim('TOK/S'), 14) +
        C.dim('NODE ID');
    console.log('  ' + hdr);
    console.log('  ' + C.dim('\u2500'.repeat(100)));

    for (const node of nodes) {
        const stats = node.latest_stats;
        const gpuCount = stats ? String(stats.gpu_count) : String(node.gpu_count);

        let vram = C.dim('-');
        if (stats && stats.gpus.length > 0) {
            let totalVram = 0;
            let usedVram = 0;
            for (const gpu of stats.gpus) {
                totalVram += gpu.vramTotalMb;
                usedVram += gpu.vramUsedMb;
            }
            vram = formatMb(usedVram) + '/' + formatMb(totalVram);
        }

        const toks = stats ? formatToksPerSec(stats.toks_per_sec) : C.dim('-');

        const row =
            padRight(statusBadge(node.status), 20) +
            padRight(C.white(node.hostname), 22) +
            padRight(gpuCount, 8) +
            padRight(vram, 20) +
            padRight(toks, 14) +
            C.dim(node.id);

        console.log('  ' + row);
    }

    console.log('');
}

async function cmdNode(gateway: string, nodeId: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/nodes/' + encodeURIComponent(nodeId)) as { node: NodeWithStats };
    const node = data.node;
    const stats = node.latest_stats;

    console.log('');
    console.log('  ' + C.purple(C.bold('Node: ')) + C.white(node.hostname));
    console.log('  ' + C.dim(node.id));
    console.log('');

    // Basic info
    console.log('  ' + C.cyan('\u2502') + ' Status      ' + statusBadge(node.status));
    console.log('  ' + C.cyan('\u2502') + ' Farm        ' + node.farm_hash);
    if (node.ip_address) {
        console.log('  ' + C.cyan('\u2502') + ' IP          ' + node.ip_address);
    }
    if (node.mac_address) {
        console.log('  ' + C.cyan('\u2502') + ' MAC         ' + node.mac_address);
    }
    if (node.os_version) {
        console.log('  ' + C.cyan('\u2502') + ' OS          ' + node.os_version);
    }
    console.log('  ' + C.cyan('\u2502') + ' Registered  ' + (node.registered_at || C.dim('unknown')));
    console.log('  ' + C.cyan('\u2502') + ' Last seen   ' + (node.last_seen_at || C.dim('never')));
    console.log('');

    if (!stats) {
        console.log(C.dim('  No stats reported yet.'));
        console.log('');
        return;
    }

    // System stats
    console.log('  ' + C.cyan(C.bold('System')));
    console.log('  ' + C.cyan('\u2502') + ' Uptime      ' + formatUptime(stats.uptime_secs));
    console.log('  ' + C.cyan('\u2502') + ' CPU         ' + stats.cpu.usage_pct + '%' + (stats.cpu.temp_c > 0 ? C.dim(` (${stats.cpu.temp_c}\u00B0C)`) : ''));
    console.log('  ' + C.cyan('\u2502') + ' RAM         ' + formatMb(stats.ram.used_mb) + ' / ' + formatMb(stats.ram.total_mb));
    console.log('  ' + C.cyan('\u2502') + ' Disk        ' + stats.disk.used_gb + ' GB / ' + stats.disk.total_gb + ' GB');
    console.log('  ' + C.cyan('\u2502') + ' Throughput  ' + formatToksPerSec(stats.toks_per_sec));
    console.log('');

    // GPUs
    if (stats.gpus.length > 0) {
        console.log('  ' + C.cyan(C.bold('GPUs')) + C.dim(` (${stats.gpus.length})`));
        for (let i = 0; i < stats.gpus.length; i++) {
            const gpu = stats.gpus[i];
            const vramPct = gpu.vramTotalMb > 0 ? Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100) : 0;
            const tempColor = gpu.temperatureC > 80 ? C.red : (gpu.temperatureC > 65 ? C.yellow : C.green);

            console.log('  ' + C.cyan('\u2502') + ' ' + C.purple(`[${i}]`) + ' ' + C.white(gpu.name));
            console.log('  ' + C.cyan('\u2502') + '     VRAM     ' + formatMb(gpu.vramUsedMb) + ' / ' + formatMb(gpu.vramTotalMb) + C.dim(` (${vramPct}%)`));
            console.log('  ' + C.cyan('\u2502') + '     Temp     ' + tempColor(gpu.temperatureC + '\u00B0C'));
            console.log('  ' + C.cyan('\u2502') + '     Util     ' + gpu.utilizationPct + '%');
            console.log('  ' + C.cyan('\u2502') + '     Power    ' + gpu.powerDrawW + ' W');
            console.log('  ' + C.cyan('\u2502') + '     Fan      ' + gpu.fanSpeedPct + '%');
            console.log('  ' + C.cyan('\u2502') + '     Clock    SM ' + formatNumber(gpu.clockSmMhz) + ' MHz / Mem ' + formatNumber(gpu.clockMemMhz) + ' MHz');
            console.log('  ' + C.cyan('\u2502') + '     Bus      ' + C.dim(gpu.busId));
        }
        console.log('');
    }

    // Inference
    const inf = stats.inference;
    console.log('  ' + C.cyan(C.bold('Inference')));
    console.log('  ' + C.cyan('\u2502') + ' Models      ' + (inf.loaded_models.length > 0 ? inf.loaded_models.join(', ') : C.dim('none')));
    console.log('  ' + C.cyan('\u2502') + ' In-flight   ' + inf.in_flight_requests);
    console.log('  ' + C.cyan('\u2502') + ' Tokens      ' + formatNumber(inf.tokens_generated));
    console.log('  ' + C.cyan('\u2502') + ' Latency     ' + (inf.avg_latency_ms > 0 ? inf.avg_latency_ms + ' ms' : C.dim('-')));
    console.log('  ' + C.cyan('\u2502') + ' Requests    ' + formatNumber(stats.requests_completed));
    console.log('');
}

async function cmdDeploy(gateway: string, model: string, nodeId?: string): Promise<void> {
    console.log('');

    if (nodeId) {
        // Deploy to specific node
        console.log('  ' + C.purple('Deploying') + ' ' + C.white(model) + ' to node ' + C.cyan(nodeId) + '...');
        console.log('');

        const data = await apiPost(gateway, '/api/v1/nodes/' + encodeURIComponent(nodeId) + '/commands', {
            action: 'install_model',
            model,
        }) as { status: string; command: { id: string; action: string } };

        console.log('  ' + C.green('\u2714') + ' Command queued: ' + C.dim(data.command.id));
        console.log('  ' + C.dim('  The agent will pull the model on its next check-in.'));
    } else {
        // Deploy to all online nodes
        console.log('  ' + C.purple('Deploying') + ' ' + C.white(model) + ' to ' + C.cyan('all online nodes') + '...');
        console.log('');

        const nodesData = await apiGet(gateway, '/api/v1/nodes') as { nodes: NodeWithStats[] };
        const onlineNodes = nodesData.nodes.filter(n => n.status === 'online');

        if (onlineNodes.length === 0) {
            console.log('  ' + C.yellow('\u26A0') + '  No online nodes found.');
            console.log('');
            return;
        }

        let queued = 0;
        for (const node of onlineNodes) {
            try {
                const data = await apiPost(gateway, '/api/v1/nodes/' + encodeURIComponent(node.id) + '/commands', {
                    action: 'install_model',
                    model,
                }) as { status: string; command: { id: string } };

                console.log('  ' + C.green('\u2714') + ' ' + padRight(C.white(node.hostname), 24) + C.dim(data.command.id));
                queued++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log('  ' + C.red('\u2718') + ' ' + padRight(C.white(node.hostname), 24) + C.red(msg));
            }
        }

        console.log('');
        console.log('  ' + C.green(String(queued)) + ' command(s) queued across ' + C.cyan(String(onlineNodes.length)) + ' node(s).');
    }

    console.log('');
}

async function cmdCommand(gateway: string, nodeId: string, action: string, flags: Record<string, string>): Promise<void> {
    const validActions = ['reload_model', 'install_model', 'remove_model', 'overclock', 'restart_agent', 'reboot'];

    if (!validActions.includes(action)) {
        console.error('');
        console.error(C.red('  \u2718 Unknown action: ') + C.white(action));
        console.error('');
        console.error('  Valid actions:');
        for (const a of validActions) {
            console.error('    ' + C.cyan(a));
        }
        console.error('');
        process.exit(1);
    }

    const body: Record<string, unknown> = { action };
    if (flags['model']) body['model'] = flags['model'];
    if (flags['gpu']) body['gpu'] = parseInt(flags['gpu']);
    if (flags['profile']) body['profile'] = flags['profile'];
    if (flags['priority']) body['priority'] = flags['priority'];

    console.log('');
    console.log('  ' + C.purple('Sending command') + ' ' + C.white(action) + ' to ' + C.cyan(nodeId) + '...');

    if (body['model']) {
        console.log('  ' + C.dim('Model: ' + body['model']));
    }
    if (body['gpu'] !== undefined) {
        console.log('  ' + C.dim('GPU: ' + body['gpu']));
    }
    console.log('');

    const data = await apiPost(gateway, '/api/v1/nodes/' + encodeURIComponent(nodeId) + '/commands', body) as {
        status: string;
        command: { id: string; action: string };
    };

    console.log('  ' + C.green('\u2714') + ' Command queued: ' + C.dim(data.command.id));
    console.log('  ' + C.dim('  The agent will execute this on its next check-in.'));
    console.log('');
}

async function cmdFlightSheets(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/flight-sheets') as { flight_sheets: FlightSheet[] };
    const sheets = data.flight_sheets;

    console.log('');
    console.log('  ' + C.purple(C.bold('Flight Sheets')) + C.dim(` (${sheets.length} total)`));
    console.log('');

    if (sheets.length === 0) {
        console.log(C.dim('  No flight sheets configured.'));
        console.log(C.dim('  Create one via the Gateway API or Dashboard.'));
        console.log('');
        return;
    }

    for (const sheet of sheets) {
        console.log('  ' + C.cyan('\u250C') + C.cyan('\u2500'.repeat(60)));
        console.log('  ' + C.cyan('\u2502') + ' ' + C.white(C.bold(sheet.name)) + C.dim('  ' + sheet.id));
        if (sheet.description) {
            console.log('  ' + C.cyan('\u2502') + ' ' + C.dim(sheet.description));
        }
        console.log('  ' + C.cyan('\u2502') + ' Created: ' + sheet.created_at);
        if (sheet.updated_at) {
            console.log('  ' + C.cyan('\u2502') + ' Updated: ' + sheet.updated_at);
        }
        console.log('  ' + C.cyan('\u2502'));
        console.log('  ' + C.cyan('\u2502') + ' ' + C.dim('Targets:'));

        for (const target of sheet.targets) {
            const nodeLabel = target.node_id === '*' ? C.yellow('all nodes') : C.cyan(target.node_id);
            const gpuLabel = target.gpu !== undefined ? C.dim(` (GPU ${target.gpu})`) : '';
            console.log('  ' + C.cyan('\u2502') + '   ' + C.purple('\u2192') + ' ' + C.white(target.model) + ' \u2192 ' + nodeLabel + gpuLabel);
        }

        console.log('  ' + C.cyan('\u2514') + C.cyan('\u2500'.repeat(60)));
        console.log('');
    }
}

async function cmdApply(gateway: string, flightSheetId: string): Promise<void> {
    console.log('');
    console.log('  ' + C.purple('Applying flight sheet') + ' ' + C.cyan(flightSheetId) + '...');
    console.log('');

    const data = await apiPost(gateway, '/api/v1/flight-sheets/' + encodeURIComponent(flightSheetId) + '/apply') as {
        status: string;
        commands_queued: number;
        commands: { id: string; action: string; model?: string }[];
    };

    if (data.commands_queued === 0) {
        console.log('  ' + C.yellow('\u26A0') + '  No commands were queued.');
        console.log('  ' + C.dim('  Check that matching nodes are online.'));
    } else {
        console.log('  ' + C.green('\u2714') + ' ' + C.green(String(data.commands_queued)) + ' command(s) queued:');
        console.log('');

        for (const cmd of data.commands) {
            const modelLabel = cmd.model ? C.white(cmd.model) : C.dim('n/a');
            console.log('    ' + C.dim(cmd.id) + '  ' + C.cyan(cmd.action) + '  ' + modelLabel);
        }
    }

    console.log('');
}

// =============================================================================
// New Commands — v0.2.0 CLAWtopus
// =============================================================================

async function cmdModels(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/models') as { models: Array<{ model: string; node_count: number; nodes: string[] }> };
    const models = data.models;

    if (models.length === 0) {
        console.log('');
        console.log(C.yellow('  No models loaded on the cluster.'));
        console.log(C.dim('  Deploy one: clawtopus deploy llama3.1:8b'));
        console.log('');
        return;
    }

    console.log('');
    console.log('  ' + C.purple(C.bold('Cluster Models')) + C.dim(` (${models.length} unique)`));
    console.log('');

    const hdr =
        padRight(C.dim('MODEL'), 30) +
        padRight(C.dim('NODES'), 10) +
        C.dim('DEPLOYED ON');
    console.log('  ' + hdr);
    console.log('  ' + C.dim('\u2500'.repeat(70)));

    for (const m of models) {
        const nodeNames = m.nodes.map(n => n.split('-').pop()).join(', ');
        const row =
            padRight(C.white(m.model), 30) +
            padRight(C.cyan(String(m.node_count)), 10) +
            C.dim(nodeNames);
        console.log('  ' + row);
    }
    console.log('');
}

async function cmdHealth(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/health/score') as {
        score: number;
        grade: string;
        color: string;
        factors: Record<string, number | boolean>;
    };

    console.log('');
    console.log('  ' + C.purple(C.bold('Cluster Health')));
    console.log('');

    // Score with color
    const scoreColor = data.score >= 80 ? C.green : data.score >= 50 ? C.yellow : C.red;
    console.log('  ' + scoreColor(C.bold(`${data.score}/100`)) + ' ' + scoreColor(`(${data.grade})`));
    console.log('');

    // Score bar
    const barLen = 40;
    const filled = Math.round((data.score / 100) * barLen);
    const bar = scoreColor('\u2588'.repeat(filled)) + C.dim('\u2591'.repeat(barLen - filled));
    console.log('  ' + bar);
    console.log('');

    // Factors
    if (data.factors) {
        console.log('  ' + C.cyan(C.bold('Factors:')));
        const labels: Record<string, string> = {
            nodes_online_pct: 'Nodes Online',
            avg_gpu_temp: 'Avg GPU Temp',
            avg_vram_headroom_pct: 'VRAM Headroom',
            recent_critical_alerts: 'Critical Alerts',
            has_loaded_models: 'Models Loaded',
        };
        for (const [key, val] of Object.entries(data.factors)) {
            const label = labels[key] || key;
            if (typeof val === 'boolean') {
                const icon = val ? C.green('\u2714') : C.red('\u2718');
                console.log('    ' + icon + ' ' + C.white(label));
            } else if (key.includes('temp')) {
                const tColor = val < 70 ? C.green : val < 85 ? C.yellow : C.red;
                console.log('    ' + padRight(C.white(label), 22) + tColor(`${val}\u00B0C`));
            } else if (key.includes('alert')) {
                const aColor = val === 0 ? C.green : C.red;
                console.log('    ' + padRight(C.white(label), 22) + aColor(String(val)));
            } else {
                const pColor = val >= 70 ? C.green : val >= 40 ? C.yellow : C.red;
                console.log('    ' + padRight(C.white(label), 22) + pColor(`${val}%`));
            }
        }
    }
    console.log('');
}

async function cmdAlerts(gateway: string, flags: Record<string, string>): Promise<void> {
    const limit = parseInt(flags['limit'] || '20');
    const resp = await apiGet(gateway, `/api/v1/alerts?limit=${limit}`) as { alerts: Array<{
        id: string;
        node_id: string;
        severity: string;
        type: string;
        message: string;
        value: number;
        threshold: number;
        acknowledged: number;
        created_at: string;
    }> };
    const data = resp.alerts;

    if (data.length === 0) {
        console.log('');
        console.log(C.green('  \u2714 No alerts. Cluster is healthy.'));
        console.log('');
        return;
    }

    console.log('');
    console.log('  ' + C.purple(C.bold('Cluster Alerts')) + C.dim(` (${data.length} recent)`));
    console.log('');

    for (const alert of data) {
        const icon = alert.severity === 'critical' ? C.red('\u2718') : C.yellow('\u26A0');
        const ack = alert.acknowledged ? C.dim(' [acked]') : '';
        const sev = alert.severity === 'critical' ? C.red(alert.severity.toUpperCase()) : C.yellow(alert.severity.toUpperCase());
        console.log(`  ${icon} ${sev} ${C.white(alert.type)} on ${C.cyan(alert.node_id)}${ack}`);
        console.log(`    ${C.dim(alert.message)} ${C.dim('(' + alert.created_at + ')')}`);
    }
    console.log('');
}

async function cmdBenchmarks(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/benchmarks') as Array<{
        id: string;
        node_id: string;
        model: string;
        tokens_per_sec: number;
        prompt_eval_rate: number;
        created_at: string;
    }>;

    if (data.length === 0) {
        console.log('');
        console.log(C.yellow('  No benchmarks recorded yet.'));
        console.log(C.dim('  Run one: clawtopus command <nodeId> benchmark --model llama3.1:8b'));
        console.log('');
        return;
    }

    console.log('');
    console.log('  ' + C.purple(C.bold('Benchmark Results')) + C.dim(` (${data.length} results)`));
    console.log('');

    const hdr =
        padRight(C.dim('NODE'), 25) +
        padRight(C.dim('MODEL'), 22) +
        padRight(C.dim('TOK/S'), 12) +
        padRight(C.dim('PROMPT EVAL'), 14) +
        C.dim('DATE');
    console.log('  ' + hdr);
    console.log('  ' + C.dim('\u2500'.repeat(80)));

    for (const b of data) {
        const row =
            padRight(C.cyan(b.node_id.slice(-12)), 25) +
            padRight(C.white(b.model), 22) +
            padRight(C.green(String(Math.round(b.tokens_per_sec))), 12) +
            padRight(C.dim(String(Math.round(b.prompt_eval_rate))), 14) +
            C.dim(b.created_at.slice(0, 10));
        console.log('  ' + row);
    }
    console.log('');
}

async function cmdTags(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0];

    if (!sub || sub === 'list') {
        // List all tags
        const data = await apiGet(gateway, '/api/v1/tags') as Array<{ tag: string; count: number }>;
        if (data.length === 0) {
            console.log('');
            console.log(C.yellow('  No tags defined.'));
            console.log(C.dim('  Add one: clawtopus tags add <nodeId> <tag>'));
            console.log('');
            return;
        }

        console.log('');
        console.log('  ' + C.purple(C.bold('Node Tags')));
        console.log('');
        for (const t of data) {
            console.log('  ' + C.cyan('\u25CF') + ' ' + C.white(t.tag) + C.dim(` (${t.count} node${t.count !== 1 ? 's' : ''})`));
        }
        console.log('');
        return;
    }

    if (sub === 'add') {
        const nodeId = positional[1];
        const tag = positional[2];
        if (!nodeId || !tag) {
            console.error(C.red('  \u2718 Usage: clawtopus tags add <nodeId> <tag>'));
            process.exit(1);
        }
        await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/tags`, { tags: [tag] });
        console.log('  ' + C.green('\u2714') + ` Tagged ${C.cyan(nodeId)} with ${C.white(tag)}`);
        return;
    }

    if (sub === 'nodes') {
        const tag = positional[1];
        if (!tag) {
            console.error(C.red('  \u2718 Usage: clawtopus tags nodes <tag>'));
            process.exit(1);
        }
        const nodes = await apiGet(gateway, `/api/v1/tags/${encodeURIComponent(tag)}/nodes`) as NodeWithStats[];
        console.log('');
        console.log('  ' + C.purple(C.bold(`Nodes tagged "${tag}"`)) + C.dim(` (${nodes.length})`));
        console.log('');
        for (const n of nodes) {
            console.log('  ' + statusBadge(n.status) + '  ' + padRight(C.white(n.hostname), 20) + C.dim(n.id));
        }
        console.log('');
        return;
    }

    console.error(C.red(`  \u2718 Unknown tags subcommand: ${sub}`));
    console.error(C.dim('  Available: list, add, nodes'));
}

async function cmdChat(gateway: string, flags: Record<string, string>): Promise<void> {
    const model = flags['model'] || 'llama3.1:8b';

    console.log('');
    console.log('  ' + C.purple(C.bold('CLAWtopus Chat')) + C.dim(` (model: ${model})`));
    console.log('  ' + C.dim('Type your message, then press Enter. Type /quit to exit.'));
    console.log('');

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: C.cyan('  \u276F '),
    });

    rl.prompt();

    rl.on('line', async (line: string) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }
        if (input === '/quit' || input === '/exit') {
            console.log('');
            console.log(C.dim('  CLAWtopus waves goodbye! \ud83d\udc19'));
            console.log('');
            rl.close();
            process.exit(0);
        }

        process.stdout.write('  ' + C.purple('CLAWtopus: '));

        try {
            const url = gateway.replace(/\/+$/, '') + '/v1/chat/completions';
            const body = JSON.stringify({
                model,
                messages: [{ role: 'user', content: input }],
                stream: false,
            });

            const resp = await apiRequest('POST', url, JSON.parse(body));
            if (resp.status >= 400) {
                const err = resp.data as Record<string, unknown>;
                console.log(C.red(String(err['error'] || `HTTP ${resp.status}`)));
            } else {
                const data = resp.data as { choices?: Array<{ message?: { content?: string } }> };
                const content = data.choices?.[0]?.message?.content || '(no response)';
                console.log(C.white(content));
            }
        } catch (err) {
            console.log(C.red('Error: ' + (err instanceof Error ? err.message : String(err))));
        }

        console.log('');
        rl.prompt();
    });
}

async function cmdDoctor(gateway: string, flags: Record<string, string>): Promise<void> {
    const autofix = flags['no-fix'] ? 'false' : 'true';

    console.log('');
    console.log('  ' + C.purple(C.bold('CLAWtopus Doctor')) + C.dim(' — Self-healing diagnostics'));
    console.log('  ' + C.dim(autofix === 'true' ? 'Auto-fix: ENABLED' : 'Auto-fix: DISABLED (dry run)'));
    console.log('');

    const data = await apiGet(gateway, `/api/v1/doctor?autofix=${autofix}`) as {
        status: string;
        timestamp: string;
        autofix_enabled: boolean;
        summary: { total_checks: number; ok: number; warnings: number; critical: number; auto_fixed: number };
        results: Array<{ check: string; status: string; message: string; auto_fixed?: boolean; detail?: unknown }>;
    };

    // Status icon and color for overall
    const statusIcon = data.status === 'healthy' ? C.green('\u2714') : data.status === 'warning' ? C.yellow('\u26A0') : C.red('\u2718');
    const statusColor = data.status === 'healthy' ? C.green : data.status === 'warning' ? C.yellow : C.red;
    console.log('  ' + statusIcon + ' Cluster status: ' + statusColor(data.status.toUpperCase()));
    console.log('');

    // Results
    for (const r of data.results) {
        let icon: string;
        let color: (s: string) => string;
        switch (r.status) {
            case 'ok': icon = C.green('\u2714'); color = C.green; break;
            case 'fixed': icon = C.cyan('\u2692'); color = C.cyan; break;
            case 'warning': icon = C.yellow('\u26A0'); color = C.yellow; break;
            case 'critical': icon = C.red('\u2718'); color = C.red; break;
            default: icon = C.dim('\u25CB'); color = C.dim;
        }

        const fixLabel = r.auto_fixed ? C.cyan(' [AUTO-FIXED]') : '';
        console.log('  ' + icon + ' ' + padRight(color(r.check), 30) + C.white(r.message) + fixLabel);
    }

    // Summary
    console.log('');
    const s = data.summary;
    const parts: string[] = [];
    parts.push(C.green(`${s.ok} ok`));
    if (s.auto_fixed > 0) parts.push(C.cyan(`${s.auto_fixed} fixed`));
    if (s.warnings > 0) parts.push(C.yellow(`${s.warnings} warning${s.warnings > 1 ? 's' : ''}`));
    if (s.critical > 0) parts.push(C.red(`${s.critical} critical`));
    console.log('  ' + C.dim(`${s.total_checks} checks: `) + parts.join(C.dim(' | ')));

    if (s.auto_fixed > 0) {
        console.log('');
        console.log('  ' + C.cyan(C.bold(`\u2692 ${s.auto_fixed} issue(s) auto-fixed by CLAWtopus Doctor`)));
    }

    if (s.critical > 0) {
        console.log('');
        console.log('  ' + C.red(C.bold('\u26A0 Critical issues require manual intervention')));
    }

    console.log('');
}

function cmdHelp(): void {
    console.log('');
    for (const line of CLAWTOPUS_FACE) {
        console.log('  ' + line);
    }
    console.log('');
    console.log('  ' + C.purple(C.bold('CLAWtopus CLI')) + ' ' + C.dim('v0.2.0'));
    console.log('  ' + C.dim('Eight arms. One mind. Zero compromises.'));
    console.log('  ' + C.dim('Inference router + cluster management for TentaCLAW OS.'));
    console.log('');
    console.log('  ' + C.cyan(C.bold('USAGE')));
    console.log('');
    console.log('    clawtopus <command> [options]');
    console.log('');
    console.log('  ' + C.cyan(C.bold('CLUSTER MANAGEMENT')));
    console.log('');
    console.log('    ' + padRight(C.green('status'), 42) + 'Cluster overview (nodes, GPUs, VRAM, tok/s)');
    console.log('    ' + padRight(C.green('nodes'), 42) + 'List all nodes with status');
    console.log('    ' + padRight(C.green('node') + ' <nodeId>', 42) + 'Show detailed node info');
    console.log('    ' + padRight(C.green('health'), 42) + 'Cluster health score (0-100)');
    console.log('    ' + padRight(C.green('alerts'), 42) + 'View cluster alerts');
    console.log('    ' + padRight(C.green('benchmarks'), 42) + 'View benchmark results');
    console.log('    ' + padRight(C.green('tags') + ' [list|add|nodes]', 42) + 'Manage node tags');
    console.log('    ' + padRight(C.green('doctor'), 42) + 'Run diagnostics + auto-fix issues');
    console.log('    ' + padRight(C.green('doctor') + ' --no-fix', 42) + 'Dry run (diagnose only, no fixes)');
    console.log('');
    console.log('  ' + C.cyan(C.bold('INFERENCE & MODELS')));
    console.log('');
    console.log('    ' + padRight(C.green('models'), 42) + 'List models loaded across the cluster');
    console.log('    ' + padRight(C.green('chat') + ' --model <name>', 42) + 'Interactive chat with a cluster model');
    console.log('    ' + padRight(C.green('deploy') + ' <model>', 42) + 'Deploy model to all online nodes');
    console.log('    ' + padRight(C.green('deploy') + ' <model> <nodeId>', 42) + 'Deploy model to specific node');
    console.log('');
    console.log('  ' + C.cyan(C.bold('AUTOMATION')));
    console.log('');
    console.log('    ' + padRight(C.green('command') + ' <nodeId> <action>', 42) + 'Send command to a node');
    console.log('    ' + padRight(C.green('flight-sheets'), 42) + 'List all flight sheets');
    console.log('    ' + padRight(C.green('apply') + ' <flightSheetId>', 42) + 'Apply a flight sheet');
    console.log('    ' + padRight(C.green('help'), 42) + 'Show this help');
    console.log('');
    console.log('  ' + C.cyan(C.bold('COMMAND OPTIONS')));
    console.log('');
    console.log('    ' + padRight(C.yellow('--model') + ' <name>', 42) + 'Model name (for command)');
    console.log('    ' + padRight(C.yellow('--gpu') + ' <index>', 42) + 'GPU index (for command)');
    console.log('    ' + padRight(C.yellow('--profile') + ' <name>', 42) + 'Profile name (for overclock)');
    console.log('    ' + padRight(C.yellow('--priority') + ' <level>', 42) + 'Priority (for command)');
    console.log('');
    console.log('  ' + C.cyan(C.bold('GLOBAL OPTIONS')));
    console.log('');
    console.log('    ' + padRight(C.yellow('--gateway') + ' <url>', 42) + 'HiveMind Gateway URL');
    console.log('');
    console.log('  ' + C.cyan(C.bold('ENVIRONMENT')));
    console.log('');
    console.log('    ' + padRight(C.yellow('TENTACLAW_GATEWAY'), 42) + 'Default gateway URL (default: http://localhost:8080)');
    console.log('');
    console.log('  ' + C.cyan(C.bold('ACTIONS')) + C.dim(' (for the command subcommand)'));
    console.log('');
    console.log('    ' + padRight('reload_model', 24) + 'Reload a model in the inference engine');
    console.log('    ' + padRight('install_model', 24) + 'Pull/install a model via Ollama');
    console.log('    ' + padRight('remove_model', 24) + 'Remove a model from the node');
    console.log('    ' + padRight('overclock', 24) + 'Apply an overclock profile');
    console.log('    ' + padRight('restart_agent', 24) + 'Restart the TentaCLAW agent daemon');
    console.log('    ' + padRight('reboot', 24) + 'Reboot the node');
    console.log('');
    console.log('  ' + C.cyan(C.bold('EXAMPLES')));
    console.log('');
    console.log(C.dim('    # Check cluster status'));
    console.log('    clawtopus status');
    console.log('');
    console.log(C.dim('    # List models and check health'));
    console.log('    clawtopus models');
    console.log('    clawtopus health');
    console.log('');
    console.log(C.dim('    # Deploy a model across the cluster'));
    console.log('    clawtopus deploy llama3.1:8b');
    console.log('');
    console.log(C.dim('    # Interactive chat with a model'));
    console.log('    clawtopus chat --model llama3.1:8b');
    console.log('');
    console.log(C.dim('    # Tag nodes and filter by tag'));
    console.log('    clawtopus tags add NODE-001 production');
    console.log('    clawtopus tags nodes production');
    console.log('');
    console.log(C.dim('    # Send a command to a specific node'));
    console.log('    clawtopus command NODE-001 install_model --model codellama:7b');
    console.log('');
    console.log(C.dim('    # Use a remote gateway'));
    console.log('    clawtopus status --gateway http://192.168.1.100:8080');
    console.log('');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);
    const gateway = getGatewayUrl(parsed.flags);

    switch (parsed.command) {
        case 'status':
            await cmdStatus(gateway);
            break;

        case 'nodes':
            await cmdNodes(gateway);
            break;

        case 'node': {
            const nodeId = parsed.positional[0];
            if (!nodeId) {
                console.error('');
                console.error(C.red('  \u2718 Missing node ID'));
                console.error(C.dim('  Usage: clawtopus node <nodeId>'));
                console.error('');
                process.exit(1);
            }
            await cmdNode(gateway, nodeId);
            break;
        }

        case 'deploy': {
            const model = parsed.positional[0];
            if (!model) {
                console.error('');
                console.error(C.red('  \u2718 Missing model name'));
                console.error(C.dim('  Usage: clawtopus deploy <model> [nodeId]'));
                console.error(C.dim('  Example: clawtopus deploy llama3.1:8b'));
                console.error('');
                process.exit(1);
            }
            const targetNode = parsed.positional[1];
            await cmdDeploy(gateway, model, targetNode);
            break;
        }

        case 'command': {
            const nodeId = parsed.positional[0];
            const action = parsed.positional[1];
            if (!nodeId || !action) {
                console.error('');
                console.error(C.red('  \u2718 Missing arguments'));
                console.error(C.dim('  Usage: clawtopus command <nodeId> <action> [--model <m>] [--gpu <n>]'));
                console.error(C.dim('  Example: clawtopus command NODE-001 install_model --model llama3.1:8b'));
                console.error('');
                process.exit(1);
            }
            await cmdCommand(gateway, nodeId, action, parsed.flags);
            break;
        }

        case 'models':
            await cmdModels(gateway);
            break;

        case 'health':
            await cmdHealth(gateway);
            break;

        case 'alerts':
            await cmdAlerts(gateway, parsed.flags);
            break;

        case 'benchmarks':
            await cmdBenchmarks(gateway);
            break;

        case 'tags':
            await cmdTags(gateway, parsed.positional, parsed.flags);
            break;

        case 'chat':
            await cmdChat(gateway, parsed.flags);
            break;

        case 'doctor':
            await cmdDoctor(gateway, parsed.flags);
            break;

        case 'flight-sheets':
            await cmdFlightSheets(gateway);
            break;

        case 'apply': {
            const sheetId = parsed.positional[0];
            if (!sheetId) {
                console.error('');
                console.error(C.red('  \u2718 Missing flight sheet ID'));
                console.error(C.dim('  Usage: clawtopus apply <flightSheetId>'));
                console.error(C.dim('  Run "clawtopus flight-sheets" to see available IDs.'));
                console.error('');
                process.exit(1);
            }
            await cmdApply(gateway, sheetId);
            break;
        }

        case 'help':
        case '--help':
        case '-h':
            cmdHelp();
            break;

        case 'version':
        case '--version':
        case '-v':
            console.log('clawtopus-cli v0.2.0');
            break;

        default:
            console.error('');
            console.error(C.red('  \u2718 Unknown command: ') + C.white(parsed.command));
            console.error(C.dim('  Run "clawtopus help" for usage.'));
            console.error('');
            process.exit(1);
    }
}

main().catch((err) => {
    console.error('');
    console.error(C.red('  \u2718 Fatal error: ') + (err instanceof Error ? err.message : String(err)));
    console.error('');
    process.exit(1);
});
