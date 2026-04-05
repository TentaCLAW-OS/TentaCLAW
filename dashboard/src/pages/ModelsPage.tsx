// ─── TentaCLAW Dashboard — Models Page ──────────────────────────────────────

import React, { useState } from 'react';
import { useStore } from '../store';
import {
  StatCard, ProgressBar, Badge, StatusDot, SectionHeader,
  formatBytes,
} from '../components/ui';
import {
  Cpu, Download, Play, Square, Trash2, Search, Filter,
  ChevronDown, HardDrive, Layers,
} from 'lucide-react';
import type { ModelInfo } from '../types';

export function ModelsPage() {
  const { models, nodes } = useStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'loaded' | 'available'>('all');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);

  const loaded = models.filter(m => m.status === 'loaded');
  const available = models.filter(m => m.status === 'available');

  const filtered = models.filter(m => {
    if (filter === 'loaded' && m.status !== 'loaded') return false;
    if (filter === 'available' && m.status !== 'available') return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.family.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalVramUsed = nodes.flatMap(n => n.gpus).reduce((s, g) => s + g.vramUsedMb, 0);
  const totalVram = nodes.flatMap(n => n.gpus).reduce((s, g) => s + g.vramTotalMb, 0);
  const idleGpus = nodes.flatMap(n => n.gpus).filter(g => g.status === 'idle');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Loaded Models" value={loaded.length} sub={`${available.length} available`} icon={<Layers size={16} />} color="text-accent" />
        <StatCard label="Total Models" value={models.length} sub="in registry" icon={<Cpu size={16} />} color="text-accent-3" />
        <StatCard label="VRAM Used" value={formatBytes(totalVramUsed)} sub={`of ${formatBytes(totalVram)}`} icon={<HardDrive size={16} />} color="text-warning" />
        <StatCard label="Idle GPUs" value={idleGpus.length} sub="ready to deploy" color="text-success" />
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-bg-card border border-border rounded-lg p-0.5">
          {(['all', 'loaded', 'available'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Model Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(model => (
          <div
            key={model.id}
            onClick={() => setSelectedModel(selectedModel?.id === model.id ? null : model)}
            className={`bg-bg-card border rounded-xl overflow-hidden cursor-pointer card-hover ${selectedModel?.id === model.id ? 'border-accent/40 ring-1 ring-accent/20' : 'border-border'}`}
          >
            {/* Card Header */}
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={model.status} />
                <span className="font-semibold text-sm">{model.name}</span>
              </div>
              <Badge variant={model.status === 'loaded' ? 'success' : model.status === 'downloading' ? 'info' : 'default'}>
                {model.status}
              </Badge>
            </div>

            {/* Card Body */}
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{model.description}</p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Family</span>
                  <span className="text-text-primary">{model.family}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Params</span>
                  <span className="text-accent font-medium">{model.parameters}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Quant</span>
                  <span className="text-text-primary font-mono">{model.quantization}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Size</span>
                  <span className="text-text-primary">{formatBytes(model.sizeMb)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">VRAM Req</span>
                  <span className="text-warning">{formatBytes(model.vramRequiredMb)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Context</span>
                  <span className="text-text-primary">{(model.maxContext / 1024).toFixed(0)}k</span>
                </div>
              </div>

              {model.status === 'loaded' && (
                <div className="pt-2 border-t border-border/30 flex items-center justify-between">
                  <span className="text-xs text-text-muted">
                    {model.loadedOn.length} GPU{model.loadedOn.length !== 1 ? 's' : ''}
                  </span>
                  {model.tokPerSec && (
                    <span className="text-xs text-success font-mono font-bold">{model.tokPerSec} tok/s</span>
                  )}
                </div>
              )}

              {model.status === 'downloading' && model.downloadPct !== undefined && (
                <ProgressBar value={model.downloadPct} label="Downloading" size="sm" color="bg-accent-3" />
              )}
            </div>

            {/* Card Actions */}
            <div className="px-4 py-2 border-t border-border/50 flex items-center gap-2">
              {model.status === 'available' && (
                <>
                  <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors">
                    <Play size={12} /> Deploy
                  </button>
                  <button className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-bg-secondary text-text-muted text-xs hover:text-text-primary transition-colors">
                    <Download size={12} /> Pull
                  </button>
                </>
              )}
              {model.status === 'loaded' && (
                <>
                  <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-danger/10 text-danger text-xs font-medium hover:bg-danger/20 transition-colors">
                    <Square size={12} /> Unload
                  </button>
                  <button className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-bg-secondary text-text-muted text-xs hover:text-text-primary transition-colors">
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
