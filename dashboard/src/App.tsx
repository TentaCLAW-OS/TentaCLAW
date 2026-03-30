export function App() {
  return (
    <div className="flex flex-col h-screen relative z-[1]">
      {/* Scanline effect */}
      <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--cyan)]/10 to-transparent pointer-events-none z-50" style={{ animation: 'scanline 8s linear infinite' }} />

      {/* Header */}
      <header className="h-11 flex items-center justify-between px-4 shrink-0" style={{ background: 'rgba(8,10,16,0.9)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: 'linear-gradient(135deg, var(--purple), var(--cyan))', boxShadow: '0 0 12px rgba(140,0,200,0.25)' }}>
            🐙
          </div>
          <span className="text-xs font-bold tracking-[2.5px]" style={{ background: 'linear-gradient(90deg, var(--cyan), var(--purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TENTACLAW
          </span>
          <span className="text-[8px] text-[var(--text-dim)] font-mono px-1.5 py-0.5 border rounded" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>v1.0.0</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" style={{ boxShadow: '0 0 6px rgba(0,255,136,0.5)' }} />
            <span className="text-[9px] text-[var(--text-dim)] font-mono">live</span>
          </div>
        </div>
      </header>

      {/* Main three-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 flex flex-col overflow-hidden" style={{ background: 'var(--bg-sidebar)', backdropFilter: 'blur(12px)', borderRight: '1px solid var(--border)' }}>
          <div className="p-3 text-[9px] uppercase tracking-[2px] text-[var(--text-muted)] font-medium" style={{ borderBottom: '1px solid var(--border)' }}>
            Resource Tree
          </div>
          <div className="flex-1 p-2 text-xs text-[var(--text-dim)]">
            Tree loading...
          </div>
        </aside>

        {/* Center content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            {/* Vertical tabs */}
            <nav className="w-[140px] shrink-0 py-2" style={{ background: 'rgba(10,13,20,0.5)', borderRight: '1px solid var(--border)' }}>
              {['Summary', 'GPUs', 'Models', 'Inference', 'Metrics', 'Terminal', 'AI Chat', 'Security', 'Alerts', 'Flight Sheets', 'Billing', 'Settings'].map((tab, i) => (
                <div
                  key={tab}
                  className={`flex items-center gap-2 px-3.5 py-2 text-[11px] cursor-pointer border-l-2 transition-all ${i === 0 ? 'border-l-[var(--cyan)] text-[var(--cyan)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                  style={i === 0 ? { background: 'rgba(0,255,255,0.05)' } : undefined}
                >
                  {tab}
                </div>
              ))}
            </nav>

            {/* Content pane */}
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-sm text-[var(--text-secondary)]">
                Dashboard ready — Summary tab will render here
              </p>
            </div>
          </div>

          {/* Bottom task log */}
          <div className="h-[140px] shrink-0 flex flex-col" style={{ background: 'rgba(8,10,16,0.8)', backdropFilter: 'blur(12px)', borderTop: '1px solid var(--border)' }}>
            <div className="flex gap-0 px-3" style={{ borderBottom: '1px solid var(--border)' }}>
              {['Tasks', 'Cluster Log', 'Alerts'].map((tab, i) => (
                <div
                  key={tab}
                  className={`px-3.5 py-1.5 text-[10px] cursor-pointer border-b-2 ${i === 0 ? 'border-b-[var(--cyan)] text-[var(--cyan)]/70' : 'border-transparent text-[var(--text-muted)]'}`}
                >
                  {tab}
                </div>
              ))}
            </div>
            <div className="p-3 text-xs text-[var(--text-dim)] font-mono">
              Task log ready...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
