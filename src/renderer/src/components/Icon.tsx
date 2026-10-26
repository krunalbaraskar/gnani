const PATHS = {
  play: 'M7 5v14l11-7z',
  stop: 'M7 7h10v10H7z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
  screen: 'M4 5h16v11H4zM9 20h6M12 16v4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M5 12h13M13 6l6 6-6 6',
  folder: 'M3 7h7l2 2h9v10H3z',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

const FILLED = new Set(['play', 'stop']);

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
