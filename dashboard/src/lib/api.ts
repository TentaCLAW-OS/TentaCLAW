import type { ClusterSummary, ClusterNode, HealthScore, PowerStats, Alert, SparklineData } from './types';

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
  getNodes: () => request<ClusterNode[]>('/api/v1/nodes'),
  getHealthScore: () => request<HealthScore>('/api/v1/health/score'),
  getPower: () => request<PowerStats>('/api/v1/power'),
  getAlerts: (limit = 50) => request<Alert[]>(`/api/v1/alerts?limit=${limit}`),
  getSparklines: (nodeId: string) => request<SparklineData>(`/api/v1/nodes/${nodeId}/sparklines`),
  sendCommand: (nodeId: string, action: string, params?: Record<string, unknown>) =>
    request<{ id: string }>(`/api/v1/nodes/${nodeId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ action, ...params }),
    }),
};
