const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  hash: 'M10 3L8 21M17 3l-2 18M4 9h17M3 15h17',
  at: 'M16 8v7c0 3 5 2 5-3a9 9 0 10-4 7M16 12a4 4 0 10-8 0 4 4 0 008 0',
  threads: 'M20 11a8 8 0 10-4 7l5 2-1-6zM8 9h8M8 13h5',
  drafts: 'M8 3h7l4 4v12H8zM14 3v5h5M5 7H3v14h12',
  compose: 'M13 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-8M10 14l1-4 8-8 3 3-8 8z',
  user: 'M12 3a4 4 0 100 8 4 4 0 000-8M4 21v-3a6 6 0 016-5h4a6 6 0 016 5v3',
  plus: 'M12 5v14M5 12h14',
  pin: 'M9 3h6l-1 6 4 5H6l4-5zM12 14v7',
  hide: 'M3 3l18 18M10 5h2c6 0 10 7 10 7a18 18 0 01-4 4M6 6a19 19 0 00-4 6s4 7 10 7h2M10 10a3 3 0 004 4',
  cursor: 'M4 3l15 10-7 1-3 7z',
  bell: 'M6 9a6 6 0 0112 0v5l2 3H4l2-3zM10 21h4',
  history: 'M4 5v5h5M4 10a8 8 0 118 10M12 7v5l3 2',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18M12 11v6M12 7h.01',
  settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1zM12 9a3 3 0 100 6 3 3 0 000-6',
  calendar: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h3M14 14h2',
  check: 'M5 12l4 4L19 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  play: 'M7 5v14l11-7z',
  stop: 'M7 7h10v10H7z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
  screen: 'M4 5h16v11H4zM9 20h6M12 16v4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M3 3l19 9-19 9v-7l13-2-13-2z',
  folder: 'M3 7h7l2 2h9v10H3z',
  close: 'M6 6l12 12M18 6L6 18',
  pause: 'M9 6v12M15 6v12',
  book: 'M4 5h5a3 3 0 013 3v11a2 2 0 00-2-2H4zM20 5h-5a3 3 0 00-3 3v11a2 2 0 012-2h6z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l4 4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
} as const;

const FILLED = new Set(['play', 'stop', 'send']);

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
