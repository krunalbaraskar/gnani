/** User settings. Persisted as JSON by the main process. Contains no secrets. */

export type OutputLanguage = 'english' | 'same' | 'hinglish';
export type AudioMode = 'live' | 'file';
/**
 * How much Bolo does during a meeting. silent = transcribe only (answers only when asked) ·
 * assist = answers when asked, meanings under mixed-language lines · active = also answers
 * their questions on its own.
 */
export type MeetingMode = 'silent' | 'assist' | 'active';
export const MEETING_MODES: readonly MeetingMode[] = ['silent', 'assist', 'active'];

export interface Settings {
  /** See MeetingMode. Read on every line, so switching mid-meeting applies at once. */
  mode: MeetingMode;
  /** The user's name: "Me" in the minutes, and who action items are assigned to. */
  myName: string;
  /** Write the minutes as soon as a meeting ends. */
  autoMinutes: boolean;
  /** Answers may also come from the minutes and notes of past meetings. */
  useMeetings: boolean;
  /**
   * Comma-separated words that raise an alert when they say them (projects, clients, other
   * spellings of my name). My name always counts.
   */
  watchWords: string;
  /** Gnani language code (see GNANI_LANGUAGES). */
  sttLanguage: string;
  /** Numbers, currency and dates as digits (Gnani ITN; Hindi and English only). */
  formatNumbers: boolean;
  outputLanguage: OutputLanguage;
  /** Free-text context sent with every suggestion request. */
  contextNote: string;
  /** Empty = use LLM_BASE_URL / LLM_MODEL from the environment. Keys are env-only. */
  llmBaseUrl: string;
  llmModel: string;
  /** Minutes of transcript sent to the LLM. */
  transcriptMinutes: number;
  /** Skip sending long silences to the STT to save credits. */
  silenceGate: boolean;
  silenceThresholdDb: number;
  /** Drop "me" segments that are the speakers' echo of "them". */
  echoDedupe: boolean;
  audioMode: AudioMode;
  /** '' = system default microphone. */
  micDeviceId: string;
  /** File replay playback rate (1 = real time). */
  replaySpeed: number;
  /** Also play replayed audio through the speakers. */
  replayAudible: boolean;
  /** Also write each meeting as .md/.json files here. '' = only the meeting library. */
  exportDir: string;
  autoExport: boolean;
  consentAcknowledged: boolean;
  /** Which version of the consent notice was accepted (see CONSENT_VERSION). */
  consentVersion: number;
  overlayOpacity: number;
  /** Folder of reference files answers are grounded in. '' = none. Set only via the folder dialog. */
  contextDir: string;
  /** Characters of file content sent with each answer request. */
  contextBudgetChars: number;
  /** Gnani language code the user reads; meanings of mixed-language lines are written in it. */
  myLanguage: string;
  /** Show a plain meaning under "them" lines that mix in other languages. */
  explainThem: boolean;
  /** Model that accepts images, for screen questions. '' = screen reading is off. */
  llmVisionModel: string;
}

/**
 * Bumped when the consent notice starts disclosing something new (2: files and screen;
 * 3: meeting library and minutes; 4: past meetings in answers).
 */
export const CONSENT_VERSION = 4;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'active',
  myName: '',
  autoMinutes: true,
  useMeetings: true,
  watchWords: '',
  sttLanguage: 'hi-IN',
  formatNumbers: false,
  outputLanguage: 'same',
  contextNote: '',
  llmBaseUrl: '',
  llmModel: '',
  transcriptMinutes: 3,
  silenceGate: false,
  silenceThresholdDb: -50,
  echoDedupe: true,
  audioMode: 'file',
  micDeviceId: '',
  replaySpeed: 1,
  replayAudible: true,
  exportDir: '',
  autoExport: true,
  consentAcknowledged: false,
  consentVersion: 0,
  overlayOpacity: 0.94,
  contextDir: '',
  contextBudgetChars: 24_000,
  myLanguage: 'en-IN',
  explainThem: true,
  llmVisionModel: '',
};

const OUTPUT_LANGUAGES: readonly OutputLanguage[] = ['english', 'same', 'hinglish'];
const AUDIO_MODES: readonly AudioMode[] = ['live', 'file'];

function pick<T>(value: unknown, fallback: T, valid: (v: unknown) => boolean): T {
  return valid(value) ? (value as T) : fallback;
}
const isString = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';
const inRange = (lo: number, hi: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * https anywhere. Plain http only to this machine or the local network (Ollama, vLLM): the
 * API key, transcript and files travel in this request.
 */
export function isSafeLlmUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  const host = url.hostname;
  const local =
    !host.includes('.') || // localhost, [::1], a machine name on the LAN
    /^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|\.local$/.test(host);
  return url.protocol === 'http:' && local;
}

/** Merges untrusted input (file on disk, IPC from the renderer) over a base, field by field. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = base;
  return {
    mode: pick(
      i['mode'],
      // Before modes, auto-suggest off was the closest thing to "assist".
      i['autoSuggest'] === false && base === DEFAULT_SETTINGS ? 'assist' : d.mode,
      (v) => MEETING_MODES.includes(v as MeetingMode),
    ),
    myName: pick(i['myName'], d.myName, (v) => isString(v) && (v as string).length <= 80),
    autoMinutes: pick(i['autoMinutes'], d.autoMinutes, isBool),
    useMeetings: pick(i['useMeetings'], d.useMeetings, isBool),
    watchWords: pick(
      i['watchWords'],
      d.watchWords,
      (v) => isString(v) && (v as string).length <= 300,
    ),
    sttLanguage: pick(
      i['sttLanguage'],
      d.sttLanguage,
      // One locale or indic-auto: Gnani refuses lists and en-hi-in-cm, so old saved values reset.
      (v) => isString(v) && /^(?:[a-z]{2}-[A-Z]{2}|indic-auto)$/.test(v as string),
    ),
    formatNumbers: pick(i['formatNumbers'], d.formatNumbers, isBool),
    outputLanguage: pick(i['outputLanguage'], d.outputLanguage, (v) =>
      OUTPUT_LANGUAGES.includes(v as OutputLanguage),
    ),
    contextNote: pick(
      i['contextNote'],
      d.contextNote,
      (v) => isString(v) && (v as string).length <= 2000,
    ),
    llmBaseUrl: pick(
      i['llmBaseUrl'],
      d.llmBaseUrl,
      (v) => isString(v) && (v === '' || isSafeLlmUrl(v as string)),
    ),
    llmModel: pick(i['llmModel'], d.llmModel, (v) => isString(v) && (v as string).length <= 200),
    transcriptMinutes: pick(i['transcriptMinutes'], d.transcriptMinutes, inRange(0.5, 30)),
    silenceGate: pick(i['silenceGate'], d.silenceGate, isBool),
    silenceThresholdDb: pick(i['silenceThresholdDb'], d.silenceThresholdDb, inRange(-90, -10)),
    echoDedupe: pick(i['echoDedupe'], d.echoDedupe, isBool),
    audioMode: pick(i['audioMode'], d.audioMode, (v) => AUDIO_MODES.includes(v as AudioMode)),
    micDeviceId: pick(i['micDeviceId'], d.micDeviceId, isString),
    replaySpeed: pick(i['replaySpeed'], d.replaySpeed, inRange(0.25, 16)),
    replayAudible: pick(i['replayAudible'], d.replayAudible, isBool),
    exportDir: pick(i['exportDir'], d.exportDir, isString),
    autoExport: pick(i['autoExport'], d.autoExport, isBool),
    consentAcknowledged: pick(i['consentAcknowledged'], d.consentAcknowledged, isBool),
    consentVersion: pick(i['consentVersion'], d.consentVersion, inRange(0, 100)),
    overlayOpacity: pick(i['overlayOpacity'], d.overlayOpacity, inRange(0.3, 1)),
    contextDir: pick(i['contextDir'], d.contextDir, isString),
    contextBudgetChars: pick(
      i['contextBudgetChars'],
      d.contextBudgetChars,
      inRange(4_000, 100_000),
    ),
    myLanguage: pick(
      i['myLanguage'],
      d.myLanguage,
      (v) => isString(v) && /^[a-z]{2}-[A-Z]{2}$/.test(v as string),
    ),
    explainThem: pick(i['explainThem'], d.explainThem, isBool),
    llmVisionModel: pick(
      i['llmVisionModel'],
      d.llmVisionModel,
      (v) => isString(v) && (v as string).length <= 200,
    ),
  };
}
