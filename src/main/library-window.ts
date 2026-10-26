import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { MEETING_ID } from '../shared/meeting.ts';

/**
 * The meeting library: a normal window (in the taskbar, shareable on screen, unlike the
 * overlay) running the same renderer bundle with #library in the URL.
 */
export function createLibraryWindow(meetingId?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    title: 'Bolo — Meetings',
    backgroundColor: '#15171c',
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

  const hash = `library${meetingId && MEETING_ID.test(meetingId) ? `/${meetingId}` : ''}`;
  const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}#${hash}`);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash });
  return win;
}
