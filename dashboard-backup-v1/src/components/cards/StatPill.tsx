import type { ReactNode } from 'react';

interface StatPillProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  subtext?: string;
  delay?: number;
  children?: ReactNode;
}

export function StatPill({ label, value, unit, color, subtext, delay, children }: StatPillProps) {
  return (
    <div
      className="relative overflow-hidden rounded-[12px] px-4 py-3 flex flex-col gap-1"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        minWidth: 120,
        animation: 'fadeIn 0.4s ease-out both',
        animationDelay: delay != null ? `${delay}s` : undefined,
        transition: 'all 0.25s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--border-hover)';
        el.style.boxShadow = '0 0 12px rgba(0,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--border)';
        el.style.boxShadow = 'none';
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 1,
          background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
          opacity: 0.8,
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
            color: color ?? 'var(--text-primary)',
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

      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
