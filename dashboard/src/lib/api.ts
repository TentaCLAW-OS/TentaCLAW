import type { ClusterSummary, ClusterNode, HealthScore, PowerStats, Alert, SparklineData, ModelDistribution } from './types';

const BASE = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  getSummary: () => request<ClusterSummary>('/api/v1/summary'),
  getNodes: async () => {
    const res = await request<{ nodes: ClusterNode[] } | ClusterNode[]>('/api/v1/nodes');
    return Array.isArray(res) ? res : res.nodes;
  },
  getHealthScore: () => request<HealthScore>('/api/v1/health/score'),
  getPower: async () => {
    const res = await request<Record<string, unknown>>('/api/v1/power');
    return {
      total_watts: (res.total_watts ?? res.totalWatts ?? 0) as number,
      daily_cost_usd: (res.daily_cost_usd ?? res.dailyCostUsd ?? 0) as number,
      monthly_cost_usd: (res.monthly_cost_usd ?? res.monthlyCostUsd ?? 0) as number,
    } as PowerStats;
  },
  getAlerts: async (limit = 50) => {
    const res = await request<{ alerts: Alert[] } | Alert[]>(`/api/v1/alerts?limit=${limit}`);
    return Array.isArray(res) ? res : res.alerts;
  },
  getSparklines: (nodeId: string) => request<SparklineData>(`/api/v1/nodes/${nodeId}/sparklines`),
  sendCommand: (nodeId: string, action: string, params?: Record<string, unknown>) =>
    request<{ id: string }>(`/api/v1/nodes/${nodeId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ action, ...params }),
    }),
  getModelDistribution: () =>
    request<ModelDistribution[]>('/api/v1/models/distribution'),
  smartDeploy: (model: string) =>
    request<{ ok: boolean; message: string }>('/api/v1/models/smart-deploy', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  acknowledgeAlert: (id: string) =>
    request<void>(`/api/v1/alerts/${id}/acknowledge`, { method: 'POST' }),
};
