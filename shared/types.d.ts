/**
 * TentaCLAW OS — Shared Types
 *
 * Types shared between the Agent daemon and the TentaCLAW Gateway.
 * CLAWtopus says: "One mind. One type system."
 */
export interface GpuStats {
    busId: string;
    name: string;
    vramTotalMb: number;
    vramUsedMb: number;
    temperatureC: number;
    utilizationPct: number;
    powerDrawW: number;
    fanSpeedPct: number;
    clockSmMhz: number;
    clockMemMhz: number;
}
export interface StatsPayload {
    farm_hash: string;
    node_id: string;
    hostname: string;
    uptime_secs: number;
    gpu_count: number;
    gpus: GpuStats[];
    cpu: {
        usage_pct: number;
        temp_c: number;
    };
    ram: {
        total_mb: number;
        used_mb: number;
    };
    disk: {
        total_gb: number;
        used_gb: number;
    };
    network: {
        bytes_in: number;
        bytes_out: number;
    };
    inference: {
        loaded_models: string[];
        in_flight_requests: number;
        tokens_generated: number;
        avg_latency_ms: number;
    };
    backend?: {
        type: string;
        port: number;
        version?: string;
    };
    system_info?: {
        cpu_model: string;
        cpu_cores: number;
        cpu_threads: number;
        ram_total_gb: number;
        kernel: string;
        arch: string;
        os: string;
        disk_type: string;
        agent_version: string;
    };
    toks_per_sec: number;
    requests_completed: number;
}
export type CommandAction = 'reload_model' | 'install_model' | 'remove_model' | 'overclock' | 'benchmark' | 'restart_agent' | 'reboot' | 'quantize_model';
export type OverclockProfile = 'stock' | 'gaming' | 'mining' | 'inference';
export declare const OVERCLOCK_PROFILES: Record<OverclockProfile, {
    power_limit_pct: number;
    core_offset_mhz: number;
    mem_offset_mhz: number;
    fan_speed_pct: number;
}>;
export interface GatewayCommand {
    id: string;
    action: CommandAction;
    model?: string;
    gpu?: number;
    profile?: string;
    priority?: string;
}
export interface GatewayResponse {
    commands: GatewayCommand[];
    config_hash?: string;
}
export interface NodeRegistration {
    node_id: string;
    farm_hash: string;
    hostname: string;
    ip_address?: string;
    mac_address?: string;
    gpu_count: number;
    gpus: GpuStats[];
    os_version?: string;
}
export type NodeStatus = 'online' | 'offline' | 'error' | 'rebooting';
export interface Node {
    id: string;
    farm_hash: string;
    hostname: string;
    ip_address: string | null;
    mac_address: string | null;
    registered_at: string;
    last_seen_at: string | null;
    status: NodeStatus;
    gpu_count: number;
    os_version: string | null;
}
export interface NodeWithStats extends Node {
    latest_stats: StatsPayload | null;
}
export interface FlightSheetTarget {
    node_id: string;
    model: string;
    gpu?: number;
}
export interface FlightSheet {
    id: string;
    name: string;
    description: string;
    targets: FlightSheetTarget[];
    created_at: string;
    updated_at: string | null;
}
export interface BenchmarkResult {
    id: string;
    node_id: string;
    model: string;
    tokens_per_sec: number;
    prompt_eval_rate: number;
    eval_rate: number;
    total_duration_ms: number;
    created_at: string;
}
export type AlertSeverity = 'warning' | 'critical';
export type AlertType = 'gpu_temp' | 'vram_full' | 'cpu_saturated' | 'ram_pressure' | 'disk_full' | 'node_offline';
export interface Alert {
    id: string;
    node_id: string;
    severity: AlertSeverity;
    type: AlertType;
    message: string;
    value: number;
    threshold: number;
    acknowledged: boolean;
    created_at: string;
}
export interface SshKey {
    id: string;
    node_id: string;
    label: string;
    public_key: string;
    fingerprint: string;
    created_at: string;
}
export interface NodeTag {
    node_id: string;
    tag: string;
    created_at: string;
}
export type DaphneyEventType = 'node_online' | 'node_offline' | 'inference_request' | 'inference_complete' | 'gpu_temp_change' | 'alert_fired' | 'model_loaded' | 'model_unloaded' | 'cluster_topology';
export interface DaphneyEvent {
    type: DaphneyEventType;
    timestamp: string;
    node_id?: string;
    data: unknown;
    topology?: {
        total_nodes: number;
        online_nodes: number;
        total_gpus: number;
        nodes: Array<{
            id: string;
            hostname: string;
            status: string;
            gpu_count: number;
        }>;
    };
}
export interface ModelPullProgress {
    node_id: string;
    model: string;
    status: 'downloading' | 'verifying' | 'complete' | 'error';
    progress_pct: number;
    bytes_downloaded: number;
    bytes_total: number;
    started_at: string;
    updated_at: string;
}
export type BackendType = 'ollama' | 'vllm' | 'llamacpp' | 'bitnet' | 'none';
export interface BackendInfo {
    type: BackendType;
    port: number;
    version?: string;
    models: string[];
    healthy: boolean;
}
export type AmdCompute = 'rocm' | 'vulkan' | 'opencl';
export interface AmdGpuArch {
    arch: string;
    gfxVersion: string;
    compute: AmdCompute;
    rocmSupported: boolean;
    hsaOverride?: string;
}
export interface BitNetConfig {
    binaryPath: string;
    port: number;
    model: string;
    cpuThreads: number;
    enabled: boolean;
}
export interface ClusterTopology {
    nodes: Array<{
        id: string;
        hostname: string;
        ip_address: string | null;
        status: NodeStatus;
        gpu_count: number;
        backend: BackendType;
        latency_ms?: number;
    }>;
    total_nodes: number;
    online_nodes: number;
    total_gpus: number;
    total_vram_mb: number;
    backends: BackendType[];
}
export type WatchdogLevel = 'info' | 'warning' | 'critical' | 'emergency';
export type WatchdogAction = 'log' | 'restart_service' | 'kill_process' | 'reset_gpu' | 'reboot';
export interface WatchdogEvent {
    id: string;
    node_id: string;
    level: WatchdogLevel;
    action: WatchdogAction;
    target: string;
    result: 'success' | 'failed' | 'pending';
    message: string;
    created_at: string;
}
export type NotificationChannelType = 'discord' | 'slack' | 'telegram' | 'email' | 'webhook';
export interface NotificationChannel {
    id: string;
    type: NotificationChannelType;
    name: string;
    config: Record<string, string>;
    enabled: boolean;
    created_at: string;
}
export interface PowerStats {
    total_watts: number;
    per_node: Array<{
        node_id: string;
        hostname: string;
        watts: number;
        gpu_watts: number;
    }>;
    cost_per_kwh: number;
    daily_cost: number;
    monthly_estimate: number;
}
export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export interface FleetHealth {
    score: number;
    grade: HealthGrade;
    issues: Array<{
        severity: AlertSeverity;
        message: string;
        node_id?: string;
    }>;
    recommendations: string[];
}
export type ApiKeyPermission = 'read' | 'write' | 'admin';
export interface ApiKey {
    id: string;
    name: string;
    key_hash: string;
    permissions: ApiKeyPermission[];
    rate_limit: number;
    expires_at?: string;
    created_at: string;
    last_used_at?: string;
    revoked: boolean;
}
export interface ModelSearchResult {
    name: string;
    description: string;
    size_gb: number;
    vram_required_mb: number;
    quantization: string;
    fits_cluster: boolean;
    source: 'ollama' | 'huggingface';
    tags: string[];
}
export interface ScheduleConfig {
    id: string;
    name: string;
    cron: string;
    action: CommandAction;
    target_nodes: string[];
    model?: string;
    enabled: boolean;
    last_run_at?: string;
    next_run_at?: string;
    created_at: string;
}
export type SSEEventType = 'node_online' | 'node_offline' | 'stats_update' | 'command_sent' | 'command_completed' | 'flight_sheet_applied' | 'alert' | 'benchmark_complete';
export interface SSEEvent {
    type: SSEEventType;
    timestamp: string;
    data: unknown;
}
