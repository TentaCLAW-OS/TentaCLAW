// ─── TentaCLAW Dashboard — Cluster Control Page ─────────────────────────────

import React, { useState } from 'react';
import { useStore } from '../store';
import { StatCard, ProgressBar, Badge, StatusDot, TempDisplay, formatBytes, formatPower, formatUptime } from '../components/ui';
import {
  Server, Cpu, HardDrive, MemoryStick, Thermometer,
  Zap, ChevronDown, ChevronRight, Terminal, Activity,
  RefreshCw, Power, Settings, MonitorDot, Wifi, WifiOff,
} from 'lucide-react';

export function ClusterPage() {
  const { nodes, fleet } = useStore();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(nodes.map(n => n.id)));
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [shellInput, setShellInput] = useState('');
  const [shellHistory, setShellHistory] = useState<{ cmd: string; out: string; ts: number }[]>([
    { cmd: 'tentaclaw status', out: 'All systems operational. 5 nodes online, 10 GPUs active.', ts: Date.now() - 60000 },
    { cmd: 'tentaclaw gpu list', out: 'RTX 4090 x3  |  A100 80GB x2  |  RTX 3090 x1  |  RTX 4080S x1\nTotal VRAM: 344 GB  |  In Use: 267 GB  |  Available: 77 GB', ts: Date.now() - 30000 },
  ]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedNodes);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedNodes(next);
  };

  const handleShell = () => {
    if (!shellInput.trim()) return;
    const out = shellInput.includes('help')
      ? 'Available commands:\n  status, gpu list, gpu load <model>, node info <id>, model pull <name>, restart <node>'
      : `Executed: ${shellInput}\nOK`;
    setShellHistory(prev => [...prev, { cmd: shellInput.trim(), out, ts: Date.now() }]);
    setShellInput('');
  };

  const selNode = nodes.find(n => n.id === selectedNode) || nodes[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold gradient-text">Cluster Control</h1>
          <p className="text-xs text-text-muted mt-1">Manage your Octopod fleet</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:border-border-focus transition-colors flex items-center gap-1.5">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard label="Nodes Online" value={`${fleet?.nodesOnline || 0}/${nodes.length}`} icon={<Server size={14} />} color="text-success" />
        <StatCard label="Total GPUs" value={`${fleet?.gpusTotal || 0}`} icon={<Cpu size={14} />} color="text-accent" />
        <StatCard label="VRAM Used" value={fleet ? `${Math.round(fleet.totalVramUsedMb / 1024)} GB` : '0'} icon={<MemoryStick size={14} />} color="text-accent-2" />
        <StatCard label="Throughput" value={fleet ? `${Math.round(fleet.totalTokPerSec)} t/s` : '0'} icon={<Activity size={14} />} color="text-accent-3" />
        <StatCard label="Power Draw" value={fleet ? formatPower(fleet.totalPowerW) : '0 W'} icon={<Zap size={14} />} color="text-warning" />
        <StatCard label="Fleet Uptime" value="99.98%" icon={<MonitorDot size={14} />} color="text-success" />
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Node Tree (Left Panel) */}
        <div className="col-span-4 bg-bg-card border border-border rounded-xl p-4 max-h-[600px] overflow-y-auto custom-scrollbar">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Node Tree</h3>
          <div className="space-y-1">
            {nodes.map(node => (
              <div key={node.id}>
                {/* Node Row */}
                <button
                  onClick={() => { toggleExpand(node.id); setSelectedNode(node.id); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${selectedNode === node.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-card-hover text-text-primary'}`}
                >
                  {expandedNodes.has(node.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <StatusDot status={node.status} />
                  <Server size={12} className="text-text-muted" />
                  <span className="font-medium">{node.name}</span>
                  <span className="ml-auto text-text-muted">{node.gpus.length} GPU{node.gpus.length !== 1 ? 's' : ''}</span>
                </button>
                {/* GPU Children */}
                {expandedNodes.has(node.id) && (
                  <div className="ml-6 mt-0.5 space-y-0.5 border-l border-border/50 pl-3">
                    {node.gpus.map((gpu, gi) => (
                      <div key={gi} className="flex items-center gap-2 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-card-hover transition-colors">
                        <Cpu size={10} className="text-accent-3" />
                        <span className="truncate">{gpu.name.replace('NVIDIA ', '').replace('GeForce ', '')}</span>
                        <span className="ml-auto text-text-muted whitespace-nowrap">{Math.round(gpu.vramUsedMb / 1024)}/{Math.round(gpu.vramTotalMb / 1024)}G</span>
                      </div>
                    ))}
                    {/* System resources */}
                    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-text-muted">
                      <Cpu size={10} /> CPU {Math.round(node.cpuPct)}%
                      <MemoryStick size={10} className="ml-2" /> RAM {Math.round(node.memUsedMb / 1024)}/{Math.round(node.memTotalMb / 1024)}G
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Node Detail (Center Panel) */}
        <div className="col-span-5 space-y-4">
          {selNode && (
            <>
              {/* Node Header */}
              <div className="bg-bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                      <Server size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{selNode.name}</h3>
                      <div className="text-[11px] text-text-muted">{selNode.ipAddress} · up {formatUptime(selNode.uptimeSec)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={selNode.status === 'online' ? 'success' : 'danger'}>{selNode.status}</Badge>
                    <button className="p-1.5 bg-bg-card-hover rounded-lg text-text-muted hover:text-text-primary transition-colors">
                      <Settings size={14} />
                    </button>
                    <button className="p-1.5 bg-bg-card-hover rounded-lg text-text-muted hover:text-danger transition-colors">
                      <Power size={14} />
                    </button>
                  </div>
                </div>

                {/* System Resources */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]"><span className="text-text-muted">CPU</span><span>{Math.round(selNode.cpuPct)}%</span></div>
                    <ProgressBar value={selNode.cpuPct} max={100} color="bg-accent" size="sm" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]"><span className="text-text-muted">Memory</span><span>{Math.round(selNode.memUsedMb / 1024)}/{Math.round(selNode.memTotalMb / 1024)} GB</span></div>
                    <ProgressBar value={selNode.memUsedMb} max={selNode.memTotalMb} color="bg-accent-2" size="sm" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]"><span className="text-text-muted">Disk</span><span>{Math.round(selNode.diskUsedGb)}/{Math.round(selNode.diskTotalGb)} GB</span></div>
                    <ProgressBar value={selNode.diskUsedGb} max={selNode.diskTotalGb} color="bg-accent-3" size="sm" />
                  </div>
                </div>
              </div>

              {/* GPU Cards */}
              <div className="space-y-3">
                {selNode.gpus.map((gpu, gi) => (
                  <div key={gi} className="bg-bg-card border border-border rounded-xl p-4 card-hover">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Cpu size={14} className="text-accent-3" />
                        <span className="text-sm font-medium">{gpu.name}</span>
                        <Badge variant="info">GPU {gpu.index}</Badge>
                      </div>
                      <TempDisplay temp={gpu.tempC} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]"><span className="text-text-muted">VRAM</span><span>{Math.round(gpu.vramUsedMb / 1024)}/{Math.round(gpu.vramTotalMb / 1024)} GB</span></div>
                        <ProgressBar value={gpu.vramUsedMb} max={gpu.vramTotalMb} color="bg-accent" size="sm" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]"><span className="text-text-muted">Load</span><span>{Math.round(gpu.utilizationPct)}%</span></div>
                        <ProgressBar value={gpu.utilizationPct} max={100} color={gpu.utilizationPct > 80 ? 'bg-warning' : 'bg-success'} size="sm" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-text-muted">
                      <span>Power: {formatPower(gpu.powerW)}</span>
                      <span>Fan: {gpu.fanPct}%</span>
                      <span>
                        Model: <span className="text-text-primary font-medium">{gpu.model || 'none'}</span>
                      </span>
                      {gpu.tokensPerSec != null && gpu.tokensPerSec > 0 && (
                        <span className="text-accent">{gpu.tokensPerSec.toFixed(1)} tok/s</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Shell Panel (Right) */}
        <div className="col-span-3 bg-bg-card border border-border rounded-xl flex flex-col max-h-[600px]">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
            <Terminal size={12} className="text-accent-3" />
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Shell</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar font-mono text-[11px] space-y-2">
            {shellHistory.map((entry, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-accent">❯</span>
                  <span className="text-text-primary">{entry.cmd}</span>
                </div>
                <div className="text-text-muted whitespace-pre-wrap ml-4">{entry.out}</div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <div className="flex items-center gap-2 bg-bg-primary rounded-lg px-2">
              <span className="text-accent text-xs">❯</span>
              <input
                value={shellInput}
                onChange={e => setShellInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleShell()}
                placeholder="tentaclaw ..."
                className="flex-1 bg-transparent text-xs text-text-primary py-2 focus:outline-none placeholder:text-text-muted font-mono"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
