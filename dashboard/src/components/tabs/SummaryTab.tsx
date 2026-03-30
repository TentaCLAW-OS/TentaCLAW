import { useClusterStore } from '@/stores/cluster';
import { StatPill } from '@/components/cards/StatPill';
import { NodeCard } from '@/components/cards/NodeCard';
import { VramBar } from '@/components/ui/VramBar';
import { formatToks, formatWatts } from '@/lib/format';
import type { ClusterNode } from '@/lib/types';

function getNodeSortOrder(node: ClusterNode): number {
  if (node.status === 'online') {
    const hasHotGpu = (node.latest_stats?.gpus ?? []).some((g) => g.temperatureC > 75);
    return hasHotGpu ? 1 : 0;
  }
  return 2;
}

export function SummaryTab() {
  const { nodes, summary, health, power } = useClusterStore();

  // Compute totals from nodes when summary is null
  const onlineNodes = nodes.filter((n) => n.status === 'online');
  const offlineNodes = nodes.filter((n) => n.status !== 'online');

  const totalToksPerSec = nodes.reduce(
    (acc, n) => acc + (n.latest_stats?.toks_per_sec ?? 0),
    0,
  );
  const totalGpus = summary?.total_gpus ?? nodes.reduce((acc, n) => acc + n.gpu_count, 0);
  const totalVramMb =
    summary?.total_vram_mb ??
    nodes.reduce((acc, n) => {
      const gpus = n.latest_stats?.gpus ?? [];
      return acc + gpus.reduce((g, gpu) => g + gpu.vramTotalMb, 0);
    }, 0);
  const usedVramMb = nodes.reduce((acc, n) => {
    const gpus = n.latest_stats?.gpus ?? [];
    return acc + gpus.reduce((g, gpu) => g + gpu.vramUsedMb, 0);
  }, 0);

  const onlineCount = summary?.online_nodes ?? onlineNodes.length;
  const offlineCount = summary?.offline_nodes ?? offlineNodes.length;
  const totalToks = summary ? totalToksPerSec : totalToksPerSec;

  // Power display
  const totalWatts = power?.total_watts ?? 0;
  const dailyCost = power?.daily_cost_usd ?? 0;
  const powerDisplay =
    totalWatts >= 1000
      ? `${(totalWatts / 1000).toFixed(1)}`
      : `${totalWatts}`;
  const powerUnit = totalWatts >= 1000 ? 'kW' : 'W';

  // Requests
  const requests24h = summary?.inference_requests_24h ?? 0;
  const reqsPerSec = requests24h > 0 ? (requests24h / 86400).toFixed(1) : '0';

  // Sort nodes: online first, then warning, then offline
  const sortedNodes = [...nodes].sort((a, b) => getNodeSortOrder(a) - getNodeSortOrder(b));

  return (
    <div className="flex flex-col gap-5">
      {/* Stat pills row */}
      <div className="flex flex-wrap gap-3">
        <StatPill
          label="Nodes"
          value={onlineCount}
          unit="online"
          delay={0}
          subtext={offlineCount > 0 ? `${offlineCount} offline` : undefined}
        />
        <StatPill label="GPUs" value={totalGpus} delay={0.05} />
        <StatPill label="VRAM" value={`${(totalVramMb / 1024).toFixed(0)}`} unit="GB" delay={0.1}>
          <VramBar used={usedVramMb} total={totalVramMb} />
        </StatPill>
        <StatPill
          label="Throughput"
          value={formatToks(totalToks)}
          color="var(--cyan)"
          unit="tok/s"
          delay={0.15}
        />
        <StatPill
          label="Power"
          value={powerDisplay}
          unit={powerUnit}
          color="var(--yellow)"
          subtext={dailyCost > 0 ? `$${dailyCost.toFixed(2)}/day` : undefined}
          delay={0.2}
        />
        <StatPill
          label="Health"
          value={health?.grade ?? '--'}
          color={
            health?.grade === 'A'
              ? 'var(--green)'
              : health?.grade === 'F'
                ? 'var(--red)'
                : 'var(--text-primary)'
          }
          subtext={health ? `${health.score}/100` : undefined}
          delay={0.25}
        />
        <StatPill
          label="Requests"
          value={reqsPerSec}
          unit="req/s"
          subtext="today"
          delay={0.3}
        />
      </div>

      {/* Nodes section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h3
            className="text-xs font-semibold shrink-0"
            style={{
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Nodes
          </h3>
          <div
            className="flex-1"
            style={{
              height: 1,
              background: 'linear-gradient(90deg, var(--border), transparent)',
            }}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedNodes.map((node, i) => (
            <NodeCard key={node.id} node={node} index={i} />
          ))}
          {sortedNodes.length === 0 && (
            <p
              className="col-span-2 text-center py-12"
              style={{ color: 'var(--text-muted)', fontSize: 12 }}
            >
              No nodes registered yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
