// ─── TentaCLAW Dashboard — Home Page ────────────────────────────────────────

import React from 'react';
import { useStore } from '../store';
import {
  StatCard, ProgressBar, Sparkline, Badge, StatusDot, TempDisplay,
  formatBytes, formatPower, formatUptime, formatNumber, SectionHeader,
} from '../components/ui';
import {
  Server, Cpu, Zap, Activity, Thermometer, HardDrive,
  ArrowUpRight, ArrowDownRight, Wifi,
} from 'lucide-react';

export function DashboardPage() {
  const { nodes, fleet, models, agents, alerts } = useStore();

  if (!fleet || !fleet.nodesTotal) {
    return <div className="flex items-center justify-center h-64 text-text-muted">Loading fleet data...</div>;
  }

  const vramPct = fleet.totalVramTotalMb > 0
    ? Math.round((fleet.totalVramUsedMb / fleet.totalVramTotalMb) * 100) : 0;
  const maxPower = nodes.flatMap(n => n.gpus).reduce((s, g) => s + g.powerCapW, 0);
  const unackAlerts = alerts.filter(a => !a.acknowledged);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard label="Octopods" value={`${fleet.nodesOnline}/${fleet.nodesTotal}`} sub="nodes online" icon={<Server size={16} />} color="text-accent-3" />
        <StatCard label="GPUs Active" value={fleet.gpusActive} sub={`${fleet.gpusIdle} idle · ${fleet.gpusTotal} total`} icon={<Cpu size={16} />} color="text-success" />
        <StatCard label="Throughput" value={`${formatNumber(fleet.totalTokPerSec)} tok/s`} sub="cluster total" icon={<Activity size={16} />} color="text-accent" />
        <StatCard label="Power Draw" value={formatPower(fleet.totalPowerW)} sub={`of ${formatPower(maxPower)} capacity`} icon={<Zap size={16} />} color="text-warning" />
        <StatCard label="VRAM" value={`${vramPct}%`} sub={`${formatBytes(fleet.totalVramUsedMb)} / ${formatBytes(fleet.totalVramTotalMb)}`} icon={<HardDrive size={16} />} color="text-accent" />
        <StatCard label="Fleet Health" value={fleet.healthGrade} sub={`${fleet.healthPct}% score`} color={fleet.healthPct >= 80 ? 'text-success' : 'text-warning'} />
      </div>

      {/* GPU Fleet Grid */}
      <div>
        <SectionHeader title="GPU Fleet" subtitle={`${fleet.gpusTotal} GPUs across ${fleet.nodesTotal} Octopods`} />
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {nodes.map(node => (
            <div key={node.id} className="bg-bg-card border border-border rounded-xl overflow-hidden card-hover">
              {/* Node Header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={node.status} />
                  <span className="font-semibold text-sm">{node.name}</span>
                  <span className="text-xs text-text-muted">{node.ipAddress}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{formatUptime(node.uptimeSec)}</span>
                  <Badge variant={node.status === 'online' ? 'success' : 'danger'}>
                    {node.status}
                  </Badge>
                </div>
              </div>

              {/* Node System Stats */}
              {node.status === 'online' && (
                <div className="px-4 py-2 border-b border-border/50 grid grid-cols-3 gap-3">
                  <ProgressBar value={node.cpuPct} label="CPU" size="sm" />
                  <ProgressBar value={(node.memUsedMb / node.memTotalMb) * 100} label="MEM" size="sm" />
                  <ProgressBar value={(node.diskUsedGb / node.diskTotalGb) * 100} label="DISK" size="sm" />
                </div>
              )}

              {/* GPU Cards */}
              <div className="divide-y divide-border/30">
                {node.gpus.map(gpu => (
                  <div key={gpu.index} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <StatusDot status={gpu.status} />
                        <span className="text-sm font-medium">{gpu.shortName}</span>
                        <span className="text-xs text-text-muted">GPU {gpu.index}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <TempDisplay temp={gpu.tempC} />
                        <span className="text-warning font-mono">{gpu.powerW}W</span>
                      </div>
                    </div>

                    {/* VRAM + Load */}
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <ProgressBar
                        value={gpu.vramUsedMb}
                        max={gpu.vramTotalMb}
                        label="VRAM"
                        size="sm"
                        color={gpu.vramUsedMb / gpu.vramTotalMb > 0.9 ? 'bg-danger' : undefined}
                      />
                      <ProgressBar value={gpu.utilizationPct} label="Load" size="sm" />
                    </div>

                    {/* Model + Throughput */}
                    {gpu.status === 'active' && gpu.model ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-accent font-medium">{gpu.model}</span>
                          <span className="text-xs text-text-primary font-mono font-bold">{gpu.tokensPerSec} tok/s</span>
                        </div>
                        <Sparkline data={gpu.history} width={80} height={20} />
                      </div>
                    ) : gpu.status === 'idle' ? (
                      <div className="text-xs text-text-muted italic">No model loaded</div>
                    ) : (
                      <div className="text-xs text-danger">Unreachable</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Row: Models + Alerts + Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active Models */}
        <div className="bg-bg-card border border-border rounded-xl p-4">
          <SectionHeader title="Active Models" subtitle={`${fleet.models.length} deployed`} />
          <div className="space-y-2">
            {models.filter(m => m.status === 'loaded').map(m => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2">
                  <StatusDot status="active" />
                  <span className="text-sm font-medium">{m.name}</span>
                  <Badge variant="purple">{m.parameters}</Badge>
                </div>
                <span className="text-xs text-text-muted font-mono">{m.loadedOn.length} GPU{m.loadedOn.length !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Running Agents */}
        <div className="bg-bg-card border border-border rounded-xl p-4">
          <SectionHeader title="Running Agents" subtitle={`${agents.filter(a => a.status === 'running').length} active`} />
          <div className="space-y-2">
            {agents.filter(a => a.status === 'running').map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2">
                  <StatusDot status={a.status} />
                  <span className="text-sm font-medium">{a.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">{formatNumber(a.requestCount)} reqs</div>
                  <div className="text-xs text-text-muted">{a.avgLatencyMs}ms avg</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="bg-bg-card border border-border rounded-xl p-4">
          <SectionHeader title="Alerts" subtitle={`${unackAlerts.length} unacknowledged`} />
          <div className="space-y-2">
            {alerts.slice(0, 5).map(a => (
              <div key={a.id} className={`flex items-start gap-2 py-2 border-b border-border/30 last:border-0 ${a.acknowledged ? 'opacity-50' : ''}`}>
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${a.severity === 'critical' ? 'bg-danger' : a.severity === 'warning' ? 'bg-warning' : 'bg-accent-3'}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.title}</div>
                  <div className="text-xs text-text-muted">{new Date(a.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
