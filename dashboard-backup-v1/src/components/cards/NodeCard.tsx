import type { ClusterNode } from '@/lib/types';
import { StatusDot } from '@/components/ui/StatusDot';
import { Sparkline } from '@/components/ui/Sparkline';
import { GpuChip } from '@/components/cards/GpuChip';
import { useDragStore } from '@/hooks/useDragDrop';
import { formatToks, formatTimeAgo } from '@/lib/format';

interface NodeCardProps {
  node: ClusterNode;
  index?: number;
}

/** Generate a pseudo-random sparkline array seeded from a string */
function mockSparkline(seed: string, base: number, variance: number, len = 20): number[] {
  const out: number[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  let val = base;
  for (let i = 0; i < len; i++) {
    hash = (hash * 1103515245 + 12345) | 0;
    const delta = ((hash >>> 16) % (variance * 2 + 1)) - variance;
    val = Math.max(base - variance, Math.min(base + variance, val + delta));
    out.push(val);
  }
  return out;
}

function getNodeStatus(node: ClusterNode): 'online' | 'warning' | 'offline' {
  if (node.status === 'offline' || node.status === 'error') return 'offline';
  const gpus = node.latest_stats?.gpus ?? [];
  const hasHotGpu = gpus.some((g) => g.temperatureC > 75);
  if (hasHotGpu) return 'warning';
  return 'online';
}

function DraggableModelName({ model }: { model: string }) {
  const { dragging, dragData, startDrag, endDrag } = useDragStore();
  const isDraggingThis = dragging && dragData?.model === model;

  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', model);
        startDrag(model);
      }}
      onDragEnd={() => endDrag()}
      className="truncate"
      style={{
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--text-muted)',
        cursor: 'grab',
        opacity: isDraggingThis ? 0.5 : 1,
        padding: '1px 4px',
        borderRadius: 3,
        border: '1px solid transparent',
        transition: 'all 0.15s ease-out',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,255,0.2)';
        (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.04)';
        (e.currentTarget as HTMLElement).style.color = 'var(--cyan)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
      }}
      title={`Drag "${model}" to deploy on another node`}
    >
      {model}
    </span>
  );
}

export function NodeCard({ node, index = 0 }: NodeCardProps) {
  const displayStatus = getNodeStatus(node);
  const isOffline = displayStatus === 'offline';
  const isWarning = displayStatus === 'warning';
  const stats = node.latest_stats;
  const soul = stats?.soul;
  const toksPerSec = stats?.toks_per_sec ?? 0;
  const isIdle = !isOffline && toksPerSec === 0;
  const gpus = stats?.gpus ?? [];
  const useGrid = gpus.length >= 5;

  // Sparkline mock data
  const tempData = mockSparkline(`${node.id}-temp`, 55, 15);
  const vramData = mockSparkline(`${node.id}-vram`, 60, 20);
  const toksData = mockSparkline(`${node.id}-toks`, 40, 25);

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${isWarning ? 'rgba(255,220,0,0.25)' : 'var(--border)'}`,
        opacity: isOffline ? 0.5 : 1,
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: `fadeIn 0.4s ease-out both${isWarning ? ', yellowPulse 2s ease-in-out infinite' : ''}`,
        animationDelay: `${index * 0.06}s`,
        ...(isOffline ? {
          backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(255,255,255,0.02) 6px, rgba(255,255,255,0.02) 7px)',
        } : {}),
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = isWarning
          ? 'rgba(255,220,0,0.4)'
          : 'var(--border-hover)';
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = isWarning
          ? '0 4px 20px rgba(255,220,0,0.08)'
          : '0 4px 20px rgba(0,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = isWarning
          ? 'rgba(255,220,0,0.25)'
          : 'var(--border)';
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'none';
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 1,
          background: isWarning
            ? 'linear-gradient(90deg, var(--yellow), transparent)'
            : 'linear-gradient(90deg, var(--cyan), var(--purple))',
          opacity: 0.4,
        }}
      />

      <div className="p-3 flex flex-col gap-2.5">
        {/* Header: StatusDot + hostname + tok/s */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={isWarning ? 'warning' : node.status === 'error' ? 'error' : node.status} />
            <div className="flex flex-col min-w-0">
              <span
                className="text-xs font-medium truncate"
                style={{
                  color: 'var(--text-primary)',
                  textDecoration: isOffline ? 'line-through' : 'none',
                }}
              >
                {soul?.name ?? node.hostname}
              </span>
              {soul && soul.name !== node.hostname && (
                <span
                  className="truncate"
                  style={{ fontSize: 9, color: 'var(--text-dim)', fontStyle: 'italic' }}
                  title={soul.personality}
                >
                  {node.hostname}
                </span>
              )}
            </div>
          </div>
          {!isOffline && (
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: isIdle ? 'var(--text-dim)' : 'var(--cyan)',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {formatToks(toksPerSec)}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  marginLeft: 3,
                }}
              >
                tok/s
              </span>
            </span>
          )}
        </div>

        {/* Offline state: last seen */}
        {isOffline && node.last_seen_at && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}
          >
            Last seen {formatTimeAgo(node.last_seen_at)}
          </span>
        )}

        {/* GPU chip row */}
        {!isOffline && gpus.length > 0 && (
          <div
            className={useGrid ? 'grid grid-cols-4 gap-1.5' : 'flex flex-wrap gap-1.5'}
          >
            {gpus.map((gpu) => (
              <GpuChip key={gpu.busId} gpu={gpu} />
            ))}
          </div>
        )}

        {/* Sparkline row */}
        {!isOffline && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span style={{ fontSize: 7, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Temp
              </span>
              <Sparkline data={tempData} color="var(--yellow)" fillOpacity={0.1} />
            </div>
            <div>
              <span style={{ fontSize: 7, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                VRAM
              </span>
              <Sparkline data={vramData} color="var(--purple)" fillOpacity={0.1} />
            </div>
            <div>
              <span style={{ fontSize: 7, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Tok/s
              </span>
              <Sparkline data={toksData} color="var(--cyan)" fillOpacity={0.1} />
            </div>
          </div>
        )}

        {/* Footer: backend type + loaded models */}
        {!isOffline && stats && (
          <div className="flex items-center gap-2 flex-wrap">
            {stats.backend && (
              <span
                className="rounded px-1.5 py-0.5"
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: 'rgba(0,255,255,0.08)',
                  color: 'var(--cyan)',
                  border: '1px solid rgba(0,255,255,0.12)',
                }}
              >
                {stats.backend.type}
              </span>
            )}
            {stats.inference.loaded_models.length > 0 &&
              stats.inference.loaded_models.map((modelName) => (
                <DraggableModelName key={modelName} model={modelName} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
