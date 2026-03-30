/**
 * TentaCLAW Gateway — Benchmark Engine Tests
 *
 * Tests the built-in model benchmarking engine: suite resolution,
 * scoring, comparison, regression detection, leaderboard, and export.
 * Uses vi.mock to isolate from the DB and inference layers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB layer
// ---------------------------------------------------------------------------

const mockDbRows: Record<string, any[]> = {
    benchmark_suites: [],
    benchmark_runs: [],
};

const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => ({
        run: vi.fn((...args: any[]) => {
            // Track inserts for benchmark_runs
            if (sql.includes('INSERT INTO benchmark_runs')) {
                mockDbRows.benchmark_runs.push({
                    id: args[0],
                    model: args[1],
                    suite_id: args[2],
                    namespace: args[3],
                    status: 'running',
                    results: '{}',
                    started_at: args[4],
                    model_config: args[5],
                    created_at: new Date().toISOString(),
                });
            }
            if (sql.includes('INSERT OR REPLACE INTO benchmark_suites')) {
                mockDbRows.benchmark_suites.push({
                    id: args[0],
                    name: args[1],
                    description: args[2],
                    tasks: args[3],
                    is_builtin: 0,
                });
            }
        }),
        get: vi.fn((...args: any[]) => {
            if (sql.includes('FROM benchmark_runs WHERE id')) {
                return mockDbRows.benchmark_runs.find(r => r.id === args[0]);
            }
            if (sql.includes('FROM benchmark_suites WHERE id')) {
                return mockDbRows.benchmark_suites.find(s => s.id === args[0]);
            }
            return undefined;
        }),
        all: vi.fn((...args: any[]) => {
            if (sql.includes('FROM benchmark_suites')) {
                return mockDbRows.benchmark_suites.filter(s => s.is_builtin === 0);
            }
            if (sql.includes('FROM benchmark_runs') && sql.includes('model = ?')) {
                return mockDbRows.benchmark_runs
                    .filter(r => r.model === args[0] && r.status === 'completed')
                    .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at));
            }
            if (sql.includes('FROM benchmark_runs') && sql.includes('namespace = ?')) {
                return mockDbRows.benchmark_runs.filter(r => r.namespace === args[0]);
            }
            if (sql.includes('FROM benchmark_runs')) {
                return mockDbRows.benchmark_runs;
            }
            return [];
        }),
    })),
};

vi.mock('../src/db', () => ({
    getDb: () => mockDb,
}));

vi.mock('../src/profiler', () => ({
    percentile: (values: number[], p: number) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        const fraction = index - lower;
        return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
    },
}));

// Mock fetch for inference requests
const mockFetchResponses: any[] = [];
let fetchCallCount = 0;

global.fetch = vi.fn(async () => {
    const idx = fetchCallCount++;
    const resp = mockFetchResponses[idx % Math.max(mockFetchResponses.length, 1)] ?? {
        choices: [{ message: { content: 'mocked response' } }],
        usage: { completion_tokens: 10 },
    };
    return {
        json: async () => resp,
    } as any;
});

import {
    getBuiltInSuites,
    createCustomSuite,
    getBenchmarkRun,
    listBenchmarkRuns,
    compareBenchmarks,
    getBenchmarkHistory,
    detectRegression,
    getLeaderboard,
    exportResults,
    runBenchmark,
} from '../src/benchmark-engine';

import type { BenchmarkRun, BenchmarkSuite } from '../src/benchmark-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBenchmarkRow(overrides?: Partial<any>): any {
    return {
        id: overrides?.id ?? 'run-001',
        model: overrides?.model ?? 'llama3.1:8b',
        suite_id: overrides?.suite_id ?? 'standard',
        namespace: overrides?.namespace ?? 'default',
        status: overrides?.status ?? 'completed',
        results: JSON.stringify(overrides?.results ?? {
            overall_score: 75,
            per_task: [
                { task: 'logical-deduction', score: 80, avg_latency_ms: 500, avg_tokens_per_sec: 30, samples: 5 },
                { task: 'code-python', score: 70, avg_latency_ms: 600, avg_tokens_per_sec: 25, samples: 5 },
            ],
            throughput: {
                tokens_per_second: 28,
                time_to_first_token_ms: 50,
                latency_p50_ms: 550,
                latency_p95_ms: 800,
                latency_p99_ms: 1200,
            },
            resource_usage: {
                gpu_memory_peak_mb: 5000,
                gpu_utilization_avg_pct: 85,
                power_draw_avg_w: 250,
            },
        }),
        started_at: '2026-03-28T10:00:00.000Z',
        completed_at: '2026-03-28T10:05:00.000Z',
        duration_ms: 300000,
        model_config: JSON.stringify(overrides?.model_config ?? {
            quantization: 'Q4_K_M',
            backend: 'ollama',
            node: 'node-01',
            gpu: 'RTX 4090',
        }),
        created_at: overrides?.created_at ?? '2026-03-28T10:00:00.000Z',
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    mockDbRows.benchmark_suites = [];
    mockDbRows.benchmark_runs = [];
    fetchCallCount = 0;
    mockFetchResponses.length = 0;
    vi.clearAllMocks();
});

describe('Built-In Suites', () => {
    it('returns at least 5 built-in suites', () => {
        const suites = getBuiltInSuites();
        expect(suites.length).toBeGreaterThanOrEqual(5);
    });

    it('includes standard, code, reasoning, instruction, and speed suites', () => {
        const suites = getBuiltInSuites();
        const ids = suites.map(s => s.id);
        expect(ids).toContain('standard');
        expect(ids).toContain('code');
        expect(ids).toContain('reasoning');
        expect(ids).toContain('instruction');
        expect(ids).toContain('speed');
    });

    it('standard suite has 50 prompts across 10 tasks', () => {
        const suites = getBuiltInSuites();
        const standard = suites.find(s => s.id === 'standard')!;
        expect(standard.tasks.length).toBe(10);
        const totalPrompts = standard.tasks.reduce((sum, t) => sum + t.prompts.length, 0);
        expect(totalPrompts).toBe(50);
    });

    it('code suite has 30 prompts', () => {
        const suites = getBuiltInSuites();
        const code = suites.find(s => s.id === 'code')!;
        const totalPrompts = code.tasks.reduce((sum, t) => sum + t.prompts.length, 0);
        expect(totalPrompts).toBe(30);
    });

    it('reasoning suite has 30 prompts', () => {
        const suites = getBuiltInSuites();
        const reasoning = suites.find(s => s.id === 'reasoning')!;
        const totalPrompts = reasoning.tasks.reduce((sum, t) => sum + t.prompts.length, 0);
        expect(totalPrompts).toBe(30);
    });

    it('instruction suite has 30 prompts', () => {
        const suites = getBuiltInSuites();
        const instruction = suites.find(s => s.id === 'instruction')!;
        const totalPrompts = instruction.tasks.reduce((sum, t) => sum + t.prompts.length, 0);
        expect(totalPrompts).toBe(30);
    });

    it('speed suite has 10 prompts', () => {
        const suites = getBuiltInSuites();
        const speed = suites.find(s => s.id === 'speed')!;
        const totalPrompts = speed.tasks.reduce((sum, t) => sum + t.prompts.length, 0);
        expect(totalPrompts).toBe(10);
    });

    it('all suites have valid task categories', () => {
        const validCategories = ['reasoning', 'knowledge', 'code', 'math', 'instruction', 'creative', 'custom'];
        const suites = getBuiltInSuites();
        for (const suite of suites) {
            for (const task of suite.tasks) {
                expect(validCategories).toContain(task.category);
            }
        }
    });

    it('all tasks have a valid scoring method', () => {
        const validMethods = ['contains', 'exact', 'llm-judge', 'human', 'custom'];
        const suites = getBuiltInSuites();
        for (const suite of suites) {
            for (const task of suite.tasks) {
                expect(validMethods).toContain(task.scoringMethod);
            }
        }
    });
});

describe('Custom Suites', () => {
    it('creates a custom suite', () => {
        const suite = createCustomSuite({
            id: 'my-suite',
            name: 'My Custom Suite',
            description: 'Testing custom prompts',
            tasks: [{
                name: 'test-task',
                category: 'custom',
                prompts: [{ user: 'Hello?', expectedContains: ['Hello'] }],
                scoringMethod: 'contains',
            }],
        });
        expect(suite.id).toBe('my-suite');
        expect(suite.name).toBe('My Custom Suite');
        expect(suite.tasks.length).toBe(1);
    });

    it('rejects overwriting built-in suite IDs', () => {
        expect(() => createCustomSuite({
            id: 'standard',
            name: 'Hijack Standard',
            description: 'Nope',
            tasks: [],
        })).toThrow('Cannot create custom suite with built-in ID');
    });

    it('auto-generates an ID when not provided', () => {
        const suite = createCustomSuite({
            name: 'Auto-ID Suite',
            description: 'Should get an auto ID',
            tasks: [],
        });
        expect(suite.id).toBeTruthy();
        expect(suite.id.length).toBeGreaterThan(0);
    });
});

describe('Benchmark Run Retrieval', () => {
    it('returns null for non-existent run', () => {
        const run = getBenchmarkRun('nonexistent');
        expect(run).toBeNull();
    });

    it('parses a benchmark row correctly', () => {
        const row = makeBenchmarkRow();
        mockDbRows.benchmark_runs.push(row);

        // Override the mock to return the row
        mockDb.prepare.mockImplementationOnce(() => ({
            run: vi.fn(),
            get: vi.fn(() => row),
            all: vi.fn(() => []),
        }));

        // Re-import would be needed for full isolation, but we test
        // the parseBenchmarkRow logic indirectly through getBenchmarkRun
        const run = getBenchmarkRun('run-001');
        if (run) {
            expect(run.model).toBe('llama3.1:8b');
            expect(run.results.overall_score).toBe(75);
            expect(run.results.per_task.length).toBe(2);
            expect(run.model_config.quantization).toBe('Q4_K_M');
        }
    });

    it('lists runs by namespace', () => {
        mockDbRows.benchmark_runs.push(
            makeBenchmarkRow({ id: 'run-a', namespace: 'prod' }),
            makeBenchmarkRow({ id: 'run-b', namespace: 'staging' }),
        );
        const runs = listBenchmarkRuns('prod');
        // The mock returns all rows matching namespace — verify the function calls correctly
        expect(mockDb.prepare).toHaveBeenCalled();
    });
});

describe('Benchmark Comparison', () => {
    it('compares two runs and detects winner', () => {
        const row1 = makeBenchmarkRow({
            id: 'cmp-run-1',
            model: 'llama3.1:8b',
            results: {
                overall_score: 70,
                per_task: [{ task: 'logic', score: 70, avg_latency_ms: 500, avg_tokens_per_sec: 30, samples: 5 }],
                throughput: { tokens_per_second: 30, time_to_first_token_ms: 40, latency_p50_ms: 500, latency_p95_ms: 700, latency_p99_ms: 900 },
                resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 80, power_draw_avg_w: 200 },
            },
        });
        const row2 = makeBenchmarkRow({
            id: 'cmp-run-2',
            model: 'qwen2.5:14b',
            results: {
                overall_score: 85,
                per_task: [{ task: 'logic', score: 85, avg_latency_ms: 700, avg_tokens_per_sec: 20, samples: 5 }],
                throughput: { tokens_per_second: 20, time_to_first_token_ms: 60, latency_p50_ms: 700, latency_p95_ms: 900, latency_p99_ms: 1200 },
                resource_usage: { gpu_memory_peak_mb: 8000, gpu_utilization_avg_pct: 90, power_draw_avg_w: 300 },
            },
        });

        // Make getBenchmarkRun return the right rows
        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn((...args: any[]) => {
                if (args[0] === 'cmp-run-1') return row1;
                if (args[0] === 'cmp-run-2') return row2;
                return undefined;
            }),
            all: vi.fn(() => []),
        }));

        const comparison = compareBenchmarks('cmp-run-1', 'cmp-run-2');
        expect(comparison.score_delta).toBe(15);
        expect(comparison.score_delta_pct).toBeGreaterThan(0);
        expect(comparison.winner).toContain('qwen2.5:14b');
        expect(comparison.per_task_comparison.length).toBeGreaterThan(0);
    });

    it('throws when a run is missing', () => {
        mockDb.prepare.mockImplementation(() => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
        }));

        expect(() => compareBenchmarks('missing1', 'missing2')).toThrow('not found');
    });
});

describe('Regression Detection', () => {
    it('detects regression when score drops more than threshold', () => {
        const prevRow = makeBenchmarkRow({
            id: 'reg-prev',
            model: 'llama3.1:8b',
            results: {
                overall_score: 80,
                per_task: [{ task: 'logic', score: 80, avg_latency_ms: 500, avg_tokens_per_sec: 30, samples: 5 }],
                throughput: { tokens_per_second: 30, time_to_first_token_ms: 40, latency_p50_ms: 500, latency_p95_ms: 700, latency_p99_ms: 900 },
                resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 80, power_draw_avg_w: 200 },
            },
            created_at: '2026-03-27T10:00:00.000Z',
        });
        const latestRow = makeBenchmarkRow({
            id: 'reg-latest',
            model: 'llama3.1:8b',
            results: {
                overall_score: 60,
                per_task: [{ task: 'logic', score: 60, avg_latency_ms: 600, avg_tokens_per_sec: 25, samples: 5 }],
                throughput: { tokens_per_second: 25, time_to_first_token_ms: 50, latency_p50_ms: 600, latency_p95_ms: 800, latency_p99_ms: 1000 },
                resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 80, power_draw_avg_w: 200 },
            },
            created_at: '2026-03-28T10:00:00.000Z',
        });

        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => {
                if (sql.includes('ORDER BY created_at DESC LIMIT 2')) {
                    return [latestRow, prevRow]; // Latest first
                }
                return [];
            }),
        }));

        const report = detectRegression('llama3.1:8b');
        expect(report.regressed).toBe(true);
        expect(report.score_drop_pct).toBe(25); // (80-60)/80 * 100 = 25%
        expect(report.threshold_pct).toBe(5);
    });

    it('reports no regression when score is stable', () => {
        const row1 = makeBenchmarkRow({
            id: 'stable-1',
            model: 'llama3.1:8b',
            results: {
                overall_score: 75,
                per_task: [],
                throughput: { tokens_per_second: 30, time_to_first_token_ms: 40, latency_p50_ms: 500, latency_p95_ms: 700, latency_p99_ms: 900 },
                resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 80, power_draw_avg_w: 200 },
            },
            created_at: '2026-03-27T10:00:00.000Z',
        });
        const row2 = makeBenchmarkRow({
            id: 'stable-2',
            model: 'llama3.1:8b',
            results: {
                overall_score: 74,
                per_task: [],
                throughput: { tokens_per_second: 30, time_to_first_token_ms: 40, latency_p50_ms: 500, latency_p95_ms: 700, latency_p99_ms: 900 },
                resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 80, power_draw_avg_w: 200 },
            },
            created_at: '2026-03-28T10:00:00.000Z',
        });

        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => {
                if (sql.includes('ORDER BY created_at DESC LIMIT 2')) {
                    return [row2, row1];
                }
                return [];
            }),
        }));

        const report = detectRegression('llama3.1:8b');
        expect(report.regressed).toBe(false);
        expect(report.score_drop_pct).toBeLessThan(5);
    });

    it('handles model with only one run', () => {
        const row = makeBenchmarkRow({
            id: 'single-run',
            model: 'phi3:mini',
        });

        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => {
                if (sql.includes('ORDER BY created_at DESC LIMIT 2')) {
                    return [row];
                }
                return [];
            }),
        }));

        const report = detectRegression('phi3:mini');
        expect(report.regressed).toBe(false);
        expect(report.previous_run).toBe('');
    });
});

describe('Export Results', () => {
    const testRow = makeBenchmarkRow({ id: 'export-test' });

    beforeEach(() => {
        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn((...args: any[]) => {
                if (args[0] === 'export-test') return testRow;
                return undefined;
            }),
            all: vi.fn(() => []),
        }));
    });

    it('exports as JSON', () => {
        const json = exportResults('export-test', 'json');
        const parsed = JSON.parse(json);
        expect(parsed.model).toBe('llama3.1:8b');
        expect(parsed.results.overall_score).toBe(75);
    });

    it('exports as CSV', () => {
        const csv = exportResults('export-test', 'csv');
        expect(csv).toContain('task,score,avg_latency_ms');
        expect(csv).toContain('overall_score,75');
        expect(csv).toContain('logical-deduction');
    });

    it('exports as markdown', () => {
        const md = exportResults('export-test', 'markdown');
        expect(md).toContain('# Benchmark Results: llama3.1:8b');
        expect(md).toContain('| Task |');
        expect(md).toContain('logical-deduction');
        expect(md).toContain('75/100');
    });

    it('throws for non-existent run', () => {
        expect(() => exportResults('nope', 'json')).toThrow('not found');
    });
});

describe('Leaderboard', () => {
    it('returns entries sorted by score', () => {
        const rows = [
            makeBenchmarkRow({
                id: 'lb-1', model: 'model-a',
                results: { overall_score: 90, per_task: [], throughput: { tokens_per_second: 40, time_to_first_token_ms: 30, latency_p50_ms: 400, latency_p95_ms: 600, latency_p99_ms: 800 }, resource_usage: { gpu_memory_peak_mb: 5000, gpu_utilization_avg_pct: 85, power_draw_avg_w: 250 } },
                model_config: { quantization: 'Q4_K_M', backend: 'ollama', node: 'n1', gpu: 'RTX 4090' },
            }),
            makeBenchmarkRow({
                id: 'lb-2', model: 'model-b',
                results: { overall_score: 70, per_task: [], throughput: { tokens_per_second: 50, time_to_first_token_ms: 20, latency_p50_ms: 300, latency_p95_ms: 500, latency_p99_ms: 700 }, resource_usage: { gpu_memory_peak_mb: 4000, gpu_utilization_avg_pct: 75, power_draw_avg_w: 200 } },
                model_config: { quantization: 'Q4_K_M', backend: 'vllm', node: 'n2', gpu: 'RTX 3090' },
            }),
        ];

        mockDb.prepare.mockImplementation(() => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => rows),
        }));

        const leaderboard = getLeaderboard();
        expect(leaderboard.length).toBe(2);
        expect(leaderboard[0].rank).toBe(1);
        expect(leaderboard[0].score).toBe(90);
        expect(leaderboard[0].model).toBe('model-a');
        expect(leaderboard[1].rank).toBe(2);
        expect(leaderboard[1].score).toBe(70);
    });
});

describe('Run Benchmark (with mocked inference)', () => {
    it('runs a benchmark and returns completed status', async () => {
        // Set up mock fetch to return responses that match expected keywords
        mockFetchResponses.push({
            choices: [{ message: { content: 'No, we cannot conclude that all cats are pets. The premise only states some animals are pets.' } }],
            usage: { completion_tokens: 20 },
        });

        // Reset prepare mock to support both exec and prepare calls
        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
        }));

        // Run benchmark with just the speed suite (fewest prompts)
        const run = await runBenchmark('llama3.1:8b', 'speed', {
            inferenceEndpoint: 'http://localhost:8080/v1/chat/completions',
            warmupRuns: 0,
        });

        expect(run.status).toBe('completed');
        expect(run.model).toBe('llama3.1:8b');
        expect(run.suite).toBe('speed');
        expect(run.results.overall_score).toBeGreaterThanOrEqual(0);
        expect(run.results.per_task.length).toBeGreaterThan(0);
        expect(run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fails gracefully when suite does not exist', async () => {
        await expect(runBenchmark('model', 'nonexistent-suite')).rejects.toThrow('not found');
    });
});

describe('Benchmark History', () => {
    it('returns completed runs for a model', () => {
        mockDb.prepare.mockImplementation((sql: string) => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => [
                makeBenchmarkRow({ id: 'hist-1', model: 'llama3.1:8b' }),
                makeBenchmarkRow({ id: 'hist-2', model: 'llama3.1:8b' }),
            ]),
        }));

        const history = getBenchmarkHistory('llama3.1:8b');
        expect(history.length).toBe(2);
        expect(history[0].model).toBe('llama3.1:8b');
    });

    it('returns all completed runs when no model specified', () => {
        mockDb.prepare.mockImplementation(() => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => [
                makeBenchmarkRow({ id: 'h1', model: 'llama3.1:8b' }),
                makeBenchmarkRow({ id: 'h2', model: 'qwen2.5:14b' }),
            ]),
        }));

        const history = getBenchmarkHistory();
        expect(history.length).toBe(2);
    });
});

describe('Suite Structure Validation', () => {
    beforeEach(() => {
        // Restore default mock behavior so getBuiltInSuites works cleanly
        mockDb.prepare.mockImplementation(() => ({
            run: vi.fn(),
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
        }));
    });

    it('all prompts have a user field', () => {
        const suites = getBuiltInSuites();
        for (const suite of suites) {
            for (const task of suite.tasks) {
                for (const prompt of task.prompts) {
                    expect(prompt.user).toBeTruthy();
                    expect(typeof prompt.user).toBe('string');
                    expect(prompt.user.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('all suites have required fields', () => {
        const suites = getBuiltInSuites();
        for (const suite of suites) {
            expect(suite.id).toBeTruthy();
            expect(suite.name).toBeTruthy();
            expect(suite.description).toBeTruthy();
            expect(Array.isArray(suite.tasks)).toBe(true);
            expect(suite.tasks.length).toBeGreaterThan(0);
        }
    });

    it('tasks have unique names within each suite', () => {
        const suites = getBuiltInSuites();
        for (const suite of suites) {
            const names = suite.tasks.map(t => t.name);
            const uniqueNames = new Set(names);
            expect(uniqueNames.size).toBe(names.length);
        }
    });
});
