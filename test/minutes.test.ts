import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/core/llm/types.ts';
import {
  cleanMinutes,
  generateMinutes,
  parseActionItems,
  splitTranscript,
  unverifiedFigures,
} from '../src/core/minutes/minutes.ts';
import { minutesDocument } from '../src/core/minutes/document.ts';
import type { SessionRecord } from '../src/core/session/types.ts';

const START = new Date(2026, 9, 26, 14, 5).getTime();

function record(lines: ['me' | 'them', string][], gapMs = 20_000): SessionRecord {
  return {
    startedAt: START,
    endedAt: START + lines.length * gapMs + 1000,
    sttLanguage: 'hi-IN',
    outputLanguage: 'same',
    contextNote: 'Quarterly order review with Mehta Hardware',
    audioMode: 'live',
    echoesRemoved: 0,
    suggestions: [],
    segments: lines.map(([speaker, text], i) => ({
      id: `${speaker}:${i}`,
      speaker,
      text,
      at: START + (i + 1) * gapMs,
    })),
  };
}

/** Replies by request kind; records every request. */
function fakeLlm(reply: (req: LlmRequest) => string): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: 'fake',
    calls,
    async *streamChat(req) {
      calls.push(req);
      for (const word of reply(req).match(/\S+\s*/g) ?? []) yield word;
    },
  };
}

const MINUTES = [
  '# Order review',
  '## Summary',
  'They will order 140 units at ₹1,180.',
  '## Key points',
  '- Delivery in 7 days',
  '## Decisions',
  '- None recorded.',
  '## Action items',
  '- [ ] **Krunal** — send the quotation on WhatsApp — by Friday',
  '- [x] **Them** - confirm the address',
  '- [ ] Book the truck',
  '## Open questions',
  '- None.',
  '## Next steps',
  '- Call on Monday',
].join('\n');

const system = (req: LlmRequest) => String(req.messages[0]!.content);
const user = (req: LlmRequest) => String(req.messages[1]!.content);

describe('generateMinutes', () => {
  it('writes the minutes in one request for a short meeting', async () => {
    const llm = fakeLlm(() => MINUTES);
    const progress: string[] = [];
    const r = await generateMinutes(
      llm,
      {
        record: record([
          ['them', 'We will take 140 units at 1,180 rupees.'],
          ['me', 'Delivery in 7 days. I will send the quotation on WhatsApp by Friday.'],
        ]),
        myName: 'Krunal',
        language: 'English',
        notes: 'Call them Monday',
      },
      { onProgress: (p) => progress.push(p.stage) },
    );
    expect(llm.calls).toHaveLength(1);
    expect(system(llm.calls[0]!)).toContain('Write in English');
    expect(user(llm.calls[0]!)).toContain('[00:20] Them: We will take 140 units');
    expect(user(llm.calls[0]!)).toContain('[00:40] Krunal: Delivery in 7 days');
    expect(user(llm.calls[0]!)).toContain('Quarterly order review');
    expect(user(llm.calls[0]!)).toContain('Call them Monday');
    expect(progress.every((p) => p === 'writing')).toBe(true);

    expect(r.title).toBe('Order review');
    expect(r.markdown.startsWith('# Order review\n\n**Date:**')).toBe(true);
    expect(r.markdown).toContain('**With:** Krunal, Them');
    expect(r.unverifiedFigures).toEqual([]);
    expect(r.actionItems).toEqual([
      { owner: 'Krunal', text: 'send the quotation on WhatsApp — by Friday', done: false },
      { owner: 'Them', text: 'confirm the address', done: true },
      { owner: undefined, text: 'Book the truck', done: false },
    ]);
  });

  it('flags figures nobody said and keeps a title the user chose', async () => {
    const llm = fakeLlm(() => MINUTES.replace('140 units', '150 units'));
    const r = await generateMinutes(llm, {
      record: record([['them', 'We will take 140 units at 1,180 rupees, delivery in 7 days.']]),
      myName: '',
      language: 'English',
      title: 'Mehta call',
    });
    expect(r.unverifiedFigures).toEqual(['150']);
    expect(r.title).toBe('Mehta call');
    expect(r.markdown).toMatch(/^# Mehta call\n/);
    expect(r.markdown).toContain('**With:** Me, Them');
  });

  it('takes notes per part, then writes from the notes, for a long meeting', async () => {
    const lines = Array.from(
      { length: 60 },
      (_, i) =>
        [i % 2 ? 'me' : 'them', `Line ${i} about the order and the delivery schedule.`] as [
          'me' | 'them',
          string,
        ],
    );
    const llm = fakeLlm((req) =>
      system(req).includes('You take notes on part') ? '- Topics: the order' : MINUTES,
    );
    const progress: string[] = [];
    await generateMinutes(
      llm,
      { record: record(lines), myName: 'Krunal', language: 'English' },
      {
        singlePassChars: 1000,
        partChars: 800,
        onProgress: (p) => progress.push(p.stage === 'notes' ? `${p.part}/${p.parts}` : 'w'),
      },
    );
    const parts = llm.calls.filter((c) => system(c).includes('You take notes on part'));
    expect(parts.length).toBeGreaterThan(2);
    expect(llm.calls).toHaveLength(parts.length + 1);
    expect(user(llm.calls.at(-1)!)).toContain('Notes taken on each part');
    expect(user(llm.calls.at(-1)!)).toContain(`Part ${parts.length}:\n- Topics: the order`);
    expect(progress[0]).toBe(`1/${parts.length}`);
  });

  it('refuses an empty meeting without calling the model', async () => {
    const llm = fakeLlm(() => MINUTES);
    await expect(
      generateMinutes(llm, { record: record([]), myName: '', language: 'English' }),
    ).rejects.toThrow(/Nothing was transcribed/);
    expect(llm.calls).toHaveLength(0);
  });
});

describe('minutes helpers', () => {
  it('cleans a fenced reply and text before the title', () => {
    expect(cleanMinutes('```markdown\n# T\n## Summary\nx\n```')).toBe('# T\n## Summary\nx');
    expect(cleanMinutes('Sure! Here are the minutes:\n# T\nbody')).toBe('# T\nbody');
    expect(cleanMinutes('## Summary\nx')).toBe('# Meeting notes\n\n## Summary\nx');
  });

  it('reads action items only from their section', () => {
    const md =
      '## Key points\n- [ ] not an action\n## Action items\n- [ ] **A**: do it\n## Next steps\n- [ ] no';
    expect(parseActionItems(md)).toEqual([{ owner: 'A', text: 'do it', done: false }]);
    expect(parseActionItems('# nothing')).toEqual([]);
  });

  it('splits on whole lines and cuts only an over-long line', () => {
    expect(splitTranscript('aaaa\nbbbb\ncccc', 9)).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(splitTranscript('x'.repeat(10), 4)).toEqual(['xxxx', 'xxxx', 'xx']);
  });

  it('compares figures the way answers do', () => {
    expect(unverifiedFigures('₹1,180 and 7 days', ['1180 rupees, 7 din'])).toEqual([]);
    expect(unverifiedFigures('12 boxes', ['10 boxes'])).toEqual(['12']);
  });

  it('builds a printable page with everything escaped', () => {
    const html = minutesDocument('<b>T</b>', '# Hi <script>alert(1)</script>');
    expect(html).toContain('<title>&lt;b&gt;T&lt;/b&gt;</title>');
    expect(html).not.toContain('<script>');
    expect(html).toContain("default-src 'none'");
  });
});
