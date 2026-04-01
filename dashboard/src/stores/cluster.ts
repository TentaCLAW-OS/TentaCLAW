import { create } from 'zustand';
import type { ClusterNode, ClusterSummary, HealthScore, Alert, PowerStats, SSEEvent } from '@/lib/types';
import { api } from '@/lib/api';

interface ClusterState {
  nodes: ClusterNode[];
  summary: ClusterSummary | null;
  health: HealthScore | null;
  alerts: Alert[];
  power: PowerStats | null;
  connected: boolean;
  lastEvent: number;
  lastRawEvent: SSEEvent | null;

  loadInitial: () => Promise<void>;
  handleSSE: (event: SSEEvent) => void;
  setConnected: (c: boolean) => void;
}

export const useClusterStore = create<ClusterState>((set, get) => ({
  nodes: [],
  summary: null,
  health: null,
  alerts: [],
  power: null,
  connected: false,
  lastEvent: 0,
  lastRawEvent: null,

  loadInitial: async () => {
    const [summary, nodes, health, power, alerts] = await Promise.all([
      api.getSummary(),
      api.getNodes(),
      api.getHealthScore(),
      api.getPower().catch(() => null),
      api.getAlerts(),
    ]);
    set({ summary, nodes, health, power, alerts });
  },

  handleSSE: (event) => {
    const state = get();
    set({ lastEvent: Date.now(), lastRawEvent: event });

    switch (event.type) {
      case 'stats_update': {
        const idx = state.nodes.findIndex((n) => n.id === event.node_id);
        if (idx === -1) return;
        const updated = [...state.nodes];
        updated[idx] = {
          ...updated[idx],
          latest_stats: event.stats,
          status: 'online',
          last_seen_at: new Date().toISOString(),
        };
        set({ nodes: updated });
        break;
      }
      case 'node_online': {
        const updated = state.nodes.map((n) =>
          n.id === event.node_id
            ? { ...n, status: 'online' as const, last_seen_at: event.timestamp }
            : n,
        );
        set({ nodes: updated });
        break;
      }
      case 'node_offline': {
        const updated = state.nodes.map((n) =>
          n.id === event.node_id ? { ...n, status: 'offline' as const } : n,
        );
        set({ nodes: updated });
        break;
      }
      case 'alert': {
        set({ alerts: [event.alert, ...state.alerts].slice(0, 100) });
        break;
      }
    }
  },

  setConnected: (connected) => set({ connected }),
}));
