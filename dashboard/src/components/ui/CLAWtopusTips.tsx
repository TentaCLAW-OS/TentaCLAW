import { useEffect, useState } from 'react';

interface CLAWtopusTipsProps {
  /** The tip message to display (without the octopus emoji) */
  tip: string;
}

/**
 * Contextual tip component — shows a CLAWtopus personality hint
 * with a subtle fade-in animation. Used in empty states.
 */
export function CLAWtopusTips({ tip }: CLAWtopusTipsProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger fade-in after mount
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex items-center justify-center gap-2 py-8"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
      }}
    >
      <p
        style={{
          fontStyle: 'italic',
          fontSize: 12,
          color: 'rgba(140, 80, 200, 0.65)',
          fontFamily: "'Inter', sans-serif",
          letterSpacing: '0.01em',
        }}
      >
        {tip} — <span role="img" aria-label="CLAWtopus">🐙</span>
      </p>
    </div>
  );
}
