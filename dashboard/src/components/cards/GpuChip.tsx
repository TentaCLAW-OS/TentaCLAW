import type { GpuStats } from '@/lib/types';
import { formatTemp } from '@/lib/format';

interface GpuChipProps {
  gpu: GpuStats;
}

const tempColors: Record<ReturnType<typeof formatTemp>, string> = {
  cool: 'var(--green)',
  warm: 'var(--yellow)',
  hot: 'var(--red)',
};

export function GpuChip({ gpu }: GpuChipProps) {
  const tempRange = formatTemp(gpu.temperatureC);
  const tempColor = tempColors[tempRange];
  const vramPct = gpu.vramTotalMb > 0
    ? Math.min((gpu.vramUsedMb / gpu.vramTotalMb) * 100, 100)
    : 0;
  const vramUsedGb = (gpu.vramUsedMb / 1024).toFixed(1);
  const vramTotalGb = (gpu.vramTotalMb / 1024).toFixed(1);

  return (
    <div
      className="rounded-md px-2 py-1.5 flex flex-col gap-0.5 transition-colors"
      style={{
        background: 'var(--bg-chip)',
        border: '1px solid var(--border)',
        minWidth: 80,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      {/* GPU name */}
      <span
        style={{
          fontSize: 8,
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {gpu.name}
      </span>

      {/* Temperature */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: tempColor,
          lineHeight: 1,
        }}
      >
        {gpu.temperatureC}&deg;C
      </span>

      {/* VRAM bar */}
      <div
        className="rounded-full overflow-hidden"
        style={{
          height: 2,
          background: 'rgba(255,255,255,0.06)',
          marginTop: 2,
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${vramPct}%`,
            background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>

      {/* VRAM text */}
      <span
        style={{
          fontSize: 7,
          color: 'var(--text-dim)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {vramUsedGb}/{vramTotalGb} GB
      </span>
    </div>
  );
}
