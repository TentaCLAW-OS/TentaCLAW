interface StatusDotProps {
  status: 'online' | 'warning' | 'offline' | 'error' | 'rebooting';
  size?: number;
}

const config: Record<StatusDotProps['status'], { color: string; glow: boolean; speed?: string }> = {
  online:    { color: '#00ff88', glow: true,  speed: '2.5s' },
  warning:   { color: '#ffdc00', glow: true,  speed: '1.5s' },
  offline:   { color: '#444',    glow: false },
  error:     { color: '#ff4646', glow: true,  speed: '1s' },
  rebooting: { color: '#ffdc00', glow: true,  speed: '0.8s' },
};

export function StatusDot({ status, size = 7 }: StatusDotProps) {
  const c = config[status];

  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: c.color,
        ['--glow-color' as string]: c.color,
        boxShadow: c.glow ? `0 0 4px ${c.color}, 0 0 8px ${c.color}` : 'none',
        animation: c.glow && c.speed ? `breathe ${c.speed} ease-in-out infinite` : 'none',
      }}
    />
  );
}
