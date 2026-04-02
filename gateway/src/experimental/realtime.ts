/**
 * TentaCLAW Gateway — Real-time Communication Layer
 *
 * Manages WebSocket client tracking, event subscriptions,
 * and message formatting for SSE / WS delivery.
 *
 * TentaCLAW says: "Every tentacle stays connected — no signal lost at sea."
 */

export interface RealtimeClient {
    id: string;
    type: 'dashboard' | 'agent' | 'cli' | 'external';
    connectedAt: number;
    lastPing: number;
    subscriptions: string[];  // event types to receive
}

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

const clients = new Map<string, RealtimeClient>();

/**
 * Register a new real-time client.
 */
export function registerClient(id: string, type: RealtimeClient['type']): RealtimeClient {
    const now = Date.now();
    const client: RealtimeClient = {
        id,
        type,
        connectedAt: now,
        lastPing: now,
        subscriptions: [],
    };
    clients.set(id, client);
    return client;
}

/**
 * Remove a disconnected client.
 */
export function removeClient(id: string): void {
    clients.delete(id);
}

/**
 * Get all connected clients.
 */
export function getClients(): RealtimeClient[] {
    return Array.from(clients.values());
}

/**
 * Get client count by type.
 */
export function getClientCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const client of clients.values()) {
        counts[client.type] = (counts[client.type] ?? 0) + 1;
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe a client to specific event types.
 */
export function subscribe(clientId: string, events: string[]): void {
    const client = clients.get(clientId);
    if (!client) return;

    for (const evt of events) {
        if (!client.subscriptions.includes(evt)) {
            client.subscriptions.push(evt);
        }
    }
}

/**
 * Unsubscribe a client from specific event types.
 */
export function unsubscribe(clientId: string, events: string[]): void {
    const client = clients.get(clientId);
    if (!client) return;

    client.subscriptions = client.subscriptions.filter(s => !events.includes(s));
}

/**
 * Check if a client should receive an event of the given type.
 * A client with no subscriptions receives everything (wildcard).
 */
export function shouldReceive(clientId: string, eventType: string): boolean {
    const client = clients.get(clientId);
    if (!client) return false;

    // No subscriptions = wildcard — receive all events
    if (client.subscriptions.length === 0) return true;

    return client.subscriptions.includes(eventType);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Get connection statistics.
 */
export function getConnectionStats(): {
    total: number;
    by_type: Record<string, number>;
    avg_connection_time_ms: number;
    subscriptions: Record<string, number>;
} {
    const now = Date.now();
    const all = Array.from(clients.values());
    const total = all.length;

    const by_type: Record<string, number> = {};
    let connectionTimeSum = 0;
    const subscriptions: Record<string, number> = {};

    for (const c of all) {
        by_type[c.type] = (by_type[c.type] ?? 0) + 1;
        connectionTimeSum += now - c.connectedAt;
        for (const sub of c.subscriptions) {
            subscriptions[sub] = (subscriptions[sub] ?? 0) + 1;
        }
    }

    return {
        total,
        by_type,
        avg_connection_time_ms: total > 0 ? Math.round(connectionTimeSum / total) : 0,
        subscriptions,
    };
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Prune clients that have not pinged within `maxAgeSecs` seconds (default 60).
 * Returns the IDs of removed clients.
 */
export function pruneStaleClients(maxAgeSecs: number = 60): string[] {
    const cutoff = Date.now() - maxAgeSecs * 1000;
    const removed: string[] = [];

    for (const [id, client] of clients) {
        if (client.lastPing < cutoff) {
            clients.delete(id);
            removed.push(id);
        }
    }

    return removed;
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format an event for Server-Sent Events (SSE) transmission.
 * Follows the SSE spec: `event:` + `data:` lines, terminated by double newline.
 */
export function formatSSE(eventType: string, data: unknown): string {
    const json = JSON.stringify(data);
    // Each line of the data field must be prefixed with `data: `
    const dataLines = json.split('\n').map(line => `data: ${line}`).join('\n');
    return `event: ${eventType}\n${dataLines}\n\n`;
}

/**
 * Format an event for WebSocket transmission.
 * Returns a JSON string with a standard envelope.
 */
export function formatWS(eventType: string, data: unknown): string {
    return JSON.stringify({
        type: eventType,
        data,
        ts: Date.now(),
    });
}

// ---------------------------------------------------------------------------
// Internal helper — allow tests to reset state
// ---------------------------------------------------------------------------

/** @internal Clear all clients — used by tests only. */
export function _resetClients(): void {
    clients.clear();
}
