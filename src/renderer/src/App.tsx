import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CONSENT_VERSION, type Settings } from '../../shared/settings.ts';
import { SPEAKERS, type Speaker } from '../../shared/transcript/types.ts';
import { openAudioPort, postFrame } from './audio/audio-ports.ts';
import { FileReplay } from './audio/file-replay.ts';
import { LiveCapture } from './audio/live-capture.ts';
import type { AudioSink, AudioSourceController } from './audio/types.ts';
import { AnswerCard } from './components/AnswerCard.tsx';
import { Bar } from './components/Bar.tsx';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { ContextTab } from './components/ContextTab.tsx';
import { SettingsPanel, type ReplaySelection } from './components/SettingsPanel.tsx';
import { Line, Transcript } from './components/Transcript.tsx';
import { initialUiState, uiReducer, type Tab } from './state.ts';

const TABS: [Tab, string][] = [
  ['live', 'Live'],
  ['transcript', 'Transcript'],
  ['context', 'Context'],
  ['settings', 'Settings'],
];

export function App() {
  const [state, dispatch] = useReducer(uiReducer, initialUiState);
  const [files, setFiles] = useState<ReplaySelection>({ me: null, them: null });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const source = useRef<AudioSourceController | null>(null);
  const ports = useRef<Partial<Record<Speaker, MessagePort>>>({});
  const levelTimer = useRef<Record<Speaker, number>>({ me: 0, them: 0 });

  useEffect(() => {
    void window.bolo.getState().then((app) => dispatch({ type: 'init', app }));
    return window.bolo.onEvent((event) => dispatch({ type: 'event', event }));
  }, []);

  // The window is exactly as tall as the bar plus whatever is open under it.
  const loaded = state.app !== null;
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const report = () =>
      window.bolo.window({
        kind: 'resize',
        width: 0,
        height: Math.ceil(el.getBoundingClientRect().height),
      });
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [loaded]);

  // Clear notices after a while.
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(
      () => dispatch({ type: 'dismiss-notice' }),
      state.notice.level === 'error' ? 9000 : 5000,
    );
    return () => clearTimeout(t);
  }, [state.notice]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const settings = await window.bolo.updateSettings(patch);
    dispatch({ type: 'settings', settings });
  }, []);

  const teardownAudio = useCallback(() => {
    source.current?.stop();
    source.current = null;
    for (const p of Object.values(ports.current)) p?.close();
    ports.current = {};
    dispatch({ type: 'capturing', capturing: false });
  }, []);

  const stop = useCallback(async () => {
    teardownAudio();
    const res = await window.bolo.stopSession();
    if (res.exported)
      dispatch({ type: 'notice', level: 'info', message: `Saved ${res.exported.markdown}` });
    else if (res.error) dispatch({ type: 'notice', level: 'error', message: res.error });
  }, [teardownAudio]);

  const start = useCallback(async () => {
    const settings = state.app?.settings;
    if (!settings) return;
    if (settings.audioMode === 'file' && !files.me && !files.them) {
      dispatch({ type: 'panel', panel: 'settings' });
      dispatch({
        type: 'notice',
        level: 'error',
        message: 'Choose WAV files to replay (or click Demo) under Settings → Audio.',
      });
      return;
    }
    dispatch({ type: 'starting' });
    const res = await window.bolo.startSession();
    if (!res.ok) {
      dispatch({ type: 'start-failed', error: res.error });
      return;
    }
    setStartedAt(Date.now());
    try {
      for (const s of SPEAKERS) ports.current[s] = await openAudioPort(s);
      const sink: AudioSink = {
        frame: (speaker, f) => {
          const p = ports.current[speaker];
          if (p) postFrame(p, f);
        },
        level: (speaker, level) => {
          // Throttle meter updates to ~12/s per speaker.
          const now = performance.now();
          if (now - levelTimer.current[speaker] < 80 && level > 0) return;
          levelTimer.current[speaker] = now;
          dispatch({ type: 'level', speaker, level });
        },
      };
      source.current =
        settings.audioMode === 'file'
          ? new FileReplay(files, sink, {
              speed: settings.replaySpeed,
              audible: settings.replayAudible,
              onEnd: () => {
                dispatch({
                  type: 'notice',
                  level: 'info',
                  message: 'Replay finished — wrapping up…',
                });
                // Give the last utterance and its answer time to come back before stopping.
                setTimeout(() => void stop(), 2500);
              },
            })
          : new LiveCapture(sink, {
              micDeviceId: settings.micDeviceId,
              onWarning: (message) => dispatch({ type: 'notice', level: 'error', message }),
            });
      await source.current.start();
      dispatch({ type: 'capturing', capturing: true });
    } catch (err) {
      teardownAudio();
      await window.bolo.stopSession();
      dispatch({ type: 'start-failed', error: (err as Error).message });
    }
  }, [state.app?.settings, files, stop, teardownAudio]);

  const loadDemo = useCallback(async () => {
    const demo = await window.bolo.readDemoAudio();
    if (!demo.me && !demo.them) {
      dispatch({
        type: 'notice',
        level: 'error',
        message: `No demo audio in ${state.app?.demoAudioDir}. Run "npm run demo-audio" first (see README).`,
      });
      return;
    }
    setFiles({
      me: demo.me,
      them: demo.them,
      meName: demo.me ? 'demo me.wav' : undefined,
      themName: demo.them ? 'demo them.wav' : undefined,
    });
  }, [state.app?.demoAudioDir]);

  const app = state.app;
  if (!app)
    return (
      <div className="shell" ref={shell}>
        <div className="bar loading">Loading…</div>
      </div>
    );
  const s = app.settings;
  const needsConsent = !s.consentAcknowledged || s.consentVersion < CONSENT_VERSION;
  const lastThem = state.segments.findLast((x) => x.speaker === 'them');
  const pendingThem = state.partial.them || (state.processing.them ? '…' : '');

  return (
    <div
      ref={shell}
      className={`shell ${state.clickThrough ? 'click-through' : ''}`}
      style={{ ['--bg-alpha' as string]: s.overlayOpacity }}
    >
      <Bar
        state={state}
        startedAt={startedAt}
        share={app.shareProtection}
        visionReady={!!s.llmVisionModel}
        onStart={() => void start()}
        onStop={() => void stop()}
        onToggleOpen={() => dispatch({ type: 'toggle-open' })}
        onToggleMenu={() => setMenu((m) => !m)}
      />

      {menu && (
        <div className="strip menu">
          <button
            className="ghost small"
            onClick={() => window.bolo.window({ kind: 'toggle-click-through' })}
          >
            Click-through <kbd>Ctrl+Shift+M</kbd>
          </button>
          <button className="ghost small" onClick={() => window.bolo.window({ kind: 'hide' })}>
            Hide <kbd>Ctrl+Shift+H</kbd>
          </button>
          <span className="spacer" />
          <button className="ghost small" onClick={() => window.bolo.window({ kind: 'quit' })}>
            Quit Bolo
          </button>
        </div>
      )}

      {state.clickThrough && (
        <div className="strip warn">Click-through on — Ctrl+Shift+M to use Bolo</div>
      )}
      {state.notice && (
        <div
          className={`strip notice-${state.notice.level}`}
          role={state.notice.level === 'error' ? 'alert' : 'status'}
          onClick={() => dispatch({ type: 'dismiss-notice' })}
        >
          {state.notice.message}
        </div>
      )}

      {needsConsent ? (
        <div className="panel">
          <ConsentNotice
            sttName={app.stt.name.startsWith('Gnani') ? 'Gnani' : 'your speech-to-text service'}
            onAccept={() =>
              void updateSettings({ consentAcknowledged: true, consentVersion: CONSENT_VERSION })
            }
          />
        </div>
      ) : (
        state.open && (
          <div className="panel">
            <nav className="tabs" role="tablist">
              {TABS.map(([tab, label]) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={state.panel === tab}
                  className={state.panel === tab ? 'on' : ''}
                  onClick={() => dispatch({ type: 'panel', panel: tab })}
                >
                  {label}
                </button>
              ))}
              <span className="spacer" />
              {app.context.files.length > 0 ? (
                <span className="muted small">{app.context.files.length} files loaded</span>
              ) : (
                app.context.error && <span className="warn small">{app.context.error}</span>
              )}
            </nav>

            {state.panel === 'live' && (
              <div className="live">
                {!app.keys.stt && (
                  <p className="error-text">
                    {app.stt.keyVar} is missing. Add it to .env and restart Bolo.
                  </p>
                )}
                {!app.context.dir && !state.running && (
                  <p className="hint">
                    Add a context folder so Bolo can answer from your files.{' '}
                    <button
                      className="link"
                      onClick={() => dispatch({ type: 'panel', panel: 'context' })}
                    >
                      Open Context
                    </button>
                  </p>
                )}
                <section className="said">
                  <span className="label">They said</span>
                  {lastThem ? (
                    <Line segment={lastThem} />
                  ) : (
                    <p className="empty">
                      {state.running
                        ? 'Listening. Their words appear here.'
                        : 'Press Start when your call begins.'}
                    </p>
                  )}
                  {pendingThem && <p className="pending">{pendingThem}</p>}
                </section>
                <AnswerCard
                  suggestion={state.suggestion}
                  running={state.running}
                  onRequest={() => window.bolo.requestSuggestion()}
                />
                {state.echoesRemoved > 0 && (
                  <p className="muted small">
                    {state.echoesRemoved} echoed line(s) removed from Me
                  </p>
                )}
              </div>
            )}

            {state.panel === 'transcript' && (
              <Transcript
                segments={state.segments}
                partial={state.partial}
                processing={state.processing}
                startedAt={startedAt}
              />
            )}

            {state.panel === 'context' && (
              <ContextTab
                context={app.context}
                note={s.contextNote}
                onNote={(contextNote) => void updateSettings({ contextNote })}
              />
            )}

            {state.panel === 'settings' && (
              <SettingsPanel
                app={app}
                running={state.running}
                files={files}
                onFiles={setFiles}
                onLoadDemo={() => void loadDemo()}
                onChange={(p) => void updateSettings(p)}
                onChooseExportDir={() =>
                  void window.bolo
                    .chooseExportDir()
                    .then(() =>
                      window.bolo.getState().then((a) => dispatch({ type: 'init', app: { ...a } })),
                    )
                }
              />
            )}
          </div>
        )
      )}
    </div>
  );
}
