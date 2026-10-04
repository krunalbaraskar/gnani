import { useEffect, useState } from 'react';
import type { AppState } from '../../../shared/ipc.ts';
import type { OutputLanguage, Settings } from '../../../shared/settings.ts';

interface Props {
  app: AppState;
  onChange: (patch: Partial<Settings>) => void;
  onChooseExportDir: () => void;
}

/** Text field that saves on blur/Enter, not on every keystroke. */
function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => draft !== value && commit(draft),
  };
}

export function SettingsPanel({ app, onChange, onChooseExportDir }: Props) {
  const s = app.settings;
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const lang = app.languages.find((l) => l.code === s.sttLanguage);
  const context = useDraft(s.contextNote, (v) => onChange({ contextNote: v }));
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
    <div className="settings">
      <fieldset>
        <legend>Keys (from .env — never shown here)</legend>
        <p className={app.keys.gnani ? 'ok' : 'error-text'}>
          GNANI_API_KEY: {app.keys.gnani ? 'found' : 'missing — add it to .env and restart'}
        </p>
        <p className="muted small">STT endpoint: {app.sttUrl}</p>
        <p className={app.keys.llm ? 'ok' : 'muted'}>
          LLM_API_KEY: {app.keys.llm ? 'found' : 'not set (fine for a local Ollama/vLLM server)'}
        </p>
      </fieldset>

      <fieldset>
        <legend>Audio</legend>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              checked={s.audioMode === 'live'}
              onChange={() => onChange({ audioMode: 'live' })}
            />
            Live: mic + system audio
          </label>
          <label>
            <input
              type="radio"
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
            Experimental: not in Gnani’s current SDK. If it fails, switch back to Hindi.
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
      </fieldset>

      <fieldset>
        <legend>Suggestions</legend>
        <label>
          Context for the AI
          <textarea
            rows={3}
            placeholder="e.g. I'm selling term insurance; be concise and polite."
            {...context}
          />
        </label>
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
                checked={s.outputLanguage === v}
                onChange={() => onChange({ outputLanguage: v })}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoSuggest}
            onChange={(e) => onChange({ autoSuggest: e.target.checked })}
          />
          Suggest automatically when they ask a question
        </label>
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
          Leave empty to use LLM_BASE_URL / LLM_MODEL from .env. Ollama: http://localhost:11434/v1
        </p>
      </fieldset>

      <fieldset>
        <legend>Export</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoExport}
            onChange={(e) => onChange({ autoExport: e.target.checked })}
          />
          Save transcript + suggestions (Markdown and JSON) when a session ends
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
          Hotkeys: Ctrl+Shift+Space suggest · Ctrl+Shift+H show/hide · Ctrl+Shift+M click-through.
          The overlay is hidden from screen sharing.
        </p>
      </fieldset>
    </div>
  );
}
