/**
 * TentaCLAW OS — Agent ↔ Gateway Protocol Definition
 *
 * Formal, versioned protocol for all communication between TentaCLAW Agent
 * daemons and the TentaCLAW Gateway. This file is the single source of truth
 * for message shapes, discovery packets, command envelopes, and validation.
 *
 * Imported by both `agent/` and `gateway/` packages.
 *
 * CLAWtopus says: "Speak the same language, or get tangled."
 *
 * @module protocol
 * @version 1.0
 */

import type {
    StatsPayload,
    GpuStats,
    GatewayCommand,
    CommandAction,
    BackendType,
} from './types';

// Re-export the types that are part of the protocol surface
export type { StatsPayload, GpuStats, GatewayCommand, CommandAction, BackendType };

// =============================================================================
// Protocol Version
// =============================================================================

/**
 * Current protocol version. Sent in heartbeats and gateway responses so both
 * sides can detect version mismatches and degrade gracefully.
 *
 * Bump the major segment for breaking changes; bump the minor segment for
 * backwards-compatible additions.
 */
export const PROTOCOL_VERSION = '1.0';

// =============================================================================
// Constants
// =============================================================================

/** UDP port used for gateway auto-discovery broadcasts. */
export const DISCOVERY_PORT = 41338;

/** Magic string that identifies a valid TentaCLAW discovery packet. */
export const DISCOVERY_MAGIC = 'TENTACLAW-GATEWAY';

/** Default interval (ms) between agent heartbeat / stats pushes. */
export const DEFAULT_STATS_INTERVAL_MS = 10_000;

/** Default HTTP port the gateway listens on. */
export const DEFAULT_GATEWAY_PORT = 8080;

// =============================================================================
// Agent → Gateway: Registration
// =============================================================================

/**
 * Sent by the agent on first connection to the gateway.
 * Provides enough information for the gateway to catalog the node and decide
 * which commands (if any) to issue immediately (e.g. flight-sheet application).
 */
export interface AgentRegistration {
    /** Protocol version the agent speaks. */
    protocol_version: string;

    /** Unique, persistent identifier for this node (UUID or machine-id). */
    node_id: string;

    /** Farm hash the node belongs to. */
    farm_hash: string;

    /** Human-readable hostname. */
    hostname: string;

    /** Number of GPUs detected on this node. */
    gpu_count: number;

    /** Per-GPU hardware details captured at startup. */
    gpus: GpuStats[];

    /** Agent software version string (semver). */
    agent_version: string;

    /** Inference backend information, if a backend is running. */
    backend?: {
        type: BackendType;
        port: number;
        version?: string;
    };

    /** Operating system version string (e.g. "TentaCLAW OS 0.3.1"). */
    os_version?: string;

    /** LAN IPv4 address of the node, when known. */
    ip_address?: string;

    /** Primary MAC address, when known. */
    mac_address?: string;
}

// =============================================================================
// Agent → Gateway: Heartbeat (periodic stats push)
// =============================================================================

/**
 * Periodic message sent by the agent to the gateway (typically every
 * {@link DEFAULT_STATS_INTERVAL_MS} milliseconds).
 *
 * Contains the full {@link StatsPayload} plus envelope metadata so the
 * gateway can version-check and route appropriately.
 */
export interface AgentHeartbeat {
    /** Protocol version for forward-compatibility checks. */
    protocol_version: string;

    /** Node that produced this heartbeat. */
    node_id: string;

    /** ISO-8601 timestamp of when the payload was captured. */
    timestamp: string;

    /** Full hardware and inference statistics. */
    stats: StatsPayload;
}

// =============================================================================
// Gateway → Agent: Response
// =============================================================================

/**
 * Response returned by the gateway after receiving a heartbeat (or
 * registration). Carries zero or more commands for the agent to execute.
 */
export interface GatewayResponseEnvelope {
    /** Protocol version the gateway speaks. */
    protocol_version: string;

    /** Pending commands for this node (may be empty). */
    commands: GatewayCommand[];

    /**
     * Opaque hash of the node's desired-state config on the gateway side.
     * The agent can cache this and skip redundant work when it has not changed.
     */
    config_hash?: string;
}

// =============================================================================
// Gateway → Agent: Individual Command
// =============================================================================

/**
 * A single command dispatched from the gateway to an agent.
 *
 * Extends the base {@link GatewayCommand} from `types.ts` with a `nonce`
 * field used for idempotent / deduplicated execution.
 */
export interface GatewayCommandEnvelope {
    /** Unique command identifier (UUID). */
    id: string;

    /** The action the agent should perform. */
    action: CommandAction;

    /**
     * Nonce for deduplication. The agent MUST track recently-seen nonces and
     * silently discard commands whose nonce has already been processed.
     */
    nonce: string;

    /** Opaque, action-specific payload. */
    payload?: Record<string, unknown>;

    /** Target model name (for model-related actions). */
    model?: string;

    /** Target GPU index (for GPU-specific actions). */
    gpu?: number;

    /** Overclock profile name (for the `overclock` action). */
    profile?: string;

    /** Execution priority hint. */
    priority?: 'low' | 'normal' | 'high';
}

// =============================================================================
// UDP Discovery Broadcast
// =============================================================================

/**
 * JSON payload broadcast by the gateway over UDP on port
 * {@link DISCOVERY_PORT}. Agents listen for this packet to auto-discover
 * the gateway without any manual configuration.
 */
export interface DiscoveryPacket {
    /** Must equal {@link DISCOVERY_MAGIC} (`"TENTACLAW-GATEWAY"`). */
    magic: string;

    /** Full HTTP(S) URL of the gateway (e.g. `"http://192.168.1.50:8080"`). */
    url: string;

    /** Protocol version the gateway speaks. */
    protocol_version: string;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Type-guard that validates an unknown value is a well-formed
 * {@link AgentHeartbeat}.
 *
 * Checks required fields and basic types — does NOT deeply validate the
 * nested {@link StatsPayload}.
 */
export function isValidHeartbeat(data: unknown): data is AgentHeartbeat {
    if (data === null || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return (
        typeof d['protocol_version'] === 'string' &&
        typeof d['node_id'] === 'string' &&
        typeof d['timestamp'] === 'string' &&
        d['stats'] !== null &&
        typeof d['stats'] === 'object'
    );
}

/**
 * Type-guard that validates an unknown value is a well-formed
 * {@link GatewayCommandEnvelope}.
 *
 * Ensures the `action` field is one of the known {@link CommandAction} values
 * and that a `nonce` is present for deduplication.
 */
export function isValidCommand(data: unknown): data is GatewayCommandEnvelope {
    if (data === null || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;

    const validActions: ReadonlySet<string> = new Set<CommandAction>([
        'reload_model',
        'install_model',
        'remove_model',
        'overclock',
        'benchmark',
        'restart_agent',
        'reboot',
        'quantize_model',
    ]);

    return (
        typeof d['id'] === 'string' &&
        typeof d['action'] === 'string' &&
        validActions.has(d['action']) &&
        typeof d['nonce'] === 'string'
    );
}

/**
 * Type-guard that validates an unknown value is a well-formed
 * {@link DiscoveryPacket}.
 *
 * Checks that the magic string matches {@link DISCOVERY_MAGIC} and that a
 * gateway URL and protocol version are present.
 */
export function isValidDiscovery(data: unknown): data is DiscoveryPacket {
    if (data === null || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return (
        d['magic'] === DISCOVERY_MAGIC &&
        typeof d['url'] === 'string' &&
        d['url'] !== '' &&
        typeof d['protocol_version'] === 'string'
    );
}
