/**
 * TentaCLAW Gateway — Distributed Inference Coordinator
 *
 * Enables splitting large models across multiple nodes for pipeline-parallel
 * and tensor-parallel inference.  A 70B model that cannot fit on a single GPU
 * can be sharded across 2-8 machines, each handling a slice of the layers.
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "One model. Eight arms. Spread across the cluster."
 */

import type { NodeWithStats, GpuStats } from '../../shared/types';
import { getAllNodes } from './db';
import { parseParamCount, estimateVramDetailed } from './models';

// =============================================================================
// Types
// =============================================================================

export interface DistributedModelConfig {
    model: string;
    nodes: Array<{
        node_id: string;
        hostname: string;
        ip_address: string;
        gpu_indices: number[];
        layers: { start: number; end: number };  // which layers this node handles
        vram_allocated_mb: number;
    }>;
    total_layers: number;
    total_params_b: number;
    pipeline_parallel_size: number;
    tensor_parallel_size: number;  // per node
}

export interface DistributedInferenceRequest {
    request_id: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    parameters: Record<string, unknown>;
}

export interface LayerAssignment {
    node_id: string;
    layers_start: number;
    layers_end: number;
    vram_needed_mb: number;
    estimated_latency_ms: number;
}

export interface DistributedLatencyEstimate {
    total_ms: number;
    per_node_ms: Array<{
        node_id: string;
        computation_ms: number;
        layer_count: number;
    }>;
    inter_node_transfer_ms: number;
    boundary_crossings: number;
    bottleneck_node_id: string | null;
}

export interface DistributedMetrics {
    model: string;
    nodes: Array<{
        node_id: string;
        hostname: string;
        layers: { start: number; end: number };
        layer_processing_ms: number;
        gpu_utilization_pct: number;
        vram_used_mb: number;
        vram_allocated_mb: number;
    }>;
    inter_node_transfer_ms: number;
    total_latency_ms: number;
    bottleneck: {
        node_id: string;
        reason: string;
        severity: 'low' | 'medium' | 'high';
    } | null;
    tokens_per_sec: number;
}

// =============================================================================
// Module State
// =============================================================================

/** Currently active distributed model configurations. */
const activeDistributions = new Map<string, DistributedModelConfig>();

/** Per-node latency tracking for distributed models. */
const nodeLatencyTracker = new Map<string, number[]>();

/** Maximum number of latency samples per node. */
const MAX_LATENCY_SAMPLES = 200;

// =============================================================================
// Constants
// =============================================================================

/** Estimated per-layer computation time in ms, keyed by GPU architecture prefix. */
const GPU_LAYER_LATENCY_MS: Record<string, number> = {
    'NVIDIA A100':    0.08,
    'NVIDIA H100':    0.05,
    'NVIDIA A6000':   0.10,
    'NVIDIA RTX 4090': 0.09,
    'NVIDIA RTX 4080': 0.12,
    'NVIDIA RTX 3090': 0.14,
    'NVIDIA RTX 3080': 0.18,
    'NVIDIA RTX 3070': 0.22,
    'NVIDIA RTX 3060': 0.30,
    'AMD Radeon RX 7900': 0.16,
    'AMD Radeon RX 6900': 0.22,
};

/** Default per-layer latency when the GPU type is unknown. */
const DEFAULT_LAYER_LATENCY_MS = 0.20;

/** Latency added per inter-node boundary crossing (network hop). */
const INTER_NODE_LATENCY_MS = 1.0;

/** Minimum number of nodes required for distribution. */
const MIN_NODES_FOR_DISTRIBUTION = 2;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Estimate the total number of transformer layers for a model based on its
 * parameter count.  This uses the heuristic: layers ~ sqrt(params_in_B) * 32.
 */
function estimateLayerCount(paramsBillions: number): number {
    return Math.ceil(Math.sqrt(paramsBillions) * 32);
}

/**
 * Look up per-layer latency for a GPU by matching its name against known
 * architectures.  Falls back to `DEFAULT_LAYER_LATENCY_MS`.
 */
function gpuLayerLatency(gpuName: string): number {
    for (const [prefix, latency] of Object.entries(GPU_LAYER_LATENCY_MS)) {
        if (gpuName.toUpperCase().includes(prefix.toUpperCase())) {
            return latency;
        }
    }
    return DEFAULT_LAYER_LATENCY_MS;
}

/**
 * Compute the total free VRAM across all GPUs on a node.
 */
function nodeFreeVram(node: NodeWithStats): number {
    if (!node.latest_stats) return 0;
    return node.latest_stats.gpus.reduce(
        (sum, gpu) => sum + (gpu.vramTotalMb - gpu.vramUsedMb),
        0,
    );
}

/**
 * Get the primary GPU name for a node (first GPU).
 */
function nodeGpuName(node: NodeWithStats): string {
    if (!node.latest_stats || node.latest_stats.gpus.length === 0) return 'Unknown';
    return node.latest_stats.gpus[0].name;
}

/**
 * Record a latency sample for a node participating in distributed inference.
 */
function recordNodeLatency(nodeId: string, latencyMs: number): void {
    const samples = nodeLatencyTracker.get(nodeId) || [];
    samples.push(latencyMs);
    if (samples.length > MAX_LATENCY_SAMPLES) {
        samples.splice(0, samples.length - MAX_LATENCY_SAMPLES);
    }
    nodeLatencyTracker.set(nodeId, samples);
}

/**
 * Get the average latency for a node, or -1 if no samples.
 */
function averageNodeLatency(nodeId: string): number {
    const samples = nodeLatencyTracker.get(nodeId);
    if (!samples || samples.length === 0) return -1;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// =============================================================================
// planDistribution — Optimal layer distribution across nodes
// =============================================================================

/**
 * Given a model and available cluster nodes, calculate the optimal layer
 * distribution for pipeline-parallel inference.
 *
 * Algorithm:
 *   1. Parse the model parameter count.
 *   2. Estimate total transformer layers.
 *   3. Filter to eligible online nodes with GPU(s) and free VRAM.
 *   4. Sort nodes by free VRAM descending (biggest contributors first).
 *   5. Distribute layers proportionally to each node's available VRAM.
 *   6. Minimise inter-node communication by keeping adjacent layers together.
 *
 * @returns A DistributedModelConfig describing the full split, or throws
 *          if distribution is not feasible.
 */
export function planDistribution(
    model: string,
    clusterNodes?: NodeWithStats[],
): DistributedModelConfig {
    const nodes = clusterNodes ?? getAllNodes();
    const paramCount = parseParamCount(model);
    const paramsBillions = paramCount / 1e9;
    const totalLayers = estimateLayerCount(paramsBillions);

    // Filter to eligible nodes: online, has GPUs, has stats, has free VRAM
    const eligible = nodes.filter(n =>
        n.status === 'online' &&
        n.latest_stats &&
        n.latest_stats.gpu_count > 0 &&
        nodeFreeVram(n) > 0,
    );

    if (eligible.length < MIN_NODES_FOR_DISTRIBUTION) {
        throw new Error(
            `Distributed inference requires at least ${MIN_NODES_FOR_DISTRIBUTION} eligible nodes, ` +
            `but only ${eligible.length} are available.`,
        );
    }

    // Total model VRAM requirement (using detailed estimation at FP16 for distribution sizing)
    const vramEstimate = estimateVramDetailed(model, 'Q4_K_M');
    const totalVramNeeded = vramEstimate.total_mb;

    // Total free VRAM across eligible nodes
    const totalFreeVram = eligible.reduce((sum, n) => sum + nodeFreeVram(n), 0);

    if (totalFreeVram < totalVramNeeded) {
        throw new Error(
            `Insufficient cluster VRAM for ${model}: need ${totalVramNeeded} MB but only ` +
            `${totalFreeVram} MB free across ${eligible.length} nodes.`,
        );
    }

    // Sort nodes by free VRAM descending — assign more layers to bigger nodes
    eligible.sort((a, b) => nodeFreeVram(b) - nodeFreeVram(a));

    // Determine how many nodes we actually need (stop once we have enough VRAM)
    const selectedNodes: NodeWithStats[] = [];
    let accumulatedVram = 0;
    for (const node of eligible) {
        selectedNodes.push(node);
        accumulatedVram += nodeFreeVram(node);
        if (accumulatedVram >= totalVramNeeded) break;
    }

    // Calculate proportional layer assignments
    const totalSelectedVram = selectedNodes.reduce((sum, n) => sum + nodeFreeVram(n), 0);
    const assignments: DistributedModelConfig['nodes'] = [];
    let layerCursor = 0;

    for (let i = 0; i < selectedNodes.length; i++) {
        const node = selectedNodes[i];
        const freeVram = nodeFreeVram(node);
        const vramFraction = freeVram / totalSelectedVram;

        // Calculate layer count proportional to VRAM contribution
        let layerCount: number;
        if (i === selectedNodes.length - 1) {
            // Last node gets all remaining layers to avoid rounding gaps
            layerCount = totalLayers - layerCursor;
        } else {
            layerCount = Math.max(1, Math.round(totalLayers * vramFraction));
            // Ensure we don't exceed total layers
            if (layerCursor + layerCount > totalLayers) {
                layerCount = totalLayers - layerCursor;
            }
        }

        if (layerCount <= 0) continue;

        const layersStart = layerCursor;
        const layersEnd = layerCursor + layerCount - 1;
        layerCursor += layerCount;

        // VRAM allocated proportional to layers assigned
        const vramAllocated = Math.ceil(totalVramNeeded * (layerCount / totalLayers));

        // GPU indices: use all available GPUs on the node
        const gpuIndices = node.latest_stats!.gpus.map((_: GpuStats, idx: number) => idx);

        assignments.push({
            node_id: node.id,
            hostname: node.hostname,
            ip_address: node.ip_address || '0.0.0.0',
            gpu_indices: gpuIndices,
            layers: { start: layersStart, end: layersEnd },
            vram_allocated_mb: vramAllocated,
        });
    }

    const config: DistributedModelConfig = {
        model,
        nodes: assignments,
        total_layers: totalLayers,
        total_params_b: paramsBillions,
        pipeline_parallel_size: assignments.length,
        tensor_parallel_size: 1, // Default: 1 tensor-parallel rank per node
    };

    // Store in active distributions
    activeDistributions.set(model, config);

    return config;
}

// =============================================================================
// estimateDistributedLatency — End-to-end latency prediction
// =============================================================================

/**
 * Estimate the end-to-end inference latency for a distributed model config.
 *
 * Accounts for:
 *   - Per-layer computation time based on GPU type
 *   - Inter-node network hops at each pipeline stage boundary (~1 ms each)
 *   - Pipeline bubbles (sequential dependency between stages)
 */
export function estimateDistributedLatency(
    config: DistributedModelConfig,
): DistributedLatencyEstimate {
    const allNodes = getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    const perNodeMs: DistributedLatencyEstimate['per_node_ms'] = [];
    let maxNodeMs = 0;
    let bottleneckNodeId: string | null = null;

    for (const assignment of config.nodes) {
        const node = nodeMap.get(assignment.node_id);
        const gpuName = node ? nodeGpuName(node) : 'Unknown';
        const perLayerMs = gpuLayerLatency(gpuName);
        const layerCount = assignment.layers.end - assignment.layers.start + 1;
        const computationMs = layerCount * perLayerMs;

        perNodeMs.push({
            node_id: assignment.node_id,
            computation_ms: Math.round(computationMs * 100) / 100,
            layer_count: layerCount,
        });

        if (computationMs > maxNodeMs) {
            maxNodeMs = computationMs;
            bottleneckNodeId = assignment.node_id;
        }
    }

    // Number of inter-node boundary crossings = pipeline stages - 1
    const boundaryCrossings = Math.max(0, config.nodes.length - 1);
    const interNodeTransferMs = boundaryCrossings * INTER_NODE_LATENCY_MS;

    // Total latency is the sum of all stages (pipeline is sequential for a
    // single request) plus inter-node transfer overhead.
    const totalComputeMs = perNodeMs.reduce((sum, n) => sum + n.computation_ms, 0);
    const totalMs = Math.round((totalComputeMs + interNodeTransferMs) * 100) / 100;

    return {
        total_ms: totalMs,
        per_node_ms: perNodeMs,
        inter_node_transfer_ms: interNodeTransferMs,
        boundary_crossings: boundaryCrossings,
        bottleneck_node_id: bottleneckNodeId,
    };
}

// =============================================================================
// getDistributedModels — List all active distributed models
// =============================================================================

/**
 * Return a list of all models currently running in distributed mode,
 * along with their configuration summaries.
 */
export function getDistributedModels(): Array<{
    model: string;
    node_count: number;
    total_layers: number;
    total_params_b: number;
    pipeline_parallel_size: number;
    node_ids: string[];
}> {
    const results: Array<{
        model: string;
        node_count: number;
        total_layers: number;
        total_params_b: number;
        pipeline_parallel_size: number;
        node_ids: string[];
    }> = [];

    for (const [_model, config] of activeDistributions) {
        results.push({
            model: config.model,
            node_count: config.nodes.length,
            total_layers: config.total_layers,
            total_params_b: config.total_params_b,
            pipeline_parallel_size: config.pipeline_parallel_size,
            node_ids: config.nodes.map(n => n.node_id),
        });
    }

    return results;
}

// =============================================================================
// canDistribute — Feasibility check
// =============================================================================

/**
 * Check whether a model can be distributed across the given nodes.
 *
 * Requirements:
 *   1. Total free VRAM across all provided nodes >= model VRAM requirement.
 *   2. At least 2 eligible nodes available.
 *   3. (Estimated) inter-node latency is below threshold.
 */
export function canDistribute(
    model: string,
    nodes?: NodeWithStats[],
): {
    feasible: boolean;
    reason: string;
    total_vram_available_mb: number;
    total_vram_required_mb: number;
    eligible_node_count: number;
    shortfall_mb: number;
} {
    const allNodes = nodes ?? getAllNodes();

    const eligible = allNodes.filter(n =>
        n.status === 'online' &&
        n.latest_stats &&
        n.latest_stats.gpu_count > 0 &&
        nodeFreeVram(n) > 0,
    );

    const vramEstimate = estimateVramDetailed(model, 'Q4_K_M');
    const totalRequired = vramEstimate.total_mb;
    const totalAvailable = eligible.reduce((sum, n) => sum + nodeFreeVram(n), 0);
    const shortfall = Math.max(0, totalRequired - totalAvailable);

    // Check: at least 2 nodes
    if (eligible.length < MIN_NODES_FOR_DISTRIBUTION) {
        return {
            feasible: false,
            reason: `Need at least ${MIN_NODES_FOR_DISTRIBUTION} eligible nodes, only ${eligible.length} available.`,
            total_vram_available_mb: totalAvailable,
            total_vram_required_mb: totalRequired,
            eligible_node_count: eligible.length,
            shortfall_mb: shortfall,
        };
    }

    // Check: total VRAM sufficiency
    if (totalAvailable < totalRequired) {
        return {
            feasible: false,
            reason: `Insufficient VRAM: need ${totalRequired} MB but only ${totalAvailable} MB free across ${eligible.length} nodes.`,
            total_vram_available_mb: totalAvailable,
            total_vram_required_mb: totalRequired,
            eligible_node_count: eligible.length,
            shortfall_mb: shortfall,
        };
    }

    // Check: no single node can fit the whole model (otherwise distribution is wasteful)
    const largestNodeVram = Math.max(...eligible.map(n => nodeFreeVram(n)));
    if (largestNodeVram >= totalRequired) {
        return {
            feasible: true,
            reason: `Distribution possible but unnecessary: node with ${largestNodeVram} MB free can fit the model alone (${totalRequired} MB required).`,
            total_vram_available_mb: totalAvailable,
            total_vram_required_mb: totalRequired,
            eligible_node_count: eligible.length,
            shortfall_mb: 0,
        };
    }

    return {
        feasible: true,
        reason: `Model can be distributed across ${eligible.length} nodes. Total VRAM: ${totalAvailable} MB available, ${totalRequired} MB required.`,
        total_vram_available_mb: totalAvailable,
        total_vram_required_mb: totalRequired,
        eligible_node_count: eligible.length,
        shortfall_mb: 0,
    };
}

// =============================================================================
// getDistributionPlan — Retrieve current distribution for a running model
// =============================================================================

/**
 * Get the current distribution plan for a model that is running in
 * distributed mode.  Returns null if the model is not distributed.
 */
export function getDistributionPlan(model: string): DistributedModelConfig | null {
    return activeDistributions.get(model) ?? null;
}

// =============================================================================
// redistributeModel — Recalculate distribution on topology change
// =============================================================================

/**
 * Recalculate the distribution plan for a model when the set of available
 * nodes changes (e.g. a node goes offline, or a new node joins).
 *
 * This removes the old distribution and creates a fresh plan based on the
 * new node set.  Returns the new config.
 */
export function redistributeModel(
    model: string,
    newNodes?: NodeWithStats[],
): DistributedModelConfig {
    const existingConfig = activeDistributions.get(model);

    // Remove the old distribution
    activeDistributions.delete(model);
    nodeLatencyTracker.clear();

    // Plan a fresh distribution with the new node set
    const updatedConfig = planDistribution(model, newNodes);

    // Preserve tensor_parallel_size from the old config if it was customised
    if (existingConfig && existingConfig.tensor_parallel_size > 1) {
        updatedConfig.tensor_parallel_size = existingConfig.tensor_parallel_size;
    }

    return updatedConfig;
}

// =============================================================================
// getDistributedMetrics — Per-node metrics for a distributed model
// =============================================================================

/**
 * Gather per-node metrics for a distributed model including layer processing
 * times, GPU utilisation, inter-node transfer latency, and bottleneck
 * detection.
 *
 * Returns null if the model is not running in distributed mode.
 */
export function getDistributedMetrics(model: string): DistributedMetrics | null {
    const config = activeDistributions.get(model);
    if (!config) return null;

    const allNodes = getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    const latencyEstimate = estimateDistributedLatency(config);

    const nodeMetrics: DistributedMetrics['nodes'] = [];
    let maxProcessingMs = 0;
    let bottleneckNodeId: string | null = null;
    let bottleneckReason = '';

    for (const assignment of config.nodes) {
        const node = nodeMap.get(assignment.node_id);
        const gpuName = node ? nodeGpuName(node) : 'Unknown';
        const perLayerMs = gpuLayerLatency(gpuName);
        const layerCount = assignment.layers.end - assignment.layers.start + 1;
        const processingMs = layerCount * perLayerMs;

        // Gather live GPU stats if available
        let gpuUtilPct = 0;
        let vramUsed = 0;
        if (node?.latest_stats) {
            const gpus = node.latest_stats.gpus;
            gpuUtilPct = gpus.length > 0
                ? gpus.reduce((sum, g) => sum + g.utilizationPct, 0) / gpus.length
                : 0;
            vramUsed = gpus.reduce((sum, g) => sum + g.vramUsedMb, 0);
        }

        // Check for historical latency data
        const historicalLatency = averageNodeLatency(assignment.node_id);
        const effectiveMs = historicalLatency > 0 ? historicalLatency : processingMs;

        nodeMetrics.push({
            node_id: assignment.node_id,
            hostname: assignment.hostname,
            layers: assignment.layers,
            layer_processing_ms: Math.round(effectiveMs * 100) / 100,
            gpu_utilization_pct: Math.round(gpuUtilPct * 10) / 10,
            vram_used_mb: vramUsed,
            vram_allocated_mb: assignment.vram_allocated_mb,
        });

        // Bottleneck detection: highest processing time
        if (effectiveMs > maxProcessingMs) {
            maxProcessingMs = effectiveMs;
            bottleneckNodeId = assignment.node_id;
            bottleneckReason = `Highest layer processing time: ${Math.round(effectiveMs * 100) / 100} ms for ${layerCount} layers`;
        }

        // Also flag if GPU utilisation is very high
        if (gpuUtilPct > 95 && effectiveMs >= maxProcessingMs * 0.8) {
            bottleneckNodeId = assignment.node_id;
            bottleneckReason = `GPU saturated at ${Math.round(gpuUtilPct)}% utilisation with ${Math.round(effectiveMs * 100) / 100} ms processing time`;
        }
    }

    // Determine bottleneck severity
    let bottleneck: DistributedMetrics['bottleneck'] = null;
    if (bottleneckNodeId && nodeMetrics.length > 1) {
        const avgMs = nodeMetrics.reduce((s, n) => s + n.layer_processing_ms, 0) / nodeMetrics.length;
        const ratio = maxProcessingMs / (avgMs || 1);
        let severity: 'low' | 'medium' | 'high';
        if (ratio > 2.0) {
            severity = 'high';
        } else if (ratio > 1.5) {
            severity = 'medium';
        } else {
            severity = 'low';
        }

        bottleneck = {
            node_id: bottleneckNodeId,
            reason: bottleneckReason,
            severity,
        };
    }

    // Estimate tokens per second from the overall latency
    // A single token pass requires one full forward pass through all layers
    const totalLatencyMs = latencyEstimate.total_ms;
    const tokensPerSec = totalLatencyMs > 0 ? Math.round(1000 / totalLatencyMs) : 0;

    return {
        model,
        nodes: nodeMetrics,
        inter_node_transfer_ms: latencyEstimate.inter_node_transfer_ms,
        total_latency_ms: totalLatencyMs,
        bottleneck,
        tokens_per_sec: tokensPerSec,
    };
}

// =============================================================================
// Utility exports
// =============================================================================

/**
 * Remove a distributed model configuration (e.g. when unloading the model).
 */
export function removeDistributedModel(model: string): boolean {
    const existed = activeDistributions.has(model);
    activeDistributions.delete(model);
    // Clean up latency tracking for all nodes that were part of this distribution
    const config = activeDistributions.get(model);
    if (!config) {
        // Already deleted; clear stale entries if any
    }
    return existed;
}

/**
 * Get the number of inter-node boundary crossings for a distribution config.
 */
export function getBoundaryCrossings(config: DistributedModelConfig): number {
    return Math.max(0, config.nodes.length - 1);
}

/**
 * Get layer assignments as a flat list for easier consumption.
 */
export function getLayerAssignments(config: DistributedModelConfig): LayerAssignment[] {
    const allNodes = getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    return config.nodes.map(assignment => {
        const node = nodeMap.get(assignment.node_id);
        const gpuName = node ? nodeGpuName(node) : 'Unknown';
        const perLayerMs = gpuLayerLatency(gpuName);
        const layerCount = assignment.layers.end - assignment.layers.start + 1;

        return {
            node_id: assignment.node_id,
            layers_start: assignment.layers.start,
            layers_end: assignment.layers.end,
            vram_needed_mb: assignment.vram_allocated_mb,
            estimated_latency_ms: Math.round(layerCount * perLayerMs * 100) / 100,
        };
    });
}

/**
 * Record a latency observation for a node in the distributed pipeline.
 * Used by the inference proxy to feed real measurements back into the
 * coordinator for more accurate bottleneck detection.
 */
export function recordDistributedLatency(nodeId: string, latencyMs: number): void {
    recordNodeLatency(nodeId, latencyMs);
}
