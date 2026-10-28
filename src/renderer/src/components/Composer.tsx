import type { RefObject } from 'react';
import { Icon } from './Icon.tsx';

export function Composer({
  running,
  clickThrough,
  visionReady,
  question,
  withScreen,
  inputRef,
  onQuestion,
  onScreen,
  onSubmit,
}: {
  running: boolean;
  clickThrough: boolean;
  visionReady: boolean;
  question: string;
  withScreen: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuestion: (value: string) => void;
  onScreen: () => void;
  onSubmit: () => void;
}) {
  const canAsk = running && !clickThrough;
  return (
    <form
      className={`composer ${withScreen ? 'with-screen' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="Ask Bolo"
        placeholder="Message Bolo…"
        title={
          clickThrough ? 'Ctrl+Shift+M to use Bolo' : !running ? 'Start a call to ask' : undefined
        }
        value={question}
        onChange={(event) => onQuestion(event.target.value)}
        maxLength={500}
        disabled={!canAsk}
      />
      <div className="composer-toolbar">
        <button
          type="button"
          className={`icon ${withScreen ? 'on' : ''}`}
          disabled={!canAsk || !visionReady}
          onClick={onScreen}
          aria-label="Attach my screen"
          aria-pressed={withScreen}
          title={
            visionReady
              ? 'Attach my screen to this question'
              : 'Set a vision model in Settings to use the screen'
          }
        >
          <Icon name="screen" />
        </button>
        {withScreen && <span className="small accent">Screen attached</span>}
        <button
          type="button"
          className="ghost small catch-up"
          disabled={!canAsk}
          onClick={() => window.bolo.catchUp()}
          title="What was said in the last 10 minutes, and anything asked of you (Ctrl+Shift+U)"
        >
          <Icon name="history" size={15} /> Catch me up
        </button>
        <span className="spacer" />
        <button
          type="submit"
          className="icon send"
          aria-label="Send message"
          title="Ask (Enter)"
          disabled={!canAsk || !question.trim()}
        >
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}
