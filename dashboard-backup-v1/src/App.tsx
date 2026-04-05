import { useEffect, useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { KeybindHelp } from '@/components/ui/KeybindHelp';
import { LoginPage } from '@/components/LoginPage';
import { useAuthStore } from '@/stores/auth';
import { usePanelsStore } from '@/stores/panels';
import { useUIStore } from '@/stores/ui';
import { useSSE } from '@/hooks/useSSE';
import { useKeybinds } from '@/hooks/useKeybinds';
import type { KeybindAction } from '@/lib/types';

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

  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const toggleLeft = usePanelsStore((s) => s.toggleLeftSidebar);
  const toggleRight = usePanelsStore((s) => s.toggleRightSidebar);
  const toggleBottom = usePanelsStore((s) => s.toggleBottomPanel);

  const keybinds = useMemo<KeybindAction[]>(
    () => [
      { id: 'toggle-left', keys: 'ctrl+b', label: 'Toggle sidebar', category: 'panels', action: toggleLeft },
      { id: 'toggle-right', keys: 'ctrl+j', label: 'Toggle context', category: 'panels', action: toggleRight },
      { id: 'toggle-bottom', keys: 'ctrl+`', label: 'Toggle log', category: 'panels', action: toggleBottom },
      { id: 'go-summary', keys: 'g s', label: 'Go to Summary', category: 'tabs', action: () => setActiveTab('summary') },
      { id: 'go-gpus', keys: 'g g', label: 'Go to GPUs', category: 'tabs', action: () => setActiveTab('gpus') },
      { id: 'go-models', keys: 'g m', label: 'Go to Models', category: 'tabs', action: () => setActiveTab('models') },
      { id: 'go-inference', keys: 'g i', label: 'Go to Inference', category: 'tabs', action: () => setActiveTab('inference') },
      { id: 'go-terminal', keys: 'g t', label: 'Go to Terminal', category: 'tabs', action: () => setActiveTab('terminal') },
      { id: 'go-chat', keys: 'g c', label: 'Go to Chat', category: 'tabs', action: () => setActiveTab('chat') },
      { id: 'go-alerts', keys: 'g a', label: 'Go to Alerts', category: 'tabs', action: () => setActiveTab('alerts') },
      { id: 'go-settings', keys: 'g x', label: 'Go to Settings', category: 'tabs', action: () => setActiveTab('settings') },
    ],
    [setActiveTab, toggleLeft, toggleRight, toggleBottom],
  );

  useKeybinds(keybinds);

  return (
    <div className="flex flex-col h-screen relative z-[1]">
      {/* Scanline */}
      <div
        className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--cyan)]/10 to-transparent pointer-events-none z-50"
        style={{ animation: 'scanline 8s linear infinite' }}
      />
      <CommandPalette />
      <KeybindHelp />
      <Header />
      <PanelLayout />
      <StatusBar />
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
