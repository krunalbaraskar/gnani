import type { ChatMessage } from '../llm/types.ts';
import { formatTranscript } from '../../shared/transcript/format.ts';
import type { TranscriptSegment } from '../../shared/transcript/types.ts';
import type { OutputLanguage } from '../../shared/settings.ts';

export type SuggestionTrigger = 'hotkey' | 'auto';

export interface PromptInput {
  segments: readonly TranscriptSegment[];
  contextNote: string;
  outputLanguage: OutputLanguage;
  trigger: SuggestionTrigger;
  /** For auto-suggest: the "them" segment that looked like a question. */
  question?: string;
}

const LANGUAGE_RULES: Record<OutputLanguage, string> = {
  english: 'Reply in simple, natural Indian English.',
  same:
    'Reply in the same language and script the other person used most recently: Hindi in ' +
    'Devanagari, Hinglish in Roman script, Tamil in Tamil script, and so on. If unsure, use Hinglish.',
  hinglish:
    'Reply in Hinglish — Hindi and English mixed the way people speak in Indian cities — ' +
    'written in Roman (Latin) script, e.g. "Ji bilkul, main aapko details WhatsApp kar deta hoon."',
};

export function buildSystemPrompt(outputLanguage: OutputLanguage): string {
  return [
    'You are Bolo, a discreet real-time assistant for someone on a live phone or video call.',
    '"Me" is the user you are helping. "Them" is the other person on the call.',
    'Suggest what Me should say next, as words Me can read out loud right now.',
    '',
    'Rules:',
    '- 1 to 3 short lines, at most about 20 words each. Usually one line is enough.',
    '- Plain spoken text only: no markdown, bullets, numbering, quotes, labels or explanations.',
    '- Be polite, warm and to the point, the way a skilled Indian professional talks.',
    '- Answer what Them just asked or said. If a fact (price, date, policy term) is not in the',
    '  context or transcript, do not invent it: offer to check and confirm, or ask a short question.',
    '- The transcript comes from live speech recognition and may contain mistakes; read through them.',
    `- ${LANGUAGE_RULES[outputLanguage]}`,
  ].join('\n');
}

export function buildSuggestionMessages(input: PromptInput): ChatMessage[] {
  const transcript = formatTranscript(input.segments);
  const parts: string[] = [];
  const note = input.contextNote.trim();
  if (note) parts.push(`About me and this call:\n${note}`);
  parts.push(
    transcript
      ? `Transcript of the last few minutes (oldest first):\n${transcript}`
      : 'The call has just started; nothing has been said yet.',
  );
  if (input.trigger === 'auto' && input.question) {
    parts.push(`Them just asked: "${input.question.trim()}"\nSuggest my answer.`);
  } else {
    parts.push('What should I say next?');
  }
  return [
    { role: 'system', content: buildSystemPrompt(input.outputLanguage) },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Cleans a finished suggestion: strips list markers, wrapping quotes and speaker labels
 * a model may add despite instructions, and keeps at most `maxLines` lines.
 */
export function cleanSuggestion(text: string, maxLines = 3): string {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
        .replace(/^(?:me|you|reply|suggestion)\s*:\s*/i, '')
        .replace(/^["“'‘](.*)["”'’]$/, '$1')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');
}
