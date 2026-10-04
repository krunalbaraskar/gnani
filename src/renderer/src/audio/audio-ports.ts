import { AUDIO_PORT_MESSAGE } from '../../../shared/ipc.ts';
import type { Speaker } from '../../../shared/transcript/types.ts';

/** Asks the preload for a MessagePort to the main process for one speaker's frames. */
export function openAudioPort(speaker: Speaker, timeoutMs = 3000): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('audio port was not delivered'));
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; speaker?: string } | null;
      if (e.source !== window || data?.type !== AUDIO_PORT_MESSAGE || data.speaker !== speaker)
        return;
      const port = e.ports[0];
      if (!port) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(port);
    }
    window.addEventListener('message', onMessage);
    window.bolo.openAudioPort(speaker);
  });
}

/** Sends a frame, transferring its buffer (zero-copy). */
export function postFrame(port: MessagePort, frame: Uint8Array): void {
  const buf =
    frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
      ? (frame.buffer as ArrayBuffer)
      : (frame.slice().buffer as ArrayBuffer);
  port.postMessage(buf, [buf]);
}
