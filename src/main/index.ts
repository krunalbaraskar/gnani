import type { BrowserWindow } from 'electron';
import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MeetingService } from '../core/meetings/service.ts';
import { MeetingStore } from '../core/meetings/store.ts';
import { OpenAiCompatibleProvider } from '../core/llm/openai-compatible.ts';
import { GNANI_LANGUAGES } from '../core/stt/gnani-protocol.ts';
import { consoleLogger } from '../core/util/logger.ts';
import {
  IPC,
  type AppState,
  type BoloEvent,
  type AppSection,
  type ConnectResult,
  type ContextView,
  type ExportResult,
  type ShareProtection,
  type StartResult,
  type DemoAudio,
  type StopResult,
  type WindowCommand,
} from '../shared/ipc.ts';
import { markdownToPlainText } from '../shared/markdown.ts';
import { MEETING_ID, type MeetingPatch } from '../shared/meeting.ts';
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
import { CalendarService } from './calendar.ts';
import { APP_SECTIONS, createMainWindow } from './main-window.ts';
import { fileStem, writeMinutesPdf } from './minutes-export.ts';
import { installMediaHandlers } from './permissions.ts';
import { captureScreen } from './screen-capture.ts';
import { languageName, llmConfig, SessionController } from './session-controller.ts';
import { SettingsStore } from './settings-store.ts';

const HOTKEYS = {
  suggest: 'CommandOrControl+Shift+Space',
  toggleOverlay: 'CommandOrControl+Shift+H',
  clickThrough: 'CommandOrControl+Shift+M',
  // Not Ctrl+Shift+S: that is "Save As" in most apps, and this one sends a screenshot.
  askScreen: 'CommandOrControl+Alt+Space',
  catchUp: 'CommandOrControl+Shift+U',
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
let library: BrowserWindow | null = null;
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
    // A question naming the user brings a hidden overlay back, without taking focus.
    if (e.type === 'mention' && e.mention.asked && overlay && !overlay.isVisible())
      overlay.showInactive();
    for (const w of [overlay, library]) if (w && !w.isDestroyed()) w.webContents.send(IPC.event, e);
  };
  const meetings = new MeetingService({
    store: new MeetingStore(join(app.getPath('userData'), 'meetings'), log),
    llm: () => new OpenAiCompatibleProvider(llmConfig(settings.get(), loadEnv())),
    writer: () => ({
      myName: settings.get().myName,
      language: languageName(settings.get().myLanguage),
    }),
    emit,
    logger: log,
  });
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
  void meetings.refreshMemory();
  const calendar = new CalendarService(
    () => settings.get(),
    (view) => emit({ type: 'calendar', calendar: view }),
    log,
  );
  calendar.start();

  /** What answers are grounded in: the folder's files, then past meetings' minutes. */
  const answerContext = (): LoadedContext | null => {
    const memory = settings.get().useMeetings ? meetings.memory : [];
    const files = context.context;
    if (!files.files.length && !memory.length) return null;
    return {
      files: [
        ...files.files,
        ...[...new Set(memory.map((c) => c.file))].map((name) => ({ name, info: 'meeting' })),
      ],
      skipped: files.skipped,
      chunks: [...files.chunks, ...memory],
    };
  };

  const controller = new SessionController(loadEnv, () => settings.get(), answerContext, emit, log);

  const isOwn = (id: number) =>
    !!overlay && !overlay.isDestroyed() && overlay.webContents.id === id;
  installMediaHandlers(isOwn);

  overlay = createOverlayWindow({
    opaque: env.opaqueWindow,
    opacity: settings.get().overlayOpacity,
    protect: !env.recordable,
  });
  overlay.on('closed', () => (overlay = null));

  const isMain = (id: number) =>
    !!library && !library.isDestroyed() && library.webContents.id === id;
  /** Rejects IPC from anything other than the top frame of our two windows. */
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    (isOwn(e.sender.id) || isMain(e.sender.id)) && e.senderFrame === e.sender.mainFrame;
  /** Audio, window commands and the call itself belong to the overlay alone. */
  const fromOverlay = (e: IpcMainEvent | IpcMainInvokeEvent) =>
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
      sessionPaused: controller.paused,
      demoAudioDir: demoDir,
      context: contextView(s.contextDir, context),
      memoryMeetings: new Set(meetings.memory.map((c) => c.file)).size,
      calendar: calendar.view,
      integrations: { accounts: [], available: { google: false, microsoft: false } },
      detected: null,
      // The window's protection was fixed at startup; a later .env edit must not change the claim.
      shareProtection: shareProtection(env.recordable),
    };
  });

  handle(IPC.updateSettings, (patch: unknown) => {
    // Folders are only ever set through the folder dialogs in this process.
    const {
      exportDir: _ignored,
      contextDir: _alsoIgnored,
      calendarFile: _fileIgnored,
      ...safe
    } = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const before = settings.get().calendarUrl;
    // A link replaces a calendar file; only one source at a time.
    if (typeof safe['calendarUrl'] === 'string' && safe['calendarUrl']) safe['calendarFile'] = '';
    const next = settings.update(safe);
    if (env.opaqueWindow) overlay?.setOpacity(next.overlayOpacity);
    if (next.calendarUrl !== before) void calendar.refresh();
    return next;
  });

  // Files are re-read at call start, so edits made since the last call are picked up.
  handle(IPC.startSession, async (eventKey: unknown): Promise<StartResult> => {
    const s = settings.get();
    if (!s.consentAcknowledged || s.consentVersion < CONSENT_VERSION) {
      return { ok: false, error: 'Read and accept the notice first.' };
    }
    await loadContextDir();
    const event = typeof eventKey === 'string' ? calendar.find(eventKey) : undefined;
    return controller.start(
      event && {
        title: event.title,
        attendees: event.attendees.slice(0, 50),
        agenda: event.description.slice(0, 1500),
      },
    );
  });

  handle(IPC.chooseCalendarFile, async (clear: unknown) => {
    if (clear === true) {
      settings.update({ calendarFile: '' });
      return calendar.refresh();
    }
    const opts = {
      title: 'Calendar file (.ics)',
      properties: ['openFile' as const],
      filters: [{ name: 'Calendar', extensions: ['ics'] }],
    };
    const parent = library && !library.isDestroyed() ? library : overlay;
    const r = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    const file = r.canceled ? null : r.filePaths[0];
    if (file) settings.update({ calendarFile: file, calendarUrl: '' });
    return calendar.refresh();
  });
  handle(IPC.refreshCalendar, () => calendar.refresh());
  // Filled in by the accounts service (OAuth); until then sign-in reports it is unavailable.
  handle(IPC.connectAccount, (): ConnectResult => ({
    ok: false,
    error: 'Calendar sign-in is not available yet.',
  }));
  handle(IPC.disconnectAccount, () => undefined);
  ipcMain.on(IPC.openJoinLink, (e, key: unknown) => {
    const url = trusted(e) && typeof key === 'string' ? calendar.find(key)?.joinUrl : undefined;
    // Only the https meeting links the parser recognised, never anything else from the file.
    if (url?.startsWith('https://')) void shell.openExternal(url);
  });

  /**
   * Stops the session, saves it to the library, also exports it to the export folder if
   * one is set, and starts writing the minutes. `quitting`: the app is closing, so the
   * minutes are left for later.
   */
  async function finishSession(quitting: boolean): Promise<StopResult> {
    const record = await controller.stop();
    if (!record) return {};
    if (record.segments.length === 0)
      return { error: 'Nothing was transcribed, so nothing was saved.' };
    const result: StopResult = {};
    try {
      result.meetingId = (await meetings.saveRecord(record)).id;
    } catch (err) {
      result.error = `Could not save the meeting: ${(err as Error).message}`;
    }
    const s = settings.get();
    if (s.autoExport && s.exportDir) {
      try {
        result.exported = await writeSessionExport(s.exportDir, record);
      } catch (err) {
        result.error ??= `Could not export the meeting: ${(err as Error).message}`;
      }
    }
    const llm = llmConfig(s, loadEnv());
    if (result.meetingId && s.autoMinutes && !quitting && llm.baseUrl && llm.model) {
      void meetings.writeMinutes(result.meetingId);
      result.writingMinutes = true;
    }
    return result;
  }

  handle(IPC.stopSession, () => finishSession(false));

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
  ipcMain.on(IPC.catchUp, (e) => {
    if (trusted(e)) controller.catchUp();
  });
  handle(IPC.askMeetings, async (question: unknown, askId: unknown) => {
    const q = typeof question === 'string' ? question.trim().slice(0, 500) : '';
    if (!q || typeof askId !== 'number') return { error: 'Type a question.' };
    const llm = llmConfig(settings.get(), loadEnv());
    if (!llm.baseUrl || !llm.model) return { error: 'Set an AI model in Settings first.' };
    try {
      return await meetings.ask(q, {
        budget: settings.get().contextBudgetChars,
        onText: (text) => emit({ type: 'ask-progress', askId, text }),
      });
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
  ipcMain.on(IPC.setPaused, (e, paused: unknown) => {
    if (fromOverlay(e) && typeof paused === 'boolean') controller.setPaused(paused);
  });

  // ---- Meeting library ----

  /** Shows the main window at a section, creating it if needed. */
  const openApp = (section: AppSection = 'home', id?: string) => {
    if (library && !library.isDestroyed()) {
      library.webContents.send(IPC.event, {
        type: 'navigate',
        section,
        meetingId: id,
      } as BoloEvent);
      // Older renderers listen for this one.
      if (id) library.webContents.send(IPC.event, { type: 'open-meeting', id } as BoloEvent);
      if (library.isMinimized()) library.restore();
      library.show();
      library.focus();
      return;
    }
    library = createMainWindow(section, id);
    library.on('closed', () => (library = null));
  };
  const validId = (id: unknown): id is string => typeof id === 'string' && MEETING_ID.test(id);
  ipcMain.on(IPC.openLibrary, (e, id: unknown) => {
    if (trusted(e)) openApp('meetings', validId(id) ? id : undefined);
  });
  ipcMain.on(IPC.requestStart, (e, eventKey: unknown) => {
    if (!trusted(e) || !overlay || overlay.isDestroyed()) return;
    overlay.showInactive();
    overlay.webContents.send(IPC.event, {
      type: 'start-request',
      eventKey: typeof eventKey === 'string' ? eventKey : undefined,
    } as BoloEvent);
  });
  ipcMain.on(IPC.openApp, (e, section: unknown) => {
    if (trusted(e))
      openApp(APP_SECTIONS.includes(section as AppSection) ? (section as AppSection) : 'home');
  });
  handle(IPC.listActionItems, () => meetings.actionItems());
  handle(IPC.toggleActionItem, (id: unknown, index: unknown, done: unknown) =>
    validId(id) && Number.isInteger(index) && typeof done === 'boolean'
      ? meetings.setActionItem(id, index as number, done)
      : false,
  );
  handle(IPC.listMeetings, (query: unknown) =>
    meetings.list(typeof query === 'string' ? query.slice(0, 200) : ''),
  );
  handle(IPC.getMeeting, (id: unknown) => (validId(id) ? meetings.detail(id) : null));
  handle(IPC.updateMeeting, (id: unknown, patch: unknown) => {
    if (!validId(id) || !patch || typeof patch !== 'object') return null;
    const p = patch as Record<string, unknown>;
    const safe: MeetingPatch = {};
    for (const k of ['title', 'notes', 'minutes', 'themName'] as const)
      if (typeof p[k] === 'string') safe[k] = p[k];
    const line = p['lineSpeaker'] as Record<string, unknown> | undefined;
    if (line && typeof line.id === 'string' && typeof line.name === 'string')
      safe.lineSpeaker = { id: line.id, name: line.name };
    return meetings.update(id, safe);
  });
  const parentFor = () => (library && !library.isDestroyed() ? library : overlay);
  handle(IPC.deleteMeeting, async (id: unknown) => {
    const m = validId(id) ? await meetings.detail(id) : null;
    if (!m) return false;
    const parent = parentFor();
    const opts = {
      type: 'warning' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete “${m.title}”?`,
      detail: 'The transcript, notes and minutes are removed from this computer.',
    };
    const r = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
    return r.response === 0 ? meetings.delete(m.id) : false;
  });
  ipcMain.on(IPC.writeMinutes, (e, id: unknown) => {
    if (!trusted(e) || !validId(id)) return;
    const llm = llmConfig(settings.get(), loadEnv());
    if (!llm.baseUrl || !llm.model) {
      emit({
        type: 'notice',
        level: 'error',
        message: 'Set an AI model in Settings to write minutes.',
      });
      return;
    }
    void meetings.writeMinutes(id);
  });
  ipcMain.on(IPC.cancelMinutes, (e, id: unknown) => {
    if (trusted(e) && validId(id)) meetings.cancelMinutes(id);
  });
  handle(IPC.guessSpeakers, async (id: unknown) => {
    if (!validId(id)) return { error: 'No such meeting.' };
    const llm = llmConfig(settings.get(), loadEnv());
    if (!llm.baseUrl || !llm.model) return { error: 'Set an AI model in Settings first.' };
    try {
      return { named: await meetings.guessSpeakers(id) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
  handle(IPC.exportMeeting, async (id: unknown, format: unknown): Promise<ExportResult> => {
    const m = validId(id) ? await meetings.detail(id) : null;
    if (!m?.minutesView || (format !== 'md' && format !== 'pdf')) return null;
    const ext = format === 'pdf' ? 'pdf' : 'md';
    const opts = {
      title: format === 'pdf' ? 'Save minutes as PDF' : 'Save minutes as Markdown',
      defaultPath: join(
        settings.get().exportDir || app.getPath('documents'),
        `${fileStem(m.title)}.${ext}`,
      ),
      filters: [
        format === 'pdf'
          ? { name: 'PDF', extensions: ['pdf'] }
          : { name: 'Markdown', extensions: ['md'] },
      ],
    };
    const parent = parentFor();
    const r = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    try {
      if (format === 'pdf') await writeMinutesPdf(r.filePath, m.title, m.minutesView.markdown);
      else await writeFile(r.filePath, m.minutesView.markdown, 'utf8');
      shell.showItemInFolder(r.filePath);
      return { path: r.filePath };
    } catch (err) {
      return { error: `Could not save: ${(err as Error).message}` };
    }
  });
  const copyMinutes = async (id: unknown) => {
    const m = validId(id) ? await meetings.detail(id) : null;
    if (!m?.minutesView) return null;
    clipboard.writeText(markdownToPlainText(m.minutesView.markdown));
    return m;
  };
  handle(IPC.copyMinutes, async (id: unknown) => !!(await copyMinutes(id)));
  ipcMain.on(IPC.emailMinutes, (e, id: unknown) => {
    if (!trusted(e)) return;
    void copyMinutes(id).then((m) => {
      if (!m?.minutesView) return;
      // Mail apps cut long mailto bodies, so long minutes are pasted from the clipboard.
      const text = markdownToPlainText(m.minutesView.markdown);
      const body = text.length <= 1500 ? text : 'Minutes copied to the clipboard: paste them here.';
      void shell.openExternal(
        `mailto:?subject=${encodeURIComponent(`Minutes: ${m.title}`)}&body=${encodeURIComponent(body)}`,
      );
    });
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
    if (!fromOverlay(e) || !overlay) return;
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
    if (!fromOverlay(e) || !msg || !SPEAKERS.includes(msg.speaker as Speaker)) {
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
  register(HOTKEYS.catchUp, () => controller.catchUp());

  // Quitting mid-call still saves the transcript (if an export folder is set).
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !controller.running) return;
    e.preventDefault();
    quitting = true;
    void finishSession(true).finally(() => app.quit());
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
