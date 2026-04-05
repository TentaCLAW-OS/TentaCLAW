import { useClusterStore } from '@/stores/cluster';
import type { GpuStats, ClusterNode } from '@/lib/types';
import { formatTemp } from '@/lib/format';
import { TentaCLAWTips } from '@/components/ui/TentaCLAWTips';
import { emptyStateTips } from '@/lib/personality';

/* ── temperature colour mapping (matches GpuChip) ── */
const tempColors: Record<ReturnType<typeof formatTemp>, string> = {
  cool: 'var(--green)',
  warm: 'var(--yellow)',
  hot: 'var(--red)',
};

/* ── flattened row type ── */
interface GpuRow {
  nodeId: string;
  hostname: string;
  gpu: GpuStats;
}

/* ── shared inline styles ── */
const monoFont = "'JetBrains Mono', monospace";

const headerStyle: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  padding: '8px 10px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: monoFont,
  color: 'var(--text-primary)',
  padding: '7px 10px',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
};

/* ── thin inline VRAM bar (same gradient as GpuChip) ── */
function VramInlineBar({ pct }: { pct: number }) {
  return (
    <div
      className="rounded-full overflow-hidden"
      style={{
        height: 3,
        background: 'rgba(255,255,255,0.06)',
        minWidth: 60,
        marginTop: 2,
      }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
          transition: 'width 0.6s ease-out',
        }}
      />
    </div>
  );
}

/* ── small utilisation bar ── */
function UtilBar({ pct }: { pct: number }) {
  return (
    <div
      className="rounded-full overflow-hidden"
      style={{
        height: 3,
        background: 'rgba(255,255,255,0.06)',
        width: 48,
        marginTop: 2,
      }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: 'var(--cyan)',
          transition: 'width 0.6s ease-out',
        }}
      />
    </div>
  );
}

/* ── row hover helpers removed — using CSS className instead ── */

/* ══════════════════════════════════════════════════════
   GpusTab — full GPU inventory table
   ══════════════════════════════════════════════════════ */
export function GpusTab() {
  const nodes = useClusterStore((s) => s.nodes);

  /* flatten all GPUs across every node into rows */
  const rows: GpuRow[] = [];
  for (const node of nodes) {
    const gpus = node.latest_stats?.gpus ?? [];
    for (const gpu of gpus) {
      rows.push({ nodeId: node.id, hostname: node.hostname, gpu });
    }
  }

  /* ── empty state ── */
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2" style={{ animation: 'slideUp 0.4s ease-out both' }}>
        <span className="text-2xl opacity-20">🖥️</span>
        <TentaCLAWTips tip={emptyStateTips.gpus} />
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', animation: 'slideUp 0.4s ease-out both' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: 'transparent',
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--border)',
            }}
          >
            <th style={headerStyle}>Node</th>
            <th style={headerStyle}>GPU</th>
            <th style={headerStyle}>Bus ID</th>
            <th style={headerStyle}>Temp</th>
            <th style={headerStyle}>VRAM</th>
            <th style={headerStyle}>Utilization</th>
            <th style={headerStyle}>Power</th>
            <th style={headerStyle}>Fan</th>
            <th style={headerStyle}>Core Clock</th>
            <th style={headerStyle}>Mem Clock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { gpu, hostname } = row;
            const tempRange = formatTemp(gpu.temperatureC);
            const tempColor = tempColors[tempRange];
            const vramPct =
              gpu.vramTotalMb > 0
                ? Math.min((gpu.vramUsedMb / gpu.vramTotalMb) * 100, 100)
                : 0;
            const vramUsedGb = (gpu.vramUsedMb / 1024).toFixed(1);
            const vramTotalGb = (gpu.vramTotalMb / 1024).toFixed(0);

            return (
              <tr
                key={`${row.nodeId}-${gpu.busId}-${i}`}
                className="hover:bg-[rgba(0,255,255,0.02)] transition-colors"
              >
                {/* Node */}
                <td
                  style={{
                    ...cellStyle,
                    color: 'var(--cyan)',
                    cursor: 'pointer',
                    fontFamily: monoFont,
                    fontWeight: 500,
                  }}
                >
                  {hostname}
                </td>

                {/* GPU name */}
                <td
                  style={{
                    ...cellStyle,
                    fontFamily: 'inherit',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {gpu.name}
                </td>

                {/* Bus ID */}
                <td
                  style={{
                    ...cellStyle,
                    color: 'var(--text-dim)',
                  }}
                >
                  {gpu.busId}
                </td>

                {/* Temperature */}
                <td
                  style={{
                    ...cellStyle,
                    color: tempColor,
                    fontWeight: 700,
                  }}
                >
                  {gpu.temperatureC}&deg;C
                </td>

                {/* VRAM */}
                <td style={cellStyle}>
                  <div className="flex flex-col gap-0.5">
                    <span>
                      {vramUsedGb} / {vramTotalGb} GB
                    </span>
                    <VramInlineBar pct={vramPct} />
                  </div>
                </td>

                {/* Utilization */}
                <td style={cellStyle}>
                  <div className="flex flex-col gap-0.5">
                    <span>{gpu.utilizationPct}%</span>
                    <UtilBar pct={gpu.utilizationPct} />
                  </div>
                </td>

                {/* Power */}
                <td style={cellStyle}>{gpu.powerDrawW}W</td>

                {/* Fan */}
                <td style={cellStyle}>{gpu.fanSpeedPct}%</td>

                {/* Core Clock */}
                <td style={cellStyle}>{gpu.clockSmMhz} MHz</td>

                {/* Mem Clock */}
                <td style={cellStyle}>{gpu.clockMemMhz} MHz</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
