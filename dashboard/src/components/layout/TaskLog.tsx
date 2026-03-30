import { useState } from 'react';

type LogTab = 'tasks' | 'cluster-log' | 'alerts';

interface TaskRow {
  time: string;
  node: string;
  user: string;
  description: string;
  status: string;
  statusColor: string;
}

const mockTasks: TaskRow[] = [
  {
    time: '12:27:04',
    node: 'colo-beast',
    user: 'system',
    description: 'Deploying llama3.1:405b (tensor-parallel\u00D78)',
    status: '\u27F3 running',
    statusColor: 'var(--cyan)',
  },
  {
    time: '12:26:51',
    node: 'pve-gpu-02',
    user: 'watchdog',
    description: 'GPU #1 temperature alert \u2014 83\u00B0C exceeds threshold',
    status: '\u26A0 WARN',
    statusColor: 'var(--yellow)',
  },
  {
    time: '12:25:33',
    node: 'rack-node-04',
    user: 'admin',
    description: 'Benchmark completed \u2014 mixtral:8x7b \u2014 612 tok/s',
    status: '\u2713 OK',
    statusColor: 'var(--green)',
  },
  {
    time: '12:24:17',
    node: 'colo-beast',
    user: 'admin',
    description: 'Model pull started \u2014 deepseek-coder-v2:236b',
    status: '\u27F3 running',
    statusColor: 'var(--cyan)',
  },
  {
    time: '12:22:08',
    node: 'home-lab-01',
    user: 'system',
    description: 'Node heartbeat restored after 45s gap',
    status: '\u2713 OK',
    statusColor: 'var(--green)',
  },
  {
    time: '12:20:44',
    node: 'pve-gpu-02',
    user: 'cron',
    description: 'Scheduled VRAM defrag completed \u2014 freed 2.1 GB',
    status: '\u2713 OK',
    statusColor: 'var(--green)',
  },
];

const logTabs: { id: LogTab; label: string }[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'cluster-log', label: 'Cluster Log' },
  { id: 'alerts', label: 'Alerts' },
];

export function TaskLog() {
  const [activeLogTab, setActiveLogTab] = useState<LogTab>('tasks');

  return (
    <div
      className="h-[140px] shrink-0 flex flex-col"
      style={{
        background: 'rgba(8,10,16,0.8)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* Tab bar */}
      <div className="flex gap-0 px-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-1.5">
        {activeLogTab === 'tasks' ? (
          <div className="flex flex-col gap-px">
            {mockTasks.map((task, idx) => (
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
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] text-[var(--text-dim)]">
              {activeLogTab === 'cluster-log' ? 'Cluster log' : 'Alerts feed'} &mdash; coming soon
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
