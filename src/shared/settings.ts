/** User settings. Persisted as JSON by the main process. Contains no secrets. */

export type OutputLanguage = 'english' | 'same' | 'hinglish';
export type AudioMode = 'live' | 'file';

export interface Settings {
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
  /** Suggest automatically when "them" finishes a question. */
  autoSuggest: boolean;
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
  /** '' = ask on first export. */
  exportDir: string;
  autoExport: boolean;
  consentAcknowledged: boolean;
  overlayOpacity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sttLanguage: 'hi-IN',
  formatNumbers: false,
  outputLanguage: 'same',
  contextNote: '',
  llmBaseUrl: '',
  llmModel: '',
  transcriptMinutes: 3,
  autoSuggest: true,
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
  overlayOpacity: 0.94,
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

/** Merges untrusted input (file on disk, IPC from the renderer) over a base, field by field. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = base;
  return {
    sttLanguage: pick(
      i['sttLanguage'],
      d.sttLanguage,
      (v) => isString(v) && /^[a-zA-Z,-]{2,120}$/.test(v as string),
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
      (v) => isString(v) && (v === '' || /^https?:\/\//.test(v as string)),
    ),
    llmModel: pick(i['llmModel'], d.llmModel, (v) => isString(v) && (v as string).length <= 200),
    transcriptMinutes: pick(i['transcriptMinutes'], d.transcriptMinutes, inRange(0.5, 30)),
    autoSuggest: pick(i['autoSuggest'], d.autoSuggest, isBool),
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
    overlayOpacity: pick(i['overlayOpacity'], d.overlayOpacity, inRange(0.3, 1)),
  };
}
