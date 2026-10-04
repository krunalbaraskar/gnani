/**
 * Optional UI smoke test: drives the BUILT overlay (out/renderer) in Chromium with a
 * fake window.bolo API and a fake microphone. Checks WAV replay end to end in the
 * renderer and the live AudioWorklet path. Not part of `npm test` (needs a browser).
 *
 *   npm run build
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/ui-smoke.mjs            # screenshots go to out/ui-smoke/
 *
 * Set CHROMIUM_PATH to use an existing Chromium/Chrome binary instead.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const repo = join(import.meta.dirname, '..');
const root = join(repo, 'out', 'renderer');
const fixtures = join(repo, 'test', 'fixtures');
const shots = join(repo, 'out', 'ui-smoke');
mkdirSync(shots, { recursive: true });
const shot = (name) => ({ path: join(shots, name) });
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wav': 'audio/wav',
};
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = url.startsWith('/fixtures/')
    ? join(fixtures, url.slice(10))
    : join(root, url === '/' ? 'index.html' : url);
  if (!existsSync(file)) return res.writeHead(404).end();
  res
    .writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    .end(readFileSync(file));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 420, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.addInitScript(() => {
  const listeners = new Set();
  const stats = { frames: { me: 0, them: 0 }, badFrames: 0, settingsUpdates: [] };
  window.__stats = stats;
  window.__emit = (e) => listeners.forEach((l) => l(e));
  let settings = {
    sttLanguage: 'hi-IN',
    formatNumbers: false,
    outputLanguage: 'same',
    contextNote: '',
    llmBaseUrl: '',
    llmModel: '',
    transcriptMinutes: 3,
    autoSuggest: true,
    silenceGate: false,
    silenceThresholdDb: -50,
    echoDedupe: true,
    audioMode: 'file',
    micDeviceId: '',
    replaySpeed: 4,
    replayAudible: false,
    exportDir: '',
    autoExport: true,
    consentAcknowledged: false,
    overlayOpacity: 0.94,
  };
  const wav = (n) => fetch('/fixtures/' + n).then((r) => r.arrayBuffer());
  window.bolo = {
    getState: async () => ({
      settings,
      languages: [
        { code: 'hi-IN', label: 'Hindi (handles Hinglish)', supportsItn: true },
        { code: 'en-hi-in-cm', label: 'Hinglish code-mixed (experimental)', experimental: true },
      ],
      keys: { gnani: true, llm: false },
      llm: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
      sttUrl: 'wss://api.vachana.ai/stt/v3/stream',
      platform: 'win32',
      clickThrough: false,
      sessionRunning: false,
      demoAudioDir: 'C:/demo',
    }),
    updateSettings: async (patch) => {
      stats.settingsUpdates.push(patch);
      settings = { ...settings, ...patch };
      return settings;
    },
    startSession: async () => {
      setTimeout(() => window.__emit({ type: 'session', running: true }), 0);
      return { ok: true };
    },
    stopSession: async () => {
      window.__emit({ type: 'session', running: false });
      return { exported: { markdown: 'C:/x/bolo-session.md', json: 'C:/x/bolo-session.json' } };
    },
    requestSuggestion: () => {},
    chooseExportDir: async () => null,
    openExportDir: () => {},
    readDemoAudio: async () => ({ me: await wav('me.wav'), them: await wav('them.wav') }),
    window: () => {},
    openAudioPort: (speaker) => {
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = (e) => {
        const b = e.data;
        if (!(b instanceof ArrayBuffer) || b.byteLength !== 1024) stats.badFrames++;
        else stats.frames[speaker]++;
      };
      window.postMessage({ type: 'bolo:audio-port', speaker }, '*', [port1]);
    },
    onEvent: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

await page.goto(`http://localhost:${port}/`);
await page.getByText('Before you record a call').waitFor();
await page.screenshot(shot('shot-1-consent.png'));
await page.getByRole('button', { name: /I understand/ }).click();
await page.getByText('Keys (from .env').waitFor();
await page.screenshot({ ...shot('shot-2-settings.png'), fullPage: true });

// Back to the live view, load demo audio (fixtures), start replay at 4x.
await page.getByTitle('Back to transcript').click();
await page.getByRole('button', { name: 'Demo' }).click();
await page.getByRole('button', { name: /Them: demo them.wav/ }).waitFor();
await page.getByRole('button', { name: /Start replay/ }).click();
await page.getByText('Listening').first().waitFor();

// Simulate main-process events while frames flow.
await page.evaluate(() => {
  const T = Date.now();
  const e = window.__emit;
  e({ type: 'stt-status', status: { speaker: 'them', state: 'connected' } });
  e({ type: 'stt-status', status: { speaker: 'me', state: 'connected' } });
  e({
    type: 'segment',
    segment: {
      id: 'them:1',
      speaker: 'them',
      text: 'Hello, haan ji, aapne term insurance ke liye call kiya tha.',
      at: T,
      endToEndLatencyMs: 410,
      serverLatencyMs: 180,
    },
  });
  e({
    type: 'segment',
    segment: {
      id: 'me:1',
      speaker: 'me',
      text: 'Ji, main Rohan bol raha hoon, Suraksha Life se.',
      at: T + 2000,
      endToEndLatencyMs: 380,
    },
  });
  e({
    type: 'segment',
    segment: {
      id: 'them:2',
      speaker: 'them',
      text: 'प्रीमियम कितना होगा monthly, aur tax benefit milega?',
      at: T + 4000,
      endToEndLatencyMs: 450,
    },
  });
  e({ type: 'processing', speaker: 'me' });
  e({
    type: 'suggestion-start',
    suggestion: { id: 'sug-1', trigger: 'auto', text: '', startedAt: T + 4100 },
  });
  e({ type: 'suggestion-token', id: 'sug-1', text: 'Premium around ₹1,200 monthly hai,' });
});
await page.waitForTimeout(400);
await page.screenshot(shot('shot-3-live.png'));
await page.evaluate(() => {
  window.__emit({
    type: 'suggestion-done',
    suggestion: {
      id: 'sug-1',
      trigger: 'auto',
      text: 'Premium around ₹1,200 monthly hai,\naur 80C ka tax benefit bhi milega.',
      startedAt: 0,
      finishedAt: 900,
      firstTokenMs: 640,
    },
  });
});

// Replay is 6.2s at 4x ≈ 1.6s, then the app waits 2.5s and stops.
await page.getByText(/Saved C:\/x\/bolo-session.md/).waitFor({ timeout: 10000 });
await page.screenshot(shot('shot-4-done.png'));
const fileStats = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stats)));
console.info('file replay frames:', fileStats.frames, 'bad:', fileStats.badFrames);

// Live mode: fake mic → AudioWorklet → frames. (Headless has no display capture → warning, mic-only.)
await page.evaluate(() => {
  window.__stats.frames = { me: 0, them: 0 };
});
await page.getByTitle('Settings').click();
await page.getByLabel('Live: mic + system audio').check();
await page.getByTitle('Back to transcript').click();
await page.getByRole('button', { name: /Start listening/ }).click();
await page.waitForTimeout(2500);
const liveStats = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stats)));
console.info('live frames after 2.5s:', liveStats.frames, 'bad:', liveStats.badFrames);
await page.screenshot(shot('shot-5-live-mode.png'));
const notice = await page
  .locator('.notice')
  .textContent()
  .catch(() => null);
console.info('notice:', notice);
await page.getByRole('button', { name: /Stop/ }).click();
await browser.close();
server.close();

const failures = [];
if (fileStats.badFrames || liveStats.badFrames) failures.push('frames that were not 1024 bytes');
if (fileStats.frames.me < 200 || fileStats.frames.them < 200)
  failures.push('file replay sent too few frames');
if (liveStats.frames.me < 30) failures.push('live mic produced too few frames');
if (errors.length) failures.push(...errors);
if (failures.length) {
  console.error('UI smoke test FAILED:', failures);
  process.exit(1);
}
console.info(`UI smoke test passed. Screenshots in ${shots}`);
