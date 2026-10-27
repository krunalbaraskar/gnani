/**
 * Optional end-to-end test of the real Electron app (main + preload + renderer) against
 * the mock Gnani and mock LLM servers, replaying the WAV fixtures. Not part of `npm test`.
 *
 *   npm run build
 *   npm i --no-save playwright
 *   node scripts/e2e-electron.mjs          # Linux CI: xvfb-run -a node scripts/e2e-electron.mjs
 *
 * It uses a throwaway settings/userData folder, so it never touches your real settings.
 * BOLO_RECORDABLE=1 is set so the screenshots can see the overlay.
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { demoReply } from '../test/mock/demo-brain.ts';
import { MockGnaniServer } from '../test/mock/mock-gnani-server.ts';
import { MockLlmServer } from '../test/mock/mock-llm-server.ts';
import { SCRIPT, THEM_LINES, ME_LINES } from '../test/fixtures/script.ts';

const repo = join(import.meta.dirname, '..');
const electronPath = createRequire(import.meta.url)('electron');
const home = mkdtempSync(join(tmpdir(), 'bolo-e2e-'));
const exportDir = join(home, 'exports');
const contextDir = join(repo, 'demo-context');
const shots = join(repo, 'test-results', 'e2e');
mkdirSync(shots, { recursive: true });

// Electron's userData = <appData>/Bolo. Pre-seed settings so no dialogs block the run.
const appData = join(home, 'appdata');
mkdirSync(join(appData, 'Bolo'), { recursive: true });
writeFileSync(
  join(appData, 'Bolo', 'settings.json'),
  JSON.stringify({
    audioMode: 'file',
    replaySpeed: 0.5, // slow enough to ask questions before the replay ends
    replayAudible: false,
    exportDir,
    contextDir,
    contextNote: 'I sell paint to dealers',
    llmVisionModel: 'mock-vision',
    mode: 'active',
    myName: 'Krunal',
    watchWords: 'Mehta Hardware',
  }),
);

const gnani = new MockGnaniServer({ script: SCRIPT });
const llm = new MockLlmServer({ reply: demoReply, tokenDelayMs: 15 });
const sttUrl = await gnani.start();
const llmUrl = await llm.start();
const userText = (r) => {
  const c = r.body.messages.at(-1).content;
  return typeof c === 'string' ? c : c.map((p) => p.text ?? '').join('\n');
};
const hasImage = (r) =>
  r.body.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  );

const app = await electron.launch({
  executablePath: electronPath,
  args: [
    join(repo, 'out', 'main', 'index.js'),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ],
  cwd: home, // so the repo's real .env is not picked up
  env: {
    ...process.env,
    // Set by editors that are themselves Electron apps; it would run our app as plain Node.
    ELECTRON_RUN_AS_NODE: undefined,
    BOLO_USER_DATA: join(appData, 'Bolo'),
    GNANI_API_KEY: 'test-key',
    GNANI_STT_URL: sttUrl,
    LLM_BASE_URL: llmUrl,
    LLM_MODEL: 'mock-model',
    LLM_API_KEY: '',
    BOLO_RECORDABLE: '1',
  },
});

const failures = [];
let page;
const check = (ok, msg) =>
  ok ? console.info('  ✓', msg) : (failures.push(msg), console.error('  ✗', msg));
try {
  page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
  const bounds = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

  const win = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      alwaysOnTop: w.isAlwaysOnTop(),
      bounds: w.getBounds(),
      workArea: screen.getPrimaryDisplay().workArea,
    };
  });
  check(win.alwaysOnTop, 'overlay is always on top');
  const centre = win.bounds.x + win.bounds.width / 2;
  const screenCentre = win.workArea.x + win.workArea.width / 2;
  check(
    win.bounds.width === 620 && Math.abs(centre - screenCentre) <= 1,
    `overlay is a 620 px bar centred at the top ${JSON.stringify(win.bounds)}`,
  );
  const isolated = await page.evaluate(
    () => typeof window.require === 'undefined' && typeof window.process === 'undefined',
  );
  check(isolated, 'renderer has no Node access (contextIsolation, no nodeIntegration)');

  const after = await page.evaluate(() =>
    window.bolo.updateSettings({ exportDir: '/somewhere/else', contextDir: '/etc' }),
  );
  check(
    after.exportDir === exportDir && after.contextDir === contextDir,
    'renderer cannot change the export or context folder',
  );

  // First run: consent, then the window shrinks back to what is open.
  await page.getByText('Before you record a call').waitFor();
  await shot('1-consent');
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.getByText('Keys (from .env').waitFor();
  await page.getByRole('img', { name: 'Visible in recordings (demo mode)' }).waitFor();
  check(true, 'demo mode is announced while content protection is off');

  // Context tab lists the demo files; contents never reach the renderer.
  await page.getByRole('tab', { name: 'Context' }).click();
  await page.getByText('inventory.csv').waitFor();
  await page.getByText('10 rows').waitFor();
  await shot('2-context');
  const state = await page.evaluate(() => window.bolo.getState());
  check(
    state.context.files.length === 3 && !JSON.stringify(state).includes('SP-EX-BL-5'),
    'three context files loaded; file contents stay in the main process',
  );

  // Collapsed bar: the window is only as tall as the bar.
  await page.getByTitle('Collapse').click();
  await page.waitForTimeout(300);
  await shot('3-bar');
  check(
    (await bounds()).height === 44,
    `collapsed window is only as tall as the bar (${(await bounds()).height})`,
  );

  // Replay files live under Settings → Audio.
  await page
    .getByRole('tab', { name: 'Settings' })
    .click()
    .catch(async () => {
      await page.getByTitle('Expand').click();
      await page.getByRole('tab', { name: 'Settings' }).click();
    });
  await page
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles(join(repo, 'test', 'fixtures', 'them.wav'));
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(join(repo, 'test', 'fixtures', 'me.wav'));
  await page.getByRole('button', { name: 'Mode: Active' }).waitFor();
  check(true, 'mode chip shows Active');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('status', { name: 'Listening' }).waitFor({ timeout: 5000 });
  check(true, 'session started; the panel switched to Live');

  // Their first line names a watch word: an alert, with no AI involved.
  await page.getByText('Mentioned: Mehta Hardware').waitFor({ timeout: 15000 });
  check(true, 'alert when they say a watch word');
  await shot('3b-mention');

  // The client's question, its meaning, and an answer grounded in the files.
  await page.getByText(/142 units Pune godown/).waitFor({ timeout: 25000 });
  await page.getByText('Answer · from your files').waitFor({ timeout: 5000 });
  await page.locator('.answer .chip', { hasText: 'inventory.csv' }).waitFor();
  await page.locator('.answer .chip', { hasText: 'price-list.md' }).waitFor();
  check(true, 'grounded answer shown with both source files');
  await page
    .getByText(/How much stock of the blue 5-litre/)
    .first()
    .waitFor({ timeout: 8000 });
  check(true, 'meaning shown under the mixed-language line');
  await shot('4-live-answer');
  const answerReq = llm.requests.find((r) => userText(r).includes('Them just asked'));
  check(
    userText(answerReq).includes('--- inventory.csv ---') &&
      userText(answerReq).includes('I sell paint to dealers'),
    'file chunks and the note about me were sent with the answer request',
  );
  check((await bounds()).height > 150, 'window grew to fit the panel');

  // A typed question, answered from the project notes.
  await page.getByLabel('Ask Bolo').fill('what did we promise on delivery?');
  await page.getByLabel('Ask Bolo').press('Enter');
  await page.getByText(/Delivery within 7 working days/).waitFor({ timeout: 8000 });
  await page.getByText('You asked: what did we promise on delivery?').waitFor();
  await page.locator('.answer .chip', { hasText: 'project-notes.md' }).waitFor();
  check(true, 'typed question answered from project-notes.md');
  await shot('5-typed-question');

  // A question the files cannot answer.
  await page.getByLabel('Ask Bolo').fill('what is their GST number?');
  await page.getByLabel('Ask Bolo').press('Enter');
  await page.getByText('Answer · not in your files').waitFor({ timeout: 8000 });
  check(true, 'honest "not in your files" card');
  await shot('6-not-in-files');

  // Catch me up: a recap of the call so far, read silently.
  await page.getByRole('button', { name: /Catch me up/ }).click();
  await page.getByText('Catch-up · last 10 min').waitFor({ timeout: 8000 });
  await page.getByText(/Asked you: stock and wholesale rate/).waitFor();
  check(true, 'catch-up recap shown, figures checked against the call');
  await shot('6b-catch-up');

  // Screen question: the main process captures; the image goes only to the model.
  await page.evaluate(() => window.bolo.askScreen());
  await page.getByText('Answer · from your screen').waitFor({ timeout: 10000 });
  await page.locator('.answer pre.code', { hasText: 'def most_stocked' }).waitFor();
  check(true, 'screen answer shows its code as a code block');
  const screenReq = llm.requests.find(hasImage);
  check(
    !!screenReq && screenReq.body.model === 'mock-vision',
    'screenshot sent to the vision model',
  );
  check(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity() === 1),
    'overlay is visible again after the capture',
  );
  await shot('7-screen-answer');

  await page.getByRole('tab', { name: 'Transcript' }).click();
  await page.getByText(THEM_LINES.closing.text).waitFor({ timeout: 15000 });
  await page.getByText(ME_LINES.answer.text).waitFor({ timeout: 15000 });
  const lines = await page
    .locator('.transcript .line:not(.pending)')
    .evaluateAll((els) => els.map((e) => e.querySelector('.who').textContent));
  check(lines.filter((l) => l === 'Them').length === 3, 'three Them lines');
  check(lines.filter((l) => l === 'Me').length === 2, 'two Me lines (echo removed)');
  await shot('8-transcript');

  const savedNotice = page.getByText(/^Meeting saved\. Writing the minutes/);
  await savedNotice.waitFor({ timeout: 20000 });
  check(true, 'meeting saved to the library and minutes started');
  const files = readdirSync(exportDir);
  console.info('  exported:', files);
  const md = files.find((f) => f.endsWith('.md'));
  const json = files.find((f) => f.endsWith('.json'));
  check(!!md && !!json, 'session exported as Markdown and JSON');
  if (md) {
    const text = readFileSync(join(exportDir, md), 'utf8');
    writeFileSync(join(shots, 'export.md'), text);
    check(text.includes(THEM_LINES.question.text), 'export contains the transcript');
    check(text.includes('(from inventory.csv, price-list.md)'), 'export names the answer sources');
    check(text.includes('_Meaning: How much stock'), 'export contains the meaning line');
  }
  if (json) {
    const saved = readFileSync(join(exportDir, json), 'utf8');
    check(JSON.parse(saved).echoesRemoved === 1, 'export records the removed echo');
    check(!saved.includes('data:image'), 'no screenshot in the export');
  }
  // ---- Meeting library ----
  const meetingsDir = join(appData, 'Bolo', 'meetings');
  const libraryOpened = app.waitForEvent('window');
  await savedNotice.click();
  const lib = await libraryOpened;
  lib.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await lib.getByText('Blue 5 litre stock and rate').first().waitFor({ timeout: 15000 });
  await lib.getByText(/send the quotation on WhatsApp/).waitFor();
  // The text streams in while writing; the footer appears once the minutes are saved.
  await lib.getByText(/^Written .* Check before sharing\./).waitFor({ timeout: 15000 });
  check(true, 'library opened at the meeting with its minutes');
  check(
    (await lib.locator('.doc').innerText()).includes('With: Krunal, Them'),
    'minutes name the user from "My name"',
  );
  await lib.screenshot({ path: join(shots, '9-library-minutes.png') });
  const minutesReq = llm.requests.find((r) =>
    JSON.stringify(r.body.messages[0]).includes('You write the minutes'),
  );
  check(
    !!minutesReq && userText(minutesReq).includes(THEM_LINES.question.text),
    'the transcript was sent to write the minutes',
  );
  const stored = readdirSync(meetingsDir).filter((f) => f.endsWith('.json'));
  check(stored.length === 1, 'one meeting file in the library folder');
  const meetingJson = JSON.parse(readFileSync(join(meetingsDir, stored[0]), 'utf8'));
  check(
    meetingJson.minutes?.markdown.includes('## Action items') &&
      meetingJson.record.mode === 'active',
    'meeting file holds the minutes and the mode',
  );
  check(!JSON.stringify(meetingJson).includes('data:image'), 'no screenshot in the meeting file');

  await lib.getByRole('tab', { name: 'Transcript' }).click();
  await lib.getByText(THEM_LINES.question.text).waitFor();
  check(true, 'library shows the transcript');
  await lib.screenshot({ path: join(shots, '10-library-transcript.png') });

  await lib.getByLabel('Search meetings').fill('quotation');
  await lib.locator('.lib-item').first().waitFor();
  await lib.getByLabel('Search meetings').fill('zebra crossing');
  await lib.getByText(/^No meeting mentions all of that/).waitFor();
  check(true, 'search finds the meeting by a word and reports no match for others');
  const libTrusted = await lib.evaluate(() =>
    window.bolo.updateSettings({ exportDir: '/elsewhere' }).then((s) => s.exportDir),
  );
  check(libTrusted === exportDir, 'library window cannot change the export folder either');

  // Ask your meetings: answered from this meeting, linked back to it.
  await lib.getByLabel('Search meetings').fill('what did they want on whatsapp?');
  await lib.getByLabel('Search meetings').press('Enter');
  await lib.getByText('From your meetings').waitFor({ timeout: 8000 });
  await lib.getByText('Mehta Hardware asked for the quotation on WhatsApp.').waitFor();
  await lib.screenshot({ path: join(shots, '11-ask-meetings.png') });
  await lib.locator('.ask-sources .chip').first().click();
  await lib.getByRole('tab', { name: 'Minutes' }).waitFor();
  check(true, 'asking your meetings answers with a link to the meeting');

  // A second meeting: Bolo now knows the first one and answers from its minutes.
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('status', { name: 'Listening' }).waitFor({ timeout: 5000 });
  await page.getByLabel('Ask Bolo').fill('what did they want on whatsapp?');
  await page.getByLabel('Ask Bolo').press('Enter');
  await page.getByText('Answer · from past meetings').waitFor({ timeout: 8000 });
  await page.locator('.answer .chip-meeting', { hasText: 'Blue 5 litre stock and rate' }).waitFor();
  check(true, "a later meeting answers from the first meeting's minutes");
  await shot('12-past-meeting-answer');
  await page.getByTitle('Stop the call and save').click();
  await page.getByText(/^Meeting saved/).waitFor({ timeout: 20000 });

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
} catch (err) {
  // Leave evidence behind: what the overlay showed and what the model was asked.
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
  console.error(
    '  LLM requests:',
    llm.requests.map((r) => userText(r).slice(-160)),
  );
  console.error(
    '  transcripts:',
    gnani.connections.map((c) => c.transcripts),
  );
  throw err;
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
