/**
 * TentaCLAW Gateway — High Availability / Gateway Clustering
 *
 * Enables multiple gateway instances to form a cluster for redundancy.
 * Uses heartbeats, leader election, and state sync to keep the cluster healthy.
 *
 * CLAWtopus says: "One brain is good. Two brains are better. Eight arms either way."
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayRole = 'primary' | 'secondary' | 'candidate';

export interface GatewayPeer {
    id: string;
    url: string;
    role: GatewayRole;
    last_heartbeat: number;
    healthy: boolean;
    version: string;
}

export interface HAConfig {
    enabled: boolean;
    peer_urls: string[];           // URLs of other gateway instances
    heartbeat_interval_ms: number; // default 5000
    election_timeout_ms: number;   // default 15000
    sync_interval_ms: number;      // default 30000
}

export interface HAStatus {
    role: GatewayRole;
    peers: GatewayPeer[];
    cluster_healthy: boolean;
    last_sync: string | null;
    uptime_ms: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const peers = new Map<string, GatewayPeer>();
let currentRole: GatewayRole = 'candidate';
let haConfig: HAConfig = {
    enabled: false,
    peer_urls: [],
    heartbeat_interval_ms: 5000,
    election_timeout_ms: 15000,
    sync_interval_ms: 30000,
};

/** Unique ID for this gateway instance */
let selfId: string = generateId();

/** Timestamp when HA was started */
let startedAt: number = 0;

/** Last time state was successfully synced */
let lastSyncTime: string | null = null;

/** Interval handles for the HA loop */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let electionTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a short random ID for this gateway instance. */
function generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'gw-';
    for (let i = 0; i < 8; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

/**
 * Minimal HTTP GET using Node's built-in `http`/`https` modules.
 * Returns the response body as a string, or throws on failure.
 */
async function httpGet(url: string, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? require('https') : require('http');
        const req = mod.get(url, { timeout: timeoutMs }, (res: import('http').IncomingMessage) => {
            if (!res.statusCode || res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                res.resume(); // drain
                return;
            }
            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

/**
 * Minimal HTTP POST using Node's built-in `http`/`https` modules.
 * Sends JSON body and returns the response body as a string.
 */
async function httpPost(url: string, data: unknown, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? require('https') : require('http');
        const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            timeout: timeoutMs,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        const req = mod.request(options, (res: import('http').IncomingMessage) => {
            if (!res.statusCode || res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                res.resume();
                return;
            }
            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
        req.write(payload);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize HA with configuration.
 * Merges the provided partial config with defaults and registers any
 * configured peer URLs.
 */
export function initHA(config: Partial<HAConfig>): void {
    haConfig = { ...haConfig, ...config };
    selfId = generateId();
    currentRole = 'candidate';
    lastSyncTime = null;
    peers.clear();

    // Pre-register configured peer URLs
    for (const url of haConfig.peer_urls) {
        registerPeer(url);
    }
}

// ---------------------------------------------------------------------------
// Status & role queries
// ---------------------------------------------------------------------------

/**
 * Get current HA status including role, peers, and cluster health.
 */
export function getHAStatus(): HAStatus {
    const peerList = Array.from(peers.values());
    const healthyCount = peerList.filter(p => p.healthy).length;
    // Cluster is healthy when at least one peer is reachable or we are the only node
    const clusterHealthy = peerList.length === 0 || healthyCount > 0;

    return {
        role: currentRole,
        peers: peerList,
        cluster_healthy: clusterHealthy,
        last_sync: lastSyncTime,
        uptime_ms: startedAt > 0 ? Date.now() - startedAt : 0,
    };
}

/**
 * Get current role of this gateway instance.
 */
export function getRole(): GatewayRole {
    return currentRole;
}

/**
 * Returns true if this instance is currently the primary gateway.
 */
export function isPrimary(): boolean {
    return currentRole === 'primary';
}

// ---------------------------------------------------------------------------
// Peer management
// ---------------------------------------------------------------------------

/**
 * Register a peer gateway by URL.
 * Returns the newly created GatewayPeer record.
 */
export function registerPeer(url: string): GatewayPeer {
    // Derive a deterministic ID from the URL
    const id = 'peer-' + url.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
    const peer: GatewayPeer = {
        id,
        url,
        role: 'candidate',
        last_heartbeat: 0,
        healthy: false,
        version: 'unknown',
    };
    peers.set(id, peer);
    return peer;
}

/**
 * Remove a peer from the cluster registry.
 * Returns true if the peer existed and was removed.
 */
export function removePeer(id: string): boolean {
    return peers.delete(id);
}

// ---------------------------------------------------------------------------
// Heartbeats
// ---------------------------------------------------------------------------

/**
 * Send heartbeat to all registered peers by hitting their /health endpoint.
 * Updates each peer's health status and last_heartbeat timestamp.
 */
export async function sendHeartbeats(): Promise<void> {
    const tasks = Array.from(peers.values()).map(async (peer) => {
        const healthy = await checkPeerHealth(peer);
        peer.healthy = healthy;
        if (healthy) {
            peer.last_heartbeat = Date.now();
        }
    });

    await Promise.allSettled(tasks);
}

/**
 * Check whether a single peer is healthy by requesting its /health endpoint.
 */
export async function checkPeerHealth(peer: GatewayPeer): Promise<boolean> {
    try {
        const healthUrl = peer.url.replace(/\/+$/, '') + '/health';
        const body = await httpGet(healthUrl, 3000);
        // Try to parse version from health response
        try {
            const parsed = JSON.parse(body);
            if (parsed.version) {
                peer.version = parsed.version;
            }
            if (parsed.role) {
                peer.role = parsed.role as GatewayRole;
            }
        } catch {
            // Non-JSON health response is fine — the peer is still alive
        }
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Leader election
// ---------------------------------------------------------------------------

/**
 * Run leader election using a simple deterministic algorithm:
 * among all healthy peers (including self), the one with the
 * lexicographically lowest ID becomes primary.
 *
 * Returns the role assigned to this instance after the election.
 */
export function runElection(): GatewayRole {
    // Collect healthy candidate IDs
    const candidates: string[] = [selfId];

    for (const peer of peers.values()) {
        if (peer.healthy) {
            candidates.push(peer.id);
        }
    }

    // Sort lexicographically — lowest wins
    candidates.sort();

    if (candidates[0] === selfId) {
        currentRole = 'primary';
    } else {
        currentRole = 'secondary';

        // Mark the winning peer as primary
        for (const peer of peers.values()) {
            if (peer.id === candidates[0]) {
                peer.role = 'primary';
            } else if (peer.role === 'primary') {
                peer.role = 'secondary';
            }
        }
    }

    return currentRole;
}

// ---------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------

/**
 * Sync cluster state (peer registry, configuration) to all secondary peers.
 * Only the primary should call this; secondaries ignore it gracefully.
 */
export async function syncState(): Promise<{ synced_peers: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    if (currentRole !== 'primary') {
        return { synced_peers: 0, errors: ['not primary — skipping sync'] };
    }

    const peerList = Array.from(peers.values());
    const payload = {
        from: selfId,
        role: currentRole,
        peers: peerList.map(p => ({ id: p.id, url: p.url, role: p.role, healthy: p.healthy })),
        ts: Date.now(),
    };

    const tasks = peerList
        .filter(p => p.healthy && p.role !== 'primary')
        .map(async (peer) => {
            try {
                const syncUrl = peer.url.replace(/\/+$/, '') + '/ha/sync';
                await httpPost(syncUrl, payload);
                synced++;
            } catch (err) {
                errors.push(`${peer.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        });

    await Promise.allSettled(tasks);

    if (errors.length === 0) {
        lastSyncTime = new Date().toISOString();
    }

    return { synced_peers: synced, errors };
}

// ---------------------------------------------------------------------------
// HA loop — start / stop
// ---------------------------------------------------------------------------

/**
 * Start the HA loop: periodic heartbeats, election checks, and state sync.
 * Does nothing if HA is not enabled in config.
 */
export function startHA(): void {
    if (!haConfig.enabled) return;

    stopHA(); // clear any existing timers
    startedAt = Date.now();
    currentRole = 'candidate';

    // Heartbeat loop
    heartbeatTimer = setInterval(async () => {
        await sendHeartbeats();
    }, haConfig.heartbeat_interval_ms);

    // Election loop — check if primary is missing
    electionTimer = setInterval(() => {
        const now = Date.now();
        const primaryPeer = Array.from(peers.values()).find(p => p.role === 'primary');

        // If no peer claims primary or the primary hasn't sent a heartbeat in time, run election
        const primaryMissing = !primaryPeer
            || !primaryPeer.healthy
            || (now - primaryPeer.last_heartbeat > haConfig.election_timeout_ms);

        if (currentRole !== 'primary' && primaryMissing) {
            runElection();
        }
    }, haConfig.election_timeout_ms);

    // Sync loop — primary pushes state to secondaries
    syncTimer = setInterval(async () => {
        if (currentRole === 'primary') {
            await syncState();
        }
    }, haConfig.sync_interval_ms);

    // Run an initial election immediately
    runElection();
}

/**
 * Stop the HA loop and clear all timers.
 */
export function stopHA(): void {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (electionTimer) { clearInterval(electionTimer); electionTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

// ---------------------------------------------------------------------------
// Incoming peer messages
// ---------------------------------------------------------------------------

/**
 * Handle an incoming heartbeat from a remote peer.
 * Updates the peer's metadata and marks it healthy.
 */
export function handlePeerHeartbeat(peerId: string, data: { role: GatewayRole; version: string }): void {
    const existing = peers.get(peerId);
    if (existing) {
        existing.role = data.role;
        existing.version = data.version;
        existing.last_heartbeat = Date.now();
        existing.healthy = true;
    }
}

// ---------------------------------------------------------------------------
// Primary URL discovery
// ---------------------------------------------------------------------------

/**
 * Get the URL of the current primary gateway.
 * Returns this instance's own URL concept (null) if we are primary,
 * or the primary peer's URL, or null if no primary is known.
 */
export function getPrimaryUrl(): string | null {
    if (currentRole === 'primary') {
        return null; // caller is already on the primary
    }

    for (const peer of peers.values()) {
        if (peer.role === 'primary' && peer.healthy) {
            return peer.url;
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Role transitions
// ---------------------------------------------------------------------------

/**
 * Promote this gateway instance to primary.
 * All peers previously marked as primary are demoted to secondary.
 */
export function promoteToPrimary(): void {
    currentRole = 'primary';

    // Demote any peer that was marked primary
    for (const peer of peers.values()) {
        if (peer.role === 'primary') {
            peer.role = 'secondary';
        }
    }
}

/**
 * Step down from the primary role, reverting to candidate.
 * A subsequent election will determine the new primary.
 */
export function stepDown(): void {
    if (currentRole === 'primary') {
        currentRole = 'candidate';
    }
}

// ---------------------------------------------------------------------------
// Internal helpers — allow tests to reset state
// ---------------------------------------------------------------------------

/** @internal Reset all HA state — used by tests only. */
export function _resetHA(): void {
    stopHA();
    peers.clear();
    currentRole = 'candidate';
    selfId = generateId();
    startedAt = 0;
    lastSyncTime = null;
    haConfig = {
        enabled: false,
        peer_urls: [],
        heartbeat_interval_ms: 5000,
        election_timeout_ms: 15000,
        sync_interval_ms: 30000,
    };
}
