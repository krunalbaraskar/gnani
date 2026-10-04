import { describe, expect, it } from 'vitest';
import {
  buildSuggestionMessages,
  buildSystemPrompt,
  cleanSuggestion,
} from '../src/core/suggest/prompt.ts';
import type { TranscriptSegment } from '../src/shared/transcript/types.ts';

const T0 = 1_700_000_000_000;
const segments: TranscriptSegment[] = [
  { id: '1', speaker: 'them', text: 'Hello, aapne term insurance ke liye call kiya tha.', at: T0 },
  { id: '2', speaker: 'me', text: 'Ji, main Rohan bol raha hoon.', at: T0 + 4000 },
  { id: '3', speaker: 'them', text: 'Premium kitna hoga monthly?', at: T0 + 9000 },
];

describe('buildSystemPrompt', () => {
  it.each([
    ['english', /Indian English/],
    ['hinglish', /Roman \(Latin\) script/],
    ['same', /same language and script/],
  ] as const)('includes the %s output-language rule', (lang, re) => {
    expect(buildSystemPrompt(lang)).toMatch(re);
  });

  it('asks for short, speakable replies and forbids invented facts', () => {
    const p = buildSystemPrompt('english');
    expect(p).toMatch(/1 to 3 short lines/);
    expect(p).toMatch(/do not invent/);
  });
});

describe('buildSuggestionMessages', () => {
  it('builds system + user messages with context note and formatted transcript', () => {
    const [system, user] = buildSuggestionMessages({
      segments,
      contextNote: "I'm selling term insurance; be concise and polite.",
      outputLanguage: 'hinglish',
      trigger: 'hotkey',
    });
    expect(system!.role).toBe('system');
    expect(user!.role).toBe('user');
    expect(user!.content).toContain("About me and this call:\nI'm selling term insurance");
    expect(user!.content).toContain(
      '[00:00] Them: Hello, aapne term insurance ke liye call kiya tha.',
    );
    expect(user!.content).toContain('[00:09] Them: Premium kitna hoga monthly?');
    expect(user!.content).toMatch(/What should I say next\?$/);
  });

  it('names the question for auto suggestions and handles an empty call', () => {
    const [, user] = buildSuggestionMessages({
      segments: [],
      contextNote: '  ',
      outputLanguage: 'same',
      trigger: 'auto',
      question: 'Premium kitna hoga?',
    });
    expect(user!.content).not.toContain('About me');
    expect(user!.content).toContain('nothing has been said yet');
    expect(user!.content).toContain('Them just asked: "Premium kitna hoga?"');
  });
});

describe('cleanSuggestion', () => {
  it('strips bullets, numbering, labels and wrapping quotes; keeps 3 lines max', () => {
    const raw =
      '1. "Ji bilkul, main bhej deta hoon."\n- Me: Kal tak confirm karunga.\n\n• Aur kuch?\n4) extra';
    expect(cleanSuggestion(raw)).toBe(
      'Ji bilkul, main bhej deta hoon.\nKal tak confirm karunga.\nAur kuch?',
    );
  });

  it('leaves normal text alone', () => {
    expect(cleanSuggestion('  Premium around ₹1,200 monthly hai.  ')).toBe(
      'Premium around ₹1,200 monthly hai.',
    );
  });
});
