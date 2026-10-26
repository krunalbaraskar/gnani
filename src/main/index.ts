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
  type ContextView,
  type ShareProtection,
  type StartResult,
  type DemoAudio,
  type StopResult,
  type WindowCommand,
} from '../shared/ipc.ts';
import { CONSENT_VERSION } from '../shared/settings.ts';
import { SPEAKERS, type Speaker } from '../shared/transcript/types.ts';
import type { LoadedContext } from '../core/context/context.ts';
import { contextView, readContextDir } from './context-loader.ts';
import { loadEnv, sttInfo } from './env.ts';
import { writeSessionExport } from './export-writer.ts';
import {
  createOverlayWindow,
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_WIDTH,
  setClickThrough,
} from './overlay-window.ts';
import { installMediaHandlers } from './permissions.ts';
import { captureScreen } from './screen-capture.ts';
import { llmConfig, SessionController } from './session-controller.ts';
import { SettingsStore } from './settings-store.ts';

const HOTKEYS = {
  suggest: 'CommandOrControl+Shift+Space',
  toggleOverlay: 'CommandOrControl+Shift+H',
  clickThrough: 'CommandOrControl+Shift+M',
  // Not Ctrl+Shift+S: that is "Save As" in most apps, and this one sends a screenshot.
  askScreen: 'CommandOrControl+Alt+Space',
} as const;

/**
 * Where "hidden from screen share" was checked by hand (docs/WINDOWS_TESTING.md): the
 * platform and the lowest OS build tested. Empty until that check passes; the overlay
 * only claims to be hidden on machines this covers.
 */
const SHARE_PROTECTION_VERIFIED: { platform: NodeJS.Platform; minBuild: number }[] = [
  // Windows 11 build 26100, 2026-10-09: absent from a GDI screen capture with the transparent
  // window and with BOLO_OPAQUE_WINDOW=1; present in both with BOLO_RECORDABLE=1.
  { platform: 'win32', minBuild: 26100 },
];

function shareProtection(recordable: boolean): ShareProtection {
  if (recordable) return 'demo';
  const build = Number(process.getSystemVersion().split('.').pop());
  return SHARE_PROTECTION_VERIFIED.some(
    (v) => v.platform === process.platform && build >= v.minBuild,
  )
    ? 'hidden'
    : 'unverified';
}

const log = consoleLogger;
let overlay: BrowserWindow | null = null;
let clickThrough = false;

// Pin the name and settings folder (%APPDATA%\Bolo) however the app is launched;
// otherwise `electron <script>` would use "Electron".
app.setName('Bolo');
// BOLO_USER_DATA lets the end-to-end test use a throwaway folder: on Windows the appData
// path does not follow the APPDATA environment variable.
const testUserData = app.isPackaged ? undefined : process.env['BOLO_USER_DATA'];
app.setPath('userData', testUserData || join(app.getPath('appData'), 'Bolo'));

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
  // The user's reference files. Only names and sizes ever go to the renderer.
  let context: { context: LoadedContext; error?: string } = {
    context: { files: [], skipped: [], chunks: [] },
  };
  let contextLoads = 0;
  const loadContextDir = (): Promise<ContextView> => {
    const dir = settings.get().contextDir;
    const load = ++contextLoads;
    return readContextDir(dir).then((loaded) => {
      // A slow read of a folder the user has since changed must not win.
      if (load !== contextLoads) return contextView(settings.get().contextDir, context);
      context = loaded;
      const view = contextView(dir, loaded);
      emit({ type: 'context', context: view });
      return view;
    });
  };
  void loadContextDir();

  const controller = new SessionController(
    loadEnv,
    () => settings.get(),
    () => (context.context.files.length ? context.context : null),
    emit,
    log,
  );

  const isOwn = (id: number) =>
    !!overlay && !overlay.isDestroyed() && overlay.webContents.id === id;
  installMediaHandlers(isOwn);

  overlay = createOverlayWindow({
    opaque: env.opaqueWindow,
    opacity: settings.get().overlayOpacity,
    protect: !env.recordable,
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
    const stt = sttInfo(e);
    return {
      settings: s,
      languages: GNANI_LANGUAGES.map((l) => ({ ...l })),
      keys: { stt: stt.key, llm: !!e.llmApiKey },
      stt: { name: stt.name, keyVar: stt.keyVar, url: stt.url },
      llm: { baseUrl: llm.baseUrl, model: llm.model },
      platform: process.platform,
      clickThrough,
      sessionRunning: controller.running,
      demoAudioDir: demoDir,
      context: contextView(s.contextDir, context),
      // The window's protection was fixed at startup; a later .env edit must not change the claim.
      shareProtection: shareProtection(env.recordable),
    };
  });

  handle(IPC.updateSettings, (patch: unknown) => {
    // Folders are only ever set through the folder dialogs in this process.
    const {
      exportDir: _ignored,
      contextDir: _alsoIgnored,
      ...safe
    } = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const next = settings.update(safe);
    if (env.opaqueWindow) overlay?.setOpacity(next.overlayOpacity);
    return next;
  });

  // Files are re-read at call start, so edits made since the last call are picked up.
  handle(IPC.startSession, async (): Promise<StartResult> => {
    const s = settings.get();
    if (!s.consentAcknowledged || s.consentVersion < CONSENT_VERSION) {
      return { ok: false, error: 'Read and accept the notice first.' };
    }
    await loadContextDir();
    return controller.start();
  });

  /** Stops the session and exports it. `interactive` allows asking for a folder. */
  async function finishSession(interactive: boolean): Promise<StopResult> {
    const record = await controller.stop();
    if (!record || !settings.get().autoExport) return {};
    let dir = settings.get().exportDir;
    if (!dir && interactive) dir = (await chooseDir()) ?? '';
    if (!dir) return { error: 'Not saved: no export folder chosen.' };
    try {
      return { exported: await writeSessionExport(dir, record) };
    } catch (err) {
      return { error: `Could not save the session: ${(err as Error).message}` };
    }
  }

  handle(IPC.stopSession, () => finishSession(true));

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

  handle(IPC.chooseContextDir, async (): Promise<ContextView> => {
    const opts = {
      title: 'Folder with the files Bolo should answer from',
      properties: ['openDirectory' as const],
    };
    const r = overlay
      ? await dialog.showOpenDialog(overlay, opts)
      : await dialog.showOpenDialog(opts);
    const dir = r.canceled ? null : r.filePaths[0];
    if (dir) settings.update({ contextDir: dir });
    return loadContextDir();
  });
  handle(IPC.reloadContext, loadContextDir);

  const capture = () => captureScreen(overlay);
  ipcMain.on(IPC.ask, (e, text: unknown, withScreen: unknown) => {
    if (!trusted(e) || typeof text !== 'string') return;
    const question = text.trim().slice(0, 500);
    if (question) void controller.ask(question, withScreen === true ? capture : undefined);
  });
  ipcMain.on(IPC.askScreen, (e) => {
    if (trusted(e)) void controller.askScreen(capture);
  });
  ipcMain.on(IPC.requestMeaning, (e, id: unknown) => {
    if (trusted(e) && typeof id === 'string') controller.requestMeaning(id);
  });

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
        // Width is fixed; the renderer reports how tall its content is.
        const h = Math.round(
          Math.max(OVERLAY_MIN_HEIGHT, Math.min(OVERLAY_MAX_HEIGHT, Number(cmd.height) || 0)),
        );
        if (overlay.getSize()[1] !== h) {
          // setSize ignores resizable:false only on some platforms, so lift it briefly.
          overlay.setResizable(true);
          overlay.setSize(OVERLAY_WIDTH, h);
          overlay.setResizable(false);
        }
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
  register(HOTKEYS.askScreen, () => void controller.askScreen(capture));

  // Quitting mid-call still saves the transcript (if an export folder is set).
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !controller.running) return;
    e.preventDefault();
    quitting = true;
    void finishSession(false).finally(() => app.quit());
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
