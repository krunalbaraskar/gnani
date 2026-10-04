import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export interface OverlayOptions {
  /** Some Windows GPU/driver combos can't resize transparent windows; fall back to opaque. */
  opaque: boolean;
  opacity: number;
}

export function createOverlayWindow(opts: OverlayOptions): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 420;
  const height = 640;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 300,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    frame: false,
    transparent: !opts.opaque,
    backgroundColor: opts.opaque ? '#15171c' : '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    show: false,
    title: 'Bolo',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep audio processing and timers running while the overlay is hidden.
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // Float above full-screen apps, and stay out of screen shares and recordings.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (opts.opaque) win.setOpacity(opts.opacity);

  win.once('ready-to-show', () => win.showInactive());

  // Never open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

/** Click-through: mouse events pass to the app underneath (e.g. Zoom). */
export function setClickThrough(win: BrowserWindow, enabled: boolean): void {
  win.setIgnoreMouseEvents(enabled, { forward: true });
}
