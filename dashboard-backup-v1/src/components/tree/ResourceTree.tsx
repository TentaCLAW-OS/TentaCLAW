import { useState, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import { useDragStore } from '@/hooks/useDragDrop';
import { api } from '@/lib/api';
import { StatusDot } from '@/components/ui/StatusDot';

export function ResourceTree() {
  const nodes = useClusterStore((s) => s.nodes);
  const health = useClusterStore((s) => s.health);
  const selectedResource = useUIStore((s) => s.selectedResource);
  const selectResource = useUIStore((s) => s.selectResource);

  const { dragging, dragData, dropTarget, setDropTarget, endDrag } = useDragStore();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deploySuccess, setDeploySuccess] = useState<string | null>(null);

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

  const handleDrop = async (nodeId: string) => {
    if (!dragData) return;
    endDrag();
    try {
      await api.sendCommand(nodeId, 'install_model', { model: dragData.model });
      setDeploySuccess(nodeId);
      setTimeout(() => setDeploySuccess(null), 1200);
    } catch {
      // Deploy failed — the API layer already handles errors
    }
  };

  return (
    <div className="flex flex-col text-[11px] select-none">
      {/* Drag hint */}
      {dragging && (
        <div
          style={{
            padding: '4px 12px',
            fontSize: 9,
            color: 'var(--cyan)',
            background: 'rgba(0,255,255,0.04)',
            borderBottom: '1px solid rgba(0,255,255,0.1)',
            textAlign: 'center',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Drop on a node to deploy
        </div>
      )}

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
            className="text-[7px] font-mono font-bold px-1 py-px rounded-full"
            style={{
              color: gradeColor[health.grade] ?? 'var(--text-muted)',
              border: `1px solid ${gradeColor[health.grade] ?? 'var(--border)'}`,
              opacity: 0.7,
              lineHeight: '1.4',
              fontFeatureSettings: "'tnum'",
            }}
          >
            {health.grade}
          </span>
        )}
      </div>

      {/* Nodes */}
      {nodes.map((node) => {
        const isOnline = node.status === 'online';
        const isNodeExpanded = expanded[node.id] ?? false;
        const hasStats = !!node.latest_stats;
        const gpus = node.latest_stats?.gpus ?? [];
        const models = node.latest_stats?.inference?.loaded_models ?? [];

        const isDropTarget = dragging && dropTarget === node.id && isOnline;
        const isValidTarget = dragging && isOnline;
        const isSuccessFlash = deploySuccess === node.id;

        return (
          <div key={node.id}>
            {/* Node row — drop target */}
            <div
              className="flex items-center gap-2 py-1.5 cursor-pointer transition-all group"
              style={{
                paddingLeft: 32,
                borderLeft: isSuccessFlash
                  ? '2px solid var(--green)'
                  : isDropTarget
                    ? '2px solid var(--cyan)'
                    : isActive('node', node.id)
                      ? '2px solid var(--cyan)'
                      : '2px solid transparent',
                color: isActive('node', node.id) ? 'var(--cyan)' : isOnline ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isSuccessFlash
                  ? 'rgba(0,255,136,0.08)'
                  : isDropTarget
                    ? 'rgba(0,255,255,0.04)'
                    : isActive('node', node.id)
                      ? 'rgba(0,255,255,0.05)'
                      : 'transparent',
                textDecoration: !isOnline ? 'line-through' : 'none',
                boxShadow: isSuccessFlash
                  ? '0 0 12px rgba(0,255,136,0.15)'
                  : isDropTarget
                    ? '0 0 12px rgba(0,255,255,0.1)'
                    : 'none',
                border: isSuccessFlash
                  ? undefined
                  : isDropTarget
                    ? '1px solid var(--cyan)'
                    : undefined,
                borderRadius: isDropTarget ? 4 : 0,
                transition: 'all 0.15s ease-out',
              }}
              onClick={() => selectResource({ type: 'node', id: node.id })}
              onDragOver={(e) => {
                if (!dragging || !isOnline) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropTarget(node.id);
              }}
              onDragEnter={(e) => {
                if (!dragging || !isOnline) return;
                e.preventDefault();
                setDropTarget(node.id);
              }}
              onDragLeave={(e) => {
                // Only clear if we're leaving the node row entirely
                const related = e.relatedTarget as HTMLElement | null;
                if (!e.currentTarget.contains(related)) {
                  if (dropTarget === node.id) setDropTarget(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (isOnline && dragData) {
                  handleDrop(node.id);
                }
              }}
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
                className="text-[7px] font-mono px-1 py-px rounded-full shrink-0"
                style={{
                  color: 'var(--cyan)',
                  border: '1px solid rgba(0,255,255,0.12)',
                  opacity: 0.6,
                  lineHeight: '1.4',
                  fontFeatureSettings: "'tnum'",
                }}
              >
                {node.gpu_count} GPU
              </span>
              {!isOnline && (
                <span
                  className="text-[7px] font-mono px-1 py-px rounded-full shrink-0"
                  style={{ color: 'var(--red)', border: '1px solid rgba(255,70,70,0.15)', opacity: 0.7, lineHeight: '1.4' }}
                >
                  off
                </span>
              )}
              {isValidTarget && !isDropTarget && (
                <span
                  className="text-[8px] font-mono shrink-0"
                  style={{
                    color: 'var(--cyan)',
                    opacity: 0.5,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                >
                  +
                </span>
              )}
              {isSuccessFlash && (
                <span
                  className="text-[8px] font-mono shrink-0"
                  style={{ color: 'var(--green)' }}
                >
                  deployed
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
                        paddingLeft: 52,
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
                        {gpu.name.replace(/Advanced Micro Devices, Inc\. \[AMD\/ATI\] /g, '').replace(/NVIDIA Corporation /g, '').replace(/ \[.*?\]/g, '').trim()} #{idx}
                      </span>
                      <span
                        className="text-[7px] font-mono px-1 py-px rounded-full shrink-0"
                        style={{ color: tempColor, border: `1px solid ${tempColor}22`, opacity: 0.75, lineHeight: '1.4', fontFeatureSettings: "'tnum'" }}
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
                        paddingLeft: 52,
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

      {/* Pulse animation for drop target hints */}
      {dragging && (
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
        `}</style>
      )}

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
