// ─── TentaCLAW Dashboard — Types ────────────────────────────────────────────

export interface GpuInfo {
  index: number;
  name: string;
  shortName: string;
  tempC: number;
  fanPct: number;
  powerW: number;
  powerCapW: number;
  vramUsedMb: number;
  vramTotalMb: number;
  utilizationPct: number;
  tokensPerSec: number;
  model: string | null;
  status: 'active' | 'idle' | 'error' | 'offline';
  history: number[];
}

export interface OctopodNode {
  id: string;
  name: string;
  hostname: string;
  status: 'online' | 'offline' | 'warning';
  cpuPct: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  networkRxKbps: number;
  networkTxKbps: number;
  uptimeSec: number;
  gpus: GpuInfo[];
  ipAddress: string;
  os: string;
  kernel: string;
  agentVersion: string;
}

export interface FleetStatus {
  nodesOnline: number;
  nodesTotal: number;
  gpusActive: number;
  gpusIdle: number;
  gpusTotal: number;
  healthPct: number;
  healthGrade: string;
  totalTokPerSec: number;
  totalPowerW: number;
  totalVramUsedMb: number;
  totalVramTotalMb: number;
  avgTempC: number;
  avgCpuPct: number;
  avgMemPct: number;
  models: string[];
  totalInferences: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  parameters: string;
  quantization: string;
  sizeMb: number;
  vramRequiredMb: number;
  maxContext: number;
  loadedOn: string[];       // GPU IDs where currently loaded
  status: 'loaded' | 'available' | 'downloading' | 'error';
  downloadPct?: number;
  tokPerSec?: number;
  description: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  temperature: number;
  maxTokens: number;
  status: 'running' | 'stopped' | 'error';
  createdAt: number;
  requestCount: number;
  avgLatencyMs: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
  nodeId?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  nodeId?: string;
  timestamp: number;
  acknowledged: boolean;
}

export type Page = 'dashboard' | 'models' | 'agents' | 'chat' | 'cluster' | 'alerts' | 'settings';
