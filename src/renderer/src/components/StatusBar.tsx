import type { SttStatusView } from '../../../shared/ipc.ts';
import type { Speaker } from '../../../shared/transcript/types.ts';
import type { UiState } from '../state.ts';

const LABEL: Record<Speaker, string> = { me: 'Me', them: 'Them' };

function describe(s: SttStatusView): string {
  switch (s.state) {
    case 'reconnecting':
      return s.retryInMs !== undefined ? `retry ${Math.ceil(s.retryInMs / 1000)}s` : 'reconnecting';
    case 'error':
      return 'error';
    default:
      return s.state;
  }
}

function SpeakerStatus({ speaker, state }: { speaker: Speaker; state: UiState }) {
  const st = state.stt[speaker];
  const lat = state.latency[speaker];
  const title = [
    `${LABEL[speaker]} stream: ${st.state}`,
    st.error ? `Last error: ${st.error}` : '',
    lat.e2e !== undefined ? `End-of-speech → text: ${lat.e2e} ms (measured)` : '',
    lat.server !== undefined ? `Gnani processing: ${lat.server} ms (reported)` : '',
    st.droppedFrames ? `Frames dropped while offline: ${st.droppedFrames}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className={`status status-${st.state} speaker-${speaker}`} title={title}>
      <span className="status-dot" />
      <span className="status-name">{LABEL[speaker]}</span>
      <span className="level" aria-hidden>
        <span style={{ transform: `scaleX(${state.levels[speaker]})` }} />
      </span>
      <span className="status-text">
        {st.state === 'connected' && lat.e2e !== undefined ? `${lat.e2e} ms` : describe(st)}
      </span>
    </div>
  );
}

export function StatusBar({ state }: { state: UiState }) {
  return (
    <div className="statusbar">
      <SpeakerStatus speaker="them" state={state} />
      <SpeakerStatus speaker="me" state={state} />
    </div>
  );
}
