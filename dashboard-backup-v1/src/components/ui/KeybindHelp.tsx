import { useState, useEffect } from 'react';

interface ShortcutGroup {
  category: string;
  shortcuts: Array<{ keys: string; label: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: 'Panels',
    shortcuts: [
      { keys: 'Ctrl+B', label: 'Toggle left sidebar' },
      { keys: 'Ctrl+J', label: 'Toggle context panel' },
      { keys: 'Ctrl+`', label: 'Toggle bottom log' },
    ],
  },
  {
    category: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+K', label: 'Command palette' },
      { keys: 'g s', label: 'Go to Summary' },
      { keys: 'g g', label: 'Go to GPUs' },
      { keys: 'g m', label: 'Go to Models' },
      { keys: 'g i', label: 'Go to Inference' },
      { keys: 'g t', label: 'Go to Terminal' },
      { keys: 'g c', label: 'Go to Chat' },
      { keys: 'g a', label: 'Go to Alerts' },
      { keys: 'g x', label: 'Go to Settings' },
    ],
  },
  {
    category: 'Slash Commands',
    shortcuts: [
      { keys: '/models', label: 'Jump to models' },
      { keys: '/nodes', label: 'Jump to summary' },
      { keys: '/alerts', label: 'Jump to alerts' },
      { keys: '/flight', label: 'Jump to flight sheets' },
      { keys: '/theme', label: 'Open theme picker' },
    ],
  },
];

export function KeybindHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-h-[70vh] rounded-xl overflow-hidden"
        style={{
          background: 'rgba(14,18,28,0.95)',
          border: '1px solid rgba(0,255,255,0.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Keyboard Shortcuts
          </span>
          <span className="text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
            press ? or Esc to close
          </span>
        </div>

        <div className="overflow-y-auto px-5 py-3" style={{ maxHeight: 'calc(70vh - 48px)' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category} className="mb-4">
              <div
                className="text-[9px] uppercase tracking-[2px] mb-2"
                style={{ color: 'var(--cyan)' }}
              >
                {group.category}
              </div>
              <div className="flex flex-col gap-1">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {s.label}
                    </span>
                    <kbd
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
