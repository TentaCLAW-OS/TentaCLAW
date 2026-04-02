// F:\tentaclaw-os\gateway\src\finetune.ts
// Fine-Tuning Orchestration Engine
// TentaCLAW says: "Train on your data. On your hardware. No cloud fees. Ever."

import { getDb } from './db';
import { getAllNodes } from './db';
import { estimateVramDetailed } from './models';

// =============================================================================
// Types
// =============================================================================

export interface FineTuneJob {
    id: string;
    name: string;
    namespace: string;
    status: 'pending' | 'preparing' | 'training' | 'evaluating' | 'completed' | 'failed' | 'cancelled';
    config: {
        baseModel: string;            // "meta-llama/Llama-3.1-8B-Instruct"
        method: 'lora' | 'qlora' | 'full';
        dataset: string;              // path or HuggingFace dataset ID
        datasetFormat: 'sharegpt' | 'alpaca' | 'chatml' | 'completion' | 'auto';
        outputModel: string;          // name for the fine-tuned model/adapter
        hyperparameters: {
            learningRate: number;          // default 2e-4
            epochs: number;                // default 3
            batchSize: number;             // default 4
            gradientAccumulation: number;  // default 4
            loraRank?: number;             // default 16
            loraAlpha?: number;            // default 32
            loraTargetModules?: string[];  // default ["q_proj", "v_proj"]
            warmupSteps?: number;
            maxSteps?: number;
            weightDecay?: number;
        };
        gpuAllocation: number;         // number of GPUs to use
        preemptible: boolean;          // can be paused for inference (default true)
    };
    progress: {
        currentStep: number;
        totalSteps: number;
        currentEpoch: number;
        totalEpochs: number;
        loss: number;
        learningRate: number;
        gpuMemoryUsedMb: number;
        tokensProcessed: number;
        estimatedTimeRemainingS: number;
    };
    nodeId?: string;                   // which node is running this
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
    error?: string;
    checkpoints: Array<{
        step: number;
        loss: number;
        path: string;
        timestamp: string;
    }>;
}

export type FineTuneStatus = FineTuneJob['status'];

export interface FineTuneJobConfig {
    name: string;
    namespace?: string;
    baseModel: string;
    method?: 'lora' | 'qlora' | 'full';
    dataset: string;
    datasetFormat?: 'sharegpt' | 'alpaca' | 'chatml' | 'completion' | 'auto';
    outputModel?: string;
    hyperparameters?: Partial<FineTuneJob['config']['hyperparameters']>;
    gpuAllocation?: number;
    preemptible?: boolean;
}

export interface DatasetValidationResult {
    valid: boolean;
    format: string;
    rowCount: number;
    errors: string[];
    warnings: string[];
    estimatedTrainingTimeMinutes: number;
    estimatedTokenCount: number;
    avgRowLength: number;
}

export interface DatasetPreviewRow {
    index: number;
    data: Record<string, unknown>;
}

export interface DatasetStats {
    rowCount: number;
    avgLength: number;
    minLength: number;
    maxLength: number;
    estimatedTokenCount: number;
    formatDetected: string;
    sizeBytes: number;
}

export interface Adapter {
    id: string;
    name: string;
    namespace: string;
    baseModel: string;
    method: 'lora' | 'qlora' | 'full';
    loraRank?: number;
    loraAlpha?: number;
    loraTargetModules?: string[];
    path: string;
    sizeMb: number;
    jobId: string;
    benchmarks?: Record<string, number>;
    createdAt: string;
}

export interface TrainingCommand {
    command: string;
    args: string[];
    env: Record<string, string>;
    framework: 'unsloth' | 'axolotl' | 'peft' | 'deepspeed';
    description: string;
}

// =============================================================================
// Database Schema Initialization
// =============================================================================

/**
 * Ensure fine-tuning tables exist in the database.
 * Called on first access, idempotent via CREATE TABLE IF NOT EXISTS.
 */
let schemaInitialized = false;

function ensureSchema(): void {
    if (schemaInitialized) return;
    const d = getDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS finetune_jobs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            status TEXT NOT NULL DEFAULT 'pending',
            config TEXT NOT NULL,
            progress TEXT NOT NULL DEFAULT '{}',
            node_id TEXT,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            error TEXT,
            checkpoints TEXT NOT NULL DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_finetune_jobs_namespace ON finetune_jobs(namespace);
        CREATE INDEX IF NOT EXISTS idx_finetune_jobs_status ON finetune_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_finetune_jobs_created ON finetune_jobs(created_at DESC);

        CREATE TABLE IF NOT EXISTS adapters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            namespace TEXT NOT NULL DEFAULT 'default',
            base_model TEXT NOT NULL,
            method TEXT NOT NULL,
            lora_rank INTEGER,
            lora_alpha INTEGER,
            lora_target_modules TEXT,
            path TEXT NOT NULL,
            size_mb REAL NOT NULL DEFAULT 0,
            job_id TEXT,
            benchmarks TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_adapters_namespace ON adapters(namespace);
        CREATE INDEX IF NOT EXISTS idx_adapters_base_model ON adapters(base_model);
    `);

    schemaInitialized = true;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return 'ft_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateAdapterId(): string {
    return 'adp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_HYPERPARAMETERS: FineTuneJob['config']['hyperparameters'] = {
    learningRate: 2e-4,
    epochs: 3,
    batchSize: 4,
    gradientAccumulation: 4,
    loraRank: 16,
    loraAlpha: 32,
    loraTargetModules: ['q_proj', 'v_proj'],
    warmupSteps: 10,
    weightDecay: 0.01,
};

/** Serialize a FineTuneJob from a DB row. */
function rowToJob(row: Record<string, unknown>): FineTuneJob {
    return {
        id: row.id as string,
        name: row.name as string,
        namespace: row.namespace as string,
        status: row.status as FineTuneStatus,
        config: JSON.parse(row.config as string),
        progress: JSON.parse(row.progress as string),
        nodeId: (row.node_id as string) || undefined,
        startedAt: (row.started_at as string) || undefined,
        completedAt: (row.completed_at as string) || undefined,
        createdAt: row.created_at as string,
        error: (row.error as string) || undefined,
        checkpoints: JSON.parse(row.checkpoints as string),
    };
}

/** Serialize an Adapter from a DB row. */
function rowToAdapter(row: Record<string, unknown>): Adapter {
    return {
        id: row.id as string,
        name: row.name as string,
        namespace: row.namespace as string,
        baseModel: row.base_model as string,
        method: row.method as Adapter['method'],
        loraRank: (row.lora_rank as number) || undefined,
        loraAlpha: (row.lora_alpha as number) || undefined,
        loraTargetModules: row.lora_target_modules
            ? JSON.parse(row.lora_target_modules as string)
            : undefined,
        path: row.path as string,
        sizeMb: row.size_mb as number,
        jobId: row.job_id as string,
        benchmarks: row.benchmarks ? JSON.parse(row.benchmarks as string) : undefined,
        createdAt: row.created_at as string,
    };
}

// =============================================================================
// Job Management
// =============================================================================

/**
 * Create a fine-tune job.
 *
 * Validates config, merges defaults for hyperparameters, queues the job as
 * `pending`, and returns the full FineTuneJob with its generated ID.
 */
export function createFineTuneJob(cfg: FineTuneJobConfig): FineTuneJob {
    ensureSchema();
    const d = getDb();

    // --- Validate ---
    const errors: string[] = [];
    if (!cfg.baseModel) errors.push('baseModel is required');
    if (!cfg.dataset) errors.push('dataset is required');
    if (!cfg.name) errors.push('name is required');
    if (errors.length > 0) {
        throw new Error(`Invalid fine-tune config: ${errors.join('; ')}`);
    }

    const method = cfg.method ?? 'qlora';
    const hp = { ...DEFAULT_HYPERPARAMETERS, ...(cfg.hyperparameters || {}) };

    // Validate hyperparameters ranges
    if (hp.learningRate <= 0 || hp.learningRate > 1) {
        throw new Error('learningRate must be between 0 (exclusive) and 1 (inclusive)');
    }
    if (hp.epochs < 1 || hp.epochs > 100) {
        throw new Error('epochs must be between 1 and 100');
    }
    if (hp.batchSize < 1 || hp.batchSize > 256) {
        throw new Error('batchSize must be between 1 and 256');
    }

    const id = generateId();
    const namespace = cfg.namespace ?? 'default';
    const outputModel = cfg.outputModel ?? `${cfg.name}-${method}`;

    const config: FineTuneJob['config'] = {
        baseModel: cfg.baseModel,
        method,
        dataset: cfg.dataset,
        datasetFormat: cfg.datasetFormat ?? 'auto',
        outputModel,
        hyperparameters: hp,
        gpuAllocation: cfg.gpuAllocation ?? 1,
        preemptible: cfg.preemptible ?? true,
    };

    const progress: FineTuneJob['progress'] = {
        currentStep: 0,
        totalSteps: 0,
        currentEpoch: 0,
        totalEpochs: hp.epochs,
        loss: 0,
        learningRate: hp.learningRate,
        gpuMemoryUsedMb: 0,
        tokensProcessed: 0,
        estimatedTimeRemainingS: 0,
    };

    d.prepare(`
        INSERT INTO finetune_jobs (id, name, namespace, status, config, progress, checkpoints)
        VALUES (?, ?, ?, 'pending', ?, ?, '[]')
    `).run(id, cfg.name, namespace, JSON.stringify(config), JSON.stringify(progress));

    console.log(`[finetune] Created job ${id}: ${cfg.name} (${method} on ${cfg.baseModel})`);

    return {
        id,
        name: cfg.name,
        namespace,
        status: 'pending',
        config,
        progress,
        createdAt: new Date().toISOString(),
        checkpoints: [],
    };
}

/**
 * Retrieve a fine-tune job by ID, with full progress and checkpoints.
 */
export function getFineTuneJob(id: string): FineTuneJob | null {
    ensureSchema();
    const d = getDb();
    const row = d.prepare('SELECT * FROM finetune_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToJob(row);
}

/**
 * List all fine-tune jobs, optionally filtered by namespace.
 */
export function listFineTuneJobs(namespace?: string): FineTuneJob[] {
    ensureSchema();
    const d = getDb();
    const rows = namespace
        ? d.prepare('SELECT * FROM finetune_jobs WHERE namespace = ? ORDER BY created_at DESC').all(namespace)
        : d.prepare('SELECT * FROM finetune_jobs ORDER BY created_at DESC').all();
    return (rows as Record<string, unknown>[]).map(rowToJob);
}

/**
 * Cancel a running or pending job. If the job is currently training,
 * its last checkpoint is preserved for later resumption.
 */
export function cancelFineTuneJob(id: string): FineTuneJob {
    ensureSchema();
    const d = getDb();
    const job = getFineTuneJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    if (job.status === 'completed' || job.status === 'cancelled') {
        throw new Error(`Job ${id} is already ${job.status}`);
    }

    d.prepare(`
        UPDATE finetune_jobs SET status = 'cancelled', completed_at = datetime('now')
        WHERE id = ?
    `).run(id);

    console.log(`[finetune] Cancelled job ${id} (was ${job.status})`);

    return { ...job, status: 'cancelled', completedAt: new Date().toISOString() };
}

/**
 * Resume a cancelled or failed job from its last checkpoint.
 * Resets status to 'pending' so the scheduler can re-assign it.
 */
export function resumeFineTuneJob(id: string): FineTuneJob {
    ensureSchema();
    const d = getDb();
    const job = getFineTuneJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    if (job.status !== 'cancelled' && job.status !== 'failed') {
        throw new Error(`Job ${id} cannot be resumed (status: ${job.status})`);
    }

    if (job.checkpoints.length === 0) {
        // No checkpoint — restart from scratch
        const progress: FineTuneJob['progress'] = {
            currentStep: 0,
            totalSteps: job.progress.totalSteps,
            currentEpoch: 0,
            totalEpochs: job.config.hyperparameters.epochs,
            loss: 0,
            learningRate: job.config.hyperparameters.learningRate,
            gpuMemoryUsedMb: 0,
            tokensProcessed: 0,
            estimatedTimeRemainingS: 0,
        };
        d.prepare(`
            UPDATE finetune_jobs
            SET status = 'pending', error = NULL, completed_at = NULL, progress = ?
            WHERE id = ?
        `).run(JSON.stringify(progress), id);
    } else {
        // Resume from last checkpoint
        const lastCp = job.checkpoints[job.checkpoints.length - 1];
        const progress: FineTuneJob['progress'] = {
            ...job.progress,
            currentStep: lastCp.step,
            loss: lastCp.loss,
        };
        d.prepare(`
            UPDATE finetune_jobs
            SET status = 'pending', error = NULL, completed_at = NULL, progress = ?
            WHERE id = ?
        `).run(JSON.stringify(progress), id);
    }

    console.log(`[finetune] Resumed job ${id} from ${job.checkpoints.length > 0 ? `checkpoint step ${job.checkpoints[job.checkpoints.length - 1].step}` : 'scratch'}`);

    return { ...job, status: 'pending', error: undefined, completedAt: undefined };
}

/**
 * Update a job's progress. Called by the training worker as it reports metrics.
 */
export function updateJobProgress(id: string, progress: Partial<FineTuneJob['progress']>): void {
    ensureSchema();
    const d = getDb();
    const job = getFineTuneJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    const merged = { ...job.progress, ...progress };
    d.prepare('UPDATE finetune_jobs SET progress = ? WHERE id = ?')
        .run(JSON.stringify(merged), id);
}

/**
 * Transition a job to a new status. Enforces valid transitions.
 */
export function updateJobStatus(id: string, status: FineTuneStatus, error?: string): void {
    ensureSchema();
    const d = getDb();

    const VALID_TRANSITIONS: Record<FineTuneStatus, FineTuneStatus[]> = {
        pending: ['preparing', 'cancelled', 'failed'],
        preparing: ['training', 'cancelled', 'failed'],
        training: ['evaluating', 'cancelled', 'failed'],
        evaluating: ['completed', 'failed'],
        completed: [],
        failed: ['pending'],   // resume
        cancelled: ['pending'], // resume
    };

    const job = getFineTuneJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    if (!VALID_TRANSITIONS[job.status].includes(status)) {
        throw new Error(`Invalid transition: ${job.status} -> ${status}`);
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    updates.push('status = ?');
    params.push(status);

    if (status === 'training' && !job.startedAt) {
        updates.push(`started_at = datetime('now')`);
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        updates.push(`completed_at = datetime('now')`);
    }
    if (error) {
        updates.push('error = ?');
        params.push(error);
    }

    params.push(id);
    d.prepare(`UPDATE finetune_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    console.log(`[finetune] Job ${id} status: ${job.status} -> ${status}`);
}

/**
 * Add a checkpoint to a job.
 */
export function addJobCheckpoint(id: string, checkpoint: { step: number; loss: number; path: string }): void {
    ensureSchema();
    const d = getDb();
    const job = getFineTuneJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    const cp = {
        ...checkpoint,
        timestamp: new Date().toISOString(),
    };
    const checkpoints = [...job.checkpoints, cp];

    d.prepare('UPDATE finetune_jobs SET checkpoints = ? WHERE id = ?')
        .run(JSON.stringify(checkpoints), id);

    console.log(`[finetune] Checkpoint saved for job ${id} at step ${checkpoint.step} (loss: ${checkpoint.loss.toFixed(4)})`);
}

// =============================================================================
// Job Scheduler
// =============================================================================

/**
 * Find the best node to run a fine-tune job.
 *
 * Priorities:
 *   1. Nodes that already have the base model cached (skip download)
 *   2. Nodes with enough free GPU memory for training
 *   3. Namespace quota compliance
 *   4. Fewest running fine-tune jobs (spread load)
 */
export function scheduleJob(job: FineTuneJob): {
    nodeId: string;
    hostname: string;
    gpuIndices: number[];
    reason: string;
} | null {
    ensureSchema();
    const nodes = getAllNodes();
    if (nodes.length === 0) return null;

    // Estimate VRAM needed for training (roughly 2-4x inference for backprop + optimizer states)
    const inferenceVram = estimateVramDetailed(job.config.baseModel, 'FP16');
    const trainingMultiplier = job.config.method === 'full' ? 4.0
        : job.config.method === 'qlora' ? 1.5
        : 2.0; // lora
    const requiredVramMb = Math.ceil(inferenceVram.total_mb * trainingMultiplier);

    // Count running jobs per node
    const d = getDb();
    const runningJobs = d.prepare(
        `SELECT node_id, COUNT(*) as cnt FROM finetune_jobs
         WHERE status IN ('preparing', 'training', 'evaluating') AND node_id IS NOT NULL
         GROUP BY node_id`
    ).all() as Array<{ node_id: string; cnt: number }>;
    const jobCountByNode = new Map(runningJobs.map(r => [r.node_id, r.cnt]));

    // Score each node
    const candidates: Array<{
        nodeId: string;
        hostname: string;
        score: number;
        gpuIndices: number[];
        reason: string;
    }> = [];

    for (const node of nodes) {
        if (node.status !== 'online') continue;
        if (!node.latest_stats?.gpus || node.latest_stats.gpus.length === 0) continue;

        // Calculate available VRAM across GPUs
        const gpus = node.latest_stats.gpus;
        const availableGpus: Array<{ index: number; freeMb: number }> = [];
        for (let i = 0; i < gpus.length; i++) {
            const free = gpus[i].vramTotalMb - gpus[i].vramUsedMb;
            availableGpus.push({ index: i, freeMb: free });
        }

        // Sort by free VRAM descending, pick the top N GPUs needed
        availableGpus.sort((a, b) => b.freeMb - a.freeMb);
        const allocated = availableGpus.slice(0, job.config.gpuAllocation);
        const totalFreeMb = allocated.reduce((sum, g) => sum + g.freeMb, 0);

        if (totalFreeMb < requiredVramMb) continue;
        if (allocated.length < job.config.gpuAllocation) continue;

        let score = 100;

        // Prefer nodes with base model cached (check if any loaded model matches)
        const loadedModels: string[] = (node.latest_stats as unknown as { models?: string[] }).models ?? [];
        const hasBaseModel = loadedModels.some(m =>
            m.toLowerCase().includes(job.config.baseModel.toLowerCase().split('/').pop() ?? '')
        );
        if (hasBaseModel) score += 50;

        // Prefer nodes with fewer running jobs
        const runningCount = jobCountByNode.get(node.id) ?? 0;
        score -= runningCount * 20;

        // Prefer nodes with more headroom
        score += Math.floor(totalFreeMb / 1024);

        candidates.push({
            nodeId: node.id,
            hostname: node.hostname,
            score,
            gpuIndices: allocated.map(g => g.index),
            reason: hasBaseModel
                ? `Base model cached; ${totalFreeMb}MB free across ${allocated.length} GPU(s)`
                : `${totalFreeMb}MB free across ${allocated.length} GPU(s)`,
        });
    }

    if (candidates.length === 0) return null;

    // Pick highest score
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Assign the node
    d.prepare('UPDATE finetune_jobs SET node_id = ? WHERE id = ?').run(best.nodeId, job.id);

    console.log(`[finetune] Scheduled job ${job.id} on ${best.hostname} (score: ${best.score})`);

    return {
        nodeId: best.nodeId,
        hostname: best.hostname,
        gpuIndices: best.gpuIndices,
        reason: best.reason,
    };
}

/**
 * Preempt (pause) a running fine-tune job to free GPUs for inference demand.
 * Saves a checkpoint and transitions to 'cancelled' so it can resume later.
 */
export function preemptJob(jobId: string): { checkpointStep: number; freedGpus: number } {
    ensureSchema();
    const job = getFineTuneJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    if (job.status !== 'training' && job.status !== 'preparing') {
        throw new Error(`Job ${jobId} is not running (status: ${job.status})`);
    }

    if (!job.config.preemptible) {
        throw new Error(`Job ${jobId} is not preemptible`);
    }

    // Save a preemption checkpoint
    const checkpointPath = `checkpoints/${job.id}/preempt-step-${job.progress.currentStep}`;
    addJobCheckpoint(jobId, {
        step: job.progress.currentStep,
        loss: job.progress.loss,
        path: checkpointPath,
    });

    // Cancel the job (will be resumed later)
    const d = getDb();
    d.prepare(`
        UPDATE finetune_jobs SET status = 'cancelled', error = 'Preempted for inference demand'
        WHERE id = ?
    `).run(jobId);

    console.log(`[finetune] Preempted job ${jobId} at step ${job.progress.currentStep}`);

    return {
        checkpointStep: job.progress.currentStep,
        freedGpus: job.config.gpuAllocation,
    };
}

/**
 * Get the job queue: all pending jobs in priority order.
 * Priority: non-preemptible first, then by creation time.
 */
export function getJobQueue(): FineTuneJob[] {
    ensureSchema();
    const d = getDb();
    const rows = d.prepare(`
        SELECT * FROM finetune_jobs
        WHERE status = 'pending'
        ORDER BY
            json_extract(config, '$.preemptible') ASC,
            created_at ASC
    `).all() as Record<string, unknown>[];
    return rows.map(rowToJob);
}

/**
 * Get all currently running jobs (preparing, training, or evaluating).
 */
export function getRunningJobs(): FineTuneJob[] {
    ensureSchema();
    const d = getDb();
    const rows = d.prepare(`
        SELECT * FROM finetune_jobs
        WHERE status IN ('preparing', 'training', 'evaluating')
        ORDER BY started_at ASC
    `).all() as Record<string, unknown>[];
    return rows.map(rowToJob);
}

/**
 * Get preemptible running jobs, sorted by lowest priority (best candidates for preemption).
 */
export function getPreemptibleJobs(): FineTuneJob[] {
    ensureSchema();
    const d = getDb();
    const rows = d.prepare(`
        SELECT * FROM finetune_jobs
        WHERE status IN ('preparing', 'training')
          AND json_extract(config, '$.preemptible') = 1
        ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(rowToJob);
}

// =============================================================================
// Dataset Validation
// =============================================================================

/** Known dataset format signatures. */
const FORMAT_SIGNATURES: Record<string, (sample: Record<string, unknown>) => boolean> = {
    sharegpt: (s) => Array.isArray(s.conversations),
    alpaca: (s) => typeof s.instruction === 'string' && typeof s.output === 'string',
    chatml: (s) => Array.isArray(s.messages),
    completion: (s) => typeof s.text === 'string' || typeof s.prompt === 'string',
};

/**
 * Detect the format of a dataset sample row.
 */
function detectFormat(sample: Record<string, unknown>): string {
    for (const [fmt, check] of Object.entries(FORMAT_SIGNATURES)) {
        if (check(sample)) return fmt;
    }
    return 'unknown';
}

/**
 * Estimate token count from text length (rough: ~4 chars per token for English).
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Extract the text content from a dataset row for length/token estimation.
 */
function extractRowText(row: Record<string, unknown>, format: string): string {
    switch (format) {
        case 'sharegpt': {
            const convos = row.conversations as Array<{ value?: string; content?: string }> | undefined;
            return (convos ?? []).map(c => c.value ?? c.content ?? '').join(' ');
        }
        case 'alpaca': {
            return [row.instruction, row.input, row.output].filter(Boolean).join(' ');
        }
        case 'chatml': {
            const msgs = row.messages as Array<{ content?: string }> | undefined;
            return (msgs ?? []).map(m => m.content ?? '').join(' ');
        }
        case 'completion': {
            return (row.text as string) ?? (row.prompt as string) ?? '';
        }
        default:
            return JSON.stringify(row);
    }
}

/**
 * Validate a dataset.
 *
 * Checks format, counts rows, estimates training time. Accepts a parsed
 * array of rows (the caller reads the file and parses JSON/JSONL).
 */
export function validateDataset(
    rows: Record<string, unknown>[],
    expectedFormat: string = 'auto',
): DatasetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rows || rows.length === 0) {
        return {
            valid: false,
            format: 'unknown',
            rowCount: 0,
            errors: ['Dataset is empty'],
            warnings: [],
            estimatedTrainingTimeMinutes: 0,
            estimatedTokenCount: 0,
            avgRowLength: 0,
        };
    }

    // Detect format from first row
    const detected = detectFormat(rows[0]);
    const format = expectedFormat === 'auto' ? detected : expectedFormat;

    if (expectedFormat !== 'auto' && detected !== expectedFormat) {
        warnings.push(`Expected format '${expectedFormat}' but detected '${detected}'`);
    }
    if (detected === 'unknown') {
        errors.push('Could not detect dataset format. Supported: sharegpt, alpaca, chatml, completion');
    }

    // Validate all rows match the format
    let mismatchCount = 0;
    let totalLength = 0;
    let totalTokens = 0;

    for (let i = 0; i < rows.length; i++) {
        const rowFormat = detectFormat(rows[i]);
        if (rowFormat !== format && format !== 'unknown') {
            mismatchCount++;
        }
        const text = extractRowText(rows[i], format);
        totalLength += text.length;
        totalTokens += estimateTokens(text);
    }

    if (mismatchCount > 0) {
        warnings.push(`${mismatchCount} of ${rows.length} rows do not match '${format}' format`);
    }

    if (rows.length < 10) {
        warnings.push('Dataset has fewer than 10 rows — results may be poor');
    }

    const avgLength = totalLength / rows.length;

    // Estimate training time: ~1000 tokens/sec on a single GPU with LoRA
    // 3 epochs over totalTokens at 1000 tok/s
    const estimatedTrainingTimeMinutes = Math.ceil((totalTokens * 3) / (1000 * 60));

    return {
        valid: errors.length === 0,
        format,
        rowCount: rows.length,
        errors,
        warnings,
        estimatedTrainingTimeMinutes,
        estimatedTokenCount: totalTokens,
        avgRowLength: Math.round(avgLength),
    };
}

/**
 * Preview the first N rows of a dataset.
 */
export function previewDataset(
    rows: Record<string, unknown>[],
    count: number = 5,
): DatasetPreviewRow[] {
    return rows.slice(0, count).map((data, index) => ({ index, data }));
}

/**
 * Get statistics about a dataset.
 */
export function getDatasetStats(rows: Record<string, unknown>[]): DatasetStats {
    if (!rows || rows.length === 0) {
        return {
            rowCount: 0,
            avgLength: 0,
            minLength: 0,
            maxLength: 0,
            estimatedTokenCount: 0,
            formatDetected: 'unknown',
            sizeBytes: 0,
        };
    }

    const format = detectFormat(rows[0]);
    let minLen = Infinity;
    let maxLen = 0;
    let totalLen = 0;
    let totalTokens = 0;

    for (const row of rows) {
        const text = extractRowText(row, format);
        const len = text.length;
        totalLen += len;
        totalTokens += estimateTokens(text);
        if (len < minLen) minLen = len;
        if (len > maxLen) maxLen = len;
    }

    const serialized = JSON.stringify(rows);

    return {
        rowCount: rows.length,
        avgLength: Math.round(totalLen / rows.length),
        minLength: minLen === Infinity ? 0 : minLen,
        maxLength: maxLen,
        estimatedTokenCount: totalTokens,
        formatDetected: format,
        sizeBytes: Buffer.byteLength(serialized, 'utf8'),
    };
}

// =============================================================================
// Training Command Generation
// =============================================================================

/**
 * Generate the CLI training command for a fine-tune job.
 *
 * Supports:
 *   - Single-GPU LoRA via Unsloth
 *   - Multi-GPU QLoRA via PEFT + accelerate
 *   - Full fine-tune with DeepSpeed ZeRO-3
 *   - Axolotl for complex multi-format training
 */
export function generateTrainingCommand(job: FineTuneJob): TrainingCommand {
    const cfg = job.config;

    // Single-GPU LoRA or QLoRA with Unsloth (fastest path)
    if (cfg.gpuAllocation === 1 && (cfg.method === 'lora' || cfg.method === 'qlora')) {
        return generateUnslothCommand(job);
    }

    // Multi-GPU QLoRA with PEFT + accelerate
    if (cfg.gpuAllocation > 1 && cfg.method === 'qlora') {
        return generatePeftAccelerateCommand(job);
    }

    // Full fine-tune with DeepSpeed ZeRO-3
    if (cfg.method === 'full') {
        return generateDeepSpeedCommand(job);
    }

    // Multi-GPU LoRA with Axolotl
    return generateAxolotlCommand(job);
}

function generateUnslothCommand(job: FineTuneJob): TrainingCommand {
    const cfg = job.config;
    const hp = cfg.hyperparameters;

    const args = [
        '-m', 'unsloth_train',
        '--model', cfg.baseModel,
        '--dataset', cfg.dataset,
        '--dataset-format', cfg.datasetFormat,
        '--output', cfg.outputModel,
        '--method', cfg.method,
        '--lr', hp.learningRate.toString(),
        '--epochs', hp.epochs.toString(),
        '--batch-size', hp.batchSize.toString(),
        '--gradient-accumulation', hp.gradientAccumulation.toString(),
    ];

    if (cfg.method === 'lora' || cfg.method === 'qlora') {
        args.push('--lora-rank', (hp.loraRank ?? 16).toString());
        args.push('--lora-alpha', (hp.loraAlpha ?? 32).toString());
        if (hp.loraTargetModules && hp.loraTargetModules.length > 0) {
            args.push('--lora-target-modules', hp.loraTargetModules.join(','));
        }
    }

    if (cfg.method === 'qlora') {
        args.push('--load-in-4bit');
    }

    if (hp.warmupSteps !== undefined) args.push('--warmup-steps', hp.warmupSteps.toString());
    if (hp.maxSteps !== undefined) args.push('--max-steps', hp.maxSteps.toString());
    if (hp.weightDecay !== undefined) args.push('--weight-decay', hp.weightDecay.toString());

    // Resume from checkpoint if available
    if (job.checkpoints.length > 0) {
        const lastCp = job.checkpoints[job.checkpoints.length - 1];
        args.push('--resume-from', lastCp.path);
    }

    return {
        command: 'python',
        args,
        env: {
            CUDA_VISIBLE_DEVICES: '0',
            WANDB_DISABLED: 'true',
            HF_HOME: '/data/huggingface',
        },
        framework: 'unsloth',
        description: `Single-GPU ${cfg.method.toUpperCase()} training with Unsloth (4x faster than vanilla PEFT)`,
    };
}

function generatePeftAccelerateCommand(job: FineTuneJob): TrainingCommand {
    const cfg = job.config;
    const hp = cfg.hyperparameters;

    const gpuList = Array.from({ length: cfg.gpuAllocation }, (_, i) => i).join(',');

    const args = [
        '-m', 'accelerate.commands.launch',
        '--num_processes', cfg.gpuAllocation.toString(),
        '--mixed_precision', 'bf16',
        '-m', 'peft_train',
        '--model', cfg.baseModel,
        '--dataset', cfg.dataset,
        '--dataset-format', cfg.datasetFormat,
        '--output', cfg.outputModel,
        '--method', 'qlora',
        '--lr', hp.learningRate.toString(),
        '--epochs', hp.epochs.toString(),
        '--per-device-batch-size', hp.batchSize.toString(),
        '--gradient-accumulation', hp.gradientAccumulation.toString(),
        '--lora-rank', (hp.loraRank ?? 16).toString(),
        '--lora-alpha', (hp.loraAlpha ?? 32).toString(),
        '--load-in-4bit',
    ];

    if (hp.loraTargetModules && hp.loraTargetModules.length > 0) {
        args.push('--lora-target-modules', hp.loraTargetModules.join(','));
    }
    if (hp.warmupSteps !== undefined) args.push('--warmup-steps', hp.warmupSteps.toString());
    if (hp.maxSteps !== undefined) args.push('--max-steps', hp.maxSteps.toString());
    if (hp.weightDecay !== undefined) args.push('--weight-decay', hp.weightDecay.toString());

    if (job.checkpoints.length > 0) {
        const lastCp = job.checkpoints[job.checkpoints.length - 1];
        args.push('--resume-from', lastCp.path);
    }

    return {
        command: 'python',
        args,
        env: {
            CUDA_VISIBLE_DEVICES: gpuList,
            WANDB_DISABLED: 'true',
            HF_HOME: '/data/huggingface',
        },
        framework: 'peft',
        description: `Multi-GPU QLoRA training with PEFT + Accelerate across ${cfg.gpuAllocation} GPUs`,
    };
}

function generateDeepSpeedCommand(job: FineTuneJob): TrainingCommand {
    const cfg = job.config;
    const hp = cfg.hyperparameters;

    const gpuList = Array.from({ length: cfg.gpuAllocation }, (_, i) => i).join(',');

    const args = [
        '-m', 'deepspeed',
        '--num_gpus', cfg.gpuAllocation.toString(),
        'train.py',
        '--model', cfg.baseModel,
        '--dataset', cfg.dataset,
        '--dataset-format', cfg.datasetFormat,
        '--output', cfg.outputModel,
        '--method', 'full',
        '--lr', hp.learningRate.toString(),
        '--epochs', hp.epochs.toString(),
        '--per-device-batch-size', hp.batchSize.toString(),
        '--gradient-accumulation', hp.gradientAccumulation.toString(),
        '--deepspeed-config', 'ds_config_zero3.json',
        '--bf16',
    ];

    if (hp.warmupSteps !== undefined) args.push('--warmup-steps', hp.warmupSteps.toString());
    if (hp.maxSteps !== undefined) args.push('--max-steps', hp.maxSteps.toString());
    if (hp.weightDecay !== undefined) args.push('--weight-decay', hp.weightDecay.toString());

    if (job.checkpoints.length > 0) {
        const lastCp = job.checkpoints[job.checkpoints.length - 1];
        args.push('--resume-from', lastCp.path);
    }

    return {
        command: 'python',
        args,
        env: {
            CUDA_VISIBLE_DEVICES: gpuList,
            WANDB_DISABLED: 'true',
            HF_HOME: '/data/huggingface',
            NCCL_P2P_DISABLE: '0',
            NCCL_IB_DISABLE: '0',
        },
        framework: 'deepspeed',
        description: `Full fine-tune with DeepSpeed ZeRO-3 across ${cfg.gpuAllocation} GPUs`,
    };
}

function generateAxolotlCommand(job: FineTuneJob): TrainingCommand {
    const cfg = job.config;
    const hp = cfg.hyperparameters;

    const gpuList = Array.from({ length: cfg.gpuAllocation }, (_, i) => i).join(',');

    const args = [
        '-m', 'axolotl.cli.train',
        '--model', cfg.baseModel,
        '--dataset', cfg.dataset,
        '--dataset-format', cfg.datasetFormat,
        '--output', cfg.outputModel,
        '--method', cfg.method,
        '--lr', hp.learningRate.toString(),
        '--epochs', hp.epochs.toString(),
        '--batch-size', hp.batchSize.toString(),
        '--gradient-accumulation', hp.gradientAccumulation.toString(),
    ];

    if (cfg.method === 'lora' || cfg.method === 'qlora') {
        args.push('--lora-rank', (hp.loraRank ?? 16).toString());
        args.push('--lora-alpha', (hp.loraAlpha ?? 32).toString());
        if (hp.loraTargetModules && hp.loraTargetModules.length > 0) {
            args.push('--lora-target-modules', hp.loraTargetModules.join(','));
        }
    }

    if (hp.warmupSteps !== undefined) args.push('--warmup-steps', hp.warmupSteps.toString());
    if (hp.maxSteps !== undefined) args.push('--max-steps', hp.maxSteps.toString());
    if (hp.weightDecay !== undefined) args.push('--weight-decay', hp.weightDecay.toString());

    if (job.checkpoints.length > 0) {
        const lastCp = job.checkpoints[job.checkpoints.length - 1];
        args.push('--resume-from', lastCp.path);
    }

    return {
        command: 'python',
        args,
        env: {
            CUDA_VISIBLE_DEVICES: gpuList,
            WANDB_DISABLED: 'true',
            HF_HOME: '/data/huggingface',
        },
        framework: 'axolotl',
        description: `Multi-GPU ${cfg.method.toUpperCase()} training with Axolotl across ${cfg.gpuAllocation} GPUs`,
    };
}

// =============================================================================
// Adapter Management
// =============================================================================

/**
 * Register a completed adapter (called when a fine-tune job finishes).
 */
export function registerAdapter(opts: {
    name: string;
    namespace?: string;
    baseModel: string;
    method: Adapter['method'];
    loraRank?: number;
    loraAlpha?: number;
    loraTargetModules?: string[];
    path: string;
    sizeMb: number;
    jobId: string;
    benchmarks?: Record<string, number>;
}): Adapter {
    ensureSchema();
    const d = getDb();
    const id = generateAdapterId();
    const namespace = opts.namespace ?? 'default';

    d.prepare(`
        INSERT INTO adapters (id, name, namespace, base_model, method, lora_rank, lora_alpha, lora_target_modules, path, size_mb, job_id, benchmarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        opts.name,
        namespace,
        opts.baseModel,
        opts.method,
        opts.loraRank ?? null,
        opts.loraAlpha ?? null,
        opts.loraTargetModules ? JSON.stringify(opts.loraTargetModules) : null,
        opts.path,
        opts.sizeMb,
        opts.jobId,
        opts.benchmarks ? JSON.stringify(opts.benchmarks) : '{}',
    );

    console.log(`[finetune] Registered adapter '${opts.name}' (${opts.method}, base: ${opts.baseModel})`);

    return {
        id,
        name: opts.name,
        namespace,
        baseModel: opts.baseModel,
        method: opts.method,
        loraRank: opts.loraRank,
        loraAlpha: opts.loraAlpha,
        loraTargetModules: opts.loraTargetModules,
        path: opts.path,
        sizeMb: opts.sizeMb,
        jobId: opts.jobId,
        benchmarks: opts.benchmarks,
        createdAt: new Date().toISOString(),
    };
}

/**
 * List all LoRA adapters, optionally filtered by namespace.
 */
export function listAdapters(namespace?: string): Adapter[] {
    ensureSchema();
    const d = getDb();
    const rows = namespace
        ? d.prepare('SELECT * FROM adapters WHERE namespace = ? ORDER BY created_at DESC').all(namespace)
        : d.prepare('SELECT * FROM adapters ORDER BY created_at DESC').all();
    return (rows as Record<string, unknown>[]).map(rowToAdapter);
}

/**
 * Get a single adapter by name.
 */
export function getAdapter(name: string): Adapter | null {
    ensureSchema();
    const d = getDb();
    const row = d.prepare('SELECT * FROM adapters WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToAdapter(row);
}

/**
 * Delete an adapter by name.
 */
export function deleteAdapter(name: string): boolean {
    ensureSchema();
    const d = getDb();
    const result = d.prepare('DELETE FROM adapters WHERE name = ?').run(name);
    if (result.changes > 0) {
        console.log(`[finetune] Deleted adapter '${name}'`);
        return true;
    }
    return false;
}

/**
 * Update adapter benchmarks after evaluation.
 */
export function updateAdapterBenchmarks(name: string, benchmarks: Record<string, number>): void {
    ensureSchema();
    const d = getDb();
    d.prepare('UPDATE adapters SET benchmarks = ? WHERE name = ?')
        .run(JSON.stringify(benchmarks), name);
}

// =============================================================================
// Summary & Analytics
// =============================================================================

/**
 * Get a summary of fine-tuning activity.
 */
export function getFineTuneSummary(): {
    totalJobs: number;
    pendingJobs: number;
    runningJobs: number;
    completedJobs: number;
    failedJobs: number;
    cancelledJobs: number;
    totalAdapters: number;
    activeGpuCount: number;
} {
    ensureSchema();
    const d = getDb();

    const jobCounts = d.prepare(`
        SELECT status, COUNT(*) as cnt FROM finetune_jobs GROUP BY status
    `).all() as Array<{ status: string; cnt: number }>;

    const countMap = new Map(jobCounts.map(r => [r.status, r.cnt]));

    const adapterCount = (d.prepare('SELECT COUNT(*) as cnt FROM adapters').get() as { cnt: number }).cnt;

    const activeGpus = d.prepare(`
        SELECT COALESCE(SUM(json_extract(config, '$.gpuAllocation')), 0) as total
        FROM finetune_jobs
        WHERE status IN ('preparing', 'training', 'evaluating')
    `).get() as { total: number };

    return {
        totalJobs: jobCounts.reduce((sum, r) => sum + r.cnt, 0),
        pendingJobs: countMap.get('pending') ?? 0,
        runningJobs: (countMap.get('preparing') ?? 0) + (countMap.get('training') ?? 0) + (countMap.get('evaluating') ?? 0),
        completedJobs: countMap.get('completed') ?? 0,
        failedJobs: countMap.get('failed') ?? 0,
        cancelledJobs: countMap.get('cancelled') ?? 0,
        totalAdapters: adapterCount,
        activeGpuCount: activeGpus.total,
    };
}
