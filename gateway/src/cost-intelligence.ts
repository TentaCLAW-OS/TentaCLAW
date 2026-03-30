// F:\tentaclaw-os\gateway\src\cost-intelligence.ts
// Cost Intelligence — Know What Your Cluster Actually Costs
// CLAWtopus says: "Every watt. Every token. Every dollar. I track it all."

import {
    getAllNodes,
    getClusterPower,
    getDb,
} from './db';

// =============================================================================
// Types
// =============================================================================

export interface HardwareCostEntry {
    nodeId: string;
    purchasePrice: number;
    purchaseDate: string;
    depreciationYears: number;       // default 3
}

export interface CostConfig {
    electricityCostPerKwh: number;   // default $0.12
    currency: string;                // default 'USD'
    hardwareCosts: HardwareCostEntry[];
}

export interface CostBreakdown {
    cost_per_million_tokens: number;
    breakdown: {
        electricity_pct: number;
        hardware_pct: number;
        overhead_pct: number;
    };
}

export interface CloudProvider {
    provider: string;
    cost_per_m_tokens: number;
    monthly_equivalent: number;
}

export interface CloudComparison {
    self_hosted: {
        monthly_cost: number;
        cost_per_million_tokens: number;
        tokens_served_this_month: number;
    };
    cloud_comparison: CloudProvider[];
    savings: Record<string, number>;
}

export interface NodeROI {
    nodeId: string;
    hardware_cost: number;
    monthly_savings: number;
    payback_days: number;
    roi_pct: number;
}

export interface HardwareROIResult {
    nodes: NodeROI[];
}

export interface BudgetConfig {
    monthly_limit: number;
}

export interface BudgetStatus {
    monthly_limit: number;
    current_spend: number;
    remaining: number;
    days_elapsed: number;
    days_in_month: number;
    projected_spend: number;
    projected_overage: number;
    on_track: boolean;
}

export interface PowerSnapshot {
    timestamp: string;
    watts: number;
}

export interface CostDashboard {
    current_power_watts: number;
    daily_electricity_cost: number;
    monthly_electricity_cost: number;
    yearly_electricity_cost: number;
    cost_per_million_tokens: number;
    cloud_savings_vs_openai: number;
    cloud_savings_vs_anthropic: number;
    cloud_savings_vs_together: number;
    cloud_savings_vs_runpod: number;
    hardware_roi_summary: {
        total_hardware_cost: number;
        avg_payback_days: number;
        avg_roi_pct: number;
    };
    budget: BudgetStatus | null;
    trend: 'increasing' | 'decreasing' | 'stable';
    currency: string;
}

// =============================================================================
// Module State
// =============================================================================

let costConfig: CostConfig = {
    electricityCostPerKwh: 0.12,
    currency: 'USD',
    hardwareCosts: [],
};

let budgetConfig: BudgetConfig | null = null;

// In-memory power history ring buffer — stores one sample per call (minute-level granularity)
const powerHistory: PowerSnapshot[] = [];
const MAX_POWER_HISTORY = 1440; // 24 hours at 1 sample/minute

// Track daily cost samples for trend detection
const dailyCostSamples: Array<{ date: string; cost: number }> = [];
const MAX_DAILY_SAMPLES = 90; // 3 months

// Cloud API pricing (cost per million tokens — output tokens, as of 2026)
const CLOUD_PRICING: Array<{ provider: string; key: string; cost_per_m_tokens: number }> = [
    { provider: 'OpenAI GPT-4o',      key: 'vs_openai',    cost_per_m_tokens: 2.50  },
    { provider: 'Anthropic Claude',    key: 'vs_anthropic', cost_per_m_tokens: 3.00  },
    { provider: 'Together AI Llama',   key: 'vs_together',  cost_per_m_tokens: 0.20  },
    { provider: 'RunPod vLLM',         key: 'vs_runpod',    cost_per_m_tokens: 0.10  },
];

// Overhead multiplier: accounts for cooling, networking, admin time, etc.
const OVERHEAD_MULTIPLIER = 0.10; // 10% overhead on top of electricity + hardware

// =============================================================================
// Helpers
// =============================================================================

/** Get the number of days in the current month. */
function daysInCurrentMonth(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/** Get how many days have elapsed this month (fractional). */
function daysElapsedThisMonth(): number {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return Math.max(1, (now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24));
}

/** Calculate monthly amortized hardware cost across all configured nodes. */
function getMonthlyHardwareAmortization(): number {
    let totalMonthly = 0;
    for (const entry of costConfig.hardwareCosts) {
        const monthlyAmort = entry.purchasePrice / (entry.depreciationYears * 12);
        totalMonthly += monthlyAmort;
    }
    return totalMonthly;
}

/** Round a number to N decimal places. */
function round(value: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/** Get total tokens served this month from the inference log. */
function getTokensServedThisMonth(): number {
    const d = getDb();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const since = startOfMonth.toISOString().replace('T', ' ').slice(0, 19);

    const row = d.prepare(`
        SELECT COALESCE(SUM(tokens_out), 0) as total
        FROM inference_log
        WHERE created_at >= ?
    `).get(since) as { total: number };

    return row.total;
}


// =============================================================================
// 1. Power Monitoring
// =============================================================================

/**
 * Get the total power draw across all online nodes in the cluster.
 *
 * Reads live GPU power draw from node stats and adds a system baseline
 * estimate (~100W per node for CPU, RAM, etc.).
 *
 * @returns Total watts drawn by the cluster.
 */
export function getClusterPowerDraw(): number {
    const power = getClusterPower();
    return power.total_watts;
}

/**
 * Get the power draw for a specific node.
 *
 * @param nodeId - The ID of the node to query.
 * @returns Watts drawn by the node, or 0 if the node is offline/unknown.
 */
export function getNodePowerDraw(nodeId: string): number {
    const power = getClusterPower();
    const nodeEntry = power.per_node.find(n => n.node_id === nodeId);
    return nodeEntry ? nodeEntry.watts : 0;
}

/**
 * Get power consumption history over the specified number of hours.
 *
 * Returns watt-hour estimates based on stored power snapshots.
 * Each snapshot represents the instantaneous wattage at the time it was taken.
 *
 * Also records the current power level into the history buffer for future queries.
 *
 * @param hours - Number of hours of history to return (max 24).
 * @returns Array of { timestamp, watts } snapshots and a total_wh estimate.
 */
export function getPowerHistory(hours: number = 24): {
    snapshots: PowerSnapshot[];
    total_wh: number;
    avg_watts: number;
} {
    // Record current power draw as a new snapshot
    const currentWatts = getClusterPowerDraw();
    const now = new Date().toISOString();
    powerHistory.push({ timestamp: now, watts: currentWatts });
    if (powerHistory.length > MAX_POWER_HISTORY) {
        powerHistory.shift();
    }

    // Filter to requested time window
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const relevant = powerHistory.filter(s => s.timestamp >= cutoff);

    if (relevant.length === 0) {
        return { snapshots: [], total_wh: 0, avg_watts: 0 };
    }

    // Estimate watt-hours: average watts * hours
    const avgWatts = relevant.reduce((sum, s) => sum + s.watts, 0) / relevant.length;

    // Actual time span covered by snapshots
    const firstTs = new Date(relevant[0].timestamp).getTime();
    const lastTs = new Date(relevant[relevant.length - 1].timestamp).getTime();
    const spanHours = Math.max((lastTs - firstTs) / 3600_000, 1 / 60); // at least 1 minute

    const totalWh = avgWatts * spanHours;

    return {
        snapshots: relevant,
        total_wh: round(totalWh, 1),
        avg_watts: round(avgWatts, 1),
    };
}

// =============================================================================
// 2. Electricity Cost Configuration
// =============================================================================

/**
 * Configure the cost parameters: electricity rate, currency, and hardware costs.
 *
 * @param config - Partial or full cost configuration to apply.
 */
export function setCostConfig(config: Partial<CostConfig>): void {
    if (config.electricityCostPerKwh !== undefined) {
        costConfig.electricityCostPerKwh = config.electricityCostPerKwh;
    }
    if (config.currency !== undefined) {
        costConfig.currency = config.currency;
    }
    if (config.hardwareCosts !== undefined) {
        costConfig.hardwareCosts = config.hardwareCosts.map(h => ({
            ...h,
            depreciationYears: h.depreciationYears || 3,
        }));
    }
}

/**
 * Get the current cost configuration.
 *
 * @returns A copy of the current CostConfig.
 */
export function getCostConfig(): CostConfig {
    return {
        ...costConfig,
        hardwareCosts: costConfig.hardwareCosts.map(h => ({ ...h })),
    };
}

// =============================================================================
// 3. Cost Per Token
// =============================================================================

/**
 * Calculate the all-in cost per token for your self-hosted cluster.
 *
 * The calculation:
 *   1. Monthly electricity cost = (total watts * 24 * 30 / 1000) * rate
 *   2. Monthly hardware cost = sum of (purchase_price / depreciation_months) per node
 *   3. Overhead = 10% of (electricity + hardware) for cooling, admin, networking
 *   4. Total monthly cost / tokens served this month = cost per token
 *
 * @returns Cost per million tokens and a percentage breakdown by category.
 */
export function getCostPerToken(): CostBreakdown {
    const power = getClusterPower();
    const monthlyElectricity = (power.total_watts * 24 * 30 / 1000) * costConfig.electricityCostPerKwh;
    const monthlyHardware = getMonthlyHardwareAmortization();
    const subtotal = monthlyElectricity + monthlyHardware;
    const overhead = subtotal * OVERHEAD_MULTIPLIER;
    const totalMonthlyCost = subtotal + overhead;

    const tokensThisMonth = getTokensServedThisMonth();

    // Avoid division by zero — if no tokens, show cost structure with zero CPM
    const costPerMillionTokens = tokensThisMonth > 0
        ? (totalMonthlyCost / tokensThisMonth) * 1_000_000
        : 0;

    // Calculate percentage breakdown
    const electricityPct = totalMonthlyCost > 0 ? round((monthlyElectricity / totalMonthlyCost) * 100, 1) : 0;
    const hardwarePct = totalMonthlyCost > 0 ? round((monthlyHardware / totalMonthlyCost) * 100, 1) : 0;
    const overheadPct = totalMonthlyCost > 0 ? round((overhead / totalMonthlyCost) * 100, 1) : 0;

    return {
        cost_per_million_tokens: round(costPerMillionTokens, 4),
        breakdown: {
            electricity_pct: electricityPct,
            hardware_pct: hardwarePct,
            overhead_pct: overheadPct,
        },
    };
}

// =============================================================================
// 4. Cloud Comparison
// =============================================================================

/**
 * Compare your self-hosted cluster costs against major cloud API providers.
 *
 * Calculates what it would cost to serve the same volume of tokens through
 * each provider, and how much you save (or not) by self-hosting.
 *
 * @returns Self-hosted costs, cloud equivalents, and savings amounts.
 */
export function getCloudComparison(): CloudComparison {
    const power = getClusterPower();
    const monthlyElectricity = (power.total_watts * 24 * 30 / 1000) * costConfig.electricityCostPerKwh;
    const monthlyHardware = getMonthlyHardwareAmortization();
    const overhead = (monthlyElectricity + monthlyHardware) * OVERHEAD_MULTIPLIER;
    const monthlyCost = round(monthlyElectricity + monthlyHardware + overhead, 2);

    const tokensThisMonth = getTokensServedThisMonth();
    const selfCostPerMTokens = tokensThisMonth > 0
        ? round((monthlyCost / tokensThisMonth) * 1_000_000, 4)
        : 0;

    // Calculate cloud equivalents
    const cloudComparison: CloudProvider[] = CLOUD_PRICING.map(cp => ({
        provider: cp.provider,
        cost_per_m_tokens: cp.cost_per_m_tokens,
        monthly_equivalent: round((tokensThisMonth / 1_000_000) * cp.cost_per_m_tokens, 2),
    }));

    // Calculate savings
    const savings: Record<string, number> = {};
    for (const cp of CLOUD_PRICING) {
        const cloudMonthly = (tokensThisMonth / 1_000_000) * cp.cost_per_m_tokens;
        savings[cp.key] = round(cloudMonthly - monthlyCost, 2);
    }

    return {
        self_hosted: {
            monthly_cost: monthlyCost,
            cost_per_million_tokens: selfCostPerMTokens,
            tokens_served_this_month: tokensThisMonth,
        },
        cloud_comparison: cloudComparison,
        savings,
    };
}

// =============================================================================
// 5. Hardware ROI
// =============================================================================

/**
 * Calculate return on investment for each node with configured hardware costs.
 *
 * ROI is measured against the cloud cost that would be needed to serve the
 * same token volume. Uses the highest-cost cloud provider (OpenAI GPT-4o)
 * as the baseline for maximum savings.
 *
 * @returns Per-node ROI including payback period and ROI percentage.
 */
export function getHardwareROI(): HardwareROIResult {
    const power = getClusterPower();
    const tokensThisMonth = getTokensServedThisMonth();
    const nodes = getAllNodes().filter(n => n.status === 'online');
    const onlineNodeCount = nodes.length;

    // Fair share of tokens per node (proportional to GPU count)
    const totalGpus = nodes.reduce((s, n) => s + (n.latest_stats?.gpu_count || 0), 0);

    // Baseline cloud cost per million tokens (use Together AI — more realistic for local models)
    const baselineCloudCPM = CLOUD_PRICING[0].cost_per_m_tokens; // OpenAI as high-water mark

    const nodeROIs: NodeROI[] = [];

    for (const hwEntry of costConfig.hardwareCosts) {
        const node = nodes.find(n => n.id === hwEntry.nodeId);
        const nodeGpus = node?.latest_stats?.gpu_count || 1;

        // This node's fair share of tokens
        const tokenShare = totalGpus > 0
            ? tokensThisMonth * (nodeGpus / totalGpus)
            : (onlineNodeCount > 0 ? tokensThisMonth / onlineNodeCount : 0);

        // This node's electricity cost
        const powerEntry = power.per_node.find(p => p.node_id === hwEntry.nodeId);
        const nodeWatts = powerEntry ? powerEntry.watts : 0;
        const nodeMonthlyElectricity = (nodeWatts * 24 * 30 / 1000) * costConfig.electricityCostPerKwh;
        const nodeMonthlyHardware = hwEntry.purchasePrice / (hwEntry.depreciationYears * 12);
        const nodeMonthlyCost = nodeMonthlyElectricity + nodeMonthlyHardware;

        // Cloud equivalent cost for this node's share of tokens
        const cloudEquivalent = (tokenShare / 1_000_000) * baselineCloudCPM;

        // Monthly savings vs cloud
        const monthlySavings = round(Math.max(0, cloudEquivalent - nodeMonthlyCost), 2);

        // Payback period: how many days until hardware is paid off by savings
        const paybackDays = monthlySavings > 0
            ? Math.ceil(hwEntry.purchasePrice / (monthlySavings / 30))
            : Infinity;

        // ROI over the depreciation period
        // Total savings over life = monthly_savings * depreciation_months
        // ROI% = ((total_savings - hardware_cost) / hardware_cost) * 100
        const totalLifeSavings = monthlySavings * hwEntry.depreciationYears * 12;
        const roiPct = hwEntry.purchasePrice > 0
            ? round(((totalLifeSavings - hwEntry.purchasePrice) / hwEntry.purchasePrice) * 100, 0)
            : 0;

        nodeROIs.push({
            nodeId: hwEntry.nodeId,
            hardware_cost: hwEntry.purchasePrice,
            monthly_savings: monthlySavings,
            payback_days: paybackDays === Infinity ? -1 : paybackDays,
            roi_pct: roiPct,
        });
    }

    return { nodes: nodeROIs };
}

// =============================================================================
// 6. Budget Management
// =============================================================================

/**
 * Set a monthly cost budget for the cluster.
 *
 * The budget tracks electricity costs plus hardware amortization.
 *
 * @param monthlyLimit - Maximum monthly spend allowed.
 */
export function setBudget(monthlyLimit: number): void {
    budgetConfig = { monthly_limit: monthlyLimit };
}

/**
 * Get the current budget status including spend-to-date and projections.
 *
 * @returns Budget status with current spend, projected overage, and on-track flag.
 *          Returns null if no budget has been set.
 */
export function getBudgetStatus(): BudgetStatus | null {
    if (!budgetConfig) return null;

    const power = getClusterPower();
    const daysElapsed = daysElapsedThisMonth();
    const daysTotal = daysInCurrentMonth();

    // Current month's electricity spend (based on actual power draw extrapolated)
    const dailyElectricity = (power.total_watts * 24 / 1000) * costConfig.electricityCostPerKwh;
    const electricitySoFar = dailyElectricity * daysElapsed;

    // Hardware amortization accrued so far this month
    const monthlyHardware = getMonthlyHardwareAmortization();
    const hardwareSoFar = monthlyHardware * (daysElapsed / daysTotal);

    // Overhead
    const currentSpendRaw = electricitySoFar + hardwareSoFar;
    const overhead = currentSpendRaw * OVERHEAD_MULTIPLIER;
    const currentSpend = round(currentSpendRaw + overhead, 2);

    // Project to end of month at current rate
    const dailyRate = daysElapsed > 0 ? currentSpend / daysElapsed : 0;
    const projectedSpend = round(dailyRate * daysTotal, 2);
    const projectedOverage = round(Math.max(0, projectedSpend - budgetConfig.monthly_limit), 2);

    return {
        monthly_limit: budgetConfig.monthly_limit,
        current_spend: currentSpend,
        remaining: round(Math.max(0, budgetConfig.monthly_limit - currentSpend), 2),
        days_elapsed: round(daysElapsed, 1),
        days_in_month: daysTotal,
        projected_spend: projectedSpend,
        projected_overage: projectedOverage,
        on_track: projectedSpend <= budgetConfig.monthly_limit,
    };
}

/**
 * Check whether the cluster should throttle requests to stay within budget.
 *
 * Returns true if the projected monthly spend exceeds the configured budget.
 * Returns false if no budget is set.
 *
 * @returns true if throttling is recommended; false otherwise.
 */
export function shouldThrottle(): boolean {
    const status = getBudgetStatus();
    if (!status) return false;
    return status.projected_overage > 0;
}

// =============================================================================
// 7. Cost Dashboard Data
// =============================================================================

/**
 * Get a comprehensive cost dashboard summary suitable for a UI widget.
 *
 * Aggregates:
 *   - Live power draw
 *   - Daily / monthly / yearly electricity costs
 *   - Self-hosted cost per token
 *   - Cloud savings comparisons
 *   - Hardware ROI summary
 *   - Budget status
 *   - Cost trend (increasing / decreasing / stable)
 *
 * @returns Everything needed for a cost dashboard in one call.
 */
export function getCostDashboard(): CostDashboard {
    const power = getClusterPower();
    const costPerToken = getCostPerToken();
    const cloudComp = getCloudComparison();
    const roi = getHardwareROI();
    const budget = getBudgetStatus();

    // Electricity costs at different time scales
    const dailyElectricity = (power.total_watts * 24 / 1000) * costConfig.electricityCostPerKwh;
    const monthlyElectricity = dailyElectricity * 30;
    const yearlyElectricity = dailyElectricity * 365;

    // ROI summary
    const roiNodes = roi.nodes;
    const totalHardwareCost = roiNodes.reduce((s, n) => s + n.hardware_cost, 0);
    const avgPaybackDays = roiNodes.length > 0
        ? Math.round(roiNodes.filter(n => n.payback_days >= 0).reduce((s, n) => s + n.payback_days, 0)
            / Math.max(1, roiNodes.filter(n => n.payback_days >= 0).length))
        : 0;
    const avgRoiPct = roiNodes.length > 0
        ? Math.round(roiNodes.reduce((s, n) => s + n.roi_pct, 0) / roiNodes.length)
        : 0;

    // Determine cost trend from daily samples
    const today = new Date().toISOString().slice(0, 10);
    const existingToday = dailyCostSamples.find(s => s.date === today);
    if (existingToday) {
        existingToday.cost = dailyElectricity;
    } else {
        dailyCostSamples.push({ date: today, cost: dailyElectricity });
        if (dailyCostSamples.length > MAX_DAILY_SAMPLES) {
            dailyCostSamples.shift();
        }
    }

    const trend = determineTrend();

    return {
        current_power_watts: power.total_watts,
        daily_electricity_cost: round(dailyElectricity, 2),
        monthly_electricity_cost: round(monthlyElectricity, 2),
        yearly_electricity_cost: round(yearlyElectricity, 2),
        cost_per_million_tokens: costPerToken.cost_per_million_tokens,
        cloud_savings_vs_openai: cloudComp.savings['vs_openai'] || 0,
        cloud_savings_vs_anthropic: cloudComp.savings['vs_anthropic'] || 0,
        cloud_savings_vs_together: cloudComp.savings['vs_together'] || 0,
        cloud_savings_vs_runpod: cloudComp.savings['vs_runpod'] || 0,
        hardware_roi_summary: {
            total_hardware_cost: totalHardwareCost,
            avg_payback_days: avgPaybackDays,
            avg_roi_pct: avgRoiPct,
        },
        budget,
        trend,
        currency: costConfig.currency,
    };
}

/**
 * Determine the cost trend based on recent daily samples.
 *
 * Compares the average of the last 3 days to the average of the 3 days before that.
 * If insufficient data, returns 'stable'.
 */
function determineTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (dailyCostSamples.length < 4) return 'stable';

    const recent = dailyCostSamples.slice(-3);
    const prior = dailyCostSamples.slice(-6, -3);

    if (prior.length === 0) return 'stable';

    const recentAvg = recent.reduce((s, d) => s + d.cost, 0) / recent.length;
    const priorAvg = prior.reduce((s, d) => s + d.cost, 0) / prior.length;

    // Use a 5% threshold to avoid noise
    const changeRatio = priorAvg > 0 ? (recentAvg - priorAvg) / priorAvg : 0;

    if (changeRatio > 0.05) return 'increasing';
    if (changeRatio < -0.05) return 'decreasing';
    return 'stable';
}
