import { formatClock } from '../../shared/transcript/format.ts';
import type { SessionRecord } from './types.ts';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-time file name stem, e.g. bolo-session-2026-10-04_14-05-09 */
export function exportBaseName(startedAt: number): string {
  const d = new Date(startedAt);
  return (
    `bolo-session-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

const LABEL = { me: 'Me', them: 'Them' } as const;

export function sessionToMarkdown(r: SessionRecord): string {
  const start = r.startedAt;
  const end = r.endedAt ?? r.segments.at(-1)?.at ?? start;
  const lines: string[] = [
    `# Bolo session — ${new Date(start).toLocaleString('en-IN')}`,
    '',
    `- Duration: ${formatClock(end - start)}`,
    `- Speech-to-text language: ${r.sttLanguage}`,
    `- Suggestion language: ${r.outputLanguage}`,
    `- Audio source: ${r.audioMode === 'file' ? 'file replay' : 'live capture'}`,
    `- Segments: ${r.segments.length} (echo segments removed: ${r.echoesRemoved})`,
    `- Suggestions: ${r.suggestions.length}`,
  ];
  if (r.contextNote.trim()) lines.push('', '## Context', '', r.contextNote.trim());

  // Interleave transcript and suggestions by time.
  type Item = { at: number; md: string };
  const items: Item[] = r.segments.map((s) => ({
    at: s.at,
    md:
      `**[${formatClock(s.at - start)}] ${LABEL[s.speaker]}:** ${s.text}` +
      (s.meaning ? `  \n_Meaning: ${s.meaning}_` : ''),
  }));
  for (const s of r.suggestions) {
    if (!s.text && !s.error) continue;
    const label = s.trigger === 'auto' ? 'Suggestion (auto)' : 'Suggestion';
    const asked = s.asked ? `_You asked: ${s.asked}_ — ` : '';
    const from = [...(s.sources ?? []), ...(s.usedScreen ? ['screen'] : [])];
    const tail = s.error
      ? ''
      : s.verdict === 'missing'
        ? ' _(not in your files)_'
        : s.verdict === 'unverified'
          ? ' _(figure not checked)_'
          : from.length
            ? ` _(from ${from.join(', ')})_`
            : '';
    const body = asked + (s.error ? `_failed: ${s.error}_` : s.text.split('\n').join(' / ')) + tail;
    items.push({
      at: s.startedAt,
      md: `> 💡 **[${formatClock(s.startedAt - start)}] ${label}:** ${body}`,
    });
  }
  items.sort((a, b) => a.at - b.at);

  lines.push('', '## Transcript', '');
  if (items.length === 0) lines.push('_Nothing was transcribed._');
  for (const it of items) lines.push(it.md, '');
  return lines.join('\n').trimEnd() + '\n';
}

export function sessionToJson(r: SessionRecord): string {
  return JSON.stringify({ version: 1, app: 'bolo', ...r }, null, 2) + '\n';
}
