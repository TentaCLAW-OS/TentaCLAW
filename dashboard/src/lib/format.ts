export function formatToks(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export function formatVram(mb: number): string {
  const gb = mb / 1024;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${mb} MB`;
}

export function formatWatts(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${w} W`;
}

export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTemp(c: number): 'cool' | 'warm' | 'hot' {
  if (c < 60) return 'cool';
  if (c < 80) return 'warm';
  return 'hot';
}

export function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
