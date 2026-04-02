import { useEffect, useState } from 'react';

interface TentaCLAWTipsProps {
  /** The tip message to display (without the octopus emoji) */
  tip: string;
}

/**
 * Contextual tip component — shows a TentaCLAW personality hint
 * with a subtle fade-in animation. Used in empty states.
 */
export function TentaCLAWTips({ tip }: TentaCLAWTipsProps) {
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
          fontFamily: "'Geist', 'Inter', sans-serif",
          letterSpacing: '0.01em',
        }}
      >
        {tip} —{' '}
        <svg viewBox="0 0 32 32" width={16} height={16} fill="none" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
          <circle cx="16" cy="12" r="8" fill="url(#octoGradTip)" />
          <ellipse cx="12" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
          <ellipse cx="20" cy="11" rx="1.5" ry="2" fill="white" opacity="0.9" />
          <circle cx="12" cy="11.5" r="0.8" fill="#060910" />
          <circle cx="20" cy="11.5" r="0.8" fill="#060910" />
          <path d="M13 15 Q16 17 19 15" stroke="white" strokeWidth="0.8" fill="none" opacity="0.6" />
          <path d="M8 18 Q6 24 4 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M10 19 Q9 25 7 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M13 20 Q12 26 11 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
          <path d="M16 20 Q16 26 16 30" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
          <path d="M19 20 Q20 26 21 30" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
          <path d="M22 19 Q23 25 25 29" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M24 18 Q26 24 28 28" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M11 19 Q10 23 8 26" stroke="var(--teal)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
          <defs>
            <linearGradient id="octoGradTip" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--purple)" />
              <stop offset="1" stopColor="var(--cyan)" />
            </linearGradient>
          </defs>
        </svg>
      </p>
    </div>
  );
}
