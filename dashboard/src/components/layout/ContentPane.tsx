import { useUIStore } from '@/stores/ui';
import { SummaryTab } from '@/components/tabs/SummaryTab';
import { ChatTab } from '@/components/tabs/ChatTab';
import { TerminalTab } from '@/components/tabs/TerminalTab';
import type { TabId } from '@/lib/types';

const tabLabels: Record<TabId, string> = {
  summary: 'Summary',
  gpus: 'GPUs',
  models: 'Models',
  inference: 'Inference',
  metrics: 'Metrics',
  terminal: 'Terminal',
  chat: 'AI Chat',
  security: 'Security',
  alerts: 'Alerts',
  'flight-sheets': 'Flight Sheets',
  billing: 'Billing',
  settings: 'Settings',
};

export function ContentPane() {
  const activeTab = useUIStore((s) => s.activeTab);

  // Terminal tab needs full-height container without padding (xterm manages its own scroll)
  if (activeTab === 'terminal') {
    return (
      <div className="flex-1 overflow-hidden" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <TerminalTab />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {activeTab === 'summary' ? (
        <SummaryTab />
      ) : activeTab === 'chat' ? (
        <ChatTab />
      ) : (
        <div>
          <h2
            className="text-sm font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {tabLabels[activeTab]}
          </h2>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {tabLabels[activeTab]} tab &mdash; coming soon
          </p>
        </div>
      )}
    </div>
  );
}
