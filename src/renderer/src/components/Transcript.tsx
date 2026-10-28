import { useEffect, useRef } from 'react';
import { formatClock } from '../../../shared/transcript/format.ts';
import type { Speaker, TranscriptSegment } from '../../../shared/transcript/types.ts';

interface Props {
  segments: TranscriptSegment[];
  partial: Record<Speaker, string>;
  processing: Record<Speaker, boolean>;
  startedAt: number | null;
}

/** One line of the conversation. "Them" lines can be clicked to (re)explain them. */
export function Line({ segment: s, when }: { segment: TranscriptSegment; when?: string }) {
  const them = s.speaker === 'them';
  const Tag = them ? 'button' : 'div';
  return (
    <Tag
      type={them ? 'button' : undefined}
      className={`line line-${s.speaker} ${them ? 'clickable' : ''} ${s.mentions ? 'mentioned' : ''}`}
      onClick={them ? () => window.bolo.requestMeaning(s.id) : undefined}
      title={
        them
          ? `${s.mentions ? `Mentions ${s.mentions.join(', ')}. ` : ''}Click to explain this line`
          : undefined
      }
    >
      <span className="who">{them ? 'Them' : 'Me'}</span>
      <span className="text" lang="und">
        {s.text}
        {s.meaning && <span className="meaning">{s.meaning}</span>}
      </span>
      {when && <span className="when">{when}</span>}
    </Tag>
  );
}

export function Transcript({ segments, partial, processing, startedAt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [segments, partial, processing]);

  const t0 = startedAt ?? segments[0]?.at ?? 0;
  const pending = (['them', 'me'] as const).filter((s) => partial[s] || processing[s]);

  return (
    <div
      className="transcript"
      role="tabpanel"
      id="overlay-panel-transcript"
      aria-labelledby="overlay-tab-transcript"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {segments.length === 0 && pending.length === 0 && (
        <p className="empty">The live transcript appears here.</p>
      )}
      {segments.map((s) => (
        <Line key={s.id} segment={s} when={formatClock(s.at - t0)} />
      ))}
      {pending.map((s) => (
        <div key={`pending-${s}`} className={`line line-${s} pending`}>
          <span className="who">{s === 'me' ? 'Me' : 'Them'}</span>
          <span className="text">{partial[s] || '…'}</span>
        </div>
      ))}
    </div>
  );
}
