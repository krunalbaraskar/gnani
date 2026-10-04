import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Settings } from '../../shared/settings.ts';
import { SPEAKERS, type Speaker } from '../../shared/transcript/types.ts';
import { openAudioPort, postFrame } from './audio/audio-ports.ts';
import { FileReplay, type ReplayFiles } from './audio/file-replay.ts';
import { LiveCapture } from './audio/live-capture.ts';
import type { AudioSink, AudioSourceController } from './audio/types.ts';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { ResizeGrip } from './components/ResizeGrip.tsx';
import { SessionControls } from './components/SessionControls.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { SuggestionCard } from './components/SuggestionCard.tsx';
import { Transcript } from './components/Transcript.tsx';
import { initialUiState, uiReducer } from './state.ts';

const HEADPHONE_TIP_KEY = 'bolo.headphoneTipDismissed';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [state, dispatch] = useReducer(uiReducer, initialUiState);
  const [files, setFiles] = useState<ReplayFiles & { meName?: string; themName?: string }>({
    me: null,
    them: null,
  });
  const [tipDismissed, setTipDismissed] = useState(() => readFlag(HEADPHONE_TIP_KEY));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const source = useRef<AudioSourceController | null>(null);
  const ports = useRef<Partial<Record<Speaker, MessagePort>>>({});
  const levelTimer = useRef<Record<Speaker, number>>({ me: 0, them: 0 });

  useEffect(() => {
    void window.bolo.getState().then((app) => dispatch({ type: 'init', app }));
    return window.bolo.onEvent((event) => dispatch({ type: 'event', event }));
  }, []);

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
      dispatch({
        type: 'notice',
        level: 'error',
        message: 'Choose WAV files to replay (or click Demo).',
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
                // Give the last utterance time to come back before stopping.
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
  if (!app) return <div className="shell loading">Loading…</div>;
  const s = app.settings;

  return (
    <div
      className={`shell ${state.clickThrough ? 'click-through' : ''}`}
      style={{ ['--bg-alpha' as string]: s.overlayOpacity }}
    >
      <header className="titlebar">
        <span className="brand">Bolo</span>
        {state.capturing ? (
          <span className="listening" role="status">
            <span className="rec-dot" /> Listening
          </span>
        ) : (
          <span className="not-listening">Not listening</span>
        )}
        <span className="spacer" />
        <button
          className="icon"
          title={state.panel === 'settings' ? 'Back to transcript' : 'Settings'}
          onClick={() =>
            dispatch({ type: 'panel', panel: state.panel === 'settings' ? 'live' : 'settings' })
          }
        >
          {state.panel === 'settings' ? '←' : '⚙'}
        </button>
        <button
          className="icon"
          title="Click-through (Ctrl+Shift+M)"
          onClick={() => window.bolo.window({ kind: 'toggle-click-through' })}
        >
          ⇲
        </button>
        <button
          className="icon"
          title="Hide (Ctrl+Shift+H)"
          onClick={() => window.bolo.window({ kind: 'hide' })}
        >
          –
        </button>
        <button
          className="icon"
          title="Quit Bolo"
          onClick={() => window.bolo.window({ kind: 'quit' })}
        >
          ×
        </button>
      </header>

      {state.clickThrough && (
        <div className="banner">Click-through on — Ctrl+Shift+M to interact</div>
      )}

      {state.panel === 'settings' ? (
        <SettingsPanel
          app={app}
          onChange={(p) => void updateSettings(p)}
          onChooseExportDir={() =>
            void window.bolo
              .chooseExportDir()
              .then(() =>
                window.bolo.getState().then((a) => dispatch({ type: 'init', app: { ...a } })),
              )
          }
        />
      ) : (
        <>
          <StatusBar state={state} />
          {s.audioMode === 'live' && !tipDismissed && (
            <div className="banner tip">
              🎧 Use headphones. Without them your mic also hears the other person; Bolo filters
              that echo, but headphones work better.
              <button
                className="icon"
                onClick={() => {
                  setTipDismissed(true);
                  try {
                    localStorage.setItem(HEADPHONE_TIP_KEY, '1');
                  } catch {
                    // ignore
                  }
                }}
              >
                ×
              </button>
            </div>
          )}
          <Transcript
            segments={state.segments}
            partial={state.partial}
            processing={state.processing}
            startedAt={startedAt}
          />
          <SuggestionCard
            suggestion={state.suggestion}
            running={state.running}
            onRequest={() => window.bolo.requestSuggestion()}
          />
          {state.echoesRemoved > 0 && (
            <p className="muted small center">
              {state.echoesRemoved} echoed line(s) removed from Me
            </p>
          )}
        </>
      )}

      <SessionControls
        settings={s}
        running={state.running}
        starting={state.starting}
        files={files}
        onFiles={setFiles}
        onLoadDemo={() => void loadDemo()}
        onStart={() => void start()}
        onStop={() => void stop()}
      />

      {state.notice && (
        <div
          className={`notice notice-${state.notice.level}`}
          onClick={() => dispatch({ type: 'dismiss-notice' })}
        >
          {state.notice.message}
        </div>
      )}

      {!s.consentAcknowledged && (
        <ConsentNotice onAccept={() => void updateSettings({ consentAcknowledged: true })} />
      )}
      <ResizeGrip />
    </div>
  );
}
