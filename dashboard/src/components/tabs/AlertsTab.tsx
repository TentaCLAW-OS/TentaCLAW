import { useState, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { api } from '@/lib/api';
import { formatTimeAgo } from '@/lib/format';

/* ── Alert rule mock data ── */
interface AlertRule {
  id: string;
  metric: string;
  operator: string;
  threshold: string;
  severity: 'warning' | 'critical';
  enabled: boolean;
}

const defaultRules: AlertRule[] = [
  { id: 'r1', metric: 'gpu_temp', operator: '>', threshold: '80\u00B0C', severity: 'warning', enabled: true },
  { id: 'r2', metric: 'gpu_temp', operator: '>', threshold: '90\u00B0C', severity: 'critical', enabled: true },
  { id: 'r3', metric: 'vram_pct', operator: '>', threshold: '95%', severity: 'warning', enabled: true },
  { id: 'r4', metric: 'cpu_usage', operator: '>', threshold: '90%', severity: 'warning', enabled: false },
  { id: 'r5', metric: 'node_offline', operator: '=', threshold: 'true', severity: 'critical', enabled: true },
];

/* ── Shared inline styles ── */
const monoFont = "'JetBrains Mono', monospace";

const severityColors: Record<'warning' | 'critical', string> = {
  warning: 'var(--yellow)',
  critical: 'var(--red)',
};

const severityIcons: Record<'warning' | 'critical', string> = {
  warning: '\u26A0',
  critical: '\uD83D\uDD34',
};

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

/* ── Toggle switch ── */
function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: 32,
        height: 16,
        borderRadius: 8,
        border: 'none',
        background: on ? 'var(--cyan)' : 'rgba(255,255,255,0.12)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: on ? '#fff' : 'rgba(255,255,255,0.4)',
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          transition: 'left 0.2s, background 0.2s',
        }}
      />
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   AlertsTab — active alerts + alert rules management
   ══════════════════════════════════════════════════════ */
export function AlertsTab() {
  const alerts = useClusterStore((s) => s.alerts);
  const nodes = useClusterStore((s) => s.nodes);
  const [ackingIds, setAckingIds] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<AlertRule[]>(defaultRules);

  /* resolve node hostname from node_id */
  const hostnameFor = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      return node?.hostname ?? nodeId;
    },
    [nodes],
  );

  /* acknowledge handler */
  const handleAck = useCallback(async (alertId: string) => {
    setAckingIds((prev) => new Set(prev).add(alertId));
    try {
      await api.acknowledgeAlert(alertId);
      /* optimistic: update store */
      useClusterStore.setState((state) => ({
        alerts: state.alerts.map((a) =>
          a.id === alertId ? { ...a, acknowledged: true } : a,
        ),
      }));
    } catch {
      /* revert on failure — alert stays unacknowledged */
    } finally {
      setAckingIds((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
    }
  }, []);

  /* toggle rule enabled */
  const toggleRule = useCallback((ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    );
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ── Section 1: Active Alerts ── */}
      <section>
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            marginBottom: 12,
          }}
        >
          Active Alerts
        </h3>

        {alerts.length === 0 ? (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            No active alerts &mdash; your cluster is healthy {'\uD83D\uDC19'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((alert) => {
              const isAcking = ackingIds.has(alert.id);
              const color = severityColors[alert.severity];
              const icon = severityIcons[alert.severity];

              return (
                <div
                  key={alert.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 8,
                    borderLeft: `3px solid ${color}`,
                    background: alert.acknowledged
                      ? 'rgba(255,255,255,0.02)'
                      : 'rgba(255,255,255,0.05)',
                    opacity: alert.acknowledged ? 0.55 : 1,
                    transition: 'opacity 0.3s, background 0.3s',
                  }}
                >
                  {/* severity icon */}
                  <span style={{ fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>
                    {icon}
                  </span>

                  {/* content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginBottom: 3,
                      }}
                    >
                      {alert.message}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px 14px',
                        fontSize: 10,
                        fontFamily: monoFont,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span style={{ color: 'var(--cyan)' }}>
                        {hostnameFor(alert.node_id)}
                      </span>
                      <span>
                        value: <strong style={{ color: color }}>{alert.value}</strong>
                        {' / '}
                        threshold: {alert.threshold}
                      </span>
                      <span>{formatTimeAgo(alert.created_at)}</span>
                    </div>
                  </div>

                  {/* acknowledge button */}
                  {!alert.acknowledged && (
                    <button
                      type="button"
                      onClick={() => handleAck(alert.id)}
                      disabled={isAcking}
                      style={{
                        flexShrink: 0,
                        padding: '4px 10px',
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: monoFont,
                        color: 'var(--cyan)',
                        background: 'rgba(0,255,255,0.08)',
                        border: '1px solid rgba(0,255,255,0.25)',
                        borderRadius: 4,
                        cursor: isAcking ? 'wait' : 'pointer',
                        opacity: isAcking ? 0.5 : 1,
                        transition: 'opacity 0.2s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isAcking ? 'Ack\u2026' : 'Acknowledge'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 2: Alert Rules ── */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h3
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
            }}
          >
            Alert Rules
          </h3>
          <button
            type="button"
            style={{
              padding: '5px 12px',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: monoFont,
              color: 'var(--cyan)',
              background: 'transparent',
              border: '1px solid var(--cyan)',
              borderRadius: 4,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add Rule
          </button>
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
                <th style={headerStyle}>Metric</th>
                <th style={headerStyle}>Operator</th>
                <th style={headerStyle}>Threshold</th>
                <th style={headerStyle}>Severity</th>
                <th style={headerStyle}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr
                  key={rule.id}
                  style={{
                    background: 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0,255,255,0.02)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <td style={{ ...cellStyle, color: 'var(--cyan)', fontWeight: 500 }}>
                    {rule.metric}
                  </td>
                  <td style={{ ...cellStyle, color: 'var(--text-secondary)' }}>
                    {rule.operator}
                  </td>
                  <td style={cellStyle}>{rule.threshold}</td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        borderRadius: 3,
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: severityColors[rule.severity],
                        background:
                          rule.severity === 'critical'
                            ? 'rgba(255,60,60,0.12)'
                            : 'rgba(255,200,0,0.12)',
                      }}
                    >
                      {rule.severity}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <ToggleSwitch
                      on={rule.enabled}
                      onToggle={() => toggleRule(rule.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
