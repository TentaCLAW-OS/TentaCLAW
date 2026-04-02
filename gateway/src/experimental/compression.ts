// F:\tentaclaw-os\gateway\src\compression.ts
// Model Compression Service — Every Quantization, One Command
// TentaCLAW says: "Why waste VRAM on full precision when Q4 is 95% as good?"

import { getDb } from './db';
import { estimateVramDetailed, parseParamCount } from './models';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface QuantizationResult {
    quantization: string;
    outputPath: string;
    sizeMb: number;
    vramRequiredMb: number;
    qualityScore?: number;       // from auto-benchmark (0-100 relative to FP16)
    tokensPerSecond?: number;
}

export interface QuantizationJob {
    id: string;
    sourceModel: string;          // HuggingFace ID or local path
    targetQuantizations: string[]; // ["Q4_K_M", "Q5_K_M", "Q8_0", "AWQ", "GPTQ"]
    status: 'pending' | 'downloading' | 'quantizing' | 'benchmarking' | 'completed' | 'failed';
    results: QuantizationResult[];
    createdAt: string;
    completedAt?: string;
    error?: string;
}

export type QuantizationJobStatus = QuantizationJob['status'];

export interface QuantizationConstraints {
    maxVramMb: number;
    minQualityPct: number;     // 0-100, relative to FP16 baseline
    preferSpeed: boolean;       // true = optimize for tok/s
}

export interface QuantizationOption {
    quantization: string;
    estimatedSizeMb: number;
    estimatedVramMb: number;
    estimatedQualityPct: number;  // relative to FP16 baseline
    estimatedToksPerSec: number;  // relative multiplier vs FP16
    fitsConstraints: boolean;
    rank: number;
}

export interface QuantizationRecommendation {
    model: string;
    constraints: QuantizationConstraints;
    recommended: string;           // top pick
    options: QuantizationOption[];
}

export interface QuantizationComparison {
    model: string;
    entries: Array<{
        quantization: string;
        sizeMb: number;
        vramMb: number;
        qualityPct: number;
        tokensPerSecond: number;
        recommended: boolean;
    }>;
    bestQuality: string;
    bestSpeed: string;
    bestBalance: string;
}

export interface FP8Assessment {
    nodeId: string;
    gpuName: string;
    supportsFP8: boolean;
    reason: string;
}

export interface CompressionSavings {
    totalJobsCompleted: number;
    totalQuantizationsProduced: number;
    totalOriginalSizeMb: number;
    totalCompressedSizeMb: number;
    savedMb: number;
    savedPct: number;
    totalVramSavedMb: number;
    summary: string;
}

export interface QualityImpactReport {
    totalModelsAnalyzed: number;
    averageQualityLossPct: number;
    byQuantization: Array<{
        quantization: string;
        avgQualityPct: number;
        avgQualityLossPct: number;
        sampleCount: number;
    }>;
    summary: string;
}

export interface GGUFConversionJob {
    id: string;
    sourceModel: string;
    targetQuantization: string;
    status: 'pending' | 'converting' | 'completed' | 'failed';
    outputPath?: string;
    command: string;
    createdAt: string;
    completedAt?: string;
    error?: string;
}

interface QuantizationCommand {
    tool: 'llama-quantize' | 'auto-awq' | 'auto-gptq' | 'llama-convert';
    command: string;
    args: string[];
    env: Record<string, string>;
    description: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default quantizations to produce when none specified.
 * Covers the sweet spot: best balance, high quality, and maximum compression.
 */
const DEFAULT_QUANTIZATIONS = ['Q4_K_M', 'Q5_K_M', 'Q8_0'];

/**
 * All supported quantization targets with metadata.
 * quality_pct is relative to FP16 (100%).
 * speed_multiplier is relative to FP16 (1.0x).
 */
const QUANTIZATION_PROFILES: Record<string, {
    quality_pct: number;
    speed_multiplier: number;
    bits_per_weight: number;
    tool: 'llama-quantize' | 'auto-awq' | 'auto-gptq';
    category: 'gguf' | 'awq' | 'gptq';
}> = {
    'Q2_K':   { quality_pct: 82,  speed_multiplier: 2.4, bits_per_weight: 2.5,  tool: 'llama-quantize', category: 'gguf' },
    'Q3_K_S': { quality_pct: 86,  speed_multiplier: 2.2, bits_per_weight: 3.0,  tool: 'llama-quantize', category: 'gguf' },
    'Q3_K_M': { quality_pct: 88,  speed_multiplier: 2.1, bits_per_weight: 3.25, tool: 'llama-quantize', category: 'gguf' },
    'Q4_0':   { quality_pct: 91,  speed_multiplier: 2.0, bits_per_weight: 4.0,  tool: 'llama-quantize', category: 'gguf' },
    'Q4_K_S': { quality_pct: 93,  speed_multiplier: 1.95, bits_per_weight: 4.0, tool: 'llama-quantize', category: 'gguf' },
    'Q4_K_M': { quality_pct: 95,  speed_multiplier: 1.9, bits_per_weight: 4.5,  tool: 'llama-quantize', category: 'gguf' },
    'Q5_0':   { quality_pct: 96,  speed_multiplier: 1.7, bits_per_weight: 5.0,  tool: 'llama-quantize', category: 'gguf' },
    'Q5_K_S': { quality_pct: 96,  speed_multiplier: 1.65, bits_per_weight: 5.0, tool: 'llama-quantize', category: 'gguf' },
    'Q5_K_M': { quality_pct: 97,  speed_multiplier: 1.6, bits_per_weight: 5.5,  tool: 'llama-quantize', category: 'gguf' },
    'Q6_K':   { quality_pct: 98,  speed_multiplier: 1.4, bits_per_weight: 6.0,  tool: 'llama-quantize', category: 'gguf' },
    'Q8_0':   { quality_pct: 99.5, speed_multiplier: 1.2, bits_per_weight: 8.0, tool: 'llama-quantize', category: 'gguf' },
    'AWQ':    { quality_pct: 95,  speed_multiplier: 2.0, bits_per_weight: 4.0,  tool: 'auto-awq',       category: 'awq' },
    'GPTQ':   { quality_pct: 94,  speed_multiplier: 1.8, bits_per_weight: 4.0,  tool: 'auto-gptq',      category: 'gptq' },
    'FP16':   { quality_pct: 100, speed_multiplier: 1.0, bits_per_weight: 16.0, tool: 'llama-quantize', category: 'gguf' },
    'FP8':    { quality_pct: 99.8, speed_multiplier: 2.0, bits_per_weight: 8.0, tool: 'llama-quantize', category: 'gguf' },
};

/**
 * GPUs with native FP8 support (Hopper, Blackwell, and beyond).
 */
const FP8_NATIVE_GPUS = [
    'H100', 'H200', 'H800',
    'B100', 'B200', 'B300',
    'GH200', 'GB200', 'GB300',
    'L4',  // Ada Lovelace also has FP8 via Transformer Engine
];

// =============================================================================
// Database Schema Initialization
// =============================================================================

/**
 * Ensure compression/quantization tables exist. Called lazily on first use.
 * Follows the same pattern as finetune.ts and benchmark-engine.ts.
 */
let schemaInitialized = false;

function ensureSchema(): void {
    if (schemaInitialized) return;
    const d = getDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS quantization_jobs (
            id TEXT PRIMARY KEY,
            source_model TEXT NOT NULL,
            target_quantizations TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            results TEXT NOT NULL DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_quantization_jobs_status ON quantization_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_quantization_jobs_model ON quantization_jobs(source_model);
        CREATE INDEX IF NOT EXISTS idx_quantization_jobs_created ON quantization_jobs(created_at DESC);

        CREATE TABLE IF NOT EXISTS gguf_conversions (
            id TEXT PRIMARY KEY,
            source_model TEXT NOT NULL,
            target_quantization TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            output_path TEXT,
            command TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_gguf_conversions_status ON gguf_conversions(status);
        CREATE INDEX IF NOT EXISTS idx_gguf_conversions_created ON gguf_conversions(created_at DESC);
    `);

    schemaInitialized = true;
}

// =============================================================================
// Helpers
// =============================================================================

function generateJobId(): string {
    return 'qtz_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateConversionId(): string {
    return 'gguf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Deserialize a QuantizationJob from a raw DB row. */
function rowToJob(row: Record<string, unknown>): QuantizationJob {
    return {
        id: row.id as string,
        sourceModel: row.source_model as string,
        targetQuantizations: JSON.parse(row.target_quantizations as string),
        status: row.status as QuantizationJobStatus,
        results: JSON.parse(row.results as string),
        createdAt: row.created_at as string,
        completedAt: (row.completed_at as string) || undefined,
        error: (row.error as string) || undefined,
    };
}

/** Deserialize a GGUFConversionJob from a raw DB row. */
function rowToConversion(row: Record<string, unknown>): GGUFConversionJob {
    return {
        id: row.id as string,
        sourceModel: row.source_model as string,
        targetQuantization: row.target_quantization as string,
        status: row.status as GGUFConversionJob['status'],
        outputPath: (row.output_path as string) || undefined,
        command: row.command as string,
        createdAt: row.created_at as string,
        completedAt: (row.completed_at as string) || undefined,
        error: (row.error as string) || undefined,
    };
}

/**
 * Estimate file size (MB) for a given model at a specific quantization.
 * Uses parameter count and bits-per-weight.
 */
function estimateFileSizeMb(modelName: string, quantization: string): number {
    const params = parseParamCount(modelName);
    const profile = QUANTIZATION_PROFILES[quantization];
    if (!profile) return 0;
    const bytesPerParam = profile.bits_per_weight / 8;
    return Math.ceil((params * bytesPerParam) / (1024 * 1024));
}

/**
 * Estimate tokens/second for a model at a given quantization.
 * Uses a baseline of ~15 tok/s at FP16 for a 7B model and scales by
 * parameter count ratio and quantization speed multiplier.
 */
function estimateToksPerSec(modelName: string, quantization: string): number {
    const params = parseParamCount(modelName);
    const profile = QUANTIZATION_PROFILES[quantization];
    if (!profile) return 0;
    // Baseline: 7B FP16 ~ 15 tok/s on a single modern GPU
    const paramRatio = 7e9 / params; // smaller model = faster
    const baselineTps = 15 * Math.sqrt(paramRatio); // sqrt for diminishing returns
    return Math.round(baselineTps * profile.speed_multiplier * 10) / 10;
}

// =============================================================================
// 1. Auto-Quantization — Job Management
// =============================================================================

/**
 * Create a new auto-quantization job.
 * Queues the model for quantization at the specified (or default) target levels.
 */
export function createQuantizationJob(
    sourceModel: string,
    targets?: string[],
): QuantizationJob {
    ensureSchema();
    const d = getDb();

    if (!sourceModel) {
        throw new Error('sourceModel is required');
    }

    const targetQuantizations = targets && targets.length > 0
        ? targets.filter(t => t in QUANTIZATION_PROFILES)
        : DEFAULT_QUANTIZATIONS;

    if (targetQuantizations.length === 0) {
        throw new Error(
            `No valid quantization targets. Supported: ${Object.keys(QUANTIZATION_PROFILES).join(', ')}`,
        );
    }

    const id = generateJobId();

    // Pre-compute estimated results for each target
    const results: QuantizationResult[] = targetQuantizations.map(q => {
        const vramEst = estimateVramDetailed(sourceModel, q);
        return {
            quantization: q,
            outputPath: `./models/${sourceModel.replace(/\//g, '--')}/${q}/model.gguf`,
            sizeMb: estimateFileSizeMb(sourceModel, q),
            vramRequiredMb: vramEst.total_mb,
            qualityScore: QUANTIZATION_PROFILES[q]?.quality_pct,
            tokensPerSecond: estimateToksPerSec(sourceModel, q),
        };
    });

    d.prepare(`
        INSERT INTO quantization_jobs (id, source_model, target_quantizations, status, results)
        VALUES (?, ?, ?, 'pending', ?)
    `).run(id, sourceModel, JSON.stringify(targetQuantizations), JSON.stringify(results));

    console.log(
        `[compression] Created quantization job ${id}: ${sourceModel} -> [${targetQuantizations.join(', ')}]`,
    );

    return {
        id,
        sourceModel,
        targetQuantizations,
        status: 'pending',
        results,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Get a quantization job by ID, including all results.
 */
export function getQuantizationJob(id: string): QuantizationJob | null {
    ensureSchema();
    const d = getDb();
    const row = d.prepare('SELECT * FROM quantization_jobs WHERE id = ?').get(id) as
        Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToJob(row);
}

/**
 * List all quantization jobs, newest first.
 */
export function listQuantizationJobs(options?: {
    status?: QuantizationJobStatus;
    model?: string;
    limit?: number;
    offset?: number;
}): QuantizationJob[] {
    ensureSchema();
    const d = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
        conditions.push('status = ?');
        params.push(options.status);
    }
    if (options?.model) {
        conditions.push('source_model = ?');
        params.push(options.model);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = d.prepare(
        `SELECT * FROM quantization_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map(rowToJob);
}

/**
 * Update job status. Internal helper used by the orchestration layer.
 */
export function updateQuantizationJobStatus(
    id: string,
    status: QuantizationJobStatus,
    updates?: { results?: QuantizationResult[]; error?: string },
): void {
    ensureSchema();
    const d = getDb();

    const sets: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (updates?.results) {
        sets.push('results = ?');
        params.push(JSON.stringify(updates.results));
    }
    if (updates?.error) {
        sets.push('error = ?');
        params.push(updates.error);
    }
    if (status === 'completed' || status === 'failed') {
        sets.push("completed_at = datetime('now')");
    }

    params.push(id);
    d.prepare(`UPDATE quantization_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// =============================================================================
// 2. Smart Quantization Recommendation
// =============================================================================

/**
 * Given a model and hardware/quality constraints, return a ranked list of
 * quantization options with estimated quality, speed, and size trade-offs.
 *
 * The ranking algorithm:
 *  - Filter out options that exceed maxVramMb or fall below minQualityPct
 *  - Score each remaining option: quality_pct * (preferSpeed ? speed_multiplier : 1)
 *  - Sort descending by score
 */
export function recommendQuantization(
    model: string,
    constraints: QuantizationConstraints,
): QuantizationRecommendation {
    const options: QuantizationOption[] = [];

    for (const [quant, profile] of Object.entries(QUANTIZATION_PROFILES)) {
        const vramEst = estimateVramDetailed(model, quant);
        const sizeMb = estimateFileSizeMb(model, quant);
        const toksPerSec = estimateToksPerSec(model, quant);

        const fitsVram = vramEst.total_mb <= constraints.maxVramMb;
        const meetsQuality = profile.quality_pct >= constraints.minQualityPct;
        const fitsConstraints = fitsVram && meetsQuality;

        options.push({
            quantization: quant,
            estimatedSizeMb: sizeMb,
            estimatedVramMb: vramEst.total_mb,
            estimatedQualityPct: profile.quality_pct,
            estimatedToksPerSec: toksPerSec,
            fitsConstraints,
            rank: 0, // assigned below
        });
    }

    // Score and rank
    const scored = options
        .filter(o => o.fitsConstraints)
        .map(o => {
            const score = constraints.preferSpeed
                ? o.estimatedToksPerSec * (o.estimatedQualityPct / 100)
                : o.estimatedQualityPct + (o.estimatedToksPerSec * 0.1);
            return { option: o, score };
        })
        .sort((a, b) => b.score - a.score);

    scored.forEach((s, i) => { s.option.rank = i + 1; });

    // Also rank non-fitting options at the end
    const nonFitting = options
        .filter(o => !o.fitsConstraints)
        .sort((a, b) => b.estimatedQualityPct - a.estimatedQualityPct);
    const nextRank = scored.length;
    nonFitting.forEach((o, i) => { o.rank = nextRank + i + 1; });

    const allSorted = [
        ...scored.map(s => s.option),
        ...nonFitting,
    ];

    const recommended = scored.length > 0 ? scored[0].option.quantization : 'Q4_K_M';

    return {
        model,
        constraints,
        recommended,
        options: allSorted,
    };
}

// =============================================================================
// 3. Quantization Comparison
// =============================================================================

/**
 * Auto-benchmark the same model at every supported quantization level.
 * Returns a comparison table of quant -> size -> VRAM -> quality -> tok/s -> recommended.
 *
 * When actual benchmark data exists in the DB (from completed jobs), it uses real
 * measurements. Otherwise, uses calibrated estimates.
 */
export function compareQuantizations(model: string): QuantizationComparison {
    ensureSchema();
    const d = getDb();

    // Check if we have real benchmark results from completed jobs for this model
    const existingJobs = d.prepare(
        "SELECT results FROM quantization_jobs WHERE source_model = ? AND status = 'completed'",
    ).all(model) as Array<{ results: string }>;

    const realResults = new Map<string, QuantizationResult>();
    for (const job of existingJobs) {
        const results: QuantizationResult[] = JSON.parse(job.results);
        for (const r of results) {
            // Prefer the latest measurement
            realResults.set(r.quantization, r);
        }
    }

    // Build comparison entries for every known quantization
    const quantsToCompare = [
        'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M',
        'Q5_0', 'Q5_K_S', 'Q5_K_M', 'Q6_K', 'Q8_0',
        'AWQ', 'GPTQ', 'FP8', 'FP16',
    ];

    const entries = quantsToCompare.map(q => {
        const real = realResults.get(q);
        const profile = QUANTIZATION_PROFILES[q];
        if (!profile) {
            return {
                quantization: q,
                sizeMb: 0,
                vramMb: 0,
                qualityPct: 0,
                tokensPerSecond: 0,
                recommended: false,
            };
        }

        const vramEst = estimateVramDetailed(model, q);
        return {
            quantization: q,
            sizeMb: real?.sizeMb ?? estimateFileSizeMb(model, q),
            vramMb: real?.vramRequiredMb ?? vramEst.total_mb,
            qualityPct: real?.qualityScore ?? profile.quality_pct,
            tokensPerSecond: real?.tokensPerSecond ?? estimateToksPerSec(model, q),
            recommended: false, // set below
        };
    });

    // Determine best in each category
    const validEntries = entries.filter(e => e.sizeMb > 0);
    const bestQuality = validEntries.reduce((a, b) => a.qualityPct > b.qualityPct ? a : b);
    const bestSpeed = validEntries.reduce((a, b) => a.tokensPerSecond > b.tokensPerSecond ? a : b);

    // Best balance = highest (quality * speed) among entries with quality >= 90%
    const balanced = validEntries.filter(e => e.qualityPct >= 90);
    const bestBalance = balanced.length > 0
        ? balanced.reduce((a, b) =>
            (a.qualityPct * a.tokensPerSecond) > (b.qualityPct * b.tokensPerSecond) ? a : b,
        )
        : bestQuality;

    // Mark the recommended entry (best balance)
    const balanceEntry = entries.find(e => e.quantization === bestBalance.quantization);
    if (balanceEntry) balanceEntry.recommended = true;

    return {
        model,
        entries,
        bestQuality: bestQuality.quantization,
        bestSpeed: bestSpeed.quantization,
        bestBalance: bestBalance.quantization,
    };
}

// =============================================================================
// 4. FP8 Auto-Detection
// =============================================================================

/**
 * Check if a node's GPU supports native FP8 compute.
 * Returns true for H100, H200, B100, B200, L4, and other Hopper/Blackwell GPUs.
 */
export function shouldUseFP8(nodeId: string): FP8Assessment {
    const d = getDb();

    // Get the latest stats for this node to find GPU name
    const stat = d.prepare(
        'SELECT payload FROM stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1',
    ).get(nodeId) as { payload: string } | undefined;

    if (!stat) {
        return {
            nodeId,
            gpuName: 'unknown',
            supportsFP8: false,
            reason: 'No stats data available for this node',
        };
    }

    const payload = JSON.parse(stat.payload);
    const gpus = payload.gpus ?? [];
    if (gpus.length === 0) {
        return {
            nodeId,
            gpuName: 'none',
            supportsFP8: false,
            reason: 'No GPUs detected on this node',
        };
    }

    // Check the first GPU (all GPUs on a node are typically identical)
    const gpuName: string = gpus[0].name ?? 'unknown';
    const upperName = gpuName.toUpperCase();

    const hasFP8 = FP8_NATIVE_GPUS.some(fp8gpu => upperName.includes(fp8gpu));

    return {
        nodeId,
        gpuName,
        supportsFP8: hasFP8,
        reason: hasFP8
            ? `${gpuName} has native FP8 support via Transformer Engine -- 2x throughput, near-lossless quality`
            : `${gpuName} does not have native FP8 compute. Use Q8_0 (INT8) instead for similar compression.`,
    };
}

/**
 * Convert a model to FP8 format.
 * Creates a quantization job targeting FP8, which is nearly lossless (~99.8% quality)
 * and doubles inference speed on supported hardware.
 */
export function convertToFP8(model: string): QuantizationJob {
    return createQuantizationJob(model, ['FP8']);
}

// =============================================================================
// 5. Compression Analytics
// =============================================================================

/**
 * Calculate total VRAM and disk savings from all completed quantization jobs.
 * "Quantization saved 45GB of VRAM across your cluster."
 */
export function getCompressionSavings(): CompressionSavings {
    ensureSchema();
    const d = getDb();

    const completedJobs = d.prepare(
        "SELECT * FROM quantization_jobs WHERE status = 'completed'",
    ).all() as Record<string, unknown>[];

    let totalOriginalSizeMb = 0;
    let totalCompressedSizeMb = 0;
    let totalOriginalVramMb = 0;
    let totalCompressedVramMb = 0;
    let totalQuantizations = 0;

    for (const row of completedJobs) {
        const sourceModel = row.source_model as string;
        const results: QuantizationResult[] = JSON.parse(row.results as string);

        // FP16 baseline for comparison
        const fp16Size = estimateFileSizeMb(sourceModel, 'FP16');
        const fp16Vram = estimateVramDetailed(sourceModel, 'FP16').total_mb;

        for (const result of results) {
            totalOriginalSizeMb += fp16Size;
            totalCompressedSizeMb += result.sizeMb;
            totalOriginalVramMb += fp16Vram;
            totalCompressedVramMb += result.vramRequiredMb;
            totalQuantizations++;
        }
    }

    const savedMb = totalOriginalSizeMb - totalCompressedSizeMb;
    const savedPct = totalOriginalSizeMb > 0
        ? Math.round((savedMb / totalOriginalSizeMb) * 1000) / 10
        : 0;
    const vramSavedMb = totalOriginalVramMb - totalCompressedVramMb;

    const savedGb = Math.round(savedMb / 1024 * 10) / 10;
    const vramSavedGb = Math.round(vramSavedMb / 1024 * 10) / 10;

    return {
        totalJobsCompleted: completedJobs.length,
        totalQuantizationsProduced: totalQuantizations,
        totalOriginalSizeMb,
        totalCompressedSizeMb,
        savedMb,
        savedPct,
        totalVramSavedMb: vramSavedMb,
        summary: completedJobs.length > 0
            ? `Quantization saved ${savedGb}GB of disk and ${vramSavedGb}GB of VRAM across ${totalQuantizations} quantized models (${savedPct}% reduction)`
            : 'No completed quantization jobs yet. Run some quantizations to see savings!',
    };
}

/**
 * Analyze quality impact of quantizations across all completed jobs.
 * "Average quality loss from Q4_K_M: 2.3% vs FP16"
 */
export function getQualityImpact(): QualityImpactReport {
    ensureSchema();
    const d = getDb();

    const completedJobs = d.prepare(
        "SELECT results FROM quantization_jobs WHERE status = 'completed'",
    ).all() as Array<{ results: string }>;

    // Aggregate quality scores by quantization type
    const buckets = new Map<string, { totalQuality: number; count: number }>();

    for (const job of completedJobs) {
        const results: QuantizationResult[] = JSON.parse(job.results);
        for (const r of results) {
            const quality = r.qualityScore ?? QUANTIZATION_PROFILES[r.quantization]?.quality_pct ?? 100;
            const existing = buckets.get(r.quantization) ?? { totalQuality: 0, count: 0 };
            existing.totalQuality += quality;
            existing.count += 1;
            buckets.set(r.quantization, existing);
        }
    }

    const byQuantization = Array.from(buckets.entries())
        .map(([quant, data]) => {
            const avgQuality = Math.round((data.totalQuality / data.count) * 10) / 10;
            return {
                quantization: quant,
                avgQualityPct: avgQuality,
                avgQualityLossPct: Math.round((100 - avgQuality) * 10) / 10,
                sampleCount: data.count,
            };
        })
        .sort((a, b) => b.avgQualityPct - a.avgQualityPct);

    const totalModels = buckets.size;
    const overallAvgLoss = byQuantization.length > 0
        ? Math.round(
            byQuantization.reduce((sum, b) => sum + b.avgQualityLossPct * b.sampleCount, 0) /
            byQuantization.reduce((sum, b) => sum + b.sampleCount, 0) * 10,
        ) / 10
        : 0;

    // Build a human-friendly summary
    const summaryParts = byQuantization
        .filter(b => b.sampleCount > 0)
        .slice(0, 5)
        .map(b => `${b.quantization}: ${b.avgQualityLossPct}% loss`);

    return {
        totalModelsAnalyzed: totalModels,
        averageQualityLossPct: overallAvgLoss,
        byQuantization,
        summary: byQuantization.length > 0
            ? `Average quality loss: ${overallAvgLoss}% vs FP16. Breakdown: ${summaryParts.join(', ')}`
            : 'No quality data yet. Complete some quantization jobs with benchmarking to see impact.',
    };
}

// =============================================================================
// 6. GGUF Conversion
// =============================================================================

/**
 * Convert a HuggingFace model (safetensors) to GGUF format at the given quantization.
 * Generates the appropriate llama.cpp convert + quantize command.
 */
export function convertToGGUF(
    model: string,
    quantization: string = 'Q4_K_M',
): GGUFConversionJob {
    ensureSchema();
    const d = getDb();

    if (!(quantization in QUANTIZATION_PROFILES)) {
        throw new Error(
            `Unsupported quantization: ${quantization}. Supported: ${Object.keys(QUANTIZATION_PROFILES).join(', ')}`,
        );
    }

    const id = generateConversionId();
    const outputDir = `./models/${model.replace(/\//g, '--')}`;
    const fp16Path = `${outputDir}/model-fp16.gguf`;
    const outputPath = `${outputDir}/${quantization}.gguf`;

    // Build the two-step command string (stored as metadata; executed by the orchestrator):
    // 1. convert_hf_to_gguf.py: HuggingFace -> GGUF FP16
    // 2. llama-quantize: GGUF FP16 -> target quantization
    const step1 = [
        'python3', 'llama.cpp/convert_hf_to_gguf.py',
        '--outfile', fp16Path,
        '--outtype', 'f16',
        model,
    ].join(' ');
    const step2 = [
        './llama.cpp/llama-quantize',
        fp16Path, outputPath, quantization,
    ].join(' ');
    const fullCommand = `${step1} && ${step2}`;

    d.prepare(`
        INSERT INTO gguf_conversions (id, source_model, target_quantization, status, output_path, command)
        VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, model, quantization, outputPath, fullCommand);

    console.log(`[compression] Created GGUF conversion ${id}: ${model} -> ${quantization}`);

    return {
        id,
        sourceModel: model,
        targetQuantization: quantization,
        status: 'pending',
        outputPath,
        command: fullCommand,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Get GGUF conversion job status.
 */
export function getConversionStatus(jobId: string): GGUFConversionJob | null {
    ensureSchema();
    const d = getDb();
    const row = d.prepare('SELECT * FROM gguf_conversions WHERE id = ?').get(jobId) as
        Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToConversion(row);
}

/**
 * Update GGUF conversion status. Internal helper.
 */
export function updateConversionStatus(
    jobId: string,
    status: GGUFConversionJob['status'],
    updates?: { outputPath?: string; error?: string },
): void {
    ensureSchema();
    const d = getDb();

    const sets: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (updates?.outputPath) {
        sets.push('output_path = ?');
        params.push(updates.outputPath);
    }
    if (updates?.error) {
        sets.push('error = ?');
        params.push(updates.error);
    }
    if (status === 'completed' || status === 'failed') {
        sets.push("completed_at = datetime('now')");
    }

    params.push(jobId);
    d.prepare(`UPDATE gguf_conversions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// =============================================================================
// Command Generation
// =============================================================================

/**
 * Generate the shell command descriptor for a quantization target.
 * Supports llama.cpp quantize, AutoAWQ, and AutoGPTQ.
 *
 * NOTE: These commands are returned as structured data for the orchestration
 * layer to execute safely (via execFile or similar). They are NOT executed
 * directly by this module.
 */
export function generateQuantizationCommand(
    sourceModel: string,
    quantization: string,
    outputDir?: string,
): QuantizationCommand {
    const profile = QUANTIZATION_PROFILES[quantization];
    if (!profile) {
        throw new Error(`Unknown quantization: ${quantization}`);
    }

    const modelSlug = sourceModel.replace(/\//g, '--');
    const baseDir = outputDir ?? `./models/${modelSlug}`;

    switch (profile.tool) {
        case 'llama-quantize': {
            const fp16Path = `${baseDir}/model-fp16.gguf`;
            const outputPath = `${baseDir}/${quantization}.gguf`;
            return {
                tool: 'llama-quantize',
                command: './llama.cpp/llama-quantize',
                args: [fp16Path, outputPath, quantization],
                env: {},
                description: `Quantize ${sourceModel} to ${quantization} using llama.cpp (${profile.bits_per_weight}-bit, ~${profile.quality_pct}% quality)`,
            };
        }
        case 'auto-awq': {
            return {
                tool: 'auto-awq',
                command: 'python3',
                args: [
                    '-m', 'awq',
                    '--model_path', sourceModel,
                    '--w_bit', '4',
                    '--q_group_size', '128',
                    '--output_dir', `${baseDir}/awq`,
                ],
                env: {
                    CUDA_VISIBLE_DEVICES: '0',
                },
                description: `Quantize ${sourceModel} to 4-bit AWQ (activation-aware, ~${profile.quality_pct}% quality)`,
            };
        }
        case 'auto-gptq': {
            return {
                tool: 'auto-gptq',
                command: 'python3',
                args: [
                    '-m', 'auto_gptq',
                    '--pretrained_model_dir', sourceModel,
                    '--quantized_model_dir', `${baseDir}/gptq`,
                    '--bits', '4',
                    '--group_size', '128',
                    '--desc_act',
                ],
                env: {
                    CUDA_VISIBLE_DEVICES: '0',
                },
                description: `Quantize ${sourceModel} to 4-bit GPTQ (post-training quantization, ~${profile.quality_pct}% quality)`,
            };
        }
        default: {
            // Exhaustive check -- should never reach here
            const _exhaustive: never = profile.tool;
            throw new Error(`Unhandled quantization tool: ${_exhaustive}`);
        }
    }
}

/**
 * Generate all commands needed for a full quantization job.
 * Returns the download step, conversion, and per-target quantization commands.
 *
 * These are returned as structured data for the orchestration layer.
 */
export function generateJobCommands(job: QuantizationJob): {
    download: { command: string; args: string[] };
    convert: { command: string; args: string[] };
    quantize: QuantizationCommand[];
} {
    const modelSlug = job.sourceModel.replace(/\//g, '--');
    const baseDir = `./models/${modelSlug}`;

    return {
        download: {
            command: 'huggingface-cli',
            args: ['download', job.sourceModel, '--local-dir', `${baseDir}/source`],
        },
        convert: {
            command: 'python3',
            args: [
                'llama.cpp/convert_hf_to_gguf.py',
                '--outfile', `${baseDir}/model-fp16.gguf`,
                '--outtype', 'f16',
                `${baseDir}/source`,
            ],
        },
        quantize: job.targetQuantizations.map(q =>
            generateQuantizationCommand(job.sourceModel, q, baseDir),
        ),
    };
}
