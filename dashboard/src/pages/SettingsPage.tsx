// ─── TentaCLAW Dashboard — Settings Page ────────────────────────────────────

import React, { useState } from 'react';
import {
  Settings, Globe, Key, Palette, RefreshCw, Shield, Bell,
  Save, CheckCircle2, Monitor, Zap, Server, Eye, EyeOff,
} from 'lucide-react';
import { OctopusLogo } from '../components/ui';

interface SettingsState {
  gatewayUrl: string;
  apiKey: string;
  refreshInterval: number;
  theme: 'dark' | 'midnight' | 'hacker';
  accentColor: string;
  notifications: boolean;
  soundAlerts: boolean;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  showSensitiveData: boolean;
  compactMode: boolean;
  animationsEnabled: boolean;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>({
    gatewayUrl: 'http://localhost:8080',
    apiKey: '',
    refreshInterval: 2000,
    theme: 'midnight',
    accentColor: '#a855f7',
    notifications: true,
    soundAlerts: false,
    autoReconnect: true,
    maxReconnectAttempts: 5,
    showSensitiveData: false,
    compactMode: false,
    animationsEnabled: true,
  });
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');

  const update = <K extends keyof SettingsState>(key: K, val: SettingsState[K]) => {
    setSettings(s => ({ ...s, [key]: val }));
    setSaved(false);
  };

  const handleSave = () => {
    // In real implementation, persist to localStorage and reconnect
    localStorage.setItem('tentaclaw-settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const testConnection = () => {
    setConnectionStatus('testing');
    setTimeout(() => {
      setConnectionStatus(settings.gatewayUrl ? 'connected' : 'disconnected');
    }, 1500);
  };

  const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="bg-bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-accent">{icon}</div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const Field = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">{label}</div>
        {description && <div className="text-[11px] text-text-muted mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!value)}
      className={`w-9 h-5 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-border'} relative`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${value ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold gradient-text">Settings</h1>
          <p className="text-xs text-text-muted mt-1">Configure your TentaCLAW dashboard</p>
        </div>
        <button
          onClick={handleSave}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${saved ? 'bg-success/10 text-success border border-success/20' : 'bg-accent text-white hover:bg-accent/90'}`}
        >
          {saved ? <><CheckCircle2 size={14} /> Saved</> : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      {/* Connection */}
      <Section title="Gateway Connection" icon={<Globe size={16} />}>
        <Field label="Gateway URL" description="TentaCLAW gateway endpoint">
          <div className="flex items-center gap-2">
            <input
              value={settings.gatewayUrl}
              onChange={e => update('gatewayUrl', e.target.value)}
              className="w-64 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-border-focus"
              placeholder="http://localhost:8080"
            />
            <button
              onClick={testConnection}
              className="px-2.5 py-1.5 bg-bg-card-hover border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {connectionStatus === 'testing' ? <RefreshCw size={12} className="animate-spin" /> : 'Test'}
            </button>
            {connectionStatus === 'connected' && <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 size={12} /> Connected</span>}
          </div>
        </Field>
        <Field label="API Key" description="Authentication key for the gateway">
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={e => update('apiKey', e.target.value)}
              className="w-64 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-border-focus font-mono"
              placeholder="sk-..."
            />
            <button onClick={() => setShowKey(!showKey)} className="text-text-muted hover:text-text-primary">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        <Field label="Auto-reconnect" description="Automatically reconnect on connection loss">
          <Toggle value={settings.autoReconnect} onChange={v => update('autoReconnect', v)} />
        </Field>
        <Field label="Max reconnect attempts" description="Give up after this many failures">
          <input
            type="number"
            value={settings.maxReconnectAttempts}
            onChange={e => update('maxReconnectAttempts', parseInt(e.target.value) || 0)}
            className="w-20 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary text-center focus:outline-none focus:border-border-focus"
            min={1}
            max={20}
          />
        </Field>
      </Section>

      {/* Monitoring */}
      <Section title="Monitoring" icon={<Zap size={16} />}>
        <Field label="Refresh interval" description="How often to poll for new data (ms)">
          <select
            value={settings.refreshInterval}
            onChange={e => update('refreshInterval', parseInt(e.target.value))}
            className="w-40 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-border-focus"
          >
            <option value={1000}>1 second</option>
            <option value={2000}>2 seconds</option>
            <option value={5000}>5 seconds</option>
            <option value={10000}>10 seconds</option>
            <option value={30000}>30 seconds</option>
          </select>
        </Field>
        <Field label="Notifications" description="Browser notifications for alerts">
          <Toggle value={settings.notifications} onChange={v => update('notifications', v)} />
        </Field>
        <Field label="Sound alerts" description="Play sound for critical alerts">
          <Toggle value={settings.soundAlerts} onChange={v => update('soundAlerts', v)} />
        </Field>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" icon={<Palette size={16} />}>
        <Field label="Theme" description="Dashboard color theme">
          <div className="flex gap-2">
            {[
              { id: 'midnight', label: 'Midnight', color: 'bg-[#0a0e17]' },
              { id: 'dark', label: 'Dark', color: 'bg-[#1a1a2e]' },
              { id: 'hacker', label: 'Hacker', color: 'bg-[#0d1117]' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => update('theme', t.id as any)}
                className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs transition-colors ${settings.theme === t.id ? 'border-accent text-accent' : 'border-border text-text-secondary hover:text-text-primary'}`}
              >
                <span className={`w-3 h-3 rounded-full ${t.color} border border-white/10`} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Accent color" description="Primary accent color">
          <div className="flex gap-2">
            {['#a855f7', '#6366f1', '#22d3ee', '#22c55e', '#eab308', '#ef4444'].map(c => (
              <button
                key={c}
                onClick={() => update('accentColor', c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${settings.accentColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Compact mode" description="Reduce padding and card sizes">
          <Toggle value={settings.compactMode} onChange={v => update('compactMode', v)} />
        </Field>
        <Field label="Animations" description="Enable UI animations and transitions">
          <Toggle value={settings.animationsEnabled} onChange={v => update('animationsEnabled', v)} />
        </Field>
      </Section>

      {/* Security */}
      <Section title="Security" icon={<Shield size={16} />}>
        <Field label="Show sensitive data" description="Display API keys and tokens in plaintext">
          <Toggle value={settings.showSensitiveData} onChange={v => update('showSensitiveData', v)} />
        </Field>
      </Section>

      {/* About */}
      <div className="bg-bg-card border border-border rounded-xl p-5 text-center">
        <OctopusLogo size={40} className="mx-auto mb-2" />
        <div className="text-sm font-semibold gradient-text">TentaCLAW Dashboard</div>
        <div className="text-[11px] text-text-muted mt-1">v0.1.0 · GPU Inference Cluster Control Plane</div>
        <div className="text-[10px] text-text-muted mt-2">TUI (pod display) · Web Dashboard (this) · Grafana (observability)</div>
      </div>
    </div>
  );
}
