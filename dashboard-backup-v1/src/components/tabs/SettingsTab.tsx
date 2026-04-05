import { useState, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useThemeStore } from '@/stores/theme';
import { THEMES } from '@/lib/themes';

/* ── shared style constants ── */

const monoFont = "'JetBrains Mono', monospace";

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  marginBottom: 12,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  backdropFilter: 'blur(12px)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '16px 20px',
  position: 'relative',
  overflow: 'hidden',
};

const accentLine: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
  opacity: 0.5,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  minWidth: 130,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontFamily: monoFont,
  fontSize: 12,
  padding: '6px 10px',
  outline: 'none',
  width: '100%',
  maxWidth: 280,
  transition: 'all 0.2s ease',
};

const inputFocusStyle: React.CSSProperties = {
  borderColor: 'rgba(0,255,255,0.4)',
  boxShadow: '0 0 6px rgba(0,255,255,0.15)',
};

const staticValueStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: monoFont,
  color: 'var(--text-primary)',
};

const headerCellStyle: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  padding: '8px 10px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tableCellStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: monoFont,
  color: 'var(--text-primary)',
  padding: '7px 10px',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
};

/* ── notification channel data ── */

interface NotificationChannel {
  name: string;
  type: 'discord' | 'telegram' | 'email';
  target: string;
  active: boolean;
}

const MOCK_CHANNELS: NotificationChannel[] = [
  { name: 'Discord Alerts', type: 'discord', target: '#gpu-alerts', active: true },
  { name: 'Telegram Admin', type: 'telegram', target: '@admin_bot', active: true },
  { name: 'Email Reports', type: 'email', target: 'admin@tentaclaw.io', active: false },
];

/* ── Row hover helpers removed — using CSS className instead ── */

/* ── FocusInput: input with focus glow ── */

function FocusInput({
  value,
  onChange,
  placeholder,
  suffix,
  style: extraStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  style?: React.CSSProperties;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex items-center gap-2" style={{ maxWidth: 320 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...inputStyle,
          ...(focused ? inputFocusStyle : {}),
          ...extraStyle,
        }}
      />
      {suffix && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ── OutlineButton ── */

function OutlineButton({
  children,
  color = 'var(--cyan)',
  onClick,
}: {
  children: React.ReactNode;
  color?: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}11` : 'transparent',
        border: `1px solid ${color}`,
        borderRadius: 6,
        color,
        fontSize: 11,
        fontWeight: 500,
        padding: '6px 14px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? `0 0 8px ${color}22` : 'none',
      }}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   SettingsTab — cluster settings view
   ══════════════════════════════════════════════════════ */

export function SettingsTab() {
  const { nodes, summary } = useClusterStore();
  const { activeThemeId, setTheme } = useThemeStore();

  /* Local form state */
  const [clusterName, setClusterName] = useState('TentaCLAW Cluster');
  const [electricityRate, setElectricityRate] = useState('0.12');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetThreshold, setBudgetThreshold] = useState('80');

  /* Notification channels state */
  const [channels, setChannels] = useState<NotificationChannel[]>(MOCK_CHANNELS);
  const [addingChannel, setAddingChannel] = useState(false);
  const [newChName, setNewChName] = useState('');
  const [newChType, setNewChType] = useState<'discord' | 'telegram' | 'email'>('discord');
  const [newChTarget, setNewChTarget] = useState('');

  const handleAddChannel = useCallback(() => {
    if (!addingChannel) { setAddingChannel(true); return; }
    if (!newChName.trim() || !newChTarget.trim()) return;
    setChannels(prev => [...prev, { name: newChName, type: newChType, target: newChTarget, active: true }]);
    setAddingChannel(false);
    setNewChName('');
    setNewChTarget('');
  }, [addingChannel, newChName, newChType, newChTarget]);

  const handleToggleChannel = useCallback((idx: number) => {
    setChannels(prev => prev.map((ch, i) => i === idx ? { ...ch, active: !ch.active } : ch));
  }, []);

  const handleDeleteChannel = useCallback((idx: number) => {
    setChannels(prev => prev.filter((_, i) => i !== idx));
  }, []);

  /* Derive some display values */
  const onlineCount = summary?.online_nodes ?? nodes.filter((n) => n.status === 'online').length;
  const totalNodes = summary?.total_nodes ?? nodes.length;

  /* Compute rough uptime from first online node */
  const firstOnline = nodes.find((n) => n.status === 'online');
  const uptimeSecs = firstOnline?.latest_stats?.uptime_secs ?? 0;
  const uptimeDisplay =
    uptimeSecs > 0
      ? `${Math.floor(uptimeSecs / 86400)}d ${Math.floor((uptimeSecs % 86400) / 3600)}h ${Math.floor((uptimeSecs % 3600) / 60)}m`
      : '--';

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'slideUp 0.4s ease-out both' }}>
      {/* ────────── Section 1: Cluster Info ────────── */}
      <div style={cardStyle}>
        <div style={accentLine} />
        <h3 style={sectionHeadingStyle}>Cluster Info</h3>

        <div className="flex flex-col gap-3">
          {/* Cluster Name */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Cluster Name</span>
            <FocusInput value={clusterName} onChange={setClusterName} />
          </div>

          {/* Gateway Version */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Gateway Version</span>
            <span style={staticValueStyle}>v0.3.0</span>
          </div>

          {/* Gateway Uptime */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Gateway Uptime</span>
            <span style={staticValueStyle}>{uptimeDisplay}</span>
          </div>

          {/* Database Stats */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Database Stats</span>
            <span style={{ ...staticValueStyle, color: 'var(--text-secondary)' }}>
              {totalNodes} node{totalNodes !== 1 ? 's' : ''} registered
              {' \u00B7 '}
              {onlineCount} online
              {summary?.total_gpus != null && (
                <>
                  {' \u00B7 '}
                  {summary.total_gpus} GPU{summary.total_gpus !== 1 ? 's' : ''}
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ────────── Section 2: Notifications ────────── */}
      <div style={cardStyle}>
        <div style={accentLine} />
        <h3 style={sectionHeadingStyle}>Notifications</h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headerCellStyle}>Channel</th>
                <th style={headerCellStyle}>Type</th>
                <th style={headerCellStyle}>Target</th>
                <th style={headerCellStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch, i) => (
                <tr
                  key={i}
                  className="hover:bg-[rgba(0,255,255,0.02)] transition-colors"
                >
                  <td style={{ ...tableCellStyle, color: 'var(--cyan)', fontWeight: 500 }}>
                    {ch.name}
                  </td>
                  <td style={{ ...tableCellStyle, color: 'var(--text-secondary)' }}>
                    {ch.type}
                  </td>
                  <td style={{ ...tableCellStyle, color: 'var(--text-secondary)' }}>
                    {ch.target}
                  </td>
                  <td style={tableCellStyle}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => handleToggleChannel(i)}
                      onKeyDown={(e) => e.key === 'Enter' && handleToggleChannel(i)}
                      style={{ cursor: 'pointer', color: ch.active ? 'var(--green)' : 'var(--text-muted)' }}
                    >
                      {ch.active ? 'Active \u2713' : 'Disabled'}
                    </span>
                    {' '}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => handleDeleteChannel(i)}
                      onKeyDown={(e) => e.key === 'Enter' && handleDeleteChannel(i)}
                      style={{ cursor: 'pointer', color: 'var(--red)', fontSize: 10, marginLeft: 8 }}
                    >
                      \u2716
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {addingChannel && (
          <div className="flex items-center gap-2 mt-2" style={{ padding: '8px', borderRadius: '6px', background: 'var(--bg-card)' }}>
            <input value={newChName} onChange={(e) => setNewChName(e.target.value)} placeholder="Name" style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '12px' }} />
            <select title="Channel type" value={newChType} onChange={(e) => setNewChType(e.target.value as 'discord' | 'telegram' | 'email')} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '12px' }}>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
            </select>
            <input value={newChTarget} onChange={(e) => setNewChTarget(e.target.value)} placeholder="Target (#channel, @bot, email)" style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '12px' }} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <OutlineButton onClick={handleAddChannel}>{addingChannel ? 'Save Channel' : '+ Add Channel'}</OutlineButton>
          {addingChannel && <OutlineButton onClick={() => setAddingChannel(false)}>Cancel</OutlineButton>}
        </div>
      </div>

      {/* ────────── Section 3: Power & Cost Configuration ────────── */}
      <div style={cardStyle}>
        <div style={accentLine} />
        <h3 style={sectionHeadingStyle}>Power &amp; Cost Configuration</h3>

        <div className="flex flex-col gap-3">
          {/* Electricity Rate */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Electricity Rate</span>
            <FocusInput
              value={electricityRate}
              onChange={setElectricityRate}
              suffix="$/kWh"
              style={{ maxWidth: 120 }}
            />
          </div>

          {/* Budget Limit */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Budget Limit</span>
            <FocusInput
              value={budgetLimit}
              onChange={setBudgetLimit}
              placeholder="Optional"
              suffix="$/month"
              style={{ maxWidth: 120 }}
            />
          </div>

          {/* Budget Alert Threshold */}
          <div className="flex items-center gap-3">
            <span style={labelStyle}>Alert Threshold</span>
            <FocusInput
              value={budgetThreshold}
              onChange={setBudgetThreshold}
              suffix="%"
              style={{ maxWidth: 80 }}
            />
          </div>
        </div>
      </div>

      {/* ────────── Section 3b: Appearance ────────── */}
      <div style={cardStyle}>
        <div style={accentLine} />
        <h3 style={sectionHeadingStyle}>Appearance</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 10,
          }}
        >
          {THEMES.map((theme) => {
            const active = theme.id === activeThemeId;
            const accent = theme.colors['--cyan'] || theme.colors['--purple'] || '#0ff';
            const bg = theme.colors['--bg-base'] || '#0e121c';
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                style={{
                  background: bg,
                  border: `2px solid ${active ? accent : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  boxShadow: active ? `0 0 10px ${accent}44` : 'none',
                  position: 'relative',
                }}
              >
                {/* Color swatches */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {(['--cyan', '--purple', '--green', '--yellow'] as const).map((k) => (
                    <div
                      key={k}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: theme.colors[k] || 'transparent',
                        opacity: theme.colors[k] ? 1 : 0,
                      }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: accent, marginBottom: 2 }}>
                  {theme.name}
                </div>
                {active && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 8,
                      fontSize: 9,
                      color: accent,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    active
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ────────── Section 4: Cluster Operations ────────── */}
      <div
        style={{
          ...cardStyle,
          borderColor: 'rgba(255,70,70,0.2)',
        }}
      >
        {/* Red accent line instead of cyan/purple */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--red)',
            opacity: 0.6,
          }}
        />
        <h3 style={{ ...sectionHeadingStyle, color: 'var(--red)' }}>
          Cluster Operations
        </h3>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 14,
            marginTop: -4,
          }}
        >
          Dangerous actions &mdash; use with caution
        </p>

        <div className="flex flex-wrap gap-3">
          <OutlineButton color="var(--text-secondary)">Export Cluster Config</OutlineButton>
          <OutlineButton color="var(--text-secondary)">Import Cluster Config</OutlineButton>
          <OutlineButton color="var(--red)">Rotate Cluster Secret</OutlineButton>
          <OutlineButton color="var(--red)">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              style={{ flexShrink: 0 }}
            >
              <path
                d="M8 1.5L1 14h14L8 1.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.75" fill="currentColor" />
            </svg>
            Reboot All Nodes
          </OutlineButton>
        </div>
      </div>
    </div>
  );
}
