import { useState, useRef, useEffect, useCallback } from 'react';
import { useClusterStore } from '@/stores/cluster';
import { useAuthStore } from '@/stores/auth';
import { getMood, getPersonalityMessage, getGreeting } from '@/lib/personality';
import type { Mood } from '@/lib/personality';

function OctopusLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none">
      <circle cx="16" cy="12" r="8" fill="url(#octoGrad)" />
      <ellipse cx="12" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
      <ellipse cx="20" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
      <circle cx="12" cy="11.5" r="0.8" fill="#060910" />
      <circle cx="20" cy="11.5" r="0.8" fill="#060910" />
      <path d="M13 15 Q16 17 19 15" stroke="white" strokeWidth="0.8" fill="none" opacity="0.6" />
      <path d="M8 18 Q6 24 4 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M10 19 Q9 25 7 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M13 20 Q12 26 11 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M16 20 Q16 26 16 30" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M19 20 Q20 26 21 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M22 19 Q23 25 25 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M24 18 Q26 24 28 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M11 19 Q10 23 8 26" stroke="var(--teal)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
      <defs>
        <linearGradient id="octoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--purple)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function OctopusMini() {
  return (
    <svg viewBox="0 0 32 32" width={16} height={16} fill="none" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="16" cy="12" r="8" fill="url(#octoGradMini)" />
      <ellipse cx="12" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
      <ellipse cx="20" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
      <circle cx="12" cy="11.5" r="0.8" fill="#060910" />
      <circle cx="20" cy="11.5" r="0.8" fill="#060910" />
      <path d="M13 15 Q16 17 19 15" stroke="white" strokeWidth="0.8" fill="none" opacity="0.6" />
      <path d="M8 18 Q6 24 4 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M10 19 Q9 25 7 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M13 20 Q12 26 11 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M16 20 Q16 26 16 30" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M19 20 Q20 26 21 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M22 19 Q23 25 25 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M24 18 Q26 24 28 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M11 19 Q10 23 8 26" stroke="var(--teal)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
      <defs>
        <linearGradient id="octoGradMini" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--purple)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="4.5" stroke="var(--text-dim)" strokeWidth="1.3" />
      <path d="M10.5 10.5L13.5 13.5" stroke="var(--text-dim)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function Header() {
  const nodes = useClusterStore((s) => s.nodes);
  const connected = useClusterStore((s) => s.connected);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const alerts = useClusterStore((s) => s.alerts);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const onlineNodes = nodes.filter((n) => n.status === 'online').length;
  const totalGpus = nodes.reduce((sum, n) => sum + n.gpu_count, 0);

  // CLAWtopus personality state
  const hasWarning = alerts.some((a) => a.severity === 'warning' && !a.acknowledged);
  const hasError = alerts.some((a) => a.severity === 'critical' && !a.acknowledged);
  const currentMood: Mood = getMood(onlineNodes, nodes.length, hasWarning, hasError);

  const pickMessage = useCallback(() => getPersonalityMessage(currentMood), [currentMood]);
  const [statusMessage, setStatusMessage] = useState(pickMessage);
  const [messageFading, setMessageFading] = useState(false);

  // Rotate personality message every 30 seconds with fade transition
  useEffect(() => {
    // Immediately pick a new message when mood changes
    setStatusMessage(getPersonalityMessage(currentMood));
  }, [currentMood]);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageFading(true);
      setTimeout(() => {
        setStatusMessage(pickMessage());
        setMessageFading(false);
      }, 300);
    }, 30_000);
    return () => clearInterval(interval);
  }, [pickMessage]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const displayName = user?.username ?? 'user';
  const initial = displayName[0].toUpperCase();

  return (
    <header
      className="flex items-center justify-between px-4 shrink-0 z-30"
      style={{
        height: 48,
        background: 'rgba(8,10,16,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        borderImage: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.08), transparent) 1',
      }}
    >
      {/* Left: Logo + brand */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
            boxShadow: '0 0 12px rgba(140,0,200,0.25)',
          }}
        >
          <OctopusLogo size={24} />
        </div>
        <span
          className="text-xs font-bold"
          style={{
            letterSpacing: '3px',
            background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          TENTACLAW
        </span>
        <span
          className="text-[8px] text-[var(--text-dim)] font-mono px-1.5 py-0.5 border rounded"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          v1.0.0
        </span>
      </div>

      {/* Center: Search + CLAWtopus status */}
      <div className="flex items-center gap-4">
        <div
          className="flex items-center gap-2 w-[280px] h-7 px-3 rounded-lg border"
          style={{
            background: 'var(--bg-input)',
            borderColor: 'var(--border)',
          }}
        >
          <SearchIcon />
          <span
            className="text-[11px]"
            style={{ color: 'var(--text-dim)', userSelect: 'none' }}
          >
            Search nodes, models, commands... (Ctrl+K)
          </span>
        </div>
        <div
          style={{
            fontStyle: 'italic',
            fontSize: 10,
            color: 'rgba(140, 80, 200, 0.6)',
            fontFamily: "'Geist', 'Inter', sans-serif",
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
            opacity: messageFading ? 0 : 1,
            transition: 'opacity 0.3s ease-in-out',
            userSelect: 'none',
          }}
        >
          &ldquo;{statusMessage}&rdquo; — <OctopusMini />
        </div>
      </div>

      {/* Right: Quick stats + controls */}
      <div className="flex items-center gap-4">
        {/* Quick stats */}
        <div className="flex items-center gap-3 text-[9px] font-mono text-[var(--cyan)]">
          <span>{onlineNodes} nodes</span>
          <span>{totalGpus} GPUs</span>
          <span>{nodes.length} total</span>
        </div>

        {/* Connection dot */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: connected ? 'var(--green)' : 'var(--red)',
              boxShadow: connected
                ? '0 0 6px rgba(0,255,136,0.5)'
                : '0 0 6px rgba(255,70,70,0.5)',
            }}
          />
          <span className="text-[9px] text-[var(--text-dim)] font-mono">
            {connected ? 'live' : 'offline'}
          </span>
        </div>

        {/* Notification bell */}
        <div className="relative cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <span className="text-sm">&#x1F514;</span>
          <div
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--red)' }}
          />
        </div>

        {/* Settings gear */}
        <span className="text-sm cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          &#x2699;
        </span>

        {/* User avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
              }}
            >
              {initial}
            </div>
            <span className="text-[9px] text-[var(--text-muted)] font-mono">{displayName}</span>
            <svg
              className="w-2.5 h-2.5 text-[var(--text-dim)]"
              style={{
                transform: showDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
              viewBox="0 0 10 6"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Dropdown */}
          {showDropdown && (
            <div
              className="absolute right-0 top-full mt-1.5 w-40 rounded-xl border overflow-hidden z-50"
              style={{
                background: 'rgba(14,18,28,0.95)',
                backdropFilter: 'blur(20px)',
                borderColor: 'var(--border)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                animation: 'fadeIn 0.15s ease-out both',
              }}
            >
              <div
                className="px-3 py-2 border-b"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="text-[10px] font-mono text-[var(--text-secondary)]">{displayName}</div>
                <div className="text-[9px] font-mono text-[var(--text-dim)]">{user?.role ?? 'user'}</div>
              </div>
              <button
                onClick={async () => {
                  setShowDropdown(false);
                  await logout();
                }}
                className="w-full text-left px-3 py-2 text-[10px] font-mono text-[var(--red)] hover:bg-[rgba(255,70,70,0.08)] transition-colors cursor-pointer"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
