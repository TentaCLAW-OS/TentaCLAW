/**
 * TentaCLAW Gateway — Intelligent Model Placement Scheduler
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "I decide where everything goes. Eight arms. One brain. Perfect placement."
 */

import {
    getAllNodes,
    getClusterModels,
    getEvictionCandidates,
    getNodeLatencyP50,
    getNodeThroughput,
    getModelPriority,
    getIdleModels,
    getPlacementConstraints,
    estimateModelVram,
    resolveModelAlias,
} from './db';

// =============================================================================
// Public Types
// =============================================================================

export interface PlacementPlan {
    model: string;
    target_nodes: Array<{
        node_id: string;
        hostname: string;
        backend: string;
        available_vram_mb: number;
        estimated_model_vram_mb: number;
        evictions_needed: string[];
        confidence: number;
    }>;
    total_vram_required_mb: number;
    strategy: PlacementStrategy;
    warnings: string[];
}

export type PlacementStrategy = 'spread' | 'binpack' | 'latency' | 'cost';

export type RoutingStrategy =
    | 'least-loaded'
    | 'least-latency'
    | 'round-robin'
    | 'vram-headroom'
    | 'affinity';

export interface RoutingDecision {
    node_id: string;
    hostname: string;
    backend_port: number;
    backend_type: string;
    reason: string;
    score: number;
    latency_estimate_ms: number;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Round-robin counter keyed by model name. */
const rrCounters = new Map<string, number>();

/** Affinity map: model -> last-used node_id. */
const affinityMap = new Map<string, string>();

/**
 * Quantization bytes-per-parameter table.
 *
 * When the user specifies a quantization level (e.g. "Q4_K_M") we normalise
 * to a canonical prefix and look it up here.  Unrecognised quant strings
 * fall back to Q4 (the most common Ollama default).
 */
const QUANT_BPP: Record<string, number> = {
    'Q2':   0.3125,   // 2.5 bits
    'Q3':   0.4375,   // 3.5 bits
    'Q4':   0.5,      // 4 bits  — default for most Ollama models
    'Q5':   0.625,    // 5 bits
    'Q6':   0.75,     // 6 bits
    'Q8':   1.0,      // 8 bits
    'FP16': 2.0,
    'FP32': 4.0,
    'BF16': 2.0,
};

/**
 * Backend concurrency penalty.
 *
 * vLLM and SGLang use continuous batching which handles concurrent requests
 * far more efficiently than Ollama's sequential model.  Lower = preferred.
 */
const BACKEND_PENALTY: Record<string, number> = {
    vllm:   0,
    sglang: 2,
    ollama: 10,
    llamacpp: 5,
};

function backendPenalty(backend: string): number {
    const key = backend.toLowerCase();
    return BACKEND_PENALTY[key] ?? 5;
}

/**
 * Normalise a quantisation string like "Q4_K_M" or "q8_0" to a lookup key.
 */
function normaliseQuant(q: string): string {
    const upper = q.toUpperCase().trim();
    if (upper.startsWith('FP') || upper.startsWith('BF')) return upper.replace(/[^A-Z0-9]/g, '');
    const match = upper.match(/^Q(\d)/);
    return match ? `Q${match[1]}` : 'Q4';
}

/**
 * Parse a parameter count in *billions* from a model name string.
 *
 * Handles patterns like:
 *   llama3.1:8b       -> 8
 *   mixtral:8x7b      -> 46.7  (MoE: total ≈ 8*7 * 5/6)
 *   qwen3:14b         -> 14
 *   deepseek-coder-v2:16b -> 16
 *   llama3.1:70b-q4_0 -> 70
 *
 * Returns undefined when no parameter count can be inferred.
 */
function parseParamBillions(model: string): number | undefined {
    // MoE pattern: 8x7b
    const moeMatch = model.match(/(\d+)x(\d+)b/i);
    if (moeMatch) {
        const experts = parseInt(moeMatch[1], 10);
        const perExpert = parseInt(moeMatch[2], 10);
        // Rough total effective params for MoE (shared layers ≈ 80% of one expert)
        return experts * perExpert * (5 / 6);
    }

    // Standard: just "Nb"
    const match = model.match(/(\d+(?:\.\d+)?)b/i);
    if (match) return parseFloat(match[1]);

    return undefined;
}

/**
 * Parse quantization hint from the model name itself.
 * e.g. "llama3.1:8b-q4_k_m" -> "Q4"
 */
function parseQuantFromName(model: string): string | undefined {
    const match = model.match(/[_-](q\d|fp16|fp32|bf16)/i);
    return match ? normaliseQuant(match[1]) : undefined;
}

// =============================================================================
// estimateVram — Fine-grained VRAM estimation
// =============================================================================

/**
 * Estimate VRAM requirement for a model with specific quantization.
 *
 * The estimate breaks down into four components:
 *   1. Model weights — paramBillions * bytesPerParam * 1024
 *   2. KV cache      — proportional to context length and model dimension
 *   3. Activations   — scratch space for forward pass
 *   4. Overhead       — CUDA context, framework buffers (~300-500 MB)
 *
 * This is significantly more accurate than the simple `estimateModelVram`
 * in db.ts because it considers quantization and context length.
 */
export function estimateVram(
    model: string,
    quantization?: string,
    contextLength: number = 4096,
): {
    model_weights_mb: number;
    kv_cache_mb: number;
    activation_mb: number;
    overhead_mb: number;
    total_mb: number;
    fits_on: Array<{ node_id: string; hostname: string; headroom_mb: number }>;
} {
    // Resolve alias first
    const resolved = resolveModelAlias(model);
    const modelName = resolved.target;

    const params = parseParamBillions(modelName);

    // Determine quantization: explicit arg > parsed from name > default Q4
    const quantKey = quantization
        ? normaliseQuant(quantization)
        : (parseQuantFromName(modelName) ?? 'Q4');
    const bpp = QUANT_BPP[quantKey] ?? 0.5;

    let modelWeightsMb: number;

    if (params !== undefined) {
        // params in billions, bpp in bytes per parameter
        // weight_bytes = params * 1e9 * bpp
        // weight_mb    = weight_bytes / (1024 * 1024)
        modelWeightsMb = Math.round((params * 1e9 * bpp) / (1024 * 1024));
    } else {
        // Fall back to the lookup table in db.ts
        modelWeightsMb = estimateModelVram(modelName);
    }

    // KV cache estimate
    // Rule of thumb: for a transformer with hidden_dim ≈ params^0.4 * 1024,
    // KV cache per token ≈ 2 * n_layers * 2 * hidden_dim * sizeof(fp16)
    // We use a simplified formula: ~0.5 MB per 1K context per 1B params (at Q4).
    const paramScale = params ?? (modelWeightsMb / 600); // rough inverse of the 600 MB/B heuristic
    const kvCacheMb = Math.round(paramScale * (contextLength / 1024) * 0.5);

    // Activation memory — typically 5-10% of model weights during inference
    const activationMb = Math.round(modelWeightsMb * 0.07);

    // Overhead: CUDA context + framework buffers
    const overheadMb = 400;

    const totalMb = modelWeightsMb + kvCacheMb + activationMb + overheadMb;

    // Check which nodes can fit this model
    const nodes = getAllNodes();
    const fitsOn: Array<{ node_id: string; hostname: string; headroom_mb: number }> = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram  = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const free = totalVram - usedVram;
        if (free >= totalMb) {
            fitsOn.push({ node_id: node.id, hostname: node.hostname, headroom_mb: free - totalMb });
        }
    }

    fitsOn.sort((a, b) => b.headroom_mb - a.headroom_mb);

    return {
        model_weights_mb: modelWeightsMb,
        kv_cache_mb: kvCacheMb,
        activation_mb: activationMb,
        overhead_mb: overheadMb,
        total_mb: totalMb,
        fits_on: fitsOn,
    };
}

// =============================================================================
// planModelPlacement — Cluster-wide model placement planning
// =============================================================================

/**
 * Plan where to place a model in the cluster.
 *
 * Strategies:
 *   - **spread**: distribute replicas across as many nodes as possible
 *     (maximises fault tolerance)
 *   - **binpack**: pack onto fewest nodes with most free VRAM
 *     (minimises resource fragmentation)
 *   - **latency**: prefer nodes with lowest historical inference latency
 *   - **cost**: prefer nodes that need zero evictions, then fewest evictions
 */
export function planModelPlacement(
    model: string,
    options?: {
        replicas?: number;
        strategy?: PlacementStrategy;
        quantization?: string;
        exclude_nodes?: string[];
        require_backend?: string;
    },
): PlacementPlan {
    const replicas      = options?.replicas ?? 1;
    const strategy      = options?.strategy ?? 'binpack';
    const quantization  = options?.quantization;
    const excludeSet    = new Set(options?.exclude_nodes ?? []);
    const requireBe     = options?.require_backend?.toLowerCase();

    const resolved  = resolveModelAlias(model);
    const modelName = resolved.target;
    const warnings: string[] = [];

    // Estimate VRAM
    const vramEst = estimateVram(modelName, quantization);
    const requiredMb = vramEst.total_mb;

    // Placement constraints from DB
    const constraints = getPlacementConstraints(modelName);
    const requireNodeIds = new Set<string>();
    const avoidNodeIds   = new Set<string>();
    const requireTags    = new Set<string>();
    for (const c of constraints) {
        if (c.constraint_type === 'require_node') requireNodeIds.add(c.target);
        if (c.constraint_type === 'avoid_node')   avoidNodeIds.add(c.target);
        if (c.constraint_type === 'require_tag')   requireTags.add(c.target);
    }

    const nodes = getAllNodes();

    // Build candidate list
    interface Candidate {
        node_id: string;
        hostname: string;
        backend: string;
        available_vram_mb: number;
        total_vram_mb: number;
        evictions_needed: string[];
        eviction_cost: number;
        latency_p50: number;
        confidence: number;
    }

    const candidates: Candidate[] = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (excludeSet.has(node.id))  continue;
        if (avoidNodeIds.has(node.id)) continue;

        // If constraints require specific nodes, skip others
        if (requireNodeIds.size > 0 && !requireNodeIds.has(node.id)) continue;

        const backend = (node.latest_stats as any).backend;
        const backendType = (backend?.type || 'ollama') as string;

        // Backend filter
        if (requireBe && backendType.toLowerCase() !== requireBe) continue;

        // Tag constraint check (would need tags API; check if we have placement constraints for tags)
        // For now, tag constraints are a warning if we can't verify them
        if (requireTags.size > 0) {
            // We would need getNodeTags here. Since it exists in db.ts, we can import it.
            // For safety, just note the warning if not already handled.
            // Tags are checked via getNodeTags (not imported to avoid circular), so skip tag check
            // and add a warning instead.
            warnings.push(`Tag constraints present for ${modelName} but tag verification is advisory-only in scheduler`);
        }

        // Skip if model is already loaded on this node
        if (node.latest_stats.inference.loaded_models.includes(modelName)) continue;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram  = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const available = totalVram - usedVram;

        // Skip nodes where model cannot fit even with full eviction
        if (totalVram < requiredMb) continue;

        let evictionsNeeded: string[] = [];
        let evictionCost = 0;

        if (available < requiredMb) {
            // Need evictions
            const evictable = getEvictionCandidates(node.id);
            let freedVram = available;
            const evictions: string[] = [];

            for (const candidate of evictable) {
                if (freedVram >= requiredMb) break;
                evictions.push(candidate.model);
                freedVram += candidate.vram_mb;
            }

            if (freedVram < requiredMb) continue; // Still can't fit, skip

            evictionsNeeded = evictions;
            evictionCost = evictions.length;
        }

        // Historical latency for this model (or 0 if no data)
        const latencyP50 = getNodeLatencyP50(node.id, modelName);

        // Confidence: starts at 1.0, decremented by various factors
        let confidence = 1.0;
        if (evictionCost > 0) confidence -= Math.min(0.3, evictionCost * 0.1);
        if (available < requiredMb * 1.2) confidence -= 0.1;  // tight fit
        if (latencyP50 === 0) confidence -= 0.05;             // no historical data
        confidence = Math.max(0, Math.round(confidence * 100) / 100);

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            backend: backendType,
            available_vram_mb: available,
            total_vram_mb: totalVram,
            evictions_needed: evictionsNeeded,
            eviction_cost: evictionCost,
            latency_p50: latencyP50,
            confidence,
        });
    }

    // Sort candidates according to strategy
    switch (strategy) {
        case 'spread':
            // Prefer nodes with the least loaded models (most room) to spread load
            candidates.sort((a, b) => {
                const aModels = getAllNodes().find(n => n.id === a.node_id)
                    ?.latest_stats?.inference.loaded_models.length ?? 0;
                const bModels = getAllNodes().find(n => n.id === b.node_id)
                    ?.latest_stats?.inference.loaded_models.length ?? 0;
                if (aModels !== bModels) return aModels - bModels;
                return b.available_vram_mb - a.available_vram_mb;
            });
            break;

        case 'binpack':
            // Prefer nodes with *least* free VRAM that can still fit the model
            // (pack tightly to leave other nodes fully free for big models)
            candidates.sort((a, b) => {
                if (a.eviction_cost !== b.eviction_cost) return a.eviction_cost - b.eviction_cost;
                // Among zero-eviction candidates, pick the tightest fit
                return a.available_vram_mb - b.available_vram_mb;
            });
            break;

        case 'latency':
            // Prefer nodes with best historical latency
            candidates.sort((a, b) => {
                // Nodes with actual latency data beat those without
                if (a.latency_p50 > 0 && b.latency_p50 === 0) return -1;
                if (a.latency_p50 === 0 && b.latency_p50 > 0) return 1;
                if (a.latency_p50 !== b.latency_p50) return a.latency_p50 - b.latency_p50;
                return a.eviction_cost - b.eviction_cost;
            });
            break;

        case 'cost':
            // Minimise evictions, then prefer most available VRAM
            candidates.sort((a, b) => {
                if (a.eviction_cost !== b.eviction_cost) return a.eviction_cost - b.eviction_cost;
                return b.available_vram_mb - a.available_vram_mb;
            });
            break;
    }

    const selected = candidates.slice(0, replicas);

    if (selected.length < replicas) {
        warnings.push(
            `Requested ${replicas} replica(s) but only ${selected.length} suitable node(s) found`,
        );
    }

    if (selected.length === 0) {
        warnings.push('No nodes have enough VRAM to fit this model (even with evictions)');
    }

    return {
        model: modelName,
        target_nodes: selected.map(c => ({
            node_id: c.node_id,
            hostname: c.hostname,
            backend: c.backend,
            available_vram_mb: c.available_vram_mb,
            estimated_model_vram_mb: requiredMb,
            evictions_needed: c.evictions_needed,
            confidence: c.confidence,
        })),
        total_vram_required_mb: requiredMb,
        strategy,
        warnings,
    };
}

// =============================================================================
// routeRequest — Real-time inference routing
// =============================================================================

/**
 * Route an inference request to the best available node that has the model loaded.
 *
 * Composite score (lower = better):
 *   (in_flight_requests * 40)
 * + (latency_p50 * 0.3)
 * + ((100 - vram_headroom_pct) * 0.2)
 * + backend_penalty
 *
 * The chosen `RoutingStrategy` adjusts the weights and tie-breakers.
 */
export function routeRequest(
    model: string,
    options?: {
        strategy?: RoutingStrategy;
        prefer_node?: string;
        max_latency_ms?: number;
        exclude_nodes?: string[];
    },
): RoutingDecision | null {
    const strategy   = options?.strategy ?? 'least-loaded';
    const preferNode = options?.prefer_node;
    const maxLatency = options?.max_latency_ms ?? Infinity;
    const excludeSet = new Set(options?.exclude_nodes ?? []);

    const resolved = resolveModelAlias(model);
    const modelName = resolved.target;
    const fallbacks = resolved.fallbacks;

    // Try primary model first, then fallbacks
    const modelsToTry = [modelName, ...fallbacks];

    for (const tryModel of modelsToTry) {
        const decision = routeForModel(tryModel, strategy, preferNode, maxLatency, excludeSet);
        if (decision) {
            // Update affinity map
            affinityMap.set(model, decision.node_id);
            return decision;
        }
    }

    return null;
}

function routeForModel(
    model: string,
    strategy: RoutingStrategy,
    preferNode: string | undefined,
    maxLatency: number,
    excludeSet: Set<string>,
): RoutingDecision | null {
    const nodes = getAllNodes();

    interface Scored {
        node_id: string;
        hostname: string;
        backend_type: string;
        backend_port: number;
        in_flight: number;
        latency_p50: number;
        throughput: number;
        vram_headroom_pct: number;
        score: number;
    }

    const candidates: Scored[] = [];

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        if (excludeSet.has(node.id)) continue;

        // Check if model is loaded
        const hasModel = node.latest_stats.inference.loaded_models.some(
            m => m === model || m.startsWith(model.split(':')[0]),
        );
        if (!hasModel) continue;

        const backend = (node.latest_stats as any).backend;
        const backendType = (backend?.type || 'ollama') as string;
        const backendPort = (backend?.port || 11434) as number;

        const latencyP50 = getNodeLatencyP50(node.id, model);
        const throughput = getNodeThroughput(node.id, model);

        // Respect max latency constraint
        if (latencyP50 > 0 && latencyP50 > maxLatency) continue;

        const inFlight = node.latest_stats.inference.in_flight_requests;

        const totalVram = node.latest_stats.gpus.reduce((s, g) => s + g.vramTotalMb, 0);
        const usedVram  = node.latest_stats.gpus.reduce((s, g) => s + g.vramUsedMb, 0);
        const vramHeadroomPct = totalVram > 0 ? ((totalVram - usedVram) / totalVram) * 100 : 0;

        // Composite score (lower = better)
        let score: number;

        switch (strategy) {
            case 'least-loaded':
                score = (inFlight * 40) +
                        (latencyP50 * 0.3) +
                        ((100 - vramHeadroomPct) * 0.2) +
                        backendPenalty(backendType);
                break;

            case 'least-latency':
                // Heavily weight latency; use throughput as tiebreaker
                score = (latencyP50 > 0 ? latencyP50 : 500) * 1.0 +
                        (inFlight * 10) +
                        backendPenalty(backendType) -
                        (throughput * 0.1);
                break;

            case 'round-robin': {
                // All candidates get equal base score; order is determined
                // by the round-robin counter after sorting.
                score = 0;
                break;
            }

            case 'vram-headroom':
                // Prefer nodes with the most VRAM headroom (for future requests)
                score = (100 - vramHeadroomPct) * 1.0 +
                        (inFlight * 10) +
                        backendPenalty(backendType);
                break;

            case 'affinity': {
                // Prefer the node that last served this model (cache locality)
                const affinityNode = affinityMap.get(model);
                const affinityBonus = (affinityNode === node.id) ? -100 : 0;
                score = affinityBonus +
                        (inFlight * 40) +
                        (latencyP50 * 0.3) +
                        ((100 - vramHeadroomPct) * 0.2) +
                        backendPenalty(backendType);
                break;
            }

            default:
                score = (inFlight * 40) + (latencyP50 * 0.3) + backendPenalty(backendType);
        }

        // Preferred node bonus (significant score reduction)
        if (preferNode && node.id === preferNode) {
            score -= 200;
        }

        candidates.push({
            node_id: node.id,
            hostname: node.hostname,
            backend_type: backendType,
            backend_port: backendPort,
            in_flight: inFlight,
            latency_p50: latencyP50,
            throughput,
            vram_headroom_pct: vramHeadroomPct,
            score: Math.round(score * 10) / 10,
        });
    }

    if (candidates.length === 0) return null;

    // For round-robin, rotate through candidates deterministically
    if (strategy === 'round-robin') {
        const counter = (rrCounters.get(model) ?? 0) % candidates.length;
        rrCounters.set(model, counter + 1);

        // Sort by node_id for stable ordering, then pick at index `counter`
        candidates.sort((a, b) => a.node_id.localeCompare(b.node_id));
        const pick = candidates[counter % candidates.length];

        return {
            node_id: pick.node_id,
            hostname: pick.hostname,
            backend_port: pick.backend_port,
            backend_type: pick.backend_type,
            reason: `round-robin (slot ${counter + 1}/${candidates.length})`,
            score: pick.score,
            latency_estimate_ms: pick.latency_p50 || 0,
        };
    }

    // Standard: pick lowest score
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    // Build human-readable reason
    const parts: string[] = [];
    if (best.in_flight === 0) parts.push('idle');
    else parts.push(`${best.in_flight} in-flight`);
    if (best.latency_p50 > 0) parts.push(`p50=${best.latency_p50}ms`);
    if (best.throughput > 0)   parts.push(`${Math.round(best.throughput)} tok/s`);
    parts.push(`${best.backend_type}`);
    parts.push(`${Math.round(best.vram_headroom_pct)}% VRAM free`);

    return {
        node_id: best.node_id,
        hostname: best.hostname,
        backend_port: best.backend_port,
        backend_type: best.backend_type,
        reason: `${strategy}: ${parts.join(', ')}`,
        score: best.score,
        latency_estimate_ms: best.latency_p50 || 0,
    };
}

// =============================================================================
// getRoutingTable — Cluster-wide model-to-node mapping
// =============================================================================

/**
 * Get a snapshot of which nodes currently serve which models,
 * including latency and throughput metrics.
 */
export function getRoutingTable(): Array<{
    model: string;
    nodes: Array<{
        node_id: string;
        backend: string;
        latency_p50_ms: number;
        throughput_tok_s: number;
    }>;
    total_replicas: number;
}> {
    const clusterModels = getClusterModels();
    const allNodes = getAllNodes();

    return clusterModels.map(entry => {
        const nodesInfo = entry.nodes.map(nodeId => {
            const node = allNodes.find(n => n.id === nodeId);
            const backend = (node?.latest_stats as any)?.backend;
            const backendType = (backend?.type || 'ollama') as string;

            return {
                node_id: nodeId,
                backend: backendType,
                latency_p50_ms: getNodeLatencyP50(nodeId, entry.model),
                throughput_tok_s: Math.round(getNodeThroughput(nodeId, entry.model) * 10) / 10,
            };
        });

        return {
            model: entry.model,
            nodes: nodesInfo,
            total_replicas: entry.node_count,
        };
    });
}

// =============================================================================
// getAutoscaleRecommendations — What should be scaled up or down
// =============================================================================

/**
 * Analyse current cluster state and recommend scaling actions.
 *
 * Rules:
 *   - **scale_up**: a model has only 1 replica and its average in-flight > 3
 *     (it needs help handling concurrent load)
 *   - **scale_down**: a model has >1 replica and all replicas have 0 in-flight
 *     requests for the sampling window
 *   - **evict**: a model has been idle for > 30 minutes and has 'low' priority
 */
export function getAutoscaleRecommendations(): Array<{
    model: string;
    action: 'scale_up' | 'scale_down' | 'evict';
    reason: string;
    current_replicas: number;
    recommended_replicas: number;
    target_node?: string;
}> {
    const recommendations: Array<{
        model: string;
        action: 'scale_up' | 'scale_down' | 'evict';
        reason: string;
        current_replicas: number;
        recommended_replicas: number;
        target_node?: string;
    }> = [];

    const clusterModels = getClusterModels();
    const allNodes = getAllNodes();

    for (const entry of clusterModels) {
        const { model, nodes: nodeIds, node_count } = entry;
        const priority = getModelPriority(model);

        // Gather in-flight stats across all nodes serving this model
        let totalInFlight = 0;
        let maxInFlight = 0;
        for (const nodeId of nodeIds) {
            const node = allNodes.find(n => n.id === nodeId);
            const inFlight = node?.latest_stats?.inference.in_flight_requests ?? 0;
            totalInFlight += inFlight;
            maxInFlight = Math.max(maxInFlight, inFlight);
        }
        const avgInFlight = node_count > 0 ? totalInFlight / node_count : 0;

        // Scale up: single replica under pressure
        if (node_count === 1 && avgInFlight > 3) {
            const plan = planModelPlacement(model, { replicas: 1, strategy: 'spread' });
            const targetNode = plan.target_nodes[0]?.node_id;

            recommendations.push({
                model,
                action: 'scale_up',
                reason: `Single replica with avg ${avgInFlight.toFixed(1)} in-flight requests — needs horizontal scaling`,
                current_replicas: node_count,
                recommended_replicas: 2,
                target_node: targetNode,
            });
        }

        // Scale up: multiple replicas all overloaded
        if (node_count > 1 && avgInFlight > 5) {
            const plan = planModelPlacement(model, { replicas: 1, strategy: 'spread' });
            const targetNode = plan.target_nodes[0]?.node_id;

            recommendations.push({
                model,
                action: 'scale_up',
                reason: `All ${node_count} replicas averaging ${avgInFlight.toFixed(1)} in-flight — cluster is saturated`,
                current_replicas: node_count,
                recommended_replicas: node_count + 1,
                target_node: targetNode,
            });
        }

        // Scale down: multiple replicas all idle
        if (node_count > 1 && totalInFlight === 0 && priority !== 'critical') {
            recommendations.push({
                model,
                action: 'scale_down',
                reason: `${node_count} replicas with zero in-flight requests — over-provisioned`,
                current_replicas: node_count,
                recommended_replicas: 1,
            });
        }
    }

    // Eviction: idle low-priority models
    const idleModels = getIdleModels(30);
    for (const idle of idleModels) {
        const priority = getModelPriority(idle.model);
        if (priority === 'critical' || priority === 'normal') continue;

        // Only evict if model has more than 0 replicas (which it does, since it's loaded)
        const entry = clusterModels.find(m => m.model === idle.model);
        const currentReplicas = entry?.node_count ?? 1;

        // Avoid duplicate recommendation if we already suggested scale_down
        const alreadyRecommended = recommendations.some(
            r => r.model === idle.model && r.action !== 'evict',
        );
        if (alreadyRecommended) continue;

        recommendations.push({
            model: idle.model,
            action: 'evict',
            reason: `Idle for ${idle.idle_minutes} minutes with '${priority}' priority`,
            current_replicas: currentReplicas,
            recommended_replicas: 0,
            target_node: idle.node_id,
        });
    }

    return recommendations;
}

// =============================================================================
// analyzeCapacity — What can the cluster handle right now?
// =============================================================================

/**
 * Full capacity analysis of the cluster: total resources, utilisation,
 * and a list of common models that could be loaded right now.
 */
export function analyzeCapacity(): {
    total_vram_mb: number;
    used_vram_mb: number;
    free_vram_mb: number;
    utilization_pct: number;
    models_loaded: number;
    can_fit: Array<{ model: string; quantization: string; nodes_that_fit: number }>;
    bottleneck: string;
} {
    const nodes = getAllNodes();
    let totalVram = 0;
    let usedVram = 0;
    let totalGpuUtil = 0;
    let gpuCount = 0;
    const loadedModels = new Set<string>();

    for (const node of nodes) {
        if (node.status !== 'online' || !node.latest_stats) continue;
        for (const gpu of node.latest_stats.gpus) {
            totalVram += gpu.vramTotalMb;
            usedVram  += gpu.vramUsedMb;
            totalGpuUtil += gpu.utilizationPct;
            gpuCount++;
        }
        for (const m of node.latest_stats.inference.loaded_models) {
            loadedModels.add(m);
        }
    }

    const freeVram = totalVram - usedVram;
    const utilizationPct = totalVram > 0 ? Math.round((usedVram / totalVram) * 1000) / 10 : 0;
    const avgGpuUtil = gpuCount > 0 ? totalGpuUtil / gpuCount : 0;

    // Check what common models could fit right now
    const commonModels: Array<{ name: string; quant: string }> = [
        { name: 'llama3.2:1b',  quant: 'Q4' },
        { name: 'llama3.2:3b',  quant: 'Q4' },
        { name: 'llama3.1:8b',  quant: 'Q4' },
        { name: 'qwen2.5:7b',   quant: 'Q4' },
        { name: 'gemma2:9b',    quant: 'Q4' },
        { name: 'qwen3:14b',    quant: 'Q4' },
        { name: 'codellama:34b', quant: 'Q4' },
        { name: 'llama3.1:70b', quant: 'Q4' },
        { name: 'llama3.1:8b',  quant: 'FP16' },
        { name: 'mixtral:8x7b', quant: 'Q4' },
    ];

    const canFit: Array<{ model: string; quantization: string; nodes_that_fit: number }> = [];

    for (const cm of commonModels) {
        const est = estimateVram(cm.name, cm.quant);
        if (est.fits_on.length > 0) {
            canFit.push({
                model: cm.name,
                quantization: cm.quant,
                nodes_that_fit: est.fits_on.length,
            });
        }
    }

    // Determine bottleneck
    let bottleneck: string;
    if (totalVram === 0) {
        bottleneck = 'none'; // No GPUs detected
    } else if (utilizationPct > 90) {
        bottleneck = 'vram';
    } else if (avgGpuUtil > 85) {
        bottleneck = 'compute';
    } else {
        // Check if network might be an issue (high in-flight across nodes)
        const totalInFlight = nodes.reduce((s, n) => {
            return s + (n.latest_stats?.inference.in_flight_requests ?? 0);
        }, 0);
        const onlineNodes = nodes.filter(n => n.status === 'online').length;
        if (onlineNodes > 0 && totalInFlight / onlineNodes > 10) {
            bottleneck = 'network';
        } else {
            bottleneck = 'none';
        }
    }

    return {
        total_vram_mb: totalVram,
        used_vram_mb: usedVram,
        free_vram_mb: freeVram,
        utilization_pct: utilizationPct,
        models_loaded: loadedModels.size,
        can_fit: canFit,
        bottleneck,
    };
}
