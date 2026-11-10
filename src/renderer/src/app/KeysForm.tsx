import { useId, useState } from 'react';
import type { KeysPatch, TestKeysResult } from '../../../shared/ipc.ts';
import { Icon } from '../components/Icon.tsx';
import type { SettingsProps } from './MainWindow.tsx';
import { settingsChanged } from './settings-sync.ts';

/** OpenAI-compatible services with a known-good model. Free keys: Gemini and Groq. */
const SERVICES = [
  {
    id: 'gemini',
    label: 'Google Gemini (free key)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    effort: 'low',
    where: 'aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    label: 'Groq (free key)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b',
    effort: 'low',
    where: 'console.groq.com/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    effort: '',
    where: 'platform.openai.com/api-keys',
  },
] as const;

type ServiceId = (typeof SERVICES)[number]['id'] | 'custom';

const sameBase = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/**
 * Lets the user paste their API keys into Echo. Keys go one way, to the main process, which
 * writes them to %APPDATA%\Echo\.env; the form only ever learns whether a key is saved.
 */
export function KeysForm({
  app,
  refresh,
  notify,
}: Pick<SettingsProps, 'app' | 'refresh' | 'notify'>) {
  const id = useId();
  const env = app.envLlm;
  const initial: ServiceId =
    SERVICES.find((s) => env.baseUrl && sameBase(s.baseUrl, env.baseUrl))?.id ??
    (env.baseUrl ? 'custom' : 'gemini');
  const [service, setService] = useState<ServiceId>(initial);
  const preset = SERVICES.find((s) => s.id === service);
  const [baseUrl, setBaseUrl] = useState(env.baseUrl || SERVICES[0].baseUrl);
  const [model, setModel] = useState(env.model || SERVICES[0].model);
  const [gnaniKey, setGnaniKey] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'testing'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TestKeysResult | null>(null);
  const gnani = app.stt.keyVar === 'GNANI_API_KEY';

  const choose = (next: ServiceId) => {
    setService(next);
    const p = SERVICES.find((s) => s.id === next);
    if (p) {
      setBaseUrl(p.baseUrl);
      setModel(p.model);
    }
  };

  const test = async () => {
    setBusy('testing');
    setResult(null);
    try {
      setResult(await window.echo.testKeys());
    } catch {
      setError('Could not run the check. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setError('');
    setResult(null);
    const patch: KeysPatch = {
      LLM_BASE_URL: baseUrl.trim(),
      LLM_MODEL: model.trim(),
    };
    // Reasoning effort follows the service: thinking models need "low" to answer quickly.
    const changedService = !sameBase(baseUrl.trim(), env.baseUrl);
    if (preset) patch.LLM_REASONING_EFFORT = preset.effort;
    else if (changedService) patch.LLM_REASONING_EFFORT = '';
    // An empty key box keeps the saved key.
    if (gnaniKey.trim()) patch.GNANI_API_KEY = gnaniKey.trim();
    if (llmKey.trim()) patch.LLM_API_KEY = llmKey.trim();
    else if (changedService && app.keys.llm) {
      setError('A different AI service needs its own API key.');
      return;
    }
    setBusy('saving');
    try {
      const r = await window.echo.saveKeys(patch);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setGnaniKey('');
      setLlmKey('');
      await refresh();
      settingsChanged(); // the overlay re-reads which keys are saved
      if (r.warning) notify(r.warning, true);
    } catch {
      setError('Could not save the keys. Please try again.');
      return;
    } finally {
      setBusy('');
    }
    await test();
  };

  const status = (found: boolean, label: string) => (
    <span className={found ? 'ok' : 'error-text'}>
      <Icon name={found ? 'check' : 'close'} size={14} /> {label}: {found ? 'saved' : 'missing'}
    </span>
  );

  return (
    <div className="keys-form">
      <div className="keys-status">
        <p>
          {status(app.keys.stt, app.stt.keyVar)}
          {/* Plain http is only allowed to a local server, which needs no key. */}
          {status(app.keys.llm || app.llm.baseUrl.startsWith('http://'), 'AI model key')}
        </p>
        <p className="muted small">
          Speech-to-text: {app.stt.name} · AI model: {app.llm.model || 'not set'}
        </p>
      </div>

      {gnani && (
        <label htmlFor={`${id}-gnani`}>
          Gnani API key
          <input
            id={`${id}-gnani`}
            aria-label="Gnani API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={gnaniKey}
            placeholder={
              app.keys.stt ? 'Saved. Paste a new key to replace it' : 'Paste your Gnani key'
            }
            onChange={(e) => setGnaniKey(e.target.value)}
          />
          <span className="muted small">Live transcription of both sides of the call.</span>
        </label>
      )}

      <label htmlFor={`${id}-service`}>
        AI model service
        <select
          id={`${id}-service`}
          aria-label="AI model service"
          value={service}
          onChange={(e) => choose(e.target.value as ServiceId)}
        >
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value="custom">Other OpenAI-compatible (Ollama, vLLM, OpenRouter…)</option>
        </select>
        {preset && <span className="muted small">Get a key at {preset.where}</span>}
      </label>

      {service === 'custom' && (
        <label htmlFor={`${id}-url`}>
          Base URL
          <input
            id={`${id}-url`}
            aria-label="Base URL"
            type="url"
            spellCheck={false}
            value={baseUrl}
            placeholder="http://localhost:11434/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}
      <label htmlFor={`${id}-model`}>
        AI model name
        <input
          id={`${id}-model`}
          aria-label="AI model name"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <label htmlFor={`${id}-llm`}>
        AI model API key
        <input
          id={`${id}-llm`}
          aria-label="AI model API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={llmKey}
          placeholder={app.keys.llm ? 'Saved. Paste a new key to replace it' : 'Paste your API key'}
          onChange={(e) => setLlmKey(e.target.value)}
        />
        <span className="muted small">
          Answers, meanings and minutes. Leave empty for a local server.
        </span>
      </label>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="keys-actions">
        <button className="primary" disabled={!!busy} onClick={() => void save()}>
          {busy === 'saving' ? 'Saving…' : 'Save and test'}
        </button>
        <button disabled={!!busy} onClick={() => void test()}>
          {busy === 'testing' ? 'Testing…' : 'Test saved keys'}
        </button>
      </div>
      {result && (
        <ul className="keys-result" role="status">
          {(
            [
              ['Speech-to-text', result.stt],
              ['AI model', result.llm],
            ] as const
          ).map(([label, r]) => (
            <li key={label} className={r.ok ? 'ok' : 'error-text'}>
              <Icon name={r.ok ? 'check' : 'close'} size={14} />
              <span>
                <strong>{label}:</strong> {r.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Keys are saved only on this computer, in {app.keyFile}, and are never shown again.
      </p>
    </div>
  );
}
