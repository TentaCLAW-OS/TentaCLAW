import { useState, useCallback, useEffect, useRef } from 'react';

interface UseResizableOptions {
  direction: 'horizontal' | 'vertical';
  initialSize: number;
  minSize: number;
  maxSize: number;
  onResize?: (size: number) => void;
}

interface UseResizableReturn {
  size: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Manages drag-to-resize state for a panel.
 *
 * @param direction - 'horizontal' resizes width (left/right drag), 'vertical' resizes height (up/down drag)
 * @param initialSize - Initial size in pixels. Not clamped to [minSize, maxSize] on first render.
 * @param minSize / maxSize - Clamping bounds applied during drag.
 * @param onResize - Optional callback fired on every size change. Memoize or accept frequent calls.
 *
 * Returns { size, isResizing, handleMouseDown }.
 * handleMouseDown is stable for the component lifetime (safe to pass to React.memo children).
 */
export function useResizable({
  direction,
  initialSize,
  minSize,
  maxSize,
  onResize,
}: UseResizableOptions): UseResizableReturn {
  const [size, setSize] = useState(initialSize);
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  // Mirror size in a ref so handleMouseDown can read the latest value without being in deps
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // Mirror onResize in a ref so the effect does not re-run when the callback identity changes
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSize.current = sizeRef.current;
    },
    [direction], // size removed — read via sizeRef instead
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos.current;
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      setSize(newSize);
      onResizeRef.current?.(newSize); // stable ref call — not in dep array
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    // Capture previous styles so concurrent resizes don't clobber each other
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing, direction, minSize, maxSize]); // onResize removed — read via ref

  return { size, isResizing, handleMouseDown };
}
