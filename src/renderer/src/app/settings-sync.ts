/** Settings have no IPC event. Notify sibling renderers to re-read the typed API. */
const CHANNEL = 'echo-settings-updated';

export function settingsChanged() {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage('refresh');
  channel.close();
}

export function onSettingsChanged(refresh: () => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = refresh;
  return () => channel.close();
}
