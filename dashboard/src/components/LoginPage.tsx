import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

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
            <span role="img" aria-label="tentaclaw">🐙</span>
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
