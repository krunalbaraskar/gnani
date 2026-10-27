import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { AUDIO_PORT_MESSAGE, IPC, type BoloEvent } from '../shared/ipc.ts';
import type { BoloApi } from './api.ts';

const api: BoloApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  startSession: () => ipcRenderer.invoke(IPC.startSession),
  stopSession: () => ipcRenderer.invoke(IPC.stopSession),
  requestSuggestion: () => ipcRenderer.send(IPC.requestSuggestion),
  chooseExportDir: () => ipcRenderer.invoke(IPC.chooseExportDir),
  openExportDir: () => ipcRenderer.send(IPC.openExportDir),
  readDemoAudio: () => ipcRenderer.invoke(IPC.readDemoAudio),
  chooseContextDir: () => ipcRenderer.invoke(IPC.chooseContextDir),
  reloadContext: () => ipcRenderer.invoke(IPC.reloadContext),
  ask: (text, withScreen) => ipcRenderer.send(IPC.ask, text, withScreen),
  askScreen: () => ipcRenderer.send(IPC.askScreen),
  requestMeaning: (id) => ipcRenderer.send(IPC.requestMeaning, id),
  catchUp: () => ipcRenderer.send(IPC.catchUp),
  askMeetings: (question, askId) => ipcRenderer.invoke(IPC.askMeetings, question, askId),
  setPaused: (paused) => ipcRenderer.send(IPC.setPaused, paused),
  openLibrary: (id) => ipcRenderer.send(IPC.openLibrary, id),
  listMeetings: (query) => ipcRenderer.invoke(IPC.listMeetings, query),
  getMeeting: (id) => ipcRenderer.invoke(IPC.getMeeting, id),
  updateMeeting: (id, patch) => ipcRenderer.invoke(IPC.updateMeeting, id, patch),
  deleteMeeting: (id) => ipcRenderer.invoke(IPC.deleteMeeting, id),
  writeMinutes: (id) => ipcRenderer.send(IPC.writeMinutes, id),
  cancelMinutes: (id) => ipcRenderer.send(IPC.cancelMinutes, id),
  exportMeeting: (id, format) => ipcRenderer.invoke(IPC.exportMeeting, id, format),
  copyMinutes: (id) => ipcRenderer.invoke(IPC.copyMinutes, id),
  emailMinutes: (id) => ipcRenderer.send(IPC.emailMinutes, id),
  window: (cmd) => ipcRenderer.send(IPC.window, cmd),
  openAudioPort: (speaker) => {
    // MessagePorts can't cross contextBridge, so: one end to main over IPC, the
    // other to the page with window.postMessage (Electron's documented pattern).
    const { port1, port2 } = new MessageChannel();
    ipcRenderer.postMessage(IPC.audioPort, { speaker }, [port2]);
    window.postMessage(
      { type: AUDIO_PORT_MESSAGE, speaker },
      window.location.origin === 'null' ? '*' : window.location.origin,
      [port1],
    );
  },
  onEvent: (listener) => {
    const handler = (_e: IpcRendererEvent, event: BoloEvent) => listener(event);
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.removeListener(IPC.event, handler);
  },
};

contextBridge.exposeInMainWorld('bolo', api);
