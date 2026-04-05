import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

function OctopusLogo() {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} fill="none">
      <circle cx="16" cy="12" r="8" fill="url(#octoGradLogin)" />
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
        <linearGradient id="octoGradLogin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--purple)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || loading) return;
    await login(username, password);
  };

  return (
    <div className="login-page">
      {/* Scanline overlay */}
      <div className="login-scanline" />

      {/* Background grid + radial (mirrors body::before/after) */}
      <div className="login-grid" />
      <div className="login-radials" />

      {/* Center card */}
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo-area">
          <div className="login-logo-mark">
            <OctopusLogo />
          </div>
          <div className="login-brand">
            <span className="login-brand-name">TENTACLAW</span>
            <span className="login-brand-os">OS</span>
          </div>
          <p className="login-tagline">
            Eight arms. One mind. Zero compromises.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <input
              ref={usernameRef}
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="login-input"
              autoComplete="username"
              disabled={loading}
            />
          </div>
          <div className="login-field">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-input"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="login-error">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="login-button"
          >
            {loading ? (
              <span className="login-button-loading">
                <span className="login-spinner" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p className="login-version">TentaCLAW OS v1.0.0</p>
      </div>
    </div>
  );
}
