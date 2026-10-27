import type { ContextView } from '../../../shared/ipc.ts';
import type { Settings } from '../../../shared/settings.ts';
import { useDraft } from './SettingsPanel.tsx';
import { Icon } from './Icon.tsx';

interface Props {
  context: ContextView;
  settings: Settings;
  /** Past meetings with minutes or notes that answers can use. */
  memoryMeetings: number;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * What Bolo knows: who you are, the folder of reference files, past meetings, and the note
 * about this call.
 */
export function ContextTab({ context, settings: s, memoryMeetings, onChange }: Props) {
  const note = useDraft(s.contextNote, (contextNote) => onChange({ contextNote }));
  const name = useDraft(s.myName, (myName) => onChange({ myName }));
  const watch = useDraft(s.watchWords, (watchWords) => onChange({ watchWords }));
  return (
    <div className="context">
      <label className="inline">
        My name
        <input
          type="text"
          maxLength={80}
          placeholder="Used in the minutes, and alerts when they say it"
          {...name}
        />
      </label>
      <label className="inline">
        Alert me on
        <input
          type="text"
          maxLength={300}
          placeholder="Project or client names, other spellings of my name (comma-separated)"
          {...watch}
        />
      </label>
      <p className="muted small">
        Speech-to-text may write names in another script (Hindi writes Krunal as क्रुणाल): add that
        spelling too.
      </p>

      <div className="row">
        <span className="path" title={context.dir}>
          {context.dir || 'No context folder yet'}
        </span>
        <button className="ghost small" onClick={() => void window.bolo.chooseContextDir()}>
          <Icon name="folder" size={13} /> Choose folder…
        </button>
        {context.dir && (
          <button className="ghost small" onClick={() => void window.bolo.reloadContext()}>
            Reload
          </button>
        )}
      </div>

      {context.error && <p className="warn">{context.error}</p>}
      {!context.dir && (
        <p className="muted">
          Add a folder with your stock sheet, price list or project notes (.csv, .md, .txt, .json).
          When they ask, Bolo answers from those files and shows which one.
        </p>
      )}

      {(context.files.length > 0 || context.skipped.length > 0) && (
        <ul className="files">
          {context.files.map((f) => (
            <li key={f.name}>
              <span>{f.name}</span>
              <span className="muted">{f.info}</span>
            </li>
          ))}
          {context.skipped.map((f) => (
            <li key={f.name} className="skipped">
              <span>{f.name}</span>
              <span>skipped: {f.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <label className="check">
        <input
          type="checkbox"
          checked={s.useMeetings}
          onChange={(e) => onChange({ useMeetings: e.target.checked })}
        />
        Also answer from my past meetings&apos; minutes and notes
        {s.useMeetings && <span className="muted small">({memoryMeetings} saved)</span>}
      </label>
      {(context.files.length > 0 || (s.useMeetings && memoryMeetings > 0)) && (
        <p className="muted small">
          What matches a question is sent to your AI model to answer it. Nothing is sent anywhere
          else.
        </p>
      )}

      <label>
        About me and this call
        <textarea
          rows={2}
          placeholder="e.g. I sell industrial paint to distributors. Be brief and polite."
          {...note}
        />
      </label>
    </div>
  );
}
