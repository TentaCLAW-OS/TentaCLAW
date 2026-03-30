/**
 * TentaCLAW Gateway — Fine-Tuning Orchestration Tests
 *
 * Tests the fine-tuning engine: job CRUD, scheduling, dataset validation,
 * training command generation, adapter management, and preemption.
 * Mocks the DB layer so we test pure logic only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeWithStats, StatsPayload, GpuStats } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — stub out DB and model helpers so finetune.ts runs in isolation
// ---------------------------------------------------------------------------

// In-memory store for the mock DB
let mockTables: Record<string, Map<string, Record<string, unknown>>>;

function resetMockTables() {
    mockTables = {
        finetune_jobs: new Map(),
        adapters: new Map(),
    };
}

const mockNodes: NodeWithStats[] = [];

vi.mock('../src/db', () => {
    return {
        getDb: vi.fn(() => {
            const stmtAll = (sql: string) => {
                return (...params: unknown[]) => {
                    const table = sql.includes('finetune_jobs') ? 'finetune_jobs' : 'adapters';
                    const map = mockTables[table];
                    let rows = [...map.values()];

                    // Handle WHERE clauses
                    if (sql.includes('WHERE id = ?') || sql.includes('WHERE id =')) {
                        rows = rows.filter(r => r.id === params[0]);
                    }
                    if (sql.includes('WHERE name = ?')) {
                        rows = rows.filter(r => r.name === params[0]);
                    }
                    if (sql.includes('WHERE namespace = ?')) {
                        rows = rows.filter(r => r.namespace === params[0]);
                    }
                    if (sql.includes("WHERE status = 'pending'")) {
                        rows = rows.filter(r => r.status === 'pending');
                    }
                    if (sql.includes("WHERE status IN ('preparing', 'training', 'evaluating')")) {
                        rows = rows.filter(r => ['preparing', 'training', 'evaluating'].includes(r.status as string));
                    }
                    if (sql.includes("WHERE status IN ('preparing', 'training')")) {
                        rows = rows.filter(r => ['preparing', 'training'].includes(r.status as string));
                    }
                    if (sql.includes('GROUP BY')) {
                        // Group by status and count
                        const groups = new Map<string, number>();
                        for (const row of [...mockTables['finetune_jobs'].values()]) {
                            const s = row.status as string;
                            groups.set(s, (groups.get(s) ?? 0) + 1);
                        }
                        return [...groups.entries()].map(([status, cnt]) => ({ status, cnt }));
                    }
                    if (sql.includes('COUNT(*)')) {
                        return [{ cnt: rows.length }];
                    }
                    if (sql.includes('COALESCE(SUM')) {
                        let total = 0;
                        for (const row of [...mockTables['finetune_jobs'].values()]) {
                            if (['preparing', 'training', 'evaluating'].includes(row.status as string)) {
                                const cfg = JSON.parse(row.config as string);
                                total += cfg.gpuAllocation ?? 0;
                            }
                        }
                        return [{ total }];
                    }

                    return rows;
                };
            };

            return {
                exec: vi.fn(),
                prepare: vi.fn((sql: string) => {
                    return {
                        run: (...params: unknown[]) => {
                            if (sql.includes('INSERT INTO finetune_jobs')) {
                                const [id, name, namespace, config, progress] = params;
                                mockTables['finetune_jobs'].set(id as string, {
                                    id, name, namespace, status: 'pending',
                                    config, progress, node_id: null,
                                    started_at: null, completed_at: null,
                                    created_at: new Date().toISOString(),
                                    error: null, checkpoints: '[]',
                                });
                                return { changes: 1 };
                            }
                            if (sql.includes('INSERT INTO adapters')) {
                                const [id, name, namespace, base_model, method, lora_rank, lora_alpha, lora_target_modules, path, size_mb, job_id, benchmarks] = params;
                                mockTables['adapters'].set(id as string, {
                                    id, name, namespace, base_model, method,
                                    lora_rank, lora_alpha, lora_target_modules,
                                    path, size_mb, job_id, benchmarks,
                                    created_at: new Date().toISOString(),
                                });
                                return { changes: 1 };
                            }
                            if (sql.includes('UPDATE finetune_jobs SET progress')) {
                                const paramArr = [...params];
                                const id = paramArr[paramArr.length - 1] as string;
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) row.progress = paramArr[0];
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes('UPDATE finetune_jobs SET checkpoints')) {
                                const [checkpoints, id] = params as [string, string];
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) row.checkpoints = checkpoints;
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes('UPDATE finetune_jobs SET node_id')) {
                                const [nodeId, id] = params as [string, string];
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) row.node_id = nodeId;
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes("UPDATE finetune_jobs SET status = 'cancelled'")) {
                                const id = params[0] as string;
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) {
                                    row.status = 'cancelled';
                                    row.completed_at = new Date().toISOString();
                                    if (sql.includes('error =')) {
                                        row.error = 'Preempted for inference demand';
                                    }
                                }
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes('UPDATE finetune_jobs SET status')) {
                                // Generic status update
                                const paramArr = [...params];
                                const id = paramArr[paramArr.length - 1] as string;
                                const status = paramArr[0] as string;
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) {
                                    row.status = status;
                                    if (paramArr.length > 2) {
                                        row.error = paramArr[1];
                                    }
                                }
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes('UPDATE finetune_jobs') && sql.includes("status = 'pending'")) {
                                const paramArr = [...params];
                                const id = paramArr[paramArr.length - 1] as string;
                                const row = mockTables['finetune_jobs'].get(id);
                                if (row) {
                                    row.status = 'pending';
                                    row.error = null;
                                    row.completed_at = null;
                                    row.progress = paramArr[0];
                                }
                                return { changes: row ? 1 : 0 };
                            }
                            if (sql.includes('UPDATE adapters SET benchmarks')) {
                                const [benchmarks, name] = params as [string, string];
                                for (const row of mockTables['adapters'].values()) {
                                    if (row.name === name) row.benchmarks = benchmarks;
                                }
                                return { changes: 1 };
                            }
                            if (sql.includes('DELETE FROM adapters')) {
                                const name = params[0] as string;
                                for (const [k, v] of mockTables['adapters'].entries()) {
                                    if (v.name === name) {
                                        mockTables['adapters'].delete(k);
                                        return { changes: 1 };
                                    }
                                }
                                return { changes: 0 };
                            }
                            return { changes: 0 };
                        },
                        get: (...params: unknown[]) => {
                            const results = stmtAll(sql)(...params);
                            return Array.isArray(results) ? results[0] ?? undefined : results;
                        },
                        all: stmtAll(sql),
                    };
                }),
            };
        }),
        getAllNodes: vi.fn(() => mockNodes),
    };
});

vi.mock('../src/models', () => ({
    parseParamCount: vi.fn((name: string) => {
        const match = name.toLowerCase().match(/(\d+\.?\d*)\s*b/);
        return match ? parseFloat(match[1]) * 1e9 : 7e9;
    }),
    estimateVramDetailed: vi.fn((_name: string, _quant: string) => {
        const params = (() => {
            const m = _name.toLowerCase().match(/(\d+\.?\d*)\s*b/);
            return m ? parseFloat(m[1]) : 7;
        })();
        const totalMb = Math.ceil(params * 1024 * 0.6);
        return {
            model_weights_mb: totalMb,
            kv_cache_mb: 512,
            activation_mb: 256,
            overhead_mb: 500,
            total_mb: totalMb + 1268,
        };
    }),
}));

// Import after mocks
import {
    createFineTuneJob,
    getFineTuneJob,
    listFineTuneJobs,
    cancelFineTuneJob,
    resumeFineTuneJob,
    updateJobProgress,
    updateJobStatus,
    addJobCheckpoint,
    scheduleJob,
    preemptJob,
    getJobQueue,
    getRunningJobs,
    getPreemptibleJobs,
    validateDataset,
    previewDataset,
    getDatasetStats,
    generateTrainingCommand,
    registerAdapter,
    listAdapters,
    getAdapter,
    deleteAdapter,
    updateAdapterBenchmarks,
    getFineTuneSummary,
} from '../src/finetune';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGpu(overrides?: Partial<GpuStats>): GpuStats {
    return {
        busId: '0000:01:00.0',
        name: 'NVIDIA RTX 4090',
        vramTotalMb: 24576,
        vramUsedMb: 4096,
        temperatureC: 55,
        utilizationPct: 30,
        powerDrawW: 300,
        fanSpeedPct: 45,
        clockSmMhz: 2520,
        clockMemMhz: 10500,
        ...overrides,
    };
}

function makeNode(id: string, overrides?: Partial<NodeWithStats>): NodeWithStats {
    return {
        id,
        farm_hash: 'FARM0001',
        hostname: `host-${id}`,
        ip_address: `10.0.0.${parseInt(id.replace(/\D/g, ''), 10) || 1}`,
        registered_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        status: 'online',
        gpu_count: 2,
        latest_stats: {
            farm_hash: 'FARM0001',
            node_id: id,
            hostname: `host-${id}`,
            cpu_usage_pct: 30,
            ram_used_mb: 8192,
            ram_total_mb: 32768,
            gpus: [makeGpu(), makeGpu({ busId: '0000:02:00.0' })],
            models_loaded: [],
            uptime_seconds: 86400,
            toks_per_sec: 50,
            os: 'linux',
            agent_version: '0.1.0',
        },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    resetMockTables();
    mockNodes.length = 0;
});

describe('Job Management', () => {
    it('creates a fine-tune job with defaults', () => {
        const job = createFineTuneJob({
            name: 'my-llama-tune',
            baseModel: 'meta-llama/Llama-3.1-8B-Instruct',
            dataset: '/data/my-dataset.jsonl',
        });

        expect(job.id).toMatch(/^ft_/);
        expect(job.name).toBe('my-llama-tune');
        expect(job.namespace).toBe('default');
        expect(job.status).toBe('pending');
        expect(job.config.method).toBe('qlora');
        expect(job.config.datasetFormat).toBe('auto');
        expect(job.config.hyperparameters.learningRate).toBe(2e-4);
        expect(job.config.hyperparameters.epochs).toBe(3);
        expect(job.config.hyperparameters.loraRank).toBe(16);
        expect(job.config.hyperparameters.loraAlpha).toBe(32);
        expect(job.config.preemptible).toBe(true);
        expect(job.progress.currentStep).toBe(0);
        expect(job.checkpoints).toEqual([]);
    });

    it('creates a job with custom hyperparameters', () => {
        const job = createFineTuneJob({
            name: 'custom-tune',
            baseModel: 'mistralai/Mistral-7B-v0.3',
            dataset: 'my_org/my_dataset',
            method: 'lora',
            datasetFormat: 'sharegpt',
            hyperparameters: { learningRate: 1e-5, epochs: 5, loraRank: 64 },
            gpuAllocation: 2,
            preemptible: false,
        });

        expect(job.config.method).toBe('lora');
        expect(job.config.datasetFormat).toBe('sharegpt');
        expect(job.config.hyperparameters.learningRate).toBe(1e-5);
        expect(job.config.hyperparameters.epochs).toBe(5);
        expect(job.config.hyperparameters.loraRank).toBe(64);
        expect(job.config.gpuAllocation).toBe(2);
        expect(job.config.preemptible).toBe(false);
    });

    it('rejects invalid config — missing required fields', () => {
        expect(() => createFineTuneJob({
            name: '',
            baseModel: '',
            dataset: '',
        })).toThrow('Invalid fine-tune config');
    });

    it('rejects invalid hyperparameters', () => {
        expect(() => createFineTuneJob({
            name: 'bad-lr',
            baseModel: 'llama-8b',
            dataset: '/data/ds.jsonl',
            hyperparameters: { learningRate: -1 },
        })).toThrow('learningRate');

        expect(() => createFineTuneJob({
            name: 'bad-epochs',
            baseModel: 'llama-8b',
            dataset: '/data/ds.jsonl',
            hyperparameters: { epochs: 200 },
        })).toThrow('epochs');
    });

    it('retrieves a job by ID', () => {
        const created = createFineTuneJob({
            name: 'retrieve-test',
            baseModel: 'llama-8b',
            dataset: '/data/ds.jsonl',
        });
        const fetched = getFineTuneJob(created.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.id).toBe(created.id);
        expect(fetched!.name).toBe('retrieve-test');
    });

    it('returns null for non-existent job', () => {
        expect(getFineTuneJob('ft_nonexistent')).toBeNull();
    });

    it('lists jobs by namespace', () => {
        createFineTuneJob({ name: 'j1', baseModel: 'llama-8b', dataset: '/ds.jsonl', namespace: 'team-a' });
        createFineTuneJob({ name: 'j2', baseModel: 'llama-8b', dataset: '/ds.jsonl', namespace: 'team-b' });
        createFineTuneJob({ name: 'j3', baseModel: 'llama-8b', dataset: '/ds.jsonl', namespace: 'team-a' });

        const allJobs = listFineTuneJobs();
        expect(allJobs.length).toBe(3);

        const teamA = listFineTuneJobs('team-a');
        expect(teamA.length).toBe(2);
    });

    it('cancels a pending job', () => {
        const job = createFineTuneJob({ name: 'to-cancel', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        const cancelled = cancelFineTuneJob(job.id);
        expect(cancelled.status).toBe('cancelled');
    });

    it('throws when cancelling an already-completed job', () => {
        const job = createFineTuneJob({ name: 'done-job', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        // Manually mark as completed
        mockTables['finetune_jobs'].get(job.id)!.status = 'completed';
        expect(() => cancelFineTuneJob(job.id)).toThrow('already completed');
    });

    it('resumes a cancelled job from checkpoint', () => {
        const job = createFineTuneJob({ name: 'resume-test', baseModel: 'llama-8b', dataset: '/ds.jsonl' });

        // Add a checkpoint and cancel
        const checkpoints = [{ step: 500, loss: 0.35, path: '/ckpt/500', timestamp: new Date().toISOString() }];
        mockTables['finetune_jobs'].get(job.id)!.checkpoints = JSON.stringify(checkpoints);
        mockTables['finetune_jobs'].get(job.id)!.status = 'cancelled';

        const resumed = resumeFineTuneJob(job.id);
        expect(resumed.status).toBe('pending');
    });

    it('throws when resuming a running job', () => {
        const job = createFineTuneJob({ name: 'running-job', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        mockTables['finetune_jobs'].get(job.id)!.status = 'training';
        expect(() => resumeFineTuneJob(job.id)).toThrow('cannot be resumed');
    });
});

describe('Dataset Validation', () => {
    it('validates a ShareGPT format dataset', () => {
        const rows = [
            { conversations: [{ from: 'human', value: 'Hello' }, { from: 'gpt', value: 'Hi there!' }] },
            { conversations: [{ from: 'human', value: 'How are you?' }, { from: 'gpt', value: 'I am fine.' }] },
        ];

        const result = validateDataset(rows);
        expect(result.valid).toBe(true);
        expect(result.format).toBe('sharegpt');
        expect(result.rowCount).toBe(2);
        expect(result.estimatedTokenCount).toBeGreaterThan(0);
    });

    it('validates an Alpaca format dataset', () => {
        const rows = [
            { instruction: 'Translate this', input: 'Hello', output: 'Hola' },
            { instruction: 'Summarize', input: 'Long text...', output: 'Short version' },
        ];

        const result = validateDataset(rows);
        expect(result.valid).toBe(true);
        expect(result.format).toBe('alpaca');
    });

    it('validates a ChatML format dataset', () => {
        const rows = [
            { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }] },
        ];

        const result = validateDataset(rows);
        expect(result.valid).toBe(true);
        expect(result.format).toBe('chatml');
    });

    it('validates a completion format dataset', () => {
        const rows = [
            { text: 'This is a complete text for training.' },
            { text: 'Another training example.' },
        ];

        const result = validateDataset(rows);
        expect(result.valid).toBe(true);
        expect(result.format).toBe('completion');
    });

    it('rejects an empty dataset', () => {
        const result = validateDataset([]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Dataset is empty');
    });

    it('detects unknown format', () => {
        const rows = [{ foo: 'bar', baz: 123 }];
        const result = validateDataset(rows);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Could not detect');
    });

    it('warns about format mismatch', () => {
        const rows = [
            { instruction: 'Do this', output: 'Done' },
        ];

        const result = validateDataset(rows, 'sharegpt');
        expect(result.warnings.some(w => w.includes('Expected format'))).toBe(true);
    });

    it('warns about small datasets', () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({
            text: `Example ${i}`,
        }));

        const result = validateDataset(rows);
        expect(result.warnings.some(w => w.includes('fewer than 10'))).toBe(true);
    });

    it('previews first N rows', () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ text: `Row ${i}` }));
        const preview = previewDataset(rows, 3);
        expect(preview).toHaveLength(3);
        expect(preview[0].index).toBe(0);
        expect(preview[2].data).toEqual({ text: 'Row 2' });
    });

    it('computes dataset stats', () => {
        const rows = [
            { text: 'Short' },
            { text: 'A medium length text example' },
            { text: 'This is a much longer text that should have more tokens than the others in this set' },
        ];

        const stats = getDatasetStats(rows);
        expect(stats.rowCount).toBe(3);
        expect(stats.formatDetected).toBe('completion');
        expect(stats.minLength).toBeLessThan(stats.maxLength);
        expect(stats.estimatedTokenCount).toBeGreaterThan(0);
        expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('handles empty dataset in stats', () => {
        const stats = getDatasetStats([]);
        expect(stats.rowCount).toBe(0);
        expect(stats.formatDetected).toBe('unknown');
    });
});

describe('Training Command Generation', () => {
    function makeJob(overrides?: Partial<FineTuneJobForTest>): import('../src/finetune').FineTuneJob {
        return {
            id: 'ft_test123',
            name: 'test-tune',
            namespace: 'default',
            status: 'training',
            config: {
                baseModel: 'meta-llama/Llama-3.1-8B-Instruct',
                method: 'qlora',
                dataset: '/data/train.jsonl',
                datasetFormat: 'sharegpt',
                outputModel: 'my-model-qlora',
                hyperparameters: {
                    learningRate: 2e-4,
                    epochs: 3,
                    batchSize: 4,
                    gradientAccumulation: 4,
                    loraRank: 16,
                    loraAlpha: 32,
                    loraTargetModules: ['q_proj', 'v_proj'],
                    warmupSteps: 10,
                    weightDecay: 0.01,
                },
                gpuAllocation: 1,
                preemptible: true,
            },
            progress: {
                currentStep: 0,
                totalSteps: 1000,
                currentEpoch: 0,
                totalEpochs: 3,
                loss: 0,
                learningRate: 2e-4,
                gpuMemoryUsedMb: 0,
                tokensProcessed: 0,
                estimatedTimeRemainingS: 0,
            },
            createdAt: new Date().toISOString(),
            checkpoints: [],
            ...overrides,
        };
    }

    // Type helper for test overrides
    type FineTuneJobForTest = import('../src/finetune').FineTuneJob;

    it('generates Unsloth command for single-GPU QLoRA', () => {
        const cmd = generateTrainingCommand(makeJob());
        expect(cmd.framework).toBe('unsloth');
        expect(cmd.command).toBe('python');
        expect(cmd.args).toContain('--load-in-4bit');
        expect(cmd.args).toContain('--lora-rank');
        expect(cmd.env.CUDA_VISIBLE_DEVICES).toBe('0');
        expect(cmd.description).toContain('Unsloth');
    });

    it('generates Unsloth command for single-GPU LoRA', () => {
        const job = makeJob();
        job.config.method = 'lora';
        const cmd = generateTrainingCommand(job);
        expect(cmd.framework).toBe('unsloth');
        expect(cmd.args).not.toContain('--load-in-4bit');
    });

    it('generates PEFT + Accelerate command for multi-GPU QLoRA', () => {
        const job = makeJob();
        job.config.gpuAllocation = 4;
        const cmd = generateTrainingCommand(job);
        expect(cmd.framework).toBe('peft');
        expect(cmd.env.CUDA_VISIBLE_DEVICES).toBe('0,1,2,3');
        expect(cmd.description).toContain('4 GPUs');
    });

    it('generates DeepSpeed command for full fine-tune', () => {
        const job = makeJob();
        job.config.method = 'full';
        job.config.gpuAllocation = 8;
        const cmd = generateTrainingCommand(job);
        expect(cmd.framework).toBe('deepspeed');
        expect(cmd.args).toContain('--deepspeed-config');
        expect(cmd.env.CUDA_VISIBLE_DEVICES).toBe('0,1,2,3,4,5,6,7');
    });

    it('generates Axolotl command for multi-GPU LoRA', () => {
        const job = makeJob();
        job.config.method = 'lora';
        job.config.gpuAllocation = 2;
        const cmd = generateTrainingCommand(job);
        expect(cmd.framework).toBe('axolotl');
        expect(cmd.env.CUDA_VISIBLE_DEVICES).toBe('0,1');
    });

    it('includes resume-from when checkpoints exist', () => {
        const job = makeJob();
        job.checkpoints = [{ step: 500, loss: 0.3, path: '/ckpt/500', timestamp: new Date().toISOString() }];
        const cmd = generateTrainingCommand(job);
        expect(cmd.args).toContain('--resume-from');
        expect(cmd.args).toContain('/ckpt/500');
    });
});

describe('Adapter Management', () => {
    it('registers a new adapter', () => {
        const adapter = registerAdapter({
            name: 'my-custom-adapter',
            baseModel: 'meta-llama/Llama-3.1-8B-Instruct',
            method: 'qlora',
            loraRank: 16,
            loraAlpha: 32,
            loraTargetModules: ['q_proj', 'v_proj'],
            path: '/adapters/my-custom-adapter',
            sizeMb: 128,
            jobId: 'ft_abc123',
        });

        expect(adapter.id).toMatch(/^adp_/);
        expect(adapter.name).toBe('my-custom-adapter');
        expect(adapter.method).toBe('qlora');
        expect(adapter.loraRank).toBe(16);
    });

    it('lists adapters', () => {
        registerAdapter({
            name: 'adapter-1', baseModel: 'llama-8b', method: 'lora',
            path: '/a/1', sizeMb: 64, jobId: 'ft_1', namespace: 'team-a',
        });
        registerAdapter({
            name: 'adapter-2', baseModel: 'llama-8b', method: 'qlora',
            path: '/a/2', sizeMb: 128, jobId: 'ft_2', namespace: 'team-b',
        });

        const all = listAdapters();
        expect(all.length).toBe(2);

        const teamA = listAdapters('team-a');
        expect(teamA.length).toBe(1);
        expect(teamA[0].name).toBe('adapter-1');
    });

    it('gets adapter by name', () => {
        registerAdapter({
            name: 'find-me', baseModel: 'llama-8b', method: 'lora',
            path: '/a/find', sizeMb: 32, jobId: 'ft_x',
        });

        const adapter = getAdapter('find-me');
        expect(adapter).not.toBeNull();
        expect(adapter!.name).toBe('find-me');
    });

    it('returns null for non-existent adapter', () => {
        expect(getAdapter('does-not-exist')).toBeNull();
    });

    it('deletes an adapter', () => {
        registerAdapter({
            name: 'delete-me', baseModel: 'llama-8b', method: 'lora',
            path: '/a/del', sizeMb: 32, jobId: 'ft_y',
        });

        expect(deleteAdapter('delete-me')).toBe(true);
        expect(deleteAdapter('delete-me')).toBe(false); // already gone
    });
});

describe('Job Scheduling', () => {
    it('returns null when no nodes are available', () => {
        const job = createFineTuneJob({ name: 'orphan', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        const result = scheduleJob(job);
        expect(result).toBeNull();
    });

    it('schedules a job to a node with available GPUs', () => {
        mockNodes.push(makeNode('node-1'));
        const job = createFineTuneJob({ name: 'scheduled-job', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        const result = scheduleJob(job);
        expect(result).not.toBeNull();
        expect(result!.nodeId).toBe('node-1');
        expect(result!.gpuIndices.length).toBeGreaterThanOrEqual(1);
    });

    it('skips offline nodes', () => {
        mockNodes.push(makeNode('node-offline', { status: 'offline' }));
        mockNodes.push(makeNode('node-online'));
        const job = createFineTuneJob({ name: 'skip-offline', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        const result = scheduleJob(job);
        expect(result).not.toBeNull();
        expect(result!.nodeId).toBe('node-online');
    });
});

describe('Preemption', () => {
    it('preempts a running preemptible job', () => {
        const job = createFineTuneJob({ name: 'preemptable', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        // Manually set to training
        const row = mockTables['finetune_jobs'].get(job.id)!;
        row.status = 'training';
        row.config = JSON.stringify({ ...job.config, preemptible: true });
        row.progress = JSON.stringify({ ...job.progress, currentStep: 250, loss: 0.42 });

        const result = preemptJob(job.id);
        expect(result.checkpointStep).toBe(250);
        expect(result.freedGpus).toBe(1);
    });

    it('refuses to preempt non-preemptible jobs', () => {
        const job = createFineTuneJob({
            name: 'locked', baseModel: 'llama-8b', dataset: '/ds.jsonl', preemptible: false,
        });
        const row = mockTables['finetune_jobs'].get(job.id)!;
        row.status = 'training';

        expect(() => preemptJob(job.id)).toThrow('not preemptible');
    });
});

describe('Summary', () => {
    it('computes fine-tune summary', () => {
        createFineTuneJob({ name: 'j1', baseModel: 'llama-8b', dataset: '/ds.jsonl' });
        createFineTuneJob({ name: 'j2', baseModel: 'llama-8b', dataset: '/ds.jsonl' });

        const summary = getFineTuneSummary();
        expect(summary.totalJobs).toBe(2);
        expect(summary.pendingJobs).toBe(2);
        expect(summary.totalAdapters).toBe(0);
    });
});
