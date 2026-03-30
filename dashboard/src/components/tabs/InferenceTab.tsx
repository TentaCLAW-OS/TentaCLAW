import { useMemo } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { Sparkline } from '@/components/ui/Sparkline';
import { CLAWtopusTips } from '@/components/ui/CLAWtopusTips';
import { emptyStateTips } from '@/lib/personality';

/* ---------- data ---------- */

const MOCK_THROUGHPUT_HISTORY: number[] = Array.from({ length: 50 }, (_, i) => {
  const base = 1200 + Math.sin(i / 5) * 400;
  return Math.round(base + (Math.random() - 0.5) * 300);
});

interface InferenceRequest {
  time: string;
  model: string;
  tokens: number;
  latencyMs: number;
  node: string;
  ok: boolean;
}

const MOCK_REQUESTS: InferenceRequest[] = [
  { time: '12:27:04', model: 'llama3.1:70b', tokens: 342, latencyMs: 1204, node: 'pve-gpu-01', ok: true },
  { time: '12:27:02', model: 'qwen2.5:32b', tokens: 128, latencyMs: 456, node: 'pve-gpu-01', ok: true },
  { time: '12:26:58', model: 'deepseek-v3:671b', tokens: 1024, latencyMs: 3891, node: 'pve-gpu-02', ok: true },
  { time: '12:26:55', model: 'mixtral:8x7b', tokens: 256, latencyMs: 892, node: 'rack-node-04', ok: true },
  { time: '12:26:51', model: 'llama3.1:70b', tokens: 64, latencyMs: 312, node: 'pve-gpu-01', ok: false },
];

/* ---------- helpers ---------- */

function latencyColor(ms: number): string {
  if (ms < 500) return 'var(--green)';
  if (ms < 2000) return 'var(--yellow)';
  return 'var(--red)';
}

function errorRateColor(pct: number): string {
  if (pct < 1) return 'var(--green)';
  if (pct < 5) return 'var(--yellow)';
  return 'var(--red)';
}

/* ---------- component ---------- */

export function InferenceTab() {
  const { nodes, summary } = useClusterStore();

  /* Compute live stats from cluster data */
  const stats = useMemo(() => {
    const onlineNodes = nodes.filter((n) => n.status === 'online');

    const totalToksPerSec = onlineNodes.reduce(
      (acc, n) => acc + (n.latest_stats?.toks_per_sec ?? 0),
      0,
    );

    const latencies = onlineNodes
      .map((n) => n.latest_stats?.inference?.avg_latency_ms ?? 0)
      .filter((l) => l > 0);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;

    const requests24h = summary?.inference_requests_24h ?? 0;
    const reqsPerSec = requests24h > 0 ? (requests24h / 86400).toFixed(1) : '0';

    const errorRate = summary?.error_rate_pct ?? 0;

    const cacheHitRate = 72.4;

    return { totalToksPerSec, avgLatency, reqsPerSec, errorRate, cacheHitRate, hasActivity: onlineNodes.length > 0 };
  }, [nodes, summary]);

  // Empty state when no nodes are online / no inference activity
  if (!stats.hasActivity) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ animation: 'slideUp 0.4s ease-out both' }}>
        <span className="text-2xl opacity-20">&#x26A1;</span>
        <CLAWtopusTips tip={emptyStateTips.inference} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'slideUp 0.4s ease-out both' }}>
      {/* ---- Top row: 4 stat cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Requests/s"
          value={stats.reqsPerSec}
          unit="req/s"
        />
        <StatCard
          label="Avg Latency"
          value={stats.avgLatency > 0 ? stats.avgLatency.toLocaleString() : '--'}
          unit="ms"
          valueColor={stats.avgLatency > 0 ? latencyColor(stats.avgLatency) : undefined}
        />
        <StatCard
          label="Error Rate"
          value={stats.errorRate.toFixed(1)}
          unit="%"
          valueColor={errorRateColor(stats.errorRate)}
        />
        <StatCard
          label="Cache Hit Rate"
          value={stats.cacheHitRate.toFixed(1)}
          unit="%"
          valueColor="var(--cyan)"
        />
      </div>

      {/* ---- Middle: Throughput sparkline ---- */}
      <div
        className="rounded-lg px-4 py-3"
        style={{
          background: 'var(--bg-card)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
        }}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Cluster Throughput (tok/s)
        </h3>
        <div style={{ height: 80 }}>
          <Sparkline
            data={MOCK_THROUGHPUT_HISTORY}
            color="var(--cyan)"
            fillOpacity={0.2}
          />
        </div>
      </div>

      {/* ---- Bottom: Recent requests table ---- */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
        }}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3 px-4 pt-3" style={{ color: 'var(--text-muted)' }}>
          Recent Requests
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <th className="text-left font-medium px-4 py-2">Time</th>
                <th className="text-left font-medium px-4 py-2">Model</th>
                <th className="text-right font-medium px-4 py-2">Tokens</th>
                <th className="text-right font-medium px-4 py-2">Latency</th>
                <th className="text-left font-medium px-4 py-2">Node</th>
                <th className="text-center font-medium px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_REQUESTS.map((req, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom:
                      i < MOCK_REQUESTS.length - 1
                        ? '1px solid var(--border)'
                        : undefined,
                  }}
                >
                  <td
                    className="px-4 py-2"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {req.time}
                  </td>
                  <td
                    className="px-4 py-2"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--text-primary)',
                    }}
                  >
                    {req.model}
                  </td>
                  <td
                    className="px-4 py-2 text-right"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--text-primary)',
                    }}
                  >
                    {req.tokens.toLocaleString()}
                  </td>
                  <td
                    className="px-4 py-2 text-right"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: latencyColor(req.latencyMs),
                    }}
                  >
                    {req.latencyMs.toLocaleString()}ms
                  </td>
                  <td
                    className="px-4 py-2"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {req.node}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {req.ok ? (
                      <span style={{ color: 'var(--green)' }}>&#10003;</span>
                    ) : (
                      <span style={{ color: 'var(--red)' }}>&#10007;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- StatCard sub-component ---------- */

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  valueColor?: string;
}

function StatCard({ label, value, unit, valueColor }: StatCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded-lg px-4 py-3 flex flex-col gap-1"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 1,
          background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
          opacity: 0.5,
        }}
      />

      <span
        style={{
          fontSize: 8,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>

      <div className="flex items-baseline gap-1.5">
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: valueColor ?? 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
