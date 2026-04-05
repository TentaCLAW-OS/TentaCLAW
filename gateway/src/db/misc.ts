/**
 * TentaCLAW Gateway — Miscellaneous DB Operations
 * (Tags, SSH Keys, Flight Sheets, Benchmarks, Notifications, Schedules,
 *  Uptime, Overclock, Watchdog, Playground, Prompt Cache, Node Groups,
 *  Placement Constraints, Config Export/Import)
 */

import type { SshKey, NodeWithStats } from '../../../shared/types';
import { getDb, generateId } from './init';
import { safeJsonParse } from './safe-json';

/** Ensure stats.inference and stats.gpus always exist (duplicated from nodes.ts to avoid circular dep) */
function _normalizeStats(stats: any): any {
    if (!stats) return null;
    if (!stats.inference || typeof stats.inference !== 'object') {
        stats.inference = { loaded_models: [], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 };
    }
    if (!Array.isArray(stats.inference.loaded_models)) stats.inference.loaded_models = [];
    if (!Array.isArray(stats.gpus)) stats.gpus = [];
    return stats;
}

// =============================================================================
// Benchmarks
// =============================================================================

export interface BenchmarkRecord {
    id: string;
    node_id: string;
    model: string;
    tokens_per_sec: number;
    prompt_eval_rate: number;
    eval_rate: number;
    total_duration_ms: number;
    created_at: string;
}

export function storeBenchmark(nodeId: string, result: {
    model: string;
    tokens_per_sec: number;
    prompt_eval_rate?: number;
    eval_rate?: number;
    total_duration_ms?: number;
}): BenchmarkRecord {
    const d = getDb();
    const id = generateId();

    d.prepare(`
        INSERT INTO benchmarks (id, node_id, model, tokens_per_sec, prompt_eval_rate, eval_rate, total_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, nodeId, result.model, result.tokens_per_sec, result.prompt_eval_rate || 0, result.eval_rate || 0, result.total_duration_ms || 0);

    return d.prepare('SELECT * FROM benchmarks WHERE id = ?').get(id) as BenchmarkRecord;
}

export function getNodeBenchmarks(nodeId: string, limit: number = 20): BenchmarkRecord[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM benchmarks WHERE node_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(nodeId, limit) as BenchmarkRecord[];
}

export function getAllBenchmarks(limit: number = 50): BenchmarkRecord[] {
    const d = getDb();
    return d.prepare(
        'SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as BenchmarkRecord[];
}

// =============================================================================
// Schedules (cron-like tasks)
// =============================================================================

export interface Schedule {
    id: string;
    name: string;
    type: string;
    cron: string;
    config: Record<string, unknown>;
    enabled: boolean;
    last_run: string | null;
    next_run: string | null;
    created_at: string;
}

export function createSchedule(name: string, type: string, cron: string, config: Record<string, unknown>): Schedule {
    const d = getDb();
    const id = generateId();
    const nextRun = computeNextRun(cron);

    d.prepare(`
        INSERT INTO schedules (id, name, type, cron, config, next_run)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, type, cron, JSON.stringify(config), nextRun);

    return getSchedule(id)!;
}

export function getSchedule(id: string): Schedule | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, config: safeJsonParse(row.config, {}), enabled: !!row.enabled };
}

export function getAllSchedules(): Schedule[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ ...r, config: safeJsonParse(r.config, {}), enabled: !!r.enabled }));
}

export function deleteSchedule(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
}

export function toggleSchedule(id: string, enabled: boolean): boolean {
    const d = getDb();
    return d.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;
}

export function markScheduleRun(id: string): void {
    const d = getDb();
    const schedule = getSchedule(id);
    if (!schedule) return;
    const nextRun = computeNextRun(schedule.cron);
    d.prepare('UPDATE schedules SET last_run = datetime(\'now\'), next_run = ? WHERE id = ?').run(nextRun, id);
}

export function getDueSchedules(): Schedule[] {
    const d = getDb();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const rows = d.prepare(
        'SELECT * FROM schedules WHERE enabled = 1 AND (next_run IS NULL OR next_run <= ?)'
    ).all(now) as any[];
    return rows.map(r => ({ ...r, config: safeJsonParse(r.config, {}), enabled: !!r.enabled }));
}

/**
 * Simple cron-to-next-run computation.
 */
function computeNextRun(cron: string): string {
    const now = new Date();
    let next: Date;

    if (cron === '@hourly') {
        next = new Date(now.getTime() + 3600000);
    } else if (cron === '@daily') {
        next = new Date(now.getTime() + 86400000);
    } else if (cron.startsWith('@every ')) {
        const match = cron.match(/@every\s+(\d+)([hms])/);
        if (match) {
            const val = parseInt(match[1]);
            const unit = match[2];
            const ms = unit === 'h' ? val * 3600000 : unit === 'm' ? val * 60000 : val * 1000;
            next = new Date(now.getTime() + ms);
        } else {
            next = new Date(now.getTime() + 3600000);
        }
    } else {
        next = new Date(now.getTime() + 3600000);
    }

    return next.toISOString().replace('T', ' ').slice(0, 19);
}

// =============================================================================
// SSH Key Management
// =============================================================================

export function addSshKey(nodeId: string, label: string, publicKey: string): SshKey {
    const d = getDb();
    const id = generateId();
    const keyParts = publicKey.trim().split(/\s+/);
    const keyData = keyParts.length >= 2 ? keyParts[1] : keyParts[0];
    const fingerprint = 'SHA256:' + keyData.slice(0, 43).replace(/[+/=]/g, '');

    d.prepare(`
        INSERT INTO ssh_keys (id, node_id, label, public_key, fingerprint)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, nodeId, label, publicKey.trim(), fingerprint);

    return d.prepare('SELECT * FROM ssh_keys WHERE id = ?').get(id) as SshKey;
}

export function getNodeSshKeys(nodeId: string): SshKey[] {
    const d = getDb();
    return d.prepare('SELECT * FROM ssh_keys WHERE node_id = ? ORDER BY created_at DESC').all(nodeId) as SshKey[];
}

export function deleteSshKey(keyId: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM ssh_keys WHERE id = ?').run(keyId).changes > 0;
}

// =============================================================================
// Node Tags
// =============================================================================

export function addNodeTag(nodeId: string, tag: string): void {
    const d = getDb();
    d.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)').run(nodeId, tag.toLowerCase().trim());
}

export function removeNodeTag(nodeId: string, tag: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM node_tags WHERE node_id = ? AND tag = ?').run(nodeId, tag.toLowerCase().trim()).changes > 0;
}

export function getNodeTags(nodeId: string): string[] {
    const d = getDb();
    const rows = d.prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag').all(nodeId) as { tag: string }[];
    return rows.map(r => r.tag);
}

export function getNodesByTag(tag: string): NodeWithStats[] {
    const d = getDb();
    const nodeIds = d.prepare(
        'SELECT node_id FROM node_tags WHERE tag = ?'
    ).all(tag.toLowerCase().trim()) as { node_id: string }[];

    // Inline node+stats lookup to avoid circular dependency with nodes.ts
    return nodeIds.map(r => {
        const node = d.prepare('SELECT * FROM nodes WHERE id = ?').get(r.node_id) as any;
        if (!node) return null;
        const latestStat = d.prepare(
            'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(r.node_id) as { payload: string } | undefined;
        return {
            ...node,
            latest_stats: latestStat ? _normalizeStats(safeJsonParse(latestStat.payload, null)) : null,
        };
    }).filter((n): n is NodeWithStats => n !== null);
}

export function getAllTags(): Array<{ tag: string; count: number }> {
    const d = getDb();
    return d.prepare(
        'SELECT tag, COUNT(*) as count FROM node_tags GROUP BY tag ORDER BY count DESC'
    ).all() as Array<{ tag: string; count: number }>;
}

// =============================================================================
// Uptime Tracking
// =============================================================================

export function recordUptimeEvent(nodeId: string, event: string, fromStatus?: string, toStatus?: string): void {
    const d = getDb();
    d.prepare('INSERT INTO uptime_events (node_id, event, from_status, to_status) VALUES (?, ?, ?, ?)').run(nodeId, event, fromStatus || null, toStatus || null);
}

export function getNodeUptime(nodeId: string, hours: number = 24): { uptime_pct: number; total_online_s: number; total_offline_s: number; events: number } {
    const d = getDb();
    const since = new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

    const events = d.prepare(
        'SELECT * FROM uptime_events WHERE node_id = ? AND created_at >= ? ORDER BY created_at'
    ).all(nodeId, since) as any[];

    let onlineMs = 0;
    let offlineMs = 0;
    let lastTime = Date.now() - hours * 3600_000;
    let lastStatus = 'offline';

    const node = d.prepare('SELECT status FROM nodes WHERE id = ?').get(nodeId) as any;
    if (node) lastStatus = node.status === 'online' ? 'online' : 'offline';

    for (const evt of events) {
        const evtTime = new Date(evt.created_at + 'Z').getTime();
        const elapsed = evtTime - lastTime;
        if (lastStatus === 'online') onlineMs += elapsed;
        else offlineMs += elapsed;

        if (evt.to_status) lastStatus = evt.to_status;
        lastTime = evtTime;
    }

    const remaining = Date.now() - lastTime;
    if (lastStatus === 'online') onlineMs += remaining;
    else offlineMs += remaining;

    const total = onlineMs + offlineMs;
    return {
        uptime_pct: total > 0 ? Math.round((onlineMs / total) * 1000) / 10 : 0,
        total_online_s: Math.round(onlineMs / 1000),
        total_offline_s: Math.round(offlineMs / 1000),
        events: events.length,
    };
}

export function getFleetUptime(hours: number = 24): Array<{ node_id: string; hostname: string; uptime_pct: number }> {
    const d = getDb();
    const nodes = d.prepare('SELECT id, hostname FROM nodes').all() as any[];
    return nodes.map(n => {
        const uptime = getNodeUptime(n.id, hours);
        return { node_id: n.id, hostname: n.hostname, uptime_pct: uptime.uptime_pct };
    });
}

// =============================================================================
// Overclock Profiles
// =============================================================================

export function setOverclockProfile(nodeId: string, gpuIndex: number, profile: {
    core_offset_mhz?: number;
    mem_offset_mhz?: number;
    power_limit_w?: number;
    fan_speed_pct?: number;
}): void {
    const d = getDb();
    const id = `${nodeId}:${gpuIndex}`;
    const existing = d.prepare('SELECT id FROM overclock_profiles WHERE id = ?').get(id);

    if (existing) {
        const sets: string[] = ["applied_at = datetime('now')"];
        const vals: unknown[] = [];
        if (profile.core_offset_mhz !== undefined) { sets.push('core_offset_mhz = ?'); vals.push(profile.core_offset_mhz); }
        if (profile.mem_offset_mhz !== undefined) { sets.push('mem_offset_mhz = ?'); vals.push(profile.mem_offset_mhz); }
        if (profile.power_limit_w !== undefined) { sets.push('power_limit_w = ?'); vals.push(profile.power_limit_w); }
        if (profile.fan_speed_pct !== undefined) { sets.push('fan_speed_pct = ?'); vals.push(profile.fan_speed_pct); }
        vals.push(id);
        d.prepare(`UPDATE overclock_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    } else {
        d.prepare(`INSERT INTO overclock_profiles (id, node_id, gpu_index, core_offset_mhz, mem_offset_mhz, power_limit_w, fan_speed_pct) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            id, nodeId, gpuIndex,
            profile.core_offset_mhz || 0, profile.mem_offset_mhz || 0,
            profile.power_limit_w || 0, profile.fan_speed_pct || 0,
        );
    }
}

export function getOverclockProfiles(nodeId: string): any[] {
    const d = getDb();
    return d.prepare('SELECT * FROM overclock_profiles WHERE node_id = ? ORDER BY gpu_index').all(nodeId) as any[];
}

// =============================================================================
// Watchdog Events
// =============================================================================

export function recordWatchdogEvent(nodeId: string, level: number, action: string, detail: string): void {
    const d = getDb();
    d.prepare('INSERT INTO watchdog_events (node_id, level, action, detail) VALUES (?, ?, ?, ?)').run(nodeId, level, action, detail);
}

export function getWatchdogEvents(nodeId: string, limit: number = 50): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> {
    const d = getDb();
    return d.prepare('SELECT * FROM watchdog_events WHERE node_id = ? ORDER BY created_at DESC LIMIT ?').all(nodeId, limit) as any[];
}

export function getAllWatchdogEvents(limit: number = 100): Array<{ id: number; node_id: string; level: number; action: string; detail: string; created_at: string }> {
    const d = getDb();
    return d.prepare('SELECT * FROM watchdog_events ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

// =============================================================================
// Notification Channels
// =============================================================================

export function createNotificationChannel(type: string, name: string, config: Record<string, unknown>): any {
    // Validate webhook URLs to prevent SSRF
    if (type === 'discord' && config.webhook_url) {
        const wh = String(config.webhook_url);
        if (!wh.startsWith('https://discord.com/') && !wh.startsWith('https://discordapp.com/')) {
            throw new Error('Discord webhook URL must start with https://discord.com/ or https://discordapp.com/');
        }
    }
    if (type === 'webhook' && config.url) {
        try { new URL(String(config.url)); } catch { throw new Error('Invalid webhook URL'); }
    }
    const d = getDb();
    const id = generateId();
    d.prepare('INSERT INTO notification_channels (id, type, name, config) VALUES (?, ?, ?, ?)').run(id, type, name, JSON.stringify(config));
    return d.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id);
}

export function getAllNotificationChannels(): any[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM notification_channels ORDER BY created_at').all() as any[];
    return rows.map(r => ({ ...r, config: safeJsonParse(r.config, {}), enabled: !!r.enabled }));
}

export function deleteNotificationChannel(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes > 0;
}

export async function sendNotification(channelId: string, message: string): Promise<boolean> {
    const d = getDb();
    const channel = d.prepare('SELECT * FROM notification_channels WHERE id = ? AND enabled = 1').get(channelId) as any;
    if (!channel) return false;

    const config = safeJsonParse(channel.config, {} as Record<string, any>);

    try {
        switch (channel.type) {
            case 'telegram': {
                const safeBotToken = String(config.bot_token || '').replace(/[^a-zA-Z0-9:_-]/g, '');
                const url = `https://api.telegram.org/bot${safeBotToken}/sendMessage`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: config.chat_id, text: message, parse_mode: 'HTML' }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            case 'discord': {
                const webhookUrl = String(config.webhook_url || '');
                if (!webhookUrl.startsWith('https://')) return false;
                const resp = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: message }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            case 'webhook': {
                const whUrl = String(config.url || '');
                if (!whUrl.startsWith('http://') && !whUrl.startsWith('https://')) return false;
                const resp = await fetch(whUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, timestamp: new Date().toISOString() }),
                });
                d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, resp.ok ? 'sent' : 'failed');
                return resp.ok;
            }
            default:
                return false;
        }
    } catch {
        d.prepare('INSERT INTO notification_log (channel_id, message, status) VALUES (?, ?, ?)').run(channelId, message, 'error');
        return false;
    }
}

// =============================================================================
// Playground History
// =============================================================================

export function insertPlaygroundHistory(entry: {
    model: string;
    prompt_preview: string;
    response_preview: string;
    latency_ms: number;
    tokens_in?: number;
    tokens_out?: number;
    node_id?: string;
}): void {
    const d = getDb();
    d.prepare(
        `INSERT INTO playground_history (model, prompt_preview, response_preview, latency_ms, tokens_in, tokens_out, node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        entry.model,
        entry.prompt_preview.slice(0, 100),
        entry.response_preview.slice(0, 200),
        entry.latency_ms,
        entry.tokens_in || 0,
        entry.tokens_out || 0,
        entry.node_id || null,
    );
}

export function getPlaygroundHistory(limit: number = 50): Array<{
    id: number;
    model: string;
    prompt_preview: string;
    response_preview: string;
    latency_ms: number;
    tokens_in: number;
    tokens_out: number;
    node_id: string | null;
    created_at: string;
}> {
    const d = getDb();
    return d.prepare('SELECT * FROM playground_history ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

// =============================================================================
// Prompt Cache
// =============================================================================

export function getCachedResponse(promptHash: string): { response: string; tokens_saved: number } | null {
    const d = getDb();
    const row = d.prepare(`
        SELECT response, tokens_saved FROM prompt_cache
        WHERE hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(promptHash) as any;

    if (row) {
        d.prepare('UPDATE prompt_cache SET hits = hits + 1 WHERE hash = ?').run(promptHash);
        return { response: row.response, tokens_saved: row.tokens_saved || 0 };
    }
    return null;
}

export function cacheResponse(promptHash: string, model: string, promptPreview: string, response: string, tokensSaved: number, ttlMinutes: number = 60): void {
    const d = getDb();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString().replace('T', ' ').slice(0, 19);
    d.prepare(`INSERT OR REPLACE INTO prompt_cache (hash, model, prompt_preview, response, tokens_saved, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        promptHash, model, promptPreview.slice(0, 100), response, tokensSaved, expiresAt
    );
}

export function getCacheStats(): { entries: number; total_hits: number; total_tokens_saved: number } {
    const d = getDb();
    const stats = d.prepare(`
        SELECT COUNT(*) as entries, COALESCE(SUM(hits), 0) as total_hits, COALESCE(SUM(tokens_saved * hits), 0) as total_tokens_saved
        FROM prompt_cache WHERE expires_at IS NULL OR expires_at > datetime('now')
    `).get() as any;
    return stats;
}

export function pruneCache(): number {
    const d = getDb();
    const result = d.prepare("DELETE FROM prompt_cache WHERE expires_at <= datetime('now')").run();
    return result.changes;
}

// =============================================================================
// Node Groups
// =============================================================================

export function createNodeGroup(name: string, description?: string): { id: string; name: string } {
    const d = getDb();
    const id = generateId();
    d.prepare('INSERT INTO node_groups (id, name, description) VALUES (?, ?, ?)').run(id, name, description || null);
    return { id, name };
}

export function getNodeGroups(): Array<{ id: string; name: string; description: string | null; member_count: number }> {
    const d = getDb();
    return d.prepare(`
        SELECT g.id, g.name, g.description, COUNT(m.node_id) as member_count
        FROM node_groups g LEFT JOIN node_group_members m ON g.id = m.group_id
        GROUP BY g.id ORDER BY g.name
    `).all() as any[];
}

export function addNodeToGroup(groupId: string, nodeId: string): void {
    getDb().prepare('INSERT OR IGNORE INTO node_group_members (group_id, node_id) VALUES (?, ?)').run(groupId, nodeId);
}

export function removeNodeFromGroup(groupId: string, nodeId: string): void {
    getDb().prepare('DELETE FROM node_group_members WHERE group_id = ? AND node_id = ?').run(groupId, nodeId);
}

export function getGroupMembers(groupId: string): string[] {
    return (getDb().prepare('SELECT node_id FROM node_group_members WHERE group_id = ?').all(groupId) as { node_id: string }[]).map(r => r.node_id);
}

export function deleteNodeGroup(id: string): boolean {
    const d = getDb();
    d.prepare('DELETE FROM node_group_members WHERE group_id = ?').run(id);
    return d.prepare('DELETE FROM node_groups WHERE id = ?').run(id).changes > 0;
}

// =============================================================================
// Placement Constraints
// =============================================================================

export function addPlacementConstraint(model: string, constraintType: string, target: string): { id: string } {
    const d = getDb();
    const id = generateId();
    d.prepare('INSERT INTO placement_constraints (id, model, constraint_type, target) VALUES (?, ?, ?, ?)').run(id, model, constraintType, target);
    return { id };
}

export function getPlacementConstraints(model?: string): Array<{ id: string; model: string; constraint_type: string; target: string }> {
    const d = getDb();
    if (model) return d.prepare('SELECT * FROM placement_constraints WHERE model = ?').all(model) as any[];
    return d.prepare('SELECT * FROM placement_constraints').all() as any[];
}

export function deletePlacementConstraint(id: string): boolean {
    return getDb().prepare('DELETE FROM placement_constraints WHERE id = ?').run(id).changes > 0;
}

// =============================================================================
// Config Export/Import
// =============================================================================

export function exportClusterConfig(): Record<string, unknown> {
    const d = getDb();
    // Inline alias query to avoid circular dependency with models.ts
    const aliasRows = d.prepare('SELECT * FROM model_aliases ORDER BY alias').all() as any[];
    const aliases = aliasRows.map(r => ({ ...r, fallbacks: safeJsonParse(r.fallbacks || '[]', []) }));
    // Inline flight sheet query to avoid circular dependency with commands.ts
    const fsRows = d.prepare('SELECT * FROM flight_sheets ORDER BY created_at DESC').all() as any[];
    const flightSheets = fsRows.map(r => ({ ...r, targets: safeJsonParse(r.targets, []) }));

    return {
        version: '0.2.0',
        exported_at: new Date().toISOString(),
        aliases,
        flight_sheets: flightSheets,
        schedules: getAllSchedules(),
        tags: getAllTags(),
        notification_channels: getAllNotificationChannels(),
        node_tags: (() => {
            return d.prepare('SELECT * FROM node_tags').all();
        })(),
    };
}

export function importClusterConfig(config: Record<string, any>): { imported: string[]; errors: string[] } {
    const d = getDb();
    const imported: string[] = [];
    const errors: string[] = [];

    // Import aliases (inline to avoid circular dependency with models.ts)
    if (config.aliases && Array.isArray(config.aliases)) {
        for (const a of config.aliases) {
            try {
                d.prepare('INSERT OR REPLACE INTO model_aliases (alias, target, fallbacks) VALUES (?, ?, ?)').run(
                    a.alias, a.target, JSON.stringify(a.fallbacks || [])
                );
                imported.push('alias:' + a.alias);
            } catch (e) { errors.push('alias:' + a.alias + ': ' + e); }
        }
    }

    // Import flight sheets (inline to avoid circular dependency with commands.ts)
    if (config.flight_sheets && Array.isArray(config.flight_sheets)) {
        for (const fs of config.flight_sheets) {
            try {
                const id = generateId();
                d.prepare('INSERT INTO flight_sheets (id, name, description, targets) VALUES (?, ?, ?, ?)').run(
                    id, fs.name, fs.description || '', JSON.stringify(fs.targets || [])
                );
                imported.push('flight_sheet:' + fs.name);
            } catch (e) { errors.push('flight_sheet:' + fs.name + ': ' + e); }
        }
    }

    if (config.schedules && Array.isArray(config.schedules)) {
        for (const s of config.schedules) {
            try {
                createSchedule(s.name, s.type, s.cron, s.config || {});
                imported.push('schedule:' + s.name);
            } catch (e) { errors.push('schedule:' + s.name + ': ' + e); }
        }
    }

    if (config.notification_channels && Array.isArray(config.notification_channels)) {
        for (const ch of config.notification_channels) {
            try {
                createNotificationChannel(ch.type, ch.name, ch.config || {});
                imported.push('notification:' + ch.name);
            } catch (e) { errors.push('notification:' + ch.name + ': ' + e); }
        }
    }

    return { imported, errors };
}
