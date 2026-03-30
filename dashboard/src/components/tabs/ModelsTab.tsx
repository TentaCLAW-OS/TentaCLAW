import { useEffect, useMemo, useState } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useDragStore } from '@/hooks/useDragDrop';
import { api } from '@/lib/api';
import type { ModelDistribution } from '@/lib/types';
import { CLAWtopusTips } from '@/components/ui/CLAWtopusTips';
import { emptyStateTips } from '@/lib/personality';

/* ---------------------------------------------------------------------------
 * VRAM estimation heuristic
 * Derives approximate VRAM from model name (e.g. "70b" at Q4 ~ 40 GB).
 * Falls back to "?" when the name contains no recognizable parameter count.
 * -------------------------------------------------------------------------*/
function estimateVram(modelName: string): string {
  const match = modelName.match(/(\d+(?:\.\d+)?)[bB]/);
  if (!match) return '?';
  const billions = parseFloat(match[1]);
  // Q4 quantisation: ~0.57 GB per billion parameters (rough rule of thumb)
  const gb = billions * 0.57;
  if (gb >= 1) return `~${Math.round(gb)} GB`;
  return `~${(gb * 1024).toFixed(0)} MB`;
}

/* ---------------------------------------------------------------------------
 * Aggregate model info from node stats + distribution API
 * -------------------------------------------------------------------------*/
interface AggregatedModel {
  name: string;
  nodeCount: number;
  status: 'loaded' | 'loading' | 'error';
  vramEstimate: string;
  locations: Array<{ node_id: string; hostname: string }>;
}

function useAggregatedModels(distribution: ModelDistribution[]) {
  const nodes = useClusterStore((s) => s.nodes);

  return useMemo(() => {
    // Collect models from node stats
    const statsMap = new Map<string, Set<string>>();
    for (const node of nodes) {
      const loaded = node.latest_stats?.inference?.loaded_models;
      if (loaded) {
        for (const m of loaded) {
          if (!statsMap.has(m)) statsMap.set(m, new Set());
          statsMap.get(m)!.add(node.id);
        }
      }
    }

    // Merge with distribution API data
    const distMap = new Map<string, ModelDistribution>();
    for (const d of distribution) {
      distMap.set(d.model, d);
    }

    // Union all model names
    const allNames = new Set([...statsMap.keys(), ...distMap.keys()]);

    const models: AggregatedModel[] = [];
    for (const name of allNames) {
      const distEntry = distMap.get(name);
      const statsNodes = statsMap.get(name);
      const nodeCount = Math.max(distEntry?.nodes ?? 0, statsNodes?.size ?? 0);

      models.push({
        name,
        nodeCount,
        status: nodeCount > 0 ? 'loaded' : 'loading',
        vramEstimate: estimateVram(name),
        locations: distEntry?.locations ?? [],
      });
    }

    models.sort((a, b) => b.nodeCount - a.nodeCount || a.name.localeCompare(b.name));
    return models;
  }, [nodes, distribution]);
}

/* ---------------------------------------------------------------------------
 * Sub-components
 * -------------------------------------------------------------------------*/
function StatusBadge({ status }: { status: AggregatedModel['status'] }) {
  const config: Record<string, { bg: string; border: string; color: string; label: string }> = {
    loaded: {
      bg: 'rgba(0,255,136,0.08)',
      border: 'rgba(0,255,136,0.25)',
      color: 'var(--green)',
      label: 'loaded',
    },
    loading: {
      bg: 'rgba(0,255,255,0.08)',
      border: 'rgba(0,255,255,0.25)',
      color: 'var(--cyan)',
      label: 'loading',
    },
    error: {
      bg: 'rgba(255,60,60,0.08)',
      border: 'rgba(255,60,60,0.25)',
      color: 'var(--red)',
      label: 'error',
    },
  };
  const c = config[status] ?? config.loading;

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.color,
        animation: status === 'loading' ? 'pulse 2s ease-in-out infinite' : undefined,
      }}
    >
      {c.label}
    </span>
  );
}

function ModelCard({ model }: { model: AggregatedModel }) {
  const { dragging, dragData, startDrag, endDrag } = useDragStore();
  const isDraggingThis = dragging && dragData?.model === model.name;

  return (
    <div
      className="relative overflow-hidden rounded-[10px] px-4 py-3 flex flex-col gap-1.5 shrink-0"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', model.name);
        startDrag(model.name);
      }}
      onDragEnd={() => endDrag()}
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        minWidth: 180,
        maxWidth: 240,
        cursor: 'grab',
        opacity: isDraggingThis ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 1,
          background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
          opacity: 0.5,
        }}
      />

      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={model.name}
      >
        {model.name}
      </span>

      <span
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Running on {model.nodeCount} node{model.nodeCount !== 1 ? 's' : ''}
      </span>

      <StatusBadge status={model.status} />
    </div>
  );
}

function DraggableModelRow({ model }: { model: AggregatedModel }) {
  const { dragging, dragData, startDrag, endDrag } = useDragStore();
  const isDraggingThis = dragging && dragData?.model === model.name;

  return (
    <tr
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', model.name);
        startDrag(model.name);
      }}
      onDragEnd={() => endDrag()}
      className="hover:bg-[rgba(0,255,255,0.02)] transition-colors"
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        cursor: 'grab',
        opacity: isDraggingThis ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <td
        style={{
          padding: '10px 14px',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-primary)',
          maxWidth: 260,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={model.name}
      >
        {model.name}
      </td>
      <td
        style={{
          padding: '10px 14px',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-secondary)',
        }}
      >
        {model.nodeCount}
      </td>
      <td
        style={{
          padding: '10px 14px',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-secondary)',
        }}
      >
        {model.vramEstimate}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <StatusBadge status={model.status} />
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <span className="text-2xl opacity-20">🧠</span>
      <CLAWtopusTips tip={emptyStateTips.models} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Main component
 * -------------------------------------------------------------------------*/
export function ModelsTab() {
  const [distribution, setDistribution] = useState<ModelDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getModelDistribution()
      .then((data) => {
        if (!cancelled) setDistribution(data);
      })
      .catch(() => {
        // Silently handle — we still have node stats as fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useAggregatedModels(distribution);

  const handleDeploy = () => {
    // No-op: deploy modal will be implemented
  };

  const handleSmartDeploy = () => {
    // No-op: smart deploy flow will be implemented
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading models...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'slideUp 0.4s ease-out both' }}>
      {/* Pulse animation for loading badge */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Header with actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Model Catalog
        </h3>

        <div className="flex gap-2">
          <button
            onClick={handleDeploy}
            style={{
              background: 'transparent',
              border: '1px solid var(--cyan)',
              borderRadius: 6,
              color: 'var(--cyan)',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            Deploy Model
          </button>
          <button
            onClick={handleSmartDeploy}
            style={{
              background: 'transparent',
              border: '1px solid var(--teal)',
              borderRadius: 6,
              color: 'var(--teal)',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(0,140,140,0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            Smart Deploy
          </button>
        </div>
      </div>

      {models.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Model summary cards — horizontal scroll */}
          <div
            className="flex gap-3 pb-2"
            style={{
              overflowX: 'auto',
              scrollbarWidth: 'thin',
            }}
          >
            {models.map((m) => (
              <ModelCard key={m.name} model={m} />
            ))}
          </div>

          {/* Model distribution table */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
              Distribution
            </h3>

            <div
              className="rounded-[10px] overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--border)',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {['Model', 'Nodes', 'VRAM Est.', 'Status'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '10px 14px',
                          fontSize: 9,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <DraggableModelRow key={m.name} model={m} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
