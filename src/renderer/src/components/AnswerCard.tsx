import type { SuggestionView } from '../../../shared/ipc.ts';
import { Avatar } from './Avatars.tsx';
import { messageTime } from './Transcript.tsx';

type Verdict = NonNullable<SuggestionView['verdict']>;

const TITLE: Record<Verdict, string> = {
  files: 'Answer · from your files',
  call: 'Answer · from this call',
  reply: 'Suggested reply',
  missing: 'Answer · not in your files',
  unverified: 'Answer · check this figure',
  screen: 'Answer · from your screen',
  recap: 'Catch-up · last 10 min',
};

/** Past meetings are cited as "meeting <date> <title>" (see core/meetings/memory.ts). */
const isMeeting = (src: string) => src.startsWith('meeting ');

function title(s: SuggestionView | null, streaming: boolean): string {
  if (!s) return 'Answer';
  const recap = s.trigger === 'catchup';
  if (s.error) return recap ? 'Catch-up · failed' : 'Answer · failed';
  // Nothing claims to be verified until the check has run.
  if (streaming || !s.verdict) return recap ? 'Catching you up…' : 'Answer · checking';
  if (recap && s.verdict === 'unverified') return 'Catch-up · check this figure';
  if (s.verdict === 'call' && !s.sources?.includes('transcript')) return 'Answer · from your note';
  if (s.verdict === 'files' && s.sources?.every(isMeeting)) return 'Answer · from past meetings';
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
    <article className="bot-message">
      <Avatar name="Echo" />
      <div className="message-body">
        <header className="message-header">
          <strong>Echo</strong>
          <span className="app-tag">APP</span>
          {s && (
            <time className="when" dateTime={new Date(s.startedAt).toISOString()}>
              {messageTime(s.startedAt)}
            </time>
          )}
        </header>
        <section className={`answer answer-${tone}`} aria-live="polite" aria-busy={streaming}>
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
              Echo answers when they ask a question. Ctrl+Shift+Space answers now; Ctrl+Alt+Space
              reads your screen; Ctrl+Shift+U catches you up.
            </p>
          )}
          {s?.error && <p className="error-text">{s.error}</p>}
          {s && !s.error && (
            <div className={`answer-text ${s.usedScreen || s.trigger === 'catchup' ? 'long' : ''}`}>
              {s.text ? (
                <AnswerText text={s.text} />
              ) : streaming ? (
                s.usedScreen ? (
                  'Reading your screen…'
                ) : (
                  'Thinking…'
                )
              ) : null}
            </div>
          )}
          {s && !streaming && !s.error && (
            <footer>
              {s.sources?.map((src) => (
                <span
                  key={src}
                  className={`chip ${isMeeting(src) ? 'chip-meeting' : ''}`}
                  title={src}
                >
                  {isMeeting(src) ? src.slice('meeting '.length) : src}
                </span>
              ))}
              {s.usedScreen && <span className="chip">screen</span>}
              {s.verdict === 'screen' && <span>read by the AI model, not checked</span>}
              {s.verdict === 'unverified' && (
                <span>
                  {s.trigger === 'catchup'
                    ? 'a number here was not said in the call'
                    : 'a number here is not in your files or the call'}
                </span>
              )}
              {s.firstTokenMs !== undefined && <span className="ms">{s.firstTokenMs} ms</span>}
            </footer>
          )}
        </section>
      </div>
    </article>
  );
}
