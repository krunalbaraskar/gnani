import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TodoItem } from '../shared/integrations.ts';

export const TODO_MAX_LENGTH = 500;

/** todos.json in the app's userData folder: to-dos the user added by hand. */
export class TodoStore {
  private items: TodoItem[];
  private readonly file: string;

  constructor(file = join(app.getPath('userData'), 'todos.json')) {
    this.file = file;
    this.items = this.load();
  }

  /** Open ones first, newest first within each. */
  list(): TodoItem[] {
    return [...this.items].sort(
      (a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt,
    );
  }

  add(text: string): TodoItem | null {
    const clean = text.trim().slice(0, TODO_MAX_LENGTH);
    if (!clean) return null;
    const item: TodoItem = { id: randomUUID(), text: clean, done: false, createdAt: Date.now() };
    this.items.push(item);
    this.save();
    return item;
  }

  setDone(id: string, done: boolean): boolean {
    const item = this.items.find((t) => t.id === id);
    if (!item) return false;
    item.done = done;
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  private load(): TodoItem[] {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(raw) ? raw.filter(isTodo) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.items, null, 2));
    renameSync(tmp, this.file); // atomic replace, so a crash can't leave half a file
  }
}

function isTodo(v: unknown): v is TodoItem {
  const t = v as TodoItem;
  return (
    !!t &&
    typeof t.id === 'string' &&
    typeof t.text === 'string' &&
    typeof t.done === 'boolean' &&
    typeof t.createdAt === 'number'
  );
}
