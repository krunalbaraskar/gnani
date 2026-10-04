import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings.ts';

/** settings.json in the app's userData folder; validated on every read and write. */
export class SettingsStore {
  private current: Settings;
  private readonly file: string;

  constructor(file = join(app.getPath('userData'), 'settings.json')) {
    this.file = file;
    this.current = this.load();
  }

  get(): Settings {
    return this.current;
  }

  update(patch: unknown): Settings {
    this.current = sanitizeSettings(patch, this.current);
    this.save();
    return this.current;
  }

  private load(): Settings {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2));
    renameSync(tmp, this.file); // atomic replace, so a crash can't leave half a file
  }
}
