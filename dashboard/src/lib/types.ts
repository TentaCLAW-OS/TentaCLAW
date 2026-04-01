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
  cpu: { usage_pct: number; temp_c: number };
  ram: { total_mb: number; used_mb: number };
  disk: { total_gb: number; used_gb: number };
  network: { bytes_in: number; bytes_out: number };
  inference: {
    loaded_models: string[];
    in_flight_requests: number;
    tokens_generated: number;
    avg_latency_ms: number;
  };
  backend?: { type: string; port: number; version?: string };
  system_info?: {
    cpu_model: string;
    cpu_cores: number;
    cpu_threads: number;
    ram_total_gb: number;
    kernel: string;
    arch: string;
    os: string;
    disk_type: 'nvme' | 'ssd' | 'hdd' | 'unknown';
    agent_version: string;
  };
  toks_per_sec: number;
  requests_completed: number;
}

export interface ClusterNode {
  id: string;
  farm_hash: string;
  hostname: string;
  ip_address: string | null;
  registered_at: string;
  last_seen_at: string | null;
  status: 'online' | 'offline' | 'error' | 'rebooting';
  gpu_count: number;
  os_version: string | null;
  latest_stats?: StatsPayload;
}

export interface ClusterSummary {
  total_nodes: number;
  online_nodes: number;
  offline_nodes: number;
  total_gpus: number;
  total_vram_mb: number;
  total_models: number;
  inference_requests_24h: number;
  avg_latency_ms: number;
  error_rate_pct: number;
}

export interface HealthScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: Array<{ severity: 'warning' | 'critical'; message: string; node_id?: string }>;
  recommendations: string[];
}

export interface Alert {
  id: string;
  node_id: string;
  severity: 'warning' | 'critical';
  type: string;
  message: string;
  value: number;
  threshold: number;
  acknowledged: boolean;
  created_at: string;
}

export interface PowerStats {
  total_watts: number;
  daily_cost_usd: number;
  monthly_cost_usd: number;
}

export interface SparklineData {
  timestamps: number[];
  gpu_temp: number[];
  gpu_vram_pct: number[];
  toks_per_sec: number[];
}

export type SSEEvent =
  | { type: 'stats_update'; node_id: string; stats: StatsPayload }
  | { type: 'alert'; alert: Alert }
  | { type: 'node_online'; node_id: string; timestamp: string }
  | { type: 'node_offline'; node_id: string; timestamp: string }
  | { type: 'command_sent'; node_id: string; command: { id: string; action: string } }
  | { type: 'command_completed'; command_id: string }
  | { type: 'watchdog_event'; node_id: string; level: number; action: string };

export interface ModelDistribution {
  model: string;
  nodes: number;
  locations: Array<{ node_id: string; hostname: string }>;
}

export type ResourceType = 'cluster' | 'node' | 'gpu' | 'model';
export interface ResourceSelection {
  type: ResourceType;
  id: string;
}

export type TabId =
  | 'summary' | 'gpus' | 'models' | 'inference' | 'metrics'
  | 'terminal' | 'chat' | 'security' | 'alerts'
  | 'flight-sheets' | 'billing' | 'settings';

// ── Panel & Layout ──
export interface PanelConfig {
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsed: boolean;
}

// ── TODO Tracker ──
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: number;
  completedAt?: number;
  /** Optional: link to a node or model */
  resourceRef?: { type: ResourceType; id: string };
}

// ── Theme ──
export interface ThemeDefinition {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
}

// ── Keybinds ──
export interface KeybindAction {
  id: string;
  label: string;
  keys: string; // e.g. "ctrl+k", "g then s" (leader sequence)
  category: 'navigation' | 'panels' | 'actions' | 'tabs';
  action: () => void;
}
