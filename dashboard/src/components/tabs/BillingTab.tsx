import { useClusterStore } from '@/stores/cluster';

/* ══════════════════════════════════════════════════════
   Tier definitions
   ══════════════════════════════════════════════════════ */

type LicenseTier = 'Community' | 'Pro' | 'Enterprise';

interface TierConfig {
  color: string;
  glow: boolean;
  features: string[];
  maxNodes: number;
}

const TIER_CONFIG: Record<LicenseTier, TierConfig> = {
  Community: {
    color: 'var(--teal)',
    glow: false,
    features: ['5 Nodes', 'Basic Monitoring', 'Community Support', 'REST API'],
    maxNodes: 5,
  },
  Pro: {
    color: 'var(--cyan)',
    glow: true,
    features: [
      '25 Nodes', 'Advanced Metrics', 'Priority Support', 'Flight Sheets',
      'Watchdog', 'SSE Streaming', 'Model Router',
    ],
    maxNodes: 25,
  },
  Enterprise: {
    color: 'var(--purple)',
    glow: true,
    features: [
      'Unlimited Nodes', 'Custom SLA', 'Dedicated Support', 'RBAC',
      'Audit Log', 'SSO / SAML', 'On-Prem Deploy', 'White-Label',
    ],
    maxNodes: Infinity,
  },
};

/* ══════════════════════════════════════════════════════
   Mock billing data
   ══════════════════════════════════════════════════════ */

const MOCK = {
  tier: 'Community' as LicenseTier,
  nodesUsed: 3,
  dailyCost: 4.80,
  monthlyCost: 146,
  costPerMTokens: 0.42,
  cloudSavings: 2340,
  tokensGenerated: 14_820_000,
  requestsServed: 48_712,
  gpuHours: 312.6,
};

/* ══════════════════════════════════════════════════════
   BillingTab — license status, cost intelligence, usage
   ══════════════════════════════════════════════════════ */

export function BillingTab() {
  const { nodes, power } = useClusterStore();

  const tier = MOCK.tier;
  const cfg = TIER_CONFIG[tier];
  const nodesUsed = nodes.length > 0 ? nodes.length : MOCK.nodesUsed;
  const dailyCost = power?.daily_cost_usd ?? MOCK.dailyCost;
  const monthlyCost = power?.monthly_cost_usd ?? MOCK.monthlyCost;

  const nodesPct = cfg.maxNodes === Infinity
    ? 0
    : Math.min((nodesUsed / cfg.maxNodes) * 100, 100);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Section 1: License Status ── */}
      <LicenseCard
        tier={tier}
        cfg={cfg}
        nodesUsed={nodesUsed}
        nodesPct={nodesPct}
      />

      {/* ── Section 2: Cost Intelligence ── */}
      <SectionHeading>Cost Intelligence</SectionHeading>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CostCard label="Daily Cost" value={`$${dailyCost.toFixed(2)}`} unit="/day" />
        <CostCard label="Monthly Cost" value={`$${monthlyCost}`} unit="/mo" />
        <CostCard
          label="Cost per M Tokens"
          value={`$${MOCK.costPerMTokens.toFixed(2)}`}
        />
        <CostCard
          label="Cloud Savings"
          value={`$${MOCK.cloudSavings.toLocaleString()}`}
          unit="/mo saved"
          subtext="vs OpenAI"
          valueColor="var(--green)"
          greenGlow
        />
      </div>

      {/* ── Section 3: Usage This Month ── */}
      <SectionHeading>Usage This Month</SectionHeading>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <UsageCard
          label="Tokens Generated"
          value={formatLargeNumber(MOCK.tokensGenerated)}
        />
        <UsageCard
          label="Requests Served"
          value={MOCK.requestsServed.toLocaleString()}
        />
        <UsageCard
          label="GPU Hours"
          value={MOCK.gpuHours.toFixed(1)}
          unit="hrs"
        />
      </div>
    </div>
  );
}

/* ── Section heading ── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs font-semibold"
      style={{
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </h3>
  );
}

/* ── License Card ── */

interface LicenseCardProps {
  tier: LicenseTier;
  cfg: TierConfig;
  nodesUsed: number;
  nodesPct: number;
}

function LicenseCard({ tier, cfg, nodesUsed, nodesPct }: LicenseCardProps) {
  const showUpgrade = tier === 'Community';

  return (
    <div
      className="relative overflow-hidden rounded-lg p-5 flex flex-col gap-4"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${cfg.color}`,
        borderTopWidth: 2,
        ...(cfg.glow
          ? { boxShadow: `0 0 20px ${cfg.color}33, 0 0 40px ${cfg.color}1a` }
          : {}),
      }}
    >
      {/* Top accent line — thicker, tier-colored */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 2,
          background: cfg.color,
          opacity: 0.9,
        }}
      />

      {/* Header row: badge + upgrade button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold"
            style={{
              background: `${cfg.color}1a`,
              color: cfg.color,
              border: `1px solid ${cfg.color}44`,
              letterSpacing: '0.04em',
              fontSize: 11,
            }}
          >
            {tier}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            License
          </span>
        </div>

        {showUpgrade && (
          <button
            type="button"
            className="rounded-md px-4 py-1.5 text-xs font-semibold"
            style={{
              background: 'linear-gradient(135deg, var(--cyan), var(--purple))',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.02em',
              transition: 'opacity 0.15s, transform 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      {/* Nodes usage */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Nodes
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-primary)',
            }}
          >
            {nodesUsed} / {cfg.maxNodes === Infinity ? '\u221E' : cfg.maxNodes} used
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="rounded-full overflow-hidden"
          style={{
            height: 6,
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: cfg.maxNodes === Infinity ? '5%' : `${Math.max(nodesPct, 2)}%`,
              background: `linear-gradient(90deg, ${cfg.color}, var(--cyan))`,
              transition: 'width 0.6s ease-out',
            }}
          />
        </div>
      </div>

      {/* Features */}
      <div className="flex flex-wrap gap-1.5">
        {cfg.features.map((feat) => (
          <span
            key={feat}
            className="rounded-full px-2.5 py-0.5"
            style={{
              fontSize: 9,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
            }}
          >
            {feat}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Cost Card ── */

interface CostCardProps {
  label: string;
  value: string;
  unit?: string;
  subtext?: string;
  valueColor?: string;
  greenGlow?: boolean;
}

function CostCard({ label, value, unit, subtext, valueColor, greenGlow }: CostCardProps) {
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

      <div className="flex items-baseline gap-1">
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: valueColor ?? 'var(--text-primary)',
            lineHeight: 1,
            ...(greenGlow
              ? {
                  textShadow: '0 0 12px rgba(0,255,136,0.5), 0 0 24px rgba(0,255,136,0.25)',
                }
              : {}),
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

      {subtext && (
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {subtext}
        </span>
      )}
    </div>
  );
}

/* ── Usage Card ── */

interface UsageCardProps {
  label: string;
  value: string;
  unit?: string;
}

function UsageCard({ label, value, unit }: UsageCardProps) {
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
            color: 'var(--text-primary)',
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

/* ── Helpers ── */

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
