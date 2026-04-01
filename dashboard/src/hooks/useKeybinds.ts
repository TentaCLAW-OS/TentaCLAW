import { useEffect, useCallback, useRef } from 'react';
import type { KeybindAction } from '@/lib/types';

function parseKeyCombo(keys: string): string[][] {
  // "g s" → [["g"], ["s"]] (sequence)
  // "ctrl+k" → [["ctrl+k"]] (chord)
  return keys.split(' ').map((part) => [part.toLowerCase()]);
}

function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'escape') key = 'esc';

  // Don't double-add modifier keys
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
    parts.push(key);
  }

  return parts.join('+');
}

/**
 * Registers global keyboard shortcuts.
 *
 * IMPORTANT: Callers MUST stabilize the `keybinds` array with `useMemo` or define it
 * outside the component. An unstable array reference causes the keydown listener to
 * re-register on every render.
 *
 * @example
 * const keybinds = useMemo(() => [...], [dep1, dep2]);
 * useKeybinds(keybinds);
 */
export function useKeybinds(keybinds: KeybindAction[]) {
  const sequenceBuffer = useRef<string[]>([]);
  const sequenceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const pressed = eventToKey(e);

      // Check direct (single-chord) keybinds first
      for (const bind of keybinds) {
        const parsed = parseKeyCombo(bind.keys);
        if (parsed.length === 1 && parsed[0][0] === pressed) {
          e.preventDefault();
          bind.action();
          sequenceBuffer.current = [];
          return;
        }
      }

      // Sequence handling
      sequenceBuffer.current.push(pressed);
      if (sequenceTimeout.current) clearTimeout(sequenceTimeout.current);
      sequenceTimeout.current = setTimeout(() => {
        sequenceBuffer.current = [];
      }, 800); // 800ms to complete sequence

      // Check sequence keybinds
      const bufferStr = sequenceBuffer.current.join(' ');
      for (const bind of keybinds) {
        const parsed = parseKeyCombo(bind.keys);
        if (parsed.length > 1) {
          const bindStr = parsed.map((p) => p[0]).join(' ');
          if (bindStr === bufferStr) {
            e.preventDefault();
            bind.action();
            sequenceBuffer.current = [];
            if (sequenceTimeout.current) clearTimeout(sequenceTimeout.current);
            return;
          }
        }
      }
    },
    [keybinds],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
