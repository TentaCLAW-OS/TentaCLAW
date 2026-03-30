interface VramBarProps {
  used: number;
  total: number;
}

export function VramBar({ used, total }: VramBarProps) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const usedGb = (used / 1024).toFixed(1);
  const totalGb = (total / 1024).toFixed(1);

  return (
    <div className="w-full">
      <div
        className="relative w-full rounded-full overflow-hidden"
        style={{
          height: 3,
          background: 'rgba(255,255,255,0.06)',
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
            boxShadow: '0 0 6px rgba(0,255,255,0.4), 0 0 12px rgba(140,0,200,0.2)',
            animation: 'barPulse 3s ease-in-out infinite',
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>
      <p
        className="mt-1"
        style={{
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-muted)',
        }}
      >
        {usedGb} GB used &middot; {pct.toFixed(0)}%
      </p>
    </div>
  );
}
