import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markdownToHtml } from '../../../shared/markdown.ts';
import type {
  MeetingAnswerView,
  MeetingDetail,
  MeetingSummary,
  MinutesProgressView,
} from '../../../shared/meeting.ts';
import { MAX_SPEAKER_NAME, speakerOf } from '../../../shared/speakers.ts';
import { formatClock } from '../../../shared/transcript/format.ts';
import { Icon } from '../components/Icon.tsx';
import { MODE_INFO } from '../components/Bar.tsx';
import { Avatars } from '../components/Avatars.tsx';
import { moveTab } from '../components/Tabs.tsx';

type Tab = 'minutes' | 'transcript' | 'notes';

function when(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 1 ? `${Math.round(ms / 1000)} s` : min < 60 ? `${min} min` : formatClock(ms);
}

/** Groups the list by day: Today, Yesterday, or the date. */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

function initialId(): string | null {
  return /^#(?:library|app\/meetings)\/(m\d+)$/.exec(window.location.hash)?.[1] ?? null;
}

/** Markdown from the model or the user, rendered by the escaping renderer. */
function Rendered({ markdown }: { markdown: string }) {
  const html = useMemo(() => markdownToHtml(markdown), [markdown]);
  // markdownToHtml escapes all input; only its own tags reach the page.
  return <div className="doc" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A question asked of all meetings, while it streams and once it is answered. */
interface AskState {
  askId: number;
  question: string;
  text: string;
  answer?: MeetingAnswerView;
  error?: string;
}

let asks = 0;

export function Library({
  meetingId,
  onSelect,
}: {
  meetingId?: string;
  onSelect?: (id: string) => void;
}) {
  const [list, setList] = useState<MeetingSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(() => meetingId ?? initialId());
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [progress, setProgress] = useState<Record<string, MinutesProgressView>>({});
  const [tab, setTab] = useState<Tab>('minutes');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);
  // While an answer to a question is shown, the list shows every meeting, not search hits.
  const listQuery = ask ? '' : query;
  const queryRef = useRef(listQuery);
  const selectedRef = useRef(selected);
  queryRef.current = listQuery;
  selectedRef.current = selected;

  useEffect(() => {
    if (meetingId && meetingId !== selectedRef.current) {
      setQuery('');
      setAsk(null);
      setSelected(meetingId);
    }
  }, [meetingId]);

  const refreshList = useCallback(async () => {
    const query = queryRef.current;
    try {
      const next = await window.bolo.listMeetings(query);
      if (query !== queryRef.current) return;
      setList(next);
      setLoaded(true);
    } catch {
      setToast({ text: 'Could not load your meetings. Please try again.', error: true });
    }
  }, []);
  const refreshDetail = useCallback(async (id: string | null) => {
    try {
      const next = id ? await window.bolo.getMeeting(id) : null;
      if (id === selectedRef.current) setDetail(next);
    } catch {
      setToast({ text: 'Could not open this meeting. Please try again.', error: true });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refreshList(), listQuery ? 180 : 0);
    return () => clearTimeout(t);
  }, [listQuery, refreshList]);

  useEffect(() => {
    setDetail(null);
    void refreshDetail(selected);
    setTab('minutes');
  }, [selected, refreshDetail]);

  // Open the newest meeting when nothing was asked for.
  useEffect(() => {
    if (!selected && !listQuery && list[0]) {
      setSelected(list[0].id);
      onSelect?.(list[0].id);
    }
  }, [list, selected, listQuery, onSelect]);

  useEffect(
    () =>
      window.bolo.onEvent((e) => {
        switch (e.type) {
          case 'meeting-updated':
            void refreshList();
            if (e.summary.id === selectedRef.current) void refreshDetail(e.summary.id);
            if (e.summary.minutes !== 'writing')
              setProgress(({ [e.summary.id]: _done, ...rest }) => rest);
            break;
          case 'meeting-deleted':
            setList((current) => current.filter((m) => m.id !== e.id));
            void refreshList();
            if (e.id === selectedRef.current) setSelected(null);
            break;
          case 'minutes-progress':
            setProgress((p) => ({ ...p, [e.id]: e.progress }));
            break;
          case 'open-meeting':
            setQuery('');
            setSelected(e.id);
            break;
          case 'ask-progress':
            setAsk((a) => (a?.askId === e.askId && !a.answer ? { ...a, text: e.text } : a));
            break;
        }
      }),
    [refreshList, refreshDetail],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const startAsk = async () => {
    const question = query.trim();
    if (!question) return;
    const askId = ++asks;
    setAsk({ askId, question, text: '' });
    try {
      const r = await window.bolo.askMeetings(question, askId);
      setAsk((a) =>
        a?.askId !== askId ? a : 'error' in r ? { ...a, error: r.error } : { ...a, answer: r },
      );
    } catch {
      setAsk((a) =>
        a?.askId === askId
          ? { ...a, error: 'Could not reach your AI model. Please try again.' }
          : a,
      );
    }
  };
  const open = (id: string) => {
    setAsk(null);
    setSelected(id);
    onSelect?.(id);
  };

  const groups = useMemo(() => {
    const out: { label: string; items: MeetingSummary[] }[] = [];
    for (const m of list) {
      // Search results are ordered by relevance, so they are not grouped by day.
      const label = listQuery ? 'Results' : dayLabel(m.startedAt);
      if (out.at(-1)?.label === label) out.at(-1)!.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [list, listQuery]);

  return (
    <div className="library">
      <aside className="lib-side">
        <form
          className="lib-search"
          onSubmit={(e) => {
            e.preventDefault();
            void startAsk();
          }}
        >
          <Icon name="search" size={14} />
          <input
            type="search"
            placeholder="Search, or ask your meetings + Enter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search meetings"
          />
        </form>
        {query.trim() && (
          <button className="lib-ask" onClick={() => void startAsk()}>
            <Icon name="sparkle" size={14} />
            <span>
              Ask your meetings: <em>{query.trim()}</em>
            </span>
          </button>
        )}
        <nav className="lib-list" aria-label="Meetings">
          {loaded && list.length === 0 && (
            <p className="muted lib-empty-list">
              {listQuery
                ? 'No meeting mentions all of that. Press Enter to ask your meetings instead.'
                : 'No meetings yet.'}
            </p>
          )}
          {groups.map((g) => (
            <section key={g.label}>
              <h3>{g.label}</h3>
              {g.items.map((m) => (
                <button
                  key={m.id}
                  className={`lib-item ${m.id === selected ? 'on' : ''}`}
                  onClick={() => open(m.id)}
                  aria-current={!ask && m.id === selected}
                >
                  <span className="lib-item-title">{m.title}</span>
                  <span className="lib-item-meta">
                    {new Date(m.startedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {duration(m.durationMs)}
                    {m.minutes === 'writing' && <span className="badge busy">writing</span>}
                    {m.minutes === 'ready' && <span className="badge ready">ready</span>}
                    {m.minutes === 'failed' && <span className="badge bad">no minutes</span>}
                    {m.actionItems > 0 && <span className="badge">{m.actionItems} to do</span>}
                  </span>
                  {m.snippet && <span className="lib-item-snippet">{m.snippet}</span>}
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <main className="lib-main">
        {ask ? (
          <AskPane ask={ask} onOpen={open} onClose={() => setAsk(null)} />
        ) : detail ? (
          <MeetingView
            key={detail.id}
            m={detail}
            progress={progress[detail.id]}
            tab={tab}
            onTab={setTab}
            onChanged={setDetail}
            toast={(text, error) => setToast({ text, error })}
          />
        ) : (
          <div className="lib-empty">
            <Icon name="book" size={40} />
            <h2>
              {loaded && list.length === 0 && !query ? 'Your meetings live here' : 'Pick a meeting'}
            </h2>
            <p className="muted">
              When a meeting ends, Bolo saves the transcript on this computer and writes the
              minutes: summary, decisions and action items. Start one from the bar at the top of
              your screen.
            </p>
          </div>
        )}
      </main>

      {toast && (
        <div className={`lib-toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

export const ASK_LABEL: Record<MeetingAnswerView['verdict'], string> = {
  files: 'From your meetings',
  call: 'From your meetings',
  recap: 'From your meetings',
  screen: 'Answer',
  reply: 'Answer',
  missing: 'Not in your meetings',
  unverified: 'Check this figure: a number here is not in your meetings',
};

function AskPane({
  ask,
  onOpen,
  onClose,
}: {
  ask: AskState;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const a = ask.answer;
  return (
    <article className="meeting ask-pane">
      <header className="meeting-head">
        <h1 className="ask-question">{ask.question}</h1>
        <button className="ghost small" onClick={onClose}>
          <Icon name="close" size={14} /> Close
        </button>
        <div className="meeting-meta muted">Asked of all your saved meetings</div>
      </header>
      <div className="meeting-body">
        <section className={`ask-answer ${a ? `ask-${a.verdict}` : ''}`} aria-live="polite">
          <span className="ask-label">
            {ask.error ? 'Could not answer' : a ? ASK_LABEL[a.verdict] : 'Reading your meetings…'}
          </span>
          {ask.error ? (
            <p className="error-text">{ask.error}</p>
          ) : (
            <p className="ask-text">
              {a?.text ?? ask.text}
              {!a && <span className="caret" />}
            </p>
          )}
          {!!a?.sources.length && (
            <div className="ask-sources">
              {a.sources.map((s) => (
                <button key={s.meetingId} className="chip" onClick={() => onOpen(s.meetingId)}>
                  {s.name.replace(/^meeting /, '')}
                </button>
              ))}
            </div>
          )}
        </section>
        <p className="muted small">
          Bolo sends the parts of your meetings that match the question to your AI model, and checks
          every figure in the answer against them.
        </p>
      </div>
    </article>
  );
}

interface ViewProps {
  m: MeetingDetail;
  progress?: MinutesProgressView;
  tab: Tab;
  onTab: (t: Tab) => void;
  onChanged: (m: MeetingDetail) => void;
  toast: (text: string, error?: boolean) => void;
}

function MeetingView({ m, progress, tab, onTab, onChanged, toast }: ViewProps) {
  const [title, setTitle] = useState(m.title);
  useEffect(() => setTitle(m.title), [m.title]);
  const saveTitle = async () => {
    const t = title.trim();
    if (!t || t === m.title) return setTitle(m.title);
    const next = await window.bolo.updateMeeting(m.id, { title: t });
    if (next) onChanged(next);
  };

  return (
    <article className="meeting">
      <header className="meeting-head">
        <input
          className="meeting-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Meeting title"
          maxLength={200}
        />
        <div className="meeting-meta muted">
          {when(m.startedAt)} · {duration(m.durationMs)} · {m.lines} lines
          {m.mode && <> · {MODE_INFO[m.mode]?.label ?? m.mode} mode</>}
          {m.pauses.length > 0 && <> · paused {m.pauses.length}×</>}
        </div>
        {!!m.attendees.length && (
          <div className="meeting-attendees">
            <Avatars people={m.attendees} />
            <span className="muted small">{m.attendees.length} people invited</span>
          </div>
        )}
        <button
          className="ghost small danger"
          onClick={() => void window.bolo.deleteMeeting(m.id)}
          title="Delete this meeting from this computer"
        >
          <Icon name="trash" size={14} /> Delete
        </button>
      </header>

      <nav
        className="tabs lib-tabs"
        role="tablist"
        aria-label="Meeting details"
        onKeyDown={moveTab}
      >
        {(
          [
            ['minutes', 'Minutes'],
            ['transcript', 'Transcript'],
            ['notes', 'Notes & answers'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            id={`meeting-tab-${t}`}
            aria-controls="meeting-panel"
            className={tab === t ? 'on' : ''}
            onClick={() => onTab(t)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div
        className="meeting-body"
        role="tabpanel"
        id="meeting-panel"
        aria-labelledby={`meeting-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'minutes' && (
          <MinutesPane m={m} progress={progress} onChanged={onChanged} toast={toast} />
        )}
        {tab === 'transcript' && <TranscriptPane m={m} onChanged={onChanged} toast={toast} />}
        {tab === 'notes' && <NotesPane m={m} onChanged={onChanged} />}
      </div>
    </article>
  );
}

function MinutesPane({ m, progress, onChanged, toast }: Omit<ViewProps, 'tab' | 'onTab'>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const minutes = m.minutesView;

  if (m.minutes === 'writing') {
    return (
      <div className="minutes">
        <div className="minutes-bar">
          <span className="busy-dot" />
          <span>
            {progress?.stage === 'notes'
              ? `Reading the meeting, part ${progress.part} of ${progress.parts}…`
              : 'Writing the minutes…'}
          </span>
          <span className="spacer" />
          <button className="ghost small" onClick={() => window.bolo.cancelMinutes(m.id)}>
            Cancel
          </button>
        </div>
        {progress?.stage === 'writing' && <Rendered markdown={progress.text} />}
      </div>
    );
  }

  if (!minutes) {
    return (
      <div className="minutes-empty">
        {m.minutesError ? (
          <p className="error-text">Minutes were not written: {m.minutesError}</p>
        ) : (
          <p className="muted">No minutes for this meeting yet.</p>
        )}
        <button className="primary" onClick={() => window.bolo.writeMinutes(m.id)}>
          <Icon name="sparkle" size={14} /> {m.minutesError ? 'Try again' : 'Write minutes'}
        </button>
        <p className="muted small">
          Bolo sends the transcript and your notes to your AI model and writes a summary, key
          points, decisions, action items and open questions.
        </p>
      </div>
    );
  }

  const save = async () => {
    const next = await window.bolo.updateMeeting(m.id, { minutes: draft });
    if (next) onChanged(next);
    setEditing(false);
  };
  const exportAs = async (format: 'md' | 'pdf') => {
    const r = await window.bolo.exportMeeting(m.id, format);
    if (r && 'path' in r) toast(`Saved ${r.path}`);
    else if (r) toast(r.error, true);
  };

  return (
    <div className="minutes">
      <div className="minutes-bar">
        {editing ? (
          <>
            <button className="primary small" onClick={() => void save()}>
              Save
            </button>
            <button className="ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <span className="muted small">Markdown: # heading, - bullet, - [ ] action item</span>
          </>
        ) : (
          <>
            <button
              className="ghost small"
              onClick={() => {
                setDraft(minutes.markdown);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={14} /> Edit
            </button>
            <button
              className="ghost small"
              onClick={() =>
                void window.bolo
                  .copyMinutes(m.id)
                  .then((ok) => ok && toast('Copied. Paste into an email or chat.'))
              }
            >
              <Icon name="copy" size={14} /> Copy
            </button>
            <button className="ghost small" onClick={() => window.bolo.emailMinutes(m.id)}>
              <Icon name="mail" size={14} /> Email
            </button>
            <button className="ghost small" onClick={() => void exportAs('pdf')}>
              <Icon name="download" size={14} /> PDF
            </button>
            <button className="ghost small" onClick={() => void exportAs('md')}>
              <Icon name="download" size={14} /> Markdown
            </button>
            <span className="spacer" />
            <button
              className="ghost small"
              title={
                minutes.edited
                  ? 'Write them again from the transcript. Your edits will be replaced.'
                  : 'Write them again from the transcript and your notes'
              }
              onClick={() => {
                if (!minutes.edited || window.confirm('Replace your edited minutes?'))
                  window.bolo.writeMinutes(m.id);
              }}
            >
              <Icon name="sparkle" size={14} /> Rewrite
            </button>
          </>
        )}
      </div>

      {!editing && minutes.unverifiedFigures.length > 0 && (
        <p className="figure-warning" role="note">
          Check {minutes.unverifiedFigures.length === 1 ? 'this figure' : 'these figures'}:{' '}
          <strong>{minutes.unverifiedFigures.join(', ')}</strong>. Nobody said{' '}
          {minutes.unverifiedFigures.length === 1 ? 'it' : 'them'} in the meeting. Edit the minutes
          to fix or confirm.
        </p>
      )}

      {editing ? (
        <textarea
          className="minutes-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck
          autoFocus
          aria-label="Edit minutes"
        />
      ) : (
        <Rendered markdown={minutes.markdown} />
      )}
      {!editing && (
        <p className="muted small">
          Written {when(minutes.generatedAt)}
          {minutes.edited ? ', edited by you' : ' from the transcript. Check before sharing.'}
        </p>
      )}
    </div>
  );
}

/** Who said one "them" line: pick a known name, type another, or go back to "Them". */
function SpeakerPicker({
  m,
  segId,
  names,
  onChanged,
}: {
  m: MeetingDetail;
  segId: string;
  names: string[];
  onChanged: (m: MeetingDetail) => void;
}) {
  const [typing, setTyping] = useState(false);
  const current = speakerOf({ id: segId, speaker: 'them' }, '', m.speakers);
  const guessed = m.speakers.guessed?.includes(segId);
  const save = async (name: string) => {
    setTyping(false);
    const next = await window.bolo.updateMeeting(m.id, { lineSpeaker: { id: segId, name } });
    if (next) onChanged(next);
  };
  if (typing)
    return (
      <input
        className="who-input"
        autoFocus
        maxLength={MAX_SPEAKER_NAME}
        placeholder="Name"
        aria-label="Who said this"
        onBlur={(e) => (e.target.value.trim() ? void save(e.target.value) : setTyping(false))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setTyping(false);
        }}
      />
    );
  return (
    <select
      className={`who-pick ${guessed ? 'guessed' : ''}`}
      value={current}
      title={guessed ? 'Guessed by Bolo. Pick a name to confirm or change it.' : 'Who said this'}
      aria-label="Who said this"
      onChange={(e) => {
        const v = e.target.value;
        if (v === '\u0000other') setTyping(true);
        else void save(v === 'Them' ? '' : v);
      }}
    >
      {[...new Set([current, ...names, 'Them'])].map((n) => (
        <option key={n} value={n}>
          {n}
          {n === current && guessed ? ' ?' : ''}
        </option>
      ))}
      <option value={'\u0000other'}>Someone else…</option>
    </select>
  );
}

function TranscriptPane({
  m,
  onChanged,
  toast,
}: {
  m: MeetingDetail;
  onChanged: (m: MeetingDetail) => void;
  toast: (text: string, error?: boolean) => void;
}) {
  const [them, setThem] = useState(m.speakers.them ?? '');
  const [guessing, setGuessing] = useState(false);
  useEffect(() => setThem(m.speakers.them ?? ''), [m.speakers.them]);
  const names = useMemo(
    () =>
      [
        ...new Set(
          [...m.attendees, m.speakers.them ?? '', ...Object.values(m.speakers.byLine ?? {})]
            .map((n) => n.trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [m.attendees, m.speakers],
  );
  const saveThem = async () => {
    if (them.trim() === (m.speakers.them ?? '')) return;
    const next = await window.bolo.updateMeeting(m.id, { themName: them });
    if (next) onChanged(next);
  };
  const guess = async () => {
    setGuessing(true);
    const r = await window.bolo.guessSpeakers(m.id);
    setGuessing(false);
    if ('error' in r) toast(r.error, true);
    else
      toast(
        r.named
          ? `Named ${r.named} line${r.named === 1 ? '' : 's'}. Guesses are marked ?; pick a name to confirm.`
          : 'No names could be told from the conversation.',
      );
  };
  const items = useMemo(() => {
    type Item =
      | { kind: 'line'; at: number; seg: MeetingDetail['segments'][number] }
      | { kind: 'answer'; at: number; s: MeetingDetail['suggestions'][number] }
      | { kind: 'pause'; at: number; to: number };
    const out: Item[] = [
      ...m.segments.map((seg) => ({ kind: 'line' as const, at: seg.at, seg })),
      ...m.suggestions
        .filter((s) => s.text && !s.error && !s.cancelled)
        .map((s) => ({ kind: 'answer' as const, at: s.startedAt, s })),
      ...m.pauses.map((p) => ({ kind: 'pause' as const, at: p.from, to: p.to })),
    ];
    return out.sort((a, b) => a.at - b.at);
  }, [m]);
  if (!m.segments.length) return <p className="muted">Nothing was transcribed.</p>;
  return (
    <div className="lib-transcript">
      <div className="speakers-bar">
        <label className="inline">
          They are
          <input
            type="text"
            value={them}
            maxLength={MAX_SPEAKER_NAME}
            placeholder="Them — e.g. Mehta Hardware"
            onChange={(e) => setThem(e.target.value)}
            onBlur={() => void saveThem()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <button className="ghost small" disabled={guessing} onClick={() => void guess()}>
          <Icon name="sparkle" size={14} /> {guessing ? 'Working it out…' : 'Guess who said what'}
        </button>
        <span className="muted small">
          Speech-to-text hears you and “them”. Name them here, or line by line.
        </span>
      </div>
      {items.map((it, i) =>
        it.kind === 'line' ? (
          <div
            key={it.seg.id}
            className={`tline ${it.seg.speaker} ${it.seg.mentions ? 'mentioned' : ''}`}
          >
            <span className="t">{formatClock(it.at - m.startedAt)}</span>
            {it.seg.speaker === 'me' ? (
              <span className="who">Me</span>
            ) : (
              <SpeakerPicker m={m} segId={it.seg.id} names={names} onChanged={onChanged} />
            )}
            <span className="text">
              {it.seg.text}
              {it.seg.meaning && <em className="meaning">{it.seg.meaning}</em>}
            </span>
          </div>
        ) : it.kind === 'answer' ? (
          <div key={it.s.id} className="tline bolo">
            <span className="t">{formatClock(it.at - m.startedAt)}</span>
            <span className="who">Bolo</span>
            <span className="text">
              {it.s.asked && <span className="muted">You asked: {it.s.asked} — </span>}
              {it.s.text.replace(/```\w*\n?/g, '')}
              {!!it.s.sources?.length && (
                <span className="muted"> (from {it.s.sources.join(', ')})</span>
              )}
            </span>
          </div>
        ) : (
          <div key={`p${i}`} className="tline pause muted">
            <span className="t">{formatClock(it.at - m.startedAt)}</span>
            <span className="text">Paused for {duration(it.to - it.at)} (off the record)</span>
          </div>
        ),
      )}
    </div>
  );
}

function NotesPane({ m, onChanged }: { m: MeetingDetail; onChanged: (m: MeetingDetail) => void }) {
  const [notes, setNotes] = useState(m.notes);
  const [saved, setSaved] = useState(true);
  useEffect(() => setNotes(m.notes), [m.notes]);
  const save = async () => {
    if (notes === m.notes) return;
    const next = await window.bolo.updateMeeting(m.id, { notes });
    if (next) onChanged(next);
    setSaved(true);
  };
  const answers = m.suggestions.filter((s) => s.text && !s.error && !s.cancelled);
  return (
    <div className="notes">
      <label>
        My notes
        <textarea
          rows={8}
          value={notes}
          placeholder="Anything the transcript missed. Rewrite the minutes to include it."
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          onBlur={() => void save()}
        />
      </label>
      <p className="muted small">
        {saved ? 'Saved on this computer.' : 'Saves when you click away.'}
      </p>
      {m.agenda && (
        <>
          <h3>About this meeting</h3>
          <p>{m.agenda}</p>
        </>
      )}
      <h3>What Bolo answered during the meeting</h3>
      {answers.length === 0 ? (
        <p className="muted">No answers in this meeting.</p>
      ) : (
        <ul className="answers">
          {answers.map((s) => (
            <li key={s.id}>
              <span className="muted small">
                {formatClock(s.startedAt - m.startedAt)} ·{' '}
                {s.asked
                  ? `You asked: ${s.asked}`
                  : s.question
                    ? `They asked: ${s.question}`
                    : 'Suggested reply'}
              </span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
