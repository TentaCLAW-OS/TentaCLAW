import { useEffect, useRef } from 'react';
import { useClusterStore } from '@/stores/cluster';
import type { SSEEvent } from '@/lib/types';

export function useSSE() {
  const handleSSE = useClusterStore((s) => s.handleSSE);
  const setConnected = useClusterStore((s) => s.setConnected);
  const loadInitial = useClusterStore((s) => s.loadInitial);
  const esRef = useRef<EventSource | null>(null);
  const handleSSERef = useRef(handleSSE);
  handleSSERef.current = handleSSE;
  const setConnectedRef = useRef(setConnected);
  setConnectedRef.current = setConnected;
  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const es = new EventSource('/api/v1/events');
      esRef.current = es;

      es.onopen = () => {
        if (!mounted) return;
        setConnectedRef.current(true);
        loadInitialRef.current();
      };

      es.onmessage = (e) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          handleSSERef.current(data as SSEEvent);
        } catch {
          /* ignore malformed events */
        }
      };

      es.onerror = () => {
        if (!mounted) return;
        setConnectedRef.current(false);
        es.close();
        setTimeout(connect, 2000);
      };
    }

    loadInitialRef.current()
      .then(connect)
      .catch(() => setTimeout(connect, 2000));

    return () => {
      mounted = false;
      esRef.current?.close();
    };
  }, []); // Empty deps — connect once
}
