import { useState, useEffect, useRef } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { usePanelsStore } from '@/stores/panels';
import { useResizable } from '@/hooks/useResizable';
import { ResizeHandle } from '@/components/layout/ResizeHandle';

type LogTab = 'tasks' | 'cluster-log' | 'alerts';

interface TaskRow {
  time: string;
  node: string;
  user: string;
  description: string;
  status: string;
  statusColor: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sseEventToRow(type: string, data: Record<string, unknown>): TaskRow | null {
  const now = formatTime(new Date());
  const nodeId = (data.node_id ?? data.nodeId ?? '') as string;
  const hostname = nodeId.split('-').slice(-1)[0] || nodeId;

  switch (type) {
    case 'stats_update':
      return null; // Too noisy
    case 'node_online':
      return { time: now, node: hostname, user: 'system', description: 'Node came online', status: '\u2713 OK', statusColor: 'var(--green)' };
    case 'node_offline':
      return { time: now, node: hostname, user: 'system', description: 'Node went offline', status: '\u2717 ERR', statusColor: 'var(--red)' };
    case 'alert':
      return { time: now, node: hostname, user: 'watchdog', description: (data.alert as Record<string, string>)?.message ?? 'Alert triggered', status: '\u26A0 WARN', statusColor: 'var(--yellow)' };
    case 'command_sent':
      return { time: now, node: hostname, user: 'admin', description: `Command: ${(data.command as Record<string, string>)?.action ?? 'unknown'}`, status: '\u27F3 sent', statusColor: 'var(--cyan)' };
    case 'command_completed':
      return { time: now, node: '', user: 'system', description: `Command ${data.command_id} completed`, status: '\u2713 OK', statusColor: 'var(--green)' };
    case 'watchdog_event':
      return { time: now, node: hostname, user: 'watchdog', description: `Level ${data.level} watchdog: ${data.action}`, status: '\u26A0 WARN', statusColor: 'var(--yellow)' };
    case 'benchmark_complete':
      return { time: now, node: hostname, user: 'system', description: 'Benchmark completed', status: '\u2713 OK', statusColor: 'var(--green)' };
    case 'model_pull_started':
      return { time: now, node: hostname, user: 'system', description: `Model pull started: ${data.model ?? ''}`, status: '\u27F3 running', statusColor: 'var(--cyan)' };
    default:
      return { time: now, node: hostname || 'cluster', user: 'system', description: type.replace(/_/g, ' '), status: '\u2022 info', statusColor: 'var(--text-muted)' };
  }
}

// Seed with some initial rows so the log isn't empty
const seedTasks: TaskRow[] = [
  { time: formatTime(new Date()), node: 'cluster', user: 'system', description: 'Dashboard connected to gateway', status: '\u2713 OK', statusColor: 'var(--green)' },
];

const logTabs: { id: LogTab; label: string }[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'cluster-log', label: 'Cluster Log' },
  { id: 'alerts', label: 'Alerts' },
];

export function TaskLog() {
  const [activeLogTab, setActiveLogTab] = useState<LogTab>('tasks');
  const [tasks, setTasks] = useState<TaskRow[]>(seedTasks);
  const lastEvent = useClusterStore((s) => s.lastEvent);
  const alerts = useClusterStore((s) => s.alerts);
  const scrollRef = useRef<HTMLDivElement>(null);

  const bottomHeight = usePanelsStore((s) => s.bottomPanelHeight);
  const collapsed = usePanelsStore((s) => s.bottomPanelCollapsed);
  const toggleBottom = usePanelsStore((s) => s.toggleBottomPanel);
  const setHeight = usePanelsStore((s) => s.setBottomPanelHeight);

  // invert: true so dragging UP increases height (bottom panel grows upward)
  const { size, isResizing, handleMouseDown: handleResizeMouseDown } = useResizable({
    direction: 'vertical',
    initialSize: bottomHeight,
    minSize: 80,
    maxSize: 400,
    onResize: setHeight,
    invert: true,
  });

  // Derive task rows from the shared SSE event in the cluster store
  useEffect(() => {
    if (!lastEvent) return;
    try {
      const data = typeof (lastEvent as { data?: unknown }).data === 'string'
        ? JSON.parse((lastEvent as { data: string }).data)
        : lastEvent;
      if ((data as { type?: string }).type === 'connected') return;
      const row = sseEventToRow((data as { type: string }).type, data as Record<string, unknown>);
      if (row) {
        setTasks((prev) => [row, ...prev].slice(0, 50));
      }
    } catch { /* ignore */ }
  }, [lastEvent]);

  if (collapsed) {
    return (
      <div
        className="flex items-center px-3 shrink-0 cursor-pointer"
        style={{
          height: 28,
          background: 'rgba(8,10,16,0.8)',
          borderTop: '1px solid var(--border)',
        }}
        onClick={toggleBottom}
      >
        <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>&#9650; Tasks / Cluster Log / Alerts</span>
      </div>
    );
  }

  return (
    <>
      <ResizeHandle direction="vertical" onMouseDown={handleResizeMouseDown} isResizing={isResizing} />
      <div
        className="shrink-0 flex flex-col"
        style={{
          height: size,
          background: 'rgba(8,10,16,0.8)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Tab bar */}
        <div className="flex gap-0 px-3 shrink-0 items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          {logTabs.map((tab) => {
            const active = activeLogTab === tab.id;
            return (
              <div
                key={tab.id}
                className="px-3.5 py-1.5 text-[10px] cursor-pointer border-b-2 transition-colors"
                style={{
                  borderBottomColor: active ? 'var(--cyan)' : 'transparent',
                  color: active ? 'rgba(0,255,255,0.7)' : 'var(--text-muted)',
                }}
                onClick={() => setActiveLogTab(tab.id)}
              >
                {tab.label}
              </div>
            );
          })}
          <button
            onClick={toggleBottom}
            className="ml-auto text-[9px] cursor-pointer px-1.5"
            style={{ color: 'var(--text-dim)' }}
            title="Collapse panel (Ctrl+`)"
          >
            &#9660;
          </button>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1.5">
          {activeLogTab === 'tasks' ? (
            <div className="flex flex-col gap-px">
              {tasks.map((task, idx) => (
                <div
                  key={idx}
                  className="grid items-center gap-2 py-0.5"
                  style={{ gridTemplateColumns: '90px 100px 80px 1fr 70px' }}
                >
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {task.time}
                  </span>
                  <span className="text-[10px] font-mono truncate" style={{ color: 'var(--cyan)' }}>
                    {task.node}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {task.user}
                  </span>
                  <span className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                    {task.description}
                  </span>
                  <span
                    className="text-[10px] font-mono text-right"
                    style={{ color: task.statusColor }}
                  >
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-px">
              {activeLogTab === 'alerts' && alerts.length > 0 ? (
                alerts.slice(0, 20).map((alert, idx) => (
                  <div
                    key={alert.id ?? idx}
                    className="grid items-center gap-2 py-0.5"
                    style={{ gridTemplateColumns: '90px 100px 1fr 70px' }}
                  >
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {new Date(alert.created_at).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <span className="text-[10px] font-mono truncate" style={{ color: alert.severity === 'critical' ? 'var(--red)' : 'var(--yellow)' }}>
                      {alert.node_id?.split('-').slice(-1)[0] || alert.node_id}
                    </span>
                    <span className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {alert.message}
                    </span>
                    <span className="text-[10px] font-mono text-right" style={{ color: alert.severity === 'critical' ? 'var(--red)' : 'var(--yellow)' }}>
                      {alert.severity === 'critical' ? '\u2717 CRIT' : '\u26A0 WARN'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    {activeLogTab === 'cluster-log' ? 'Cluster log events will appear here' : 'No active alerts \u2014 cluster is healthy'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
