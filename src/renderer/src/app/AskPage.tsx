import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeetingAnswerView } from '../../../shared/meeting.ts';
import { Icon } from '../components/Icon.tsx';
import { ASK_LABEL } from '../library/Library.tsx';

interface Turn {
  id: number;
  question: string;
  text: string;
  answer?: MeetingAnswerView;
  error?: string;
}

// This counter also avoids colliding with asks from the Meetings search field.
let nextAsk = Date.now();
const STARTERS = [
  'What did we agree with …?',
  'Open action items for me',
  'What did they ask about pricing?',
];

export function AskPage({
  active,
  initialQuestion,
  onOpen,
}: {
  active: boolean;
  initialQuestion: { text: string; id: number } | null;
  onOpen: (id: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const consumed = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question) return;
    const id = ++nextAsk;
    setTurns((t) => [...t, { id, question, text: '' }]);
    setDraft('');
    stick.current = true;
    try {
      const result = await window.bolo.askMeetings(question, id);
      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? { ...turn, ...('error' in result ? { error: result.error } : { answer: result }) }
            : turn,
        ),
      );
    } catch {
      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? { ...turn, error: 'Could not reach your AI model. Please try again.' }
            : turn,
        ),
      );
    }
  }, []);

  useEffect(
    () =>
      window.bolo.onEvent((event) => {
        if (event.type === 'ask-progress')
          setTurns((t) =>
            t.map((turn) =>
              turn.id === event.askId && !turn.answer && !turn.error
                ? { ...turn, text: event.text }
                : turn,
            ),
          );
      }),
    [],
  );
  useEffect(() => {
    if (!active || !initialQuestion || consumed.current === initialQuestion.id) return;
    consumed.current = initialQuestion.id;
    void send(initialQuestion.text);
  }, [active, initialQuestion, send]);
  useEffect(() => {
    if (active && stick.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns, active]);

  const busy = turns.some((t) => !t.answer && !t.error);
  return (
    <section className="ask-page" hidden={!active} aria-label="Ask your meetings">
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {!turns.length ? (
          <div className="ask-welcome">
            <span className="ask-symbol">
              <Icon name="sparkle" size={30} />
            </span>
            <p className="eyebrow">A second memory</p>
            <h2>
              Good questions.
              <br />
              Remembered conversations.
            </h2>
            <p className="muted">
              Ask across your saved meetings. Follow the sources back to the conversation.
            </p>
            <div className="starter-questions">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    if (q.includes('…')) {
                      setDraft('What did we agree with ');
                      input.current?.focus();
                    } else void send(q);
                  }}
                  disabled={busy}
                >
                  <Icon name="sparkle" size={14} />
                  {q}
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-turns">
            {turns.map((turn) => (
              <article className="chat-turn" key={turn.id}>
                <div className="question-bubble">
                  <span className="sr-only">You asked: </span>
                  {turn.question}
                </div>
                <section
                  className={`ask-answer ask-${turn.answer?.verdict ?? 'pending'}`}
                  aria-busy={!turn.answer && !turn.error}
                >
                  <span className="ask-label">
                    <Icon name="sparkle" size={14} />{' '}
                    {turn.error
                      ? 'Could not answer'
                      : turn.answer
                        ? ASK_LABEL[turn.answer.verdict]
                        : 'Reading your meetings…'}
                  </span>
                  <p className={`ask-text ${turn.error ? 'error-text' : ''}`}>
                    {turn.error ??
                      turn.answer?.text ??
                      (turn.text || 'Looking for the conversations that can help…')}
                    {!turn.answer && !turn.error && <span className="caret" />}
                  </p>
                  {!!turn.answer?.sources.length && (
                    <div className="ask-sources">
                      {turn.answer.sources.map((source) => (
                        <button
                          className="chip"
                          key={`${source.meetingId}:${source.name}`}
                          onClick={() => onOpen(source.meetingId)}
                        >
                          <Icon name="book" size={12} />
                          {source.name.replace(/^meeting /, '')}
                        </button>
                      ))}
                    </div>
                  )}
                  {turn.error && (
                    <button
                      className="small"
                      disabled={busy}
                      onClick={() => void send(turn.question)}
                    >
                      Try again
                    </button>
                  )}
                </section>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="chat-compose">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void send(draft);
          }}
        >
          <Icon name="sparkle" size={18} />
          <input
            ref={input}
            aria-label="Ask your meetings"
            placeholder="Ask anything about your meetings…"
            value={draft}
            maxLength={1000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="primary"
            type="submit"
            aria-label="Send question"
            disabled={!draft.trim() || busy}
          >
            <Icon name="arrow" />
          </button>
        </form>
        <p className="muted small" role="status">
          {busy
            ? 'Bolo is answering…'
            : 'Relevant parts of your meetings are sent to your AI model. Check answers before sharing.'}
        </p>
      </div>
    </section>
  );
}
