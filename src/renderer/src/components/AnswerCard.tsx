import type { SuggestionView } from '../../../shared/ipc.ts';

type Verdict = NonNullable<SuggestionView['verdict']>;

const TITLE: Record<Verdict, string> = {
  files: 'Answer · from your files',
  call: 'Answer · from this call',
  reply: 'Suggested reply',
  missing: 'Answer · not in your files',
  unverified: 'Answer · check this figure',
  screen: 'Answer · from your screen',
};

function title(s: SuggestionView | null, streaming: boolean): string {
  if (!s) return 'Answer';
  if (s.error) return 'Answer · failed';
  // Nothing claims to be verified until the check has run.
  if (streaming || !s.verdict) return 'Answer · checking';
  if (s.verdict === 'call' && !s.sources?.includes('transcript')) return 'Answer · from your note';
  return TITLE[s.verdict];
}

/** Plain text, except ``` fences, which become code blocks. An unclosed fence (still streaming) is code too. */
function AnswerText({ text }: { text: string }) {
  return text.split(/```[^\n]*\n?/).map((part, i) =>
    i % 2 ? (
      <pre key={i} className="code">
        <code>{part.replace(/\n$/, '')}</code>
      </pre>
    ) : (
      part.trim() && <span key={i}>{part.trim()}</span>
    ),
  );
}

export function AnswerCard({
  suggestion: s,
  running,
  onRequest,
}: {
  suggestion: SuggestionView | null;
  running: boolean;
  onRequest: () => void;
}) {
  const streaming = !!s && s.finishedAt === undefined;
  const tone = !s || streaming || s.error ? 'neutral' : (s.verdict ?? 'neutral');
  return (
    <section className={`answer answer-${tone}`} aria-live="polite">
      <header>
        <span className="answer-title">{title(s, streaming)}</span>
        <button
          className="hotkey"
          onClick={onRequest}
          disabled={!running}
          title="Answer what they just said, from anywhere"
        >
          <kbd>Ctrl+Shift+Space</kbd>
        </button>
      </header>
      {s?.asked && <p className="asked">You asked: {s.asked}</p>}
      {!s && (
        <p className="hint">
          Bolo answers when they ask a question. Ctrl+Shift+Space answers now; Ctrl+Alt+Space reads
          your screen.
        </p>
      )}
      {s?.error && <p className="error-text">{s.error}</p>}
      {s && !s.error && (
        <div className={`answer-text ${s.usedScreen ? 'long' : ''}`}>
          {s.text ? (
            <AnswerText text={s.text} />
          ) : streaming ? (
            s.usedScreen ? (
              'Reading your screen…'
            ) : (
              'Thinking…'
            )
          ) : null}
          {streaming && <span className="caret" />}
        </div>
      )}
      {s && !streaming && !s.error && (
        <footer>
          {s.sources?.map((src) => (
            <span key={src} className="chip">
              {src}
            </span>
          ))}
          {s.usedScreen && <span className="chip">screen</span>}
          {s.verdict === 'screen' && <span>read by the AI model, not checked</span>}
          {s.verdict === 'unverified' && (
            <span>a number here is not in your files or the call</span>
          )}
          {s.firstTokenMs !== undefined && <span className="ms">{s.firstTokenMs} ms</span>}
        </footer>
      )}
    </section>
  );
}
