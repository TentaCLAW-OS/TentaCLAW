// ─── TentaCLAW Dashboard — Sidebar Navigation ──────────────────────────────

import React from 'react';
import { useStore } from '../store';
import type { Page } from '../types';
import {
  LayoutDashboard, Cpu, Bot, MessageCircle, Server,
  AlertTriangle, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { OctopusLogo } from './ui';

const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { page: 'cluster', label: 'Cluster', icon: <Server size={20} /> },
  { page: 'models', label: 'Models', icon: <Cpu size={20} /> },
  { page: 'agents', label: 'Agents', icon: <Bot size={20} /> },
  { page: 'chat', label: 'Chat', icon: <MessageCircle size={20} /> },
  { page: 'alerts', label: 'Alerts', icon: <AlertTriangle size={20} /> },
  { page: 'settings', label: 'Settings', icon: <Settings size={20} /> },
];

export function Sidebar() {
  const { page, setPage, sidebarCollapsed, toggleSidebar, alerts } = useStore();
  const unackAlerts = alerts.filter(a => !a.acknowledged).length;

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-sidebar border-r border-border flex flex-col z-40 transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-56'}`}>
      {/* Logo */}
      <div className={`flex items-center h-14 px-3 border-b border-border ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
        <OctopusLogo size={28} />
        {!sidebarCollapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold gradient-text tracking-tight">TentaCLAW</span>
            <span className="text-[10px] text-text-muted">GPU Fleet Control</span>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = page === item.page;
          return (
            <button
              key={item.page}
              onClick={() => setPage(item.page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative group
                ${active
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-card border border-transparent'
                }
                ${sidebarCollapsed ? 'justify-center' : ''}
              `}
            >
              <span className={active ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}>
                {item.icon}
              </span>
              {!sidebarCollapsed && <span>{item.label}</span>}
              {item.page === 'alerts' && unackAlerts > 0 && (
                <span className={`${sidebarCollapsed ? 'absolute -top-1 -right-1' : 'ml-auto'} bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center`}>
                  {unackAlerts}
                </span>
              )}
              {/* Tooltip for collapsed */}
              {sidebarCollapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 bg-bg-card border border-border rounded text-xs text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-border">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-card transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
