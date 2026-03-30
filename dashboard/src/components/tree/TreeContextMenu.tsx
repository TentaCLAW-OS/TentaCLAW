import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/ui';
import { api } from '@/lib/api';

interface MenuPosition {
  x: number;
  y: number;
  nodeId: string;
  hostname: string;
  status: string;
}

interface MenuItem {
  label: string;
  icon: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function useTreeContextMenu() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const openMenu = useCallback((e: React.MouseEvent, nodeId: string, hostname: string, status: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, nodeId, hostname, status });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (menu) {
      const handler = () => setMenu(null);
      window.addEventListener('click', handler);
      window.addEventListener('contextmenu', handler);
      return () => {
        window.removeEventListener('click', handler);
        window.removeEventListener('contextmenu', handler);
      };
    }
  }, [menu]);

  return { menu, openMenu, closeMenu };
}

export function TreeContextMenu({
  x,
  y,
  nodeId,
  hostname,
  status,
  onClose,
}: MenuPosition & { onClose: () => void }) {
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const selectResource = useUIStore((s) => s.selectResource);

  const items: MenuItem[] = [
    {
      label: 'Open Terminal',
      icon: '>_',
      action: () => {
        selectResource({ type: 'node', id: nodeId });
        setActiveTab('terminal');
      },
    },
    {
      label: 'View Details',
      icon: '▣',
      action: () => {
        selectResource({ type: 'node', id: nodeId });
        setActiveTab('summary');
      },
    },
    {
      label: 'Deploy Model',
      icon: '▶',
      action: () => {
        selectResource({ type: 'node', id: nodeId });
        setActiveTab('models');
      },
    },
    {
      label: 'Run Benchmark',
      icon: '📊',
      action: () => {
        api.sendCommand(nodeId, 'benchmark').catch(console.error);
      },
    },
    {
      label: 'Restart Agent',
      icon: '↻',
      action: () => {
        api.sendCommand(nodeId, 'restart_agent').catch(console.error);
      },
      disabled: status === 'offline',
    },
    {
      label: 'Reboot Node',
      icon: '⏻',
      action: () => {
        if (confirm(`Reboot ${hostname}? This will interrupt all running inference.`)) {
          api.sendCommand(nodeId, 'reboot').catch(console.error);
        }
      },
      danger: true,
      disabled: status === 'offline',
    },
  ];

  // Adjust position to stay within viewport
  const menuWidth = 200;
  const menuHeight = items.length * 34 + 8;
  const adjX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjY = y + menuHeight > window.innerHeight ? y - menuHeight : y;

  return (
    <div
      className="fixed z-[70]"
      style={{
        left: adjX,
        top: adjY,
        background: 'rgba(14,18,28,0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(0,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        minWidth: menuWidth,
        padding: '4px 0',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="px-3 py-1.5 text-[9px] uppercase tracking-wider"
        style={{
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          marginBottom: 2,
        }}
      >
        {hostname}
      </div>

      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer transition-colors"
          style={{
            color: item.disabled
              ? 'var(--text-dim)'
              : item.danger
                ? 'var(--red)'
                : 'var(--text-secondary)',
            fontSize: 11,
            pointerEvents: item.disabled ? 'none' : undefined,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              (e.currentTarget as HTMLElement).style.background = item.danger
                ? 'rgba(255,70,70,0.06)'
                : 'rgba(0,255,255,0.04)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
        >
          <span className="w-4 text-center text-[10px]">{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
