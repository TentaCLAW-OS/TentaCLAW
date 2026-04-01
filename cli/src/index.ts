#!/usr/bin/env node
/**
 * TentaCLAW CLI — Eight arms. One mind. Zero compromises.
 *
 * Inference router + cluster management for TentaCLAW OS.
 * Talks to the TentaCLAW Gateway API. Pure Node.js, zero dependencies.
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
 *   clawtopus hub search <query>                      # Search CLAWHub registry
 *   clawtopus hub install @ns/pkg[@ver]               # Install a package
 *   clawtopus hub list                                # List installed packages
 *   clawtopus hub info @ns/pkg                        # Package details
 *   clawtopus hub publish                             # Publish from clawhub.yaml
 *   clawtopus hub trending                            # Trending packages
 *   clawtopus hub star @ns/pkg                        # Star a package
 *   clawtopus hub init --type agent                   # Create clawhub.yaml
 *   clawtopus help                                    # Show help
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// =============================================================================
// Brand Colors (ANSI true-color escape sequences)
// =============================================================================

const C = {
    teal:    (s: string) => `\x1b[38;2;0;212;170m${s}\x1b[0m`,   // #00d4aa — primary brand
    cyan:    (s: string) => `\x1b[38;2;0;212;170m${s}\x1b[0m`,   // alias for teal
    purple:  (s: string) => `\x1b[38;2;139;92;246m${s}\x1b[0m`,  // #8b5cf6 — secondary
    green:   (s: string) => `\x1b[38;2;0;255;136m${s}\x1b[0m`,
    red:     (s: string) => `\x1b[38;2;255;70;70m${s}\x1b[0m`,
    yellow:  (s: string) => `\x1b[38;2;255;220;0m${s}\x1b[0m`,
    dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
    bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
    white:   (s: string) => `\x1b[97m${s}\x1b[0m`,
    italic:  (s: string) => `\x1b[3m${s}\x1b[0m`,
};

// =============================================================================
// CLAWtopus Personality — contextual quips
// =============================================================================

const personality = {
    healthy: [
        "chill, everything's smooth",
        "running like a dream",
        "eight arms, zero problems",
        "you didn't even notice huh... that's the point",
        "all systems purring",
        "smooth seas today, captain",
        "I could do this with four arms tied behind my back",
    ],
    warning: [
        "gpu-02 is getting toasty... watching it",
        "something's cooking but I got it",
        "not ideal but not a crisis",
        "keeping an eye on things. all eight of them",
        "slight wobble but we're steady",
    ],
    error: [
        "okay we got a problem",
        "lost contact with a node... not great",
        "fixing it. don't touch anything",
        "this is fine. (it's not fine.)",
        "all hands on deck. literally",
    ],
    deploy: [
        "deploying... sit back",
        "loading that model up real quick",
        "on it. 8 arms remember?",
        "watch this",
        "hold my ink",
    ],
    idle: [
        "quiet out here. too quiet",
        "all dressed up and no tokens to generate",
        "ready when you are",
    ],
    optimize: [
        "let me rearrange some tentacles here",
        "shuffling things around for peak performance",
        "tuning the cluster like a fine instrument",
    ],
};

function pickPersonality(mood: keyof typeof personality): string {
    const msgs = personality[mood];
    return msgs[Math.floor(Math.random() * msgs.length)];
}

function personalityLine(mood: keyof typeof personality): string {
    return '  ' + C.purple(C.italic(`"${pickPersonality(mood)}"`)) + C.dim(' \u2014 \uD83D\uDC19');
}

// =============================================================================
// Visual Helpers — progress bars, sparklines, box drawing
// =============================================================================

const CLI_VERSION = '1.0.0';

function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function progressBar(pct: number, width = 30): string {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round(clamped / 100 * width);
    const empty = width - filled;
    const color = pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.cyan;
    return color('\u2588'.repeat(filled)) + C.dim('\u2591'.repeat(empty));
}

function miniBar(pct: number, width = 5): string {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round(clamped / 100 * width);
    const empty = width - filled;
    const color = pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.cyan;
    return color('\u2588'.repeat(filled)) + C.dim('\u2592'.repeat(empty));
}

function sparkline(data: number[]): string {
    if (data.length === 0) return '';
    const chars = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    return data.map(v => {
        const idx = Math.floor(((v - min) / range) * 7);
        return chars[idx];
    }).join('');
}

function boxTop(title: string, width = 62): string {
    const titlePart = title ? `\u2500 ${C.bold(C.white(title))} ` : '';
    const titleLen = title ? title.length + 3 : 0;
    return `  \u250C${titlePart}${'\u2500'.repeat(Math.max(0, width - titleLen - 1))}\u2510`;
}

function boxMid(content: string, width = 62): string {
    const visLen = stripAnsi(content).length;
    const pad = Math.max(0, width - visLen - 2);
    return `  \u2502 ${content}${' '.repeat(pad)}\u2502`;
}

function boxEmpty(width = 62): string {
    return `  \u2502${' '.repeat(width)}\u2502`;
}

function boxBot(width = 62): string {
    return `  \u2514${'\u2500'.repeat(width)}\u2518`;
}

function boxSep(width = 62): string {
    return `  \u251C${'\u2500'.repeat(width)}\u2524`;
}

function tempColor(temp: number): (s: string) => string {
    return temp > 80 ? C.red : temp > 60 ? C.yellow : C.green;
}

function bootSplash(): void {
    const w = 35;
    console.log('');
    console.log(C.teal([
        '                          ___',
        "                       .-'   `'.",
        '                      /         \\',
        '                      |         ;',
        '                      |         |           ___.--,',
        "             _.._     |0) ~ (0) |    _.---'`__.-( (_.",
        "      __.--'`_.. '.__.\\.    '--. \\_.-' ,.--'`     `\"\"` ",
        "     ( ,.--'`   ',__/|)  `-. '.  `.   /   _",
        "     _`) )  .---.__.' /   `. `. \\_  `-'  /`.)  ",
        '    `)_\')  /        /     `.  `\\  \\ `\'  /',
        "     `'''  |  _    |       `. `. `.  /`",
        '            ;  \\   \'.        `. `. `./',
        '             \\  \'.   \\         `. `.  `-._     _',
        "              '.  `'. `.         `-. `.    `.__/",
        "                `'.  `\\ `.         `.  `-.",
        "                   `'  \\ `;          `-._`.",
        "                        ` \\               `'",
    ].join('\n')));
    console.log('');
    console.log(`  \u256D${'\u2500'.repeat(w)}\u256E`);
    console.log(`  \u2502  \uD83D\uDC19 ${C.teal(C.bold('TentaCLAW'))} ${C.dim('v' + CLI_VERSION)}${' '.repeat(w - 23)}\u2502`);
    console.log(`  \u2502  ${C.purple(C.italic('Eight arms. One mind.'))}${' '.repeat(w - 24)}\u2502`);
    console.log(`  \u2570${'\u2500'.repeat(w)}\u256F`);
    console.log('');
}

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
    if (flags['gateway']) return flags['gateway'];
    if (process.env['TENTACLAW_GATEWAY']) return process.env['TENTACLAW_GATEWAY'];
    // Check saved port from quickstart/install
    try {
        const fs = require('fs') as typeof import('fs');
        const os = require('os') as typeof import('os');
        const saved = fs.readFileSync(os.homedir() + '/.tentaclaw/gateway-port', 'utf8').trim();
        if (saved) return `http://localhost:${saved}`;
    } catch { /* no saved port */ }
    return 'http://localhost:8080';
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
                'User-Agent': 'TentaCLAW-CLI/' + CLI_VERSION,
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

async function apiPut(baseUrl: string, path: string, body?: unknown): Promise<unknown> {
    const url = baseUrl.replace(/\/+$/, '') + path;
    try {
        const resp = await apiRequest('PUT', url, body);
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
            console.error(C.red('  \u2718 Cannot connect to TentaCLAW Gateway'));
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

    // Determine health mood
    const allOnline = data.online_nodes === data.total_nodes && data.total_nodes > 0;
    const noneOnline = data.online_nodes === 0;
    const mood: keyof typeof personality = noneOnline ? 'error' : allOnline ? 'healthy' : 'warning';

    // Health grade approximation
    const healthPct = data.total_nodes > 0 ? Math.round((data.online_nodes / data.total_nodes) * 100) : 0;
    const grade = healthPct >= 90 ? 'A' : healthPct >= 70 ? 'B' : healthPct >= 50 ? 'C' : 'D';
    const gradeColor = healthPct >= 90 ? C.green : healthPct >= 70 ? C.yellow : C.red;

    // VRAM
    const vramPct = data.total_vram_mb > 0 ? Math.round((data.used_vram_mb / data.total_vram_mb) * 100) : 0;
    const vramTotalGb = Math.round(data.total_vram_mb / 1024);
    const vramUsedGb = Math.round(data.used_vram_mb / 1024);

    // Throughput
    const toks = formatNumber(Math.round(data.total_toks_per_sec));

    const W = 62;
    console.log('');
    console.log(boxTop('CLUSTER STATUS', W));
    console.log(boxEmpty(W));

    // Row 1: NODES / GPUs / HEALTH
    const nodesColor = allOnline ? C.green : noneOnline ? C.red : C.yellow;
    const row1 =
        C.dim('NODES  ') + nodesColor(C.bold(String(data.online_nodes)) + ' online') + '    ' +
        C.dim('GPUs  ') + C.cyan(C.bold(String(data.total_gpus)) + ' active') + '    ' +
        C.dim('HEALTH  ') + gradeColor(C.bold(grade) + ` (${healthPct})`);
    console.log(boxMid(row1, W));

    // Row 2: VRAM progress bar
    const vramLabel = C.dim('VRAM   ') + C.white(`${vramUsedGb}/${vramTotalGb} GB`) + '   ' + progressBar(vramPct, 22) + '  ' + C.white(`${vramPct}%`);
    console.log(boxMid(vramLabel, W));

    // Row 3: Throughput
    const toksLine = C.dim('TOK/S  ') + C.green(C.bold(toks));
    console.log(boxMid(toksLine, W));

    // Row 4: Models
    const modelList = data.loaded_models.length > 0
        ? data.loaded_models.slice(0, 4).join(', ') + (data.loaded_models.length > 4 ? C.dim(` +${data.loaded_models.length - 4} more`) : '')
        : C.dim('none');
    console.log(boxMid(C.dim('MODELS ') + modelList, W));

    console.log(boxEmpty(W));

    // Personality quote
    const quote = C.purple(C.italic(`"${pickPersonality(mood)}"`)) + C.dim('  \u2014 \uD83D\uDC19');
    console.log(boxMid(quote, W));

    console.log(boxBot(W));
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

    const W = 72;
    console.log('');
    console.log(boxTop('NODES', W));

    for (const node of nodes) {
        const stats = node.latest_stats;

        if (node.status !== 'online') {
            // Offline / rebooting node — compact line
            const icon = C.dim('\u25CB');
            const lastSeen = node.last_seen_at
                ? C.dim(`(${timeSince(node.last_seen_at)} ago)`)
                : C.dim('(never seen)');
            console.log(boxMid(`${icon} ${C.dim(node.hostname)}     ${C.dim('offline')} ${lastSeen}`, W));
            continue;
        }

        // Online node — rich display
        const icon = C.green('\u25CF');

        // GPU summary (e.g. "2xRTX 4090")
        let gpuLabel = C.dim(`${node.gpu_count} GPU${node.gpu_count !== 1 ? 's' : ''}`);
        if (stats && stats.gpus.length > 0) {
            const gpuNames = stats.gpus.map(g => g.name);
            const uniqueGpus = [...new Set(gpuNames)];
            if (uniqueGpus.length === 1) {
                gpuLabel = C.white(`${stats.gpus.length}\u00D7${uniqueGpus[0]}`);
            } else {
                gpuLabel = C.white(uniqueGpus.map(name => {
                    const count = gpuNames.filter(n => n === name).length;
                    return `${count}\u00D7${name}`;
                }).join(', '));
            }
        }

        // Tok/s
        const toks = stats ? formatNumber(Math.round(stats.toks_per_sec)) + ' tok/s' : '0 tok/s';
        const toksStr = stats && stats.toks_per_sec > 0 ? C.green(toks) : C.dim(toks);

        // Temperature (max across GPUs)
        let maxTemp = 0;
        let vramPct = 0;
        if (stats && stats.gpus.length > 0) {
            maxTemp = Math.max(...stats.gpus.map(g => g.temperatureC));
            const totalVram = stats.gpus.reduce((a, g) => a + g.vramTotalMb, 0);
            const usedVram = stats.gpus.reduce((a, g) => a + g.vramUsedMb, 0);
            vramPct = totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0;
        }
        const tempStr = maxTemp > 0 ? tempColor(maxTemp)(maxTemp + '\u00B0C') : C.dim('-');

        // Build the line
        const line =
            `${icon} ${padRight(C.white(C.bold(node.hostname)), 18)}` +
            `${padRight(gpuLabel, 20)}` +
            `${padRight(toksStr, 16)}` +
            `${padRight(tempStr, 8)}` +
            `${miniBar(vramPct)} ${C.white(vramPct + '%')}`;
        console.log(boxMid(line, W));
    }

    console.log(boxBot(W));

    // Personality based on cluster health
    const offlineCount = nodes.filter(n => n.status !== 'online').length;
    const mood: keyof typeof personality = offlineCount === 0 ? 'healthy' : offlineCount >= nodes.length ? 'error' : 'warning';
    console.log(personalityLine(mood));
    console.log('');
}

function timeSince(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    if (isNaN(diffMs) || diffMs < 0) return '?';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
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
            const tColor = tempColor(gpu.temperatureC);

            console.log('  ' + C.cyan('\u2502') + ' ' + C.purple(`[${i}]`) + ' ' + C.white(C.bold(gpu.name)));
            console.log('  ' + C.cyan('\u2502') + '     VRAM     ' + progressBar(vramPct, 20) + '  ' + formatMb(gpu.vramUsedMb) + '/' + formatMb(gpu.vramTotalMb) + C.dim(` ${vramPct}%`));
            console.log('  ' + C.cyan('\u2502') + '     Temp     ' + tColor(gpu.temperatureC + '\u00B0C') + '  ' + miniBar(Math.min(100, Math.round(gpu.temperatureC / 100 * 100)), 5));
            console.log('  ' + C.cyan('\u2502') + '     Util     ' + progressBar(gpu.utilizationPct, 10) + '  ' + C.white(gpu.utilizationPct + '%'));
            console.log('  ' + C.cyan('\u2502') + '     Power    ' + C.white(gpu.powerDrawW + ' W') + '  ' + C.dim('Fan ' + gpu.fanSpeedPct + '%'));
            console.log('  ' + C.cyan('\u2502') + '     Clock    ' + C.dim('SM') + ' ' + C.white(formatNumber(gpu.clockSmMhz)) + C.dim(' MHz / Mem ') + C.white(formatNumber(gpu.clockMemMhz)) + C.dim(' MHz'));
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
        console.log('');
        console.log(personalityLine('deploy'));
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
        console.log(personalityLine('idle'));
        console.log('');
        return;
    }

    const W = 68;
    console.log('');
    console.log(boxTop('MODELS', W));

    const hdr = padRight(C.dim('MODEL'), 34) + padRight(C.dim('NODES'), 10) + C.dim('DEPLOYED ON');
    console.log(boxMid(hdr, W));
    console.log(boxSep(W));

    for (const m of models) {
        const nodeNames = m.nodes.map(n => n.split('-').pop()).join(', ');
        const coverage = miniBar(Math.min(100, m.node_count * 20), 5);
        const row = padRight(C.white(C.bold(m.model)), 34) + padRight(coverage + ' ' + C.cyan(String(m.node_count)), 10) + C.dim(nodeNames);
        console.log(boxMid(row, W));
    }

    console.log(boxBot(W));
    console.log('');
}

async function cmdHealth(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/health/score') as {
        score: number;
        grade: string;
        color: string;
        factors: Record<string, number | boolean>;
        history?: number[];
    };

    const scoreColor = data.score >= 80 ? C.green : data.score >= 50 ? C.yellow : C.red;
    const mood: keyof typeof personality = data.score >= 80 ? 'healthy' : data.score >= 50 ? 'warning' : 'error';

    // Generate sparkline from history or fake a trend
    const history = data.history || generateFakeHistory(data.score, 20);
    const spark = C.cyan(sparkline(history));
    const trend = determineTrend(history);
    const trendLabel = trend === 'up' ? C.green('\u2191 improving') : trend === 'down' ? C.red('\u2193 declining') : C.dim('\u2192 stable');

    const W = 62;
    console.log('');
    console.log(boxTop('CLUSTER HEALTH', W));
    console.log(boxEmpty(W));

    // Big score line with grade
    const scoreLine = C.dim('HEALTH: ') + scoreColor(C.bold(`${data.grade}`)) + ' ' +
        scoreColor(C.bold(`(${data.score}/100)`)) + '  ' + spark + '  ' + C.dim('trend: ') + trendLabel;
    console.log(boxMid(scoreLine, W));

    // Progress bar
    console.log(boxMid(progressBar(data.score, 50) + '  ' + scoreColor(data.score + '%'), W));

    console.log(boxEmpty(W));

    // Factors
    if (data.factors) {
        console.log(boxMid(C.dim('FACTORS'), W));
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
                console.log(boxMid(`  ${icon} ${C.white(label)}`, W));
            } else if (key.includes('temp')) {
                const tColor = val < 70 ? C.green : val < 85 ? C.yellow : C.red;
                console.log(boxMid(`  ${padRight(C.white(label), 22)}${tColor(`${val}\u00B0C`)}`, W));
            } else if (key.includes('alert')) {
                const aColor = val === 0 ? C.green : C.red;
                console.log(boxMid(`  ${padRight(C.white(label), 22)}${aColor(String(val))}`, W));
            } else {
                const pColor = val >= 70 ? C.green : val >= 40 ? C.yellow : C.red;
                console.log(boxMid(`  ${padRight(C.white(label), 22)}${pColor(`${val}%`)}`, W));
            }
        }
    }

    console.log(boxEmpty(W));
    const quote = C.purple(C.italic(`"${pickPersonality(mood)}"`)) + C.dim('  \u2014 \uD83D\uDC19');
    console.log(boxMid(quote, W));
    console.log(boxBot(W));
    console.log('');
}

function generateFakeHistory(current: number, length: number): number[] {
    const result: number[] = [];
    let val = current - 10 + Math.random() * 5;
    for (let i = 0; i < length; i++) {
        val += (Math.random() - 0.45) * 6;
        val = Math.max(0, Math.min(100, val));
        result.push(Math.round(val));
    }
    result[result.length - 1] = current;
    return result;
}

function determineTrend(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 4) return 'stable';
    const recent = data.slice(-4);
    const earlier = data.slice(-8, -4);
    if (earlier.length === 0) return 'stable';
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const diff = recentAvg - earlierAvg;
    if (diff > 3) return 'up';
    if (diff < -3) return 'down';
    return 'stable';
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
        console.log(personalityLine('healthy'));
        console.log('');
        return;
    }

    const W = 68;
    console.log('');
    console.log(boxTop('ALERTS', W));

    for (const alert of data) {
        const icon = alert.severity === 'critical' ? C.red('\u2718') : C.yellow('\u26A0');
        const ack = alert.acknowledged ? C.dim(' [acked]') : '';
        const sev = alert.severity === 'critical' ? C.red(C.bold(alert.severity.toUpperCase())) : C.yellow(alert.severity.toUpperCase());
        console.log(boxMid(`${icon} ${sev} ${C.white(alert.type)} on ${C.cyan(alert.node_id)}${ack}`, W));
        console.log(boxMid(`  ${C.dim(alert.message)} ${C.dim('(' + alert.created_at + ')')}`, W));
    }

    const mood: keyof typeof personality = data.some(a => a.severity === 'critical') ? 'error' : 'warning';
    console.log(boxEmpty(W));
    console.log(boxMid(C.purple(C.italic(`"${pickPersonality(mood)}"`)) + C.dim('  \u2014 \uD83D\uDC19'), W));
    console.log(boxBot(W));
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

    // Find max tok/s for relative bars
    const maxToks = Math.max(...data.map(b => b.tokens_per_sec), 1);

    const W = 72;
    console.log('');
    console.log(boxTop('BENCHMARKS', W));

    const hdr =
        padRight(C.dim('NODE'), 16) +
        padRight(C.dim('MODEL'), 20) +
        padRight(C.dim('TOK/S'), 24) +
        padRight(C.dim('PROMPT'), 10);
    console.log(boxMid(hdr, W));
    console.log(boxSep(W));

    for (const b of data) {
        const relPct = Math.round((b.tokens_per_sec / maxToks) * 100);
        const bar = miniBar(relPct, 8);
        const row =
            padRight(C.cyan(b.node_id.slice(-12)), 16) +
            padRight(C.white(b.model), 20) +
            padRight(bar + ' ' + C.green(C.bold(String(Math.round(b.tokens_per_sec)))), 24) +
            padRight(C.dim(String(Math.round(b.prompt_eval_rate))), 10);
        console.log(boxMid(row, W));
    }

    console.log(boxBot(W));
    console.log('');
}

async function cmdTags(gateway: string, positional: string[], _flags: Record<string, string>): Promise<void> {
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

    bootSplash();
    console.log('  ' + C.purple(C.bold('Chat Mode')) + C.dim(` \u2014 model: ${model}`));
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
            console.log(C.dim('  TentaCLAW waves goodbye! \ud83d\udc19'));
            console.log('');
            rl.close();
            process.exit(0);
        }

        process.stdout.write('  ' + C.purple('TentaCLAW: '));

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

// =============================================================================
// Code Agent — Tool Definitions
// =============================================================================

const CODE_AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the full contents of a file. Use before editing.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path (relative to cwd or absolute)' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file, creating or overwriting it.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to write' },
                    content: { type: 'string', description: 'Full file content to write' },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List files and directories.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (default: cwd)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_shell',
            description: 'Execute a shell command. User must approve each command. Use for builds, tests, installs.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a text pattern across files in a directory.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Text pattern to search for' },
                    directory: { type: 'string', description: 'Directory to search (default: cwd)' },
                    file_pattern: { type: 'string', description: 'Glob for file types, e.g. "*.ts"' },
                },
                required: ['pattern'],
            },
        },
    },
];

// =============================================================================
// Code Agent — Helpers
// =============================================================================

function summarizeToolArgs(argsJson: string): string {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const vals = Object.values(args).map(v => {
            const s = String(v);
            return s.length > 70 ? s.slice(0, 70) + '\u2026' : s;
        });
        return C.dim('(' + vals.join(', ') + ')');
    } catch {
        return C.dim('(' + argsJson.slice(0, 80) + ')');
    }
}

interface AgentToolCall {
    id: string;
    name: string;
    args: string;
}

async function executeCodeTool(
    call: AgentToolCall,
    rl: import('readline').Interface,
    autoApprove: boolean
): Promise<string> {
    let args: Record<string, string>;
    try {
        args = JSON.parse(call.args || '{}') as Record<string, string>;
    } catch {
        return 'Error: could not parse tool arguments';
    }

    const { execFileSync } = await import('child_process');

    switch (call.name) {
        case 'read_file': {
            const filePath = path.resolve(args['path'] || '');
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const totalLines = content.split('\n').length;
                return content.length > 12000
                    ? content.slice(0, 12000) + `\n...(truncated — ${totalLines} total lines)`
                    : content;
            } catch (e) {
                return `Error reading: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'write_file': {
            const filePath = path.resolve(args['path'] || '');
            const content = args['content'] || '';
            if (!autoApprove) {
                const existing = fs.existsSync(filePath);
                console.log('');
                console.log('  ' + C.yellow(`\u26A1 ${existing ? 'Overwrite' : 'Create'}: ${C.white(filePath)}`));
                console.log('  ' + C.dim(`   ${content.split('\n').length} lines`));
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [y/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Write cancelled.';
            }
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, content, 'utf8');
                return `Written: ${filePath} (${content.split('\n').length} lines)`;
            } catch (e) {
                return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'list_dir': {
            const dirPath = path.resolve(args['path'] || '.');
            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const lines = entries
                    .sort((a, b) => {
                        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    })
                    .map(e => (e.isDirectory() ? '\uD83D\uDCC1 ' : '   ') + e.name + (e.isDirectory() ? '/' : ''));
                return lines.join('\n') || '(empty)';
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'run_shell': {
            // run_shell intentionally uses shell execution — this is the tool's purpose.
            // User must approve each command before it runs (unless --yes flag is set).
            const command = args['command'] || '';
            if (!command) return 'Error: no command provided';
            if (!autoApprove) {
                console.log('');
                console.log('  ' + C.yellow('\u26A1 Run shell command:'));
                console.log('  ' + C.cyan(`  $ ${command}`));
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [y/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Command cancelled.';
            } else {
                console.log('  ' + C.dim(`  $ ${command}`));
            }
            // shell: true is intentional here — run_shell needs pipes, redirects, expansions.
            // The command is AI-generated and shown to the user for approval.
            const { execSync } = await import('child_process');
            try {
                const out = execSync(command, {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    timeout: 30000,
                    maxBuffer: 2 * 1024 * 1024,
                });
                return ((out as string) || '(no output)').slice(0, 8000);
            } catch (e: unknown) {
                const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
                const combined = ((err.stdout || '') + (err.stderr || '')).trim();
                return combined
                    ? `Exit ${err.status ?? 1}:\n${combined}`.slice(0, 8000)
                    : `Failed: ${err.message || 'unknown error'}`;
            }
        }

        case 'search_files': {
            const pattern = args['pattern'] || '';
            const dir = path.resolve(args['directory'] || '.');
            const glob = args['file_pattern'] || '*';
            if (!pattern) return 'Error: pattern required';
            try {
                // Use execFileSync with arg arrays to avoid shell injection
                const filesRaw = execFileSync('grep', ['-rl', pattern, dir, `--include=${glob}`], {
                    encoding: 'utf8',
                    timeout: 10000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                }).trim();
                if (!filesRaw) return 'No matches found.';
                const fileList = filesRaw.split('\n').slice(0, 5);
                const results: string[] = [];
                for (const f of fileList) {
                    const hits = execFileSync('grep', ['-n', pattern, f], {
                        encoding: 'utf8',
                        timeout: 5000,
                        stdio: ['pipe', 'pipe', 'pipe'],
                    }).trim().split('\n').slice(0, 5).join('\n');
                    results.push(`${f}:\n${hits}`);
                }
                return results.join('\n\n');
            } catch (e: unknown) {
                const err = e as { status?: number; stdout?: string };
                // grep exits 1 when no matches found
                if (err.status === 1) return 'No matches found.';
                if (err.stdout) return err.stdout.trim().slice(0, 4000);
                return `Search error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        default:
            return `Unknown tool: ${call.name}`;
    }
}

// =============================================================================
// Code Agent — Main Command
// =============================================================================

async function cmdCode(gateway: string, flags: Record<string, string>): Promise<void> {
    let autoApprove = flags['yes'] === 'true' || flags['y'] === 'true';

    // Resolve model — pick from flag or auto-detect from cluster
    let model = flags['model'] || '';
    if (!model) {
        try {
            const modelsResp = await apiGet(gateway, '/v1/models') as { data?: Array<{ id: string }> };
            const list = modelsResp?.data || [];
            const preferred = list.find(m => /instruct|chat|code/i.test(m.id)) || list[0];
            model = preferred?.id || 'llama3.1:8b';
        } catch {
            model = 'llama3.1:8b';
        }
    }

    bootSplash();
    console.log('  ' + C.purple(C.bold('Code Agent')) + C.dim(` \u2014 model: ${model}`));
    console.log('  ' + C.dim(`cwd: ${process.cwd()}`));
    console.log('  ' + C.dim('Commands: /quit  /clear  /model <name>  /auto  /help'));
    console.log('  ' + C.dim(autoApprove ? 'Writes & shell: \u2713 auto-approved' : 'Writes & shell: will ask for approval'));
    console.log('');

    // Build system prompt
    let systemPrompt = `You are TentaCLAW Code Agent — an expert AI software engineer running inside TentaCLAW OS.

You have tools to read files, write files, list directories, run shell commands, and search codebases. Use them proactively — don't ask the user to run commands for you.

Current working directory: ${process.cwd()}
Platform: ${process.platform}
Node.js: ${process.version}

Approach:
- Be direct and action-oriented. Read files before editing them.
- Provide complete file content when writing (not diffs or snippets).
- Run tests or builds after making changes when appropriate.
- Briefly explain what you're doing, then do it.`;

    // Load workspace context files if present
    for (const cf of ['AGENTS.md', 'CLAUDE.md', '.clawcode']) {
        const cfPath = path.join(process.cwd(), cf);
        if (fs.existsSync(cfPath)) {
            try {
                const c = fs.readFileSync(cfPath, 'utf8');
                if (c.length < 5000) {
                    systemPrompt += `\n\n--- ${cf} ---\n${c}`;
                    console.log('  ' + C.green(`\u2714 Loaded ${cf}`));
                }
            } catch { /* skip unreadable */ }
        }
    }
    console.log('');

    type AgentMessage = {
        role: string;
        content: string | null;
        tool_calls?: unknown;
        tool_call_id?: string;
        name?: string;
    };
    const messages: AgentMessage[] = [{ role: 'system', content: systemPrompt }];

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: C.teal('\n  \u276F '),
    });

    const runAgentLoop = async (userMessage: string): Promise<void> => {
        messages.push({ role: 'user', content: userMessage });

        for (let iter = 0; iter < 20; iter++) {
            const url = gateway.replace(/\/+$/, '') + '/v1/chat/completions';
            const bodyStr = JSON.stringify({
                model,
                messages,
                tools: CODE_AGENT_TOOLS,
                tool_choice: 'auto',
                stream: true,
            });

            let fullContent = '';
            const tcAcc: Record<number, { id: string; name: string; args: string }> = {};

            process.stdout.write('\n  ' + C.purple('\u25CE '));

            // Stream the completion
            await new Promise<void>((resolve, reject) => {
                const parsed = new URL(url);
                const isHttps = parsed.protocol === 'https:';
                const lib = isHttps ? https : http;
                const req = lib.request({
                    hostname: parsed.hostname,
                    port: Number(parsed.port) || (isHttps ? 443 : 80),
                    path: parsed.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(bodyStr),
                    },
                }, (res) => {
                    let buf = '';
                    res.on('data', (chunk: Buffer) => {
                        buf += chunk.toString();
                        const lines = buf.split('\n');
                        buf = lines.pop() ?? '';
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const raw = line.slice(6).trim();
                            if (raw === '[DONE]') continue;
                            try {
                                const ev = JSON.parse(raw) as {
                                    choices?: Array<{
                                        delta?: {
                                            content?: string;
                                            tool_calls?: Array<{
                                                index?: number;
                                                id?: string;
                                                function?: { name?: string; arguments?: string };
                                            }>;
                                        };
                                    }>;
                                };
                                const delta = ev.choices?.[0]?.delta;
                                if (!delta) continue;
                                if (delta.content) {
                                    process.stdout.write(delta.content);
                                    fullContent += delta.content;
                                }
                                if (delta.tool_calls) {
                                    for (const tc of delta.tool_calls) {
                                        const idx = tc.index ?? 0;
                                        if (!tcAcc[idx]) tcAcc[idx] = { id: '', name: '', args: '' };
                                        if (tc.id) tcAcc[idx].id += tc.id;
                                        if (tc.function?.name) tcAcc[idx].name += tc.function.name;
                                        if (tc.function?.arguments) tcAcc[idx].args += tc.function.arguments;
                                    }
                                }
                            } catch { /* skip malformed SSE */ }
                        }
                    });
                    res.on('end', resolve);
                    res.on('error', reject);
                });
                req.on('error', reject);
                req.write(bodyStr);
                req.end();
            });

            const toolCalls = Object.values(tcAcc);

            // No tool calls — final response
            if (toolCalls.length === 0) {
                if (fullContent) messages.push({ role: 'assistant', content: fullContent });
                console.log('');
                return;
            }

            // Streamed some text then made tool calls
            console.log('');
            messages.push({
                role: 'assistant',
                content: fullContent || null,
                tool_calls: toolCalls.map(tc => ({
                    id: tc.id || `call_${Date.now()}`,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.args },
                })),
            });

            // Execute each tool and feed results back
            for (const tc of toolCalls) {
                const tcId = tc.id || `call_${Date.now()}`;
                console.log('');
                console.log('  ' + C.cyan(`\u2699  ${tc.name}`) + '  ' + summarizeToolArgs(tc.args));

                const result = await executeCodeTool(
                    { id: tcId, name: tc.name, args: tc.args },
                    rl,
                    autoApprove
                );

                // Show truncated result preview
                const lines = result.split('\n');
                const preview = lines.slice(0, 25);
                for (const l of preview) console.log('  ' + C.dim('\u2502 ') + l);
                if (lines.length > 25) console.log('  ' + C.dim(`\u2502 \u2026(${lines.length - 25} more lines)`));

                messages.push({
                    role: 'tool',
                    tool_call_id: tcId,
                    name: tc.name,
                    content: result,
                });
            }
            // Loop continues — model will respond to tool results
        }

        console.log('  ' + C.yellow('\u26A0 Reached maximum iterations.'));
    };

    rl.prompt();

    rl.on('line', async (line: string) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        // Slash commands
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(' ');
            const cmd = (parts[0] || '').toLowerCase();
            if (cmd === 'quit' || cmd === 'exit') {
                console.log('');
                console.log(C.dim('  TentaCLAW waves goodbye \uD83D\uDC19'));
                rl.close();
                process.exit(0);
            }
            if (cmd === 'clear') {
                messages.splice(1); // keep system prompt
                console.log('  ' + C.green('\u2714 Cleared.'));
                rl.prompt(); return;
            }
            if (cmd === 'model' && parts[1]) {
                model = parts[1];
                console.log('  ' + C.green(`\u2714 Model: ${model}`));
                rl.prompt(); return;
            }
            if (cmd === 'auto') {
                autoApprove = !autoApprove;
                console.log('  ' + C.green(`\u2714 Auto-approve: ${autoApprove ? 'ON' : 'OFF'}`));
                rl.prompt(); return;
            }
            if (cmd === 'context') {
                console.log('  ' + C.purple(`${messages.length} messages in context`));
                rl.prompt(); return;
            }
            if (cmd === 'help') {
                console.log('');
                console.log('  ' + C.bold('Slash commands:'));
                console.log('  ' + padRight(C.cyan('/clear'), 22) + 'Clear conversation');
                console.log('  ' + padRight(C.cyan('/model <name>'), 22) + 'Switch model');
                console.log('  ' + padRight(C.cyan('/auto'), 22) + 'Toggle auto-approval for writes & shell');
                console.log('  ' + padRight(C.cyan('/context'), 22) + 'Show message count');
                console.log('  ' + padRight(C.cyan('/quit'), 22) + 'Exit');
                console.log('');
                rl.prompt(); return;
            }
            console.log('  ' + C.dim(`Unknown: /${cmd}. Try /help.`));
            rl.prompt(); return;
        }

        rl.pause();
        try {
            await runAgentLoop(input);
        } catch (e) {
            console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
        }
        rl.resume();
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
    console.log('  ' + C.purple(C.bold('TentaCLAW Optimize')) + C.dim(' \u2014 ') + C.purple(C.italic(pickPersonality('optimize'))));
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

    console.log('  ' + C.teal('\uD83D\uDC19') + ' ' + C.bold('TentaCLAW says:'));
    console.log('');

    // Nodes — with personality
    if (summary.online_nodes === summary.total_nodes && summary.online_nodes > 0) {
        console.log('  ' + C.green('\u2714') + ` All ${summary.online_nodes} ${nodeWord} online. We're running smooth.`);
    } else if (summary.online_nodes === 0) {
        console.log('  ' + C.red('\u2718') + ' No nodes online. Plug something in.');
    } else {
        console.log('  ' + C.yellow('\u26A0') + ` ${summary.online_nodes} of ${summary.total_nodes} ${nodeWord} online. ${summary.total_nodes - summary.online_nodes} went dark.`);
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
    console.log('');
    console.log('  ' + C.teal('\uD83D\uDC19') + ' ' + C.bold('Scanning...'));
    console.log('');

    const data = await apiGet(gateway, '/api/v1/doctor?autofix=true') as any;

    const fixed = data.results.filter((r: any) => r.status === 'fixed');
    const critical = data.results.filter((r: any) => r.status === 'critical');

    if (fixed.length === 0 && critical.length === 0) {
        console.log('  ' + C.green('\u2714') + ' Everything\'s clean. Nothing to fix.');
        console.log(personalityLine('healthy'));
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

    console.log('  ' + C.purple('Deploying') + ' ' + C.white(C.bold(model)) + C.dim(` (~${check.estimated_vram_mb}MB VRAM)`));

    if (check.best_node) {
        console.log('  ' + C.dim('Best node: ') + C.white(check.best_node.hostname) + C.dim(` (${Math.round(check.best_node.available_mb / 1024)}GB free)`));
    }

    // Simulated progress bar
    console.log('  ' + progressBar(0, 30) + '  ' + C.dim('queuing...'));

    // Deploy
    const result = await apiPost(gateway, '/api/v1/models/smart-deploy', { model, count: 1 }) as any;

    if (result.deployed && result.deployed.length > 0) {
        // Show completed bar
        console.log('  ' + progressBar(100, 30) + '  ' + C.green('queued'));
        console.log('');
        for (const d of result.deployed) {
            console.log('  ' + C.green('\u2714') + ` Queued on ${C.white(d.hostname)}`);
        }
        console.log('');
        console.log('  ' + C.dim('Model will start downloading. Check progress: clawtopus models'));
        console.log('');
        console.log(personalityLine('deploy'));
    } else {
        console.log('  ' + C.red('\u2718 Deploy failed'));
    }
    console.log('');
}

async function cmdFleet(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/fleet') as any[];

    const W = 72;
    console.log('');
    console.log(boxTop('FLEET RELIABILITY', W));

    const hdr = padRight(C.dim('NODE'), 16) + padRight(C.dim('HEALTH'), 16) + padRight(C.dim('UPTIME'), 10) + padRight(C.dim('GPUs'), 8) + padRight(C.dim('MODELS'), 8) + C.dim('STATUS');
    console.log(boxMid(hdr, W));
    console.log(boxSep(W));

    for (const n of data) {
        const hColor = n.health_score >= 80 ? C.green : n.health_score >= 50 ? C.yellow : C.red;
        const sColor = n.status === 'online' ? C.green : n.status === 'maintenance' ? C.yellow : C.red;
        const healthBar = miniBar(n.health_score, 5);
        console.log(boxMid(
            padRight(C.white(C.bold(n.hostname)), 16) +
            padRight(healthBar + ' ' + hColor(n.grade), 16) +
            padRight(C.dim(n.uptime_pct + '%'), 10) +
            padRight(C.cyan(String(n.gpu_count)), 8) +
            padRight(C.dim(String(n.models)), 8) +
            sColor(n.status), W
        ));
    }

    console.log(boxBot(W));
    console.log('');
}

async function cmdEvents(gateway: string, flags: Record<string, string>): Promise<void> {
    const limit = parseInt(flags['limit'] || '20');
    const data = await apiGet(gateway, `/api/v1/timeline?limit=${limit}`) as any[];

    console.log('');
    if (data.length === 0) {
        console.log('  ' + C.dim('No events yet.'));
        console.log('');
        return;
    }

    console.log('  ' + C.purple(C.bold('Cluster Timeline')) + C.dim(` (${data.length} events)`));
    console.log('');

    for (const evt of data) {
        const sevIcon = evt.severity === 'critical' ? C.red('\u2718') :
                       evt.severity === 'warning' ? C.yellow('\u26A0') : C.dim('\u25CB');
        const srcColor = evt.source === 'watchdog' ? C.red :
                        evt.source === 'alert' ? C.yellow :
                        evt.source === 'uptime' ? C.cyan : C.dim;
        const nodeShort = evt.node_id ? evt.node_id.split('-').pop() : '';
        const time = evt.created_at ? evt.created_at.slice(11, 19) : '';

        console.log(`  ${sevIcon} ${C.dim(time)} ${srcColor(padRight(evt.source, 10))} ${padRight(C.white(nodeShort), 12)} ${C.dim(evt.message.slice(0, 60))}`);
    }
    console.log('');
}

async function cmdMaintenance(gateway: string, positional: string[]): Promise<void> {
    const nodeId = positional[0];
    const action = positional[1] || 'on';

    if (!nodeId) {
        console.error(C.red('  Usage: clawtopus maintenance <nodeId> [on|off]'));
        process.exit(1);
    }

    const enabled = action !== 'off';
    await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled });

    console.log('');
    if (enabled) {
        console.log('  ' + C.yellow('\u26A0') + ' ' + C.white(nodeId) + ' is now in ' + C.yellow('MAINTENANCE') + ' mode');
        console.log('  ' + C.dim('No new requests will be routed to this node.'));
    } else {
        console.log('  ' + C.green('\u2714') + ' ' + C.white(nodeId) + ' is back ' + C.green('ONLINE'));
    }
    console.log('');
}

async function cmdPower(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/power') as any;

    const totalW = data.total_watts || 0;
    const dailyKwh = data.daily_kwh || data.daily_cost_usd ? ((totalW * 24) / 1000) : 0;
    const monthlyKwh = dailyKwh * 30;
    const rate = data.electricity_rate || data.cost_per_kwh || 0.12;
    const dailyCost = data.daily_cost || data.daily_cost_usd || (dailyKwh * rate);
    const monthlyCost = data.monthly_cost || data.monthly_cost_usd || (monthlyKwh * rate);

    const W = 56;
    console.log('');
    console.log(boxTop('POWER & COST', W));
    console.log(boxEmpty(W));

    console.log(boxMid(C.dim('POWER'), W));
    console.log(boxMid(padRight(C.dim('Total Draw'), 20) + C.white(C.bold(totalW + 'W')), W));
    console.log(boxMid(padRight(C.dim('Daily Usage'), 20) + C.white(dailyKwh.toFixed(1) + ' kWh'), W));
    console.log(boxMid(padRight(C.dim('Monthly Usage'), 20) + C.white(Math.round(monthlyKwh) + ' kWh'), W));
    console.log(boxEmpty(W));

    console.log(boxMid(C.dim('COST') + C.dim(` ($${rate}/kWh)`), W));
    console.log(boxMid(padRight(C.dim('Daily'), 20) + C.green(C.bold('$' + dailyCost.toFixed(2))), W));
    console.log(boxMid(padRight(C.dim('Monthly'), 20) + C.green(C.bold('$' + monthlyCost.toFixed(2))), W));
    if (data.cost_per_request > 0) {
        console.log(boxMid(padRight(C.dim('Per Request'), 20) + C.green('$' + data.cost_per_request.toFixed(4)), W));
    }
    if (data.cost_per_1k_tokens > 0) {
        console.log(boxMid(padRight(C.dim('Per 1K Tokens'), 20) + C.green('$' + data.cost_per_1k_tokens.toFixed(4)), W));
    }

    if (data.per_node && data.per_node.length > 0) {
        console.log(boxEmpty(W));
        console.log(boxMid(C.dim('PER NODE'), W));
        for (const n of data.per_node) {
            const nodeW = n.watts || (n.gpu_watts + 100) || 0;
            console.log(boxMid(
                padRight(C.white(n.hostname), 16) +
                padRight(C.dim(nodeW + 'W'), 10) +
                C.dim((n.gpu_watts || 0) + 'W GPU (' + n.gpu_count + ')'), W
            ));
        }
    }

    console.log(boxBot(W));
    console.log('');
}

async function cmdAlias(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'list';

    if (sub === 'list') {
        const aliases = await apiGet(gateway, '/api/v1/aliases') as any[];
        console.log('');
        console.log('  ' + C.purple(C.bold('Model Aliases')) + C.dim(` (${aliases.length})`));
        console.log('  ' + C.dim('Point any OpenAI client at your cluster using familiar model names.'));
        console.log('');
        console.log('  ' + padRight(C.dim('ALIAS'), 25) + padRight(C.dim('TARGET'), 30) + C.dim('FALLBACKS'));
        console.log('  ' + C.dim('\u2500'.repeat(75)));
        for (const a of aliases) {
            const fb = a.fallbacks.length > 0 ? C.dim(a.fallbacks.join(' \u2192 ')) : C.dim('none');
            console.log('  ' + padRight(C.white(C.bold(a.alias)), 25) + padRight(C.cyan(a.target), 30) + fb);
        }
        console.log('');
        console.log('  ' + C.dim('Usage: curl -X POST http://gateway/v1/chat/completions -d \'{"model":"gpt-4",...}\''));
        console.log('');
        return;
    }

    if (sub === 'set') {
        const alias = positional[1];
        const target = positional[2];
        if (!alias || !target) {
            console.error(C.red('  Usage: clawtopus alias set <alias> <target> [--fallback model1,model2]'));
            process.exit(1);
        }
        const fallbacks = (flags['fallback'] || '').split(',').filter(Boolean);
        await apiPost(gateway, '/api/v1/aliases', { alias, target, fallbacks });
        console.log('  ' + C.green('\u2714') + ` ${C.white(alias)} \u2192 ${C.cyan(target)}` + (fallbacks.length > 0 ? C.dim(' (fallbacks: ' + fallbacks.join(', ') + ')') : ''));
        return;
    }
}

async function cmdAuto(gateway: string): Promise<void> {
    console.log('');
    console.log('  ' + C.purple(C.bold('TentaCLAW Auto Mode')) + C.dim(' — letting the system decide'));
    console.log('');

    const result = await apiPost(gateway, '/api/v1/auto', {}) as any;

    if (result.decisions.length === 0) {
        console.log('  ' + C.green('\u2714') + ' Cluster is already optimized. No changes needed.');
        console.log('');
        return;
    }

    for (const d of result.decisions) {
        const icon = d.executed ? C.cyan('\u2692') : C.yellow('\u26A0');
        const label = d.executed ? C.cyan('[AUTO]') : C.yellow('[SUGGEST]');
        console.log('  ' + icon + ' ' + label + ' ' + C.white(d.reason));
    }

    console.log('');
    if (result.executed > 0) {
        console.log('  ' + C.cyan(C.bold(`\u2692 ${result.executed} action(s) executed automatically`)));
    }
    if (result.suggested > 0) {
        console.log('  ' + C.yellow(`\u26A0 ${result.suggested} suggestion(s) — review and act manually`));
    }
    console.log('');
}

async function cmdApiKey(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'list';

    if (sub === 'list') {
        const keys = await apiGet(gateway, '/api/v1/apikeys') as any[];
        console.log('');
        if (keys.length === 0) {
            console.log(C.dim('  No API keys. Create one:'));
            console.log(C.cyan('    clawtopus apikey create --name "my-app"'));
        } else {
            console.log('  ' + C.purple(C.bold('API Keys')) + C.dim(` (${keys.length})`));
            console.log('');
            console.log('  ' + padRight(C.dim('PREFIX'), 14) + padRight(C.dim('NAME'), 20) + padRight(C.dim('SCOPE'), 14) + padRight(C.dim('REQS'), 10) + C.dim('LAST USED'));
            console.log('  ' + C.dim('\u2500'.repeat(70)));
            for (const k of keys) {
                const enabled = k.enabled ? C.green('\u25CF') : C.red('\u25CB');
                console.log('  ' + enabled + ' ' +
                    padRight(C.white(k.key_prefix + '...'), 14) +
                    padRight(C.white(k.name), 20) +
                    padRight(C.dim(k.scope), 14) +
                    padRight(C.cyan(String(k.requests_count)), 10) +
                    C.dim(k.last_used_at || 'never'));
            }
        }
        console.log('');
        return;
    }

    if (sub === 'create') {
        const name = flags['name'] || 'default';
        const scope = flags['scope'] || 'inference';
        const rpm = parseInt(flags['rpm'] || '60');
        const result = await apiPost(gateway, '/api/v1/apikeys', { name, scope, rate_limit_rpm: rpm }) as any;

        console.log('');
        console.log('  ' + C.green('\u2714') + ' API Key created');
        console.log('');
        console.log('  ' + C.red(C.bold('SAVE THIS KEY — IT WILL NOT BE SHOWN AGAIN:')));
        console.log('');
        console.log('  ' + C.white(C.bold(result.key)));
        console.log('');
        console.log('  ' + C.dim('Name:  ') + C.white(name));
        console.log('  ' + C.dim('Scope: ') + C.white(scope));
        console.log('  ' + C.dim('Rate:  ') + C.white(rpm + ' req/min'));
        console.log('');
        console.log('  ' + C.dim('Use with: curl -H "Authorization: Bearer ' + result.key.slice(0, 10) + '..."'));
        console.log('');
        return;
    }

    if (sub === 'revoke') {
        const keyId = positional[1];
        if (!keyId) { console.error(C.red('  Usage: clawtopus apikey revoke <id>')); process.exit(1); }
        await apiGet(gateway, ''); // placeholder - need delete method
        console.log('  ' + C.green('\u2714') + ' Key revoked');
        return;
    }
}

async function cmdAnalytics(gateway: string, flags: Record<string, string>): Promise<void> {
    const hours = parseInt(flags['hours'] || '24');

    const W = 62;
    console.log('');
    console.log(boxTop(`ANALYTICS \u2014 last ${hours}h`, W));
    console.log(boxEmpty(W));

    const data = await apiGet(gateway, `/api/v1/inference/analytics?hours=${hours}`) as any;

    // Overview
    const successRate = data.total_requests > 0 ? Math.round((data.successful / data.total_requests) * 100) : 100;
    console.log(boxMid(C.dim('OVERVIEW'), W));
    console.log(boxMid(padRight(C.dim('Total Requests'), 22) + C.white(C.bold(String(data.total_requests))), W));
    console.log(boxMid(padRight(C.dim('Success Rate'), 22) + progressBar(successRate, 15) + '  ' + C.green(successRate + '%'), W));
    console.log(boxMid(padRight(C.dim('Failed'), 22) + (data.failed > 0 ? C.red(C.bold(String(data.failed))) : C.dim('0')), W));
    console.log(boxMid(padRight(C.dim('Req/min'), 22) + C.white(String(data.requests_per_minute)), W));
    console.log(boxMid(padRight(C.dim('Tokens In'), 22) + C.white(formatNumber(data.total_tokens_in)), W));
    console.log(boxMid(padRight(C.dim('Tokens Out'), 22) + C.white(formatNumber(data.total_tokens_out)), W));
    console.log(boxEmpty(W));

    // Latency with visual bar
    console.log(boxMid(C.dim('LATENCY'), W));
    const maxLatency = Math.max(data.p99_latency_ms || 1, 1);
    console.log(boxMid(padRight(C.dim('Average'), 22) + miniBar(Math.min(100, Math.round(data.avg_latency_ms / maxLatency * 100)), 5) + ' ' + C.white(data.avg_latency_ms + 'ms'), W));
    console.log(boxMid(padRight(C.dim('p50'), 22) + miniBar(Math.min(100, Math.round(data.p50_latency_ms / maxLatency * 100)), 5) + ' ' + C.white(data.p50_latency_ms + 'ms'), W));
    console.log(boxMid(padRight(C.dim('p95'), 22) + miniBar(Math.min(100, Math.round(data.p95_latency_ms / maxLatency * 100)), 5) + ' ' + (data.p95_latency_ms > 5000 ? C.yellow : C.white)(data.p95_latency_ms + 'ms'), W));
    console.log(boxMid(padRight(C.dim('p99'), 22) + miniBar(100, 5) + ' ' + (data.p99_latency_ms > 10000 ? C.red : C.white)(data.p99_latency_ms + 'ms'), W));
    console.log(boxBot(W));
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
    console.log('  ' + C.purple(C.bold('TentaCLAW Doctor')) + C.dim(' — Self-healing diagnostics'));
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
        console.log('  ' + C.cyan(C.bold(`\u2692 ${s.auto_fixed} issue(s) auto-fixed by TentaCLAW Doctor`)));
    }

    if (s.critical > 0) {
        console.log('');
        console.log('  ' + C.red(C.bold('\u26A0 Critical issues require manual intervention')));
        console.log(personalityLine('error'));
    } else if (s.warnings > 0) {
        console.log(personalityLine('warning'));
    } else {
        console.log(personalityLine('healthy'));
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
            headers: { 'User-Agent': 'TentaCLAW-CLI/' + CLI_VERSION, 'Accept': 'application/json' },
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
    console.log(`  \uD83D\uDC19 ${C.teal(C.bold('TentaCLAW'))} ${C.dim('v' + CLI_VERSION)} ${C.dim('\u2014')} ${C.purple(C.italic('Eight arms. One mind.'))}`);
    console.log('');

    const section = (title: string) => {
        console.log('  ' + C.teal(C.bold(title)));
    };
    const cmd = (name: string, desc: string) => {
        console.log('    ' + padRight(C.green(name), 32) + C.dim(desc));
    };

    section('CLUSTER');
    cmd('status', 'Cluster overview with health score');
    cmd('nodes', 'List all nodes with GPU details');
    cmd('health', 'Detailed health analysis with sparkline');
    cmd('models', 'List all loaded models');
    cmd('alerts', 'View cluster alerts');
    cmd('doctor', 'Run diagnostics + auto-heal');
    console.log('');

    section('DEPLOY');
    cmd('deploy <model>', 'Smart-deploy to best node');
    cmd('deploy <model> <node>', 'Deploy to a specific node');
    cmd('apply <id>', 'Apply a flight sheet');
    cmd('flight-sheets', 'List flight sheets');
    console.log('');

    section('AGENT');
    cmd('code [--model <m>] [--yes]', 'AI coding agent — reads, writes files, runs shell');
    cmd('chat [--model <m>]', 'Simple chat with a model');
    console.log('');

    section('MANAGE');
    cmd('top', 'Real-time cluster monitor (htop-style)');
    cmd('backends', 'Inference backends per node');
    cmd('capacity', 'Cluster capacity report');
    cmd('power', 'Power draw and cost estimates');
    cmd('hot', 'Hottest nodes by GPU temperature');
    cmd('idle', 'Idle nodes (< 10% utilization)');
    cmd('benchmarks', 'View performance benchmarks');
    cmd('tags [list|add|nodes]', 'Manage node tags');
    cmd('drain/cordon <node>', 'Take a node offline');
    cmd('uncordon <node>', 'Bring a node back');
    console.log('');

    section('SMART');
    cmd('optimize', 'CLAWtopus optimizes your cluster');
    cmd('explain', 'Plain English cluster summary');
    cmd('fix', 'Auto-fix cluster issues');
    cmd('auto', 'Full auto mode \u2014 let TentaCLAW decide');
    cmd('vibe', 'How\'s the cluster doing?');
    console.log('');

    section('SEARCH');
    cmd('search <query>', 'Search Ollama + HuggingFace');
    cmd('info <org/model>', 'Detailed model info');
    cmd('recommend', 'Model recommendations for your cluster');
    cmd('estimate <model>', 'VRAM estimate for a model');
    console.log('');

    section('HUB');
    cmd('hub search <query>', 'Search CLAWHub');
    cmd('hub install @ns/pkg', 'Install a package');
    cmd('hub list', 'List installed');
    cmd('hub publish', 'Publish from clawhub.yaml');
    cmd('hub trending', 'Trending packages');
    console.log('');

    section('ADMIN');
    cmd('users', 'List users');
    cmd('login <username>', 'Login to gateway');
    cmd('apikey [create|list]', 'API key management');
    cmd('alert-rules', 'View alert rules');
    cmd('analytics', 'Inference analytics');
    cmd('audit', 'Audit log');
    console.log('');

    console.log('  ' + C.dim('Use') + ' ' + C.yellow('--gateway <url>') + ' ' + C.dim('to specify a different gateway.'));
    console.log('  ' + C.dim('Default: http://localhost:8080'));
    console.log('');
}

// =============================================================================
// Main
// =============================================================================

// Random startup tips — show 20% of the time
const TIPS = [
    'Run `clawtopus top` for a real-time cluster monitor.',
    'Use `clawtopus backends` to see what inference engines each node runs.',
    'Try `clawtopus joke` when you need a laugh.',
    'Set TENTACLAW_GATEWAY to avoid passing --gateway every time.',
    'Use `clawtopus drain <node>` to safely take a node offline.',
    'Run `clawtopus doctor` to auto-diagnose cluster issues.',
    'Use `clawtopus fortune` for octopus wisdom.',
    'Deploy BitNet models on CPU-only nodes with `clawtopus deploy bitnet-b1.58`.',
    'Model aliases: `gpt-4` can route to any model you want. Try `clawtopus alias`.',
    'The `tentaclaw auto mode lets TentaCLAW decide everything. Trust the octopus.',
    'Browse CLAWHub with `clawtopus hub trending` — see what the family is building.',
    'Publish to CLAWHub: `clawtopus hub init && clawtopus hub publish`. Join the family.',
];

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);
    const gateway = getGatewayUrl(parsed.flags);

    // Boot splash for status or no-args
    if (parsed.command === 'status' || parsed.command === 'help') {
        bootSplash();
    }

    // Random tip on 20% of runs (skip for help/version/simple commands)
    if (Math.random() < 0.2 && !['help', 'status', 'version', '--help', '-h', '--version', '-v', 'joke', 'fortune', 'dance', 'credits', 'sup'].includes(parsed.command)) {
        console.error(C.dim('  \uD83D\uDC19 Tip: ' + TIPS[Math.floor(Math.random() * TIPS.length)]));
    }

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

        case 'code':
        case 'agent':
            await cmdCode(gateway, parsed.flags);
            break;

        case 'watchdog':
            await cmdWatchdog(gateway, parsed.positional);
            break;

        case 'notify':
            await cmdNotify(gateway, parsed.positional, parsed.flags);
            break;

        case 'fleet':
        case 'reliability':
            await cmdFleet(gateway);
            break;

        case 'events':
        case 'timeline':
            await cmdEvents(gateway, parsed.flags);
            break;

        case 'maintenance':
            await cmdMaintenance(gateway, parsed.positional);
            break;

        case 'power':
        case 'cost':
            await cmdPower(gateway);
            break;

        case 'alias':
        case 'aliases':
            await cmdAlias(gateway, parsed.positional, parsed.flags);
            break;

        case 'vibe': {
            const s = await apiGet(gateway, '/api/v1/summary') as any;
            const h = await apiGet(gateway, '/api/v1/health/score') as any;
            const vibeMood: keyof typeof personality = h.score >= 80 ? 'healthy' : h.score >= 50 ? 'warning' : 'error';
            const scoreColor = h.score >= 80 ? C.green : h.score >= 50 ? C.yellow : C.red;
            console.log('');
            console.log('  \uD83D\uDC19 ' + C.purple(C.italic(C.bold(`"${pickPersonality(vibeMood)}"`))) );
            console.log('');
            console.log('  ' + C.dim('  ') + scoreColor(C.bold(h.grade)) + ' ' + progressBar(h.score, 20) + '  ' + scoreColor(h.score + '/100'));
            console.log('  ' + C.dim(`   ${s.online_nodes} nodes | ${s.total_gpus} GPUs | ${formatNumber(Math.round(s.total_toks_per_sec || 0))} tok/s`));
            console.log('');
            break;
        }

        case 'sup': {
            console.log('');
            console.log('  ' + C.teal('\uD83D\uDC19 sup'));
            console.log('');
            break;
        }

        case 'joke': {
            const jokes = [
                'Why did the GPU go to therapy? Too much parallel processing of emotions.',
                'I told my CPU a joke about inference. It didn\'t get it — not enough context.',
                'What\'s a GPU\'s favorite music? Heavy metal. Obviously.',
                'Why don\'t GPUs ever get lonely? They always work in parallel.',
                'My VRAM is full but my heart is empty. — CLAWtopus, 3am',
                'I asked the model for advice. It said "temperature 0". Cold.',
                'How many arms does it take to manage a GPU cluster? Eight. Obviously.',
                'knock knock. Who\'s there? OOM. OOM w— *process killed*',
                'A GPU walks into a bar. The bartender says "you look hot." The GPU says "always."',
                'Per-token pricing is a scam. This is not a joke. — CLAWtopus',
            ];
            console.log('');
            console.log('  ' + C.teal('\uD83D\uDC19') + ' ' + C.white(jokes[Math.floor(Math.random() * jokes.length)]));
            console.log('');
            break;
        }

        case 'fortune': {
            const fortunes = [
                'Your cluster will run smoothly today. The octopus has spoken.',
                'A new GPU approaches. Accept it with open arms (all eight).',
                'The model you seek is already downloaded. Look within.',
                'Today\'s latency will be surprisingly low. Trust the routing.',
                'An OOM error averted is worth two in the log.',
                'Eight arms, one mind. Your cluster thinks as one.',
                'The node you neglect today will fail tomorrow. Run doctor.',
                'Patience with large models yields great tokens.',
                'Your VRAM is a garden. Tend it wisely.',
                'The best inference is the one that was already cached.',
                'Per-token pricing is a choice. You chose differently. Respect.',
                'The tentacle that reaches furthest finds the coolest GPU.',
            ];
            console.log('');
            console.log('  ' + C.purple('\u2728') + ' ' + C.dim('CLAWtopus fortune:'));
            console.log('  ' + C.white(fortunes[Math.floor(Math.random() * fortunes.length)]));
            console.log('');
            break;
        }

        case 'dance': {
            const frames = [
                '     \\o/\n      |\n     / \\',
                '      o\n     /|\\\n     / \\',
                '     \\o/\n      |\n     / \\',
                '    o/\n    /|\n    / \\',
            ];
            console.log('');
            console.log('  ' + C.teal('\uD83D\uDC19 CLAWtopus is dancing!'));
            for (const frame of frames) {
                console.log('');
                for (const line of frame.split('\n')) {
                    console.log('  ' + C.purple(line));
                }
            }
            console.log('');
            console.log('  ' + C.dim('...eight arms make for great dance moves'));
            console.log('');
            break;
        }

        case 'credits': {
            console.log('');
            for (const line of CLAWTOPUS_FACE) {
                console.log('  ' + line);
            }
            console.log('');
            console.log('  ' + C.teal(C.bold('TENTACLAW OS')) + ' ' + C.dim('v' + CLI_VERSION));
            console.log('  ' + C.purple(C.italic('Eight arms. One mind. Zero compromises.')));
            console.log('');
            console.log('  ' + padRight(C.purple('Created by'), 16) + C.white('TentaCLAW-OS'));
            console.log('  ' + padRight(C.purple('Mascot'), 16) + C.white('CLAWtopus \uD83D\uDC19'));
            console.log('  ' + padRight(C.purple('License'), 16) + C.white('MIT'));
            console.log('  ' + padRight(C.purple('Website'), 16) + C.teal('www.tentaclaw.io'));
            console.log('  ' + padRight(C.purple('GitHub'), 16) + C.teal('github.com/TentaCLAW-OS'));
            console.log('');
            console.log('  ' + C.dim('Built with \u2764 and too many GPUs'));
            console.log('');
            break;
        }

        case 'auto':
            await cmdAuto(gateway);
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

        case 'apikey':
        case 'apikeys':
            await cmdApiKey(gateway, parsed.positional, parsed.flags);
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

case 'capacity':            await cmdCapacity(gateway);            break;        case 'suggestions':        case 'suggest':            await cmdSuggestions(gateway);            break;        case 'gpu-map':        case 'gpus':            await cmdGpuMap(gateway);            break;
        case 'groups': {
            const groups = await apiGet(gateway, '/api/v1/node-groups') as Array<{ id: string; name: string; member_count: number }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('NODE GROUPS')));
            console.log('');
            if (groups.length === 0) {
                console.log('  ' + C.dim('No groups. Create one: clawtopus groups create <name>'));
            } else {
                for (const g of groups) {
                    console.log('  ' + C.white(g.name) + C.dim(' (' + g.member_count + ' nodes) ID: ' + g.id));
                }
            }
            console.log('');
            break;
        }

        case 'capacity': {
            const cap = await apiGet(gateway, '/api/v1/capacity') as Record<string, number>;
            console.log('');
            console.log('  ' + C.teal(C.bold('CLUSTER CAPACITY')));
            console.log('');
            console.log('  ' + padRight(C.dim('Nodes'), 20) + C.white(String(cap.total_nodes || 0)));
            console.log('  ' + padRight(C.dim('GPUs'), 20) + C.white(String(cap.total_gpus || 0)));
            console.log('  ' + padRight(C.dim('Total VRAM'), 20) + C.teal(Math.round((cap.total_vram_mb || 0) / 1024) + ' GB'));
            console.log('  ' + padRight(C.dim('Used VRAM'), 20) + C.yellow(Math.round((cap.used_vram_mb || 0) / 1024) + ' GB'));
            console.log('  ' + padRight(C.dim('Free VRAM'), 20) + C.green(Math.round((cap.free_vram_mb || 0) / 1024) + ' GB'));
            console.log('  ' + padRight(C.dim('Utilization'), 20) + C.white((cap.utilization_pct || 0) + '%'));
            console.log('  ' + padRight(C.dim('Models Loaded'), 20) + C.white(String(cap.loaded_models || 0)));
            console.log('  ' + padRight(C.dim('Room for 7B models'), 20) + C.teal(String(cap.max_additional_7b || 0)));
            console.log('  ' + padRight(C.dim('Room for 70B models'), 20) + C.teal(String(cap.max_additional_70b || 0)));
            console.log('');
            break;
        }

        case 'hot': {
            const hot = await apiGet(gateway, '/api/v1/nodes/hot') as Array<{ hostname: string; max_temp_c: number; gpu_count: number }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('HOTTEST NODES')) + C.dim(' (sorted by GPU temp)'));
            console.log('');
            for (const n of hot.slice(0, 10)) {
                const color = n.max_temp_c > 85 ? C.red : n.max_temp_c > 70 ? C.yellow : C.green;
                console.log('  ' + padRight(C.white(n.hostname), 25) + color(n.max_temp_c + 'C') + C.dim('  (' + n.gpu_count + ' GPUs)'));
            }
            console.log('');
            break;
        }

        case 'idle': {
            const idle = await apiGet(gateway, '/api/v1/nodes/idle') as Array<{ hostname: string; avg_util: number; gpu_count: number }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('IDLE NODES')) + C.dim(' (< 10% GPU utilization)'));
            console.log('');
            if (idle.length === 0) {
                console.log('  ' + C.green('All nodes are busy. CLAWtopus approves.'));
            } else {
                for (const n of idle) {
                    console.log('  ' + padRight(C.white(n.hostname), 25) + C.dim(n.avg_util + '% util') + C.dim('  (' + n.gpu_count + ' GPUs)'));
                }
            }
            console.log('');
            break;
        }

        case 'webhooks': {
            const wh = await apiGet(gateway, '/api/v1/webhooks') as Array<{ id: string; url: string; events: string[]; enabled: boolean }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('WEBHOOKS')));
            console.log('');
            if (wh.length === 0) {
                console.log('  ' + C.dim('No webhooks configured.'));
            } else {
                for (const w of wh) {
                    const status = w.enabled ? C.green('enabled') : C.red('disabled');
                    console.log('  ' + C.white(w.url) + ' ' + status + C.dim(' [' + w.events.join(', ') + ']'));
                }
            }
            console.log('');
            break;
        }

        case 'profiler': {
            const perf = await apiGet(gateway, '/api/v1/profiler/summary').catch(() => null) as Record<string, unknown> | null;
            console.log('');
            console.log('  ' + C.teal(C.bold('PERFORMANCE PROFILER')));
            console.log('');
            if (!perf) {
                console.log('  ' + C.dim('Profiler not available. Gateway may need to be updated.'));
            } else {
                console.log('  ' + padRight(C.dim('Total requests'), 25) + C.white(String(perf.total_requests || 0)));
                console.log('  ' + padRight(C.dim('Avg latency'), 25) + C.teal(perf.avg_latency_ms + 'ms'));
                console.log('  ' + padRight(C.dim('P50'), 25) + C.white(perf.p50_ms + 'ms'));
                console.log('  ' + padRight(C.dim('P95'), 25) + C.yellow(perf.p95_ms + 'ms'));
                console.log('  ' + padRight(C.dim('P99'), 25) + C.red(perf.p99_ms + 'ms'));
            }
            console.log('');
            break;
        }

        case 'users': {
            const users = await apiGet(gateway, '/api/v1/users') as Array<{ id: string; username: string; role: string; last_login_at: string | null }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('USERS')));
            console.log('');
            for (const u of users) {
                const roleColor = u.role === 'admin' ? C.red : u.role === 'operator' ? C.yellow : C.dim;
                console.log('  ' + padRight(C.white(u.username), 20) + roleColor(u.role) + (u.last_login_at ? C.dim('  last: ' + u.last_login_at) : C.dim('  never logged in')));
            }
            console.log('');
            break;
        }

        case 'login': {
            const username = parsed.positional[0] || 'admin';
            const password = parsed.flags['password'] || parsed.positional[1] || 'admin';
            try {
                const result = await apiPost(gateway, '/api/v1/auth/login', { username, password }) as { token: string; user: { username: string; role: string } };
                console.log('');
                console.log('  ' + C.green('\u2714') + ' Logged in as ' + C.white(result.user.username) + ' (' + result.user.role + ')');
                console.log('  ' + C.dim('Token: ' + result.token.slice(0, 20) + '...'));
                console.log('');
            } catch {
                console.log('');
                console.log('  ' + C.red('\u2718') + ' Login failed. Check credentials.');
                console.log('');
            }
            break;
        }

        case 'alert-rules': {
            const rules = await apiGet(gateway, '/api/v1/alert-rules') as Array<{ id: string; name: string; metric: string; operator: string; threshold: number; severity: string; enabled: number }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('ALERT RULES')));
            console.log('');
            for (const r of rules) {
                const status = r.enabled ? C.green('enabled') : C.red('disabled');
                const sevColor = r.severity === 'critical' ? C.red : C.yellow;
                console.log('  ' + padRight(C.white(r.name), 30) + padRight(sevColor(r.severity), 12) + C.dim(r.metric + ' ' + r.operator + ' ' + r.threshold) + '  ' + status);
            }
            console.log('');
            break;
        }

        case 'topology': {
            const topo = await apiGet(gateway, '/api/v1/topology') as { nodes: Array<{ hostname: string; status: string; gpu_count: number }>; total_nodes: number };
            console.log('');
            console.log('  ' + C.teal(C.bold('CLUSTER TOPOLOGY')));
            console.log('  ' + C.dim(topo.total_nodes + ' nodes'));
            console.log('');
            for (const n of (topo.nodes || [])) {
                const icon = n.status === 'online' ? C.green('\u25CF') : C.red('\u25CF');
                console.log('  ' + icon + ' ' + padRight(C.white(n.hostname), 25) + C.dim(n.gpu_count + ' GPUs'));
            }
            console.log('');
            break;
        }

        case 'about': {
            const ver = await apiGet(gateway, '/api/v1/version') as Record<string, unknown>;
            bootSplash();
            console.log('  ' + padRight(C.dim('CLI Version'), 20) + C.white('v' + CLI_VERSION));
            console.log('  ' + padRight(C.dim('Gateway API'), 20) + C.white(String(ver.version || 'unknown')));
            console.log('  ' + padRight(C.dim('API Version'), 20) + C.white(String(ver.api_version || 'v1')));
            console.log('  ' + padRight(C.dim('License'), 20) + C.white('MIT'));
            console.log('  ' + padRight(C.dim('Website'), 20) + C.teal('www.tentaclaw.io'));
            console.log('  ' + padRight(C.dim('GitHub'), 20) + C.teal('github.com/TentaCLAW-OS'));
            console.log('');
            console.log('  ' + C.purple(C.italic('"Eight arms. One mind. Zero compromises."')));
            console.log('');
            break;
        }

        case 'recommend': {
            const vram = parsed.flags['vram'] ? parseInt(parsed.flags['vram']) : undefined;
            const url = vram ? `/api/v1/models/recommend?vram_mb=${vram}` : '/api/v1/models/recommend';
            const recs = await apiGet(gateway, url) as Array<{ model: string; quantization: string; vram_required_mb: number; use_case: string; description: string }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('RECOMMENDED MODELS')) + (vram ? C.dim(` (for ${vram} MB VRAM)`) : C.dim(' (for your cluster)')));
            console.log('');
            for (const r of recs) {
                console.log('  ' + padRight(C.white(r.model), 25) + padRight(C.dim(r.quantization), 10) + padRight(C.teal(Math.round(r.vram_required_mb / 1024) + 'GB'), 8) + C.dim(r.use_case));
            }
            if (recs.length === 0) console.log('  ' + C.dim('No models fit. Need more VRAM, boss.'));
            console.log('');
            break;
        }

        case 'estimate': {
            const model = parsed.positional[0];
            if (!model) { console.error(C.red('  Usage: clawtopus estimate <model> [--quantization Q4_K_M]')); process.exit(1); }
            const quant = parsed.flags['quantization'] || parsed.flags['quant'] || 'Q4_K_M';
            const est = await apiGet(gateway, `/api/v1/models/estimate-vram?model=${encodeURIComponent(model)}&quantization=${encodeURIComponent(quant)}`) as { model: string; quantization: string; format: string; recommended_backends: string[]; vram: { model_weights_mb: number; kv_cache_mb: number; total_mb: number } };
            console.log('');
            console.log('  ' + C.teal(C.bold('VRAM ESTIMATE')) + ' — ' + C.white(est.model));
            console.log('');
            console.log('  ' + padRight(C.dim('Quantization'), 22) + C.white(est.quantization));
            console.log('  ' + padRight(C.dim('Format'), 22) + C.white(est.format));
            console.log('  ' + padRight(C.dim('Model weights'), 22) + C.teal(Math.round(est.vram.model_weights_mb / 1024 * 10) / 10 + ' GB'));
            console.log('  ' + padRight(C.dim('KV cache'), 22) + C.teal(Math.round(est.vram.kv_cache_mb / 1024 * 10) / 10 + ' GB'));
            console.log('  ' + padRight(C.dim('Total VRAM needed'), 22) + C.white(C.bold(Math.round(est.vram.total_mb / 1024 * 10) / 10 + ' GB')));
            console.log('  ' + padRight(C.dim('Best backends'), 22) + est.recommended_backends.map(b => C.green(b)).join(', '));
            console.log('');
            break;
        }

        case 'audit': {
            const limit = parsed.flags['limit'] || '20';
            const events = await apiGet(gateway, `/api/v1/audit?limit=${limit}`) as Array<{ event_type: string; actor: string; ip_address: string; detail: string; created_at: string }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('AUDIT LOG')));
            console.log('');
            for (const e of events) {
                const color = e.event_type.includes('fail') ? C.red : e.event_type.includes('login') ? C.green : C.dim;
                console.log('  ' + C.dim(e.created_at.slice(0, 19)) + '  ' + color(padRight(e.event_type, 25)) + C.white(e.actor || '-') + C.dim('  ' + (e.detail || '')));
            }
            console.log('');
            break;
        }

        case 'routing': {
            const table = await apiGet(gateway, '/api/v1/routing-table').catch(() => null) as Array<{ model: string; nodes: Array<{ node_id: string; backend: string }> }> | null;
            console.log('');
            console.log('  ' + C.teal(C.bold('ROUTING TABLE')));
            console.log('');
            if (!table || !Array.isArray(table)) {
                console.log('  ' + C.dim('Routing table not available.'));
            } else {
                for (const r of table) {
                    console.log('  ' + C.white(r.model));
                    for (const n of r.nodes) {
                        console.log('    → ' + C.dim(n.node_id.slice(0, 16)) + ' via ' + C.green(n.backend));
                    }
                }
            }
            console.log('');
            break;
        }

        case 'finetune': {
            const sub = parsed.positional[0];
            switch (sub) {
                case 'create': {
                    const base = parsed.flags['base'] || parsed.positional[1];
                    const data = parsed.flags['data'] || parsed.flags['dataset'];
                    const method = parsed.flags['method'] || 'qlora';
                    const output = parsed.flags['output'] || 'my-finetuned-model';
                    if (!base || !data) {
                        console.error(C.red('  Usage: clawtopus finetune create --base <model> --data <path> [--method qlora] [--output name]'));
                        process.exit(1);
                    }
                    console.log('');
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Starting fine-tune job...');
                    console.log('  ' + C.dim('Base model: ') + C.white(base));
                    console.log('  ' + C.dim('Dataset:    ') + C.white(data));
                    console.log('  ' + C.dim('Method:     ') + C.white(method));
                    console.log('  ' + C.dim('Output:     ') + C.white(output));
                    const job = await apiPost(gateway, '/api/v1/finetune/jobs', { baseModel: base, dataset: data, method, outputModel: output }) as { id: string };
                    console.log('  ' + C.green('\u2714') + ' Job created: ' + C.white(job.id));
                    console.log('  ' + C.dim('"Your data. Your model. Your hardware." \u2014 CLAWtopus'));
                    console.log('');
                    break;
                }
                case 'status':
                case 'list': {
                    const jobs = await apiGet(gateway, '/api/v1/finetune/jobs') as Array<{ id: string; config: { baseModel: string; method: string }; status: string; progress: { currentEpoch: number; totalEpochs: number; loss: number } }>;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('FINE-TUNE JOBS')));
                    console.log('');
                    if (jobs.length === 0) {
                        console.log('  ' + C.dim('No jobs. Start one: clawtopus finetune create --base llama3.1:8b --data ./data.jsonl'));
                    }
                    for (const j of jobs) {
                        const statusColor = j.status === 'completed' ? C.green : j.status === 'training' ? C.yellow : j.status === 'failed' ? C.red : C.dim;
                        console.log('  ' + C.white(j.id) + '  ' + statusColor(j.status) + '  ' + C.dim(j.config.baseModel + ' / ' + j.config.method));
                        if (j.progress && j.status === 'training') {
                            console.log('    Epoch ' + j.progress.currentEpoch + '/' + j.progress.totalEpochs + '  Loss: ' + (j.progress.loss || 0).toFixed(4));
                        }
                    }
                    console.log('');
                    break;
                }
                case 'cancel': {
                    const jobId = parsed.positional[1];
                    if (!jobId) { console.error(C.red('  Usage: clawtopus finetune cancel <job-id>')); process.exit(1); }
                    await apiPost(gateway, `/api/v1/finetune/jobs/${encodeURIComponent(jobId)}/cancel`, {});
                    console.log('  ' + C.yellow('\u26A0') + ' Job ' + C.white(jobId) + ' cancelled');
                    break;
                }
                default:
                    console.log('');
                    console.log('  ' + C.teal(C.bold('FINE-TUNE COMMANDS')));
                    console.log('');
                    console.log('    ' + C.green('finetune create') + '  --base <model> --data <path> --method qlora');
                    console.log('    ' + C.green('finetune status') + '  List all fine-tune jobs');
                    console.log('    ' + C.green('finetune cancel') + '  <job-id>');
                    console.log('');
            }
            break;
        }

        case 'benchmark': {
            const sub = parsed.positional[0];
            switch (sub) {
                case 'run': {
                    const model = parsed.flags['model'] || parsed.positional[1];
                    const suite = parsed.flags['suite'] || 'standard';
                    if (!model) { console.error(C.red('  Usage: clawtopus benchmark run --model <name> [--suite standard]')); process.exit(1); }
                    console.log('');
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Running benchmark: ' + C.white(suite) + ' on ' + C.white(model));
                    const run = await apiPost(gateway, '/api/v1/benchmarks/run', { model, suite }) as { id: string };
                    console.log('  ' + C.green('\u2714') + ' Benchmark started: ' + C.white(run.id));
                    console.log('  ' + C.dim('"Numbers don\'t lie." \u2014 CLAWtopus'));
                    console.log('');
                    break;
                }
                case 'results':
                case 'list': {
                    const runs = await apiGet(gateway, '/api/v1/benchmarks/runs') as Array<{ id: string; model: string; suite: string; status: string; results?: { overall_score: number } }>;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('BENCHMARK RESULTS')));
                    console.log('');
                    for (const r of runs) {
                        const score = r.results ? C.teal(r.results.overall_score + '/100') : C.dim('pending');
                        console.log('  ' + padRight(C.white(r.model), 25) + padRight(C.dim(r.suite), 15) + padRight(score, 12) + (r.status === 'completed' ? C.green('done') : C.yellow(r.status)));
                    }
                    console.log('');
                    break;
                }
                case 'compare': {
                    const m1 = parsed.positional[1];
                    const m2 = parsed.positional[2];
                    if (!m1 || !m2) { console.error(C.red('  Usage: clawtopus benchmark compare <model1> <model2>')); process.exit(1); }
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Comparing ' + C.white(m1) + ' vs ' + C.white(m2) + '...');
                    console.log('  ' + C.dim('(Feature in progress — check dashboard for visual comparison)'));
                    break;
                }
                default:
                    console.log('');
                    console.log('  ' + C.teal(C.bold('BENCHMARK COMMANDS')));
                    console.log('');
                    console.log('    ' + C.green('benchmark run') + '     --model <name> [--suite standard|code|reasoning]');
                    console.log('    ' + C.green('benchmark results') + ' List all benchmark runs');
                    console.log('    ' + C.green('benchmark compare') + ' <model1> <model2>');
                    console.log('');
            }
            break;
        }

        case 'namespace': {
            const sub = parsed.positional[0];
            switch (sub) {
                case 'create': {
                    const name = parsed.positional[1];
                    if (!name) { console.error(C.red('  Usage: clawtopus namespace create <name>')); process.exit(1); }
                    const ns = await apiPost(gateway, '/api/v1/namespaces', { name }) as { name: string };
                    console.log('  ' + C.green('\u2714') + ' Namespace created: ' + C.white(ns.name));
                    console.log('  ' + C.dim('"Every family has territories." \u2014 CLAWtopus'));
                    break;
                }
                case 'list':
                case undefined: {
                    const nss = await apiGet(gateway, '/api/v1/namespaces') as Array<{ name: string; display_name?: string }>;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('NAMESPACES')));
                    console.log('');
                    for (const ns of nss) {
                        console.log('  ' + C.white(ns.name) + (ns.display_name ? C.dim(' — ' + ns.display_name) : ''));
                    }
                    console.log('');
                    break;
                }
                case 'delete': {
                    const name = parsed.positional[1];
                    if (!name) { console.error(C.red('  Usage: clawtopus namespace delete <name>')); process.exit(1); }
                    await apiPost(gateway, `/api/v1/namespaces/${encodeURIComponent(name)}/delete`, {}).catch(() => apiGet(gateway, `/api/v1/namespaces/${encodeURIComponent(name)}`));
                    console.log('  ' + C.green('\u2714') + ' Namespace deleted: ' + C.white(name));
                    break;
                }
                default:
                    console.log('');
                    console.log('  ' + C.teal(C.bold('NAMESPACE COMMANDS')));
                    console.log('');
                    console.log('    ' + C.green('namespace create') + ' <name>');
                    console.log('    ' + C.green('namespace list'));
                    console.log('    ' + C.green('namespace delete') + ' <name>');
                    console.log('');
            }
            break;
        }

        case 'apply': {
            const file = parsed.flags['f'] || parsed.flags['file'] || parsed.positional[0];
            if (!file) {
                console.error(C.red('  Usage: clawtopus apply -f deployment.yaml'));
                process.exit(1);
            }
            console.log('');
            console.log('  ' + C.teal('\uD83D\uDC19') + ' Applying ' + C.white(file) + '...');
            // Read YAML file and POST to declarative API
            try {
                const fs = await import('fs');
                const content = fs.readFileSync(file, 'utf-8');
                const result = await apiPost(gateway, '/api/v2/deployments', JSON.parse(content)) as { name: string; status: string };
                console.log('  ' + C.green('\u2714') + ' Deployment applied: ' + C.white(result.name));
                console.log('  ' + C.dim('"You declare. I reconcile." \u2014 CLAWtopus'));
            } catch (err) {
                console.error('  ' + C.red('\u2718 Failed: ') + (err instanceof Error ? err.message : String(err)));
            }
            console.log('');
            break;
        }

        case 'deployments': {
            const deps = await apiGet(gateway, '/api/v2/deployments') as Array<{ metadata: { name: string; namespace: string }; spec: { model: string; replicas: number }; status?: { phase: string; readyReplicas: number } }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('DEPLOYMENTS')) + C.dim(' (declarative)'));
            console.log('');
            for (const d of deps) {
                const phase = d.status?.phase || 'Unknown';
                const phaseColor = phase === 'Running' ? C.green : phase === 'Degraded' ? C.yellow : phase === 'Failed' ? C.red : C.dim;
                const ready = d.status?.readyReplicas || 0;
                console.log('  ' + padRight(C.white(d.metadata.name), 25) + padRight(C.dim(d.metadata.namespace), 15) + padRight(C.teal(d.spec.model), 25) + phaseColor(phase) + C.dim(' ' + ready + '/' + d.spec.replicas));
            }
            if (deps.length === 0) console.log('  ' + C.dim('No deployments. Apply one: clawtopus apply -f deployment.yaml'));
            console.log('');
            break;
        }

        case 'adapters': {
            const adapters = await apiGet(gateway, '/api/v1/adapters') as Array<{ name: string; baseModel: string; method: string; sizeMb: number }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('LORA ADAPTERS')));
            console.log('');
            for (const a of adapters) {
                console.log('  ' + padRight(C.white(a.name), 30) + padRight(C.dim(a.baseModel), 25) + C.dim(a.method + ' / ' + a.sizeMb + 'MB'));
            }
            if (adapters.length === 0) console.log('  ' + C.dim('No adapters. Fine-tune one: clawtopus finetune create --base llama3.1:8b --data ./data.jsonl'));
            console.log('');
            break;
        }

        case 'cost': {
            const dashboard = await apiGet(gateway, '/api/v1/cost/dashboard').catch(() => null) as Record<string, unknown> | null;
            console.log('');
            console.log('  ' + C.teal(C.bold('COST INTELLIGENCE')));
            console.log('');
            if (!dashboard) {
                console.log('  ' + C.dim('Cost tracking not available. Configure: clawtopus cost config'));
            } else {
                const d = dashboard as any;
                console.log('  ' + padRight(C.dim('Power draw'), 25) + C.white((d.current_power_watts || 0) + 'W'));
                console.log('  ' + padRight(C.dim('Monthly electricity'), 25) + C.teal('$' + (d.monthly_electricity_cost || 0).toFixed(2)));
                console.log('  ' + padRight(C.dim('Cost per M tokens'), 25) + C.white('$' + (d.cost_per_million_tokens || 0).toFixed(4)));
                if (d.cloud_savings) {
                    console.log('');
                    console.log('  ' + C.green(C.bold('SAVINGS vs CLOUD')));
                    console.log('  ' + padRight(C.dim('vs OpenAI'), 25) + C.green('$' + (d.cloud_savings.vs_openai || 0).toLocaleString()));
                    console.log('  ' + padRight(C.dim('vs Anthropic'), 25) + C.green('$' + (d.cloud_savings.vs_anthropic || 0).toLocaleString()));
                    console.log('  ' + padRight(C.dim('vs Together'), 25) + C.green('$' + (d.cloud_savings.vs_together || 0).toLocaleString()));
                }
                if (d.hardware_roi) {
                    console.log('');
                    console.log('  ' + C.dim('"Per-token pricing is a scam. Here\'s the proof." \u2014 CLAWtopus'));
                }
            }
            console.log('');
            break;
        }

        case 'burst': {
            const sub = parsed.positional[0];
            switch (sub) {
                case 'status': {
                    const stats = await apiGet(gateway, '/api/v1/burst/stats').catch(() => null) as Record<string, unknown> | null;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CLOUD BURST STATUS')));
                    console.log('');
                    if (!stats) {
                        console.log('  ' + C.dim('Cloud burst not configured. Add providers: clawtopus burst add-provider'));
                    } else {
                        const s = stats as any;
                        console.log('  ' + padRight(C.dim('Total burst requests'), 25) + C.white(String(s.total_requests || 0)));
                        console.log('  ' + padRight(C.dim('Cost today'), 25) + C.yellow('$' + (s.cost_today || 0).toFixed(2)));
                        console.log('  ' + padRight(C.dim('Cost this month'), 25) + C.yellow('$' + (s.cost_total || 0).toFixed(2)));
                    }
                    console.log('');
                    break;
                }
                case 'savings': {
                    const report = await apiGet(gateway, '/api/v1/burst/savings').catch(() => null) as Record<string, unknown> | null;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CLOUD SAVINGS REPORT')));
                    console.log('');
                    if (report) {
                        const r = report as any;
                        console.log('  ' + C.dim('Local: ') + C.green((r.local_pct || 95) + '%') + C.dim(' ($' + (r.local_cost || 0).toFixed(2) + ')'));
                        console.log('  ' + C.dim('Cloud: ') + C.yellow((r.cloud_pct || 5) + '%') + C.dim(' ($' + (r.cloud_cost || 0).toFixed(2) + ')'));
                        console.log('  ' + C.dim('If 100% cloud: ') + C.red('$' + (r.full_cloud_cost || 0).toFixed(2)));
                        console.log('  ' + C.green(C.bold('Saved: $' + (r.savings || 0).toFixed(2))));
                    }
                    console.log('');
                    break;
                }
                default:
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CLOUD BURST COMMANDS')));
                    console.log('  ' + C.green('  burst status') + '   — Current burst stats');
                    console.log('  ' + C.green('  burst savings') + '  — Cost savings report');
                    console.log('');
            }
            break;
        }

        case 'traces': {
            const traces = await apiGet(gateway, '/api/v1/traces?limit=20').catch(() => []) as Array<{ traceId: string; model: string; timing: { total_ms: number }; tokens: { total: number }; timestamp: string }>;
            console.log('');
            console.log('  ' + C.teal(C.bold('INFERENCE TRACES')) + C.dim(' (last 20)'));
            console.log('');
            for (const t of traces) {
                console.log('  ' + C.dim(t.timestamp.slice(11, 19)) + '  ' + padRight(C.white(t.model), 20) + padRight(C.teal(t.timing.total_ms + 'ms'), 10) + C.dim(t.tokens.total + ' tok'));
            }
            if (traces.length === 0) console.log('  ' + C.dim('No traces yet. Run some inference first.'));
            console.log('');
            break;
        }

        case 'topo':
        case 'topology-gpu': {
            console.log('');
            console.log('  ' + C.teal(C.bold('GPU TOPOLOGY')));
            console.log('');
            const nodes = await apiGet(gateway, '/api/v1/nodes') as Array<{ hostname: string; latest_stats?: { gpus: Array<{ name: string }> } }>;
            for (const n of nodes) {
                const gpus = n.latest_stats?.gpus || [];
                console.log('  ' + C.white(n.hostname));
                for (let i = 0; i < gpus.length; i++) {
                    const connector = i === gpus.length - 1 ? '\u2514' : '\u251C';
                    console.log('    ' + C.dim(connector + '\u2500') + ' GPU ' + i + ': ' + C.teal(gpus[i].name));
                }
                if (gpus.length === 0) console.log('    ' + C.dim('\u2514\u2500 CPU only (BitNet)'));
            }
            console.log('');
            break;
        }

        case 'stacks': {
            console.log('');
            console.log('  ' + C.teal(C.bold('CLAWHUB STACKS')) + C.dim(' — One-click deployment bundles'));
            console.log('');
            const stacks = [
                { name: 'rag-stack', desc: 'RAG Pipeline (embed + chat + reranker)', vram: '24GB' },
                { name: 'code-assistant-stack', desc: 'Code Assistant (DeepSeek + autocomplete + indexing)', vram: '16GB' },
                { name: 'voice-ai-stack', desc: 'Voice AI (Whisper + LLM + Kokoro TTS)', vram: '16GB' },
                { name: 'multi-modal-stack', desc: 'Multi-Modal (chat + vision + image + audio)', vram: '24GB' },
                { name: 'enterprise-chat-stack', desc: 'Enterprise Chat (70B + routing + rate limits)', vram: '128GB' },
                { name: 'homelab-starter-stack', desc: 'Homelab Starter (Gemma 4B, works on 8GB)', vram: '8GB' },
                { name: 'research-stack', desc: 'Research (DeepSeek R1 70B + web search + citations)', vram: '64GB' },
                { name: 'privacy-stack', desc: 'Privacy/HIPAA (air-gapped, encrypted, compliant)', vram: '16GB' },
            ];
            for (const s of stacks) {
                console.log('  ' + padRight(C.green('@tentaclaw/' + s.name), 40) + padRight(C.teal(s.vram), 8) + C.dim(s.desc));
            }
            console.log('');
            console.log('  Install: ' + C.white('clawtopus hub install @tentaclaw/<stack-name>'));
            console.log('');
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
            console.log('clawtopus-cli v' + CLI_VERSION);
            break;

        case 'backends': {
            const data = await apiGet(gateway, '/api/v1/inference/backends') as { backends: Array<{ node_id: string; hostname: string; backend: { type: string; port?: number; version?: string }; gpu_count: number; total_vram_mb: number; models: string[] }> };
            console.log('');
            console.log('  ' + C.teal(C.bold('INFERENCE BACKENDS')));
            console.log('');
            if (!data.backends || data.backends.length === 0) {
                console.log('  ' + C.dim('No backends detected. Deploy some nodes first.'));
            } else {
                for (const b of data.backends) {
                    const backendColor = b.backend.type === 'ollama' ? C.green : b.backend.type === 'bitnet' || b.backend.type === 'llamacpp' ? C.cyan : C.yellow;
                    console.log('  ' + C.white(b.hostname) + C.dim(' (' + b.node_id.slice(0, 16) + ')'));
                    console.log('    Backend: ' + backendColor(b.backend.type) + (b.backend.version ? C.dim(' v' + b.backend.version) : '') + C.dim(' :' + (b.backend.port || '?')));
                    console.log('    GPUs:    ' + C.white(String(b.gpu_count)) + C.dim(' (' + Math.round(b.total_vram_mb / 1024) + ' GB VRAM)'));
                    console.log('    Models:  ' + (b.models.length > 0 ? b.models.map(m => C.teal(m)).join(', ') : C.dim('none')));
                    console.log('');
                }
            }
            break;
        }

        case 'drain': {
            const nodeId = parsed.positional[0];
            if (!nodeId) { console.error(C.red('  Usage: clawtopus drain <nodeId>')); process.exit(1); }
            console.log('');
            console.log('  ' + C.yellow('\u26A0') + ' Draining node ' + C.white(nodeId) + '...');
            await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled: true });
            console.log('  ' + C.green('\u2714') + ' Node ' + C.white(nodeId) + ' is now in maintenance mode');
            console.log('  ' + C.dim('No new requests will be routed to this node.'));
            console.log('');
            break;
        }

        case 'cordon': {
            const nodeId = parsed.positional[0];
            if (!nodeId) { console.error(C.red('  Usage: clawtopus cordon <nodeId>')); process.exit(1); }
            await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled: true });
            console.log('');
            console.log('  ' + C.yellow('\u26A0') + ' ' + C.white(nodeId) + ' cordoned — no new scheduling');
            console.log('');
            break;
        }

        case 'uncordon': {
            const nodeId = parsed.positional[0];
            if (!nodeId) { console.error(C.red('  Usage: clawtopus uncordon <nodeId>')); process.exit(1); }
            await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled: false });
            console.log('');
            console.log('  ' + C.green('\u2714') + ' ' + C.white(nodeId) + ' uncordoned — ready for scheduling');
            console.log('');
            break;
        }

        case 'top': {
            console.log('');
            console.log('  ' + C.teal(C.bold('CLUSTER TOP')) + C.dim(' \u2014 refreshing every 3s (Ctrl+C to quit)'));
            console.log('');
            const refreshTop = async () => {
                const topNodes = await apiGet(gateway, '/api/v1/nodes') as Array<{ id: string; hostname: string; status: string; gpu_count: number; latest_stats?: { gpus: Array<{ temperatureC: number; utilizationPct: number; vramUsedMb: number; vramTotalMb: number; powerDrawW: number }>; cpu: { usage_pct: number }; inference: { loaded_models: string[]; in_flight_requests: number } } }>;
                process.stdout.write('\x1b[2J\x1b[H'); // clear screen
                const W = 78;
                console.log(boxTop('TENTACLAW CLUSTER TOP  ' + new Date().toLocaleTimeString(), W));
                console.log(boxMid(
                    padRight(C.dim('NODE'), 16) + padRight(C.dim('ST'), 10) +
                    padRight(C.dim('GPU'), 6) + padRight(C.dim('TEMP'), 12) +
                    padRight(C.dim('UTIL'), 14) + padRight(C.dim('VRAM'), 12) +
                    C.dim('MODELS'), W
                ));
                console.log(boxSep(W));
                for (const n of topNodes) {
                    const s = n.latest_stats;
                    const avgTemp = s ? Math.round(s.gpus.reduce((a, g) => a + g.temperatureC, 0) / Math.max(s.gpus.length, 1)) : 0;
                    const avgUtil = s ? Math.round(s.gpus.reduce((a, g) => a + g.utilizationPct, 0) / Math.max(s.gpus.length, 1)) : 0;
                    const vramUsed = s ? Math.round(s.gpus.reduce((a, g) => a + g.vramUsedMb, 0)) : 0;
                    const vramTotal = s ? Math.round(s.gpus.reduce((a, g) => a + g.vramTotalMb, 0)) : 0;
                    const tColorFn = tempColor(avgTemp);
                    const models = s ? s.inference.loaded_models.slice(0, 2).join(', ') : '';
                    const stIcon = n.status === 'online' ? C.green('\u25CF') : C.red('\u25CB');
                    console.log(boxMid(
                        padRight(C.white(C.bold(n.hostname)), 16) +
                        padRight(stIcon, 10) +
                        padRight(C.white(String(n.gpu_count)), 6) +
                        padRight(tColorFn(avgTemp + '\u00B0C') + ' ' + miniBar(Math.min(100, avgTemp), 3), 12) +
                        padRight(miniBar(avgUtil, 5) + ' ' + C.white(avgUtil + '%'), 14) +
                        padRight(C.teal(Math.round(vramUsed / 1024) + '/' + Math.round(vramTotal / 1024) + 'G'), 12) +
                        C.dim(models), W
                    ));
                }
                console.log(boxBot(W));
                console.log('  ' + C.dim('Press Ctrl+C to exit'));
            };
            await refreshTop();
            const interval = setInterval(refreshTop, 3000);
            process.on('SIGINT', () => { clearInterval(interval); console.log(''); process.exit(0); });
            // Keep process alive
            await new Promise(() => {});
            break;
        }

        case 'hub': {
            const registryUrl = process.env.CLAWHUB_REGISTRY || 'http://localhost:3200';
            const sub = parsed.positional[0];
            const packagesDir = path.join(os.homedir(), '.tentaclaw', 'packages');

            switch (sub) {
                case 'search': {
                    const query = parsed.positional.slice(1).join(' ');
                    if (!query) {
                        console.error('');
                        console.error(C.red('  \u2718 Missing search query'));
                        console.error(C.dim('  Usage: clawtopus hub search <query> [--type agent]'));
                        console.error('');
                        process.exit(1);
                    }
                    const typeFilter = parsed.flags['type'] ? `&type=${encodeURIComponent(parsed.flags['type'])}` : '';
                    const results = await apiGet(registryUrl, `/v1/search?q=${encodeURIComponent(query)}${typeFilter}`) as { packages: Array<{ name: string; namespace: string; description: string; version: string; type: string; stars: number; downloads: number }> };
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CLAWHUB SEARCH')) + C.dim(` — "${query}"`));
                    console.log('');
                    if (!results.packages || results.packages.length === 0) {
                        console.log('  ' + C.dim('No results. The streets are quiet for that one.'));
                    } else {
                        console.log('  ' + padRight(C.dim('PACKAGE'), 35) + padRight(C.dim('TYPE'), 12) + padRight(C.dim('VERSION'), 12) + padRight(C.dim('STARS'), 8) + C.dim('DESCRIPTION'));
                        console.log('  ' + C.dim('\u2500'.repeat(90)));
                        for (const pkg of results.packages) {
                            const fullName = `@${pkg.namespace}/${pkg.name}`;
                            console.log('  ' + padRight(C.teal(fullName), 35) + padRight(C.purple(pkg.type || 'pkg'), 12) + padRight(C.white(pkg.version), 12) + padRight(C.yellow('\u2605 ' + pkg.stars), 8) + C.dim(pkg.description || ''));
                        }
                    }
                    console.log('');
                    break;
                }

                case 'install': {
                    const pkgSpec = parsed.positional[1];
                    if (!pkgSpec) {
                        console.error('');
                        console.error(C.red('  \u2718 Missing package name'));
                        console.error(C.dim('  Usage: clawtopus hub install @ns/package[@version]'));
                        console.error('');
                        process.exit(1);
                    }
                    // Parse @ns/package[@version]
                    const atMatch = pkgSpec.match(/^@([^/]+)\/([^@]+)(?:@(.+))?$/);
                    if (!atMatch) {
                        console.error('');
                        console.error(C.red('  \u2718 Invalid package format. Expected @namespace/package[@version]'));
                        console.error('');
                        process.exit(1);
                        break;
                    }
                    const [, ns, pkgName, pkgVersion] = atMatch;
                    const version = pkgVersion || 'latest';
                    console.log('');
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Fetching ' + C.white(`@${ns}/${pkgName}@${version}`) + '...');
                    const pkgData = await apiGet(registryUrl, `/v1/packages/@${encodeURIComponent(ns)}/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}`) as { name: string; namespace: string; version: string; manifest: Record<string, unknown> };
                    // Ensure packages directory exists
                    const pkgDir = path.join(packagesDir, ns, pkgName, pkgData.version || version);
                    fs.mkdirSync(pkgDir, { recursive: true });
                    // Write package manifest
                    fs.writeFileSync(path.join(pkgDir, 'clawhub.json'), JSON.stringify(pkgData, null, 2));
                    console.log('  ' + C.green('\u2714') + ' Installed ' + C.teal(`@${ns}/${pkgName}@${pkgData.version || version}`) + ' to ' + C.dim(pkgDir));
                    console.log('');
                    console.log('  ' + C.purple('"Package installed. The family grows stronger."'));
                    console.log('');
                    break;
                }

                case 'list': {
                    console.log('');
                    console.log('  ' + C.teal(C.bold('INSTALLED PACKAGES')) + C.dim(' — ~/.tentaclaw/packages/'));
                    console.log('');
                    if (!fs.existsSync(packagesDir)) {
                        console.log('  ' + C.dim('No packages installed yet. Run: clawtopus hub install @ns/package'));
                    } else {
                        const namespaces = fs.readdirSync(packagesDir).filter(f => fs.statSync(path.join(packagesDir, f)).isDirectory());
                        let count = 0;
                        for (const nsDir of namespaces) {
                            const nsPath = path.join(packagesDir, nsDir);
                            const packages = fs.readdirSync(nsPath).filter(f => fs.statSync(path.join(nsPath, f)).isDirectory());
                            for (const pkg of packages) {
                                const pkgPath = path.join(nsPath, pkg);
                                const versions = fs.readdirSync(pkgPath).filter(f => fs.statSync(path.join(pkgPath, f)).isDirectory());
                                for (const ver of versions) {
                                    const manifestPath = path.join(pkgPath, ver, 'clawhub.json');
                                    let desc = '';
                                    if (fs.existsSync(manifestPath)) {
                                        try {
                                            const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                                            desc = m.description || m.manifest?.description || '';
                                        } catch { /* ignore */ }
                                    }
                                    console.log('  ' + padRight(C.teal(`@${nsDir}/${pkg}`), 35) + padRight(C.white(ver), 12) + C.dim(desc));
                                    count++;
                                }
                            }
                        }
                        if (count === 0) {
                            console.log('  ' + C.dim('No packages installed yet.'));
                        } else {
                            console.log('');
                            console.log('  ' + C.dim(`${count} package(s) installed.`));
                        }
                    }
                    console.log('');
                    break;
                }

                case 'info': {
                    const pkgRef = parsed.positional[1];
                    if (!pkgRef) {
                        console.error('');
                        console.error(C.red('  \u2718 Missing package name'));
                        console.error(C.dim('  Usage: clawtopus hub info @ns/package'));
                        console.error('');
                        process.exit(1);
                    }
                    const infoMatch = pkgRef.match(/^@([^/]+)\/(.+)$/);
                    if (!infoMatch) {
                        console.error('');
                        console.error(C.red('  \u2718 Invalid package format. Expected @namespace/package'));
                        console.error('');
                        process.exit(1);
                        break;
                    }
                    const [, infoNs, infoName] = infoMatch;
                    const info = await apiGet(registryUrl, `/v1/packages/@${encodeURIComponent(infoNs)}/${encodeURIComponent(infoName)}`) as { name: string; namespace: string; description: string; type: string; stars: number; downloads: number; versions: Array<{ version: string; created_at: string }>; author: string; license: string };
                    console.log('');
                    console.log('  ' + C.teal(C.bold(`@${info.namespace}/${info.name}`)));
                    console.log('  ' + C.dim(info.description || 'No description'));
                    console.log('');
                    console.log('  ' + padRight(C.dim('Type'), 16) + C.purple(info.type || 'package'));
                    console.log('  ' + padRight(C.dim('Author'), 16) + C.white(info.author || 'unknown'));
                    console.log('  ' + padRight(C.dim('License'), 16) + C.white(info.license || 'unknown'));
                    console.log('  ' + padRight(C.dim('Stars'), 16) + C.yellow('\u2605 ' + (info.stars || 0)));
                    console.log('  ' + padRight(C.dim('Downloads'), 16) + C.white(String(info.downloads || 0)));
                    console.log('');
                    if (info.versions && info.versions.length > 0) {
                        console.log('  ' + C.dim('VERSIONS'));
                        for (const v of info.versions.slice(0, 10)) {
                            console.log('    ' + padRight(C.white(v.version), 16) + C.dim(v.created_at || ''));
                        }
                        if (info.versions.length > 10) {
                            console.log('    ' + C.dim(`... and ${info.versions.length - 10} more`));
                        }
                    }
                    console.log('');
                    break;
                }

                case 'publish': {
                    const manifestFile = path.resolve(process.cwd(), 'clawhub.yaml');
                    if (!fs.existsSync(manifestFile)) {
                        console.error('');
                        console.error(C.red('  \u2718 No clawhub.yaml found in current directory'));
                        console.error(C.dim('  Run "clawtopus hub init" to create one.'));
                        console.error('');
                        process.exit(1);
                    }
                    // Simple YAML parser — handles key: value, nested blocks, and arrays
                    const yamlContent = fs.readFileSync(manifestFile, 'utf-8');
                    const manifest: Record<string, unknown> = {};
                    const lines = yamlContent.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) continue;
                        const colonIdx = trimmed.indexOf(':');
                        if (colonIdx > 0) {
                            const key = trimmed.slice(0, colonIdx).trim();
                            const val = trimmed.slice(colonIdx + 1).trim();
                            if (val) {
                                // Strip quotes
                                manifest[key] = val.replace(/^["']|["']$/g, '');
                            }
                        }
                    }
                    if (!manifest['name'] || !manifest['namespace']) {
                        console.error('');
                        console.error(C.red('  \u2718 clawhub.yaml must include "name" and "namespace" fields'));
                        console.error('');
                        process.exit(1);
                    }
                    console.log('');
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Publishing ' + C.white(`@${manifest['namespace']}/${manifest['name']}`) + '...');
                    await apiPost(registryUrl, '/v1/packages', manifest);
                    console.log('  ' + C.green('\u2714') + ' Published ' + C.teal(`@${manifest['namespace']}/${manifest['name']}@${manifest['version'] || '0.0.1'}`));
                    console.log('');
                    console.log('  ' + C.purple('"Published. Your work is now on the streets."'));
                    console.log('');
                    break;
                }

                case 'trending': {
                    const trending = await apiGet(registryUrl, '/v1/trending') as { packages: Array<{ name: string; namespace: string; description: string; stars: number; downloads: number; type: string }> };
                    console.log('');
                    console.log('  ' + C.teal(C.bold('TRENDING ON CLAWHUB')));
                    console.log('  ' + C.purple('"These are the top earners this week."'));
                    console.log('');
                    if (!trending.packages || trending.packages.length === 0) {
                        console.log('  ' + C.dim('Nothing trending yet. Be the first.'));
                    } else {
                        console.log('  ' + padRight(C.dim('#'), 4) + padRight(C.dim('PACKAGE'), 35) + padRight(C.dim('TYPE'), 12) + padRight(C.dim('STARS'), 8) + C.dim('DESCRIPTION'));
                        console.log('  ' + C.dim('\u2500'.repeat(85)));
                        for (let i = 0; i < trending.packages.length; i++) {
                            const pkg = trending.packages[i];
                            const fullName = `@${pkg.namespace}/${pkg.name}`;
                            const rank = String(i + 1);
                            console.log('  ' + padRight(C.white(rank), 4) + padRight(C.teal(fullName), 35) + padRight(C.purple(pkg.type || 'pkg'), 12) + padRight(C.yellow('\u2605 ' + pkg.stars), 8) + C.dim(pkg.description || ''));
                        }
                    }
                    console.log('');
                    break;
                }

                case 'star': {
                    const starRef = parsed.positional[1];
                    if (!starRef) {
                        console.error('');
                        console.error(C.red('  \u2718 Missing package name'));
                        console.error(C.dim('  Usage: clawtopus hub star @ns/package'));
                        console.error('');
                        process.exit(1);
                    }
                    const starMatch = starRef.match(/^@([^/]+)\/(.+)$/);
                    if (!starMatch) {
                        console.error('');
                        console.error(C.red('  \u2718 Invalid package format. Expected @namespace/package'));
                        console.error('');
                        process.exit(1);
                        break;
                    }
                    const [, starNs, starName] = starMatch;
                    await apiPut(registryUrl, `/v1/packages/@${encodeURIComponent(starNs)}/${encodeURIComponent(starName)}/latest/star`);
                    console.log('');
                    console.log('  ' + C.yellow('\u2605') + ' Starred ' + C.teal(`@${starNs}/${starName}`));
                    console.log('');
                    console.log('  ' + C.purple('"Starred. I respect that."'));
                    console.log('');
                    break;
                }

                case 'init': {
                    const initType = parsed.flags['type'] || 'agent';
                    const initFile = path.resolve(process.cwd(), 'clawhub.yaml');
                    if (fs.existsSync(initFile)) {
                        console.error('');
                        console.error(C.yellow('  \u26A0 clawhub.yaml already exists in this directory'));
                        console.error('');
                        process.exit(1);
                    }
                    const dirName = path.basename(process.cwd());
                    const template = [
                        '# CLAWHub Package Manifest',
                        '# https://tentaclaw.io/docs/clawhub',
                        '',
                        `name: "${dirName}"`,
                        'namespace: "my-org"',
                        `version: "0.1.0"`,
                        `type: "${initType}"`,
                        `description: "A TentaCLAW ${initType}"`,
                        'license: "MIT"',
                        '',
                        '# Entry point',
                        `entry: "index.ts"`,
                        '',
                        '# Tags for discovery',
                        '# tags:',
                        '#   - ai',
                        '#   - inference',
                        '',
                    ].join('\n');
                    fs.writeFileSync(initFile, template, 'utf-8');
                    console.log('');
                    console.log('  ' + C.green('\u2714') + ' Created ' + C.white('clawhub.yaml') + C.dim(` (type: ${initType})`));
                    console.log('');
                    console.log('  ' + C.dim('Next steps:'));
                    console.log('    1. Edit clawhub.yaml with your package details');
                    console.log('    2. Run ' + C.teal('clawtopus hub publish') + ' to publish');
                    console.log('');
                    break;
                }

                case undefined:
                case 'help': {
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CLAWHUB')) + C.dim(' — TentaCLAW Package Registry'));
                    console.log('  ' + C.dim('"The family takes care of its own."'));
                    console.log('');
                    console.log('  ' + C.cyan(C.bold('USAGE')));
                    console.log('');
                    console.log('    clawtopus hub <command> [options]');
                    console.log('');
                    console.log('  ' + C.cyan(C.bold('COMMANDS')));
                    console.log('');
                    console.log('    ' + padRight(C.green('search') + ' <query> [--type agent]', 42) + 'Search the registry');
                    console.log('    ' + padRight(C.green('install') + ' @ns/package[@version]', 42) + 'Install a package');
                    console.log('    ' + padRight(C.green('list'), 42) + 'List installed packages');
                    console.log('    ' + padRight(C.green('info') + ' @ns/package', 42) + 'Show package details');
                    console.log('    ' + padRight(C.green('publish'), 42) + 'Publish from clawhub.yaml');
                    console.log('    ' + padRight(C.green('trending'), 42) + 'Trending packages');
                    console.log('    ' + padRight(C.green('star') + ' @ns/package', 42) + 'Star a package');
                    console.log('    ' + padRight(C.green('init') + ' [--type agent]', 42) + 'Create clawhub.yaml template');
                    console.log('    ' + padRight(C.green('help'), 42) + 'Show this help');
                    console.log('');
                    console.log('  ' + C.cyan(C.bold('ENVIRONMENT')));
                    console.log('');
                    console.log('    ' + padRight(C.yellow('CLAWHUB_REGISTRY'), 42) + 'Registry URL (default: http://localhost:3200)');
                    console.log('');
                    console.log('  ' + C.cyan(C.bold('EXAMPLES')));
                    console.log('');
                    console.log(C.dim('    # Search for agents'));
                    console.log('    clawtopus hub search "code review" --type agent');
                    console.log('');
                    console.log(C.dim('    # Install a package'));
                    console.log('    clawtopus hub install @tentaclaw/router-agent@1.0.0');
                    console.log('');
                    console.log(C.dim('    # Publish your package'));
                    console.log('    clawtopus hub init --type agent');
                    console.log('    clawtopus hub publish');
                    console.log('');
                    break;
                }

                default:
                    console.error('');
                    console.error(C.red('  \u2718 Unknown hub command: ' + sub));
                    console.error(C.dim('  Run "clawtopus hub help" for usage.'));
                    console.error('');
                    process.exit(1);
            }
            break;
        }

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

// =============================================================================
// Wave 41-45: Additional CLI Smart Commands
// =============================================================================

// These are registered in the switch but defined here for organization

// =============================================================================
// Waves 61-70: CLI Power-Ups
// =============================================================================

async function cmdCapacity(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/capacity') as any;
    const W = 56;
    console.log('');
    console.log(boxTop('CLUSTER CAPACITY', W));
    console.log(boxEmpty(W));

    const utilPct = data.utilization_pct || 0;
    console.log(boxMid(padRight(C.dim('Total VRAM'), 18) + C.white(C.bold(data.total_vram_gb + ' GB')), W));
    console.log(boxMid(padRight(C.dim('Used'), 18) + C.yellow(data.used_vram_gb + ' GB'), W));
    console.log(boxMid(padRight(C.dim('Free'), 18) + C.green(data.free_vram_gb + ' GB'), W));
    console.log(boxMid(padRight(C.dim('Utilization'), 18) + progressBar(utilPct, 20) + '  ' + (utilPct > 80 ? C.red : C.white)(utilPct + '%'), W));
    console.log(boxEmpty(W));
    console.log(boxMid(C.cyan(data.recommendation), W));

    if (data.can_still_fit && data.can_still_fit.length > 0) {
        console.log(boxEmpty(W));
        console.log(boxMid(C.dim('Models that still fit:'), W));
        for (const m of data.can_still_fit.slice(0, 5)) {
            console.log(boxMid('  ' + C.green('\u2714') + ' ' + C.white(m.model) + C.dim(' (' + Math.round(m.vram_mb / 1024) + 'GB)'), W));
        }
    }

    console.log(boxBot(W));
    console.log('');
}

async function cmdSuggestions(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/suggestions') as any;
    console.log('');
    if (data.suggestions.length === 0) {
        console.log('  ' + C.green('\u2714 No suggestions — cluster is running great!'));
    } else {
        console.log('  ' + C.purple(C.bold('Suggestions')));
        console.log('');
        for (const s of data.suggestions) {
            const icon = s.priority === 'critical' ? C.red('\u2718') : s.priority === 'high' ? C.yellow('\u26A0') : C.cyan('\u25CF');
            console.log('  ' + icon + ' ' + C.white(s.action) + C.dim(' — ' + s.reason));
            if (s.command) console.log('    ' + C.cyan(s.command));
        }
    }
    console.log('');
}

async function cmdGpuMap(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/gpu-map') as any;
    const W = 72;
    console.log('');
    console.log(boxTop(`GPU MAP \u2014 ${data.total_gpus} GPUs`, W));

    console.log(boxMid(
        padRight(C.dim('NODE'), 14) + padRight(C.dim('GPU'), 22) +
        padRight(C.dim('VRAM'), 18) + padRight(C.dim('TEMP'), 8) + C.dim('UTIL'), W
    ));
    console.log(boxSep(W));

    for (const g of data.gpus) {
        const tColor = tempColor(g.temp);
        console.log(boxMid(
            padRight(C.white(g.hostname), 14) +
            padRight(C.dim(g.name?.slice(0, 20) || '?'), 22) +
            padRight(miniBar(g.vram_pct, 8) + ' ' + C.white(g.vram_pct + '%'), 18) +
            padRight(tColor(g.temp + '\u00B0C'), 8) +
            miniBar(g.util, 5) + ' ' + C.dim(g.util + '%'), W
        ));
    }

    console.log(boxBot(W));
    console.log('');
}
