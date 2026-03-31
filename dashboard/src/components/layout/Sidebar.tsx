import { useUIStore } from '@/stores/ui';
import { ResourceTree } from '@/components/tree/ResourceTree';

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden transition-all duration-300"
      style={{
        width: collapsed ? 0 : 240,
        background: 'var(--bg-sidebar)',
        backdropFilter: 'blur(12px)',
        borderRight: collapsed ? 'none' : '1px solid var(--border)',
      }}
    >
      {/* Sidebar header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[9px] uppercase tracking-[2px] text-[var(--text-muted)] font-medium">
          Resource Tree
        </span>
        <button
          className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer px-1.5 py-0.5 rounded"
          style={{ border: '1px solid var(--border)' }}
        >
          Server View &#x25BE;
        </button>
      </div>

      {/* Subtle separator glow */}
      <div
        style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.06), transparent)',
        }}
      />

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <ResourceTree />
      </div>
    </aside>
  );
}
