/**
 * Structured Output + Autonomous Operations Tests (Waves 151 + 265)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
    registerSchema, getSchema, listSchemas, deleteSchema,
    validateAgainstSchema, jsonSchemaToGbnf, selectConstraintMethod,
    registerBuiltinSchemas, _resetStructuredOutput,
} from '../src/experimental/structured-output';

import {
    setAutonomyLevel, getAutonomyLevel, AUTONOMY_DESCRIPTIONS,
    registerPlaybook, listPlaybooks, registerDefaultPlaybooks,
    shouldExecute, queueAction, approveAction, rejectAction,
    getActionHistory, getPendingApprovals, triggerPlaybook,
    _resetAutonomousOps,
} from '../src/experimental/autonomous-ops';

// =============================================================================
// Structured Output
// =============================================================================

describe('JSON Schema Validation', () => {
    beforeEach(() => _resetStructuredOutput());

    it('validates valid object', () => {
        const schema = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] };
        const result = validateAgainstSchema({ name: 'Alice', age: 30 }, schema);
        expect(result.valid).toBe(true);
    });

    it('rejects missing required field', () => {
        const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
        const result = validateAgainstSchema({}, schema);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('required');
    });

    it('validates enum constraint', () => {
        const schema = { type: 'string', enum: ['positive', 'negative', 'neutral'] };
        expect(validateAgainstSchema('positive', schema).valid).toBe(true);
        expect(validateAgainstSchema('maybe', schema).valid).toBe(false);
    });

    it('validates number range', () => {
        const schema = { type: 'number', minimum: 0, maximum: 1 };
        expect(validateAgainstSchema(0.5, schema).valid).toBe(true);
        expect(validateAgainstSchema(1.5, schema).valid).toBe(false);
    });

    it('validates nested objects', () => {
        const schema = {
            type: 'object',
            properties: {
                user: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
            },
            required: ['user'],
        };
        expect(validateAgainstSchema({ user: { name: 'Bob' } }, schema).valid).toBe(true);
        expect(validateAgainstSchema({ user: {} }, schema).valid).toBe(false);
    });

    it('validates arrays', () => {
        const schema = { type: 'array', items: { type: 'string' } };
        expect(validateAgainstSchema(['a', 'b'], schema).valid).toBe(true);
        expect(validateAgainstSchema([1, 2], schema).valid).toBe(false);
    });
});

describe('Schema Registry', () => {
    beforeEach(() => _resetStructuredOutput());

    it('registers and retrieves schema', () => {
        registerSchema('test', { type: 'object', properties: { x: { type: 'number' } } }, 'Test');
        const s = getSchema('test');
        expect(s?.name).toBe('test');
        expect(s?.schema.type).toBe('object');
    });

    it('registers builtin schemas', () => {
        registerBuiltinSchemas();
        expect(getSchema('sentiment')).toBeTruthy();
        expect(getSchema('entity_extraction')).toBeTruthy();
        expect(getSchema('classification')).toBeTruthy();
        expect(getSchema('summary')).toBeTruthy();
    });

    it('lists all schemas', () => {
        registerBuiltinSchemas();
        expect(listSchemas().length).toBeGreaterThanOrEqual(4);
    });
});

describe('GBNF Grammar Generation', () => {
    it('generates grammar from simple schema', () => {
        const grammar = jsonSchemaToGbnf({ type: 'object', properties: { name: { type: 'string' } } });
        expect(grammar).toContain('root');
        expect(grammar).toContain('string');
        expect(grammar).toContain('name');
    });
});

describe('Backend Constraint Selection', () => {
    it('selects json_schema for SGLang', () => {
        const method = selectConstraintMethod('sglang', { type: 'object' });
        expect(method.method).toBe('json_schema');
    });

    it('selects grammar for llama.cpp', () => {
        const method = selectConstraintMethod('llamacpp', { type: 'object' });
        expect(method.method).toBe('grammar');
    });

    it('selects post_validate for TRT-LLM', () => {
        const method = selectConstraintMethod('trtllm', { type: 'object' });
        expect(method.method).toBe('post_validate');
    });
});

// =============================================================================
// Autonomous Operations
// =============================================================================

describe('Autonomy Levels', () => {
    beforeEach(() => _resetAutonomousOps());

    it('default level is 2', () => {
        expect(getAutonomyLevel()).toBe(2);
    });

    it('all 5 levels have descriptions', () => {
        for (const level of [0, 1, 2, 3, 4] as const) {
            expect(AUTONOMY_DESCRIPTIONS[level]).toBeTruthy();
        }
    });

    it('level 0 blocks all actions', () => {
        setAutonomyLevel(0);
        expect(shouldExecute({ action: 'alert', params: {}, destructive: false }).execute).toBe(false);
    });

    it('level 2 blocks destructive actions', () => {
        setAutonomyLevel(2);
        expect(shouldExecute({ action: 'deploy', params: {}, destructive: false }).execute).toBe(true);
        expect(shouldExecute({ action: 'undeploy', params: {}, destructive: true }).execute).toBe(false);
    });

    it('level 4 allows everything', () => {
        setAutonomyLevel(4);
        expect(shouldExecute({ action: 'undeploy', params: {}, destructive: true }).execute).toBe(true);
    });
});

describe('Playbook Management', () => {
    beforeEach(() => _resetAutonomousOps());

    it('registers default playbooks', () => {
        registerDefaultPlaybooks();
        const playbooks = listPlaybooks();
        expect(playbooks.length).toBe(6);
    });

    it('gpu-failure-recovery playbook exists', () => {
        registerDefaultPlaybooks();
        const pb = listPlaybooks().find(p => p.name === 'gpu-failure-recovery');
        expect(pb).toBeTruthy();
        expect(pb!.trigger.condition).toBe('gpu_failure');
        expect(pb!.actions.length).toBe(3);
    });

    it('thermal-protection has temperature threshold', () => {
        registerDefaultPlaybooks();
        const pb = listPlaybooks().find(p => p.name === 'thermal-protection');
        expect(pb!.trigger.threshold).toBe(85);
    });
});

describe('Action Execution', () => {
    beforeEach(() => _resetAutonomousOps());

    it('queues non-destructive action at level 2', () => {
        setAutonomyLevel(2);
        const action = queueAction('test', { action: 'alert', params: {}, destructive: false }, 'test');
        expect(action.status).toBe('completed');
    });

    it('queues destructive action for approval at level 2', () => {
        setAutonomyLevel(2);
        const action = queueAction('test', { action: 'undeploy', params: {}, destructive: true }, 'test');
        expect(action.status).toBe('pending_approval');
        expect(action.requires_approval).toBe(true);
    });

    it('approves pending action', () => {
        setAutonomyLevel(2);
        const action = queueAction('test', { action: 'drain', params: {}, destructive: true }, 'test');
        expect(approveAction(action.id, 'admin@tentaclaw.io')).toBe(true);
        expect(getActionHistory()[0].status).toBe('completed');
        expect(getActionHistory()[0].approved_by).toBe('admin@tentaclaw.io');
    });

    it('rejects pending action', () => {
        setAutonomyLevel(2);
        const action = queueAction('test', { action: 'drain', params: {}, destructive: true }, 'test');
        expect(rejectAction(action.id)).toBe(true);
        expect(getActionHistory()[0].status).toBe('skipped');
    });

    it('triggers playbook and creates actions', () => {
        registerDefaultPlaybooks();
        setAutonomyLevel(2);
        const actions = triggerPlaybook('gpu-failure-recovery', 'GPU-0 failed on node-1');
        expect(actions.length).toBe(3);
        // Alert (non-destructive) should auto-execute, drain (destructive) should need approval
        expect(actions[0].status).toBe('completed'); // alert
        expect(actions[2].status).toBe('pending_approval'); // drain
    });

    it('respects cooldown period', () => {
        registerDefaultPlaybooks();
        triggerPlaybook('gpu-failure-recovery', 'First trigger');
        const second = triggerPlaybook('gpu-failure-recovery', 'Second trigger (cooldown)');
        expect(second).toHaveLength(0); // cooldown blocks
    });

    it('lists pending approvals', () => {
        setAutonomyLevel(2);
        queueAction('test', { action: 'drain', params: {}, destructive: true }, 'reason');
        queueAction('test', { action: 'undeploy', params: {}, destructive: true }, 'reason');
        expect(getPendingApprovals()).toHaveLength(2);
    });
});
