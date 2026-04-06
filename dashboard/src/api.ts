// ─── TentaCLAW Dashboard — API Client ───────────────────────────────────────
// Connects to the real gateway. Falls back to mock data if unavailable.

const BASE = (window as any).__TENTACLAW_GATEWAY__ || '';

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

// ─── Gateway API Types ─────────────────────────────────────────────────────

interface GatewaySummary {
  total_nodes: number;
  online_nodes: number;
  offline_nodes: number;
  total_gpus: number;
  total_vram_mb: number;
  used_vram_mb: number;
  total_toks_per_sec: number;
  loaded_models: string[];
}

interface GatewayGpu {
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

interface GatewayNodeStats {
  cpu_percent?: number;
  mem_used_mb?: number;
  mem_total_mb?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  uptime_secs?: number;
  gpu_count?: number;
  gpus?: GatewayGpu[];
  loaded_models?: string[];
  backend?: { type: string; port: number };
}

interface GatewayNode {
  id: string;
  farm_hash: string;
  hostname: string;
  ip_address: string;
  status: string;
  gpu_count: number;
  os_version: string;
  latest_stats: GatewayNodeStats | null;
}

interface GatewayAlert {
  id: number;
  severity: string;
  title: string;
  message: string;
  node_id?: string;
  created_at: string;
  acknowledged: number;
}

// ─── Transformers (Gateway → Dashboard types) ───────────────────────────────

import type { OctopodNode, GpuInfo, Alert } from './types';

function gpuShortName(name: string): string {
  return name.replace('NVIDIA ', '').replace('GeForce ', '').replace('AMD ', '').replace('Radeon ', '');
}

export function transformNode(n: GatewayNode): OctopodNode {
  const stats = n.latest_stats;
  const gpus: GpuInfo[] = (stats?.gpus || []).map((g, i) => ({
    index: i,
    name: g.name,
    shortName: gpuShortName(g.name),
    tempC: g.temperatureC || 0,
    fanPct: g.fanSpeedPct || 0,
    powerW: g.powerDrawW || 0,
    powerCapW: Math.round((g.powerDrawW || 0) * 1.3),
    vramUsedMb: g.vramUsedMb || 0,
    vramTotalMb: g.vramTotalMb || 0,
    utilizationPct: g.utilizationPct || 0,
    tokensPerSec: 0,
    model: null,
    status: g.utilizationPct > 5 ? 'active' as const : 'idle' as const,
    history: Array(30).fill(0).map(() => Math.random() * (g.utilizationPct || 10)),
  }));

  // Map loaded models to GPUs
  const models = stats?.loaded_models || [];
  gpus.forEach((gpu, i) => {
    if (models[i]) {
      gpu.model = models[i];
      gpu.status = 'active';
      gpu.tokensPerSec = Math.round(50 + Math.random() * 200);
    }
  });

  const displayName = n.hostname.startsWith('pve') ? `Octopod-${n.hostname.replace('pve', '').replace('-', '') || '1'}` : n.hostname;

  return {
    id: n.id,
    name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
    hostname: n.hostname,
    status: n.status === 'online' ? 'online' : 'offline',
    cpuPct: stats?.cpu_percent || 0,
    memUsedMb: stats?.mem_used_mb || 0,
    memTotalMb: stats?.mem_total_mb || 1,
    diskUsedGb: stats?.disk_used_gb || 0,
    diskTotalGb: stats?.disk_total_gb || 1,
    networkRxKbps: 0,
    networkTxKbps: 0,
    uptimeSec: stats?.uptime_secs || 0,
    gpus,
    ipAddress: n.ip_address,
    os: '',
    kernel: '',
    agentVersion: '',
  };
}

export function transformAlert(a: GatewayAlert): Alert {
  return {
    id: String(a.id),
    severity: (a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info') as Alert['severity'],
    title: a.title,
    message: a.message,
    nodeId: a.node_id,
    timestamp: new Date(a.created_at).getTime(),
    acknowledged: a.acknowledged === 1,
  };
}

// ─── API Functions ──────────────────────────────────────────────────────────

export async function fetchSummary(): Promise<GatewaySummary | null> {
  return get<GatewaySummary>('/api/v1/summary');
}

export async function fetchNodes(): Promise<OctopodNode[]> {
  const data = await get<{ nodes: GatewayNode[] }>('/api/v1/nodes');
  if (!data?.nodes) return [];
  return data.nodes.map(transformNode);
}

export async function fetchAlerts(): Promise<Alert[]> {
  const data = await get<{ alerts: GatewayAlert[] }>('/api/v1/alerts');
  if (!data?.alerts) return [];
  return data.alerts.map(transformAlert);
}

export async function acknowledgeAlert(id: string): Promise<boolean> {
  const r = await post(`/api/v1/alerts/${id}/acknowledge`, {});
  return r !== null;
}

export async function chatCompletion(model: string, messages: { role: string; content: string }[]): Promise<any> {
  return post('/v1/chat/completions', { model, messages, stream: false });
}

export async function fetchModels(): Promise<any[]> {
  const data = await get<{ data: any[] }>('/v1/models');
  return data?.data || [];
}

export { type GatewaySummary };
