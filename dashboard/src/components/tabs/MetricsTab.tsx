import { useMemo } from 'react';
import { Sparkline } from '@/components/ui/Sparkline';

/* ── mock data helpers ── */

/**
 * Seeded PRNG (linear congruential) so charts look identical across renders.
 * Returns a function that yields values in [0, 1).
 */
function seededRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) | 0;
    return ((s >>> 16) & 0x7fff) / 0x7fff;
  };
}

/**
 * Generate a smooth random-walk time series between `min` and `max`.
 * `trend` nudges the walk upward, downward, or keeps it neutral.
 */
function mockSeries(
  length: number,
  min: number,
  max: number,
  trend: 'up' | 'down' | 'stable' = 'stable',
  seed = 42,
): number[] {
  const rng = seededRng(seed);
  const range = max - min;
  const drift = trend === 'up' ? 0.02 : trend === 'down' ? -0.02 : 0;
  const out: number[] = [];
  let val = min + range * 0.5;

  for (let i = 0; i < length; i++) {
    const step = (rng() - 0.48 + drift) * range * 0.12;
    val = Math.max(min, Math.min(max, val + step));
    out.push(Math.round(val * 100) / 100);
  }
  return out;
}

/* ── shared inline styles ── */

const monoFont = "'JetBrains Mono', monospace";

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  lineHeight: 1,
};

const valueStyle: React.CSSProperties = {
  fontSize: 18,
  fontFamily: monoFont,
  fontWeight: 600,
  color: 'var(--text-primary)',
  lineHeight: 1,
};

/* ── ChartCard: reusable glassmorphism container ── */

interface ChartCardProps {
  title: string;
  value: string;
  valueColor?: string;
  children: React.ReactNode;
}

function ChartCard({ title, value, valueColor, children }: ChartCardProps) {
  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span style={titleStyle}>{title}</span>
        <span style={{ ...valueStyle, color: valueColor ?? 'var(--text-primary)' }}>
          {value}
        </span>
      </div>

      {/* Chart area */}
      <div style={{ height: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  );
}

/* ── MultiSparkline: overlay multiple data series ── */

interface SeriesDef {
  data: number[];
  color: string;
  fillOpacity?: number;
}

function MultiSparkline({ series }: { series: SeriesDef[] }) {
  // Compute global min/max across all series for consistent scale
  const allValues = series.flatMap((s) => s.data);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const range = globalMax - globalMin || 1;

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: '100%', display: 'block' }}
    >
      {series.map((s, si) => {
        const points = s.data.map((v, i) => {
          const x = (i / (s.data.length - 1)) * 100;
          const y = 24 - ((v - globalMin) / range) * 20 - 2;
          return { x, y };
        });
        const linePath = points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ');
        const fillPath =
          linePath +
          ` L ${points[points.length - 1].x.toFixed(1)} 24 L ${points[0].x.toFixed(1)} 24 Z`;
        const gradientId = `multi-fill-${si}-${s.color.replace(/[^a-zA-Z0-9]/g, '')}`;
        const fillOp = s.fillOpacity ?? 0.1;

        return (
          <g key={si}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={fillOp} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={fillPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              stroke={s.color}
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════
   MetricsTab — cluster performance charts
   ══════════════════════════════════════════════════════ */

export function MetricsTab() {
  const data = useMemo(() => {
    const N = 30;

    // Throughput — tok/s (realistic range for a small cluster)
    const throughput = mockSeries(N, 380, 620, 'stable', 101);

    // Latency — ms
    const latencyP50 = mockSeries(N, 18, 35, 'stable', 201);
    const latencyP95 = mockSeries(N, 45, 90, 'stable', 202);
    const latencyP99 = mockSeries(N, 80, 180, 'stable', 203);

    // Error rate — percentage (mostly low, occasionally spikes)
    const errorRate = mockSeries(N, 0.1, 1.8, 'stable', 301);

    // Daily electricity cost — USD
    const cost = mockSeries(N, 2.8, 6.2, 'up', 401);

    // VRAM utilization — cluster-wide percentage
    const vram = mockSeries(N, 55, 92, 'up', 501);

    return { throughput, latencyP50, latencyP95, latencyP99, errorRate, cost, vram };
  }, []);

  const currentThroughput = data.throughput[data.throughput.length - 1];
  const currentP50 = data.latencyP50[data.latencyP50.length - 1];
  const currentP95 = data.latencyP95[data.latencyP95.length - 1];
  const currentError = data.errorRate[data.errorRate.length - 1];
  const currentCost = data.cost[data.cost.length - 1];
  const currentVram = data.vram[data.vram.length - 1];

  const errorColor = currentError > 1 ? 'var(--red)' : 'var(--green)';

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: 3 charts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {/* Throughput */}
        <ChartCard
          title="Throughput"
          value={`${currentThroughput.toFixed(0)} tok/s`}
          valueColor="var(--cyan)"
        >
          <Sparkline data={data.throughput} color="var(--cyan)" fillOpacity={0.2} />
        </ChartCard>

        {/* Latency */}
        <ChartCard
          title="Latency"
          value={`p50 ${currentP50.toFixed(0)}ms / p95 ${currentP95.toFixed(0)}ms`}
          valueColor="var(--text-secondary)"
        >
          <MultiSparkline
            series={[
              { data: data.latencyP50, color: 'var(--green)', fillOpacity: 0.05 },
              { data: data.latencyP95, color: 'var(--yellow)', fillOpacity: 0.05 },
              { data: data.latencyP99, color: 'var(--red)', fillOpacity: 0.08 },
            ]}
          />
        </ChartCard>

        {/* Error Rate */}
        <ChartCard
          title="Error Rate"
          value={`${currentError.toFixed(2)}%`}
          valueColor={errorColor}
        >
          <Sparkline data={data.errorRate} color={errorColor} fillOpacity={0.2} />
        </ChartCard>
      </div>

      {/* Row 2: 2 charts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
        }}
      >
        {/* Cost */}
        <ChartCard
          title="Daily Electricity Cost"
          value={`$${currentCost.toFixed(2)}`}
          valueColor="var(--yellow)"
        >
          <MultiSparkline
            series={[
              { data: data.cost, color: 'var(--yellow)', fillOpacity: 0.18 },
              {
                data: data.cost.map((v) => v * 0.6),
                color: 'var(--teal)',
                fillOpacity: 0.1,
              },
            ]}
          />
        </ChartCard>

        {/* VRAM Utilization */}
        <ChartCard
          title="VRAM Utilization"
          value={`${currentVram.toFixed(1)}%`}
          valueColor="var(--cyan)"
        >
          <MultiSparkline
            series={[
              { data: data.vram, color: 'var(--cyan)', fillOpacity: 0.25 },
              {
                data: data.vram.map((v) => v * 0.85),
                color: 'var(--purple)',
                fillOpacity: 0.15,
              },
            ]}
          />
        </ChartCard>
      </div>

      {/* Legend row */}
      <div
        className="flex flex-wrap gap-4"
        style={{ padding: '4px 0', fontSize: 10, color: 'var(--text-muted)' }}
      >
        <span>
          <span style={{ color: 'var(--green)', fontFamily: monoFont }}>---</span> p50
        </span>
        <span>
          <span style={{ color: 'var(--yellow)', fontFamily: monoFont }}>---</span> p95
        </span>
        <span>
          <span style={{ color: 'var(--red)', fontFamily: monoFont }}>---</span> p99
        </span>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
          Mock data — connect cluster for live metrics
        </span>
      </div>
    </div>
  );
}
