// ─── Shared UI Components ───────────────────────────────────────────────────

import React from 'react';

// ─── TentaCLAW Octopus Logo (inline SVG) ───────────────────────────────────

export function OctopusLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <defs>
        <linearGradient id="tc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00d4aa"/>
          <stop offset="100%" stopColor="#8b5cf6"/>
        </linearGradient>
        <linearGradient id="tc-grad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00d4aa"/>
          <stop offset="100%" stopColor="#8b5cf6"/>
        </linearGradient>
        <radialGradient id="tc-body" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#00d4aa" stopOpacity={0.9}/>
          <stop offset="100%" stopColor="#0a2a22"/>
        </radialGradient>
        <filter id="tc-glow">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="32" cy="22" rx="16" ry="14" fill="url(#tc-body)" filter="url(#tc-glow)"/>
      <ellipse cx="32" cy="22" rx="16" ry="14" stroke="url(#tc-grad)" strokeWidth="1.2" fill="none"/>
      <ellipse cx="26" cy="19" rx="4" ry="4.5" fill="#0d1117" stroke="url(#tc-grad)" strokeWidth="0.8"/>
      <ellipse cx="38" cy="19" rx="4" ry="4.5" fill="#0d1117" stroke="url(#tc-grad)" strokeWidth="0.8"/>
      <ellipse cx="26" cy="19.5" rx="2" ry="2.5" fill="url(#tc-grad)"/>
      <ellipse cx="38" cy="19.5" rx="2" ry="2.5" fill="url(#tc-grad)"/>
      <circle cx="25" cy="18" r="0.9" fill="white" opacity={0.85}/>
      <circle cx="37" cy="18" r="0.9" fill="white" opacity={0.85}/>
      <path d="M27 25 Q32 29 37 25" stroke="url(#tc-grad)" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
      <path d="M18 32 C12 36 8 42 10 50 C11 54 14 55 13 58" stroke="url(#tc-grad)" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <path d="M22 35 C18 40 16 47 18 53 C19 57 22 57 21 60" stroke="url(#tc-grad2)" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M26 36 C24 42 23 49 25 54 C26 58 28 58 28 62" stroke="url(#tc-grad)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      <path d="M30 36 C29 43 29 50 30 55 C31 59 32 60 32 63" stroke="url(#tc-grad2)" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M34 36 C35 43 35 50 34 55 C33 59 32 60 32 63" stroke="url(#tc-grad)" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M38 36 C40 42 41 49 39 54 C38 58 36 58 36 62" stroke="url(#tc-grad2)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      <path d="M42 35 C46 40 48 47 46 53 C45 57 42 57 43 60" stroke="url(#tc-grad)" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M46 32 C52 36 56 42 54 50 C53 54 50 55 51 58" stroke="url(#tc-grad2)" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <circle cx="11" cy="46" r="1" fill="url(#tc-grad)" opacity={0.6}/>
      <circle cx="10.5" cy="52" r="0.8" fill="url(#tc-grad)" opacity={0.5}/>
      <circle cx="53" cy="46" r="1" fill="url(#tc-grad2)" opacity={0.6}/>
      <circle cx="53.5" cy="52" r="0.8" fill="url(#tc-grad2)" opacity={0.5}/>
    </svg>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

export function StatCard({ label, value, sub, icon, color = 'text-white' }: {
  label: string; value: string | number; sub?: string; icon?: React.ReactNode; color?: string;
}) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 card-hover">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-secondary uppercase tracking-wider">{label}</span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
    </div>
  );
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

export function ProgressBar({ value, max = 100, size = 'md', color, label }: {
  value: number; max?: number; size?: 'sm' | 'md' | 'lg'; color?: string; label?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = color ?? (pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warning' : 'bg-accent-3');
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-secondary">{label}</span>
          <span className="text-text-primary font-mono">{Math.round(pct)}%</span>
        </div>
      )}
      <div className={`w-full bg-bg-secondary rounded-full ${h} overflow-hidden`}>
        <div className={`${h} ${c} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────

export function Badge({ children, variant = 'default' }: {
  children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
}) {
  const styles: Record<string, string> = {
    default: 'bg-bg-secondary text-text-secondary border-border',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    danger: 'bg-danger/10 text-danger border-danger/20',
    info: 'bg-accent-3/10 text-accent-3 border-accent-3/20',
    purple: 'bg-accent/10 text-accent border-accent/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${styles[variant]}`}>
      {children}
    </span>
  );
}

// ─── Status Dot ─────────────────────────────────────────────────────────────

export function StatusDot({ status }: { status: string }) {
  const c = status === 'online' || status === 'active' || status === 'running' || status === 'loaded'
    ? 'bg-success' : status === 'idle' || status === 'warning' || status === 'stopped' || status === 'available'
    ? 'bg-warning' : 'bg-danger';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}

// ─── Sparkline (SVG) ────────────────────────────────────────────────────────

export function Sparkline({ data, width = 120, height = 32, color = '#22d3ee' }: {
  data: number[]; width?: number; height?: number; color?: string;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
      <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
      <polyline
        fill={`url(#sg-${color.replace('#', '')})`}
        stroke="none"
        points={`0,${height} ${points} ${width},${height}`}
      />
    </svg>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────────

export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Temperature Display ────────────────────────────────────────────────────

export function TempDisplay({ temp }: { temp: number }) {
  const c = temp >= 85 ? 'text-danger' : temp >= 70 ? 'text-warning' : temp >= 50 ? 'text-success' : 'text-accent-3';
  return <span className={`font-mono ${c}`}>{temp}°C</span>;
}

// ─── Format Helpers ─────────────────────────────────────────────────────────

export function formatBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatPower(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${Math.round(w)}W`;
}

export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}
