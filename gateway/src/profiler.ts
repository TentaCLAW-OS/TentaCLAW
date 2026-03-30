// F:\tentaclaw-os\gateway\src\profiler.ts
// Performance Profiler for TentaCLAW Gateway
// CLAWtopus says: "I time everything. Eight arms, eight stopwatches."

/**
 * Request timing middleware data
 */
export interface RequestProfile {
    request_id: string;
    method: string;
    path: string;
    status: number;
    total_ms: number;
    db_ms: number;
    inference_ms: number;
    timestamp: string;
}

// In-memory ring buffer of recent request profiles (last 1000)
const profiles: RequestProfile[] = [];
const MAX_PROFILES = 1000;

/**
 * Record a request profile into the ring buffer.
 * When the buffer exceeds MAX_PROFILES, the oldest entry is removed.
 */
export function recordProfile(profile: RequestProfile): void {
    profiles.push(profile);
    if (profiles.length > MAX_PROFILES) {
        profiles.shift();
    }
}

/**
 * Get recent profiles, optionally limited to the last N entries.
 */
export function getProfiles(limit?: number): RequestProfile[] {
    if (limit === undefined || limit >= profiles.length) {
        return [...profiles];
    }
    return profiles.slice(-limit);
}

/**
 * Calculate a given percentile from an array of numbers.
 * @param values - sorted or unsorted numeric array
 * @param p - percentile between 0 and 100
 */
export function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const fraction = index - lower;
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/**
 * Get an overall performance summary across all recorded profiles.
 */
export function getPerformanceSummary(): {
    total_requests: number;
    avg_latency_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    slowest_endpoints: Array<{ path: string; avg_ms: number; count: number }>;
    fastest_endpoints: Array<{ path: string; avg_ms: number; count: number }>;
    errors_pct: number;
    requests_per_second: number;
} {
    if (profiles.length === 0) {
        return {
            total_requests: 0,
            avg_latency_ms: 0,
            p50_ms: 0,
            p95_ms: 0,
            p99_ms: 0,
            slowest_endpoints: [],
            fastest_endpoints: [],
            errors_pct: 0,
            requests_per_second: 0,
        };
    }

    const latencies = profiles.map((p) => p.total_ms);
    const totalLatency = latencies.reduce((sum, v) => sum + v, 0);
    const errorCount = profiles.filter((p) => p.status >= 400).length;

    // Calculate requests per second from the time window of recorded profiles
    const timestamps = profiles.map((p) => new Date(p.timestamp).getTime());
    const timeSpanMs = Math.max(timestamps[timestamps.length - 1] - timestamps[0], 1);
    const requestsPerSecond = profiles.length / (timeSpanMs / 1000);

    // Group by path for endpoint-level stats
    const byPath = new Map<string, { totalMs: number; count: number }>();
    for (const p of profiles) {
        const entry = byPath.get(p.path);
        if (entry) {
            entry.totalMs += p.total_ms;
            entry.count++;
        } else {
            byPath.set(p.path, { totalMs: p.total_ms, count: 1 });
        }
    }

    const endpointStats = Array.from(byPath.entries()).map(([path, stats]) => ({
        path,
        avg_ms: Math.round((stats.totalMs / stats.count) * 100) / 100,
        count: stats.count,
    }));

    // Sort by avg_ms descending for slowest, ascending for fastest
    const sortedDesc = [...endpointStats].sort((a, b) => b.avg_ms - a.avg_ms);
    const sortedAsc = [...endpointStats].sort((a, b) => a.avg_ms - b.avg_ms);

    return {
        total_requests: profiles.length,
        avg_latency_ms: Math.round((totalLatency / profiles.length) * 100) / 100,
        p50_ms: Math.round(percentile(latencies, 50) * 100) / 100,
        p95_ms: Math.round(percentile(latencies, 95) * 100) / 100,
        p99_ms: Math.round(percentile(latencies, 99) * 100) / 100,
        slowest_endpoints: sortedDesc.slice(0, 10),
        fastest_endpoints: sortedAsc.slice(0, 10),
        errors_pct: Math.round((errorCount / profiles.length) * 10000) / 100,
        requests_per_second: Math.round(requestsPerSecond * 100) / 100,
    };
}

/**
 * Get performance statistics for a specific endpoint path.
 */
export function getEndpointPerformance(path: string): {
    path: string;
    total_requests: number;
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    error_rate: number;
    histogram: Array<{ bucket_ms: number; count: number }>;
} {
    const matching = profiles.filter((p) => p.path === path);

    if (matching.length === 0) {
        return {
            path,
            total_requests: 0,
            avg_ms: 0,
            p50_ms: 0,
            p95_ms: 0,
            p99_ms: 0,
            error_rate: 0,
            histogram: [],
        };
    }

    const latencies = matching.map((p) => p.total_ms);
    const totalLatency = latencies.reduce((sum, v) => sum + v, 0);
    const errorCount = matching.filter((p) => p.status >= 400).length;

    // Build histogram with exponential buckets: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000+
    const bucketBounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const buckets = new Map<number, number>();
    for (const bound of bucketBounds) {
        buckets.set(bound, 0);
    }

    for (const lat of latencies) {
        let placed = false;
        for (const bound of bucketBounds) {
            if (lat <= bound) {
                buckets.set(bound, (buckets.get(bound) || 0) + 1);
                placed = true;
                break;
            }
        }
        if (!placed) {
            // Beyond the largest bucket — put in 10000+
            buckets.set(10000, (buckets.get(10000) || 0) + 1);
        }
    }

    const histogram = Array.from(buckets.entries())
        .map(([bucket_ms, count]) => ({ bucket_ms, count }))
        .filter((entry) => entry.count > 0);

    return {
        path,
        total_requests: matching.length,
        avg_ms: Math.round((totalLatency / matching.length) * 100) / 100,
        p50_ms: Math.round(percentile(latencies, 50) * 100) / 100,
        p95_ms: Math.round(percentile(latencies, 95) * 100) / 100,
        p99_ms: Math.round(percentile(latencies, 99) * 100) / 100,
        error_rate: Math.round((errorCount / matching.length) * 10000) / 100,
        histogram,
    };
}

/**
 * Generate a load test configuration/command for a given endpoint.
 * Produces commands for common load-testing tools (hey, wrk, curl).
 */
export function generateLoadTestConfig(endpoint: string, options?: {
    concurrency?: number;
    duration_secs?: number;
    rps?: number;
}): {
    command: string;
    config: Record<string, unknown>;
} {
    const concurrency = options?.concurrency ?? 10;
    const duration = options?.duration_secs ?? 30;
    const rps = options?.rps ?? 100;

    // Generate a `hey` command (https://github.com/rakyll/hey)
    const heyCommand = `hey -c ${concurrency} -z ${duration}s -q ${rps} ${endpoint}`;

    return {
        command: heyCommand,
        config: {
            tool: 'hey',
            endpoint,
            concurrency,
            duration_secs: duration,
            target_rps: rps,
            alternatives: {
                wrk: `wrk -t${Math.min(concurrency, 8)} -c${concurrency} -d${duration}s ${endpoint}`,
                curl_loop: `for i in $(seq 1 ${concurrency * duration}); do curl -s -o /dev/null -w "%{time_total}\\n" ${endpoint} & done | sort -n`,
                ab: `ab -n ${rps * duration} -c ${concurrency} ${endpoint}`,
            },
        },
    };
}

/**
 * Clear all recorded profiles.
 */
export function clearProfiles(): void {
    profiles.length = 0;
}
