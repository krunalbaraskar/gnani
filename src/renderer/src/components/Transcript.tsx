import { useEffect, useRef } from 'react';
import type { Speaker, TranscriptSegment } from '../../../shared/transcript/types.ts';
import { Avatar } from './Avatars.tsx';

export function messageTime(at: number) {
  return new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function groupsWith(previous: TranscriptSegment | undefined, current: TranscriptSegment) {
  return !!previous && previous.speaker === current.speaker && current.at - previous.at < 120_000;
}

/** Every row keeps its speaker label, including when its visible header is grouped. */
export function Line({
  segment: s,
  name,
  grouped = false,
}: {
  segment: TranscriptSegment;
  name?: string;
  grouped?: boolean;
}) {
  const them = s.speaker === 'them';
  const speaker = name || (them ? 'Them' : 'Me');
  return (
    <article
      className={`line line-${s.speaker} ${grouped ? 'grouped' : ''} ${s.mentions?.length ? 'mentioned' : ''}`}
    >
      <span className="who sr-only">{them ? 'Them' : 'Me'}</span>
      {!grouped && <Avatar name={speaker} />}
      <div className="message-body">
        {!grouped && (
          <header className="message-header">
            <strong>{speaker}</strong>
            <time className="when" dateTime={new Date(s.at).toISOString()}>
              {messageTime(s.at)}
            </time>
          </header>
        )}
        <div className="text" lang="und">
          {s.text}
          {s.meaning && <span className="meaning">↳ {s.meaning}</span>}
        </div>
      </div>
      {them && (
        <button
          className="small line-action"
          onClick={() => window.bolo.requestMeaning(s.id)}
          aria-label={`Explain: ${s.text}`}
          title="Explain this line"
        >
          Explain
        </button>
      )}
    </article>
  );
}

export function PendingLine({
  speaker,
  name,
  text,
}: {
  speaker: Speaker;
  name: string;
  text: string;
}) {
  return (
    <div className={`pending-message line-${speaker}`}>
      <Avatar name={name} />
      <div className="message-body">
        <header className="message-header">
          <strong>{name}</strong>
          <span className="muted small">Speaking…</span>
        </header>
        <p className="pending">{text}</p>
      </div>
    </div>
  );
}

/** Stay with new messages unless the user has scrolled up to read earlier ones. */
export function useMessageScroll(changes: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [changes]);
  return {
    ref,
    onScroll: () => {
      const el = ref.current;
      if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    },
  };
}

export function Transcript({
  segments,
  partial,
  processing,
  myName,
  themName,
}: {
  segments: TranscriptSegment[];
  partial: Record<Speaker, string>;
  processing: Record<Speaker, boolean>;
  myName: string;
  themName: string;
}) {
  const scroll = useMessageScroll([segments, partial, processing]);
  const pending = (['them', 'me'] as const).filter((s) => partial[s] || processing[s]);
  return (
    <div
      className="transcript"
      role="tabpanel"
      id="overlay-panel-transcript"
      aria-labelledby="overlay-tab-transcript"
      tabIndex={0}
      {...scroll}
    >
      {segments.length === 0 && pending.length === 0 && (
        <p className="empty">The live transcript appears here.</p>
      )}
      {segments.map((s, i) => (
        <Line
          key={s.id}
          segment={s}
          name={s.speaker === 'me' ? myName : themName}
          grouped={groupsWith(segments[i - 1], s)}
        />
      ))}
      {pending.map((s) => (
        <PendingLine
          key={s}
          speaker={s}
          name={s === 'me' ? myName : themName}
          text={partial[s] || '…'}
        />
      ))}
    </div>
  );
}
