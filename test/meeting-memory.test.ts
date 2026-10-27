import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/core/llm/types.ts';
import { askMeetings, NOT_FOUND } from '../src/core/meetings/ask.ts';
import {
  isMeetingSource,
  meetingChunks,
  meetingSourceName,
  meetingTranscriptChunks,
} from '../src/core/meetings/memory.ts';
import { newMeeting, type StoredMeeting } from '../src/core/meetings/store.ts';
import type { SessionRecord } from '../src/core/session/types.ts';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 20, 11, 0).getTime();

function meeting(
  startedAt: number,
  title: string,
  minutes: string | null,
  lines: string[] = [],
): StoredMeeting {
  const record: SessionRecord = {
    startedAt,
    endedAt: startedAt + 60_000,
    sttLanguage: 'hi-IN',
    outputLanguage: 'same',
    contextNote: '',
    audioMode: 'live',
    echoesRemoved: 0,
    suggestions: [],
    segments: lines.map((text, i) => ({
      id: `them:${i}`,
      speaker: 'them' as const,
      text,
      at: startedAt + (i + 1) * 1000,
    })),
  };
  return {
    ...newMeeting(record),
    title,
    minutes: minutes
      ? { markdown: minutes, generatedAt: startedAt, edited: false, unverifiedFigures: [] }
      : undefined,
  };
}

const pricing = meeting(
  T0,
  'Pricing: Mehta, Q4 [draft]',
  '# Pricing\n## Decisions\n- Bulk rate fixed at ₹1,180 for 50 units or more',
  ['Theek hai, 1,180 final karte hain'],
);
const kickoff = meeting(
  T0 + DAY,
  'Atlas kickoff',
  '# Atlas kickoff\n## Summary\nLaunch on 3 November',
);
const noMinutes = meeting(T0 + 2 * DAY, 'Quick sync', null, ['delivery van is late']);

function fakeLlm(reply: (req: LlmRequest) => string): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: 'fake',
    calls,
    async *streamChat(req) {
      calls.push(req);
      yield reply(req);
    },
  };
}

describe('meeting memory', () => {
  it('names a meeting by date and a title safe for the source line', () => {
    expect(meetingSourceName(pricing)).toBe('meeting 2026-10-20 Pricing Mehta Q4 draft');
    expect(meetingSourceName(pricing, ' transcript')).toMatch(/ transcript$/);
    expect(isMeetingSource('meeting 2026-10-20 x')).toBe(true);
    expect(isMeetingSource('inventory.csv')).toBe(false);
  });

  it('chunks minutes and notes of the newest meetings only', () => {
    const withNotes = { ...noMinutes, notes: 'Call the transporter' };
    const chunks = meetingChunks([pricing, kickoff, withNotes], 2);
    expect([...new Set(chunks.map((c) => c.file))]).toEqual([
      'meeting 2026-10-22 Quick sync',
      'meeting 2026-10-21 Atlas kickoff',
    ]);
    expect(chunks[0]!.text).toContain('My notes:\nCall the transporter');
    expect(meetingChunks([noMinutes])).toEqual([]);
  });

  it('turns transcripts into chunks with speaker labels', () => {
    const [c] = meetingTranscriptChunks([noMinutes], 'Asha');
    expect(c).toEqual({
      file: 'meeting 2026-10-22 Quick sync transcript',
      text: '[00:01] Them: delivery van is late',
    });
  });
});

describe('askMeetings', () => {
  const opts = { myName: 'Asha', budget: 250 };

  it('answers from the matching meetings and links the cited ones', async () => {
    const llm = fakeLlm(
      () =>
        'The bulk rate is ₹1,180 for 50 units or more.\n' +
        '[source: meeting 2026-10-20 Pricing Mehta Q4 draft, meeting 2026-10-20 Pricing Mehta Q4 draft transcript]',
    );
    const r = await askMeetings(llm, [pricing, kickoff, noMinutes], 'bulk rate?', opts);
    expect(r).toEqual({
      text: 'The bulk rate is ₹1,180 for 50 units or more.',
      verdict: 'files',
      sources: [{ name: 'meeting 2026-10-20 Pricing Mehta Q4 draft', meetingId: pricing.id }],
    });
    const user = String(llm.calls[0]!.messages[1]!.content);
    expect(user).toContain('--- meeting 2026-10-20 Pricing Mehta Q4 draft ---');
    expect(user).not.toContain('Atlas'); // over budget and unrelated: not sent
  });

  it('flags a figure that is in no meeting', async () => {
    const llm = fakeLlm(() => 'It is ₹1,250.\n[source: meeting 2026-10-20 Pricing Mehta Q4 draft]');
    const r = await askMeetings(llm, [pricing], 'bulk rate?', opts);
    expect(r.verdict).toBe('unverified');
    expect(r.sources).toEqual([]);
  });

  it('does not call the model when no meeting shares a word with the question', async () => {
    const llm = fakeLlm(() => 'x');
    const r = await askMeetings(llm, [pricing, kickoff], 'zebra crossing?', opts);
    expect(r).toEqual({ text: NOT_FOUND, verdict: 'missing', sources: [] });
    expect(llm.calls).toHaveLength(0);
  });
});
