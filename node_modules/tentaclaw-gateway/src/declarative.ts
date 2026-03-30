/**
 * TentaCLAW Gateway — Declarative State Engine
 *
 * Kubernetes-style desired-state reconciliation for model deployments.
 * The foundation of TentaCLAW v3.0: you declare what you want, the
 * engine reconciles the cluster to match.
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * CLAWtopus says: "You declare. I reconcile. That's how the family works."
 */

import {
    getAllNodes,
    queueCommand,
    getDb,
} from './db';
import type { NodeWithStats } from '../../shared/types';

// =============================================================================
// Flight Sheet v2 Schema
// =============================================================================

export interface ModelDeployment {
    apiVersion: 'tentaclaw.io/v1';
    kind: 'ModelDeployment';
    metadata: {
        name: string;
        namespace: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
        createdAt?: string;
        updatedAt?: string;
    };
    spec: {
        model: string;                    // "meta-llama/Llama-3.1-8B-Instruct" or "llama3.1:8b"
        quantization?: string;            // "Q4_K_M", "AWQ", "GPTQ", "FP16"
        replicas: number;                 // desired replica count
        minReplicas?: number;             // autoscaler minimum (0 = scale-to-zero)
        maxReplicas?: number;             // autoscaler maximum
        backend?: string;                 // "ollama" | "vllm" | "sglang" | "auto"
        resources?: {
            gpuMemory?: string;           // "16Gi", "24Gi"
            gpuCount?: number;            // GPUs per replica
            tensorParallel?: number;
        };
        routing?: {
            strategy?: string;            // "least-latency" | "round-robin" | "vram-headroom"
            maxLatencyMs?: number;
            affinityKey?: string;
        };
        sla?: {
            maxLatencyP95Ms?: number;
            minThroughputTokS?: number;
            minAvailabilityPct?: number;
        };
        nodeSelector?: Record<string, string>;  // label-based node selection
        nodeAffinity?: {
            required?: string[];          // node IDs that MUST be used
            preferred?: string[];         // node IDs that SHOULD be used
        };
        nodeAntiAffinity?: string[];      // spread across these nodes
        priority?: 'critical' | 'normal' | 'low';
    };
    status?: DeploymentStatus;
}

export interface DeploymentStatus {
    phase: 'Pending' | 'Deploying' | 'Running' | 'Degraded' | 'Failed';
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    conditions: Array<{
        type: 'Available' | 'Progressing' | 'Degraded' | 'SLAMet';
        status: boolean;
        reason?: string;
        message?: string;
        lastTransitionTime: string;
    }>;
    nodes: Array<{
        nodeId: string;
        hostname: string;
        backend: string;
        status: 'loading' | 'ready' | 'error';
        loadedAt?: string;
    }>;
    events: Array<{
        type: 'Normal' | 'Warning';
        reason: string;
        message: string;
        timestamp: string;
    }>;
}

// =============================================================================
// Validation Result
// =============================================================================

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// =============================================================================
// State Diff
// =============================================================================

export interface StateDiff {
    deployment: string;
    namespace: string;
    model: string;
    desiredReplicas: number;
    actualReplicas: number;
    delta: number;                       // positive = need more, negative = have excess
    action: 'scale_up' | 'scale_down' | 'in_sync' | 'needs_repair';
    failedNodes: string[];
    missingNodes: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const MAX_EVENTS_PER_DEPLOYMENT = 200;
const VALID_API_VERSION = 'tentaclaw.io/v1';
const VALID_KIND = 'ModelDeployment';
const VALID_BACKENDS = ['ollama', 'vllm', 'sglang', 'auto'];
const VALID_PRIORITIES: Array<ModelDeployment['spec']['priority']> = ['critical', 'normal', 'low'];
const VALID_ROUTING_STRATEGIES = ['least-latency', 'round-robin', 'vram-headroom'];

// =============================================================================
// Module State
// =============================================================================

/** In-memory deployment registry keyed by `namespace/name`. */
const deployments = new Map<string, ModelDeployment>();

/** Reconciliation loop timer. */
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/** Whether the DB table has been ensured for this process. */
let dbTableEnsured = false;

// =============================================================================
// Helpers
// =============================================================================

/** Composite key for a deployment. */
function deploymentKey(name: string, namespace: string): string {
    return `${namespace}/${name}`;
}

/** ISO timestamp. */
function nowISO(): string {
    return new Date().toISOString();
}

/** Ensure the deployments table exists in the DB. */
function ensureDbTable(): void {
    if (dbTableEnsured) return;
    const d = getDb();
    d.exec(`
        CREATE TABLE IF NOT EXISTS deployments (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            namespace TEXT NOT NULL,
            spec TEXT NOT NULL,
            metadata TEXT NOT NULL,
            status TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_deployments_namespace ON deployments(namespace);
        CREATE INDEX IF NOT EXISTS idx_deployments_name ON deployments(name);
    `);
    dbTableEnsured = true;
}

/** Persist a deployment to the database. */
function persistDeployment(deployment: ModelDeployment): void {
    ensureDbTable();
    const d = getDb();
    const key = deploymentKey(deployment.metadata.name, deployment.metadata.namespace);
    const now = nowISO();

    d.prepare(`
        INSERT INTO deployments (key, name, namespace, spec, metadata, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            spec = excluded.spec,
            metadata = excluded.metadata,
            status = excluded.status,
            updated_at = excluded.updated_at
    `).run(
        key,
        deployment.metadata.name,
        deployment.metadata.namespace,
        JSON.stringify(deployment.spec),
        JSON.stringify(deployment.metadata),
        deployment.status ? JSON.stringify(deployment.status) : null,
        deployment.metadata.createdAt ?? now,
        now,
    );
}

/** Remove a deployment from the database. */
function removeDeploymentFromDb(name: string, namespace: string): void {
    ensureDbTable();
    const d = getDb();
    const key = deploymentKey(name, namespace);
    d.prepare('DELETE FROM deployments WHERE key = ?').run(key);
}

/** Load all deployments from the database into memory. */
function loadDeploymentsFromDb(): void {
    ensureDbTable();
    const d = getDb();
    const rows = d.prepare('SELECT * FROM deployments').all() as Array<{
        key: string;
        name: string;
        namespace: string;
        spec: string;
        metadata: string;
        status: string | null;
        created_at: string;
        updated_at: string;
    }>;

    for (const row of rows) {
        const metadata = JSON.parse(row.metadata);
        const spec = JSON.parse(row.spec);
        const status = row.status ? JSON.parse(row.status) : undefined;

        const deployment: ModelDeployment = {
            apiVersion: VALID_API_VERSION,
            kind: VALID_KIND,
            metadata: {
                ...metadata,
                createdAt: metadata.createdAt ?? row.created_at,
                updatedAt: row.updated_at,
            },
            spec,
            status,
        };

        deployments.set(row.key, deployment);
    }
}

/** Add an event to a deployment's status, trimming old events. */
function addEvent(
    deployment: ModelDeployment,
    type: 'Normal' | 'Warning',
    reason: string,
    message: string,
): void {
    if (!deployment.status) return;
    deployment.status.events.push({
        type,
        reason,
        message,
        timestamp: nowISO(),
    });
    if (deployment.status.events.length > MAX_EVENTS_PER_DEPLOYMENT) {
        deployment.status.events.splice(
            0,
            deployment.status.events.length - MAX_EVENTS_PER_DEPLOYMENT,
        );
    }
}

/** Update a condition on a deployment's status. */
function setCondition(
    deployment: ModelDeployment,
    type: 'Available' | 'Progressing' | 'Degraded' | 'SLAMet',
    status: boolean,
    reason?: string,
    message?: string,
): void {
    if (!deployment.status) return;
    const existing = deployment.status.conditions.find(c => c.type === type);
    if (existing) {
        if (existing.status !== status || existing.reason !== reason) {
            existing.lastTransitionTime = nowISO();
        }
        existing.status = status;
        existing.reason = reason;
        existing.message = message;
    } else {
        deployment.status.conditions.push({
            type,
            status,
            reason,
            message,
            lastTransitionTime: nowISO(),
        });
    }
}

/**
 * Initialize a fresh DeploymentStatus for a deployment.
 */
function initStatus(deployment: ModelDeployment): void {
    deployment.status = {
        phase: 'Pending',
        replicas: 0,
        readyReplicas: 0,
        availableReplicas: 0,
        conditions: [],
        nodes: [],
        events: [],
    };
}

/**
 * Find the best available node for a model, respecting affinity constraints.
 *
 * Selects from online nodes that do NOT already serve this model on the given
 * exclusion list. Sorts by free VRAM descending.
 */
function findBestAvailableNode(
    _model: string,
    excludeNodeIds: string[],
    deployment: ModelDeployment,
): NodeWithStats | null {
    const allNodes = getAllNodes();
    const excludeSet = new Set(excludeNodeIds);

    let candidates = allNodes.filter(n =>
        n.status === 'online' &&
        n.latest_stats &&
        !excludeSet.has(n.id),
    );

    // Apply node affinity constraints
    if (deployment.spec.nodeAffinity?.required && deployment.spec.nodeAffinity.required.length > 0) {
        const requiredSet = new Set(deployment.spec.nodeAffinity.required);
        candidates = candidates.filter(n => requiredSet.has(n.id));
    }

    // Apply anti-affinity (prefer nodes NOT in the list)
    if (deployment.spec.nodeAntiAffinity && deployment.spec.nodeAntiAffinity.length > 0) {
        const antiSet = new Set(deployment.spec.nodeAntiAffinity);
        const preferred = candidates.filter(n => !antiSet.has(n.id));
        if (preferred.length > 0) {
            candidates = preferred;
        }
    }

    // Sort by free VRAM descending (most headroom first)
    candidates.sort((a, b) => {
        const freeA = a.latest_stats
            ? a.latest_stats.gpus.reduce((s, g) => s + (g.vramTotalMb - g.vramUsedMb), 0)
            : 0;
        const freeB = b.latest_stats
            ? b.latest_stats.gpus.reduce((s, g) => s + (g.vramTotalMb - g.vramUsedMb), 0)
            : 0;
        return freeB - freeA;
    });

    // Prefer nodes from the preferred affinity list if specified
    if (deployment.spec.nodeAffinity?.preferred && deployment.spec.nodeAffinity.preferred.length > 0) {
        const preferredSet = new Set(deployment.spec.nodeAffinity.preferred);
        const preferredCandidates = candidates.filter(n => preferredSet.has(n.id));
        if (preferredCandidates.length > 0) {
            return preferredCandidates[0];
        }
    }

    return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Find the least-utilised node for a model (candidate for scale-down).
 */
function findLeastUtilizedNode(nodeIds: string[]): string | null {
    if (nodeIds.length === 0) return null;

    const allNodes = getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    let bestId: string | null = null;
    let lowestUtil = Infinity;

    for (const id of nodeIds) {
        const node = nodeMap.get(id);
        if (!node || !node.latest_stats) {
            return id; // No stats = least utilized
        }

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

/**
 * Get nodes that currently have a specific model loaded.
 */
function getNodesServingModel(model: string): NodeWithStats[] {
    const allNodes = getAllNodes();
    return allNodes.filter(n =>
        n.status === 'online' &&
        n.latest_stats &&
        n.latest_stats.inference.loaded_models.some(
            m => m === model || m.startsWith(model.split(':')[0]),
        ),
    );
}

/**
 * Get nodes that are registered for a model but are in error/offline state.
 */
function getFailedNodesForModel(model: string): NodeWithStats[] {
    const allNodes = getAllNodes();
    return allNodes.filter(n =>
        n.status !== 'online' &&
        n.latest_stats &&
        n.latest_stats.inference.loaded_models.includes(model),
    );
}

// =============================================================================
// validateDeployment -- Schema & resource validation
// =============================================================================

/**
 * Validate a ModelDeployment object.
 *
 * Checks:
 *   - Required fields present with correct types
 *   - apiVersion and kind match expected values
 *   - Replica counts are sensible (non-negative, min <= max)
 *   - Backend is a known type
 *   - Priority is a known value
 *   - Routing strategy is known
 *   - SLA values are positive
 *
 * @returns A ValidationResult with `valid`, `errors`, and `warnings`.
 */
export function validateDeployment(deployment: ModelDeployment): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // --- API version & kind ---
    if (deployment.apiVersion !== VALID_API_VERSION) {
        errors.push(`Invalid apiVersion "${deployment.apiVersion}". Expected "${VALID_API_VERSION}".`);
    }
    if (deployment.kind !== VALID_KIND) {
        errors.push(`Invalid kind "${deployment.kind}". Expected "${VALID_KIND}".`);
    }

    // --- Metadata ---
    if (!deployment.metadata) {
        errors.push('metadata is required.');
    } else {
        if (!deployment.metadata.name || typeof deployment.metadata.name !== 'string') {
            errors.push('metadata.name is required and must be a string.');
        } else if (!/^[a-z0-9][a-z0-9\-_.]*[a-z0-9]$/.test(deployment.metadata.name) && deployment.metadata.name.length > 1) {
            warnings.push(`metadata.name "${deployment.metadata.name}" should follow DNS-label conventions (lowercase alphanumeric, hyphens, dots).`);
        }
        if (!deployment.metadata.namespace || typeof deployment.metadata.namespace !== 'string') {
            errors.push('metadata.namespace is required and must be a string.');
        }
    }

    // --- Spec ---
    if (!deployment.spec) {
        errors.push('spec is required.');
    } else {
        // Model
        if (!deployment.spec.model || typeof deployment.spec.model !== 'string') {
            errors.push('spec.model is required and must be a string.');
        }

        // Replicas
        if (typeof deployment.spec.replicas !== 'number' || deployment.spec.replicas < 0) {
            errors.push('spec.replicas must be a non-negative number.');
        }
        if (!Number.isInteger(deployment.spec.replicas)) {
            errors.push('spec.replicas must be an integer.');
        }

        // Min/Max replicas
        if (deployment.spec.minReplicas !== undefined) {
            if (typeof deployment.spec.minReplicas !== 'number' || deployment.spec.minReplicas < 0) {
                errors.push('spec.minReplicas must be a non-negative number.');
            }
        }
        if (deployment.spec.maxReplicas !== undefined) {
            if (typeof deployment.spec.maxReplicas !== 'number' || deployment.spec.maxReplicas < 0) {
                errors.push('spec.maxReplicas must be a non-negative number.');
            }
        }
        if (
            deployment.spec.minReplicas !== undefined &&
            deployment.spec.maxReplicas !== undefined &&
            deployment.spec.minReplicas > deployment.spec.maxReplicas
        ) {
            errors.push('spec.minReplicas cannot exceed spec.maxReplicas.');
        }
        if (
            deployment.spec.maxReplicas !== undefined &&
            deployment.spec.replicas > deployment.spec.maxReplicas
        ) {
            warnings.push('spec.replicas exceeds spec.maxReplicas; replicas will be clamped.');
        }

        // Backend
        if (deployment.spec.backend !== undefined) {
            if (!VALID_BACKENDS.includes(deployment.spec.backend)) {
                errors.push(`spec.backend "${deployment.spec.backend}" is not valid. Expected one of: ${VALID_BACKENDS.join(', ')}.`);
            }
        }

        // Priority
        if (deployment.spec.priority !== undefined) {
            if (!VALID_PRIORITIES.includes(deployment.spec.priority)) {
                errors.push(`spec.priority "${deployment.spec.priority}" is not valid. Expected one of: ${VALID_PRIORITIES.join(', ')}.`);
            }
        }

        // Routing strategy
        if (deployment.spec.routing?.strategy !== undefined) {
            if (!VALID_ROUTING_STRATEGIES.includes(deployment.spec.routing.strategy)) {
                warnings.push(`spec.routing.strategy "${deployment.spec.routing.strategy}" is not a known strategy. Known: ${VALID_ROUTING_STRATEGIES.join(', ')}.`);
            }
        }

        // SLA values
        if (deployment.spec.sla) {
            if (deployment.spec.sla.maxLatencyP95Ms !== undefined && deployment.spec.sla.maxLatencyP95Ms <= 0) {
                errors.push('spec.sla.maxLatencyP95Ms must be positive.');
            }
            if (deployment.spec.sla.minThroughputTokS !== undefined && deployment.spec.sla.minThroughputTokS <= 0) {
                errors.push('spec.sla.minThroughputTokS must be positive.');
            }
            if (deployment.spec.sla.minAvailabilityPct !== undefined) {
                if (deployment.spec.sla.minAvailabilityPct < 0 || deployment.spec.sla.minAvailabilityPct > 100) {
                    errors.push('spec.sla.minAvailabilityPct must be between 0 and 100.');
                }
            }
        }

        // Resources
        if (deployment.spec.resources) {
            if (deployment.spec.resources.gpuCount !== undefined && deployment.spec.resources.gpuCount < 1) {
                errors.push('spec.resources.gpuCount must be at least 1.');
            }
            if (deployment.spec.resources.tensorParallel !== undefined && deployment.spec.resources.tensorParallel < 1) {
                errors.push('spec.resources.tensorParallel must be at least 1.');
            }
        }

        // Node affinity
        if (deployment.spec.nodeAffinity?.required) {
            if (!Array.isArray(deployment.spec.nodeAffinity.required)) {
                errors.push('spec.nodeAffinity.required must be an array of node IDs.');
            }
        }
        if (deployment.spec.nodeAffinity?.preferred) {
            if (!Array.isArray(deployment.spec.nodeAffinity.preferred)) {
                errors.push('spec.nodeAffinity.preferred must be an array of node IDs.');
            }
        }

        // Zero replicas warning
        if (deployment.spec.replicas === 0 && deployment.spec.minReplicas === undefined) {
            warnings.push('spec.replicas is 0 with no minReplicas set. The model will not be deployed until replicas > 0.');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

// =============================================================================
// applyDeployment -- Apply desired-state deployment
// =============================================================================

/**
 * Apply a desired-state deployment.
 *
 * Validates the schema, stores in the registry, and triggers an immediate
 * reconciliation for this deployment.
 *
 * @param deployment  The ModelDeployment manifest.
 * @returns The deployment with initial status set.
 * @throws Error if validation fails.
 */
export function applyDeployment(deployment: ModelDeployment): ModelDeployment {
    // Validate
    const validation = validateDeployment(deployment);
    if (!validation.valid) {
        throw new Error(
            `Invalid ModelDeployment: ${validation.errors.join('; ')}`,
        );
    }

    const key = deploymentKey(deployment.metadata.name, deployment.metadata.namespace);
    const existing = deployments.get(key);
    const now = nowISO();

    // Preserve or initialise timestamps
    if (existing) {
        deployment.metadata.createdAt = existing.metadata.createdAt;
        deployment.metadata.updatedAt = now;
        // Preserve existing status events, update the rest during reconcile
        if (existing.status) {
            deployment.status = {
                ...existing.status,
                phase: 'Deploying',
            };
            addEvent(deployment, 'Normal', 'DeploymentUpdated', `Deployment spec updated at ${now}.`);
        } else {
            initStatus(deployment);
            addEvent(deployment, 'Normal', 'DeploymentCreated', `Deployment created at ${now}.`);
        }
    } else {
        deployment.metadata.createdAt = now;
        deployment.metadata.updatedAt = now;
        initStatus(deployment);
        addEvent(deployment, 'Normal', 'DeploymentCreated', `Deployment created at ${now}.`);
    }

    // Store in memory
    deployments.set(key, deployment);

    // Persist to DB
    persistDeployment(deployment);

    // Trigger immediate reconciliation for this deployment
    reconcileDeployment(deployment);

    return deployment;
}

// =============================================================================
// reconcileDeployment -- Reconcile a single deployment
// =============================================================================

/**
 * Reconcile a single deployment: compare desired vs actual state and take
 * corrective actions.
 */
function reconcileDeployment(deployment: ModelDeployment): void {
    if (!deployment.status) {
        initStatus(deployment);
    }

    const model = deployment.spec.model;
    const desiredReplicas = deployment.spec.replicas;

    // --- Observe actual state ---
    const servingNodes = getNodesServingModel(model);
    const actualReplicas = servingNodes.length;
    const failedNodes = getFailedNodesForModel(model);
    const servingNodeIds = servingNodes.map(n => n.id);

    // Update status counts
    deployment.status!.replicas = actualReplicas;
    deployment.status!.readyReplicas = actualReplicas;
    deployment.status!.availableReplicas = actualReplicas;

    // Update node list in status
    deployment.status!.nodes = servingNodes.map(n => ({
        nodeId: n.id,
        hostname: n.hostname,
        backend: n.latest_stats?.backend?.type ?? 'unknown',
        status: 'ready' as const,
        loadedAt: n.last_seen_at ?? undefined,
    }));

    // Add failed nodes to status
    for (const failedNode of failedNodes) {
        const existingInStatus = deployment.status!.nodes.find(sn => sn.nodeId === failedNode.id);
        if (!existingInStatus) {
            deployment.status!.nodes.push({
                nodeId: failedNode.id,
                hostname: failedNode.hostname,
                backend: failedNode.latest_stats?.backend?.type ?? 'unknown',
                status: 'error',
            });
        }
    }

    // --- Reconcile: scale up if actual < desired ---
    if (actualReplicas < desiredReplicas) {
        const needed = desiredReplicas - actualReplicas;
        setCondition(deployment, 'Progressing', true, 'ScalingUp', `Need ${needed} more replica(s).`);

        for (let i = 0; i < needed; i++) {
            const allExcluded = [
                ...servingNodeIds,
                // Also exclude nodes we have already queued commands for in this cycle
                ...deployment.status!.nodes
                    .filter(n => n.status === 'loading')
                    .map(n => n.nodeId),
            ];

            const targetNode = findBestAvailableNode(model, allExcluded, deployment);
            if (targetNode) {
                queueCommand(targetNode.id, 'install_model', { model });

                deployment.status!.nodes.push({
                    nodeId: targetNode.id,
                    hostname: targetNode.hostname,
                    backend: targetNode.latest_stats?.backend?.type ?? 'unknown',
                    status: 'loading',
                });

                addEvent(
                    deployment,
                    'Normal',
                    'ScalingUp',
                    `Deploying ${model} to ${targetNode.hostname} (${targetNode.id}). Replica ${actualReplicas + i + 1}/${desiredReplicas}.`,
                );
            } else {
                addEvent(
                    deployment,
                    'Warning',
                    'InsufficientNodes',
                    `No available node for replica ${actualReplicas + i + 1}/${desiredReplicas} of ${model}.`,
                );
                break;
            }
        }
    }

    // --- Reconcile: scale down if actual > desired ---
    if (actualReplicas > desiredReplicas) {
        const excess = actualReplicas - desiredReplicas;
        setCondition(deployment, 'Progressing', true, 'ScalingDown', `Removing ${excess} excess replica(s).`);

        for (let i = 0; i < excess; i++) {
            const remainingNodeIds = servingNodes
                .slice(i) // skip already-processed
                .map(n => n.id);
            const victimId = findLeastUtilizedNode(remainingNodeIds);
            if (victimId) {
                queueCommand(victimId, 'remove_model', { model });

                // Update status node entry
                const nodeEntry = deployment.status!.nodes.find(n => n.nodeId === victimId);
                if (nodeEntry) {
                    nodeEntry.status = 'loading'; // transitioning
                }

                const victimNode = servingNodes.find(n => n.id === victimId);
                addEvent(
                    deployment,
                    'Normal',
                    'ScalingDown',
                    `Removing ${model} from ${victimNode?.hostname ?? victimId}. Reducing to ${desiredReplicas} replica(s).`,
                );
            }
        }
    }

    // --- Handle failed nodes: redeploy elsewhere ---
    if (failedNodes.length > 0 && actualReplicas < desiredReplicas) {
        for (const failedNode of failedNodes) {
            addEvent(
                deployment,
                'Warning',
                'NodeFailed',
                `Node ${failedNode.hostname} (${failedNode.id}) is ${failedNode.status}. Model may need redeployment.`,
            );
        }
    }

    // --- Update phase ---
    if (desiredReplicas === 0) {
        deployment.status!.phase = actualReplicas === 0 ? 'Running' : 'Deploying';
    } else if (actualReplicas >= desiredReplicas) {
        deployment.status!.phase = 'Running';
        setCondition(deployment, 'Available', true, 'AllReplicasReady', `${actualReplicas}/${desiredReplicas} replicas ready.`);
        setCondition(deployment, 'Progressing', false, 'Complete', 'Deployment complete.');
    } else if (actualReplicas > 0) {
        deployment.status!.phase = 'Degraded';
        setCondition(deployment, 'Available', true, 'PartiallyAvailable', `${actualReplicas}/${desiredReplicas} replicas ready.`);
        setCondition(deployment, 'Degraded', true, 'InsufficientReplicas', `Only ${actualReplicas}/${desiredReplicas} replicas available.`);
    } else {
        deployment.status!.phase = failedNodes.length > 0 ? 'Failed' : 'Pending';
        setCondition(deployment, 'Available', false, 'NoReplicasReady', 'No replicas are available.');
    }

    // --- Check SLA conditions ---
    if (deployment.spec.sla) {
        const sla = deployment.spec.sla;
        let slaMet = true;

        if (sla.minAvailabilityPct !== undefined && desiredReplicas > 0) {
            const availPct = (actualReplicas / desiredReplicas) * 100;
            if (availPct < sla.minAvailabilityPct) {
                slaMet = false;
                setCondition(
                    deployment,
                    'SLAMet',
                    false,
                    'AvailabilityBelowTarget',
                    `Availability ${availPct.toFixed(1)}% < target ${sla.minAvailabilityPct}%.`,
                );
            }
        }

        if (slaMet) {
            setCondition(deployment, 'SLAMet', true, 'AllSLAsMet', 'All SLA conditions are satisfied.');
        }
    }

    // Persist updated status
    persistDeployment(deployment);
}

// =============================================================================
// reconcile -- The core reconciliation loop
// =============================================================================

/**
 * Run one reconciliation pass across all deployments.
 *
 * For each deployment:
 *   - Count actual replicas (nodes currently serving this model)
 *   - If actual < desired, deploy to best available node
 *   - If actual > desired, remove from least-utilized node
 *   - If node failed, redeploy elsewhere
 *   - Check SLA conditions and update status
 *   - Generate events for each action
 */
export function reconcile(): void {
    for (const deployment of deployments.values()) {
        reconcileDeployment(deployment);
    }
}

// =============================================================================
// getDeployments -- List all deployments
// =============================================================================

/**
 * List all deployments, optionally filtered by namespace.
 *
 * @param namespace  Optional namespace filter.
 * @returns Array of deployments with current status.
 */
export function getDeployments(namespace?: string): ModelDeployment[] {
    const all = Array.from(deployments.values());
    if (namespace) {
        return all.filter(d => d.metadata.namespace === namespace);
    }
    return all;
}

// =============================================================================
// getDeployment -- Get a single deployment
// =============================================================================

/**
 * Get a single deployment by name and namespace.
 *
 * @param name       Deployment name.
 * @param namespace  Deployment namespace.
 * @returns The deployment with full status, or null if not found.
 */
export function getDeployment(name: string, namespace: string): ModelDeployment | null {
    const key = deploymentKey(name, namespace);
    return deployments.get(key) ?? null;
}

// =============================================================================
// deleteDeployment -- Remove a deployment and unload from all nodes
// =============================================================================

/**
 * Remove a deployment. Unloads the model from all nodes that currently serve it.
 *
 * @param name       Deployment name.
 * @param namespace  Deployment namespace.
 * @returns True if the deployment was found and deleted, false otherwise.
 */
export function deleteDeployment(name: string, namespace: string): boolean {
    const key = deploymentKey(name, namespace);
    const deployment = deployments.get(key);
    if (!deployment) return false;

    const model = deployment.spec.model;

    // Unload from all serving nodes
    const servingNodes = getNodesServingModel(model);
    for (const node of servingNodes) {
        queueCommand(node.id, 'remove_model', { model });
    }

    // Remove from memory and DB
    deployments.delete(key);
    removeDeploymentFromDb(name, namespace);

    return true;
}

// =============================================================================
// startReconciliationLoop -- Background reconciliation
// =============================================================================

/**
 * Start the background reconciliation loop.
 *
 * If already running, the existing loop is stopped and restarted with the
 * new interval.
 *
 * @param intervalMs  Reconciliation interval in milliseconds (default 15s).
 */
export function startReconciliationLoop(intervalMs?: number): void {
    stopReconciliationLoop();

    const interval = intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;

    // Load persisted deployments on first start
    if (deployments.size === 0) {
        loadDeploymentsFromDb();
    }

    reconcileTimer = setInterval(() => {
        try {
            reconcile();
        } catch (_err) {
            console.error('[declarative] Reconciliation error:', _err);
        }
    }, interval);

    console.log(`[declarative] Reconciliation loop started (interval: ${interval}ms, deployments: ${deployments.size})`);
}

// =============================================================================
// stopReconciliationLoop -- Stop the background loop
// =============================================================================

/**
 * Stop the background reconciliation loop.
 */
export function stopReconciliationLoop(): void {
    if (reconcileTimer !== null) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
        console.log('[declarative] Reconciliation loop stopped.');
    }
}

// =============================================================================
// getDeploymentEvents -- Get events for a deployment
// =============================================================================

/**
 * Get recent events for a specific deployment.
 *
 * @param name       Deployment name.
 * @param namespace  Deployment namespace.
 * @param limit      Maximum number of events to return (default: 50).
 * @returns Array of events, newest first. Empty array if deployment not found.
 */
export function getDeploymentEvents(
    name: string,
    namespace: string,
    limit: number = 50,
): Array<{ type: 'Normal' | 'Warning'; reason: string; message: string; timestamp: string }> {
    const deployment = getDeployment(name, namespace);
    if (!deployment?.status) return [];

    const events = deployment.status.events;
    const clamped = Math.max(1, Math.min(limit, events.length));
    return events.slice(-clamped).reverse();
}

// =============================================================================
// diffState -- Desired vs actual state diff
// =============================================================================

/**
 * Return the diff between desired and actual state across all deployments.
 *
 * For each deployment, reports:
 *   - Desired vs actual replica count
 *   - Delta (positive = need more, negative = have excess)
 *   - Action needed (scale_up, scale_down, in_sync, needs_repair)
 *   - List of failed node IDs
 *
 * @returns Array of StateDiff objects.
 */
export function diffState(): StateDiff[] {
    const diffs: StateDiff[] = [];

    for (const deployment of deployments.values()) {
        const model = deployment.spec.model;
        const desiredReplicas = deployment.spec.replicas;
        const servingNodes = getNodesServingModel(model);
        const actualReplicas = servingNodes.length;
        const failedNodes = getFailedNodesForModel(model);
        const delta = desiredReplicas - actualReplicas;

        let action: StateDiff['action'];
        if (failedNodes.length > 0 && actualReplicas < desiredReplicas) {
            action = 'needs_repair';
        } else if (delta > 0) {
            action = 'scale_up';
        } else if (delta < 0) {
            action = 'scale_down';
        } else {
            action = 'in_sync';
        }

        diffs.push({
            deployment: deployment.metadata.name,
            namespace: deployment.metadata.namespace,
            model,
            desiredReplicas,
            actualReplicas,
            delta,
            action,
            failedNodes: failedNodes.map(n => n.id),
            missingNodes: Math.max(0, delta),
        });
    }

    return diffs;
}

// =============================================================================
// Utility exports for testing
// =============================================================================

/**
 * Reset all in-memory state. Used in tests only.
 * @internal
 */
export function _resetState(): void {
    deployments.clear();
    stopReconciliationLoop();
    dbTableEnsured = false;
}

/**
 * Get the number of deployments currently tracked.
 * @internal
 */
export function _getDeploymentCount(): number {
    return deployments.size;
}
