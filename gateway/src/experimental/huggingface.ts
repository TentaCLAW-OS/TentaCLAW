// F:\tentaclaw-os\gateway\src\huggingface.ts
// HuggingFace Model Hub Integration
// TentaCLAW says: "135,000 models. I know which ones you need."

import { estimateVramDetailed } from './models';

// =============================================================================
// Types
// =============================================================================

export interface HFModelInfo {
    id: string;              // e.g. "meta-llama/Llama-3.1-8B-Instruct"
    author: string;
    model_name: string;
    pipeline_tag: string;    // "text-generation", "text2text-generation", etc.
    tags: string[];
    downloads: number;
    likes: number;
    last_modified: string;
    library_name: string;    // "transformers", "gguf", etc.
    has_gguf: boolean;
    gguf_files: Array<{ filename: string; size_bytes: number; quantization?: string }>;
    estimated_vram_mb: number;
    recommended_quantization: string;
    fits_cluster: boolean;
}

export interface GGUFFileInfo {
    filename: string;
    size_bytes: number;
    quantization: string;
    url: string;
}

export interface ClusterFitResult {
    fits: boolean;
    recommended_quantization: string;
    vram_required_mb: number;
    nodes_that_fit: number;
}

// =============================================================================
// Constants
// =============================================================================

const HF_API_BASE = 'https://huggingface.co/api';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Popular model categories for browsing
 */
export const MODEL_CATEGORIES = [
    { tag: 'text-generation', label: 'Chat & Text Generation', icon: '\u{1F4AC}' },
    { tag: 'text2text-generation', label: 'Text-to-Text', icon: '\u{1F4DD}' },
    { tag: 'text-generation-inference', label: 'Inference Optimized', icon: '\u26A1' },
    { tag: 'automatic-speech-recognition', label: 'Speech-to-Text', icon: '\u{1F3A4}' },
    { tag: 'text-to-speech', label: 'Text-to-Speech', icon: '\u{1F50A}' },
    { tag: 'text-to-image', label: 'Image Generation', icon: '\u{1F3A8}' },
    { tag: 'image-text-to-text', label: 'Vision Models', icon: '\u{1F441}\uFE0F' },
    { tag: 'feature-extraction', label: 'Embeddings', icon: '\u{1F522}' },
] as const;

// =============================================================================
// Cache
// =============================================================================

interface CacheEntry<T> {
    data: T;
    expires_at: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires_at) {
        cache.delete(key);
        return undefined;
    }
    return entry.data as T;
}

function cacheSet<T>(key: string, data: T): void {
    cache.set(key, { data, expires_at: Date.now() + CACHE_TTL_MS });
}

/** Evict expired entries (called lazily to avoid unbounded growth) */
function cacheEvictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now > entry.expires_at) cache.delete(key);
    }
}

// =============================================================================
// HuggingFace API Helpers
// =============================================================================

/** Raw JSON shape returned by the HF /api/models endpoint */
interface HFApiModel {
    _id?: string;
    id?: string;
    modelId?: string;
    author?: string;
    pipeline_tag?: string;
    tags?: string[];
    downloads?: number;
    likes?: number;
    lastModified?: string;
    library_name?: string;
    siblings?: Array<{ rfilename: string; size?: number }>;
}

/**
 * Known quantization tokens that appear in GGUF filenames.
 * Order matters: we check longer tokens first so "Q4_K_M" matches before "Q4".
 */
const KNOWN_QUANTS = [
    'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q3_K_L',
    'Q4_0', 'Q4_1', 'Q4_K_S', 'Q4_K_M',
    'Q5_0', 'Q5_1', 'Q5_K_S', 'Q5_K_M',
    'Q6_K', 'Q8_0', 'IQ2_XXS', 'IQ2_XS', 'IQ3_XXS',
    'FP16', 'BF16', 'F16', 'F32',
];

function detectQuantFromFilename(filename: string): string {
    const upper = filename.toUpperCase();
    for (const q of KNOWN_QUANTS) {
        if (upper.includes(q)) return q;
    }
    return 'unknown';
}

function splitModelId(modelId: string): { author: string; name: string } {
    const slash = modelId.indexOf('/');
    if (slash === -1) return { author: '', name: modelId };
    return { author: modelId.slice(0, slash), name: modelId.slice(slash + 1) };
}

async function hfFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${HF_API_BASE}${path}`);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== '') url.searchParams.set(k, v);
        }
    }

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    const hfToken = process.env['HF_TOKEN'] ?? process.env['HUGGING_FACE_HUB_TOKEN'];
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
        throw new Error(`HuggingFace API error ${res.status}: ${res.statusText} (${url.pathname})`);
    }
    return res.json() as Promise<T>;
}

// =============================================================================
// Mappers
// =============================================================================

function mapApiModel(raw: HFApiModel): HFModelInfo {
    const modelId = raw.id ?? raw.modelId ?? raw._id ?? '';
    const { author, name } = splitModelId(modelId);
    const tags = raw.tags ?? [];
    const siblings = raw.siblings ?? [];

    // Find GGUF files
    const ggufFiles = siblings
        .filter(s => s.rfilename.endsWith('.gguf'))
        .map(s => ({
            filename: s.rfilename,
            size_bytes: s.size ?? 0,
            quantization: detectQuantFromFilename(s.rfilename),
        }));

    const hasGguf = ggufFiles.length > 0 || tags.includes('gguf');

    // Estimate VRAM using the best available quantization
    const preferredQuant = hasGguf ? 'Q4_K_M' : 'FP16';
    const vramEstimate = estimateVramDetailed(modelId, preferredQuant);

    // Recommend quantization
    const recommendedQuantization = hasGguf ? 'Q4_K_M' : 'FP16';

    return {
        id: modelId,
        author,
        model_name: name,
        pipeline_tag: raw.pipeline_tag ?? '',
        tags,
        downloads: raw.downloads ?? 0,
        likes: raw.likes ?? 0,
        last_modified: raw.lastModified ?? '',
        library_name: raw.library_name ?? '',
        has_gguf: hasGguf,
        gguf_files: ggufFiles,
        estimated_vram_mb: vramEstimate.total_mb,
        recommended_quantization: recommendedQuantization,
        fits_cluster: false, // Caller should use checkClusterFit()
    };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Search HuggingFace models.
 * Uses the HF API: https://huggingface.co/api/models
 */
export async function searchHFModels(query: string, options?: {
    limit?: number;
    filter?: string;        // pipeline_tag filter
    sort?: 'downloads' | 'likes' | 'lastModified';
    direction?: 'asc' | 'desc';
    gguf_only?: boolean;
}): Promise<HFModelInfo[]> {
    const limit = options?.limit ?? 20;
    const sort = options?.sort ?? 'downloads';
    const direction = options?.direction ?? 'desc';
    const filter = options?.filter ?? '';

    const cacheKey = `search:${query}:${limit}:${sort}:${direction}:${filter}:${options?.gguf_only ?? false}`;
    const cached = cacheGet<HFModelInfo[]>(cacheKey);
    if (cached) return cached;

    // Periodically prune the cache
    cacheEvictExpired();

    const params: Record<string, string> = {
        search: query,
        limit: String(limit),
        sort,
        direction: direction === 'desc' ? '-1' : '1',
    };
    if (filter) params['filter'] = filter;

    const raw = await hfFetch<HFApiModel[]>('/models', params);
    let models = raw.map(mapApiModel);

    if (options?.gguf_only) {
        models = models.filter(m => m.has_gguf);
    }

    cacheSet(cacheKey, models);
    return models;
}

/**
 * Get detailed info for a specific model.
 */
export async function getHFModelInfo(modelId: string): Promise<HFModelInfo | null> {
    const cacheKey = `model:${modelId}`;
    const cached = cacheGet<HFModelInfo>(cacheKey);
    if (cached) return cached;

    try {
        const raw = await hfFetch<HFApiModel>(`/models/${modelId}`);
        const model = mapApiModel(raw);
        cacheSet(cacheKey, model);
        return model;
    } catch {
        return null;
    }
}

/**
 * List GGUF files for a model (ready to download for Ollama/llama.cpp).
 * Fetches the file listing from the model's tree API.
 */
export async function getGGUFFiles(modelId: string): Promise<GGUFFileInfo[]> {
    const cacheKey = `gguf:${modelId}`;
    const cached = cacheGet<GGUFFileInfo[]>(cacheKey);
    if (cached) return cached;

    try {
        // The model detail endpoint includes siblings (file listings)
        const raw = await hfFetch<HFApiModel>(`/models/${modelId}`);
        const siblings = raw.siblings ?? [];

        const ggufFiles: GGUFFileInfo[] = siblings
            .filter(s => s.rfilename.endsWith('.gguf'))
            .map(s => ({
                filename: s.rfilename,
                size_bytes: s.size ?? 0,
                quantization: detectQuantFromFilename(s.rfilename),
                url: `https://huggingface.co/${modelId}/resolve/main/${s.rfilename}`,
            }));

        cacheSet(cacheKey, ggufFiles);
        return ggufFiles;
    } catch {
        return [];
    }
}

/**
 * Get trending models on HuggingFace.
 * Sorted by recent downloads to approximate "trending".
 */
export async function getTrendingModels(limit?: number): Promise<HFModelInfo[]> {
    const effectiveLimit = limit ?? 20;
    const cacheKey = `trending:${effectiveLimit}`;
    const cached = cacheGet<HFModelInfo[]>(cacheKey);
    if (cached) return cached;

    cacheEvictExpired();

    const raw = await hfFetch<HFApiModel[]>('/models', {
        sort: 'downloads',
        direction: '-1',
        limit: String(effectiveLimit),
        filter: 'text-generation',
    });

    const models = raw.map(mapApiModel);
    cacheSet(cacheKey, models);
    return models;
}

/**
 * Check if a model fits on the cluster.
 */
export function checkClusterFit(model: HFModelInfo, clusterVramMb: number): ClusterFitResult {
    // Try quantizations from highest quality to lowest
    const quantsToTry = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K'];
    let recommendedQuant = 'Q4_K_M';
    let vramRequired = model.estimated_vram_mb;

    for (const q of quantsToTry) {
        const est = estimateVramDetailed(model.id, q);
        if (est.total_mb <= clusterVramMb) {
            recommendedQuant = q;
            vramRequired = est.total_mb;
            break;
        }
    }

    // If even Q2_K doesn't fit, use whatever we last computed
    if (vramRequired > clusterVramMb) {
        const smallest = estimateVramDetailed(model.id, 'Q2_K');
        vramRequired = smallest.total_mb;
        recommendedQuant = 'Q2_K';
    }

    const fits = vramRequired <= clusterVramMb;

    // Estimate how many identical nodes could each hold the model
    // (assuming uniform node VRAM = clusterVramMb / number-of-nodes is unknown,
    //  so we report how many copies fit in total cluster VRAM)
    const nodesThatFit = fits ? Math.floor(clusterVramMb / vramRequired) : 0;

    return {
        fits,
        recommended_quantization: recommendedQuant,
        vram_required_mb: vramRequired,
        nodes_that_fit: nodesThatFit,
    };
}
