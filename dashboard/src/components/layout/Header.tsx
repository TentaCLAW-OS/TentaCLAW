import { useClusterStore } from '@/stores/cluster';

export function Header() {
  const summary = useClusterStore((s) => s.summary);
  const connected = useClusterStore((s) => s.connected);

  const totalGpus = summary?.total_gpus ?? 0;
  const totalNodes = summary?.total_nodes ?? 0;

  return (
    <header
      className="h-11 flex items-center justify-between px-4 shrink-0 z-30"
      style={{
        background: 'rgba(8,10,16,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Left: Logo + brand */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
          style={{
            background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
            boxShadow: '0 0 12px rgba(140,0,200,0.25)',
          }}
        >
          <span role="img" aria-label="tentaclaw">🐙</span>
        </div>
        <span
          className="text-xs font-bold tracking-[2.5px]"
          style={{
            background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          TENTACLAW
        </span>
        <span
          className="text-[8px] text-[var(--text-dim)] font-mono px-1.5 py-0.5 border rounded"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          v1.0.0
        </span>
      </div>

      {/* Center: Search */}
      <div className="flex items-center">
        <input
          type="text"
          placeholder="Search nodes, models, commands... (Ctrl+K)"
          className="w-[280px] h-7 px-3 text-[11px] rounded border outline-none placeholder:text-[var(--text-dim)]"
          style={{
            background: 'var(--bg-input)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
          readOnly
        />
      </div>

      {/* Right: Quick stats + controls */}
      <div className="flex items-center gap-4">
        {/* Quick stats */}
        <div className="flex items-center gap-3 text-[9px] font-mono text-[var(--cyan)]">
          <span>{totalNodes} nodes</span>
          <span>{totalGpus} GPUs</span>
          <span>{summary?.inference_requests_24h ?? 0} req/24h</span>
        </div>

        {/* Connection dot */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: connected ? 'var(--green)' : 'var(--red)',
              boxShadow: connected
                ? '0 0 6px rgba(0,255,136,0.5)'
                : '0 0 6px rgba(255,70,70,0.5)',
            }}
          />
          <span className="text-[9px] text-[var(--text-dim)] font-mono">
            {connected ? 'live' : 'offline'}
          </span>
        </div>

        {/* Notification bell */}
        <div className="relative cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <span className="text-sm">&#x1F514;</span>
          <div
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--red)' }}
          />
        </div>

        {/* Settings gear */}
        <span className="text-sm cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          &#x2699;
        </span>

        {/* User avatar */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
            }}
          >
            A
          </div>
          <span className="text-[9px] text-[var(--text-muted)] font-mono">admin</span>
        </div>
      </div>
    </header>
  );
}
