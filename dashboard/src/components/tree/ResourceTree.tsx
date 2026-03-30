import { useState, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import { StatusDot } from '@/components/ui/StatusDot';

export function ResourceTree() {
  const nodes = useClusterStore((s) => s.nodes);
  const health = useClusterStore((s) => s.health);
  const selectedResource = useUIStore((s) => s.selectedResource);
  const selectResource = useUIStore((s) => s.selectResource);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const isActive = (type: string, id: string) =>
    selectedResource.type === type && selectedResource.id === id;

  const gradeColor: Record<string, string> = {
    A: 'var(--green)',
    B: '#66ff88',
    C: 'var(--yellow)',
    D: '#ff9944',
    F: 'var(--red)',
  };

  return (
    <div className="flex flex-col text-[11px] select-none">
      {/* Cluster root */}
      <div
        className="flex items-center gap-2 py-1.5 cursor-pointer transition-colors"
        style={{
          paddingLeft: 12,
          borderLeft: isActive('cluster', 'root') ? '2px solid var(--cyan)' : '2px solid transparent',
          color: isActive('cluster', 'root') ? 'var(--cyan)' : 'var(--text-primary)',
          background: isActive('cluster', 'root') ? 'rgba(0,255,255,0.05)' : 'transparent',
        }}
        onClick={() => selectResource({ type: 'cluster', id: 'root' })}
      >
        <span className="text-[13px]">&#x1F310;</span>
        <span className="font-semibold">TentaCLAW Cluster</span>
        {health && (
          <span
            className="text-[8px] font-mono font-bold px-1 py-0.5 rounded"
            style={{
              color: gradeColor[health.grade] ?? 'var(--text-muted)',
              border: `1px solid ${gradeColor[health.grade] ?? 'var(--border)'}`,
              opacity: 0.8,
            }}
          >
            {health.grade}
          </span>
        )}
      </div>

      {/* Nodes */}
      {nodes.map((node) => {
        const isOnline = node.status === 'online';
        const isNodeExpanded = expanded[node.id] ?? isOnline;
        const hasStats = !!node.latest_stats;
        const gpus = node.latest_stats?.gpus ?? [];
        const models = node.latest_stats?.inference?.loaded_models ?? [];

        return (
          <div key={node.id}>
            {/* Node row */}
            <div
              className="flex items-center gap-2 py-1.5 cursor-pointer transition-colors group"
              style={{
                paddingLeft: 28,
                borderLeft: isActive('node', node.id) ? '2px solid var(--cyan)' : '2px solid transparent',
                color: isActive('node', node.id) ? 'var(--cyan)' : isOnline ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isActive('node', node.id) ? 'rgba(0,255,255,0.05)' : 'transparent',
                textDecoration: !isOnline ? 'line-through' : 'none',
              }}
              onClick={() => selectResource({ type: 'node', id: node.id })}
            >
              {/* Expand chevron */}
              {hasStats ? (
                <span
                  className="text-[9px] text-[var(--text-muted)] cursor-pointer w-3 text-center shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(node.id);
                  }}
                >
                  {isNodeExpanded ? '\u25BE' : '\u25B8'}
                </span>
              ) : (
                <span className="w-3 shrink-0" />
              )}

              <StatusDot status={node.status} size={6} />
              <span className="font-semibold truncate">{node.hostname}</span>
              <span
                className="text-[8px] font-mono px-1 py-0.5 rounded shrink-0"
                style={{
                  color: 'var(--cyan)',
                  border: '1px solid rgba(0,255,255,0.15)',
                  opacity: 0.7,
                }}
              >
                {node.gpu_count} GPU
              </span>
              {!isOnline && (
                <span
                  className="text-[8px] font-mono px-1 py-0.5 rounded shrink-0"
                  style={{ color: 'var(--red)', border: '1px solid rgba(255,70,70,0.2)' }}
                >
                  off
                </span>
              )}
            </div>

            {/* Children: GPUs + Models */}
            {hasStats && isNodeExpanded && (
              <div>
                {gpus.map((gpu, idx) => {
                  const gpuId = `${node.id}:gpu:${idx}`;
                  const tempColor =
                    gpu.temperatureC >= 80 ? 'var(--red)' :
                    gpu.temperatureC >= 60 ? 'var(--yellow)' :
                    'var(--green)';

                  return (
                    <div
                      key={gpuId}
                      className="flex items-center gap-2 py-1 cursor-pointer transition-colors"
                      style={{
                        paddingLeft: 44,
                        borderLeft: isActive('gpu', gpuId) ? '2px solid var(--cyan)' : '2px solid transparent',
                        color: isActive('gpu', gpuId) ? 'var(--cyan)' : 'var(--text-secondary)',
                        background: isActive('gpu', gpuId) ? 'rgba(0,255,255,0.05)' : 'transparent',
                      }}
                      onClick={() => selectResource({ type: 'gpu', id: gpuId })}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ background: 'linear-gradient(135deg, #4488ff, #00ccff)' }}
                      />
                      <span className="truncate text-[10px]">
                        {gpu.name} #{idx}
                      </span>
                      <span
                        className="text-[8px] font-mono px-1 rounded shrink-0"
                        style={{ color: tempColor, border: `1px solid ${tempColor}33` }}
                      >
                        {gpu.temperatureC}&deg;C
                      </span>
                    </div>
                  );
                })}

                {models.map((model, idx) => {
                  const modelId = `${node.id}:model:${model}`;
                  return (
                    <div
                      key={`${modelId}-${idx}`}
                      className="flex items-center gap-2 py-1 cursor-pointer transition-colors"
                      style={{
                        paddingLeft: 44,
                        borderLeft: isActive('model', modelId) ? '2px solid var(--cyan)' : '2px solid transparent',
                        color: isActive('model', modelId) ? 'var(--cyan)' : 'var(--text-secondary)',
                        background: isActive('model', modelId) ? 'rgba(0,255,255,0.05)' : 'transparent',
                      }}
                      onClick={() => selectResource({ type: 'model', id: modelId })}
                    >
                      <span className="text-[10px] text-[var(--green)] shrink-0">&#x25B6;</span>
                      <span className="truncate text-[10px]">{model}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="px-4 py-6 text-[10px] text-[var(--text-dim)] text-center">
          No nodes registered yet.
          <br />
          <span className="text-[var(--text-muted)]">Connect an agent to get started.</span>
        </div>
      )}
    </div>
  );
}
