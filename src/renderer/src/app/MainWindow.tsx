import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSection, AppState } from '../../../shared/ipc.ts';
import type { Settings } from '../../../shared/settings.ts';
import { formatClock } from '../../../shared/transcript/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Library } from '../library/Library.tsx';
import { AskPage } from './AskPage.tsx';
import { Home } from './Home.tsx';
import { Onboarding } from './Onboarding.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { parseRoute, routeHash, type AppRoute } from './routes.ts';
import { onSettingsChanged, settingsChanged } from './settings-sync.ts';

export type Notify = (text: string, error?: boolean, meetingId?: string) => void;
export interface SettingsProps {
  app: AppState;
  onChange: (patch: Partial<Settings>) => Promise<Settings | null>;
  refresh: () => Promise<void>;
  notify: Notify;
}

const NAV = [
  ['home', 'Home', 'home'],
  ['meetings', 'Meetings', 'book'],
  ['ask', 'Ask', 'sparkle'],
  ['settings', 'Settings', 'settings'],
] as const;

export function MainWindow() {
  const [app, setApp] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(location.hash));
  const [toast, setToast] = useState<{ text: string; error?: boolean; meetingId?: string } | null>(
    null,
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState('profile');
  const [question, setQuestion] = useState<{ text: string; id: number } | null>(null);
  const questionId = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const notify = useCallback<Notify>(
    (text, error, meetingId) => setToast({ text, error, meetingId }),
    [],
  );
  const navigate = useCallback((section: AppSection, meetingId?: string) => {
    setRoute({ section, meetingId });
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await window.bolo.getState();
      setApp(next);
      setStartedAt(next.sessionRunning ? (next.sessionStartedAt ?? Date.now()) : null);
      setLoadError('');
    } catch {
      setLoadError('Bolo could not load. Please try again.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    const stopSettingsSync = onSettingsChanged(() => void refresh());
    const hashChanged = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', hashChanged);
    const off = window.bolo.onEvent((e) => {
      if (e.type === 'navigate') navigate(e.section, e.meetingId);
      if (e.type === 'open-meeting') navigate('meetings', e.id);
      if (e.type === 'meeting-deleted')
        setRoute((current) => (current.meetingId === e.id ? { section: 'meetings' } : current));
      if (e.type === 'notice') notify(e.message, e.level === 'error');
      if (e.type === 'session') setStartedAt(e.running ? (e.startedAt ?? Date.now()) : null);
      setApp((current) => {
        if (!current) return current;
        switch (e.type) {
          case 'session':
            return { ...current, sessionRunning: e.running, sessionPaused: false };
          case 'paused':
            return { ...current, sessionPaused: e.paused };
          case 'calendar':
            return { ...current, calendar: e.calendar };
          case 'context':
            return { ...current, context: e.context };
          case 'detected':
            return { ...current, detected: e.meeting };
          case 'integrations':
            return { ...current, integrations: e.integrations };
          case 'memory-updated':
            return { ...current, memoryMeetings: e.meetings };
          default:
            return current;
        }
      });
    });
    return () => {
      off();
      stopSettingsSync();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('hashchange', hashChanged);
    };
  }, [navigate, notify, refresh]);

  useEffect(() => {
    history.replaceState(null, '', routeHash(route));
    document.title = `Bolo — ${NAV.find(([key]) => key === route.section)?.[1] ?? 'Home'}`;
    heading.current?.focus();
  }, [route]);
  useEffect(() => {
    if (!app?.sessionRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [app?.sessionRunning]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(null),
      toast.meetingId ? 15000 : toast.error ? 9000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  const onChange = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const settings = await window.bolo.updateSettings(patch);
        setApp((current) => (current ? { ...current, settings } : current));
        settingsChanged();
        return settings;
      } catch {
        notify('Your settings could not be saved. Please try again.', true);
        return null;
      }
    },
    [notify],
  );
  const stop = async () => {
    setStopping(true);
    try {
      const result = await window.bolo.stopSession();
      notify(
        result.meetingId
          ? `Meeting saved.${result.writingMinutes ? ' Writing the minutes…' : ''}${result.error ? ` ${result.error}` : ''}`
          : (result.error ?? 'Meeting stopped.'),
        !!result.error,
        result.meetingId,
      );
    } catch {
      notify('Could not stop the meeting. Please try again.', true);
    } finally {
      setStopping(false);
    }
  };
  const ask = (text: string) => {
    setQuestion({ text, id: ++questionId.current });
    navigate('ask');
  };
  const settingsProps = app ? { app, onChange, refresh, notify } : null;

  const toastView = toast && (
    <div
      className={`app-toast ${toast.error ? 'error' : ''}`}
      role={toast.error ? 'alert' : 'status'}
    >
      <span>{toast.text}</span>
      {toast.meetingId && (
        <button
          onClick={() => {
            navigate('meetings', toast.meetingId);
            setToast(null);
          }}
        >
          Open
        </button>
      )}
      <button className="icon" aria-label="Dismiss notification" onClick={() => setToast(null)}>
        <Icon name="close" />
      </button>
    </div>
  );

  if (!app || !settingsProps)
    return (
      <div className="app-loading" role="status">
        {loadError || 'Getting Bolo ready…'}
        {loadError && <button onClick={() => void refresh()}>Try again</button>}
      </div>
    );
  if (!app.settings.onboarded)
    return (
      <>
        <Onboarding {...settingsProps} />
        {toastView}
      </>
    );

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#app-content"
        onClick={(e) => {
          e.preventDefault();
          heading.current?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="app-sidebar" aria-label="Bolo">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="sparkle" size={20} />
          </span>
          <span className="nav-label">Bolo</span>
        </div>
        <button
          className="primary start-meeting"
          disabled={app.sessionRunning}
          title={
            app.sessionRunning
              ? 'A meeting is already running. Stop it before starting another.'
              : 'Start a meeting'
          }
          onClick={() => window.bolo.requestStart()}
          aria-label="Start a meeting"
        >
          <Icon name="play" size={14} />
          <span className="nav-label">Start a meeting</span>
        </button>
        {app.sessionRunning && (
          <p className="sidebar-hint nav-label">A meeting is already running</p>
        )}
        <nav className="app-nav" aria-label="Main navigation">
          {NAV.map(([section, label, icon]) => (
            <button
              key={section}
              className={route.section === section ? 'on' : ''}
              aria-current={route.section === section ? 'page' : undefined}
              aria-label={label}
              title={label}
              onClick={() => navigate(section)}
            >
              <Icon name={icon} size={19} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {app.sessionRunning ? (
            <div className={`session-status ${app.sessionPaused ? 'is-paused' : ''}`}>
              <span className="status-title">
                <i />
                <span className="nav-label">{app.sessionPaused ? 'Paused' : 'Listening'}</span>
              </span>
              <span className="session-timer" title="Time since this window observed the call">
                {formatClock(Math.max(0, now - (startedAt ?? now)))}
              </span>
              <div className="session-controls">
                <button
                  className="icon"
                  aria-label={app.sessionPaused ? 'Resume' : 'Pause'}
                  title={app.sessionPaused ? 'Resume' : 'Pause (off the record)'}
                  onClick={() => window.bolo.setPaused(!app.sessionPaused)}
                >
                  <Icon name={app.sessionPaused ? 'play' : 'pause'} />
                </button>
                <button
                  className="icon"
                  title="Stop the call and save"
                  aria-label="Stop the call and save"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <Icon name="stop" size={14} />
                </button>
              </div>
            </div>
          ) : (
            <p className="sidebar-foot nav-label">
              <Icon name="shield" size={15} /> A little help. More presence.
            </p>
          )}
        </div>
      </aside>
      <main className={`app-content section-${route.section}`} id="app-content">
        <header className="section-header">
          <h1 ref={heading} tabIndex={-1}>
            {NAV.find(([key]) => key === route.section)?.[1]}
          </h1>
          <span className="muted">Your meeting buddy</span>
        </header>
        {route.section === 'home' && (
          <Home
            app={app}
            onMeeting={(id) => navigate('meetings', id)}
            onCalendar={() => {
              setSettingsAnchor('calendar');
              navigate('settings');
            }}
            onAsk={ask}
            notify={notify}
          />
        )}
        {route.section === 'meetings' && (
          <Library meetingId={route.meetingId} onSelect={(id) => navigate('meetings', id)} />
        )}
        <AskPage
          active={route.section === 'ask'}
          initialQuestion={question}
          onOpen={(id) => navigate('meetings', id)}
        />
        {route.section === 'settings' && (
          <SettingsPage {...settingsProps} anchor={settingsAnchor} onAnchor={setSettingsAnchor} />
        )}
      </main>
      {toastView}
    </div>
  );
}
