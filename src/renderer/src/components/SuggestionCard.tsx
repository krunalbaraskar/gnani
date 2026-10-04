import type { SuggestionView } from '../../../shared/ipc.ts';

export function SuggestionCard({
  suggestion,
  onRequest,
  running,
}: {
  suggestion: SuggestionView | null;
  onRequest: () => void;
  running: boolean;
}) {
  const streaming = suggestion && suggestion.finishedAt === undefined;
  return (
    <section className={`suggestion ${streaming ? 'streaming' : ''}`} aria-live="polite">
      <header>
        <span className="suggestion-title">
          {suggestion?.trigger === 'auto'
            ? 'Suggested reply (question detected)'
            : 'Suggested reply'}
        </span>
        <button
          className="ghost small"
          onClick={onRequest}
          disabled={!running}
          title="Ctrl+Shift+Space"
        >
          Suggest <kbd>Ctrl+Shift+Space</kbd>
        </button>
      </header>
      {!suggestion && (
        <p className="hint">Press Ctrl+Shift+Space for a reply suggestion, from anywhere.</p>
      )}
      {suggestion?.error && <p className="error-text">{suggestion.error}</p>}
      {suggestion && !suggestion.error && (
        <p className="suggestion-text">
          {suggestion.text || (streaming ? 'Thinking…' : '')}
          {streaming && <span className="caret" />}
        </p>
      )}
      {suggestion?.firstTokenMs !== undefined && !streaming && (
        <footer>first words after {suggestion.firstTokenMs} ms</footer>
      )}
    </section>
  );
}
