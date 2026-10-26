import { desktopCapturer, screen, type BrowserWindow } from 'electron';
import { withTimeout } from './context-loader.ts';

const MAX_SIDE = 1568;
const CAPTURE_TIMEOUT_MS = 5000;
/** Time for the compositor to drop the overlay before the screen is grabbed. */
const HIDE_SETTLE_MS = 100;

/**
 * One still of the display under the mouse pointer, as a JPEG data URL. The overlay is
 * made invisible for the capture and always restored. The image stays in memory: it is
 * never written to disk and never sent to the renderer.
 */
export function captureScreen(overlay: BrowserWindow | null): Promise<string> {
  // A second request while one is in flight shares it: two overlapping hides would
  // restore the overlay to invisible.
  inFlight ??= capture(overlay).finally(() => (inFlight = null));
  return inFlight;
}

let inFlight: Promise<string> | null = null;

async function capture(overlay: BrowserWindow | null): Promise<string> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = Math.min(
    1,
    MAX_SIDE / (Math.max(display.size.width, display.size.height) * display.scaleFactor),
  );
  const thumbnailSize = {
    width: Math.round(display.size.width * display.scaleFactor * scale),
    height: Math.round(display.size.height * display.scaleFactor * scale),
  };

  const restore = hide(overlay);
  try {
    await new Promise((r) => setTimeout(r, HIDE_SETTLE_MS));
    // Without a limit, a capture that never returns would leave the overlay invisible.
    const sources = await withTimeout(
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize }),
      CAPTURE_TIMEOUT_MS,
      'the screen capture timed out',
    );
    // Never guess between monitors: the wrong screen would be sent to the model.
    const source =
      sources.find((s) => s.display_id === String(display.id)) ??
      (sources.length === 1 ? sources[0] : undefined);
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(
        process.platform === 'darwin'
          ? 'no image (allow Screen Recording for Bolo in System Settings)'
          : 'the system returned no image',
      );
    }
    return `data:image/jpeg;base64,${source.thumbnail.toJPEG(80).toString('base64')}`;
  } finally {
    restore();
  }
}

function hide(overlay: BrowserWindow | null): () => void {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return () => {};
  // Linux has no window opacity, so the window is really hidden there.
  if (process.platform === 'linux') {
    overlay.hide();
    return () => !overlay.isDestroyed() && overlay.showInactive();
  }
  const opacity = overlay.getOpacity();
  overlay.setOpacity(0);
  return () => !overlay.isDestroyed() && overlay.setOpacity(opacity);
}
