import { useEffect, useId, useRef, useState } from 'react';
import type { AccountProvider } from '../../../shared/integrations.ts';
import { MEETING_MODES, type Settings } from '../../../shared/settings.ts';
import { MODE_INFO } from '../components/Bar.tsx';
import { Icon } from '../components/Icon.tsx';
import type { SettingsProps } from './MainWindow.tsx';

type StringKey = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function DraftField({
  app,
  onChange,
  name,
  label,
  hint,
  multiline,
  maxLength = 200,
  placeholder,
  type = 'text',
}: Pick<SettingsProps, 'app' | 'onChange'> & {
  name: StringKey;
  label: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  type?: 'text' | 'url';
}) {
  const value = app.settings[name];
  const fieldId = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    if (draft === value) return;
    const saved = await onChange({ [name]: draft });
    setDraft(saved?.[name] ?? value);
  };
  const props = {
    id: fieldId,
    'aria-describedby': hint ? `${fieldId}-hint` : undefined,
    value: draft,
    maxLength,
    placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => void commit(),
  };
  return (
    <label htmlFor={fieldId}>
      {label}
      {multiline ? (
        <textarea rows={4} {...props} />
      ) : (
        <input
          type={type}
          {...props}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      )}
      {hint && (
        <span className="muted small" id={`${fieldId}-hint`}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Toggle({
  app,
  onChange,
  name,
  children,
}: Pick<SettingsProps, 'app' | 'onChange'> & { name: BoolKey; children: React.ReactNode }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={app.settings[name]}
        onChange={(e) => void onChange({ [name]: e.target.checked })}
      />
      <span>{children}</span>
    </label>
  );
}

export function ProfileFields(props: SettingsProps) {
  return (
    <>
      <DraftField
        {...props}
        name="myName"
        label="My name"
        maxLength={80}
        placeholder="What should Bolo call you?"
      />
      <DraftField
        {...props}
        name="watchWords"
        label="Alert me on"
        maxLength={300}
        placeholder="Projects, clients, other spellings of my name"
        hint="Separate watch words with commas. Speech-to-text may write names in another script (Krunal as क्रुणाल): add that spelling too."
      />
      <label>
        I read
        <select
          aria-label="I read"
          value={props.app.settings.myLanguage}
          onChange={(e) => void props.onChange({ myLanguage: e.target.value })}
        >
          {props.app.languages
            .filter((l) => !l.experimental)
            .map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}

export function CalendarAccounts(props: SettingsProps) {
  const { app, onChange, notify, refresh } = props;
  const [connecting, setConnecting] = useState<AccountProvider | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const connect = async (provider: AccountProvider) => {
    setConnecting(provider);
    setError('');
    try {
      const result = await window.bolo.connectAccount(provider);
      if (!result.ok) setError(result.error);
      else {
        await refresh();
        notify(`Connected ${result.account.email}.`);
      }
    } catch {
      setError('Could not connect your account. Please try again.');
    } finally {
      setConnecting(null);
    }
  };
  const disconnect = async (id: string) => {
    setDisconnecting(id);
    setError('');
    try {
      await window.bolo.disconnectAccount(id);
      await refresh();
      notify('Account disconnected.');
    } catch {
      setError('Could not disconnect this account. Please try again.');
    } finally {
      setDisconnecting(null);
    }
  };
  const otherCalendar = async (action: 'choose' | 'remove' | 'refresh') => {
    setWorking(true);
    setError('');
    try {
      if (action === 'refresh') await window.bolo.refreshCalendar();
      else await window.bolo.chooseCalendarFile(action === 'remove');
      await refresh();
    } catch {
      setError('Could not update your calendar. Please try again.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <p className="muted">
        A read-only view of your day, with the right people and agenda ready for each meeting.
      </p>
      <div className="account-connect">
        {(['google', 'microsoft'] as const).map((provider) => {
          const available = app.integrations.available[provider];
          const hint = `Not set up in this build (needs ${provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'} in .env)`;
          return (
            <div key={provider}>
              <button
                aria-describedby={!available ? `${provider}-hint` : undefined}
                disabled={!available || !!connecting}
                onClick={() => void connect(provider)}
              >
                <span className={`provider-mark provider-${provider}`} aria-hidden>
                  {provider === 'google' ? 'G' : 'M'}
                </span>
                {connecting === provider ? (
                  <>
                    <span className="spinner" /> Finish signing in in your browser…
                  </>
                ) : provider === 'google' ? (
                  'Connect Google Calendar'
                ) : (
                  'Connect Outlook'
                )}
              </button>
              {!available && (
                <p className="muted small" id={`${provider}-hint`}>
                  {hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!!app.integrations.accounts.length && (
        <ul className="account-list">
          {app.integrations.accounts.map((account) => (
            <li key={account.id}>
              <span
                className={`provider-mark provider-${account.provider}`}
                aria-label={account.provider === 'google' ? 'Google' : 'Outlook'}
              >
                {account.provider === 'google' ? 'G' : 'M'}
              </span>
              <div>
                <strong>{account.email}</strong>
                <span className="muted small">
                  {account.provider === 'google' ? 'Google Calendar' : 'Outlook'} · Connected
                </span>
                {account.error && <p className="error-text">{account.error}</p>}
              </div>
              <button
                className="small"
                disabled={!!disconnecting}
                onClick={() => void disconnect(account.id)}
              >
                {disconnecting === account.id ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <h3>Other calendars</h3>
      <DraftField
        {...props}
        name="calendarUrl"
        label="Private iCal link"
        type="url"
        maxLength={2000}
        placeholder="https://… or webcal://…"
        hint="Google: Calendar settings → Secret address in iCal format. Or choose an .ics file below."
      />
      <div className="row">
        {app.settings.calendarFile ? (
          <>
            <span className="path" title={app.settings.calendarFile}>
              {app.settings.calendarFile}
            </span>
            <button disabled={working} onClick={() => void otherCalendar('remove')}>
              Remove file
            </button>
          </>
        ) : (
          <button disabled={working} onClick={() => void otherCalendar('choose')}>
            <Icon name="calendar" size={15} /> Choose .ics file
          </button>
        )}
        <button disabled={working} onClick={() => void otherCalendar('refresh')}>
          {working ? 'Updating…' : 'Refresh calendar'}
        </button>
      </div>
      {app.calendar.error && (
        <p className="warn" role="status">
          {app.calendar.error}
        </p>
      )}
      <p className="muted small">
        Refreshed every 10 minutes. Starting from an invite brings its title, people, and agenda
        into Bolo.
      </p>
      <Toggle app={app} onChange={onChange} name="autoDetect">
        Notice calls in Zoom, Teams, Meet and others
      </Toggle>
    </>
  );
}

export function KnowledgeFields(props: SettingsProps) {
  const { app, refresh, notify } = props;
  const [busy, setBusy] = useState(false);
  const choose = async (reload: boolean) => {
    setBusy(true);
    try {
      if (reload) await window.bolo.reloadContext();
      else await window.bolo.chooseContextDir();
      await refresh();
    } catch {
      notify('Your context folder could not be read. Please try again.', true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="muted">
        Your price list, stock sheet, or project notes. Bolo shows its sources when it answers.
      </p>
      <div className="folder-choice">
        <Icon name="folder" size={24} />
        <span className="path" title={app.context.dir}>
          {app.context.dir || 'No context folder chosen'}
        </span>
        <button disabled={busy} onClick={() => void choose(false)}>
          Choose folder
        </button>
        {app.context.dir && (
          <button disabled={busy} onClick={() => void choose(true)}>
            Reload
          </button>
        )}
      </div>
      {app.context.error && (
        <p className="error-text" role="alert">
          {app.context.error}
        </p>
      )}
      {!!(app.context.files.length || app.context.skipped.length) && (
        <ul className="files">
          {app.context.files.map((f) => (
            <li key={f.name}>
              <span>{f.name}</span>
              <span className="muted">{f.info}</span>
            </li>
          ))}
          {app.context.skipped.map((f) => (
            <li className="skipped" key={f.name}>
              <span>{f.name}</span>
              <span>Skipped: {f.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Supports .csv, .md, .txt and .json. Only parts relevant to your question go to your AI
        model.
      </p>
      <Toggle {...props} name="useMeetings">
        Also answer from my past meetings{' '}
        <span className="muted">({app.memoryMeetings} saved)</span>
      </Toggle>
      <DraftField
        {...props}
        name="contextNote"
        label="About me"
        multiline
        maxLength={2000}
        placeholder="e.g. I sell industrial paint to distributors. Keep replies brief and polite."
      />
      <label>
        File content sent per answer: {Math.round(app.settings.contextBudgetChars / 1000)}k
        characters
        <input
          type="range"
          min={4000}
          max={100000}
          step={2000}
          value={app.settings.contextBudgetChars}
          onChange={(e) => void props.onChange({ contextBudgetChars: Number(e.target.value) })}
        />
        <span className="muted small">Lower this for small local models.</span>
      </label>
    </>
  );
}

export function KeysStatus({ app }: Pick<SettingsProps, 'app'>) {
  return (
    <div className="keys-status">
      <p className={app.keys.stt ? 'ok' : 'error-text'}>
        <Icon name={app.keys.stt ? 'check' : 'close'} size={16} /> {app.stt.keyVar}:{' '}
        {app.keys.stt ? 'found' : 'missing — add it to .env and restart'}
      </p>
      <p className="muted small">
        Speech-to-text: {app.stt.name} at {app.stt.url}
      </p>
      <p className={app.keys.llm ? 'ok' : 'muted'}>
        LLM_API_KEY: {app.keys.llm ? 'found' : 'not set (fine for a local Ollama/vLLM server)'}
      </p>
      <p className="muted small">
        AI model: {app.llm.model || 'Not configured'} ·{' '}
        {app.llm.baseUrl || 'No base URL configured'}
      </p>
    </div>
  );
}

export function PrivacyText({ stt }: { stt: string }) {
  return (
    <div className="privacy-copy">
      <p>
        Bolo listens to both sides of your conversation. Audio is sent to {stt} for speech-to-text.
        The transcript goes to the AI model you configure to suggest replies and, after the meeting,
        to write minutes.
      </p>
      <p>
        Parts of your context files and past meetings’ minutes that match your question are sent to
        that model. A picture of your screen is sent only when you ask with the screen.
      </p>
      <p>
        Transcripts, notes, and minutes are saved on this computer until you delete them. Use
        synthetic or consented conversations for demos.
      </p>
      <p>
        <strong>
          Tell the other person and get their consent before recording or transcribing a
          conversation.
        </strong>
      </p>
    </div>
  );
}

const SECTIONS = [
  ['profile', 'Profile'],
  ['calendar', 'Calendar & accounts'],
  ['during', 'During meetings'],
  ['knowledge', 'Knowledge'],
  ['after', 'After meetings'],
  ['ai', 'AI & speech'],
  ['privacy', 'Privacy'],
] as const;

export function SettingsPage(
  props: SettingsProps & { anchor: string; onAnchor: (anchor: string) => void },
) {
  const { app, onChange, anchor, onAnchor, notify, refresh } = props;
  const { settings: s } = app;
  const scroll = useRef<HTMLDivElement>(null);
  const language = app.languages.find((l) => l.code === s.sttLanguage);
  useEffect(() => {
    const target = scroll.current?.querySelector<HTMLElement>(`#settings-${anchor}`);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [anchor]);
  const exportDir = async () => {
    try {
      await window.bolo.chooseExportDir();
      await refresh();
    } catch {
      notify('Could not choose an export folder.', true);
    }
  };
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            className={anchor === id ? 'on' : ''}
            aria-current={anchor === id ? 'location' : undefined}
            onClick={() => onAnchor(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-scroll" ref={scroll}>
        <section className="settings-section" id="settings-profile" tabIndex={-1}>
          <header>
            <h2>Profile</h2>
            <p className="muted">A few things that make Bolo yours.</p>
          </header>
          <ProfileFields {...props} />
        </section>
        <section className="settings-section" id="settings-calendar" tabIndex={-1}>
          <header>
            <h2>Calendar & accounts</h2>
          </header>
          <CalendarAccounts {...props} />
        </section>
        <section className="settings-section" id="settings-during" tabIndex={-1}>
          <header>
            <h2>During meetings</h2>
            <p className="muted">Choose how much help you’d like in the conversation.</p>
          </header>
          <fieldset>
            <legend>Meeting mode</legend>
            <div className="mode-choices">
              {MEETING_MODES.map((mode) => (
                <label key={mode} className={mode === s.mode ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="meeting-mode"
                    checked={s.mode === mode}
                    onChange={() => void onChange({ mode })}
                  />
                  <span>
                    <strong>{MODE_INFO[mode].label}</strong>
                    <span className="muted small">{MODE_INFO[mode].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Reply language
            <select
              aria-label="Reply language"
              value={s.outputLanguage}
              onChange={(e) =>
                void onChange({ outputLanguage: e.target.value as Settings['outputLanguage'] })
              }
            >
              <option value="same">Same as the call</option>
              <option value="hinglish">Hinglish</option>
              <option value="english">English</option>
            </select>
          </label>
          <Toggle {...props} name="explainThem">
            Show a plain meaning under mixed-language lines
          </Toggle>
          <label>
            Transcript sent to the AI: last {s.transcriptMinutes} min
            <input
              type="range"
              min={1}
              max={10}
              value={s.transcriptMinutes}
              onChange={(e) => void onChange({ transcriptMinutes: Number(e.target.value) })}
            />
          </label>
        </section>
        <section className="settings-section" id="settings-knowledge" tabIndex={-1}>
          <header>
            <h2>Knowledge</h2>
          </header>
          <KnowledgeFields {...props} />
        </section>
        <section className="settings-section" id="settings-after" tabIndex={-1}>
          <header>
            <h2>After meetings</h2>
            <p className="muted">Every meeting is saved on this computer.</p>
          </header>
          <Toggle {...props} name="autoMinutes">
            Write minutes automatically: summary, decisions, and action items
          </Toggle>
          <Toggle {...props} name="autoExport">
            Also save the transcript as Markdown and JSON to a folder
          </Toggle>
          <div className="folder-choice">
            <Icon name="folder" />
            <span className="path" title={s.exportDir}>
              {s.exportDir || 'No export folder chosen'}
            </span>
            <button onClick={() => void exportDir()}>Choose folder</button>
            {s.exportDir && <button onClick={() => window.bolo.openExportDir()}>Open</button>}
          </div>
        </section>
        <section className="settings-section" id="settings-ai" tabIndex={-1}>
          <header>
            <h2>AI & speech</h2>
            <p className="muted">Keys are loaded from .env and never shown here.</p>
          </header>
          <KeysStatus app={app} />
          <DraftField
            {...props}
            name="llmBaseUrl"
            label="LLM base URL"
            type="url"
            maxLength={2000}
            placeholder={app.llm.baseUrl || 'https://api.openai.com/v1'}
            hint="Leave empty to use .env. Use HTTPS, except for this computer or your local network. Ollama: http://localhost:11434/v1."
          />
          <DraftField {...props} name="llmModel" label="Model" placeholder={app.llm.model} />
          <DraftField
            {...props}
            name="llmVisionModel"
            label="Vision model"
            placeholder="e.g. gpt-4o-mini — empty turns screen reading off"
            hint="One screen picture is sent only when you ask with the screen."
          />
          <label>
            Speech-to-text language
            <select
              aria-label="Speech-to-text language"
              value={s.sttLanguage}
              onChange={(e) => void onChange({ sttLanguage: e.target.value })}
            >
              {app.languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          {language?.experimental && (
            <p className="warn">
              Experimental: accuracy not tested yet. If lines look wrong, pick the call’s language.
            </p>
          )}
          {language?.supportsItn && (
            <Toggle {...props} name="formatNumbers">
              Write numbers and amounts as digits (₹1,200 instead of “twelve hundred”)
            </Toggle>
          )}
          <p className="muted small">Speech settings apply from the next session.</p>
          <a
            className="audio-help"
            href="#settings-audio-help"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('settings-audio-help')?.focus();
            }}
          >
            Audio input is set in the call bar <Icon name="arrow" size={14} />
          </a>
          <p id="settings-audio-help" className="muted small" tabIndex={-1}>
            In the floating call bar, choose Expand → Settings → Audio for microphone input or WAV
            replay. Ctrl+Shift+H shows or hides the bar.
          </p>
        </section>
        <section className="settings-section" id="settings-privacy" tabIndex={-1}>
          <header>
            <h2>Privacy</h2>
            <p className="muted">Your conversations deserve care.</p>
          </header>
          <PrivacyText stt={app.stt.name} />
        </section>
      </div>
    </div>
  );
}
