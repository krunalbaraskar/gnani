import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../shared/ipc.ts';
import { MEETING_MODES, type OutputLanguage, type Settings } from '../../../shared/settings.ts';
import type { ReplayFiles } from '../audio/file-replay.ts';
import { MODE_INFO } from './Bar.tsx';

export type ReplaySelection = ReplayFiles & { meName?: string; themName?: string };

interface Props {
  app: AppState;
  running: boolean;
  files: ReplaySelection;
  onFiles: (f: ReplaySelection) => void;
  onLoadDemo: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onChooseExportDir: () => void;
}

/** Text field that saves on blur/Enter, not on every keystroke. */
export function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => draft !== value && commit(draft),
  };
}

export function SettingsPanel({
  app,
  running,
  files,
  onFiles,
  onLoadDemo,
  onChange,
  onChooseExportDir,
}: Props) {
  const s = app.settings;
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const meInput = useRef<HTMLInputElement>(null);
  const themInput = useRef<HTMLInputElement>(null);
  const lang = app.languages.find((l) => l.code === s.sttLanguage);
  const vision = useDraft(s.llmVisionModel, (v) => onChange({ llmVisionModel: v.trim() }));
  const pick = async (speaker: 'me' | 'them', list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    onFiles({ ...files, [speaker]: buf, [`${speaker}Name`]: file.name });
  };
  const baseUrl = useDraft(s.llmBaseUrl, (v) => onChange({ llmBaseUrl: v.trim() }));
  const model = useDraft(s.llmModel, (v) => onChange({ llmModel: v.trim() }));

  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((d) => setMics(d.filter((x) => x.kind === 'audioinput')))
        .catch(() => setMics([]));
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, []);

  return (
    <div
      className="settings"
      role="tabpanel"
      id="overlay-panel-settings"
      aria-labelledby="overlay-tab-settings"
    >
      <fieldset>
        <legend>Audio</legend>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              name="audio-mode"
              checked={s.audioMode === 'live'}
              onChange={() => onChange({ audioMode: 'live' })}
            />
            Live: mic + system audio
          </label>
          <label>
            <input
              type="radio"
              name="audio-mode"
              checked={s.audioMode === 'file'}
              onChange={() => onChange({ audioMode: 'file' })}
            />
            Replay WAV files
          </label>
        </div>
        {s.audioMode === 'live' ? (
          <label>
            Microphone (Me)
            <select
              value={s.micDeviceId}
              onChange={(e) => onChange({ micDeviceId: e.target.value })}
            >
              <option value="">System default</option>
              {mics
                .filter(
                  (m) => m.deviceId && m.deviceId !== 'default' && m.deviceId !== 'communications',
                )
                .map((m, i) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
            <span className="muted small">
              Them = everything your PC plays (Zoom, Meet, Teams…).
            </span>
          </label>
        ) : (
          <>
            <div className="file-row">
              <button
                className="ghost small"
                disabled={running}
                onClick={() => themInput.current?.click()}
                title="WAV with the other side"
              >
                Them: {files.themName ?? 'choose WAV'}
              </button>
              <button
                className="ghost small"
                disabled={running}
                onClick={() => meInput.current?.click()}
                title="WAV with your side"
              >
                Me: {files.meName ?? 'choose WAV'}
              </button>
              <button
                className="ghost small"
                disabled={running}
                onClick={onLoadDemo}
                title="Load demo-audio/me.wav and them.wav"
              >
                Demo
              </button>
              <input
                ref={themInput}
                type="file"
                accept=".wav,audio/wav"
                hidden
                onChange={(e) => void pick('them', e.target.files)}
              />
              <input
                ref={meInput}
                type="file"
                accept=".wav,audio/wav"
                hidden
                onChange={(e) => void pick('me', e.target.files)}
              />
            </div>
            <div className="row">
              <label>
                Speed
                <select
                  value={s.replaySpeed}
                  onChange={(e) => onChange({ replaySpeed: Number(e.target.value) })}
                >
                  {[1, 1.5, 2, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.replayAudible}
                  onChange={(e) => onChange({ replayAudible: e.target.checked })}
                />
                Play aloud
              </label>
            </div>
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={s.echoDedupe}
            onChange={(e) => onChange({ echoDedupe: e.target.checked })}
          />
          Remove speaker echo from my mic (use headphones if you can)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.silenceGate}
            onChange={(e) => onChange({ silenceGate: e.target.checked })}
          />
          Silence gate — don’t stream silence (saves credits)
        </label>
        {s.silenceGate && (
          <label>
            Gate threshold: {s.silenceThresholdDb} dBFS
            <input
              type="range"
              min={-70}
              max={-25}
              value={s.silenceThresholdDb}
              onChange={(e) => onChange({ silenceThresholdDb: Number(e.target.value) })}
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Keys (from .env — never shown here)</legend>
        <p className={app.keys.stt ? 'ok' : 'error-text'}>
          {app.stt.keyVar}: {app.keys.stt ? 'found' : 'missing — add it to .env and restart'}
        </p>
        <p className="muted small">
          Speech-to-text: {app.stt.name} at {app.stt.url}
        </p>
        <p className={app.keys.llm ? 'ok' : 'muted'}>
          LLM_API_KEY: {app.keys.llm ? 'found' : 'not set (fine for a local Ollama/vLLM server)'}
        </p>
      </fieldset>

      <fieldset>
        <legend>Speech-to-text (Gnani)</legend>
        <label>
          Conversation language
          <select value={s.sttLanguage} onChange={(e) => onChange({ sttLanguage: e.target.value })}>
            {app.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {lang?.experimental && (
          <p className="warn small">
            Experimental: accuracy not tested yet. If lines look wrong, pick the call’s language.
          </p>
        )}
        {lang?.supportsItn && (
          <label className="check">
            <input
              type="checkbox"
              checked={s.formatNumbers}
              onChange={(e) => onChange({ formatNumbers: e.target.checked })}
            />
            Write numbers and amounts as digits (₹1,200 instead of “twelve hundred”)
          </label>
        )}
        <p className="muted small">Applies from the next session.</p>
        <label>
          I read
          <select value={s.myLanguage} onChange={(e) => onChange({ myLanguage: e.target.value })}>
            {app.languages
              .filter((l) => !l.experimental)
              .map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.explainThem}
            onChange={(e) => onChange({ explainThem: e.target.checked })}
          />
          Show a plain meaning under their lines that mix in other languages
        </label>
      </fieldset>

      <fieldset>
        <legend>Suggestions</legend>
        <label>Reply language</label>
        <div className="radio-row">
          {(
            [
              ['same', 'Same as the call'],
              ['hinglish', 'Hinglish'],
              ['english', 'English'],
            ] as [OutputLanguage, string][]
          ).map(([v, label]) => (
            <label key={v}>
              <input
                type="radio"
                name="reply-language"
                checked={s.outputLanguage === v}
                onChange={() => onChange({ outputLanguage: v })}
              />
              {label}
            </label>
          ))}
        </div>
        <label>During meetings</label>
        <div className="radio-col">
          {MEETING_MODES.map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="meeting-mode"
                checked={s.mode === m}
                onChange={() => onChange({ mode: m })}
              />
              {MODE_INFO[m].hint}
            </label>
          ))}
        </div>
        <label>
          Transcript sent to the AI: last {s.transcriptMinutes} min
          <input
            type="range"
            min={1}
            max={10}
            value={s.transcriptMinutes}
            onChange={(e) => onChange({ transcriptMinutes: Number(e.target.value) })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>AI model (any OpenAI-compatible API)</legend>
        <label>
          Base URL
          <input
            type="url"
            placeholder={app.llm.baseUrl || 'https://api.openai.com/v1'}
            {...baseUrl}
          />
        </label>
        <label>
          Model
          <input type="text" placeholder={app.llm.model || 'gpt-4o-mini'} {...model} />
        </label>
        <p className="muted small">
          Leave empty to use LLM_BASE_URL / LLM_MODEL from .env. Ollama: http://localhost:11434/v1.
          Use https, except for this computer or your local network.
        </p>
        <label>
          Vision model (for reading the screen)
          <input type="text" placeholder="e.g. gpt-4o-mini — empty turns it off" {...vision} />
        </label>
        <p className="muted small">
          Name a model that accepts images. When you ask with the screen, one picture of it is sent
          to this model; never otherwise.
        </p>
        <label>
          File content sent per answer: {Math.round(s.contextBudgetChars / 1000)}k characters
          <input
            type="range"
            min={4000}
            max={100000}
            step={2000}
            value={s.contextBudgetChars}
            onChange={(e) => onChange({ contextBudgetChars: Number(e.target.value) })}
          />
        </label>
        <p className="muted small">Lower this for small local models.</p>
      </fieldset>

      <fieldset>
        <legend>After the meeting</legend>
        <p className="muted small">
          Every meeting is saved on this computer.{' '}
          <button className="link" onClick={() => window.bolo.openLibrary()}>
            Open Meetings
          </button>
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoMinutes}
            onChange={(e) => onChange({ autoMinutes: e.target.checked })}
          />
          Write the minutes (summary, decisions, action items) as soon as it ends
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoExport}
            onChange={(e) => onChange({ autoExport: e.target.checked })}
          />
          Also save the transcript (Markdown and JSON) to a folder
        </label>
        <div className="row">
          <span className="path" title={s.exportDir}>
            {s.exportDir || 'No folder chosen yet'}
          </span>
          <button className="ghost small" onClick={onChooseExportDir}>
            Choose…
          </button>
          {s.exportDir && (
            <button className="ghost small" onClick={() => window.bolo.openExportDir()}>
              Open
            </button>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Overlay</legend>
        <label>
          Background opacity
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.02}
            value={s.overlayOpacity}
            onChange={(e) => onChange({ overlayOpacity: Number(e.target.value) })}
          />
        </label>
        <p className="muted small">
          Hotkeys: Ctrl+Shift+Space answer · Ctrl+Alt+Space read my screen · Ctrl+Shift+H show/hide
          · Ctrl+Shift+M click-through.
        </p>
      </fieldset>
    </div>
  );
}
