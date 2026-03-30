import { useState, useEffect, useRef, useMemo } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import type { TabId } from '@/lib/types';

interface Command {
  id: string;
  label: string;
  category: 'tab' | 'node' | 'action';
  action: () => void;
  shortcut?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nodes = useClusterStore((s) => s.nodes);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const selectResource = useUIStore((s) => s.selectResource);

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

    return cmds;
  }, [nodes, setActiveTab, selectResource]);

  // Filter
  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

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

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
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
      filtered[selectedIdx].action();
      setOpen(false);
    }
  }

  if (!open) return null;

  return (
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
              fontFamily: "'Inter', sans-serif",
            }}
          />
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
              No matching commands
            </div>
          ) : (
            filtered.slice(0, 15).map((cmd, i) => (
              <div
                key={cmd.id}
                className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors"
                style={{
                  background: i === selectedIdx ? 'rgba(0,255,255,0.06)' : 'transparent',
                }}
                onClick={() => {
                  cmd.action();
                  setOpen(false);
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span
                  className="text-[9px] uppercase px-1.5 py-0.5 rounded font-medium"
                  style={{
                    color:
                      cmd.category === 'tab'
                        ? 'var(--cyan)'
                        : cmd.category === 'node'
                          ? 'var(--green)'
                          : 'var(--purple)',
                    background:
                      cmd.category === 'tab'
                        ? 'rgba(0,255,255,0.08)'
                        : cmd.category === 'node'
                          ? 'rgba(0,255,136,0.08)'
                          : 'rgba(140,0,200,0.08)',
                  }}
                >
                  {cmd.category}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {cmd.label}
                </span>
              </div>
            ))
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
  );
}
