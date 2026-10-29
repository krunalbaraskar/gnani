import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { MIC_CONSENT_KEY, parseMicUsage } from '../core/integrations/mic-usage.ts';
import type { Logger } from '../core/util/logger.ts';
import type { DetectedMeeting } from '../shared/integrations.ts';

const POLL_MS = 4000;

export interface DetectorOptions {
  enabled: () => boolean;
  onChange: (meeting: DetectedMeeting | null) => void;
  log: Logger;
  /** Our own executable, which uses the microphone during a Echo call. */
  selfPaths: string[];
  /** Development and tests only: read this file instead of the registry. */
  fakeRegistryFile?: string;
}

function queryRegistry(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', MIC_CONSENT_KEY, '/s'],
      { windowsHide: true, timeout: 3000 },
      (err, out) => resolve(err ? '' : out),
    );
  });
}

/**
 * Notices calls in other apps (Zoom, Teams, a Meet tab…) from the apps Windows lists as
 * using the microphone right now. Polls a registry key every few seconds; no audio, no
 * window titles, nothing sent anywhere. Windows only; elsewhere it stays quiet.
 */
export class MeetingDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: DetectedMeeting | null = null;
  private busy = false;
  private readonly o: DetectorOptions;

  constructor(opts: DetectorOptions) {
    this.o = opts;
  }

  get meeting(): DetectedMeeting | null {
    return this.current;
  }

  start(): void {
    if (process.platform !== 'win32' && !this.o.fakeRegistryFile) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const text = !this.o.enabled()
        ? ''
        : this.o.fakeRegistryFile
          ? await readFile(this.o.fakeRegistryFile, 'utf8').catch(() => '')
          : await queryRegistry();
      const top = parseMicUsage(text, this.o.selfPaths)[0];
      const next: DetectedMeeting | null = !top
        ? null
        : this.current?.app === top.app
          ? this.current // the same call carries on
          : { app: top.app, since: Date.now(), key: `${top.id}@${Date.now()}` };
      if (next !== this.current) {
        this.current = next;
        this.o.onChange(next);
      }
    } catch (err) {
      this.o.log.warn('meeting detection failed', { error: (err as Error).message });
    } finally {
      this.busy = false;
    }
  }
}
