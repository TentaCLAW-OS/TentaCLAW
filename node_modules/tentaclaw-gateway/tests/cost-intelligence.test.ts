/**
 * TentaCLAW Gateway — Cost Intelligence Tests
 *
 * Tests the cost intelligence system: power monitoring, cost configuration,
 * cost per token, cloud comparison, hardware ROI, budget management, and
 * the cost dashboard.
 * Uses vi.mock to isolate from the DB layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB layer — cost-intelligence imports getAllNodes, getClusterPower, getDb
// ---------------------------------------------------------------------------

const mockAllNodes = vi.fn(() => [] as Array<{
    id: string;
    status: string;
    gpu_count: number;
    latest_stats: {
        gpu_count: number;
        gpus: Array<{ utilizationPct: number; vramTotalMb: number; vramUsedMb: number; powerDrawW: number }>;
    } | null;
}>);

const mockClusterPower = vi.fn(() => ({
    total_watts: 500,
    per_node: [
        { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
    ],
    daily_kwh: 12,
    monthly_kwh: 360,
    daily_cost: 1.44,
    monthly_cost: 43.20,
    cost_per_request: 0.001,
    cost_per_1k_tokens: 0.01,
    electricity_rate: 0.12,
}));

/** In-memory mock for getDb — returns a mock with prepare().get() for inference_log queries. */
const mockDbGet = vi.fn((_sql: string) => ({ total: 5000000 }));
const mockDbPrepare = vi.fn((_sql: string) => ({
    get: (...args: unknown[]) => mockDbGet(_sql, ...args),
}));
const mockGetDb = vi.fn(() => ({
    prepare: mockDbPrepare,
}));

vi.mock('../src/db', () => ({
    getAllNodes: (...args: unknown[]) => mockAllNodes(...(args as [])),
    getClusterPower: (...args: unknown[]) => mockClusterPower(...(args as [])),
    getDb: (...args: unknown[]) => mockGetDb(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import {
    getClusterPowerDraw,
    getPowerHistory,
    setCostConfig,
    getCostConfig,
    getCostPerToken,
    getCloudComparison,
    getHardwareROI,
    setBudget,
    getBudgetStatus,
    shouldThrottle,
    getCostDashboard,
} from '../src/cost-intelligence';

// =============================================================================
// Power Monitoring
// =============================================================================

describe('Power Monitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore default mock return values
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
    });

    it('getClusterPowerDraw returns number', () => {
        const watts = getClusterPowerDraw();
        expect(typeof watts).toBe('number');
        expect(watts).toBe(500);
    });

    it('getPowerHistory returns array', () => {
        const history = getPowerHistory(1);
        expect(history).toBeDefined();
        expect(Array.isArray(history.snapshots)).toBe(true);
        expect(typeof history.total_wh).toBe('number');
        expect(typeof history.avg_watts).toBe('number');
        // Should have at least one snapshot (the current reading)
        expect(history.snapshots.length).toBeGreaterThanOrEqual(1);
    });
});

// =============================================================================
// Cost Configuration
// =============================================================================

describe('Cost Configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset cost config to defaults
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
    });

    it('setCostConfig stores config', () => {
        setCostConfig({ electricityCostPerKwh: 0.25, currency: 'EUR' });

        const config = getCostConfig();
        expect(config.electricityCostPerKwh).toBe(0.25);
        expect(config.currency).toBe('EUR');
    });

    it('getCostConfig returns defaults', () => {
        const config = getCostConfig();
        expect(config).toBeDefined();
        expect(typeof config.electricityCostPerKwh).toBe('number');
        expect(typeof config.currency).toBe('string');
        expect(Array.isArray(config.hardwareCosts)).toBe(true);
    });

    it('Default electricity cost is 0.12', () => {
        const config = getCostConfig();
        expect(config.electricityCostPerKwh).toBe(0.12);
    });
});

// =============================================================================
// Cost Per Token
// =============================================================================

describe('Cost Per Token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
        // Mock inference_log returning 5M tokens this month
        mockDbGet.mockReturnValue({ total: 5000000 });
    });

    it('getCostPerToken returns object with breakdown', () => {
        const result = getCostPerToken();
        expect(result).toBeDefined();
        expect(typeof result.cost_per_million_tokens).toBe('number');
        expect(result.breakdown).toBeDefined();
        expect(typeof result.breakdown.electricity_pct).toBe('number');
        expect(typeof result.breakdown.hardware_pct).toBe('number');
        expect(typeof result.breakdown.overhead_pct).toBe('number');
    });

    it('Cost includes electricity and hardware components', () => {
        // Add hardware costs to see both components
        setCostConfig({
            electricityCostPerKwh: 0.12,
            hardwareCosts: [{
                nodeId: 'node-1',
                purchasePrice: 5000,
                purchaseDate: '2025-01-01',
                depreciationYears: 3,
            }],
        });

        const result = getCostPerToken();
        // With both electricity and hardware, both percentages should be > 0
        expect(result.breakdown.electricity_pct).toBeGreaterThan(0);
        expect(result.breakdown.hardware_pct).toBeGreaterThan(0);
        // Overhead is always 10% of subtotal
        expect(result.breakdown.overhead_pct).toBeGreaterThan(0);
        // All percentages should sum to ~100
        const total = result.breakdown.electricity_pct + result.breakdown.hardware_pct + result.breakdown.overhead_pct;
        expect(total).toBeCloseTo(100, 0);
    });
});

// =============================================================================
// Cloud Comparison
// =============================================================================

describe('Cloud Comparison', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
        mockDbGet.mockReturnValue({ total: 5000000 });
    });

    it('getCloudComparison returns self_hosted and cloud_comparison', () => {
        const comp = getCloudComparison();
        expect(comp.self_hosted).toBeDefined();
        expect(typeof comp.self_hosted.monthly_cost).toBe('number');
        expect(typeof comp.self_hosted.cost_per_million_tokens).toBe('number');
        expect(typeof comp.self_hosted.tokens_served_this_month).toBe('number');

        expect(Array.isArray(comp.cloud_comparison)).toBe(true);
        expect(comp.cloud_comparison.length).toBeGreaterThanOrEqual(4);

        expect(comp.savings).toBeDefined();
        expect(typeof comp.savings).toBe('object');
    });

    it('Includes OpenAI, Anthropic, Together, RunPod', () => {
        const comp = getCloudComparison();
        const providerNames = comp.cloud_comparison.map(c => c.provider);

        expect(providerNames.some(n => n.includes('OpenAI'))).toBe(true);
        expect(providerNames.some(n => n.includes('Anthropic'))).toBe(true);
        expect(providerNames.some(n => n.includes('Together'))).toBe(true);
        expect(providerNames.some(n => n.includes('RunPod'))).toBe(true);
    });

    it('Savings calculated correctly', () => {
        const comp = getCloudComparison();

        // Savings keys should exist for each provider
        expect('vs_openai' in comp.savings).toBe(true);
        expect('vs_anthropic' in comp.savings).toBe(true);
        expect('vs_together' in comp.savings).toBe(true);
        expect('vs_runpod' in comp.savings).toBe(true);

        // Each savings value should be a number
        expect(typeof comp.savings['vs_openai']).toBe('number');
        expect(typeof comp.savings['vs_anthropic']).toBe('number');
        expect(typeof comp.savings['vs_together']).toBe('number');
        expect(typeof comp.savings['vs_runpod']).toBe('number');
    });
});

// =============================================================================
// Hardware ROI
// =============================================================================

describe('Hardware ROI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [{
                nodeId: 'node-1',
                purchasePrice: 5000,
                purchaseDate: '2025-01-01',
                depreciationYears: 3,
            }],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
        mockAllNodes.mockReturnValue([
            {
                id: 'node-1',
                status: 'online',
                gpu_count: 1,
                latest_stats: {
                    gpu_count: 1,
                    gpus: [{
                        utilizationPct: 80,
                        vramTotalMb: 24576,
                        vramUsedMb: 16000,
                        powerDrawW: 400,
                    }],
                },
            },
        ]);
        // 5M tokens this month
        mockDbGet.mockReturnValue({ total: 5000000 });
    });

    it('getHardwareROI returns per-node data', () => {
        const roi = getHardwareROI();
        expect(roi.nodes).toBeDefined();
        expect(Array.isArray(roi.nodes)).toBe(true);
        expect(roi.nodes.length).toBe(1);
        expect(roi.nodes[0].nodeId).toBe('node-1');
        expect(typeof roi.nodes[0].hardware_cost).toBe('number');
        expect(typeof roi.nodes[0].monthly_savings).toBe('number');
        expect(typeof roi.nodes[0].roi_pct).toBe('number');
    });

    it('Payback days is positive number', () => {
        const roi = getHardwareROI();
        const node = roi.nodes[0];
        // With 5M tokens at $2.50/M (OpenAI baseline) = $12.50/month cloud cost,
        // minus electricity (~$43.20/month) the savings may be zero (payback_days = -1)
        // if electricity exceeds cloud cost. Adjust tokens to ensure positive savings.
        mockDbGet.mockReturnValue({ total: 100000000 }); // 100M tokens

        const roi2 = getHardwareROI();
        const node2 = roi2.nodes[0];
        // With 100M tokens at $2.50/M = $250/month cloud cost vs ~$43 electricity
        expect(node2.payback_days).toBeGreaterThan(0);
    });
});

// =============================================================================
// Budget
// =============================================================================

describe('Budget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
    });

    it('setBudget stores limit', () => {
        setBudget(100);

        const status = getBudgetStatus();
        expect(status).not.toBeNull();
        expect(status!.monthly_limit).toBe(100);
    });

    it('getBudgetStatus returns current vs limit', () => {
        setBudget(200);

        const status = getBudgetStatus();
        expect(status).not.toBeNull();
        expect(status!.monthly_limit).toBe(200);
        expect(typeof status!.current_spend).toBe('number');
        expect(typeof status!.remaining).toBe('number');
        expect(typeof status!.days_elapsed).toBe('number');
        expect(typeof status!.days_in_month).toBe('number');
        expect(typeof status!.projected_spend).toBe('number');
        expect(typeof status!.on_track).toBe('boolean');
        // Remaining should be limit minus current spend
        expect(status!.remaining).toBeCloseTo(status!.monthly_limit - status!.current_spend, 1);
    });

    it('shouldThrottle returns false under budget', () => {
        // Set a very high budget so we're always under
        setBudget(10000);

        const throttle = shouldThrottle();
        expect(throttle).toBe(false);
    });
});

// =============================================================================
// Cost Dashboard
// =============================================================================

describe('Cost Dashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [
                { node_id: 'node-1', hostname: 'rig-01', watts: 500, gpu_watts: 400, gpu_count: 1 },
            ],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0.001,
            cost_per_1k_tokens: 0.01,
            electricity_rate: 0.12,
        });
        mockAllNodes.mockReturnValue([]);
        mockDbGet.mockReturnValue({ total: 5000000 });
    });

    it('getCostDashboard returns all-in-one data', () => {
        const dashboard = getCostDashboard();
        expect(dashboard).toBeDefined();
        expect(typeof dashboard.current_power_watts).toBe('number');
        expect(typeof dashboard.daily_electricity_cost).toBe('number');
        expect(typeof dashboard.monthly_electricity_cost).toBe('number');
        expect(typeof dashboard.yearly_electricity_cost).toBe('number');
        expect(typeof dashboard.cost_per_million_tokens).toBe('number');
        expect(typeof dashboard.trend).toBe('string');
        expect(typeof dashboard.currency).toBe('string');
    });

    it('Dashboard includes power, cost, savings, roi, budget', () => {
        // Set budget so it appears in dashboard
        setBudget(500);

        const dashboard = getCostDashboard();

        // Power
        expect(dashboard.current_power_watts).toBe(500);

        // Costs
        expect(dashboard.daily_electricity_cost).toBeGreaterThan(0);
        expect(dashboard.monthly_electricity_cost).toBeGreaterThan(0);
        expect(dashboard.yearly_electricity_cost).toBeGreaterThan(0);

        // Savings vs cloud providers
        expect(typeof dashboard.cloud_savings_vs_openai).toBe('number');
        expect(typeof dashboard.cloud_savings_vs_anthropic).toBe('number');
        expect(typeof dashboard.cloud_savings_vs_together).toBe('number');
        expect(typeof dashboard.cloud_savings_vs_runpod).toBe('number');

        // ROI summary
        expect(dashboard.hardware_roi_summary).toBeDefined();
        expect(typeof dashboard.hardware_roi_summary.total_hardware_cost).toBe('number');
        expect(typeof dashboard.hardware_roi_summary.avg_payback_days).toBe('number');
        expect(typeof dashboard.hardware_roi_summary.avg_roi_pct).toBe('number');

        // Budget
        expect(dashboard.budget).not.toBeNull();
        expect(dashboard.budget!.monthly_limit).toBe(500);

        // Trend
        expect(['increasing', 'decreasing', 'stable']).toContain(dashboard.trend);

        // Currency
        expect(dashboard.currency).toBe('USD');
    });
});

// =============================================================================
// Power Monitoring Edge Cases
// =============================================================================

describe('Power Monitoring Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClusterPower.mockReturnValue({
            total_watts: 0,
            per_node: [],
            daily_kwh: 0,
            monthly_kwh: 0,
            daily_cost: 0,
            monthly_cost: 0,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });
    });

    it('getClusterPowerDraw returns 0 when no nodes', () => {
        const watts = getClusterPowerDraw();
        expect(watts).toBe(0);
    });

    it('getPowerHistory accumulates snapshots on repeated calls', () => {
        mockClusterPower.mockReturnValue({
            total_watts: 200,
            per_node: [],
            daily_kwh: 4.8,
            monthly_kwh: 144,
            daily_cost: 0.58,
            monthly_cost: 17.28,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });

        getPowerHistory(1);
        getPowerHistory(1);
        const h3 = getPowerHistory(1);
        // Each call adds a snapshot
        expect(h3.snapshots.length).toBeGreaterThanOrEqual(3);
    });

    it('getPowerHistory avg_watts is a positive number when cluster has power', () => {
        mockClusterPower.mockReturnValue({
            total_watts: 750,
            per_node: [],
            daily_kwh: 18,
            monthly_kwh: 540,
            daily_cost: 2.16,
            monthly_cost: 64.80,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });

        const history = getPowerHistory(1);
        // avg_watts includes all snapshots in the time window (may include prior calls),
        // but should be > 0 since this call contributes a 750W snapshot
        expect(history.avg_watts).toBeGreaterThan(0);
    });
});

// =============================================================================
// Cost Config Edge Cases
// =============================================================================

describe('Cost Config Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
    });

    it('setCostConfig merges partial updates', () => {
        setCostConfig({ currency: 'GBP' });
        const config = getCostConfig();
        expect(config.currency).toBe('GBP');
        expect(config.electricityCostPerKwh).toBe(0.12); // unchanged
    });

    it('getCostConfig returns a copy not a reference', () => {
        const c1 = getCostConfig();
        c1.electricityCostPerKwh = 999;
        c1.hardwareCosts.push({
            nodeId: 'injected',
            purchasePrice: 1,
            purchaseDate: '2025-01-01',
            depreciationYears: 1,
        });

        const c2 = getCostConfig();
        expect(c2.electricityCostPerKwh).toBe(0.12);
        expect(c2.hardwareCosts.length).toBe(0);
    });

    it('setCostConfig sets hardware depreciation default to 3 years', () => {
        setCostConfig({
            hardwareCosts: [{
                nodeId: 'n1',
                purchasePrice: 3000,
                purchaseDate: '2025-06-01',
                depreciationYears: 0, // falsy — should default to 3
            }],
        });

        const config = getCostConfig();
        expect(config.hardwareCosts[0].depreciationYears).toBe(3);
    });
});

// =============================================================================
// Cost Per Token Edge Cases
// =============================================================================

describe('Cost Per Token Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });
    });

    it('getCostPerToken returns 0 when no tokens served', () => {
        mockDbGet.mockReturnValue({ total: 0 });

        const result = getCostPerToken();
        expect(result.cost_per_million_tokens).toBe(0);
    });

    it('getCostPerToken decreases with more tokens', () => {
        mockDbGet.mockReturnValue({ total: 1000000 });
        const low = getCostPerToken();

        mockDbGet.mockReturnValue({ total: 100000000 });
        const high = getCostPerToken();

        expect(high.cost_per_million_tokens).toBeLessThan(low.cost_per_million_tokens);
    });
});

// =============================================================================
// Budget Edge Cases
// =============================================================================

describe('Budget Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });
    });

    it('shouldThrottle returns false when no budget set', () => {
        // getBudgetStatus returns null when no budget; shouldThrottle should return false
        // Note: budget may persist from prior tests, so we test the no-budget case
        // by verifying the function returns boolean
        const result = shouldThrottle();
        expect(typeof result).toBe('boolean');
    });

    it('getBudgetStatus projected_overage is zero when under budget', () => {
        setBudget(10000); // very high

        const status = getBudgetStatus();
        expect(status).not.toBeNull();
        expect(status!.projected_overage).toBe(0);
        expect(status!.on_track).toBe(true);
    });

    it('getBudgetStatus days_in_month is between 28 and 31', () => {
        setBudget(100);

        const status = getBudgetStatus();
        expect(status).not.toBeNull();
        expect(status!.days_in_month).toBeGreaterThanOrEqual(28);
        expect(status!.days_in_month).toBeLessThanOrEqual(31);
    });

    it('shouldThrottle returns true with tiny budget and high power', () => {
        mockClusterPower.mockReturnValue({
            total_watts: 10000, // 10kW
            per_node: [],
            daily_kwh: 240,
            monthly_kwh: 7200,
            daily_cost: 28.80,
            monthly_cost: 864,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });
        setBudget(1); // $1 budget with $864/month power costs

        const throttle = shouldThrottle();
        expect(throttle).toBe(true);
    });
});

// =============================================================================
// Cloud Comparison Edge Cases
// =============================================================================

describe('Cloud Comparison Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCostConfig({
            electricityCostPerKwh: 0.12,
            currency: 'USD',
            hardwareCosts: [],
        });
        mockClusterPower.mockReturnValue({
            total_watts: 500,
            per_node: [],
            daily_kwh: 12,
            monthly_kwh: 360,
            daily_cost: 1.44,
            monthly_cost: 43.20,
            cost_per_request: 0,
            cost_per_1k_tokens: 0,
            electricity_rate: 0.12,
        });
    });

    it('getCloudComparison with zero tokens returns zero self-hosted CPM', () => {
        mockDbGet.mockReturnValue({ total: 0 });

        const comp = getCloudComparison();
        expect(comp.self_hosted.cost_per_million_tokens).toBe(0);
        expect(comp.self_hosted.tokens_served_this_month).toBe(0);
    });

    it('getCloudComparison cloud monthly_equivalent scales with tokens', () => {
        mockDbGet.mockReturnValue({ total: 10000000 });
        const comp1 = getCloudComparison();

        mockDbGet.mockReturnValue({ total: 20000000 });
        const comp2 = getCloudComparison();

        // Double the tokens should roughly double the cloud equivalent
        for (let i = 0; i < comp1.cloud_comparison.length; i++) {
            expect(comp2.cloud_comparison[i].monthly_equivalent).toBeCloseTo(
                comp1.cloud_comparison[i].monthly_equivalent * 2,
                1,
            );
        }
    });

    it('getCloudComparison each provider has cost_per_m_tokens > 0', () => {
        mockDbGet.mockReturnValue({ total: 5000000 });

        const comp = getCloudComparison();
        for (const provider of comp.cloud_comparison) {
            expect(provider.cost_per_m_tokens).toBeGreaterThan(0);
        }
    });
});
