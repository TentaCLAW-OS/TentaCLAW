// F:\tentaclaw-os\gateway\src\cloud-burst.ts
// Cloud Burst — Overflow to Cloud When Local is Full
// TentaCLAW says: "My cluster is full? Fine. I'll rent some muscle."

/**
 * TentaCLAW Gateway — Cloud Burst System
 *
 * When local GPU capacity is exhausted, overflow inference requests to
 * cloud GPU providers (RunPod, Lambda, Together, Groq, OpenRouter, etc.).
 * Tracks cost, enforces budgets, and reports savings vs 100% cloud.
 *
 * Self-hosted. No SaaS. Your data stays on your hardware (unless you burst).
 * TentaCLAW says: "Local first. Cloud when desperate. Always in control."
 */

import { getAllNodes, getInferenceAnalytics } from './db';

// =============================================================================
// Public Types
// =============================================================================

export interface CloudProvider {
    name: string;
    type: 'runpod' | 'lambda' | 'together' | 'groq' | 'openrouter' | 'custom';
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
    priority: number;      // lower = try first
    costPerMToken: number; // cost per million tokens (USD)
    models: string[];      // supported models
    maxConcurrent: number;
}

export interface BurstPolicy {
    enabled: boolean;
    triggerConditions: {
        queueDepth?: number;          // burst when queue > N
        utilizationPct?: number;       // burst when GPU util > N%
        latencyP95Ms?: number;         // burst when p95 > N ms
        allNodesAtCapacity?: boolean;  // burst when no VRAM headroom
    };
    maxCostPerHour: number;           // cost cap (USD)
    maxCostPerDay: number;            // daily cost cap (USD)
    preferLocal: boolean;             // always try local first
    fallbackOrder: string[];          // provider names in priority order
}

export interface BurstDecision {
    burst: boolean;
    reason: string;
    provider: string;
}

export interface BurstEvent {
    id: string;
    timestamp: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    cost: number;
    success: boolean;
    error?: string;
}

export interface BurstStats {
    totalBurstRequests: number;
    totalCost: number;
    costThisHour: number;
    costToday: number;
    requestsByProvider: Record<string, number>;
    costByProvider: Record<string, number>;
    avgLatencyMs: number;
    successRate: number;
}

export interface CloudSavingsReport {
    periodDays: number;
    localRequests: number;
    cloudRequests: number;
    localPct: number;
    cloudPct: number;
    cloudCost: number;
    estimatedFullCloudCost: number;
    savings: number;
    savingsPct: number;
    summary: string;
}

// =============================================================================
// Internal Types
// =============================================================================

/** Tracks active concurrent requests per provider. */
interface ProviderConcurrency {
    active: number;
}

/** Cluster snapshot used for trigger evaluation. */
interface ClusterSnapshot {
    queueDepth: number;
    avgGpuUtilPct: number;
    latencyP95Ms: number;
    allAtCapacity: boolean;
    onlineNodes: number;
}

// =============================================================================
// Module State
// =============================================================================

/** Registered cloud providers keyed by name. */
const providers = new Map<string, CloudProvider>();

/** Current burst policy. */
let policy: BurstPolicy = {
    enabled: false,
    triggerConditions: {
        queueDepth: 10,
        utilizationPct: 95,
        latencyP95Ms: 5000,
        allNodesAtCapacity: true,
    },
    maxCostPerHour: 5.00,
    maxCostPerDay: 50.00,
    preferLocal: true,
    fallbackOrder: [],
};

/** Burst event history. */
const burstHistory: BurstEvent[] = [];

/** Per-provider concurrency tracking. */
const concurrency = new Map<string, ProviderConcurrency>();

/** Maximum burst events retained in memory. */
const MAX_BURST_HISTORY = 2000;

/** Counter for generating event IDs. */
let eventCounter = 0;

// =============================================================================
// Helpers
// =============================================================================

/** ISO timestamp for the current time. */
function nowISO(): string {
    return new Date().toISOString();
}

/** Generate a unique burst event ID. */
function nextEventId(): string {
    eventCounter += 1;
    return `burst-${Date.now()}-${eventCounter}`;
}

/** Trim burst history to maximum size. */
function trimHistory(): void {
    if (burstHistory.length > MAX_BURST_HISTORY) {
        burstHistory.splice(0, burstHistory.length - MAX_BURST_HISTORY);
    }
}

/** Get events within a time window (ms from now). */
function eventsInWindow(windowMs: number): BurstEvent[] {
    const cutoff = Date.now() - windowMs;
    return burstHistory.filter(e => new Date(e.timestamp).getTime() >= cutoff);
}

/** Sum cost of events in a time window. */
function costInWindow(windowMs: number): number {
    return eventsInWindow(windowMs).reduce((sum, e) => sum + e.cost, 0);
}

/** Get active concurrency for a provider. */
function getProviderConcurrency(name: string): number {
    return concurrency.get(name)?.active ?? 0;
}

/** Increment active concurrency for a provider. */
function incrementConcurrency(name: string): void {
    const entry = concurrency.get(name);
    if (entry) {
        entry.active += 1;
    } else {
        concurrency.set(name, { active: 1 });
    }
}

/** Decrement active concurrency for a provider. */
function decrementConcurrency(name: string): void {
    const entry = concurrency.get(name);
    if (entry && entry.active > 0) {
        entry.active -= 1;
    }
}

/**
 * Capture a snapshot of current cluster state for trigger evaluation.
 *
 * Uses the database layer to gather live stats from registered nodes.
 */
function captureClusterSnapshot(): ClusterSnapshot {
    const nodes = getAllNodes();
    const online = nodes.filter(n => n.status === 'online' && n.latest_stats);

    // Queue depth: sum of in-flight requests across all nodes
    let totalInFlight = 0;
    let totalGpuUtil = 0;
    let gpuCount = 0;
    let allAtCapacity = online.length > 0;

    for (const node of online) {
        const stats = node.latest_stats;
        if (!stats) continue;

        totalInFlight += stats.inference.in_flight_requests;

        for (const gpu of stats.gpus) {
            totalGpuUtil += gpu.utilizationPct;
            gpuCount += 1;
            // A GPU has headroom if < 90% VRAM used
            const vramPct = gpu.vramTotalMb > 0
                ? (gpu.vramUsedMb / gpu.vramTotalMb) * 100
                : 100;
            if (vramPct < 90) {
                allAtCapacity = false;
            }
        }
    }

    const avgGpuUtil = gpuCount > 0 ? totalGpuUtil / gpuCount : 0;

    // Get p95 latency from inference analytics (last 1 hour)
    const analytics = getInferenceAnalytics(1);

    return {
        queueDepth: totalInFlight,
        avgGpuUtilPct: avgGpuUtil,
        latencyP95Ms: analytics.p95_latency_ms,
        allAtCapacity,
        onlineNodes: online.length,
    };
}

/**
 * Build the base URL for a provider's chat completions endpoint.
 *
 * Different providers use slightly different paths. This normalises them.
 */
function buildCompletionsUrl(provider: CloudProvider): string {
    const base = provider.baseUrl.replace(/\/+$/, '');

    switch (provider.type) {
        case 'groq':
            // Groq uses OpenAI-compatible /v1/chat/completions
            return `${base}/openai/v1/chat/completions`;
        case 'together':
        case 'openrouter':
        case 'runpod':
        case 'lambda':
        case 'custom':
        default:
            // Most providers are OpenAI-compatible
            return `${base}/v1/chat/completions`;
    }
}

/**
 * Build request headers for a given provider.
 */
function buildHeaders(provider: CloudProvider): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    switch (provider.type) {
        case 'openrouter':
            headers['Authorization'] = `Bearer ${provider.apiKey}`;
            headers['HTTP-Referer'] = 'https://tentaclaw.io';
            headers['X-Title'] = 'TentaCLAW Cloud Burst';
            break;
        default:
            headers['Authorization'] = `Bearer ${provider.apiKey}`;
            break;
    }

    return headers;
}

/**
 * Resolve a model name to the provider-specific model ID.
 *
 * For now, passes through as-is. Future: add model mapping tables.
 */
function resolveProviderModel(provider: CloudProvider, model: string): string | null {
    // Check if provider explicitly lists this model
    if (provider.models.length > 0) {
        // Exact match
        if (provider.models.includes(model)) return model;
        // Substring match (e.g., "llama3.1:70b" matches "meta-llama/llama-3.1-70b")
        const fuzzy = provider.models.find(m =>
            m.toLowerCase().includes(model.toLowerCase().replace(/[.:]/g, '-')) ||
            model.toLowerCase().includes(m.toLowerCase().replace(/[/\-]/g, ''))
        );
        if (fuzzy) return fuzzy;
        return null;
    }
    // If no model list configured, assume the provider can handle it
    return model;
}

/**
 * Select the best available provider for a given model.
 *
 * Respects priority, concurrency limits, enablement, and model support.
 * Uses fallbackOrder from policy if set, otherwise sorts by priority.
 */
function selectProvider(model: string): CloudProvider | null {
    const ordered = getOrderedProviders();

    for (const provider of ordered) {
        if (!provider.enabled) continue;

        // Check model support
        const resolved = resolveProviderModel(provider, model);
        if (!resolved) continue;

        // Check concurrency limit
        if (getProviderConcurrency(provider.name) >= provider.maxConcurrent) continue;

        return provider;
    }

    return null;
}

/**
 * Get providers ordered by policy fallbackOrder then by priority.
 */
function getOrderedProviders(): CloudProvider[] {
    const all = Array.from(providers.values());

    if (policy.fallbackOrder.length > 0) {
        const ordered: CloudProvider[] = [];
        const seen = new Set<string>();

        // First add providers in fallbackOrder
        for (const name of policy.fallbackOrder) {
            const p = providers.get(name);
            if (p) {
                ordered.push(p);
                seen.add(name);
            }
        }
        // Then add any remaining providers sorted by priority
        for (const p of all.sort((a, b) => a.priority - b.priority)) {
            if (!seen.has(p.name)) {
                ordered.push(p);
            }
        }
        return ordered;
    }

    return all.sort((a, b) => a.priority - b.priority);
}

/**
 * Estimate token count from messages (rough approximation).
 *
 * Uses ~4 characters per token as a reasonable default for English text.
 * Exported so callers can use it for cost estimation before routing.
 */
export function estimateTokensFromMessages(messages: Array<{ role: string; content: string }>): number {
    let chars = 0;
    for (const msg of messages) {
        chars += (msg.role?.length ?? 0) + (typeof msg.content === 'string' ? msg.content.length : 0);
    }
    return Math.ceil(chars / 4);
}

/**
 * Extract token counts from an OpenAI-format completion response.
 */
function extractTokenCounts(result: Record<string, unknown>): { tokensIn: number; tokensOut: number } {
    const usage = result.usage as Record<string, number> | undefined;
    if (usage) {
        return {
            tokensIn: usage.prompt_tokens ?? 0,
            tokensOut: usage.completion_tokens ?? 0,
        };
    }
    return { tokensIn: 0, tokensOut: 0 };
}

// =============================================================================
// Provider Management
// =============================================================================

/**
 * Register a cloud provider for burst overflow.
 *
 * If a provider with the same name already exists, it is replaced.
 */
export function addCloudProvider(config: CloudProvider): void {
    providers.set(config.name, { ...config });
}

/**
 * Remove a registered cloud provider by name.
 *
 * Returns true if the provider was found and removed, false otherwise.
 */
export function removeCloudProvider(name: string): boolean {
    concurrency.delete(name);
    return providers.delete(name);
}

/**
 * List all registered cloud providers.
 *
 * API keys are masked for security (only last 4 characters shown).
 */
export function listCloudProviders(): Array<CloudProvider & { activeConcurrent: number }> {
    return Array.from(providers.values())
        .sort((a, b) => a.priority - b.priority)
        .map(p => ({
            ...p,
            apiKey: p.apiKey.length > 4
                ? '****' + p.apiKey.slice(-4)
                : '****',
            activeConcurrent: getProviderConcurrency(p.name),
        }));
}

// =============================================================================
// Burst Policy Management
// =============================================================================

/**
 * Configure the burst policy.
 *
 * Merges with defaults; unspecified fields retain current values.
 */
export function setBurstPolicy(update: Partial<BurstPolicy>): BurstPolicy {
    if (update.enabled !== undefined) policy.enabled = update.enabled;
    if (update.maxCostPerHour !== undefined) policy.maxCostPerHour = update.maxCostPerHour;
    if (update.maxCostPerDay !== undefined) policy.maxCostPerDay = update.maxCostPerDay;
    if (update.preferLocal !== undefined) policy.preferLocal = update.preferLocal;
    if (update.fallbackOrder !== undefined) policy.fallbackOrder = update.fallbackOrder;
    if (update.triggerConditions) {
        policy.triggerConditions = {
            ...policy.triggerConditions,
            ...update.triggerConditions,
        };
    }
    return { ...policy };
}

/**
 * Get the current burst policy.
 */
export function getBurstPolicy(): BurstPolicy {
    return { ...policy };
}

// =============================================================================
// Burst Decision Engine
// =============================================================================

/**
 * Evaluate trigger conditions and determine whether to burst to cloud.
 *
 * Checks:
 * 1. Is bursting enabled?
 * 2. Are any trigger conditions met?
 * 3. Are cost caps respected?
 * 4. Is a suitable provider available?
 *
 * Returns a decision with reason and recommended provider.
 */
export function shouldBurst(model?: string): BurstDecision {
    const noBurst: BurstDecision = { burst: false, reason: '', provider: '' };

    // Gate: policy must be enabled
    if (!policy.enabled) {
        return { ...noBurst, reason: 'Burst policy is disabled' };
    }

    // Gate: must have at least one provider configured
    if (providers.size === 0) {
        return { ...noBurst, reason: 'No cloud providers configured' };
    }

    // Check cost caps
    const hourCost = costInWindow(60 * 60 * 1000);
    if (hourCost >= policy.maxCostPerHour) {
        return { ...noBurst, reason: `Hourly cost cap reached ($${hourCost.toFixed(2)} / $${policy.maxCostPerHour.toFixed(2)})` };
    }

    const dayCost = costInWindow(24 * 60 * 60 * 1000);
    if (dayCost >= policy.maxCostPerDay) {
        return { ...noBurst, reason: `Daily cost cap reached ($${dayCost.toFixed(2)} / $${policy.maxCostPerDay.toFixed(2)})` };
    }

    // Capture cluster state
    const snapshot = captureClusterSnapshot();
    const conditions = policy.triggerConditions;
    const triggers: string[] = [];

    // Evaluate each trigger condition
    if (conditions.queueDepth !== undefined && snapshot.queueDepth > conditions.queueDepth) {
        triggers.push(`Queue depth ${snapshot.queueDepth} > ${conditions.queueDepth}`);
    }

    if (conditions.utilizationPct !== undefined && snapshot.avgGpuUtilPct > conditions.utilizationPct) {
        triggers.push(`GPU utilization ${snapshot.avgGpuUtilPct.toFixed(1)}% > ${conditions.utilizationPct}%`);
    }

    if (conditions.latencyP95Ms !== undefined && snapshot.latencyP95Ms > conditions.latencyP95Ms) {
        triggers.push(`P95 latency ${snapshot.latencyP95Ms}ms > ${conditions.latencyP95Ms}ms`);
    }

    if (conditions.allNodesAtCapacity && snapshot.allAtCapacity && snapshot.onlineNodes > 0) {
        triggers.push('All nodes at VRAM capacity');
    }

    // No triggers fired
    if (triggers.length === 0) {
        return { ...noBurst, reason: 'No trigger conditions met' };
    }

    // Find a suitable provider
    const provider = selectProvider(model ?? '');
    if (!provider) {
        return {
            ...noBurst,
            reason: `Triggers fired (${triggers.join('; ')}) but no suitable provider available`,
        };
    }

    return {
        burst: true,
        reason: triggers.join('; '),
        provider: provider.name,
    };
}

// =============================================================================
// Cloud Request Routing
// =============================================================================

/**
 * Send an inference request to a specific cloud provider.
 *
 * Formats the request in OpenAI-compatible chat completions format.
 * Returns the response in the same format, enriched with burst metadata.
 */
export async function routeToCloud(
    providerName: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: {
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        stop?: string | string[];
        stream?: boolean;
        tools?: unknown[];
        tool_choice?: unknown;
        response_format?: unknown;
        seed?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
    },
): Promise<Record<string, unknown>> {
    const provider = providers.get(providerName);
    if (!provider) {
        throw new Error(`Cloud provider "${providerName}" not found`);
    }
    if (!provider.enabled) {
        throw new Error(`Cloud provider "${providerName}" is disabled`);
    }

    // Resolve model name for this provider
    const resolvedModel = resolveProviderModel(provider, model);
    if (!resolvedModel) {
        throw new Error(`Provider "${providerName}" does not support model "${model}"`);
    }

    // Check concurrency
    if (getProviderConcurrency(providerName) >= provider.maxConcurrent) {
        throw new Error(`Provider "${providerName}" at max concurrency (${provider.maxConcurrent})`);
    }

    // Build the request body in OpenAI format
    const body: Record<string, unknown> = {
        model: resolvedModel,
        messages,
        stream: false, // Cloud burst does not support streaming (yet)
    };

    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.top_p !== undefined) body.top_p = options.top_p;
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options?.stop !== undefined) body.stop = options.stop;
    if (options?.seed !== undefined) body.seed = options.seed;
    if (options?.frequency_penalty !== undefined) body.frequency_penalty = options.frequency_penalty;
    if (options?.presence_penalty !== undefined) body.presence_penalty = options.presence_penalty;
    if (options?.tools && Array.isArray(options.tools) && options.tools.length > 0) body.tools = options.tools;
    if (options?.tool_choice !== undefined) body.tool_choice = options.tool_choice;
    if (options?.response_format !== undefined) body.response_format = options.response_format;

    const url = buildCompletionsUrl(provider);
    const headers = buildHeaders(provider);
    const startTime = Date.now();

    incrementConcurrency(providerName);

    const event: BurstEvent = {
        id: nextEventId(),
        timestamp: nowISO(),
        provider: providerName,
        model: resolvedModel,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        cost: 0,
        success: false,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        const latencyMs = Date.now() - startTime;
        event.latencyMs = latencyMs;

        if (!response.ok) {
            const errText = await response.text();
            event.error = `HTTP ${response.status}: ${errText.slice(0, 500)}`;
            burstHistory.push(event);
            trimHistory();
            throw new Error(`Cloud provider "${providerName}" returned ${response.status}: ${errText.slice(0, 200)}`);
        }

        const result = await response.json() as Record<string, unknown>;
        const tokens = extractTokenCounts(result);
        event.tokensIn = tokens.tokensIn;
        event.tokensOut = tokens.tokensOut;
        event.success = true;

        // Calculate cost
        const totalTokens = tokens.tokensIn + tokens.tokensOut;
        event.cost = (totalTokens / 1_000_000) * provider.costPerMToken;

        burstHistory.push(event);
        trimHistory();

        // Enrich response with burst metadata
        const enriched = { ...result };
        (enriched as Record<string, unknown>)._tentaclaw = {
            burst: true,
            provider: providerName,
            cost: event.cost,
            latency_ms: latencyMs,
            local_exhausted: true,
        };

        return enriched;
    } catch (err) {
        if (!event.error) {
            event.error = err instanceof Error ? err.message : String(err);
        }
        if (!burstHistory.includes(event)) {
            burstHistory.push(event);
            trimHistory();
        }
        throw err;
    } finally {
        decrementConcurrency(providerName);
    }
}

// =============================================================================
// Integration: handleBurstRequest
// =============================================================================

/**
 * Handle a burst request — called when local routing fails.
 *
 * Tries cloud providers in priority order until one succeeds.
 * Returns an OpenAI-compatible response or throws if all providers fail.
 */
export async function handleBurstRequest(
    model: string,
    body: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        stop?: string | string[];
        stream?: boolean;
        tools?: unknown[];
        tool_choice?: unknown;
        response_format?: unknown;
        seed?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
    },
): Promise<Record<string, unknown>> {
    // Check if we should burst at all
    const decision = shouldBurst(model);
    if (!decision.burst) {
        throw new Error(`Cloud burst denied: ${decision.reason}`);
    }

    // Try providers in order
    const ordered = getOrderedProviders();
    const errors: string[] = [];

    for (const provider of ordered) {
        if (!provider.enabled) continue;

        // Check model support
        const resolved = resolveProviderModel(provider, model);
        if (!resolved) continue;

        // Check concurrency
        if (getProviderConcurrency(provider.name) >= provider.maxConcurrent) {
            errors.push(`${provider.name}: at max concurrency`);
            continue;
        }

        try {
            const result = await routeToCloud(provider.name, model, body.messages, {
                temperature: body.temperature,
                top_p: body.top_p,
                max_tokens: body.max_tokens,
                stop: body.stop,
                stream: body.stream,
                tools: body.tools,
                tool_choice: body.tool_choice,
                response_format: body.response_format,
                seed: body.seed,
                frequency_penalty: body.frequency_penalty,
                presence_penalty: body.presence_penalty,
            });
            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${provider.name}: ${msg}`);
        }
    }

    throw new Error(
        `All cloud providers failed for model "${model}". Errors: ${errors.join(' | ')}`,
    );
}

// =============================================================================
// Statistics & Reporting
// =============================================================================

/**
 * Get burst statistics: requests, cost, provider breakdown.
 */
export function getBurstStats(): BurstStats {
    const hourEvents = eventsInWindow(60 * 60 * 1000);
    const dayEvents = eventsInWindow(24 * 60 * 60 * 1000);

    const requestsByProvider: Record<string, number> = {};
    const costByProvider: Record<string, number> = {};
    let totalLatency = 0;
    let successCount = 0;

    for (const event of burstHistory) {
        requestsByProvider[event.provider] = (requestsByProvider[event.provider] ?? 0) + 1;
        costByProvider[event.provider] = (costByProvider[event.provider] ?? 0) + event.cost;
        totalLatency += event.latencyMs;
        if (event.success) successCount += 1;
    }

    return {
        totalBurstRequests: burstHistory.length,
        totalCost: burstHistory.reduce((sum, e) => sum + e.cost, 0),
        costThisHour: hourEvents.reduce((sum, e) => sum + e.cost, 0),
        costToday: dayEvents.reduce((sum, e) => sum + e.cost, 0),
        requestsByProvider,
        costByProvider,
        avgLatencyMs: burstHistory.length > 0
            ? Math.round(totalLatency / burstHistory.length)
            : 0,
        successRate: burstHistory.length > 0
            ? successCount / burstHistory.length
            : 1,
    };
}

/**
 * Get recent burst events.
 */
export function getBurstHistory(limit: number = 50): BurstEvent[] {
    const start = Math.max(0, burstHistory.length - limit);
    return burstHistory.slice(start).reverse();
}

// =============================================================================
// Cost Estimation & Savings
// =============================================================================

/**
 * Estimate the cost of sending a request to a cloud provider.
 *
 * @param model — Model name (used to find cheapest provider)
 * @param tokens — Estimated total tokens (input + output)
 * @returns Cost estimates per provider, sorted cheapest first
 */
export function estimateCloudCost(
    model: string,
    tokens: number,
): Array<{ provider: string; cost: number; costPerMToken: number }> {
    const estimates: Array<{ provider: string; cost: number; costPerMToken: number }> = [];

    for (const provider of providers.values()) {
        if (!provider.enabled) continue;

        const resolved = resolveProviderModel(provider, model);
        if (!resolved) continue;

        const cost = (tokens / 1_000_000) * provider.costPerMToken;
        estimates.push({
            provider: provider.name,
            cost,
            costPerMToken: provider.costPerMToken,
        });
    }

    return estimates.sort((a, b) => a.cost - b.cost);
}

/**
 * Generate a savings report comparing local-first with 100% cloud.
 *
 * Uses inference analytics to count total requests, then estimates
 * what it would cost if all requests had been sent to cloud.
 */
export function getCloudSavingsReport(periodDays: number = 30): CloudSavingsReport {
    // Get total requests from inference analytics
    const hours = periodDays * 24;
    const analytics = getInferenceAnalytics(hours);

    const totalRequests = analytics.total_requests;
    const cloudRequests = burstHistory.filter(e => {
        const age = Date.now() - new Date(e.timestamp).getTime();
        return age <= periodDays * 24 * 60 * 60 * 1000;
    }).length;
    const localRequests = totalRequests - cloudRequests;

    // Actual cloud cost
    const cloudCost = burstHistory
        .filter(e => {
            const age = Date.now() - new Date(e.timestamp).getTime();
            return age <= periodDays * 24 * 60 * 60 * 1000;
        })
        .reduce((sum, e) => sum + e.cost, 0);

    // Estimate what 100% cloud would cost
    // Use average tokens per request from analytics
    const totalTokens = analytics.total_tokens_in + analytics.total_tokens_out;
    const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 500;

    // Find the cheapest provider for cost estimation
    const allProviders = Array.from(providers.values()).filter(p => p.enabled);
    const cheapestRate = allProviders.length > 0
        ? Math.min(...allProviders.map(p => p.costPerMToken))
        : 1.0; // Default $1/M tokens if no providers configured

    const estimatedFullCloudCost = (totalRequests * avgTokensPerRequest / 1_000_000) * cheapestRate;
    const savings = estimatedFullCloudCost - cloudCost;

    const localPct = totalRequests > 0
        ? Math.round((localRequests / totalRequests) * 100)
        : 100;
    const cloudPct = totalRequests > 0
        ? Math.round((cloudRequests / totalRequests) * 100)
        : 0;

    const summary = totalRequests > 0
        ? `This month: ${localPct}% local ($0), ${cloudPct}% cloud ($${cloudCost.toFixed(2)}). ` +
          `If 100% cloud: $${estimatedFullCloudCost.toFixed(2)}. ` +
          `You saved $${savings.toFixed(2)}.`
        : 'No inference requests recorded in this period.';

    return {
        periodDays,
        localRequests,
        cloudRequests,
        localPct,
        cloudPct,
        cloudCost,
        estimatedFullCloudCost,
        savings,
        savingsPct: estimatedFullCloudCost > 0
            ? Math.round((savings / estimatedFullCloudCost) * 100)
            : 100,
        summary,
    };
}
