// ─── TentaCLAW Dashboard — App Shell ────────────────────────────────────────

import React, { useEffect } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { ModelsPage } from './pages/ModelsPage';
import { AgentsPage } from './pages/AgentsPage';
import { ChatPage } from './pages/ChatPage';
import { ClusterPage } from './pages/ClusterPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';

function PageRouter() {
  const page = useStore(s => s.page);
  switch (page) {
    case 'dashboard': return <DashboardPage />;
    case 'models': return <ModelsPage />;
    case 'agents': return <AgentsPage />;
    case 'chat': return <ChatPage />;
    case 'cluster': return <ClusterPage />;
    case 'alerts': return <AlertsPage />;
    case 'settings': return <SettingsPage />;
    default: return <DashboardPage />;
  }
}

export function App() {
  const { init, sidebarCollapsed } = useStore();

  useEffect(() => { init(); }, []);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-56'}`}>
        <TopBar />
        <main className="p-6">
          <PageRouter />
        </main>
      </div>
    </div>
  );
}
