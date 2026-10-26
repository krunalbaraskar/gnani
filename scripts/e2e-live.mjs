/**
 * Optional check of live capture on a real machine: microphone ("me") and system-audio
 * loopback ("them") into the mock Gnani server. Needs a microphone and a playback device.
 *
 *   npm run build
 *   npm i --no-save playwright
 *   node scripts/e2e-live.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { MockGnaniServer } from '../test/mock/mock-gnani-server.ts';

const repo = join(import.meta.dirname, '..');
const userData = mkdtempSync(join(tmpdir(), 'bolo-live-'));
writeFileSync(
  join(userData, 'settings.json'),
  JSON.stringify({ audioMode: 'live', consentAcknowledged: true, consentVersion: 2 }),
);
const gnani = new MockGnaniServer();
const sttUrl = await gnani.start();

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: userData,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    BOLO_USER_DATA: userData,
    BOLO_RECORDABLE: '1',
    GNANI_API_KEY: 'test-key',
    GNANI_STT_URL: sttUrl,
  },
});
let failed;
try {
  const page = await app.firstWindow();
  const notices = [];
  await page.exposeFunction('__notice', (m) => notices.push(m));
  await page.evaluate(() =>
    window.bolo.onEvent((e) => e.type === 'notice' && window.__notice(e.message)),
  );
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('status', { name: 'Listening' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(5000);
  const shown = await page.locator('.strip').allTextContents();
  const frames = gnani.connections.map((c) => ({ frames: c.frames, bad: c.badFrames }));
  console.info('  streams:', JSON.stringify(frames));
  console.info('  strips shown:', JSON.stringify(shown));
  console.info('  notices:', JSON.stringify(notices));
  const streaming = gnani.connections.filter((c) => c.frames > 50 && c.badFrames === 0).length;
  console.info(
    streaming === 2
      ? '  ✓ both mic and system-audio streams delivered 1024-byte frames'
      : `  ✗ only ${streaming} of 2 streams delivered audio`,
  );
  failed = streaming !== 2;
  await page.getByTitle('Stop the call and save').click();
} finally {
  await app.close();
  await gnani.stop();
}
process.exit(failed ? 1 : 0);
