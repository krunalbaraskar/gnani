import type { UiState } from '../state.ts';
import { AnswerCard } from './AnswerCard.tsx';
import { groupsWith, Line, PendingLine, useMessageScroll } from './Transcript.tsx';

export function LiveFeed({ state, themName }: { state: UiState; themName: string }) {
  const scroll = useMessageScroll([
    state.segments,
    state.partial,
    state.processing,
    state.suggestion,
  ]);
  const them = state.segments.filter((s) => s.speaker === 'them').slice(-4);
  const suggestion = state.suggestion;
  const posts = [
    ...them.map((segment) => ({ at: segment.at, segment })),
    ...(suggestion ? [{ at: suggestion.startedAt, segment: null }] : []),
  ].sort((a, b) => a.at - b.at);
  const pending = state.partial.them || (state.processing.them ? '…' : '');
  return (
    <div
      className="live-feed"
      tabIndex={0}
      role="region"
      aria-label="Live conversation"
      {...scroll}
    >
      {posts.length > 0 && <div className="date-separator">Today</div>}
      {!posts.length && (
        <div className="feed-empty">
          <strong>
            {state.running ? 'You’re here. Echo is listening.' : 'Be here. Echo remembers.'}
          </strong>
          <p>
            {state.running
              ? 'Their words and Echo’s answers appear here.'
              : 'Press Start when your call begins.'}
          </p>
          <p className="small">
            <kbd>Ctrl+Shift+Space</kbd> answer · <kbd>Ctrl+Alt+Space</kbd> screen ·{' '}
            <kbd>Ctrl+Shift+U</kbd> catch up
          </p>
        </div>
      )}
      {posts.map((post, i) =>
        post.segment ? (
          <Line
            key={post.segment.id}
            segment={post.segment}
            name={themName}
            grouped={
              groupsWith(posts[i - 1]?.segment ?? undefined, post.segment) &&
              groupsWith(state.segments[state.segments.indexOf(post.segment) - 1], post.segment)
            }
          />
        ) : (
          <AnswerCard
            key={suggestion!.id}
            suggestion={suggestion}
            running={state.running}
            onRequest={() => window.echo.requestSuggestion()}
          />
        ),
      )}
      {pending && <PendingLine speaker="them" name={themName} text={pending} />}
    </div>
  );
}
