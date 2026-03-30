import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { VerticalTabs } from '@/components/layout/VerticalTabs';
import { ContentPane } from '@/components/layout/ContentPane';
import { TaskLog } from '@/components/layout/TaskLog';
import { useSSE } from '@/hooks/useSSE';

export function App() {
  useSSE();

  return (
    <div className="flex flex-col h-screen relative z-[1]">
      {/* Scanline */}
      <div
        className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--cyan)]/10 to-transparent pointer-events-none z-50"
        style={{ animation: 'scanline 8s linear infinite' }}
      />

      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <VerticalTabs />
            <ContentPane />
          </div>
          <TaskLog />
        </div>
      </div>
    </div>
  );
}
