import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSection, AppState } from '../../../shared/ipc.ts';
import type { Settings } from '../../../shared/settings.ts';
import type { MeetingSummary } from '../../../shared/meeting.ts';
import { formatClock } from '../../../shared/transcript/format.ts';
import { initials } from '../components/Avatars.tsx';
import { Icon } from '../components/Icon.tsx';
import { Library } from '../library/Library.tsx';
import { AskPage } from './AskPage.tsx';
import { Home } from './Home.tsx';
import { Onboarding } from './Onboarding.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { TodoPage } from './TodoPage.tsx';
import { parseRoute, routeHash, type AppRoute } from './routes.ts';
import { onSettingsChanged, settingsChanged } from './settings-sync.ts';
import { meetingSlug } from './presentation.ts';

export type Notify = (text: string, error?: boolean, meetingId?: string) => void;
export interface SettingsProps {
  app: AppState;
  onChange: (patch: Partial<Settings>) => Promise<Settings | null>;
  refresh: () => Promise<void>;
  notify: Notify;
}

const NAV = [
  ['home', 'Home', 'home'],
  ['todo', 'To do', 'check'],
  ['meetings', 'Meetings', 'book'],
  ['ask', 'Ask', 'sparkle'],
  ['settings', 'Settings', 'user'],
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
  const [startMenu, setStartMenu] = useState(false);
  const [creating, setCreating] = useState<'google' | 'microsoft' | null>(null);
  const [question, setQuestion] = useState<{ text: string; id: number } | null>(null);
  const questionId = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const jumpInput = useRef<HTMLInputElement>(null);
  const jumpBox = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  // For "Jump to" only; each page loads its own lists.
  const refreshMeetings = useCallback(async () => {
    try {
      const recent = await window.echo.listMeetings('');
      setMeetings(recent.sort((a, b) => b.startedAt - a.startedAt));
    } catch {
      // Jump to still offers the sections.
    }
  }, []);
  const notify = useCallback<Notify>(
    (text, error, meetingId) => setToast({ text, error, meetingId }),
    [],
  );
  const navigate = useCallback((section: AppSection, meetingId?: string) => {
    setRoute({ section, meetingId });
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await window.echo.getState();
      setApp(next);
      setStartedAt(next.sessionRunning ? (next.sessionStartedAt ?? Date.now()) : null);
      setLoadError('');
    } catch {
      setLoadError('Echo could not load. Please try again.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshMeetings();
    window.addEventListener('focus', refresh);
    const stopSettingsSync = onSettingsChanged(() => void refresh());
    const hashChanged = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', hashChanged);
    const off = window.echo.onEvent((e) => {
      if (e.type === 'meeting-updated' || e.type === 'meeting-deleted') void refreshMeetings();
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
  }, [navigate, notify, refresh, refreshMeetings]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        jumpInput.current?.focus();
        setJumpOpen(true);
      }
      if (e.key === 'Escape' && jumpBox.current?.contains(document.activeElement)) {
        setJumpOpen(false);
        jumpInput.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    history.replaceState(null, '', routeHash(route));
    document.title = `Echo — ${NAV.find(([key]) => key === route.section)?.[1] ?? 'Home'}`;
    heading.current?.focus();
  }, [route]);
  // Every second for the call timer; otherwise often enough for "Upcoming" and the date.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), app?.sessionRunning ? 1000 : 30_000);
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
        const settings = await window.echo.updateSettings(patch);
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
      const result = await window.echo.stopSession();
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
  const newMeeting = async (provider: 'google' | 'microsoft') => {
    setStartMenu(false);
    setCreating(provider);
    try {
      const r = await window.echo.createMeeting(provider);
      notify(r.ok ? `Meeting link copied: ${r.url}. Echo is listening.` : r.error, !r.ok);
    } catch {
      notify('Could not create the meeting. Please try again.', true);
    } finally {
      setCreating(null);
    }
  };
  const ask = (text: string) => {
    setQuestion({ text, id: ++questionId.current });
    navigate('ask');
  };
  const settingsProps = app ? { app, onChange, refresh, notify } : null;
  const jumpTo = (section: AppSection, meetingId?: string) => {
    setJumpOpen(false);
    setJump('');
    navigate(section, meetingId);
  };
  const jumpSections = NAV.filter(([, label]) => label.toLowerCase().includes(jump.toLowerCase()));
  const jumpMeetings = meetings
    .filter((m) => m.title.toLowerCase().includes(jump.toLowerCase()))
    .slice(0, 8);

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
        {loadError || 'Getting Echo ready…'}
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
      <header className="workspace-header">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden>
            E
          </span>
          <span>Echo</span>
        </div>
        <div
          className="jump-box"
          ref={jumpBox}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setJumpOpen(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (jumpSections[0]) jumpTo(jumpSections[0][0]);
              else if (jumpMeetings[0]) jumpTo('meetings', jumpMeetings[0].id);
            }}
          >
            <Icon name="search" />
            <input
              ref={jumpInput}
              type="search"
              role="combobox"
              aria-haspopup="dialog"
              aria-label="Jump to"
              placeholder="Jump to…"
              value={jump}
              aria-expanded={jumpOpen}
              aria-controls="jump-results"
              onFocus={() => setJumpOpen(true)}
              onChange={(e) => {
                setJump(e.target.value);
                setJumpOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  jumpBox.current
                    ?.querySelector<HTMLButtonElement>('.jump-results button')
                    ?.focus();
                }
              }}
            />
            <kbd>Ctrl K</kbd>
          </form>
          {jumpOpen && (
            <div
              className="jump-results"
              id="jump-results"
              role="dialog"
              aria-label="Jump to results"
            >
              {jumpSections.length > 0 && <p>Go to</p>}
              {jumpSections.map(([section, label, icon]) => (
                <button key={section} onClick={() => jumpTo(section)}>
                  <Icon name={icon} />
                  {label}
                </button>
              ))}
              {jumpMeetings.length > 0 && <p>Meetings</p>}
              {jumpMeetings.map((m) => (
                <button key={m.id} onClick={() => jumpTo('meetings', m.id)}>
                  <Icon name="hash" />
                  <span>{meetingSlug(m.title)}</span>
                </button>
              ))}
              {!jumpSections.length && !jumpMeetings.length && (
                <p>No matching meetings or sections.</p>
              )}
            </div>
          )}
        </div>
        {app.sessionRunning && (
          <div className={`session-status ${app.sessionPaused ? 'is-paused' : ''}`}>
            <span className="status-title">
              <i />
              <span>{app.sessionPaused ? 'Paused' : 'Live'}</span>
              <span className="sr-only">{!app.sessionPaused && 'Listening'}</span>
            </span>
            <span className="session-timer">
              {formatClock(Math.max(0, now - (startedAt ?? now)))}
            </span>
            <button
              className="icon"
              aria-label={app.sessionPaused ? 'Resume' : 'Pause'}
              title={app.sessionPaused ? 'Resume' : 'Pause (off the record)'}
              onClick={() => window.echo.setPaused(!app.sessionPaused)}
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
              <Icon name="stop" size={13} />
            </button>
          </div>
        )}
      </header>
      <aside className="app-rail" aria-label="Workspace">
        <nav className="app-nav" aria-label="Main navigation">
          {NAV.filter(([section]) => section !== 'settings').map(([section, label, icon]) => (
            <button
              key={section}
              className={route.section === section ? 'on' : ''}
              aria-current={route.section === section ? 'page' : undefined}
              aria-label={label}
              title={label}
              onClick={() => navigate(section)}
            >
              <Icon name={icon} size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button
          className={`rail-profile ${route.section === 'settings' ? 'on' : ''}`}
          title={app.settings.myName || 'Your workspace'}
          aria-label="Your profile"
          aria-current={route.section === 'settings' ? 'page' : undefined}
          onClick={() => {
            setSettingsAnchor('profile');
            navigate('settings');
            requestAnimationFrame(() =>
              document.getElementById('settings-profile')?.scrollIntoView({ block: 'start' }),
            );
          }}
        >
          {Array.from(initials(app.settings.myName || 'E'))[0]}
        </button>
      </aside>
      <div
        className="start-box"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStartMenu(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setStartMenu(false);
        }}
      >
        <button
          className="start-meeting"
          disabled={app.sessionRunning || !!creating}
          title={app.sessionRunning ? 'A meeting is already running' : 'Start a meeting'}
          aria-label="Start a meeting"
          aria-haspopup="menu"
          aria-expanded={startMenu}
          onClick={() => setStartMenu((open) => !open)}
        >
          {creating ? <span className="spinner" /> : <Icon name="play" size={22} />}
        </button>
        {startMenu && !app.sessionRunning && (
          <div className="start-menu" role="menu" aria-label="Start a meeting">
            <button
              role="menuitem"
              onClick={() => {
                setStartMenu(false);
                window.echo.requestStart();
              }}
            >
              <Icon name="play" size={14} />
              <span>
                Start listening
                <small>Echo listens to the call you're already in</small>
              </span>
            </button>
            {(['google', 'microsoft'] as const).map((provider) => {
              const connected = app.integrations.accounts.some((a) => a.provider === provider);
              const name = provider === 'google' ? 'Google Meet' : 'Teams meeting';
              return (
                <button
                  key={provider}
                  role="menuitem"
                  disabled={!connected}
                  onClick={() => void newMeeting(provider)}
                >
                  <span className={`provider-mark provider-${provider}`} aria-hidden>
                    {provider === 'google' ? 'G' : 'M'}
                  </span>
                  <span>
                    New {name}
                    <small>
                      {connected
                        ? 'Creates the link, opens it and starts listening'
                        : `Connect ${provider === 'google' ? 'Google' : 'Microsoft'} in You → Calendar & accounts`}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <main className={`app-content section-${route.section}`} id="app-content">
        <header className="section-header">
          <h1 ref={heading} tabIndex={-1}>
            {route.section === 'ask'
              ? 'Ask your meetings'
              : route.section === 'settings'
                ? 'You'
                : NAV.find(([key]) => key === route.section)?.[1]}
          </h1>
          <span className="muted">
            {route.section === 'home'
              ? new Date(now).toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })
              : route.section === 'ask'
                ? 'A thread with Echo'
                : 'Your workspace'}
          </span>
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
        {route.section === 'todo' && (
          <TodoPage onMeeting={(id) => navigate('meetings', id)} notify={notify} />
        )}
        {route.section === 'meetings' && (
          <Library
            upcoming={app.calendar.events
              .filter((e) => e.end > now)
              .sort((a, b) => a.start - b.start)}
            running={app.sessionRunning}
            meetingId={route.meetingId}
            onSelect={(id) => navigate('meetings', id)}
          />
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
