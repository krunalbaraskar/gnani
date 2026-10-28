import type { AppSection } from '../../../shared/ipc.ts';

export interface AppRoute {
  section: AppSection;
  meetingId?: string;
}

export function parseRoute(hash: string): AppRoute {
  const match = /^#(?:library|app\/meetings)(?:\/(m\d+))?$/.exec(hash);
  if (match) return { section: 'meetings', meetingId: match[1] };
  if (hash === '#app/ask') return { section: 'ask' };
  if (hash === '#app/settings') return { section: 'settings' };
  return { section: 'home' };
}

export function routeHash({ section, meetingId }: AppRoute): string {
  return `#app/${section}${section === 'meetings' && meetingId ? `/${meetingId}` : ''}`;
}
