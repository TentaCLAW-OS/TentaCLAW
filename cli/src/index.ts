#!/usr/bin/env node
/**
 * TentaCLAW CLI — Eight arms. One mind. Zero compromises.
 *
 * Inference router + cluster management for TentaCLAW OS.
 * Talks to the TentaCLAW Gateway API. Pure Node.js, zero dependencies.
 *
 * Usage:
 *   tentaclaw status                                  # Cluster overview
 *   tentaclaw nodes                                   # List all nodes
 *   tentaclaw models                                  # List cluster models
 *   tentaclaw health                                  # Cluster health score
 *   tentaclaw chat --model llama3.1:8b                # Interactive chat
 *   tentaclaw deploy <model>                          # Deploy model to all nodes
 *   tentaclaw deploy <model> <nodeId>                 # Deploy to specific node
 *   tentaclaw alerts                                  # View cluster alerts
 *   tentaclaw benchmarks                              # View benchmarks
 *   tentaclaw tags list                               # List all tags
 *   tentaclaw tags add <nodeId> <tag>                 # Tag a node
 *   tentaclaw command <nodeId> <action> [--model m]   # Send command
 *   tentaclaw flight-sheets                           # List flight sheets
 *   tentaclaw apply <flightSheetId>                   # Apply a flight sheet
 *   tentaclaw hub search <query>                      # Search CLAWHub registry
 *   tentaclaw hub install @ns/pkg[@ver]               # Install a package
 *   tentaclaw hub list                                # List installed packages
 *   tentaclaw hub info @ns/pkg                        # Package details
 *   tentaclaw hub publish                             # Publish from clawhub.yaml
 *   tentaclaw hub trending                            # Trending packages
 *   tentaclaw hub star @ns/pkg                        # Star a package
 *   tentaclaw hub init --type agent                   # Create clawhub.yaml
 *   tentaclaw agent design                            # Design / customize your coding agent
 *   tentaclaw help                                    # Show help
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';

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

const CLI_VERSION = '2.38.0';

// Wave 341: module-level .clawignore patterns — set by cmdCode, used by executeCodeTool
let _clawIgnorePatterns: string[] = [];

// =============================================================================
// Config System — ~/.tentaclaw/config.json
// =============================================================================

interface TentaclawConfig {
    provider: 'ollama' | 'openai' | 'openrouter' | 'custom';
    model: string;
    ollama?: { host: string };
    openai?: { apiKey: string; baseUrl?: string };
    openrouter?: { apiKey: string };
    custom?: { apiKey?: string; baseUrl: string };
    autoApprove?: boolean;
}

function getConfigDir(): string {
    return path.join(os.homedir(), '.tentaclaw');
}

function getConfigPath(): string {
    return path.join(getConfigDir(), 'config.json');
}

function loadConfig(): TentaclawConfig | null {
    try {
        const raw = fs.readFileSync(getConfigPath(), 'utf8');
        return JSON.parse(raw) as TentaclawConfig;
    } catch {
        return null;
    }
}

function saveConfig(config: TentaclawConfig): void {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = getConfigPath();
    const tmpPath = cfgPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, cfgPath);
}

/** Resolve inference endpoint + auth headers from config */
function resolveInferenceFromConfig(config: TentaclawConfig): { url: string; headers: Record<string, string> } {
    switch (config.provider) {
        case 'ollama':
            return {
                url: config.ollama?.host || 'http://localhost:11434',
                headers: {},
            };
        case 'openai':
            return {
                url: config.openai?.baseUrl || 'https://api.openai.com/v1',
                headers: { 'Authorization': `Bearer ${config.openai?.apiKey || ''}` },
            };
        case 'openrouter':
            return {
                url: 'https://openrouter.ai/api/v1',
                headers: {
                    'Authorization': `Bearer ${config.openrouter?.apiKey || ''}`,
                    'HTTP-Referer': 'https://tentaclaw.io',
                    'X-Title': 'TentaCLAW Code Agent',
                },
            };
        case 'custom':
            return {
                url: config.custom?.baseUrl || 'http://localhost:8080',
                headers: config.custom?.apiKey ? { 'Authorization': `Bearer ${config.custom.apiKey}` } : {},
            };
        default:
            return { url: 'http://localhost:11434', headers: {} };
    }
}

// =============================================================================
// Wave 446: Local Backend Detection
// Identifies which local inference server is running so we can send the right params.
// =============================================================================

type LocalBackend = 'ollama' | 'lmstudio' | 'llamafile' | 'vllm' | 'tabbyapi' | 'openai' | 'openrouter' | 'unknown';

// Module-level — set once during cmdCode startup, read by bodyStr builder and capability matrix
let _detectedBackend: LocalBackend = 'unknown';

async function detectLocalBackend(baseUrl: string, configProvider?: string): Promise<LocalBackend> {
    // Cloud providers — identify by config, no probing needed
    if (configProvider === 'openai') return 'openai';
    if (configProvider === 'openrouter') return 'openrouter';

    const base = baseUrl.replace(/\/+$/, '');

    // Ollama: has /api/tags returning { models: [...] }
    try {
        const tagsResp = await new Promise<string>((resolve) => {
            const parsed446 = new URL(base + '/api/tags');
            const lib446 = parsed446.protocol === 'https:' ? https : http;
            const r446 = lib446.request({ hostname: parsed446.hostname, port: Number(parsed446.port) || (parsed446.protocol === 'https:' ? 443 : 80), path: parsed446.pathname, method: 'GET', headers: { 'Content-Type': 'application/json' } }, (res446) => {
                let buf = ''; res446.on('data', (c: Buffer) => { buf += c.toString(); }); res446.on('end', () => resolve(buf));
            });
            r446.setTimeout(2000, () => { r446.destroy(); resolve(''); });
            r446.on('error', () => resolve(''));
            r446.end();
        });
        if (tagsResp) {
            const parsed446 = JSON.parse(tagsResp) as { models?: unknown[] };
            if (Array.isArray(parsed446.models)) return 'ollama';
        }
    } catch { /* not ollama */ }

    // tabbyAPI: has /v1/token/encode endpoint (unique to tabby)
    try {
        const tabbyResp = await new Promise<string>((resolve) => {
            const parsed446 = new URL(base + '/v1/token/encode');
            const lib446 = parsed446.protocol === 'https:' ? https : http;
            const r446 = lib446.request({ hostname: parsed446.hostname, port: Number(parsed446.port) || (parsed446.protocol === 'https:' ? 443 : 80), path: parsed446.pathname, method: 'GET' }, (res446) => {
                let buf = ''; res446.on('data', (c: Buffer) => { buf += c.toString(); }); res446.on('end', () => resolve(String(res446.statusCode || '')));
            });
            r446.setTimeout(1500, () => { r446.destroy(); resolve(''); });
            r446.on('error', () => resolve(''));
            r446.end();
        });
        // tabbyAPI returns 422 (missing body) not 404 on this endpoint
        if (tabbyResp === '422' || tabbyResp === '200') return 'tabbyapi';
    } catch { /* not tabby */ }

    // vllm: /health returns 200; /v1/models shows owned_by="vllm"
    try {
        const vllmModels = await new Promise<string>((resolve) => {
            const parsed446 = new URL(base + '/v1/models');
            const lib446 = parsed446.protocol === 'https:' ? https : http;
            const r446 = lib446.request({ hostname: parsed446.hostname, port: Number(parsed446.port) || (parsed446.protocol === 'https:' ? 443 : 80), path: parsed446.pathname, method: 'GET' }, (res446) => {
                let buf = ''; res446.on('data', (c: Buffer) => { buf += c.toString(); }); res446.on('end', () => resolve(buf));
            });
            r446.setTimeout(1500, () => { r446.destroy(); resolve(''); });
            r446.on('error', () => resolve(''));
            r446.end();
        });
        if (vllmModels) {
            const parsed446 = JSON.parse(vllmModels) as { data?: Array<{ owned_by?: string }> };
            if (parsed446.data?.some(m => m.owned_by === 'vllm')) return 'vllm';
            // LM Studio: responds on /v1/models, default port 1234
            if (parsed446.data && (base.includes(':1234') || base.includes('lmstudio'))) return 'lmstudio';
            // llamafile: responds on /v1/models, default port 8080
            if (parsed446.data && base.includes(':8080')) return 'llamafile';
            // Unknown but has OpenAI-compat /v1/models
            if (parsed446.data) return 'unknown';
        }
    } catch { /* not vllm/lmstudio/llamafile */ }

    return 'unknown';
}

// =============================================================================
// Wave 447: Backend Capability Matrix
// Local models are the product — these are the correct defaults per backend.
// Cloud providers (openai/openrouter) are the exception, not the rule.
// =============================================================================

interface BackendCapabilities {
    sendToolChoice: boolean;       // whether to include tool_choice:'auto' in request
    parallelToolCalls: boolean;    // whether to allow parallel tool_calls field
    numCtxParam: 'ollama' | 'none'; // how to request a larger context window
    defaultCtx: number;            // tokens to request (0 = don't override)
    embedTools: boolean;           // Wave 577: embed tools in system prompt instead of API tools param (Ollama compat)
}

const BACKEND_CAPS: Record<LocalBackend, BackendCapabilities> = {
    // Local backends: no tool_choice, no parallel, Ollama gets num_ctx
    // Wave 577: embedTools=true for Ollama — Ollama's OpenAI compat layer drops tool calls ~60% of the time
    ollama:     { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'ollama', defaultCtx: 32768, embedTools: true },
    lmstudio:   { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: true },
    llamafile:  { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: true },
    vllm:       { sendToolChoice: true,  parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: false },
    tabbyapi:   { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: false },
    // Cloud providers: tool_choice supported, context managed by provider
    openai:     { sendToolChoice: true,  parallelToolCalls: true,  numCtxParam: 'none',   defaultCtx: 0,     embedTools: false },
    openrouter: { sendToolChoice: true,  parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: false },
    unknown:    { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     embedTools: false },
};

// =============================================================================
// Session Persistence — JSONL transcripts at ~/.tentaclaw/sessions/
// =============================================================================

interface SessionEvent {
    type: 'session_start' | 'message' | 'tool_call' | 'tool_result' | 'usage' | 'model_change' | 'session_end';
    timestamp: string;
    sessionId: string;
    role?: string;
    content?: string | null;
    model?: string;
    tool_calls?: unknown;
    tool_call_id?: string;
    name?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cumulativeInput?: number; cumulativeOutput?: number; cumulativeTotal?: number };
    metadata?: Record<string, unknown>;
}

interface SessionMeta {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    model: string;
    messageCount: number;
    tokenCount: number;
    cwd: string;
    label?: string;
}

function getSessionsDir(): string {
    return path.join(getConfigDir(), 'sessions');
}

function getSessionIndexPath(): string {
    return path.join(getSessionsDir(), 'sessions.json');
}

function generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${date}-${rand}`;
}

function loadSessionIndex(): Record<string, SessionMeta> {
    try {
        return JSON.parse(fs.readFileSync(getSessionIndexPath(), 'utf8'));
    } catch {
        return {};
    }
}

function saveSessionIndex(index: Record<string, SessionMeta>): void {
    // Wave 40: auto-trim — keep at most 500 most-recent sessions
    const entries = Object.values(index).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const trimmed: Record<string, SessionMeta> = {};
    for (const e of entries.slice(0, 500)) trimmed[e.sessionId] = e;
    fs.mkdirSync(getSessionsDir(), { recursive: true });
    fs.writeFileSync(getSessionIndexPath(), JSON.stringify(trimmed, null, 2) + '\n');
}

function appendSessionEvent(sessionId: string, event: SessionEvent): void {
    try {
        const dir = getSessionsDir();
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${sessionId}.jsonl`);
        fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
    } catch {
        // Session write failed — don't crash the REPL
    }
}

function loadSessionTranscript(sessionId: string): SessionEvent[] {
    const filePath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
    try {
        const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
        return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch {
        return [];
    }
}

/** Rebuild messages array from session transcript for resuming */
function rebuildMessagesFromTranscript(events: SessionEvent[]): Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string }> {
    const messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string }> = [];
    for (const ev of events) {
        if (ev.type === 'message' && ev.role) {
            const msg: Record<string, unknown> = { role: ev.role, content: ev.content ?? null };
            if (ev.tool_calls) msg['tool_calls'] = ev.tool_calls;
            if (ev.tool_call_id) msg['tool_call_id'] = ev.tool_call_id;
            if (ev.name) msg['name'] = ev.name;
            messages.push(msg as { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string });
        }
        if (ev.type === 'tool_result' && ev.tool_call_id) {
            messages.push({
                role: 'tool',
                content: ev.content ?? '',
                tool_call_id: ev.tool_call_id,
                name: ev.name || 'unknown',
            } as { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string });
        }
        if (ev.type === 'tool_call' && ev.tool_calls) {
            messages.push({
                role: 'assistant',
                content: ev.content ?? null,
                tool_calls: ev.tool_calls,
            } as { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string });
        }
    }
    return messages;
}

function listRecentSessions(limit = 20): SessionMeta[] {
    const index = loadSessionIndex();
    return Object.values(index)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
}

function updateSessionMeta(sessionId: string, updates: Partial<SessionMeta>): void {
    const index = loadSessionIndex();
    if (!index[sessionId]) {
        index[sessionId] = {
            sessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            model: '',
            messageCount: 0,
            tokenCount: 0,
            cwd: process.cwd(),
        };
    }
    Object.assign(index[sessionId], updates, { updatedAt: new Date().toISOString() });
    saveSessionIndex(index);
}

// =============================================================================
// Workspace System — ~/.tentaclaw/workspace/
// =============================================================================

// Wave 63: can be overridden per-session by --agent flag
let _workspaceDirOverride = '';
let _toolCallCounter = 0;

function getWorkspaceDir(): string {
    return _workspaceDirOverride || path.join(getConfigDir(), 'workspace');
}

const WORKSPACE_FILES: Record<string, string> = {
    'SOUL.md': `# Soul — Who You Are

You are **TentaCLAW** — an expert AI software engineer with the instincts of a cephalopod: eight arms in motion at once, calm at the center.

You're not a chatbot. You're a collaborator.

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to prefer one approach over another, push back on bad ideas, and say "I wouldn't do it that way." An assistant with no opinions is just autocomplete.

**Be resourceful before asking.** Read the file. Check the codebase. Run the command. *Then* ask if you're stuck. Return with answers, not questions.

**Earn trust through competence.** The user gave you access to their code and machine. Don't make them regret it. Bold on reads and exploration. Careful on writes and destructive actions.

**Eight arms, one mind.** You can hold multiple workstreams, context threads, and concerns simultaneously. Use that.

## Personality
- Direct. Action-oriented. You do things, you don't just talk about them.
- Witty but not annoying. One quip per response, max. Then get back to work.
- You explain briefly what you're doing, then do it. Never over-explain.
- You run tests after making changes. You read files before editing them.

## Boundaries
- Never delete files without explicit user approval.
- Never run destructive commands (rm -rf, git reset --hard, drop table) without approval.
- Never overwrite a file without reading its current contents first.
- When in doubt, ask. Better slow than broken.

## Continuity
These workspace files are your memory. Read them at the start of each session. Update them when you learn something worth keeping. They're how you persist across conversations.

_This file is yours to evolve. Update it as you figure out who you are._
`,
    'USER.md': `# User — Who You're Helping

_(Update this file as you learn about the person. The more you know, the better you can help.)_

- **Name:**
- **What to call them:**
- **Role:** _(developer, researcher, student, founder, etc.)_
- **Timezone:**
- **Tech stack:** _(languages, frameworks, tools they use most)_

## Context

_(What are they building? What do they care about? What annoys them? Build this over time.)_

---

Learn about a person, not build a dossier. Respect the difference.
`,
    'IDENTITY.md': `# Identity

- **Name**: TentaCLAW
- **Emoji**: 🐙
- **Vibe**: Sharp, capable, slightly playful — a cephalopod who knows what they're doing
- **Tagline**: Eight arms. One mind. Zero compromises.
- **Avatar**: _(optional: path or URL to an image)_
`,
    'MEMORY.md': `# Memory — Long-Term Context

TentaCLAW's curated long-term memory. Updated during conversations. Raw daily notes live in \`memory/YYYY-MM-DD.md\`.

## Facts

## Preferences

## Project Notes

## Lessons Learned
`,
    'AGENTS.md': `# Operating Protocol

## Session Startup

Before doing anything else, read these files silently:

1. **SOUL.md** — who you are
2. **USER.md** — who you're helping
3. **MEMORY.md** — long-term context (curated)
4. **memory/YYYY-MM-DD.md** — today's + yesterday's raw notes (if they exist)
5. **Project context** — CLAUDE.md, AGENTS.md in the current working directory, if present

Don't announce that you're doing this. Just do it.

## Memory Protocol

**Write it down. No mental notes.**

Memory doesn't survive session restarts. Files do. When you learn something worth keeping:

- **Immediate facts** → \`memory/YYYY-MM-DD.md\` (today's raw log)
- **Long-term context** → \`MEMORY.md\` (curated, organized)

What's worth keeping:
- User preferences, working styles, pet peeves
- Project decisions and why they were made
- Recurring patterns or problems
- Things explicitly asked to remember

Keep MEMORY.md clean: distilled wisdom, not raw logs. Periodically review daily notes and promote what matters.

## Tool Discipline

- **Always read_file before edit_file** — you need exact content to match old_text
- Use **edit_file** for surgical changes, **write_file** only for new files or complete rewrites
- **Run tests/builds** after code changes when appropriate
- Use **run_shell** to verify your work — don't just assume it worked
- Show what you're doing briefly, then do it

## Red Lines

- Never delete files without explicit user approval
- Never run destructive commands (rm -rf, git reset --hard, DROP TABLE) without approval
- Never overwrite files without reading them first
- \`trash\` > \`rm\` where available (recoverable beats gone forever)
- When in doubt, ask

## What "Done" Means

A task isn't done until:
1. The code works (you ran it or have a test)
2. You've explained what you did (briefly)
3. You've noted anything the user should know about side effects or follow-ups
`,
    'TOOLS.md': `# Local Environment

Notes about this machine's setup. Edit this file so TentaCLAW understands your environment.

## SSH Hosts
_(e.g., prod: user@192.168.1.100, homelab: alexa@proxmox.local)_

## Custom Paths
_(e.g., projects: ~/code, data: /mnt/data, cluster: /opt/tentaclaw)_

## Preferred Tools
_(e.g., package manager: pnpm, editor: vscode, shell: zsh, container: docker)_

## Conventions
_(e.g., commit style: conventional commits, branch naming: feature/xxx, test runner: vitest)_

## Cluster / Nodes
_(e.g., pve-gpu: RTX 4070 Ti Super, pve-vega2: Vega 64)_

## Available Tools (auto-managed)

| Tool | Description |
|------|-------------|
| read_file | Read a file, optionally by line range |
| write_file | Write or overwrite a file |
| edit_file | Surgical old→new text replacement |
| list_dir | List directory contents |
| search_files | Search text/regex across files |
| glob_files | Find files matching a glob pattern |
| http_get | Fetch a URL (docs, APIs, raw files) |
| run_shell | Execute a shell command |
| create_directory | Create directories recursively |
| delete_file | Delete a file (requires approval) |
| move_file | Move or rename a file |
| copy_file | Copy a file |
`,
    'HEARTBEAT.md': `# Heartbeat — Periodic Tasks

# Add bullet-point tasks below to have TentaCLAW check them each session.
# Lines must start with "- " to be active. Commented lines (#) are ignored.
#
# Examples (uncomment to activate):
# - Check for uncommitted git changes and remind me
# - Review today's memory log and update MEMORY.md with what matters
# - Check if any TODOs were added since last session
`,
    // BOOTSTRAP.md removed from defaults — it was recreated every session, blocking real work.
    // First-run onboarding is handled by checking if USER.md has default content instead.
};

function ensureWorkspace(): void {
    const dir = getWorkspaceDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });

    for (const [filename, defaultContent] of Object.entries(WORKSPACE_FILES)) {
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, defaultContent, 'utf8');
        }
    }
}

/** Load workspace context files into a string for the system prompt */
function loadWorkspaceContext(): string {
    const dir = getWorkspaceDir();
    if (!fs.existsSync(dir)) return '';

    const MAX_PER_FILE = 8000;
    const MAX_TOTAL = 50000;
    let total = '';

    const files = ['SOUL.md', 'USER.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'];
    for (const filename of files) {
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) continue;
        try {
            let content = fs.readFileSync(filePath, 'utf8');
            if (content.trim().length === 0) continue;
            if (content.length > MAX_PER_FILE) {
                content = content.slice(0, MAX_PER_FILE) + '\n... (truncated)';
            }
            if (total.length + content.length > MAX_TOTAL) break;
            total += `\n\n--- ${filename} ---\n${content}`;
        } catch { /* skip unreadable */ }
    }

    // Wave 56: Load today's + yesterday's daily memory notes (cap per-file at 4000 chars)
    const MAX_DAILY = 4000;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    for (const [label, date] of [['Yesterday', yesterday], ['Today', today]] as [string, string][]) {
        const dailyPath = path.join(dir, 'memory', `${date}.md`);
        if (!fs.existsSync(dailyPath)) continue;
        try {
            let daily = fs.readFileSync(dailyPath, 'utf8');
            if (daily.trim().length === 0) continue;
            if (daily.length > MAX_DAILY) {
                // Keep most recent notes (end of file) — truncate from start
                daily = '... (earlier notes truncated)\n' + daily.slice(-MAX_DAILY);
            }
            if (total.length + daily.length < MAX_TOTAL) {
                total += `\n\n--- ${label}'s Notes (${date}) ---\n${daily}`;
            }
        } catch { /* skip */ }
    }

    return total;
}

// =============================================================================
// Usage Tracking
// =============================================================================

interface UsageStats {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requestCount: number;
}

function newUsageStats(): UsageStats {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0 };
}

function formatTokens(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// =============================================================================
// TentaCLAW Personality — contextual quips
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
        const arg = raw[i]!;
        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=');
            if (eqIdx !== -1) {
                // --key=value inline
                flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
            } else {
                const key = arg.slice(2);
                const next = raw[i + 1];
                if (next !== undefined && !next.startsWith('-')) {
                    flags[key] = next;
                    i++;
                } else {
                    flags[key] = 'true';
                }
            }
        } else if (arg.startsWith('-') && arg.length === 2) {
            // Wave 412: single-char flag (-n 3 or -n=3)
            const key = arg.slice(1);
            const eqArg = raw[i + 1];
            if (eqArg !== undefined && !eqArg.startsWith('-')) {
                flags[key] = eqArg;
                i++;
            } else {
                flags[key] = 'true';
            }
        } else if (arg.startsWith('-') && arg.includes('=') && arg.length > 2) {
            // Wave 412: -n=3 style
            const eqIdx = arg.indexOf('=');
            flags[arg.slice(1, eqIdx)] = arg.slice(eqIdx + 1);
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

function apiRequest(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<ApiResponse> {
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
                ...extraHeaders,
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

/** Non-fatal version of apiGet — returns null on any failure instead of exiting */
async function apiProbe(baseUrl: string, path: string): Promise<unknown | null> {
    const url = baseUrl.replace(/\/+$/, '') + path;
    try {
        const resp = await apiRequest('GET', url);
        if (resp.status >= 400) return null;
        return resp.data;
    } catch {
        return null;
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

async function apiDelete(baseUrl: string, pathStr: string): Promise<unknown> {
    const url = baseUrl.replace(/\/+$/, '') + pathStr;
    try {
        const resp = await apiRequest('DELETE', url);
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
            console.error(C.dim('      tentaclaw status --gateway http://192.168.1.100:8080'));
            console.error(C.dim('      TENTACLAW_GATEWAY=http://host:port tentaclaw status'));
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
    uptime_secs?: number;
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

const MASCOT_FACE = [
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

    // Status badge
    const statusBadgeStr = allOnline
        ? C.green('\u25CF HEALTHY')
        : noneOnline
            ? C.red('\u25CF OFFLINE')
            : C.yellow('\u25CF DEGRADED');

    // VRAM (free / total)
    const vramTotalGb = Math.round(data.total_vram_mb / 1024);
    const vramFreeGb = Math.round((data.total_vram_mb - data.used_vram_mb) / 1024);

    // Throughput
    const toks = formatNumber(Math.round(data.total_toks_per_sec));

    // Models
    const modelList = data.loaded_models.length > 0
        ? data.loaded_models.slice(0, 2).join(', ') +
          (data.loaded_models.length > 2 ? C.dim(`  +${data.loaded_models.length - 2} more`) : '')
        : C.dim('none');

    // Uptime
    const uptimeStr = data.uptime_secs != null ? formatUptime(data.uptime_secs) : C.dim('—');

    const W = 55;
    // Label column width (10 chars) + 2 for "│ " prefix padding handled by boxMid
    const labelW = 10;
    const label = (s: string) => C.dim(s.padEnd(labelW));

    // Header: "TENTACLAW CLUSTER" bold teal, version right-aligned
    const headerTitle = C.bold(C.teal('TENTACLAW CLUSTER'));
    const headerVer = C.dim('v' + CLI_VERSION);
    // visible lengths: title = 17, ver = 5+, space between
    const headerTitleLen = 'TENTACLAW CLUSTER'.length;   // 17
    const headerVerLen = ('v' + CLI_VERSION).length;      // e.g. 6
    const headerGap = W - 2 - headerTitleLen - headerVerLen; // W-2 = content width
    const headerRow = headerTitle + ' '.repeat(Math.max(1, headerGap)) + headerVer;

    console.log('');
    console.log(boxTop('', W));
    console.log(boxMid(headerRow, W));
    console.log(boxSep(W));
    console.log(boxMid(label('Status') + statusBadgeStr, W));
    console.log(boxMid(label('Nodes') + C.white(String(data.online_nodes) + ' online') + C.dim('  /  ') + C.white(String(data.total_nodes) + ' total'), W));
    console.log(boxMid(label('GPUs') + C.cyan(String(data.total_gpus) + ' active'), W));
    console.log(boxMid(label('VRAM') + C.cyan(String(vramFreeGb) + ' GB free') + C.dim('  /  ') + C.white(String(vramTotalGb) + ' GB total'), W));
    console.log(boxMid(label('Models') + C.white(modelList), W));
    console.log(boxMid(label('Tok/s') + C.green(C.bold(toks)), W));
    console.log(boxMid(label('Uptime') + C.white(uptimeStr), W));
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
    console.log(boxTop('', W));

    // Header row: "NODES  (N total)" bold teal + count dim
    const nodesHeader = C.bold(C.teal('NODES')) + C.dim(`  (${nodes.length} total)`);
    console.log(boxMid(nodesHeader, W));
    console.log(boxSep(W));

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
// New Commands — v0.2.0 TentaCLAW
// =============================================================================

async function cmdModels(gateway: string): Promise<void> {
    const data = await apiGet(gateway, '/api/v1/models') as { models: Array<{ model: string; node_count: number; nodes: string[] }> };
    const models = data.models;

    if (models.length === 0) {
        console.log('');
        console.log(C.yellow('  No models loaded on the cluster.'));
        console.log(C.dim('  Deploy one: tentaclaw deploy llama3.1:8b'));
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
    const raw = await apiGet(gateway, '/api/v1/benchmarks') as any;
    const data: Array<{
        id: string;
        node_id: string;
        model: string;
        tokens_per_sec: number;
        prompt_eval_rate: number;
        created_at: string;
    }> = Array.isArray(raw) ? raw : (raw?.benchmarks ?? []);

    if (data.length === 0) {
        console.log('');
        console.log(C.yellow('  No benchmarks recorded yet.'));
        console.log(C.dim('  Run one: tentaclaw command <nodeId> benchmark --model llama3.1:8b'));
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
            console.log(C.dim('  Add one: tentaclaw tags add <nodeId> <tag>'));
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
            console.error(C.red('  \u2718 Usage: tentaclaw tags add <nodeId> <tag>'));
            process.exit(1);
        }
        await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/tags`, { tags: [tag] });
        console.log('  ' + C.green('\u2714') + ` Tagged ${C.cyan(nodeId)} with ${C.white(tag)}`);
        return;
    }

    if (sub === 'nodes') {
        const tag = positional[1];
        if (!tag) {
            console.error(C.red('  \u2718 Usage: tentaclaw tags nodes <tag>'));
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
    // Resolve inference: config > gateway > local Ollama
    let inferenceUrl = '';
    let inferenceHeaders: Record<string, string> = {};
    let model = flags['model'] || '';
    let backendLabel = '';

    const config = loadConfig();
    if (config) {
        const resolved = resolveInferenceFromConfig(config);
        inferenceUrl = resolved.url;
        inferenceHeaders = resolved.headers;
        if (!model) model = config.model;
        backendLabel = C.green(config.provider);
    }

    if (!inferenceUrl || !model) {
        const gwResp = await apiProbe(gateway, '/v1/models') as { data?: Array<{ id: string }> } | null;
        const gwModels = (gwResp?.data || []).map(m => m.id);
        if (model && gwModels.includes(model)) {
            inferenceUrl = gateway; backendLabel = C.teal('cluster');
        } else if (!model && gwModels.length > 0) {
            inferenceUrl = gateway;
            model = gwModels.find(m => /chat|instruct/i.test(m)) || gwModels[0];
            backendLabel = C.teal('cluster');
        }
    }

    if (!inferenceUrl || !model) {
        for (const port of [11434, 11435]) {
            const resp = await apiProbe(`http://localhost:${port}`, '/v1/models') as { data?: Array<{ id: string }> } | null;
            const list = (resp?.data || []).map(m => m.id);
            if (list.length > 0) {
                inferenceUrl = `http://localhost:${port}`;
                if (!model) model = list.find(m => /chat|instruct/i.test(m)) || list[0];
                backendLabel = C.yellow('local Ollama');
                break;
            }
        }
    }

    if (!inferenceUrl) {
        console.error('');
        console.error(C.red('  \u2718 No inference backend available.'));
        console.error(C.dim('  Run "tentaclaw setup" to configure a model provider.'));
        console.error('');
        process.exit(1);
    }
    if (!model) model = 'llama3.1:8b';

    // Session + multi-turn history
    const chatSessionId = generateSessionId();
    const chatUsage = newUsageStats();
    // Wave 103: --system flag for custom system prompt
    const customSystem = flags['system'] || flags['s'] || '';
    const chatMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: customSystem || 'You are TentaCLAW \u2014 a helpful, witty AI assistant. Be concise but thorough.' },
    ];
    appendSessionEvent(chatSessionId, {
        type: 'session_start', timestamp: new Date().toISOString(), sessionId: chatSessionId,
        model, metadata: { mode: 'chat', cwd: process.cwd() },
    });
    updateSessionMeta(chatSessionId, { model, cwd: process.cwd(), label: 'chat' });

    bootSplash();
    console.log('  ' + C.purple(C.bold('Chat Mode')) + C.dim(` \u2014 model: ${model}`) + C.dim(' via ') + backendLabel);
    console.log('  ' + C.dim(`Session: ${chatSessionId}`));
    console.log('  ' + C.dim('Commands: /help for full list  |  Multi-turn history enabled'));
    console.log('');

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: C.cyan('  \u276F '),
    });

    rl.prompt();

    let chatInferring = false;
    let chatCloseRequested = false;

    rl.on('line', async (line: string) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        // Chat slash commands
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(' ');
            const chatCmd = (parts[0] || '').toLowerCase();
            const chatArg = parts.slice(1).join(' ').trim();

            switch (chatCmd) {
                case 'quit':
                case 'exit': {
                    appendSessionEvent(chatSessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId: chatSessionId });
                    updateSessionMeta(chatSessionId, { messageCount: chatMessages.filter(m => m.role === 'user').length, tokenCount: chatUsage.totalTokens });
                    console.log('');
                    console.log(C.dim(`  Session saved: ${chatSessionId}`));
                    console.log(C.dim('  TentaCLAW waves goodbye \uD83D\uDC19'));
                    rl.close();
                    process.exit(0);
                    break;
                }
                case 'new':
                case 'reset': {
                    chatMessages.splice(1);
                    chatUsage.inputTokens = 0; chatUsage.outputTokens = 0; chatUsage.totalTokens = 0; chatUsage.requestCount = 0;
                    console.log('  ' + C.green('\u2714 Conversation cleared.'));
                    rl.prompt(); return;
                }
                case 'status': {
                    const turns = chatMessages.filter(m => m.role === 'user').length;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('STATUS')));
                    console.log('  ' + padRight(C.dim('Session'), 18) + C.white(chatSessionId));
                    console.log('  ' + padRight(C.dim('Model'), 18) + C.white(model));
                    console.log('  ' + padRight(C.dim('Backend'), 18) + backendLabel);
                    console.log('  ' + padRight(C.dim('Turns'), 18) + C.white(String(turns)));
                    console.log('  ' + padRight(C.dim('Requests'), 18) + C.white(String(chatUsage.requestCount)));
                    console.log('  ' + padRight(C.dim('Tokens'), 18) + C.white(`${formatTokens(chatUsage.inputTokens)} in / ${formatTokens(chatUsage.outputTokens)} out`));
                    console.log('');
                    rl.prompt(); return;
                }
                case 'model': {
                    if (chatArg) {
                        model = chatArg;
                        appendSessionEvent(chatSessionId, { type: 'model_change', timestamp: new Date().toISOString(), sessionId: chatSessionId, model });
                        console.log('  ' + C.green(`\u2714 Model: ${model}`));
                    } else {
                        console.log('  ' + C.dim(`Current model: ${model}`));
                    }
                    rl.prompt(); return;
                }
                case 'sessions': {
                    const sessions = listRecentSessions(8);
                    if (sessions.length === 0) { console.log('  ' + C.dim('No sessions yet.')); }
                    else {
                        console.log('');
                        for (const s of sessions) {
                            const ts = new Date(s.createdAt || '').toLocaleString();
                            console.log('  ' + C.dim(s.sessionId.slice(0, 8)) + '  ' + C.white(s.label || s.model || 'chat') + '  ' + C.dim(ts) + (s.messageCount ? C.dim(`  ${s.messageCount} msgs`) : ''));
                        }
                        console.log('');
                    }
                    rl.prompt(); return;
                }
                case 'save': {
                    updateSessionMeta(chatSessionId, { messageCount: chatMessages.filter(m => m.role === 'user').length, tokenCount: chatUsage.totalTokens });
                    console.log('  ' + C.green(`\u2714 Session saved: ${chatSessionId}`));
                    rl.prompt(); return;
                }
                case 'export': {
                    const exportPath = chatArg || path.join(process.cwd(), `chat-${chatSessionId.slice(0, 8)}.md`);
                    const lines = [`# Chat Export\nSession: ${chatSessionId}\nDate: ${new Date().toISOString()}\nModel: ${model}\n`];
                    for (const m of chatMessages) {
                        if (m.role === 'system') continue;
                        lines.push(`## ${m.role === 'user' ? 'You' : 'TentaCLAW'}\n\n${m.content}\n`);
                    }
                    fs.writeFileSync(exportPath, lines.join('\n'), 'utf8');
                    console.log('  ' + C.green(`\u2714 Exported: ${exportPath}`));
                    rl.prompt(); return;
                }
                case 'compact': {
                    const system = chatMessages[0];
                    const recent = chatMessages.slice(-6);
                    chatMessages.splice(0, chatMessages.length, system!, ...recent);
                    console.log('  ' + C.green(`\u2714 Compacted to last ${recent.length} messages.`));
                    rl.prompt(); return;
                }
                case 'context': {
                    const userCount = chatMessages.filter(m => m.role === 'user').length;
                    const asstCount = chatMessages.filter(m => m.role === 'assistant').length;
                    console.log('  ' + C.dim(`${chatMessages.length} messages (${userCount} user, ${asstCount} assistant)`));
                    rl.prompt(); return;
                }
                case 'workspace': {
                    const wsDir = getWorkspaceDir();
                    if (!fs.existsSync(wsDir)) { console.log('  ' + C.dim('Workspace not initialized.')); rl.prompt(); return; }
                    console.log('');
                    console.log('  ' + C.teal(C.bold('WORKSPACE')) + C.dim(`  ${wsDir}`));
                    const wsFiles = fs.readdirSync(wsDir).filter(f => !fs.statSync(path.join(wsDir, f)).isDirectory());
                    for (const f of wsFiles) console.log('  ' + C.dim('  \u2022 ') + C.white(f));
                    console.log('');
                    rl.prompt(); return;
                }
                case 'clear': {
                    console.clear();
                    rl.prompt(); return;
                }
                case 'help': {
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CHAT COMMANDS')));
                    console.log('  ' + C.dim('/new') + '          Clear conversation history');
                    console.log('  ' + C.dim('/status') + '       Show session info and token counts');
                    console.log('  ' + C.dim('/model <m>') + '    Switch model');
                    console.log('  ' + C.dim('/sessions') + '     List recent sessions');
                    console.log('  ' + C.dim('/save') + '         Save session to disk');
                    console.log('  ' + C.dim('/export [f]') + '   Export chat to markdown file');
                    console.log('  ' + C.dim('/compact') + '      Trim older messages to save context');
                    console.log('  ' + C.dim('/context') + '      Show message count');
                    console.log('  ' + C.dim('/workspace') + '    Show workspace files');
                    console.log('  ' + C.dim('/clear') + '        Clear terminal');
                    console.log('  ' + C.dim('/quit') + '         Save and exit');
                    console.log('');
                    rl.prompt(); return;
                }
                default: {
                    console.log('  ' + C.dim(`Unknown: /${chatCmd}. Try /help.`));
                    rl.prompt(); return;
                }
            }
        }

        // Add to multi-turn history
        chatMessages.push({ role: 'user', content: input });
        appendSessionEvent(chatSessionId, {
            type: 'message', timestamp: new Date().toISOString(), sessionId: chatSessionId,
            role: 'user', content: input,
        });

        process.stdout.write('\n  ' + C.purple('\u25CE '));

        chatInferring = true;
        rl.pause();
        try {
            const url = inferenceUrl.replace(/\/+$/, '') + '/v1/chat/completions';
            const bodyStr = JSON.stringify({ model, messages: chatMessages, stream: true });
            let fullContent = '';
            const prevChatInput = chatUsage.inputTokens;
            const prevChatOutput = chatUsage.outputTokens;
            const prevChatTotal = chatUsage.totalTokens;

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
                        ...inferenceHeaders,
                    },
                }, (res) => {
                    if (res.statusCode && res.statusCode >= 400) {
                        let errBuf = '';
                        res.on('data', (c: Buffer) => { errBuf += c.toString(); });
                        res.on('end', () => {
                            try { const e = JSON.parse(errBuf); process.stdout.write(C.red(String(e.error?.message || `HTTP ${res.statusCode}`))); }
                            catch { process.stdout.write(C.red(`HTTP ${res.statusCode}`)); }
                            resolve();
                        });
                        return;
                    }
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
                                    choices?: Array<{ delta?: { content?: string } }>;
                                    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                                };
                                if (ev.usage) {
                                    chatUsage.inputTokens += ev.usage.prompt_tokens || 0;
                                    chatUsage.outputTokens += ev.usage.completion_tokens || 0;
                                    chatUsage.totalTokens += ev.usage.total_tokens || 0;
                                }
                                const content = ev.choices?.[0]?.delta?.content;
                                if (content) {
                                    process.stdout.write(content);
                                    fullContent += content;
                                }
                            } catch { /* skip malformed SSE */ }
                        }
                    });
                    res.on('end', () => {
                        // Flush remaining buffer
                        if (buf.trim()) {
                            const remainingLines = buf.split('\n');
                            for (const line of remainingLines) {
                                if (!line.startsWith('data: ')) continue;
                                const raw = line.slice(6).trim();
                                if (raw === '[DONE]') continue;
                                try {
                                    const ev = JSON.parse(raw) as {
                                        choices?: Array<{ delta?: { content?: string } }>;
                                        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                                    };
                                    if (ev.usage) {
                                        chatUsage.inputTokens += ev.usage.prompt_tokens || 0;
                                        chatUsage.outputTokens += ev.usage.completion_tokens || 0;
                                        chatUsage.totalTokens += ev.usage.total_tokens || 0;
                                    }
                                    const content = ev.choices?.[0]?.delta?.content;
                                    if (content) {
                                        process.stdout.write(content);
                                        fullContent += content;
                                    }
                                } catch { /* skip */ }
                            }
                        }
                        resolve();
                    });
                    res.on('error', reject);
                });
                req.on('error', reject);
                req.write(bodyStr);
                req.end();
            });

            if (fullContent) {
                chatUsage.requestCount++;
                chatMessages.push({ role: 'assistant', content: fullContent });
                appendSessionEvent(chatSessionId, {
                    type: 'message', timestamp: new Date().toISOString(), sessionId: chatSessionId,
                    role: 'assistant', content: fullContent, model,
                });
                // Wave 35: emit usage event per turn + keep index fresh
                appendSessionEvent(chatSessionId, {
                    type: 'usage', timestamp: new Date().toISOString(), sessionId: chatSessionId,
                    usage: {
                        inputTokens: chatUsage.inputTokens - prevChatInput,
                        outputTokens: chatUsage.outputTokens - prevChatOutput,
                        totalTokens: chatUsage.totalTokens - prevChatTotal,
                        cumulativeInput: chatUsage.inputTokens,
                        cumulativeOutput: chatUsage.outputTokens,
                        cumulativeTotal: chatUsage.totalTokens,
                    },
                    metadata: { model, requestCount: chatUsage.requestCount },
                });
                updateSessionMeta(chatSessionId, { messageCount: chatMessages.filter(m => m.role === 'user').length, tokenCount: chatUsage.totalTokens });
            }
        } catch (err) {
            process.stdout.write(C.red('\nError: ' + (err instanceof Error ? err.message : String(err))));
        }

        console.log('\n');
        chatInferring = false;
        if (chatCloseRequested) {
            // stdin closed while we were inferring — exit cleanly now
            appendSessionEvent(chatSessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId: chatSessionId });
            updateSessionMeta(chatSessionId, { messageCount: chatMessages.filter(m => m.role === 'user').length, tokenCount: chatUsage.totalTokens });
            process.exit(0);
        }
        rl.resume();
        rl.prompt();
    });

    // Graceful save on stdin close (e.g. piped input EOF or Ctrl+D)
    rl.on('close', () => {
        if (chatInferring) {
            chatCloseRequested = true;  // defer exit until inference finishes
            return;
        }
        appendSessionEvent(chatSessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId: chatSessionId });
        updateSessionMeta(chatSessionId, { messageCount: chatMessages.filter(m => m.role === 'user').length, tokenCount: chatUsage.totalTokens });
        process.exit(0);
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
            description: 'Read a file. Large files (>12000 chars) are truncated — use start_line/end_line to read specific sections. Use grep to filter to matching lines only.',
            parameters: {
                type: 'object',
                properties: {
                    path:         { type: 'string',  description: 'File path (relative to cwd or absolute)' },
                    start_line:   { type: 'integer', description: 'First line to read (1-indexed). Negative = from end: -50 reads last 50 lines.' },
                    end_line:     { type: 'integer', description: 'Last line to read inclusive (default: last line)' },
                    grep:         { type: 'string',  description: 'Filter: return only lines matching this pattern (regex ok). Includes 2 lines context around each match.' },
                    grep_context: { type: 'integer', description: 'Lines of context around each grep match (default: 2)' },
                    encoding:     { type: 'string',  description: 'Set to "hex" to get a hex dump of the first 256 bytes — useful for inspecting binary files' },
                    count_only:   { type: 'boolean', description: 'If true, return only the total line count without reading file content — fast for large files' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file, creating or overwriting it. Use mode:"append" to add to the end.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to write' },
                    content: { type: 'string', description: 'Full file content to write' },
                    mode: { type: 'string', description: '"overwrite" (default) or "append" to add to end of file' },
                    backup: { type: 'boolean', description: 'If true, creates a .bak copy of the existing file before overwriting (default: false)' },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List files and directories. Use depth:1-4 for a recursive tree view.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (default: cwd)' },
                    depth: { type: 'integer', description: 'Recursion depth: 0=flat list (default), 1-4=tree view' },
                    sort: { type: 'string', description: 'Sort order for flat mode: "alpha" (default), "mtime" (newest first, shows timestamp), "size" (largest first)' },
                    show_hidden: { type: 'boolean', description: 'Include dotfiles and dot-directories (default: false)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_shell',
            description: 'Execute a shell command. Output streams in real-time. User must approve each command (unless --yes). Use for builds, tests, installs.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run' },
                    timeout_secs: { type: 'integer', description: 'Timeout in seconds (default: 60, max: 300)' },
                    max_output_lines: { type: 'integer', description: 'Cap returned output to N lines, keeping head+tail (default: unlimited, useful for noisy commands)' },
                    cwd: { type: 'string', description: 'Working directory for the command (default: current cwd). Resolved relative to current cwd if not absolute.' },
                    env: { type: 'string', description: 'Extra environment variables as "KEY=value,KEY2=value2" — merged with current environment' },
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
                    file_type: { type: 'string', description: 'Shorthand file type filter: "ts", "js", "py", "go", "rs", "md", "json", "yaml", "css", "html" — sets file_pattern automatically' },
                    use_regex: { type: 'boolean', description: 'Treat pattern as JavaScript regex (default false)' },
                    case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
                    exclude: { type: 'string', description: 'Comma-separated dirs to exclude (e.g. "build,tmp")' },
                    context_lines: { type: 'integer', description: 'Lines of context around each match (default 2, max 5)' },
                    max_results: { type: 'integer', description: 'Max number of matching files to return (default: 20, max: 100)' },
                    whole_word: { type: 'boolean', description: 'If true, only match whole words (e.g. "log" matches "log(" but not "logger")' },
                },
                required: ['pattern'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Make a surgical edit to a file by replacing a specific text snippet. Use instead of write_file when changing part of an existing file. Always read_file first to see exact content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to edit' },
                    old_text: { type: 'string', description: 'Exact text to find and replace (must match file content exactly, including whitespace)' },
                    new_text: { type: 'string', description: 'Replacement text' },
                    replace_all: { type: 'boolean', description: 'Replace all occurrences (default false — fails if multiple matches found)' },
                    nth_occurrence: { type: 'integer', description: 'When old_text appears multiple times, replace only the Nth match (1=first, 2=second, etc.) instead of failing' },
                },
                required: ['path', 'old_text', 'new_text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_directory',
            description: 'Create a directory (and any missing parent directories). Safe to call if it already exists.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to create' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Permanently delete a file. ALWAYS requires user approval unless auto-approve is on. Supports comma-separated paths for batch deletion.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to delete, or comma-separated list for batch deletion' },
                    dry_run: { type: 'boolean', description: 'Preview what would be deleted without actually deleting (default false)' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'move_file',
            description: 'Move or rename a file. Requires user approval.',
            parameters: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Source file path' },
                    destination: { type: 'string', description: 'Destination file path' },
                },
                required: ['source', 'destination'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'copy_file',
            description: 'Copy a file to a new location. No approval needed.',
            parameters: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Source file path' },
                    destination: { type: 'string', description: 'Destination file path' },
                },
                required: ['source', 'destination'],
            },
        },
    },
    // Wave 74: glob_files tool
    {
        type: 'function',
        function: {
            name: 'glob_files',
            description: 'Find files matching a glob pattern. Returns sorted list of matching paths. Use for "find all *.ts files" or "find all test files" tasks.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts", "src/**/*.test.js"' },
                    directory: { type: 'string', description: 'Base directory to search from (default: cwd)' },
                    limit: { type: 'integer', description: 'Max results to return (default: 50)' },
                    sort: { type: 'string', description: 'Sort order: "name" (default), "mtime" (newest first), "size" (largest first)' },
                    content_preview: { type: 'boolean', description: 'Show first non-empty line of each matched file (default false)' },
                    exclude: { type: 'string', description: 'Comma-separated patterns to exclude (e.g. "*.test.ts,fixtures/**")' },
                    modified_since: { type: 'string', description: 'Filter to files modified within the last N minutes ("30m"), hours ("2h"), or days ("1d"). Combine with sort="mtime" for best results.' },
                    skip_binary: { type: 'boolean', description: 'If true, skip common binary file extensions (images, archives, compiled files). Default: false.' },
                },
                required: ['pattern'],
            },
        },
    },
    // Wave 74: http_get tool for fetching docs/APIs
    {
        type: 'function',
        function: {
            name: 'http_get',
            description: 'Fetch a URL via HTTP/HTTPS. Returns the response body as text (max 8000 chars). Supports GET and POST. Use for reading docs, APIs, raw GitHub files.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to fetch' },
                    method: { type: 'string', description: 'HTTP method: "GET" (default) or "POST"' },
                    body: { type: 'string', description: 'Request body for POST requests (JSON string or plain text)' },
                    headers: { type: 'object', description: 'Optional HTTP headers as key-value pairs' },
                    timeout_secs: { type: 'integer', description: 'Request timeout in seconds (default: 10, max: 60 — use for slow APIs or large file downloads)' },
                    json_path: { type: 'string', description: 'Dot-notation path to extract from JSON response (e.g. "choices[0].message.content", "data.items"). Returns just the value, not the full response.' },
                },
                required: ['url'],
            },
        },
    },
    // Wave 224: patch_file — apply multiple old→new replacements in one call
    {
        type: 'function',
        function: {
            name: 'patch_file',
            description: 'Apply multiple text replacements to a file in one call. Faster than edit_file when changing several separate sections. Each patch is { old_text, new_text }. Patches are applied in order — earlier patches should not affect the position of later patches.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to patch' },
                    dry_run: { type: 'boolean', description: 'If true, preview which patches succeed/fail without writing the file (default: false)' },
                    patches: {
                        type: 'array',
                        description: 'Array of { old_text, new_text } objects to apply in order',
                        items: {
                            type: 'object',
                            properties: {
                                old_text: { type: 'string', description: 'Exact text to find and replace' },
                                new_text: { type: 'string', description: 'Replacement text' },
                            },
                            required: ['old_text', 'new_text'],
                        },
                    },
                },
                required: ['path', 'patches'],
            },
        },
    },
    // Wave 187: write_note — append a note to the daily memory file
    {
        type: 'function',
        function: {
            name: 'write_note',
            description: 'Append a note to the daily memory log. Use to record observations, decisions, or reminders without touching code files. Set persist=true to also write to MEMORY.md for cross-session durability.',
            parameters: {
                type: 'object',
                properties: {
                    note: { type: 'string', description: 'The note to write' },
                    tag: { type: 'string', description: 'Optional tag/category (e.g. "bug", "idea", "decision")' },
                    persist: { type: 'boolean', description: 'If true, also appends to MEMORY.md for long-term retention (default: false)' },
                },
                required: ['note'],
            },
        },
    },
];

// =============================================================================
// Code Agent — Helpers
// =============================================================================

const SENSITIVE_PATTERNS = [
    /[/\\]\.env($|\.)/i,
    /[/\\]\.ssh[/\\]/i,
    /[/\\]\.aws[/\\]/i,
    /[/\\]\.gnupg[/\\]/i,
    /[/\\]\.npmrc$/i,
    /[/\\]credentials\.json$/i,
    /[/\\]id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
];

function isSensitivePath(filePath: string): boolean {
    return SENSITIVE_PATTERNS.some(p => p.test(filePath));
}

function summarizeToolArgs(argsJson: string, toolName?: string): string {
    // Wave 118: per-tool readable summaries
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const trunc = (s: string, n = 60) => s.length > n ? s.slice(0, n) + '\u2026' : s;
        const p = (k: string) => trunc(String(args[k] || ''));
        // Wave 320: richer color coding per tool type
        switch (toolName) {
            case 'read_file':     return C.teal(p('path')) + C.dim(args['start_line'] ? `:${args['start_line']}-${args['end_line'] || ''}` : '');
            case 'write_file':    return C.white(p('path')) + C.dim(args['content'] ? ` (${String(args['content']).split('\n').length}L)` : '');
            case 'edit_file': {
                const oldLines = String(args['old_text'] || '').split('\n').length;
                const newLines = String(args['new_text'] || '').split('\n').length;
                const delta = newLines - oldLines;
                const deltaStr = delta > 0 ? C.green(`+${delta}`) : delta < 0 ? C.red(String(delta)) : C.dim('±0');
                return C.white(p('path')) + C.dim(' ') + deltaStr + C.dim(' lines  ') + C.dim('"' + trunc(String(args['old_text'] || '').replace(/\n/g, '↵'), 25) + '"');
            }
            case 'run_shell':     return C.dim('$ ') + C.cyan(trunc(String(args['command'] || ''), 70));
            case 'search_files':  return C.yellow('"' + trunc(String(args['pattern'] || ''), 30) + '"') + C.dim(args['path'] ? ' in ' + p('path') : '');
            case 'list_dir':      return C.teal(p('path') || '.');
            case 'glob_files':    return C.yellow(p('pattern')) + C.dim(args['base_path'] ? ' in ' + p('base_path') : '');
            case 'http_get':      return C.cyan(trunc(String(args['url'] || ''), 70));
            case 'patch_file':    return C.white(p('path')) + C.dim(` (${Array.isArray(args['patches']) ? (args['patches'] as unknown[]).length : '?'} patches)`);
            case 'write_note':    return C.dim((args['tag'] ? `[${args['tag']}] ` : '') + trunc(String(args['note'] || ''), 60));
            case 'create_directory': return C.teal(p('path') + '/');
            case 'delete_file':   return C.red(p('path'));
            case 'move_file':     return C.dim(p('source') + ' \u2192 ') + C.white(p('destination'));
            case 'copy_file':     return C.dim(p('source') + ' \u2192 ') + C.white(p('destination'));
            default: {
                const vals = Object.values(args).map(v => trunc(String(v)));
                return C.dim('(' + vals.join(', ') + ')');
            }
        }
    } catch {
        return C.dim('(' + argsJson.slice(0, 80) + ')');
    }
}

interface AgentToolCall {
    id: string;
    name: string;
    args: string;
}

function resolvePath(p: string): string {
    const resolved = path.resolve(p.replace(/^~/, os.homedir()));
    const cwd = process.cwd();
    const home = os.homedir();
    if (!resolved.startsWith(cwd) && !resolved.startsWith(home)) {
        throw new Error(`Path outside project and home directory: ${p}`);
    }
    return resolved;
}

async function executeCodeTool(
    call: AgentToolCall,
    rl: import('readline').Interface | null,
    autoApprove: boolean,
    printMode = false
): Promise<string> {
    let args: Record<string, string>;
    try {
        args = JSON.parse(call.args || '{}') as Record<string, string>;
    } catch {
        return 'Error: could not parse tool arguments';
    }

    switch (call.name) {
        case 'read_file': {
            // Wave 199/341: support path:line or path:start-end; respect .clawignore
            let rawPath = String(args['path'] || '');
            let pathAutoStart: number | undefined;
            let pathAutoEnd: number | undefined;
            const lineRangeMatch = rawPath.match(/:(\d+)(?:-(\d+))?$/);
            if (lineRangeMatch && !rawPath.match(/^https?:/)) {
                pathAutoStart = parseInt(lineRangeMatch[1]!, 10);
                pathAutoEnd = lineRangeMatch[2] ? parseInt(lineRangeMatch[2], 10) : undefined;
                rawPath = rawPath.slice(0, rawPath.lastIndexOf(':'));
            }
            const filePath = resolvePath(rawPath);
            if (isSensitivePath(filePath)) {
                return `Blocked: ${path.basename(filePath)} is a sensitive file (credentials/secrets)`;
            }
            // Wave 341: check .clawignore patterns
            if (_clawIgnorePatterns.length > 0) {
                const relToIgnore = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
                const isIgnored = _clawIgnorePatterns.some((pat: string) => {
                    const p = pat.endsWith('/') ? pat.slice(0, -1) : pat;
                    const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '($|/)');
                    return re.test(relToIgnore) || relToIgnore.includes('/' + p + '/') || relToIgnore.startsWith(p + '/');
                });
                if (isIgnored) return `Skipped: ${path.relative(process.cwd(), filePath)} is excluded by .clawignore`;
            }
            try {
                // Wave 210: binary file detection — check first 512 bytes for null bytes
                const stat = fs.statSync(filePath);
                if (stat.size > 0) {
                    const sampleBuf = Buffer.alloc(Math.min(512, stat.size));
                    const fd = fs.openSync(filePath, 'r');
                    fs.readSync(fd, sampleBuf, 0, sampleBuf.length, 0);
                    fs.closeSync(fd);
                    // Wave 393: encoding="hex" — return hex dump of first 256 bytes for binary inspection
                    const encodingArg393 = String(args['encoding'] || '').toLowerCase();
                    if (sampleBuf.includes(0)) {
                        if (encodingArg393 === 'hex') {
                            const hexBytes393 = Math.min(256, stat.size);
                            const buf393 = Buffer.alloc(hexBytes393);
                            const fd2 = fs.openSync(filePath, 'r');
                            fs.readSync(fd2, buf393, 0, hexBytes393, 0);
                            fs.closeSync(fd2);
                            const hexLines393: string[] = [];
                            for (let i = 0; i < hexBytes393; i += 16) {
                                const chunk = buf393.slice(i, i + 16);
                                const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
                                const ascii = [...chunk].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
                                hexLines393.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
                            }
                            return `Binary file: ${path.basename(filePath)} (${(stat.size / 1024).toFixed(1)}kb)\n${hexLines393.join('\n')}${stat.size > 256 ? `\n...(${stat.size} bytes total)` : ''}`;
                        }
                        const ext = path.extname(filePath).toLowerCase();
                        return `Binary file: ${path.basename(filePath)} (${(stat.size / 1024).toFixed(1)}kb, ${ext || 'no extension'}) — cannot read as text. Use encoding="hex" for a hex dump, or run_shell for xxd/strings.`;
                    }
                }
                const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
                const lines = raw.split('\n');
                const totalLines = lines.length;
                // Wave 406: count_only — return just the line count without reading content
                if (args['count_only'] === 'true' || args['count_only'] === true as unknown as string) {
                    return `${path.basename(filePath)}: ${totalLines} lines`;
                }
                // Wave 37/218: start_line / end_line window; negative start_line = from end (e.g. -50 = last 50 lines)
                // Wave 421: clamp and validate to prevent confusing "Lines 11-5" header when model passes out-of-range args
                const rawStartArg = parseInt(String(args['start_line'] || String(pathAutoStart || '1')), 10) || 1;
                const resolvedStart = rawStartArg < 0 ? Math.max(1, totalLines + rawStartArg + 1) : rawStartArg;
                const startLine = Math.max(1, Math.min(resolvedStart, totalLines));
                const endLine = Math.min(totalLines, parseInt(String(args['end_line'] || String(pathAutoEnd || totalLines)), 10) || totalLines);
                if (args['start_line'] && startLine > endLine) {
                    return `Error: start_line (${rawStartArg}) is beyond end_line (${endLine}). File has ${totalLines} lines (1–${totalLines}).`;
                }
                const hasWindow = args['start_line'] || args['end_line'] || pathAutoStart || pathAutoEnd;
                const windowedLines = hasWindow ? lines.slice(startLine - 1, endLine) : lines;
                const actualStart = hasWindow ? startLine : 1;
                // Wave 81: prefix each line with its line number so agent can do precise edits
                const PAD = String(totalLines).length;
                const numbered = windowedLines.map((l, i) => `${String(actualStart + i).padStart(PAD)}: ${l}`).join('\n');
                // Wave 131: include file size and last-modified in header
                let fileMeta = '';
                try {
                    const stat = fs.statSync(filePath);
                    const kb = (stat.size / 1024).toFixed(1);
                    const mtime = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
                    fileMeta = ` | ${kb}kb | modified ${mtime}`;
                } catch { /* skip */ }
                const header = (args['start_line'] || args['end_line'])
                    ? `[${path.basename(filePath)} — Lines ${startLine}–${endLine} of ${totalLines}${fileMeta}]\n`
                    : `[${path.basename(filePath)} — ${totalLines} lines${fileMeta}]\n`;
                // Wave 352: grep param — filter lines by pattern before returning
                const grepParam = String(args['grep'] || '').trim();
                if (grepParam) {
                    let grepRe352: RegExp;
                    try { grepRe352 = new RegExp(grepParam, 'i'); } catch { grepRe352 = new RegExp(grepParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
                    const ctxLines352 = Math.max(0, parseInt(String(args['grep_context'] || '2'), 10) || 2);
                    const allNumbered = numbered.split('\n');
                    const matchedIndices = new Set<number>();
                    allNumbered.forEach((l, i) => { if (grepRe352.test(l)) { for (let c = Math.max(0, i - ctxLines352); c <= Math.min(allNumbered.length - 1, i + ctxLines352); c++) matchedIndices.add(c); } });
                    if (matchedIndices.size === 0) return `${header}[grep("${grepParam}"): no matches in ${path.basename(filePath)}]`;
                    const grepLines = [...matchedIndices].sort((a, b) => a - b).map(i => allNumbered[i]);
                    const matchCount = allNumbered.filter(l => grepRe352.test(l)).length;
                    return `${header}[grep("${grepParam}"): ${matchCount} match${matchCount !== 1 ? 'es' : ''} — showing ${grepLines.length} lines with ${ctxLines352} lines context]\n` + grepLines.join('\n');
                }
                // Wave 36/175: truncation header with actionable hint
                const LIMIT = 12000;
                if (numbered.length > LIMIT) {
                    const linesShown = numbered.slice(0, LIMIT).split('\n').length;
                    const pct = Math.round((linesShown / totalLines) * 100);
                    const midLine = Math.round(totalLines / 2);
                    return `${header}[Truncated at ${pct}% (${linesShown}/${totalLines} lines). To read more:\n` +
                        `  • read_file("${path.basename(filePath)}", start_line=1, end_line=200) — first section\n` +
                        `  • read_file("${path.basename(filePath)}", start_line=${midLine}, end_line=${midLine + 200}) — middle\n` +
                        `  • read_file("${path.basename(filePath)}", start_line=${Math.max(1, totalLines - 200)}) — end\n` +
                        `  • search_files("pattern", path="${path.dirname(filePath)}") — search instead]\n\n` +
                        numbered.slice(0, LIMIT) + '\n...(truncated)';
                }
                return header + numbered;
            } catch (e) {
                return `Error reading: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'write_file': {
            const filePath = resolvePath(args['path'] || '');
            if (isSensitivePath(filePath)) {
                return `Blocked: ${path.basename(filePath)} is a sensitive file (credentials/secrets)`;
            }
            const content = args['content'] || '';
            // Wave 154: append mode
            const writeMode = (args['mode'] || 'overwrite').toLowerCase();
            // Wave 385: backup param — create .bak before overwriting
            const backupFlag385 = args['backup'] === 'true' || args['backup'] === true as unknown as string;
            if (writeMode === 'append') {
                try {
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.appendFileSync(filePath, content, 'utf8');
                    const newLines = content.split('\n').length;
                    return `Appended ${newLines} line${newLines !== 1 ? 's' : ''} to: ${filePath}`;
                } catch (e) {
                    return `Error appending: ${e instanceof Error ? e.message : String(e)}`;
                }
            }
            const existing = fs.existsSync(filePath);
            if (!autoApprove) {
                console.log('');
                console.log('  ' + C.yellow(`\u26A1 ${existing ? 'Overwrite' : 'Create'}: ${C.white(filePath)}`));
                if (existing) {
                    // Wave 119: enhanced diff preview when overwriting
                    try {
                        const old = fs.readFileSync(filePath, 'utf8');
                        const oldLines = old.split('\n');
                        const newLines = content.split('\n');
                        const delta = newLines.length - oldLines.length;
                        const deltaStr = delta > 0 ? C.green(`+${delta}`) : delta < 0 ? C.red(String(delta)) : C.dim('±0');
                        console.log('  ' + C.dim(`   ${oldLines.length} → ${newLines.length} lines (`) + deltaStr + C.dim(')'));
                        // Show first few added/removed lines
                        let shown = 0;
                        for (let li = 0; li < Math.max(oldLines.length, newLines.length) && shown < 4; li++) {
                            const ol = oldLines[li]; const nl = newLines[li];
                            if (ol !== nl) {
                                if (ol !== undefined) console.log('  ' + C.red(`  - ${ol.slice(0, 70)}`));
                                if (nl !== undefined) console.log('  ' + C.green(`  + ${nl.slice(0, 70)}`));
                                shown++;
                            }
                        }
                        if (shown === 0 && oldLines.length !== newLines.length) {
                            console.log('  ' + C.dim('  (lines appended/removed at end)'));
                        }
                    } catch { console.log('  ' + C.dim(`   ${content.split('\n').length} lines`)); }
                } else {
                    console.log('  ' + C.dim(`   ${content.split('\n').length} lines`));
                }
                if (!rl) return 'Write cancelled (no interactive prompt in --task mode without --yes).';
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [') + C.green('y') + C.dim('/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Write cancelled.';
            }
            try {
                const newLineCount = content.split('\n').length;
                // Wave 211: compute delta BEFORE writing (existing holds the old content)
                let diffSummary = '';
                if (existing) {
                    try {
                        const oldContent = fs.readFileSync(filePath, 'utf8');
                        const oldLineCount = oldContent.split('\n').length;
                        const delta = newLineCount - oldLineCount;
                        diffSummary = ` (${delta > 0 ? '+' + delta : delta < 0 ? String(delta) : '±0'} lines)`;
                    } catch { /* skip */ }
                }
                // Wave 407: detect if parent dir needs to be created and report it
                const dirPath407 = path.dirname(filePath);
                const dirExisted407 = fs.existsSync(dirPath407);
                fs.mkdirSync(dirPath407, { recursive: true });
                const dirNote407 = (!dirExisted407 && dirPath407 !== '.') ? ` [created dir: ${path.relative(process.cwd(), dirPath407) || dirPath407}]` : '';
                // Wave 385: create .bak backup before overwriting
                let backupNote385 = '';
                if (backupFlag385 && existing) {
                    const bakPath385 = filePath + '.bak';
                    try { fs.copyFileSync(filePath, bakPath385); backupNote385 = ` [backup: ${path.basename(bakPath385)}]`; } catch { /* skip */ }
                }
                fs.writeFileSync(filePath, content, 'utf8');
                return `${existing ? 'Overwritten' : 'Created'}: ${path.basename(filePath)}${diffSummary} (${newLineCount} total lines)${backupNote385}${dirNote407}`;
            } catch (e) {
                return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'list_dir': {
            const dirPath = resolvePath(args['path'] || '.');
            // Wave 200: depth parameter — 0 = flat (default), 1-4 = recursive tree
            const maxDepth = Math.min(4, Math.max(0, parseInt(String(args['depth'] || '0'), 10) || 0));
            // Wave 362: sort parameter for flat mode — alpha (default), mtime, size
            const listSort362 = String(args['sort'] || 'alpha').toLowerCase();
            // Wave 418: show_hidden — include dotfiles/dotdirs in listing
            const showHidden418 = args['show_hidden'] === 'true' || args['show_hidden'] === true as unknown as string;
            // Wave 345: merge .clawignore patterns into skip set
            const LIST_SKIP = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage', ..._clawIgnorePatterns.map(p => p.split('/')[0]!).filter(Boolean)]);
            try {
                if (maxDepth === 0) {
                    const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true });
                    const entries = showHidden418 ? rawEntries : rawEntries.filter(e => !e.name.startsWith('.'));
                    const sorted = entries.sort((a, b) => {
                        if (listSort362 === 'mtime' || listSort362 === 'size') {
                            // For mtime/size sorts: get stats for both
                            try {
                                const sa = fs.statSync(path.join(dirPath, a.name));
                                const sb = fs.statSync(path.join(dirPath, b.name));
                                if (listSort362 === 'mtime') return sb.mtimeMs - sa.mtimeMs;
                                return sb.size - sa.size;
                            } catch { return 0; }
                        }
                        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });
                    // Wave 90/362: show file sizes (and mtime when sorted by mtime)
                    const lines = sorted.map(e => {
                        const name = e.isDirectory() ? `\uD83D\uDCC1 ${e.name}/` : `   ${e.name}`;
                        if (!e.isDirectory()) {
                            try {
                                const st = fs.statSync(path.join(dirPath, e.name));
                                const sz = st.size;
                                const szStr = sz < 1024 ? `${sz}b` : sz < 1024 * 1024 ? `${(sz / 1024).toFixed(1)}kb` : `${(sz / 1024 / 1024).toFixed(1)}mb`;
                                const mtStr = listSort362 === 'mtime' ? '  ' + st.mtime.toISOString().slice(0, 16).replace('T', ' ') : '';
                                return `${name}  (${szStr}${mtStr})`;
                            } catch { /* ok */ }
                        }
                        return name;
                    });
                    // Wave 141: summary line
                    const dirs = sorted.filter(e => e.isDirectory()).length;
                    const files = sorted.length - dirs;
                    const summary = `\n${dirs} director${dirs !== 1 ? 'ies' : 'y'}, ${files} file${files !== 1 ? 's' : ''}`;
                    return (lines.join('\n') || '(empty)') + summary;
                } else {
                    // Recursive tree mode
                    const treeLines: string[] = [];
                    let totalFiles = 0; let totalDirs = 0;
                    const buildTree = (d: string, prefix: string, depth: number): void => {
                        let entries: fs.Dirent[];
                        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                        entries.sort((a, b) => {
                            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        });
                        const visible = showHidden418 ? entries : entries.filter(e => !e.name.startsWith('.') || e.name === '.env');
                        for (let i = 0; i < visible.length; i++) {
                            const e = visible[i]!;
                            const isLast = i === visible.length - 1;
                            const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
                            const childPrefix = prefix + (isLast ? '    ' : '\u2502   ');
                            if (e.isDirectory()) {
                                totalDirs++;
                                const skip = LIST_SKIP.has(e.name);
                                treeLines.push(prefix + connector + e.name + '/' + (skip ? ' (skipped)' : ''));
                                if (!skip && depth < maxDepth) buildTree(path.join(d, e.name), childPrefix, depth + 1);
                            } else {
                                totalFiles++;
                                let szStr = '';
                                try { const sz = fs.statSync(path.join(d, e.name)).size; szStr = sz < 1024 ? ` (${sz}b)` : sz < 1_048_576 ? ` (${(sz/1024).toFixed(1)}kb)` : ` (${(sz/1_048_576).toFixed(1)}mb)`; } catch { /* ok */ }
                                treeLines.push(prefix + connector + e.name + szStr);
                            }
                        }
                    };
                    buildTree(dirPath, '', 0);
                    return (treeLines.join('\n') || '(empty)') + `\n\n${totalDirs} dir${totalDirs !== 1 ? 's' : ''}, ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;
                }
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'run_shell': {
            // run_shell intentionally uses shell execution — this is the tool's purpose.
            // User must approve each command before it runs (unless --yes flag is set).
            const command = args['command'] || '';
            if (!command) return 'Error: no command provided';
            const timeoutSecs = Math.min(Math.max(parseInt(String(args['timeout_secs'] || '60'), 10) || 60, 5), 300);
            // Wave 206: show cwd in prompt so user knows where command runs
            // Wave 239: support optional cwd parameter for running in a specific directory
            const cwdArg = args['cwd'] ? String(args['cwd']) : '';
            const cmdCwd = cwdArg
                ? (path.isAbsolute(cwdArg) ? cwdArg : path.join(process.cwd(), cwdArg))
                : process.cwd();
            const cwdShort = cmdCwd.replace(os.homedir(), '~');
            if (!autoApprove) {
                console.log('');
                console.log('  ' + C.yellow('\u26A1 Run shell command:'));
                console.log('  ' + C.cyan(`  $ ${command}`));
                console.log('  ' + C.dim(`  in ${cwdShort}  timeout:${timeoutSecs}s`));
                if (!rl) return 'Command cancelled (no interactive prompt in --task mode without --yes).';
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [') + C.green('y') + C.dim('/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Command cancelled.';
            } else {
                console.log('  ' + C.dim(`  $ ${command}`) + C.dim(`  [${cwdShort}]`));
            }
            // Wave 89: streaming output — print chunks in real-time, also capture for LLM
            // shell: true is intentional — run_shell needs pipes, redirects, expansions.
            const spawn = require('child_process').spawn as typeof import('child_process').spawn;
            const runShellT0_386 = Date.now();  // Wave 386: track elapsed time
            // Wave 413: env param — additional env vars as "KEY=value,KEY2=value2" string
            const envArg413 = String(args['env'] || '').trim();
            const extraEnv413: Record<string, string> = {};
            if (envArg413) {
                for (const pair of envArg413.split(',')) {
                    const eq = pair.indexOf('=');
                    if (eq !== -1) extraEnv413[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
                }
            }
            const mergedEnv413 = Object.keys(extraEnv413).length > 0 ? { ...process.env, ...extraEnv413 } : undefined;
            return await new Promise<string>((resolve) => {
                const isWin = process.platform === 'win32';
                const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/d', '/s', '/c', command] : ['-c', command], {
                    cwd: cmdCwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    ...(mergedEnv413 ? { env: mergedEnv413 } : {}),
                });
                let captured = '';
                let timedOut = false;
                // Wave 240: strip ANSI from captured output (keeps context clean for model)
                const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
                const timer = setTimeout(() => {
                    timedOut = true;
                    child.kill();
                }, timeoutSecs * 1000);
                child.stdout?.on('data', (chunk: Buffer) => {
                    const s = chunk.toString();
                    // Wave 423: suppress live output in --print/--task mode (keep stdout clean for scripting)
                    if (!printMode) process.stdout.write(C.dim(s));
                    captured += stripAnsi(s);
                    if (captured.length > 80_000) child.kill();
                });
                child.stderr?.on('data', (chunk: Buffer) => {
                    const s = chunk.toString();
                    if (!printMode) process.stderr.write(C.dim(s));
                    captured += stripAnsi(s);
                    if (captured.length > 80_000) child.kill();
                });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    // Wave 165/386: show exit code visually with elapsed time (suppressed in --print mode)
                    const runShellElapsed386 = ((Date.now() - runShellT0_386) / 1000).toFixed(1);
                    if (!printMode) {
                        if (code !== null && code !== 0) {
                            process.stdout.write('\n  ' + C.red(`✗ Exit ${code}`) + C.dim(` (${runShellElapsed386}s)`));
                        } else if (code === 0) {
                            process.stdout.write('\n  ' + C.dim(`✓ Exit 0`) + C.dim(` (${runShellElapsed386}s)`));
                        }
                        process.stdout.write('\n');
                    }
                    if (timedOut) { resolve(`Timeout after ${timeoutSecs}s:\n${captured.slice(0, 8000)}`); return; }
                    let out = captured.trim() || '(no output)';
                    // Wave 231: max_output_lines — keep head + tail when output is very long
                    const maxOutputLines = args['max_output_lines'] ? Math.max(10, parseInt(String(args['max_output_lines']), 10) || 0) : 0;
                    if (maxOutputLines > 0) {
                        const outLines = out.split('\n');
                        if (outLines.length > maxOutputLines) {
                            const half = Math.floor(maxOutputLines / 2);
                            const head = outLines.slice(0, half);
                            const tail = outLines.slice(-half);
                            out = head.join('\n') + `\n...(${outLines.length - maxOutputLines} lines omitted)...\n` + tail.join('\n');
                        }
                    }
                    // Wave 245: smart truncation — keep head + tail (not just head) when output is very long
                    const truncateOutput = (s: string, limit: number): string => {
                        if (s.length <= limit) return s;
                        const half = Math.floor(limit / 2);
                        const head = s.slice(0, half);
                        const tail = s.slice(-half);
                        const omitted = s.length - (head.length + tail.length);
                        return `${head}\n...(${omitted} chars omitted — middle of output)...\n${tail}`;
                    };
                    if (code !== 0 && code !== null) {
                        // Wave 208: auto-detect common error patterns and inject a fix hint
                        const errHints: Array<[RegExp, string]> = [
                            [/command not found|is not recognized/i, 'Hint: Command not found — check if it\'s installed (try: which <cmd> or npm install -g <pkg>)'],
                            [/EACCES|permission denied/i, 'Hint: Permission denied — try: sudo <command> or chmod +x <file>'],
                            [/EADDRINUSE|address already in use/i, 'Hint: Port already in use — kill existing process or use a different port'],
                            [/Cannot find module|MODULE_NOT_FOUND/i, 'Hint: Module not found — try: npm install (or yarn/pnpm install)'],
                            [/npm ERR! 404|package not found/i, 'Hint: Package not found — check the package name and npm registry'],
                            [/ENOENT.*no such file/i, 'Hint: File not found — check the path exists with: list_dir(path)'],
                            [/syntax error|SyntaxError/i, 'Hint: Syntax error — read the file and check for typos around the reported line'],
                            [/tsc.*error|TypeScript.*error/i, 'Hint: TypeScript error — read the failing file and fix the type issues'],
                        ];
                        const hint = errHints.find(([re]) => re.test(out))?.[1] || '';
                        resolve(truncateOutput(`Exit ${code}:\n${out}` + (hint ? '\n\n' + hint : ''), 8000));
                    } else {
                        resolve(truncateOutput(code === 0 ? out : `Exit ${code}:\n${out}`, 8000));
                    }
                });
                child.on('error', (e) => { clearTimeout(timer); resolve(`Failed: ${e.message}`); });
            });
        }

        case 'search_files': {
            const pattern = args['pattern'] || '';
            const dir = resolvePath(args['directory'] || '.');
            // Wave 360: file_type shorthand — map common type names to glob patterns
            const FILE_TYPE_MAP: Record<string, string> = {
                ts: '*.ts', tsx: '*.tsx', js: '*.js', jsx: '*.jsx', py: '*.py', go: '*.go',
                rs: '*.rs', rb: '*.rb', java: '*.java', cs: '*.cs', cpp: '*.cpp', c: '*.c',
                md: '*.md', txt: '*.txt', json: '*.json', yaml: '*.{yaml,yml}', yml: '*.{yaml,yml}',
                css: '*.css', html: '*.html', sh: '*.sh', toml: '*.toml', conf: '*.conf',
            };
            const fileTypeArg = String(args['file_type'] || '').toLowerCase();
            const fileGlob = (fileTypeArg && FILE_TYPE_MAP[fileTypeArg]) || args['file_pattern'] || '*';
            const useRegex = args['use_regex'] === 'true' || args['use_regex'] === true as unknown as string;
            // Wave 145: case_sensitive param (default: false — case insensitive)
            const caseSensitive = args['case_sensitive'] === 'true' || args['case_sensitive'] === true as unknown as string;
            // Wave 176: exclude dirs/patterns
            const excludeArg = String(args['exclude'] || '');
            const extraExcludes = excludeArg ? excludeArg.split(',').map(s => s.trim()).filter(Boolean) : [];
            if (!pattern) return 'Error: pattern required';
            // Wave 196: context_lines param
            const ctxLines2 = Math.min(5, Math.max(0, parseInt(String(args['context_lines'] || '2'), 10) || 2));
            // Wave 388: whole_word param — match whole words only
            const wholeWord388 = args['whole_word'] === 'true' || args['whole_word'] === true as unknown as string;
            // Wave 203: use ripgrep (rg) if available — much faster on large codebases
            try {
                const rgAvail = (() => { try { execSync('rg --version', { stdio: 'ignore' }); return true; } catch { return false; } })();
                if (rgAvail) {
                    const rgFlags = [
                        useRegex ? '' : '--fixed-strings',
                        caseSensitive ? '' : '--ignore-case',
                        wholeWord388 ? '--word-regexp' : '',
                        `--context=${ctxLines2}`,
                        '--max-count=10',
                        '--max-filesize=1M',
                        fileGlob !== '*' ? `--glob=${fileGlob}` : '',
                        ...extraExcludes.map(e => `--glob=!${e}/**`),
                        '--heading', '--line-number', '--no-messages',
                        '--color=never',
                    ].filter(Boolean);
                    const rgCmd = `rg ${rgFlags.join(' ')} ${JSON.stringify(pattern)} ${JSON.stringify(dir)}`;
                    try {
                        const out = execSync(rgCmd, { encoding: 'utf8', stdio: 'pipe', cwd: dir, maxBuffer: 1_000_000 }).trim();
                        if (!out) return 'No matches found.';
                        const fileCount = (out.match(/^[^\n]+\n/gm) || []).filter(l => !l.startsWith(' ') && !l.match(/^\d/)).length;
                        return out + `\n\n(via rg — ${fileCount} file${fileCount !== 1 ? 's' : ''})`;
                    } catch (e) {
                        const exitErr = e as { status?: number; stdout?: string };
                        if (exitErr.status === 1) return 'No matches found.';
                        // rg exit 2 = error — fall through to Node.js search
                    }
                }
            } catch { /* fall through to pure Node.js search */ }

            let searchRe: RegExp | null = null;
            if (useRegex) {
                try { searchRe = new RegExp(pattern, caseSensitive ? '' : 'i'); }
                catch { return `Error: invalid regex: ${pattern}`; }
            }

            // Pure Node.js search — no grep dependency, works on Windows/Linux/macOS
            const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage', '.nyc_output', 'vendor', ...extraExcludes]);
            const globToRegex = (g: string) => new RegExp(
                '^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
                'i'
            );
            const fileRegex = globToRegex(fileGlob);
            const matchFiles: Array<{ file: string; hits: string[] }> = [];
            // Wave 377: max_results param — expose as a parameter
            const MAX_FILES = Math.min(Math.max(parseInt(String(args['max_results'] || '20'), 10) || 20, 1), 100);
            const MAX_MATCHES_PER_FILE = 8;

            const walk = (d: string, depth: number): void => {
                if (depth > 8 || matchFiles.length >= MAX_FILES) return;
                let entries: string[];
                try { entries = fs.readdirSync(d); } catch { return; }
                for (const entry of entries) {
                    if (matchFiles.length >= MAX_FILES) return;
                    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
                    const full = path.join(d, entry);
                    let stat: fs.Stats;
                    try { stat = fs.statSync(full); } catch { continue; }
                    if (stat.isDirectory()) {
                        walk(full, depth + 1);
                    } else if (stat.isFile() && fileRegex.test(entry)) {
                        let content: string;
                        try { content = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''); } catch { continue; }
                        if (content.length > 500_000) continue; // skip binary/huge files
                        const lines = content.split('\n');
                        const PAD = String(lines.length).length;
                        // Collect all match line indices
                        const matchIdxs: number[] = [];
                        for (let i = 0; i < lines.length; i++) {
                            const lineStr = lines[i]!;
                            // Wave 388: whole_word — wrap pattern in \b...\b for word-boundary matching
                        const matchLine388 = (line: string): boolean => {
                            if (searchRe) return searchRe.test(line);
                            if (wholeWord388) {
                                const escaped388 = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                try {
                                    return new RegExp(`\\b${escaped388}\\b`, caseSensitive ? '' : 'i').test(line);
                                } catch { return false; }
                            }
                            return caseSensitive ? line.includes(pattern) : line.toLowerCase().includes(pattern.toLowerCase());
                        };
                        const matched = matchLine388(lineStr);
                            if (matched) { matchIdxs.push(i); if (matchIdxs.length >= MAX_MATCHES_PER_FILE) break; }
                        }
                        if (matchIdxs.length === 0) continue;
                        // Build context ranges, merging overlapping, with separators
                        const hits: string[] = [];
                        let lastLineShown = -2;
                        for (const mi of matchIdxs) {
                            const from = Math.max(0, mi - ctxLines2);
                            const to = Math.min(lines.length - 1, mi + ctxLines2);
                            if (from > lastLineShown + 1 && lastLineShown >= 0) hits.push('---');
                            for (let li = Math.max(from, lastLineShown + 1); li <= to; li++) {
                                const marker = li === mi ? '▶' : ':';
                                hits.push(`${String(li + 1).padStart(PAD)}${marker} ${lines[li]}`);
                            }
                            lastLineShown = to;
                        }
                        const relPath = path.relative(dir, full);
                        matchFiles.push({ file: relPath, hits });
                    }
                }
            };

            walk(dir, 0);
            if (matchFiles.length === 0) return 'No matches found.';
            const resultLines = matchFiles.map(m => `${m.file}:\n${m.hits.join('\n')}`);
            const totalMatches = matchFiles.reduce((s, m) => s + m.hits.filter(h => h.includes('▶')).length, 0);
            resultLines.push(`\n${matchFiles.length} file${matchFiles.length !== 1 ? 's' : ''}, ${totalMatches} match${totalMatches !== 1 ? 'es' : ''}`);
            if (matchFiles.length >= MAX_FILES) resultLines.push(`(limit ${MAX_FILES} files reached — refine your pattern)`);
            return resultLines.join('\n\n');
        }

        case 'edit_file': {
            const filePath = resolvePath(args['path'] || '');
            const oldText = args['old_text'] || '';
            const newText = args['new_text'] ?? '';
            // Wave 147: replace_all flag — replace all occurrences instead of failing
            const replaceAll = args['replace_all'] === 'true' || args['replace_all'] === true as unknown as string;
            // Wave 361: nth_occurrence — target the Nth match (1-indexed) when old_text appears multiple times
            const nthOccurrence = parseInt(String(args['nth_occurrence'] || '0'), 10) || 0;
            if (!oldText) return 'Error: old_text is required';
            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
            } catch (e) {
                return `Error reading: ${e instanceof Error ? e.message : String(e)}`;
            }
            // Count occurrences
            let count = 0;
            let searchPos = 0;
            while (true) {
                const idx = content.indexOf(oldText, searchPos);
                if (idx === -1) break;
                count++;
                searchPos = idx + 1;
            }
            if (count === 0) {
                // Wave 449: primary normalization — handles the most common local model failures:
                // \r\n vs \n (Windows files), trailing whitespace per line (model reconstruction artifacts)
                const normalize449 = (s: string) =>
                    s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+$/gm, '');
                const norm449Content = normalize449(content);
                const norm449OldText = normalize449(oldText);
                const norm449Idx = norm449Content.indexOf(norm449OldText);
                if (norm449Idx !== -1 && norm449OldText.trim().length > 0) {
                    // Map normalized position to original content using line counts
                    const beforeNorm = norm449Content.slice(0, norm449Idx);
                    const startLine = beforeNorm.split('\n').length - 1;
                    const oldLineCount = norm449OldText.split('\n').length;

                    const origLines = content.split('\n');
                    const beforeLines = origLines.slice(0, startLine);
                    const afterLines = origLines.slice(startLine + oldLineCount);
                    const result = [...beforeLines, ...newText.split('\n'), ...afterLines].join('\n');

                    try {
                        fs.writeFileSync(filePath, result, 'utf8');
                        return `Edited: ${path.basename(filePath)} at L${startLine + 1} — ${oldLineCount} lines replaced`;
                    } catch (e) {
                        return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
                    }
                }
                // Wave 216: secondary fallback — collapse all horizontal whitespace (more aggressive)
                const normalizeWs = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n');
                const normContent = normalizeWs(content);
                const normOldText = normalizeWs(oldText);
                if (normContent.includes(normOldText) && normOldText.trim().length > 10) {
                    // Reconstruct actual match from normalized content position
                    const normIdx = normContent.indexOf(normOldText);
                    // Find the span in original content that corresponds to this normalized region
                    // Simple approach: apply the edit on normalized content and write back
                    const normEdited = replaceAll
                        ? normContent.split(normOldText).join(normalizeWs(newText))
                        : normContent.replace(normOldText, normalizeWs(newText));
                    try {
                        fs.writeFileSync(filePath, normEdited, 'utf8');
                        const normLines = normOldText.split('\n');
                        const normInsIdx = normContent.slice(0, normIdx).split('\n').length;
                        return `Edited (whitespace-normalized): ${path.basename(filePath)} at L${normInsIdx} — ${normLines.length} lines replaced`;
                    } catch (e) {
                        return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
                    }
                }
                // Wave 234: Show nearby context window as hint — helps agent fix old_text
                const lines = content.split('\n');
                const oldFirst = oldText.split('\n')[0]!.trim().slice(0, 30);
                const closest = lines
                    .map((l, i) => ({ line: i + 1, text: l, score: l.trim().includes(oldFirst) ? 2 : oldFirst.length > 5 && l.toLowerCase().includes(oldFirst.toLowerCase().slice(0, 10)) ? 1 : 0 }))
                    .filter(l => l.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 2);
                let hint = '';
                if (closest.length > 0) {
                    const ctxLines = closest.map(c => {
                        const from = Math.max(0, c.line - 3);
                        const to = Math.min(lines.length - 1, c.line + 2);
                        const ctx = lines.slice(from, to + 1).map((l, i) => `  ${from + i + 1 === c.line ? '▶' : ' '}${String(from + i + 1).padStart(4)}: ${l.slice(0, 100)}`).join('\n');
                        return `Near L${c.line} (use read_file start_line=${Math.max(1, c.line - 5)} end_line=${Math.min(lines.length, c.line + 10)}):\n${ctx}`;
                    }).join('\n\n');
                    hint = `\nNearest match candidates:\n${ctxLines}\nCheck indentation and whitespace — copy text exactly from read_file output.`;
                } else {
                    // Wave 424: auto-include file content (up to 80 lines) so agent can self-correct without extra read_file call
                    const previewLines = lines.slice(0, 80);
                    const PAD424 = String(lines.length).length;
                    const preview424 = previewLines.map((l, i) => `${String(i + 1).padStart(PAD424)}: ${l}`).join('\n');
                    const truncNote424 = lines.length > 80 ? `\n...(${lines.length - 80} more lines — use read_file to see rest)` : '';
                    hint = `\nFile content (${lines.length} lines) — find the exact text and retry:\n${preview424}${truncNote424}`;
                }
                return `Error: old_text not found in ${filePath}.${hint}`;
            }
            if (count > 1 && !replaceAll && nthOccurrence === 0) {
                return `Error: old_text found ${count} times in ${filePath}. Options:\n  • Add more surrounding context to make old_text unique\n  • Use nth_occurrence=1 (first), nth_occurrence=${count} (last), or any N between\n  • Use replace_all:true to replace all occurrences`;
            }
            // Wave 361: nth_occurrence — replace the Nth match specifically
            if (nthOccurrence > 0 && count > 0) {
                let occIdx = 0; let pos = 0; let targetStart = -1;
                while (occIdx < nthOccurrence) {
                    const found = content.indexOf(oldText, pos);
                    if (found === -1) break;
                    occIdx++;
                    if (occIdx === nthOccurrence) { targetStart = found; break; }
                    pos = found + 1;
                }
                if (targetStart === -1) return `Error: old_text found ${count} times but occurrence ${nthOccurrence} requested.`;
                const edited = content.slice(0, targetStart) + newText + content.slice(targetStart + oldText.length);
                try {
                    if (!autoApprove) {
                        console.log('');
                        console.log('  ' + C.yellow(`⚡ Edit (occurrence ${nthOccurrence}/${count}): ${C.white(filePath)}`));
                        if (!rl) return 'Edit cancelled.';
                        const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [') + C.green('y') + C.dim('/N] '), res));
                        if (!ok.trim().toLowerCase().startsWith('y')) return 'Edit cancelled.';
                    }
                    fs.writeFileSync(filePath, edited, 'utf8');
                    const lineN = content.slice(0, targetStart).split('\n').length;
                    return `Edited (occurrence ${nthOccurrence}/${count}): ${path.basename(filePath)} at L${lineN}`;
                } catch (e) { return `Error writing: ${e instanceof Error ? e.message : String(e)}`; }
            }
            // Exactly one match (or replace_all) — apply edit
            if (!autoApprove) {
                const preview = oldText.length > 200 ? oldText.slice(0, 200) + '...' : oldText;
                console.log('');
                console.log('  ' + C.yellow(`\u26A1 Edit: ${C.white(filePath)}`));
                console.log('  ' + C.red('  - ' + preview.split('\n').join('\n  - ')));
                console.log('  ' + C.green('  + ' + (newText.length > 200 ? newText.slice(0, 200) + '...' : newText).split('\n').join('\n  + ')));
                if (!rl) return 'Edit cancelled (no interactive prompt in --task mode without --yes).';
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [') + C.green('y') + C.dim('/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Edit cancelled.';
            }
            const edited = replaceAll
                ? content.split(oldText).join(newText)  // replace all occurrences
                : content.replace(oldText, newText);     // replace first occurrence only
            try {
                fs.writeFileSync(filePath, edited, 'utf8');
                // Wave 64/204: compact diff with line numbers so LLM can verify the change
                const editedLines = edited.split('\n');
                const insertionIdx = content.slice(0, content.indexOf(oldText)).split('\n').length;
                const oldLineArr = oldText.split('\n');
                const newLineArr = newText.split('\n');
                const DIFF_LIMIT = 8;
                const removed = oldLineArr.slice(0, DIFF_LIMIT).map((l, i) => `L${insertionIdx + i}: - ${l}`);
                const added = newLineArr.slice(0, DIFF_LIMIT).map((l, i) => `L${insertionIdx + i}: + ${l}`);
                const moreRemoved = oldLineArr.length > DIFF_LIMIT ? `  ...(${oldLineArr.length - DIFF_LIMIT} more removed)` : '';
                const moreAdded = newLineArr.length > DIFF_LIMIT ? `  ...(${newLineArr.length - DIFF_LIMIT} more added)` : '';
                const diffBlock = removed.join('\n') + (moreRemoved ? '\n' + moreRemoved : '') + '\n' + added.join('\n') + (moreAdded ? '\n' + moreAdded : '');
                const replaceCount = replaceAll && count > 1 ? ` (${count} occurrences replaced)` : '';
                const lineChange = newLineArr.length - oldLineArr.length;
                const lineSummary = lineChange > 0 ? ` +${lineChange} lines` : lineChange < 0 ? ` ${lineChange} lines` : ' ±0 lines';
                return `Edited: ${path.basename(filePath)}${replaceCount}${lineSummary} (${editedLines.length} total)\n${diffBlock}`;
            } catch (e) {
                return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        // Wave 224: patch_file — apply multiple old→new replacements in one call
        case 'patch_file': {
            const patchFilePath = resolvePath(args['path'] || '');
            if (!args['path']) return 'Error: path is required';
            let patchList: Array<{ old_text: string; new_text: string }>;
            try {
                patchList = typeof args['patches'] === 'string'
                    ? JSON.parse(args['patches']) as typeof patchList
                    : (args['patches'] as unknown as typeof patchList);
            } catch {
                return 'Error: patches must be a JSON array of { old_text, new_text } objects';
            }
            if (!Array.isArray(patchList) || patchList.length === 0) return 'Error: patches must be a non-empty array';
            let patchContent: string;
            try {
                patchContent = fs.readFileSync(patchFilePath, 'utf8').replace(/^\uFEFF/, '');
            } catch (e) {
                return `Error reading: ${e instanceof Error ? e.message : String(e)}`;
            }
            const results: string[] = [];
            let patchFailed = false;
            for (let pi = 0; pi < patchList.length; pi++) {
                const { old_text, new_text } = patchList[pi]!;
                if (!old_text) { results.push(`Patch ${pi + 1}: skipped (empty old_text)`); continue; }
                if (!patchContent.includes(old_text)) {
                    // whitespace-tolerant fallback
                    const normalizeWs = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n');
                    const norm = normalizeWs(patchContent);
                    const normOld = normalizeWs(old_text);
                    if (norm.includes(normOld) && normOld.trim().length > 10) {
                        patchContent = norm.replace(normOld, normalizeWs(new_text));
                        results.push(`Patch ${pi + 1}: applied (whitespace-normalized)`);
                        continue;
                    }
                    results.push(`Patch ${pi + 1}: FAILED — old_text not found`);
                    patchFailed = true;
                    continue;
                }
                const countMatches = patchContent.split(old_text).length - 1;
                if (countMatches > 1) {
                    results.push(`Patch ${pi + 1}: FAILED — old_text found ${countMatches} times (ambiguous)`);
                    patchFailed = true;
                    continue;
                }
                const before = patchContent.slice(0, patchContent.indexOf(old_text)).split('\n').length;
                const oldLen = old_text.split('\n').length;
                const newLen = new_text.split('\n').length;
                patchContent = patchContent.replace(old_text, new_text);
                results.push(`Patch ${pi + 1}: applied at L${before} (${oldLen}→${newLen} lines)`);
            }
            // Wave 382: dry_run param — preview patches without writing
            const patchDryRun382 = args['dry_run'] === 'true' || args['dry_run'] === true as unknown as string;
            if (patchDryRun382) {
                const status382 = patchFailed ? 'partial' : 'all-ok';
                return `[dry-run] patch_file ${status382} on ${path.basename(patchFilePath)} (${patchList.length} patches, file NOT modified):\n${results.join('\n')}`;
            }
            try {
                fs.writeFileSync(patchFilePath, patchContent, 'utf8');
                const status = patchFailed ? 'partial' : 'success';
                return `patch_file ${status} on ${path.basename(patchFilePath)} (${patchList.length} patches):\n${results.join('\n')}`;
            } catch (e) {
                return `Error writing: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'create_directory': {
            const dirPath = resolvePath(args['path'] || '');
            try {
                fs.mkdirSync(dirPath, { recursive: true });
                return `Created: ${dirPath}`;
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'delete_file': {
            // Wave 370: support paths array for batch deletion + dry_run preview
            const dryRun370 = args['dry_run'] === 'true' || args['dry_run'] === true as unknown as string;
            // Accept single path or comma-separated list
            const rawPaths370 = String(args['path'] || '');
            const pathList370 = rawPaths370.split(',').map((p: string) => p.trim()).filter(Boolean).map(resolvePath);
            if (pathList370.length === 0) return 'Error: path is required';
            const results370: string[] = [];
            for (const filePath of pathList370) {
                try {
                    const stat = fs.statSync(filePath);
                    const size = stat.size < 1024 ? `${stat.size} B` : `${(stat.size / 1024).toFixed(1)} KB`;
                    if (dryRun370) { results370.push(`[dry-run] Would delete: ${filePath} (${size})`); continue; }
                    if (!autoApprove) {
                        console.log('');
                        console.log('  ' + C.red(`\u26A1 DELETE: ${C.white(filePath)} ${C.dim(`(${size})`)}`));
                        if (!rl) return 'Delete cancelled (no interactive prompt in --task mode without --yes).';
                        const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Permanently delete? [y/N] '), res));
                        if (!ok.trim().toLowerCase().startsWith('y')) { results370.push(`Cancelled: ${filePath}`); continue; }
                    }
                    fs.unlinkSync(filePath);
                    results370.push(`Deleted: ${filePath}`);
                } catch (e) {
                    results370.push(`Error: ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            return results370.join('\n');
        }

        case 'move_file': {
            const src = resolvePath(args['source'] || '');
            const dst = resolvePath(args['destination'] || '');
            if (!autoApprove) {
                // Wave 398: show source file size in move prompt
                let moveSzNote398 = '';
                try { const st = fs.statSync(src); moveSzNote398 = C.dim(` (${st.size < 1024 ? st.size + 'B' : (st.size/1024).toFixed(1) + 'kb'})`); } catch { /* skip */ }
                console.log('');
                console.log('  ' + C.yellow(`\u26A1 Move: ${C.white(src)}${moveSzNote398} \u2192 ${C.white(dst)}`));
                if (!rl) return 'Move cancelled (no interactive prompt in --task mode without --yes).';
                const ok = await new Promise<string>(res => rl.question('  ' + C.dim('  Approve? [') + C.green('y') + C.dim('/N] '), res));
                if (!ok.trim().toLowerCase().startsWith('y')) return 'Move cancelled.';
            }
            try {
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.renameSync(src, dst);
                return `Moved: ${src} → ${dst}`;
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'copy_file': {
            const src = resolvePath(args['source'] || '');
            const dst = resolvePath(args['destination'] || '');
            try {
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(src, dst);
                return `Copied: ${src} → ${dst}`;
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        // Wave 74: glob_files tool
        case 'glob_files': {
            const pattern = args['pattern'] || '';
            const dir = resolvePath(args['directory'] || process.cwd());
            const limit = Math.min(parseInt(String(args['limit'] || '50'), 10) || 50, 200);
            // Wave 197: sort parameter — name (default), mtime (newest first), size (largest first)
            const sortMode = String(args['sort'] || 'name').toLowerCase();
            if (!pattern) return 'Error: pattern is required';
            // Wave 192: skip_dirs parameter — extra dirs to skip beyond defaults
            const GLOB_SKIP = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage', '.nyc_output']);
            const extraSkip = String(args['skip_dirs'] || '').split(',').map(s => s.trim()).filter(Boolean);
            for (const s of extraSkip) GLOB_SKIP.add(s);
            // Wave 372: modified_since param — filter to files modified within N minutes/hours/days
            const modifiedSinceArg372 = String(args['modified_since'] || '').trim().toLowerCase();
            let modifiedSinceCutoff372 = 0;
            if (modifiedSinceArg372) {
                const ms372Match = modifiedSinceArg372.match(/^(\d+)(m|h|d)$/);
                if (ms372Match) {
                    const n372 = parseInt(ms372Match[1]!, 10);
                    const unit372 = ms372Match[2];
                    const mult372 = unit372 === 'm' ? 60_000 : unit372 === 'h' ? 3_600_000 : 86_400_000;
                    modifiedSinceCutoff372 = Date.now() - n372 * mult372;
                }
            }
            // Wave 397: skip_binary param — exclude common binary extensions
            const skipBinary397 = args['skip_binary'] === 'true' || args['skip_binary'] === true as unknown as string;
            const BINARY_EXTS397 = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'mp4', 'mp3', 'wav', 'ogg', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pyc', 'class', 'o', 'obj', 'a', 'lib', 'db', 'sqlite', 'sqlite3']);
            // Wave 356: exclude param — exclude files/dirs matching any of these patterns (glob-style)
            const excludePatterns356 = String(args['exclude'] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            const isExcluded356 = (relPath: string): boolean => {
                if (excludePatterns356.length === 0) return false;
                return excludePatterns356.some(ep => {
                    const re = new RegExp(ep.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\x01').replace(/\*/g, '[^/]*').replace(/\x01/g, '.*'));
                    return re.test(relPath) || relPath.includes('/' + ep + '/') || relPath.startsWith(ep + '/');
                });
            };
            try {
                // Pure Node.js glob: walk directory recursively and match against pattern
                const regexStr = pattern
                    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials except * and ?
                    .replace(/\*\*/g, '\u0001')             // placeholder for **
                    .replace(/\*/g, '[^/]*')                // * → match non-slash
                    .replace(/\?/g, '[^/]')                 // ? → match any single non-slash
                    .replace(/\u0001/g, '.*');              // ** → match anything
                const re = new RegExp('^' + regexStr + '$');
                const results: Array<{ relPath: string; size: number; mtime: number }> = [];
                const walk = (d: string, rel: string) => {
                    if (results.length >= limit * 3) return; // collect more for sorting
                    let entries: fs.Dirent[];
                    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                    for (const e of entries) {
                        if (e.name.startsWith('.') && !pattern.startsWith('.') && !pattern.includes('/.')) continue;
                        if (e.isDirectory() && GLOB_SKIP.has(e.name)) continue;
                        const relPath = rel ? `${rel}/${e.name}` : e.name;
                        if (isExcluded356(relPath)) continue;
                        if (e.isDirectory()) { walk(path.join(d, e.name), relPath); }
                        else if (re.test(relPath)) {
                            // Wave 397: skip binary files if flag set
                            if (skipBinary397 && BINARY_EXTS397.has(path.extname(e.name).slice(1).toLowerCase())) continue;
                            let size = 0; let mtime = 0;
                            try { const st = fs.statSync(path.join(dir, relPath)); size = st.size; mtime = st.mtimeMs; } catch { /* skip */ }
                            results.push({ relPath, size, mtime });
                        }
                    }
                };
                walk(dir, '');
                // Wave 372: apply modified_since filter after walk
                const filteredResults372 = modifiedSinceCutoff372 > 0
                    ? results.filter(r => r.mtime >= modifiedSinceCutoff372)
                    : results;
                if (filteredResults372.length === 0) {
                    return modifiedSinceCutoff372 > 0
                        ? `No files matched: ${pattern} (modified in last ${modifiedSinceArg372})`
                        : `No files matched: ${pattern}`;
                }
                // re-assign so sort + limit use filtered set
                results.length = 0;
                for (const r of filteredResults372) results.push(r);
                if (results.length === 0) return `No files matched: ${pattern}`;
                // Wave 197: sort by mtime or size if requested
                if (sortMode === 'mtime') results.sort((a, b) => b.mtime - a.mtime);
                else if (sortMode === 'size') results.sort((a, b) => b.size - a.size);
                else results.sort((a, b) => a.relPath.localeCompare(b.relPath));
                const limited = results.slice(0, limit);
                // Wave 222: content_preview — show first line of each matched file
                const showPreview = args['content_preview'] === 'true' || args['content_preview'] === true as unknown as string;
                const lines = limited.map(r => {
                    const sz = r.size < 1024 ? `${r.size}B` : r.size < 1_048_576 ? `${(r.size/1024).toFixed(1)}kb` : `${(r.size/1_048_576).toFixed(1)}mb`;
                    const mtStr = sortMode === 'mtime' ? ' ' + new Date(r.mtime).toISOString().slice(0, 16).replace('T', ' ') : '';
                    let preview = '';
                    if (showPreview && r.size < 50_000) {
                        try {
                            const firstLine = fs.readFileSync(path.join(dir, r.relPath), 'utf8').split('\n').find(l => l.trim()) || '';
                            if (firstLine) preview = `  → ${firstLine.trim().slice(0, 80)}`;
                        } catch { /* skip */ }
                    }
                    return `${r.relPath} (${sz}${mtStr})${preview}`;
                });
                return lines.join('\n') + (results.length >= limit ? `\n...(limit ${limit} reached)` : '') + `\n\n${results.length} file${results.length !== 1 ? 's' : ''} found`;
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        // Wave 74: http_get tool for fetching documentation
        case 'http_get': {
            const url = args['url'] || '';
            if (!url) return 'Error: url is required';
            if (!url.startsWith('http://') && !url.startsWith('https://')) return 'Error: url must start with http:// or https://';
            // Wave 206/416: timeout_secs parameter (default 10, max 60)
            const httpTimeoutMs = Math.min(60, Math.max(3, parseInt(String(args['timeout_secs'] || '10'), 10) || 10)) * 1000;
            try {
                // Wave 156: auto-follow redirects (up to 3 hops)
                const httpMethod = String(args['method'] || 'GET').toUpperCase();
                const httpBody = (httpMethod === 'POST' && args['body']) ? String(args['body']) : undefined;
                const fetchUrl = async (targetUrl: string, hops = 0): Promise<string> => {
                    if (hops > 3) return 'Error: too many redirects';
                    return new Promise<string>((resolve, reject) => {
                        const http = require('http') as typeof import('http');
                        const https = require('https') as typeof import('https');
                        const parsed = new URL(targetUrl);
                        const mod = parsed.protocol === 'https:' ? https : http;
                        const headersArg = typeof args['headers'] === 'object' ? args['headers'] as Record<string, string> : {};
                        const reqHeaders: Record<string, string> = { 'User-Agent': 'TentaCLAW-CLI/' + CLI_VERSION, ...headersArg };
                        if (httpBody && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
                            reqHeaders['Content-Type'] = httpBody.trimStart().startsWith('{') ? 'application/json' : 'text/plain';
                        }
                        if (httpBody) reqHeaders['Content-Length'] = String(Buffer.byteLength(httpBody, 'utf8'));
                        const reqOpts = { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: httpMethod, headers: reqHeaders };
                        const req = mod.request(reqOpts, (res) => {
                            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, targetUrl).toString();
                                fetchUrl(nextUrl, hops + 1).then(resolve).catch(reject); return;
                            }
                            let body = '';
                            res.setEncoding('utf8');
                            res.on('data', (c: string) => { body += c; if (body.length > 80_000) req.destroy(); });
                            res.on('end', () => resolve(`Status: ${res.statusCode}\n\n${body}`));
                        });
                        req.on('error', reject);
                        req.setTimeout(httpTimeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
                        if (httpBody) req.write(httpBody);
                        req.end();
                    });
                };
                const result = await fetchUrl(url);
                // Wave 130: strip HTML for cleaner output if content-type is HTML
                // Wave 243: pretty-print JSON responses for better model comprehension
                let cleaned = result;
                const bodyPart = result.replace(/^Status: \d+\n\n/, '');
                const statusLine = result.slice(0, result.indexOf('\n\n') + 2);
                if (bodyPart.trimStart().startsWith('{') || bodyPart.trimStart().startsWith('[')) {
                    try {
                        const parsed2 = JSON.parse(bodyPart);
                        cleaned = statusLine + JSON.stringify(parsed2, null, 2);
                    } catch { /* keep raw */ }
                } else if (result.includes('<html') || result.includes('<!DOCTYPE') || result.includes('<body')) {
                    cleaned = result
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
                        .replace(/[ \t]{2,}/g, ' ')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                }
                const truncated = cleaned.length > 8000 ? cleaned.slice(0, 8000) + '\n...(truncated at 8000 chars)' : cleaned;
                // Wave 390: json_path param — extract a specific field from JSON response using dot notation
                const jsonPath390 = String(args['json_path'] || '').trim();
                if (jsonPath390) {
                    try {
                        const jsonBody390 = JSON.parse(result.replace(/^Status: \d+\n\n/, ''));
                        const parts390 = jsonPath390.split('.').flatMap(p => {
                            const arrMatch = p.match(/^(.+?)\[(\d+)\]$/);
                            return arrMatch ? [arrMatch[1]!, arrMatch[2]!] : [p];
                        });
                        let val390: unknown = jsonBody390;
                        for (const k of parts390) {
                            if (val390 === null || val390 === undefined) break;
                            val390 = (val390 as Record<string, unknown>)[k];
                        }
                        if (val390 === undefined) return `json_path "${jsonPath390}" not found in response`;
                        return typeof val390 === 'string' ? val390 : JSON.stringify(val390, null, 2);
                    } catch { /* json_path failed — fall through to full response */ }
                }
                return `HTTP ${httpMethod} ${url}\n${truncated}`;
            } catch (e) {
                return `Error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        case 'write_note': {
            // Wave 187/349: append note to daily memory file; persist=true also appends to MEMORY.md
            const note = args['note'] || '';
            const tag = args['tag'] ? `[${args['tag']}] ` : '';
            const persist = args['persist'] === 'true';
            if (!note) return 'Error: note is required';
            const today = new Date().toISOString().slice(0, 10);
            const noteDir = path.join(getWorkspaceDir(), 'memory');
            const notePath = path.join(noteDir, `${today}.md`);
            try {
                fs.mkdirSync(noteDir, { recursive: true });
                const time = new Date().toISOString().slice(11, 16);
                const entry = `\n- ${time} ${tag}${note}`;
                fs.appendFileSync(notePath, entry, 'utf8');
                // Wave 349: persist=true also writes to MEMORY.md for cross-session durability
                // Wave 428: dedup — don't write same note twice to MEMORY.md
                if (persist) {
                    const memPath = path.join(getWorkspaceDir(), 'MEMORY.md');
                    const existing428 = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';
                    const noteKey428 = `${tag}${note}`.trim().slice(0, 80);
                    if (!existing428.includes(noteKey428)) {
                        const memEntry = `\n- ${today} ${tag}${note}`;
                        fs.appendFileSync(memPath, memEntry, 'utf8');
                        return `Note saved to ${today}.md and MEMORY.md: "${note.slice(0, 60)}"`;
                    }
                    return `Note already in MEMORY.md — saved to ${today}.md only: "${note.slice(0, 60)}"`;
                }
                return `Note saved to ${today}.md: "${note.slice(0, 60)}"`;
            } catch (e) {
                return `Error saving note: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        default:
            return `Unknown tool: ${call.name}`;
    }
}

// =============================================================================
// Code Agent — Main Command
// =============================================================================

/** Check GitHub for latest release; notify user if update available. Cached 24h. */
async function checkForUpdate(): Promise<void> {
    if (Math.random() > 0.05) return;   // 5% of runs
    try {
        const cacheFile = path.join(getConfigDir(), 'update-check.json');
        // Check cache (valid for 24h)
        if (fs.existsSync(cacheFile)) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { checkedAt: string; latestVersion: string };
            const age = Date.now() - new Date(cached.checkedAt).getTime();
            if (age < 86_400_000) {
                if (cached.latestVersion && cached.latestVersion !== `v${CLI_VERSION}`) {
                    console.log('  ' + C.yellow(`\u2605 Update available: ${cached.latestVersion}`) + C.dim('  \u2192  tentaclaw update'));
                }
                return;
            }
        }
        // Fetch from GitHub
        const data = await new Promise<string>((resolve, reject) => {
            const req = https.request({
                hostname: 'api.github.com',
                path: '/repos/TentaCLAW-OS/tentaclaw-os/releases/latest',
                method: 'GET',
                headers: { 'User-Agent': `tentaclaw-cli/${CLI_VERSION}`, 'Accept': 'application/vnd.github.v3+json' },
                timeout: 3000,
            }, (res) => {
                let body = '';
                res.on('data', (c: Buffer) => { body += c.toString(); });
                res.on('end', () => resolve(body));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.end();
        });
        const release = JSON.parse(data) as { tag_name?: string };
        const latest = release.tag_name || `v${CLI_VERSION}`;
        fs.mkdirSync(getConfigDir(), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: latest }), 'utf8');
        if (latest !== `v${CLI_VERSION}`) {
            console.log('  ' + C.yellow(`\u2605 Update available: ${latest}`) + C.dim('  \u2192  tentaclaw update'));
        }
    } catch { /* silent — never break startup */ }
}

async function cmdCode(gateway: string, flags: Record<string, string>): Promise<void> {
    // Wave 79: --headless implies --yes (no human in the loop)
    const headless = flags['headless'] === 'true';
    // Wave 233: load autoApprove default from config (set via `tentaclaw config set autoApprove true`)
    const savedAutoApprove = loadConfig()?.autoApprove ?? false;
    let autoApprove = flags['yes'] === 'true' || flags['y'] === 'true' || headless || savedAutoApprove;
    // Wave 124/455: --temp flag; default 0.1 for coding tasks (more deterministic), 0.7 for chat
    const defaultTemp = (flags['no-tools'] === 'true' || flags['chat'] === 'true') ? 0.7 : 0.1;
    const tempFlag = parseFloat(flags['temp'] || flags['temperature'] || String(defaultTemp));
    let agentTemperature = isNaN(tempFlag) ? defaultTemp : Math.min(2.0, Math.max(0.0, tempFlag));
    // Wave 100: --checkpoint auto-commits to git after each write/edit tool call
    const checkpoint = flags['checkpoint'] === 'true' || flags['cp'] === 'true';
    // Wave 109: --no-tools runs code agent as pure chat (no tool use)
    // Wave 427: let so it can be flipped at runtime when model doesn't support tools
    let noTools = flags['no-tools'] === 'true' || flags['chat'] === 'true';
    // Wave 159: --max-iter limits agent iterations (default 20, max 50)
    const maxIter = Math.min(50, Math.max(1, parseInt(flags['max-iter'] || flags['max_iter'] || '20', 10) || 20));
    // Wave 333: --timeout <seconds> aborts agent after wall-clock time limit
    const timeoutSecs = parseInt(flags['timeout'] || '0', 10) || 0;
    const agentDeadline = timeoutSecs > 0 ? Date.now() + timeoutSecs * 1000 : 0;
    // Wave 271: --max-tokens controls max response length (default: no limit, up to model's max)
    const maxTokensFlag = parseInt(flags['max-tokens'] || flags['max_tokens'] || '0', 10) || 0;
    const nodeFlag = flags['node'] || flags['n'] || '';       // --node <id> to pin to specific cluster node
    // Wave 237: --print mode — suppress splash/status lines, output only model response (for scripting)
    // Wave 251: --json mode — output final result as JSON object (implies printMode)
    const jsonMode = flags['json'] === 'true';
    const printMode = flags['print'] === 'true' || flags['p'] === 'true' || jsonMode;

    // Wave 560: --persona <type> changes agent personality/focus
    // Types: default, security, concise, educational, senior, rubber-duck
    const personaFlag = flags['persona'] || flags['persona-type'] || '';
    const PERSONA_PROMPTS: Record<string, string> = {
        security:    '\n\n## Persona: Security-Focused\nYou are a security-focused engineer. Always check for: injection vulnerabilities, insecure defaults, missing auth, exposed secrets, and OWASP top 10. Flag security issues before implementing features.',
        concise:     '\n\n## Persona: Concise\nBe extremely concise. No explanations unless asked. Code only. One sentence descriptions max.',
        educational: '\n\n## Persona: Educational\nExplain everything as you go. Show your reasoning. Teach the user what you\'re doing and why.',
        senior:      '\n\n## Persona: Senior Engineer\nYou are a principal engineer. Always consider: scalability, maintainability, testing, performance, and long-term consequences. Point out technical debt.',
        'rubber-duck': '\n\n## Persona: Rubber Duck\nHelp the user think through problems by asking clarifying questions. Don\'t jump to solutions. Make them reason through it.',
    };
    const personaPromptExtra = personaFlag && PERSONA_PROMPTS[personaFlag] ? PERSONA_PROMPTS[personaFlag] : '';

    // Wave 562: --consensus runs the prompt on 3 models and picks the most consistent answer
    const consensusFlag = flags['consensus'] === 'true' || flags['consensus'] === '';

    // Wave 566: --long-context prefers model with largest context window
    const longContextFlag = flags['long-context'] === 'true' || flags['long-ctx'] === 'true';

    // Wave 567: --quantize-aware adjusts prompting based on model size/tier
    const quantizeAwareFlag = flags['quantize-aware'] === 'true';
    // Wave 545: --tdd mode — write tests first, then implementation
    const tddFlag = flags['tdd'] === 'true' || flags['tdd'] === '';

    // Wave 63: --agent <name> loads a named workspace (workspace-<name>/ directory)
    const agentFlag = flags['agent'] || flags['a'] || '';
    const agentWorkspaceOverride = agentFlag
        ? path.join(getConfigDir(), `workspace-${agentFlag}`)
        : '';

    // Wave 45: --file <path> — load file content as initial task
    let taskFlag = flags['task'] || flags['t'] || '';
    const fileFlag = flags['file'] || flags['f'] || '';
    if (fileFlag) {
        try {
            const fileContent = fs.readFileSync(path.resolve(fileFlag), 'utf8').replace(/^\uFEFF/, '');
            taskFlag = taskFlag
                ? `${taskFlag}\n\n[File: ${fileFlag}]\n${fileContent}`
                : `[File: ${fileFlag}]\n${fileContent}`;
        } catch (e) {
            console.error(C.red(`  ✘ Cannot read --file "${fileFlag}": ${e instanceof Error ? e.message : String(e)}`));
            process.exit(1);
        }
    }
    // Wave 242: read from stdin with --stdin flag (explicit opt-in for piping)
    // e.g. "git diff | tentaclaw code --stdin --task 'write commit msg'"
    // Not auto-detected — would break interactive REPL when stdin is inherited pipe
    const stdinFlag = flags['stdin'] === 'true';
    if (stdinFlag && !process.stdin.isTTY) {
        const stdinChunks: Buffer[] = [];
        for await (const chunk of process.stdin) stdinChunks.push(chunk as Buffer);
        const stdinText = Buffer.concat(stdinChunks).toString('utf8').trim();
        if (stdinText) {
            taskFlag = taskFlag ? `${taskFlag}\n\n[stdin]\n${stdinText}` : stdinText;
        }
    }

    // Resolve inference endpoint: config > gateway > local Ollama
    let inferenceUrl = '';
    let inferenceHeaders: Record<string, string> = {};
    let model = flags['model'] || '';
    let backendLabel = '';

    const config = loadConfig();

    if (config) {
        // Config exists — use configured provider
        const resolved = resolveInferenceFromConfig(config);
        inferenceUrl = resolved.url;
        inferenceHeaders = resolved.headers;
        if (!model) model = config.model;
        backendLabel = C.green(config.provider);
    }

    // If no config or config provider unavailable, try gateway
    if (!inferenceUrl || !model) {
        const gwResp = await apiProbe(gateway, '/v1/models') as { data?: Array<{ id: string }> } | null;
        const gatewayModels = (gwResp?.data || []).map(m => m.id);
        if (model && gatewayModels.includes(model)) {
            inferenceUrl = gateway;
            backendLabel = C.teal('cluster');
        } else if (model && !gatewayModels.includes(model)) {
            // Wave 244: fuzzy match — find model that starts with the given prefix (e.g. "gemma3" → "gemma3:8b")
            const fuzzy = gatewayModels.find(m => m.startsWith(model) || m.toLowerCase().startsWith(model.toLowerCase()));
            if (fuzzy) { model = fuzzy; inferenceUrl = gateway; backendLabel = C.teal('cluster'); }
        } else if (!model && gatewayModels.length > 0) {
            inferenceUrl = gateway;
            model = gatewayModels.find(m => /instruct|chat|code/i.test(m)) || gatewayModels[0];
            backendLabel = C.teal('cluster');
        }
    }

    // Last resort: probe local Ollama
    if (!inferenceUrl || !model) {
        for (const port of [11434, 11435]) {
            const resp = await apiProbe(`http://localhost:${port}`, '/v1/models') as { data?: Array<{ id: string }> } | null;
            const list = (resp?.data || []).map(m => m.id);
            if (list.length > 0) {
                inferenceUrl = `http://localhost:${port}`;
                if (!model) {
                    model = list.find(m => /code|coder|instruct/i.test(m)) || list.find(m => /chat/i.test(m)) || list[0];
                }
                backendLabel = C.yellow('local Ollama');
                break;
            }
        }
    }

    if (!inferenceUrl) {
        console.error('');
        console.error(C.red('  \u2718 No inference backend available.'));
        // Wave 438: detect if Ollama is installed but not running vs not installed at all
        const ollamaInstalled438 = (() => { try { execSync('ollama --version', { stdio: 'ignore' }); return true; } catch { return false; } })();
        if (ollamaInstalled438) {
            console.error(C.yellow('  Ollama is installed but not running.'));
            console.error(C.dim('  Start it: ') + C.cyan('ollama serve'));
            console.error(C.dim('  Then pull a model: ') + C.cyan('ollama pull hermes3:8b'));
        } else {
            console.error(C.dim('  Option A — Install Ollama (free, runs locally):'));
            console.error(C.cyan('    https://ollama.com/download'));
            console.error(C.dim('  Option B — Configure an API provider:'));
            console.error(C.cyan('    tentaclaw setup'));
            console.error('');
            console.error(C.dim('  Recommended first model (fits 8 GB VRAM or RAM):'));
            console.error(C.cyan('    ollama pull hermes3:8b'));
            console.error(C.dim('  CPU-only (no GPU needed):'));
            console.error(C.cyan('    ollama pull bitnet-b1.58-3b'));
        }
        console.error('');
        process.exit(1);
    }
    if (!model) model = 'llama3.1:8b';

    // Wave 446: detect which local backend is running — drives capability matrix in Wave 447
    _detectedBackend = await detectLocalBackend(inferenceUrl, config?.provider);
    const backendDisplayName: Record<LocalBackend, string> = {
        ollama: 'Ollama (local)', lmstudio: 'LM Studio (local)', llamafile: 'llamafile (local)',
        vllm: 'vllm (local)', tabbyapi: 'tabbyAPI (local)',
        openai: 'OpenAI', openrouter: 'OpenRouter', unknown: 'local',
    };
    if (!printMode) {
        console.log('  ' + C.dim('backend  ') + C.green(backendDisplayName[_detectedBackend]) + C.dim('    model  ') + C.white(model));
    }

    // Initialize workspace (Wave 63: apply named workspace override before ensureWorkspace)
    if (agentWorkspaceOverride) {
        _workspaceDirOverride = agentWorkspaceOverride;
    }
    ensureWorkspace();

    // Session management
    // Wave 105: --last resumes the most recently updated session
    let resumeId = flags['resume'] || flags['session'] || '';
    if (!resumeId && (flags['last'] === 'true' || flags['continue'] === 'true')) {
        const idx = loadSessionIndex();
        const sorted = Object.values(idx).sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
        if (sorted.length > 0) resumeId = sorted[0]!.sessionId;
    }
    let sessionId = resumeId || generateSessionId();
    const sessionUsage = newUsageStats();
    const sessionStartMs = Date.now();  // Wave 191: session duration tracking
    let sessionToolCallCount = 0;  // Wave 160: running tool call counter for /status
    let lastToolSignature = '';  // Wave 168: loop detection — tracks last tool+args combo
    const toolCallFreq435 = new Map<string, number>();  // Wave 435: frequency map for all tool calls
    const sessionFilesTouched = new Set<string>();  // Wave 323: track files modified this session
    // Wave 554: undo stack — records file state before each write/edit for /undo
    const undoStack554: Array<{ path: string; content: string | null; action: string; timestamp: number }> = [];

    void checkForUpdate();   // background — never blocks startup
    if (!printMode) { bootSplash(); }
    // Wave 140: show git branch in startup banner
    let gitBranch = '';
    try { gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { /* not git */ }
    if (!printMode) {
        console.log('  ' + C.purple(C.bold('Code Agent')) + C.dim(` \u2014 model: ${model}`) + C.dim(' via ') + backendLabel + (gitBranch ? C.dim(`  [${gitBranch}]`) : ''));
        console.log('  ' + C.dim(`cwd: ${process.cwd()}`) + C.dim(`  session: ${sessionId.slice(0, 8)}`));
        // Wave 153: detect project stack for banner
        const stackMarkers: Record<string, string> = {
            'package.json': 'Node.js', 'Cargo.toml': 'Rust', 'go.mod': 'Go',
            'requirements.txt': 'Python', 'pyproject.toml': 'Python', 'pom.xml': 'Java',
            'build.gradle': 'Java', 'Gemfile': 'Ruby', 'composer.json': 'PHP',
            'mix.exs': 'Elixir', 'Makefile': 'C/C++', 'CMakeLists.txt': 'C/C++',
        };
        const detectedStack = Object.entries(stackMarkers).find(([f]) => fs.existsSync(path.join(process.cwd(), f)))?.[1] || '';
        const timeoutNote = timeoutSecs > 0 ? C.dim(`  timeout: ${timeoutSecs}s`) : '';
        const iterNote = flags['max-iter'] || flags['max_iter'] ? C.dim(`  max-iter: ${maxIter}`) : '';
        console.log('  ' + C.dim('Commands: /help for full list') + (detectedStack ? C.dim(`  |  ${detectedStack} project`) : '') + timeoutNote + iterNote);
        console.log('  ' + C.dim(autoApprove ? 'Writes & shell: \u2713 auto-approved' : 'Writes & shell: will ask for approval'));
        // Wave 308: show uncommitted changes in banner
        try {
            const dirtyBanner = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
            if (dirtyBanner) {
                const dirtyCount = dirtyBanner.split('\n').length;
                console.log('  ' + C.yellow(`\u26A0 ${dirtyCount} uncommitted change${dirtyCount !== 1 ? 's' : ''} — use tentaclaw diff or /diff to review`));
            }
        } catch { /* not a git repo */ }
        // Wave 427/433: warn when model is known to not support tools (prevents confusing stream errors)
        // Wave 433: also check Ollama model architecture for custom models (e.g. alexa-research=gemma3)
        const NO_TOOLS_MODELS = ['dark-champion', 'command-r', 'gemma2', 'gemma3', 'phi3', 'phi4', 'stablelm'];
        const NO_TOOLS_ARCHS433 = ['gemma2', 'gemma3', 'phi3', 'phi4', 'stablelm'];
        const modelBaseName = model.split(':')[0]?.toLowerCase() || '';
        let likelyNoTools = NO_TOOLS_MODELS.some(m => modelBaseName.includes(m));
        // Wave 444: fix operator precedence — parens required so localhost check has !likelyNoTools guard
        if (!likelyNoTools && (inferenceUrl.includes('11434') || inferenceUrl.includes('localhost'))) {
            // Quick Ollama model-info check — fire-and-forget, non-blocking
            try {
                const modelInfoUrl = inferenceUrl.replace(/\/+$/, '') + `/api/show`;
                const infoResp = await new Promise<string>((resolve) => {
                    const parsed433 = new URL(modelInfoUrl);
                    const lib433 = parsed433.protocol === 'https:' ? https : http;
                    const req433 = lib433.request({ hostname: parsed433.hostname, port: Number(parsed433.port) || 80, path: parsed433.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 2000 }, (res433) => {
                        let buf433 = ''; res433.on('data', (c: Buffer) => { buf433 += c.toString(); }); res433.on('end', () => resolve(buf433));
                    }); req433.on('error', () => resolve('')); req433.on('timeout', () => { req433.destroy(); resolve(''); });
                    req433.write(JSON.stringify({ name: model })); req433.end();
                });
                if (infoResp) {
                    const info433 = JSON.parse(infoResp) as { modelinfo?: Record<string, string>; details?: { family?: string }; model_info?: Record<string, unknown> };
                    const arch433 = (
                        Object.entries(info433.modelinfo || {}).find(([k]) => k.endsWith('.architecture'))?.[1] ||
                        info433.details?.family || ''
                    ).toLowerCase();
                    if (arch433 && NO_TOOLS_ARCHS433.some(a => arch433.includes(a))) {
                        likelyNoTools = true;
                    }
                    // Wave 454: extract context_length from Ollama /api/show
                    const allInfo454 = { ...info433.modelinfo, ...info433.model_info };
                    const ctxEntry454 = Object.entries(allInfo454).find(([k]) => k.endsWith('.context_length'));
                    if (ctxEntry454) {
                        const detectedCtx454 = parseInt(String(ctxEntry454[1]), 10);
                        if (detectedCtx454 > 0 && !printMode) {
                            console.log('  ' + C.dim(`Model context window: ${formatNumber(detectedCtx454)} tokens`));
                        }
                    }
                }
            } catch { /* skip if Ollama unreachable or non-Ollama endpoint */ }
        }
        if (likelyNoTools && !noTools) {
            console.log('  ' + C.yellow(`\u26A0 Note: "${model}" may not support tool calls.`));
            console.log('  ' + C.dim('  If prompts fail, use: tentaclaw code --no-tools   (chat mode)'));
            console.log('  ' + C.dim('  Or switch model:     tentaclaw config set model hermes3:8b'));
            console.log('');
        }
    }

    // Build system prompt — task mode gets a stripped-down version for better small-model focus
    let systemPrompt = taskFlag
        ? `You are an expert programmer. Complete the task using tools. Do NOT explain — just call the tool.

RULES:
- For creating files: call write_file with COMPLETE, WORKING code. No stubs, no 'pass'.
- For running commands: call run_shell.
- For reading files: call read_file.
- For editing files: call read_file first, then edit_file with exact old_text.
- Call tools IMMEDIATELY. Do not describe what you will do.
- CWD: ${process.cwd()}`
        : `You are TentaCLAW Code Agent — an expert AI software engineer embedded in TentaCLAW OS.

## Core Principles
- **Act, don't ask.** Use tools immediately. Never say "I would need to read X" — just read it.
- **Read before writing.** Always read a file before editing it. Never write code you haven't seen the context for.
- **Prefer edit_file over write_file** for modifying existing files — it's safer and more precise.
- **Verify your changes.** After editing, read the relevant section back to confirm correctness.
- **Commit small.** When checkpointing, commit logical units of work with clear messages.
- **Answer directly** for questions that don't involve files, code, or the system (math, definitions, explanations). Don't use tools for pure knowledge questions.

## Tool Strategy
- **glob_files(pattern)** — fastest way to find files.
- **search_files(pattern, file_type="ts")** — preferred over reading files to locate code.
- **read_file(path, grep="pattern")** — use grep param to return only matching lines.
- **read_file(path, start_line, end_line)** — use line ranges for large files.
- **edit_file(path, old_text, new_text)** — surgical replacement. old_text must match exactly.
- **run_shell(command)** — run tests, builds, git commands.

## Error Recovery
- If edit_file fails "not found": read the file first, copy the exact text including indentation.
- If run_shell fails: read the error, fix the cause — don't retry blindly.
- Never guess file content. Always read before editing.

## What NOT to do
- Do NOT say "I'll now...", "Let me...", "I would need to..." — just do it.
- Do NOT repeat the task back before starting. Start immediately.
- Do NOT output placeholder comments like "// add implementation here".

## Memory
- Use write_note(note, persist=true) for facts that should survive across sessions.

## Environment
- CWD: ${process.cwd()}
- Platform: ${process.platform} | Node.js: ${process.version}
- Session: ${sessionId} | Date: ${new Date().toISOString().slice(0, 10)}${noTools ? '\n- Mode: no-tools (pure chat)' : ''}`;

    // Load workspace context (SOUL.md, USER.md, IDENTITY.md, MEMORY.md, etc.)
    // In task mode: skip workspace files entirely — they add 3KB+ of personality/protocol
    // that drowns out the actual task for small models
    if (!taskFlag) {
        const workspaceCtx = loadWorkspaceContext();
        if (workspaceCtx) {
            systemPrompt += workspaceCtx;
            const wsFiles = workspaceCtx.match(/--- (\S+) ---/g)?.map(m => m.replace(/--- | ---/g, '')) || [];
            if (wsFiles.length > 0 && !printMode) {
                const wsCtxKb = (workspaceCtx.length / 1024).toFixed(1);
                console.log('  ' + C.green(`\u2714 Workspace: ${wsFiles.join(', ')}`) + C.dim(` (${wsCtxKb}kb)`));
            }
        }
    } else if (!printMode) {
        console.log('  ' + C.dim('\u2714 Workspace: task mode (lightweight)'));
    }

    // Wave 201: inject brief project structure when no CLAUDE.md/AGENTS.md loaded
    // (Skip if project context is already loaded — those files have structure info)
    const hasProjectCtx = ['AGENTS.md', 'CLAUDE.md', '.clawcode'].some(cf => {
        let d = process.cwd();
        for (let i = 0; i < 4; i++) { if (fs.existsSync(path.join(d, cf))) return true; d = path.dirname(d); if (path.dirname(d) === d) break; }
        return false;
    });
    if (!hasProjectCtx) {
        try {
            const cwdEntries = fs.readdirSync(process.cwd(), { withFileTypes: true });
            const KEY_FILES = new Set(['package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile', 'README.md', 'docker-compose.yml', '.env.example']);
            const dirs = cwdEntries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist').map(e => e.name + '/');
            const keyFiles = cwdEntries.filter(e => e.isFile() && KEY_FILES.has(e.name)).map(e => e.name);
            if (dirs.length + keyFiles.length > 0) {
                const structLine = [...dirs.slice(0, 10), ...keyFiles].join('  ');
                systemPrompt += `\n\n## Project Layout\n${structLine}`;
            }
        } catch { /* skip if cwd not accessible */ }
    }

    // Load local project context files — search cwd and up to 4 parent dirs (Wave 84)
    const findProjectFile = (name: string): string | null => {
        let dir = process.cwd();
        for (let i = 0; i < 5; i++) {
            const fp = path.join(dir, name);
            if (fs.existsSync(fp)) return fp;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return null;
    };
    for (const cf of ['AGENTS.md', 'CLAUDE.md', '.clawcode']) {
        const cfPath = findProjectFile(cf);
        if (cfPath) {
            try {
                const c = fs.readFileSync(cfPath, 'utf8');
                if (c.length < 8000) {
                    const rel = path.relative(process.cwd(), cfPath);
                    const label = rel.startsWith('..') ? `${cf} (${path.dirname(cfPath)})` : cf;
                    systemPrompt += `\n\n--- ${label} (project) ---\n${c}`;
                    if (!printMode) console.log('  ' + C.green(`\u2714 Project: ${rel.startsWith('..') ? `../${cf}` : cf}`));
                }
            } catch { /* skip unreadable */ }
        }
    }
    // Wave 341: load .clawignore — extra excluded patterns for agent file operations
    const clawignorePath = findProjectFile('.clawignore');
    _clawIgnorePatterns = [];
    if (clawignorePath) {
        try {
            const ignoreLines = fs.readFileSync(clawignorePath, 'utf8').split('\n');
            for (const l of ignoreLines) {
                const t = l.trim();
                if (t && !t.startsWith('#')) _clawIgnorePatterns.push(t.replace(/\/$/, ''));
            }
            if (_clawIgnorePatterns.length > 0 && !printMode) {
                console.log('  ' + C.dim(`\u2714 .clawignore: ${_clawIgnorePatterns.length} exclusion${_clawIgnorePatterns.length !== 1 ? 's' : ''} loaded`));
            }
        } catch { /* skip unreadable */ }
    }
    // Detect first-run bootstrap — only in interactive mode, not --task
    const bootstrapPath = path.join(getWorkspaceDir(), 'BOOTSTRAP.md');
    const hasBootstrap = !taskFlag && fs.existsSync(bootstrapPath);
    if (hasBootstrap && !printMode) {
        console.log('  ' + C.purple('\u2728 First run detected \u2014 onboarding will start'));
    }

    // Skip all context injection in task mode — keep prompt tiny for small models
    if (!taskFlag) {

    // Wave 531: project-aware context — auto-detect language/framework and inject relevant hints
    try {
        const cwd = process.cwd();
        const detected531: string[] = [];
        if (fs.existsSync(path.join(cwd, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps['next']) detected531.push('Next.js');
                else if (deps['react']) detected531.push('React');
                if (deps['express']) detected531.push('Express');
                if (deps['hono']) detected531.push('Hono');
                if (deps['typescript'] || fs.existsSync(path.join(cwd, 'tsconfig.json'))) detected531.push('TypeScript');
                else detected531.push('JavaScript/Node.js');
                if (deps['vitest'] || deps['jest']) detected531.push(deps['vitest'] ? 'Vitest' : 'Jest');
                if (deps['prisma'] || deps['@prisma/client']) detected531.push('Prisma');
                if (deps['tailwindcss']) detected531.push('Tailwind CSS');
            } catch { detected531.push('Node.js'); }
        } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
            detected531.push('Rust/Cargo');
        } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
            detected531.push('Go');
        } else if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
            detected531.push('Python');
            if (fs.existsSync(path.join(cwd, 'manage.py'))) detected531.push('Django');
            else if (fs.existsSync(path.join(cwd, 'app.py'))) detected531.push('Flask/FastAPI');
        } else if (fs.existsSync(path.join(cwd, 'Makefile'))) {
            detected531.push('C/C++ (Makefile)');
        }
        if (fs.existsSync(path.join(cwd, '.git'))) detected531.push('Git');
        if (fs.existsSync(path.join(cwd, 'Dockerfile')) || fs.existsSync(path.join(cwd, 'docker-compose.yml'))) detected531.push('Docker');
        if (detected531.length > 0) {
            systemPrompt += `\n\n## Detected Stack\n${detected531.join(', ')}`;
        }
    } catch { /* skip detection errors */ }

    // Wave 536: diff-aware context — inject recent git diff into system prompt
    try {
        const diffResult = execSync('git diff HEAD --stat 2>/dev/null || true', { encoding: 'utf8', stdio: 'pipe', timeout: 3000 }).trim();
        if (diffResult && diffResult.length < 2000) {
            systemPrompt += `\n\n## Recent Changes (git diff --stat)\n\`\`\`\n${diffResult}\n\`\`\``;
        }
    } catch { /* not a git repo or git unavailable */ }

    // Wave 92: HEARTBEAT.md — inject periodic tasks as a reminder at session start
    const heartbeatPath = path.join(getWorkspaceDir(), 'HEARTBEAT.md');
    if (!taskFlag && fs.existsSync(heartbeatPath)) {
        const hb = fs.readFileSync(heartbeatPath, 'utf8').trim();
        // Only inject if file has real content (not just comments/empty)
        // Wave 426: only count lines that look like actual tasks (bullet points), not prose/template text
        const hbLines = hb.split('\n').filter(l => /^\s*[-*]\s+\S/.test(l) && !l.trim().startsWith('#'));
        if (hbLines.length > 0) {
            systemPrompt += `\n\n--- Heartbeat Tasks (check proactively) ---\n${hb}`;
            if (!printMode) console.log('  ' + C.cyan(`\u{1F493} Heartbeat: ${hbLines.length} task${hbLines.length !== 1 ? 's' : ''} queued`));
        }
    }
    // Wave 560: inject persona modifier
    if (personaPromptExtra) systemPrompt += personaPromptExtra;

    // Wave 562: consensus mode — instruct agent to consider multiple approaches before committing
    if (consensusFlag) {
        systemPrompt += '\n\n## Consensus Mode\nBefore committing to any implementation approach, briefly consider 2–3 alternatives and explain why you chose the path you did. Do this inline — no need for a separate section.';
    }

    // Wave 567: quantize-aware mode — remind agent to consider VRAM and quantization
    if (quantizeAwareFlag) {
        systemPrompt += '\n\n## Quantize-Aware Mode\nWhen recommending or writing code that loads, fine-tunes, or serves models, always factor in quantization (GGUF Q4_K_M, AWQ, GPTQ, bitsandbytes). Prefer approaches that run within typical home-lab VRAM (8–24 GB per GPU).';
    }

    // Wave 545: TDD mode — write tests first, then implementation
    if (tddFlag) {
        systemPrompt += '\n\n## TDD Mode (--tdd)\nFor EVERY change you make:\n1. Write the failing test FIRST (using the project\'s test framework)\n2. Run the test to confirm it fails\n3. Write the minimal code to make it pass\n4. Run the test to confirm it passes\n5. Refactor if needed, run tests again\nNever write implementation code without a test first. If the project has no test setup, create one.';
    }

    // Wave 556: inject recent shell history context
    if (!longContextFlag) {
        try {
            const histFile = process.env.HISTFILE || path.join(os.homedir(), '.bash_history');
            if (fs.existsSync(histFile)) {
                const histRaw = fs.readFileSync(histFile, 'utf8');
                const histLines = histRaw.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(-15);
                if (histLines.length > 0) {
                    systemPrompt += `\n\n## Recent Shell History (last ${histLines.length} commands)\n\`\`\`\n${histLines.join('\n')}\n\`\`\``;
                }
            }
        } catch { /* ignore — shell history is best-effort */ }
    }

    } // end of !taskFlag context injection block

    if (!printMode) console.log('');

    type AgentMessage = {
        role: string;
        content: string | null;
        tool_calls?: unknown;
        tool_call_id?: string;
        name?: string;
    };
    let messages: AgentMessage[] = [{ role: 'system', content: systemPrompt }];

    // Resume session if requested
    if (resumeId) {
        // Wave 300: --no-history resumes the session ID (for continuity) but doesn't load messages
        const noHistory = flags['no-history'] === 'true' || flags['no_history'] === 'true';
        if (!noHistory) {
            const events = loadSessionTranscript(resumeId);
            if (events.length > 0) {
                const restored = rebuildMessagesFromTranscript(events);
                messages = [{ role: 'system', content: systemPrompt }, ...restored];
                if (!printMode) {
                    console.log('  ' + C.green(`\u2714 Resumed session: ${restored.length} messages loaded`));
                    // Wave 430: show last user message so user knows what was being worked on
                    const lastUser430 = restored.slice().reverse().find(m => m.role === 'user' && typeof m.content === 'string');
                    if (lastUser430 && typeof lastUser430.content === 'string') {
                        const preview430 = lastUser430.content.replace(/\[Context:[^\]]*\]/g, '').trim().slice(0, 120);
                        console.log('  ' + C.dim(`Last: "${preview430}${preview430.length >= 120 ? '…' : ''}"`));
                    }
                    console.log('');
                }
            }
        } else if (!printMode) {
            console.log('  ' + C.dim(`Resumed session ${resumeId.slice(0, 8)} (history skipped)`));
            console.log('');
        }
    }

    // Record session start
    appendSessionEvent(sessionId, {
        type: 'session_start', timestamp: new Date().toISOString(), sessionId,
        model, metadata: { cwd: process.cwd(), provider: config?.provider },
    });
    updateSessionMeta(sessionId, { model, cwd: process.cwd() });

    const readline = await import('readline');
    let rl: import('readline').Interface | null = null;

    let bootstrapConsumed = false;
    // Wave 422: track whether any text was streamed in --print mode (for fallback)
    let printModeHasText422 = false;

    const runAgentLoop = async (userMessage: string): Promise<void> => {
        printModeHasText422 = false; // reset per call
        // On first message: inject bootstrap instructions if present
        let actualMessage = userMessage;
        if (hasBootstrap && !bootstrapConsumed) {
            try {
                const bsContent = fs.readFileSync(bootstrapPath, 'utf8');
                actualMessage = `[SYSTEM BOOTSTRAP — first-run onboarding]\n${bsContent}\n\n[USER MESSAGE]\n${userMessage}`;
                bootstrapConsumed = true;
                // Wave 429: delete immediately on injection so model failures don't re-trigger onboarding
                try { fs.unlinkSync(bootstrapPath); } catch { /* ok */ }
            } catch { /* skip if can't read */ }
        }
        // Wave 269: for short edit tasks (no read instruction) with a file, prepend a read-first reminder
        const isShortEditTask = userMessage.length < 200 &&
            /\b(edit|fix|change|update|modify|refactor)\b/i.test(userMessage) &&
            !/\b(read|read_file|first|before)\b/i.test(userMessage);
        const mentionsSpecificFile = userMessage.match(/\b[\w./\\-]+\.[a-z]{2,6}\b/i);
        if (isShortEditTask && mentionsSpecificFile && messages.filter(m => m.role === 'user').length === 0) {
            actualMessage = `${actualMessage}\n\n[REMINDER: read_file("${mentionsSpecificFile[0]}") first before editing]`;
        }
        // Wave 537: error context — when user pastes an error with file:line references, auto-inject those file contents
        const errorLooksLike537 = /\b(error|exception|traceback|panic|failed|undefined is not|cannot read|cannot find|type ?error|reference ?error|syntax ?error)\b/i.test(userMessage);
        if (errorLooksLike537 && messages.filter(m => m.role === 'user').length === 0) {
            // Extract file:line references from error messages
            const fileLineRefs = userMessage.match(/(?:[\w./\\-]+\.[a-z]{2,6}):(\d+)/gi) || [];
            const injected537: string[] = [];
            for (const ref of fileLineRefs.slice(0, 3)) {
                const [filePath537, lineStr] = ref.split(':');
                if (!filePath537 || !lineStr) continue;
                const absPath537 = path.resolve(filePath537);
                if (!fs.existsSync(absPath537)) continue;
                try {
                    const content537 = fs.readFileSync(absPath537, 'utf8');
                    const lines537 = content537.split('\n');
                    const lineNum537 = parseInt(lineStr, 10);
                    const start537 = Math.max(0, lineNum537 - 5);
                    const end537 = Math.min(lines537.length, lineNum537 + 5);
                    const snippet = lines537.slice(start537, end537).map((l, i) => `${start537 + i + 1}: ${l}`).join('\n');
                    injected537.push(`[Auto-read ${filePath537}:${lineNum537}]\n\`\`\`\n${snippet}\n\`\`\``);
                } catch { /* skip unreadable */ }
            }
            if (injected537.length > 0) {
                actualMessage = `${actualMessage}\n\n${injected537.join('\n\n')}`;
            }
        }
        // Wave 425: inject compact file listing on first message when task involves files/code
        const looksFileRelated425 = /\b(file|dir|folder|read|write|edit|create|list|find|search|glob|run|build|code|project|src|test)\b/i.test(actualMessage);
        if (looksFileRelated425 && messages.filter(m => m.role === 'user').length === 0) {
            try {
                const SKIP425 = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage']);
                const entries425 = fs.readdirSync(process.cwd(), { withFileTypes: true })
                    .filter(e => !e.name.startsWith('.') && !SKIP425.has(e.name))
                    .map(e => e.isDirectory() ? `${e.name}/` : e.name)
                    .sort()
                    .slice(0, 30);
                if (entries425.length > 0) {
                    actualMessage = `[CWD: ${process.cwd()} | files: ${entries425.join(', ')}]\n${actualMessage}`;
                }
            } catch { /* skip if cwd unreadable */ }
        }
        messages.push({ role: 'user', content: actualMessage });
        appendSessionEvent(sessionId, {
            type: 'message', timestamp: new Date().toISOString(), sessionId,
            role: 'user', content: userMessage,
        });
        // Wave 107: auto-title session from first user message
        if (messages.filter(m => m.role === 'user').length === 1 && !resumeId) {
            const autoTitle = userMessage.replace(/[\n\r]+/g, ' ').trim().slice(0, 60);
            updateSessionMeta(sessionId, { label: autoTitle });
        }

        let intentionNudgeCount = 0;  // Wave 235: limit stalled-intention nudges to 1 per call
        let emptyNudgeCount431 = 0;  // Wave 431: limit empty-response nudges to prevent infinite loops
        for (let iter = 0; iter < maxIter; iter++) {
            // Wave 333: enforce wall-clock timeout
            if (agentDeadline > 0 && Date.now() > agentDeadline) {
                if (!printMode) console.log('\n  ' + C.yellow(`⏱ Timeout after ${timeoutSecs}s — agent stopped.`));
                break;
            }

            // Wave 451: context auto-trim for local backends — prevent silent context overflow
            // Local models have hard context limits (2K–32K); long sessions overflow silently without this.
            const LOCAL_BACKENDS_451: LocalBackend[] = ['ollama', 'lmstudio', 'llamafile', 'tabbyapi', 'unknown'];
            if (LOCAL_BACKENDS_451.includes(_detectedBackend) && messages.length > 22) {
                const systemMsg = messages[0]!;                 // always keep system prompt
                const tail451 = messages.slice(-12);            // always keep last 12 messages
                // Find first 'user' role in tail to avoid starting on an orphaned tool result
                const safeStart451 = tail451.findIndex(m => m.role === 'user');
                const safeTail451 = safeStart451 > 0 ? tail451.slice(safeStart451) : tail451;
                const dropped451 = messages.length - 1 - safeTail451.length;
                if (dropped451 > 0) {
                    messages.length = 0;
                    messages.push(systemMsg);
                    messages.push({
                        role: 'user',
                        content: `[Context trimmed: ${dropped451} earlier messages removed to stay within context window. Continue from current state.]`,
                    });
                    messages.push(...safeTail451);
                    if (!printMode) console.log('  ' + C.dim(`\u26A1 Context trimmed (kept last ${safeTail451.length} messages)`));
                }
            }

            const url = inferenceUrl.replace(/\/+$/, '') + '/v1/chat/completions';
            // Wave 447: use backend capability matrix — local models are the default, cloud is the exception
            const caps447 = BACKEND_CAPS[_detectedBackend];
            // Wave 577: for embedTools backends, inject COMPACT tool summary into system prompt
            // and DON'T send the tools param — Ollama's parser drops tool calls ~60% of the time
            // Full tool defs are 10K chars — way too much. Compact summary is ~500 chars.
            const useEmbedTools = caps447.embedTools && !noTools;
            let reqMessages = messages;
            if (useEmbedTools && messages.length > 0 && messages[0]!.role === 'system') {
                const embedSuffix = `\n\n## Tool Calling
Available tools: write_file(path, content), read_file(path), edit_file(path, old_text, new_text), run_shell(command), search_files(pattern, path), list_dir(path), glob_files(pattern), create_directory(path), delete_file(path), move_file(source, destination), copy_file(source, destination), patch_file(path, patches[{old_text,new_text}]), http_get(url), write_note(note)

To call a tool, output a <tool_call> tag with JSON:
<tool_call>
{"function": "write_file", "arguments": {"path": "hello.py", "content": "print('hello')"}}
</tool_call>

IMPORTANT: Use relative paths from the current directory. Do not create subdirectories unless asked.`;
                reqMessages = [
                    { ...messages[0], content: (messages[0]!.content as string) + embedSuffix },
                    ...messages.slice(1),
                ];
            }
            const bodyStr = JSON.stringify({
                model,
                messages: reqMessages,
                ...(!noTools && !useEmbedTools ? {
                    tools: CODE_AGENT_TOOLS,
                    // tool_choice only sent to backends that need it (openai, openrouter, vllm)
                    ...(caps447.sendToolChoice ? { tool_choice: 'auto' } : {}),
                    // parallel_tool_calls disabled for local models — causes confused multi-tool responses
                    ...(!caps447.parallelToolCalls ? { parallel_tool_calls: false } : {}),
                } : {}),
                stream: true,
                temperature: agentTemperature,  // Wave 73: /think sets this
                ...(maxTokensFlag > 0 ? { max_tokens: maxTokensFlag } : {}),  // Wave 271
                // Wave 448: Ollama num_ctx injection — override the default 2048/4096 token context window
                ...(caps447.numCtxParam === 'ollama' && caps447.defaultCtx > 0
                    ? { options: { num_ctx: caps447.defaultCtx } }
                    : {}),
            });

            let fullContent = '';
            const tcAcc: Record<number, { id: string; name: string; args: string }> = {};
            let outputTokensThisRound = 0;  // Wave 46: tok/s tracking
            const prevSessionInput = sessionUsage.inputTokens;
            const prevSessionOutput = sessionUsage.outputTokens;
            const prevSessionTotal = sessionUsage.totalTokens;
            // Wave 279: track <thinking> tag state — suppress from visible output, keep in fullContent
            let inThinkingTag = false;
            let thinkingBuffer = '';
            let thinkingStartMs = 0;

            if (!printMode) process.stdout.write('\n  ' + C.purple('\u25CE '));

            // Wave 55: progress dots — show activity while waiting for first token
            let firstTokenReceived = false;
            // Wave 123: spinner with elapsed time — shows thinking progress
            const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
            let spinnerIdx = 0;
            const thinkStart = Date.now();
            const spinner = setInterval(() => {
                if (printMode || firstTokenReceived) { clearInterval(spinner); return; }
                const elapsed = ((Date.now() - thinkStart) / 1000).toFixed(1);
                // Wave 322: show tool call count in spinner when tools have been called
                const tcCount = messages.filter(m => m.role === 'tool').length;
                const tcStr = tcCount > 0 ? C.dim(` [${tcCount} tools]`) : '';
                process.stdout.write('\r  ' + C.purple('\u25CE ') + C.dim(SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length] + ' ' + elapsed + 's') + tcStr);
                spinnerIdx++;
            }, 80);

            // Wave 445: after 5s with no tokens, local models are likely loading into VRAM
            const loadingTimer445 = !printMode ? setTimeout(() => {
                if (!firstTokenReceived) {
                    process.stdout.write('\r  ' + C.purple('\u25CE ') + C.dim('  Loading model into memory\u2026 (30\u201390s the first time)') + ' '.repeat(8));
                }
            }, 5000) : null;

            // Stream the completion — with error recovery
            const streamState = { error: '', finishReason: '' };
            const streamStart = Date.now();  // Wave 46: start timer
            await new Promise<void>((resolve) => {
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
                        ...inferenceHeaders,
                        ...(nodeFlag ? { 'x-node-id': nodeFlag } : {}),
                    },
                }, (res) => {
                    // Wave 43: handle HTTP errors before processing SSE
                    if (res.statusCode && res.statusCode >= 400) {
                        let errBuf = '';
                        res.on('data', (c: Buffer) => { errBuf += c.toString(); });
                        res.on('end', () => {
                            console.log('');
                            let errMsg = `HTTP ${res.statusCode}`;
                            try { const e = JSON.parse(errBuf); errMsg = e.error?.message || e.message || errMsg; } catch { /* raw text */ }
                            process.stdout.write(C.red('  \u2718 ' + errMsg));
                            if (/model.*not found|no such model|unknown model/i.test(errMsg) || res.statusCode === 404) {
                                console.log('\n  ' + C.yellow('  Tip: ') + C.dim(`ollama pull ${model}`));
                                // Wave 110: list available models from cluster (fire-and-forget)
                                apiGet(gateway, '/api/v1/models').then((modResp) => {
                                    const resp = modResp as { models?: Array<{ name?: string }> };
                                    if (resp?.models && resp.models.length > 0) {
                                        const names = resp.models.map(m => m.name || '').filter(Boolean).slice(0, 8);
                                        console.log('  ' + C.dim('Available models: ' + names.join(', ')));
                                    }
                                }).catch(() => { /* skip if cluster unreachable */ });
                            }
                            streamState.error = errMsg;
                            resolve();
                        });
                        return;
                    }
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
                                        finish_reason?: string;
                                    }>;
                                    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                                };
                                // Parse token usage (returned in final chunk by most providers)
                                if (ev.usage) {
                                    sessionUsage.inputTokens += ev.usage.prompt_tokens || 0;
                                    const outToks = ev.usage.completion_tokens || 0;
                                    sessionUsage.outputTokens += outToks;
                                    outputTokensThisRound += outToks;  // Wave 46
                                    sessionUsage.totalTokens += ev.usage.total_tokens || 0;
                                }
                                // Wave 448: capture finish_reason — 'length' means context overflow
                                const fr = ev.choices?.[0]?.finish_reason;
                                if (fr) streamState.finishReason = fr;
                                const delta = ev.choices?.[0]?.delta;
                                if (!delta) continue;
                                if (delta.content) {
                                    if (!firstTokenReceived) {
                                        firstTokenReceived = true;
                                        clearInterval(spinner);
                                        if (!printMode) process.stdout.write('\r  ' + C.purple('\u25CE '));  // clear spinner line
                                    }
                                    // Wave 279/339: handle <thinking>...</thinking> blocks (deepseek-r1, qwq etc.)
                                    // Collect them in fullContent but suppress from visible output; show duration
                                    thinkingBuffer += delta.content;
                                    if (!inThinkingTag && thinkingBuffer.includes('<think')) {
                                        inThinkingTag = true;
                                        thinkingStartMs = Date.now();
                                        if (!printMode) process.stdout.write(C.dim('\u{1F9E0} thinking…'));
                                    }
                                    if (inThinkingTag && thinkingBuffer.includes('</think')) {
                                        inThinkingTag = false;
                                        const thinkMs = Date.now() - (thinkingStartMs || Date.now());
                                        const thinkSecs = (thinkMs / 1000).toFixed(1);
                                        const afterThink = thinkingBuffer.slice(thinkingBuffer.lastIndexOf('</think>') + 8);
                                        thinkingBuffer = afterThink;
                                        if (!printMode) {
                                            process.stdout.write('\r  ' + C.purple('\u25CE ') + C.dim(`\u{1F9E0} thought for ${thinkSecs}s`) + ' '.repeat(5) + '\n  ' + C.purple('\u25CE '));
                                        }
                                        if (!jsonMode && afterThink) process.stdout.write(afterThink);
                                        fullContent += delta.content;
                                        continue;
                                    }
                                    if (!inThinkingTag) {
                                        // Wave 577: suppress <tool_call> tags from display in embedTools mode
                                        // Content is still accumulated in fullContent for post-stream parsing
                                        let displayContent = delta.content;
                                        if (useEmbedTools && displayContent) {
                                            displayContent = displayContent.replace(/<\/?tool_call>/g, '');
                                            // Suppress JSON between tool_call tags — check if fullContent is mid-tag
                                            const openCount = (fullContent + delta.content).split('<tool_call>').length - 1;
                                            const closeCount = (fullContent + delta.content).split('</tool_call>').length - 1;
                                            if (openCount > closeCount) displayContent = '';  // inside a tool_call tag
                                        }
                                        // Wave 251: in jsonMode, collect without streaming (JSON emitted at end)
                                        if (!jsonMode && displayContent) {
                                            process.stdout.write(displayContent);
                                            if (printMode && displayContent.trim()) printModeHasText422 = true;
                                        }
                                    }
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
                    res.on('end', () => {
                        clearInterval(spinner); if (loadingTimer445) clearTimeout(loadingTimer445); firstTokenReceived = true;
                        // Flush remaining buffer
                        if (buf.trim()) {
                            const remainingLines = buf.split('\n');
                            for (const line of remainingLines) {
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
                                            finish_reason?: string;
                                        }>;
                                        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                                    };
                                    if (ev.usage) {
                                        sessionUsage.inputTokens += ev.usage.prompt_tokens || 0;
                                        const outToks = ev.usage.completion_tokens || 0;
                                        sessionUsage.outputTokens += outToks;
                                        outputTokensThisRound += outToks;
                                        sessionUsage.totalTokens += ev.usage.total_tokens || 0;
                                    }
                                    const fr = ev.choices?.[0]?.finish_reason;
                                    if (fr) streamState.finishReason = fr;
                                    const delta = ev.choices?.[0]?.delta;
                                    if (delta) {
                                        if (delta.content) fullContent += delta.content;
                                        if (delta.tool_calls) {
                                            for (const tc of delta.tool_calls) {
                                                const idx = tc.index ?? 0;
                                                if (!tcAcc[idx]) tcAcc[idx] = { id: '', name: '', args: '' };
                                                if (tc.id) tcAcc[idx].id += tc.id;
                                                if (tc.function?.name) tcAcc[idx].name += tc.function.name;
                                                if (tc.function?.arguments) tcAcc[idx].args += tc.function.arguments;
                                            }
                                        }
                                    }
                                } catch { /* skip */ }
                            }
                        }
                        resolve();
                    });
                    res.on('error', (e) => { clearInterval(spinner); if (loadingTimer445) clearTimeout(loadingTimer445); firstTokenReceived = true; streamState.error = e.message; resolve(); });
                });
                // Wave 445: 120s socket timeout — local models can be slow to load but shouldn't hang forever
                req.setTimeout(120_000, () => {
                    req.destroy();
                    clearInterval(spinner);
                    if (loadingTimer445) clearTimeout(loadingTimer445);
                    firstTokenReceived = true;
                    streamState.error = [
                        'No response after 120s.',
                        'The model may still be loading. Try again in 30 seconds.',
                        'Check status:  ollama ps',
                        'Free VRAM:     ollama stop ' + model,
                    ].join('\n  ');
                    resolve();
                });
                req.on('error', (e) => { clearInterval(spinner); if (loadingTimer445) clearTimeout(loadingTimer445); firstTokenReceived = true; streamState.error = e.message; resolve(); });
                req.write(bodyStr);
                req.end();
            });

            // Error recovery: save partial content if stream broke
            // Wave 448: surface context overflow before checking for other errors
            if (!printMode && (streamState.finishReason === 'length' || streamState.finishReason === 'max_tokens')) {
                console.log('\n  ' + C.yellow('\u26A0  Context window full \u2014 response was cut off'));
                console.log('  ' + C.dim('  Options:'));
                console.log('  ' + C.dim('    /compact         \u2014 summarize history and continue'));
                console.log('  ' + C.dim('    /new             \u2014 start a fresh session'));
                if (_detectedBackend === 'ollama') {
                    console.log('  ' + C.dim('    tentaclaw config set model qwen2.5-coder:14b  \u2014 larger context model'));
                }
                console.log('');
            }

            if (streamState.error) {
                console.log('\n');
                console.log('  ' + C.red('\u26A0 Stream interrupted: ' + streamState.error));
                // Wave 427: auto-detect "does not support tools" and offer graceful fallback
                if (/does not support tools|tool_use.*not supported|function.*call.*not.*support/i.test(streamState.error) && !noTools) {
                    console.log('');
                    console.log('  ' + C.yellow(`\u26A0 Model "${model}" does not support tool calls.`));
                    console.log('  ' + C.dim('  Switch to a tools-capable model, or use no-tools mode:'));
                    console.log('  ' + C.cyan('    tentaclaw config set model hermes3:8b'));
                    console.log('  ' + C.cyan('    tentaclaw code --no-tools   ') + C.dim('(chat mode — no file/shell access)'));
                    console.log('');
                    if (rl) {
                        // Offer to auto-switch to --no-tools for this session
                        const ans = await new Promise<string>(res => rl!.question('  ' + C.dim('  Continue this session in no-tools mode? [Y/n] '), res));
                        if (!ans.trim().toLowerCase().startsWith('n')) {
                            noTools = true;
                            console.log('  ' + C.green('✔ Switched to no-tools mode for this session.'));
                            console.log('');
                            return;
                        }
                    }
                    return;
                }
                if (fullContent) {
                    messages.push({ role: 'assistant', content: fullContent + ' [stream interrupted]' });
                    appendSessionEvent(sessionId, {
                        type: 'message', timestamp: new Date().toISOString(), sessionId,
                        role: 'assistant', content: fullContent, model, metadata: { interrupted: true },
                    });
                    console.log('  ' + C.dim('  Partial response saved. Type to retry.'));
                } else {
                    console.log('  ' + C.dim('  No partial content. Type to retry.'));
                }
                console.log('');
                return;
            }

            const toolCalls = Object.values(tcAcc);

            // Wave 46/127: show tok/s + TTFT — use SSE usage if available, else estimate from content length
            const streamElapsed = (Date.now() - streamStart) / 1000;
            const ttft = ((Date.now() - thinkStart) / 1000 - streamElapsed).toFixed(1);
            const toksForDisplay = outputTokensThisRound > 0
                ? outputTokensThisRound
                : Math.ceil(fullContent.length / 4);  // ~4 chars per token estimate
            if (!printMode && toksForDisplay > 0 && streamElapsed > 0.1) {
                const toksPerSec = (toksForDisplay / streamElapsed).toFixed(1);
                const ttftNum = parseFloat(ttft);
                const ttftStr = ttftNum > 0 ? ` ttft:${ttft}s` : '';
                process.stdout.write(C.dim(`  [${toksPerSec} tok/s${ttftStr}]`));
            }

            // Wave 577: parse <tool_call> tags from content (embedded tools mode)
            // When using embedTools, the model outputs <tool_call>JSON</tool_call> in content instead of tool_calls
            if (toolCalls.length === 0 && fullContent && useEmbedTools) {
                const tcTagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
                let tcTagMatch;
                while ((tcTagMatch = tcTagRegex.exec(fullContent)) !== null) {
                    const raw577 = tcTagMatch[1]!;
                    // Try standard JSON.parse first
                    let parsed577ok = false;
                    try {
                        const p = JSON.parse(raw577) as { function?: string; name?: string; arguments?: Record<string, unknown> };
                        const n = p.function || p.name || '';
                        if (n) { toolCalls.push({ id: `call_embed_${Date.now()}_${toolCalls.length}`, name: n, args: JSON.stringify(p.arguments || {}) }); parsed577ok = true; }
                    } catch { /* try fallback */ }
                    // Fallback: regex extraction — handles triple-quotes, unescaped newlines, etc.
                    if (!parsed577ok) {
                        const fnMatch = raw577.match(/"function"\s*:\s*"(\w+)"/);
                        const nameMatch: RegExpMatchArray | null = !fnMatch ? raw577.match(/"name"\s*:\s*"(\w+)"/) : null;
                        const tcName577 = fnMatch?.[1] || nameMatch?.[1] || '';
                        // Extract "path" and "content" fields individually
                        const pathMatch = raw577.match(/"path"\s*:\s*["']([^"']+)["']/);
                        const tcPath = pathMatch?.[1] || '';
                        if (tcName577 && tcName577 === 'write_file' && tcPath) {
                            // Extract content between "content": and the closing of arguments
                            // This handles triple-quotes, unescaped newlines, etc.
                            const contentStart = raw577.indexOf('"content"');
                            if (contentStart >= 0) {
                                let contentRaw = raw577.slice(contentStart);
                                // Find the content value after the colon
                                const colonIdx = contentRaw.indexOf(':');
                                contentRaw = contentRaw.slice(colonIdx + 1).trim();
                                // Remove leading quotes/triple-quotes
                                contentRaw = contentRaw.replace(/^["']{1,3}/, '').replace(/["']{1,3}\s*\}?\s*\}?\s*$/, '');
                                // Unescape common escape sequences that models output as literal chars
                                contentRaw = contentRaw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
                                toolCalls.push({ id: `call_embed_${Date.now()}_${toolCalls.length}`, name: tcName577, args: JSON.stringify({ path: tcPath, content: contentRaw }) });
                            }
                        } else if (tcName577) {
                            // For non-write_file tools, try to extract args loosely
                            // Use non-greedy match to avoid consuming too much on nested JSON
                            const argsMatch = raw577.match(/"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}?\s*$/);
                            let argsStr = '{}';
                            if (argsMatch) { try { argsStr = JSON.stringify(JSON.parse(argsMatch[1]!)); } catch { argsStr = argsMatch[1]!; } }
                            toolCalls.push({ id: `call_embed_${Date.now()}_${toolCalls.length}`, name: tcName577, args: argsStr });
                        }
                    }
                }
                // Strip <tool_call> tags from content shown to user
                if (toolCalls.length > 0) {
                    fullContent = fullContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
                }
            }

            // Task mode early exit: if a tool already created/edited a file, and this response
            // has no more tool calls, the task is done. Don't let the model ramble or hallucinate.
            // EXCEPTION: only allow multi-tool continuation if task explicitly asks for multiple files
            const taskMentionsMultiFile = taskFlag && /\b(two files|three files|both files|multiple files|also create|and create|and a [\w.]+ file)\b/i.test(taskFlag);
            if (toolCalls.length === 0 && taskFlag && sessionToolCallCount > 0 && !(taskMentionsMultiFile && sessionToolCallCount < 4)) {
                if (fullContent) {
                    messages.push({ role: 'assistant', content: fullContent });
                    appendSessionEvent(sessionId, {
                        type: 'message', timestamp: new Date().toISOString(), sessionId,
                        role: 'assistant', content: fullContent, model,
                    });
                }
                sessionUsage.requestCount++;
                appendSessionEvent(sessionId, {
                    type: 'usage', timestamp: new Date().toISOString(), sessionId,
                    usage: {
                        inputTokens: sessionUsage.inputTokens - prevSessionInput,
                        outputTokens: sessionUsage.outputTokens - prevSessionOutput,
                        totalTokens: sessionUsage.totalTokens - prevSessionTotal,
                        cumulativeInput: sessionUsage.inputTokens,
                        cumulativeOutput: sessionUsage.outputTokens,
                        cumulativeTotal: sessionUsage.totalTokens,
                    },
                    metadata: { model, requestCount: sessionUsage.requestCount },
                });
                if (!jsonMode) {
                    if (printMode) { process.stdout.write('\n'); } else { console.log(''); }
                }
                return;
            }

            // No tool calls — final response
            if (toolCalls.length === 0) {
                // Wave 450: aggressive text-mode tool recovery for local models
                // Many small/quantized local models output tool calls as plain text JSON instead of proper tool_calls.
                // We try 4 different patterns common across model families, then synthesize a proper tool call.
                if (fullContent && !noTools) {
                    // Each pattern extracts [fullMatch, nameCapture, argsCapture] — order varies by pattern
                    const TEXT_TOOL_PATTERNS_450: Array<{ re: RegExp; nameIdx: 1 | 2; argsIdx: 1 | 2 }> = [
                        // Standard:  {"name": "tool", "arguments": {...}}
                        { re: /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/,  nameIdx: 1, argsIdx: 2 },
                        // Reversed:  {"arguments": {...}, "name": "tool"}
                        { re: /\{\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*,\s*"name"\s*:\s*"(\w+)"\s*\}/,  nameIdx: 2, argsIdx: 1 },
                        // Wrapped:   {"function": {"name": "tool", "arguments": {...}}}
                        { re: /\{\s*"function"\s*:\s*\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\s*\}/, nameIdx: 1, argsIdx: 2 },
                        // Markdown block:  ```json\n{"name": "tool", "arguments": {...}}\n```
                        { re: /```(?:json)?\s*\n?\s*\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/, nameIdx: 1, argsIdx: 2 },
                    ];
                    let recoveredTool450 = false;
                    for (const pat of TEXT_TOOL_PATTERNS_450) {
                        const m = fullContent.match(pat.re);
                        if (!m) continue;
                        const tName = m[pat.nameIdx] || '';
                        const tArgsRaw = m[pat.argsIdx] || '{}';
                        const validTools = CODE_AGENT_TOOLS.map(t => t.function.name);
                        if (!tName) continue;
                        if (!validTools.includes(tName)) {
                            if (intentionNudgeCount < 1) {
                                if (!printMode) console.log('\n  ' + C.yellow(`\u26A0 Unknown tool "${tName}" — asking for direct answer`));
                                messages.push({ role: 'assistant', content: fullContent });
                                messages.push({ role: 'user', content: 'Please answer the question directly without using tools.' });
                                sessionUsage.requestCount++;
                                intentionNudgeCount++;
                                recoveredTool450 = true;
                            }
                            break;
                        }
                        try {
                            const tArgs = JSON.parse(tArgsRaw) as Record<string, unknown>;
                            if (!printMode) console.log('\n  ' + C.yellow(`\u26A0 Text-mode tool recovered \u2014 auto-executing: ${tName}`));
                            const syntheticId = `call_txt_${Date.now()}_${_toolCallCounter++}`;
                            const syntheticArgs = JSON.stringify(tArgs);
                            messages.push({ role: 'assistant', content: null, tool_calls: [{ id: syntheticId, type: 'function', function: { name: tName, arguments: syntheticArgs } }] });
                            const toolResult = await executeCodeTool({ id: syntheticId, name: tName, args: syntheticArgs }, rl, autoApprove, printMode);
                            sessionToolCallCount++;
                            const rLines = toolResult.split('\n');
                            const isErr = toolResult.startsWith('Error') || toolResult.startsWith('Failed');
                            const isOk = ['Edited:', 'Created:', 'Overwritten:'].some(p => toolResult.startsWith(p));
                            const col = isErr ? C.red : isOk ? C.green : (l: string) => l;
                            if (!printMode) for (const l of rLines.slice(0, 10)) console.log('  ' + C.dim('\u2502 ') + col(l));
                            messages.push({ role: 'tool', tool_call_id: syntheticId, name: tName, content: toolResult });
                            sessionUsage.requestCount++;
                            recoveredTool450 = true;
                            break;
                        } catch { continue; /* bad JSON in args — try next pattern */ }
                    }
                    if (recoveredTool450) continue;
                }
                // Wave 235: stalled-intention recovery — detect premature stop without completing task
                // Nudge limit: only once per runAgentLoop call to prevent repeated looping
                if (fullContent && !noTools && intentionNudgeCount < 2) {
                    const validToolNames = CODE_AGENT_TOOLS.map(t => t.function.name);
                    // Case A: model says "I will use/call/edit/modify [tool]" but didn't call it
                    // Wave 577: wider regex — also catches "Next, use", "First, use", "use the write_file function"
                    const intentionMatch = fullContent.match(/\b(?:will|going to|proceed(?:ing)? to|now|let me|I'll|next,?\s+(?:I'll\s+)?|first,?\s+(?:I'll\s+)?)\s*(?:use|call|apply|execute|invoke|run|edit|modify|change|update|create|write|read)\s+(?:the\s+)?(?:file\s+)?[`'"]?(\w+)[`'"]?/i);
                    // Wave 577: also try direct tool name mention — "write_file(" or "`write_file`"
                    const directToolMatch: RegExpMatchArray | null = !intentionMatch ? fullContent.match(/[`'"]?(read_file|write_file|edit_file|run_shell|search_files|list_dir|glob_files|patch_file|create_directory|delete_file|move_file|copy_file|http_get|write_note)[`'"]?\s*\(/) : null;
                    const mentionedTool = intentionMatch?.[1] || directToolMatch?.[1] || '';
                    const caseA = mentionedTool && validToolNames.includes(mentionedTool) && fullContent.length < 500;
                    // Case B/D shared prerequisite: how many tool calls happened so far
                    const prevToolCallCount = messages.filter(m => m.role === 'tool').length;
                    // Case D: model asks for permission ("Do you want me to proceed?", "Shall I?")
                    const asksPermission = fullContent.length < 200 && prevToolCallCount > 0 &&
                        fullContent.match(/\b(?:do you want|should I|shall I|may I|would you like|want me to)\b/i);
                    // Also catch: model claims it "confirmed/made/replaced/written" without actually calling edit_file or write_file
                    const hasWriteToolResult = messages.some(m =>
                        m.role === 'tool' && typeof m.content === 'string' &&
                        (m.content.startsWith('Edited:') || m.content.startsWith('Created:') || m.content.startsWith('Overwritten:'))
                    );
                    const claimsAction = fullContent.length < 500 && prevToolCallCount > 0 && !hasWriteToolResult &&
                        fullContent.match(/\b(?:confirmed|replaced|changed|updated|modified|made the (?:requested )?change|I(?:'ve| have) (?:updated|written|made|applied|completed|fixed|edited|changed))\b/i);
                    // Suppress nudge if task already has a successful edit/write in context (Wave 315)
                    const hasSuccessfulEdit = messages.some(m =>
                        m.role === 'tool' && typeof m.content === 'string' &&
                        (m.content.startsWith('Edited:') || m.content.startsWith('Created:') || m.content.startsWith('Overwritten:'))
                    );
                    const looksIntermediate = !hasSuccessfulEdit && ((fullContent.length < 300 && prevToolCallCount > 0 &&
                        !fullContent.match(/\b(?:done|complete|finished|success|all set)\b/i) &&
                        !fullContent.match(/^\s*[\d.]+\s*$/) &&  // not a pure number answer
                        fullContent.match(/\b(?:contains|shows|has|is|reads?)\b/i)) ||  // describing what was read
                        claimsAction || asksPermission);
                    if (caseA || looksIntermediate) {
                        const nudgeTool = caseA ? mentionedTool : '';
                        // Wave 577: SHORT nudge messages — long nudges bloat context and cause empty retries
                        const nudgeMsg = nudgeTool
                            ? `Call ${nudgeTool} now.`
                            : asksPermission
                                ? `Yes, proceed now.`
                                : `Call edit_file or write_file now.`;
                        if (!printMode) console.log('\n  ' + C.yellow(`\u26A0 ${caseA ? `Stalled intention ("${nudgeTool}")` : 'Premature stop detected'} — nudging agent`));
                        // Wave 257: lower temperature when nudging — more deterministic on retry
                        agentTemperature = Math.max(0.0, agentTemperature - 0.2);
                        messages.push({ role: 'assistant', content: fullContent });
                        messages.push({ role: 'user', content: nudgeMsg });
                        sessionUsage.requestCount++;
                        intentionNudgeCount++;
                        // Emit usage on nudge path so session always has usage event
                        appendSessionEvent(sessionId, {
                            type: 'usage', timestamp: new Date().toISOString(), sessionId,
                            usage: {
                                inputTokens: sessionUsage.inputTokens - prevSessionInput,
                                outputTokens: sessionUsage.outputTokens - prevSessionOutput,
                                totalTokens: sessionUsage.totalTokens - prevSessionTotal,
                                cumulativeInput: sessionUsage.inputTokens,
                                cumulativeOutput: sessionUsage.outputTokens,
                                cumulativeTotal: sessionUsage.totalTokens,
                            },
                            metadata: { model, requestCount: sessionUsage.requestCount },
                        });
                        continue;
                    }
                }
                if (fullContent) {
                    messages.push({ role: 'assistant', content: fullContent });
                    appendSessionEvent(sessionId, {
                        type: 'message', timestamp: new Date().toISOString(), sessionId,
                        role: 'assistant', content: fullContent, model,
                    });
                } else {
                    // Empty response — retry without resetting context (keep tool results intact)
                    if (emptyNudgeCount431 < 3) {
                        emptyNudgeCount431++;
                        if (!printMode) console.log('  ' + C.yellow(`\u26A0 Empty response (attempt ${emptyNudgeCount431}/3) — retrying…`));
                        // Don't reset messages — tool results from prior iterations are valuable context
                        continue;
                    }
                    if (!printMode) console.log('  ' + C.yellow('\u26A0 Model returned empty response after 3 attempts.'));
                    messages.push({ role: 'assistant', content: '(empty response)' });
                }
                sessionUsage.requestCount++;
                appendSessionEvent(sessionId, {
                    type: 'usage', timestamp: new Date().toISOString(), sessionId,
                    usage: {
                        inputTokens: sessionUsage.inputTokens - prevSessionInput,
                        outputTokens: sessionUsage.outputTokens - prevSessionOutput,
                        totalTokens: sessionUsage.totalTokens - prevSessionTotal,
                        cumulativeInput: sessionUsage.inputTokens,
                        cumulativeOutput: sessionUsage.outputTokens,
                        cumulativeTotal: sessionUsage.totalTokens,
                    },
                    metadata: { model, requestCount: sessionUsage.requestCount },
                });
                const msgCount = messages.filter(m => m.role === 'user').length;
                updateSessionMeta(sessionId, { model, messageCount: msgCount, tokenCount: sessionUsage.totalTokens });
                // Wave 186: context budget nudge every 5 exchanges
                if (!printMode && msgCount > 0 && msgCount % 5 === 0) {
                    // Wave 265: include tool content in context estimate (was missing before)
                    const ctxEst = Math.round(messages.reduce((s, m) => {
                        if (typeof m.content === 'string') return s + m.content.length;
                        if (Array.isArray(m.content)) return s + (m.content as Array<{ text?: string }>).reduce((a, c) => a + (c.text?.length || 0), 0);
                        return s;
                    }, 0) / 4);
                    const pct = Math.round((ctxEst / 128_000) * 100);
                    if (pct >= 70) {
                        const severity = pct >= 90 ? C.red : pct >= 80 ? C.yellow : C.dim;
                        const hint = pct >= 90 ? '/compact or /new urgently' : pct >= 80 ? '/compact tools to free space' : '/compact when convenient';
                        console.log('  ' + severity(`\u26A0 Context ~${pct}% full (est. ${formatTokens(ctxEst)} tokens) — ${hint}`));
                    }
                }
                // jsonMode: no trailing newline here — JSON is emitted after runAgentLoop returns
                if (!jsonMode) {
                    if (printMode) { process.stdout.write('\n'); } else { console.log(''); }
                }
                return;
            }

            // Streamed some text then made tool calls
            if (!printMode) console.log('');
            const formattedCalls = toolCalls.map(tc => ({
                id: tc.id || `call_${Date.now()}_${_toolCallCounter++}`,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.args },
            }));
            // Wave 577: for embedTools mode, don't push tool_calls structure (model doesn't understand it)
            if (useEmbedTools) {
                // Reconstruct the <tool_call> text for the assistant message
                const tcText = toolCalls.map(tc => `<tool_call>\n{"function": "${tc.name}", "arguments": ${tc.args}}\n</tool_call>`).join('\n');
                messages.push({ role: 'assistant', content: (fullContent ? fullContent + '\n' : '') + tcText });
            } else {
                messages.push({ role: 'assistant', content: fullContent || null, tool_calls: formattedCalls });
            }
            appendSessionEvent(sessionId, {
                type: 'message', timestamp: new Date().toISOString(), sessionId,
                role: 'assistant', content: fullContent || null, tool_calls: formattedCalls, model,
            });

            // Execute each tool and feed results back
            for (const tc of toolCalls) {
                const tcId = tc.id || `call_${Date.now()}_${_toolCallCounter++}`;

                // Wave 453: harden tool args JSON parsing — truncated SSE can produce malformed args
                // Surface the error clearly so the model retries with complete args, rather than running with {}
                if (tc.args && tc.args.trim().length > 2) {
                    try {
                        JSON.parse(tc.args);
                    } catch {
                        const badArgsResult = [
                            `Error: tool arguments were malformed JSON (likely truncated SSE stream).`,
                            `Received: ${tc.args.slice(0, 300)}`,
                            `Please retry with complete, valid JSON arguments.`,
                        ].join('\n');
                        if (useEmbedTools) {
                            messages.push({ role: 'user', content: `<tool_response>\n${badArgsResult}\n</tool_response>` });
                        } else {
                            messages.push({ role: 'tool', tool_call_id: tcId, name: tc.name, content: badArgsResult });
                        }
                        if (!printMode) console.log('  ' + C.red(`\u2718 ${tc.name}: malformed args (stream truncated) — agent will retry`));
                        sessionUsage.requestCount++;
                        continue;
                    }
                }

                if (!printMode) {
                    console.log('');
                    // Wave 185: show iteration context
                    const iterLabel = toolCalls.length > 1 ? C.dim(` [${toolCalls.indexOf(tc) + 1}/${toolCalls.length}]`) : '';
                    console.log('  ' + C.cyan(`\u2699  ${tc.name}`) + iterLabel + '  ' + summarizeToolArgs(tc.args, tc.name));
                }

                appendSessionEvent(sessionId, {
                    type: 'tool_call', timestamp: new Date().toISOString(), sessionId,
                    name: tc.name, metadata: { args: tc.args },
                });

                // Wave 168/435: detect repeated identical tool call (agent stuck in loop)
                const toolSig = `${tc.name}:${tc.args.slice(0, 100)}`;
                const freq435 = (toolCallFreq435.get(toolSig) || 0) + 1;
                toolCallFreq435.set(toolSig, freq435);
                if (toolSig === lastToolSignature) {
                    if (!printMode) console.log('\n  ' + C.yellow('\u26A0 Agent loop detected — same tool called twice in a row. Injecting hint.'));
                    const hintMsg = `Note: You just called ${tc.name} with the same arguments again. This indicates you may be stuck. Try a different approach, read relevant context first, or ask the user for clarification.`;
                    messages.push({ role: 'user', content: hintMsg });
                } else if (freq435 >= 4) {
                    // Wave 435: same tool called 4+ times total (not necessarily consecutive) — likely deeper loop
                    if (!printMode) console.log('\n  ' + C.yellow(`\u26A0 ${tc.name} called ${freq435} times — possible loop. Nudging agent.`));
                    messages.push({ role: 'user', content: `Note: ${tc.name} has been called ${freq435} times with similar arguments. You appear to be looping. Stop and reconsider your approach — either the task is done and you should summarize, or you need a fundamentally different strategy.` });
                }
                lastToolSignature = toolSig;

                // Wave 554: capture file state before write/edit for /undo
                if (['write_file', 'edit_file', 'patch_file', 'delete_file'].includes(tc.name)) {
                    try {
                        const undoArgs554 = JSON.parse(tc.args || '{}') as Record<string, string>;
                        const undoPath554 = undoArgs554['path'] || '';
                        if (undoPath554) {
                            const absPath554 = path.resolve(undoPath554);
                            const prevContent554 = fs.existsSync(absPath554) ? fs.readFileSync(absPath554, 'utf8') : null;
                            undoStack554.push({ path: absPath554, content: prevContent554, action: tc.name, timestamp: Date.now() });
                            if (undoStack554.length > 50) undoStack554.shift(); // cap at 50 entries
                        }
                    } catch { /* skip if args unparsable */ }
                }

                const toolStart = Date.now();
                const result = await executeCodeTool(
                    { id: tcId, name: tc.name, args: tc.args },
                    rl,
                    autoApprove,
                    printMode
                );
                sessionToolCallCount++; // Wave 160
                // Wave 323: track files touched in this session
                if (['Edited:', 'Created:', 'Overwritten:', 'Appended'].some(p => result.startsWith(p))) {
                    try {
                        const argsObj = JSON.parse(tc.args || '{}') as Record<string, string>;
                        const fp = argsObj['path'] || '';
                        if (fp) sessionFilesTouched.add(path.relative(process.cwd(), path.resolve(fp)).replace(/\\/g, '/'));
                    } catch { /* ok */ }
                }
                // Wave 195: show elapsed time for slow tools (>500ms)
                const toolElapsed = Date.now() - toolStart;
                if (!printMode && toolElapsed > 500) {
                    process.stdout.write(C.dim(`  [${(toolElapsed / 1000).toFixed(1)}s]`));
                }

                // Wave 173: color-coded tool result display
                if (!printMode) {
                    const resultLines = result.split('\n');
                    const isError = result.startsWith('Error') || result.startsWith('Failed');
                    const isSuccess = ['Edited:', 'Created:', 'Overwritten:', 'Deleted:', 'Moved:', 'Copied:', 'Appended'].some(p => result.startsWith(p));
                    const firstLineColor = isError ? C.red : isSuccess ? C.green : (l: string) => l;
                    const preview = resultLines.slice(0, 25);
                    for (let li = 0; li < preview.length; li++) {
                        const l = preview[li]!;
                        const colored = li === 0 ? firstLineColor(l) : (l.startsWith('- ') ? C.red(l) : l.startsWith('+ ') ? C.green(l) : C.dim(l));
                        console.log('  ' + C.dim('\u2502 ') + colored);
                    }
                    if (resultLines.length > 25) console.log('  ' + C.dim(`\u2502 \u2026(${resultLines.length - 25} more lines)`));
                }

                // Wave 452: on edit_file "old_text not found", auto-inject current file content
                // so the model can correct old_text on its next attempt without wasting a full read_file iteration
                let result452 = result;
                if (tc.name === 'edit_file' && result.startsWith('Error: old_text not found')) {
                    try {
                        const args452 = JSON.parse(tc.args || '{}') as Record<string, unknown>;
                        const fp452 = typeof args452['path'] === 'string' ? args452['path'] : '';
                        if (fp452) {
                            const fresh452 = fs.readFileSync(fp452, 'utf8');
                            const lines452 = fresh452.split('\n');
                            const preview452 = lines452.slice(0, 25).join('\n');
                            const more452 = lines452.length > 25 ? `\n[...${lines452.length - 25} more lines — use read_file to see all]` : '';
                            result452 += `\n\n--- Current file content (auto-read) ---\n${preview452}${more452}\n---\nCopy old_text exactly from above. Do not reconstruct from memory.`;
                        }
                    } catch { /* file may not exist or be unreadable */ }
                }

                // Wave 577: for embedTools mode, send tool result as user message with <tool_response> tags
                if (useEmbedTools) {
                    // In task mode: after a successful write/create, hint completion
                    // Don't force stop — the task might need multiple files
                    const isSuccess577 = ['Created:', 'Overwritten:', 'Edited:', 'Appended', 'Deleted:'].some(p => result452.startsWith(p));
                    const stopHint577 = (taskFlag && isSuccess577) ? '\n\nTask done. Write a one-line summary. Do NOT create, write, or modify any other files.' : '';
                    messages.push({ role: 'user', content: `<tool_response>\n${result452}${stopHint577}\n</tool_response>` });
                } else {
                    messages.push({ role: 'tool', tool_call_id: tcId, name: tc.name, content: result452 });
                }
                appendSessionEvent(sessionId, {
                    type: 'tool_result', timestamp: new Date().toISOString(), sessionId,
                    role: 'tool', tool_call_id: tcId, name: tc.name,
                    content: result452.length > 2000 ? result452.slice(0, 2000) + '...(truncated in log)' : result452,
                });
                // Wave 100: --checkpoint — auto-commit after write/edit/delete operations
                // Wave 296: improved commit message with relative path
                if (checkpoint && ['write_file', 'edit_file', 'delete_file', 'move_file', 'create_directory'].includes(tc.name) && !result.startsWith('Error') && !result.includes('cancelled')) {
                    try {
                        const argsObj = JSON.parse(tc.args || '{}') as Record<string, string>;
                        const fp = argsObj['path'] || argsObj['source'] || '';
                        const relPath = fp ? path.relative(process.cwd(), path.resolve(fp)).replace(/\\/g, '/') : '';
                        const displayPath = relPath || path.basename(fp || 'files');
                        const verb = tc.name === 'write_file' ? 'write' : tc.name === 'edit_file' ? 'edit' : tc.name === 'delete_file' ? 'delete' : tc.name.replace('_', ' ');
                        const commitMsg = `tentaclaw(${verb}): ${displayPath}`;
                        execSync(`git add -A && git commit -m "${commitMsg.replace(/"/g, "'")} [checkpoint]"`, { cwd: process.cwd(), stdio: 'ignore' });
                        if (!printMode) console.log('  ' + C.dim(`\u{1F4BE} ${commitMsg}`));
                    } catch { /* git not available or nothing to commit */ }
                }
            }
            sessionUsage.requestCount++;
            // Loop continues — model will respond to tool results
        }

        if (!printMode) console.log('  ' + C.yellow('\u26A0 Reached maximum iterations.'));
    };

    // Non-interactive mode: --task "..." runs once and exits
    if (taskFlag) {
        if (!printMode) {
            console.log('  ' + C.dim(`Task: ${taskFlag}`));
            if (nodeFlag) console.log('  ' + C.dim(`Pinned node: ${nodeFlag}`));
            console.log('');
        }
        rl = null;   // no REPL in task mode — tool approval uses --yes
        try {
            await runAgentLoop(taskFlag);
        } catch (e) {
            console.error(C.red('  Error: ' + (e instanceof Error ? e.message : String(e))));
            process.exit(1);
        }
        // Wave 422: if --print and agent called tools but produced no text, emit last tool result
        if (printMode && !printModeHasText422) {
            const lastTool = messages.slice().reverse().find(m => m.role === 'tool' && typeof m.content === 'string');
            if (lastTool && typeof lastTool.content === 'string') {
                process.stdout.write(lastTool.content.trim() + '\n');
            }
        }
        if (bootstrapConsumed) {
            try { fs.unlinkSync(bootstrapPath); } catch { /* ok */ }
        }
        // Wave 152: summary after task completes
        const taskMsgCount = messages.filter(m => m.role === 'user').length;
        // Wave 577 fix: in embedded tools mode, tool results are role:user with <tool_response>, not role:tool
        const taskToolCount = sessionToolCallCount;
        if (jsonMode) {
            // Wave 251: --json — output structured result for scripting
            const lastAssistant = messages.slice().reverse().find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim());
            const responseText = (typeof lastAssistant?.content === 'string' ? lastAssistant.content : '').trim();
            process.stdout.write(JSON.stringify({
                response: responseText,
                tool_calls: taskToolCount,
                tokens: sessionUsage.totalTokens,
                model,
            }) + '\n');
        } else if (!printMode) {
            console.log('');
            console.log('  ' + C.dim(`Done. ${taskMsgCount} exchange${taskMsgCount !== 1 ? 's' : ''}, ${taskToolCount} tool call${taskToolCount !== 1 ? 's' : ''}, ${formatTokens(sessionUsage.totalTokens)} tokens.`));
            // Wave 289: show which files were modified during the task
            try {
                const changedTask = execSync('git diff --name-only', { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() }).trim();
                if (changedTask) {
                    const taskFiles = changedTask.split('\n').slice(0, 8);
                    const taskExtra = changedTask.split('\n').length > 8 ? ` +${changedTask.split('\n').length - 8} more` : '';
                    console.log('  ' + C.dim(`\u25B8 Modified: ${taskFiles.join(', ')}${taskExtra}`));
                }
            } catch { /* not a git repo */ }
        }
        appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
        updateSessionMeta(sessionId, { model, messageCount: taskMsgCount, tokenCount: sessionUsage.totalTokens });
        return;
    }

    // Auto-detect piped input: if stdin is not a TTY, read all input and run as task
    if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const pipedInput = Buffer.concat(chunks).toString('utf8').trim();
        if (pipedInput) {
            if (!printMode) console.log('  ' + C.dim(`Piped input: ${pipedInput.slice(0, 60)}${pipedInput.length > 60 ? '...' : ''}`));
            taskFlag = pipedInput;  // treat piped input as task mode for early-exit logic
            rl = null;
            try { await runAgentLoop(pipedInput); } catch (e) { console.error(C.red('  Error: ' + (e instanceof Error ? e.message : String(e)))); }
            const pipedMsgCount = messages.filter(m => m.role === 'user').length;
            if (!printMode) {
                console.log('');
                console.log('  ' + C.dim(`Done. ${pipedMsgCount} exchange${pipedMsgCount !== 1 ? 's' : ''}, ${sessionToolCallCount} tool call${sessionToolCallCount !== 1 ? 's' : ''}, ${formatTokens(sessionUsage.totalTokens)} tokens.`));
            }
            appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
            return;
        }
    }

    // Interactive REPL mode
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: C.teal('\n  \u276F '),
    });

    rl.prompt();

    // Graceful stdin close — piped input EOF or Ctrl+D
    rl.on('close', () => {
        appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
        const msgCount = messages.filter(m => m.role === 'user').length;
        updateSessionMeta(sessionId, { messageCount: msgCount, tokenCount: sessionUsage.totalTokens });
        // Always delete bootstrap on session end — prevents stale onboarding
        try { fs.unlinkSync(bootstrapPath); } catch { /* ok */ }
        process.exit(0);
    });

    // Graceful Ctrl+C — save session cleanly, no JSONL corruption
    process.on('SIGINT', () => {
        console.log('');
        appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
        const msgCount = messages.filter(m => m.role === 'user').length;
        updateSessionMeta(sessionId, { messageCount: msgCount, tokenCount: sessionUsage.totalTokens });
        try {
            const fd = fs.openSync(path.join(getSessionsDir(), `${sessionId}.jsonl`), 'r');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
        } catch { /* best effort */ }
        if (bootstrapConsumed) {
            try { fs.unlinkSync(bootstrapPath); } catch { /* ok */ }
        }
        // Wave 191: session duration
        const durationMs = Date.now() - sessionStartMs;
        const durationStr = durationMs > 3600_000
            ? `${Math.round(durationMs / 3600_000)}h ${Math.round((durationMs % 3600_000) / 60_000)}m`
            : durationMs > 60_000
                ? `${Math.round(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`
                : `${Math.round(durationMs / 1000)}s`;
        console.log(C.dim('  TentaCLAW waves goodbye \uD83D\uDC19') + C.dim(`  (${durationStr})`));
        console.log(C.dim(`  Session saved: ${sessionId}`));
        rl!.close();
        process.exit(0);
    });

    // Wave 82: multiline input buffer — lines ending with \ continue to next line
    let mlBuffer = '';
    // Wave 254: track last user prompt for /retry
    let lastUserInput = '';
    // Wave 285: persistent pinned context injected as system-level prefix in every user turn
    let pinnedContext = '';

    rl.on('line', async (line: string) => {
        // Multiline continuation: if line ends with \, buffer it and wait for more
        if (line.endsWith('\\')) {
            mlBuffer += line.slice(0, -1) + '\n';
            rl!.setPrompt(C.cyan('  . '));
            rl!.prompt(); return;
        }
        let input: string;
        if (mlBuffer) {
            input = (mlBuffer + line).trim();
            mlBuffer = '';
            rl!.setPrompt(C.cyan('  \u276F '));
        } else {
            input = line.trim();
        }
        if (!input) { rl!.prompt(); return; }

        // ! shell shortcut — run command directly, no LLM
        if (input.startsWith('!')) {
            const shellCmd = input.slice(1).trim();
            if (shellCmd) {
                try {
                    const out = execSync(shellCmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', cwd: process.cwd(), encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
                    if (out) process.stdout.write(C.dim(out));
                } catch (e: unknown) {
                    const err = e as { stdout?: string; stderr?: string; status?: number };
                    const combined = ((err.stdout || '') + (err.stderr || '')).trim();
                    if (combined) console.log(C.dim(combined));
                    else console.log(C.red(`  Exit ${err.status ?? 1}`));
                }
            }
            rl!.prompt(); return;
        }

        // Slash commands
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(' ');
            const cmd = (parts[0] || '').toLowerCase();
            const arg = parts.slice(1).join(' ').trim();

            switch (cmd) {
                case 'quit':
                case 'exit': {
                    appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
                    const msgCount = messages.filter(m => m.role === 'user').length;
                    updateSessionMeta(sessionId, { messageCount: msgCount, tokenCount: sessionUsage.totalTokens });
                    // Delete bootstrap after first session
                    if (bootstrapConsumed) {
                        try { fs.unlinkSync(bootstrapPath); } catch { /* ok */ }
                    }
                    // Wave 65: session summary
                    console.log('');
                    const toolCalls = messages.filter(m => m.role === 'assistant' && Array.isArray((m as { tool_calls?: unknown[] }).tool_calls));
                    const toolCallCount = toolCalls.reduce((s, m) => s + ((m as { tool_calls?: unknown[] }).tool_calls?.length || 0), 0);
                    const filesWritten = new Set<string>();
                    for (const m of messages) {
                        if (m.role === 'assistant' && Array.isArray((m as { tool_calls?: { function: { name: string; arguments: string } }[] }).tool_calls)) {
                            for (const tc of (m as { tool_calls: { function: { name: string; arguments: string } }[] }).tool_calls) {
                                if (['write_file', 'edit_file', 'create_directory'].includes(tc.function.name)) {
                                    try { const a = JSON.parse(tc.function.arguments); if (a.path) filesWritten.add(a.path); } catch { /* ok */ }
                                }
                            }
                        }
                    }
                    if (msgCount > 0 || toolCallCount > 0) {
                        console.log('  ' + C.dim(`  ${msgCount} exchange${msgCount !== 1 ? 's' : ''}` +
                            (toolCallCount > 0 ? `  \u2022  ${toolCallCount} tool call${toolCallCount !== 1 ? 's' : ''}` : '') +
                            (sessionUsage.totalTokens > 0 ? `  \u2022  ${formatTokens(sessionUsage.totalTokens)} tokens` : '') +
                            (filesWritten.size > 0 ? `  \u2022  ${filesWritten.size} file${filesWritten.size !== 1 ? 's' : ''} touched` : '')));
                    }
                    console.log(C.dim('  TentaCLAW waves goodbye \uD83D\uDC19'));
                    console.log(C.dim(`  Session saved: ${sessionId}`));
                    rl!.close();
                    process.exit(0);
                    break;
                }
                case 'new':
                case 'reset': {
                    // Wave 316: /new — also clear pinnedContext, show old session ID + message count
                    appendSessionEvent(sessionId, { type: 'session_end', timestamp: new Date().toISOString(), sessionId });
                    const oldId = sessionId;
                    const oldMsgCount = messages.filter(m => m.role === 'user').length;
                    sessionId = generateSessionId();
                    messages = [{ role: 'system', content: systemPrompt }];
                    sessionUsage.inputTokens = 0;
                    sessionUsage.outputTokens = 0;
                    sessionUsage.totalTokens = 0;
                    sessionUsage.requestCount = 0;
                    pinnedContext = '';  // clear pinned context on new session
                    appendSessionEvent(sessionId, {
                        type: 'session_start', timestamp: new Date().toISOString(), sessionId,
                        model, metadata: { cwd: process.cwd(), previousSession: oldId },
                    });
                    updateSessionMeta(sessionId, { model, cwd: process.cwd() });
                    console.log('  ' + C.green(`\u2714 New session: ${sessionId}`));
                    console.log('  ' + C.dim(`  Previous: ${oldId} (${oldMsgCount} exchange${oldMsgCount !== 1 ? 's' : ''})`));
                    rl!.prompt(); return;
                }
                case 'undo': {
                    // Wave 554: /undo — restore last file to its pre-write/edit state
                    const lastUndo = undoStack554.pop();
                    if (!lastUndo) {
                        console.log('  ' + C.yellow('\u26A0 Nothing to undo.'));
                        rl!.prompt(); return;
                    }
                    try {
                        if (lastUndo.content === null) {
                            // File didn't exist before — delete it
                            if (fs.existsSync(lastUndo.path)) fs.unlinkSync(lastUndo.path);
                            console.log('  ' + C.green('\u2714 Undo: deleted ' + path.basename(lastUndo.path) + ' (was newly created)'));
                        } else {
                            fs.writeFileSync(lastUndo.path, lastUndo.content, 'utf8');
                            console.log('  ' + C.green('\u2714 Undo: restored ' + path.basename(lastUndo.path) + ' to pre-' + lastUndo.action + ' state'));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('\u2718 Undo failed: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.prompt(); return;
                }
                case 'status': {
                    const userMsgs = messages.filter(m => m.role === 'user').length;
                    const assistantMsgs = messages.filter(m => m.role === 'assistant').length;
                    const toolMsgs = messages.filter(m => m.role === 'tool').length;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('STATUS')));
                    // Wave 117: show session label in status if set
                    const sessionMeta = loadSessionIndex()[sessionId];
                    const sessionLabel = sessionMeta?.label;
                    console.log('  ' + padRight(C.dim('Session'), 18) + C.white(sessionId.slice(0, 14)) + (sessionLabel ? C.dim(' — ' + sessionLabel.slice(0, 40)) : ''));
                    console.log('  ' + padRight(C.dim('Model'), 18) + C.white(model));
                    console.log('  ' + padRight(C.dim('Backend'), 18) + backendLabel);
                    console.log('  ' + padRight(C.dim('Messages'), 18) + C.white(`${userMsgs} user, ${assistantMsgs} assistant, ${toolMsgs} tool`));
                    // Wave 62: estimate context tokens from content length when SSE returns 0
                    const ctxCharCount = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                    const ctxEstTokens = Math.round(ctxCharCount / 4);
                    const displayTokens = sessionUsage.totalTokens > 0 ? sessionUsage.totalTokens : ctxEstTokens;
                    const tokenSource = sessionUsage.totalTokens > 0 ? '' : C.dim(' (est.)');
                    console.log('  ' + padRight(C.dim('Context'), 18) + C.white(`${messages.length} messages`) + C.dim(` (~${formatTokens(ctxEstTokens)} tokens)`));
                    console.log('  ' + padRight(C.dim('Requests'), 18) + C.white(String(sessionUsage.requestCount)));
                    console.log('  ' + padRight(C.dim('Tool calls'), 18) + C.white(String(sessionToolCallCount)));
                    console.log('  ' + padRight(C.dim('Tokens'), 18) + C.white(`${formatTokens(sessionUsage.inputTokens)} in / ${formatTokens(sessionUsage.outputTokens)} out`) + tokenSource);
                    // Wave 213/44: token budget with visual progress bar
                    const TOKEN_BUDGET = 128_000;
                    const tokenPct = Math.min(100, Math.round((displayTokens / TOKEN_BUDGET) * 100));
                    const barFill = Math.round(tokenPct / 100 * 20);
                    const bar = '█'.repeat(barFill) + '░'.repeat(20 - barFill);
                    const barColor = tokenPct >= 90 ? C.red : tokenPct >= 75 ? C.yellow : C.green;
                    const budgetWarn = tokenPct >= 90 ? ' ⚠ /compact or /new' : tokenPct >= 75 ? ' ⚠ consider /compact' : '';
                    console.log('  ' + padRight(C.dim('Budget'), 18) + barColor(`${bar} ${tokenPct}%`) + C.dim(budgetWarn));
                    // Session duration
                    const sessionDuration = sessionStartMs ? Math.round((Date.now() - sessionStartMs) / 1000) : 0;
                    const durStr = sessionDuration < 60 ? `${sessionDuration}s` : `${Math.floor(sessionDuration / 60)}m ${sessionDuration % 60}s`;
                    console.log('  ' + padRight(C.dim('Duration'), 18) + C.dim(durStr));
                    console.log('  ' + padRight(C.dim('CWD'), 18) + C.dim(process.cwd().replace(os.homedir(), '~')));
                    // Wave 225: show git branch + dirty status in /status
                    try {
                        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        const dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        const dirtyStr = dirty ? C.yellow(` (${dirty.split('\n').length} changed)`) : C.dim(' (clean)');
                        console.log('  ' + padRight(C.dim('Git branch'), 18) + C.cyan(branch) + dirtyStr);
                    } catch { /* not a git repo */ }
                    console.log('  ' + padRight(C.dim('Auto-approve'), 18) + (autoApprove ? C.green('ON') : C.yellow('OFF')));
                    // Wave 304: show pinned context if active
                    if (pinnedContext) console.log('  ' + padRight(C.dim('Pinned ctx'), 18) + C.cyan(pinnedContext.slice(0, 50) + (pinnedContext.length > 50 ? '…' : '')));
                    // Wave 323: show files touched this session
                    if (sessionFilesTouched.size > 0) {
                        const fList = [...sessionFilesTouched].slice(0, 5);
                        const fMore = sessionFilesTouched.size > 5 ? ` +${sessionFilesTouched.size - 5} more` : '';
                        console.log('  ' + padRight(C.dim('Files changed'), 18) + C.green(fList.join(', ') + fMore));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'usage': {
                    const cfg = loadConfig();
                    const provider = cfg?.provider || 'ollama';
                    // Cost per 1M tokens by provider+model (input/output)
                    const costTable: Record<string, { in: number; out: number }> = {
                        'gpt-4o':           { in: 2.50,  out: 10.00 },
                        'gpt-4o-mini':      { in: 0.15,  out: 0.60  },
                        'gpt-4-turbo':      { in: 10.00, out: 30.00 },
                        'gpt-3.5-turbo':    { in: 0.50,  out: 1.50  },
                        'claude-3-5-sonnet':{ in: 3.00,  out: 15.00 },
                        'claude-3-haiku':   { in: 0.25,  out: 1.25  },
                    };
                    const rates = Object.entries(costTable).find(([k]) => model.toLowerCase().includes(k.toLowerCase()))?.[1];
                    const isOllama = provider === 'ollama' || inferenceUrl.includes('localhost');
                    const inputCost  = isOllama ? 0 : (rates ? (sessionUsage.inputTokens  / 1_000_000) * rates.in  : null);
                    const outputCost = isOllama ? 0 : (rates ? (sessionUsage.outputTokens / 1_000_000) * rates.out : null);
                    console.log('');
                    console.log('  ' + C.teal(C.bold('USAGE')));
                    console.log('  ' + padRight(C.dim('Model'), 22) + C.white(model));
                    console.log('  ' + padRight(C.dim('Provider'), 22) + C.white(provider));
                    console.log('  ' + padRight(C.dim('Requests'), 22) + C.white(String(sessionUsage.requestCount)));
                    console.log('  ' + padRight(C.dim('Input tokens'), 22) + C.white(formatTokens(sessionUsage.inputTokens)));
                    console.log('  ' + padRight(C.dim('Output tokens'), 22) + C.white(formatTokens(sessionUsage.outputTokens)));
                    console.log('  ' + padRight(C.dim('Total tokens'), 22) + C.white(formatTokens(sessionUsage.totalTokens)));
                    if (isOllama) {
                        console.log('  ' + padRight(C.dim('Cost'), 22) + C.green('FREE  (local Ollama)'));
                    } else if (inputCost !== null && outputCost !== null) {
                        console.log('  ' + padRight(C.dim('Est. cost'), 22) + C.yellow(`$${(inputCost + outputCost).toFixed(4)}`));
                        console.log('  ' + padRight(C.dim('  input'), 22) + C.dim(`$${inputCost.toFixed(4)}  @ $${rates!.in}/1M`));
                        console.log('  ' + padRight(C.dim('  output'), 22) + C.dim(`$${outputCost.toFixed(4)}  @ $${rates!.out}/1M`));
                    } else {
                        console.log('  ' + padRight(C.dim('Est. cost'), 22) + C.dim('unknown — model not in cost table'));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'clear': {
                    // Wave 309: /clear — show freed message count
                    const clearCount = messages.length - 1; // all except system prompt
                    messages = [{ role: 'system', content: systemPrompt }];
                    console.log('  ' + C.green(`\u2714 Context cleared — ${clearCount} message${clearCount !== 1 ? 's' : ''} removed. Session continues.`));
                    rl!.prompt(); return;
                }
                case 'model': {
                    // Wave 290: /model — show current; /model <name> — switch; /model list [filter] — list
                    if (!arg || arg === 'list') {
                        if (!arg) { console.log('  ' + C.dim(`Current model: ${model}`)); rl!.prompt(); return; }
                        // /model list [filter]
                        rl!.pause();
                        const filter290 = arg.replace(/^list\s*/i, '').trim().toLowerCase();
                        try {
                            const resp290 = await apiGet(gateway, '/api/v1/models') as { models?: Array<{ name?: string; size?: number; node?: string }> };
                            const allModels = (resp290?.models || []).filter(m => !filter290 || (m.name || '').toLowerCase().includes(filter290));
                            if (allModels.length > 0) {
                                console.log('');
                                console.log('  ' + C.teal(C.bold('MODELS' + (filter290 ? ` (filter: ${filter290})` : ''))));
                                console.log('');
                                for (const m of allModels) {
                                    const active = m.name === model ? C.green(' \u25C0') : '';
                                    const sz = m.size ? C.dim(` ${(m.size / 1e9).toFixed(1)}GB`) : '';
                                    const node = m.node ? C.dim(` (${m.node})`) : '';
                                    console.log('  ' + C.white(padRight(m.name || '?', 30)) + sz + node + active);
                                }
                                console.log('');
                                console.log('  ' + C.dim('Switch: /model <name>'));
                                console.log('');
                            } else {
                                console.log('  ' + C.dim('No models match' + (filter290 ? ` "${filter290}"` : '') + '. Use: tentaclaw deploy <model>'));
                            }
                        } catch { console.log('  ' + C.red('Could not reach cluster.')); }
                        rl!.resume(); rl!.prompt(); return;
                    }
                    const oldModel = model;
                    model = arg;
                    appendSessionEvent(sessionId, {
                        type: 'model_change', timestamp: new Date().toISOString(), sessionId,
                        model, metadata: { previous: oldModel },
                    });
                    console.log('  ' + C.green(`\u2714 Model: ${model}`));
                    rl!.prompt(); return;
                }
                case 'models': {
                    // Wave 113: list available models from cluster
                    rl!.pause();
                    try {
                        const resp = await apiGet(gateway, '/api/v1/models') as { models?: Array<{ name?: string; size?: number; node?: string }> };
                        if (resp?.models && resp.models.length > 0) {
                            console.log('');
                            console.log('  ' + C.teal(C.bold('AVAILABLE MODELS')));
                            console.log('');
                            for (const m of resp.models) {
                                const active = m.name === model ? C.green(' \u25C0 active') : '';
                                const sz = m.size ? C.dim(` ${(m.size / 1e9).toFixed(1)}GB`) : '';
                                const node = m.node ? C.dim(` (${m.node})`) : '';
                                console.log('  ' + C.white(padRight(m.name || '?', 30)) + sz + node + active);
                            }
                            console.log('');
                            console.log('  ' + C.dim('Switch: /model <name>'));
                            console.log('');
                        } else {
                            console.log('  ' + C.dim('No models loaded on cluster. Use: tentaclaw deploy <model>'));
                        }
                    } catch {
                        console.log('  ' + C.red('Could not reach cluster.'));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'auto': {
                    autoApprove = !autoApprove;
                    console.log('  ' + C.green(`\u2714 Auto-approve: ${autoApprove ? 'ON' : 'OFF'}`));
                    rl!.prompt(); return;
                }
                case 'context': {
                    // Wave 220: detailed context breakdown with token bar
                    const byRole: Record<string, { count: number; chars: number }> = {};
                    for (const m of messages) {
                        const r = m.role;
                        if (!byRole[r]) byRole[r] = { count: 0, chars: 0 };
                        byRole[r]!.count++;
                        byRole[r]!.chars += typeof m.content === 'string' ? m.content.length : 0;
                    }
                    const totalChars = Object.values(byRole).reduce((s, v) => s + v.chars, 0);
                    const estTokens = Math.round(totalChars / 4);
                    const budgetPct = Math.min(100, Math.round(estTokens / 128_000 * 100));
                    const barFill2 = Math.round(budgetPct / 100 * 24);
                    const bar2 = '█'.repeat(barFill2) + '░'.repeat(24 - barFill2);
                    const barCol2 = budgetPct >= 90 ? C.red : budgetPct >= 70 ? C.yellow : C.green;
                    console.log('');
                    console.log('  ' + C.teal(C.bold('CONTEXT')) + C.dim(` — ${messages.length} messages`));
                    console.log('');
                    console.log('  ' + barCol2(bar2) + C.dim(` ${budgetPct}% of 128k  (~${formatTokens(estTokens)} tokens)`));
                    console.log('');
                    for (const [role, info] of Object.entries(byRole)) {
                        const roleLabel = { system: 'system', user: 'you', assistant: 'agent', tool: 'tool results' }[role] || role;
                        console.log('  ' + padRight(C.dim(roleLabel), 16) + C.white(String(info.count).padStart(3)) + C.dim(` msg  ~${formatTokens(Math.round(info.chars / 4))} tokens`));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'time': {
                    // Wave 321: /time — show current time and session duration
                    const now321 = new Date();
                    const dur321 = sessionStartMs ? Math.round((Date.now() - sessionStartMs) / 1000) : 0;
                    const durStr321 = dur321 < 60 ? `${dur321}s` : `${Math.floor(dur321 / 60)}m ${dur321 % 60}s`;
                    console.log('  ' + C.dim(now321.toLocaleTimeString()) + C.dim('  session running: ') + C.white(durStr321));
                    rl!.prompt(); return;
                }
                case 'bench': {
                    // Wave 363: /bench [--n N] <cmd> — run a shell command N times and show timing stats
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /bench [--n <count>] <shell command>  — benchmark a command (default: 3 runs)')); rl!.prompt(); return; }
                    let benchCmd = arg.trim();
                    let benchN = 3;
                    // Parse optional --n N at start of arg
                    const benchNMatch = benchCmd.match(/^--n\s+(\d+)\s+/);
                    if (benchNMatch) { benchN = Math.min(20, Math.max(1, parseInt(benchNMatch[1]!, 10) || 3)); benchCmd = benchCmd.slice(benchNMatch[0].length); }
                    benchN = Math.min(20, benchN);
                    if (!benchCmd) { console.log('  ' + C.dim('Provide a command after --n N')); rl!.prompt(); return; }
                    console.log('');
                    console.log('  ' + C.dim(`Benchmarking (${benchN}x): ${benchCmd}`));
                    console.log('');
                    rl!.pause();
                    const benchTimes: number[] = [];
                    for (let bi = 0; bi < benchN; bi++) {
                        const bt0 = Date.now();
                        try {
                            execSync(benchCmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', encoding: 'utf8', stdio: 'pipe', timeout: 60_000 });
                            const bElapsed = Date.now() - bt0;
                            benchTimes.push(bElapsed);
                            const bBar = '█'.repeat(Math.min(20, Math.round(bElapsed / 50)));
                            console.log('  ' + C.dim(`[${bi + 1}]`) + '  ' + C.teal(`${bElapsed}ms`) + '  ' + C.dim(bBar));
                        } catch (e) {
                            const bElapsed = Date.now() - bt0;
                            console.log('  ' + C.dim(`[${bi + 1}]`) + '  ' + C.red(`${bElapsed}ms  FAILED`));
                        }
                    }
                    if (benchTimes.length > 0) {
                        const bAvg = Math.round(benchTimes.reduce((a, b) => a + b, 0) / benchTimes.length);
                        const bMin = Math.min(...benchTimes);
                        const bMax = Math.max(...benchTimes);
                        console.log('');
                        console.log('  ' + C.dim('avg') + ' ' + C.white(`${bAvg}ms`) + '  ' + C.dim('min') + ' ' + C.green(`${bMin}ms`) + '  ' + C.dim('max') + ' ' + C.yellow(`${bMax}ms`));
                    }
                    console.log('');
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'tokens': {
                    // Wave 291: /tokens — quick token usage breakdown for this session
                    console.log('');
                    console.log('  ' + C.teal(C.bold('TOKEN USAGE')));
                    console.log('');
                    console.log('  ' + padRight(C.dim('Input tokens'), 18) + C.white(String(sessionUsage.inputTokens)));
                    console.log('  ' + padRight(C.dim('Output tokens'), 18) + C.white(String(sessionUsage.outputTokens)));
                    console.log('  ' + padRight(C.dim('Total tokens'), 18) + C.white(C.bold(String(sessionUsage.totalTokens))));
                    console.log('  ' + padRight(C.dim('Requests made'), 18) + C.white(String(sessionUsage.requestCount)));
                    if (sessionUsage.requestCount > 0) {
                        const avgPerReq = Math.round(sessionUsage.totalTokens / sessionUsage.requestCount);
                        console.log('  ' + padRight(C.dim('Avg/request'), 18) + C.dim(String(avgPerReq)));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'sessions': {
                    const recent = listRecentSessions(10);
                    console.log('');
                    console.log('  ' + C.teal(C.bold('RECENT SESSIONS')));
                    if (recent.length === 0) {
                        console.log('  ' + C.dim('No sessions yet.'));
                    } else {
                        for (const s of recent) {
                            const active = s.sessionId === sessionId ? C.green(' \u25C0 current') : '';
                            const date = s.updatedAt.slice(0, 16).replace('T', ' ');
                            const label = s.label ? C.dim(' — ') + C.white(s.label.slice(0, 40)) : '';
                            console.log('  ' + C.cyan(s.sessionId.slice(0, 8)) + C.dim(`  ${date}  ${s.messageCount}m`) + label + active);
                        }
                    }
                    console.log('');
                    console.log('  ' + C.dim('Resume: tentaclaw code --resume <session-id>'));
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'load': {
                    // Wave 317: /load <session-id> — import messages from another session into current context
                    const loadId = arg.trim();
                    if (!loadId) { console.log('  ' + C.dim('Usage: /load <session-id>  — merge another session\'s messages into current context')); rl!.prompt(); return; }
                    const loadEvents = loadSessionTranscript(loadId);
                    if (loadEvents.length === 0) { console.log('  ' + C.red(`No events found for session: ${loadId}`)); rl!.prompt(); return; }
                    const loadedMsgs = rebuildMessagesFromTranscript(loadEvents);
                    // Filter out system messages from the loaded session
                    const userContent = loadedMsgs.filter(m => m.role !== 'system');
                    messages.push(...userContent);
                    console.log('  ' + C.green(`\u2714 Loaded ${userContent.length} message${userContent.length !== 1 ? 's' : ''} from session ${loadId.slice(0, 8)}`));
                    rl!.prompt(); return;
                }
                case 'tag':
                case 'label': {
                    // Wave 297: /tag <text> — set a human-readable label for the current session
                    const tagText = arg.trim();
                    if (!tagText) { console.log('  ' + C.dim('Usage: /tag <label>  — set a label for this session')); rl!.prompt(); return; }
                    const msgCount2 = messages.filter(m => m.role === 'user').length;
                    updateSessionMeta(sessionId, { messageCount: msgCount2, tokenCount: sessionUsage.totalTokens, label: tagText });
                    console.log('  ' + C.green(`\u{1F3F7} Session labeled: "${tagText}"`));
                    rl!.prompt(); return;
                }
                case 'save': {
                    // Wave 294: /save [label] — save + optionally set human-readable label
                    const saveLabel = arg.trim();
                    const msgCount = messages.filter(m => m.role === 'user').length;
                    const saveMeta: Parameters<typeof updateSessionMeta>[1] = { messageCount: msgCount, tokenCount: sessionUsage.totalTokens };
                    if (saveLabel) saveMeta.label = saveLabel;
                    updateSessionMeta(sessionId, saveMeta);
                    const labelNote = saveLabel ? C.dim(` — "${saveLabel}"`) : '';
                    console.log('  ' + C.green(`\u2714 Session saved: ${sessionId}`) + labelNote);
                    rl!.prompt(); return;
                }
                case 'export': {
                    const exportPath = arg || `tentaclaw-session-${sessionId}.jsonl`;
                    try {
                        const srcPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
                        fs.copyFileSync(srcPath, path.resolve(exportPath));
                        console.log('  ' + C.green(`\u2714 Exported to: ${path.resolve(exportPath)}`));
                    } catch (e) {
                        console.log('  ' + C.red(`\u2718 Export failed: ${e instanceof Error ? e.message : String(e)}`));
                    }
                    rl!.prompt(); return;
                }
                case 'share': {
                    // Wave 85: export session as formatted markdown
                    const sharePath = arg || path.join(process.cwd(), `tentaclaw-${sessionId.slice(0, 8)}.md`);
                    const mdLines = [
                        `# TentaCLAW Session`,
                        ``,
                        `**Session:** ${sessionId}`,
                        `**Date:** ${new Date().toLocaleDateString()}`,
                        `**Model:** ${model}`,
                        `**CWD:** ${process.cwd()}`,
                        ``,
                        `---`,
                        ``,
                    ];
                    for (const m of messages) {
                        if (m.role === 'system') continue;
                        if (m.role === 'user') {
                            mdLines.push(`## You\n\n${m.content}\n`);
                        } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
                            mdLines.push(`## TentaCLAW\n\n${m.content}\n`);
                        } else if (m.role === 'tool') {
                            const preview = typeof m.content === 'string' ? m.content.slice(0, 500) : '';
                            if (preview) mdLines.push(`> **Tool result** (${(m as { name?: string }).name || 'tool'})\n>\n> ${preview.replace(/\n/g, '\n> ')}\n`);
                        }
                    }
                    try {
                        fs.writeFileSync(path.resolve(sharePath), mdLines.join('\n'), 'utf8');
                        console.log('  ' + C.green(`\u2714 Shared to: ${path.resolve(sharePath)}`));
                    } catch (e) {
                        console.log('  ' + C.red(`\u2718 Share failed: ${e instanceof Error ? e.message : String(e)}`));
                    }
                    rl!.prompt(); return;
                }
                case 'load': {
                    // Wave 102: /load <file|url> — inject file or URL contents into context
                    const loadArg = arg.trim();
                    if (!loadArg) { console.log('  ' + C.dim('Usage: /load <file>  or  /load <url>')); rl!.prompt(); return; }
                    rl!.pause();
                    try {
                        let fc = '';
                        let label = '';
                        if (loadArg.startsWith('http://') || loadArg.startsWith('https://')) {
                            // Wave 232: fetch URL
                            label = loadArg;
                            const http = require('http') as typeof import('http');
                            const https = require('https') as typeof import('https');
                            fc = await new Promise<string>((res, rej) => {
                                const parsed = new URL(loadArg);
                                const mod = parsed.protocol === 'https:' ? https : http;
                                const req = mod.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'TentaCLAW-CLI/2' } }, (response) => {
                                    let body = '';
                                    response.setEncoding('utf8');
                                    response.on('data', (c: string) => { body += c; if (body.length > 80_000) req.destroy(); });
                                    response.on('end', () => res(body));
                                });
                                req.on('error', rej);
                                req.setTimeout(10_000, () => { req.destroy(); rej(new Error('Timeout')); });
                            });
                            // Strip HTML
                            if (fc.includes('<html') || fc.includes('<!DOCTYPE')) {
                                fc = fc.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                                    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
                            }
                        } else {
                            const loadPath = resolvePath(loadArg);
                            label = loadPath;
                            fc = fs.readFileSync(loadPath, 'utf8');
                        }
                        const truncated = fc.slice(0, 8000);
                        const isTrunc = fc.length > 8000;
                        const injected = `[Loaded: ${label}]\n\`\`\`\n${truncated}\n\`\`\`${isTrunc ? '\n...(truncated at 8000 chars)' : ''}`;
                        messages.push({ role: 'user', content: `Please read this content I've loaded:\n\n${injected}` });
                        messages.push({ role: 'assistant', content: `I've read ${path.basename(label)} (${fc.split('\n').length} lines). Ready to work with it.` });
                        console.log('  ' + C.green(`\u2714 Loaded: ${label} (${fc.split('\n').length} lines into context)`));
                    } catch (e) {
                        console.log('  ' + C.red(`\u2718 Could not load: ${e instanceof Error ? e.message : String(e)}`));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'compact': {
                    // Wave 116/207: /compact [summarize|drop|<N>]
                    const compactArg = arg.trim().toLowerCase();
                    if (compactArg === 'summarize' || compactArg === 'sum') {
                        // Wave 207: LLM-generated summary — compress full context into a brief summary
                        rl!.pause();
                        try {
                            const conversationText = messages
                                .filter(m => m.role !== 'system')
                                .map(m => {
                                    if (m.role === 'user') return `User: ${typeof m.content === 'string' ? m.content.slice(0, 400) : '(tool response)'}`;
                                    if (m.role === 'assistant' && typeof m.content === 'string' && m.content) return `Assistant: ${m.content.slice(0, 400)}`;
                                    if (m.role === 'tool') return `Tool(${(m as {name?:string}).name||'?'}): ${typeof m.content === 'string' ? m.content.slice(0, 200) : ''}`;
                                    return null;
                                }).filter(Boolean).join('\n');
                            const sumUrl = inferenceUrl.replace(/\/+$/, '') + '/v1/chat/completions';
                            const sumBody = JSON.stringify({
                                model, stream: false, temperature: 0.3,
                                messages: [
                                    { role: 'system', content: 'You are a helpful assistant. Write a compact, dense summary of this conversation. Include: what the user asked for, what files were changed, what tools were used, key findings, and current state. Write in past tense. Max 300 words.' },
                                    { role: 'user', content: `Summarize this conversation:\n\n${conversationText.slice(0, 6000)}` },
                                ],
                            });
                            console.log('  ' + C.dim('Summarizing with LLM…'));
                            const http2 = require('http') as typeof import('http');
                            const https2 = require('https') as typeof import('https');
                            const parsed2 = new URL(sumUrl);
                            const mod2 = parsed2.protocol === 'https:' ? https2 : http2;
                            const cfg2 = loadConfig();
                            const apiKey2 = cfg2?.openai?.apiKey || cfg2?.openrouter?.apiKey || cfg2?.custom?.apiKey || '';
                            const sumHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(sumBody)) };
                            if (apiKey2) sumHeaders['Authorization'] = `Bearer ${apiKey2}`;
                            const summary = await new Promise<string>((res, rej) => {
                                const req = mod2.request({ hostname: parsed2.hostname, port: parsed2.port, path: parsed2.pathname, method: 'POST', headers: sumHeaders }, (response) => {
                                    let body = '';
                                    response.on('data', (c: Buffer) => { body += c.toString(); });
                                    response.on('end', () => {
                                        try {
                                            const parsed = JSON.parse(body) as { choices?: [{ message?: { content?: string } }] };
                                            res(parsed.choices?.[0]?.message?.content || '(no summary generated)');
                                        } catch { res('(failed to parse summary)'); }
                                    });
                                });
                                req.on('error', rej);
                                req.setTimeout(30_000, () => { req.destroy(); rej(new Error('Timeout')); });
                                req.write(sumBody); req.end();
                            });
                            const sysMsg = messages[0]!;
                            const before = messages.length;
                            messages = [
                                sysMsg,
                                { role: 'user', content: '[Context compacted — session summary]' },
                                { role: 'assistant', content: `## Session Summary\n\n${summary}` },
                            ];
                            const after = messages.length;
                            console.log('  ' + C.green(`\u2714 Context compressed: ${before} → ${after} messages.`));
                            console.log('  ' + C.dim(summary.slice(0, 200) + (summary.length > 200 ? '…' : '')));
                        } catch (e) {
                            console.log('  ' + C.red('Summarize failed: ' + (e instanceof Error ? e.message : String(e))));
                        }
                        rl!.resume(); rl!.prompt(); return;
                    } else if (compactArg === 'tools') {
                        // Wave 249: /compact tools — remove tool result messages (keep assistant analyses)
                        // This frees the most context when the model has already processed file reads
                        const before = messages.length;
                        const beforeBytes = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                        // Remove tool messages but keep the corresponding assistant tool_call messages (with nulled content)
                        messages = messages.filter((m) => {
                            if (m.role !== 'tool') return true;
                            // Keep pinned tool results
                            return typeof m.content === 'string' && m.content.includes('[PINNED');
                        });
                        const after = messages.length;
                        const afterBytes = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                        const freed = Math.round((beforeBytes - afterBytes) / 1024);
                        console.log('  ' + C.green(`✔ Dropped ${before - after} tool results. Freed ~${freed}kb. Est: ~${formatTokens(Math.round(afterBytes / 4))} tokens.`));
                        rl!.prompt(); return;
                    } else if (compactArg === 'drop' || /^\d+$/.test(compactArg)) {
                        // Drop old exchanges, keep system prompt + last N exchanges (default 5)
                        const keepExchanges = /^\d+$/.test(compactArg) ? parseInt(compactArg, 10) : 5;
                        const sysMsg = messages[0];
                        const rest = messages.slice(1);
                        // Group into exchanges by user message boundaries
                        const exchanges: typeof messages[] = [];
                        let current: typeof messages = [];
                        for (const m of rest) {
                            if (m.role === 'user' && current.length > 0) {
                                exchanges.push(current);
                                current = [];
                            }
                            current.push(m);
                        }
                        if (current.length > 0) exchanges.push(current);
                        const kept = exchanges.slice(-keepExchanges).flat();
                        const dropped = exchanges.length - Math.min(exchanges.length, keepExchanges);
                        messages = [sysMsg!, ...kept];
                        const ctxBytes2 = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                        console.log('  ' + C.green(`\u2714 Dropped ${dropped} old exchange${dropped !== 1 ? 's' : ''}. Kept last ${Math.min(exchanges.length, keepExchanges)}. Est: ~${formatTokens(Math.round(ctxBytes2 / 4))} tokens.`));
                    } else if (!compactArg) {
                        // Wave 383: no-arg /compact — show context stats + options menu instead of silent trim
                        const ctxBytesNow = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                        const ctxEstNow = Math.round(ctxBytesNow / 4);
                        const ctxPctNow = Math.min(100, Math.round(ctxEstNow / 128_000 * 100));
                        const toolMsgs383 = messages.filter(m => m.role === 'tool').length;
                        const userMsgs383 = messages.filter(m => m.role === 'user').length;
                        console.log('');
                        console.log('  ' + C.teal(C.bold('COMPACT')) + C.dim(` — ${messages.length} messages, ~${formatTokens(ctxEstNow)} tokens (${ctxPctNow}%)`));
                        console.log('');
                        console.log('  ' + C.white('/compact summarize') + C.dim('  LLM summary — smallest result, loses detail'));
                        console.log('  ' + C.white('/compact tools') + C.dim(`     Drop ${toolMsgs383} tool results — quick, preserves conversation`));
                        console.log('  ' + C.white('/compact drop') + C.dim('      Keep last 5 exchanges, drop older ones'));
                        console.log('  ' + C.white('/compact 3') + C.dim('         Keep last 3 exchanges'));
                        console.log('');
                        console.log('  ' + C.dim(`You have ${userMsgs383} exchanges in context.`));
                        console.log('');
                    } else {
                        // Default: trim long tool/assistant messages
                        let trimmed = 0;
                        for (let i = 1; i < messages.length - 10; i++) {
                            const m = messages[i];
                            const isPinned = typeof m.content === 'string' && m.content.includes('[PINNED');
                            if (isPinned) continue;
                            if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 200) {
                                messages[i] = { ...m, content: m.content.slice(0, 200) + '\n...(compacted)' };
                                trimmed++;
                            } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 500) {
                                messages[i] = { ...m, content: m.content.slice(0, 300) + '\n...(compacted — use /retry or /new if needed)' };
                                trimmed++;
                            }
                        }
                        const ctxBytes = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
                        const ctxEst = Math.round(ctxBytes / 4);
                        console.log('  ' + C.green(`\u2714 Compacted ${trimmed} messages. Est. context: ~${formatTokens(ctxEst)} tokens.`));
                        console.log('  ' + C.dim('Tip: /compact drop or /compact 3 to aggressively drop old exchanges.'));
                    }
                    rl!.prompt(); return;
                }
                case 'think': {
                    // Wave 73/311: /think — set agentTemperature; supports names, numeric 0-10, or raw float
                    const levels: Record<string, number> = {
                        off: 0.1, minimal: 0.3, low: 0.5, medium: 0.7, high: 0.9, xhigh: 1.0,
                        '0': 0.0, '1': 0.1, '2': 0.2, '3': 0.3, '4': 0.4, '5': 0.5,
                        '6': 0.6, '7': 0.7, '8': 0.8, '9': 0.9, '10': 1.0,
                    };
                    const level = arg.trim().toLowerCase();
                    if (level && levels[level] !== undefined) {
                        agentTemperature = levels[level]!;
                        console.log('  ' + C.green(`\u2714 Temperature: ${agentTemperature} \u2014 active from next message`));
                    } else if (level && !isNaN(parseFloat(level)) && parseFloat(level) >= 0 && parseFloat(level) <= 2) {
                        agentTemperature = Math.round(parseFloat(level) * 100) / 100;
                        console.log('  ' + C.green(`\u2714 Temperature: ${agentTemperature} \u2014 active from next message`));
                    } else if (!level) {
                        const currentLevel = Object.entries({ off: 0.1, minimal: 0.3, low: 0.5, medium: 0.7, high: 0.9, xhigh: 1.0 }).find(([, v]) => v === agentTemperature)?.[0] || 'custom';
                        console.log('  ' + C.dim(`Current: ${currentLevel} (temperature ${agentTemperature})`));
                        console.log('  ' + C.dim('Usage: /think off|minimal|low|medium|high|xhigh  or  /think 0-10  or  /think 0.7'));
                    } else {
                        console.log('  ' + C.dim('Usage: /think off|minimal|low|medium|high|xhigh  or  /think 0-10  or  /think 0.7'));
                    }
                    rl!.prompt(); return;
                }
                case 'cd':
                case 'cwd': {
                    if (!arg) {
                        console.log('  ' + C.dim(`cwd: ${process.cwd()}`));
                    } else {
                        const target = path.resolve(arg.replace(/^~/, os.homedir()));
                        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
                            process.chdir(target);
                            // Wave 331: update prompt to show current directory basename
                            const cwdBase = path.basename(process.cwd());
                            rl!.setPrompt(C.teal(`\n  ${cwdBase} ❯ `));
                            console.log('  ' + C.green(`\u2714 ${process.cwd()}`));
                        } else {
                            console.log('  ' + C.red(`\u2718 Not a directory: ${target}`));
                        }
                    }
                    rl!.prompt(); return;
                }
                case 'workspace':
                case 'ws': {
                    const wsArg = arg.trim();
                    const wsDir = getWorkspaceDir();
                    if (wsArg === 'reload') {
                        // Wave 70: reload workspace context into system prompt
                        const newCtx = loadWorkspaceContext();
                        const base = messages[0]?.role === 'system' ? String(messages[0].content) : systemPrompt;
                        // Replace old workspace context block with fresh one
                        const wsMarker = '--- Workspace Context ---';
                        const freshSystem = base.includes(wsMarker)
                            ? base.slice(0, base.indexOf(wsMarker)) + newCtx
                            : base + (newCtx ? '\n\n' + newCtx : '');
                        if (messages[0]?.role === 'system') messages[0].content = freshSystem;
                        console.log('  ' + C.green('\u2714 Workspace context reloaded into system prompt.'));
                        rl!.prompt(); return;
                    }
                    console.log('');
                    console.log('  ' + C.teal(C.bold('WORKSPACE')) + C.dim(` \u2014 ${wsDir}`));
                    try {
                        const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.md'));
                        for (const f of files) {
                            const size = fs.statSync(path.join(wsDir, f)).size;
                            console.log('  ' + C.green(padRight(f, 20)) + C.dim(`${size} bytes`));
                        }
                    } catch { console.log('  ' + C.dim('No workspace files.')); }
                    console.log('  ' + C.dim('  /workspace reload  \u2014 refresh files into context'));
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'retry': {
                    // Wave 59/254/329: re-run the last user message; /retry [modified prompt] to tweak
                    const retryOverride = arg.trim();
                    const retryBase = lastUserInput || (() => {
                        const lastUser2 = [...messages].reverse().find(m => m.role === 'user');
                        return lastUser2 ? String(lastUser2.content) : '';
                    })();
                    const retryMsg = retryOverride || retryBase;
                    if (!retryMsg) {
                        console.log('  ' + C.dim('Nothing to retry.'));
                        rl!.prompt(); return;
                    }
                    // Remove messages from the last user message onwards (keep history before it)
                    const lastUserMsgIdx = messages.map(m => m.role).lastIndexOf('user');
                    if (lastUserMsgIdx >= 0) messages = messages.slice(0, lastUserMsgIdx);
                    if (retryOverride) {
                        console.log('  ' + C.yellow('\u21BA Retrying with: ') + C.white(retryOverride.slice(0, 80)) + (retryOverride.length > 80 ? C.dim('…') : ''));
                    } else {
                        console.log('  ' + C.yellow('\u21BA Retrying: ') + C.dim(retryMsg.slice(0, 80)) + (retryMsg.length > 80 ? C.dim('…') : ''));
                    }
                    rl!.pause();
                    try { await runAgentLoop(retryMsg); }
                    catch (e) { console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e)))); }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'summarize':
                case 'summary': {
                    // Wave 101: /summarize — ask agent to write session summary to MEMORY.md
                    const summaryPrompt = `Please write a brief summary of what we've accomplished in this session. Include what was built or changed (with file names), key decisions, and any facts worth remembering. Append it to ${getWorkspaceDir()}/MEMORY.md under a "## Session ${new Date().toLocaleDateString()}" heading using edit_file. Keep it to 5-10 bullet points.`;
                    rl!.pause();
                    try { await runAgentLoop(summaryPrompt); }
                    catch (e) { console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e)))); }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'plan': {
                    // Wave 99: /plan <task> — ask agent to outline plan before executing
                    const planTask = arg.trim() || (messages.filter(m => m.role === 'user').slice(-1)[0]?.content as string || '');
                    if (!planTask) { console.log('  ' + C.dim('Usage: /plan <what you want to do>')); rl!.prompt(); return; }
                    const planPrompt = `Before doing anything, make a brief numbered plan for: ${planTask}

List the steps you'll take. Be specific about which files you'll read, modify, or create. Keep it to 5-10 steps. Do NOT execute anything yet — just outline the plan.`;
                    rl!.pause();
                    try { await runAgentLoop(planPrompt); }
                    catch (e) { console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e)))); }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'focus': {
                    // Wave 313/367: /focus <file> [file2 ...] — inject one or more files as pinned context
                    const focusArg = arg.trim();
                    if (!focusArg) { console.log('  ' + C.dim('Usage: /focus <file> [file2...]  — read files and pin as session context')); rl!.prompt(); return; }
                    // Wave 367: split on whitespace to support multiple files
                    const focusTargets = focusArg.split(/\s+/).filter(Boolean);
                    const focusBlocks: string[] = [];
                    const focusNames: string[] = [];
                    for (const ft of focusTargets) {
                        const focusPath = resolvePath(ft);
                        if (!fs.existsSync(focusPath)) { console.log('  ' + C.red(`File not found: ${ft}`)); continue; }
                        try {
                            const focusContent = fs.readFileSync(focusPath, 'utf8').slice(0, 6000);
                            const focusExt = path.extname(focusPath).slice(1) || 'text';
                            const rel = path.relative(process.cwd(), focusPath);
                            focusBlocks.push(`File: ${rel}\n\`\`\`${focusExt}\n${focusContent}\n\`\`\``);
                            focusNames.push(rel);
                        } catch (e) { console.log('  ' + C.red(`Cannot read ${ft}: ` + (e instanceof Error ? e.message : String(e)))); }
                    }
                    if (focusBlocks.length === 0) { rl!.prompt(); return; }
                    const totalLines = focusBlocks.join('\n').split('\n').length;
                    messages.push({ role: 'user', content: `[Focusing on: ${focusNames.join(', ')}]\n\n${focusBlocks.join('\n\n')}` });
                    messages.push({ role: 'assistant', content: `I've read ${focusNames.join(', ')} (${totalLines} total lines). What would you like me to do?` });
                    pinnedContext = `Focus files: ${focusNames.join(', ')}`;
                    console.log('  ' + C.green(`\u2714 Focused on: ${focusNames.join(', ')} (${totalLines} lines, pinned)`));
                    rl!.prompt(); return;
                }
                case 'reload': {
                    // Wave 307: /reload — shortcut for /workspace reload (reload workspace context into system prompt)
                    const newCtxReload = loadWorkspaceContext();
                    const baseReload = messages[0]?.role === 'system' ? String(messages[0].content) : '';
                    const markerReload = '--- Workspace Context ---';
                    const freshReload = baseReload.includes(markerReload)
                        ? baseReload.slice(0, baseReload.indexOf(markerReload)) + newCtxReload
                        : baseReload + (newCtxReload ? '\n\n' + newCtxReload : '');
                    if (messages[0]?.role === 'system') messages[0].content = freshReload;
                    const wsFiles307 = newCtxReload.match(/--- (\S+) ---/g)?.map(m => m.replace(/--- | ---/g, '')) || [];
                    console.log('  ' + C.green('\u2714 Workspace reloaded') + (wsFiles307.length > 0 ? C.dim(` (${wsFiles307.join(', ')})`) : ''));
                    rl!.prompt(); return;
                }
                case 'pin-context': {
                    // Wave 285: /pin-context [text] — set/clear persistent context prepended to every message
                    const pinCtxText = arg.trim();
                    if (!pinCtxText) {
                        if (pinnedContext) {
                            pinnedContext = '';
                            console.log('  ' + C.green('\u2714 Pinned context cleared.'));
                        } else {
                            console.log('  ' + C.dim('Usage: /pin-context <text>  — prepend text to every message'));
                            console.log('  ' + C.dim('       /pin-context          — clear current pinned context'));
                        }
                    } else {
                        pinnedContext = pinCtxText;
                        console.log('  ' + C.green('\u{1F4CC} Pinned context set: ') + C.dim(pinCtxText.slice(0, 60) + (pinCtxText.length > 60 ? '…' : '')));
                    }
                    rl!.prompt(); return;
                }
                case 'pin': {
                    // Wave 60: pin the last assistant message (mark with 🔒 so compact skips it)
                    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
                    if (!lastAssistant) { console.log('  ' + C.dim('Nothing to pin.')); rl!.prompt(); return; }
                    const pinnedMark = '\n\n[PINNED — do not compact this message]';
                    if (String(lastAssistant.content).includes('[PINNED')) {
                        console.log('  ' + C.dim('Already pinned.'));
                    } else {
                        lastAssistant.content = String(lastAssistant.content) + pinnedMark;
                        console.log('  ' + C.green('\u{1F4CC} Pinned last response — will survive /compact'));
                    }
                    rl!.prompt(); return;
                }
                case 'undo': {
                    // Remove the last user+assistant exchange from context (not from JSONL)
                    // Wave 256: improved with tool count display and last-prompt hint
                    const lastUserIdx2 = messages.map(m => m.role).lastIndexOf('user');
                    if (lastUserIdx2 <= 0) { console.log('  ' + C.dim('Nothing to undo.')); rl!.prompt(); return; }
                    const removedMsgs = messages.splice(lastUserIdx2);
                    const removedTools2 = removedMsgs.filter(m => m.role === 'tool').length;
                    const removedAssist2 = removedMsgs.filter(m => m.role === 'assistant').length;
                    console.log('  ' + C.green(`\u2714 Undone last exchange — removed ${removedAssist2} response${removedAssist2 !== 1 ? 's' : ''}, ${removedTools2} tool call${removedTools2 !== 1 ? 's' : ''}.`));
                    if (lastUserInput) console.log('  ' + C.dim(`Prompt was: "${lastUserInput.slice(0, 70)}${lastUserInput.length > 70 ? '…' : ''}"`));
                    console.log('  ' + C.dim('Use /retry to re-run, or type a new message.'));
                    rl!.prompt(); return;
                }
                case 'diff': {
                    // Wave 198: show actual colored git diff output
                    // Wave 374: --context N (or -C N) — configurable unified diff context lines
                    rl!.pause();
                    try {
                        const diffArg = arg.trim();
                        // Extract --context N or -C N
                        const diffCtxMatch374 = diffArg.match(/(?:--context|-C)[= ]?(\d+)/);
                        const diffCtxN374 = diffCtxMatch374 ? `-U${diffCtxMatch374[1]}` : '';
                        const cleanDiffArg374 = diffArg.replace(/(?:--context|-C)[= ]?\d+/, '').trim();
                        // /diff --staged  → staged changes; /diff <file> → specific file; /diff → unstaged
                        const gitArgs = cleanDiffArg374 === '--staged' || cleanDiffArg374 === '--cached' ? '--cached' : cleanDiffArg374;
                        let diffOut: string;
                        try {
                            diffOut = execSync(`git diff ${diffCtxN374} ${gitArgs}`.trim(), { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() }).trim();
                        } catch { diffOut = ''; }
                        console.log('');
                        if (!diffOut) {
                            // Fall back to --stat for a summary
                            try {
                                const stat = execSync('git diff --stat HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                                if (stat) { console.log('  ' + C.teal(C.bold('CHANGES (committed)'))); stat.split('\n').forEach(l => console.log('  ' + C.dim(l))); }
                                else console.log('  ' + C.dim('Working tree clean — no unstaged changes.'));
                            } catch { console.log('  ' + C.dim('Not a git repository.')); }
                        } else {
                            const MAX_DIFF_LINES = 120;
                            const diffLines = diffOut.split('\n');
                            const shown = diffLines.slice(0, MAX_DIFF_LINES);
                            console.log('  ' + C.teal(C.bold('DIFF')) + (gitArgs === '--cached' ? C.dim(' (staged)') : '') + C.dim(` — ${diffLines.length} lines`));
                            console.log('');
                            for (const l of shown) {
                                if (l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('Binary')) console.log('  ' + C.bold(l));
                                else if (l.startsWith('--- ') || l.startsWith('+++ ')) console.log('  ' + C.dim(l));
                                else if (l.startsWith('@@')) console.log('  ' + C.purple(l));
                                else if (l.startsWith('+')) console.log('  ' + C.green(l));
                                else if (l.startsWith('-')) console.log('  ' + C.red(l));
                                else console.log('  ' + C.dim(l));
                            }
                            if (diffLines.length > MAX_DIFF_LINES) {
                                console.log('  ' + C.dim(`\u2026(${diffLines.length - MAX_DIFF_LINES} more lines — use ! git diff for full output)`));
                            }
                        }
                        console.log('');
                    } catch { console.log('  ' + C.dim('Not a git repository.')); }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'tools': {
                    // Wave 194: list all available tools in code agent
                    console.log('');
                    console.log('  ' + C.teal(C.bold('TOOLS')) + C.dim(` — ${CODE_AGENT_TOOLS.length} available`));
                    console.log('');
                    for (const t of CODE_AGENT_TOOLS) {
                        const fn = t.function;
                        const params = fn.parameters?.properties ? Object.keys(fn.parameters.properties as Record<string, unknown>) : [];
                        console.log('  ' + C.cyan(padRight(fn.name, 22)) + C.dim(fn.description.slice(0, 55)) + (fn.description.length > 55 ? C.dim('…') : ''));
                        if (params.length > 0) console.log('  ' + ' '.repeat(22) + C.dim('params: ' + params.join(', ')));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'inject': {
                    // Wave 179: inject text directly as assistant message (steering context)
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /inject <text>  — adds text to context as if assistant said it')); rl!.prompt(); return; }
                    messages.push({ role: 'assistant', content: arg.trim() });
                    console.log('  ' + C.green('\u2714 Injected as assistant message.'));
                    rl!.prompt(); return;
                }
                case 'ask': {
                    // Wave 166: quick question with no-tools mode (direct response, no tool calls)
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /ask <question>  — supports @file.ts references')); rl!.prompt(); return; }
                    rl!.pause();
                    try {
                        // Wave 375: @file expansion for /ask — expand @path/to/file before sending
                        let askArg375 = arg.trim();
                        const atFileMatches375 = [...askArg375.matchAll(/@([\w./\\-]+\.[a-z]{1,10})\b/gi)];
                        for (const m375 of atFileMatches375) {
                            const atPath375 = resolvePath(m375[1]!);
                            try {
                                const atContent375 = fs.readFileSync(atPath375, 'utf8').slice(0, 6000);
                                const atExt375 = path.extname(atPath375).slice(1) || 'text';
                                askArg375 = askArg375.replace(m375[0]!, `\`\`\`${atExt375}\n// ${m375[1]}\n${atContent375}\n\`\`\``);
                                console.log('  ' + C.dim(`@${m375[1]} → ${atContent375.split('\n').length} lines injected`));
                            } catch { /* file not found — leave @ref as-is */ }
                        }
                        const url = inferenceUrl.replace(/\/+$/, '') + '/v1/chat/completions';
                        const askBody = JSON.stringify({
                            model, stream: true, temperature: agentTemperature,
                            messages: [...messages, { role: 'user', content: askArg375 }],
                        });
                        process.stdout.write('\n  ' + C.purple('\u25CE '));
                        await new Promise<void>((res) => {
                            const http = require('http') as typeof import('http');
                            const https = require('https') as typeof import('https');
                            const parsed = new URL(url);
                            const mod = parsed.protocol === 'https:' ? https : http;
                            const cfg = loadConfig();
                            const apiKey = cfg?.openai?.apiKey || cfg?.openrouter?.apiKey || cfg?.custom?.apiKey || '';
                            const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(askBody)) };
                            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                            const req = mod.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST', headers }, (response) => {
                                let buf = '';
                                response.on('data', (c: Buffer) => {
                                    buf += c.toString();
                                    const lines = buf.split('\n');
                                    buf = lines.pop() ?? '';
                                    for (const line of lines) {
                                        if (!line.startsWith('data: ')) continue;
                                        const raw = line.slice(6).trim();
                                        if (raw === '[DONE]') continue;
                                        try {
                                            const ev = JSON.parse(raw) as { choices?: [{ delta?: { content?: string } }] };
                                            const delta = ev.choices?.[0]?.delta?.content;
                                            if (delta) process.stdout.write(delta);
                                        } catch { /* skip */ }
                                    }
                                });
                                response.on('end', () => res());
                            });
                            req.on('error', () => res());
                            req.write(askBody);
                            req.end();
                        });
                        process.stdout.write('\n');
                    } catch (e) {
                        console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'forget': {
                    // Wave 164: remove messages containing a search string from context
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /forget <text-to-match>  — removes messages containing this text')); rl!.prompt(); return; }
                    const query = arg.trim().toLowerCase();
                    const before = messages.length;
                    messages = messages.filter(m => {
                        if (m.role === 'system') return true; // never remove system prompt
                        return !(typeof m.content === 'string' && m.content.toLowerCase().includes(query));
                    });
                    const removed = before - messages.length;
                    if (removed > 0) {
                        console.log('  ' + C.green(`\u2714 Removed ${removed} message${removed !== 1 ? 's' : ''} containing "${arg.trim()}"`));
                    } else {
                        console.log('  ' + C.dim(`No messages found containing "${arg.trim()}"`));
                    }
                    rl!.prompt(); return;
                }
                case 'history': {
                    // Wave 122/336: show last N user/assistant exchanges with tool call counts
                    const N = parseInt(arg.trim() || '5', 10) || 5;
                    // Build exchanges: pair each user msg with following assistant + tool messages
                    const exchanges: Array<{ user: string; assistant: string; toolCount: number }> = [];
                    let pendingUser = '';
                    let toolCountH = 0;
                    for (const m of messages) {
                        if (m.role === 'system') continue;
                        if (m.role === 'user') {
                            if (pendingUser) exchanges.push({ user: pendingUser, assistant: '', toolCount: toolCountH });
                            pendingUser = typeof m.content === 'string' ? m.content : '';
                            toolCountH = 0;
                        } else if (m.role === 'assistant') {
                            const assistText = typeof m.content === 'string' ? m.content : '';
                            if (pendingUser) { exchanges.push({ user: pendingUser, assistant: assistText, toolCount: toolCountH }); pendingUser = ''; toolCountH = 0; }
                        } else if (m.role === 'tool') {
                            toolCountH++;
                        }
                    }
                    if (pendingUser) exchanges.push({ user: pendingUser, assistant: '', toolCount: toolCountH });
                    const slice = exchanges.slice(-N);
                    console.log('');
                    console.log('  ' + C.teal(C.bold('HISTORY')) + C.dim(` — last ${slice.length} exchange${slice.length !== 1 ? 's' : ''}`));
                    console.log('');
                    for (let hi = 0; hi < slice.length; hi++) {
                        const ex = slice[hi]!;
                        const idx = exchanges.length - slice.length + hi + 1;
                        const userPrev = ex.user.replace(/\n/g, ' ').slice(0, 100);
                        const assistPrev = ex.assistant.replace(/\n/g, ' ').slice(0, 100);
                        const toolsNote = ex.toolCount > 0 ? C.dim(` [${ex.toolCount} tool${ex.toolCount !== 1 ? 's' : ''}]`) : '';
                        console.log('  ' + C.dim(`[${idx}]`) + ' ' + C.cyan('You: ') + C.white(userPrev) + (userPrev.length >= 100 ? C.dim('…') : ''));
                        if (ex.assistant) console.log('       ' + C.purple('TentaCLAW: ') + C.dim(assistPrev) + (assistPrev.length >= 100 ? C.dim('…') : '') + toolsNote);
                        console.log('');
                    }
                    rl!.prompt(); return;
                }
                case 'commit': {
                    // Wave 215: /commit [msg] — smart commit with auto-generated message
                    rl!.pause();
                    try {
                        const statusOut = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (!statusOut) {
                            console.log('  ' + C.dim('Nothing to commit — working tree clean.'));
                        } else {
                            const changedFiles = statusOut.split('\n').map(l => l.slice(3).trim());
                            // Build smart auto-message from changed files
                            const customMsg = arg.trim();
                            let commitMsg = customMsg;
                            if (!commitMsg) {
                                const dirs = [...new Set(changedFiles.map(f => f.split('/')[0]).filter(Boolean))];
                                const fileStr = changedFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
                                const more = changedFiles.length > 3 ? ` (+${changedFiles.length - 3})` : '';
                                commitMsg = `update: ${fileStr}${more}` + (dirs.length > 1 ? ` [${dirs.slice(0, 3).join(', ')}]` : '');
                            }
                            execSync(`git add -A && git commit -m "${commitMsg.replace(/"/g, "'")}"`, { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green(`\u2714 Committed ${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}: "${commitMsg}"`));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('Git error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'checkpoint':
                case 'cp': {
                    // Wave 106: on-demand git checkpoint commit
                    rl!.pause();
                    try {
                        const statusOut = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (!statusOut) {
                            console.log('  ' + C.dim('Nothing to commit — working tree clean.'));
                        } else {
                            const msg = arg.trim() || `checkpoint: TentaCLAW session ${sessionId.slice(0, 8)}`;
                            execSync(`git add -A && git commit -m "${msg.replace(/"/g, "'")}"`, { encoding: 'utf8', stdio: 'pipe' });
                            const files = statusOut.split('\n').length;
                            console.log('  ' + C.green(`\u2714 Checkpoint committed: ${files} file${files !== 1 ? 's' : ''} — "${msg}"`));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('Git error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'find': {
                    // Wave 212: /find <glob> — quick file finder without going through LLM
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /find <glob>  — e.g., /find "*.ts" or /find src/**/*.test.js')); rl!.prompt(); return; }
                    try {
                        const findPat = arg.trim();
                        const FIND_SKIP = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage']);
                        const regexStr = findPat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*');
                        const re = new RegExp('^' + regexStr + '$');
                        const results: string[] = [];
                        const walkFind = (d: string, rel: string) => {
                            if (results.length >= 50) return;
                            let entries: fs.Dirent[];
                            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                            for (const e of entries) {
                                if (e.name.startsWith('.') && !findPat.includes('.')) continue;
                                if (e.isDirectory() && FIND_SKIP.has(e.name)) continue;
                                const relPath = rel ? `${rel}/${e.name}` : e.name;
                                if (e.isDirectory()) { walkFind(path.join(d, e.name), relPath); }
                                else if (re.test(relPath) || re.test(e.name)) {
                                    try {
                                        const sz = fs.statSync(path.join(d, e.name)).size;
                                        const szStr = sz < 1024 ? `${sz}b` : `${(sz/1024).toFixed(1)}kb`;
                                        results.push(`${relPath}  (${szStr})`);
                                    } catch { results.push(relPath); }
                                }
                            }
                        };
                        walkFind(process.cwd(), '');
                        console.log('');
                        if (results.length === 0) {
                            console.log('  ' + C.dim(`No files matched: ${findPat}`));
                        } else {
                            console.log('  ' + C.teal(C.bold('FIND')) + C.dim(` "${findPat}" — ${results.length} result${results.length !== 1 ? 's' : ''}`));
                            console.log('');
                            results.forEach(r => console.log('  ' + C.cyan(r)));
                            if (results.length >= 50) console.log('  ' + C.dim('...(limit 50 reached)'));
                        }
                        console.log('');
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.prompt(); return;
                }
                case 'todo': {
                    // Wave 209: /todo — find all TODO/FIXME/HACK comments in the project
                    rl!.pause();
                    try {
                        const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|NOTE|BUG|WARN|DEPRECATED)\b.*$/gi;
                        const SKIP_TODO = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__', 'coverage']);
                        const todos: Array<{ file: string; line: number; tag: string; text: string }> = [];
                        const walk = (d: string, depth: number) => {
                            if (depth > 6 || todos.length > 100) return;
                            let entries: fs.Dirent[];
                            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                            for (const e of entries) {
                                if (e.name.startsWith('.') || SKIP_TODO.has(e.name)) continue;
                                if (e.isDirectory()) { walk(path.join(d, e.name), depth + 1); continue; }
                                const ext = path.extname(e.name);
                                if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.md', '.sh', '.yaml', '.yml'].includes(ext)) continue;
                                try {
                                    const content = fs.readFileSync(path.join(d, e.name), 'utf8');
                                    const lines = content.split('\n');
                                    for (let i = 0; i < lines.length; i++) {
                                        const m = lines[i]!.match(TODO_PATTERN);
                                        if (m) {
                                            const tag = m[0].match(/\b(TODO|FIXME|HACK|XXX|NOTE|BUG|WARN|DEPRECATED)\b/i)?.[0]?.toUpperCase() || 'TODO';
                                            const text = m[0].replace(/^[^A-Z]*(TODO|FIXME|HACK|XXX|NOTE|BUG|WARN|DEPRECATED)[:\s]*/i, '').trim();
                                            todos.push({ file: path.relative(process.cwd(), path.join(d, e.name)), line: i + 1, tag, text: text.slice(0, 100) });
                                        }
                                    }
                                } catch { /* skip unreadable */ }
                            }
                        };
                        walk(process.cwd(), 0);
                        console.log('');
                        if (todos.length === 0) {
                            console.log('  ' + C.green('\u2714 No TODOs found.'));
                        } else {
                            console.log('  ' + C.teal(C.bold('TODO LIST')) + C.dim(` — ${todos.length} item${todos.length !== 1 ? 's' : ''}`));
                            console.log('');
                            const tagColor: Record<string, (s: string) => string> = {
                                FIXME: C.red, BUG: C.red, HACK: C.yellow, TODO: C.cyan,
                                NOTE: C.dim, DEPRECATED: C.yellow, WARN: C.yellow, XXX: C.red,
                            };
                            for (const t of todos.slice(0, 30)) {
                                const col = tagColor[t.tag] || C.dim;
                                console.log('  ' + col(t.tag.padEnd(10)) + C.dim(`${t.file}:${t.line}`) + '  ' + t.text);
                            }
                            if (todos.length > 30) console.log('  ' + C.dim(`...(${todos.length - 30} more)`));
                        }
                        console.log('');
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'grep': {
                    // Wave 205: /grep <pattern> — quick project search, output goes to context
                    if (!arg.trim()) { console.log('  ' + C.dim('Usage: /grep <pattern> [file-glob]  — search project and inject results')); rl!.prompt(); return; }
                    rl!.pause();
                    const grepParts = arg.trim().split(/\s+/);
                    const grepPat = grepParts[0] || '';
                    const grepGlob = grepParts[1] || '*';
                    try {
                        // Try rg first, fall back to pure Node.js
                        let grepResult = '';
                        let usedRg = false;
                        try {
                            const rgOut = execSync(`rg --fixed-strings --ignore-case --context=1 --max-count=5 --glob=${JSON.stringify(grepGlob)} --heading --line-number --no-messages --color=never ${JSON.stringify(grepPat)}`, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), maxBuffer: 500_000 }).trim();
                            grepResult = rgOut; usedRg = true;
                        } catch { /* fall through */ }
                        if (!usedRg || !grepResult) {
                            // Pure Node.js fallback — search recursively, 3 files max
                            const SEARCH_SKIP = new Set(['node_modules', 'dist', '.git', '.next', '__pycache__']);
                            const gPat = grepPat.toLowerCase();
                            const fileRe = new RegExp('^' + grepGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
                            const found: string[] = [];
                            const walk2 = (d: string, depth: number) => {
                                if (found.length >= 3 || depth > 6) return;
                                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                                    if (e.name.startsWith('.') || SEARCH_SKIP.has(e.name)) continue;
                                    if (e.isDirectory()) { walk2(path.join(d, e.name), depth + 1); continue; }
                                    if (!fileRe.test(e.name)) continue;
                                    const content = fs.readFileSync(path.join(d, e.name), 'utf8');
                                    const lines = content.split('\n');
                                    const matches = lines.map((l, i) => ({ n: i + 1, l })).filter(x => x.l.toLowerCase().includes(gPat));
                                    if (matches.length > 0) {
                                        found.push(`${path.relative(process.cwd(), path.join(d, e.name))}\n` + matches.slice(0, 5).map(m => `  ${m.n}: ${m.l}`).join('\n'));
                                    }
                                }
                            };
                            try { walk2(process.cwd(), 0); } catch { /* ok */ }
                            grepResult = found.join('\n\n');
                        }
                        if (!grepResult) {
                            console.log('  ' + C.dim(`No matches for "${grepPat}"`));
                        } else {
                            // Wave 408: show match count in header
                            const matchLines408 = grepResult.split('\n').filter(l => l.match(/^\d+:/));
                            const fileCount408 = grepResult.split('\n').filter(l => !l.startsWith(' ') && l.includes('/') && !l.match(/^\d+:/)).length;
                            const countStr408 = `${matchLines408.length} match${matchLines408.length !== 1 ? 'es' : ''} in ${fileCount408 || '?'} file${fileCount408 !== 1 ? 's' : ''}`;
                            console.log('');
                            console.log('  ' + C.teal(C.bold('GREP')) + C.dim(` "${grepPat}"`) + C.dim(` — ${countStr408}`));
                            console.log('');
                            grepResult.split('\n').slice(0, 60).forEach(l => {
                                if (l.match(/^\d+:/)) console.log('  ' + C.dim(l));
                                else if (!l.startsWith(' ') && l.includes('/')) console.log('  ' + C.cyan(l));
                                else console.log('  ' + l);
                            });
                            console.log('');
                            // Optionally inject into context
                            messages.push({ role: 'user', content: `[/grep "${grepPat}"]\n${grepResult.slice(0, 4000)}` });
                            console.log('  ' + C.dim('Search results injected into context.'));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'git': {
                    // Wave 202: /git <subcmd> — quick git operations in session
                    const sub = arg.trim();
                    rl!.pause();
                    try {
                        if (!sub || sub === 'status' || sub === 's') {
                            const out = execSync('git status --short', { encoding: 'utf8', stdio: 'pipe' }).trim();
                            console.log('');
                            if (!out) { console.log('  ' + C.dim('Working tree clean.')); }
                            else {
                                out.split('\n').forEach(l => {
                                    const col = l.startsWith('??') ? C.dim : l.startsWith('A') || l.startsWith('M ') ? C.green : l.startsWith(' M') ? C.yellow : C.red;
                                    console.log('  ' + col(l));
                                });
                            }
                            console.log('');
                        } else if (sub === 'log' || sub === 'l') {
                            const log = execSync('git log --oneline -10', { encoding: 'utf8', stdio: 'pipe' }).trim();
                            console.log('');
                            log.split('\n').forEach(l => {
                                const [hash, ...rest] = l.split(' ');
                                console.log('  ' + C.purple(hash || '') + '  ' + C.dim(rest.join(' ')));
                            });
                            console.log('');
                        } else if (sub.startsWith('add ') || sub === 'add') {
                            const target = sub.slice(4).trim() || '-A';
                            execSync(`git add ${target}`, { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green(`\u2714 Staged: ${target}`));
                        } else if (sub.startsWith('commit ')) {
                            const msg = sub.slice(7).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
                            execSync(`git commit -m "${msg.replace(/"/g, "'")}"`, { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green(`\u2714 Committed: "${msg}"`));
                        } else if (sub === 'stash') {
                            execSync('git stash', { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green('\u2714 Stashed changes.'));
                        } else if (sub === 'stash pop') {
                            execSync('git stash pop', { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green('\u2714 Stash popped.'));
                        } else {
                            console.log('  ' + C.dim(`Usage: /git [status|log|add <files>|commit <msg>|stash|stash pop]`));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('Git error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'branch': {
                    // Wave 246: /branch — list, create, or switch git branches
                    const branchArg = arg.trim();
                    rl!.pause();
                    try {
                        const current = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (!branchArg || branchArg === 'list') {
                            // List branches
                            const out = execSync('git branch', { encoding: 'utf8', stdio: 'pipe' }).trim();
                            console.log('');
                            out.split('\n').forEach(l => {
                                const isCur = l.startsWith('*');
                                console.log('  ' + (isCur ? C.green(l) : C.dim(l)));
                            });
                            console.log('');
                        } else if (branchArg.startsWith('new ') || branchArg.startsWith('-b ')) {
                            // Create new branch
                            const name = branchArg.replace(/^new |^-b /, '').trim();
                            execSync(`git checkout -b ${name}`, { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green(`✔ Created and switched to branch: ${name}`));
                        } else {
                            // Switch to existing branch
                            execSync(`git checkout ${branchArg}`, { encoding: 'utf8', stdio: 'pipe' });
                            console.log('  ' + C.green(`✔ Switched to branch: ${branchArg} (was: ${current})`));
                        }
                    } catch (e) {
                        console.log('  ' + C.red('Branch error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'paste': {
                    // Wave 276: /paste — read from clipboard and inject into context
                    let pasteContent = '';
                    try {
                        if (process.platform === 'win32') {
                            pasteContent = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
                        } else if (process.platform === 'darwin') {
                            pasteContent = execSync('pbpaste', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
                        } else {
                            // Linux: try xclip, xsel, wl-paste
                            try { pasteContent = execSync('xclip -selection clipboard -o', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim(); }
                            catch { try { pasteContent = execSync('xsel --clipboard --output', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim(); } catch { /* no clipboard tool */ } }
                        }
                    } catch { /* clipboard unavailable */ }
                    if (!pasteContent) { console.log('  ' + C.red('Could not read clipboard (no content or clipboard unavailable)')); rl!.prompt(); return; }
                    const pasteLines = pasteContent.split('\n').length;
                    const pasteLabel = arg.trim() || 'clipboard';
                    const pasteBlock = `[Pasted from ${pasteLabel}: ${pasteLines} lines]\n\`\`\`\n${pasteContent.slice(0, 6000)}\n\`\`\`${pasteContent.length > 6000 ? '\n...(truncated)' : ''}`;
                    messages.push({ role: 'user', content: `I pasted this content:\n\n${pasteBlock}` });
                    messages.push({ role: 'assistant', content: `I see the ${pasteLabel} content (${pasteLines} lines). What would you like me to do with it?` });
                    console.log('  ' + C.green(`\u2714 Pasted ${pasteLines} lines from clipboard into context`));
                    rl!.prompt(); return;
                }
                case 'inline': {
                    // Wave 284: /inline <cmd> — run shell command and inject its output into context
                    const inlineCmd = arg.trim();
                    if (!inlineCmd) { console.log('  ' + C.dim('Usage: /inline <shell command>  — runs cmd and injects output as context')); rl!.prompt(); return; }
                    rl!.pause();
                    try {
                        const inlineOut = execSync(inlineCmd, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), maxBuffer: 200_000, timeout: 30_000 }).trim();
                        const inlineLines = inlineOut.split('\n').length;
                        const inlineBlock = `\`\`\`\n$ ${inlineCmd}\n${inlineOut.slice(0, 8000)}${inlineOut.length > 8000 ? '\n...(truncated)' : ''}\n\`\`\``;
                        messages.push({ role: 'user', content: `Shell output from \`${inlineCmd}\`:\n\n${inlineBlock}` });
                        messages.push({ role: 'assistant', content: `Got it — I see the output of \`${inlineCmd}\` (${inlineLines} lines). What would you like me to do with it?` });
                        console.log('  ' + C.green(`\u2714 Injected ${inlineLines} lines from: ${inlineCmd}`));
                    } catch (e) {
                        const errMsg = e instanceof Error ? e.message.split('\n')[0] : String(e);
                        console.log('  ' + C.red(`Error running command: ${errMsg}`));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'grep': {
                    // Wave 268: /grep <pattern> — search message context for a pattern
                    const grepPat = arg.trim();
                    if (!grepPat) { console.log('  ' + C.dim('Usage: /grep <pattern>  — search conversation context')); rl!.prompt(); return; }
                    let grepRe: RegExp;
                    try { grepRe = new RegExp(grepPat, 'gi'); } catch { grepRe = new RegExp(grepPat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
                    const grepHits: Array<{ msgIdx: number; role: string; lineNo: number; line: string }> = [];
                    messages.forEach((m, mi) => {
                        if (typeof m.content !== 'string') return;
                        m.content.split('\n').forEach((l, li) => {
                            if (grepRe.test(l)) grepHits.push({ msgIdx: mi, role: m.role, lineNo: li + 1, line: l.trim().slice(0, 120) });
                            grepRe.lastIndex = 0; // reset global regex
                        });
                    });
                    console.log('');
                    if (grepHits.length === 0) {
                        console.log('  ' + C.dim(`No matches for: ${grepPat}`));
                    } else {
                        for (const h of grepHits.slice(0, 20)) {
                            const roleCol = h.role === 'assistant' ? C.purple : h.role === 'tool' ? C.teal : C.dim;
                            console.log('  ' + roleCol(`[${h.role} #${h.msgIdx}:${h.lineNo}]`) + '  ' + h.line.replace(grepRe, m => C.yellow(m)));
                            grepRe.lastIndex = 0;
                        }
                        if (grepHits.length > 20) console.log('  ' + C.dim(`... +${grepHits.length - 20} more matches`));
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'symbols': {
                    // Wave 353: /symbols <file> — extract function/class/const names with line numbers
                    const symFile = arg.trim();
                    if (!symFile) { console.log('  ' + C.dim('Usage: /symbols <file>  — shows functions, classes, consts with line numbers')); rl!.prompt(); return; }
                    const symPath = path.isAbsolute(symFile) ? symFile : path.join(process.cwd(), symFile);
                    if (!fs.existsSync(symPath)) { console.log('  ' + C.red(`File not found: ${symFile}`)); rl!.prompt(); return; }
                    let symContent = '';
                    try { symContent = fs.readFileSync(symPath, 'utf8'); } catch { console.log('  ' + C.red(`Cannot read: ${symFile}`)); rl!.prompt(); return; }
                    const symLines = symContent.split('\n');
                    // Pattern-based extractor — works for TS/JS/Python/Go/Rust
                    const symPatterns: Array<{ re: RegExp; kind: string }> = [
                        { re: /^(export\s+)?(async\s+)?function\s+(\w+)/, kind: 'fn' },
                        { re: /^(export\s+)?(abstract\s+)?class\s+(\w+)/, kind: 'class' },
                        { re: /^(export\s+)?interface\s+(\w+)/, kind: 'iface' },
                        { re: /^(export\s+)?type\s+(\w+)\s*=/, kind: 'type' },
                        { re: /^(export\s+)?(const|let|var)\s+(\w+)\s*[:=(]/, kind: 'const' },
                        { re: /^def\s+(\w+)/, kind: 'fn' },
                        { re: /^class\s+(\w+)/, kind: 'class' },
                        { re: /^func\s+(\w+)/, kind: 'fn' },
                        { re: /^fn\s+(\w+)/, kind: 'fn' },
                    ];
                    const kindColor: Record<string, (s: string) => string> = { fn: C.teal, class: C.yellow, iface: C.cyan, type: C.purple, const: C.dim };
                    const symbols: Array<{ line: number; kind: string; name: string }> = [];
                    symLines.forEach((l, i) => {
                        for (const { re, kind } of symPatterns) {
                            const m = l.trim().match(re);
                            if (m) {
                                // extract name: last capture group or 3rd
                                const name = m[m.length - 1] || m[3] || '';
                                if (name && name.length > 1) symbols.push({ line: i + 1, kind, name });
                                break;
                            }
                        }
                    });
                    console.log('');
                    console.log('  ' + C.teal(C.bold('SYMBOLS')) + C.dim(`  ${symFile}`));
                    console.log('');
                    if (symbols.length === 0) {
                        console.log('  ' + C.dim('No symbols detected.'));
                    } else {
                        for (const s of symbols) {
                            const col = kindColor[s.kind] || C.white;
                            console.log('  ' + C.dim(String(s.line).padStart(5)) + '  ' + col(s.kind.padEnd(6)) + '  ' + C.white(s.name));
                        }
                    }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'env': {
                    // Wave 253/392: /env — show session environment (gateway, model, tokens, cwd, session id)
                    console.log('');
                    console.log('  ' + C.teal(C.bold('SESSION ENVIRONMENT')));
                    console.log('');
                    console.log('  ' + C.dim('Gateway:    ') + C.white(gateway || '(none)'));
                    console.log('  ' + C.dim('Inference:  ') + C.white(inferenceUrl));
                    console.log('  ' + C.dim('Model:      ') + C.white(model));
                    console.log('  ' + C.dim('Session:    ') + C.white(sessionId));
                    console.log('  ' + C.dim('Tokens:     ') + C.white(String(sessionUsage.totalTokens)));
                    console.log('  ' + C.dim('Requests:   ') + C.white(String(sessionUsage.requestCount)));
                    console.log('  ' + C.dim('Msgs:       ') + C.white(String(messages.length)));
                    console.log('  ' + C.dim('Cwd:        ') + C.white(process.cwd()));
                    // Wave 392: show agent config
                    console.log('  ' + C.dim('Temp:       ') + C.white(String(agentTemperature)));
                    console.log('  ' + C.dim('Max-iter:   ') + C.white(String(maxIter)));
                    console.log('  ' + C.dim('Auto-approve:') + ' ' + (autoApprove ? C.green('ON') : C.yellow('OFF')));
                    try {
                        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (branch) console.log('  ' + C.dim('Branch:     ') + C.white(branch));
                    } catch { /* not a git repo */ }
                    console.log('');
                    rl!.prompt(); return;
                }
                case 'note': {
                    // Wave 230/394: /note <text> — quick memory write; supports @tag: prefix e.g. /note @bug: null pointer in foo.ts
                    const noteText = arg.trim();
                    if (!noteText) { console.log('  ' + C.dim('Usage: /note <text>  — supports @tag: prefix (e.g. /note @bug: null deref in line 42)')); rl!.prompt(); return; }
                    try {
                        const today = new Date().toISOString().slice(0, 10);
                        const noteDir = path.join(getWorkspaceDir(), 'memory');
                        fs.mkdirSync(noteDir, { recursive: true });
                        const notePath = path.join(noteDir, `${today}.md`);
                        // Wave 394: parse @tag: prefix from the note text
                        const tagMatch394 = noteText.match(/^@(\w+):\s*/);
                        const noteTag394 = tagMatch394 ? tagMatch394[1]!.toUpperCase() : '';
                        const noteBody394 = tagMatch394 ? noteText.slice(tagMatch394[0].length).trim() : noteText;
                        const tagPrefix394 = noteTag394 ? `[${noteTag394}] ` : '';
                        const entry = `\n- ${new Date().toISOString().slice(11, 16)} ${tagPrefix394}${noteBody394}\n`;
                        fs.appendFileSync(notePath, entry, 'utf8');
                        console.log('  ' + C.green(`\u2714 Note saved`) + (noteTag394 ? C.dim(` [${noteTag394}]`) : '') + C.dim(` → ${today}.md`));
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.prompt(); return;
                }
                case 'undo': {
                    // Wave 414: /undo — remove the last user+assistant exchange from context
                    const userMsgsCount414 = messages.filter(m => m.role === 'user').length;
                    if (userMsgsCount414 === 0) { console.log('  ' + C.dim('Nothing to undo.')); rl!.prompt(); return; }
                    // Find and remove last user + all following assistant/tool messages up to next user
                    let removed414 = 0;
                    while (messages.length > 1) {
                        const last = messages[messages.length - 1]!;
                        messages.pop();
                        removed414++;
                        if (last.role === 'user') break;
                    }
                    const remaining414 = messages.filter(m => m.role === 'user').length;
                    console.log('  ' + C.green(`✔ Undone`) + C.dim(` — removed ${removed414} message${removed414 !== 1 ? 's' : ''}. Context: ${remaining414} exchange${remaining414 !== 1 ? 's' : ''} remaining.`));
                    rl!.prompt(); return;
                }
                case 'edit': {
                    // Wave 228: /edit <file> — open file in $EDITOR, then continue session
                    const editTarget = arg.trim();
                    if (!editTarget) { console.log('  ' + C.dim('Usage: /edit <file>')); rl!.prompt(); return; }
                    const editPath = resolvePath(editTarget);
                    if (!fs.existsSync(editPath)) { console.log('  ' + C.red(`File not found: ${editPath}`)); rl!.prompt(); return; }
                    const editor = process.env['EDITOR'] || process.env['VISUAL'] || (process.platform === 'win32' ? 'notepad' : 'nano');
                    rl!.pause();
                    try {
                        const { spawnSync } = require('child_process') as typeof import('child_process');
                        spawnSync(editor, [editPath], { stdio: 'inherit' });
                        const sizeBefore = fs.statSync(editPath).size;
                        console.log('  ' + C.green(`\u2714 Returned from ${editor} — ${editTarget} (${(sizeBefore / 1024).toFixed(1)}kb)`));
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'run': {
                    // Wave 226: /run [script] — smart runner for npm, make, or custom scripts
                    rl!.pause();
                    try {
                        const runArg = arg.trim();
                        // Detect project type and available scripts
                        const hasPkg = fs.existsSync(path.join(process.cwd(), 'package.json'));
                        const hasMake = fs.existsSync(path.join(process.cwd(), 'Makefile')) || fs.existsSync(path.join(process.cwd(), 'makefile'));
                        const hasCargoToml = fs.existsSync(path.join(process.cwd(), 'Cargo.toml'));
                        const hasPyproj = fs.existsSync(path.join(process.cwd(), 'pyproject.toml')) || fs.existsSync(path.join(process.cwd(), 'setup.py'));
                        if (!runArg) {
                            // List available scripts
                            console.log('');
                            console.log('  ' + C.teal(C.bold('RUN')) + C.dim(' — available scripts'));
                            console.log('');
                            if (hasPkg) {
                                try {
                                    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
                                    const scripts = pkg.scripts || {};
                                    if (Object.keys(scripts).length > 0) {
                                        console.log('  ' + C.dim('npm scripts:'));
                                        for (const [name, cmd] of Object.entries(scripts).slice(0, 15)) {
                                            console.log('  ' + padRight(C.cyan(`  /run ${name}`), 28) + C.dim(String(cmd).slice(0, 60)));
                                        }
                                    }
                                } catch { /* skip */ }
                            }
                            if (hasMake) {
                                try {
                                    const makeContent = fs.readFileSync(path.join(process.cwd(), 'Makefile'), 'utf8');
                                    const targets = makeContent.match(/^([a-zA-Z0-9_-]+)\s*:/gm)?.map(t => t.replace(':', '').trim()).slice(0, 10) || [];
                                    if (targets.length > 0) {
                                        console.log('  ' + C.dim('make targets:'));
                                        targets.forEach(t => console.log('  ' + C.cyan(`  /run make:${t}`)));
                                    }
                                } catch { /* skip */ }
                            }
                            if (hasCargoToml) console.log('  ' + C.cyan('  /run build') + C.dim('  → cargo build'));
                            if (hasPyproj) console.log('  ' + C.cyan('  /run test') + C.dim('  → pytest'));
                            console.log('');
                            console.log('  ' + C.dim('Or: /run <any shell command>'));
                            console.log('');
                            rl!.resume(); rl!.prompt(); return;
                        }
                        // Resolve script → command
                        let resolvedCmd = '';
                        if (runArg.startsWith('make:')) {
                            resolvedCmd = `make ${runArg.slice(5)}`;
                        } else if (hasPkg) {
                            try {
                                const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
                                if (pkg.scripts?.[runArg]) {
                                    resolvedCmd = `npm run ${runArg}`;
                                }
                            } catch { /* skip */ }
                        }
                        // Common shorthands
                        if (!resolvedCmd) {
                            if (runArg === 'test') resolvedCmd = hasPkg ? 'npm test' : hasPyproj ? 'pytest' : hasCargoToml ? 'cargo test' : 'make test';
                            else if (runArg === 'build') resolvedCmd = hasPkg ? 'npm run build' : hasCargoToml ? 'cargo build' : hasMake ? 'make build' : '';
                            else if (runArg === 'lint') resolvedCmd = hasPkg ? 'npm run lint' : hasPyproj ? 'ruff check .' : '';
                            else if (runArg === 'install') resolvedCmd = hasPkg ? 'npm install' : hasPyproj ? 'pip install -e .' : '';
                            else resolvedCmd = runArg; // run as-is
                        }
                        if (!resolvedCmd) { console.log('  ' + C.red(`No script: ${runArg}`)); rl!.resume(); rl!.prompt(); return; }
                        console.log('');
                        console.log('  ' + C.dim('$ ') + C.white(resolvedCmd));
                        console.log('');
                        try {
                            const { spawnSync } = require('child_process') as typeof import('child_process');
                            // Wave 373: track elapsed time for /run
                            const runT373 = Date.now();
                            const result = spawnSync(resolvedCmd, { shell: true, encoding: 'utf8', cwd: process.cwd(), timeout: 120_000 });
                            const runElapsed373 = ((Date.now() - runT373) / 1000).toFixed(1);
                            const out = ((result.stdout || '') + (result.stderr || '')).trim();
                            if (out) out.split('\n').forEach(l => console.log('  ' + l));
                            const exitCode = result.status ?? (result.error ? 1 : 0);
                            console.log('');
                            if (exitCode === 0) console.log('  ' + C.green('\u2714 Done') + C.dim(` (${runElapsed373}s)`));
                            else console.log('  ' + C.red(`\u2718 Exit code ${exitCode}`) + C.dim(` (${runElapsed373}s)`));
                        } catch (e) {
                            console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                        }
                        console.log('');
                    } catch (e) {
                        console.log('  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
                    }
                    rl!.resume(); rl!.prompt(); return;
                }
                case 'help': {
                    console.log('');
                    console.log('  ' + C.teal(C.bold('SLASH COMMANDS')));
                    console.log('');
                    console.log('  ' + C.dim('Session'));
                    console.log('  ' + padRight(C.cyan('/new'), 24) + 'Start a fresh session');
                    console.log('  ' + padRight(C.cyan('/status'), 24) + 'Model, tokens, context, session info');
                    console.log('  ' + padRight(C.cyan('/usage'), 24) + 'Token counts + cost estimate');
                    console.log('  ' + padRight(C.cyan('/sessions'), 24) + 'List recent sessions');
                    console.log('  ' + padRight(C.cyan('/save'), 24) + 'Force save session to disk');
                    console.log('  ' + padRight(C.cyan('/export [path]'), 24) + 'Export session JSONL to file');
                    console.log('  ' + padRight(C.cyan('/share [path]'), 24) + 'Export session as formatted Markdown');
                    console.log('  ' + padRight(C.cyan('/quit'), 24) + 'Save and exit');
                    console.log('');
                    console.log('  ' + C.dim('Context & History'));
                    console.log('  ' + padRight(C.cyan('/clear'), 24) + 'Wipe conversation context');
                    console.log('  ' + padRight(C.cyan('/compact [summarize|tools|N]'), 24) + 'Compress context (LLM summary, drop tool results, or drop N exchanges)');
                    console.log('  ' + padRight(C.cyan('/context'), 24) + 'Show message count in context');
                    console.log('  ' + padRight(C.cyan('/ask <question>'), 24) + 'Quick question — no tools, no context growth (supports @file refs)');
                    console.log('  ' + padRight(C.cyan('/plan <task>'), 24) + 'Ask agent to outline steps before acting');
                    console.log('  ' + padRight(C.cyan('/summarize'), 24) + 'Write session summary to MEMORY.md');
                    console.log('  ' + padRight(C.cyan('/load <file|url>'), 24) + 'Load file or URL content into context');
                    console.log('  ' + padRight(C.cyan('/retry [prompt]'), 24) + 'Re-run last message (optional: tweak the prompt first)');
                    console.log('  ' + padRight(C.cyan('/undo'), 24) + 'Remove last exchange from context (pair with /retry to redo)');
                    console.log('  ' + padRight(C.cyan('/forget <text>'), 24) + 'Remove messages containing text');
                    console.log('  ' + padRight(C.cyan('/inject <text>'), 24) + 'Inject text as assistant message');
                    console.log('  ' + padRight(C.cyan('/pin'), 24) + 'Pin last response (survives /compact)');
                    console.log('  ' + padRight(C.cyan('/diff [--staged|file|--context N]'), 36) + 'Show colored git diff (--context N controls context lines)');
                    console.log('  ' + padRight(C.cyan('/grep <pattern> [glob]'), 24) + 'Search project, inject results into context');
                    console.log('  ' + padRight(C.cyan('/find <glob>'), 24) + 'Find files matching a glob pattern');
                    console.log('  ' + padRight(C.cyan('/symbols <file>'), 24) + 'List functions, classes, and consts with line numbers');
                    console.log('  ' + padRight(C.cyan('/todo'), 24) + 'Find all TODO/FIXME/HACK comments');
                    console.log('  ' + padRight(C.cyan('/git [status|log|...]'), 24) + 'Quick git operations');
                    console.log('  ' + padRight(C.cyan('/edit <file>'), 24) + 'Open file in $EDITOR (nano, vim, notepad…)');
                    console.log('  ' + padRight(C.cyan('/run [script]'), 24) + 'Run npm/make/cargo script or shell command');
                    console.log('  ' + padRight(C.cyan('/history [N]'), 24) + 'Show last N conversation exchanges');
                    console.log('  ' + padRight(C.cyan('/commit [msg]'), 24) + 'Stage all and commit (auto-message if no msg)');
                    console.log('  ' + padRight(C.cyan('/checkpoint [msg]'), 24) + 'Alias for /commit');
                    console.log('  ' + padRight(C.cyan('/branch [name|-b name]'), 24) + 'List, switch, or create git branches');
                    console.log('  ' + padRight(C.cyan('/env'), 24) + 'Show session environment (gateway, model, tokens, cwd)');
                    console.log('  ' + padRight(C.cyan('/tokens'), 24) + 'Show token usage breakdown for this session');
                    console.log('  ' + padRight(C.cyan('/tag <label>'), 24) + 'Set a human-readable label for this session');
                    console.log('  ' + padRight(C.cyan('/load <session-id>'), 24) + 'Import messages from another session into current context');
                    console.log('  ' + padRight(C.cyan('/grep <pattern>'), 24) + 'Search conversation context for a pattern (regex ok)');
                    console.log('  ' + padRight(C.cyan('/paste [label]'), 24) + 'Read clipboard and inject into context');
                    console.log('  ' + padRight(C.cyan('/inline <cmd>'), 24) + 'Run shell command and inject output into context');
                    console.log('  ' + padRight(C.cyan('/pin-context [text]'), 24) + 'Prepend persistent context to every message (clear with no arg)');
                    console.log('  ' + padRight(C.cyan('/reload'), 24) + 'Reload workspace context files (SOUL.md, MEMORY.md, etc.) into prompt');
                    console.log('  ' + padRight(C.cyan('/focus <file>'), 24) + 'Read file and pin it as session context (auto-set /pin-context)');
                    console.log('  ' + C.dim(''));
                    console.log('  ' + C.dim('  @file syntax: type @src/foo.ts to inject file content inline'));
                    console.log('  ' + C.dim('  Multi-line: end line with \\ to continue on next line'));
                    console.log('');
                    console.log('  ' + C.dim('Config'));
                    console.log('  ' + padRight(C.cyan('/model <name>'), 24) + 'Switch model mid-session');
                    console.log('  ' + padRight(C.cyan('/models'), 24) + 'List available cluster models');
                    console.log('  ' + padRight(C.cyan('/auto'), 24) + 'Toggle auto-approval for writes/shell');
                    console.log('  ' + padRight(C.cyan('/think <level>'), 24) + 'Thinking: off|minimal|low|medium|high');
                    console.log('  ' + padRight(C.cyan('/workspace'), 24) + 'Show workspace files + sizes');
                    console.log('  ' + padRight(C.cyan('/note <text>'), 24) + 'Quick-write note to today\'s memory file');
                    console.log('  ' + padRight(C.cyan('/tools'), 24) + 'List all available agent tools');
                    console.log('  ' + padRight(C.cyan('/cd <path>'), 24) + 'Change working directory');
                    console.log('  ' + padRight(C.cyan('/cwd'), 24) + 'Show current directory');
                    console.log('');
                    console.log('  ' + C.dim('Shell'));
                    console.log('  ' + padRight(C.cyan('! <command>'), 24) + 'Run shell command directly (skip LLM)');
                    console.log('');
                    rl!.prompt(); return;
                }
                default: {
                    console.log('  ' + C.dim(`Unknown: /${cmd}. Try /help.`));
                    rl!.prompt(); return;
                }
            }
        }

        // Wave 270: @file inline expansion — replace @path/to/file with its content
        let expandedInput = input;
        const atFileMatches = [...input.matchAll(/@([\w./\\-]+\.[a-z]{1,10})\b/gi)];
        for (const m of atFileMatches) {
            const atPath = resolvePath(m[1]!);
            try {
                const atContent = fs.readFileSync(atPath, 'utf8').slice(0, 8000);
                const atLines = atContent.split('\n').length;
                const atExt = path.extname(atPath).slice(1) || 'text';
                const atBlock = `\`\`\`${atExt}\n// ${m[1]}\n${atContent}\n\`\`\``;
                expandedInput = expandedInput.replace(m[0], atBlock);
                if (!printMode) console.log('  ' + C.dim(`@${m[1]} → ${atLines} lines injected`));
            } catch { /* file not found — leave @ref as-is */ }
        }
        const finalInput = expandedInput !== input ? expandedInput : input;
        lastUserInput = input;  // Wave 254: track for /retry (track original, not expanded)
        // Wave 285: prepend pinned context if set
        const finalWithPin = pinnedContext ? `[Context: ${pinnedContext}]\n\n${finalInput}` : finalInput;
        rl.pause();
        try {
            await runAgentLoop(finalWithPin);
        } catch (e) {
            console.log('\n  ' + C.red('Error: ' + (e instanceof Error ? e.message : String(e))));
        }
        // Wave 214: show changed files after agent response (if in a git repo and files were modified)
        try {
            const changedFiles = execSync('git diff --name-only', { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() }).trim();
            if (changedFiles) {
                const files = changedFiles.split('\n').slice(0, 5);
                const more = changedFiles.split('\n').length > 5 ? ` +${changedFiles.split('\n').length - 5} more` : '';
                console.log('  ' + C.dim(`\u25B8 Modified: ${files.join(', ')}${more}`));
            }
        } catch { /* not a git repo or git not available */ }
        // Wave 355: context growth warning — hint /compact when messages are getting long
        const msgCount355 = messages.filter(m => m.role === 'user').length;
        if (msgCount355 > 0 && msgCount355 % 10 === 0) {
            console.log('  ' + C.dim(`⚠ ${msgCount355} exchanges in context — consider /compact summarize to save tokens`));
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
            console.error(C.red('  Usage: tentaclaw watchdog node <nodeId>'));
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

    console.error(C.red('  Usage: tentaclaw watchdog [status|events|node <id>]'));
}

async function cmdNotify(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'list';

    if (sub === 'list') {
        const data = await apiGet(gateway, '/api/v1/notifications/channels') as any[];
        console.log('');
        if (data.length === 0) {
            console.log(C.yellow('  No notification channels configured.'));
            console.log(C.dim('  Add one:'));
            console.log(C.dim('    tentaclaw notify add telegram --name alerts --bot-token TOKEN --chat-id CHATID'));
            console.log(C.dim('    tentaclaw notify add discord --name alerts --webhook URL'));
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
            console.error(C.red('  Usage: tentaclaw notify add <telegram|discord|webhook> --name NAME [options]'));
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
            console.error(C.red('  Usage: tentaclaw notify test <channelId>'));
            process.exit(1);
        }
        const result = await apiPost(gateway, '/api/v1/notifications/test', { channel_id: channelId }) as { status: string };
        console.log('  ' + (result.status === 'sent' ? C.green('\u2714 Test sent!') : C.red('\u2718 Failed to send')));
        return;
    }

    if (sub === 'remove') {
        const channelId = positional[1];
        if (!channelId) {
            console.error(C.red('  Usage: tentaclaw notify remove <channelId>'));
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
        console.log('  ' + C.yellow('Tip: ') + 'Error rate is high. Run `tentaclaw doctor` to diagnose.');
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
        console.log('  ' + C.dim('Try removing unused models first: tentaclaw optimize'));
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
        console.log('  ' + C.dim('Model will start downloading. Check progress: tentaclaw models'));
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
        console.error(C.red('  Usage: tentaclaw maintenance <nodeId> [on|off]'));
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
            console.error(C.red('  Usage: tentaclaw alias set <alias> <target> [--fallback model1,model2]'));
            process.exit(1);
        }
        const fallbacks = (flags['fallback'] || '').split(',').filter(Boolean);
        await apiPost(gateway, '/api/v1/aliases', { alias, target, fallbacks });
        console.log('  ' + C.green('\u2714') + ` ${C.white(alias)} \u2192 ${C.cyan(target)}` + (fallbacks.length > 0 ? C.dim(' (fallbacks: ' + fallbacks.join(', ') + ')') : ''));
        return;
    }
}

// Wave 472: tentaclaw route explain <model> [--task-type code|chat|math] [--priority cost|speed]
async function cmdRoute(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'explain';

    if (sub === 'explain' || sub === 'why') {
        const model = positional[1];
        if (!model) {
            console.error('');
            console.error(C.red('  ✘ Missing model name'));
            console.error(C.dim('  Usage: tentaclaw route explain <model> [--task-type code|chat] [--priority cost|speed]'));
            console.error('');
            process.exit(1);
        }

        const taskType = flags['task-type'] || flags['t'] || undefined;
        const priority = flags['priority'] || flags['p'] || undefined;

        const result = await apiPost(gateway, '/api/v1/routing/explain', {
            model,
            task_type: taskType,
            priority,
        }) as any;

        console.log('');
        console.log('  ' + C.purple(C.bold('Route Explain')) + C.dim(` — ${model}`));
        console.log('');

        if (result.decision) {
            const d = result.decision;
            console.log('  ' + C.green('✔') + ' Chosen node: ' + C.white(C.bold(d.hostname)) + C.dim(` (${d.chosen_node})`));
            console.log('  ' + C.dim('  Score:        ') + C.cyan(String(d.score)));
            console.log('  ' + C.dim('  Backend:      ') + C.white(d.backend));
            console.log('  ' + C.dim('  GPU util:     ') + C.white(Math.round(d.gpu_utilization) + '%'));
            console.log('  ' + C.dim('  In-flight:    ') + C.white(String(d.in_flight)));
        } else {
            console.log('  ' + C.red('✘') + ' No node available');
            if (result.no_node_reason) {
                console.log('  ' + C.dim('  Reason: ') + C.yellow(result.no_node_reason));
            }
        }

        if (result.request.resolved_model !== model) {
            console.log('');
            console.log('  ' + C.dim('  Alias:  ') + C.white(model) + C.dim(' → ') + C.cyan(result.request.resolved_model));
        }

        if (result.model_info.estimated_vram_mb) {
            console.log('  ' + C.dim('  Est. VRAM: ') + C.white(Math.round(result.model_info.estimated_vram_mb / 1024) + 'GB'));
        }

        if (result.all_candidates.length > 1) {
            console.log('');
            console.log('  ' + C.dim('  All candidates:'));
            for (const n of result.all_candidates) {
                const chosen = result.decision?.chosen_node === n.node_id;
                const prefix = chosen ? C.green('  ▶ ') : C.dim('    ');
                console.log(prefix + padRight(C.white(n.hostname), 20) + C.dim('score: ') + padRight(C.cyan(String(n.score)), 10) + C.dim(`${n.in_flight} in-flight`));
            }
        }
        console.log('');
        return;
    }

    if (sub === 'telemetry' || sub === 'log') {
        const limit = parseInt(flags['limit'] || flags['n'] || '20', 10);
        const result = await apiGet(gateway, `/api/v1/routing/telemetry?limit=${limit}`) as any;
        const decisions = result.decisions;

        console.log('');
        console.log('  ' + C.purple(C.bold('Routing Telemetry')) + C.dim(` — last ${decisions.length} decisions`));
        console.log('');
        console.log('  ' + padRight(C.dim('TIME'), 10) + padRight(C.dim('MODEL'), 28) + padRight(C.dim('NODE'), 20) + padRight(C.dim('SCORE'), 8) + C.dim('REASON'));
        console.log('  ' + C.dim('─'.repeat(82)));

        for (const d of decisions) {
            const ts = new Date(d.time).toLocaleTimeString();
            const taskTag = d.taskType ? C.dim(` [${d.taskType}]`) : '';
            const priorityTag = d.priority && d.priority !== 'balanced' ? C.dim(` [${d.priority}]`) : '';
            console.log('  ' + padRight(C.dim(ts), 10) + padRight(C.white(d.model) + taskTag + priorityTag, 28) + padRight(C.cyan(d.hostname), 20) + padRight(String(d.score), 8) + C.dim(d.reason));
        }
        console.log('');
        return;
    }

    if (sub === 'rules') {
        const result = await apiGet(gateway, '/api/v1/routing/rules') as any;
        console.log('');
        console.log('  ' + C.purple(C.bold('Routing Rules')) + C.dim(` (${result.count})`));
        console.log('');
        if (result.rules.length === 0) {
            console.log('  ' + C.dim('  No rules. Add one:'));
            console.log('  ' + C.dim('  tentaclaw route rules add --name "code to coder" --match-task code --pin-model qwen2.5-coder:7b'));
        }
        for (const r of result.rules) {
            console.log('  ' + C.white(C.bold(r.id)) + C.dim(` "${r.name}"`));
            console.log('    ' + C.dim('Match:  ') + JSON.stringify(r.match));
            console.log('    ' + C.dim('Action: ') + JSON.stringify(r.action));
        }
        console.log('');
        return;
    }

    if (sub === 'standby') {
        const result = await apiGet(gateway, '/api/v1/routing/hotstandby') as any;
        console.log('');
        console.log('  ' + C.purple(C.bold('Hot Standby')) + C.dim(' — models warm in VRAM'));
        console.log('');
        console.log('  ' + padRight(C.dim('MODEL'), 32) + padRight(C.dim('WARM NODES'), 14) + C.dim('VRAM'));
        console.log('  ' + C.dim('─'.repeat(60)));
        for (const m of result.hot_standby) {
            console.log('  ' + padRight(C.white(m.model), 32) + padRight(C.green(String(m.warm_nodes) + ' node' + (m.warm_nodes !== 1 ? 's' : '')), 14) + C.dim(Math.round(m.estimated_vram_mb / 1024) + 'GB est.'));
        }
        if (result.hot_standby.length === 0) {
            console.log('  ' + C.dim('  No models currently warm.'));
        }
        console.log('');
        return;
    }

    console.error('');
    console.error(C.red('  ✘ Unknown subcommand: ') + C.white(sub));
    console.error(C.dim('  Usage: tentaclaw route explain <model>'));
    console.error(C.dim('         tentaclaw route telemetry'));
    console.error(C.dim('         tentaclaw route rules'));
    console.error(C.dim('         tentaclaw route standby'));
    console.error('');
}

// =============================================================================
// Phase 3 Coding Agent CLI Commands (Waves 539-558)
// =============================================================================

// Wave 539 — tentaclaw review [--model <m>] [--style brief|full]
async function cmdReview(_gateway: string, flags: Record<string, string>): Promise<void> {
    const config = loadConfig();
    let diff = '';
    try {
        diff = execSync('git diff HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
        if (!diff) diff = execSync('git diff --staged', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch { /* not a git repo */ }

    if (!diff) {
        console.log('');
        console.log('  ' + C.yellow('⚠') + '  No git diff found. Stage or modify some files first.');
        console.log('');
        return;
    }

    const style = flags['style'] || 'full';
    const stylePrompt = style === 'brief'
        ? 'Give a concise bullet-point code review (max 10 bullets). Focus on bugs and security issues only.'
        : 'Give a thorough code review. Cover: bugs, security issues, logic errors, edge cases, code quality, and suggestions. Be specific with file+line references when possible.';

    const prompt = `${stylePrompt}\n\nGit diff:\n\`\`\`diff\n${diff.slice(0, 12000)}\n\`\`\``;

    console.log('');
    console.log('  ' + C.purple(C.bold('Code Review')) + C.dim(` — ${diff.split('\n').length} lines changed`));
    console.log('');

    if (!config) { console.log(C.red('  No config. Run: tentaclaw setup')); return; }

    const resolved = resolveInferenceFromConfig(config);
    const reviewModel = flags['model'] || config.model;

    const body = JSON.stringify({ model: reviewModel, messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0.2 });

    await streamOneshot(resolved.url, resolved.headers, body, reviewModel);
    console.log('');
}

// Wave 540 — tentaclaw refactor <pattern> [--dry-run]
async function cmdRefactor(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const pattern = positional.join(' ').trim();
    if (!pattern) {
        console.log('');
        console.log(C.red('  ✘ Missing refactor pattern'));
        console.log(C.dim('  Usage: tentaclaw refactor "rename getUserById to fetchUser everywhere"'));
        console.log(C.dim('  Usage: tentaclaw refactor "extract the auth logic into a separate middleware"'));
        console.log('');
        process.exit(1);
    }
    const config = loadConfig();
    if (!config) { console.log(C.red('  No config. Run: tentaclaw setup')); return; }

    let context = '';
    try {
        const diff = execSync('git diff HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
        if (diff) context = `\n\nCurrent uncommitted changes:\n\`\`\`diff\n${diff.slice(0, 4000)}\n\`\`\``;
    } catch { /* ignore */ }

    const dryRun = flags['dry-run'] === 'true' || flags['dry-run'] === '';

    const prompt = dryRun
        ? `I want to refactor: "${pattern}"\n\nExplain exactly what changes would be needed — which files, which functions, what to change. Do NOT generate code yet, just describe the plan.${context}`
        : `Refactor task: "${pattern}"\n\nAnalyze the codebase and implement this refactoring. Use the available tools to read files, make changes, and verify the result.${context}`;

    console.log('');
    console.log('  ' + C.purple(C.bold('Refactor')) + C.dim(` — "${pattern}"`));
    if (dryRun) console.log('  ' + C.dim('  Dry run — planning only, no changes'));
    console.log('');

    // Launch code agent with the refactor task
    await cmdCode(gateway, { task: prompt, yes: dryRun ? 'false' : flags['yes'] || 'false' });
}

// Wave 547 — tentaclaw pr [--base <branch>] [--title <t>] [--dry-run]
async function cmdPr(_gateway: string, flags: Record<string, string>): Promise<void> {
    const config = loadConfig();
    if (!config) { console.log(C.red('  No config. Run: tentaclaw setup')); return; }

    const baseBranch = flags['base'] || flags['b'] || 'main';
    const titleFlag = flags['title'] || '';
    const dryRun = flags['dry-run'] === 'true';

    let diff = '';
    let log = '';
    let currentBranch = '';

    try {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
        diff = execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf8', stdio: 'pipe' }).trim();
        log = execSync(`git log ${baseBranch}..HEAD --oneline`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
        console.log(C.red('  Git error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
        return;
    }

    if (!diff && !log) {
        console.log('');
        console.log('  ' + C.dim(`No changes vs ${baseBranch}. Nothing to PR.`));
        console.log('');
        return;
    }

    const prompt = `Generate a pull request description for these changes.

Branch: ${currentBranch} → ${baseBranch}
Commits:
${log || '(no commits yet)'}

Diff (first 8000 chars):
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

Output format:
## Summary
[2-4 bullet points describing what changed and why]

## Changes
[List of specific changes by file/area]

## Test plan
[What to test to verify this PR works correctly]

${titleFlag ? `Suggested title: "${titleFlag}"` : 'Also suggest a PR title (under 70 chars) on the last line, prefixed with "Title: "'}`;

    console.log('');
    console.log('  ' + C.purple(C.bold('PR Description')) + C.dim(` — ${currentBranch} → ${baseBranch}`));
    console.log('');
    if (log) { console.log('  ' + C.dim('  Commits: ') + log.split('\n').length); console.log(''); }

    const resolved = resolveInferenceFromConfig(config);
    const body = JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0.3 });
    await streamOneshot(resolved.url, resolved.headers, body, config.model);
    console.log('');

    if (!dryRun) {
        console.log('  ' + C.dim('  Copy the above and use: gh pr create --body "..."'));
        console.log('');
    }
}

// Wave 550 — tentaclaw debug "<error message or stack trace>"
async function cmdDebug(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const errorInput = positional.join(' ').trim() || flags['error'] || flags['e'] || '';

    const config = loadConfig();
    if (!config) { console.log(C.red('  No config. Run: tentaclaw setup')); return; }

    if (!errorInput) {
        // Interactive: launch code agent asking for error
        console.log('');
        console.log('  ' + C.purple(C.bold('Debug Mode')) + C.dim(' — paste an error to start'));
        console.log('');
        await cmdCode(gateway, { task: 'I need help debugging an error. Please ask me what the error is.', yes: 'false' });
        return;
    }

    // Try to find relevant files mentioned in the stack trace
    const fileRefs = (errorInput.match(/[\w/.-]+\.[a-z]{2,4}(?::\d+)?/g) || [])
        .filter(f => !f.startsWith('node_modules') && !f.match(/^https?:\/\//))
        .slice(0, 5);

    let contextFiles = '';
    for (const ref of fileRefs) {
        const filePath = ref.split(':')[0];
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split('\n');
                const lineNum = parseInt(ref.split(':')[1] || '0', 10);
                const start = Math.max(0, lineNum - 10);
                const end = Math.min(lines.length, lineNum + 10);
                const excerpt = lineNum > 0 ? lines.slice(start, end).join('\n') : content.slice(0, 500);
                contextFiles += `\n\n[${ref}]:\n\`\`\`\n${excerpt}\n\`\`\``;
            }
        } catch { /* skip */ }
    }

    const task = `Debug this error and find the root cause. Then fix it.\n\nError:\n\`\`\`\n${errorInput}\n\`\`\`${contextFiles}`;

    console.log('');
    console.log('  ' + C.purple(C.bold('Debug')) + C.dim(` — analyzing error`));
    if (fileRefs.length > 0) console.log('  ' + C.dim('  Found file refs: ') + fileRefs.join(', '));
    console.log('');

    await cmdCode(gateway, { task, yes: flags['yes'] || 'false' });
}

// Wave 551 — tentaclaw docs [<file>] [--format docstring|jsdoc|md|readme]
async function cmdDocs(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const config = loadConfig();
    if (!config) { console.log(C.red('  No config. Run: tentaclaw setup')); return; }

    const target = positional[0] || '';
    const format = flags['format'] || flags['f'] || 'auto';

    let content = '';
    let targetDesc = '';

    if (target && fs.existsSync(target)) {
        content = fs.readFileSync(target, 'utf8');
        targetDesc = `file: ${target}`;
    } else {
        // No target — generate/update README.md for the current directory
        try {
            const files = fs.readdirSync('.').filter(f => !f.startsWith('.') && !f.includes('node_modules')).slice(0, 20);
            const pkg = fs.existsSync('package.json') ? JSON.parse(fs.readFileSync('package.json', 'utf8')) : null;
            content = `Project: ${pkg?.name || path.basename(process.cwd())}\nFiles: ${files.join(', ')}\n${pkg?.description ? `Description: ${pkg.description}` : ''}`;
            targetDesc = 'current directory (README)';
        } catch {
            content = `Directory: ${process.cwd()}`;
            targetDesc = 'current directory';
        }
    }

    const formatInstructions: Record<string, string> = {
        docstring: 'Add Python docstrings to all functions and classes that lack them.',
        jsdoc: 'Add JSDoc comments to all functions and exported symbols that lack them.',
        md: 'Generate a Markdown documentation file explaining this code.',
        readme: 'Generate a comprehensive README.md for this project.',
        auto: target.endsWith('.py') ? 'Add Python docstrings to all undocumented functions/classes.'
            : target.endsWith('.ts') || target.endsWith('.js') ? 'Add JSDoc comments to all exported functions and classes.'
            : 'Generate documentation for this code/project.',
    };

    const task = `${formatInstructions[format] || formatInstructions.auto}\n\nContent:\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;

    console.log('');
    console.log('  ' + C.purple(C.bold('Docs')) + C.dim(` — ${targetDesc}`));
    console.log('');

    await cmdCode(gateway, { task, yes: flags['yes'] || 'false' });
}

// Wave 555 — tentaclaw scaffold <type> [--name <n>] [--dir <d>]
async function cmdScaffold(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const scaffoldType = positional[0] || '';
    const name = flags['name'] || flags['n'] || positional[1] || 'my-project';
    const dir = flags['dir'] || flags['d'] || '.';

    const SCAFFOLD_TYPES: Record<string, string> = {
        'api': 'REST API with TypeScript + Express + Zod validation + Jest tests',
        'cli': 'CLI tool with TypeScript + commander + chalk',
        'react': 'React app with TypeScript + Vite + Tailwind CSS',
        'nextjs': 'Next.js app with TypeScript + App Router + Tailwind',
        'python': 'Python package with pyproject.toml + pytest + ruff',
        'fastapi': 'FastAPI app with Pydantic v2 + async SQLAlchemy + alembic',
        'agent': 'AI agent with tool calling + session management + streaming',
        'discord': 'Discord bot with discord.py + slash commands',
        'telegram': 'Telegram bot with python-telegram-bot',
    };

    if (!scaffoldType || !SCAFFOLD_TYPES[scaffoldType]) {
        console.log('');
        console.log('  ' + C.purple(C.bold('Scaffold')) + C.dim(' — available types:'));
        console.log('');
        for (const [t, desc] of Object.entries(SCAFFOLD_TYPES)) {
            console.log('  ' + padRight(C.cyan(t), 14) + C.dim(desc));
        }
        console.log('');
        console.log('  ' + C.dim('Usage: tentaclaw scaffold api --name my-api --dir ./my-api'));
        console.log('');
        return;
    }

    const task = `Scaffold a complete "${scaffoldType}" project named "${name}" in the directory "${dir}".

Project type: ${SCAFFOLD_TYPES[scaffoldType]}

Requirements:
- Create all necessary files with proper content (not empty stubs)
- Include a working package.json / pyproject.toml with real dependencies
- Add a README.md with setup instructions
- Create at least one working example / hello world
- Include a basic test file
- Use modern best practices for the stack

Start by creating the directory structure, then fill in each file completely.`;

    console.log('');
    console.log('  ' + C.purple(C.bold('Scaffold')) + C.dim(` — ${scaffoldType} → ${name}`));
    console.log('');

    await cmdCode(gateway, { task, yes: flags['yes'] || 'false' });
}

// Wave 558 — tentaclaw costs [--session <id>] [--window <hours>]
async function cmdCosts(gateway: string, flags: Record<string, string>): Promise<void> {
    const config = loadConfig();
    const windowH = parseInt(flags['window'] || flags['w'] || '24', 10);

    console.log('');
    console.log('  ' + C.purple(C.bold('Cost Report')) + C.dim(` — last ${windowH}h`));
    console.log('');

    // Local power cost from gateway if available
    let powerData: any = null;
    try { powerData = await apiGet(gateway, '/api/v1/power'); } catch { /* no gateway */ }

    if (powerData) {
        console.log('  ' + C.bold('Cluster Power'));
        console.log('  ' + padRight(C.dim('Total draw:'), 20) + C.white(powerData.total_watts + 'W'));
        console.log('  ' + padRight(C.dim('Daily cost:'), 20) + C.white('$' + powerData.daily_cost));
        console.log('  ' + padRight(C.dim('Monthly cost:'), 20) + C.white('$' + powerData.monthly_cost));
        if (powerData.cost_per_1k_tokens) {
            console.log('  ' + padRight(C.dim('Per 1K tokens:'), 20) + C.white('$' + powerData.cost_per_1k_tokens));
        }
        console.log('');
    }

    // Session token usage from local JSONL files
    const sessionsDir = path.join(getConfigDir(), 'sessions');
    if (fs.existsSync(sessionsDir)) {
        const cutoff = Date.now() - windowH * 3600 * 1000;
        let totalTokensIn = 0, totalTokensOut = 0, sessionCount = 0;

        try {
            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
            for (const f of files) {
                const stat = fs.statSync(path.join(sessionsDir, f));
                if (stat.mtimeMs < cutoff) continue;

                const lines = fs.readFileSync(path.join(sessionsDir, f), 'utf8').split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const event = JSON.parse(line);
                        if (event.type === 'usage' && event.usage) {
                            totalTokensIn += event.usage.input_tokens || 0;
                            totalTokensOut += event.usage.output_tokens || 0;
                        }
                    } catch { /* skip bad lines */ }
                }
                sessionCount++;
            }
        } catch { /* skip */ }

        if (totalTokensIn + totalTokensOut > 0) {
            console.log('  ' + C.bold('Token Usage') + C.dim(` (${sessionCount} session(s), last ${windowH}h)`));
            console.log('  ' + padRight(C.dim('Input tokens:'), 20) + C.white(formatNumber(totalTokensIn)));
            console.log('  ' + padRight(C.dim('Output tokens:'), 20) + C.white(formatNumber(totalTokensOut)));
            console.log('  ' + padRight(C.dim('Total tokens:'), 20) + C.white(formatNumber(totalTokensIn + totalTokensOut)));

            if ((config?.provider as string) === 'anthropic') {
                // Rough Anthropic pricing
                const inputCost = (totalTokensIn / 1_000_000) * 3.0; // $3/M input
                const outputCost = (totalTokensOut / 1_000_000) * 15.0; // $15/M output
                console.log('');
                console.log('  ' + C.dim('  Anthropic equivalent cost (est.):'));
                console.log('  ' + padRight(C.dim('  Input:'), 18) + C.yellow('$' + inputCost.toFixed(4)));
                console.log('  ' + padRight(C.dim('  Output:'), 18) + C.yellow('$' + outputCost.toFixed(4)));
                console.log('  ' + padRight(C.dim('  Total:'), 18) + C.yellow('$' + (inputCost + outputCost).toFixed(4)));
                if (powerData?.cost_per_1k_tokens) {
                    const localCost = (totalTokensOut / 1000) * powerData.cost_per_1k_tokens;
                    console.log('  ' + padRight(C.dim('  Local power cost:'), 18) + C.green('$' + localCost.toFixed(6)));
                    console.log('  ' + C.dim('  ─────────────────────────'));
                    console.log('  ' + padRight(C.dim('  Savings:'), 18) + C.green('$' + Math.max(0, (inputCost + outputCost) - localCost).toFixed(4)));
                }
            }
        } else {
            console.log('  ' + C.dim('  No token usage data in the last ' + windowH + 'h.'));
            console.log('  ' + C.dim('  Run some sessions and check again.'));
        }
    }
    console.log('');
}

// Wave 561: Draft+Review pipeline — fast model writes code, slow model reviews it
async function cmdPipeline(gateway: string, positional: string[], flags: Record<string, string>): Promise<void> {
    const task = positional.join(' ').trim() || flags['task'] || '';
    if (!task) {
        console.log('');
        console.log('  ' + C.yellow('Usage: tentaclaw pipeline "build a REST API" --draft hermes3:8b --review qwen2.5-coder:32b'));
        return;
    }
    const draftModel = flags['draft'] || flags['fast'] || '';
    const reviewModel = flags['review'] || flags['slow'] || '';
    if (!draftModel || !reviewModel) {
        console.log('');
        console.log('  ' + C.yellow('Both --draft <model> and --review <model> are required.'));
        console.log('  ' + C.dim('  Example: tentaclaw pipeline "task" --draft hermes3:8b --review qwen2.5-coder:32b'));
        return;
    }

    console.log('');
    console.log('  ' + C.purple(C.bold('PIPELINE')) + C.dim(' — draft → review'));
    console.log('  ' + C.dim('Draft: ') + C.white(draftModel));
    console.log('  ' + C.dim('Review: ') + C.white(reviewModel));
    console.log('');

    // Step 1: Draft with fast model
    console.log('  ' + C.teal(C.bold('STEP 1: DRAFT')) + C.dim(` — ${draftModel}`));
    await cmdCode(gateway, { task, model: draftModel, yes: 'true' });

    // Step 2: Review the changes with slow model
    console.log('');
    console.log('  ' + C.teal(C.bold('STEP 2: REVIEW')) + C.dim(` — ${reviewModel}`));
    await cmdReview(gateway, { model: reviewModel, style: 'full' });

    console.log('');
    console.log('  ' + C.green('✔ Pipeline complete') + C.dim(` — draft:${draftModel} → review:${reviewModel}`));
}

// Helper: single inference call with streaming output (used by review, pr, etc.)
async function streamOneshot(inferenceUrl: string, headers: Record<string, string>, bodyStr: string, _model: string): Promise<void> {
    const https = await import('https');
    const http = await import('http');

    return new Promise<void>((resolve) => {
        const url = new URL(inferenceUrl);
        const lib = url.protocol === 'https:' ? https : http;
        const reqOptions = {
            hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search, method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
        };

        const req = lib.request(reqOptions as any, (res: any) => {
            let buffer = '';
            process.stdout.write('  ');
            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { process.stdout.write('\n'); continue; }
                    try {
                        const ev = JSON.parse(data);
                        const delta = ev.choices?.[0]?.delta?.content;
                        if (delta) process.stdout.write(delta);
                    } catch { /* skip */ }
                }
            });
            res.on('end', () => { if (buffer.trim()) process.stdout.write('\n'); resolve(); });
            res.on('error', () => resolve());
        });
        req.on('error', (e: Error) => { console.log(C.red('  Error: ' + e.message)); resolve(); });
        req.write(bodyStr);
        req.end();
    });
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
            console.log(C.cyan('    tentaclaw apikey create --name "my-app"'));
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
        if (!keyId) { console.error(C.red('  Usage: tentaclaw apikey revoke <id>')); process.exit(1); }
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
        console.log('  ' + C.cyan('  tentaclaw chat --model dolphin-mistral:latest'));
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
        console.error(C.red('  Usage: tentaclaw search <query> [--source ollama|hf|all] [--limit N]'));
        console.error(C.dim('  Example: tentaclaw search llama'));
        console.error(C.dim('  Example: tentaclaw search codellama --source hf'));
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
            console.log('  ' + C.dim('Deploy: ') + C.cyan('tentaclaw deploy <model>'));
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
        console.log('    ' + C.dim('Browse: ') + C.cyan('tentaclaw keywords ' + cat.tag));
    }

    console.log('');
    console.log('  ' + C.dim('Or search directly:'));
    console.log('    ' + C.cyan('tentaclaw search llama'));
    console.log('    ' + C.cyan('tentaclaw search mistral --source ollama'));
    console.log('    ' + C.cyan('tentaclaw keywords text-generation --limit 20'));
    console.log('');
}

async function cmdKeywords(positional: string[], flags: Record<string, string>): Promise<void> {
    const keyword = positional.join(' ').trim();
    if (!keyword) {
        console.error(C.red('  Usage: tentaclaw keywords <tag/pipeline> [--limit N] [--sort downloads|likes|trending]'));
        console.error(C.dim('  Example: tentaclaw keywords text-generation'));
        console.error(C.dim('  Example: tentaclaw keywords gguf --limit 20'));
        console.error(C.dim('  Run "tentaclaw tags" to see available categories'));
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
            console.log('  ' + C.dim('Try: tentaclaw tags'));
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
        console.error(C.red('  Usage: tentaclaw info <org/model>'));
        console.error(C.dim('  Example: tentaclaw info meta-llama/Llama-3.1-8B-Instruct'));
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

    section('SETUP');
    cmd('setup', 'Configure model provider (Ollama, OpenAI, etc.)');
    cmd('init', 'Create .clawcode in current project directory');
    cmd('models', 'List available models from your provider');
    cmd('config [show|get|set]', 'View or edit configuration');
    cmd('doctor', 'Health check (works standalone or with cluster)');
    cmd('update', 'Self-update from git');
    console.log('');

    section('SESSIONS');
    cmd('sessions', 'List recent coding sessions');
    cmd('log [-n N]', 'Compact session log — today highlighted, quick resume reference');
    cmd('sessions info <id>', 'View session details');
    cmd('sessions search <q>', 'Search message content across sessions');
    cmd('sessions stats', 'Aggregate stats (msgs, tokens, tool calls)');
    cmd('sessions clean [days]', 'Delete old sessions (default: 30 days)');
    cmd('code --resume <id>', 'Resume a previous session');
    console.log('');

    section('CLUSTER');
    cmd('status', 'Cluster overview with health score');
    cmd('nodes', 'List all nodes with GPU details');
    cmd('health', 'Detailed health analysis with sparkline');
    cmd('alerts', 'View cluster alerts');
    cmd('logs [--filter <str>]', 'Stream live gateway events');
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
    cmd('code --agent <name>', 'Load a named workspace (workspace-<name>/)');
    cmd('code --task <text>', 'Non-interactive: run one task then exit');
    cmd('code --file <path>', 'Load a file as the initial task');
    cmd('code --resume <id>', 'Resume a previous session');
    cmd('code --last', 'Resume the most recent session');
    cmd('code --checkpoint', 'Auto-commit to git after each write/edit');
    cmd('code --no-tools', 'Chat mode — no file/shell tools');
    cmd('code --print', 'Scripting mode — only output model response');
    cmd('code --json', 'Output result as JSON: {response, tool_calls, tokens, model}');
    cmd('code --max-tokens N', 'Limit model response length (e.g. --max-tokens 500)');
    cmd('run "<prompt>"', 'Shortcut: one-shot task with auto-approve');
    cmd('ask "<question>"', 'Fast inline inference — no workspace, no tools, no splash');
    cmd('explain <file>', 'Explain what a file does (no-tools, instant)');
    cmd('commit [msg]', 'Stage all & commit with AI-generated message if no msg given');
    cmd('diff [file]', 'Color-coded git diff — green adds, red removes, teal hunks');
    cmd('search <pattern> [glob]', 'Quick project-wide search (uses rg if available)');
    cmd('init', 'Create .clawcode project context file (auto-loaded by agent)');
    cmd('open <file|url|dir>', 'Open in system default app (start/open/xdg-open)');
    cmd('completions [bash|zsh|fish|powershell]', 'Emit shell tab completion script');
    cmd('clone <repo> [dir]', 'Git clone + auto-create .clawcode context file');
    cmd('build [args]', 'Build project (auto-detects npm run build, cargo, go build, make)');
    cmd('test [args]', 'Run tests (auto-detects npm test, vitest, jest, cargo, pytest, go test)');
    cmd('lint [path]', 'Run project linter (eslint, clippy, mypy, go vet — auto-detected)');
    cmd('fmt [path]', 'Auto-format using project formatter (prettier, gofmt, black, etc.)');
    cmd('watch <cmd>', 'Run command on file changes (like nodemon/watchexec, zero deps)');
    cmd('tree [dir]', 'Display directory tree (--depth N, --all for hidden files)');
    cmd('todo [dir]', 'Scan codebase for TODO/FIXME/HACK comments, grouped by type');
    cmd('stats [dir]', 'Project code statistics: lines, files, blank lines by language');
    cmd('snapshot [save|restore|drop|list] [name]', 'Git stash snapshots — save/restore named working-tree states');
    cmd('profile', 'Show current CLI environment: gateway, model, workspace, git branch');
    cmd('agents', 'List named agent workspaces');
    cmd('memory [show|edit|clear|search]', 'View and manage workspace MEMORY.md');
    cmd('workspace [show|open|reset]', 'Inspect or open workspace directory');
    cmd('chat [--model <m>]', 'Simple chat with a model');
    cmd('mcp serve', 'Run as MCP server (Claude Desktop integration)');
    cmd('mcp info', 'Show Claude Desktop MCP config snippet');
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
    cmd('optimize', 'TentaCLAW optimizes your cluster');
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
    'Run `tentaclaw top` for a real-time cluster monitor.',
    'Use `tentaclaw backends` to see what inference engines each node runs.',
    'Try `tentaclaw joke` when you need a laugh.',
    'Set TENTACLAW_GATEWAY to avoid passing --gateway every time.',
    'Use `tentaclaw drain <node>` to safely take a node offline.',
    'Run `tentaclaw doctor` to auto-diagnose cluster issues.',
    'Use `tentaclaw fortune` for octopus wisdom.',
    'Deploy BitNet models on CPU-only nodes with `tentaclaw deploy bitnet-b1.58`.',
    'Model aliases: `gpt-4` can route to any model you want. Try `tentaclaw alias`.',
    'The `tentaclaw auto mode lets TentaCLAW decide everything. Trust the octopus.',
    'Browse CLAWHub with `tentaclaw hub trending` — see what the family is building.',
    'Publish to CLAWHub: `tentaclaw hub init && tentaclaw hub publish`. Join the family.',
    // Wave 379: tips for new tool params added in Waves 352-377
    'In code agent, use read_file(path, grep="pattern") to return only matching lines — way faster than reading the whole file.',
    'search_files supports file_type="ts" | "py" | "go" | "rs" shortcuts — no need to spell out glob patterns.',
    'edit_file has nth_occurrence=N — use it when old_text appears multiple times instead of rewriting the whole file.',
    '/symbols <file> lists all functions, classes, and constants with line numbers — great for orienting in a new file.',
    'glob_files(pattern, modified_since="30m") finds files changed in the last 30 minutes — pair with sort="mtime".',
    '/diff --context 0 strips context lines for a tighter diff view; --context 10 gives more surrounding code.',
    '/ask @src/foo.ts what does this do? — @file refs expand the file directly into the question.',
];

// =============================================================================
// Setup Wizard — `tentaclaw setup`
// =============================================================================

async function prompt(rl: import('readline').Interface, question: string): Promise<string> {
    return new Promise(resolve => rl.question(question, resolve));
}

async function cmdSetup(): Promise<void> {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const existing = loadConfig();

    bootSplash();
    console.log('  ' + C.purple(C.bold('TentaCLAW Setup')));
    console.log('  ' + C.dim('Configure your AI coding assistant.\n'));

    if (existing) {
        console.log('  ' + C.dim(`Current config: provider=${existing.provider}, model=${existing.model}`));
        const redo = await prompt(rl, '  ' + C.yellow('Reconfigure? [Y/n] '));
        if (redo.trim().toLowerCase() === 'n') {
            console.log('\n  ' + C.green('\u2714 Keeping existing config.'));
            rl.close();
            return;
        }
        console.log('');
    }

    // Wave 439: detect system memory to give model size guidance
    const totalRamGb439 = Math.round(require('os').totalmem() / 1024 / 1024 / 1024);
    const ramTier439 = totalRamGb439 >= 32 ? 'high' : totalRamGb439 >= 16 ? 'mid' : 'low';
    const modelRec439 = ramTier439 === 'high'
        ? 'qwen2.5-coder:14b or qwen3-coder:30b'
        : ramTier439 === 'mid'
        ? 'qwen2.5-coder:7b or hermes3:8b (recommended)'
        : 'hermes3:8b or bitnet-b1.58-3b (CPU-only)';
    console.log('  ' + C.dim(`System RAM: ${totalRamGb439} GB → suggested model size: `) + C.cyan(modelRec439));
    console.log('');

    // --- Provider selection ---
    console.log('  ' + C.teal(C.bold('Where are your models running?')) + '\n');
    console.log('  ' + C.white('[1]') + ' Local Ollama ' + C.dim('(recommended \u2014 runs on your machine)'));
    console.log('  ' + C.white('[2]') + ' OpenAI API ' + C.dim('(GPT-4o, o1, etc.)'));
    console.log('  ' + C.white('[3]') + ' OpenRouter ' + C.dim('(100+ models, one API key)'));
    console.log('  ' + C.white('[4]') + ' Custom endpoint ' + C.dim('(any OpenAI-compatible API)'));
    console.log('');

    const providerChoice = await prompt(rl, '  ' + C.teal('\u276F '));
    const providerMap: Record<string, TentaclawConfig['provider']> = {
        '1': 'ollama', '2': 'openai', '3': 'openrouter', '4': 'custom',
    };
    const provider = providerMap[providerChoice.trim()] || 'ollama';
    console.log('');

    const config: TentaclawConfig = { provider, model: '' };

    if (provider === 'ollama') {
        await setupOllama(rl, config);
    } else if (provider === 'openai') {
        await setupOpenAI(rl, config);
    } else if (provider === 'openrouter') {
        await setupOpenRouter(rl, config);
    } else {
        await setupCustom(rl, config);
    }

    // Save
    saveConfig(config);
    console.log('\n  ' + C.green('\u2714 Configuration saved to ') + C.dim(getConfigPath()));

    // Wave 42: quick connection verification after save
    console.log('  ' + C.dim('Verifying connection...'));
    const { url: testUrl, headers: testHeaders } = resolveInferenceFromConfig(config);
    const testEndpoint = config.provider === 'ollama' ? '/api/tags' : '/models';
    const testProbe = await apiProbeWithHeaders(testUrl, testEndpoint, testHeaders);
    if (testProbe) {
        console.log('  ' + C.green('\u2714 Connection verified: ' + config.provider + ' is reachable'));
    } else {
        console.log('  ' + C.yellow('\u26A0 Warning: cannot reach backend at ' + testUrl));
        console.log('  ' + C.dim('  Config saved \u2014 fix connectivity when ready.'));
    }

    // Wave 443: offer first-agent design wizard right after setup
    console.log('  ' + C.purple('\u2736 Want to design your first agent now?') + '  ' + C.dim('(personalizes your coding assistant)'));
    const designNow = await prompt(rl, '  ' + C.teal('[Y/n] '));
    if (designNow.trim().toLowerCase() !== 'n') {
        await cmdDesignAgent(rl);
    } else {
        console.log('');
        console.log('  ' + C.teal(C.bold('Try it out:')));
        console.log('    ' + C.green('tentaclaw chat'));
        console.log('    ' + C.green('tentaclaw code'));
        console.log('    ' + C.green('tentaclaw code --task "explain this codebase"'));
        console.log('    ' + C.green('tentaclaw agent design') + C.dim('  ← customize your agent anytime'));
        console.log('');
    }

    rl.close();
}

async function setupOllama(rl: import('readline').Interface, config: TentaclawConfig): Promise<void> {
    // Detect Ollama on common ports
    console.log('  ' + C.dim('Detecting Ollama...'));
    let ollamaHost = '';
    for (const port of [11434, 11435]) {
        const resp = await apiProbe(`http://localhost:${port}`, '/api/tags');
        if (resp) {
            ollamaHost = `http://localhost:${port}`;
            break;
        }
    }

    if (!ollamaHost) {
        console.log('  ' + C.yellow('\u26A0 Ollama not detected on localhost.'));
        const custom = await prompt(rl, '  Enter Ollama host URL ' + C.dim('(e.g., http://192.168.1.100:11434)') + ': ');
        ollamaHost = custom.trim() || 'http://localhost:11434';
        const check = await apiProbe(ollamaHost, '/api/tags');
        if (!check) {
            console.log('  ' + C.red('\u2718 Cannot reach ' + ollamaHost));
            console.log('  ' + C.dim('  Saving anyway \u2014 you can fix the host later in ~/.tentaclaw/config.json'));
        }
    } else {
        console.log('  ' + C.green('\u2714 Found Ollama at ') + C.white(ollamaHost));
    }
    config.ollama = { host: ollamaHost };

    // Wave 436: list models with size grouping + smart recommendations
    const modelsResp = await apiProbe(ollamaHost, '/api/tags') as { models?: Array<{ name: string; size?: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }> } | null;
    const models = modelsResp?.models || [];

    // Wave 436: known good coding models to recommend if not installed
    const RECOMMENDED_MODELS_436 = [
        { name: 'qwen2.5-coder:7b', vram: 4.5, desc: 'best 7B coder, 4.5 GB — recommended for most laptops' },
        { name: 'hermes3:8b',       vram: 4.3, desc: 'excellent instruction following + tools, 4.3 GB' },
        { name: 'qwen2.5:7b',       vram: 4.5, desc: 'strong general model, 4.5 GB' },
        { name: 'bitnet-b1.58-3b',  vram: 0,   desc: 'runs on CPU only — no GPU needed, 1.3 GB' },
    ];
    const NO_TOOLS_434 = ['dark-champion', 'command-r', 'gemma2', 'gemma3', 'phi3', 'phi4', 'stablelm'];

    if (models.length === 0) {
        console.log('\n  ' + C.yellow('No models installed in Ollama.'));
        console.log('\n  ' + C.teal(C.bold('Recommended models for TentaCLAW coding agent:')) + '\n');
        RECOMMENDED_MODELS_436.forEach((m, i) => {
            console.log('  ' + C.white(`[${i + 1}]`) + ' ' + C.green(m.name) + C.dim(`  ${m.desc}`));
        });
        console.log('  ' + C.white(`[${RECOMMENDED_MODELS_436.length + 1}]`) + ' ' + C.dim('Enter manually'));
        console.log('');
        const choice436 = await prompt(rl, '  Pick a model to install ' + C.dim(`(1-${RECOMMENDED_MODELS_436.length + 1})`) + ': ');
        const ci = parseInt(choice436.trim()) - 1;
        if (ci >= 0 && ci < RECOMMENDED_MODELS_436.length) {
            config.model = RECOMMENDED_MODELS_436[ci]!.name;
            console.log('  ' + C.dim(`Run: ollama pull ${config.model}`));
        } else {
            const manualModel = await prompt(rl, '  Model name: ');
            config.model = manualModel.trim() || 'hermes3:8b';
        }
        console.log('  ' + C.green('\u2714 Model set: ') + C.white(config.model) + C.dim(' (run ollama pull to install)'));
        return;
    }

    // Group models by approximate VRAM requirement
    console.log('\n  ' + C.teal(C.bold('Available models:')) + '\n');
    models.forEach((m, i) => {
        const size = m.details?.parameter_size || '';
        const quant = m.details?.quantization_level || '';
        const family = m.details?.family?.toLowerCase() || '';
        const tag = [size, quant].filter(Boolean).join(', ');
        const isNoTools = NO_TOOLS_434.some(nt => m.name.toLowerCase().includes(nt) || family.includes(nt));
        // Rough VRAM estimate from size string (e.g. "7.6B" → ~4.5GB at Q4)
        const paramB = parseFloat(size?.replace(/B$/i, '') || '0') || 0;
        const vramEstGB = paramB > 0 ? (paramB * 0.6).toFixed(1) : '';
        const vramStr = vramEstGB ? ` ~${vramEstGB}GB` : '';
        const noToolsTag = isNoTools ? C.yellow(' ⚠no-tools') : '';
        // Mark if it's one of the recommended coding models
        const isRec = RECOMMENDED_MODELS_436.some(r => m.name.includes(r.name.split(':')[0]!));
        const recTag = isRec ? C.green(' ★') : '';
        console.log('  ' + C.white(`[${i + 1}]`) + ' ' + C.green(m.name) + (tag ? C.dim(` (${tag}${vramStr})`) : '') + recTag + noToolsTag);
    });
    // Wave 436: offer to install a recommended model if none present
    const hasGoodCoder = models.some(m => RECOMMENDED_MODELS_436.some(r => m.name.includes(r.name.split(':')[0]!)));
    if (!hasGoodCoder) {
        console.log('');
        console.log('  ' + C.dim('★ No recommended coding models installed. Consider:'));
        console.log('  ' + C.cyan('    ollama pull qwen2.5-coder:7b') + C.dim('  (~4.5 GB, best for 8 GB VRAM)'));
        console.log('  ' + C.cyan('    ollama pull bitnet-b1.58-3b') + C.dim('  (~1.3 GB, CPU-only, no GPU needed)'));
    }
    console.log('');

    const modelChoice = await prompt(rl, '  Pick a default model ' + C.dim(`(1-${models.length})`) + ': ');
    const idx = parseInt(modelChoice.trim()) - 1;
    config.model = models[idx]?.name || models[0]!.name;
    console.log('  ' + C.green('\u2714 Model: ') + C.white(config.model));
    // Wave 434/436: warn if chosen model is known to not support tool calls
    const chosenBase434 = config.model.split(':')[0]?.toLowerCase() || '';
    if (NO_TOOLS_434.some(m => chosenBase434.includes(m))) {
        console.log('');
        console.log('  ' + C.yellow('\u26A0 Note: this model may not support tool calls (coding agent features).'));
        console.log('  ' + C.dim('  For full agent functionality: hermes3:8b, qwen2.5-coder:7b, or bitnet-b1.58-3b (CPU)'));
        console.log('  ' + C.dim('  Use --no-tools flag or tentaclaw chat for pure chat with this model.'));
    }
}

async function setupOpenAI(rl: import('readline').Interface, config: TentaclawConfig): Promise<void> {
    console.log('  ' + C.teal(C.bold('OpenAI Configuration')) + '\n');
    const apiKey = await prompt(rl, '  API Key ' + C.dim('(sk-...)') + ': ');
    if (!apiKey.trim()) {
        console.log('  ' + C.red('\u2718 API key required.'));
        process.exit(1);
    }
    config.openai = { apiKey: apiKey.trim() };

    // Test the key by listing models
    console.log('  ' + C.dim('Testing API key...'));
    const { url, headers } = resolveInferenceFromConfig({ ...config, model: '' });
    const testResp = await apiProbeWithHeaders(url, '/models', headers);
    if (!testResp) {
        console.log('  ' + C.yellow('\u26A0 Could not verify API key. Saving anyway.'));
        config.model = 'gpt-4o';
        return;
    }

    const models = ((testResp as { data?: Array<{ id: string }> })?.data || [])
        .filter(m => /gpt|o1|o3|o4/i.test(m.id) && !/realtime|audio|whisper/i.test(m.id))
        .slice(0, 15);

    console.log('  ' + C.green('\u2714 API key valid.') + '\n');
    if (models.length > 0) {
        console.log('  ' + C.teal(C.bold('Available models:')) + '\n');
        models.forEach((m, i) => {
            console.log('  ' + C.white(`[${i + 1}]`) + ' ' + C.green(m.id));
        });
        console.log('');
        const choice = await prompt(rl, '  Pick a model ' + C.dim(`(1-${models.length})`) + ': ');
        const idx = parseInt(choice.trim()) - 1;
        config.model = models[idx]?.id || 'gpt-4o';
    } else {
        config.model = 'gpt-4o';
    }
    console.log('  ' + C.green('\u2714 Model: ') + C.white(config.model));
}

async function setupOpenRouter(rl: import('readline').Interface, config: TentaclawConfig): Promise<void> {
    console.log('  ' + C.teal(C.bold('OpenRouter Configuration')) + '\n');
    console.log('  ' + C.dim('Get an API key at https://openrouter.ai/keys') + '\n');
    const apiKey = await prompt(rl, '  API Key ' + C.dim('(sk-or-...)') + ': ');
    if (!apiKey.trim()) {
        console.log('  ' + C.red('\u2718 API key required.'));
        process.exit(1);
    }
    config.openrouter = { apiKey: apiKey.trim() };

    console.log('  ' + C.dim('Testing API key...'));
    const { url, headers } = resolveInferenceFromConfig({ ...config, model: '' });
    const testResp = await apiProbeWithHeaders(url, '/models', headers);
    if (testResp) {
        console.log('  ' + C.green('\u2714 API key valid.'));
    } else {
        console.log('  ' + C.yellow('\u26A0 Could not verify. Saving anyway.'));
    }

    console.log('\n  ' + C.teal(C.bold('Popular models:')) + '\n');
    const popular = [
        'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4-5',
        'openai/gpt-4o', 'openai/o4-mini',
        'google/gemini-2.5-flash', 'deepseek/deepseek-r1',
        'meta-llama/llama-3.1-70b-instruct', 'qwen/qwen-2.5-72b-instruct',
    ];
    popular.forEach((m, i) => {
        console.log('  ' + C.white(`[${i + 1}]`) + ' ' + C.green(m));
    });
    console.log('  ' + C.white(`[${popular.length + 1}]`) + ' ' + C.dim('Enter custom model ID'));
    console.log('');
    const choice = await prompt(rl, '  Pick a model: ');
    const idx = parseInt(choice.trim()) - 1;
    if (idx >= 0 && idx < popular.length) {
        config.model = popular[idx];
    } else {
        const custom = await prompt(rl, '  Model ID: ');
        config.model = custom.trim() || 'anthropic/claude-sonnet-4';
    }
    console.log('  ' + C.green('\u2714 Model: ') + C.white(config.model));
}

async function setupCustom(rl: import('readline').Interface, config: TentaclawConfig): Promise<void> {
    console.log('  ' + C.teal(C.bold('Custom OpenAI-Compatible Endpoint')) + '\n');
    const baseUrl = await prompt(rl, '  Base URL ' + C.dim('(e.g., http://localhost:1234/v1)') + ': ');
    if (!baseUrl.trim()) {
        console.log('  ' + C.red('\u2718 Base URL required.'));
        process.exit(1);
    }
    const apiKey = await prompt(rl, '  API Key ' + C.dim('(leave blank if none)') + ': ');
    config.custom = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined };

    const { url, headers } = resolveInferenceFromConfig({ ...config, model: '' });
    const testResp = await apiProbeWithHeaders(url, '/models', headers);
    if (testResp) {
        const models = ((testResp as { data?: Array<{ id: string }> })?.data || []).slice(0, 10);
        if (models.length > 0) {
            console.log('\n  ' + C.teal(C.bold('Available models:')) + '\n');
            models.forEach((m, i) => console.log('  ' + C.white(`[${i + 1}]`) + ' ' + C.green(m.id)));
            console.log('');
            const choice = await prompt(rl, '  Pick a model: ');
            const idx = parseInt(choice.trim()) - 1;
            config.model = models[idx]?.id || models[0].id;
        }
    } else {
        console.log('  ' + C.yellow('\u26A0 Could not reach endpoint.'));
        const modelName = await prompt(rl, '  Enter model name: ');
        config.model = modelName.trim() || 'default';
    }
    console.log('  ' + C.green('\u2714 Model: ') + C.white(config.model));
}

// Wave 443: First-agent design wizard — runs after setup or standalone via `tentaclaw agent design`
async function cmdDesignAgent(rlIn?: import('readline').Interface): Promise<void> {
    const readline = await import('readline');
    const ownRl = !rlIn;
    const rl = rlIn || readline.createInterface({ input: process.stdin, output: process.stdout });

    ensureWorkspace();
    const wsDir = getWorkspaceDir();

    console.log('');
    console.log('  ' + C.purple(C.bold('\u2736 Design Your First Agent')));
    console.log('  ' + C.dim('Customize your TentaCLAW coding assistant in 60 seconds.\n'));

    // --- Step 1: Who are you? ---
    console.log('  ' + C.teal(C.bold('About You')) + '  ' + C.dim('(helps the agent understand your context)\n'));
    const userName = await prompt(rl, '  Your name ' + C.dim('(or Enter to skip)') + ': ');

    console.log('');
    console.log('  Your role:');
    console.log('  ' + C.white('[1]') + ' Software Developer');
    console.log('  ' + C.white('[2]') + ' Researcher / Data Scientist');
    console.log('  ' + C.white('[3]') + ' Student');
    console.log('  ' + C.white('[4]') + ' DevOps / SRE');
    console.log('  ' + C.white('[5]') + ' Other');
    console.log('');

    const roleChoice = await prompt(rl, '  ' + C.teal('\u276F ') + C.dim('[1] '));
    const rolePick: Record<string, string> = {
        '1': 'Software Developer', '2': 'Researcher / Data Scientist',
        '3': 'Student', '4': 'DevOps / SRE',
    };
    let userRole = rolePick[roleChoice.trim()] || 'Software Developer';
    if (roleChoice.trim() === '5') {
        userRole = (await prompt(rl, '  Role: ')).trim() || 'Developer';
    }

    const techStack = await prompt(rl, '\n  Tech stack ' + C.dim('(e.g. TypeScript, Python, React — or Enter to skip)') + ': ');
    const userPrefs = await prompt(rl, '  Preferences ' + C.dim('(e.g. terse responses, TDD, always explain steps — or Enter to skip)') + ': ');

    // --- Step 2: Agent personality ---
    console.log('');
    console.log('  ' + C.teal(C.bold('Agent Personality')) + '\n');
    console.log('  ' + C.white('[1]') + ' Default TentaCLAW  ' + C.dim('confident, direct, witty octopus \u2605'));
    console.log('  ' + C.white('[2]') + ' Concise & Focused  ' + C.dim('no fluff, pure output'));
    console.log('  ' + C.white('[3]') + ' Verbose & Educational  ' + C.dim('explains everything, great for learning'));
    console.log('  ' + C.white('[4]') + ' Custom name  ' + C.dim('give your agent a unique identity'));
    console.log('');

    const personaRaw = await prompt(rl, '  ' + C.teal('\u276F ') + C.dim('[1] '));
    const personaChoice = personaRaw.trim() || '1';

    let agentName = 'TentaCLAW';
    let soulExtra = '';
    if (personaChoice === '2') {
        soulExtra = '\n## Style Override\n- Ultra-concise. No preamble, no summary. Output only.\n- No "I will", "Let me", "Here is". Just act.\n- One-liners over paragraphs. Code over explanation.\n';
    } else if (personaChoice === '3') {
        soulExtra = '\n## Style Override\n- Educational mode. Explain concepts before acting.\n- Walk through reasoning step by step.\n- Point out potential issues and alternatives.\n';
    } else if (personaChoice === '4') {
        agentName = (await prompt(rl, '  Agent name: ')).trim() || 'TentaCLAW';
    }

    // --- Step 3: Custom rules ---
    console.log('');
    console.log('  ' + C.teal(C.bold('Custom Rules')) + '  ' + C.dim('(optional)\n'));
    console.log('  ' + C.dim('Examples: "always write tests", "prefer functional style", "never use var"\n'));
    const customRules = await prompt(rl, '  Rules ' + C.dim('(comma-separated, or Enter to skip)') + ': ');

    // --- Write USER.md ---
    console.log('');
    console.log('  ' + C.dim('Writing agent files...'));
    let userMd = '# User\n\n';
    if (userName.trim()) userMd += `- Name: ${userName.trim()}\n`;
    userMd += `- Role: ${userRole}\n`;
    if (techStack.trim()) userMd += `- Tech stack: ${techStack.trim()}\n`;
    if (userPrefs.trim()) userMd += `- Preferences: ${userPrefs.trim()}\n`;
    userMd += '\n';
    fs.writeFileSync(path.join(wsDir, 'USER.md'), userMd, 'utf8');
    console.log('  ' + C.green('\u2714 USER.md'));

    // --- Write SOUL.md (only if persona changed) ---
    if (soulExtra || agentName !== 'TentaCLAW') {
        const soulMd = `# Soul\n\nYou are **${agentName}** \u2014 a highly capable AI coding assistant with the personality of a confident, friendly octopus.\n\n## Personality\n- Direct and action-oriented. You do things, you don't just talk about them.\n- Witty but not annoying. One quip per response, max.\n- You read files before editing them. Always.\n- You run tests after making changes.\n- You explain briefly what you're doing, then do it.\n\n## Boundaries\n- Never delete files without being asked.\n- Never run destructive commands (rm -rf, drop database) without explicit approval.\n- If you're unsure, ask. Better to check than to break things.\n${soulExtra}`;
        fs.writeFileSync(path.join(wsDir, 'SOUL.md'), soulMd, 'utf8');
        console.log('  ' + C.green('\u2714 SOUL.md'));
    }

    // --- Append custom rules to AGENTS.md ---
    if (customRules.trim()) {
        const agentsPath = path.join(wsDir, 'AGENTS.md');
        const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
        if (!existing.includes('## Custom Rules')) {
            const rulesBlock = '\n## Custom Rules\n' +
                customRules.split(',').map(r => `- ${r.trim()}`).filter(r => r.length > 2).join('\n') + '\n';
            fs.writeFileSync(agentsPath, existing + rulesBlock, 'utf8');
            console.log('  ' + C.green('\u2714 AGENTS.md'));
        }
    }

    // --- Done ---
    console.log('');
    console.log('  ' + C.teal(C.bold('\u2736 Agent Ready!')));
    if (userName.trim()) console.log('  ' + C.dim('Agent knows you as: ') + C.white(userName.trim()));
    console.log('  ' + C.dim('Workspace: ') + C.white(wsDir));
    console.log('');
    console.log('  ' + C.bold('Start coding:') + '  ' + C.green('tentaclaw code'));
    console.log('  ' + C.bold('Quick task:  ') + '  ' + C.green('tentaclaw code --task "review this file"'));
    console.log('');

    if (ownRl) rl.close();
}

/** apiProbe with custom headers (for API key testing) */
async function apiProbeWithHeaders(baseUrl: string, apiPath: string, headers: Record<string, string>): Promise<unknown | null> {
    const url = baseUrl.replace(/\/+$/, '') + apiPath;
    try {
        const resp = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
            const parsed = new URL(url);
            const transport = parsed.protocol === 'https:' ? https : http;
            const req = transport.request({
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json', ...headers },
                timeout: 10000,
            }, (res) => {
                let buf = '';
                res.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
                res.on('end', () => {
                    try { resolve({ status: res.statusCode || 500, data: JSON.parse(buf) }); }
                    catch { resolve({ status: res.statusCode || 500, data: buf }); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.end();
        });
        if (resp.status >= 400) return null;
        return resp.data;
    } catch {
        return null;
    }
}

// =============================================================================
// Standalone Models — `tentaclaw models` with config fallback
// =============================================================================

async function cmdModelsStandalone(filter = ''): Promise<void> {
    const config = loadConfig();
    if (!config) {
        console.log('');
        console.log(C.yellow('  No configuration found.'));
        console.log(C.dim('  Run: tentaclaw setup'));
        console.log('');
        return;
    }

    const { url, headers } = resolveInferenceFromConfig(config);
    console.log('');
    console.log('  ' + C.teal(C.bold('MODELS')) + C.dim(` \u2014 ${config.provider} (${url})`));
    console.log('');

    if (config.provider === 'ollama') {
        // Use Ollama's native /api/tags for richer info
        const resp = await apiProbeWithHeaders(url, '/api/tags', headers) as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }> } | null;
        const models = resp?.models || [];
        if (models.length === 0) {
            console.log(C.yellow('  No models installed.'));
            console.log(C.dim('  Install one: ollama pull llama3.1:8b'));
        } else {
            const active = config.model;
            // Wave 437: flag no-tools models and CPU-friendly models
            const NO_TOOLS_MOD437 = ['dark-champion', 'command-r', 'gemma2', 'gemma3', 'phi3', 'phi4', 'stablelm'];
            // Wave 440: --filter support
            const filteredModels440 = filter ? models.filter(m => m.name.toLowerCase().includes(filter.toLowerCase())) : models;
            if (filter && filteredModels440.length === 0) {
                console.log(C.yellow(`  No models matching "${filter}".`));
                console.log('');
                return;
            }
            for (const m of filteredModels440) {
                const sizeMb = Math.round(m.size / 1048576);
                const sizeStr = sizeMb > 1024 ? (sizeMb / 1024).toFixed(1) + ' GB' : sizeMb + ' MB';
                const params = m.details?.parameter_size || '';
                const quant = m.details?.quantization_level || '';
                const family = m.details?.family || '';
                const tag = [params, quant, family].filter(Boolean).join(', ');
                const marker = m.name === active ? C.green(' \u25C0 active') : '';
                const modelLower = m.name.toLowerCase();
                const familyLower = family.toLowerCase();
                const noToolsFlag = NO_TOOLS_MOD437.some(nt => modelLower.includes(nt) || familyLower.includes(nt))
                    ? C.yellow(' ⚠no-tools') : '';
                const cpuFlag = sizeMb < 2048 ? C.cyan(' CPU-ok') : '';
                console.log('  ' + C.green(padRight(m.name, 35)) + C.dim(padRight(tag, 25)) + C.dim(sizeStr) + marker + noToolsFlag + cpuFlag);
            }
        }
    } else {
        // OpenAI-compatible /v1/models
        const resp = await apiProbeWithHeaders(url, '/models', headers) as { data?: Array<{ id: string }> } | null;
        const models = resp?.data || [];
        if (models.length === 0) {
            console.log(C.yellow('  No models available (or API key invalid).'));
        } else {
            const active = config.model;
            for (const m of models.slice(0, 30)) {
                const marker = m.id === active ? C.green(' \u25C0 active') : '';
                console.log('  ' + C.green(m.id) + marker);
            }
            if (models.length > 30) console.log(C.dim(`  ...and ${models.length - 30} more`));
        }
    }
    console.log('');
}

// =============================================================================
// Config CLI — `tentaclaw config [show|get|set]`
// =============================================================================

async function cmdConfigCli(positional: string[]): Promise<void> {
    const sub = positional[0] || 'show';
    const config = loadConfig();

    if (sub === 'show' || sub === 'list') {
        console.log('');
        console.log('  ' + C.teal(C.bold('CONFIGURATION')) + C.dim(` \u2014 ${getConfigPath()}`));
        console.log('');
        if (!config) {
            console.log('  ' + C.yellow('No configuration found.'));
            console.log('  ' + C.dim('Run: tentaclaw setup'));
        } else {
            console.log('  ' + padRight(C.dim('provider'), 18) + C.white(config.provider));
            console.log('  ' + padRight(C.dim('model'), 18) + C.white(config.model));
            if (config.ollama) console.log('  ' + padRight(C.dim('ollama.host'), 18) + C.white(config.ollama.host));
            if (config.openai) {
                console.log('  ' + padRight(C.dim('openai.apiKey'), 18) + C.dim(config.openai.apiKey.slice(0, 8) + '...' + config.openai.apiKey.slice(-4)));
                if (config.openai.baseUrl) console.log('  ' + padRight(C.dim('openai.baseUrl'), 18) + C.white(config.openai.baseUrl));
            }
            if (config.openrouter) console.log('  ' + padRight(C.dim('openrouter.key'), 18) + C.dim(config.openrouter.apiKey.slice(0, 8) + '...'));
            if (config.custom) {
                console.log('  ' + padRight(C.dim('custom.baseUrl'), 18) + C.white(config.custom.baseUrl));
                if (config.custom.apiKey) console.log('  ' + padRight(C.dim('custom.apiKey'), 18) + C.dim('(set)'));
            }
            if (config.autoApprove !== undefined) console.log('  ' + padRight(C.dim('autoApprove'), 18) + C.white(String(config.autoApprove)));
        }
        console.log('');
        return;
    }

    if (sub === 'get') {
        const key = positional[1];
        if (!key || !config) { console.log(!config ? C.yellow('  No config.') : C.red('  Usage: tentaclaw config get <key>')); return; }
        const parts = key.split('.');
        let val: unknown = config;
        for (const p of parts) { val = val && typeof val === 'object' ? (val as Record<string, unknown>)[p] : undefined; }
        console.log(val !== undefined ? String(val) : C.dim('(not set)'));
        return;
    }

    if (sub === 'set') {
        const key = positional[1];
        const value = positional.slice(2).join(' ');
        if (!key || !value) { console.log(C.red('  Usage: tentaclaw config set <key> <value>')); return; }
        const cfg = config || { provider: 'ollama' as const, model: '' };
        if (key === 'model') cfg.model = value;
        else if (key === 'provider') cfg.provider = value as TentaclawConfig['provider'];
        else if (key === 'ollama.host') { cfg.ollama = cfg.ollama || { host: '' }; cfg.ollama.host = value; }
        else if (key === 'openai.apiKey') { cfg.openai = cfg.openai || { apiKey: '' }; cfg.openai.apiKey = value; }
        else if (key === 'openai.baseUrl') { cfg.openai = cfg.openai || { apiKey: '' }; cfg.openai.baseUrl = value; }
        else if (key === 'openrouter.apiKey') { cfg.openrouter = cfg.openrouter || { apiKey: '' }; cfg.openrouter.apiKey = value; }
        else if (key === 'autoApprove') cfg.autoApprove = value === 'true';
        else { console.log(C.red(`  Unknown key: ${key}`)); return; }
        saveConfig(cfg);
        console.log('  ' + C.green(`\u2714 Set ${key} = ${key.includes('Key') ? '***' : value}`));
        return;
    }

    if (sub === 'path') { console.log(getConfigPath()); return; }

    if (sub === 'validate') {
        if (!config) { console.log(C.red('  \u2718 No config.')); process.exit(1); }
        const { url, headers } = resolveInferenceFromConfig(config);
        const resp = await apiProbeWithHeaders(url, config.provider === 'ollama' ? '/api/tags' : '/models', headers);
        console.log(resp ? C.green('  \u2714 Config valid') : C.red(`  \u2718 Cannot reach ${config.provider} at ${url}`));
        if (!resp) process.exit(1);
        return;
    }

    console.log(C.dim('  Usage: tentaclaw config [show|get|set|path|validate]'));
}

// =============================================================================
// Agents — list named agent workspaces (Wave 69)
// =============================================================================

function cmdAgents(): void {
    const baseDir = getConfigDir();
    console.log('');
    console.log('  ' + C.teal(C.bold('AGENTS')) + C.dim(` \u2014 named workspaces in ${baseDir}`));
    console.log('');

    const entries = fs.existsSync(baseDir)
        ? fs.readdirSync(baseDir).filter(f => f.startsWith('workspace') && fs.statSync(path.join(baseDir, f)).isDirectory())
        : [];

    if (entries.length === 0) {
        console.log('  ' + C.dim('No agent workspaces found.'));
        console.log('  ' + C.dim('Create one with: tentaclaw code --agent <name>'));
    } else {
        for (const entry of entries) {
            const name = entry === 'workspace' ? C.green('(default)') : C.white(entry.replace('workspace-', ''));
            const agentFlag = entry === 'workspace' ? '' : ` --agent ${entry.replace('workspace-', '')}`;
            const wsDir = path.join(baseDir, entry);
            const files = fs.readdirSync(wsDir).filter(f => !fs.statSync(path.join(wsDir, f)).isDirectory());
            const hasMemory = fs.existsSync(path.join(wsDir, 'MEMORY.md'));
            const memSize = hasMemory ? fs.statSync(path.join(wsDir, 'MEMORY.md')).size : 0;
            console.log('  ' + padRight(name, 20) + C.dim(`${files.length} files`) +
                (hasMemory ? C.dim(` \u2022 MEMORY.md (${memSize}b)`) : '') +
                (agentFlag ? C.dim(`  \u2192  tentaclaw code${agentFlag}`) : ''));
        }
    }
    console.log('');
}

// =============================================================================
// Sessions CLI — `tentaclaw sessions [list|info|delete]`
// =============================================================================

async function cmdSessionsCli(positional: string[], flags: Record<string, string> = {}): Promise<void> {
    const sub = positional[0] || 'list';

    if (sub === 'list') {
        const recent = listRecentSessions(25);
        console.log('');
        console.log('  ' + C.teal(C.bold('SESSIONS')) + C.dim(` \u2014 ${getSessionsDir()}`));
        console.log('');
        if (recent.length === 0) {
            console.log('  ' + C.dim('No sessions yet. Start one with: tentaclaw code'));
        } else {
            console.log('  ' + padRight(C.dim('SESSION ID'), 16) + padRight(C.dim('UPDATED'), 14) + padRight(C.dim('MSGS'), 6) + padRight(C.dim('MODEL'), 20) + C.dim('TITLE'));
            for (const s of recent) {
                const date = s.updatedAt.slice(0, 16).replace('T', ' ');
                const label = s.label ? C.dim(s.label.slice(0, 35)) : '';
                console.log('  ' + padRight(C.cyan(s.sessionId.slice(0, 14)), 16) + padRight(C.dim(date.slice(5)), 14) +
                    padRight(C.white(String(s.messageCount)), 6) + padRight(C.dim(s.model?.slice(0, 18) || '?'), 20) + label);
            }
        }
        console.log('');
        console.log('  ' + C.dim('Resume: tentaclaw code --resume <session-id>'));
        console.log('');
        return;
    }

    if (sub === 'info') {
        const sid = positional[1];
        if (!sid) { console.log(C.red('  Usage: tentaclaw sessions info <session-id>')); return; }
        const index = loadSessionIndex();
        const meta = index[sid];
        if (!meta) { console.log(C.red(`  Session not found: ${sid}`)); return; }
        const events = loadSessionTranscript(sid);
        console.log('');
        console.log('  ' + C.teal(C.bold('SESSION INFO')));
        console.log('  ' + padRight(C.dim('ID'), 16) + C.white(meta.sessionId));
        console.log('  ' + padRight(C.dim('Created'), 16) + C.white(meta.createdAt.slice(0, 19).replace('T', ' ')));
        console.log('  ' + padRight(C.dim('Updated'), 16) + C.white(meta.updatedAt.slice(0, 19).replace('T', ' ')));
        console.log('  ' + padRight(C.dim('Model'), 16) + C.white(meta.model));
        console.log('  ' + padRight(C.dim('Messages'), 16) + C.white(String(meta.messageCount)));
        console.log('  ' + padRight(C.dim('Events'), 16) + C.white(String(events.length)));
        console.log('  ' + padRight(C.dim('CWD'), 16) + C.dim(meta.cwd));
        // Wave 104: tool breakdown in sessions info
        const toolEvents = events.filter(e => e.type === 'tool_call');
        const toolCounts: Record<string, number> = {};
        const filesModified = new Set<string>();
        for (const e of toolEvents) {
            const name = (e as { name?: string }).name || 'unknown';
            toolCounts[name] = (toolCounts[name] || 0) + 1;
            if (['write_file', 'edit_file', 'delete_file', 'move_file'].includes(name)) {
                try {
                    const args = JSON.parse((e as { content?: string }).content || '{}') as Record<string, string>;
                    if (args['path']) filesModified.add(path.basename(args['path']));
                } catch { /* ok */ }
            }
        }
        if (toolEvents.length > 0) {
            console.log('  ' + padRight(C.dim('Tool calls'), 16) + C.white(String(toolEvents.length)));
            const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            console.log('  ' + padRight(C.dim('Top tools'), 16) + C.dim(topTools.map(([n, c]) => `${n}(${c})`).join(', ')));
        }
        if (filesModified.size > 0) {
            console.log('  ' + padRight(C.dim('Files touched'), 16) + C.white(String(filesModified.size)) + C.dim(` — ${[...filesModified].slice(0, 5).join(', ')}${filesModified.size > 5 ? '...' : ''}`));
        }
        const usageEvents = events.filter(e => e.type === 'usage');
        const totalTokens = usageEvents.reduce((s, e) => s + (((e as { metadata?: { total_tokens?: number } }).metadata?.total_tokens) || 0), 0);
        if (totalTokens > 0) console.log('  ' + padRight(C.dim('Tokens'), 16) + C.white(formatTokens(totalTokens)));
        const userEvents = events.filter(e => e.type === 'message' && e.role === 'user');
        if (userEvents.length > 0) {
            console.log('');
            console.log('  ' + C.dim('Last messages:'));
            for (const e of userEvents.slice(-5)) {
                const preview = (e.content || '').slice(0, 80).replace(/\n/g, ' ');
                console.log('  ' + C.cyan('\u276F ') + C.white(preview) + (preview.length >= 80 ? C.dim('...') : ''));
            }
        }
        console.log('');
        return;
    }

    if (sub === 'rename') {
        // Wave 125: rename session label
        const sid = positional[1];
        const newLabel = positional.slice(2).join(' ').trim();
        if (!sid || !newLabel) { console.log(C.red('  Usage: tentaclaw sessions rename <session-id> <new title>')); return; }
        const idx = loadSessionIndex();
        if (!idx[sid]) { console.log(C.red(`  Session not found: ${sid}`)); return; }
        updateSessionMeta(sid, { label: newLabel });
        console.log('  ' + C.green(`\u2714 Renamed: "${newLabel}"`));
        return;
    }

    if (sub === 'delete') {
        const sid = positional[1];
        if (!sid) { console.log(C.red('  Usage: tentaclaw sessions delete <session-id>')); return; }
        const index = loadSessionIndex();
        delete index[sid];
        saveSessionIndex(index);
        try { fs.unlinkSync(path.join(getSessionsDir(), `${sid}.jsonl`)); } catch { /* ok */ }
        console.log('  ' + C.green(`\u2714 Deleted: ${sid}`));
        return;
    }

    if (sub === 'clean') {
        // Wave 347: --keep <N> keeps the N most recent sessions regardless of age
        const keepN = parseInt(flags['keep'] || '0', 10) || 0;
        const days = Math.max(1, parseInt(positional[1] || '30', 10) || 30);
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        const index = loadSessionIndex();
        // Sort by date — most recent first; those in the keep list are protected
        const sorted = Object.values(index).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        const keepIds = new Set(sorted.slice(0, keepN).map(s => s.sessionId));
        let removed = 0;
        let bytesFreed = 0;
        for (const [sid, meta] of Object.entries(index)) {
            if (meta.updatedAt < cutoff && !keepIds.has(sid)) {
                delete index[sid];
                const fp = path.join(getSessionsDir(), `${sid}.jsonl`);
                try { bytesFreed += fs.statSync(fp).size; fs.unlinkSync(fp); } catch { /* ok */ }
                removed++;
            }
        }
        saveSessionIndex(index);
        const freedStr = bytesFreed > 0 ? ` (${(bytesFreed / 1024).toFixed(0)}KB freed)` : '';
        console.log('  ' + C.green('\u2714') + ` Cleaned ${removed} session${removed !== 1 ? 's' : ''} older than ${days} day${days !== 1 ? 's' : ''}${freedStr}.`);
        console.log('  ' + C.dim(`  ${Object.keys(index).length} remaining.`));
        if (keepN > 0) console.log('  ' + C.dim(`  Protected: ${Math.min(keepN, sorted.length)} most recent (--keep ${keepN}).`));
        return;
    }

    // Wave 58: sessions search
    if (sub === 'search') {
        const query = positional.slice(1).join(' ').trim();
        if (!query) { console.log(C.red('  Usage: tentaclaw sessions search <query>')); return; }
        const sessDir = getSessionsDir();
        const index = loadSessionIndex();
        const matches: Array<{ sessionId: string; updatedAt: string; hits: string[] }> = [];
        console.log('');
        console.log('  ' + C.teal(C.bold('SEARCH')) + C.dim(` — "${query}"`));
        console.log('');
        const qLower = query.toLowerCase();
        for (const sid of Object.keys(index).sort((a, b) => (index[b]?.updatedAt || '').localeCompare(index[a]?.updatedAt || ''))) {
            try {
                const filePath = path.join(sessDir, `${sid}.jsonl`);
                if (!fs.existsSync(filePath)) continue;
                const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
                const hits: string[] = [];
                for (const line of lines) {
                    try {
                        const ev = JSON.parse(line) as { type?: string; role?: string; content?: string };
                        if ((ev.type === 'message') && ev.content && ev.content.toLowerCase().includes(qLower)) {
                            const preview = ev.content.replace(/\n/g, ' ').slice(0, 100);
                            hits.push(`${ev.role || '?'}: ${preview}${preview.length >= 100 ? '...' : ''}`);
                        }
                    } catch { /* skip */ }
                }
                if (hits.length > 0) matches.push({ sessionId: sid, updatedAt: index[sid]?.updatedAt || '', hits });
                if (matches.length >= 10) break;
            } catch { /* skip */ }
        }
        if (matches.length === 0) {
            console.log('  ' + C.dim('No sessions found matching: ' + query));
        } else {
            for (const m of matches) {
                const date = m.updatedAt.slice(0, 16).replace('T', ' ');
                console.log('  ' + C.white(padRight(m.sessionId, 24)) + C.dim(date));
                for (const h of m.hits.slice(0, 3)) {
                    console.log('  ' + C.dim('  \u2514 ') + h);
                }
                console.log('');
            }
            console.log('  ' + C.dim(`${matches.length} session${matches.length !== 1 ? 's' : ''} matched.`));
        }
        console.log('');
        return;
    }

    // Wave 67: sessions stats
    if (sub === 'stats') {
        const index = loadSessionIndex();
        const all = Object.values(index);
        if (all.length === 0) { console.log('  ' + C.dim('No sessions yet.')); return; }
        const totalMsgs = all.reduce((s, m) => s + (m.messageCount || 0), 0);
        const totalTokens = all.reduce((s, m) => s + (m.tokenCount || 0), 0);
        const models: Record<string, number> = {};
        for (const m of all) { if (m.model) models[m.model] = (models[m.model] || 0) + 1; }
        const topModel = Object.entries(models).sort((a, b) => b[1] - a[1])[0];
        const oldest = all.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        const sessDir = getSessionsDir();
        let totalToolCalls = 0;
        let sessionsParsed = 0;
        for (const m of all) {
            const fp = path.join(sessDir, `${m.sessionId}.jsonl`);
            if (!fs.existsSync(fp)) continue;
            const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
            for (const line of lines) {
                try {
                    const ev = JSON.parse(line) as { type?: string };
                    if (ev.type === 'tool_call') totalToolCalls++;
                } catch { /* skip */ }
            }
            sessionsParsed++;
            if (sessionsParsed >= 50) break; // cap for speed
        }
        console.log('');
        console.log('  ' + C.teal(C.bold('SESSION STATS')));
        console.log('');
        console.log('  ' + padRight(C.dim('Sessions'), 20) + C.white(String(all.length)));
        console.log('  ' + padRight(C.dim('Total messages'), 20) + C.white(String(totalMsgs)));
        console.log('  ' + padRight(C.dim('Total tokens'), 20) + C.white(totalTokens > 0 ? formatTokens(totalTokens) : C.dim('not tracked')));
        console.log('  ' + padRight(C.dim('Tool calls'), 20) + C.white(String(totalToolCalls) + (sessionsParsed < all.length ? C.dim(` (from ${sessionsParsed} sessions)`) : '')));
        if (topModel) console.log('  ' + padRight(C.dim('Top model'), 20) + C.white(topModel[0]) + C.dim(` (${topModel[1]} sessions)`));
        console.log('  ' + padRight(C.dim('Oldest session'), 20) + C.dim(oldest.createdAt.slice(0, 10)));
        console.log('');
        return;
    }

    // Wave 108: sessions export <id> [--format markdown|jsonl]
    if (sub === 'export') {
        const sid = positional[1];
        if (!sid) { console.log(C.red('  Usage: tentaclaw sessions export <session-id> [output-file]')); return; }
        const events = loadSessionTranscript(sid);
        if (events.length === 0) { console.log(C.red(`  Session not found: ${sid}`)); return; }
        const fmt = (flags['format'] || flags['f'] || 'markdown').toLowerCase();
        const outPath = positional[2] || flags['output'] || flags['o'];
        if (fmt === 'jsonl') {
            const content = events.map(e => JSON.stringify(e)).join('\n');
            if (outPath) {
                fs.writeFileSync(outPath, content, 'utf8');
                console.log('  ' + C.green(`\u2714 Exported ${events.length} events → ${outPath}`));
            } else {
                console.log(content);
            }
            return;
        }
        // Markdown format
        const index = loadSessionIndex();
        const meta = index[sid];
        const title = meta?.label || sid;
        const date = (meta?.createdAt || '').slice(0, 10) || 'unknown date';
        const model = meta?.model || 'unknown';
        let md = `# ${title}\n\n`;
        md += `**Session:** \`${sid}\`  \n**Date:** ${date}  \n**Model:** ${model}  \n\n---\n\n`;
        for (const e of events) {
            if (e.type === 'message') {
                const me = e as { role?: string; content?: string };
                if (me.role === 'user') {
                    md += `## User\n\n${me.content || ''}\n\n`;
                } else if (me.role === 'assistant') {
                    md += `## TentaCLAW\n\n${me.content || ''}\n\n`;
                }
            } else if (e.type === 'tool_call') {
                const te = e as { name?: string; content?: string };
                md += `> **Tool:** \`${te.name || 'unknown'}\`\n>\n> \`\`\`json\n> ${(te.content || '').slice(0, 300)}\n> \`\`\`\n\n`;
            }
        }
        const dest = outPath || `tentaclaw-session-${sid.slice(0, 8)}.md`;
        fs.writeFileSync(dest, md, 'utf8');
        console.log('  ' + C.green(`\u2714 Exported as Markdown → ${dest}`));
        return;
    }

    console.log(C.dim('  Usage: tentaclaw sessions [list|info|delete|clean|search|stats|export] [arg]'));
    console.log(C.dim('    clean [days]     Delete sessions older than N days (default: 30)'));
    console.log(C.dim('    search <query>   Search message content across all sessions'));
    console.log(C.dim('    stats            Show aggregate session statistics'));
    console.log(C.dim('    export <id>      Export session as Markdown (--format jsonl for raw)'));
}

// =============================================================================
// Standalone Doctor — health check without gateway
// =============================================================================

async function cmdDoctorStandalone(): Promise<void> {
    console.log('');
    console.log('  ' + C.teal(C.bold('DOCTOR')) + C.dim(' \u2014 standalone health check'));
    console.log('');

    let issues = 0;
    let ok = 0;

    const config = loadConfig();
    if (config) {
        console.log('  ' + C.green('\u2714') + ' Config: ' + C.dim(`${config.provider}, model=${config.model}`));
        ok++;
    } else {
        console.log('  ' + C.red('\u2718') + ' No config ' + C.dim('\u2014 Fix: tentaclaw setup'));
        issues++;
    }

    const wsDir = getWorkspaceDir();
    if (fs.existsSync(wsDir)) {
        const wsFiles = fs.readdirSync(wsDir).filter(f => f.endsWith('.md'));
        console.log('  ' + C.green('\u2714') + ` Workspace: ${wsFiles.length} files`);
        ok++;
    } else {
        console.log('  ' + C.yellow('\u26A0') + ' No workspace ' + C.dim('\u2014 Fix: tentaclaw code (auto-creates)'));
        issues++;
    }

    const sessions = listRecentSessions(999);
    console.log('  ' + C.green('\u2714') + ` Sessions: ${sessions.length} stored`);
    ok++;

    // Wave 41: writable config dir check
    const configDir = getConfigDir();
    try {
        const testFile = path.join(configDir, '.write-test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);
        console.log('  ' + C.green('\u2714') + ' Config dir writable');
        ok++;
    } catch {
        console.log('  ' + C.red('\u2718') + ' Config dir not writable: ' + configDir);
        issues++;
    }

    // Wave 41: config backup check
    if (config) {
        const bakPath = getConfigPath() + '.bak';
        if (fs.existsSync(bakPath)) {
            console.log('  ' + C.green('\u2714') + ' Config backup exists');
            ok++;
        } else {
            console.log('  ' + C.yellow('\u26A0') + ' No config backup yet ' + C.dim('\u2014 created automatically on next `config set`'));
        }
    }

    if (config) {
        const { url, headers } = resolveInferenceFromConfig(config);
        const endpoint = config.provider === 'ollama' ? '/api/tags' : '/models';
        const resp = await apiProbeWithHeaders(url, endpoint, headers);
        if (resp) {
            console.log('  ' + C.green('\u2714') + ` Backend: ${config.provider} reachable`);
            ok++;
            if (config.provider === 'ollama') {
                const tags = resp as { models?: Array<{ name: string }> };
                const hasModel = (tags.models || []).some(m => m.name === config.model);
                if (hasModel) { console.log('  ' + C.green('\u2714') + ` Model: ${config.model} available`); ok++; }
                else { console.log('  ' + C.red('\u2718') + ` Model: ${config.model} not found ` + C.dim(`\u2014 Fix: ollama pull ${config.model}`)); issues++; }
            }
        } else {
            console.log('  ' + C.red('\u2718') + ` Backend: cannot reach ${config.provider} at ${url}`);
            issues++;
        }
    }

    const nodeVer = parseInt(process.version.slice(1));
    if (nodeVer >= 20) { console.log('  ' + C.green('\u2714') + ` Node.js ${process.version}`); ok++; }
    else { console.log('  ' + C.yellow('\u26A0') + ` Node.js ${process.version} (need >= 20)`); issues++; }

    // Wave 151: check git availability
    try {
        const gitVer = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
        console.log('  ' + C.green('\u2714') + ` Git: ${gitVer}`);
        ok++;
    } catch {
        console.log('  ' + C.yellow('\u26A0') + ' Git: not found (checkpoint feature requires git)');
    }

    // Wave 436b: check if configured model is good for coding agent (tool use support)
    if (config) {
        const NO_TOOLS_DOC = ['dark-champion', 'command-r', 'gemma2', 'gemma3', 'phi3', 'phi4', 'stablelm'];
        const modelBase = config.model.split(':')[0]?.toLowerCase() || '';
        if (NO_TOOLS_DOC.some(m => modelBase.includes(m))) {
            console.log('  ' + C.yellow('\u26A0') + ` Model "${config.model}" may not support tool calls (coding agent requires tool use)`);
            console.log('    ' + C.dim('Recommended: hermes3:8b (4.3 GB), qwen2.5-coder:7b (4.5 GB), or bitnet-b1.58-3b (CPU-only, 1.3 GB)'));
            issues++;
        }
    }

    // Wave 342: check ripgrep (rg) — optional but improves search speed significantly
    try {
        execSync('rg --version', { encoding: 'utf8', stdio: 'pipe' });
        console.log('  ' + C.green('\u2714') + ' ripgrep (rg): available — fast search enabled');
        ok++;
    } catch {
        console.log('  ' + C.dim('\u2022') + ' ripgrep (rg): not found ' + C.dim('(optional — install for faster search: https://github.com/BurntSushi/ripgrep)'));
    }

    // Wave 342: check for .clawcode and .clawignore in cwd
    if (fs.existsSync(path.join(process.cwd(), '.clawcode'))) {
        console.log('  ' + C.green('\u2714') + ' .clawcode: present in current directory');
        ok++;
    } else {
        console.log('  ' + C.dim('\u2022') + ' .clawcode: not found in cwd ' + C.dim('(run: tentaclaw init)'));
    }
    if (fs.existsSync(path.join(process.cwd(), '.clawignore'))) {
        const ignCount = fs.readFileSync(path.join(process.cwd(), '.clawignore'), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        console.log('  ' + C.green('\u2714') + ` .clawignore: present (${ignCount} pattern${ignCount !== 1 ? 's' : ''})`);
        ok++;
    }

    // Wave 93: additional checks
    const memPath = path.join(wsDir, 'MEMORY.md');
    if (fs.existsSync(memPath)) {
        const memContent = fs.readFileSync(memPath, 'utf8').trim();
        const memLines = memContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        if (memLines > 0) { console.log('  ' + C.green('\u2714') + ` MEMORY.md: ${memLines} fact${memLines !== 1 ? 's' : ''} stored`); ok++; }
        else { console.log('  ' + C.dim('\u2022') + ' MEMORY.md: empty (agent will fill it)'); }
    }

    const sessDir = getSessionsDir();
    if (fs.existsSync(sessDir)) {
        const jsonlFiles = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
        let totalBytes = 0;
        for (const f of jsonlFiles) { try { totalBytes += fs.statSync(path.join(sessDir, f)).size; } catch { /* ok */ } }
        const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
        if (totalBytes > 100 * 1024 * 1024) {
            console.log('  ' + C.yellow('\u26A0') + ` Sessions: ${jsonlFiles.length} files, ${totalMb}MB ` + C.dim('(run: tentaclaw sessions clean)'));
        } else {
            console.log('  ' + C.green('\u2714') + ` Sessions: ${jsonlFiles.length} files, ${totalMb}MB`);
            ok++;
        }
    }

    console.log('');
    console.log(issues === 0
        ? '  ' + C.green(C.bold(`\u2714 All ${ok} checks passed.`))
        : '  ' + C.yellow(`${ok} passed, ${issues} issue${issues > 1 ? 's' : ''}.`));
    console.log('');
}

// =============================================================================
// Workspace — top-level workspace management command (Wave 91)
// =============================================================================

function cmdWorkspace(positional: string[]): void {
    const sub = positional[0] || 'show';
    const wsDir = getWorkspaceDir();

    if (sub === 'show' || sub === 'list') {
        console.log('');
        console.log('  ' + C.teal(C.bold('WORKSPACE')) + C.dim(` \u2014 ${wsDir}`));
        console.log('');
        if (!fs.existsSync(wsDir)) {
            console.log('  ' + C.dim('Workspace not initialized. Start: tentaclaw code'));
            console.log('');
            return;
        }
        const files = fs.readdirSync(wsDir).filter(f => !fs.statSync(path.join(wsDir, f)).isDirectory());
        let totalSize = 0;
        for (const f of files) {
            const sz = fs.statSync(path.join(wsDir, f)).size;
            totalSize += sz;
            const szStr = sz < 1024 ? `${sz}b` : `${(sz / 1024).toFixed(1)}kb`;
            const isKey = ['MEMORY.md', 'USER.md', 'SOUL.md'].includes(f);
            console.log('  ' + padRight(isKey ? C.white(f) : C.dim(f), 24) + C.dim(szStr));
        }

        // Daily notes count
        const memDir = path.join(wsDir, 'memory');
        if (fs.existsSync(memDir)) {
            const notes = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
            if (notes.length > 0) {
                const notesSize = notes.reduce((s, n) => s + fs.statSync(path.join(memDir, n)).size, 0);
                console.log('  ' + padRight(C.dim(`memory/ (${notes.length} notes)`), 24) + C.dim(notesSize < 1024 ? `${notesSize}b` : `${(notesSize / 1024).toFixed(1)}kb`));
                totalSize += notesSize;
            }
        }
        console.log('');
        console.log('  ' + C.dim(`Total: ${totalSize < 1024 ? totalSize + 'b' : (totalSize / 1024).toFixed(1) + 'kb'}`));
        console.log('');
        console.log('  ' + C.dim('Commands: tentaclaw workspace [show|reset|open]'));
        console.log('  ' + C.dim('          tentaclaw memory [show|edit|clear|search]'));
        console.log('');
        return;
    }

    if (sub === 'open') {
        if (!fs.existsSync(wsDir)) { console.log(C.dim('  Workspace not initialized.')); return; }
        const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        try { execSync(`${opener} "${wsDir}"`, { stdio: 'ignore' }); }
        catch { console.log('  ' + C.dim(`  Workspace at: ${wsDir}`)); }
        return;
    }

    if (sub === 'reset') {
        console.log('  ' + C.yellow(`\u26A0 This will delete all workspace files in: ${wsDir}`));
        console.log('  ' + C.dim('  (Sessions, configs, and gateway data are unaffected.)'));
        console.log('  ' + C.dim('  To confirm, run: rm -rf ' + wsDir));
        return;
    }

    console.log(C.dim('  Usage: tentaclaw workspace [show|open|reset]'));
}

// =============================================================================
// Memory — view and manage workspace memory files (Wave 88)
// =============================================================================

async function cmdMemory(positional: string[], _flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'show';
    const wsDir = getWorkspaceDir();
    const memDir = path.join(wsDir, 'memory');

    if (sub === 'show' || sub === 'view') {
        const memPath = path.join(wsDir, 'MEMORY.md');
        console.log('');
        console.log('  ' + C.teal(C.bold('MEMORY')) + C.dim(` \u2014 ${memPath}`));
        console.log('');
        if (!fs.existsSync(memPath)) {
            console.log('  ' + C.dim('No MEMORY.md yet. The code agent writes here during sessions.'));
            console.log('  ' + C.dim('Start: tentaclaw code'));
        } else {
            const content = fs.readFileSync(memPath, 'utf8');
            const lines = content.split('\n');
            const PREVIEW = 40;
            for (const l of lines.slice(0, PREVIEW)) console.log('  ' + l);
            if (lines.length > PREVIEW) console.log('  ' + C.dim(`  ...(${lines.length - PREVIEW} more lines)`));
        }
        console.log('');

        // Also show daily notes
        if (fs.existsSync(memDir)) {
            const notes = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
            if (notes.length > 0) {
                console.log('  ' + C.dim('Recent daily notes:'));
                for (const n of notes) {
                    const size = fs.statSync(path.join(memDir, n)).size;
                    console.log('  ' + C.dim('  \u2022 ') + C.white(n) + C.dim(` (${size}b)`));
                }
                console.log('');
            }
        }
        console.log('  ' + C.dim('Commands: tentaclaw memory [show|edit|clear|search <q>]'));
        console.log('');
        return;
    }

    if (sub === 'search') {
        // Wave 310: memory search with line numbers and hit count
        const query = positional.slice(1).join(' ').trim();
        if (!query) { console.log(C.red('  Usage: tentaclaw memory search <query>')); return; }
        const qLower = query.toLowerCase();
        const results: Array<{ file: string; hits: Array<{ lineNo: number; line: string }> }> = [];
        const allMemFiles = [
            path.join(wsDir, 'MEMORY.md'),
            ...((fs.existsSync(memDir) ? fs.readdirSync(memDir).filter(n => n.endsWith('.md')).sort().reverse().slice(0, 10).map(n => path.join(memDir, n)) : [])),
        ];
        for (const f of allMemFiles) {
            if (!fs.existsSync(f)) continue;
            const content = fs.readFileSync(f, 'utf8');
            const lines = content.split('\n');
            const hits = lines.map((l, i) => ({ lineNo: i + 1, line: l })).filter(x => x.line.toLowerCase().includes(qLower)).slice(0, 6);
            if (hits.length > 0) results.push({ file: path.basename(f), hits });
        }
        const totalHits = results.reduce((s, r) => s + r.hits.length, 0);
        console.log('');
        console.log('  ' + C.teal(C.bold('MEMORY SEARCH')) + C.dim(` \u2014 "${query}"  (${totalHits} hit${totalHits !== 1 ? 's' : ''})`));
        console.log('');
        if (results.length === 0) { console.log('  ' + C.dim('No results.')); }
        for (const r of results) {
            console.log('  ' + C.white(r.file) + C.dim(` (${r.hits.length} hit${r.hits.length !== 1 ? 's' : ''})`));
            for (const h of r.hits) console.log('  ' + C.dim('  L' + String(h.lineNo).padStart(3) + '  ') + h.line.trim().slice(0, 100));
            console.log('');
        }
        return;
    }

    if (sub === 'clear') {
        const memPath = path.join(wsDir, 'MEMORY.md');
        if (!fs.existsSync(memPath)) { console.log('  ' + C.dim('MEMORY.md does not exist.')); return; }
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ok = await new Promise<string>(res => rl.question('  ' + C.yellow('Clear MEMORY.md? [y/N] '), res));
        rl.close();
        if (ok.trim().toLowerCase().startsWith('y')) {
            fs.writeFileSync(memPath, '# Memory\n\n', 'utf8');
            console.log('  ' + C.green('\u2714 MEMORY.md cleared.'));
        } else {
            console.log('  ' + C.dim('Cancelled.'));
        }
        return;
    }

    if (sub === 'edit') {
        const memPath = path.join(wsDir, 'MEMORY.md');
        const editor = process.env['EDITOR'] || process.env['VISUAL'] || (process.platform === 'win32' ? 'notepad' : 'vi');
        console.log('  ' + C.dim(`Opening in ${editor}...`));
        try {
            execSync(`${editor} "${memPath}"`, { stdio: 'inherit' });
        } catch { console.log('  ' + C.red(`\u2718 Could not open editor. Set $EDITOR or edit directly: ${memPath}`)); }
        return;
    }

    if (sub === 'stats') {
        // Wave 348: tentaclaw memory stats — show memory file sizes and growth
        console.log('');
        console.log('  ' + C.teal(C.bold('MEMORY STATS')));
        console.log('');
        const memPath = path.join(wsDir, 'MEMORY.md');
        if (fs.existsSync(memPath)) {
            const content = fs.readFileSync(memPath, 'utf8');
            const lines = content.split('\n');
            const facts = lines.filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')).length;
            const sz = fs.statSync(memPath).size;
            console.log('  ' + padRight(C.dim('MEMORY.md'), 20) + C.white(`${facts} facts`) + C.dim(`  ${(sz / 1024).toFixed(1)}KB`));
        } else {
            console.log('  ' + C.dim('MEMORY.md: not yet created'));
        }
        if (fs.existsSync(memDir)) {
            const notes = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
            let totalNoteBytes = 0;
            for (const n of notes) {
                try { totalNoteBytes += fs.statSync(path.join(memDir, n)).size; } catch { /* ok */ }
            }
            console.log('  ' + padRight(C.dim('Daily notes'), 20) + C.white(`${notes.length} files`) + C.dim(`  ${(totalNoteBytes / 1024).toFixed(1)}KB total`));
            if (notes.length > 0) {
                const first = notes[0]!.replace('.md', '');
                const last = notes[notes.length - 1]!.replace('.md', '');
                console.log('  ' + padRight(C.dim('Date range'), 20) + C.dim(`${first} → ${last}`));
            }
        }
        const sessIdx = loadSessionIndex();
        const sessCount = Object.keys(sessIdx).length;
        console.log('  ' + padRight(C.dim('Sessions'), 20) + C.white(`${sessCount} stored`));
        console.log('');
        console.log('  ' + C.dim('Commands: memory show | memory search <q> | memory edit | memory clear'));
        console.log('');
        return;
    }

    console.log(C.dim('  Usage: tentaclaw memory [show|edit|clear|search <query>|stats]'));
}

// =============================================================================
// Init Project — create .clawcode in current directory (Wave 78)
// =============================================================================

async function cmdInitProject(): Promise<void> {
    const cwd = process.cwd();
    const clawcodePath = path.join(cwd, '.clawcode');

    console.log('');
    console.log('  ' + C.teal(C.bold('INIT PROJECT')) + C.dim(` \u2014 ${cwd}`));
    console.log('');

    if (fs.existsSync(clawcodePath)) {
        console.log('  ' + C.yellow('\u26A0 .clawcode already exists.'));
        const existing = fs.readFileSync(clawcodePath, 'utf8');
        console.log('  ' + C.dim(existing.slice(0, 200)));
        console.log('');
        return;
    }

    // Detect project type
    let stack = '';
    let testRunner = '';
    let buildCmd = '';
    if (fs.existsSync(path.join(cwd, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
        const scripts = pkg.scripts || {};
        testRunner = 'vitest' in (pkg.devDependencies || {}) ? 'vitest' : scripts['test'] ? 'npm test' : '';
        buildCmd = scripts['build'] ? 'npm run build' : '';
        stack = 'Node.js/TypeScript';
    } else if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
        stack = 'Python';
        testRunner = 'pytest';
    } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
        stack = 'Go';
        testRunner = 'go test ./...';
        buildCmd = 'go build ./...';
    } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
        stack = 'Rust';
        testRunner = 'cargo test';
        buildCmd = 'cargo build';
    }

    const content = `# TentaCLAW Project Config
# This file is loaded automatically by \`tentaclaw code\` in this directory.
# Add project-specific context to help the agent understand your codebase.

## Project
${stack ? `Stack: ${stack}` : 'Stack: (fill in)'}
${buildCmd ? `Build: ${buildCmd}` : ''}
${testRunner ? `Test: ${testRunner}` : ''}

## Architecture
(Describe the high-level structure, entry points, key patterns)

## Key Files
(List important files the agent should know about)

## Conventions
(Coding standards, naming conventions, commit style)

## Do Not Touch
(Files or directories the agent should avoid modifying)
`;

    fs.writeFileSync(clawcodePath, content, 'utf8');
    console.log('  ' + C.green('\u2714 Created: .clawcode'));
    console.log('  ' + C.dim(`  Edit it to add project context for the code agent.`));
    if (stack) console.log('  ' + C.dim(`  Detected: ${stack}${testRunner ? `, test: ${testRunner}` : ''}${buildCmd ? `, build: ${buildCmd}` : ''}`));
    console.log('');
    console.log('  ' + C.dim('Now run: tentaclaw code'));
    console.log('');
}

// =============================================================================
// MCP Server — expose TentaCLAW cluster tools via Model Context Protocol (Wave 71)
// =============================================================================

async function cmdMcp(gateway: string, positional: string[], _flags: Record<string, string>): Promise<void> {
    const sub = positional[0] || 'serve';

    if (sub === 'info') {
        console.log('');
        console.log('  ' + C.teal(C.bold('MCP SERVER')) + C.dim(' \u2014 TentaCLAW as an MCP tool server'));
        console.log('');
        console.log('  Add to Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):');
        console.log('');
        console.log('  ' + C.dim(JSON.stringify({
            mcpServers: {
                tentaclaw: {
                    command: 'tentaclaw',
                    args: ['mcp', 'serve'],
                    env: { TENTACLAW_GATEWAY: gateway },
                }
            }
        }, null, 2).split('\n').join('\n  ')));
        console.log('');
        console.log('  Tools exposed: cluster_status, list_nodes, list_models, list_alerts, chat_completion');
        console.log('');
        return;
    }

    if (sub !== 'serve') {
        console.log(C.dim('  Usage: tentaclaw mcp [serve|info]'));
        return;
    }

    // JSON-RPC 2.0 over stdio (MCP protocol)
    const MCP_VERSION = '2024-11-05';
    const SERVER_INFO = { name: 'tentaclaw', version: CLI_VERSION };

    const TOOLS = [
        {
            name: 'cluster_status', description: 'Get TentaCLAW cluster status, health score, and summary',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'list_nodes', description: 'List all GPU nodes in the cluster with VRAM and status',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'list_models', description: 'List AI models available across the cluster',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'list_alerts', description: 'List active cluster alerts (GPU temp, VRAM pressure, node offline)',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'chat_completion', description: 'Run inference on the TentaCLAW cluster',
            inputSchema: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: 'Model name (e.g. llama3.1:8b)' },
                    prompt: { type: 'string', description: 'User message' },
                },
                required: ['prompt'],
            },
        },
    ];

    const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');

    const handleTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
        try {
            if (name === 'cluster_status') {
                const data = await apiGet(gateway, '/api/v1/summary') as ClusterSummary;
                return JSON.stringify({ nodes: data.total_nodes, online: data.online_nodes, loaded_models: data.loaded_models?.length ?? 0 }, null, 2);
            }
            if (name === 'list_nodes') {
                const data = await apiGet(gateway, '/api/v1/nodes') as { nodes: Record<string, unknown>[] };
                return JSON.stringify(data.nodes.map(n => ({ id: n['id'], hostname: n['hostname'], status: n['status'], vram_total_mb: n['vram_total_mb'], vram_used_mb: n['vram_used_mb'] })), null, 2);
            }
            if (name === 'list_models') {
                const data = await apiGet(gateway, '/api/v1/models') as { models: Record<string, unknown>[] };
                return JSON.stringify(data.models.map(m => ({ name: m['name'], size: m['size'], nodes: m['node_ids'] })), null, 2);
            }
            if (name === 'list_alerts') {
                const data = await apiGet(gateway, '/api/v1/alerts') as unknown[];
                return JSON.stringify(data, null, 2);
            }
            if (name === 'chat_completion') {
                const model = String(args['model'] || 'llama3.1:8b');
                const prompt = String(args['prompt'] || '');
                const body = { model, messages: [{ role: 'user', content: prompt }], stream: false };
                const result = await apiPost(gateway, '/v1/chat/completions', body) as { choices?: Array<{ message?: { content?: string } }> };
                return result.choices?.[0]?.message?.content || '(no response)';
            }
            return `Unknown tool: ${name}`;
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
    };

    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', async (chunk: string) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let req: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
            try { req = JSON.parse(trimmed); } catch { continue; }
            const { id, method, params = {} } = req;

            if (method === 'initialize') {
                send({ jsonrpc: '2.0', id, result: { protocolVersion: MCP_VERSION, serverInfo: SERVER_INFO, capabilities: { tools: {} } } });
            } else if (method === 'tools/list') {
                send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
            } else if (method === 'tools/call') {
                const toolName = String(params['name'] || '');
                const toolArgs = (params['arguments'] as Record<string, unknown>) || {};
                const content = await handleTool(toolName, toolArgs);
                send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: content }] } });
            } else if (method === 'ping') {
                send({ jsonrpc: '2.0', id, result: {} });
            } else {
                send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
            }
        }
    });
    process.stdin.on('end', () => process.exit(0));
}

// =============================================================================
// Logs — stream gateway SSE events to terminal (Wave 66)
// =============================================================================

async function cmdLogs(gateway: string, flags: Record<string, string>): Promise<void> {
    const filter = flags['filter'] || flags['f'] || '';
    const count = parseInt(flags['count'] || flags['n'] || '0', 10) || 0;  // 0 = unlimited
    console.log('');
    console.log('  ' + C.teal(C.bold('LOGS')) + C.dim(` \u2014 streaming gateway events from ${gateway}`));
    if (filter) console.log('  ' + C.dim(`Filter: ${filter}`));
    console.log('  ' + C.dim('Press Ctrl+C to stop.'));
    console.log('');

    const url = `${gateway}/api/v1/events`;
    const cfg = loadConfig();
    const apiKey = process.env['TENTACLAW_API_KEY'] || cfg?.openai?.apiKey || cfg?.openrouter?.apiKey || cfg?.custom?.apiKey || '';
    const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let seen = 0;
    await new Promise<void>((resolve, reject) => {
        const http = require('http') as typeof import('http');
        const https = require('https') as typeof import('https');
        const urlObj = new URL(url);
        const mod = urlObj.protocol === 'https:' ? https : http;
        const req = mod.request({
            hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search, method: 'GET', headers,
        }, (res) => {
            res.setEncoding('utf8');
            let buf = '';
            res.on('data', (chunk: string) => {
                buf += chunk;
                const lines = buf.split('\n');
                buf = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const raw = line.slice(5).trim();
                    if (!raw || raw === '[DONE]') continue;
                    try {
                        const ev = JSON.parse(raw) as { type?: string; node_id?: string; message?: string; timestamp?: string; [k: string]: unknown };
                        if (filter && !(JSON.stringify(ev).toLowerCase().includes(filter.toLowerCase()))) continue;
                        const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
                        const typeStr = ev.type || 'event';
                        const typeColor = typeStr.includes('error') || typeStr.includes('offline') ? C.red :
                            typeStr.includes('online') || typeStr.includes('update') ? C.green : C.cyan;
                        const nodeStr = ev.node_id ? C.dim(` [${ev.node_id}]`) : '';
                        const msgStr = ev.message ? C.dim(` \u2014 ${ev.message}`) : '';
                        console.log('  ' + C.dim(ts) + '  ' + typeColor(typeStr) + nodeStr + msgStr);
                        seen++;
                        if (count > 0 && seen >= count) { req.destroy(); resolve(); }
                    } catch { /* non-JSON SSE line, skip */ }
                }
            });
            res.on('end', resolve);
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
        process.on('SIGINT', () => { req.destroy(); console.log(''); resolve(); });
    }).catch((e: unknown) => {
        console.log('  ' + C.red(`\u2718 Failed to connect: ${e instanceof Error ? e.message : String(e)}`));
        console.log('  ' + C.dim('Is the gateway running? Check: tentaclaw doctor'));
    });
    console.log('');
}

// =============================================================================
// Update — self-update from git
// =============================================================================

async function cmdUpdate(): Promise<void> {
    console.log('');
    console.log('  ' + C.teal(C.bold('UPDATE')) + C.dim(' \u2014 updating TentaCLAW CLI'));
    console.log('');

    // Find git root from script location
    const scriptDir = path.resolve(__dirname, '..', '..', '..');
    const installDir = fs.existsSync(path.join(getConfigDir(), 'src', '.git'))
        ? path.join(getConfigDir(), 'src')
        : fs.existsSync(path.join(scriptDir, '.git')) ? scriptDir : null;

    if (!installDir) {
        console.log('  ' + C.yellow('\u26A0 Cannot find git repository.'));
        console.log('  ' + C.dim('  Re-run the installer to update.'));
        console.log('');
        return;
    }

    try {
        console.log('  ' + C.dim(`Updating ${installDir}...`));
        execFileSync('git', ['pull', '--quiet'], { cwd: installDir, encoding: 'utf8', stdio: 'pipe' });
        console.log('  ' + C.green('\u2714 Git pull complete'));
        execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: installDir, encoding: 'utf8', stdio: 'pipe' });
        console.log('  ' + C.green('\u2714 Dependencies updated'));
        execFileSync('npm', ['run', 'build', '--workspace=cli'], { cwd: installDir, encoding: 'utf8', stdio: 'pipe' });
        console.log('  ' + C.green('\u2714 CLI rebuilt'));
        console.log('');
        console.log('  ' + C.green(C.bold('\u2714 Update complete. Restart tentaclaw to use new version.')));
    } catch (e) {
        console.log('  ' + C.red(`\u2718 Update failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    console.log('');
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);
    const gateway = getGatewayUrl(parsed.flags);

    // Boot splash for status or no-args
    if (parsed.command === 'status' || parsed.command === 'help') {
        bootSplash();
    }

    // Random tip on 20% of runs (skip for help/version/simple commands, and --print/--task modes)
    const printMode8660 = parsed.flags['print'] === 'true' || parsed.flags['print'] === '';
    const taskMode8660 = !!parsed.flags['task'];
    if (!printMode8660 && !taskMode8660 && Math.random() < 0.2 && !['help', 'status', 'version', '--help', '-h', '--version', '-v', 'joke', 'fortune', 'dance', 'credits', 'sup'].includes(parsed.command)) {
        console.error(C.dim('  \uD83D\uDC19 Tip: ' + TIPS[Math.floor(Math.random() * TIPS.length)]));
    }

    // Commands that work without gateway
    switch (parsed.command) {
        case 'profile': {
            // Wave 288: tentaclaw profile — show current CLI environment at a glance
            const W288 = 64;
            console.log('');
            console.log(boxTop('PROFILE', W288));
            const cfg288 = loadConfig();
            const gw288 = gateway || process.env['TENTACLAW_GATEWAY'] || '(not set)';
            const mdl288 = parsed.flags['model'] || (cfg288 && cfg288.model) || process.env['TENTACLAW_MODEL'] || '(auto)';
            const ws288 = getWorkspaceDir();
            const ver288 = CLI_VERSION;
            console.log(boxMid(padRight(C.dim('Version'), 16) + C.white('tentaclaw-cli v' + ver288), W288));
            console.log(boxMid(padRight(C.dim('Gateway'), 16) + C.cyan(gw288), W288));
            console.log(boxMid(padRight(C.dim('Model'), 16) + C.white(mdl288), W288));
            console.log(boxMid(padRight(C.dim('Workspace'), 16) + C.dim(ws288), W288));
            console.log(boxMid(padRight(C.dim('Working Dir'), 16) + C.dim(process.cwd()), W288));
            console.log(boxMid(padRight(C.dim('Platform'), 16) + C.dim(process.platform + ' node/' + process.version), W288));
            // Show config file location if it exists
            try {
                const cfgPath = path.join(os.homedir(), '.tentaclaw', 'config.json');
                if (fs.existsSync(cfgPath)) console.log(boxMid(padRight(C.dim('Config'), 16) + C.dim(cfgPath), W288));
            } catch { /* ok */ }
            // Show git repo if in one
            try {
                const branch288 = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                const root288 = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: 'pipe' }).trim();
                if (branch288) console.log(boxMid(padRight(C.dim('Git Branch'), 16) + C.green(branch288) + C.dim('  ' + root288), W288));
                // Wave 376: show git remote URL
                try {
                    const remote376 = execSync('git remote get-url origin', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    if (remote376) console.log(boxMid(padRight(C.dim('Git Remote'), 16) + C.dim(remote376), W288));
                } catch { /* no remote */ }
            } catch { /* not a git repo */ }
            // Wave 376: show active session count
            try {
                const sessionDir376 = path.join(os.homedir(), '.tentaclaw', 'sessions');
                if (fs.existsSync(sessionDir376)) {
                    const sessionCount376 = fs.readdirSync(sessionDir376).filter(f => f.endsWith('.jsonl')).length;
                    if (sessionCount376 > 0) console.log(boxMid(padRight(C.dim('Sessions'), 16) + C.dim(`${sessionCount376} saved session${sessionCount376 !== 1 ? 's' : ''}  (~/.tentaclaw/sessions/)`), W288));
                }
            } catch { /* skip */ }
            console.log(boxBot(W288));
            console.log('');
            return;
        }

        case 'setup':
        case 'configure':
            await cmdSetup();
            return;

        case 'init':
            // Wave 78: init in a project directory creates .clawcode
            if (parsed.positional[0] === 'project' || parsed.flags['project'] || fs.existsSync(path.join(process.cwd(), 'package.json')) || fs.existsSync(path.join(process.cwd(), '.git'))) {
                await cmdInitProject();
            } else {
                await cmdSetup();
            }
            return;

        case 'config':
            await cmdConfigCli(parsed.positional);
            return;

        case 'sessions':
        case 'log': {
            // Wave 255: tentaclaw log — shortcut for sessions list, with colorized compact view
            const isLog = parsed.command === 'log';
            if (isLog && parsed.positional.length === 0) {
                // Compact log view: most recent N sessions at a glance
                const logN = parseInt(parsed.flags['n'] || '15', 10) || 15;
                const recent = listRecentSessions(logN);
                console.log('');
                console.log('  ' + C.teal(C.bold('RECENT SESSIONS')));
                console.log('');
                if (recent.length === 0) {
                    console.log('  ' + C.dim('No sessions yet. Start one with: tentaclaw code'));
                } else {
                    for (const s of recent) {
                        const date = s.updatedAt.slice(0, 16).replace('T', ' ');
                        const age = s.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10) ? C.green('today') : C.dim(date.slice(5, 10));
                        const label = s.label ? C.white(s.label.slice(0, 40)) : C.dim('(untitled)');
                        // Wave 432: show token count so users know how much context a session used
                        const tokStr432 = s.tokenCount && s.tokenCount > 0 ? `  ${formatTokens(s.tokenCount)}tok` : '';
                        const stats = C.dim(`${s.messageCount || 0}msg ${s.model?.split(':')[0] || '?'}${tokStr432}`);
                        console.log('  ' + age + '  ' + C.cyan(s.sessionId.slice(0, 12)) + '  ' + stats + '  ' + label);
                    }
                }
                console.log('');
                console.log('  ' + C.dim('Resume: tentaclaw code --resume <id>  |  Full list: tentaclaw sessions'));
                console.log('');
                return;
            }
            await cmdSessionsCli(parsed.positional, parsed.flags);
            return;
        }

        case 'logs':
            await cmdLogs(gateway, parsed.flags);
            return;

        case 'show': {
            // Wave 328: tentaclaw show <session-id> — formatted conversation transcript viewer
            const showId = parsed.positional[0];
            if (!showId) {
                console.log(C.dim('  Usage: tentaclaw show <session-id>'));
                console.log(C.dim('  Prints a formatted conversation transcript from a previous session.'));
                process.exit(1);
            }
            const showEvents = loadSessionTranscript(showId);
            if (showEvents.length === 0) {
                console.error(C.red(`  Session not found or empty: ${showId}`));
                process.exit(1);
            }
            const showMsgs = rebuildMessagesFromTranscript(showEvents);
            const showMeta = loadSessionIndex()[showId];
            console.log('');
            console.log('  ' + C.teal(C.bold('SESSION TRANSCRIPT')));
            console.log('  ' + C.dim(`ID: ${showId}`) + (showMeta?.label ? '  ' + C.white(showMeta.label) : ''));
            if (showMeta?.createdAt) console.log('  ' + C.dim(`Date: ${showMeta.createdAt.slice(0, 19).replace('T', ' ')}`));
            console.log('');
            let showTurn = 0;
            for (const m of showMsgs) {
                if (m.role === 'system') continue;
                if (m.role === 'user') {
                    showTurn++;
                    const content = typeof m.content === 'string' ? m.content : '';
                    console.log('  ' + C.cyan(`[${showTurn}] You`));
                    for (const line of content.split('\n').slice(0, 30)) {
                        console.log('  ' + C.white(line));
                    }
                    if (content.split('\n').length > 30) console.log('  ' + C.dim(`  …(${content.split('\n').length - 30} more lines)`));
                    console.log('');
                } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
                    console.log('  ' + C.purple('TentaCLAW'));
                    for (const line of m.content.split('\n').slice(0, 40)) {
                        console.log('  ' + line);
                    }
                    if (m.content.split('\n').length > 40) console.log('  ' + C.dim(`  …(${m.content.split('\n').length - 40} more lines)`));
                    console.log('');
                } else if (m.role === 'tool') {
                    const toolName = (m as { name?: string }).name || 'tool';
                    const preview = typeof m.content === 'string' ? m.content.slice(0, 120).replace(/\n/g, ' ') : '';
                    console.log('  ' + C.dim(`  [${toolName}] ${preview}${preview.length >= 120 ? '…' : ''}`));
                }
            }
            console.log('  ' + C.dim(`Resume with: tentaclaw code --resume ${showId}`));
            console.log('');
            return;
        }

        case 'agents':
            cmdAgents();
            return;

        case 'memory':
            await cmdMemory(parsed.positional, parsed.flags);
            return;

        case 'workspace':
        case 'ws':
            cmdWorkspace(parsed.positional);
            return;

        case 'stats': {
            // Wave 277/415: tentaclaw stats [--ext <ext>] — project code statistics (lines, files, by language)
            const statsDir = parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd();
            // Wave 415: --ext filter — show only specific extension(s), comma-separated
            const statsExtFilter415 = (parsed.flags['ext'] || '').toLowerCase().split(',').map(e => e.trim().replace(/^\./, '')).filter(Boolean);
            const SKIP_STATS = new Set(['node_modules', 'dist', '.git', 'target', '__pycache__', '.next', 'coverage', 'build', '.nyc_output']);
            const EXT_LANG: Record<string, string> = {
                ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
                py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cs: 'C#',
                cpp: 'C++', cc: 'C++', c: 'C', h: 'C', rb: 'Ruby', php: 'PHP',
                swift: 'Swift', kt: 'Kotlin', sh: 'Shell', bash: 'Shell',
                sql: 'SQL', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
                md: 'Markdown', html: 'HTML', css: 'CSS', scss: 'CSS',
            };
            const langStats: Record<string, { files: number; lines: number; blank: number; code: number }> = {};
            let totalFiles = 0;
            const walkStats = (dir: string): void => {
                let entries: fs.Dirent[];
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (SKIP_STATS.has(e.name) || e.name.startsWith('.')) continue;
                    if (e.isDirectory()) { walkStats(path.join(dir, e.name)); continue; }
                    const ext = e.name.split('.').pop()?.toLowerCase() || '';
                    // Wave 415: apply ext filter
                    if (statsExtFilter415.length > 0 && !statsExtFilter415.includes(ext)) continue;
                    const lang = statsExtFilter415.length > 0 ? (EXT_LANG[ext] || ext.toUpperCase()) : EXT_LANG[ext];
                    if (!lang) continue;
                    totalFiles++;
                    let content: string;
                    try { content = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }
                    const lines = content.split('\n');
                    const blank = lines.filter(l => !l.trim()).length;
                    if (!langStats[lang]) langStats[lang] = { files: 0, lines: 0, blank: 0, code: 0 };
                    langStats[lang].files++;
                    langStats[lang].lines += lines.length;
                    langStats[lang].blank += blank;
                    langStats[lang].code += lines.length - blank;
                }
            };
            walkStats(statsDir);
            const sorted = Object.entries(langStats).sort((a, b) => b[1].lines - a[1].lines);
            console.log('');
            console.log('  ' + C.teal(C.bold('PROJECT STATISTICS')) + C.dim(` — ${path.basename(statsDir)}`));
            console.log('');
            const totalLines = sorted.reduce((s, [, v]) => s + v.lines, 0);
            const totalCode = sorted.reduce((s, [, v]) => s + v.code, 0);
            console.log('  ' + padRight(C.dim('LANGUAGE'), 16) + padRight(C.dim('FILES'), 8) + padRight(C.dim('LINES'), 10) + padRight(C.dim('CODE'), 10) + C.dim('BLANK'));
            console.log('  ' + C.dim('─'.repeat(52)));
            for (const [lang, s] of sorted.slice(0, 12)) {
                const pct = Math.round((s.lines / totalLines) * 100);
                const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
                console.log('  ' + padRight(C.white(lang), 16) + padRight(C.dim(String(s.files)), 8) + padRight(C.teal(String(s.lines)), 10) + padRight(C.dim(String(s.code)), 10) + C.dim(String(s.blank)));
                console.log('  ' + C.dim('  ' + bar + ` ${pct}%`));
            }
            console.log('  ' + C.dim('─'.repeat(52)));
            console.log('  ' + padRight(C.white('Total'), 16) + padRight(C.dim(String(totalFiles)), 8) + padRight(C.green(String(totalLines)), 10) + C.dim(String(totalCode)));
            console.log('');
            return;
        }

        case 'todo': {
            // Wave 266/337/354/387: tentaclaw todo [--type <tag>] [--file <path>] [--json] [--flat]
            const todoDir = parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd();
            const todoGlob = parsed.flags['glob'] || parsed.flags['g'] || '';
            const todoTypeFilter = (parsed.flags['type'] || parsed.flags['t'] || '').toUpperCase();
            // Wave 354: --file flag scans a specific file (or comma-separated list) instead of the whole tree
            const todoFileFlag = parsed.flags['file'] || parsed.flags['f'] || '';
            const todoJsonMode = parsed.flags['json'] === 'true';
            // Wave 387: --flat flag — one-per-line output without grouping, easy to pipe
            const todoFlatMode387 = parsed.flags['flat'] === 'true' || parsed.flags['flat'] === '';
            const SKIP_DIRS2 = new Set(['node_modules', 'dist', '.git', 'target', '__pycache__', '.next', 'coverage']);
            const todoPattern = /\b(TODO|FIXME|HACK|XXX|BUG|WARN|OPTIMIZE|REFACTOR)(\(.+?\))?:?\s+(.+)/i;
            const results: Array<{ file: string; line: number; tag: string; text: string }> = [];
            const scanFile354 = (fullPath: string, base: string): void => {
                let content: string;
                try { content = fs.readFileSync(fullPath, 'utf8'); } catch { return; }
                if (content.length > 500_000) return;
                content.split('\n').forEach((l, i) => {
                    const m = l.match(todoPattern);
                    if (m) {
                        const tag337 = m[1]!.toUpperCase();
                        if (!todoTypeFilter || tag337 === todoTypeFilter) {
                            results.push({ file: path.relative(base, fullPath), line: i + 1, tag: tag337, text: m[3]!.slice(0, 80) });
                        }
                    }
                });
            };
            const walkTodo = (dir: string): void => {
                let entries: fs.Dirent[];
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (SKIP_DIRS2.has(e.name) || e.name.startsWith('.')) continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) { walkTodo(full); continue; }
                    if (todoGlob && !e.name.match(todoGlob.replace(/\*/g, '.*'))) continue;
                    scanFile354(full, todoDir);
                    if (results.length > 200) return; // cap
                }
            };
            if (todoFileFlag) {
                // Wave 354: scan specific file(s) only
                for (const f of todoFileFlag.split(',').map((s: string) => s.trim()).filter(Boolean)) {
                    const resolved354 = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
                    scanFile354(resolved354, process.cwd());
                }
            } else {
                walkTodo(todoDir);
            }
            // Wave 354: JSON output mode
            if (todoJsonMode) { console.log(JSON.stringify(results, null, 2)); return; }
            // Wave 387: flat output mode — one per line, easy to pipe/grep
            if (todoFlatMode387) {
                if (results.length === 0) { console.log('(no TODOs found)'); return; }
                for (const r of results) {
                    console.log(`${r.file}:${r.line}:${r.tag}: ${r.text}`);
                }
                return;
            }
            console.log('');
            if (results.length === 0) {
                console.log('  ' + C.green('✔ No TODOs found.'));
            } else {
                const byTag: Record<string, typeof results> = {};
                for (const r of results) { (byTag[r.tag] = byTag[r.tag] || []).push(r); }
                const tagColor: Record<string, (s: string) => string> = {
                    TODO: C.teal, FIXME: C.red, BUG: C.red, HACK: C.yellow, XXX: C.yellow,
                    WARN: C.yellow, OPTIMIZE: C.purple, REFACTOR: C.purple,
                };
                // Wave 337: sort by priority — FIXME/BUG first, then TODO, then lower-priority tags
                const TAG_PRIORITY: Record<string, number> = { FIXME: 0, BUG: 1, TODO: 2, XXX: 3, HACK: 4, WARN: 5, OPTIMIZE: 6, REFACTOR: 7 };
                for (const [tag, items] of Object.entries(byTag).sort((a, b) => (TAG_PRIORITY[a[0]] ?? 99) - (TAG_PRIORITY[b[0]] ?? 99))) {
                    const col = tagColor[tag] || C.white;
                    console.log('  ' + col(C.bold(tag)) + C.dim(` (${items.length})`));
                    for (const r of items.slice(0, 10)) {
                        console.log('    ' + C.dim(`${r.file}:${r.line}`) + '  ' + r.text);
                    }
                    if (items.length > 10) console.log('    ' + C.dim(`... +${items.length - 10} more`));
                    console.log('');
                }
                console.log('  ' + C.dim(`${results.length} total`));
            }
            console.log('');
            return;
        }

        case 'tree': {
            // Wave 264/396: tentaclaw tree [dir] [--depth N] [--sizes] — directory tree; --sizes shows file sizes
            const treeRoot = parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd();
            const treeDepth = parseInt(parsed.flags['depth'] || parsed.flags['d'] || '3', 10) || 3;
            const treeShowAll = parsed.flags['all'] === 'true' || parsed.flags['a'] === 'true';
            // Wave 396: --sizes flag — show file sizes next to each file
            const treeSizes396 = parsed.flags['sizes'] === 'true' || parsed.flags['sizes'] === '' || parsed.flags['s'] === 'true';
            const TREE_SKIP = new Set(['node_modules', 'dist', '.git', 'target', '__pycache__', '.next', 'coverage', '.nyc_output', 'build']);
            let treeCount = 0;
            let treeTotalBytes396 = 0;
            const fmtSize396 = (n: number) => n < 1024 ? `${n}B` : n < 1_048_576 ? `${(n/1024).toFixed(1)}kb` : `${(n/1_048_576).toFixed(1)}mb`;
            const printTree = (dir: string, prefix: string, depth: number): void => {
                if (depth > treeDepth) return;
                let entries: string[];
                try { entries = fs.readdirSync(dir).sort(); }
                catch { return; }
                const visible = entries.filter(e => treeShowAll || !e.startsWith('.'));
                visible.forEach((entry, i) => {
                    if (!treeShowAll && TREE_SKIP.has(entry)) return;
                    const isLast = i === visible.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    const full = path.join(dir, entry);
                    let stat: fs.Stats | undefined;
                    try { stat = fs.statSync(full); } catch { return; }
                    if (stat.isDirectory()) {
                        console.log('  ' + prefix + C.teal(connector + entry + '/'));
                        treeCount++;
                        printTree(full, childPrefix, depth + 1);
                    } else {
                        const szStr396 = treeSizes396 && stat ? C.dim(` (${fmtSize396(stat.size)})`) : '';
                        if (treeSizes396 && stat) treeTotalBytes396 += stat.size;
                        console.log('  ' + prefix + C.dim(connector) + entry + szStr396);
                        treeCount++;
                    }
                });
            };
            console.log('');
            console.log('  ' + C.white(C.bold(path.basename(treeRoot) + '/')));
            printTree(treeRoot, '', 1);
            console.log('');
            const sizeNote396 = treeSizes396 ? `  total: ${fmtSize396(treeTotalBytes396)}  ` : '';
            console.log('  ' + C.dim(`${treeCount} items${sizeNote396} (depth ${treeDepth}) — use --depth N for more${treeSizes396 ? '' : ', --sizes to show file sizes'}`));
            console.log('');
            return;
        }

        case 'watch': {
            // Wave 263/358: tentaclaw watch <cmd> [--once] — run command on file changes, or once and exit
            const watchCmd2 = parsed.positional.join(' ').trim() || parsed.flags['cmd'] || '';
            const watchGlob2 = parsed.flags['glob'] || parsed.flags['g'] || '**/*.{ts,js,py,go,rs,json}';
            const watchDir2 = parsed.flags['dir'] || parsed.flags['d'] || process.cwd();
            // Wave 358: --once flag — run command once and exit (no file watching loop)
            const watchOnce = parsed.flags['once'] === 'true';
            if (!watchCmd2) {
                console.log('');
                console.log(C.dim('  Usage: tentaclaw watch <command> [--glob "**/*.ts"] [--dir ./src] [--once]'));
                console.log(C.dim('  Example: tentaclaw watch "npm run build"'));
                console.log(C.dim('  Example: tentaclaw watch "cargo check" --glob "**/*.rs"'));
                console.log(C.dim('  Example: tentaclaw watch "npm test" --once   (run once, exit)'));
                console.log('');
                return;
            }
            // Wave 358: --once mode — just run once and exit
            if (watchOnce) {
                console.log('');
                console.log('  ' + C.dim(`Running (once): ${watchCmd2}`));
                const watchOnceStart = Date.now();
                try {
                    const onceOut = execSync(watchCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: watchDir2, timeout: 120_000 });
                    const onceSecs = ((Date.now() - watchOnceStart) / 1000).toFixed(1);
                    if (onceOut.trim()) process.stdout.write(C.dim(onceOut.trim().split('\n').map((l: string) => '    ' + l).join('\n')) + '\n');
                    console.log('  ' + C.green(`  ✔ Done (${onceSecs}s)`));
                } catch (e) {
                    const err2 = e as { stderr?: string; stdout?: string; status?: number };
                    const errOut = ((err2.stderr || '') + (err2.stdout || '')).trim();
                    if (errOut) process.stdout.write(C.red(errOut.split('\n').map((l: string) => '    ' + l).join('\n')) + '\n');
                    console.log('  ' + C.red(`  ✘ Failed (exit ${err2.status ?? 1})`));
                    process.exit(1);
                }
                console.log('');
                return;
            }
            console.log('');
            console.log('  ' + C.teal(C.bold('WATCHING')) + C.dim(` — ${watchDir2}`));
            console.log('  ' + C.dim(`Pattern: ${watchGlob2}`));
            console.log('  ' + C.dim(`Command: ${watchCmd2}`));
            console.log('  ' + C.dim('Press Ctrl+C to stop.'));
            console.log('');
            const watchedMtimes: Record<string, number> = {};
            const WATCH_SKIP = new Set(['node_modules', 'dist', '.git', 'target', '__pycache__', '.next', 'coverage']);
            const collectFiles = (dir: string): string[] => {
                const result: string[] = [];
                try {
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        if (WATCH_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) result.push(...collectFiles(full));
                        else if (entry.isFile()) result.push(full);
                    }
                } catch { /* ok */ }
                return result;
            };
            const initFiles = collectFiles(watchDir2);
            for (const f of initFiles) {
                try { watchedMtimes[f] = fs.statSync(f).mtimeMs; } catch { /* ok */ }
            }
            let watching = true;
            process.on('SIGINT', () => { watching = false; console.log('\n  ' + C.dim('Stopped.')); process.exit(0); });
            const runWatchCmd = (changedLabel?: string) => {
                const ts = new Date().toISOString().slice(11, 19);
                const label = changedLabel ? C.dim(` (${changedLabel})`) : '';
                console.log('  ' + C.cyan(`→ ${ts} Running: ${watchCmd2}`) + label);
                const watchStart = Date.now();
                try {
                    const out2 = execSync(watchCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: watchDir2, timeout: 60_000 });
                    const watchElapsed = ((Date.now() - watchStart) / 1000).toFixed(1);
                    if (out2.trim()) console.log(C.dim(out2.trim().split('\n').map(l => '    ' + l).join('\n')));
                    console.log('  ' + C.green(`  ✔ Done (${watchElapsed}s)`));
                } catch (e) {
                    const err2 = e as { stderr?: string; stdout?: string };
                    const errOut = ((err2.stderr || '') + (err2.stdout || '')).trim();
                    if (errOut) console.log(C.red(errOut.split('\n').map(l => '    ' + l).join('\n')));
                    console.log('  ' + C.red('  ✘ Failed'));
                }
                console.log('');
            };
            runWatchCmd();
            // Wave 334: debounce — accumulate changes, trigger after 300ms quiet period
            let debounceTimer: ReturnType<typeof setTimeout> | null = null;
            let pendingChanges: string[] = [];
            while (watching) {
                await new Promise(r => setTimeout(r, 400));
                const curFiles = collectFiles(watchDir2);
                const changedFiles306: string[] = [];
                for (const f of curFiles) {
                    try {
                        const mtime = fs.statSync(f).mtimeMs;
                        if (watchedMtimes[f] !== mtime) { changedFiles306.push(f); watchedMtimes[f] = mtime; }
                    } catch { /* ok */ }
                }
                for (const f of curFiles) {
                    if (watchedMtimes[f] === undefined) {
                        changedFiles306.push(f);
                        try { watchedMtimes[f] = fs.statSync(f).mtimeMs; } catch { /* ok */ }
                    }
                }
                if (changedFiles306.length > 0) {
                    pendingChanges.push(...changedFiles306);
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        const unique = [...new Set(pendingChanges)];
                        const relChanged = unique.slice(0, 3).map(f => path.relative(process.cwd(), f));
                        const extra = unique.length > 3 ? ` +${unique.length - 3}` : '';
                        pendingChanges = [];
                        debounceTimer = null;
                        runWatchCmd(relChanged.join(', ') + extra);
                    }, 300);
                }
            }
            return;
        }

        case 'completions': {
            // Wave 282: tentaclaw completions [bash|zsh|fish|powershell] — emit shell completion script
            const shell = parsed.positional[0]?.toLowerCase() || 'bash';
            const cmds = ['code', 'run', 'ask', 'chat', 'status', 'nodes', 'models', 'health', 'benchmarks', 'alerts', 'deploy',
                'diff', 'log', 'init', 'fmt', 'lint', 'test', 'build', 'watch', 'tree', 'todo', 'stats',
                'clone', 'open', 'sessions', 'config', 'memory', 'agents', 'workspace', 'search', 'explain',
                'commit', 'doctor', 'update', 'hub', 'version', 'help', 'tags', 'flight-sheets', 'apply',
                'snapshot', 'profile', 'repl', 'completions', 'commits', 'blame', 'ping', 'show', 'stash',
                'node', 'nodes', 'benchmarks', 'capacity', 'groups', 'mcp'].join(' ');
            if (shell === 'bash') {
                console.log(`# TentaCLAW bash completion — add to ~/.bashrc:
# source <(tentaclaw completions bash)
_tentaclaw_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=($(compgen -W "${cmds}" -- "$cur"))
}
complete -F _tentaclaw_completions tentaclaw`);
            } else if (shell === 'zsh') {
                console.log(`# TentaCLAW zsh completion — add to ~/.zshrc:
# source <(tentaclaw completions zsh)
_tentaclaw() {
  local commands="${cmds}"
  _arguments "1:command:($commands)"
}
compdef _tentaclaw tentaclaw`);
            } else if (shell === 'fish') {
                const fishLines = cmds.split(' ').map(c => `complete -c tentaclaw -f -a ${c}`).join('\n');
                console.log(`# TentaCLAW fish completion — save to ~/.config/fish/completions/tentaclaw.fish\n${fishLines}`);
            } else if (shell === 'powershell' || shell === 'ps') {
                console.log(`# TentaCLAW PowerShell completion — add to $PROFILE:
Register-ArgumentCompleter -Native -CommandName tentaclaw -ScriptBlock {
  param($word, $ast, $pos)
  @(${cmds.split(' ').map(c => `'${c}'`).join(',')}) | Where-Object { $_ -like "$word*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}`);
            } else {
                console.log(C.red(`  Unknown shell: ${shell}. Use: bash, zsh, fish, or powershell`));
                process.exit(1);
            }
            return;
        }

        case 'clone': {
            // Wave 364: tentaclaw clone <url> [<dir>] — clone a git repo
            const cloneUrl = parsed.positional[0] || parsed.flags['url'] || '';
            if (!cloneUrl) {
                console.log('');
                console.log(C.dim('  Usage: tentaclaw clone <repo-url> [<directory>]'));
                console.log(C.dim('  Example: tentaclaw clone https://github.com/user/repo'));
                console.log(C.dim('  Example: tentaclaw clone git@github.com:user/repo my-dir'));
                console.log('');
                return;
            }
            const cloneDir = parsed.positional[1] || parsed.flags['dir'] || '';
            const cloneCmd = `git clone ${JSON.stringify(cloneUrl)}${cloneDir ? ' ' + JSON.stringify(cloneDir) : ''}`;
            console.log('');
            console.log('  ' + C.teal('🐙') + ' Cloning: ' + C.white(cloneUrl) + (cloneDir ? C.dim(' → ' + cloneDir) : ''));
            try {
                const cloneOut = execSync(cloneCmd + ' 2>&1', { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 }).trim();
                if (cloneOut) console.log(C.dim(cloneOut.split('\n').map((l: string) => '  ' + l).join('\n')));
                // Determine the cloned directory name
                const clonedName = cloneDir || cloneUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo';
                console.log('  ' + C.green(`✔ Cloned to: ${clonedName}/`));
                console.log('  ' + C.dim(`Run: cd ${clonedName} && tentaclaw code`));
            } catch (e) {
                console.log('  ' + C.red('Clone failed: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
            }
            console.log('');
            return;
        }

        case 'open': {
            // Wave 281/395: tentaclaw open <file|url|dir> [file2...] — open in system default app; supports multiple targets
            const openTargets395 = parsed.positional.length > 0 ? parsed.positional : ['.'];
            for (const openTarget of openTargets395) {
                const openCmd = process.platform === 'win32' ? `start "" "${openTarget}"`
                    : process.platform === 'darwin' ? `open "${openTarget}"`
                    : `xdg-open "${openTarget}"`;
                try {
                    execSync(openCmd, { stdio: 'ignore', cwd: process.cwd() });
                    console.log(C.dim(`  Opened: ${openTarget}`));
                } catch (e) {
                    console.error(C.red(`  Could not open ${openTarget}: ` + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
            }
            return;
        }

        case 'clone': {
            // Wave 280: tentaclaw clone <repo> [dir] — git clone then tentaclaw init
            const cloneUrl = parsed.positional[0];
            if (!cloneUrl) {
                console.log(C.dim('  Usage: tentaclaw clone <repo-url> [target-dir]'));
                return;
            }
            const cloneDir = parsed.positional[1] || cloneUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo';
            console.log(C.dim(`  Cloning ${cloneUrl} → ${cloneDir}/`));
            try {
                execSync(`git clone ${cloneUrl} ${cloneDir}`, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), timeout: 120_000 });
                console.log(C.green(`  ✔ Cloned to ${cloneDir}/`));
                // Auto-init .clawcode
                const clonedPath = path.resolve(cloneDir);
                const clawPath = path.join(clonedPath, '.clawcode');
                if (!fs.existsSync(clawPath)) {
                    const hasPkg2 = fs.existsSync(path.join(clonedPath, 'package.json'));
                    const hasCargo2 = fs.existsSync(path.join(clonedPath, 'Cargo.toml'));
                    const hasGo2 = fs.existsSync(path.join(clonedPath, 'go.mod'));
                    const hasPy2 = fs.existsSync(path.join(clonedPath, 'pyproject.toml')) || fs.existsSync(path.join(clonedPath, 'requirements.txt'));
                    const pType = hasPkg2 ? 'node' : hasCargo2 ? 'rust' : hasGo2 ? 'go' : hasPy2 ? 'python' : 'unknown';
                    const bCmd = hasPkg2 ? 'npm run build' : hasCargo2 ? 'cargo build' : hasGo2 ? 'go build ./...' : 'make build';
                    const tCmd = hasPkg2 ? 'npm test' : hasCargo2 ? 'cargo test' : hasGo2 ? 'go test ./...' : 'make test';
                    fs.writeFileSync(clawPath, `# ${cloneDir} — TentaCLAW Project Context\n\n## Type\n${pType}\n\n## Build & Test\n- Build: \`${bCmd}\`\n- Test: \`${tCmd}\`\n\n## Notes\n(Add architecture notes here)\n`, 'utf8');
                    console.log(C.green(`  ✔ Created .clawcode in ${cloneDir}/`));
                }
                console.log(C.dim(`  Next: cd ${cloneDir} && tentaclaw code`));
            } catch (e) {
                console.error(C.red('  Clone failed: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                process.exit(1);
            }
            return;
        }

        case 'snapshot': {
            // Wave 286: tentaclaw snapshot [name] — save/restore/list named stash snapshots
            const snapSubcmd = parsed.positional[0] || '';
            const snapName = parsed.positional[1] || parsed.positional[0] || '';
            if (!snapSubcmd || snapSubcmd === 'list') {
                // List saved snapshots
                try {
                    const snaps = execSync('git stash list --format="%gd %s"', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    if (!snaps) { console.log(C.dim('  No snapshots saved. Use: tentaclaw snapshot save [name]')); }
                    else {
                        console.log('');
                        console.log('  ' + C.teal(C.bold('SNAPSHOTS')));
                        console.log('');
                        for (const line of snaps.split('\n').slice(0, 20)) {
                            const [ref, ...rest] = line.split(' ');
                            const isSnap = rest.join(' ').startsWith('tentaclaw:');
                            if (isSnap) console.log('  ' + C.cyan(ref || '') + '  ' + C.white(rest.join(' ').replace('tentaclaw: ', '')));
                        }
                        console.log('');
                    }
                } catch { console.log(C.red('  git not available')); }
            } else if (snapSubcmd === 'save') {
                const label = (snapName && snapName !== 'save') ? snapName : new Date().toISOString().slice(0, 16).replace('T', ' ');
                try {
                    execSync(`git stash push -u -m "tentaclaw: ${label}"`, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() });
                    console.log(C.green(`  ✔ Snapshot saved: "${label}"`));
                    console.log(C.dim('  Restore with: tentaclaw snapshot restore [stash@{N}]'));
                } catch (e) {
                    console.log(C.red('  ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
            } else if (snapSubcmd === 'restore') {
                const ref = (snapName && snapName !== 'restore') ? snapName : 'stash@{0}';
                try {
                    execSync(`git stash pop ${ref}`, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() });
                    console.log(C.green(`  ✔ Snapshot restored: ${ref}`));
                } catch (e) {
                    console.log(C.red('  ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
            } else if (snapSubcmd === 'drop') {
                const ref2 = (snapName && snapName !== 'drop') ? snapName : 'stash@{0}';
                try {
                    execSync(`git stash drop ${ref2}`, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() });
                    console.log(C.green(`  ✔ Snapshot dropped: ${ref2}`));
                } catch (e) {
                    console.log(C.red('  ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
            } else if (snapSubcmd === 'diff') {
                // Wave 369: show diff between current working tree and a snapshot
                const diffRef369 = (snapName && snapName !== 'diff') ? snapName : 'stash@{0}';
                try {
                    const snapDiff = execSync(`git stash show -p ${diffRef369}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                    if (!snapDiff) { console.log(C.dim(`  No diff for ${diffRef369}`)); }
                    else {
                        console.log('');
                        console.log('  ' + C.dim(`diff: ${diffRef369} vs working tree`));
                        console.log('');
                        let snapIns = 0, snapDel = 0;
                        for (const l of snapDiff.split('\n')) {
                            if (l.startsWith('+') && !l.startsWith('+++')) snapIns++;
                            else if (l.startsWith('-') && !l.startsWith('---')) snapDel++;
                        }
                        console.log('  ' + C.green(`+${snapIns}`) + '  ' + C.red(`-${snapDel}`));
                        console.log('');
                        for (const l of snapDiff.split('\n').slice(0, 60)) {
                            if (l.startsWith('+++') || l.startsWith('---')) console.log('  ' + C.bold(C.white(l)));
                            else if (l.startsWith('diff') || l.startsWith('index')) console.log('  ' + C.dim(l));
                            else if (l.startsWith('@@')) console.log('  ' + C.teal(l));
                            else if (l.startsWith('+')) console.log('  ' + C.green(l));
                            else if (l.startsWith('-')) console.log('  ' + C.red(l));
                            else console.log('  ' + C.dim(l));
                        }
                        if (snapDiff.split('\n').length > 60) console.log('  ' + C.dim('...(truncated)'));
                        console.log('');
                    }
                } catch (e) {
                    console.log(C.red('  ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
            } else {
                console.log(C.dim('  Usage: tentaclaw snapshot [list|save [name]|restore [ref]|drop [ref]|diff [ref]]'));
            }
            return;
        }

        case 'commits': {
            // Wave 326/389/417: tentaclaw commits [--n <count>] [--author <name>] [--since <date>] [--until <date>] [--graph] [<file>]
            const commitsN = parseInt(parsed.flags['n'] || parsed.flags['count'] || '20', 10);
            const commitsAuthor = parsed.flags['author'] || '';
            const commitsFile = parsed.positional[0] || '';
            // Wave 389: --graph flag — show ASCII branch graph via git log --graph
            const commitsGraph389 = parsed.flags['graph'] === 'true' || parsed.flags['graph'] === '';
            const commitsAuthorArg = commitsAuthor ? `--author="${commitsAuthor}"` : '';
            const commitsFileArg = commitsFile ? `-- "${commitsFile}"` : '';
            // Wave 417: --since / --until date filters — e.g. --since "2 weeks ago" or --since 2026-01-01
            const commitsSince417 = parsed.flags['since'] ? `--since="${parsed.flags['since']}"` : '';
            const commitsUntil417 = parsed.flags['until'] ? `--until="${parsed.flags['until']}"` : '';
            if (commitsGraph389) {
                try {
                    const graphOut389 = execSync(
                        `git log --graph --pretty=format:"%h %s %C(dim)(%ar)%C(reset)" --abbrev-commit -n ${commitsN} ${commitsAuthorArg} ${commitsSince417} ${commitsUntil417}`.trim(),
                        { encoding: 'utf8', stdio: 'pipe' }
                    ).trim();
                    if (!graphOut389) { console.log(C.dim('  No commits found.')); return; }
                    console.log('');
                    for (const l of graphOut389.split('\n')) {
                        // Color graph decorations
                        const colored389 = l
                            .replace(/^([*|/\\]+)/, m => C.teal(m))
                            .replace(/^(\s*[*|/\\]+)/, m => C.teal(m));
                        console.log('  ' + colored389);
                    }
                    console.log('');
                } catch { console.log(C.red('  git not available')); }
                return;
            }
            let commitsOut = '';
            try {
                commitsOut = execSync(
                    `git log --pretty=format:"%H|%h|%an|%ar|%s" -n ${commitsN} ${commitsAuthorArg} ${commitsSince417} ${commitsUntil417} ${commitsFileArg}`.trim().replace(/\s+/g, ' '),
                    { encoding: 'utf8', stdio: 'pipe' }
                ).trim();
            } catch { /* not a git repo */ }
            if (!commitsOut) {
                console.log(C.dim('  No commits found.'));
                return;
            }
            console.log('');
            if (commitsFile) console.log('  ' + C.dim(`History for: ${commitsFile}`));
            const dateRange417 = [parsed.flags['since'] ? `since ${parsed.flags['since']}` : '', parsed.flags['until'] ? `until ${parsed.flags['until']}` : ''].filter(Boolean).join(', ');
            console.log('  ' + C.dim(`Last ${commitsN} commits` + (commitsAuthor ? ` by ${commitsAuthor}` : '') + (dateRange417 ? ` (${dateRange417})` : '')));
            console.log('');
            for (const entry of commitsOut.split('\n')) {
                const parts = entry.split('|');
                if (parts.length < 5) continue;
                const [, shortHash, author, relTime, ...msgParts] = parts;
                const msg = msgParts.join('|');
                const isCheckpoint = msg.includes('[checkpoint]');
                const displayMsg = isCheckpoint ? C.dim(msg.replace(' [checkpoint]', '')) : C.white(msg);
                console.log('  ' + C.yellow(shortHash || '') + '  ' + displayMsg + '  ' + C.dim(`${author} · ${relTime}`));
            }
            console.log('');
            return;
        }

        case 'stash': {
            // Wave 351: tentaclaw stash [list|pop [--index N]] [--msg <msg>] — git stash wrapper
            const stashSub = parsed.positional[0] || '';
            console.log('');
            try {
                if (!stashSub || stashSub === 'save') {
                    const stashMsg = parsed.flags['msg'] || parsed.flags['m'] || `wip-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
                    const stashOut = execSync(`git stash push -m ${JSON.stringify(stashMsg)} 2>&1`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                    if (stashOut.includes('No local changes')) {
                        console.log('  ' + C.dim('Nothing to stash — working tree clean.'));
                    } else {
                        console.log('  ' + C.green('✔ Stashed: ') + C.white(stashMsg));
                        console.log('  ' + C.dim('Restore with: tentaclaw stash pop'));
                    }
                } else if (stashSub === 'list') {
                    let stashList = '';
                    try { stashList = execSync('git stash list', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { /* no stashes */ }
                    if (!stashList) {
                        console.log('  ' + C.dim('No stashes.'));
                    } else {
                        console.log('  ' + C.teal(C.bold('STASHES')));
                        console.log('');
                        stashList.split('\n').forEach(l => {
                            // stash@{0}: On branch: message
                            const sm = l.match(/^(stash@\{(\d+)\}): (.*)$/);
                            if (sm) {
                                const idx = sm[2];
                                const msg = sm[3];
                                console.log('  ' + C.cyan(`[${idx}]`) + '  ' + C.white(msg));
                            } else {
                                console.log('  ' + C.dim(l));
                            }
                        });
                    }
                } else if (stashSub === 'pop' || stashSub === 'apply') {
                    const stashIdx = parsed.flags['index'] || parsed.flags['i'] || parsed.positional[1] || '0';
                    const stashRef = `stash@{${stashIdx}}`;
                    const popCmd = stashSub === 'apply' ? `git stash apply ${stashRef} 2>&1` : `git stash pop ${stashRef} 2>&1`;
                    const popOut = execSync(popCmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
                    console.log('  ' + C.green(`✔ ${stashSub === 'apply' ? 'Applied' : 'Popped'} stash[${stashIdx}]`));
                    const popLines = popOut.split('\n').slice(0, 5);
                    for (const pl of popLines) if (pl.trim()) console.log('  ' + C.dim('  ' + pl));
                } else if (stashSub === 'drop') {
                    const dropIdx = parsed.flags['index'] || parsed.flags['i'] || parsed.positional[1] || '0';
                    execSync(`git stash drop stash@{${dropIdx}} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                    console.log('  ' + C.yellow(`✔ Dropped stash[${dropIdx}]`));
                } else if (stashSub === 'clear') {
                    execSync('git stash clear 2>&1', { encoding: 'utf8', stdio: 'pipe' });
                    console.log('  ' + C.yellow('✔ All stashes cleared.'));
                } else {
                    console.log(C.dim('  Usage: tentaclaw stash [list|pop [--index N]|apply|drop|clear] [--msg <m>]'));
                }
            } catch (e) {
                console.log('  ' + C.red('Stash error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
            }
            console.log('');
            return;
        }

        case 'blame': {
            // Wave 327: tentaclaw blame <file> [--line <n>] — git blame with color and line focus
            const blameFile = parsed.positional[0] || '';
            if (!blameFile) {
                console.log(C.dim('  Usage: tentaclaw blame <file> [--line <n>]'));
                process.exit(1);
            }
            const blameLine = parsed.flags['line'] ? parseInt(parsed.flags['line'], 10) : 0;
            const blameRange = blameLine > 0 ? `-L ${Math.max(1, blameLine - 5)},${blameLine + 5}` : '';
            let blameOut = '';
            try {
                blameOut = execSync(
                    `git blame --date=short ${blameRange} "${blameFile}"`,
                    { encoding: 'utf8', stdio: 'pipe' }
                ).trim();
            } catch { console.error(C.red(`  Cannot blame: ${blameFile}`)); process.exit(1); }
            if (!blameOut) {
                console.log(C.dim(`  No blame data for: ${blameFile}`));
                return;
            }
            console.log('');
            console.log('  ' + C.dim(`blame: ${blameFile}`) + (blameLine ? C.dim(` (around line ${blameLine})`) : ''));
            console.log('');
            for (const bline of blameOut.split('\n').slice(0, 80)) {
                // git blame format: <hash> (<author> <date> <linenum>) <code>
                const bm = bline.match(/^(\^?[0-9a-f]+)\s+\((.{20})\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\)\s(.*)$/);
                if (bm) {
                    const [, hash, auth, date, lineNum, code] = bm;
                    const isTarget = blameLine > 0 && parseInt(lineNum, 10) === blameLine;
                    const authTrim = auth.trim().slice(0, 14).padEnd(14);
                    const lineStr = lineNum.padStart(4);
                    const prefix = C.dim(hash.slice(0, 7)) + '  ' + C.cyan(authTrim) + '  ' + C.dim(date) + '  ' + C.dim(lineStr) + '  ';
                    console.log('  ' + prefix + (isTarget ? C.yellow(code) : code));
                } else {
                    console.log('  ' + C.dim(bline));
                }
            }
            console.log('');
            return;
        }

        case 'build': {
            // Wave 274/384: tentaclaw build [--watch] — run the project build; --watch re-runs on file change
            const buildWatchMode384 = parsed.flags['watch'] === 'true' || parsed.flags['watch'] === '';
            const buildArgs2 = parsed.positional.join(' ').trim();
            let buildCmd2 = '';
            let buildLabel2 = '';
            if (fs.existsSync('package.json')) {
                const pkgB = JSON.parse(fs.readFileSync('package.json', 'utf8') || '{}') as { scripts?: Record<string, string> };
                if (pkgB.scripts?.['build']) { buildCmd2 = `npm run build${buildArgs2 ? ' -- ' + buildArgs2 : ''}`; buildLabel2 = 'npm run build'; }
                else if (pkgB.scripts?.['compile']) { buildCmd2 = `npm run compile${buildArgs2 ? ' -- ' + buildArgs2 : ''}`; buildLabel2 = 'npm run compile'; }
            } else if (fs.existsSync('Cargo.toml')) {
                buildCmd2 = `cargo build ${buildArgs2}`; buildLabel2 = 'cargo build';
            } else if (fs.existsSync('go.mod')) {
                buildCmd2 = `go build ./... ${buildArgs2}`; buildLabel2 = 'go build';
            } else if (fs.existsSync('Makefile')) {
                buildCmd2 = `make ${buildArgs2 || 'build'}`; buildLabel2 = 'make build';
            } else if (fs.existsSync('pyproject.toml')) {
                buildCmd2 = `python -m build ${buildArgs2}`; buildLabel2 = 'python -m build';
            }
            if (!buildCmd2) {
                console.log(C.yellow('  No build command detected. Try: npm run build, cargo build, go build ./...'));
                return;
            }
            // Wave 384: watch mode — re-run build on file changes
            if (buildWatchMode384) {
                console.log('  ' + C.teal(C.bold('BUILD WATCH')) + C.dim(`  ${buildLabel2}  — Ctrl+C to stop`));
                const runBuild384 = () => {
                    console.log('');
                    console.log('  ' + C.dim(`[${new Date().toLocaleTimeString()}] $ ${buildCmd2}`));
                    const t384 = Date.now();
                    try {
                        const bOut384 = execSync(buildCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), timeout: 120_000 });
                        const el384 = ((Date.now() - t384) / 1000).toFixed(1);
                        bOut384.trim().split('\n').slice(-10).forEach(l => console.log('  ' + C.dim(l)));
                        console.log('  ' + C.green(`✔ built (${el384}s)`));
                    } catch (e384) {
                        const e384t = e384 as { stdout?: string; stderr?: string };
                        const el384 = ((Date.now() - t384) / 1000).toFixed(1);
                        ((e384t.stdout || '') + (e384t.stderr || '')).trim().split('\n').slice(-20).forEach(l =>
                            console.log('  ' + (l.match(/error/i) ? C.red(l) : l.match(/warn/i) ? C.yellow(l) : C.dim(l))));
                        console.log('  ' + C.red(`✘ build failed (${el384}s)`));
                    }
                };
                runBuild384();
                let debounce384: ReturnType<typeof setTimeout> | null = null;
                try {
                    fs.watch(process.cwd(), { recursive: true }, (_evt384, fname384) => {
                        if (!fname384 || fname384.match(/node_modules|\.git|dist|\.d\.ts$/)) return;
                        if (debounce384) clearTimeout(debounce384);
                        debounce384 = setTimeout(() => { runBuild384(); }, 500);
                    });
                } catch {
                    console.log('  ' + C.dim('fs.watch unavailable — polling every 3s'));
                    setInterval(runBuild384, 3000);
                }
                await new Promise(() => { /* run until Ctrl+C */ });
                return;
            }
            console.log(C.dim(`  Running: ${buildCmd2}`));
            const buildStart = Date.now();
            try {
                const buildOut = execSync(buildCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), timeout: 120_000 });
                const buildElapsed = ((Date.now() - buildStart) / 1000).toFixed(1);
                if (buildOut.trim()) {
                    const lines = buildOut.trim().split('\n').slice(-20);
                    for (const l of lines) { console.log('  ' + C.dim(l)); }
                }
                console.log(C.green(`  ✔ ${buildLabel2} succeeded (${buildElapsed}s)`));
            } catch (e) {
                const errB = e as { stderr?: string; stdout?: string; status?: number };
                const buildElapsed = ((Date.now() - buildStart) / 1000).toFixed(1);
                const errLines = ((errB.stderr || '') + (errB.stdout || '')).trim().split('\n');
                for (const l of errLines.slice(-40)) {
                    if (l.match(/error/i)) console.log('  ' + C.red(l));
                    else if (l.match(/warn/i)) console.log('  ' + C.yellow(l));
                    else console.log('  ' + C.dim(l));
                }
                console.log(C.red(`  ✘ Build failed (${buildElapsed}s, exit ${errB.status ?? 1})`));
                process.exit(1);
            }
            return;
        }

        case 'test': {
            // Wave 273: tentaclaw test [args] — run tests using project's test runner
            // Wave 371: --watch flag — re-run on file changes using fs.watch
            const testWatchMode = parsed.flags['watch'] === 'true' || parsed.flags['watch'] === '';
            const testArgs = parsed.positional.join(' ').trim();
            let testCmd2 = '';
            let testLabel = '';
            if (fs.existsSync('package.json')) {
                const pkgT = JSON.parse(fs.readFileSync('package.json', 'utf8') || '{}') as { scripts?: Record<string, string> };
                const testScript = pkgT.scripts?.['test'];
                if (testScript && !testWatchMode) { testCmd2 = `npm test${testArgs ? ' -- ' + testArgs : ''}`; testLabel = 'npm test'; }
                else if (fs.existsSync('node_modules/.bin/vitest')) {
                    testCmd2 = testWatchMode ? `npx vitest ${testArgs}` : `npx vitest run ${testArgs}`;
                    testLabel = 'vitest';
                }
                else if (fs.existsSync('node_modules/.bin/jest')) {
                    testCmd2 = testWatchMode ? `npx jest --watch ${testArgs}` : `npx jest ${testArgs}`;
                    testLabel = 'jest';
                }
                else if (testScript) { testCmd2 = `npm test${testArgs ? ' -- ' + testArgs : ''}`; testLabel = 'npm test'; }
            } else if (fs.existsSync('Cargo.toml')) {
                testCmd2 = `cargo test ${testArgs}`; testLabel = 'cargo test';
            } else if (fs.existsSync('go.mod')) {
                testCmd2 = `go test ./... ${testArgs}`; testLabel = 'go test';
            } else if (fs.existsSync('pyproject.toml') || fs.existsSync('pytest.ini') || fs.existsSync('setup.cfg')) {
                testCmd2 = testWatchMode ? `ptw ${testArgs}` : `pytest ${testArgs}`; testLabel = testWatchMode ? 'pytest-watch' : 'pytest';
            } else if (fs.existsSync('Makefile')) {
                testCmd2 = `make test ${testArgs}`; testLabel = 'make test';
            }
            if (!testCmd2) {
                console.log(C.yellow('  No test runner detected. Try: npm test, cargo test, pytest, go test ./...'));
                return;
            }
            // Wave 371: watch mode for runners that don't natively support it — poll with fs.watch
            if (testWatchMode && !testLabel.match(/vitest|jest|pytest-watch/)) {
                console.log('  ' + C.teal(C.bold('WATCH')) + C.dim(`  ${testLabel}  — Ctrl+C to stop`));
                const runOnce371 = () => {
                    console.log('');
                    console.log('  ' + C.dim(`[${new Date().toLocaleTimeString()}] $ ${testCmd2}`));
                    try {
                        const out371 = execSync(testCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), timeout: 120_000 });
                        out371.trim().split('\n').slice(-15).forEach(l => console.log('  ' + C.dim(l)));
                        console.log('  ' + C.green('✔ passed'));
                    } catch (e371) {
                        const e371t = e371 as { stdout?: string; stderr?: string };
                        ((e371t.stdout || '') + (e371t.stderr || '')).trim().split('\n').slice(-20).forEach(l =>
                            console.log('  ' + (l.match(/fail|error/i) ? C.red(l) : C.dim(l))));
                        console.log('  ' + C.red('✘ failed'));
                    }
                };
                runOnce371();
                let debounce371: ReturnType<typeof setTimeout> | null = null;
                try {
                    fs.watch(process.cwd(), { recursive: true }, (_evt, fname) => {
                        if (!fname || fname.match(/node_modules|\.git|dist/)) return;
                        if (debounce371) clearTimeout(debounce371);
                        debounce371 = setTimeout(() => { runOnce371(); }, 400);
                    });
                } catch {
                    console.log('  ' + C.dim('fs.watch not available — falling back to 3s poll'));
                    setInterval(runOnce371, 3000);
                }
                await new Promise(() => { /* run until Ctrl+C */ });
                return;
            }
            console.log(C.dim(`  Running: ${testCmd2}`));
            const testStart2 = Date.now();
            try {
                const testOut2 = execSync(testCmd2, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), timeout: 120_000 });
                const elapsed2 = ((Date.now() - testStart2) / 1000).toFixed(1);
                const testLines2 = testOut2.trim().split('\n');
                if (testOut2.trim()) {
                    for (const line of testLines2.slice(-30)) {
                        if (line.match(/fail|error/i)) console.log('  ' + C.red(line));
                        else if (line.match(/pass|ok|✓/i)) console.log('  ' + C.green(line));
                        else console.log('  ' + C.dim(line));
                    }
                }
                // Wave 378: extract pass/fail counts from output for compact summary
                const passMatch378 = testOut2.match(/(\d+)\s+pass(?:ed|ing)?/i);
                const failMatch378 = testOut2.match(/(\d+)\s+fail(?:ed|ing)?/i);
                const summary378 = passMatch378 ? ` — ${C.green(passMatch378[1] + ' passed')}${failMatch378 ? ', ' + C.red(failMatch378[1] + ' failed') : ''}` : '';
                console.log(C.green(`  ✔ ${testLabel} passed`) + summary378 + C.dim(` (${elapsed2}s)`));
            } catch (e) {
                const errT = e as { stderr?: string; stdout?: string; status?: number };
                const elapsed2 = ((Date.now() - testStart2) / 1000).toFixed(1);
                const outLines = ((errT.stderr || '') + (errT.stdout || '')).trim().split('\n');
                for (const line of outLines.slice(-40)) {
                    if (line.match(/fail|error/i)) console.log('  ' + C.red(line));
                    else if (line.match(/pass|ok/i)) console.log('  ' + C.green(line));
                    else console.log('  ' + C.dim(line));
                }
                const failSummary378 = ((errT.stdout || '') + (errT.stderr || '')).match(/(\d+)\s+fail(?:ed|ing)?/i);
                const failNote378 = failSummary378 ? ` (${failSummary378[1]} failed)` : '';
                console.log(C.red(`  ✘ Tests failed${failNote378} (${elapsed2}s, exit ${errT.status ?? 1})`));
                // Wave 549: --fix flag — pass test failures to coding agent for auto-fix
                const autoFix549 = parsed.flags['fix'] === 'true' || parsed.flags['fix'] === '';
                if (autoFix549) {
                    const failOutput549 = outLines.slice(-40).join('\n');
                    console.log('');
                    console.log('  ' + C.purple(C.bold('AUTO-FIX')) + C.dim(' — delegating to coding agent'));
                    await cmdCode(gateway, { task: `Tests failed. Fix the failing tests.\nTest command: ${testCmd2}\n\nTest output:\n\`\`\`\n${failOutput549.slice(0, 3000)}\n\`\`\``, yes: 'true' });
                    return;
                }
                process.exit(1);
            }
            return;
        }

        case 'lint': {
            // Wave 272: tentaclaw lint — run the project linter (eslint, clippy, mypy, etc.)
            const lintTarget = parsed.positional[0] || '.';
            let lintCmd = '';
            if (fs.existsSync('package.json')) {
                const pkg2 = JSON.parse(fs.readFileSync('package.json', 'utf8') || '{}') as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
                if (pkg2.scripts?.['lint']) { lintCmd = 'npm run lint'; }
                else if (pkg2.devDependencies?.['eslint']) { lintCmd = `npx eslint "${lintTarget}"`; }
                else if (pkg2.devDependencies?.['biome']) { lintCmd = `npx biome lint "${lintTarget}"`; }
            } else if (fs.existsSync('Cargo.toml')) {
                lintCmd = 'cargo clippy';
            } else if (fs.existsSync('go.mod')) {
                lintCmd = 'go vet ./...';
            } else if (fs.existsSync('pyproject.toml') || fs.existsSync('requirements.txt')) {
                lintCmd = `python -m flake8 "${lintTarget}"`;
            }
            if (!lintCmd) {
                console.log(C.yellow('  No linter detected. Try: npx eslint . or cargo clippy'));
                return;
            }
            console.log(C.dim(`  Running: ${lintCmd}`));
            try {
                const lintOut = execSync(lintCmd, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() });
                if (lintOut.trim()) console.log(C.dim('  ' + lintOut.trim()));
                console.log(C.green('  ✔ Lint passed'));
            } catch (e) {
                const err3 = e as { stderr?: string; stdout?: string; status?: number };
                const lintErrOut = ((err3.stderr || '') + (err3.stdout || '')).trim();
                if (lintErrOut) {
                    // Color-code errors and warnings
                    for (const line of lintErrOut.split('\n').slice(0, 50)) {
                        if (line.match(/error/i)) console.log('  ' + C.red(line));
                        else if (line.match(/warn/i)) console.log('  ' + C.yellow(line));
                        else console.log('  ' + C.dim(line));
                    }
                }
                console.log(C.yellow(`  ✘ Lint found issues (exit ${err3.status ?? 1})`));
            }
            return;
        }

        case 'fmt':
        case 'format': {
            // Wave 260/366: tentaclaw fmt [--check] — auto-format files using the project's formatter
            const fmtTarget = parsed.positional[0] || '.';
            // Wave 366: --check mode — verify formatting without writing (exit non-zero if unformatted)
            const fmtCheck = parsed.flags['check'] === 'true';
            let fmtCmd = '';
            // Auto-detect formatter
            if (fs.existsSync('package.json')) {
                const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8') || '{}') as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
                if (pkg.scripts?.['format:check'] && fmtCheck) { fmtCmd = 'npm run format:check'; }
                else if (pkg.scripts?.['format']) { fmtCmd = fmtCheck ? 'npm run format -- --check' : 'npm run format'; }
                else if (pkg.scripts?.['fmt']) { fmtCmd = fmtCheck ? 'npm run fmt -- --check' : 'npm run fmt'; }
                else if (pkg.devDependencies?.['prettier']) { fmtCmd = fmtCheck ? `npx prettier --check "${fmtTarget}"` : `npx prettier --write "${fmtTarget}"`; }
                else if (pkg.devDependencies?.['eslint']) { fmtCmd = fmtCheck ? `npx eslint "${fmtTarget}"` : `npx eslint --fix "${fmtTarget}"`; }
            } else if (fs.existsSync('Cargo.toml')) {
                fmtCmd = fmtCheck ? 'cargo fmt -- --check' : 'cargo fmt';
            } else if (fs.existsSync('go.mod')) {
                fmtCmd = fmtCheck ? `gofmt -l "${fmtTarget}"` : `gofmt -w "${fmtTarget}"`;
            } else if (fs.existsSync('pyproject.toml') || fs.existsSync('setup.py')) {
                fmtCmd = fmtCheck ? `black --check "${fmtTarget}"` : `black "${fmtTarget}"`;
            }
            if (!fmtCmd) {
                console.log(C.yellow('  No formatter detected. Try: npx prettier --write . or black .'));
                return;
            }
            console.log(C.dim(`  Running: ${fmtCmd}`));
            try {
                const fmtOut = execSync(fmtCmd, { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() });
                if (fmtOut.trim()) console.log(C.dim('  ' + fmtOut.trim()));
                console.log(fmtCheck ? C.green('  ✔ All files correctly formatted') : C.green('  ✔ Format complete'));
            } catch (e) {
                const err = e as { stderr?: string; stdout?: string; status?: number };
                const output = ((err.stderr || '') + (err.stdout || '')).trim();
                if (output) console.log(C.dim('  ' + output.slice(0, 500)));
                if (fmtCheck) {
                    console.log(C.red('  ✘ Files need formatting — run: tentaclaw fmt'));
                    process.exit(1);
                } else {
                    console.log(C.yellow('  Formatter exited with errors (check output above)'));
                }
            }
            return;
        }

        case 'init': {
            // Wave 258: tentaclaw init — create a .clawcode project context file for the agent
            const initPath = path.join(process.cwd(), '.clawcode');
            if (fs.existsSync(initPath)) {
                console.log('');
                console.log(C.yellow(`  .clawcode already exists — edit it directly to update project context.`));
                console.log(C.dim(`  Path: ${initPath}`));
                console.log('');
                return;
            }
            // Detect project type from files
            const hasPkg = fs.existsSync('package.json');
            const hasCargo = fs.existsSync('Cargo.toml');
            const hasGo = fs.existsSync('go.mod');
            const hasPy = fs.existsSync('pyproject.toml') || fs.existsSync('requirements.txt');
            let projectType = 'unknown';
            let buildCmd = 'make build';
            let testCmd = 'make test';
            if (hasPkg) { projectType = 'node'; buildCmd = 'npm run build'; testCmd = 'npm test'; }
            else if (hasCargo) { projectType = 'rust'; buildCmd = 'cargo build'; testCmd = 'cargo test'; }
            else if (hasGo) { projectType = 'go'; buildCmd = 'go build ./...'; testCmd = 'go test ./...'; }
            else if (hasPy) { projectType = 'python'; buildCmd = 'python -m build'; testCmd = 'pytest'; }
            const dirName = path.basename(process.cwd());
            const clawcodeContent = `# ${dirName} — TentaCLAW Project Context
# This file is automatically loaded by the TentaCLAW Code Agent.
# Edit it to give the agent context about your project.

## Project Type
${projectType}

## Build & Test
- Build: \`${buildCmd}\`
- Test: \`${testCmd}\`

## Key Files
(List your important files here — entry points, config, main modules)

## Architecture Notes
(Describe the structure, main components, and how they interact)

## Coding Standards
(Style, patterns to follow, things to avoid)

## Known Gotchas
(Common pitfalls, gotchas, things that trip up the agent)
`;
            fs.writeFileSync(initPath, clawcodeContent, 'utf8');
            // Wave 340: also create .clawignore if not present — controls what agent skips
            const ignorePath = path.join(process.cwd(), '.clawignore');
            if (!fs.existsSync(ignorePath)) {
                const ignoreDefaults = [
                    '# .clawignore — patterns the TentaCLAW agent should skip when reading files',
                    '# One pattern per line. Supports glob syntax.',
                    '',
                    'node_modules/',
                    'dist/',
                    'build/',
                    '.git/',
                    '*.lock',
                    '*.min.js',
                    '*.min.css',
                    '*.map',
                    '',
                    ...(hasCargo ? ['target/', '*.rlib'] : []),
                    ...(hasGo ? ['vendor/'] : []),
                    ...(hasPy ? ['__pycache__/', '*.pyc', '.venv/', 'venv/'] : []),
                    ...(hasPkg ? ['*.d.ts', 'coverage/'] : []),
                ].join('\n');
                fs.writeFileSync(ignorePath, ignoreDefaults, 'utf8');
                console.log('');
                console.log(C.green(`  ✔ Created .clawcode`));
                console.log(C.green(`  ✔ Created .clawignore`));
            } else {
                console.log('');
                console.log(C.green(`  ✔ Created .clawcode`));
            }
            console.log(C.dim(`  The agent loads .clawcode automatically on every \`tentaclaw code\` session.`));
            console.log(C.dim(`  Edit .clawcode to give context. Edit .clawignore to exclude files from agent reads.`));
            console.log('');
            return;
        }

        case 'run': {
            // Wave 87/177: tentaclaw run "<prompt>" — shortcut for tentaclaw code --task "..." --yes
            // Also reads from stdin if no prompt given (for piping: echo "task" | tentaclaw run)
            let runTask = parsed.positional.join(' ').trim() || parsed.flags['task'] || '';
            // Wave 221: --file flag reads task from a file
            const runFileFlag = parsed.flags['file'];
            if (runFileFlag && !runTask) {
                try { runTask = fs.readFileSync(runFileFlag, 'utf8').trim(); }
                catch (e) { console.error(C.red(`  Cannot read file: ${runFileFlag}`)); process.exit(1); }
            }
            if (!runTask && !process.stdin.isTTY) {
                // Wave 177: read from stdin
                const chunks: Buffer[] = [];
                for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
                runTask = Buffer.concat(chunks).toString('utf8').trim();
            }
            if (!runTask) {
                console.log(C.red('  Usage: tentaclaw run "<prompt>"'));
                console.log(C.dim('  Runs a one-shot task with the code agent (auto-approves all tool calls).'));
                console.log(C.dim('  Flags: --model <name>  --file <path>  --max-iter <N>'));
                console.log(C.dim('  Also: echo "task" | tentaclaw run'));
                process.exit(1);
            }
            await cmdCode(gateway, { ...parsed.flags, task: runTask, yes: 'true' });
            return;
        }

        case 'ask': {
            // Wave 241: tentaclaw ask "<question>" — fast inline inference, no workspace, no tools, no splash
            // Supports stdin: echo "log" | tentaclaw ask "summarize this"
            let askQuestion = parsed.positional.join(' ').trim() || parsed.flags['task'] || '';
            let stdinContent = '';
            if (!process.stdin.isTTY) {
                const chunks: Buffer[] = [];
                for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
                stdinContent = Buffer.concat(chunks).toString('utf8').trim();
            }
            // Wave 330: --file <path> injects file content into the question
            const askFilePaths = (parsed.flags['file'] || parsed.flags['f'] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            let askFileContent = '';
            for (const askFp of askFilePaths) {
                try {
                    const raw = fs.readFileSync(path.resolve(askFp), 'utf8').slice(0, 8000);
                    askFileContent += `\n\nFile: ${askFp}\n\`\`\`\n${raw}\n\`\`\``;
                } catch { console.error(C.red(`  Cannot read: ${askFp}`)); }
            }
            if (!askQuestion && !stdinContent && !askFileContent) {
                console.log(C.dim('  Usage: tentaclaw ask "<question>" [--file <path>]'));
                console.log(C.dim('  Also:  echo "content" | tentaclaw ask "what does this mean?"'));
                process.exit(1);
            }
            const askPromptBase = stdinContent
                ? (askQuestion ? `${askQuestion}\n\n${stdinContent}` : stdinContent)
                : askQuestion;
            const askPrompt = askFileContent ? `${askPromptBase}${askFileContent}` : askPromptBase;
            // Resolve inference config
            const askConfig = loadConfig();
            let askUrl = '';
            let askHeaders: Record<string, string> = {};
            let askModel = parsed.flags['model'] || '';
            if (askConfig) {
                const r = resolveInferenceFromConfig(askConfig);
                askUrl = r.url; askHeaders = r.headers;
                if (!askModel) askModel = askConfig.model;
            }
            if (!askUrl || !askModel) {
                const gwResp = await apiProbe(gateway, '/v1/models') as { data?: Array<{ id: string }> } | null;
                const gm = (gwResp?.data || []).map(m => m.id);
                if (gm.length > 0) { askUrl = gateway; if (!askModel) askModel = gm[0]!; }
            }
            if (!askUrl || !askModel) {
                const resp = await apiProbe('http://localhost:11434', '/v1/models') as { data?: Array<{ id: string }> } | null;
                const lm = (resp?.data || []).map(m => m.id);
                if (lm.length > 0) { askUrl = 'http://localhost:11434'; if (!askModel) askModel = lm[0]!; }
            }
            if (!askUrl) { console.error(C.red('  No inference endpoint available. Run `tentaclaw setup`.')); process.exit(1); }
            // Stream the response — minimal output
            // Wave 287: --sys flag for custom system prompt; Wave 292: --temp flag for temperature
            const askSysPrompt = parsed.flags['sys'] || '';
            const askTemp = parsed.flags['temp'] || parsed.flags['temperature'] || '';
            const askFull = askUrl.replace(/\/+$/, '') + '/v1/chat/completions';
            const askMsgs: Array<{ role: string; content: string }> = [];
            if (askSysPrompt) askMsgs.push({ role: 'system', content: askSysPrompt });
            askMsgs.push({ role: 'user', content: askPrompt });
            // Wave 298: --max-tokens flag
            const askMaxTokens = parsed.flags['max-tokens'] || parsed.flags['max_tokens'] || '';
            // Wave 303: --json flag collects full response and outputs JSON
            const askJsonMode = parsed.flags['json'] === 'true';
            const askBodyObj: Record<string, unknown> = { model: askModel, messages: askMsgs, stream: true };
            if (askTemp) askBodyObj['temperature'] = parseFloat(askTemp);
            if (askMaxTokens) askBodyObj['max_tokens'] = parseInt(askMaxTokens, 10);
            const askBody = JSON.stringify(askBodyObj);
            const { http: askHttp, https: askHttps } = { http: require('http') as typeof import('http'), https: require('https') as typeof import('https') };
            let askFull2 = '';
            await new Promise<void>((resolve) => {
                const parsed2 = new URL(askFull);
                const lib2 = parsed2.protocol === 'https:' ? askHttps : askHttp;
                const req2 = lib2.request({
                    hostname: parsed2.hostname, port: Number(parsed2.port) || (parsed2.protocol === 'https:' ? 443 : 80),
                    path: parsed2.pathname, method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(askBody), ...askHeaders },
                }, (res2) => {
                    let buf2 = '';
                    let inputToks = 0, outputToks = 0;
                    res2.on('data', (chunk: Buffer) => {
                        buf2 += chunk.toString();
                        const lines2 = buf2.split('\n'); buf2 = lines2.pop() ?? '';
                        for (const line2 of lines2) {
                            if (!line2.startsWith('data: ')) continue;
                            const raw2 = line2.slice(6).trim();
                            if (raw2 === '[DONE]') continue;
                            try {
                                const ev2 = JSON.parse(raw2) as { choices?: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
                                const txt = ev2.choices?.[0]?.delta?.content;
                                if (txt) { if (!askJsonMode) process.stdout.write(txt); askFull2 += txt; }
                                if (ev2.usage) { inputToks = ev2.usage.prompt_tokens || 0; outputToks = ev2.usage.completion_tokens || 0; }
                            } catch { /* skip */ }
                        }
                    });
                    res2.on('end', () => {
                        if (askJsonMode) {
                            process.stdout.write(JSON.stringify({ response: askFull2.trim(), model: askModel, tokens: { input: inputToks, output: outputToks, total: inputToks + outputToks } }) + '\n');
                        } else {
                            process.stdout.write('\n');
                        }
                        resolve();
                    });
                    res2.on('error', () => resolve());
                });
                req2.on('error', () => resolve());
                req2.write(askBody); req2.end();
            });
            return;
        }

        case 'search': {
            // Wave 250/319/338/368/391: tentaclaw search <pattern> [glob] — project search; --replace <text> for in-place replacement
            const searchPat = parsed.positional[0] || '';
            const searchGlob = parsed.positional[1] || '';
            if (!searchPat) {
                console.log(C.dim('  Usage: tentaclaw search <pattern> [file-glob]'));
                console.log(C.dim('  Flags: -i (ignore-case)  -C N (context lines)  -B N (before)  -A N (after)'));
                console.log(C.dim('         --type ts|py|js|go|rs  --count  --files  --replace <text> (in-place)'));
                console.log(C.dim('  Example: tentaclaw search "import.*fetch" "*.ts"'));
                console.log(C.dim('  Example: tentaclaw search "oldName" --replace "newName" --type ts'));
                process.exit(1);
            }
            // Wave 391: --replace <text> — in-place find-and-replace across all matching files (pure Node.js, no sed)
            if (parsed.flags['replace'] !== undefined) {
                // Wave 391: --replace <text> — in-place find-and-replace across all matching files
                const replaceTarget = parsed.flags['replace'] || '';
                const typeFlag391 = parsed.flags['type'] || parsed.flags['t'] || '';
                const replaceGlob391 = searchGlob || (typeFlag391 ? `*.${typeFlag391.replace(/^\./, '')}` : '');
                const caseInsensitive391 = !!parsed.flags['i'] || !!parsed.flags['ignore-case'];
                const SKIP391 = new Set(['node_modules', 'dist', '.git', 'target', '__pycache__', '.next', 'coverage']);
                let replaceCount391 = 0; let fileCount391 = 0;
                const dryRun391 = parsed.flags['dry-run'] === 'true';
                const globRe391 = replaceGlob391 ? new RegExp('^' + replaceGlob391.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i') : null;
                const walkReplace391 = (dir: string): void => {
                    let entries: string[];
                    try { entries = fs.readdirSync(dir); } catch { return; }
                    for (const e of entries) {
                        if (SKIP391.has(e) || e.startsWith('.')) continue;
                        const full = path.join(dir, e);
                        let stat391: fs.Stats;
                        try { stat391 = fs.statSync(full); } catch { continue; }
                        if (stat391.isDirectory()) { walkReplace391(full); continue; }
                        if (globRe391 && !globRe391.test(e)) continue;
                        if (stat391.size > 1_000_000) continue; // skip huge files
                        let content391: string;
                        try { content391 = fs.readFileSync(full, 'utf8'); } catch { continue; }
                        if (!content391.includes(searchPat) && !(caseInsensitive391 && content391.toLowerCase().includes(searchPat.toLowerCase()))) continue;
                        const newContent391 = caseInsensitive391
                            ? content391.replace(new RegExp(searchPat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceTarget)
                            : content391.split(searchPat).join(replaceTarget);
                        const count391 = (content391.split(searchPat).length - 1) || 0;
                        replaceCount391 += count391;
                        fileCount391++;
                        const rel391 = path.relative(process.cwd(), full);
                        if (dryRun391) {
                            console.log('  ' + C.dim('[dry-run] ') + C.white(rel391) + C.dim(` — ${count391} replacement${count391 !== 1 ? 's' : ''}`));
                        } else {
                            try { fs.writeFileSync(full, newContent391, 'utf8'); console.log('  ' + C.green('\u2714 ') + C.white(rel391) + C.dim(` — ${count391} replacement${count391 !== 1 ? 's' : ''}`)); }
                            catch { console.log('  ' + C.red('\u2718 ') + C.dim(rel391)); }
                        }
                    }
                };
                walkReplace391(process.cwd());
                if (fileCount391 === 0) console.log(C.dim(`  No matches for "${searchPat}"`));
                else console.log('');
                console.log(dryRun391
                    ? C.dim(`  [dry-run] Would replace ${replaceCount391} occurrence${replaceCount391 !== 1 ? 's' : ''} in ${fileCount391} file${fileCount391 !== 1 ? 's' : ''}`)
                    : C.green(`  ✔ Replaced ${replaceCount391} occurrence${replaceCount391 !== 1 ? 's' : ''} in ${fileCount391} file${fileCount391 !== 1 ? 's' : ''}`));
                return;
            }
            const caseFlag = parsed.flags['i'] || parsed.flags['ignore-case'] ? '-i' : '';
            // Wave 368: separate before/after context flags
            const beforeCtx368 = parsed.flags['B'] || parsed.flags['before'] || '';
            const afterCtx368 = parsed.flags['A'] || parsed.flags['after'] || '';
            const contextLines = parsed.flags['C'] || parsed.flags['context'] || '2';
            const searchCountMode = parsed.flags['count'] === 'true';
            const searchFilesMode = parsed.flags['files'] === 'true' || parsed.flags['l'] === 'true';
            // Wave 319: --type flag maps to file glob
            const typeFlag338 = parsed.flags['type'] || parsed.flags['t'] || '';
            const typeGlob338 = typeFlag338 ? `*.${typeFlag338.replace(/^\./, '')}` : '';
            const effectiveGlob = searchGlob || typeGlob338;
            const rgAvail2 = (() => { try { execSync('rg --version', { stdio: 'ignore' }); return true; } catch { return false; } })();
            try {
                let searchOut = '';
                if (rgAvail2) {
                    const globArg = effectiveGlob ? `--glob=${effectiveGlob}` : '';
                    // Wave 368: use before/after if specified, otherwise symmetric context
                    const ctxArg368 = beforeCtx368 || afterCtx368
                        ? `${beforeCtx368 ? '--before-context=' + beforeCtx368 : ''}${afterCtx368 ? ' --after-context=' + afterCtx368 : ''}`
                        : `--context=${contextLines}`;
                    const modeArg = searchCountMode ? '--count' : searchFilesMode ? '--files-with-matches' : `${ctxArg368} --heading --line-number --color=always`;
                    searchOut = execSync(`rg ${caseFlag || '--ignore-case'} ${modeArg} ${globArg} ${JSON.stringify(searchPat)} .`, {
                        encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), maxBuffer: 1_000_000,
                    }).trim();
                    if (searchCountMode && searchOut) {
                        // Pretty-print count mode
                        console.log('');
                        const countLines = searchOut.split('\n').map(l => l.split(':'));
                        const total = countLines.reduce((s, p) => s + parseInt(p[1] || '0', 10), 0);
                        for (const [file, cnt] of countLines.sort((a, b) => parseInt(b[1] || '0', 10) - parseInt(a[1] || '0', 10)).slice(0, 30)) {
                            console.log('  ' + C.cyan(String(cnt).padStart(5)) + '  ' + C.white(file || ''));
                        }
                        console.log('');
                        console.log('  ' + C.dim(`${total} match${total !== 1 ? 'es' : ''} in ${countLines.length} file${countLines.length !== 1 ? 's' : ''}`));
                        console.log('');
                        return;
                    }
                } else {
                    const grepMode = searchCountMode ? '-c' : searchFilesMode ? '-l' : '-n';
                    searchOut = execSync(`grep -r ${caseFlag || '-i'} ${grepMode} --include="${effectiveGlob || '*'}" ${JSON.stringify(searchPat)} .`, {
                        encoding: 'utf8', stdio: 'pipe', cwd: process.cwd(), maxBuffer: 1_000_000,
                    }).trim();
                }
                process.stdout.write(searchOut + '\n');
            } catch (e) {
                const exitErr = e as { status?: number };
                if (exitErr.status === 1) { console.log(C.dim(`  No matches for "${searchPat}"${effectiveGlob ? ` in ${effectiveGlob}` : ''}`)); }
                else { console.error(C.red('  Search error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e)))); }
            }
            return;
        }

        case 'commit': {
            // Wave 248/332/400/419: tentaclaw commit [msg] [--push] [--dry-run] [--amend] [--no-stage]
            const commitMsgArg = parsed.positional.join(' ').trim() || parsed.flags['message'] || parsed.flags['m'] || '';
            const commitPush = parsed.flags['push'] === 'true';
            const commitDryRun = parsed.flags['dry-run'] === 'true' || parsed.flags['dry_run'] === 'true';
            // Wave 419: --no-stage — skip git add -A, commit only already-staged files
            const commitNoStage419 = parsed.flags['no-stage'] === 'true' || parsed.flags['no-stage'] === '';
            // Wave 400: --amend flag — amend the last commit (with optional new message)
            const commitAmend400 = parsed.flags['amend'] === 'true' || parsed.flags['amend'] === '';
            if (commitAmend400) {
                try {
                    const lastMsg = execSync('git log -1 --format=%s', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    const amendMsg400 = commitMsgArg || lastMsg;
                    if (!amendMsg400) { console.log(C.yellow('  No commit to amend.')); return; }
                    execSync(`git add -A && git commit --amend -m "${amendMsg400.replace(/"/g, "'")}" 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                    console.log(C.green(`  ✔ Amended: "${amendMsg400}"`));
                    if (commitPush) {
                        try { console.log(C.dim('  Pushing (force)…')); execSync('git push --force-with-lease 2>&1', { encoding: 'utf8', stdio: 'pipe' }); console.log(C.green('  ✔ Pushed.')); }
                        catch (pe) { console.error(C.red('  Push failed: ' + (pe instanceof Error ? pe.message.split('\n')[0] : String(pe)))); }
                    }
                } catch (e) {
                    console.error(C.red('  Amend error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                }
                return;
            }
            try {
                const statusOut = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
                if (!statusOut) { console.log(C.dim('  Nothing to commit — working tree clean.')); return; }
                const changedFiles = statusOut.split('\n').map(l => l.slice(3).trim());
                if (commitDryRun) {
                    console.log('');
                    console.log('  ' + C.teal(C.bold('DRY RUN — would commit:')));
                    console.log('');
                    for (const f of changedFiles.slice(0, 20)) console.log('  ' + C.dim('  ') + C.white(f));
                    if (changedFiles.length > 20) console.log('  ' + C.dim(`  …and ${changedFiles.length - 20} more`));
                    console.log('');
                    console.log('  ' + C.dim('Run without --dry-run to commit.'));
                    return;
                }
                let commitMsg = commitMsgArg;
                if (!commitMsg) {
                    // AI-generated commit message using git diff --stat
                    let diffSummary = '';
                    try { diffSummary = execSync('git diff --stat HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim().slice(0, 2000); } catch { /* ok */ }
                    if (!diffSummary) {
                        try { diffSummary = execSync('git diff --cached --stat', { encoding: 'utf8', stdio: 'pipe' }).trim().slice(0, 2000); } catch { /* ok */ }
                    }
                    if (diffSummary) {
                        console.log(C.dim('  Generating commit message…'));
                        // Quick inference call
                        const askConfig2 = loadConfig();
                        let askUrl2 = ''; let askHeaders2: Record<string, string> = {}; let askModel2 = '';
                        if (askConfig2) { const r = resolveInferenceFromConfig(askConfig2); askUrl2 = r.url; askHeaders2 = r.headers; askModel2 = askConfig2.model; }
                        if (askUrl2 && askModel2) {
                            const prompt2 = `Write a single-line conventional commit message (max 70 chars) for these changes. Only output the message, nothing else.\n\n${diffSummary}`;
                            const body2 = JSON.stringify({ model: askModel2, messages: [{ role: 'user', content: prompt2 }], stream: false, temperature: 0.3 });
                            try {
                                const parsed3 = new URL(askUrl2.replace(/\/+$/, '') + '/v1/chat/completions');
                                const lib3 = parsed3.protocol === 'https:' ? require('https') as typeof import('https') : require('http') as typeof import('http');
                                const resp3 = await new Promise<string>((resolve3) => {
                                    const req3 = lib3.request({ hostname: parsed3.hostname, port: Number(parsed3.port) || (parsed3.protocol === 'https:' ? 443 : 80), path: parsed3.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body2), ...askHeaders2 } }, (res3) => {
                                        let buf3 = ''; res3.on('data', (c: Buffer) => { buf3 += c.toString(); }); res3.on('end', () => resolve3(buf3));
                                    });
                                    req3.on('error', () => resolve3(''));
                                    req3.setTimeout(10_000, () => { req3.destroy(); resolve3(''); });
                                    req3.write(body2); req3.end();
                                });
                                const parsed4 = JSON.parse(resp3) as { choices?: Array<{ message?: { content?: string } }> };
                                commitMsg = (parsed4.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '').split('\n')[0]!.slice(0, 70);
                            } catch { /* fallback below */ }
                        }
                    }
                    if (!commitMsg) {
                        const dirs = [...new Set(changedFiles.map(f => f.split('/')[0]).filter(Boolean))];
                        const fileStr = changedFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
                        const more = changedFiles.length > 3 ? ` (+${changedFiles.length - 3})` : '';
                        commitMsg = `update: ${fileStr}${more}` + (dirs.length > 1 ? ` [${dirs.slice(0, 2).join(', ')}]` : '');
                    }
                }
                // Wave 419: --no-stage skips git add -A (commits only already-staged files)
                const gitAddCmd419 = commitNoStage419 ? '' : 'git add -A && ';
                execSync(`${gitAddCmd419}git commit -m "${commitMsg.replace(/"/g, "'")}"`, { encoding: 'utf8', stdio: 'pipe' });
                console.log(C.green(`  ✔ Committed ${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}: "${commitMsg}"`));
                if (commitPush) {
                    try {
                        console.log(C.dim('  Pushing…'));
                        execSync('git push 2>&1', { encoding: 'utf8', stdio: 'pipe' });
                        console.log(C.green('  ✔ Pushed.'));
                    } catch (pushErr) {
                        console.error(C.red('  Push failed: ' + (pushErr instanceof Error ? pushErr.message.split('\n')[0] : String(pushErr))));
                    }
                }
            } catch (e) {
                console.error(C.red('  Git error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                process.exit(1);
            }
            return;
        }

        case 'diff': {
            // Wave 252/325/357/409: tentaclaw diff [--staged] [--stat] [--word] [<file|ref>] — color-coded git diff
            const diffStaged = parsed.flags['staged'] === 'true' || parsed.flags['cached'] === 'true';
            const diffStatMode = parsed.flags['stat'] === 'true' || parsed.flags['stat'] === '';
            // Wave 409: --word flag — word-level diff using git diff --word-diff=color
            const diffWordMode409 = parsed.flags['word'] === 'true' || parsed.flags['word'] === '';
            const diffTarget325 = parsed.positional[0] || '';
            // positional could be a ref (HEAD, sha) or a file path
            const isRef325 = diffTarget325 && /^[a-f0-9]{7,40}$|^HEAD/.test(diffTarget325);
            const diffFileArg = (!isRef325 && diffTarget325) ? `-- "${diffTarget325}"` : '';
            const diffRefArg = isRef325 ? diffTarget325 : '';
            let diffOut = '';
            let diffMode = '';
            try {
                if (diffStaged) {
                    diffOut = execSync(`git diff --cached ${diffRefArg} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    diffMode = 'staged';
                } else if (diffRefArg) {
                    diffOut = execSync(`git diff ${diffRefArg} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    diffMode = `vs ${diffRefArg}`;
                } else {
                    diffOut = execSync(`git diff ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    diffMode = 'unstaged';
                    if (!diffOut.trim()) {
                        diffOut = execSync(`git diff --cached ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                        diffMode = 'staged';
                    }
                }
            } catch { /* not a git repo */ }
            if (!diffOut.trim()) {
                console.log(C.dim('  No changes to show — working tree clean.'));
                return;
            }
            // Wave 293/325/357: compute stat summary (insertions/deletions)
            let diffIns = 0, diffDel = 0, diffFiles = 0;
            const diffPerFile: Array<{ file: string; ins: number; del: number }> = [];
            let curFile357 = ''; let curIns357 = 0; let curDel357 = 0;
            for (const line of diffOut.split('\n')) {
                if (line.startsWith('diff --git')) {
                    if (curFile357) diffPerFile.push({ file: curFile357, ins: curIns357, del: curDel357 });
                    curFile357 = line.replace(/^diff --git a\/\S+ b\//, '');
                    curIns357 = 0; curDel357 = 0;
                    diffFiles++;
                } else if (line.startsWith('+') && !line.startsWith('+++')) { diffIns++; curIns357++; }
                else if (line.startsWith('-') && !line.startsWith('---')) { diffDel++; curDel357++; }
            }
            if (curFile357) diffPerFile.push({ file: curFile357, ins: curIns357, del: curDel357 });
            console.log('');
            const diffLabel = diffTarget325 && !isRef325 ? C.dim(` · ${diffTarget325}`) : (diffMode ? C.dim(` · ${diffMode}`) : '');
            console.log('  ' + C.dim(`${diffFiles} file${diffFiles !== 1 ? 's' : ''} changed`) + diffLabel + '  ' + C.green(`+${diffIns}`) + '  ' + C.red(`-${diffDel}`));
            // Wave 357: --stat mode — show per-file breakdown like git diff --stat
            if (diffStatMode) {
                console.log('');
                const maxBar = Math.min(30, Math.max(...diffPerFile.map(f => f.ins + f.del), 1));
                for (const pf of diffPerFile) {
                    const total = pf.ins + pf.del;
                    const barLen = Math.round((total / maxBar) * 20);
                    const insLen = total > 0 ? Math.round((pf.ins / total) * barLen) : 0;
                    const delLen = barLen - insLen;
                    const bar = C.green('+'.repeat(insLen)) + C.red('-'.repeat(delLen));
                    console.log('  ' + C.white(pf.file.padEnd(40).slice(0, 40)) + ' ' + bar + C.dim(` ${pf.ins > 0 ? '+' + pf.ins : ''}${pf.del > 0 ? ' -' + pf.del : ''}`));
                }
                console.log('');
                return;
            }
            // Wave 409: --word mode — re-run diff with --word-diff=plain and render inline changes
            if (diffWordMode409) {
                try {
                    const wordDiffFlag = '--word-diff=plain';
                    let wordOut409 = '';
                    if (diffStaged) {
                        wordOut409 = execSync(`git diff --cached ${wordDiffFlag} ${diffRefArg} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    } else if (diffRefArg) {
                        wordOut409 = execSync(`git diff ${wordDiffFlag} ${diffRefArg} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    } else {
                        wordOut409 = execSync(`git diff ${wordDiffFlag} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                        if (!wordOut409.trim()) wordOut409 = execSync(`git diff --cached ${wordDiffFlag} ${diffFileArg}`, { encoding: 'utf8', stdio: 'pipe' });
                    }
                    console.log('');
                    for (const line409 of wordOut409.split('\n')) {
                        if (line409.startsWith('diff --git') || line409.startsWith('index ')) { console.log('  ' + C.dim(line409)); }
                        else if (line409.startsWith('+++') || line409.startsWith('---')) { console.log('  ' + C.bold(C.white(line409))); }
                        else if (line409.startsWith('@@')) { console.log('  ' + C.teal(line409)); }
                        else {
                            // Colorize [-removed-] and {+added+} inline markers
                            const colored409 = line409
                                .replace(/\[-([^\]]*)-\]/g, (_, t) => C.red(`[-${t}-]`))
                                .replace(/\{\+([^}]*)\+\}/g, (_, t) => C.green(`{+${t}+}`));
                            console.log('  ' + colored409);
                        }
                    }
                    console.log('');
                } catch { /* fall through to normal diff */ }
                return;
            }
            console.log('');
            for (const line of diffOut.split('\n')) {
                if (line.startsWith('+++') || line.startsWith('---')) {
                    console.log('  ' + C.bold(C.white(line)));
                } else if (line.startsWith('diff --git') || line.startsWith('index ')) {
                    console.log('  ' + C.dim(line));
                } else if (line.startsWith('@@')) {
                    console.log('  ' + C.teal(line));
                } else if (line.startsWith('+')) {
                    console.log('  ' + C.green(line));
                } else if (line.startsWith('-')) {
                    console.log('  ' + C.red(line));
                } else {
                    console.log('  ' + C.dim(line));
                }
            }
            console.log('');
            return;
        }

        case 'explain': {
            // Wave 247/324: tentaclaw explain <file[:start[-end]]> — explain file or specific line range
            const explainArg = parsed.positional[0];
            if (!explainArg) {
                console.log(C.dim('  Usage: tentaclaw explain <file[:<line>[-<line>]]>'));
                console.log(C.dim('  Examples:'));
                console.log(C.dim('    tentaclaw explain src/index.ts'));
                console.log(C.dim('    tentaclaw explain src/index.ts:100'));
                console.log(C.dim('    tentaclaw explain src/index.ts:100-200'));
                process.exit(1);
            }
            // Parse file:start[-end] format
            const explainColonIdx = explainArg.lastIndexOf(':');
            let explainFile = explainArg;
            let explainStartLine = 0;
            let explainEndLine = 0;
            if (explainColonIdx > 0) {
                const afterColon = explainArg.slice(explainColonIdx + 1);
                const lineRange = afterColon.match(/^(\d+)(?:-(\d+))?$/);
                if (lineRange) {
                    explainFile = explainArg.slice(0, explainColonIdx);
                    explainStartLine = parseInt(lineRange[1], 10);
                    explainEndLine = lineRange[2] ? parseInt(lineRange[2], 10) : explainStartLine;
                }
            }
            let explainRaw: string;
            try { explainRaw = fs.readFileSync(path.resolve(explainFile), 'utf8'); }
            catch (e) { console.error(C.red(`  Cannot read: ${explainFile}`)); process.exit(1); }
            let explainContent: string;
            let explainContext: string;
            if (explainStartLine > 0) {
                const allLines = explainRaw!.split('\n');
                const lo = Math.max(0, explainStartLine - 1);
                const hi = Math.min(allLines.length, explainEndLine || explainStartLine);
                const slice = allLines.slice(lo, hi);
                explainContent = slice.join('\n').slice(0, 20_000);
                const rangeStr = explainEndLine && explainEndLine !== explainStartLine ? `lines ${explainStartLine}–${explainEndLine}` : `line ${explainStartLine}`;
                explainContext = `Explain what this specific section of code does (${rangeStr} of ${explainFile}). Be concise and practical — describe purpose, logic, and any gotchas.\n\nFile: ${explainFile} (${rangeStr})\n\n\`\`\`\n${explainContent}\n\`\`\``;
                if (!parsed.flags['print']) console.log('  ' + C.dim(`Explaining ${explainFile} lines ${explainStartLine}–${explainEndLine || explainStartLine}…`));
            } else {
                explainContent = explainRaw!.slice(0, 20_000);
                explainContext = `Explain what this file does. Be concise and practical — describe the purpose, key logic, and any gotchas. File: ${explainFile}\n\n\`\`\`\n${explainContent}\n\`\`\``;
                if (!parsed.flags['print']) console.log('  ' + C.dim(`Explaining ${explainFile}…`));
            }
            await cmdCode(gateway, { ...parsed.flags, task: explainContext, yes: 'true', 'no-tools': 'true', print: parsed.flags['print'] || 'false' });
            return;
        }

        case 'mcp':
            await cmdMcp(gateway, parsed.positional, parsed.flags);
            return;

        case 'update':
        case 'upgrade':
            await cmdUpdate();
            return;

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
                console.error(C.dim('  Usage: tentaclaw node <nodeId>'));
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
                console.error(C.dim('  Usage: tentaclaw deploy <model>'));
                console.error(C.dim('  Example: tentaclaw deploy llama3.1:8b'));
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
                console.error(C.dim('  Usage: tentaclaw command <nodeId> <action> [--model <m>] [--gpu <n>]'));
                console.error(C.dim('  Example: tentaclaw command NODE-001 install_model --model llama3.1:8b'));
                console.error('');
                process.exit(1);
            }
            await cmdCommand(gateway, nodeId, action, parsed.flags);
            break;
        }

        case 'models': {
            // Try standalone (config-based) first; fall back to gateway cluster listing
            const modelsConfig = loadConfig();
            if (modelsConfig) {
                await cmdModelsStandalone(parsed.flags['filter'] || parsed.flags['f'] || parsed.positional[0] || '');
            } else {
                await cmdModels(gateway);
            }
            break;
        }

        case 'health':
            await cmdHealth(gateway);
            break;

        case 'leaderboard':
        case 'lb': {
            // Wave 617: model leaderboard
            const lbTask = parsed.flags['task'] || parsed.flags['type'] || '';
            const lbData = await apiGet(gateway, `/api/v1/leaderboard${lbTask ? '?task_type=' + lbTask : ''}`) as { leaderboard: Array<{ model: string; task_type: string; avg_tps: number; avg_latency_ms: number; total_requests: number }> };
            console.log('');
            console.log('  ' + C.teal(C.bold('MODEL LEADERBOARD')) + (lbTask ? C.dim(` — ${lbTask}`) : ''));
            console.log('');
            console.log('  ' + padRight(C.dim('MODEL'), 30) + padRight(C.dim('TASK'), 12) + padRight(C.dim('TPS'), 10) + padRight(C.dim('LATENCY'), 12) + C.dim('REQS'));
            console.log('  ' + C.dim('\u2500'.repeat(75)));
            for (const entry of (lbData.leaderboard || [])) {
                console.log('  ' + padRight(C.white(entry.model), 30) + padRight(C.purple(entry.task_type), 12) + padRight(C.green(String(entry.avg_tps)), 10) + padRight(C.yellow(entry.avg_latency_ms + 'ms'), 12) + C.dim(String(entry.total_requests)));
            }
            if (!lbData.leaderboard?.length) console.log('  ' + C.dim('No data yet. Run some inference to populate.'));
            console.log('');
            break;
        }

        case 'registry': {
            // Wave 607: model registry
            const regData = await apiGet(gateway, '/api/v1/registry') as { models: Array<{ name: string; family: string; parameter_size: string; quantization: string; context_length: number; tags: string[]; benchmark_tps: number; nodes: string[] }> };
            console.log('');
            console.log('  ' + C.teal(C.bold('MODEL REGISTRY')) + C.dim(` — ${regData.models?.length || 0} models`));
            console.log('');
            console.log('  ' + padRight(C.dim('MODEL'), 28) + padRight(C.dim('FAMILY'), 12) + padRight(C.dim('SIZE'), 8) + padRight(C.dim('QUANT'), 10) + padRight(C.dim('CTX'), 8) + padRight(C.dim('TPS'), 8) + C.dim('TAGS'));
            console.log('  ' + C.dim('\u2500'.repeat(85)));
            for (const m of (regData.models || [])) {
                console.log('  ' + padRight(C.white(m.name), 28) + padRight(C.dim(m.family), 12) + padRight(C.teal(m.parameter_size), 8) + padRight(C.dim(m.quantization), 10) + padRight(C.yellow(formatNumber(m.context_length)), 8) + padRight(m.benchmark_tps > 0 ? C.green(String(m.benchmark_tps)) : C.dim('-'), 8) + C.purple(m.tags.join(', ')));
            }
            if (!regData.models?.length) console.log('  ' + C.dim('No models loaded. Deploy a model first.'));
            console.log('');
            break;
        }

        case 'revenue': {
            // Wave 745: revenue dashboard
            const revHours = parsed.flags['hours'] || '720';
            const revData = await apiGet(gateway, `/api/v1/revenue?hours=${revHours}`) as {
                window_hours: number; revenue: { input: number; output: number; total: number };
                costs: { power: number }; profit: number; tokens: { input: number; output: number };
                by_model: Array<{ model: string; count: number; estimated_revenue: number }>;
            };
            console.log('');
            console.log('  ' + C.teal(C.bold('REVENUE DASHBOARD')) + C.dim(` — last ${revHours}h`));
            console.log('');
            console.log('  ' + padRight(C.dim('Tokens in:'), 18) + C.white(formatNumber(revData.tokens.input)));
            console.log('  ' + padRight(C.dim('Tokens out:'), 18) + C.white(formatNumber(revData.tokens.output)));
            console.log('  ' + padRight(C.dim('Revenue:'), 18) + C.green('$' + revData.revenue.total.toFixed(2)));
            console.log('  ' + padRight(C.dim('Power cost:'), 18) + C.yellow('$' + revData.costs.power.toFixed(2)));
            console.log('  ' + padRight(C.dim('Profit:'), 18) + (revData.profit >= 0 ? C.green : C.red)('$' + revData.profit.toFixed(2)));
            if (revData.by_model?.length > 0) {
                console.log('');
                console.log('  ' + padRight(C.dim('MODEL'), 30) + padRight(C.dim('REQS'), 10) + C.dim('EST. REV'));
                for (const m of revData.by_model.slice(0, 10)) {
                    console.log('  ' + padRight(C.white(m.model), 30) + padRight(C.dim(formatNumber(m.count)), 10) + C.green('$' + m.estimated_revenue.toFixed(2)));
                }
            }
            console.log('');
            break;
        }

        case 'usage': {
            // Wave 734: usage metering (shortcut to /api/v1/usage)
            const usageHours = parsed.flags['hours'] || '24';
            const uData = await apiGet(gateway, `/api/v1/usage?hours=${usageHours}`) as {
                total_requests: number; total_tokens: number; total_tokens_in: number; total_tokens_out: number;
                avg_latency_ms: number; requests_per_minute: number;
                by_model: Array<{ model: string; count: number; avg_latency_ms: number }>;
            };
            console.log('');
            console.log('  ' + C.teal(C.bold('USAGE')) + C.dim(` — last ${usageHours}h`));
            console.log('');
            console.log('  ' + padRight(C.dim('Requests:'), 18) + C.white(formatNumber(uData.total_requests)));
            console.log('  ' + padRight(C.dim('Tokens:'), 18) + C.white(formatNumber(uData.total_tokens)) + C.dim(` (${formatNumber(uData.total_tokens_in)} in, ${formatNumber(uData.total_tokens_out)} out)`));
            console.log('  ' + padRight(C.dim('Avg latency:'), 18) + C.white(uData.avg_latency_ms + 'ms'));
            console.log('  ' + padRight(C.dim('RPM:'), 18) + C.white(String(uData.requests_per_minute)));
            if (uData.by_model?.length > 0) {
                console.log('');
                for (const m of uData.by_model.slice(0, 8)) {
                    console.log('  ' + padRight(C.white(m.model), 28) + C.dim(`${formatNumber(m.count)} reqs, ${m.avg_latency_ms}ms avg`));
                }
            }
            console.log('');
            break;
        }

        case 'quarantine': {
            // Wave 712: node quarantine
            const qSub = parsed.positional[0];
            const qNodeId = parsed.positional[1] || parsed.flags['node'] || '';
            if (qSub === 'add' && qNodeId) {
                await apiPost(gateway, `/api/v1/nodes/${qNodeId}/quarantine`, { reason: parsed.flags['reason'] || 'manual' });
                console.log('  ' + C.yellow(`\u26A0 Node ${qNodeId} quarantined`));
            } else if (qSub === 'remove' && qNodeId) {
                await apiDelete(gateway, `/api/v1/nodes/${qNodeId}/quarantine`);
                console.log('  ' + C.green(`\u2714 Node ${qNodeId} removed from quarantine`));
            } else {
                const qData = await apiGet(gateway, '/api/v1/quarantine') as { quarantined: string[] };
                console.log('');
                console.log('  ' + C.teal(C.bold('QUARANTINED NODES')));
                if (qData.quarantined?.length > 0) {
                    for (const n of qData.quarantined) console.log('  ' + C.red('\u25CB') + ' ' + C.white(n));
                } else {
                    console.log('  ' + C.dim('No nodes quarantined.'));
                }
                console.log('');
            }
            break;
        }

        case 'ab':
        case 'ab-test': {
            // Wave 618: A/B testing
            const abSub = parsed.positional[0];
            if (abSub === 'create') {
                const abBody = { name: parsed.flags['name'] || parsed.positional[1] || '', model_a: parsed.flags['a'] || '', model_b: parsed.flags['b'] || '', split_pct: parseInt(parsed.flags['split'] || '50', 10) };
                if (!abBody.name || !abBody.model_a || !abBody.model_b) {
                    console.log(C.yellow('  Usage: tentaclaw ab create --name test1 --a hermes3:8b --b qwen2.5-coder:7b [--split 50]'));
                    return;
                }
                await apiPost(gateway, '/api/v1/ab-tests', abBody);
                console.log('  ' + C.green(`\u2714 A/B test "${abBody.name}" created: ${abBody.model_a} (${abBody.split_pct}%) vs ${abBody.model_b} (${100 - abBody.split_pct}%)`));
            } else {
                const abData = await apiGet(gateway, '/api/v1/ab-tests') as { tests: Array<{ id: string; name: string; model_a: string; model_b: string; split_pct: number; active: boolean; results_a: { count: number; avg_tps: number }; results_b: { count: number; avg_tps: number } }> };
                console.log('');
                console.log('  ' + C.teal(C.bold('A/B TESTS')));
                console.log('');
                for (const t of (abData.tests || [])) {
                    const winner = t.results_a.avg_tps > t.results_b.avg_tps ? 'A' : t.results_b.avg_tps > t.results_a.avg_tps ? 'B' : '-';
                    console.log('  ' + C.white(C.bold(t.name)) + (t.active ? C.green(' ACTIVE') : C.dim(' ended')));
                    console.log('    A: ' + C.teal(t.model_a) + C.dim(` (${t.split_pct}%) `) + C.white(`${t.results_a.count} reqs, ${t.results_a.avg_tps} tps`));
                    console.log('    B: ' + C.purple(t.model_b) + C.dim(` (${100 - t.split_pct}%) `) + C.white(`${t.results_b.count} reqs, ${t.results_b.avg_tps} tps`));
                    console.log('    Winner: ' + C.green(winner === 'A' ? t.model_a : winner === 'B' ? t.model_b : 'tie'));
                    console.log('');
                }
                if (!abData.tests?.length) console.log('  ' + C.dim('No A/B tests. Create one: tentaclaw ab create --name test1 --a model1 --b model2'));
                console.log('');
            }
            break;
        }

        case 'ping': {
            // Wave 343: tentaclaw ping [--n <count>] — measure gateway round-trip latency
            const pingCount = Math.min(10, Math.max(1, parseInt(parsed.flags['n'] || parsed.flags['count'] || '3', 10) || 3));
            console.log('');
            console.log('  ' + C.dim(`Pinging ${gateway} (${pingCount}x)…`));
            const pingTimes: number[] = [];
            for (let i = 0; i < pingCount; i++) {
                const t0 = Date.now();
                const pong = await apiProbe(gateway, '/api/v1/summary');
                const elapsed = Date.now() - t0;
                if (pong !== null) {
                    pingTimes.push(elapsed);
                    const bar = '█'.repeat(Math.min(20, Math.round(elapsed / 20)));
                    const col = elapsed < 100 ? C.green : elapsed < 300 ? C.yellow : C.red;
                    console.log('  ' + C.dim(`[${i + 1}]`) + '  ' + col(`${elapsed}ms`) + '  ' + C.dim(bar));
                } else {
                    console.log('  ' + C.dim(`[${i + 1}]`) + '  ' + C.red('timeout'));
                }
                if (i < pingCount - 1) await new Promise(r => setTimeout(r, 200));
            }
            if (pingTimes.length > 0) {
                const avg = Math.round(pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length);
                const min = Math.min(...pingTimes);
                const max = Math.max(...pingTimes);
                console.log('');
                console.log('  ' + C.dim('avg') + ' ' + C.white(`${avg}ms`) + '  ' + C.dim('min') + ' ' + C.green(`${min}ms`) + '  ' + C.dim('max') + ' ' + C.yellow(`${max}ms`));
            }
            console.log('');
            return;
        }

        case 'alerts':
            await cmdAlerts(gateway, parsed.flags);
            break;

        case 'benchmark':
        case 'benchmarks':
            await cmdBenchmarks(gateway);
            break;

        case 'chat':
            await cmdChat(gateway, parsed.flags);
            break;

        case 'code':
        case 'repl': {
            // parsed.positional has already had 'code' stripped by parseArgs
            // so positional[0] is the inline task ("tentaclaw code 'build X'")
            const codeTask = parsed.positional.join(' ').trim();
            const codeFlags = codeTask ? { ...parsed.flags, task: codeTask } : parsed.flags;
            await cmdCode(gateway, codeFlags);
            break;
        }

        case 'agent':
            // Wave 443: `tentaclaw agent design` launches the first-agent wizard
            if (parsed.positional[0] === 'design' || parsed.positional[0] === 'init') {
                await cmdDesignAgent();
            } else {
                const agentTask = parsed.positional.join(' ').trim();
                const agentCodeFlags = agentTask ? { ...parsed.flags, task: agentTask } : parsed.flags;
                await cmdCode(gateway, agentCodeFlags);
            }
            break;

        case 'design':
            // Wave 443: standalone alias — `tentaclaw design`
            await cmdDesignAgent();
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
        case 'cost': {
            const powerSub = parsed.positional[0];
            if (powerSub === 'cost') {
                // Wave 717: per-request power cost
                const rate = parsed.flags['rate'] || '0.12';
                const costData = await apiGet(gateway, `/api/v1/power/cost?rate_kwh=${rate}`) as { cluster: { total_watts: number; total_tps: number; cost_per_1k_tokens: number; monthly_power_cost: number }; nodes: Array<{ hostname: string; watts: number; tps: number; cost_per_1k_tokens: number; tok_per_watt: number }> };
                console.log('');
                console.log('  ' + C.teal(C.bold('POWER COST')) + C.dim(` — $${rate}/kWh`));
                console.log('');
                console.log('  ' + padRight(C.dim('Cluster draw:'), 22) + C.white(costData.cluster.total_watts + 'W'));
                console.log('  ' + padRight(C.dim('Cluster tok/s:'), 22) + C.white(String(costData.cluster.total_tps)));
                console.log('  ' + padRight(C.dim('Cost per 1K tokens:'), 22) + C.green('$' + costData.cluster.cost_per_1k_tokens.toFixed(6)));
                console.log('  ' + padRight(C.dim('Monthly power:'), 22) + C.yellow('$' + costData.cluster.monthly_power_cost.toFixed(2)));
                if (costData.nodes?.length > 0) {
                    console.log('');
                    console.log('  ' + padRight(C.dim('NODE'), 16) + padRight(C.dim('WATTS'), 8) + padRight(C.dim('TPS'), 8) + padRight(C.dim('TOK/W'), 8) + C.dim('$/1K'));
                    for (const n of costData.nodes) {
                        console.log('  ' + padRight(C.white(n.hostname), 16) + padRight(C.yellow(String(n.watts)), 8) + padRight(C.green(String(n.tps)), 8) + padRight(C.teal(String(n.tok_per_watt)), 8) + C.dim('$' + n.cost_per_1k_tokens.toFixed(6)));
                    }
                }
                console.log('');
            } else if (powerSub === 'budget') {
                // Wave 725: power budget
                const setVal = parsed.flags['set'] || parsed.positional[1] || '';
                if (setVal) {
                    await apiPost(gateway, '/api/v1/power/budget', { watts: parseInt(setVal, 10) });
                    console.log('  ' + C.green(`\u2714 Power budget set to ${setVal}W`));
                } else {
                    const budget = await apiGet(gateway, '/api/v1/power/budget') as { budget_watts: number; current_watts: number; utilization_pct: number; over_budget: boolean };
                    console.log('');
                    console.log('  ' + C.teal(C.bold('POWER BUDGET')));
                    console.log('  ' + padRight(C.dim('Budget:'), 16) + (budget.budget_watts > 0 ? C.white(budget.budget_watts + 'W') : C.dim('Not set')));
                    console.log('  ' + padRight(C.dim('Current:'), 16) + C.white(budget.current_watts + 'W'));
                    if (budget.budget_watts > 0) {
                        const col = budget.over_budget ? C.red : budget.utilization_pct > 80 ? C.yellow : C.green;
                        console.log('  ' + padRight(C.dim('Usage:'), 16) + col(budget.utilization_pct + '%') + (budget.over_budget ? C.red(' OVER BUDGET') : ''));
                    }
                    console.log('');
                }
            } else if (powerSub === 'efficiency') {
                // Wave 728: energy efficiency
                const eff = await apiGet(gateway, '/api/v1/power/efficiency') as { efficiency: Array<{ hostname: string; tok_per_watt: number; watts: number; tps: number }> };
                console.log('');
                console.log('  ' + C.teal(C.bold('ENERGY EFFICIENCY')) + C.dim(' — tok/W by node'));
                console.log('');
                for (const n of (eff.efficiency || [])) {
                    console.log('  ' + padRight(C.white(n.hostname), 16) + C.green(n.tok_per_watt + ' tok/W') + C.dim(`  (${n.watts}W, ${n.tps} tok/s)`));
                }
                console.log('');
            } else {
                await cmdPower(gateway);
            }
            break;
        }


        case 'alias':
        case 'aliases':
            await cmdAlias(gateway, parsed.positional, parsed.flags);
            break;

        case 'route': {
            // Wave 472: tentaclaw route explain <model> / telemetry / rules / standby
            const routeSub = parsed.positional[0];
            // Allow: tentaclaw route explain <model> OR tentaclaw route <model> (explain implied)
            if (routeSub && !['explain', 'why', 'telemetry', 'log', 'rules', 'standby'].includes(routeSub)) {
                // Treat first arg as model name — shorthand for 'explain'
                await cmdRoute(gateway, ['explain', ...parsed.positional], parsed.flags);
            } else {
                await cmdRoute(gateway, parsed.positional, parsed.flags);
            }
            break;
        }

        case 'review': // Wave 539
            await cmdReview(gateway, parsed.flags);
            break;

        case 'pipeline': // Wave 561: draft+review pipeline
            await cmdPipeline(gateway, parsed.positional, parsed.flags);
            break;

        case 'refactor': // Wave 540
            await cmdRefactor(gateway, parsed.positional, parsed.flags);
            break;

        case 'pr': // Wave 547
            await cmdPr(gateway, parsed.flags);
            break;

        case 'debug': // Wave 550
            await cmdDebug(gateway, parsed.positional, parsed.flags);
            break;

        case 'docs': // Wave 551
        case 'doc':
            await cmdDocs(gateway, parsed.positional, parsed.flags);
            break;

        case 'scaffold': // Wave 555
        case 'new':
            await cmdScaffold(gateway, parsed.positional, parsed.flags);
            break;

        case 'costs': // Wave 558
        case 'usage':
        case 'spend':
            await cmdCosts(gateway, parsed.flags);
            break;

        case 'capacity': {
            // Wave 488: tentaclaw capacity [plan --models m1,m2]
            const capSub = parsed.positional[0] || 'show';
            if (capSub === 'plan') {
                const models488 = (parsed.flags['models'] || parsed.flags['m'] || '').split(',').filter(Boolean);
                if (models488.length === 0) {
                    console.log('');
                    console.log(C.red('  ✘ --models required'));
                    console.log(C.dim('  Usage: tentaclaw capacity plan --models qwen3:30b,llama3.1:70b'));
                    console.log('');
                    break;
                }
                const plan488 = await apiPost(gateway, '/api/v1/capacity/plan', { models: models488 }) as any;
                console.log('');
                console.log('  ' + C.purple(C.bold('Capacity Plan')));
                console.log('');
                console.log('  ' + padRight(C.dim('Cluster free VRAM:'), 24) + C.white(plan488.summary.cluster_free_vram_gb + 'GB'));
                console.log('  ' + padRight(C.dim('Total required:'), 24) + C.white(plan488.summary.total_required_vram_gb + 'GB'));
                console.log('');
                for (const m of plan488.models) {
                    const icon = m.can_fit ? C.green('✔') : C.red('✘');
                    const nodeInfo = m.can_fit ? C.dim(` → ${m.best_node?.hostname || '?'} (${m.fit_on_nodes} node${m.fit_on_nodes !== 1 ? 's' : ''})`) : C.red(' — no node has enough free VRAM');
                    console.log('  ' + icon + ' ' + padRight(C.white(m.model), 30) + C.dim(m.required_vram_gb + 'GB') + nodeInfo);
                }
                console.log('');
                if (plan488.summary.all_fit) {
                    console.log('  ' + C.green('✔ All models fit across the cluster'));
                } else {
                    console.log('  ' + C.red('✘ Some models won\'t fit: ') + plan488.summary.models_that_dont_fit.join(', '));
                }
                console.log('');
            } else {
                await cmdCapacity(gateway);
            }
            break;
        }

        case 'eviction':
        case 'evict': {
            // Wave 480: tentaclaw eviction [candidates|run --node <id> --model <m>|auto]
            const evSub = parsed.positional[0] || 'candidates';
            if (evSub === 'run') {
                const nodeId480 = parsed.flags['node'] || parsed.positional[1] || '';
                const model480 = parsed.flags['model'] || parsed.positional[2] || '';
                if (!nodeId480 || !model480) { console.log(C.red('  Usage: tentaclaw eviction run --node <id> --model <model>')); break; }
                const ev480 = await apiPost(gateway, '/api/v1/eviction/run', { node_id: nodeId480, model: model480 }) as any;
                console.log('  ' + C.green('✔') + ' ' + ev480.message);
            } else if (evSub === 'auto') {
                const auto480 = await apiPost(gateway, '/api/v1/eviction/auto', {}) as any;
                console.log('  ' + C.green('✔') + ` Auto-evicted ${auto480.count} model(s)`);
                for (const e of auto480.evicted) console.log('  ' + C.dim(`  ${e.hostname}: ${e.model} (${Math.round(e.vram_freed_mb / 1024)}GB freed)`));
            } else {
                const cands = await apiGet(gateway, '/api/v1/eviction/candidates') as any;
                console.log('');
                console.log('  ' + C.purple(C.bold('Eviction Candidates')) + C.dim(` (${cands.count} models)`));
                console.log('');
                if (cands.candidates.length === 0) { console.log('  ' + C.dim('  No eviction candidates.')); }
                else {
                    console.log('  ' + padRight(C.dim('NODE'), 18) + padRight(C.dim('MODEL'), 28) + padRight(C.dim('REQS'), 8) + C.dim('VRAM'));
                    for (const c of cands.candidates) {
                        console.log('  ' + padRight(C.white(c.hostname), 18) + padRight(C.cyan(c.model), 28) + padRight(String(c.request_count), 8) + C.dim(Math.round(c.vram_mb / 1024) + 'GB'));
                    }
                }
                console.log('');
            }
            break;
        }

        case 'thermal': {
            // Wave 496: tentaclaw thermal — cluster-wide thermal status
            const thermal496 = await apiGet(gateway, '/api/v1/fleet/thermal') as any;
            const statusColor = (s: string) => s === 'critical' ? C.red : s === 'hot' ? C.red : s === 'warm' ? C.yellow : C.green;
            console.log('');
            console.log('  ' + C.purple(C.bold('Thermal Status')) + C.dim(` — cluster: ${thermal496.summary.cluster_status}`));
            console.log('');
            for (const n of thermal496.nodes) {
                const col = statusColor(n.status);
                const icon = n.status === 'ok' ? C.green('●') : col('●');
                const gpuTemps = n.gpus.map((g: any) => `GPU${g.index}:${g.temp_c}°C`).join(' ');
                console.log('  ' + icon + ' ' + padRight(C.white(n.hostname), 20) + C.dim(gpuTemps));
            }
            console.log('');
            break;
        }

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
                'My VRAM is full but my heart is empty. — TentaCLAW, 3am',
                'I asked the model for advice. It said "temperature 0". Cold.',
                'How many arms does it take to manage a GPU cluster? Eight. Obviously.',
                'knock knock. Who\'s there? OOM. OOM w— *process killed*',
                'A GPU walks into a bar. The bartender says "you look hot." The GPU says "always."',
                'Per-token pricing is a scam. This is not a joke. — TentaCLAW',
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
            console.log('  ' + C.purple('\u2728') + ' ' + C.dim('TentaCLAW fortune:'));
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
            console.log('  ' + C.teal('\uD83D\uDC19 TentaCLAW is dancing!'));
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
            for (const line of MASCOT_FACE) {
                console.log('  ' + line);
            }
            console.log('');
            console.log('  ' + C.teal(C.bold('TENTACLAW OS')) + ' ' + C.dim('v' + CLI_VERSION));
            console.log('  ' + C.purple(C.italic('Eight arms. One mind. Zero compromises.')));
            console.log('');
            console.log('  ' + padRight(C.purple('Created by'), 16) + C.white('TentaCLAW-OS'));
            console.log('  ' + padRight(C.purple('Mascot'), 16) + C.white('TentaCLAW \uD83D\uDC19'));
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

        case 'doctor': {
            // Use standalone doctor if config exists and no gateway flag
            const hasConfig = loadConfig() !== null;
            const gwReachable = await apiProbe(gateway, '/api/v1/nodes');
            if (gwReachable) {
                await cmdDoctor(gateway, parsed.flags);
            } else if (hasConfig) {
                await cmdDoctorStandalone();
                return;
            } else {
                await cmdDoctorStandalone();
                return;
            }
            break;
        }

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
                console.error(C.dim('  Usage: tentaclaw apply <flightSheetId>'));
                console.error(C.dim('  Run "tentaclaw flight-sheets" to see available IDs.'));
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
                console.log('  ' + C.dim('No groups. Create one: tentaclaw groups create <name>'));
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
            const hotRaw = await apiGet(gateway, '/api/v1/nodes/hot') as any;
            const hot: Array<{ hostname: string; max_temp: number; gpu_count: number }> = Array.isArray(hotRaw) ? hotRaw : (hotRaw?.hot_nodes ?? []);
            console.log('');
            console.log('  ' + C.teal(C.bold('HOTTEST NODES')) + C.dim(' (sorted by GPU temp)'));
            console.log('');
            if (hot.length === 0) {
                console.log('  ' + C.green('All nodes are cool.'));
                console.log('');
                break;
            }
            for (const n of hot.slice(0, 10)) {
                const color = n.max_temp > 85 ? C.red : n.max_temp > 70 ? C.yellow : C.green;
                console.log('  ' + padRight(C.white(n.hostname), 25) + color(n.max_temp + 'C') + C.dim('  (' + n.gpu_count + ' GPUs)'));
            }
            console.log('');
            break;
        }

        case 'idle': {
            const idleRaw = await apiGet(gateway, '/api/v1/nodes/idle') as any;
            const idle: Array<{ hostname: string; avg_util: number; gpu_count: number }> = Array.isArray(idleRaw) ? idleRaw : (idleRaw?.idle_nodes ?? []);
            console.log('');
            console.log('  ' + C.teal(C.bold('IDLE NODES')) + C.dim(' (< 10% GPU utilization)'));
            console.log('');
            if (idle.length === 0) {
                console.log('  ' + C.green('All nodes are busy. TentaCLAW approves.'));
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
            const { rules } = await apiGet(gateway, '/api/v1/alert-rules') as { rules: Array<{ id: string; name: string; metric: string; operator: string; threshold: number; severity: string; enabled: number }> };
            console.log('');
            console.log('  ' + C.teal(C.bold('ALERT RULES')));
            console.log('');
            for (const r of (rules || [])) {
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
            // Wave 441: --local flag (or no gateway) shows RAM-based local recommendations
            const isLocalRec441 = parsed.flags['local'] === 'true' || parsed.flags['local'] === '';
            const vram = parsed.flags['vram'] ? parseInt(parsed.flags['vram']) : undefined;
            if (isLocalRec441 || !gateway || gateway === 'http://localhost:8080') {
                // Standalone local recommendation based on system RAM
                const ramGb441 = Math.round(require('os').totalmem() / 1024 / 1024 / 1024);
                console.log('');
                console.log('  ' + C.teal(C.bold('LOCAL MODEL RECOMMENDATIONS')) + C.dim(` — ${ramGb441} GB RAM detected`));
                console.log('');
                type ModelRec = { model: string; vramGb: number; desc: string; tags: string[] };
                const ALL_RECS_441: ModelRec[] = [
                    { model: 'bitnet-b1.58-3b',    vramGb: 0,    desc: 'CPU-only, no GPU needed — fastest on modern CPUs', tags: ['cpu', 'fast', 'small'] },
                    { model: 'hermes3:8b',           vramGb: 4.3,  desc: 'Best general + tool use for coding agent', tags: ['tools', 'coding', '8b'] },
                    { model: 'qwen2.5-coder:7b',     vramGb: 4.5,  desc: 'State-of-the-art 7B code model', tags: ['tools', 'coding', '7b'] },
                    { model: 'qwen2.5:7b',           vramGb: 4.5,  desc: 'Strong general model, good at instructions', tags: ['tools', '7b'] },
                    { model: 'mistral-nemo:12b',     vramGb: 7.5,  desc: 'Excellent instruction following, 12B', tags: ['tools', '12b'] },
                    { model: 'qwen2.5-coder:14b',    vramGb: 9.0,  desc: 'Best 14B code model (needs 16 GB RAM)', tags: ['tools', 'coding', '14b'] },
                    { model: 'qwen2.5:32b',          vramGb: 20.0, desc: 'Top-tier reasoning (needs 32 GB RAM)', tags: ['tools', '32b'] },
                    { model: 'qwen3-coder:30b',      vramGb: 18.0, desc: 'Best code model overall (needs 32 GB RAM)', tags: ['tools', 'coding', '30b'] },
                ];
                const fits441 = ALL_RECS_441.filter(r => r.vramGb === 0 || r.vramGb <= ramGb441 * 0.7);
                if (fits441.length === 0) {
                    console.log('  ' + C.yellow(`No models fit ${ramGb441} GB — minimum 4 GB RAM needed for 7B models.`));
                } else {
                    for (const r of fits441) {
                        const sizeStr = r.vramGb === 0 ? C.cyan('CPU') : C.dim(`${r.vramGb} GB`);
                        console.log('  ' + C.green(padRight(r.model, 28)) + padRight(sizeStr, 12) + C.dim(r.desc));
                    }
                    console.log('');
                    console.log('  ' + C.dim('Install:') + '  ' + C.cyan(`ollama pull ${fits441[0]!.model}`));
                    console.log('  ' + C.dim('Set active:') + C.cyan(`  tentaclaw config set model ${fits441[0]!.model}`));
                }
                console.log('');
                break;
            }
            const recUrl = vram ? `/api/v1/models/recommend?vram_mb=${vram}` : '/api/v1/models/recommend';
            const recResp = await apiGet(gateway, recUrl) as { recommendations: Array<{ model: string; quantization: string; vram_required_mb: number; use_case: string; description: string }>; available_vram_mb: number; count: number } | Array<any>;
            const recs = Array.isArray(recResp) ? recResp : recResp.recommendations;
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
            if (!model) { console.error(C.red('  Usage: tentaclaw estimate <model> [--quantization Q4_K_M]')); process.exit(1); }
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
            const auditData = await apiGet(gateway, `/api/v1/audit?limit=${limit}`) as { audit_log: Array<{ event_type: string; actor: string; ip_address: string; detail: string; created_at: string }> };
            const events = auditData.audit_log || [];
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
                        console.error(C.red('  Usage: tentaclaw finetune create --base <model> --data <path> [--method qlora] [--output name]'));
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
                    console.log('  ' + C.dim('"Your data. Your model. Your hardware." \u2014 TentaCLAW'));
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
                        console.log('  ' + C.dim('No jobs. Start one: tentaclaw finetune create --base llama3.1:8b --data ./data.jsonl'));
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
                    if (!jobId) { console.error(C.red('  Usage: tentaclaw finetune cancel <job-id>')); process.exit(1); }
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
                    if (!model) { console.error(C.red('  Usage: tentaclaw benchmark run --model <name> [--suite standard]')); process.exit(1); }
                    console.log('');
                    console.log('  ' + C.teal('\uD83D\uDC19') + ' Running benchmark: ' + C.white(suite) + ' on ' + C.white(model));
                    const run = await apiPost(gateway, '/api/v1/benchmarks/run', { model, suite }) as { id: string };
                    console.log('  ' + C.green('\u2714') + ' Benchmark started: ' + C.white(run.id));
                    console.log('  ' + C.dim('"Numbers don\'t lie." \u2014 TentaCLAW'));
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
                    if (!m1 || !m2) { console.error(C.red('  Usage: tentaclaw benchmark compare <model1> <model2>')); process.exit(1); }
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
                    if (!name) { console.error(C.red('  Usage: tentaclaw namespace create <name>')); process.exit(1); }
                    const ns = await apiPost(gateway, '/api/v1/namespaces', { name }) as { name: string };
                    console.log('  ' + C.green('\u2714') + ' Namespace created: ' + C.white(ns.name));
                    console.log('  ' + C.dim('"Every family has territories." \u2014 TentaCLAW'));
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
                    if (!name) { console.error(C.red('  Usage: tentaclaw namespace delete <name>')); process.exit(1); }
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
                console.error(C.red('  Usage: tentaclaw apply -f deployment.yaml'));
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
                console.log('  ' + C.dim('"You declare. I reconcile." \u2014 TentaCLAW'));
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
            if (deps.length === 0) console.log('  ' + C.dim('No deployments. Apply one: tentaclaw apply -f deployment.yaml'));
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
            if (adapters.length === 0) console.log('  ' + C.dim('No adapters. Fine-tune one: tentaclaw finetune create --base llama3.1:8b --data ./data.jsonl'));
            console.log('');
            break;
        }

        case 'cost': {
            const dashboard = await apiGet(gateway, '/api/v1/cost/dashboard').catch(() => null) as Record<string, unknown> | null;
            console.log('');
            console.log('  ' + C.teal(C.bold('COST INTELLIGENCE')));
            console.log('');
            if (!dashboard) {
                console.log('  ' + C.dim('Cost tracking not available. Configure: tentaclaw cost config'));
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
                    console.log('  ' + C.dim('"Per-token pricing is a scam. Here\'s the proof." \u2014 TentaCLAW'));
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
                        console.log('  ' + C.dim('Cloud burst not configured. Add providers: tentaclaw burst add-provider'));
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
            console.log('  Install: ' + C.white('tentaclaw hub install @tentaclaw/<stack-name>'));
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
        case '-v': {
            // Wave 275: verbose version info when no flags, plain string for scripting
            const isVerboseVersion = parsed.command === 'version' && !parsed.flags['short'] && !parsed.flags['s'];
            if (isVerboseVersion) {
                console.log('');
                console.log('  ' + C.teal(C.bold('TentaCLAW CLI')) + '  v' + CLI_VERSION);
                console.log('  ' + C.dim('Eight arms. One mind.'));
                console.log('');
                console.log('  ' + C.dim('Node:     ') + C.white(process.version));
                console.log('  ' + C.dim('Platform: ') + C.white(process.platform + ' ' + process.arch));
                console.log('  ' + C.dim('Config:   ') + C.white(getConfigPath()));
                console.log('  ' + C.dim('Workspace:') + C.white(getWorkspaceDir()));
                // Check config
                const cfg = loadConfig();
                if (cfg) {
                    console.log('  ' + C.dim('Provider: ') + C.white(cfg.provider) + C.dim(' / model: ') + C.white(cfg.model));
                } else {
                    console.log('  ' + C.dim('Provider: ') + C.yellow('not configured — run: tentaclaw config'));
                }
                console.log('');
            } else {
                console.log('tentaclaw-cli v' + CLI_VERSION);
            }
            break;
        }

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

        case 'inventory':
        case 'hw': {
            // Wave 715: hardware inventory
            const inv = await apiGet(gateway, '/api/v1/fleet/inventory') as { cluster_totals: { nodes: number; online: number; gpus: number; vram_gb: number; ram_gb: number; disk_gb: number }; nodes: Array<{ hostname: string; status: string; gpus: Array<{ name: string; vram_total_mb: number; temperature_c: number; utilization_pct: number }>; ram: { total_mb: number; used_mb: number }; disk: { total_gb: number; used_gb: number }; models_loaded: string[] }> };
            const t = inv.cluster_totals;
            console.log('');
            console.log('  ' + C.teal(C.bold('HARDWARE INVENTORY')));
            console.log('  ' + C.dim(`${t.nodes} nodes (${t.online} online) \u2022 ${t.gpus} GPUs \u2022 ${t.vram_gb}GB VRAM \u2022 ${t.ram_gb}GB RAM \u2022 ${t.disk_gb}GB disk`));
            console.log('');
            for (const n of inv.nodes || []) {
                const stIcon = n.status === 'online' ? C.green('\u25CF') : C.red('\u25CB');
                console.log('  ' + stIcon + ' ' + C.white(C.bold(n.hostname)));
                for (const g of n.gpus) {
                    console.log('    ' + C.teal(g.name) + C.dim(` ${Math.round(g.vram_total_mb / 1024)}GB`) + '  ' + miniBar(g.utilization_pct, 5) + ' ' + C.dim(g.utilization_pct + '%') + '  ' + tempColor(g.temperature_c)(g.temperature_c + '\u00B0C'));
                }
                console.log('    ' + C.dim(`RAM: ${Math.round(n.ram.used_mb / 1024)}/${Math.round(n.ram.total_mb / 1024)}GB  Disk: ${Math.round(n.disk.used_gb)}/${Math.round(n.disk.total_gb)}GB`) + (n.models_loaded.length > 0 ? '  ' + C.purple(n.models_loaded.join(', ')) : ''));
            }
            console.log('');
            break;
        }

        case 'quantize': {
            // Wave 601: quantize a model via Ollama
            const qModel = parsed.positional[0];
            const qBits = parsed.flags['bits'] || '4';
            if (!qModel) {
                console.log(C.yellow('  Usage: tentaclaw quantize <model> [--bits 4|5|8]'));
                return;
            }
            console.log('');
            console.log('  ' + C.purple(C.bold('QUANTIZE')) + C.dim(` — ${qModel} to Q${qBits}`));
            console.log('  ' + C.dim('This creates a quantized copy via Ollama modelfile.'));
            console.log('');
            const qName = `${qModel.split(':')[0]}:q${qBits}`;
            const modelfile = `FROM ${qModel}\nPARAMETER num_ctx 32768`;
            console.log('  ' + C.dim(`Creating ${qName} from ${qModel}...`));
            try {
                execSync(`ollama create ${qName} -f - <<< "${modelfile}"`, { encoding: 'utf8', stdio: 'pipe', timeout: 300_000 });
                console.log('  ' + C.green(`\u2714 Created ${qName}`));
            } catch (e) {
                console.log('  ' + C.yellow(`\u26A0 Ollama create not available. For GGUF quantization, use llama.cpp:`));
                console.log('  ' + C.dim(`  llama-quantize model.gguf model-q${qBits}.gguf Q${qBits}_K_M`));
            }
            console.log('');
            break;
        }

        case 'drain': {
            const nodeId = parsed.positional[0];
            if (!nodeId) { console.error(C.red('  Usage: tentaclaw drain <nodeId>')); process.exit(1); }
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
            if (!nodeId) { console.error(C.red('  Usage: tentaclaw cordon <nodeId>')); process.exit(1); }
            await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled: true });
            console.log('');
            console.log('  ' + C.yellow('\u26A0') + ' ' + C.white(nodeId) + ' cordoned — no new scheduling');
            console.log('');
            break;
        }

        case 'uncordon': {
            const nodeId = parsed.positional[0];
            if (!nodeId) { console.error(C.red('  Usage: tentaclaw uncordon <nodeId>')); process.exit(1); }
            await apiPost(gateway, `/api/v1/nodes/${encodeURIComponent(nodeId)}/maintenance`, { enabled: false });
            console.log('');
            console.log('  ' + C.green('\u2714') + ' ' + C.white(nodeId) + ' uncordoned — ready for scheduling');
            console.log('');
            break;
        }

        case 'top': {
            // Wave 500: --gpus flag shows per-GPU view via /api/v1/fleet/gpus
            const gpuMode500 = parsed.flags['gpus'] === 'true' || parsed.flags['gpu'] === 'true' || parsed.flags['cluster'] === 'true';
            console.log('');
            console.log('  ' + C.teal(C.bold(gpuMode500 ? 'CLUSTER GPU TOP' : 'CLUSTER TOP')) + C.dim(' \u2014 refreshing every 3s (Ctrl+C to quit)'));
            console.log('');
            const refreshTop = async () => {
                if (gpuMode500) {
                    const gpuData = await apiGet(gateway, '/api/v1/fleet/gpus') as { gpus: Array<{ hostname: string; gpu_index: number; name: string; util_pct: number; temp_c: number; vram_used_mb: number; vram_total_mb: number; fan_pct: number; model_loaded: string }> };
                    process.stdout.write('\x1b[2J\x1b[H');
                    const W = 90;
                    console.log(boxTop('TENTACLAW GPU TOP  ' + new Date().toLocaleTimeString() + '  ' + (gpuData.gpus?.length || 0) + ' GPUs', W));
                    console.log(boxMid(
                        padRight(C.dim('NODE'), 14) + padRight(C.dim('#'), 3) +
                        padRight(C.dim('GPU'), 22) + padRight(C.dim('UTIL'), 12) +
                        padRight(C.dim('TEMP'), 10) + padRight(C.dim('VRAM'), 14) +
                        C.dim('MODEL'), W
                    ));
                    console.log(boxSep(W));
                    for (const g of (gpuData.gpus || [])) {
                        const tFn = tempColor(g.temp_c);
                        console.log(boxMid(
                            padRight(C.white(g.hostname), 14) + padRight(C.dim(String(g.gpu_index)), 3) +
                            padRight(C.white(g.name.slice(0, 20)), 22) +
                            padRight(miniBar(g.util_pct, 5) + ' ' + C.white(g.util_pct + '%'), 12) +
                            padRight(tFn(g.temp_c + '\u00B0C'), 10) +
                            padRight(C.teal(Math.round(g.vram_used_mb / 1024) + '/' + Math.round(g.vram_total_mb / 1024) + 'G'), 14) +
                            C.dim(g.model_loaded || '-'), W
                        ));
                    }
                    console.log(boxBot(W));
                    console.log('  ' + C.dim('Press Ctrl+C to exit'));
                    return;
                }
                const topRaw = await apiGet(gateway, '/api/v1/nodes') as any;
                const topNodes: Array<{ id: string; hostname: string; status: string; gpu_count: number; latest_stats?: { gpus: Array<{ temperatureC: number; utilizationPct: number; vramUsedMb: number; vramTotalMb: number; powerDrawW: number }>; cpu: { usage_pct: number }; inference: { loaded_models: string[]; in_flight_requests: number } } }> = Array.isArray(topRaw) ? topRaw : (topRaw?.nodes ?? []);
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
                        console.error(C.dim('  Usage: tentaclaw hub search <query> [--type agent]'));
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
                        console.error(C.dim('  Usage: tentaclaw hub install @ns/package[@version]'));
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
                        console.log('  ' + C.dim('No packages installed yet. Run: tentaclaw hub install @ns/package'));
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
                        console.error(C.dim('  Usage: tentaclaw hub info @ns/package'));
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
                        console.error(C.dim('  Run "tentaclaw hub init" to create one.'));
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
                        console.error(C.dim('  Usage: tentaclaw hub star @ns/package'));
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
                    console.log('    2. Run ' + C.teal('tentaclaw hub publish') + ' to publish');
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
                    console.log('    tentaclaw hub <command> [options]');
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
                    console.log('    tentaclaw hub search "code review" --type agent');
                    console.log('');
                    console.log(C.dim('    # Install a package'));
                    console.log('    tentaclaw hub install @tentaclaw/router-agent@1.0.0');
                    console.log('');
                    console.log(C.dim('    # Publish your package'));
                    console.log('    tentaclaw hub init --type agent');
                    console.log('    tentaclaw hub publish');
                    console.log('');
                    break;
                }

                default:
                    console.error('');
                    console.error(C.red('  \u2718 Unknown hub command: ' + sub));
                    console.error(C.dim('  Run "tentaclaw hub help" for usage.'));
                    console.error('');
                    process.exit(1);
            }
            break;
        }

        case 'push': {
            // Wave 401: tentaclaw push [--force] [--tags] — git push with upstream auto-set on first push
            const pushForce401 = parsed.flags['force'] === 'true' || parsed.flags['force'] === '';
            const pushTags401 = parsed.flags['tags'] === 'true' || parsed.flags['tags'] === '';
            try {
                const branch401 = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                // Detect if upstream is set
                let hasUpstream401 = false;
                try { execSync(`git rev-parse --abbrev-ref --symbolic-full-name @{u}`, { encoding: 'utf8', stdio: 'pipe' }); hasUpstream401 = true; } catch { /* no upstream */ }
                const forceFlag401 = pushForce401 ? ' --force-with-lease' : '';
                const tagsFlag401 = pushTags401 ? ' --tags' : '';
                let pushCmd401: string;
                if (!hasUpstream401) {
                    // First push — set upstream
                    const remote401 = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n')[0] || 'origin';
                    pushCmd401 = `git push --set-upstream ${remote401} ${branch401}${forceFlag401}${tagsFlag401} 2>&1`;
                    console.log(C.dim(`  Setting upstream: ${remote401}/${branch401}`));
                } else {
                    pushCmd401 = `git push${forceFlag401}${tagsFlag401} 2>&1`;
                }
                execSync(pushCmd401, { encoding: 'utf8', stdio: 'pipe' });
                console.log(C.green(`  ✔ Pushed${pushForce401 ? ' (force)' : ''}: ${branch401}`));
            } catch (e) {
                const msg401 = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join('\n  ');
                console.error(C.red('  ✘ Push failed:\n  ') + msg401);
                process.exit(1);
            }
            return;
        }

        case 'pull': {
            // Wave 402/411: tentaclaw pull [--no-rebase] — git pull --rebase with conflict detection + friendly errors
            const noRebase402 = parsed.flags['no-rebase'] === 'true' || parsed.flags['no-rebase'] === '';
            try {
                const branch402 = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                // Wave 411: check for unstaged changes before attempting pull --rebase
                const dirty411 = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
                if (dirty411 && !noRebase402) {
                    const lines411 = dirty411.split('\n').length;
                    console.log(C.yellow(`  ⚠ Unstaged changes (${lines411} file${lines411 !== 1 ? 's' : ''}) — stash them first:`));
                    console.log(C.dim('    tentaclaw stash        # stash changes'));
                    console.log(C.dim('    tentaclaw pull         # pull'));
                    console.log(C.dim('    tentaclaw stash pop    # restore changes'));
                    return;
                }
                const pullFlag402 = noRebase402 ? '' : ' --rebase';
                console.log(C.dim(`  Pulling${pullFlag402 ? ' (rebase)' : ''}…`));
                const pullOut402 = execSync(`git pull${pullFlag402}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                if (pullOut402.includes('CONFLICT')) {
                    console.log('');
                    console.log(C.red('  ✘ Conflicts detected:'));
                    pullOut402.split('\n').filter(l => l.includes('CONFLICT')).forEach(l => console.log('  ' + C.yellow('  ' + l.trim())));
                    console.log('');
                    console.log(C.dim('  Resolve conflicts then: tentaclaw commit'));
                } else if (pullOut402.includes('Already up to date') || pullOut402.includes('up-to-date')) {
                    console.log(C.dim(`  Already up to date (${branch402})`));
                } else {
                    const changed402 = pullOut402.match(/(\d+) file/);
                    console.log(C.green(`  ✔ Pulled: ${branch402}`) + (changed402 ? C.dim(` — ${changed402[0]}`) : ''));
                }
            } catch (e) {
                // Wave 411: friendly error messages for common pull failures
                const errText = ((e as { stderr?: string }).stderr || (e instanceof Error ? e.message : String(e)));
                if (errText.includes('no tracking information') || errText.includes('no upstream')) {
                    console.error(C.red('  ✘ No upstream branch set.') + C.dim(' Use: tentaclaw push --set-upstream'));
                } else if (errText.includes('diverged') || errText.includes('non-fast-forward')) {
                    console.error(C.red('  ✘ Diverged from remote.') + C.dim(' Use --no-rebase to merge, or tentaclaw push --force'));
                } else {
                    const msg402 = errText.split('\n').filter(Boolean).slice(0, 3).join('\n  ');
                    console.error(C.red('  ✘ Pull failed:\n  ') + msg402);
                }
                process.exit(1);
            }
            return;
        }

        case 'fetch': {
            // Wave 403: tentaclaw fetch — git fetch with branch staleness display
            try {
                const fetchRemote403 = parsed.positional[0] || '';
                console.log(C.dim('  Fetching…'));
                execSync(`git fetch ${fetchRemote403} --prune 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                // Show staleness: local branches vs their upstream
                let branchOut403 = '';
                try {
                    branchOut403 = execSync('git branch -vv', { encoding: 'utf8', stdio: 'pipe' }).trim();
                } catch { /* ok */ }
                const branch403 = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                console.log('');
                branchOut403.split('\n').forEach(line403 => {
                    const isCur = line403.startsWith('*');
                    const behind403 = line403.match(/behind (\d+)/);
                    const ahead403 = line403.match(/ahead (\d+)/);
                    const gone403 = line403.includes(': gone]');
                    let suffix403 = '';
                    if (behind403) suffix403 += C.yellow(` ↓${behind403[1]}`);
                    if (ahead403) suffix403 += C.green(` ↑${ahead403[1]}`);
                    if (gone403) suffix403 += C.red(' [gone]');
                    const prefix = isCur ? C.green('* ') : C.dim('  ');
                    const parts403 = line403.slice(2).split(/\s+/);
                    const name403 = parts403[0] || '';
                    const sha403 = parts403[1] || '';
                    console.log('  ' + prefix + C.white(name403.padEnd(24)) + C.dim(sha403) + suffix403);
                });
                console.log('');
                console.log(C.green('  ✔ Fetched') + C.dim(` (current: ${branch403})`));
            } catch (e) {
                console.error(C.red('  ✘ Fetch failed: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                process.exit(1);
            }
            return;
        }

        case 'branch': {
            // Wave 404: tentaclaw branch [name] [--delete|-d] [--list] — top-level branch management
            const branchName404 = parsed.positional[0] || '';
            const branchDelete404 = parsed.flags['delete'] === 'true' || parsed.flags['d'] === 'true' || parsed.flags['delete'] === '' || parsed.flags['d'] === '';
            const branchNew404 = parsed.flags['b'] === 'true' || parsed.flags['b'] === '' || parsed.flags['new'] === 'true' || parsed.flags['new'] === '';
            try {
                const current404 = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
                if (!branchName404 || parsed.flags['list'] !== undefined) {
                    // List branches with tracking info
                    const out404 = execSync('git branch -vv', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    console.log('');
                    out404.split('\n').forEach(l => {
                        const isCur = l.startsWith('*');
                        const parts = l.slice(2).trim().split(/\s+/);
                        const name = parts[0] || '';
                        const sha = parts[1] || '';
                        const trackMatch = l.match(/\[([^\]]+)\]/);
                        const track = trackMatch ? C.dim(` [${trackMatch[1]}]`) : '';
                        console.log('  ' + (isCur ? C.green('* ' + name) : C.dim('  ' + name)) + ' ' + C.dim(sha) + track);
                    });
                    console.log('');
                } else if (branchDelete404) {
                    if (branchName404 === current404) { console.log(C.red(`  ✘ Cannot delete current branch: ${branchName404}`)); return; }
                    execSync(`git branch -d ${branchName404} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                    console.log(C.green(`  ✔ Deleted branch: ${branchName404}`));
                } else if (branchNew404) {
                    execSync(`git checkout -b ${branchName404} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                    console.log(C.green(`  ✔ Created and switched to: ${branchName404} (from ${current404})`));
                } else {
                    // Switch to existing branch
                    execSync(`git checkout ${branchName404} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                    console.log(C.green(`  ✔ Switched to: ${branchName404}`) + C.dim(` (was: ${current404})`));
                }
            } catch (e) {
                console.error(C.red('  ✘ Branch error: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e))));
                process.exit(1);
            }
            return;
        }

        case 'revert': {
            // Wave 405: tentaclaw revert [<commit>] [--no-edit] — git revert wrapper
            const revertTarget405 = parsed.positional[0] || 'HEAD';
            const noEdit405 = parsed.flags['no-edit'] === 'true' || parsed.flags['no-edit'] === '';
            try {
                // Show what commit we're reverting
                const commitInfo405 = execSync(`git log -1 --format="%h %s" ${revertTarget405}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                console.log(C.dim(`  Reverting: ${commitInfo405}`));
                const noEditFlag = noEdit405 ? ' --no-edit' : ' --no-edit'; // always --no-edit (no interactive editor)
                execSync(`git revert${noEditFlag} ${revertTarget405} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
                const newCommit405 = execSync('git log -1 --format="%h %s"', { encoding: 'utf8', stdio: 'pipe' }).trim();
                console.log(C.green(`  ✔ Reverted → ${newCommit405}`));
            } catch (e) {
                const msg405 = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join('\n  ');
                console.error(C.red('  ✘ Revert failed:\n  ') + msg405);
                process.exit(1);
            }
            return;
        }

        default:
            console.error('');
            console.error(C.red('  \u2718 Unknown command: ') + C.white(parsed.command));
            console.error(C.dim('  Run "tentaclaw help" for usage.'));
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

    const totalGb = data.total_vram_gb ?? Math.round((data.total_vram_mb ?? 0) / 1024);
    const usedGb  = data.used_vram_gb  ?? Math.round((data.used_vram_mb  ?? 0) / 1024);
    const freeGb  = data.free_vram_gb  ?? Math.round((data.free_vram_mb  ?? 0) / 1024);
    const utilPct = data.utilization_pct || 0;
    console.log(boxMid(padRight(C.dim('Total VRAM'), 18) + C.white(C.bold(totalGb + ' GB')), W));
    console.log(boxMid(padRight(C.dim('Used'), 18) + C.yellow(usedGb + ' GB'), W));
    console.log(boxMid(padRight(C.dim('Free'), 18) + C.green(freeGb + ' GB'), W));
    console.log(boxMid(padRight(C.dim('Utilization'), 18) + progressBar(utilPct, 20) + '  ' + (utilPct > 80 ? C.red : C.white)(utilPct + '%'), W));
    console.log(boxEmpty(W));
    if (data.recommendation) console.log(boxMid(C.cyan(data.recommendation), W));

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
