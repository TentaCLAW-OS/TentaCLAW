import { useUIStore } from '@/stores/ui';
import { SummaryTab } from '@/components/tabs/SummaryTab';
import { ChatTab } from '@/components/tabs/ChatTab';
import { TerminalTab } from '@/components/tabs/TerminalTab';
import { GpusTab } from '@/components/tabs/GpusTab';
import { ModelsTab } from '@/components/tabs/ModelsTab';
import { InferenceTab } from '@/components/tabs/InferenceTab';
import { MetricsTab } from '@/components/tabs/MetricsTab';
import { SecurityTab } from '@/components/tabs/SecurityTab';
import { AlertsTab } from '@/components/tabs/AlertsTab';
import { FlightSheetsTab } from '@/components/tabs/FlightSheetsTab';
import { BillingTab } from '@/components/tabs/BillingTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';

function TabContent() {
  const activeTab = useUIStore((s) => s.activeTab);

  switch (activeTab) {
    case 'summary':
      return <SummaryTab />;
    case 'gpus':
      return <GpusTab />;
    case 'models':
      return <ModelsTab />;
    case 'inference':
      return <InferenceTab />;
    case 'metrics':
      return <MetricsTab />;
    case 'chat':
      return <ChatTab />;
    case 'security':
      return <SecurityTab />;
    case 'alerts':
      return <AlertsTab />;
    case 'flight-sheets':
      return <FlightSheetsTab />;
    case 'billing':
      return <BillingTab />;
    case 'settings':
      return <SettingsTab />;
    default:
      return null;
  }
}

export function ContentPane() {
  const activeTab = useUIStore((s) => s.activeTab);

  // Terminal and Chat tabs need full-height container without padding
  if (activeTab === 'terminal') {
    return (
      <div className="flex-1 overflow-hidden" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <TerminalTab />
      </div>
    );
  }

  if (activeTab === 'chat') {
    return (
      <div className="flex-1 overflow-hidden" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <ChatTab />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <TabContent />
    </div>
  );
}
