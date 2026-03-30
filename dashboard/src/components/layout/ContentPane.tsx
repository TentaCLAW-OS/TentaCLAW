import { useUIStore } from '@/stores/ui';
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

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {activeTab === 'summary' ? (
        <div>
          <h2
            className="text-sm font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Cluster Summary
          </h2>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Summary Tab &mdash; coming in Task 5
          </p>
        </div>
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
