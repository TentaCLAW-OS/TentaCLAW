// ─── TentaCLAW Dashboard — Top Bar ──────────────────────────────────────────

import React from 'react';
import { useStore } from '../store';
import { formatPower, formatNumber, Badge } from './ui';
import { Activity, Thermometer, Zap, Server } from 'lucide-react';

export function TopBar() {
  const { fleet, nodes } = useStore();
  if (!fleet || !fleet.nodesTotal) return null;

  const vramPct = fleet.totalVramTotalMb > 0
    ? Math.round((fleet.totalVramUsedMb / fleet.totalVramTotalMb) * 100) : 0;

  return (
    <header className="h-12 bg-topbar border-b border-border flex items-center px-4 gap-6 text-sm">
      {/* Fleet health */}
      <div className="flex items-center gap-2">
        <Server size={14} className="text-accent-3" />
        <span className="text-text-primary font-medium">{fleet.nodesOnline}/{fleet.nodesTotal}</span>
        <span className="text-text-muted">pods</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* GPUs */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-success inline-block" />
        <span className="text-text-primary font-medium">{fleet.gpusActive}</span>
        <span className="text-text-muted">active</span>
        <span className="text-warning font-medium ml-1">{fleet.gpusIdle}</span>
        <span className="text-text-muted">idle</span>
        <span className="text-text-muted">/ {fleet.gpusTotal} GPUs</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Throughput */}
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-success" />
        <span className="text-text-primary font-mono font-medium">{formatNumber(fleet.totalTokPerSec)}</span>
        <span className="text-text-muted">tok/s</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Power */}
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-warning" />
        <span className="text-warning font-mono">{formatPower(fleet.totalPowerW)}</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* VRAM */}
      <div className="flex items-center gap-2">
        <span className="text-text-muted">VRAM</span>
        <div className="w-16 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${vramPct >= 90 ? 'bg-danger' : vramPct >= 75 ? 'bg-warning' : 'bg-accent'}`}
            style={{ width: `${vramPct}%` }}
          />
        </div>
        <span className="text-accent font-mono text-xs">{vramPct}%</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Temp */}
      <div className="flex items-center gap-2">
        <Thermometer size={14} className={fleet.avgTempC >= 80 ? 'text-danger' : fleet.avgTempC >= 65 ? 'text-warning' : 'text-accent-3'} />
        <span className="font-mono text-xs">{fleet.avgTempC}°C</span>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        <Badge variant={fleet.healthGrade === 'A' ? 'success' : fleet.healthGrade === 'B' ? 'success' : 'warning'}>
          Fleet {fleet.healthGrade}
        </Badge>
        <span className="text-xs text-text-muted">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
