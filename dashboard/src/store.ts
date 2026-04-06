// ─── TentaCLAW Dashboard — Global Store (Zustand) ───────────────────────────
// Connects to real gateway API. Falls back to mock data if gateway unreachable.

import { create } from 'zustand';
import type { OctopodNode, FleetStatus, ModelInfo, AgentConfig, Alert, ChatSession, ChatMessage, Page } from './types';
import { createMockNodes, updateMockNodes, mockModels, mockAgents, mockAlerts, mockChatSession } from './mock';
import { fetchNodes as apiFetchNodes, fetchAlerts as apiFetchAlerts, fetchSummary, chatCompletion, type GatewaySummary } from './api';

function computeFleet(nodes: OctopodNode[]): FleetStatus {
  const online = nodes.filter(n => n.status === 'online');
  const gpus = nodes.flatMap(n => n.gpus);
  const active = gpus.filter(g => g.status === 'active');
  const idle = gpus.filter(g => g.status === 'idle');
  const models = [...new Set(gpus.map(g => g.model).filter(Boolean) as string[])];
  const onPct = nodes.length > 0 ? (online.length / nodes.length) * 100 : 0;
  const gpuPct = gpus.length > 0 ? ((active.length + idle.length) / gpus.length) * 100 : 0;
  const hp = Math.round(onPct * 0.6 + gpuPct * 0.4);
  const grade = hp >= 90 ? 'A' : hp >= 80 ? 'B' : hp >= 70 ? 'C' : hp >= 60 ? 'D' : 'F';
  const avgCpu = online.length > 0 ? online.reduce((s, n) => s + n.cpuPct, 0) / online.length : 0;
  const avgMem = online.length > 0 ? online.reduce((s, n) => s + (n.memUsedMb / n.memTotalMb) * 100, 0) / online.length : 0;
  return {
    nodesOnline: online.length, nodesTotal: nodes.length,
    gpusActive: active.length, gpusIdle: idle.length, gpusTotal: gpus.length,
    healthPct: hp, healthGrade: grade,
    totalTokPerSec: gpus.reduce((s, g) => s + g.tokensPerSec, 0),
    totalPowerW: gpus.reduce((s, g) => s + g.powerW, 0),
    totalVramUsedMb: gpus.reduce((s, g) => s + g.vramUsedMb, 0),
    totalVramTotalMb: gpus.reduce((s, g) => s + g.vramTotalMb, 0),
    avgTempC: gpus.length > 0 ? Math.round(gpus.reduce((s, g) => s + g.tempC, 0) / gpus.length) : 0,
    avgCpuPct: Math.round(avgCpu), avgMemPct: Math.round(avgMem),
    models, totalInferences: Math.round(Math.random() * 50000 + 100000),
  };
}

interface Store {
  // Navigation
  page: Page;
  setPage: (p: Page) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Connection
  connected: boolean;
  lastError: string | null;

  // Fleet
  nodes: OctopodNode[];
  fleet: FleetStatus;
  tick: () => void;

  // Models
  models: ModelInfo[];

  // Agents
  agents: AgentConfig[];
  updateAgent: (id: string, patch: Partial<AgentConfig>) => void;

  // Alerts
  alerts: Alert[];
  acknowledgeAlert: (id: string) => void;

  // Chat
  sessions: ChatSession[];
  activeSession: string;
  addMessage: (msg: ChatMessage) => void;
  setActiveModel: (model: string) => void;

  // Init
  init: () => void;
  intervalId: ReturnType<typeof setInterval> | null;
}

export const useStore = create<Store>((set, get) => ({
  page: 'dashboard',
  setPage: (p) => set({ page: p }),
  sidebarCollapsed: false,
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  connected: false,
  lastError: null,

  nodes: [],
  fleet: {} as FleetStatus,
  tick: async () => {
    // Try real API first
    try {
      const apiNodes = await apiFetchNodes();
      if (apiNodes.length > 0) {
        // Merge with mock nodes for a fuller display
        const mockNodes = get().nodes.filter(n => !apiNodes.find(a => a.id === n.id));
        const allNodes = [...apiNodes, ...updateMockNodes(mockNodes)];
        set({ nodes: allNodes, fleet: computeFleet(allNodes), connected: true, lastError: null });
        return;
      }
    } catch { /* fall through to mock */ }

    // Fallback to mock
    set(s => {
      const nodes = updateMockNodes(s.nodes);
      return { nodes, fleet: computeFleet(nodes), connected: false };
    });
  },

  models: mockModels,
  agents: mockAgents,
  updateAgent: (id, patch) => set(s => ({
    agents: s.agents.map(a => a.id === id ? { ...a, ...patch } : a),
  })),

  alerts: mockAlerts,
  acknowledgeAlert: (id) => set(s => ({
    alerts: s.alerts.map(a => a.id === id ? { ...a, acknowledged: true } : a),
  })),

  sessions: [mockChatSession],
  activeSession: mockChatSession.id,
  addMessage: (msg) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === s.activeSession
        ? { ...sess, messages: [...sess.messages, msg], title: sess.messages.length === 0 ? msg.content.slice(0, 40) : sess.title }
        : sess
    ),
  })),
  setActiveModel: (model) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === s.activeSession ? { ...sess, model } : sess
    ),
  })),

  intervalId: null,
  init: async () => {
    // Try real API first
    let nodes: OctopodNode[] = [];
    try {
      nodes = await apiFetchNodes();
    } catch { /* ignore */ }

    // If no real nodes, use mock
    if (nodes.length === 0) {
      nodes = createMockNodes();
    }

    // Try fetching real alerts
    try {
      const realAlerts = await apiFetchAlerts();
      if (realAlerts.length > 0) {
        set({ alerts: realAlerts });
      }
    } catch { /* keep mock alerts */ }

    const fleet = computeFleet(nodes);
    set({ nodes, fleet, connected: nodes.length > 0 });

    const intervalId = setInterval(() => get().tick(), 2000);
    set({ intervalId });
  },
}));
