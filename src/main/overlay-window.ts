import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export interface OverlayOptions {
  /** Some Windows GPU/driver combos can't resize transparent windows; fall back to opaque. */
  opaque: boolean;
  opacity: number;
  /** Keep the overlay out of screen shares and recordings (off only in demo mode). */
  protect: boolean;
}

/** Fixed width; the height follows the content (see the renderer's ResizeObserver). */
export const OVERLAY_WIDTH = 620;
export const OVERLAY_MIN_HEIGHT = 44;
export const OVERLAY_MAX_HEIGHT = 640;

export function createOverlayWindow(opts: OverlayOptions): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = OVERLAY_WIDTH;
  const height = OVERLAY_MIN_HEIGHT;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: OVERLAY_MIN_HEIGHT,
    // A slim bar at top-centre, like Cluely; it grows downwards into a panel.
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + 12,
    frame: false,
    transparent: !opts.opaque,
    backgroundColor: opts.opaque ? '#15171c' : '#00000000',
    resizable: false,
    alwaysOnTop: true,
    // Stay out of the taskbar; the overlay's menu ("Open Echo") reopens the main window.
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Echo',
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
  win.setContentProtection(opts.protect);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (opts.opaque) win.setOpacity(opts.opacity);

  win.once('ready-to-show', () => win.showInactive());

  // Never open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Dev server only: an installed app never loads its UI from an environment variable.
  const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

/** Click-through: mouse events pass to the app underneath (e.g. Zoom). */
export function setClickThrough(win: BrowserWindow, enabled: boolean): void {
  win.setIgnoreMouseEvents(enabled, { forward: true });
}
