/** Action items across meetings, for the dashboard: listed from minutes, ticked in place. */
import type { ActionItemView } from '../../shared/integrations.ts';
import { parseActionItems } from '../minutes/minutes.ts';
import type { StoredMeeting } from './store.ts';

/** Open items first, then by newest meeting, in the minutes' own order. */
export function listActionItems(meetings: readonly StoredMeeting[]): ActionItemView[] {
  const items: ActionItemView[] = [];
  for (const m of meetings) {
    if (!m.minutes) continue;
    parseActionItems(m.minutes.markdown).forEach((a, index) =>
      items.push({
        meetingId: m.id,
        meetingTitle: m.title,
        meetingStartedAt: m.record.startedAt,
        index,
        owner: a.owner,
        text: a.text,
        done: a.done,
      }),
    );
  }
  return items.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      b.meetingStartedAt - a.meetingStartedAt ||
      a.index - b.index,
  );
}

/**
 * The minutes with action item `index` ticked or unticked, or null if there is no such
 * item. Only the box changes; the rest of the text is left exactly as it was.
 */
export function setActionItemDone(md: string, index: number, done: boolean): string | null {
  const lines = md.split('\n');
  let inSection = false;
  let n = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^## /.test(line)) inSection = /^## Action items\s*$/i.test(line);
    if (!inSection) continue;
    const m = /^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/.exec(line);
    if (!m || ++n !== index) continue;
    lines[i] = `${m[1]}${done ? 'x' : ' '}${m[3]}`;
    return lines.join('\n');
  }
  return null;
}
