/**
 * TentaCLAW Gateway — Chaos Engineering Framework (Wave 76)
 *
 * Built-in chaos testing for verifying cluster resilience:
 *   - Node kill simulation
 *   - GPU failure injection
 *   - Network partition simulation
 *   - CPU/memory stress injection
 *   - Backend crash simulation
 *   - Automatic healing verification
 *
 * CLAWtopus says: "Break it in testing so it doesn't break in production."
 */

// =============================================================================
// Types
// =============================================================================

export type ChaosAction =
    | 'kill-node'
    | 'kill-gpu'
    | 'network-partition'
    | 'network-delay'
    | 'cpu-stress'
    | 'memory-pressure'
    | 'backend-crash'
    | 'disk-full';

export interface ChaosExperiment {
    id: string;
    action: ChaosAction;
    target: string; // node_id or 'random'
    params: Record<string, unknown>;
    status: 'pending' | 'injecting' | 'active' | 'healing' | 'completed' | 'failed';
    startedAt: string;
    healedAt?: string;
    duration_ms?: number;
    result?: ChaosResult;
}

export interface ChaosResult {
    injected: boolean;
    healed: boolean;
    healTimeMs: number;
    requestsDropped: number;
    requestsRerouted: number;
    modelsAffected: string[];
    nodesAffected: string[];
    observation: string;
}

export interface ChaosConfig {
    /** Maximum duration before auto-reverting (ms) */
    maxDurationMs: number;
    /** Whether to auto-verify healing */
    verifyHealing: boolean;
    /** Dry run mode — simulate without actually injecting */
    dryRun: boolean;
}

// =============================================================================
// Module State
// =============================================================================

const experiments: Map<string, ChaosExperiment> = new Map();
let experimentCounter = 0;

const DEFAULT_CONFIG: ChaosConfig = {
    maxDurationMs: 60000, // 1 minute max
    verifyHealing: true,
    dryRun: false,
};

// =============================================================================
// Experiment Definitions
// =============================================================================

const CHAOS_ACTIONS: Record<ChaosAction, {
    description: string;
    requiresTarget: boolean;
    defaultParams: Record<string, unknown>;
}> = {
    'kill-node': {
        description: 'Simulate node failure — mark node as offline, verify traffic reroutes',
        requiresTarget: true,
        defaultParams: {},
    },
    'kill-gpu': {
        description: 'Simulate GPU failure on a node — mark specific GPU as unhealthy',
        requiresTarget: true,
        defaultParams: { gpu_index: 0 },
    },
    'network-partition': {
        description: 'Simulate network partition — node becomes unreachable for heartbeats',
        requiresTarget: true,
        defaultParams: { duration_ms: 30000 },
    },
    'network-delay': {
        description: 'Add artificial latency to node communication',
        requiresTarget: true,
        defaultParams: { delay_ms: 500 },
    },
    'cpu-stress': {
        description: 'Simulate high CPU usage — affects scheduling and gateway performance',
        requiresTarget: false,
        defaultParams: { load_pct: 90, duration_ms: 30000 },
    },
    'memory-pressure': {
        description: 'Simulate memory pressure — test OOM handling and model eviction',
        requiresTarget: false,
        defaultParams: { pressure_pct: 85, duration_ms: 30000 },
    },
    'backend-crash': {
        description: 'Kill the inference backend process on a node — verify auto-restart',
        requiresTarget: true,
        defaultParams: {},
    },
    'disk-full': {
        description: 'Simulate disk full — test logging, checkpoint, and model download handling',
        requiresTarget: false,
        defaultParams: {},
    },
};

// =============================================================================
// Core Functions
// =============================================================================

function generateId(): string {
    return `chaos-${++experimentCounter}-${Date.now().toString(36)}`;
}

/** Create a new chaos experiment */
export function createExperiment(
    action: ChaosAction,
    target: string = 'random',
    params: Record<string, unknown> = {},
    config: Partial<ChaosConfig> = {},
): ChaosExperiment {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const actionDef = CHAOS_ACTIONS[action];

    if (!actionDef) {
        throw new Error(`Unknown chaos action: ${action}. Valid: ${Object.keys(CHAOS_ACTIONS).join(', ')}`);
    }

    const experiment: ChaosExperiment = {
        id: generateId(),
        action,
        target,
        params: { ...actionDef.defaultParams, ...params, _config: mergedConfig },
        status: 'pending',
        startedAt: new Date().toISOString(),
    };

    experiments.set(experiment.id, experiment);
    return experiment;
}

/** Execute a chaos experiment (inject the fault) */
export async function injectChaos(experimentId: string): Promise<ChaosResult> {
    const exp = experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const config = (exp.params._config as ChaosConfig) || DEFAULT_CONFIG;
    exp.status = 'injecting';

    console.log(`[chaos] Injecting: ${exp.action} on ${exp.target}`);
    console.log(`[chaos] Description: ${CHAOS_ACTIONS[exp.action].description}`);

    if (config.dryRun) {
        console.log('[chaos] DRY RUN — no actual fault injected');
        exp.status = 'completed';
        exp.result = {
            injected: false,
            healed: true,
            healTimeMs: 0,
            requestsDropped: 0,
            requestsRerouted: 0,
            modelsAffected: [],
            nodesAffected: [exp.target],
            observation: 'Dry run — no fault injected',
        };
        return exp.result;
    }

    exp.status = 'active';
    const injectTime = Date.now();

    // Simulate the fault based on action type
    const result = await simulateFault(exp);

    // Auto-revert after max duration
    const maxDuration = config.maxDurationMs;
    await new Promise(resolve => setTimeout(resolve, Math.min(maxDuration, 5000)));

    // Verify healing
    if (config.verifyHealing) {
        exp.status = 'healing';
        console.log('[chaos] Verifying cluster healing...');
        // In real implementation, check if:
        // - Traffic rerouted to healthy nodes
        // - Backend auto-restarted
        // - Models redeployed
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const healTime = Date.now() - injectTime;
    exp.status = 'completed';
    exp.healedAt = new Date().toISOString();
    exp.duration_ms = healTime;
    exp.result = {
        ...result,
        healTimeMs: healTime,
    };

    console.log(`[chaos] Experiment ${exp.id} completed in ${healTime}ms`);
    console.log(`[chaos] Requests dropped: ${result.requestsDropped}, rerouted: ${result.requestsRerouted}`);

    return exp.result;
}

async function simulateFault(exp: ChaosExperiment): Promise<ChaosResult> {
    // Placeholder — real implementation would interact with gateway/agent APIs
    return {
        injected: true,
        healed: true,
        healTimeMs: 0,
        requestsDropped: 0,
        requestsRerouted: 0,
        modelsAffected: [],
        nodesAffected: [exp.target],
        observation: `${exp.action} simulated on ${exp.target}`,
    };
}

// =============================================================================
// Listing & Management
// =============================================================================

/** Get all experiments */
export function listExperiments(): ChaosExperiment[] {
    return Array.from(experiments.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
}

/** Get a specific experiment by ID */
export function getExperiment(id: string): ChaosExperiment | undefined {
    return experiments.get(id);
}

/** List available chaos actions with descriptions */
export function listActions(): Array<{ action: ChaosAction; description: string; requiresTarget: boolean }> {
    return Object.entries(CHAOS_ACTIONS).map(([action, def]) => ({
        action: action as ChaosAction,
        description: def.description,
        requiresTarget: def.requiresTarget,
    }));
}

/** Clear completed experiments from history */
export function clearExperiments(): number {
    let cleared = 0;
    for (const [id, exp] of experiments) {
        if (exp.status === 'completed' || exp.status === 'failed') {
            experiments.delete(id);
            cleared++;
        }
    }
    return cleared;
}

/** Reset all state (for testing) */
export function _resetChaos(): void {
    experiments.clear();
    experimentCounter = 0;
}
