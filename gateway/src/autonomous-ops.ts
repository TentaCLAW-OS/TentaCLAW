/**
 * TentaCLAW Gateway — Autonomous Cluster Operations (Wave 265)
 *
 * Self-healing, auto-optimization, and operational playbooks:
 *   - Auto-rebalance on GPU failure
 *   - Predictive auto-scaling
 *   - VRAM defragmentation scheduling
 *   - YAML-based operational playbooks
 *   - 5 autonomy levels (manual → fully autonomous)
 *
 * CLAWtopus says: "Eight arms, zero human intervention required."
 */

// =============================================================================
// Types
// =============================================================================

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
    0: 'Manual only — all actions require explicit human command',
    1: 'Suggest only — system suggests actions but never executes',
    2: 'Auto non-destructive — auto-execute safe actions (scale up, deploy), suggest destructive',
    3: 'Auto with approval — auto-execute most actions, require approval for destructive (undeploy, drain)',
    4: 'Fully autonomous — system handles everything, notify human after the fact',
};

export interface PlaybookAction {
    action: 'deploy' | 'undeploy' | 'scale' | 'drain' | 'rebalance' | 'defragment' | 'alert' | 'restart_backend' | 'migrate_model';
    target?: string;
    params: Record<string, unknown>;
    destructive: boolean;
}

export interface Playbook {
    name: string;
    description: string;
    trigger: {
        condition: 'gpu_failure' | 'node_offline' | 'high_queue' | 'low_utilization' | 'high_temperature' | 'vram_pressure' | 'model_error' | 'scheduled';
        threshold?: number;
        schedule?: string; // cron for scheduled triggers
    };
    actions: PlaybookAction[];
    enabled: boolean;
    cooldown_ms: number;
    last_triggered?: string;
}

export interface AutonomousAction {
    id: string;
    playbook: string;
    action: PlaybookAction;
    status: 'pending_approval' | 'executing' | 'completed' | 'failed' | 'skipped';
    reason: string;
    autonomy_level: AutonomyLevel;
    requires_approval: boolean;
    approved_by?: string;
    result?: string;
    created_at: string;
    completed_at?: string;
}

// =============================================================================
// State
// =============================================================================

let autonomyLevel: AutonomyLevel = 2; // Default: auto non-destructive
const playbooks = new Map<string, Playbook>();
const actionHistory: AutonomousAction[] = [];
let actionCounter = 0;

// =============================================================================
// Autonomy Level
// =============================================================================

export function setAutonomyLevel(level: AutonomyLevel): void {
    autonomyLevel = level;
    console.log(`[autonomous] Autonomy level set to ${level}: ${AUTONOMY_DESCRIPTIONS[level]}`);
}

export function getAutonomyLevel(): AutonomyLevel { return autonomyLevel; }

// =============================================================================
// Playbook Management
// =============================================================================

/** Register an operational playbook */
export function registerPlaybook(playbook: Playbook): void {
    playbooks.set(playbook.name, playbook);
}

/** Get a playbook */
export function getPlaybook(name: string): Playbook | null {
    return playbooks.get(name) || null;
}

/** List all playbooks */
export function listPlaybooks(): Playbook[] {
    return Array.from(playbooks.values());
}

/** Delete a playbook */
export function deletePlaybook(name: string): boolean {
    return playbooks.delete(name);
}

/** Register built-in playbooks */
export function registerDefaultPlaybooks(): void {
    registerPlaybook({
        name: 'gpu-failure-recovery',
        description: 'When a GPU fails, migrate its models to the next best available GPU',
        trigger: { condition: 'gpu_failure' },
        actions: [
            { action: 'alert', params: { severity: 'critical', message: 'GPU failure detected' }, destructive: false },
            { action: 'migrate_model', params: { strategy: 'best_available' }, destructive: false },
            { action: 'drain', target: 'affected_node', params: {}, destructive: true },
        ],
        enabled: true,
        cooldown_ms: 60000,
    });

    registerPlaybook({
        name: 'high-queue-autoscale',
        description: 'When inference queue exceeds threshold, scale up model replicas',
        trigger: { condition: 'high_queue', threshold: 50 },
        actions: [
            { action: 'scale', params: { direction: 'up', increment: 1 }, destructive: false },
            { action: 'alert', params: { severity: 'info', message: 'Auto-scaled due to high queue' }, destructive: false },
        ],
        enabled: true,
        cooldown_ms: 300000,
    });

    registerPlaybook({
        name: 'low-utilization-consolidate',
        description: 'When GPU utilization below 10% for 30min, suggest consolidation',
        trigger: { condition: 'low_utilization', threshold: 10 },
        actions: [
            { action: 'rebalance', params: { strategy: 'consolidate' }, destructive: false },
            { action: 'undeploy', params: { target: 'least_used_replica' }, destructive: true },
        ],
        enabled: true,
        cooldown_ms: 1800000,
    });

    registerPlaybook({
        name: 'vram-defragmentation',
        description: 'Periodically optimize VRAM allocation across GPUs',
        trigger: { condition: 'scheduled', schedule: '0 3 * * *' }, // 3 AM daily
        actions: [
            { action: 'defragment', params: { strategy: 'bin_pack' }, destructive: false },
        ],
        enabled: true,
        cooldown_ms: 86400000,
    });

    registerPlaybook({
        name: 'thermal-protection',
        description: 'When GPU temperature exceeds 85C, reduce load',
        trigger: { condition: 'high_temperature', threshold: 85 },
        actions: [
            { action: 'alert', params: { severity: 'warning', message: 'GPU overheating' }, destructive: false },
            { action: 'scale', params: { direction: 'down', increment: 1 }, destructive: true },
        ],
        enabled: true,
        cooldown_ms: 300000,
    });

    registerPlaybook({
        name: 'backend-crash-recovery',
        description: 'When inference backend crashes, restart it automatically',
        trigger: { condition: 'model_error' },
        actions: [
            { action: 'restart_backend', params: {}, destructive: false },
            { action: 'alert', params: { severity: 'warning', message: 'Backend restarted after crash' }, destructive: false },
        ],
        enabled: true,
        cooldown_ms: 60000,
    });
}

// =============================================================================
// Action Execution
// =============================================================================

/** Evaluate if an action should execute based on autonomy level */
export function shouldExecute(action: PlaybookAction): { execute: boolean; reason: string } {
    switch (autonomyLevel) {
        case 0:
            return { execute: false, reason: 'Level 0: manual only' };
        case 1:
            return { execute: false, reason: 'Level 1: suggestion only' };
        case 2:
            if (action.destructive) return { execute: false, reason: 'Level 2: destructive action needs manual approval' };
            return { execute: true, reason: 'Level 2: non-destructive auto-execute' };
        case 3:
            if (action.destructive) return { execute: false, reason: 'Level 3: destructive action queued for approval' };
            return { execute: true, reason: 'Level 3: auto-execute' };
        case 4:
            return { execute: true, reason: 'Level 4: fully autonomous' };
    }
}

/** Queue an autonomous action (from a triggered playbook) */
export function queueAction(playbookName: string, action: PlaybookAction, reason: string): AutonomousAction {
    const { execute } = shouldExecute(action);
    const id = `auto-${++actionCounter}-${Date.now().toString(36)}`;

    const entry: AutonomousAction = {
        id,
        playbook: playbookName,
        action,
        status: execute ? 'executing' : 'pending_approval',
        reason,
        autonomy_level: autonomyLevel,
        requires_approval: !execute && action.destructive,
        created_at: new Date().toISOString(),
    };
    actionHistory.push(entry);

    if (execute) {
        // Simulate execution
        entry.status = 'completed';
        entry.completed_at = new Date().toISOString();
        entry.result = `${action.action} executed successfully`;
    }

    return entry;
}

/** Approve a pending action */
export function approveAction(actionId: string, approver: string): boolean {
    const action = actionHistory.find(a => a.id === actionId);
    if (!action || action.status !== 'pending_approval') return false;
    action.status = 'completed';
    action.approved_by = approver;
    action.completed_at = new Date().toISOString();
    action.result = `Approved by ${approver} and executed`;
    return true;
}

/** Reject a pending action */
export function rejectAction(actionId: string): boolean {
    const action = actionHistory.find(a => a.id === actionId);
    if (!action || action.status !== 'pending_approval') return false;
    action.status = 'skipped';
    action.result = 'Rejected by operator';
    return true;
}

/** Get action history */
export function getActionHistory(limit: number = 100): AutonomousAction[] {
    return actionHistory.slice(-limit).reverse();
}

/** Get pending approvals */
export function getPendingApprovals(): AutonomousAction[] {
    return actionHistory.filter(a => a.status === 'pending_approval');
}

/** Trigger a playbook manually or by condition */
export function triggerPlaybook(name: string, reason: string): AutonomousAction[] {
    const playbook = playbooks.get(name);
    if (!playbook || !playbook.enabled) return [];

    // Check cooldown
    if (playbook.last_triggered) {
        const elapsed = Date.now() - new Date(playbook.last_triggered).getTime();
        if (elapsed < playbook.cooldown_ms) return [];
    }

    playbook.last_triggered = new Date().toISOString();
    return playbook.actions.map(action => queueAction(name, action, reason));
}

/** Reset (for testing) */
export function _resetAutonomousOps(): void {
    autonomyLevel = 2;
    playbooks.clear();
    actionHistory.length = 0;
    actionCounter = 0;
}
