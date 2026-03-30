import { useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { VerticalTabs } from '@/components/layout/VerticalTabs';
import { ContentPane } from '@/components/layout/ContentPane';
import { TaskLog } from '@/components/layout/TaskLog';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { LoginPage } from '@/components/LoginPage';
import { useAuthStore } from '@/stores/auth';
import { useSSE } from '@/hooks/useSSE';

function LoadingScreen() {
  return (
    <div
      className="flex items-center justify-center h-screen w-screen"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: 'var(--cyan)',
            borderRightColor: 'var(--cyan)',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span
          className="text-xs font-mono tracking-[2px]"
          style={{ color: 'var(--text-dim)' }}
        >
          INITIALIZING...
        </span>
      </div>
    </div>
  );
}

function Dashboard() {
  useSSE();

  return (
    <div className="flex flex-col h-screen relative z-[1]">
      {/* Scanline */}
      <div
        className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--cyan)]/10 to-transparent pointer-events-none z-50"
        style={{ animation: 'scanline 8s linear infinite' }}
      />

      {/* Command palette overlay (Ctrl+K) */}
      <CommandPalette />

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

export function App() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginPage />;
  return <Dashboard />;
}
