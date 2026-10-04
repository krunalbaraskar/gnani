import { describe, expect, it } from 'vitest';
import { exportBaseName, sessionToJson, sessionToMarkdown } from '../src/core/session/export.ts';
import type { SessionRecord } from '../src/core/session/types.ts';

const T0 = new Date(2026, 9, 4, 14, 5, 9).getTime();
const record: SessionRecord = {
  startedAt: T0,
  endedAt: T0 + 95_000,
  sttLanguage: 'hi-IN',
  outputLanguage: 'hinglish',
  contextNote: 'Selling term insurance.',
  audioMode: 'file',
  echoesRemoved: 1,
  segments: [
    { id: 'them:1', speaker: 'them', text: 'Premium kitna hoga?', at: T0 + 3000 },
    { id: 'me:1', speaker: 'me', text: 'Around ₹1,200 monthly.', at: T0 + 9000 },
  ],
  suggestions: [
    {
      id: 'sug-1',
      trigger: 'auto',
      text: 'Premium ₹1,200 monthly hai.\nTax benefit bhi hai.',
      startedAt: T0 + 4000,
    },
    { id: 'sug-2', trigger: 'hotkey', text: '', error: 'HTTP 500', startedAt: T0 + 20_000 },
  ],
};

describe('session export', () => {
  it('names files by local start time', () => {
    expect(exportBaseName(T0)).toBe('bolo-session-2026-10-04_14-05-09');
  });

  it('renders Markdown with metadata, context and interleaved suggestions', () => {
    const md = sessionToMarkdown(record);
    expect(md).toContain('- Duration: 01:35');
    expect(md).toContain('## Context\n\nSelling term insurance.');
    const order = [
      '[00:03] Them:** Premium kitna hoga?',
      '[00:04] Suggestion (auto):** Premium ₹1,200 monthly hai. / Tax benefit bhi hai.',
      '[00:09] Me:** Around ₹1,200 monthly.',
      '_failed: HTTP 500_',
    ];
    let last = -1;
    for (const s of order) {
      const i = md.indexOf(s);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
  });

  it('handles an empty session', () => {
    expect(
      sessionToMarkdown({ ...record, segments: [], suggestions: [], contextNote: '' }),
    ).toContain('_Nothing was transcribed._');
  });

  it('renders JSON that round-trips', () => {
    const parsed = JSON.parse(sessionToJson(record));
    expect(parsed.version).toBe(1);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.suggestions[0].trigger).toBe('auto');
  });
});
