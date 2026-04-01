import { useState } from 'react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

export function ResizeHandle({ direction, onMouseDown, isResizing }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal';
  const [isHovered, setIsHovered] = useState(false);

  // isResizing takes priority over hover for visual feedback
  const lineBackground = isResizing
    ? 'var(--cyan)'
    : isHovered
    ? 'rgba(0, 255, 255, 0.3)'
    : 'transparent';

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${isHorizontal ? 'horizontal' : 'vertical'} panel`}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="shrink-0 relative"
      style={{
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        zIndex: 10,
      }}
    >
      {/* Visible indicator line — opacity transitions, background switches instantly */}
      <div
        className="absolute transition-all duration-150"
        style={{
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: 1, width: 2 }
            : { left: 0, right: 0, top: 1, height: 2 }),
          background: lineBackground,
          opacity: isResizing || isHovered ? 1 : 0,
        }}
      />
      {/* Wider hit area — centered 3px each side of the 4px element */}
      <div
        className="absolute"
        style={{
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: -3, right: -3 }
            : { left: 0, right: 0, top: -3, bottom: -3 }),
        }}
      />
    </div>
  );
}
