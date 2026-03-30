import { useState, useCallback } from 'react';

/* ── Types ── */
type ApiKeyScope = 'inference' | 'admin' | 'read';
type ApiKeyStatus = 'enabled' | 'disabled';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scope: ApiKeyScope;
  rateLimit: string;
  createdAt: string;
  lastUsed: string;
  status: ApiKeyStatus;
}

/* ── Mock data ── */
const MOCK_API_KEYS: ApiKey[] = [
  {
    id: '1',
    name: 'Production API',
    keyPrefix: 'tc_****...a3f2',
    scope: 'admin',
    rateLimit: '1000 rpm',
    createdAt: '2026-02-14',
    lastUsed: '2 minutes ago',
    status: 'enabled',
  },
  {
    id: '2',
    name: 'Dev Testing',
    keyPrefix: 'tc_****...7b01',
    scope: 'inference',
    rateLimit: '500 rpm',
    createdAt: '2026-03-01',
    lastUsed: '4 hours ago',
    status: 'enabled',
  },
  {
    id: '3',
    name: 'Monitoring Read-Only',
    keyPrefix: 'tc_****...e9c4',
    scope: 'read',
    rateLimit: '200 rpm',
    createdAt: '2026-03-18',
    lastUsed: '1 day ago',
    status: 'enabled',
  },
  {
    id: '4',
    name: 'Legacy Worker Key',
    keyPrefix: 'tc_****...02af',
    scope: 'inference',
    rateLimit: '100 rpm',
    createdAt: '2025-12-03',
    lastUsed: '31 days ago',
    status: 'disabled',
  },
];

/* ── Shared inline styles (matches GpusTab pattern) ── */
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

/* ── Scope badge colour map ── */
const scopeColors: Record<ApiKeyScope, { bg: string; border: string; text: string }> = {
  inference: {
    bg: 'rgba(0,255,255,0.08)',
    border: 'rgba(0,255,255,0.25)',
    text: '#00ffff',
  },
  admin: {
    bg: 'rgba(140,0,200,0.1)',
    border: 'rgba(140,0,200,0.3)',
    text: '#b44ddf',
  },
  read: {
    bg: 'rgba(0,140,140,0.1)',
    border: 'rgba(0,140,140,0.3)',
    text: '#00c8c8',
  },
};

/* ── Row hover helpers (matches GpusTab) ── */
function handleRowEnter(e: React.MouseEvent<HTMLTableRowElement>) {
  e.currentTarget.style.background = 'rgba(0,255,255,0.02)';
}
function handleRowLeave(e: React.MouseEvent<HTMLTableRowElement>) {
  e.currentTarget.style.background = 'transparent';
}

/* ── Scope badge ── */
function ScopeBadge({ scope }: { scope: ApiKeyScope }) {
  const c = scopeColors[scope];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 9,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {scope}
    </span>
  );
}

/* ── Status indicator ── */
function StatusIndicator({ status }: { status: ApiKeyStatus }) {
  const isEnabled = status === 'enabled';
  const dotColor = isEnabled ? '#00ff88' : '#444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: isEnabled ? `0 0 4px ${dotColor}, 0 0 8px ${dotColor}` : 'none',
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: isEnabled ? 'var(--text-secondary)' : 'var(--text-muted)',
        }}
      >
        {status}
      </span>
    </span>
  );
}

/* ── Security stat card (glassmorphism like StatPill) ── */
function SecurityStatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[10px] px-4 py-3 flex flex-col gap-1"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        minWidth: 140,
        flex: '1 1 0',
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
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontFamily: monoFont,
          color: color ?? 'var(--text-primary)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Action button ── */
function ActionButton({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: 'cyan' | 'red';
  onClick: () => void;
}) {
  const borderColor =
    variant === 'cyan' ? 'rgba(0,255,255,0.5)' : 'rgba(255,70,70,0.5)';
  const hoverBorderColor =
    variant === 'cyan' ? 'rgba(0,255,255,0.85)' : 'rgba(255,70,70,0.85)';
  const textColor = variant === 'cyan' ? '#00ffff' : '#ff4646';

  const handleEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = hoverBorderColor;
      e.currentTarget.style.background =
        variant === 'cyan'
          ? 'rgba(0,255,255,0.06)'
          : 'rgba(255,70,70,0.06)';
      e.currentTarget.style.boxShadow =
        variant === 'cyan'
          ? '0 0 10px rgba(0,255,255,0.15)'
          : '0 0 10px rgba(255,70,70,0.15)';
    },
    [hoverBorderColor, variant],
  );

  const handleLeave = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = borderColor;
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.boxShadow = 'none';
    },
    [borderColor],
  );

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        background: 'transparent',
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        color: textColor,
        fontSize: 11,
        fontWeight: 600,
        padding: '6px 14px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   SecurityTab — API key management & cluster security
   ══════════════════════════════════════════════════════ */
export function SecurityTab() {
  const [keys] = useState<ApiKey[]>(MOCK_API_KEYS);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const enabledCount = keys.filter((k) => k.status === 'enabled').length;

  const handleCreateKey = useCallback(() => {
    // TODO: open create-key modal
  }, []);

  const handleRotateSecret = useCallback(() => {
    if (!confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    // TODO: call rotate API
    setConfirmRotate(false);
  }, [confirmRotate]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Section 1: API Keys ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3
            className="text-xs font-semibold"
            style={{
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            API Keys
          </h3>
          <div className="flex items-center gap-2">
            <ActionButton
              label="Create API Key"
              variant="cyan"
              onClick={handleCreateKey}
            />
            <ActionButton
              label={confirmRotate ? 'Confirm Rotate?' : 'Rotate Cluster Secret'}
              variant="red"
              onClick={handleRotateSecret}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              background: 'transparent',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Key</th>
                <th style={headerStyle}>Scope</th>
                <th style={headerStyle}>Rate Limit</th>
                <th style={headerStyle}>Created</th>
                <th style={headerStyle}>Last Used</th>
                <th style={headerStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  style={{
                    background: 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={handleRowEnter}
                  onMouseLeave={handleRowLeave}
                >
                  {/* Name */}
                  <td
                    style={{
                      ...cellStyle,
                      fontFamily: 'inherit',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {key.name}
                  </td>

                  {/* Key prefix */}
                  <td
                    style={{
                      ...cellStyle,
                      color: 'var(--text-dim)',
                    }}
                  >
                    {key.keyPrefix}
                  </td>

                  {/* Scope badge */}
                  <td style={cellStyle}>
                    <ScopeBadge scope={key.scope} />
                  </td>

                  {/* Rate limit */}
                  <td style={cellStyle}>{key.rateLimit}</td>

                  {/* Created */}
                  <td
                    style={{
                      ...cellStyle,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {key.createdAt}
                  </td>

                  {/* Last used */}
                  <td
                    style={{
                      ...cellStyle,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {key.lastUsed}
                  </td>

                  {/* Status */}
                  <td style={cellStyle}>
                    <StatusIndicator status={key.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Cluster Security Status ── */}
      <div className="flex flex-col gap-3">
        <h3
          className="text-xs font-semibold"
          style={{
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Cluster Security Status
        </h3>

        <div className="flex flex-wrap gap-3">
          <SecurityStatCard
            label="Cluster Secret"
            value="Set \u2713"
            color="var(--green)"
          />
          <SecurityStatCard
            label="mTLS"
            value="Enabled \u2713"
            color="var(--green)"
          />
          <SecurityStatCard
            label="API Auth"
            value="Required \u2713"
            color="var(--green)"
          />
          <SecurityStatCard
            label="Total API Keys"
            value={String(enabledCount)}
          />
          <SecurityStatCard
            label="Failed Auth (24h)"
            value="12"
            color="var(--yellow)"
          />
        </div>
      </div>
    </div>
  );
}
