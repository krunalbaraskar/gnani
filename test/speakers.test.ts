import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/core/llm/types.ts';
import { MeetingService } from '../src/core/meetings/service.ts';
import { guessSpeakers, knownSpeakers, parseGuesses } from '../src/core/meetings/speakers.ts';
import { MeetingStore, newMeeting } from '../src/core/meetings/store.ts';
import { generateMinutes } from '../src/core/minutes/minutes.ts';
import type { SessionRecord } from '../src/core/session/types.ts';
import { participants, speakerOf } from '../src/shared/speakers.ts';
import { formatTranscript } from '../src/shared/transcript/format.ts';
import type { Speaker } from '../src/shared/transcript/types.ts';

const T0 = 1_790_000_000_000;

function record(lines: [Speaker, string][], extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startedAt: T0,
    endedAt: T0 + 60_000,
    sttLanguage: 'en-IN',
    outputLanguage: 'same',
    contextNote: '',
    audioMode: 'live',
    echoesRemoved: 0,
    suggestions: [],
    segments: lines.map(([speaker, text], i) => ({
      id: `${speaker}:${i}`,
      speaker,
      text,
      at: T0 + (i + 1) * 20_000, // far enough apart not to merge
    })),
    ...extra,
  };
}

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

const CALL = record([
  ['me', 'Hi Rohan, hi Priya. Rohan, can you start with the rates?'],
  ['them', 'Sure, the bulk rate is 1,180.'],
  ['me', 'Thanks. Priya, delivery?'],
  ['them', 'Delivery in 7 days.'],
  ['them', 'And I can confirm the address today.'],
]);

describe('speaker names', () => {
  const names = { them: 'Mehta Hardware', byLine: { 'them:3': 'Priya' } };

  it('labels each line: my name, the line’s name, the side’s name, or Them', () => {
    expect(speakerOf({ id: 'me:0', speaker: 'me' }, 'Krunal', names)).toBe('Krunal');
    expect(speakerOf({ id: 'them:3', speaker: 'them' }, '', names)).toBe('Priya');
    expect(speakerOf({ id: 'them:1', speaker: 'them' }, '', names)).toBe('Mehta Hardware');
    expect(speakerOf({ id: 'them:1', speaker: 'them' }, '', undefined)).toBe('Them');
  });

  it('lists participants without repeats, and Them only when nobody is named', () => {
    expect(participants('Krunal', names, ['krunal', 'Rohan'], CALL.segments)).toEqual([
      'Krunal',
      'Rohan',
      'Mehta Hardware',
      'Priya',
    ]);
    expect(participants('', undefined, [], CALL.segments)).toEqual(['Me', 'Them']);
  });

  it('formats a transcript with names, merging only lines of the same person', () => {
    const segs = CALL.segments.map((s) => ({ ...s, at: T0 + Number(s.id.split(':')[1]) * 1000 }));
    expect(
      formatTranscript(segs, {
        startAt: T0,
        nameOf: (seg) =>
          speakerOf(seg, 'Krunal', {
            byLine: { 'them:1': 'Rohan', 'them:3': 'Priya', 'them:4': 'Priya' },
          }),
      }).split('\n'),
    ).toEqual([
      '[00:00] Krunal: Hi Rohan, hi Priya. Rohan, can you start with the rates?',
      '[00:01] Rohan: Sure, the bulk rate is 1,180.',
      '[00:02] Krunal: Thanks. Priya, delivery?',
      '[00:03] Priya: Delivery in 7 days. And I can confirm the address today.',
    ]);
  });
});

describe('guessSpeakers', () => {
  it('parses "n: name" lines for the lines it asked about only', () => {
    const guesses = parseGuesses(
      '2: Rohan\n4: **Priya**\n5: ?\n1: Krunal\nnoise',
      new Set([2, 4, 5]),
    );
    expect([...guesses]).toEqual([
      [2, 'Rohan'],
      [4, 'Priya'],
    ]);
  });

  it('accepts names that are known or said, and drops invented ones', async () => {
    const llm = fakeLlm(() => '2: rohan\n4: Priya\n5: Suresh');
    const guesses = await guessSpeakers(llm, CALL.segments, {
      myName: 'Krunal',
      attendees: ['Rohan Mehta', 'Rohan'],
    });
    // "rohan" matches the invite's spelling; Priya was said; Suresh never was.
    expect(guesses).toEqual({ 'them:1': 'Rohan', 'them:3': 'Priya' });
    const user = String(llm.calls[0]!.messages[1]!.content);
    expect(user).toContain('1 [Krunal] Hi Rohan');
    expect(user).toContain('2 [them] Sure, the bulk rate is 1,180.');
    expect(String(llm.calls[0]!.messages[0]!.content)).toContain('Rohan Mehta, Rohan');
  });

  it('collects known names from the invite and earlier choices', () => {
    expect(
      knownSpeakers(['Rohan', ' '], { them: 'Them', byLine: { x: 'Priya', y: 'rohan' } }),
    ).toEqual(['rohan', 'Priya']);
  });
});

describe('speakers in the library', () => {
  function service(reply: string) {
    return new MeetingService({
      store: new MeetingStore(mkdtempSync(join(tmpdir(), 'echo-speakers-'))),
      llm: () => fakeLlm(() => reply),
      writer: () => ({ myName: 'Krunal', language: 'English' }),
      emit: () => {},
    });
  }

  it('a calendar meeting keeps the invite title and names a 1:1 counterpart', () => {
    const m = newMeeting(
      record([], { title: 'Mehta pricing', attendees: ['Krunal', 'Mehta Hardware'] }),
      'krunal',
    );
    expect(m).toMatchObject({
      title: 'Mehta pricing',
      titleEdited: true,
      speakers: { them: 'Mehta Hardware' },
    });
    expect(newMeeting(record([], { attendees: ['A', 'B'] })).speakers).toBeUndefined();
  });

  it('keeps names the user set, replaces old guesses, and confirms a guess when picked', async () => {
    const s = service('2: Rohan\n4: Priya\n5: Priya');
    const m = await s.saveRecord(CALL);
    await s.update(m.id, { lineSpeaker: { id: 'them:4', name: 'Rohan' } });
    expect(await s.guessSpeakers(m.id)).toBe(2);
    let d = (await s.detail(m.id))!;
    expect(d.speakers.byLine).toEqual({ 'them:1': 'Rohan', 'them:3': 'Priya', 'them:4': 'Rohan' });
    expect(d.speakers.guessed?.sort()).toEqual(['them:1', 'them:3']);

    d = (await s.update(m.id, { lineSpeaker: { id: 'them:3', name: 'Priya' } }))!;
    expect(d.speakers.guessed).toEqual(['them:1']);
    d = (await s.update(m.id, { lineSpeaker: { id: 'them:1', name: '' }, themName: '  Mehta  ' }))!;
    expect(d.speakers).toMatchObject({ them: 'Mehta', guessed: [] });
    expect(d.speakers.byLine).not.toHaveProperty('them:1');
    // Only "them" lines can be named.
    d = (await s.update(m.id, { lineSpeaker: { id: 'me:0', name: 'X' } }))!;
    expect(d.speakers.byLine).not.toHaveProperty('me:0');
  });

  it('writes minutes with the names and the invited people', async () => {
    const llm = fakeLlm(() => '# Rates\n## Summary\nRates were agreed.');
    const r = await generateMinutes(llm, {
      record: { ...CALL, attendees: ['Rohan', 'Priya'] },
      myName: 'Krunal',
      language: 'English',
      names: { byLine: { 'them:1': 'Rohan' } },
      attendees: ['Rohan', 'Priya'],
    });
    const user = String(llm.calls[0]!.messages[1]!.content);
    expect(user).toContain('Invited: Rohan, Priya.');
    expect(user).toContain('Rohan: Sure, the bulk rate is 1,180.');
    expect(user).toContain('Them: Delivery in 7 days.');
    expect(r.markdown).toContain('**With:** Krunal, Rohan, Priya');
  });
});
