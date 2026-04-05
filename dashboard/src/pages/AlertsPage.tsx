// ─── TentaCLAW Dashboard — Alerts Page ──────────────────────────────────────

import React, { useState } from 'react';
import { useStore } from '../store';
import { StatCard, Badge } from '../components/ui';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, Bell,
  Filter, Search, X, Clock,
} from 'lucide-react';

const SEV_ICON: Record<string, React.ReactNode> = {
  critical: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-accent-3" />,
};

const SEV_BADGE: Record<string, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

function timeAgo(ts: number) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export function AlertsPage() {
  const { alerts, acknowledgeAlert, nodes } = useStore();
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const filteredAlerts = alerts.filter(a => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (!showAcknowledged && a.acknowledged) return false;
    if (search && !a.title.toLowerCase().includes(search.toLowerCase()) && !a.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const unackCount = alerts.filter(a => !a.acknowledged).length;
  const critCount = alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length;
  const warnCount = alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length;
  const infoCount = alerts.filter(a => a.severity === 'info' && !a.acknowledged).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold gradient-text">Alerts</h1>
        <p className="text-xs text-text-muted mt-1">Monitor fleet events and warnings</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Active Alerts" value={unackCount.toString()} icon={<Bell size={14} />} color="text-warning" />
        <StatCard label="Critical" value={critCount.toString()} icon={<AlertCircle size={14} />} color="text-danger" />
        <StatCard label="Warnings" value={warnCount.toString()} icon={<AlertTriangle size={14} />} color="text-warning" />
        <StatCard label="Info" value={infoCount.toString()} icon={<Info size={14} />} color="text-accent-3" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search alerts..."
            className="w-full pl-9 pr-3 py-2 bg-bg-card border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
        <div className="flex items-center bg-bg-card border border-border rounded-lg overflow-hidden text-xs">
          {['all', 'critical', 'warning', 'info'].map(sev => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(sev)}
              className={`px-3 py-2 capitalize transition-colors ${severityFilter === sev ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {sev}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showAcknowledged}
            onChange={e => setShowAcknowledged(e.target.checked)}
            className="rounded border-border bg-bg-card text-accent focus:ring-accent/30"
          />
          Show acknowledged
        </label>
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {filteredAlerts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <CheckCircle2 size={40} className="text-success/30 mb-3" />
            <span className="text-sm">No alerts to display</span>
          </div>
        )}

        {filteredAlerts
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(alert => {
            const node = nodes.find(n => n.id === alert.nodeId);
            return (
              <div
                key={alert.id}
                className={`bg-bg-card border rounded-xl p-4 transition-all ${alert.acknowledged ? 'border-border/50 opacity-60' : alert.severity === 'critical' ? 'border-danger/30' : 'border-border'} card-hover`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{SEV_ICON[alert.severity]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{alert.title}</span>
                      <Badge variant={SEV_BADGE[alert.severity]}>{alert.severity}</Badge>
                      {node && <span className="text-[11px] text-text-muted">· {node.name}</span>}
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">{alert.message}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-text-muted">
                      <Clock size={10} />
                      <span>{timeAgo(alert.timestamp)}</span>
                    </div>
                  </div>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="px-2.5 py-1 bg-bg-card-hover border border-border rounded-lg text-[11px] text-text-secondary hover:text-text-primary hover:border-border-focus transition-colors shrink-0"
                    >
                      Acknowledge
                    </button>
                  )}
                  {alert.acknowledged && (
                    <span className="text-[11px] text-success flex items-center gap-1"><CheckCircle2 size={12} /> Ack'd</span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
