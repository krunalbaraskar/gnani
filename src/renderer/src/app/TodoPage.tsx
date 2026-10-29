import { useCallback, useEffect, useState } from 'react';
import type { ActionItemView, TodoItem } from '../../../shared/ipc.ts';
import { Icon } from '../components/Icon.tsx';
import type { Notify } from './MainWindow.tsx';

/**
 * Everything to do in one place: to-dos the user adds here, then action items from
 * meeting minutes (ticked in those minutes).
 */
export function TodoPage({
  onMeeting,
  notify,
}: {
  onMeeting: (id: string) => void;
  notify: Notify;
}) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [actions, setActions] = useState<ActionItemView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [mine, fromMeetings] = await Promise.all([
        window.echo.listTodos(),
        window.echo.listActionItems(),
      ]);
      setTodos(mine);
      setActions(fromMeetings);
      setLoaded(true);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const off = window.echo.onEvent((e) => {
      if (e.type === 'meeting-updated' || e.type === 'meeting-deleted') void refresh();
    });
    return off;
  }, [refresh]);

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const item = await window.echo.addTodo(text);
      if (!item) throw new Error('not added');
      setTodos((items) => [item, ...items]);
      setDraft('');
    } catch {
      notify('That to-do could not be added. Please try again.', true);
    } finally {
      setAdding(false);
    }
  };
  const toggleTodo = async (item: TodoItem) => {
    const done = !item.done;
    setTodos((items) => items.map((t) => (t.id === item.id ? { ...t, done } : t)));
    const ok = await window.echo.setTodoDone(item.id, done).catch(() => false);
    if (!ok) {
      setTodos((items) => items.map((t) => (t.id === item.id ? { ...t, done: item.done } : t)));
      notify('That to-do could not be saved. Please try again.', true);
    }
  };
  const remove = async (item: TodoItem) => {
    setTodos((items) => items.filter((t) => t.id !== item.id));
    const ok = await window.echo.deleteTodo(item.id).catch(() => false);
    if (!ok) {
      void refresh();
      notify('That to-do could not be deleted. Please try again.', true);
    }
  };
  const toggleAction = async (item: ActionItemView) => {
    const same = (a: ActionItemView) => a.meetingId === item.meetingId && a.index === item.index;
    const done = !item.done;
    setActions((items) => items.map((a) => (same(a) ? { ...a, done } : a)));
    const ok = await window.echo
      .toggleActionItem(item.meetingId, item.index, done)
      .catch(() => false);
    if (!ok) {
      setActions((items) => items.map((a) => (same(a) ? { ...a, done: item.done } : a)));
      notify('That action item could not be saved. Please try again.', true);
    }
  };

  return (
    <div className="page todo-page">
      <div className="dashboard-grid">
        {error && (
          <div className="inline-error" role="alert">
            Could not load your to-dos. <button onClick={() => void refresh()}>Try again</button>
          </div>
        )}
        <section className="dashboard-card">
          <div className="card-heading">
            <h3>
              Your to-dos <span className="count">{todos.filter((t) => !t.done).length}</span>
            </h3>
          </div>
          <form
            className="todo-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              aria-label="New to-do"
              placeholder="Add a to-do…"
              maxLength={500}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="primary" disabled={!draft.trim() || adding}>
              <Icon name="plus" size={15} /> Add
            </button>
          </form>
          {loaded && !todos.length ? (
            <p className="muted small">Nothing yet. Add anything you need to remember.</p>
          ) : (
            <ul className="action-list todo-own">
              {todos.map((t) => (
                <li className={t.done ? 'done' : ''} key={t.id}>
                  <label className="check">
                    <input type="checkbox" checked={t.done} onChange={() => void toggleTodo(t)} />
                    <span>{t.text}</span>
                  </label>
                  <div className="action-meta">
                    <button
                      className="icon"
                      aria-label={`Delete "${t.text}"`}
                      title="Delete"
                      onClick={() => void remove(t)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="dashboard-card">
          <div className="card-heading">
            <h3>
              From meetings <span className="count">{actions.filter((a) => !a.done).length}</span>
            </h3>
          </div>
          {!loaded && !error ? (
            <p className="muted" role="status">
              Loading your to-dos…
            </p>
          ) : !actions.length ? (
            <p className="muted small">Action items from your meeting minutes will land here.</p>
          ) : (
            <ul className="action-list">
              {actions.map((a) => (
                <li className={a.done ? 'done' : ''} key={`${a.meetingId}:${a.index}`}>
                  <label className="check">
                    <input type="checkbox" checked={a.done} onChange={() => void toggleAction(a)} />
                    <span>{a.text}</span>
                  </label>
                  <div className="action-meta">
                    {a.owner && <span className="owner-chip">{a.owner}</span>}
                    <button className="link" onClick={() => onMeeting(a.meetingId)}>
                      {a.meetingTitle}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
