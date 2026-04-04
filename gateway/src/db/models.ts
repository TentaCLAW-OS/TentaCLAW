/**
 * TentaCLAW Gateway — Model Management, Aliases, Pulls, Scheduling
 */

import type { ModelPullProgress } from '../../../shared/types';
import { getDb, generateId } from './init';
import { getNode, getAllNodes } from './nodes';
import { getClusterModels } from './stats';
import { queueCommand } from './commands';
import { safeJsonParse } from './safe-json';

// =============================================================================
// Smart Model Management -- VRAM estimation
// =============================================================================

// Known model VRAM requirements (approximate, in MB)
const MODEL_VRAM_MAP: Record<string, number> = {
    'llama3.1:8b': 5120, 'llama3.1:70b': 41000, 'llama3.2:3b': 2048, 'llama3.2:1b': 1024,
    'codellama:7b': 4608, 'codellama:13b': 8192, 'codellama:34b': 20480,
    'mistral:7b': 4608, 'mixtral:8x7b': 28672,
    'qwen2.5:7b': 4608, 'qwen2.5:3b': 2048, 'qwen3:14b': 9216,
    'gemma2:9b': 5632, 'phi3:3.8b': 2560,
    'deepseek-coder-v2:16b': 10240, 'hermes3:8b': 5120,
    'nomic-embed-text': 512, 'dolphin-mistral': 4096,
};

export function estimateModelVram(model: string): number {
    if (MODEL_VRAM_MAP[model]) return MODEL_VRAM_MAP[model];
    const base = model.split(':')[0];
    for (const [key, vram] of Object.entries(MODEL_VRAM_MAP)) {
        if (key.startsWith(base)) return vram;
    }
    const paramMatch = model.match(/(\d+)b/i);
    if (paramMatch) {
        const params = parseInt(paramMatch[1]);
        return params * 600;
    }
    return 4096;
}

export function checkModelFits(model: string, nodeId: string): { fits: boolean; required_mb: number; available_mb: number; node: string } {
    const node = getNode(nodeId);
    if (!node || !node.latest_stats) return { fits: false, required_mb: 0, available_mb: 0, node: nodeId };

    const required = estimateModelVram(model);
    const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
    const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
    const available = totalVram - usedVram;

    return { fits: available >= required, required_mb: required, available_mb: available, node: nodeId };
}

export function findBestNodeForModel(model: string): { node_id: string; hostname: string; available_mb: number } | null {
    const nodes = getAllNodes();
    const required = estimateModelVram(model);

    const candidates: Array<{ node_id: string; hostname: string; available_mb: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (node.latest_stats.inference.loaded_models.includes(model)) continue;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const available = totalVram - usedVram;

        if (available >= required) {
            candidates.push({ node_id: node.id, hostname: node.hostname, available_mb: available });
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.available_mb - a.available_mb);
    return candidates[0];
}

export function getModelDistribution(): Array<{
    model: string;
    estimated_vram_mb: number;
    nodes: Array<{ node_id: string; hostname: string }>;
    coverage: number;
}> {
    const models = getClusterModels();
    const onlineCount = getAllNodes().filter(n => n.status === 'online').length;

    return models.map(m => ({
        model: m.model,
        estimated_vram_mb: estimateModelVram(m.model),
        nodes: m.nodes.map(nid => {
            const n = getAllNodes().find(x => x.id === nid);
            return { node_id: nid, hostname: n?.hostname || '?' };
        }),
        coverage: onlineCount > 0 ? Math.round((m.node_count / onlineCount) * 100) : 0,
    }));
}

// =============================================================================
// Model Aliases & Fallback Chains
// =============================================================================

export function setModelAlias(alias: string, target: string, fallbacks: string[] = []): void {
    const d = getDb();
    d.prepare('INSERT OR REPLACE INTO model_aliases (alias, target, fallbacks) VALUES (?, ?, ?)').run(
        alias, target, JSON.stringify(fallbacks)
    );
}

export function resolveModelAlias(model: string): { target: string; fallbacks: string[] } {
    const d = getDb();
    const row = d.prepare('SELECT target, fallbacks FROM model_aliases WHERE alias = ?').get(model) as any;
    if (row) {
        return { target: row.target, fallbacks: safeJsonParse(row.fallbacks || '[]', []) };
    }
    return { target: model, fallbacks: [] };
}

export function getAllModelAliases(): Array<{ alias: string; target: string; fallbacks: string[]; created_at: string }> {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM model_aliases ORDER BY alias').all() as any[];
    return rows.map(r => ({ ...r, fallbacks: safeJsonParse(r.fallbacks || '[]', []) }));
}

export function deleteModelAlias(alias: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM model_aliases WHERE alias = ?').run(alias).changes > 0;
}

export function ensureDefaultAliases(): void {
    const d = getDb();
    const count = (d.prepare('SELECT COUNT(*) as cnt FROM model_aliases').get() as { cnt: number }).cnt;
    if (count > 0) return;

    const defaults: Array<[string, string, string[]]> = [
        ['gpt-4', 'llama3.1:70b', ['llama3.1:8b', 'mistral:7b']],
        ['gpt-4o', 'llama3.1:70b', ['qwen3:14b', 'llama3.1:8b']],
        ['gpt-3.5-turbo', 'llama3.1:8b', ['mistral:7b', 'llama3.2:3b']],
        ['gpt-4o-mini', 'llama3.2:3b', ['llama3.2:1b', 'phi3:3.8b']],
        ['claude-3-opus', 'llama3.1:70b', ['qwen3:14b', 'llama3.1:8b']],
        ['claude-3-sonnet', 'llama3.1:8b', ['mistral:7b', 'qwen2.5:7b']],
        ['claude-3-haiku', 'llama3.2:3b', ['llama3.2:1b']],
        ['claude-3-opus-20240229', 'llama3.1:70b', ['qwen3:14b', 'llama3.1:8b']],
        ['claude-3-5-sonnet-20241022', 'llama3.1:8b', ['mistral:7b', 'qwen2.5:7b']],
        ['claude-3-haiku-20240307', 'llama3.2:3b', ['llama3.2:1b']],
        ['codex', 'codellama:13b', ['codellama:7b', 'qwen2.5-coder:7b']],
        ['text-embedding-ada-002', 'nomic-embed-text', []],
    ];

    for (const [alias, target, fallbacks] of defaults) {
        setModelAlias(alias, target, fallbacks);
    }
}

// =============================================================================
// Model Pull Progress
// =============================================================================

export function startModelPull(nodeId: string, model: string): ModelPullProgress {
    const d = getDb();
    const id = generateId();
    d.prepare(`
        INSERT INTO model_pulls (id, node_id, model) VALUES (?, ?, ?)
    `).run(id, nodeId, model);
    return d.prepare('SELECT * FROM model_pulls WHERE id = ?').get(id) as ModelPullProgress;
}

export function updateModelPull(nodeId: string, model: string, progress: {
    status?: string;
    progress_pct?: number;
    bytes_downloaded?: number;
    bytes_total?: number;
}): void {
    const d = getDb();
    const sets: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];

    if (progress.status) { sets.push('status = ?'); vals.push(progress.status); }
    if (progress.progress_pct !== undefined) { sets.push('progress_pct = ?'); vals.push(progress.progress_pct); }
    if (progress.bytes_downloaded !== undefined) { sets.push('bytes_downloaded = ?'); vals.push(progress.bytes_downloaded); }
    if (progress.bytes_total !== undefined) { sets.push('bytes_total = ?'); vals.push(progress.bytes_total); }

    vals.push(nodeId, model);
    d.prepare(`UPDATE model_pulls SET ${sets.join(', ')} WHERE node_id = ? AND model = ? AND status = 'downloading'`).run(...vals);
}

export function getActiveModelPulls(nodeId: string): ModelPullProgress[] {
    const d = getDb();
    return d.prepare(
        "SELECT * FROM model_pulls WHERE node_id = ? AND status IN ('downloading', 'verifying') ORDER BY started_at DESC"
    ).all(nodeId) as ModelPullProgress[];
}

export function getAllActiveModelPulls(): ModelPullProgress[] {
    const d = getDb();
    return d.prepare(
        "SELECT * FROM model_pulls WHERE status IN ('downloading', 'verifying') ORDER BY started_at DESC"
    ).all() as ModelPullProgress[];
}

// =============================================================================
// Model Scheduling Engine -- Eviction, Bin-Packing, Priorities
// =============================================================================

export function getEvictionCandidates(nodeId: string): Array<{ model: string; last_used: string; request_count: number; vram_mb: number }> {
    const d = getDb();
    const node = getNode(nodeId);
    if (!node || !node.latest_stats) return [];

    const loadedModels = node.latest_stats.inference.loaded_models;
    if (loadedModels.length === 0) return [];

    const candidates: Array<{ model: string; last_used: string; request_count: number; vram_mb: number }> = [];

    for (const model of loadedModels) {
        const priority = getModelPriority(model);
        if (priority === 'critical') continue;

        const usage = d.prepare(`
            SELECT MAX(created_at) as last_used, COUNT(*) as request_count
            FROM inference_log
            WHERE node_id = ? AND model = ?
        `).get(nodeId, model) as { last_used: string | null; request_count: number };

        candidates.push({
            model,
            last_used: usage.last_used || '1970-01-01 00:00:00',
            request_count: usage.request_count,
            vram_mb: estimateModelVram(model),
        });
    }

    candidates.sort((a, b) => a.last_used.localeCompare(b.last_used));
    return candidates;
}

export function scheduleModelDeployment(model: string, count: number = 1): Array<{ node_id: string; hostname: string; available_vram_mb: number; evictions_needed: string[] }> {
    const nodes = getAllNodes();
    const requiredVram = estimateModelVram(model);

    const plans: Array<{ node_id: string; hostname: string; available_vram_mb: number; evictions_needed: string[]; cost: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (node.latest_stats.inference.loaded_models.includes(model)) continue;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const availableVram = totalVram - usedVram;

        if (totalVram < requiredVram) continue;

        if (availableVram >= requiredVram) {
            plans.push({
                node_id: node.id,
                hostname: node.hostname,
                available_vram_mb: availableVram,
                evictions_needed: [],
                cost: 0,
            });
        } else {
            const candidates = getEvictionCandidates(node.id);
            const evictions: string[] = [];
            let freedVram = availableVram;

            for (const candidate of candidates) {
                if (freedVram >= requiredVram) break;
                evictions.push(candidate.model);
                freedVram += candidate.vram_mb;
            }

            if (freedVram >= requiredVram) {
                plans.push({
                    node_id: node.id,
                    hostname: node.hostname,
                    available_vram_mb: availableVram,
                    evictions_needed: evictions,
                    cost: evictions.length,
                });
            }
        }
    }

    plans.sort((a, b) => a.cost - b.cost || b.available_vram_mb - a.available_vram_mb);

    return plans.slice(0, count).map(({ cost: _cost, ...plan }) => plan);
}

export function setModelPriority(model: string, priority: 'critical' | 'normal' | 'low'): void {
    const d = getDb();
    d.prepare(`
        INSERT INTO model_priorities (model, priority, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(model) DO UPDATE SET priority = excluded.priority, updated_at = datetime('now')
    `).run(model, priority);
}

export function getModelPriority(model: string): 'critical' | 'normal' | 'low' {
    const d = getDb();
    const row = d.prepare('SELECT priority FROM model_priorities WHERE model = ?').get(model) as { priority: string } | undefined;
    return (row?.priority as 'critical' | 'normal' | 'low') ?? 'normal';
}

export function getModelPriorities(): Array<{ model: string; priority: string }> {
    const d = getDb();
    return d.prepare('SELECT model, priority FROM model_priorities ORDER BY model').all() as Array<{ model: string; priority: string }>;
}

export function getIdleModels(minutesIdle: number = 30): Array<{ model: string; node_id: string; last_used: string; idle_minutes: number }> {
    const d = getDb();
    const nodes = getAllNodes();
    const results: Array<{ model: string; node_id: string; last_used: string; idle_minutes: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;

        for (const model of node.latest_stats.inference.loaded_models) {
            const usage = d.prepare(`
                SELECT MAX(created_at) as last_used
                FROM inference_log
                WHERE node_id = ? AND model = ?
            `).get(node.id, model) as { last_used: string | null };

            const lastUsedStr = usage.last_used || '1970-01-01 00:00:00';
            const lastUsedTime = new Date(lastUsedStr + 'Z').getTime();
            const idleMs = Date.now() - lastUsedTime;
            const idleMins = Math.floor(idleMs / 60000);

            if (idleMins >= minutesIdle) {
                results.push({
                    model,
                    node_id: node.id,
                    last_used: lastUsedStr,
                    idle_minutes: idleMins,
                });
            }
        }
    }

    results.sort((a, b) => b.idle_minutes - a.idle_minutes);
    return results;
}

export function getClusterCapacity(): { total_vram_mb: number; used_vram_mb: number; free_vram_mb: number; models_loaded: number; max_additional_models: number } {
    const nodes = getAllNodes();
    let totalVram = 0;
    let usedVram = 0;
    const loadedModels = new Set<string>();

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;

        totalVram += node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        usedVram += node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);

        for (const model of node.latest_stats.inference.loaded_models) {
            loadedModels.add(model);
        }
    }

    const freeVram = totalVram - usedVram;
    const medianModelSizeMb = 4096;
    const maxAdditional = freeVram > 0 ? Math.floor(freeVram / medianModelSizeMb) : 0;

    return {
        total_vram_mb: totalVram,
        used_vram_mb: usedVram,
        free_vram_mb: freeVram,
        models_loaded: loadedModels.size,
        max_additional_models: maxAdditional,
    };
}

// =============================================================================
// Auto Mode -- System decides everything
// =============================================================================

export interface AutoModeDecision {
    action: string;
    reason: string;
    target?: string;
    model?: string;
    executed: boolean;
}

export function runAutoMode(): AutoModeDecision[] {
    const decisions: AutoModeDecision[] = [];
    const nodes = getAllNodes().filter(n => n.status === 'online' && n.latest_stats);
    const models = getClusterModels();

    if (nodes.length === 0) return decisions;

    // Decision 1: Empty nodes should get the most popular model
    for (const node of nodes) {
        if (!node.latest_stats) continue;
        const loadedCount = node.latest_stats.inference.loaded_models.length;
        if (loadedCount === 0) {
            const popular = models.sort((a, b) => b.node_count - a.node_count)[0];
            const fallbackModel = popular?.model || 'llama3.2:3b';

            const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
            const recommended = getAutoModelForVram(totalVram);

            const model = recommended || fallbackModel;
            const fit = checkModelFits(model, node.id);
            if (fit.fits) {
                queueCommand(node.id, 'install_model', { model });
                decisions.push({
                    action: 'deploy_model',
                    reason: `Node ${node.hostname} has no models -- deploying ${model} (${fit.required_mb}MB, ${fit.available_mb}MB free)`,
                    target: node.id,
                    model,
                    executed: true,
                });
            }
        }
    }

    // Decision 2: High-demand models should have redundancy
    const d = getDb();
    const recentRequests = d.prepare(`
        SELECT model, COUNT(*) as cnt FROM inference_log
        WHERE created_at >= datetime('now', '-1 hour')
        GROUP BY model ORDER BY cnt DESC LIMIT 5
    `).all() as Array<{ model: string; cnt: number }>;

    for (const req of recentRequests) {
        const modelInfo = models.find(m => m.model === req.model);
        if (modelInfo && modelInfo.node_count < 2 && req.cnt >= 10) {
            const best = findBestNodeForModel(req.model);
            if (best) {
                queueCommand(best.node_id, 'install_model', { model: req.model });
                decisions.push({
                    action: 'add_redundancy',
                    reason: `${req.model} got ${req.cnt} requests/hr but only on 1 node -- deploying to ${best.hostname}`,
                    target: best.node_id,
                    model: req.model,
                    executed: true,
                });
            }
        }
    }

    // Decision 3: Remove models unused for 7+ days
    for (const model of models) {
        const lastUsed = d.prepare(`
            SELECT MAX(created_at) as last_used FROM inference_log WHERE model = ?
        `).get(model.model) as { last_used: string | null } | undefined;

        if (lastUsed?.last_used) {
            const daysSinceUse = (Date.now() - new Date(lastUsed.last_used + 'Z').getTime()) / 86400000;
            if (daysSinceUse > 7 && model.node_count > 0) {
                decisions.push({
                    action: 'suggest_remove',
                    reason: `${model.model} hasn't been used in ${Math.round(daysSinceUse)} days`,
                    model: model.model,
                    executed: false,
                });
            }
        }
    }

    return decisions;
}

function getAutoModelForVram(totalVramMb: number): string | null {
    if (totalVramMb >= 40000) return 'llama3.1:70b';
    if (totalVramMb >= 16000) return 'llama3.1:8b';
    if (totalVramMb >= 8000) return 'llama3.2:3b';
    if (totalVramMb >= 4000) return 'llama3.2:1b';
    if (totalVramMb >= 2000) return 'phi3:3.8b';
    return null;
}
