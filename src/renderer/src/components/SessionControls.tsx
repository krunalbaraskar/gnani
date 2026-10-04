import { useRef } from 'react';
import type { Settings } from '../../../shared/settings.ts';
import type { ReplayFiles } from '../audio/file-replay.ts';

interface Props {
  settings: Settings;
  running: boolean;
  starting: boolean;
  files: ReplayFiles & { meName?: string; themName?: string };
  onFiles: (f: Props['files']) => void;
  onLoadDemo: () => void;
  onStart: () => void;
  onStop: () => void;
}

export function SessionControls({
  settings,
  running,
  starting,
  files,
  onFiles,
  onLoadDemo,
  onStart,
  onStop,
}: Props) {
  const meInput = useRef<HTMLInputElement>(null);
  const themInput = useRef<HTMLInputElement>(null);

  const pick = async (speaker: 'me' | 'them', list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    onFiles({ ...files, [speaker]: buf, [`${speaker}Name`]: file.name });
  };

  return (
    <div className="controls">
      {settings.audioMode === 'file' && !running && (
        <div className="file-row">
          <button
            className="ghost small"
            onClick={() => themInput.current?.click()}
            title="WAV with the other side"
          >
            Them: {files.themName ?? 'choose WAV'}
          </button>
          <button
            className="ghost small"
            onClick={() => meInput.current?.click()}
            title="WAV with your side"
          >
            Me: {files.meName ?? 'choose WAV'}
          </button>
          <button
            className="ghost small"
            onClick={onLoadDemo}
            title="Load demo-audio/me.wav and them.wav"
          >
            Demo
          </button>
          <input
            ref={themInput}
            type="file"
            accept=".wav,audio/wav"
            hidden
            onChange={(e) => void pick('them', e.target.files)}
          />
          <input
            ref={meInput}
            type="file"
            accept=".wav,audio/wav"
            hidden
            onChange={(e) => void pick('me', e.target.files)}
          />
        </div>
      )}
      {running ? (
        <button className="danger" onClick={onStop}>
          ■ Stop
        </button>
      ) : (
        <button className="primary" onClick={onStart} disabled={starting}>
          {starting
            ? 'Starting…'
            : settings.audioMode === 'file'
              ? '▶ Start replay'
              : '▶ Start listening'}
        </button>
      )}
    </div>
  );
}
