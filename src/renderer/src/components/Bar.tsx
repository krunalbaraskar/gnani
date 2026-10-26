import { useEffect, useState } from 'react';
import type { ShareProtection } from '../../../shared/ipc.ts';
import { formatClock } from '../../../shared/transcript/format.ts';
import type { Speaker } from '../../../shared/transcript/types.ts';
import type { UiState } from '../state.ts';
import { Icon } from './Icon.tsx';

const SHIELD: Record<ShareProtection, string> = {
  hidden: 'Hidden from screen share',
  unverified: 'May be visible when sharing',
  demo: 'Visible in recordings (demo mode)',
};

function Dot({ speaker, state }: { speaker: Speaker; state: UiState }) {
  const st = state.stt[speaker];
  const lat = state.latency[speaker];
  const label = speaker === 'me' ? 'Me' : 'Them';
  const title = [
    `${label}: ${st.retryInMs !== undefined ? `retry in ${Math.ceil(st.retryInMs / 1000)}s` : st.state}`,
    st.error ? `Last error: ${st.error}` : '',
    lat.e2e !== undefined ? `End of speech → text: ${lat.e2e} ms` : '',
    lat.server !== undefined ? `Gnani processing: ${lat.server} ms` : '',
    st.droppedFrames ? `Frames dropped while offline: ${st.droppedFrames}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className={`dot dot-${st.state} dot-${speaker}`} title={title}>
      <i style={{ transform: `scale(${0.55 + 0.45 * state.levels[speaker]})` }} />
      {label}
    </span>
  );
}

interface Props {
  state: UiState;
  startedAt: number | null;
  share: ShareProtection;
  visionReady: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleOpen: () => void;
  onToggleMenu: () => void;
}

export function Bar({
  state,
  startedAt,
  share,
  visionReady,
  onStart,
  onStop,
  onToggleOpen,
  onToggleMenu,
}: Props) {
  const [question, setQuestion] = useState('');
  const [withScreen, setWithScreen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state.running]);

  const submit = () => {
    const text = question.trim();
    if (!text || !state.running) return;
    window.bolo.ask(text, withScreen);
    setQuestion('');
    setWithScreen(false); // the screen is attached to one question at a time
  };

  const canAsk = state.running && !state.clickThrough;
  return (
    <header className="bar">
      <span className="brand">Bolo</span>
      {state.running ? (
        <button className="bar-main stop" onClick={onStop} title="Stop the call and save">
          <Icon name="stop" size={12} />
          <span className="timer">{formatClock(startedAt ? Date.now() - startedAt : 0)}</span>
        </button>
      ) : (
        <button className="bar-main start" onClick={onStart} disabled={state.starting}>
          <Icon name="play" size={12} />
          {state.starting ? 'Starting…' : 'Start'}
        </button>
      )}

      {state.running && (
        <span className="dots" role="status" aria-label="Listening">
          <Dot speaker="them" state={state} />
          <Dot speaker="me" state={state} />
        </span>
      )}

      <form
        className={`ask ${withScreen ? 'with-screen' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!canAsk}
          maxLength={500}
          placeholder={
            state.clickThrough
              ? 'Click-through on · Ctrl+Shift+M to use Bolo'
              : state.running
                ? withScreen
                  ? 'Ask about your screen…'
                  : 'Ask about this call or your files…'
                : 'Start a call to ask'
          }
          aria-label="Ask Bolo"
        />
        <button
          type="button"
          className={`icon ${withScreen ? 'on' : ''}`}
          disabled={!canAsk || !visionReady}
          onClick={() => setWithScreen((v) => !v)}
          aria-pressed={withScreen}
          title={
            visionReady
              ? 'Attach my screen to this question (Ctrl+Alt+Space answers from the screen directly)'
              : 'Set a vision model in Settings to use the screen'
          }
        >
          <Icon name="screen" />
        </button>
        {question.trim() && (
          <button type="submit" className="icon" title="Ask (Enter)" disabled={!canAsk}>
            <Icon name="send" />
          </button>
        )}
      </form>

      <span
        className={`shield shield-${share}`}
        title={SHIELD[share]}
        role="img"
        aria-label={SHIELD[share]}
      >
        <Icon name="shield" />
      </span>
      <button
        className="icon"
        onClick={onToggleOpen}
        title={state.open ? 'Collapse' : 'Expand'}
        aria-expanded={state.open}
      >
        <Icon name={state.open ? 'chevronUp' : 'chevronDown'} />
      </button>
      <button className="icon" onClick={onToggleMenu} title="More">
        <Icon name="more" />
      </button>
    </header>
  );
}
