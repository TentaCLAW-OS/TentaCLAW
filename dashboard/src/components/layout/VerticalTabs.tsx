import { useUIStore } from '@/stores/ui';
import type { TabId } from '@/lib/types';

interface TabDef {
  id: TabId;
  icon: string;
  label: string;
}

const tabs: TabDef[] = [
  { id: 'summary',       icon: '\u25A3', label: 'Summary' },
  { id: 'gpus',          icon: '\u2630', label: 'GPUs' },
  { id: 'models',        icon: '\u25B6', label: 'Models' },
  { id: 'inference',     icon: '\u23F5', label: 'Inference' },
  { id: 'metrics',       icon: '\uD83D\uDCCA', label: 'Metrics' },
  { id: 'terminal',      icon: '>_',     label: 'Terminal' },
  { id: 'chat',          icon: '\uD83D\uDCAC', label: 'AI Chat' },
  { id: 'security',      icon: '\uD83D\uDEE1', label: 'Security' },
  { id: 'alerts',        icon: '\u26A0',  label: 'Alerts' },
  { id: 'flight-sheets', icon: '\uD83D\uDCCB', label: 'Flight Sheets' },
  { id: 'billing',       icon: '\uD83D\uDCB0', label: 'Billing' },
  { id: 'settings',      icon: '\u2699',  label: 'Settings' },
];

export function VerticalTabs() {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  return (
    <nav
      className="w-[140px] shrink-0 py-2 overflow-y-auto"
      style={{
        background: 'rgba(10,13,20,0.5)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <div
            key={tab.id}
            className="flex items-center gap-2 px-3.5 py-2 text-[11px] cursor-pointer border-l-2 transition-all"
            style={{
              borderLeftColor: active ? 'var(--cyan)' : 'transparent',
              color: active ? 'var(--cyan)' : 'var(--text-muted)',
              background: active ? 'rgba(0,255,255,0.05)' : 'transparent',
            }}
            onClick={() => setActiveTab(tab.id)}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = 'var(--text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = 'var(--text-muted)';
              }
            }}
          >
            <span className="w-4 text-center text-[12px] shrink-0">{tab.icon}</span>
            <span className="truncate">{tab.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
