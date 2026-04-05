// ─── TentaCLAW Dashboard — Mock Data ────────────────────────────────────────

import type { OctopodNode, ModelInfo, AgentConfig, Alert, ChatSession } from './types';

function jitter(val: number, range: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val + (Math.random() - 0.5) * range));
}

function makeGpu(index: number, spec: { name: string; short: string; vram: number; cap: number; maxTok: number }, active: boolean, model: string | null) {
  const util = active ? 55 + Math.random() * 40 : 0;
  const temp = active ? 52 + Math.random() * 33 : 26 + Math.random() * 6;
  const power = active ? spec.cap * (0.35 + Math.random() * 0.55) : 12 + Math.random() * 15;
  const vramUsed = active ? spec.vram * (0.25 + Math.random() * 0.65) : spec.vram * 0.015;
  const tok = active ? spec.maxTok * (0.65 + Math.random() * 0.3) : 0;
  return {
    index,
    name: spec.name,
    shortName: spec.short,
    tempC: Math.round(temp),
    fanPct: Math.round(active ? 35 + Math.random() * 55 : 18 + Math.random() * 8),
    powerW: Math.round(power),
    powerCapW: spec.cap,
    vramUsedMb: Math.round(vramUsed),
    vramTotalMb: spec.vram,
    utilizationPct: Math.round(util),
    tokensPerSec: Math.round(tok),
    model,
    status: active ? 'active' as const : 'idle' as const,
    history: Array.from({ length: 30 }, () => Math.round(tok * (0.8 + Math.random() * 0.35))),
  };
}

const S = {
  '4090': { name: 'NVIDIA GeForce RTX 4090', short: 'RTX 4090', vram: 24564, cap: 450, maxTok: 165 },
  'A100': { name: 'NVIDIA A100 80GB SXM', short: 'A100 80GB', vram: 81920, cap: 300, maxTok: 320 },
  '3090': { name: 'NVIDIA GeForce RTX 3090', short: 'RTX 3090', vram: 24576, cap: 350, maxTok: 120 },
  'H100': { name: 'NVIDIA H100 80GB HBM3', short: 'H100 80GB', vram: 81559, cap: 700, maxTok: 480 },
  '4080': { name: 'NVIDIA GeForce RTX 4080 S', short: 'RTX 4080S', vram: 16384, cap: 320, maxTok: 110 },
};

export function createMockNodes(): OctopodNode[] {
  return [
    {
      id: 'octopod-1', name: 'Octopod-1', hostname: 'octopod-1.local', status: 'online',
      cpuPct: 38 + Math.random() * 25, memUsedMb: 48000 + Math.random() * 12000, memTotalMb: 65536,
      diskUsedGb: 420 + Math.random() * 80, diskTotalGb: 1000,
      networkRxKbps: 12000 + Math.random() * 8000, networkTxKbps: 8000 + Math.random() * 5000,
      uptimeSec: 86400 * 12 + Math.random() * 86400,
      gpus: [makeGpu(0, S['4090'], true, 'llama3.1-70b-q4'), makeGpu(1, S['4090'], true, 'llama3.1-70b-q4'), makeGpu(2, S['4090'], true, 'codestral-22b-q6')],
      ipAddress: '10.0.1.10', os: 'TentaCLAW OS 0.1.0', kernel: '6.8.0-tentaclaw', agentVersion: '0.9.4',
    },
    {
      id: 'octopod-2', name: 'Octopod-2', hostname: 'octopod-2.local', status: 'online',
      cpuPct: 22 + Math.random() * 18, memUsedMb: 98000 + Math.random() * 24000, memTotalMb: 131072,
      diskUsedGb: 680 + Math.random() * 120, diskTotalGb: 2000,
      networkRxKbps: 25000 + Math.random() * 15000, networkTxKbps: 18000 + Math.random() * 10000,
      uptimeSec: 86400 * 31 + Math.random() * 86400,
      gpus: [makeGpu(0, S['A100'], true, 'qwen2.5-72b-q4'), makeGpu(1, S['A100'], true, 'qwen2.5-72b-q4')],
      ipAddress: '10.0.1.11', os: 'TentaCLAW OS 0.1.0', kernel: '6.8.0-tentaclaw', agentVersion: '0.9.4',
    },
    {
      id: 'octopod-3', name: 'Octopod-3', hostname: 'octopod-3.local', status: 'online',
      cpuPct: 55 + Math.random() * 20, memUsedMb: 18000 + Math.random() * 8000, memTotalMb: 32768,
      diskUsedGb: 210 + Math.random() * 40, diskTotalGb: 500,
      networkRxKbps: 5000 + Math.random() * 3000, networkTxKbps: 3000 + Math.random() * 2000,
      uptimeSec: 86400 * 5 + Math.random() * 86400,
      gpus: [makeGpu(0, S['3090'], true, 'mistral-7b-q8'), makeGpu(1, S['4080'], true, 'phi-4-14b-q8')],
      ipAddress: '10.0.1.12', os: 'TentaCLAW OS 0.1.0', kernel: '6.8.0-tentaclaw', agentVersion: '0.9.3',
    },
    {
      id: 'octopod-4', name: 'Octopod-4', hostname: 'octopod-4.local', status: 'online',
      cpuPct: 6 + Math.random() * 8, memUsedMb: 3800 + Math.random() * 1500, memTotalMb: 32768,
      diskUsedGb: 55 + Math.random() * 15, diskTotalGb: 500,
      networkRxKbps: 200 + Math.random() * 300, networkTxKbps: 100 + Math.random() * 200,
      uptimeSec: 86400 * 2 + Math.random() * 86400,
      gpus: [makeGpu(0, S['4090'], false, null)],
      ipAddress: '10.0.1.13', os: 'TentaCLAW OS 0.1.0', kernel: '6.8.0-tentaclaw', agentVersion: '0.9.4',
    },
    {
      id: 'octopod-5', name: 'Octopod-5', hostname: 'octopod-5.local', status: 'offline',
      cpuPct: 0, memUsedMb: 0, memTotalMb: 65536, diskUsedGb: 0, diskTotalGb: 1000,
      networkRxKbps: 0, networkTxKbps: 0, uptimeSec: 0,
      gpus: [
        { index: 0, name: 'NVIDIA GeForce RTX 4090', shortName: 'RTX 4090', tempC: 0, fanPct: 0, powerW: 0, powerCapW: 450, vramUsedMb: 0, vramTotalMb: 24564, utilizationPct: 0, tokensPerSec: 0, model: null, status: 'offline', history: Array(30).fill(0) },
        { index: 1, name: 'NVIDIA GeForce RTX 4090', shortName: 'RTX 4090', tempC: 0, fanPct: 0, powerW: 0, powerCapW: 450, vramUsedMb: 0, vramTotalMb: 24564, utilizationPct: 0, tokensPerSec: 0, model: null, status: 'offline', history: Array(30).fill(0) },
      ],
      ipAddress: '10.0.1.14', os: 'TentaCLAW OS 0.1.0', kernel: '6.8.0-tentaclaw', agentVersion: '0.9.2',
    },
  ];
}

export function updateMockNodes(nodes: OctopodNode[]): OctopodNode[] {
  return nodes.map(n => {
    if (n.status === 'offline') return n;
    return {
      ...n,
      cpuPct: jitter(n.cpuPct, 6, 3, 97),
      memUsedMb: jitter(n.memUsedMb, 800, 1000, n.memTotalMb * 0.95),
      networkRxKbps: jitter(n.networkRxKbps, 2000, 50, 80000),
      networkTxKbps: jitter(n.networkTxKbps, 1500, 30, 60000),
      uptimeSec: n.uptimeSec + 2,
      gpus: n.gpus.map(g => {
        if (g.status === 'offline' || g.status === 'idle') return { ...g, tempC: Math.round(jitter(g.tempC, 2, 24, 40)), history: [...g.history.slice(1), 0] };
        const tok = Math.max(10, jitter(g.tokensPerSec, 18, 0, g.powerCapW * 1.5));
        return {
          ...g,
          tempC: Math.round(jitter(g.tempC, 3, 35, 94)),
          fanPct: Math.round(jitter(g.fanPct, 4, 20, 100)),
          powerW: Math.round(jitter(g.powerW, 15, 50, g.powerCapW)),
          vramUsedMb: Math.round(jitter(g.vramUsedMb, 200, 500, g.vramTotalMb * 0.98)),
          utilizationPct: Math.round(jitter(g.utilizationPct, 6, 10, 100)),
          tokensPerSec: Math.round(tok),
          history: [...g.history.slice(1), Math.round(tok)],
        };
      }),
    };
  });
}

export const mockModels: ModelInfo[] = [
  { id: 'llama3.1-70b-q4', name: 'LLaMA 3.1 70B', family: 'LLaMA', parameters: '70B', quantization: 'Q4_K_M', sizeMb: 40960, vramRequiredMb: 42000, maxContext: 128000, loadedOn: ['octopod-1:0', 'octopod-1:1'], status: 'loaded', tokPerSec: 148, description: 'Meta\'s flagship open model. Excellent at reasoning, coding, and instruction following.' },
  { id: 'qwen2.5-72b-q4', name: 'Qwen 2.5 72B', family: 'Qwen', parameters: '72B', quantization: 'Q4_K_M', sizeMb: 41500, vramRequiredMb: 44000, maxContext: 131072, loadedOn: ['octopod-2:0', 'octopod-2:1'], status: 'loaded', tokPerSec: 294, description: 'Alibaba\'s multilingual powerhouse. Strong math, coding, and Chinese language support.' },
  { id: 'codestral-22b-q6', name: 'Codestral 22B', family: 'Mistral', parameters: '22B', quantization: 'Q6_K', sizeMb: 18000, vramRequiredMb: 19000, maxContext: 32768, loadedOn: ['octopod-1:2'], status: 'loaded', tokPerSec: 131, description: 'Mistral\'s code-optimized model. Best-in-class for code generation and FIM.' },
  { id: 'mistral-7b-q8', name: 'Mistral 7B', family: 'Mistral', parameters: '7B', quantization: 'Q8_0', sizeMb: 7680, vramRequiredMb: 8500, maxContext: 32768, loadedOn: ['octopod-3:0'], status: 'loaded', tokPerSec: 105, description: 'Fast and efficient. Great as a routing model or for lightweight tasks.' },
  { id: 'phi-4-14b-q8', name: 'Phi-4 14B', family: 'Phi', parameters: '14B', quantization: 'Q8_0', sizeMb: 15000, vramRequiredMb: 16000, maxContext: 16384, loadedOn: ['octopod-3:1'], status: 'loaded', tokPerSec: 98, description: 'Microsoft\'s compact reasoning model. Punches above its weight on benchmarks.' },
  { id: 'deepseek-v3-q4', name: 'DeepSeek V3', family: 'DeepSeek', parameters: '671B MoE', quantization: 'Q4_K_M', sizeMb: 380000, vramRequiredMb: 160000, maxContext: 128000, loadedOn: [], status: 'available', description: 'Massive MoE model. Requires multi-node deployment. State-of-the-art reasoning.' },
  { id: 'gemma2-27b-q5', name: 'Gemma 2 27B', family: 'Gemma', parameters: '27B', quantization: 'Q5_K_M', sizeMb: 20000, vramRequiredMb: 22000, maxContext: 8192, loadedOn: [], status: 'available', description: 'Google\'s open model. Strong instruction following with efficient architecture.' },
  { id: 'command-r-plus-q4', name: 'Command R+', family: 'Cohere', parameters: '104B', quantization: 'Q4_K_M', sizeMb: 60000, vramRequiredMb: 65000, maxContext: 128000, loadedOn: [], status: 'available', description: 'Cohere\'s RAG-optimized model. Excellent at grounded generation with citations.' },
];

export const mockAgents: AgentConfig[] = [
  { id: 'agent-code', name: 'CodePilot', description: 'Pair programming assistant with code execution', model: 'codestral-22b-q6', systemPrompt: 'You are an expert coding assistant...', tools: ['code_exec', 'file_read', 'file_write', 'web_search'], temperature: 0.3, maxTokens: 8192, status: 'running', createdAt: Date.now() - 86400000 * 3, requestCount: 1247, avgLatencyMs: 820 },
  { id: 'agent-research', name: 'ResearchBot', description: 'Deep research with web browsing and summarization', model: 'qwen2.5-72b-q4', systemPrompt: 'You are a research assistant...', tools: ['web_search', 'web_browse', 'summarize', 'cite'], temperature: 0.5, maxTokens: 16384, status: 'running', createdAt: Date.now() - 86400000 * 7, requestCount: 523, avgLatencyMs: 2100 },
  { id: 'agent-chat', name: 'FleetAssistant', description: 'TentaCLAW cluster management helper', model: 'llama3.1-70b-q4', systemPrompt: 'You help manage the TentaCLAW GPU cluster...', tools: ['cluster_status', 'node_control', 'model_deploy'], temperature: 0.7, maxTokens: 4096, status: 'running', createdAt: Date.now() - 86400000, requestCount: 89, avgLatencyMs: 650 },
  { id: 'agent-data', name: 'DataAnalyst', description: 'SQL and data analysis agent', model: 'phi-4-14b-q8', systemPrompt: 'You are a data analyst...', tools: ['sql_query', 'chart_gen', 'csv_parse'], temperature: 0.2, maxTokens: 4096, status: 'stopped', createdAt: Date.now() - 86400000 * 14, requestCount: 2341, avgLatencyMs: 450 },
];

export const mockAlerts: Alert[] = [
  { id: 'a1', severity: 'critical', title: 'Octopod-5 Offline', message: 'Node octopod-5 has been unreachable for 2 hours. Last heartbeat at 14:22 UTC.', nodeId: 'octopod-5', timestamp: Date.now() - 7200000, acknowledged: false },
  { id: 'a2', severity: 'warning', title: 'High VRAM Usage', message: 'Octopod-1 GPU 2 VRAM at 92%. Consider offloading or upgrading.', nodeId: 'octopod-1', timestamp: Date.now() - 3600000, acknowledged: false },
  { id: 'a3', severity: 'warning', title: 'GPU Temperature Elevated', message: 'Octopod-2 GPU 0 at 81°C. Check cooling and ambient temperature.', nodeId: 'octopod-2', timestamp: Date.now() - 1800000, acknowledged: true },
  { id: 'a4', severity: 'info', title: 'Model Update Available', message: 'llama3.1-70b-q4 has a new quantization available (Q5_K_M).', timestamp: Date.now() - 900000, acknowledged: false },
];

export const mockChatSession: ChatSession = {
  id: 'session-1',
  title: 'New Chat',
  model: 'llama3.1-70b-q4',
  createdAt: Date.now(),
  messages: [],
};
