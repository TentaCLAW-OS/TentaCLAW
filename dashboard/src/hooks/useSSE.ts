import { useEffect, useRef } from 'react';
import { useClusterStore } from '@/stores/cluster';
import type { SSEEvent } from '@/lib/types';

export function useSSE() {
  const handleSSE = useClusterStore((s) => s.handleSSE);
  const setConnected = useClusterStore((s) => s.setConnected);
  const loadInitial = useClusterStore((s) => s.loadInitial);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const es = new EventSource('/api/v1/events');
      esRef.current = es;

      es.onopen = () => {
        if (!mounted) return;
        setConnected(true);
        loadInitial();
      };

      es.onmessage = (e) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          handleSSE(data as SSEEvent);
        } catch {
          /* ignore malformed events */
        }
      };

      es.onerror = () => {
        if (!mounted) return;
        setConnected(false);
        es.close();
        setTimeout(connect, 2000);
      };
    }

    loadInitial()
      .then(connect)
      .catch(() => setTimeout(connect, 2000));

    return () => {
      mounted = false;
      esRef.current?.close();
    };
  }, [handleSSE, setConnected, loadInitial]);
}
