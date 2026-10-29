import { useCallback, useEffect, useRef, useState } from 'react';
import { meetingNow, startsInLabel, type CalendarEventView } from '../../../shared/calendar.ts';
import type { ActionItemView, AppState } from '../../../shared/ipc.ts';
import type { MeetingSummary } from '../../../shared/meeting.ts';
import { Avatar, Avatars } from '../components/Avatars.tsx';
import { Icon } from '../components/Icon.tsx';
import type { Notify } from './MainWindow.tsx';

export const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const minutesLabel = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`;

function Source({ event }: { event: CalendarEventView }) {
  return (
    <span className="source-badge">
      {event.source.startsWith('google:')
        ? 'Google'
        : event.source.startsWith('microsoft:')
          ? 'Outlook'
          : 'iCal'}
    </span>
  );
}

export function Home({
  app,
  onMeeting,
  onCalendar,
  onAsk,
  notify,
}: {
  app: AppState;
  onMeeting: (id: string) => void;
  onCalendar: () => void;
  onAsk: (question: string) => void;
  notify: Notify;
}) {
  const [now, setNow] = useState(Date.now);
  const [actions, setActions] = useState<ActionItemView[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [attendees, setAttendees] = useState<Record<string, string[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [all, setAll] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const optimistic = useRef(new Map<string, boolean>());
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const [items, recent] = await Promise.all([
        window.echo.listActionItems(),
        window.echo.listMeetings(''),
      ]);
      if (request !== revision.current) return;
      setActions(
        items.map((item) => ({
          ...item,
          done: optimistic.current.get(`${item.meetingId}:${item.index}`) ?? item.done,
        })),
      );
      setMeetings(recent.sort((a, b) => b.startedAt - a.startedAt).slice(0, 6));
      setLoaded(true);
      setError(false);
      const people = await Promise.all(
        recent.slice(0, 6).map(async (m) => {
          const detail = await window.echo.getMeeting(m.id).catch(() => null);
          return [m.id, detail?.attendees ?? []] as const;
        }),
      );
      if (request === revision.current) setAttendees(Object.fromEntries(people));
    } catch {
      if (request === revision.current) setError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const off = window.echo.onEvent((e) => {
      if (e.type === 'meeting-updated' || e.type === 'meeting-deleted') void refresh();
    });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [refresh]);
  const toggle = async (item: ActionItemView) => {
    const key = `${item.meetingId}:${item.index}`;
    const done = !item.done;
    optimistic.current.set(key, done);
    setPending((p) => new Set(p).add(key));
    setActions((items) =>
      items.map((a) =>
        a.meetingId === item.meetingId && a.index === item.index ? { ...a, done } : a,
      ),
    );
    let ok = false;
    try {
      ok = await window.echo.toggleActionItem(item.meetingId, item.index, done);
    } catch {
      /* Revert below, including IPC failures. */
    }
    optimistic.current.delete(key);
    setPending((p) => {
      const next = new Set(p);
      next.delete(key);
      return next;
    });
    if (!ok) {
      setActions((items) =>
        items.map((a) =>
          a.meetingId === item.meetingId && a.index === item.index ? { ...a, done: item.done } : a,
        ),
      );
      notify('That action item could not be saved. Please try again.', true);
    }
  };
  const events = [...app.calendar.events].sort((a, b) => a.start - b.start);
  const offered = meetingNow(events, now)?.event;
  const next =
    offered ?? (!app.detected ? events.find((e) => !e.allDay && e.start > now) : undefined);
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const timeline = events.filter((e) => e.key !== next?.key && e.end > now);
  // Keep a checkbox in place while its save is pending, including a failed save.
  const sortDone = (item: ActionItemView) =>
    pending.has(`${item.meetingId}:${item.index}`) ? !item.done : item.done;
  const sortedActions = [...actions].sort(
    (a, b) =>
      Number(sortDone(a)) - Number(sortDone(b)) ||
      b.meetingStartedAt - a.meetingStartedAt ||
      a.index - b.index,
  );
  const hour = new Date(now).getHours();

  return (
    <div className="page home-page">
      <header className="page-heading">
        <p className="eyebrow">
          {new Date(now).toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h2>
          Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'},{' '}
          {app.settings.myName || 'there'}.
        </h2>
        <p className="muted">A little space to prepare, remember, and follow through.</p>
      </header>
      {error && (
        <div className="inline-error" role="alert">
          Could not load your meetings and to-dos.{' '}
          <button onClick={() => void refresh()}>Try again</button>
        </div>
      )}
      <div className="dashboard-grid">
        <section
          className={`dashboard-card now-card ${app.detected && !next ? 'detected-offer' : ''}`}
        >
          <div className="card-heading">
            <h3>
              <Icon name="calendar" />{' '}
              {(next && next.start <= now) || (app.detected && !next) ? 'Happening now' : 'Up next'}
            </h3>
            {next && <Source event={next} />}
          </div>
          {next ? (
            <>
              <p className="eyebrow accent">
                {next.start >= tomorrow.getTime() ? 'Tomorrow · ' : ''}
                {startsInLabel(next.start - now)}
              </p>
              <h4 className="event-title">
                <span className="live-dot" />
                {next.title}
              </h4>
              <p className="muted">
                {timeLabel(next.start)} – {timeLabel(next.end)}
              </p>
              <div className="event-people">
                <Avatars people={next.attendees} />
                <span className="muted small">
                  {next.attendees.length === 1
                    ? '1 person invited'
                    : next.attendees.length
                      ? `${next.attendees.length} people invited`
                      : 'A moment to get ready'}
                </span>
              </div>
              <div className="card-actions">
                <button
                  className="primary"
                  disabled={app.sessionRunning}
                  onClick={() => window.echo.requestStart(next.key)}
                >
                  <Icon name="play" size={12} /> Start with Echo
                </button>
                {next.joinUrl && (
                  <button onClick={() => window.echo.openJoinLink(next.key)}>
                    Join <Icon name="arrow" size={14} />
                  </button>
                )}
              </div>
            </>
          ) : app.detected ? (
            <>
              <span className="source-badge">Call detected</span>
              <h4 className="event-title">{app.detected.app} call in progress</h4>
              <p className="muted">Bring Echo along to help you stay in the conversation.</p>
              <button
                className="primary"
                disabled={app.sessionRunning}
                onClick={() => window.echo.requestStart()}
              >
                Start with Echo
              </button>
            </>
          ) : (
            <div className="card-empty">
              <span className="empty-symbol">
                <Icon name="calendar" size={26} />
              </span>
              <h4>A little breathing room</h4>
              <p className="muted">No meeting coming up. Echo is here when you need it.</p>
              <button
                aria-label="Start an unscheduled meeting"
                disabled={app.sessionRunning}
                onClick={() => window.echo.requestStart()}
              >
                Start a meeting
              </button>
            </div>
          )}
          {app.sessionRunning && (
            <p className="muted small">
              A meeting is already running. Use the controls in the header.
            </p>
          )}
        </section>
        <section className="dashboard-card">
          <div className="card-heading">
            <h3>Today</h3>
            <span className="muted small">& tomorrow</span>
          </div>
          {!app.calendar.configured && !app.integrations.accounts.length ? (
            <div className="card-empty">
              <span className="empty-symbol">
                <Icon name="calendar" size={26} />
              </span>
              <h4>Make room for what’s next</h4>
              <p className="muted">Connect your calendar to see your day here.</p>
              <button onClick={onCalendar}>Connect your calendar</button>
              <div className="calendar-shortcuts">
                <button className="link" onClick={onCalendar}>
                  Google
                </button>
                <span className="muted">·</span>
                <button className="link" onClick={onCalendar}>
                  Outlook
                </button>
                <span className="muted">·</span>
                <button className="link" onClick={onCalendar}>
                  iCal
                </button>
              </div>
            </div>
          ) : timeline.length ? (
            <ol className="timeline">
              {timeline.map((e) => (
                <li key={e.key}>
                  <time dateTime={new Date(e.start).toISOString()}>
                    {e.start >= tomorrow.getTime() && <span>Tomorrow</span>}
                    {e.allDay ? 'All day' : timeLabel(e.start)}
                  </time>
                  <Avatars people={e.attendees} />
                  <div>
                    <strong>{e.title}</strong>
                    <span className="muted small">
                      {e.attendees.length} {e.attendees.length === 1 ? 'person' : 'people'}{' '}
                      <Source event={e} />
                    </span>
                  </div>
                  {!e.allDay && e.start - now <= 3600000 && (
                    <button
                      className="small"
                      disabled={app.sessionRunning}
                      onClick={() => window.echo.requestStart(e.key)}
                    >
                      Start
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted quiet-empty">
              You’re all caught up. The rest of your day is clear.
            </p>
          )}
          {app.calendar.error && (
            <p className="warn" role="status">
              {app.calendar.error}{' '}
              <button className="link" onClick={onCalendar}>
                Calendar settings
              </button>
            </p>
          )}
        </section>
        <section className="dashboard-card" id="home-todos">
          <div className="card-heading">
            <h3>
              To do <span className="count">{actions.filter((a) => !a.done).length}</span>
            </h3>
            {actions.length > 8 && (
              <button className="link small" onClick={() => setAll(!all)}>
                {all ? 'Show less' : 'Show all'}
              </button>
            )}
          </div>
          {!loaded && !error ? (
            <p className="muted" role="status">
              Loading your to-dos…
            </p>
          ) : !actions.length ? (
            <div className="card-empty">
              <span className="empty-symbol">
                <Icon name="check" size={26} />
              </span>
              <h4>A fresh page</h4>
              <p className="muted">Action items from your meeting minutes will land here.</p>
            </div>
          ) : (
            <ul className="action-list">
              {(all ? sortedActions : sortedActions.slice(0, 8)).map((a) => (
                <li className={a.done ? 'done' : ''} key={`${a.meetingId}:${a.index}`}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={a.done}
                      disabled={pending.has(`${a.meetingId}:${a.index}`)}
                      onChange={() => void toggle(a)}
                    />
                    <span>{a.text}</span>
                  </label>
                  <div className="action-meta">
                    {a.owner && <span className="owner-chip">{a.owner}</span>}
                    <button className="link" onClick={() => onMeeting(a.meetingId)}>
                      {a.meetingTitle}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="dashboard-card">
          <div className="card-heading">
            <h3>Recent meetings</h3>
            <Icon name="book" />
          </div>
          {!loaded && !error ? (
            <p className="muted" role="status">
              Loading your meetings…
            </p>
          ) : !meetings.length ? (
            <div className="card-empty">
              <span className="empty-symbol">
                <Icon name="book" size={26} />
              </span>
              <h4>Good conversations, remembered</h4>
              <p className="muted">Your saved meetings and minutes will be right here.</p>
            </div>
          ) : (
            <div className="recent-meetings">
              {meetings.map((m) => (
                <button className="recent-meeting" key={m.id} onClick={() => onMeeting(m.id)}>
                  <span className="recent-avatar">
                    {attendees[m.id]?.length ? (
                      <Avatars people={attendees[m.id] ?? []} />
                    ) : (
                      <Avatar name={m.title} />
                    )}
                  </span>
                  <span className="recent-content">
                    <span className="recent-top">
                      <strong>{m.title}</strong>
                      <span className={`minutes-badge minutes-${m.minutes}`}>
                        {m.minutes === 'writing'
                          ? 'Writing…'
                          : m.minutes === 'ready'
                            ? 'Ready'
                            : m.minutes === 'failed'
                              ? 'Failed'
                              : 'No minutes'}
                      </span>
                    </span>
                    <span className="muted small">
                      {dateLabel(m.startedAt)} · {minutesLabel(m.durationMs)} · {m.actionItems}{' '}
                      action {m.actionItems === 1 ? 'item' : 'items'}
                    </span>
                    {m.snippet && <span className="meeting-snippet muted">Them: {m.snippet}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="dashboard-card dashboard-ask">
          <div>
            <h3>
              <Icon name="sparkle" /> Ask your meetings
            </h3>
            <p className="muted">The answer might already be in a conversation.</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) onAsk(question.trim());
            }}
          >
            <input
              aria-label="Ask your meetings"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              placeholder="What did we agree on last time?"
            />
            <button
              className="primary"
              type="submit"
              disabled={!question.trim()}
              aria-label="Send question"
            >
              <Icon name="send" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
