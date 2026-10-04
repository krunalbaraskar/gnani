import { tokenize } from './text-normalize.ts';

/**
 * Question words that can appear anywhere in a sentence. Covers English, Hindi
 * (Devanagari and romanised/Hinglish spellings) and a little Tamil/Tanglish.
 * Kept as single tokens so matching works across scripts without regex word
 * boundaries (which don't understand Devanagari).
 */
const QUESTION_WORDS = new Set([
  // English
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'which',
  // Hinglish (romanised Hindi), common spelling variants
  'kya',
  'kyaa',
  'kaise',
  'kaisa',
  'kaisi',
  'kab',
  'kyun',
  'kyu',
  'kyon',
  'kyoon',
  'kitna',
  'kitne',
  'kitni',
  'kaun',
  'kaunsa',
  'kaunsi',
  'kaunse',
  'kon',
  'konsa',
  'kahan',
  'kahaan',
  'kaha',
  'kidhar',
  'kis',
  'kisko',
  'kiska',
  'kiski',
  'kiske',
  // Hindi (Devanagari)
  'क्या',
  'कैसे',
  'कैसा',
  'कैसी',
  'कब',
  'क्यों',
  'क्यूँ',
  'क्यूं',
  'कितना',
  'कितने',
  'कितनी',
  'कौन',
  'कौनसा',
  'कौनसी',
  'कहाँ',
  'कहां',
  'किधर',
  'किसको',
  'किसका',
  'किसकी',
  'किसके',
  // Tanglish / Tamil
  'enna',
  'eppadi',
  'eppo',
  'epdi',
  'yen',
  'evlo',
  'evvalavu',
  'yaar',
  'enga',
  'engae',
  'என்ன',
  'எப்படி',
  'எப்போது',
  'எப்போ',
  'ஏன்',
  'எவ்வளவு',
  'யார்',
  'எங்கே',
]);

/** English auxiliaries that make a question only when they open the sentence. */
const LEADING_AUXILIARIES = new Set([
  'can',
  'could',
  'would',
  'will',
  'should',
  'shall',
  'do',
  'does',
  'did',
  'is',
  'are',
  'was',
  'were',
  'have',
  'has',
  'may',
  'any',
]);

/** Tag endings that turn a statement into a question ("theek hai na", "right"). */
const TAG_ENDINGS = new Set(['na', 'naa', 'nah', 'right', 'correct', 'na?', 'ना', 'न']);

/** Phrases that contain a question word but are exclamations, not questions. */
const NOT_QUESTIONS: readonly string[][] = [
  ['kya', 'baat'],
  ['क्या', 'बात'],
  ['what', 'a'],
  ['kya', 'hi'],
  ['जो', 'भी'],
];

export type QuestionReason = 'question-mark' | 'question-word' | 'leading-auxiliary' | 'tag';

export interface QuestionResult {
  isQuestion: boolean;
  reason?: QuestionReason;
  /** The token that triggered the match, for debugging/UI. */
  matched?: string;
}

function containsPhrase(tokens: string[], phrase: readonly string[]): boolean {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Heuristic: does this utterance look like a question the user should answer?
 * Pure and cheap, so it can run on every final segment from "them".
 */
export function detectQuestion(text: string): QuestionResult {
  const trimmed = text.trim();
  if (!trimmed) return { isQuestion: false };
  // Full-width and Arabic question marks too.
  if (/[?？؟]\s*["'”’)]*$/u.test(trimmed)) return { isQuestion: true, reason: 'question-mark' };

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { isQuestion: false };

  const exclamation = NOT_QUESTIONS.some((p) => containsPhrase(tokens, p));
  if (!exclamation) {
    const word = tokens.find((t) => QUESTION_WORDS.has(t));
    if (word) return { isQuestion: true, reason: 'question-word', matched: word };
  }
  if (tokens.length >= 3 && LEADING_AUXILIARIES.has(tokens[0]!)) {
    return { isQuestion: true, reason: 'leading-auxiliary', matched: tokens[0] };
  }
  const last = tokens[tokens.length - 1]!;
  if (tokens.length >= 2 && TAG_ENDINGS.has(last)) {
    return { isQuestion: true, reason: 'tag', matched: last };
  }
  // A question word plus a "?" anywhere mid-sentence ("kitna? I mean monthly") still counts.
  if (/[?？؟]/u.test(trimmed)) return { isQuestion: true, reason: 'question-mark' };
  return { isQuestion: false };
}

export function looksLikeQuestion(text: string): boolean {
  return detectQuestion(text).isQuestion;
}
