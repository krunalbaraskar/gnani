import type { ContextView } from '../../../shared/ipc.ts';
import { useDraft } from './SettingsPanel.tsx';
import { Icon } from './Icon.tsx';

interface Props {
  context: ContextView;
  note: string;
  onNote: (note: string) => void;
}

/** What Bolo knows: the folder of reference files, and the note about this call. */
export function ContextTab({ context, note, onNote }: Props) {
  const draft = useDraft(note, onNote);
  return (
    <div className="context">
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
      {context.files.length > 0 && (
        <p className="muted small">
          These files are sent to your AI model to answer questions. They are not sent anywhere
          else.
        </p>
      )}

      <label>
        About me and this call
        <textarea
          rows={2}
          placeholder="e.g. I sell industrial paint to distributors. Be brief and polite."
          {...draft}
        />
      </label>
    </div>
  );
}
