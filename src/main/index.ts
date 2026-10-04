import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
