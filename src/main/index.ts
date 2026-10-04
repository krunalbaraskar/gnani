import type { BrowserWindow } from 'electron';
import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GNANI_LANGUAGES } from '../core/stt/gnani-protocol.ts';
import { consoleLogger } from '../core/util/logger.ts';
import {
  IPC,
  type AppState,
  type BoloEvent,
  type DemoAudio,
  type StopResult,
  type WindowCommand,
} from '../shared/ipc.ts';
import { SPEAKERS, type Speaker } from '../shared/transcript/types.ts';
import { loadEnv } from './env.ts';
import { writeSessionExport } from './export-writer.ts';
import { createOverlayWindow, setClickThrough } from './overlay-window.ts';
import { installMediaHandlers } from './permissions.ts';
import { llmConfig, SessionController } from './session-controller.ts';
import { SettingsStore } from './settings-store.ts';

const HOTKEYS = {
  suggest: 'CommandOrControl+Shift+Space',
  toggleOverlay: 'CommandOrControl+Shift+H',
  clickThrough: 'CommandOrControl+Shift+M',
} as const;

const log = consoleLogger;
let overlay: BrowserWindow | null = null;
let clickThrough = false;

if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
  overlay?.showInactive();
});

void app.whenReady().then(() => {
  const env = loadEnv();
  const settings = new SettingsStore();
  const emit = (e: BoloEvent) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send(IPC.event, e);
  };
  const controller = new SessionController(loadEnv, () => settings.get(), emit, log);

  const isOwn = (id: number) =>
    !!overlay && !overlay.isDestroyed() && overlay.webContents.id === id;
  installMediaHandlers(isOwn);

  overlay = createOverlayWindow({
    opaque: env.opaqueWindow,
    opacity: settings.get().overlayOpacity,
  });
  overlay.on('closed', () => (overlay = null));

  /** Rejects IPC from anything other than our overlay's top frame. */
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    isOwn(e.sender.id) && e.senderFrame === e.sender.mainFrame;
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error('untrusted sender');
      return fn(...(args as A));
    });

  const demoDir = app.isPackaged
    ? join(app.getPath('userData'), 'demo-audio')
    : join(process.cwd(), 'demo-audio');

  handle(IPC.getState, (): AppState => {
    const e = loadEnv();
    const s = settings.get();
    const llm = llmConfig(s, e);
    return {
      settings: s,
      languages: GNANI_LANGUAGES.map((l) => ({ ...l })),
      keys: { gnani: !!e.gnaniApiKey, llm: !!e.llmApiKey },
      llm: { baseUrl: llm.baseUrl, model: llm.model },
      sttUrl: e.gnaniSttUrl,
      platform: process.platform,
      clickThrough,
      sessionRunning: controller.running,
      demoAudioDir: demoDir,
    };
  });

  handle(IPC.updateSettings, (patch: unknown) => {
    const next = settings.update(patch);
    if (env.opaqueWindow) overlay?.setOpacity(next.overlayOpacity);
    return next;
  });

  handle(IPC.startSession, () => controller.start());

  handle(IPC.stopSession, async (): Promise<StopResult> => {
    const record = await controller.stop();
    if (!record || !settings.get().autoExport) return {};
    let dir = settings.get().exportDir;
    if (!dir) {
      dir = (await chooseDir()) ?? '';
      if (!dir) return { error: 'Not saved: no export folder chosen.' };
    }
    try {
      return { exported: await writeSessionExport(dir, record) };
    } catch (err) {
      return { error: `Could not save the session: ${(err as Error).message}` };
    }
  });

  async function chooseDir(): Promise<string | null> {
    const opts = {
      title: 'Folder for Bolo session exports',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const r = overlay
      ? await dialog.showOpenDialog(overlay, opts)
      : await dialog.showOpenDialog(opts);
    const dir = r.canceled ? null : (r.filePaths[0] ?? null);
    if (dir) settings.update({ exportDir: dir });
    return dir;
  }
  handle(IPC.chooseExportDir, chooseDir);

  ipcMain.on(IPC.openExportDir, (e) => {
    const dir = settings.get().exportDir;
    if (trusted(e) && dir) void shell.openPath(dir);
  });

  handle(IPC.readDemoAudio, (): DemoAudio => {
    const read = (name: string) => {
      const p = join(demoDir, name);
      if (!existsSync(p)) return null;
      const b = readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    return { me: read('me.wav'), them: read('them.wav') };
  });

  ipcMain.on(IPC.requestSuggestion, (e) => {
    if (trusted(e)) controller.requestSuggestion();
  });

  const toggleClickThrough = () => {
    if (!overlay) return;
    clickThrough = !clickThrough;
    setClickThrough(overlay, clickThrough);
    emit({ type: 'click-through', enabled: clickThrough });
  };

  ipcMain.on(IPC.window, (e, cmd: WindowCommand) => {
    if (!trusted(e) || !overlay) return;
    switch (cmd?.kind) {
      case 'hide':
        overlay.hide();
        break;
      case 'toggle-click-through':
        toggleClickThrough();
        break;
      case 'resize': {
        const w = Math.round(Math.max(320, Math.min(1600, Number(cmd.width) || 0)));
        const h = Math.round(Math.max(300, Math.min(1400, Number(cmd.height) || 0)));
        overlay.setSize(w, h);
        break;
      }
      case 'quit':
        app.quit();
        break;
    }
  });

  // Audio frames arrive on one MessagePort per speaker (see preload openAudioPort).
  ipcMain.on(IPC.audioPort, (e, msg: { speaker?: Speaker }) => {
    const port = e.ports[0];
    if (!port) return;
    if (!trusted(e) || !msg || !SPEAKERS.includes(msg.speaker as Speaker)) {
      port.close();
      return;
    }
    const speaker = msg.speaker as Speaker;
    port.on('message', ({ data }) => {
      const frame = toBytes(data);
      if (frame && frame.length === 1024) controller.pushFrame(speaker, frame);
    });
    port.start();
  });

  const register = (accel: string, fn: () => void) => {
    if (!globalShortcut.register(accel, fn)) {
      log.warn('could not register hotkey (in use by another app?)', { accel });
      emit({ type: 'notice', level: 'error', message: `Hotkey ${accel} is taken by another app.` });
    }
  };
  register(HOTKEYS.suggest, () => controller.requestSuggestion());
  register(HOTKEYS.toggleOverlay, () => {
    if (!overlay) return;
    if (overlay.isVisible()) overlay.hide();
    else overlay.showInactive(); // don't steal focus from the call
  });
  register(HOTKEYS.clickThrough, toggleClickThrough);

  app.on('before-quit', () => {
    void controller.stop();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
