import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { useUIStore } from '@/stores/ui';
import { useClusterStore } from '@/stores/cluster';

const THEME = {
  background: '#0a0e14',
  foreground: '#b0b8c8',
  cursor: '#00ffff',
  cursorAccent: '#0a0e14',
  selectionBackground: 'rgba(0,255,255,0.15)',
  black: '#0a0e14',
  red: '#ff4646',
  green: '#00ff88',
  yellow: '#ffdc00',
  blue: '#00ffff',
  magenta: '#8c00c8',
  cyan: '#008c8c',
  white: '#e8e8e8',
} as const;

const FONT_FAMILY = "'JetBrains Mono', monospace";
const FONT_SIZE = 13;

export function TerminalTab() {
  const selectedResource = useUIStore((s) => s.selectedResource);
  const nodes = useClusterStore((s) => s.nodes);

  // Determine which node to connect to
  const targetNode = (() => {
    if (selectedResource.type === 'node') {
      return nodes.find((n) => n.id === selectedResource.id) ?? null;
    }
    // Fall back to first online node
    return nodes.find((n) => n.status === 'online') ?? null;
  })();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const cleanUp = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    fitAddonRef.current = null;
  }, []);

  useEffect(() => {
    if (!targetNode || !containerRef.current) return;

    // Clean up any previous session
    cleanUp();

    const terminal = new Terminal({
      theme: THEME,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // WebSocket connection
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/shell/${targetNode.id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      terminal.write(
        `\x1b[36m--- Connected to ${targetNode.hostname} (${targetNode.ip_address ?? 'unknown'}) ---\x1b[0m\r\n`,
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        terminal.write(event.data);
      } else if (event.data instanceof Blob) {
        event.data.text().then((text) => terminal.write(text));
      }
    };

    ws.onclose = () => {
      terminal.write('\r\n\x1b[31m--- Connection closed ---\x1b[0m\r\n');
    };

    ws.onerror = () => {
      terminal.write('\r\n\x1b[31m--- WebSocket error ---\x1b[0m\r\n');
    };

    // Forward terminal input to WebSocket
    const dataDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ResizeObserver for auto-fitting
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during layout transitions
      }
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    observerRef.current = resizeObserver;

    return () => {
      dataDisposable.dispose();
      cleanUp();
    };
  }, [targetNode?.id, cleanUp]);

  if (!targetNode) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: 'var(--text-secondary)' }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2" style={{ color: 'var(--text-tertiary)' }}>
            &gt;_
          </div>
          <p className="text-sm">Select a node to open a terminal session</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Node pill bar */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span
          className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
          style={{
            backgroundColor: 'rgba(0,255,255,0.1)',
            color: '#00ffff',
            border: '1px solid rgba(0,255,255,0.25)',
          }}
        >
          {targetNode.hostname}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {targetNode.ip_address ?? ''}
        </span>
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ backgroundColor: THEME.background, padding: '4px' }}
      />
    </div>
  );
}
