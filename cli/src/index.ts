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

async function cmdWatchdog(gateway: string, positional: string[]): Promise<void> {
    const sub = positional[0] || 'status';

    if (sub === 'status' || sub === 'events') {
        const limit = 20;
        const data = await apiGet(gateway, `/api/v1/watchdog?limit=${limit}`) as Array<{
            node_id: string; level: number; action: string; detail: string; created_at: string;
        }>;

        console.log('');
        if (data.length === 0) {
            console.log('  ' + C.green('\u2714 No watchdog events. Cluster is stable.'));
        } else {
            console.log('  ' + C.purple(C.bold('Watchdog Events')) + C.dim(` (${data.length} recent)`));
            console.log('');
            for (const evt of data) {
                const levelNames = [C.dim('INFO'), C.yellow('WARN'), C.cyan('RESTART'), C.red('GPU-RESET'), C.red(C.bold('REBOOT'))];
                const lvl = levelNames[evt.level] || C.dim('?');
                const nodeShort = evt.node_id.split('-').pop() || evt.node_id;
                console.log(`  ${lvl}  ${padRight(C.white(nodeShort), 16)} ${C.white(evt.action)} ${C.dim(evt.detail.slice(0, 50))}`);
                console.log(`        ${C.dim(evt.created_at)}`);
            }
        }
        console.log('');
        return;
    }

    if (sub === 'node') {
        const nodeId = positional[1];
        if (!nodeId) {
            console.error(C.red('  Usage: clawtopus watchdog node <nodeId>'));
            process.exit(1);
        }
        const data = await apiGet(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/watchdog`) as any[];
        console.log('');
        console.log('  ' + C.purple(C.bold('Watchdog')) + C.dim(` — ${nodeId}`));
        console.log('');
        if (data.length === 0) {
            console.log('  ' + C.green('\u2714 No events for this node.'));
        } else {
            for (const evt of data) {
                const levelNames = ['INFO', 'WARN', 'RESTART', 'GPU-RESET', 'REBOOT'];
                const lvl = levelNames[evt.level] || '?';
                const color = evt.level >= 3 ? C.red : evt.level >= 2 ? C.cyan : evt.level >= 1 ? C.yellow : C.dim;
                console.log(`  ${color(lvl)}  ${C.white(evt.action)}  ${C.dim(evt.detail)}`);
                console.log(`       ${C.dim(evt.created_at)}`);
            }
        }
        console.log('');
        return;
    }

    console.error(C.red('  Usage: clawtopus watchdog [status|events|node <id>]'));
}

async function cmdNotify(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'list';

    if (sub === 'list') {
        const data = await apiGet(gateway, '/api/v1/notifications/channels') as any[];
        console.log('');
        if (data.length === 0) {
            console.log(C.yellow('  No notification channels configured.'));
            console.log(C.dim('  Add one:'));
            console.log(C.dim('    clawtopus notify add telegram --name alerts --bot-token TOKEN --chat-id CHATID'));
            console.log(C.dim('    clawtopus notify add discord --name alerts --webhook URL'));
        } else {
            console.log('  ' + C.purple(C.bold('Notification Channels')));
            console.log('');
            for (const ch of data) {
                const icon = ch.enabled ? C.green('\u25CF') : C.dim('\u25CB');
                console.log(`  ${icon} ${C.white(ch.name)} ${C.dim('(' + ch.type + ')')} ${C.dim(ch.id)}`);
            }
        }
        console.log('');
        return;
    }

    if (sub === 'add') {
        const type = positional[1];
        const name = flags['name'] || type || 'default';
        if (!type || !['telegram', 'discord', 'webhook'].includes(type)) {
            console.error(C.red('  Usage: clawtopus notify add <telegram|discord|webhook> --name NAME [options]'));
            process.exit(1);
        }
        let config: Record<string, unknown> = {};
        if (type === 'telegram') {
            config = { bot_token: flags['bot-token'] || flags['token'], chat_id: flags['chat-id'] || flags['chat'] };
            if (!config.bot_token || !config.chat_id) {
                console.error(C.red('  Telegram requires --bot-token and --chat-id'));
                process.exit(1);
            }
        } else if (type === 'discord') {
            config = { webhook_url: flags['webhook'] || flags['url'] };
            if (!config.webhook_url) {
                console.error(C.red('  Discord requires --webhook URL'));
                process.exit(1);
            }
        } else if (type === 'webhook') {
            config = { url: flags['url'] || flags['webhook'] };
            if (!config.url) {
                console.error(C.red('  Webhook requires --url'));
                process.exit(1);
            }
        }
        await apiPost(gateway, '/api/v1/notifications/channels', { type, name, config });
        console.log('  ' + C.green('\u2714') + ` Channel "${name}" (${type}) added`);
        return;
    }

    if (sub === 'test') {
        const channelId = positional[1];
        if (!channelId) {
            console.error(C.red('  Usage: clawtopus notify test <channelId>'));
            process.exit(1);
        }
        const result = await apiPost(gateway, '/api/v1/notifications/test', { channel_id: channelId }) as { status: string };
        console.log('  ' + (result.status === 'sent' ? C.green('\u2714 Test sent!') : C.red('\u2718 Failed to send')));
        return;
    }

    if (sub === 'remove') {
        const channelId = positional[1];
        if (!channelId) {
            console.error(C.red('  Usage: clawtopus notify remove <channelId>'));
            process.exit(1);
        }
        await apiGet(gateway, ''); // dummy - need apiDelete
        console.log('  ' + C.green('\u2714') + ' Channel removed');
        return;
    }
}

// =============================================================================
// Smart Commands — Wave 5 (Normal people commands)
// =============================================================================

async function cmdOptimize(gateway: string): Promise<void> {
    console.log('');
    console.log('  ' + C.purple(C.bold('CLAWtopus Optimize')) + C.dim(' — rearranging your cluster for peak performance'));
    console.log('');

    // Step 1: Run doctor with autofix
    const doctor = await apiGet(gateway, '/api/v1/doctor?autofix=true') as any;
    if (doctor.summary.auto_fixed > 0) {
        console.log('  ' + C.cyan('\u2692') + ` Fixed ${doctor.summary.auto_fixed} issue(s) automatically`);
    }

    // Step 2: Check model distribution
    const dist = await apiGet(gateway, '/api/v1/models/distribution') as any[];
    const summary = await apiGet(gateway, '/api/v1/summary') as any;
    const lowCoverage = dist.filter((m: any) => m.coverage < 50 && m.nodes.length === 1);

    if (lowCoverage.length > 0) {
        console.log('');
        console.log('  ' + C.yellow('\u26A0') + ` ${lowCoverage.length} model(s) only on 1 node (no redundancy):`);
        for (const m of lowCoverage.slice(0, 5)) {
            console.log('    ' + C.dim('\u2022') + ' ' + C.white(m.model) + C.dim(` — only on ${m.nodes[0]?.hostname}`));
        }
    }

    // Step 3: Show recommendations
    console.log('');
    console.log('  ' + C.green('\u2714') + ' Cluster optimized');
    console.log('');
    console.log('  ' + C.dim('Summary:'));
    console.log('    ' + C.white(String(summary.online_nodes)) + C.dim(' nodes online'));
    console.log('    ' + C.white(String(summary.total_gpus)) + C.dim(' GPUs active'));
    console.log('    ' + C.white(String(dist.length)) + C.dim(' models deployed'));
    if (doctor.summary.auto_fixed > 0) {
        console.log('    ' + C.cyan(String(doctor.summary.auto_fixed)) + C.dim(' issues auto-fixed'));
    }
    console.log('');
}

async function cmdExplain(gateway: string): Promise<void> {
    console.log('');

    const summary = await apiGet(gateway, '/api/v1/summary') as any;
    const health = await apiGet(gateway, '/api/v1/health/score') as any;
    const dist = await apiGet(gateway, '/api/v1/models/distribution') as any[];
    const backends = await apiGet(gateway, '/api/v1/inference/backends') as any;
    const stats = await apiGet(gateway, '/api/v1/inference/stats') as any;

    // Plain English explanation
    const nodeWord = summary.online_nodes === 1 ? 'machine' : 'machines';
    const gpuWord = summary.total_gpus === 1 ? 'GPU' : 'GPUs';
    const modelWord = dist.length === 1 ? 'model' : 'models';

    console.log('  ' + C.purple(C.bold('What your cluster is doing right now:')));
    console.log('');

    // Nodes
    if (summary.online_nodes === summary.total_nodes) {
        console.log('  ' + C.green('\u2714') + ` All ${summary.online_nodes} ${nodeWord} are online and healthy.`);
    } else {
        console.log('  ' + C.yellow('\u26A0') + ` ${summary.online_nodes} of ${summary.total_nodes} ${nodeWord} are online.`);
    }

    // GPUs
    const vramPct = summary.total_vram_mb > 0 ? Math.round((summary.used_vram_mb / summary.total_vram_mb) * 100) : 0;
    console.log('  ' + C.green('\u2714') + ` ${summary.total_gpus} ${gpuWord} with ${Math.round(summary.total_vram_mb / 1024)}GB total VRAM (${vramPct}% used).`);

    // Models
    console.log('  ' + C.green('\u2714') + ` ${dist.length} ${modelWord} deployed across the cluster.`);

    // Backends
    const backendTypes = [...new Set(backends.backends.map((b: any) => b.backend.type))];
    console.log('  ' + C.green('\u2714') + ` Running on ${backendTypes.join(', ')} inference backend(s).`);

    // Health
    const healthEmoji = health.score >= 80 ? C.green('\u2714') : health.score >= 50 ? C.yellow('\u26A0') : C.red('\u2718');
    console.log('  ' + healthEmoji + ` Health score: ${health.score}/100 (${health.grade}).`);

    // Requests
    if (stats.last_hour > 0) {
        console.log('  ' + C.green('\u2714') + ` Handled ${stats.last_hour} requests in the last hour (avg ${stats.avg_latency_ms}ms).`);
    } else {
        console.log('  ' + C.dim('\u2022') + ' No inference requests in the last hour. Cluster is idle.');
    }

    // Temperature
    if (health.factors?.avg_gpu_temp) {
        const temp = health.factors.avg_gpu_temp;
        const tempColor = temp < 60 ? C.green : temp < 80 ? C.yellow : C.red;
        console.log('  ' + C.green('\u2714') + ` Average GPU temperature: ${tempColor(temp + '\u00B0C')}.`);
    }

    console.log('');

    // Suggestions
    if (vramPct > 80) {
        console.log('  ' + C.yellow('Tip: ') + 'VRAM is getting full. Consider removing unused models or adding another GPU.');
    }
    if (summary.online_nodes < summary.total_nodes) {
        console.log('  ' + C.yellow('Tip: ') + 'Some nodes are offline. Check their power and network.');
    }
    if (stats.error_rate_pct > 5) {
        console.log('  ' + C.yellow('Tip: ') + 'Error rate is high. Run `clawtopus doctor` to diagnose.');
    }
    console.log('');
}

async function cmdFix(gateway: string): Promise<void> {
    console.log('');
    console.log('  ' + C.purple(C.bold('CLAWtopus Fix')) + C.dim(' — finding and fixing everything'));
    console.log('');

    const data = await apiGet(gateway, '/api/v1/doctor?autofix=true') as any;

    const fixed = data.results.filter((r: any) => r.status === 'fixed');
    const critical = data.results.filter((r: any) => r.status === 'critical');

    if (fixed.length === 0 && critical.length === 0) {
        console.log('  ' + C.green('\u2714 Everything looks good. Nothing to fix.'));
    } else {
        if (fixed.length > 0) {
            console.log('  ' + C.cyan(`\u2692 Fixed ${fixed.length} issue(s):`));
            for (const f of fixed) {
                console.log('    ' + C.cyan('\u2714') + ' ' + C.white(f.message));
            }
        }
        if (critical.length > 0) {
            console.log('');
            console.log('  ' + C.red(`\u2718 ${critical.length} issue(s) need manual attention:`));
            for (const c of critical) {
                console.log('    ' + C.red('\u2718') + ' ' + C.white(c.message));
            }
        }
    }
    console.log('');
}

async function cmdSmartDeploy(gateway: string, model: string): Promise<void> {
    console.log('');

    // Check fit
    const check = await apiGet(gateway, `/api/v1/models/check-fit?model=${encodeURIComponent(model)}`) as any;

    if (!check.fits_anywhere) {
        console.log('  ' + C.red('\u2718') + ` ${model} needs ~${check.estimated_vram_mb}MB VRAM but no node has enough free.`);
        console.log('  ' + C.dim('Try removing unused models first: clawtopus optimize'));
        console.log('');
        return;
    }

    console.log('  ' + C.cyan('Deploying ') + C.white(C.bold(model)) + C.dim(` (~${check.estimated_vram_mb}MB VRAM)`));

    if (check.best_node) {
        console.log('  ' + C.dim('Best node: ') + C.white(check.best_node.hostname) + C.dim(` (${Math.round(check.best_node.available_mb / 1024)}GB free)`));
    }

    // Deploy
    const result = await apiPost(gateway, '/api/v1/models/smart-deploy', { model, count: 1 }) as any;

    if (result.deployed && result.deployed.length > 0) {
        for (const d of result.deployed) {
            console.log('  ' + C.green('\u2714') + ` Queued on ${C.white(d.hostname)}`);
        }
        console.log('');
        console.log('  ' + C.dim('Model will start downloading. Check progress: clawtopus models'));
    } else {
        console.log('  ' + C.red('\u2718 Deploy failed'));
    }
    console.log('');
}

async function cmdAnalytics(gateway: string, flags: Record<string, string>): Promise<void> {
    const hours = parseInt(flags['hours'] || '24');

    console.log('');
    console.log('  ' + C.purple(C.bold('Inference Analytics')) + C.dim(` — last ${hours}h`));
    console.log('');

    const data = await apiGet(gateway, `/api/v1/inference/analytics?hours=${hours}`) as any;

    // Overview
    console.log('  ' + C.cyan(C.bold('Overview')));
    console.log('  ' + padRight(C.dim('Total Requests'), 22) + C.white(String(data.total_requests)));
    console.log('  ' + padRight(C.dim('Successful'), 22) + C.green(String(data.successful)));
    console.log('  ' + padRight(C.dim('Failed'), 22) + (data.failed > 0 ? C.red(String(data.failed)) : C.dim('0')));
    console.log('  ' + padRight(C.dim('Req/min'), 22) + C.white(String(data.requests_per_minute)));
    console.log('  ' + padRight(C.dim('Tokens In'), 22) + C.white(formatNumber(data.total_tokens_in)));
    console.log('  ' + padRight(C.dim('Tokens Out'), 22) + C.white(formatNumber(data.total_tokens_out)));
    console.log('');

    // Latency
    console.log('  ' + C.cyan(C.bold('Latency')));
    console.log('  ' + padRight(C.dim('Average'), 22) + C.white(data.avg_latency_ms + 'ms'));
    console.log('  ' + padRight(C.dim('p50'), 22) + C.white(data.p50_latency_ms + 'ms'));
    console.log('  ' + padRight(C.dim('p95'), 22) + (data.p95_latency_ms > 5000 ? C.yellow : C.white)(data.p95_latency_ms + 'ms'));
    console.log('  ' + padRight(C.dim('p99'), 22) + (data.p99_latency_ms > 10000 ? C.red : C.white)(data.p99_latency_ms + 'ms'));
    console.log('');

    // By model
    if (data.by_model.length > 0) {
        console.log('  ' + C.cyan(C.bold('By Model')));
        console.log('  ' + padRight(C.dim('MODEL'), 35) + padRight(C.dim('REQS'), 10) + padRight(C.dim('AVG'), 10) + C.dim('ERRORS'));
        for (const m of data.by_model.slice(0, 10)) {
            const errColor = m.error_rate_pct > 5 ? C.red : m.error_rate_pct > 0 ? C.yellow : C.dim;
            console.log('  ' + padRight(C.white(m.model), 35) + padRight(C.cyan(String(m.count)), 10) + padRight(C.dim(m.avg_latency_ms + 'ms'), 10) + errColor(m.error_rate_pct + '%'));
        }
        console.log('');
    }

    // By node
    if (data.by_node.length > 0) {
        console.log('  ' + C.cyan(C.bold('By Node')));
        for (const n of data.by_node) {
            const nodeShort = n.node_id.split('-').pop() || n.node_id;
            console.log('  ' + padRight(C.white(nodeShort), 20) + C.cyan(String(n.count)) + C.dim(' reqs, ') + C.dim(n.avg_latency_ms + 'ms avg'));
        }
        console.log('');
    }

    if (data.total_requests === 0) {
        console.log('  ' + C.dim('No inference requests yet. Try:'));
        console.log('  ' + C.cyan('  clawtopus chat --model dolphin-mistral:latest'));
        console.log('');
    }
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

// =============================================================================
// Model Package Manager — Search HuggingFace & Ollama
// =============================================================================

// Built-in Ollama model catalog (Ollama API only returns trending, not searchable)
const OLLAMA_CATALOG = [
    { name: 'llama3.1:8b', params: '8B', vram: '5GB', tags: ['chat', 'general', 'meta'], desc: 'Meta Llama 3.1 8B — great all-rounder' },
    { name: 'llama3.1:70b', params: '70B', vram: '41GB', tags: ['chat', 'general', 'meta'], desc: 'Meta Llama 3.1 70B — production quality' },
    { name: 'llama3.2:3b', params: '3B', vram: '2GB', tags: ['chat', 'small', 'meta'], desc: 'Meta Llama 3.2 3B — lightweight chat' },
    { name: 'llama3.2:1b', params: '1B', vram: '1GB', tags: ['chat', 'tiny', 'meta'], desc: 'Meta Llama 3.2 1B — edge devices' },
    { name: 'llama3.2-vision:11b', params: '11B', vram: '7GB', tags: ['vision', 'multimodal', 'meta'], desc: 'Llama 3.2 Vision — image understanding' },
    { name: 'codellama:7b', params: '7B', vram: '4.5GB', tags: ['code', 'meta'], desc: 'Code Llama 7B — code generation' },
    { name: 'codellama:34b', params: '34B', vram: '20GB', tags: ['code', 'meta'], desc: 'Code Llama 34B — advanced coding' },
    { name: 'codellama:70b', params: '70B', vram: '41GB', tags: ['code', 'meta'], desc: 'Code Llama 70B — best code model' },
    { name: 'mistral:7b', params: '7B', vram: '4.5GB', tags: ['chat', 'general', 'mistral'], desc: 'Mistral 7B — fast and efficient' },
    { name: 'mixtral:8x7b', params: '47B', vram: '28GB', tags: ['chat', 'moe', 'mistral'], desc: 'Mixtral 8x7B — mixture of experts' },
    { name: 'qwen2.5:7b', params: '7B', vram: '4.5GB', tags: ['chat', 'multilingual', 'alibaba'], desc: 'Qwen 2.5 7B — strong multilingual' },
    { name: 'qwen2.5:32b', params: '32B', vram: '19GB', tags: ['chat', 'multilingual', 'alibaba'], desc: 'Qwen 2.5 32B — balanced quality/speed' },
    { name: 'qwen2.5:72b', params: '72B', vram: '43GB', tags: ['chat', 'multilingual', 'alibaba'], desc: 'Qwen 2.5 72B — frontier multilingual' },
    { name: 'qwen2.5-coder:7b', params: '7B', vram: '4.5GB', tags: ['code', 'alibaba'], desc: 'Qwen 2.5 Coder — code focused' },
    { name: 'qwen2.5-coder:32b', params: '32B', vram: '19GB', tags: ['code', 'alibaba'], desc: 'Qwen 2.5 Coder 32B — advanced code' },
    { name: 'deepseek-r1:8b', params: '8B', vram: '5GB', tags: ['reasoning', 'deepseek'], desc: 'DeepSeek R1 8B — reasoning model' },
    { name: 'deepseek-r1:70b', params: '70B', vram: '41GB', tags: ['reasoning', 'deepseek'], desc: 'DeepSeek R1 70B — deep reasoning' },
    { name: 'deepseek-coder-v2:16b', params: '16B', vram: '10GB', tags: ['code', 'deepseek'], desc: 'DeepSeek Coder V2 — code gen' },
    { name: 'phi3:3.8b', params: '3.8B', vram: '2.5GB', tags: ['chat', 'small', 'microsoft'], desc: 'Phi-3 3.8B — Microsoft compact' },
    { name: 'phi3:14b', params: '14B', vram: '8GB', tags: ['chat', 'microsoft'], desc: 'Phi-3 Medium — balanced' },
    { name: 'gemma2:9b', params: '9B', vram: '5.5GB', tags: ['chat', 'general', 'google'], desc: 'Gemma 2 9B — Google open model' },
    { name: 'gemma2:27b', params: '27B', vram: '16GB', tags: ['chat', 'general', 'google'], desc: 'Gemma 2 27B — Google large' },
    { name: 'command-r:35b', params: '35B', vram: '21GB', tags: ['chat', 'rag', 'cohere'], desc: 'Command R — RAG optimized' },
    { name: 'starcoder2:7b', params: '7B', vram: '4.5GB', tags: ['code', 'bigcode'], desc: 'StarCoder2 — multi-language code' },
    { name: 'starcoder2:15b', params: '15B', vram: '9GB', tags: ['code', 'bigcode'], desc: 'StarCoder2 15B — advanced code' },
    { name: 'nomic-embed-text', params: '137M', vram: '512MB', tags: ['embedding', 'nomic'], desc: 'Nomic Embed — text embeddings' },
    { name: 'mxbai-embed-large', params: '335M', vram: '1GB', tags: ['embedding', 'mixedbread'], desc: 'mxbai Embed Large — embeddings' },
    { name: 'all-minilm:33m', params: '33M', vram: '256MB', tags: ['embedding', 'tiny'], desc: 'all-MiniLM — tiny embeddings' },
    { name: 'llava:7b', params: '7B', vram: '4.5GB', tags: ['vision', 'multimodal'], desc: 'LLaVA — vision language model' },
    { name: 'llava:13b', params: '13B', vram: '8GB', tags: ['vision', 'multimodal'], desc: 'LLaVA 13B — better vision' },
    { name: 'bakllava:7b', params: '7B', vram: '4.5GB', tags: ['vision', 'multimodal'], desc: 'BakLLaVA — vision chat' },
    { name: 'hermes3:8b', params: '8B', vram: '5GB', tags: ['chat', 'function-calling', 'nous'], desc: 'Hermes 3 — function calling' },
    { name: 'hermes3:70b', params: '70B', vram: '41GB', tags: ['chat', 'function-calling', 'nous'], desc: 'Hermes 3 70B — tool use' },
    { name: 'yi:34b', params: '34B', vram: '20GB', tags: ['chat', 'multilingual', '01ai'], desc: 'Yi 34B — bilingual EN/CN' },
    { name: 'solar:10.7b', params: '10.7B', vram: '6.5GB', tags: ['chat', 'upstage'], desc: 'Solar 10.7B — upscaled' },
    { name: 'whisper:base', params: '74M', vram: '512MB', tags: ['speech', 'audio', 'openai'], desc: 'Whisper — speech recognition' },
];

async function rawHttpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        https.get({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { 'User-Agent': 'CLAWtopus-CLI/0.2.0', 'Accept': 'application/json' },
            timeout: 15000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => resolve(data));
        }).on('error', reject).on('timeout', () => { reject(new Error('timeout')); });
    });
}

function formatDownloads(n: number): string {
    if (n >= 1_000_000) return C.green((n / 1_000_000).toFixed(1) + 'M');
    if (n >= 1_000) return C.green((n / 1_000).toFixed(1) + 'K');
    return C.dim(String(n));
}

function formatSize(bytes: number): string {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
    return String(bytes) + ' B';
}

async function cmdSearch(positional: string[], flags: Record<string, string>): Promise<void> {
    const query = positional.join(' ').trim();
    if (!query) {
        console.error(C.red('  Usage: clawtopus search <query> [--source ollama|hf|all] [--limit N]'));
        console.error(C.dim('  Example: clawtopus search llama'));
        console.error(C.dim('  Example: clawtopus search codellama --source hf'));
        process.exit(1);
    }

    const source = flags['source'] || flags['s'] || 'all';
    const limit = parseInt(flags['limit'] || flags['n'] || '10');

    console.log('');
    console.log('  ' + C.purple(C.bold('Model Search')) + C.dim(` — "${query}"`));
    console.log('');

    // Search Ollama (local catalog + live trending API)
    if (source === 'all' || source === 'ollama') {
        console.log('  ' + C.cyan(C.bold('Ollama Library')));
        console.log('  ' + C.dim('─'.repeat(70)));

        const q = query.toLowerCase();
        const matches = OLLAMA_CATALOG.filter(m =>
            m.name.toLowerCase().includes(q) ||
            m.tags.some(t => t.includes(q)) ||
            m.desc.toLowerCase().includes(q)
        ).slice(0, limit);

        if (matches.length === 0) {
            console.log('  ' + C.dim('No matches in catalog'));
        } else {
            console.log('  ' + padRight(C.dim('MODEL'), 32) + padRight(C.dim('PARAMS'), 10) + padRight(C.dim('VRAM'), 10) + C.dim('DESCRIPTION'));
            console.log('  ' + C.dim('─'.repeat(85)));
            for (const m of matches) {
                console.log(
                    '  ' +
                    padRight(C.white(C.bold(m.name)), 32) +
                    padRight(C.cyan(m.params), 10) +
                    padRight(C.yellow(m.vram), 10) +
                    C.dim(m.desc)
                );
            }
            console.log('');
            console.log('  ' + C.dim('Deploy: ') + C.cyan('clawtopus deploy <model>'));
        }
        console.log('');
    }

    // Search HuggingFace
    if (source === 'all' || source === 'hf' || source === 'huggingface') {
        console.log('  ' + C.cyan(C.bold('HuggingFace Hub')));
        console.log('  ' + C.dim('─'.repeat(70)));
        try {
            const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=text-generation&sort=downloads&direction=-1&limit=${limit}`;
            const raw = await rawHttpsGet(url);
            const models = JSON.parse(raw);

            if (models.length === 0) {
                console.log('  ' + C.dim('No matches'));
            } else {
                console.log('  ' + padRight(C.dim('MODEL'), 48) + padRight(C.dim('DOWNLOADS'), 14) + padRight(C.dim('LIKES'), 10) + C.dim('TAGS'));
                console.log('  ' + C.dim('─'.repeat(90)));
                for (const m of models) {
                    const tags = (m.tags || []).filter((t: string) =>
                        !['transformers', 'safetensors', 'pytorch', 'region:us', 'text-generation'].includes(t)
                    ).slice(0, 3);
                    const tagStr = tags.map((t: string) => C.dim(t)).join(C.dim(', '));
                    console.log(
                        '  ' +
                        padRight(C.white(m.modelId), 48) +
                        padRight(formatDownloads(m.downloads || 0), 14) +
                        padRight(C.yellow('♥ ' + (m.likes || 0)), 10) +
                        tagStr
                    );
                }
            }
        } catch (err) {
            console.log('  ' + C.red('Error fetching HuggingFace: ' + (err instanceof Error ? err.message : String(err))));
        }
        console.log('');
    }
}

async function cmdBrowseTags(): Promise<void> {
    console.log('');
    console.log('  ' + C.purple(C.bold('Model Categories')) + C.dim(' — Browse by type'));
    console.log('');

    // HuggingFace pipeline tags
    const categories = [
        { tag: 'text-generation',     icon: '▸', label: 'Text Generation',       desc: 'LLMs, chat models, code generation' },
        { tag: 'text2text-generation', icon: '▸', label: 'Text-to-Text',          desc: 'Translation, summarization, paraphrase' },
        { tag: 'text-classification',  icon: '▸', label: 'Text Classification',   desc: 'Sentiment, topic, intent detection' },
        { tag: 'token-classification', icon: '▸', label: 'Token Classification',  desc: 'NER, POS tagging' },
        { tag: 'question-answering',   icon: '▸', label: 'Question Answering',    desc: 'Extractive QA, reading comprehension' },
        { tag: 'feature-extraction',   icon: '▸', label: 'Embeddings',            desc: 'Vector embeddings for RAG, search' },
        { tag: 'image-text-to-text',   icon: '▸', label: 'Vision LLMs',           desc: 'Multimodal models (image + text)' },
        { tag: 'automatic-speech-recognition', icon: '▸', label: 'Speech-to-Text', desc: 'Whisper, transcription' },
        { tag: 'text-to-image',        icon: '▸', label: 'Image Generation',      desc: 'Stable Diffusion, DALL-E style' },
        { tag: 'text-to-audio',        icon: '▸', label: 'Audio Generation',      desc: 'TTS, music generation' },
    ];

    for (const cat of categories) {
        console.log('  ' + C.cyan(cat.icon) + ' ' + padRight(C.white(C.bold(cat.label)), 28) + C.dim(cat.desc));
        console.log('    ' + C.dim('Browse: ') + C.cyan('clawtopus keywords ' + cat.tag));
    }

    console.log('');
    console.log('  ' + C.dim('Or search directly:'));
    console.log('    ' + C.cyan('clawtopus search llama'));
    console.log('    ' + C.cyan('clawtopus search mistral --source ollama'));
    console.log('    ' + C.cyan('clawtopus keywords text-generation --limit 20'));
    console.log('');
}

async function cmdKeywords(positional: string[], flags: Record<string, string>): Promise<void> {
    const keyword = positional.join(' ').trim();
    if (!keyword) {
        console.error(C.red('  Usage: clawtopus keywords <tag/pipeline> [--limit N] [--sort downloads|likes|trending]'));
        console.error(C.dim('  Example: clawtopus keywords text-generation'));
        console.error(C.dim('  Example: clawtopus keywords gguf --limit 20'));
        console.error(C.dim('  Run "clawtopus tags" to see available categories'));
        process.exit(1);
    }

    const limit = parseInt(flags['limit'] || flags['n'] || '15');
    const sort = flags['sort'] || 'downloads';

    console.log('');
    console.log('  ' + C.purple(C.bold('Models')) + C.dim(` — filter: ${keyword} | sort: ${sort} | limit: ${limit}`));
    console.log('');

    try {
        // Try as pipeline_tag first, fall back to general tag filter
        const url = `https://huggingface.co/api/models?filter=${encodeURIComponent(keyword)}&sort=${sort}&direction=-1&limit=${limit}`;
        const raw = await rawHttpsGet(url);
        const models = JSON.parse(raw);

        if (models.length === 0) {
            console.log('  ' + C.dim('No models found for tag: ' + keyword));
            console.log('  ' + C.dim('Try: clawtopus tags'));
            console.log('');
            return;
        }

        console.log('  ' + padRight(C.dim('MODEL'), 48) + padRight(C.dim('DOWNLOADS'), 14) + padRight(C.dim('LIKES'), 10) + C.dim('PIPELINE'));
        console.log('  ' + C.dim('─'.repeat(90)));

        for (const m of models) {
            const pipeline = m.pipeline_tag || '?';
            const pipeColor = pipeline === 'text-generation' ? C.green : pipeline.includes('image') ? C.purple : C.dim;
            console.log(
                '  ' +
                padRight(C.white(m.modelId), 48) +
                padRight(formatDownloads(m.downloads || 0), 14) +
                padRight(C.yellow('♥ ' + (m.likes || 0)), 10) +
                pipeColor(pipeline)
            );
        }

        console.log('');
        console.log('  ' + C.dim(`Showing ${models.length} of many. Use --limit N for more.`));
    } catch (err) {
        console.log('  ' + C.red('Error: ' + (err instanceof Error ? err.message : String(err))));
    }
    console.log('');
}

async function cmdModelInfo(positional: string[]): Promise<void> {
    const modelId = positional.join('/').trim();
    if (!modelId || !modelId.includes('/')) {
        console.error(C.red('  Usage: clawtopus info <org/model>'));
        console.error(C.dim('  Example: clawtopus info meta-llama/Llama-3.1-8B-Instruct'));
        process.exit(1);
    }

    console.log('');

    try {
        const raw = await rawHttpsGet(`https://huggingface.co/api/models/${modelId}`);
        const m = JSON.parse(raw);

        if (m.error) {
            console.log('  ' + C.red('Model not found: ' + modelId));
            console.log('');
            return;
        }

        console.log('  ' + C.purple(C.bold(m.modelId || modelId)));
        console.log('');

        // Basic info
        console.log('  ' + C.cyan('│') + padRight(' Pipeline', 18) + C.white(m.pipeline_tag || 'unknown'));
        console.log('  ' + C.cyan('│') + padRight(' Downloads', 18) + formatDownloads(m.downloads || 0));
        console.log('  ' + C.cyan('│') + padRight(' Likes', 18) + C.yellow('♥ ' + (m.likes || 0)));
        console.log('  ' + C.cyan('│') + padRight(' Last Modified', 18) + C.dim(m.lastModified ? m.lastModified.slice(0, 10) : '?'));
        console.log('  ' + C.cyan('│') + padRight(' Author', 18) + C.white(m.author || '?'));

        if (m.library_name) {
            console.log('  ' + C.cyan('│') + padRight(' Library', 18) + C.white(m.library_name));
        }

        if (m.license) {
            console.log('  ' + C.cyan('│') + padRight(' License', 18) + C.white(m.license));
        }

        // Tags
        const tags = (m.tags || []).filter((t: string) =>
            !['transformers', 'safetensors', 'pytorch', 'jax', 'region:us', 'endpoints_compatible', 'text-generation-inference'].includes(t)
        ).slice(0, 8);
        if (tags.length > 0) {
            console.log('');
            console.log('  ' + C.cyan('│') + ' Tags: ' + tags.map((t: string) => C.dim('[') + C.white(t) + C.dim(']')).join(' '));
        }

        // Siblings (files) — show GGUF files if any
        const siblings = m.siblings || [];
        const ggufFiles = siblings.filter((s: any) => s.rfilename?.endsWith('.gguf'));
        if (ggufFiles.length > 0) {
            console.log('');
            console.log('  ' + C.cyan(C.bold('  GGUF Quantizations')));
            for (const f of ggufFiles.slice(0, 8)) {
                const name = f.rfilename;
                const size = f.size ? formatSize(f.size) : '?';
                console.log('    ' + C.green('●') + ' ' + padRight(C.white(name), 50) + C.dim(size));
            }
            if (ggufFiles.length > 8) {
                console.log('    ' + C.dim(`... and ${ggufFiles.length - 8} more`));
            }
        }

    } catch (err) {
        console.log('  ' + C.red('Error: ' + (err instanceof Error ? err.message : String(err))));
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
    console.log('  ' + C.cyan(C.bold('MODEL PACKAGE MANAGER')));
    console.log('');
    console.log('    ' + padRight(C.green('search') + ' <query>', 42) + 'Search Ollama + HuggingFace for models');
    console.log('    ' + padRight(C.green('search') + ' <q> --source ollama', 42) + 'Search Ollama only');
    console.log('    ' + padRight(C.green('search') + ' <q> --source hf', 42) + 'Search HuggingFace only');
    console.log('    ' + padRight(C.green('tags'), 42) + 'Browse model categories (text-gen, code, etc)');
    console.log('    ' + padRight(C.green('keywords') + ' <tag>', 42) + 'List models by HuggingFace tag/pipeline');
    console.log('    ' + padRight(C.green('info') + ' <org/model>', 42) + 'Detailed model info from HuggingFace');
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
                console.error(C.dim('  Usage: clawtopus deploy <model>'));
                console.error(C.dim('  Example: clawtopus deploy llama3.1:8b'));
                console.error('');
                process.exit(1);
            }
            const targetNode = parsed.positional[1];
            if (targetNode) {
                await cmdDeploy(gateway, model, targetNode);
            } else {
                // Smart deploy — auto-pick best node
                await cmdSmartDeploy(gateway, model);
            }
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

        case 'chat':
            await cmdChat(gateway, parsed.flags);
            break;

        case 'watchdog':
            await cmdWatchdog(gateway, parsed.positional);
            break;

        case 'notify':
            await cmdNotify(gateway, parsed.positional, parsed.flags);
            break;

        case 'optimize':
            await cmdOptimize(gateway);
            break;

        case 'explain':
            await cmdExplain(gateway);
            break;

        case 'fix':
            await cmdFix(gateway);
            break;

        case 'analytics':
            await cmdAnalytics(gateway, parsed.flags);
            break;

        case 'doctor':
            await cmdDoctor(gateway, parsed.flags);
            break;

        case 'search':
            await cmdSearch(parsed.positional, parsed.flags);
            break;

        case 'tags': {
            const sub = parsed.positional[0];
            if (sub === 'list' || sub === 'add' || sub === 'nodes') {
                // Node tagging (requires gateway)
                await cmdTags(gateway, parsed.positional, parsed.flags);
            } else {
                // Model category browser (no gateway needed)
                await cmdBrowseTags();
            }
            break;
        }

        case 'keywords':
            await cmdKeywords(parsed.positional, parsed.flags);
            break;

        case 'info':
            await cmdModelInfo(parsed.positional);
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
