import { useEffect, useRef } from 'react';
import { formatClock } from '../../../shared/transcript/format.ts';
import type { Speaker, TranscriptSegment } from '../../../shared/transcript/types.ts';

interface Props {
  segments: TranscriptSegment[];
  partial: Record<Speaker, string>;
  processing: Record<Speaker, boolean>;
  startedAt: number | null;
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
        <div key={s.id} className={`line line-${s.speaker}`}>
          <span className="who">{s.speaker === 'me' ? 'Me' : 'Them'}</span>
          <span className="text" lang="und">
            {s.text}
          </span>
          <span className="when">{formatClock(s.at - t0)}</span>
        </div>
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
