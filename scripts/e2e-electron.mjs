/**
 * Optional end-to-end test of the real Electron app (main + preload + renderer) against
 * the mock Gnani and mock LLM servers, replaying the WAV fixtures. Not part of `npm test`.
 *
 *   npm run build
 *   npm i --no-save playwright
 *   node scripts/e2e-electron.mjs          # Linux CI: xvfb-run -a node scripts/e2e-electron.mjs
 *
 * It uses a throwaway settings/userData folder, so it never touches your real settings.
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { MockGnaniServer } from '../test/mock/mock-gnani-server.ts';
import { MockLlmServer } from '../test/mock/mock-llm-server.ts';
import { SCRIPT, THEM_LINES, ME_LINES } from '../test/fixtures/script.ts';

const repo = join(import.meta.dirname, '..');
const electronPath = createRequire(import.meta.url)('electron');
const home = mkdtempSync(join(tmpdir(), 'bolo-e2e-'));
const exportDir = join(home, 'exports');
const shots = join(repo, 'test-results', 'e2e');
mkdirSync(shots, { recursive: true });

// Electron's userData = <appData>/Bolo. Pre-seed settings so no dialogs block the run.
const appData = join(home, 'appdata');
mkdirSync(join(appData, 'Bolo'), { recursive: true });
writeFileSync(
  join(appData, 'Bolo', 'settings.json'),
  JSON.stringify({
    audioMode: 'file',
    replaySpeed: 2,
    replayAudible: false,
    exportDir,
    contextNote: 'Selling term insurance',
  }),
);

const gnani = new MockGnaniServer({ script: SCRIPT });
const llm = new MockLlmServer({
  tokens: ['Premium', ' around ₹1,200', ' monthly hai.'],
  tokenDelayMs: 20,
});
const sttUrl = await gnani.start();
const llmUrl = await llm.start();

const app = await electron.launch({
  executablePath: electronPath,
  args: [
    join(repo, 'out', 'main', 'index.js'),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ],
  cwd: home, // so the repo's real .env is not picked up
  env: {
    ...process.env,
    XDG_CONFIG_HOME: appData, // Linux
    APPDATA: appData, // Windows
    GNANI_API_KEY: 'test-key',
    GNANI_STT_URL: sttUrl,
    LLM_BASE_URL: llmUrl,
    LLM_MODEL: 'mock-model',
    LLM_API_KEY: '',
  },
});

const failures = [];
const check = (ok, msg) =>
  ok ? console.info('  ✓', msg) : (failures.push(msg), console.error('  ✗', msg));
try {
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      alwaysOnTop: w.isAlwaysOnTop(),
      resizable: w.isResizable(),
      frameless: !w.isMenuBarVisible(),
    };
  });
  check(
    win.alwaysOnTop && win.resizable,
    `overlay is always-on-top and resizable ${JSON.stringify(win)}`,
  );
  const isolated = await page.evaluate(
    () => typeof window.require === 'undefined' && typeof window.process === 'undefined',
  );
  check(isolated, 'renderer has no Node access (contextIsolation, no nodeIntegration)');

  const after = await page.evaluate(() =>
    window.bolo.updateSettings({ exportDir: '/somewhere/else' }),
  );
  check(after.exportDir === exportDir, 'renderer cannot change the export folder');
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.getByTitle('Back to transcript').click();
  await page
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles(join(repo, 'test', 'fixtures', 'them.wav'));
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(join(repo, 'test', 'fixtures', 'me.wav'));
  await page.getByRole('button', { name: /Start replay/ }).click();
  await page.getByText('Listening').first().waitFor({ timeout: 5000 });
  check(true, 'session started and Listening indicator shown');

  await page.getByText(THEM_LINES.closing.text).waitFor({ timeout: 15000 });
  await page.getByText(ME_LINES.answer.text).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(shots, 'e2e-live.png') });
  const lines = await page
    .locator('.transcript .line:not(.pending)')
    .evaluateAll((els) =>
      els.map(
        (e) => `${e.querySelector('.who').textContent}: ${e.querySelector('.text').textContent}`,
      ),
    );
  console.info('  transcript:', lines);
  check(lines.filter((l) => l.startsWith('Them')).length === 3, 'three Them lines');
  check(lines.filter((l) => l.startsWith('Me')).length === 2, 'two Me lines (echo removed)');
  await page.getByText('Premium around ₹1,200 monthly hai.').waitFor({ timeout: 10000 });
  check(true, 'auto-suggestion streamed into the overlay');
  check(
    llm.requests[0]?.body.messages[1]?.content.includes('Selling term insurance'),
    'context note sent to the LLM',
  );

  // Hotkey path, via the same IPC the global shortcut uses.
  await page.evaluate(() => window.bolo.requestSuggestion());
  await page.waitForTimeout(500);
  check(llm.requests.length >= 2, 'manual suggestion request reached the LLM');

  await page.getByText(/^Saved /).waitFor({ timeout: 15000 });
  const files = readdirSync(exportDir);
  console.info('  exported:', files);
  const md = files.find((f) => f.endsWith('.md'));
  const json = files.find((f) => f.endsWith('.json'));
  check(!!md && !!json, 'session exported as Markdown and JSON');
  if (md) {
    const text = readFileSync(join(exportDir, md), 'utf8');
    writeFileSync(join(shots, 'export.md'), text);
    check(text.includes(THEM_LINES.question.text), 'export contains the transcript');
  }
  if (json)
    check(
      JSON.parse(readFileSync(join(exportDir, json), 'utf8')).echoesRemoved === 1,
      'export records the removed echo',
    );
  await page.screenshot({ path: join(shots, 'e2e-done.png') });
  check(
    gnani.connections.every((c) => c.badFrames === 0) && gnani.connections.length >= 2,
    'mock Gnani got only 1024-byte frames on 2 streams',
  );
  check(
    gnani.connections.every((c) => c.headers['x-api-key-id'] === 'test-key'),
    'API key reached Gnani in the header',
  );
  check(!(await page.content()).includes('test-key'), 'API key never appears in the renderer');
  const errs = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  check(errs.length === 0, `no renderer errors ${errs.length ? JSON.stringify(errs) : ''}`);
} finally {
  await app.close();
  await gnani.stop();
  await llm.stop();
}
if (failures.length) {
  console.error(`E2E FAILED (${failures.length})`);
  process.exit(1);
}
console.info(`E2E passed. Screenshots in ${shots}`);
