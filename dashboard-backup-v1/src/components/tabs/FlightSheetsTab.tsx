import { useState } from 'react';

/* ── Flight sheet data ── */

interface FlightSheetModel {
  name: string;
  role: 'primary' | 'fallback' | 'shard';
}

interface FlightSheet {
  id: string;
  name: string;
  description: string;
  models: FlightSheetModel[];
  targetNodes: string[];
  targetRule: string;
  lastApplied: string | null;
}

const MOCK_FLIGHT_SHEETS: FlightSheet[] = [
  {
    id: 'fs-001',
    name: 'Production Inference',
    description:
      'Primary production workload — llama3.1:70b on high-VRAM nodes with qwen2.5 fallback for overflow.',
    models: [
      { name: 'llama3.1:70b', role: 'primary' },
      { name: 'qwen2.5:32b', role: 'fallback' },
    ],
    targetNodes: ['pve-gpu-01', 'pve-gpu-02', 'rack-node-04'],
    targetRule: 'All nodes with RTX 4090+',
    lastApplied: '2026-03-29T18:42:00Z',
  },
  {
    id: 'fs-002',
    name: 'Dev Testing',
    description: 'Lightweight model for local development and prompt iteration.',
    models: [{ name: 'phi-3:14b', role: 'primary' }],
    targetNodes: ['homelab-amd'],
    targetRule: 'homelab-amd only',
    lastApplied: '2026-03-28T09:15:00Z',
  },
  {
    id: 'fs-003',
    name: 'Big Model Cluster',
    description:
      'DeepSeek V3 671B sharded across dual-A100 node for large-context research workloads.',
    models: [{ name: 'deepseek-v3:671b', role: 'shard' }],
    targetNodes: ['pve-gpu-02'],
    targetRule: 'pve-gpu-02 (2×A100)',
    lastApplied: null,
  },
];

/* ── Helpers ── */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ── Styles ── */

const cardStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--bg-card)',
  backdropFilter: 'blur(12px)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
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

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace",
  color: 'var(--cyan)',
  background: 'rgba(0,255,255,0.08)',
  border: '1px solid rgba(0,255,255,0.15)',
  borderRadius: 9999,
  padding: '2px 10px',
  whiteSpace: 'nowrap',
};

const applyBtnStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--cyan)',
  background: 'rgba(0,255,255,0.1)',
  border: '1px solid rgba(0,255,255,0.2)',
  borderRadius: 6,
  padding: '6px 16px',
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
};

const editBtnStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  transition: 'border-color 0.15s',
};

const deleteBtnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--red)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 0.3s ease, border-color 0.3s ease',
};

/* ── Sub-components ── */

function ModelPill({ model }: { model: FlightSheetModel }) {
  const roleLabel =
    model.role === 'fallback'
      ? ' (fallback)'
      : model.role === 'shard'
        ? ' (shard)'
        : '';
  return (
    <span style={pillStyle}>
      {model.name}
      {roleLabel && (
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
          {roleLabel}
        </span>
      )}
    </span>
  );
}

function FlightSheetCard({ sheet }: { sheet: FlightSheet }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...cardStyle,
        borderColor: hovered ? 'var(--border-hover)' : 'var(--border)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Accent line */}
      <div style={accentLine} />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            {sheet.name}
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              lineHeight: 1.4,
            }}
          >
            {sheet.description}
          </span>
        </div>
      </div>

      {/* Target info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {sheet.targetNodes.length} node{sheet.targetNodes.length !== 1 ? 's' : ''} targeted
        </span>
        <span style={{ color: 'var(--text-dim)' }}>&middot;</span>
        <span>{sheet.targetRule}</span>
      </div>

      {/* Model pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sheet.models.map((m) => (
          <ModelPill key={m.name} model={m} />
        ))}
      </div>

      {/* Footer: last applied + actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {sheet.lastApplied
            ? `Applied ${formatRelativeTime(sheet.lastApplied)}`
            : 'Never applied'}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            style={{
              ...deleteBtnStyle,
              opacity: hovered ? 1 : 0,
              borderColor: hovered ? 'rgba(255,70,70,0.2)' : 'transparent',
            }}
          >
            Delete
          </button>
          <button type="button" style={editBtnStyle}>
            Edit
          </button>
          <button type="button" style={applyBtnStyle}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   FlightSheetsTab — deployment template management
   ══════════════════════════════════════════════════════ */

export function FlightSheetsTab() {
  const sheets = MOCK_FLIGHT_SHEETS;

  /* ── empty state ── */
  if (sheets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2" style={{ animation: 'slideUp 0.4s ease-out both' }}>
        <span className="text-2xl opacity-20">📋</span>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No flight sheets &mdash; create one to automate model deployments</p>
        <button
          type="button"
          style={{
            ...applyBtnStyle,
            fontSize: 13,
            padding: '8px 20px',
            marginTop: 8,
          }}
        >
          Create Flight Sheet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ animation: 'slideUp 0.4s ease-out both' }}>
      {/* Top actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Flight Sheets
        </h3>
        <button
          type="button"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--cyan)',
            background: 'rgba(0,255,255,0.1)',
            border: '1px solid rgba(0,255,255,0.2)',
            borderRadius: 6,
            padding: '8px 20px',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          Create Flight Sheet
        </button>
      </div>

      {/* Flight sheet cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sheets.map((sheet) => (
          <FlightSheetCard key={sheet.id} sheet={sheet} />
        ))}
      </div>
    </div>
  );
}
