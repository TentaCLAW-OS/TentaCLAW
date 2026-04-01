// dashboard/src/components/layout/StatusBar.tsx
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import { usePanelsStore } from '@/stores/panels';

export function StatusBar() {
  const nodes = useClusterStore((s) => s.nodes);
  const connected = useClusterStore((s) => s.connected);
  const activeTab = useUIStore((s) => s.activeTab);
  const alerts = useClusterStore((s) => s.alerts);
  const rightCollapsed = usePanelsStore((s) => s.rightSidebarCollapsed);

  const onlineNodes = nodes.filter((n) => n.status === 'online').length;
  const totalGpus = nodes.reduce((sum, n) => sum + n.gpu_count, 0);
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  // Aggregate tok/s across all online nodes
  const totalToksPerSec = nodes.reduce((sum, n) => {
    return sum + (n.latest_stats?.toks_per_sec ?? 0);
  }, 0);

  return (
    <footer
      className="flex items-center justify-between px-3 shrink-0 z-20"
      style={{
        height: 24,
        background: 'rgba(8,10,16,0.95)',
        borderTop: '1px solid var(--border)',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
      }}
    >
      {/* Left section: connection + cluster stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: connected ? 'var(--green)' : 'var(--red)',
              boxShadow: connected ? '0 0 4px rgba(0,255,136,0.4)' : '0 0 4px rgba(255,70,70,0.4)',
            }}
          />
          <span style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
            {connected ? 'connected' : 'disconnected'}
          </span>
        </div>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--cyan)' }}>{onlineNodes} nodes</span>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--text-muted)' }}>{totalGpus} GPUs</span>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--text-muted)' }}>{totalToksPerSec.toFixed(1)} tok/s</span>
        {activeAlerts > 0 && (
          <>
            <span style={{ color: 'var(--text-dim)' }}>│</span>
            <span style={{ color: 'var(--red)' }}>{activeAlerts} alert{activeAlerts !== 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Center: active tab */}
      <div style={{ color: 'var(--text-dim)' }}>
        {activeTab.replace(/-/g, ' ').toUpperCase()}
      </div>

      {/* Right: keybind hints */}
      <div className="flex items-center gap-3" style={{ color: 'var(--text-dim)' }}>
        <span>Ctrl+K search</span>
        <span>Ctrl+B sidebar</span>
        <span>Ctrl+J context</span>
        <span>? help</span>
      </div>
    </footer>
  );
}
