import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import type { AppSection } from '../shared/ipc.ts';
import { MEETING_ID } from '../shared/meeting.ts';

export const APP_SECTIONS: readonly AppSection[] = ['home', 'meetings', 'ask', 'settings'];

/** The renderer route for a section, e.g. "app/meetings/m1790000000000". */
export function appHash(section: AppSection = 'home', meetingId?: string): string {
  const id = section === 'meetings' && meetingId && MEETING_ID.test(meetingId) ? meetingId : '';
  return id ? `app/${section}/${id}` : `app/${section}`;
}

/**
 * The main window: home, meetings, ask, settings. A normal window (in the taskbar,
 * shareable on screen, unlike the overlay) running the same renderer bundle with #app in
 * the URL.
 */
export function createMainWindow(section: AppSection = 'home', meetingId?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 540,
    title: 'Bolo',
    backgroundColor: '#f7f7f5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Links inside minutes open in the browser, never inside the app.
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  const hash = appHash(section, meetingId);
  const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}#${hash}`);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash });
  return win;
}
