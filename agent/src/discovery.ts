/**
 * TentaCLAW Discovery Module — Multi-Method Gateway Discovery
 *
 * Discovers TentaCLAW gateways on the local network using multiple strategies:
 *   1. UDP broadcast (port 41337/41338)
 *   2. DNS-SD / mDNS (_tentaclaw._tcp)
 *   3. Subnet scan (HTTP health check on common ports)
 *   4. Manual fallback (localhost:8080)
 *
 * Tracks multiple known gateways with health checks and latency measurement.
 * Zero external dependencies — uses only Node.js built-in modules.
 *
 * TentaCLAW says: "Eight arms, eight ways to find you."
 */

import * as dgram from 'dgram';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';

// =============================================================================
// Types
// =============================================================================

export type DiscoveryMethod = 'udp' | 'mdns' | 'scan' | 'config' | 'env';

export interface DiscoveredGateway {
    url: string;
    method: DiscoveryMethod;
    latency_ms: number;
    last_seen: number;
    healthy: boolean;
}

// =============================================================================
// State
// =============================================================================

const knownGateways: DiscoveredGateway[] = [];
let discoveryTimer: ReturnType<typeof setInterval> | null = null;

/** Port the gateway broadcasts on; agent listens on DISCOVERY_LISTEN_PORT. */
export const DISCOVERY_PORT = 41337;
const DISCOVERY_LISTEN_PORT = DISCOVERY_PORT + 1;
const GATEWAY_MAGIC = 'TENTACLAW-GATEWAY';
const HEALTH_ENDPOINT = '/health';
const HEALTH_MARKER = 'tentaclaw';
const SCAN_PORTS = [8080, 3000, 443, 80];
const UDP_TIMEOUT_MS = 5000;
const MDNS_TIMEOUT_MS = 3000;
const SCAN_TIMEOUT_MS = 1500;
const HEALTH_TIMEOUT_MS = 5000;
const DEFAULT_LOOP_INTERVAL_MS = 60_000;

// =============================================================================
// Helpers
// =============================================================================

/** Get the first non-internal IPv4 address. */
function getLocalIp(): string {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

/** Get the /24 subnet prefix for the first non-internal IPv4 interface. */
function getSubnetPrefix(): string {
    const ip = getLocalIp();
    const parts = ip.split('.');
    return parts.slice(0, 3).join('.') + '.';
}

/** Perform an HTTP(S) GET and return the response body (or null on error). */
function httpGet(url: string, timeoutMs: number): Promise<{ status: number; body: string } | null> {
    return new Promise((resolve) => {
        const transport = url.startsWith('https') ? https : http;
        try {
            const req = transport.get(url, { timeout: timeoutMs }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode || 0, body }));
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
            resolve(null);
        }
    });
}

/** Measure round-trip latency to a gateway's /health endpoint in ms. Returns -1 on failure. */
function measureLatency(url: string): Promise<number> {
    return new Promise((resolve) => {
        const start = Date.now();
        const transport = url.startsWith('https') ? https : http;
        try {
            const req = transport.get(url + HEALTH_ENDPOINT, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
                let data = '';
                res.on('data', (c: Buffer) => { data += c.toString(); });
                res.on('end', () => resolve(Date.now() - start));
                res.on('error', () => resolve(-1));
            });
            req.on('error', () => resolve(-1));
            req.on('timeout', () => { req.destroy(); resolve(-1); });
        } catch {
            resolve(-1);
        }
    });
}

/** Upsert a gateway entry in knownGateways. */
function upsertGateway(url: string, method: DiscoveryMethod, latency: number, healthy: boolean): void {
    const now = Date.now();
    const existing = knownGateways.find((g) => g.url === url);
    if (existing) {
        existing.method = method;
        existing.latency_ms = latency;
        existing.last_seen = now;
        existing.healthy = healthy;
    } else {
        knownGateways.push({ url, method, latency_ms: latency, last_seen: now, healthy });
    }
}

// =============================================================================
// Discovery Method 1: UDP Broadcast
// =============================================================================

/**
 * Listen for TENTACLAW-GATEWAY UDP broadcasts on port 41338.
 * The gateway broadcasts its URL; we listen and resolve the first one found.
 */
function discoverViaUdp(): Promise<string | null> {
    return new Promise((resolve) => {
        let resolved = false;

        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                try { sock.close(); } catch { /* ignore */ }
                resolve(null);
            }
        }, UDP_TIMEOUT_MS);

        sock.on('message', (msg) => {
            if (resolved) return;
            try {
                const data = JSON.parse(msg.toString());
                if (data.magic === GATEWAY_MAGIC && data.url) {
                    resolved = true;
                    clearTimeout(timeout);
                    try { sock.close(); } catch { /* ignore */ }
                    resolve(data.url as string);
                }
            } catch { /* malformed packet, ignore */ }
        });

        sock.on('error', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(null);
            }
        });

        try {
            sock.bind(DISCOVERY_LISTEN_PORT);
        } catch {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(null);
            }
        }
    });
}

// =============================================================================
// Discovery Method 2: DNS-SD / mDNS
// =============================================================================

/**
 * Attempt to resolve _tentaclaw._tcp via DNS SRV lookup.
 * Works when a local DNS-SD / mDNS responder advertises the service.
 */
function discoverViaMdns(): Promise<string | null> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), MDNS_TIMEOUT_MS);

        dns.resolveSrv('_tentaclaw._tcp.local', (err, addresses) => {
            clearTimeout(timeout);
            if (err || !addresses || addresses.length === 0) {
                resolve(null);
                return;
            }

            // Pick the highest-priority (lowest priority number), then lowest-weighted
            const sorted = addresses.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return b.weight - a.weight; // higher weight = preferred
            });

            const best = sorted[0];
            const host = best.name;
            const port = best.port;
            const url = `http://${host}:${port}`;
            resolve(url);
        });
    });
}

// =============================================================================
// Discovery Method 3: Subnet Scan
// =============================================================================

/**
 * Scan the local /24 subnet on common gateway ports.
 * Checks each IP's /health endpoint for the tentaclaw marker.
 */
function discoverViaSubnetScan(): Promise<string | null> {
    return new Promise((resolve) => {
        const prefix = getSubnetPrefix();
        let found = false;
        let pending = 0;

        const finish = () => {
            if (pending <= 0 && !found) {
                resolve(null);
            }
        };

        for (let i = 1; i <= 254; i++) {
            for (const port of SCAN_PORTS) {
                const ip = prefix + i;
                const url = `http://${ip}:${port}`;
                pending++;

                const req = http.get(url + HEALTH_ENDPOINT, { timeout: SCAN_TIMEOUT_MS }, (res) => {
                    let body = '';
                    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                    res.on('end', () => {
                        if (!found && body.toLowerCase().includes(HEALTH_MARKER)) {
                            found = true;
                            resolve(url);
                        }
                        pending--;
                        finish();
                    });
                    res.on('error', () => { pending--; finish(); });
                });
                req.on('error', () => { pending--; finish(); });
                req.on('timeout', () => { req.destroy(); pending--; finish(); });
            }
        }

        // Hard cap: don't hang indefinitely
        setTimeout(() => {
            if (!found) resolve(null);
        }, 15_000);
    });
}

// =============================================================================
// Discovery Method 4: Manual / Localhost Fallback
// =============================================================================

/**
 * Try localhost:8080 as a last resort.
 * Validates by hitting the /health endpoint.
 */
async function discoverViaFallback(): Promise<string | null> {
    const url = 'http://127.0.0.1:8080';
    const resp = await httpGet(url + HEALTH_ENDPOINT, SCAN_TIMEOUT_MS);
    if (resp && resp.body.toLowerCase().includes(HEALTH_MARKER)) {
        return url;
    }
    return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Discover a TentaCLAW gateway using multiple methods in priority order:
 *   1. Environment variable GATEWAY_URL
 *   2. UDP broadcast listener
 *   3. DNS-SD / mDNS SRV lookup
 *   4. Subnet scan on common ports
 *   5. Localhost fallback
 *
 * Returns the gateway URL or null if none found.
 * Updates the knownGateways list as a side effect.
 */
export async function discoverGateway(): Promise<string | null> {
    // Priority 0: Environment variable
    const envUrl = process.env.GATEWAY_URL || process.env.TENTACLAW_GATEWAY_URL;
    if (envUrl) {
        const latency = await measureLatency(envUrl);
        const healthy = latency >= 0;
        upsertGateway(envUrl, 'env', latency, healthy);
        if (healthy) {
            console.log(`[discovery] Gateway from env: ${envUrl} (${latency}ms)`);
            return envUrl;
        }
        console.log(`[discovery] Env gateway ${envUrl} unreachable, trying other methods...`);
    }

    // Method 1: UDP broadcast
    console.log('[discovery] Listening for UDP broadcast...');
    const udpResult = await discoverViaUdp();
    if (udpResult) {
        const latency = await measureLatency(udpResult);
        upsertGateway(udpResult, 'udp', latency, latency >= 0);
        console.log(`[discovery] Found gateway via UDP: ${udpResult} (${latency}ms)`);
        return udpResult;
    }

    // Method 2: DNS-SD / mDNS
    console.log('[discovery] Trying mDNS lookup for _tentaclaw._tcp...');
    const mdnsResult = await discoverViaMdns();
    if (mdnsResult) {
        const latency = await measureLatency(mdnsResult);
        const healthy = latency >= 0;
        upsertGateway(mdnsResult, 'mdns', latency, healthy);
        if (healthy) {
            console.log(`[discovery] Found gateway via mDNS: ${mdnsResult} (${latency}ms)`);
            return mdnsResult;
        }
    }

    // Method 3: Subnet scan
    console.log('[discovery] Scanning local subnet...');
    const scanResult = await discoverViaSubnetScan();
    if (scanResult) {
        const latency = await measureLatency(scanResult);
        upsertGateway(scanResult, 'scan', latency, latency >= 0);
        console.log(`[discovery] Found gateway via subnet scan: ${scanResult} (${latency}ms)`);
        return scanResult;
    }

    // Method 4: Localhost fallback
    console.log('[discovery] Trying localhost fallback...');
    const fallbackResult = await discoverViaFallback();
    if (fallbackResult) {
        const latency = await measureLatency(fallbackResult);
        upsertGateway(fallbackResult, 'config', latency, latency >= 0);
        console.log(`[discovery] Found gateway via localhost fallback: ${fallbackResult} (${latency}ms)`);
        return fallbackResult;
    }

    console.log('[discovery] No gateway found via any method.');
    return null;
}

/**
 * Return a snapshot of all known gateways (healthy and unhealthy).
 */
export function getKnownGateways(): DiscoveredGateway[] {
    return [...knownGateways];
}

/**
 * Check whether a specific gateway is healthy by hitting its /health endpoint.
 * Updates the gateway's entry in knownGateways as a side effect.
 */
export async function checkGatewayHealth(url: string): Promise<boolean> {
    const resp = await httpGet(url + HEALTH_ENDPOINT, HEALTH_TIMEOUT_MS);
    const healthy = resp !== null && resp.status >= 200 && resp.status < 500
        && resp.body.toLowerCase().includes(HEALTH_MARKER);
    const latency = healthy ? await measureLatency(url) : -1;

    const existing = knownGateways.find((g) => g.url === url);
    if (existing) {
        existing.healthy = healthy;
        existing.last_seen = Date.now();
        if (latency >= 0) existing.latency_ms = latency;
    }

    return healthy;
}

/**
 * Return the best known gateway URL based on:
 *   1. Must be healthy
 *   2. Lowest latency
 * Returns null if no healthy gateways are known.
 */
export function getBestGateway(): string | null {
    const healthy = knownGateways
        .filter((g) => g.healthy)
        .sort((a, b) => a.latency_ms - b.latency_ms);

    return healthy.length > 0 ? healthy[0].url : null;
}

/**
 * Start a periodic discovery + health-check loop.
 *
 * Each iteration:
 *   - Re-checks health of all known gateways
 *   - Runs full multi-method discovery to find new gateways
 *
 * @param intervalMs  How often to run (default 60 000ms)
 */
export function startDiscoveryLoop(intervalMs?: number): void {
    if (discoveryTimer) return; // already running

    const interval = intervalMs ?? DEFAULT_LOOP_INTERVAL_MS;

    const tick = async () => {
        // Re-check existing gateways
        for (const gw of knownGateways) {
            const latency = await measureLatency(gw.url);
            gw.healthy = latency >= 0;
            gw.latency_ms = latency;
            if (gw.healthy) gw.last_seen = Date.now();
        }

        // Prune gateways not seen for over 10 minutes
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        for (let i = knownGateways.length - 1; i >= 0; i--) {
            if (knownGateways[i].last_seen < staleThreshold && !knownGateways[i].healthy) {
                knownGateways.splice(i, 1);
            }
        }

        // Attempt to discover new gateways
        await discoverGateway();
    };

    // Run immediately, then on interval
    tick().catch(() => {});
    discoveryTimer = setInterval(() => {
        tick().catch(() => {});
    }, interval);

    console.log(`[discovery] Discovery loop started (every ${interval / 1000}s)`);
}

/**
 * Stop the periodic discovery loop.
 */
export function stopDiscoveryLoop(): void {
    if (discoveryTimer) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
        console.log('[discovery] Discovery loop stopped');
    }
}
