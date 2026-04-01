import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import { useThemeStore } from '@/stores/theme';
import { THEMES } from '@/lib/themes';
import { fuzzyFilter } from '@/lib/fuzzy';
import type { TabId } from '@/lib/types';

interface Command {
  id: string;
  label: string;
  category: 'tab' | 'node' | 'action' | 'easter-egg';
  action: () => void;
  shortcut?: string;
  /** If set, displays this as a static result instead of running an action */
  displayResult?: string;
}

// Map from tab id to leader key sequence
const TAB_SHORTCUTS: Partial<Record<string, string>> = {
  summary: 'g s',
  gpus: 'g g',
  models: 'g m',
  inference: 'g i',
  terminal: 'g t',
  chat: 'g c',
  alerts: 'g a',
  settings: 'g x',
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [easterEggResult, setEasterEggResult] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nodes = useClusterStore((s) => s.nodes);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const selectResource = useUIStore((s) => s.selectResource);
  const { activeThemeId, setTheme } = useThemeStore();

  const triggerConfetti = useCallback(() => {
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 2000);
  }, []);

  const [themePickerOpen, setThemePickerOpen] = useState(false);

  // Slash commands — only shown when query starts with /
  const SLASH_COMMANDS = useMemo<Command[]>(() => [
    { id: 'slash:models', label: '/models — Jump to models tab', category: 'action', shortcut: '/models', action: () => setActiveTab('models') },
    { id: 'slash:nodes', label: '/nodes — Jump to summary', category: 'action', shortcut: '/nodes', action: () => setActiveTab('summary') },
    { id: 'slash:alerts', label: '/alerts — Jump to alerts', category: 'action', shortcut: '/alerts', action: () => setActiveTab('alerts') },
    { id: 'slash:flight', label: '/flight — Jump to flight sheets', category: 'action', shortcut: '/flight', action: () => setActiveTab('flight-sheets') },
    { id: 'slash:terminal', label: '/terminal — Jump to terminal', category: 'action', shortcut: '/terminal', action: () => setActiveTab('terminal') },
    { id: 'slash:theme', label: '/theme — Switch dashboard theme', category: 'action', shortcut: '/theme', action: () => { setQuery(''); setThemePickerOpen(true); } },
  ], [setActiveTab]);

  // Build command list
  const commands = useMemo<Command[]>(() => {
    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'summary', label: 'Summary' },
      { id: 'gpus', label: 'GPUs' },
      { id: 'models', label: 'Models' },
      { id: 'inference', label: 'Inference' },
      { id: 'metrics', label: 'Metrics' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'chat', label: 'AI Chat' },
      { id: 'security', label: 'Security' },
      { id: 'alerts', label: 'Alerts' },
      { id: 'flight-sheets', label: 'Flight Sheets' },
      { id: 'billing', label: 'Billing' },
      { id: 'settings', label: 'Settings' },
    ];

    const cmds: Command[] = tabs.map((t) => ({
      id: `tab:${t.id}`,
      label: `Go to ${t.label}`,
      category: 'tab' as const,
      action: () => setActiveTab(t.id),
      shortcut: TAB_SHORTCUTS[t.id],
    }));

    for (const node of nodes) {
      cmds.push({
        id: `node:${node.id}`,
        label: `Select node: ${node.hostname}`,
        category: 'node' as const,
        action: () => selectResource({ type: 'node', id: node.id }),
      });
      cmds.push({
        id: `shell:${node.id}`,
        label: `Shell into ${node.hostname}`,
        category: 'action' as const,
        action: () => {
          selectResource({ type: 'node', id: node.id });
          setActiveTab('terminal');
        },
      });
    }

    // Easter egg commands
    cmds.push({
      id: 'egg:party',
      label: 'party',
      category: 'easter-egg' as const,
      action: () => triggerConfetti(),
    });
    cmds.push({
      id: 'egg:celebrate',
      label: 'celebrate',
      category: 'easter-egg' as const,
      action: () => triggerConfetti(),
    });
    cmds.push({
      id: 'egg:who',
      label: 'who are you',
      category: 'easter-egg' as const,
      action: () => setEasterEggResult("I'm CLAWtopus. 8 arms. impeccable vibes. 🐙"),
      displayResult: "I'm CLAWtopus. 8 arms. impeccable vibes. 🐙",
    });
    cmds.push({
      id: 'egg:meaning',
      label: 'meaning of life',
      category: 'easter-egg' as const,
      action: () => setEasterEggResult('42 tok/s'),
      displayResult: '42 tok/s',
    });

    return cmds;
  }, [nodes, setActiveTab, selectResource, triggerConfetti]);

  // Filter with fuzzy search — slash commands take over when query starts with /
  const filtered = useMemo(() => {
    if (query.startsWith('/')) {
      return fuzzyFilter(query, SLASH_COMMANDS, (c) => c.label);
    }
    const base = query
      ? commands
      : commands.filter((c) => c.category !== 'easter-egg');
    return fuzzyFilter(query, base, (c) => c.label);
  }, [query, commands, SLASH_COMMANDS]);

  // Keyboard shortcut to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus input on open, reset state
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setEasterEggResult(null);
      setThemePickerOpen(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Navigate with arrows
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      const cmd = filtered[selectedIdx].item;
      cmd.action();
      // Easter eggs: show result inline, don't close (except confetti which closes)
      if (cmd.displayResult) {
        setEasterEggResult(cmd.displayResult);
      } else if (cmd.category === 'easter-egg') {
        // confetti — close after trigger
        setOpen(false);
      } else {
        setOpen(false);
      }
    }
  }

  if (!open && !showConfetti) return null;

  return (
    <>
      {showConfetti && <ConfettiOverlay />}
      {open && (
      <div
        className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={() => setOpen(false)}
      >
      <div
        className="w-[520px] rounded-xl overflow-hidden"
        style={{
          background: 'rgba(14,18,28,0.95)',
          border: '1px solid rgba(0,255,255,0.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,255,255,0.05)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, nodes, tabs..."
            className="w-full px-4 py-3 text-sm outline-none"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: "'Geist', 'Inter', sans-serif",
            }}
          />
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {themePickerOpen ? (
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--text-dim)' }}>
                Select theme
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {THEMES.map((theme, i) => {
                  const active = theme.id === activeThemeId;
                  const accent = theme.colors['--cyan'] || theme.colors['--purple'] || '#0ff';
                  const bg = theme.colors['--bg-base'] || '#0e121c';
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => { setTheme(theme.id); setOpen(false); }}
                      onMouseEnter={() => setSelectedIdx(i)}
                      style={{
                        background: bg,
                        border: `2px solid ${active ? accent : i === selectedIdx ? 'rgba(0,255,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color 0.12s',
                        boxShadow: active ? `0 0 8px ${accent}33` : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        {(['--cyan', '--purple', '--green', '--yellow'] as const).map((k) => (
                          <div key={k} style={{ width: 10, height: 10, borderRadius: '50%', background: theme.colors[k] || 'transparent', opacity: theme.colors[k] ? 1 : 0 }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: accent }}>{theme.name}</div>
                      {active && <div style={{ fontSize: 9, color: accent, opacity: 0.7, marginTop: 2 }}>active</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : easterEggResult ? (
            <div
              className="px-4 py-8 text-center"
              style={{
                color: 'var(--purple)',
                fontSize: 16,
                fontWeight: 600,
                fontStyle: 'italic',
                animation: 'fadeIn 0.3s ease-out both',
              }}
            >
              {easterEggResult}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
              No matching commands
            </div>
          ) : (
            filtered.slice(0, 15).map(({ item: cmd }, i) => {
              const categoryColor =
                cmd.category === 'tab'
                  ? 'var(--cyan)'
                  : cmd.category === 'node'
                    ? 'var(--green)'
                    : cmd.category === 'easter-egg'
                      ? 'var(--purple)'
                      : 'var(--purple)';
              const categoryBg =
                cmd.category === 'tab'
                  ? 'rgba(0,255,255,0.08)'
                  : cmd.category === 'node'
                    ? 'rgba(0,255,136,0.08)'
                    : 'rgba(140,0,200,0.08)';

              return (
                <div
                  key={cmd.id}
                  className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors"
                  style={{
                    background: i === selectedIdx ? 'rgba(0,255,255,0.06)' : 'transparent',
                  }}
                  onClick={() => {
                    cmd.action();
                    if (cmd.displayResult) {
                      setEasterEggResult(cmd.displayResult);
                    } else if (cmd.category === 'easter-egg') {
                      setOpen(false);
                    } else {
                      setOpen(false);
                    }
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span
                    className="text-[9px] uppercase px-1.5 py-0.5 rounded font-medium"
                    style={{
                      color: categoryColor,
                      background: categoryBg,
                    }}
                  >
                    {cmd.category === 'easter-egg' ? '🐙' : cmd.category}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {cmd.label}
                  </span>
                  {cmd.shortcut && (
                    <span
                      className="text-[8px] font-mono px-1 py-0.5 rounded ml-auto shrink-0"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        color: 'var(--text-dim)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div
          className="flex items-center gap-4 px-4 py-2 text-[9px]"
          style={{
            borderTop: '1px solid var(--border)',
            color: 'var(--text-dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
    )}
    </>
  );
}

/* ── Confetti overlay — colored dots floating down ── */
const CONFETTI_COLORS = [
  'var(--cyan)', 'var(--purple)', 'var(--green)', 'var(--yellow)',
  'var(--red)', '#ff69b4', '#ffa500', '#00ff88',
];

function ConfettiOverlay() {
  // Generate 40 confetti particles with random positions and delays
  const particles = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 1.2 + Math.random() * 1,
      size: 4 + Math.random() * 6,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    })),
  []);

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: -10,
            width: p.size,
            height: p.size,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            backgroundColor: p.color,
            animation: `confettiFall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}
