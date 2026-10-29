import { useEffect, useState } from 'react';
import type { ShareProtection } from '../../../shared/ipc.ts';
import { MEETING_MODES, type MeetingMode } from '../../../shared/settings.ts';
import { formatClock } from '../../../shared/transcript/format.ts';
import type { Speaker } from '../../../shared/transcript/types.ts';
import type { UiState } from '../state.ts';
import { Icon } from './Icon.tsx';

const SHIELD: Record<ShareProtection, string> = {
  hidden: 'Hidden from screen share',
  unverified: 'May be visible when sharing',
  demo: 'Visible in recordings (demo mode)',
};

export const MODE_INFO: Record<MeetingMode, { label: string; hint: string }> = {
  silent: {
    label: 'Silent',
    hint: 'Silent: transcribes only. No AI during the meeting unless you ask.',
  },
  assist: {
    label: 'Assist',
    hint: 'Assist: answers when you ask, meanings under mixed-language lines.',
  },
  active: {
    label: 'Active',
    hint: 'Active: also answers their questions on its own.',
  },
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
  mode: MeetingMode;
  onMode: (mode: MeetingMode) => void;
  onStart: () => void;
  onStop: () => void;
  onToggleOpen: () => void;
  onToggleMenu: () => void;
  onAsk: () => void;
  menuOpen: boolean;
}

export function Bar({
  state,
  startedAt,
  share,
  mode,
  onMode,
  onStart,
  onStop,
  onToggleOpen,
  onToggleMenu,
  onAsk,
  menuOpen,
}: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state.running]);

  return (
    <header className="bar">
      <span className="brand">
        <span className="brand-tile" aria-hidden>
          E
        </span>{' '}
        Echo
      </span>
      {state.running ? (
        <button className="bar-main stop" onClick={onStop} title="Stop the call and save">
          <span className={`live-dot ${state.paused ? 'paused-dot' : ''}`} />
          <span>{state.paused ? 'Paused' : 'Live'}</span>
          <span className="timer">{formatClock(startedAt ? Date.now() - startedAt : 0)}</span>
          <Icon name="stop" size={12} />
        </button>
      ) : (
        <button className="bar-main start" onClick={onStart} disabled={state.starting}>
          <Icon name="play" size={12} />
          {state.starting ? 'Starting…' : 'Start'}
        </button>
      )}

      {state.running && (
        <button
          className={`icon ${state.paused ? 'on' : ''}`}
          onClick={() => window.echo.setPaused(!state.paused)}
          aria-pressed={state.paused}
          aria-label={state.paused ? 'Resume' : 'Pause'}
          title={
            state.paused
              ? 'Paused: nothing is heard or transcribed. Click to resume.'
              : 'Pause (off the record)'
          }
        >
          <Icon name={state.paused ? 'play' : 'pause'} size={state.paused ? 12 : 16} />
        </button>
      )}

      {state.running &&
        (state.paused ? (
          <span className="paused-label" role="status" aria-label="Paused">
            Paused
          </span>
        ) : (
          <span className="dots" role="status" aria-label="Listening">
            <Dot speaker="them" state={state} />
            <Dot speaker="me" state={state} />
          </span>
        ))}

      <button
        className={`mode mode-${mode}`}
        onClick={() =>
          onMode(MEETING_MODES[(MEETING_MODES.indexOf(mode) + 1) % MEETING_MODES.length]!)
        }
        title={`${MODE_INFO[mode].hint}\nClick to switch.`}
        aria-label={`Mode: ${MODE_INFO[mode].label}`}
      >
        {MODE_INFO[mode].label}
      </button>

      <span className="spacer" />
      {!state.open && (
        <button className="ghost small bar-ask" onClick={onAsk} disabled={state.clickThrough}>
          <Icon name="send" size={14} /> Ask
        </button>
      )}

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
      <button
        id="overlay-more"
        className="icon"
        onClick={onToggleMenu}
        title="More"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls="overlay-menu"
      >
        <Icon name="more" />
      </button>
    </header>
  );
}
