/**
 * TentaCLAW Gateway — Model Autoscaler
 *
 * Scale replicas up/down based on demand, with scale-to-zero for idle models.
 * Monitors queue depth, request frequency, and latency to make informed
 * scaling decisions across the cluster.
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "Why waste VRAM on models nobody's asking for?"
 */

import { getAllNodes, getClusterModels, queueCommand } from './db';
import type { NodeWithStats } from '../../shared/types';

// =============================================================================
// Types
// =============================================================================

export interface AutoscaleConfig {
    enabled: boolean;
    check_interval_ms: number;        // default 30000 (30s)
    scale_up_threshold: number;       // queue depth that triggers scale-up (default 5)
    scale_down_idle_minutes: number;   // minutes idle before scale-down (default 15)
    scale_to_zero_minutes: number;     // minutes idle before unloading entirely (default 30)
    min_replicas: number;             // minimum replicas per model (default 1, 0 = scale-to-zero)
    max_replicas: number;             // maximum replicas per model (default 10)
    cooldown_seconds: number;         // seconds between scaling actions (default 60)
}

export interface ScaleEvent {
    model: string;
    action: 'scale_up' | 'scale_down' | 'unload' | 'cold_start';
    from_replicas: number;
    to_replicas: number;
    reason: string;
    timestamp: string;
    latency_ms?: number;  // cold start latency for 'cold_start' events
}

export interface ModelScaleState {
    model: string;
    current_replicas: number;
    desired_replicas: number;
    last_request_at: string | null;
    idle_minutes: number;
    queue_depth: number;
    avg_latency_ms: number;
    scale_events: ScaleEvent[];
}

// Internal tracking for per-model request timing
interface ModelRequestTracker {
    last_request_at: number;          // epoch ms
    request_timestamps: number[];     // recent request timestamps for rate calc
    latency_samples: number[];        // recent latency samples in ms
    queue_depth: number;              // current estimated queue depth
}

// Internal per-model override for min_replicas
interface ModelOverride {
    min_replicas: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of request timestamps kept per model for rate calculation. */
const MAX_REQUEST_TIMESTAMPS = 500;

/** Maximum number of latency samples kept per model. */
const MAX_LATENCY_SAMPLES = 200;

/** Maximum number of scale events kept in history. */
const MAX_SCALE_HISTORY = 500;

/** Window (ms) over which request rate is calculated (5 minutes). */
const RATE_WINDOW_MS = 5 * 60 * 1000;

// =============================================================================
// Module State
// =============================================================================

let config: AutoscaleConfig = {
    enabled: false,
    check_interval_ms: 30_000,
    scale_up_threshold: 5,
    scale_down_idle_minutes: 15,
    scale_to_zero_minutes: 30,
    min_replicas: 1,
    max_replicas: 10,
    cooldown_seconds: 60,
};

/** Interval handle for the autoscaler loop. */
let loopTimer: ReturnType<typeof setInterval> | null = null;

/** Per-model request tracking. */
const modelTrackers = new Map<string, ModelRequestTracker>();

/** Per-model replica override (min_replicas). */
const modelOverrides = new Map<string, ModelOverride>();

/** Global scale event history. */
const scaleHistory: ScaleEvent[] = [];

/** Timestamp (epoch ms) of the last scaling action, per model. */
const lastScaleAction = new Map<string, number>();

/** Models that were previously loaded but unloaded by scale-to-zero. */
const unloadedModels = new Set<string>();

// =============================================================================
// Helpers
// =============================================================================

/** Get or create a request tracker for a model. */
function getTracker(model: string): ModelRequestTracker {
    let tracker = modelTrackers.get(model);
    if (!tracker) {
        tracker = {
            last_request_at: 0,
            request_timestamps: [],
            latency_samples: [],
            queue_depth: 0,
        };
        modelTrackers.set(model, tracker);
    }
    return tracker;
}

/** ISO timestamp for the current time. */
function nowISO(): string {
    return new Date().toISOString();
}

/** Minutes elapsed since a given epoch timestamp. Returns Infinity if ts is 0. */
function minutesSince(epochMs: number): number {
    if (epochMs === 0) return Infinity;
    return (Date.now() - epochMs) / 60_000;
}

/** Check whether the cooldown period has elapsed for a model. */
function isCooldownExpired(model: string): boolean {
    const lastAction = lastScaleAction.get(model);
    if (!lastAction) return true;
    return (Date.now() - lastAction) >= config.cooldown_seconds * 1000;
}

/** Record a scaling action timestamp for cooldown tracking. */
function markScaleAction(model: string): void {
    lastScaleAction.set(model, Date.now());
}

/** Compute average from an array of numbers. Returns 0 for empty arrays. */
function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Get the effective min_replicas for a model (per-model override or global). */
function effectiveMinReplicas(model: string): number {
    const override = modelOverrides.get(model);
    return override !== undefined ? override.min_replicas : config.min_replicas;
}

/**
 * Find the best available node to deploy a model onto.
 *
 * Selects from online nodes that do NOT already have the model loaded,
 * sorted by free VRAM descending (most headroom first).
 */
function findBestNodeForModel(
    model: string,
    existingNodeIds: string[],
): NodeWithStats | null {
    const allNodes = getAllNodes();
    const existingSet = new Set(existingNodeIds);

    const candidates = allNodes
        .filter(n =>
            n.status === 'online' &&
            n.latest_stats &&
            n.latest_stats.gpu_count > 0 &&
            !existingSet.has(n.id) &&
            // Must not already have this model loaded
            !n.latest_stats.inference.loaded_models.includes(model),
        )
        .sort((a, b) => {
            const freeA = a.latest_stats
                ? a.latest_stats.gpus.reduce((s, g) => s + (g.vramTotalMb - g.vramUsedMb), 0)
                : 0;
            const freeB = b.latest_stats
                ? b.latest_stats.gpus.reduce((s, g) => s + (g.vramTotalMb - g.vramUsedMb), 0)
                : 0;
            return freeB - freeA;
        });

    return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Find the least-utilized node for a given model (candidate for scale-down).
 *
 * Returns the node ID with the lowest request rate / GPU utilisation among
 * nodes that have this model loaded.
 */
function findLeastUtilizedNode(
    _model: string,
    nodeIds: string[],
): string | null {
    if (nodeIds.length === 0) return null;

    const allNodes = getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    let bestId: string | null = null;
    let lowestUtil = Infinity;

    for (const id of nodeIds) {
        const node = nodeMap.get(id);
        if (!node || !node.latest_stats) {
            // Node without stats is the least utilized by definition
            return id;
        }

        // Score by average GPU utilization + in-flight request count
        const gpuUtil = node.latest_stats.gpus.length > 0
            ? node.latest_stats.gpus.reduce((s, g) => s + g.utilizationPct, 0)
              / node.latest_stats.gpus.length
            : 0;
        const inFlight = node.latest_stats.inference.in_flight_requests;
        const score = gpuUtil + inFlight * 10;

        if (score < lowestUtil) {
            lowestUtil = score;
            bestId = id;
        }
    }

    return bestId;
}

/** Push a scale event to history, trimming if needed. */
function recordScaleEvent(event: ScaleEvent): void {
    scaleHistory.push(event);
    if (scaleHistory.length > MAX_SCALE_HISTORY) {
        scaleHistory.splice(0, scaleHistory.length - MAX_SCALE_HISTORY);
    }
}

// =============================================================================
// initAutoscaler — Start the autoscaler loop
// =============================================================================

/**
 * Initialise and start the autoscaler.
 *
 * If already running, the existing loop is stopped and replaced with the
 * new configuration.
 *
 * @param overrides  Partial config overrides.  Unspecified fields retain their
 *                   current values (or defaults on first call).
 */
export function initAutoscaler(overrides?: Partial<AutoscaleConfig>): void {
    // Stop existing loop if running
    if (loopTimer !== null) {
        clearInterval(loopTimer);
        loopTimer = null;
    }

    // Apply config overrides
    if (overrides) {
        config = { ...config, ...overrides };
    }
    config.enabled = true;

    // Start the evaluation loop
    loopTimer = setInterval(() => {
        if (!config.enabled) return;
        const actions = evaluateScaling();
        for (const action of actions) {
            executeScaleAction(action);
        }
    }, config.check_interval_ms);

    // Run an immediate evaluation
    const immediateActions = evaluateScaling();
    for (const action of immediateActions) {
        executeScaleAction(action);
    }
}

// =============================================================================
// stopAutoscaler — Stop the loop
// =============================================================================

/**
 * Stop the autoscaler loop.  Does not modify configuration or state — calling
 * `initAutoscaler()` again will resume with the current config.
 */
export function stopAutoscaler(): void {
    config.enabled = false;
    if (loopTimer !== null) {
        clearInterval(loopTimer);
        loopTimer = null;
    }
}

// =============================================================================
// getAutoscaleConfig — Return current config
// =============================================================================

/**
 * Return a copy of the current autoscale configuration.
 */
export function getAutoscaleConfig(): AutoscaleConfig {
    return { ...config };
}

// =============================================================================
// updateAutoscaleConfig — Update config at runtime
// =============================================================================

/**
 * Update the autoscaler configuration at runtime.
 *
 * If the `check_interval_ms` changes and the autoscaler is running, the loop
 * is restarted with the new interval.
 *
 * @returns The updated configuration.
 */
export function updateAutoscaleConfig(
    updates: Partial<AutoscaleConfig>,
): AutoscaleConfig {
    const previousInterval = config.check_interval_ms;
    config = { ...config, ...updates };

    // If the check interval changed and we are running, restart the loop
    if (
        config.enabled &&
        loopTimer !== null &&
        updates.check_interval_ms !== undefined &&
        updates.check_interval_ms !== previousInterval
    ) {
        clearInterval(loopTimer);
        loopTimer = setInterval(() => {
            if (!config.enabled) return;
            const actions = evaluateScaling();
            for (const action of actions) {
                executeScaleAction(action);
            }
        }, config.check_interval_ms);
    }

    return { ...config };
}

// =============================================================================
// evaluateScaling — Core scaling logic
// =============================================================================

/**
 * Evaluate the current cluster state and determine which scaling actions
 * should be taken.
 *
 * For each loaded model:
 *   - Queue depth > threshold  → scale up  (add a replica on another node)
 *   - No requests for idle_minutes  → scale down (remove one replica)
 *   - No requests for scale_to_zero_minutes → unload entirely
 *
 * Respects:
 *   - Per-model and global min/max replicas
 *   - Cooldown period between scaling actions on the same model
 *
 * @returns An array of recommended ScaleEvent actions to execute.
 */
export function evaluateScaling(): ScaleEvent[] {
    const actions: ScaleEvent[] = [];
    const clusterModels = getClusterModels();

    for (const { model, node_count: currentReplicas, nodes: nodeIds } of clusterModels) {
        const tracker = getTracker(model);
        const idleMins = minutesSince(tracker.last_request_at);
        const minReplicas = effectiveMinReplicas(model);

        // Respect cooldown
        if (!isCooldownExpired(model)) continue;

        // --- Scale-to-zero check ---
        if (
            minReplicas === 0 &&
            idleMins >= config.scale_to_zero_minutes &&
            currentReplicas > 0
        ) {
            actions.push({
                model,
                action: 'unload',
                from_replicas: currentReplicas,
                to_replicas: 0,
                reason: `No requests for ${Math.floor(idleMins)} minutes (threshold: ${config.scale_to_zero_minutes}m). Unloading to free VRAM.`,
                timestamp: nowISO(),
            });
            continue; // No further actions needed for this model
        }

        // --- Scale-down check ---
        if (
            idleMins >= config.scale_down_idle_minutes &&
            currentReplicas > minReplicas &&
            currentReplicas > 1
        ) {
            const targetReplicas = Math.max(minReplicas, currentReplicas - 1);
            if (targetReplicas < currentReplicas) {
                actions.push({
                    model,
                    action: 'scale_down',
                    from_replicas: currentReplicas,
                    to_replicas: targetReplicas,
                    reason: `No requests for ${Math.floor(idleMins)} minutes (threshold: ${config.scale_down_idle_minutes}m). Removing one replica.`,
                    timestamp: nowISO(),
                });
                continue; // Only one action per model per evaluation cycle
            }
        }

        // --- Scale-up check ---
        if (
            tracker.queue_depth >= config.scale_up_threshold &&
            currentReplicas < config.max_replicas
        ) {
            const targetReplicas = Math.min(config.max_replicas, currentReplicas + 1);
            if (targetReplicas > currentReplicas) {
                // Verify there is a node available to accept the model
                const candidateNode = findBestNodeForModel(model, nodeIds);
                if (candidateNode) {
                    actions.push({
                        model,
                        action: 'scale_up',
                        from_replicas: currentReplicas,
                        to_replicas: targetReplicas,
                        reason: `Queue depth ${tracker.queue_depth} exceeds threshold ${config.scale_up_threshold}. Adding replica on ${candidateNode.hostname}.`,
                        timestamp: nowISO(),
                    });
                }
            }
        }
    }

    return actions;
}

// =============================================================================
// executeScaleAction — Execute a scaling decision
// =============================================================================

/**
 * Execute a single scaling action by issuing commands to the appropriate
 * nodes via `queueCommand`.
 *
 * Actions:
 *   - **scale_up**:   Deploy the model to the best available node.
 *   - **scale_down**: Remove the model from the least-utilised replica node.
 *   - **unload**:     Remove the model from all nodes (scale-to-zero).
 *   - **cold_start**: Re-load a previously unloaded model on the best node.
 */
export function executeScaleAction(action: ScaleEvent): void {
    markScaleAction(action.model);

    switch (action.action) {
        case 'scale_up': {
            const clusterModels = getClusterModels();
            const entry = clusterModels.find(m => m.model === action.model);
            const existingNodes = entry ? entry.nodes : [];
            const targetNode = findBestNodeForModel(action.model, existingNodes);

            if (targetNode) {
                queueCommand(targetNode.id, 'install_model', {
                    model: action.model,
                });
            }
            break;
        }

        case 'scale_down': {
            const clusterModels = getClusterModels();
            const entry = clusterModels.find(m => m.model === action.model);
            if (entry && entry.nodes.length > 0) {
                const victimId = findLeastUtilizedNode(
                    action.model,
                    entry.nodes,
                );
                if (victimId) {
                    queueCommand(victimId, 'remove_model', {
                        model: action.model,
                    });
                }
            }
            break;
        }

        case 'unload': {
            const clusterModels = getClusterModels();
            const entry = clusterModels.find(m => m.model === action.model);
            if (entry) {
                for (const nodeId of entry.nodes) {
                    queueCommand(nodeId, 'remove_model', {
                        model: action.model,
                    });
                }
            }
            // Track that this model was unloaded for cold-start detection
            unloadedModels.add(action.model);
            break;
        }

        case 'cold_start': {
            const coldStartBegin = Date.now();
            const targetNode = findBestNodeForModel(action.model, []);

            if (targetNode) {
                queueCommand(targetNode.id, 'install_model', {
                    model: action.model,
                });
                action.latency_ms = Date.now() - coldStartBegin;
            }
            // Model is no longer in the unloaded set
            unloadedModels.delete(action.model);
            break;
        }
    }

    // Record the event in history
    recordScaleEvent(action);
}

// =============================================================================
// getScaleHistory — Return recent scaling events
// =============================================================================

/**
 * Return recent scaling events, newest first.
 *
 * @param limit  Maximum number of events to return (default: 50).
 */
export function getScaleHistory(limit: number = 50): ScaleEvent[] {
    const clamped = Math.max(1, Math.min(limit, scaleHistory.length));
    return scaleHistory.slice(-clamped).reverse();
}

// =============================================================================
// getModelScaleStates — Scaling state for all models
// =============================================================================

/**
 * Return the current scaling state for every model the autoscaler knows about.
 *
 * This includes:
 *   - Currently loaded models (from the cluster)
 *   - Previously unloaded models that still have tracking data
 */
export function getModelScaleStates(): ModelScaleState[] {
    const clusterModels = getClusterModels();
    const clusterMap = new Map(
        clusterModels.map(m => [m.model, m]),
    );

    // Gather the set of all model names we track
    const allModels = new Set<string>();
    for (const m of clusterModels) allModels.add(m.model);
    for (const m of modelTrackers.keys()) allModels.add(m);
    for (const m of unloadedModels) allModels.add(m);

    const states: ModelScaleState[] = [];

    for (const model of allModels) {
        const tracker = getTracker(model);
        const cluster = clusterMap.get(model);
        const currentReplicas = cluster ? cluster.node_count : 0;
        const idleMins = minutesSince(tracker.last_request_at);
        const minReplicas = effectiveMinReplicas(model);

        // Determine desired replicas based on current demand
        let desiredReplicas = currentReplicas;
        if (tracker.queue_depth >= config.scale_up_threshold && currentReplicas < config.max_replicas) {
            desiredReplicas = Math.min(config.max_replicas, currentReplicas + 1);
        } else if (idleMins >= config.scale_to_zero_minutes && minReplicas === 0) {
            desiredReplicas = 0;
        } else if (idleMins >= config.scale_down_idle_minutes && currentReplicas > minReplicas) {
            desiredReplicas = Math.max(minReplicas, currentReplicas - 1);
        }

        // Filter scale events for this model
        const modelEvents = scaleHistory.filter(e => e.model === model);

        states.push({
            model,
            current_replicas: currentReplicas,
            desired_replicas: desiredReplicas,
            last_request_at: tracker.last_request_at > 0
                ? new Date(tracker.last_request_at).toISOString()
                : null,
            idle_minutes: idleMins === Infinity ? -1 : Math.floor(idleMins),
            queue_depth: tracker.queue_depth,
            avg_latency_ms: Math.round(avg(tracker.latency_samples) * 100) / 100,
            scale_events: modelEvents,
        });
    }

    return states;
}

// =============================================================================
// setModelMinReplicas — Per-model minimum replicas
// =============================================================================

/**
 * Set the minimum replica count for a specific model.
 *
 * Setting `min` to 0 allows scale-to-zero for this model (if enabled globally).
 * Setting `min` >= 1 prevents the model from being unloaded.
 *
 * Passing `undefined` or `null` removes the per-model override, falling back
 * to the global `min_replicas` setting.
 *
 * @param model  The model name (e.g. 'llama3.1:8b').
 * @param min    Minimum replicas, or null to clear the override.
 */
export function setModelMinReplicas(
    model: string,
    min: number | null,
): void {
    if (min === null || min === undefined) {
        modelOverrides.delete(model);
    } else {
        modelOverrides.set(model, { min_replicas: Math.max(0, Math.floor(min)) });
    }
}

// =============================================================================
// recordRequest — Track request timing for scaling decisions
// =============================================================================

/**
 * Record an incoming inference request for a model.
 *
 * This updates the model's request tracker with the current timestamp so the
 * autoscaler can calculate idle time, request rate, and queue depth.
 *
 * Should be called from the inference proxy / routing layer every time a
 * request is received for a model.
 *
 * If the model was previously unloaded (scale-to-zero), this automatically
 * triggers a cold-start event to reload it.
 *
 * @param model      The model name (e.g. 'llama3.1:8b').
 * @param latencyMs  Optional latency of the request in ms (for tracking).
 */
export function recordRequest(model: string, latencyMs?: number): void {
    const now = Date.now();
    const tracker = getTracker(model);

    // Update last request time
    tracker.last_request_at = now;

    // Add to request timestamps (for rate calculation)
    tracker.request_timestamps.push(now);
    if (tracker.request_timestamps.length > MAX_REQUEST_TIMESTAMPS) {
        tracker.request_timestamps.splice(
            0,
            tracker.request_timestamps.length - MAX_REQUEST_TIMESTAMPS,
        );
    }

    // Prune timestamps outside the rate window
    const windowStart = now - RATE_WINDOW_MS;
    while (
        tracker.request_timestamps.length > 0 &&
        tracker.request_timestamps[0] < windowStart
    ) {
        tracker.request_timestamps.shift();
    }

    // Update queue depth estimate: requests in the last second
    const oneSecAgo = now - 1000;
    tracker.queue_depth = tracker.request_timestamps.filter(
        t => t >= oneSecAgo,
    ).length;

    // Track latency if provided
    if (latencyMs !== undefined) {
        tracker.latency_samples.push(latencyMs);
        if (tracker.latency_samples.length > MAX_LATENCY_SAMPLES) {
            tracker.latency_samples.splice(
                0,
                tracker.latency_samples.length - MAX_LATENCY_SAMPLES,
            );
        }
    }

    // Cold-start: if the model was previously unloaded, trigger a reload
    if (unloadedModels.has(model)) {
        const coldStartEvent: ScaleEvent = {
            model,
            action: 'cold_start',
            from_replicas: 0,
            to_replicas: 1,
            reason: `Request received for unloaded model. Triggering cold start.`,
            timestamp: nowISO(),
        };
        executeScaleAction(coldStartEvent);
    }
}
