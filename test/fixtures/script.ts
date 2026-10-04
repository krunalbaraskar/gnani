/**
 * Synthetic demo conversation (fictional people and company). In the WAV fixtures each
 * line is a tone at `freqHz`; the mock Gnani server maps the tone back to this text.
 */
import type { ScriptLine } from '../mock/mock-gnani-server.ts';

export const THEM_LINES = {
  greeting: { freqHz: 310, text: 'Hello, haan ji, aapne term insurance ke liye call kiya tha.' },
  question: { freqHz: 420, text: 'Achha, premium kitna hoga monthly, aur tax benefit milega?' },
  closing: { freqHz: 530, text: 'Theek hai, brochure WhatsApp pe bhej dijiye.' },
} satisfies Record<string, ScriptLine>;

export const ME_LINES = {
  intro: { freqHz: 640, text: 'Ji, main Rohan bol raha hoon, Suraksha Life se.' },
  answer: { freqHz: 750, text: 'Bilkul, main abhi details share karta hoon.' },
} satisfies Record<string, ScriptLine>;

export const SCRIPT: ScriptLine[] = [...Object.values(THEM_LINES), ...Object.values(ME_LINES)];

/** Seconds; each utterance is a tone burst. */
export const THEM_TIMELINE = [
  { at: 0.3, dur: 0.8, freqHz: THEM_LINES.greeting.freqHz, amp: 0.4 },
  { at: 2.6, dur: 0.8, freqHz: THEM_LINES.question.freqHz, amp: 0.4 },
  { at: 4.6, dur: 0.8, freqHz: THEM_LINES.closing.freqHz, amp: 0.4 },
];

/** The first "me" burst is the speaker echo of THEM's greeting picked up by the mic. */
export const ME_TIMELINE = [
  { at: 0.33, dur: 0.8, freqHz: THEM_LINES.greeting.freqHz, amp: 0.12 },
  { at: 1.6, dur: 0.7, freqHz: ME_LINES.intro.freqHz, amp: 0.4 },
  { at: 3.8, dur: 0.6, freqHz: ME_LINES.answer.freqHz, amp: 0.4 },
];

export const FIXTURE_SECONDS = 6;
