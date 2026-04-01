import { useState } from 'react';
import { usePanelsStore } from '@/stores/panels';
import { useClusterStore } from '@/stores/cluster';
import { TodoTracker } from '@/components/ui/TodoTracker';

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] uppercase tracking-[2px] cursor-pointer"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>{title}</span>
        <span
          className="text-[8px] transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          ▾
        </span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

function HealthSnapshot() {
  const nodes = useClusterStore((s) => s.nodes);
  const alerts = useClusterStore((s) => s.alerts);
  const online = nodes.filter((n) => n.status === 'online').length;
  const totalGpus = nodes.reduce((sum, n) => sum + n.gpu_count, 0);
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  const stats = [
    { label: 'Nodes', value: `${online}/${nodes.length}`, color: online === nodes.length ? 'var(--green)' : 'var(--yellow)' },
    { label: 'GPUs', value: String(totalGpus), color: 'var(--cyan)' },
    { label: 'Alerts', value: String(activeAlerts), color: activeAlerts > 0 ? 'var(--red)' : 'var(--green)' },
  ];

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-center py-1.5 rounded"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <span className="text-[11px] font-mono font-bold" style={{ color: s.color }}>
            {s.value}
          </span>
          <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActiveModels() {
  const nodes = useClusterStore((s) => s.nodes);
  const models = new Set<string>();
  for (const node of nodes) {
    if (node.latest_stats?.inference.loaded_models) {
      for (const m of node.latest_stats.inference.loaded_models) {
        models.add(m);
      }
    }
  }
  const modelList = [...models].slice(0, 8);

  if (modelList.length === 0) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
        No models loaded
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {modelList.map((m) => (
        <div
          key={m}
          className="flex items-center gap-1.5 py-0.5"
        >
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--green)', boxShadow: '0 0 4px rgba(0,255,136,0.4)' }}
          />
          <span
            className="text-[10px] font-mono truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            {m}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RightSidebar() {
  const collapsed = usePanelsStore((s) => s.rightSidebarCollapsed);
  const width = usePanelsStore((s) => s.rightSidebarWidth);

  if (collapsed) return null;

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width,
        background: 'var(--bg-sidebar)',
        backdropFilter: 'blur(12px)',
        borderLeft: '1px solid var(--border)',
      }}
    >
      {/* Sidebar title */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[9px] uppercase tracking-[2px] text-[var(--text-muted)] font-medium">
          Context
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Health Snapshot */}
        <CollapsibleSection title="Cluster Health">
          <HealthSnapshot />
        </CollapsibleSection>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.06), transparent)' }} />

        {/* TODO Tracker */}
        <CollapsibleSection title="Operations TODO">
          <TodoTracker />
        </CollapsibleSection>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.06), transparent)' }} />

        {/* Active Models */}
        <CollapsibleSection title="Loaded Models" defaultOpen={false}>
          <ActiveModels />
        </CollapsibleSection>
      </div>
    </aside>
  );
}
