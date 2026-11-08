/**
 * Demo rehearsal against the REAL services: real Gnani speech-to-text, the real
 * suggestion model, the real vision model. Replays the Hinglish demo call in
 * `demo-audio/` with `demo-context/` as the files, then prints what the model actually
 * produced — answers, meanings, catch-up, and the minutes — so a human can judge demo
 * quality before standing in front of judges.
 *
 *   npm run build
 *   npm i --no-save playwright
 *   node scripts/demo-rehearsal.mjs
 *
 * Keys come from the repo's .env. Settings and meetings go to a throwaway folder, so your
 * real settings and meeting library are never touched. Screenshots, the transcript and the
 * minutes land in test-results/demo-rehearsal/.
 *
 * Unlike scripts/e2e-electron.mjs (mock servers, exact expected strings), this makes only
 * loose assertions: a real model never writes the same words twice. It also judges from
 * the app's own event stream rather than the DOM, because a notice like "Meeting saved" is
 * transient — a screenshot-driven check races it and reports failures that are really just
 * the harness looking too late.
 */
import { _electron as electron } from 'playwright';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { parseDotEnv } from '../src/core/util/dotenv.ts';

const repo = join(import.meta.dirname, '..');
const env = parseDotEnv(readFileSync(join(repo, '.env'), 'utf8'));
const home = mkdtempSync(join(tmpdir(), 'echo-demo-'));
const appData = join(home, 'appdata', 'Echo');
const exportDir = join(home, 'exports');
const out = join(repo, 'test-results', 'demo-rehearsal');
mkdirSync(appData, { recursive: true });
mkdirSync(out, { recursive: true });

const missing = ['GNANI_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`.env is missing ${missing.join(', ')} — cannot rehearse against the real API.`);
  process.exit(1);
}
// demo-audio/ is generated, not committed (see .gitignore), so a fresh clone has to make it.
for (const side of ['them', 'me']) {
  if (!existsSync(join(repo, 'demo-audio', `${side}.wav`))) {
    console.error(
      `demo-audio/${side}.wav is missing. Synthesise the demo call first:\n\n` +
        `  npm run demo-audio\n`,
    );
    process.exit(1);
  }
}
if (!env['LLM_REASONING_EFFORT']) {
  console.warn(
    'Note: LLM_REASONING_EFFORT is not set. On a thinking model the Roman rewrite can miss\n' +
      '      its deadline and leave a line in Devanagari. Set LLM_REASONING_EFFORT=low.\n',
  );
}

// Watch words in both scripts: Gnani writes Hindi in Devanagari and the Roman rewrite is
// an AI call that can time out, so the demo should not depend on which form we end up with.
writeFileSync(
  join(appData, 'settings.json'),
  JSON.stringify({
    audioMode: 'file',
    replaySpeed: 1, // real time: Gnani's VAD needs a real-time cadence
    replayAudible: false,
    exportDir,
    contextDir: join(repo, 'demo-context'),
    contextNote: 'I am Rohan from Sharma Paints. I sell paint to hardware dealers.',
    mode: 'active',
    myName: 'Rohan',
    watchWords: 'Mehta Hardware, मेहता हार्डवेयर',
    sttLanguage: 'hi-IN',
    transcriptScript: 'roman',
    formatNumbers: true,
    explainThem: true,
    myLanguage: 'en-IN',
    llmVisionModel: env['LLM_MODEL'], // Gemini Flash reads images
    autoMinutes: true,
    onboarded: true,
    consentAcknowledged: true,
    consentVersion: 4,
  }),
);

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: home, // keep the repo .env out of it; real keys are passed explicitly below
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    ECHO_USER_DATA: appData,
    ECHO_RECORDABLE: '1', // so the overlay appears in the screenshots
    STT_PROVIDER: 'gnani',
    GNANI_API_KEY: env['GNANI_API_KEY'],
    ...(env['GNANI_STT_URL'] ? { GNANI_STT_URL: env['GNANI_STT_URL'] } : {}),
    LLM_BASE_URL: env['LLM_BASE_URL'],
    LLM_MODEL: env['LLM_MODEL'],
    LLM_API_KEY: env['LLM_API_KEY'] ?? '',
    ...(env['LLM_REASONING_EFFORT'] ? { LLM_REASONING_EFFORT: env['LLM_REASONING_EFFORT'] } : {}),
  },
});

const failures = [];
const notes = [];
const check = (ok, msg) =>
  ok ? console.info('  OK   ', msg) : (failures.push(msg), console.error('  FAIL ', msg));
const show = (label, text) => {
  const body = String(text ?? '').trim();
  console.info(`\n  --- ${label} ---\n${body.replace(/^/gm, '  | ')}\n`);
  notes.push(`### ${label}\n\n${body}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
try {
  page = await app.firstWindow();
  if (new URL(page.url()).hash) {
    page =
      app.windows().find((w) => !new URL(w.url()).hash) ??
      (await app.waitForEvent('window', { predicate: (w) => !new URL(w.url()).hash }));
  }
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const shot = async (name) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.screenshot({ path: join(out, `${name}.png`) });
  };

  // ---- Record the app's whole event stream, so nothing transient is missed ----
  const events = [];
  await page.exposeFunction('__rec', (e) => events.push(e));
  await page.evaluate(() => window.echo.onEvent((e) => window.__rec(e)));
  const of = (type) => events.filter((e) => e.type === type);

  // Any calendar offer would sit over the controls; wave it away if one appears.
  await page
    .locator('.calendar-offer')
    .getByTitle('Not for this meeting')
    .click({ timeout: 4000 })
    .catch(() => {});
  // The overlay opens as a collapsed bar; the tabs only exist once it is expanded.
  await page
    .getByTitle('Expand')
    .click({ timeout: 5000 })
    .catch(() => {});

  // ---- The app's own report of which services it is wired to ----
  await page.getByRole('tab', { name: 'Settings' }).click();
  const settingsText = await page
    .locator('.settings')
    .innerText()
    .catch(() => '');
  const keysAt = settingsText.search(/Keys \(from \.env/);
  show(
    'keys and speech-to-text, as the app reports them',
    settingsText.slice(keysAt, keysAt + 260),
  );
  check(/Gnani/i.test(settingsText), 'app reports Gnani as the speech-to-text provider');
  check(
    !/\b(sk-[A-Za-z0-9]|AIza[A-Za-z0-9]|gsk_[A-Za-z0-9])/.test(settingsText),
    'no API key is rendered in the UI',
  );

  await page
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles(join(repo, 'demo-audio', 'them.wav'));
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(join(repo, 'demo-audio', 'me.wav'));

  // ---- Run the call ----
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('status', { name: 'Listening' }).waitFor({ timeout: 15_000 });
  check(true, 'session started against the live Gnani endpoint');

  // The replay is ~38 s of real-time audio, and everything the user can trigger by hand
  // needs a live session — a screen question is refused with "Start a session first" once
  // the call has ended. So all of it has to happen inside that window, with no long
  // blocking waits; the answers are collected from the event log afterwards.
  await sleep(12_000);
  await shot('1-live');
  if (
    await page
      .getByLabel('Ask Echo')
      .isEnabled()
      .catch(() => false)
  ) {
    await page.getByLabel('Ask Echo').fill('what rate did we give them last time?');
    await page.getByLabel('Ask Echo').press('Enter');
  }
  await sleep(7000);
  await shot('2-answer');
  await page.evaluate(() => window.echo.askScreen()); // the real vision model
  await sleep(8000);
  await shot('3-screen');
  await page
    .getByRole('button', { name: /Catch me up/ })
    .click({ timeout: 3000 })
    .catch(() => {});
  await sleep(5000);
  await shot('4-catch-up');

  // Wait for the session to end on its own, i.e. the replay running out, then give any
  // answer still streaming a moment to finish.
  for (let i = 0; i < 90 && !of('session').some((e) => e.running === false); i++) await sleep(1000);
  check(
    of('session').some((e) => e.running === false),
    `the call ended on its own (${Math.round((Date.now() - t0) / 1000)} s)`,
  );
  await sleep(6000);

  // ---- What the live services actually produced ----
  const segments = of('segment').map((e) => e.segment);
  const them = segments.filter((s) => s.speaker === 'them');
  check(them.length >= 3, `Gnani transcribed ${them.length} of their lines (expected 4)`);
  check(
    segments.some((s) => s.speaker === 'me'),
    'my own side was transcribed too',
  );
  const native = them.filter((s) => /[ऀ-ॿ]/.test(s.text));
  check(
    native.length === 0,
    native.length
      ? `${native.length}/${them.length} of their lines stayed in Devanagari (the Roman rewrite timed out)`
      : `all ${them.length} of their lines were rewritten in Roman script`,
  );

  const mentions = of('mention').map((e) => e.mention);
  show('watch-word alerts', mentions.map((m) => `${m.terms.join(', ')} — "${m.text}"`).join('\n'));
  check(mentions.length > 0, 'watch-word alert fired when they named Mehta Hardware');

  const meanings = of('segment-meaning');
  show('meanings of their mixed-language lines', meanings.map((m) => m.meaning).join('\n'));
  check(meanings.length >= 2, `${meanings.length} meaning lines written (expected 3-4)`);

  const answers = of('suggestion-done').map((e) => e.suggestion);
  show(
    'every answer the real model gave',
    answers
      .map(
        (a, i) =>
          `[${i + 1}] trigger=${a.trigger} verdict=${a.verdict ?? '-'}` +
          ` first token ${a.firstTokenMs ?? '?'} ms` +
          (a.error ? ` ERROR=${a.error}` : '') +
          (a.cancelled ? ' CANCELLED' : '') +
          `\n    sources: ${JSON.stringify(a.sources ?? [])}` +
          (a.asked ? `\n    asked: ${a.asked}` : '') +
          `\n    ${(a.text ?? '').replace(/\n/g, '\n    ')}`,
      )
      .join('\n\n'),
  );
  check(answers.length >= 2, `${answers.length} answers produced during the call`);
  check(
    !answers.some((a) => a.error),
    `no answer came back as an error (${answers.filter((a) => a.error).length} did)`,
  );
  const cited = answers.filter((a) => (a.sources ?? []).length);
  check(cited.length > 0, `${cited.length}/${answers.length} answers cited a context file`);
  const grounded = answers.filter((a) => /\d/.test(a.text ?? ''));
  check(grounded.length > 0, `${grounded.length} answers quoted a figure from the files`);
  const slow = answers.filter((a) => (a.firstTokenMs ?? 0) > 4000);
  check(!slow.length, `every answer started within 4 s (${slow.length} did not)`);

  // trigger tells these apart: 'auto' is unprompted, then what the user set off by hand.
  check(
    answers.some((a) => a.trigger === 'auto'),
    'answered their question unprompted (Active mode)',
  );
  check(
    answers.some((a) => a.trigger === 'typed'),
    'answered the question typed into the composer',
  );
  check(
    answers.some((a) => a.trigger === 'catchup'),
    'catch-up recap was written',
  );
  const screen = answers.find((a) => a.trigger === 'screen');
  check(!!screen && !screen.error, 'the real vision model answered a question about the screen');
  if (screen) show('screen answer (real vision model)', screen.text);

  show(
    'transcript as the demo will show it',
    segments.map((s) => `${s.speaker === 'me' ? 'Rohan' : 'Them '} | ${s.text}`).join('\n'),
  );
  writeFileSync(
    join(out, 'transcript.txt'),
    segments.map((s) => `${s.speaker}\t${s.text}`).join('\n'),
  );

  // ---- Minutes, written by the real model ----
  const notices = of('notice');
  show('notices the app raised', notices.map((n) => `${n.level}: ${n.message}`).join('\n'));
  check(
    !notices.some((n) => n.level === 'error'),
    `no error notices (${notices.filter((n) => n.level === 'error').length} seen)`,
  );
  // The "Meeting saved" notice is shown in the main window, not the overlay this is
  // watching, so the meeting events are what tells us the call was filed.
  check(of('meeting-updated').length > 0, 'the meeting was saved to the library');

  const meetingsDir = join(appData, 'meetings');
  let md = '';
  for (let i = 0; i < 120; i++) {
    const files = readdirSync(meetingsDir).filter((f) => f.endsWith('.json'));
    if (files.length) {
      const m = JSON.parse(readFileSync(join(meetingsDir, files[0]), 'utf8'));
      md = m.minutes?.markdown ?? '';
      if (md) {
        check(
          !JSON.stringify(m).includes('data:image'),
          'no screenshot stored in the meeting file',
        );
        break;
      }
    }
    await sleep(1000);
  }
  check(!!md, 'the real model wrote the minutes');
  if (md) {
    show('MINUTES, written by the real model', md);
    writeFileSync(join(out, 'minutes.md'), md);
    for (const section of ['Summary', 'Action items']) {
      check(new RegExp(`#+\\s*${section}`, 'i').test(md), `minutes have a "${section}" section`);
    }
    check(md.length > 300, `minutes are substantial (${md.length} chars)`);
    check(/1,?180|142|70|sattar/i.test(md), 'minutes carry a real figure from the call');
  }

  // A screenshot of the minutes as the judges would see them.
  const libWin = app.windows().find((w) => /^#(?:app|library)/.test(new URL(w.url()).hash));
  if (libWin) {
    await libWin
      .getByRole('button', { name: 'Meetings', exact: true })
      .click({ timeout: 4000 })
      .catch(() => {});
    await libWin.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await libWin.screenshot({ path: join(out, '5-minutes.png'), fullPage: true }).catch(() => {});
  }

  let exported = [];
  try {
    exported = readdirSync(exportDir);
  } catch {
    // autoExport may have had nothing to write
  }
  console.info('\n  exported files:', exported);
  check(
    exported.some((f) => f.endsWith('.md')) && exported.some((f) => f.endsWith('.json')),
    'the session was exported as Markdown and JSON',
  );

  const errors = logs.filter((l) => /^(pageerror|error)/.test(l));
  if (errors.length) show('renderer errors', errors.join('\n'));
  check(!errors.length, `no renderer errors (${errors.length} seen)`);
} finally {
  writeFileSync(
    join(out, 'REHEARSAL.md'),
    `# Demo rehearsal against the real services\n\n` +
      `Model: \`${env['LLM_MODEL']}\`` +
      (env['LLM_REASONING_EFFORT'] ? ` (reasoning_effort: ${env['LLM_REASONING_EFFORT']})` : '') +
      ` · speech-to-text: Gnani\nRun: ${new Date().toISOString()}\n\n` +
      (failures.length
        ? `**${failures.length} check(s) failed:**\n${failures.map((f) => `- ${f}`).join('\n')}\n\n`
        : `All checks passed.\n\n`) +
      notes.join('\n'),
  );
  await app.close().catch(() => {});
}

console.info(
  failures.length
    ? `\n${failures.length} check(s) FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`
    : '\nEvery check passed — the live demo path works.\n',
);
console.info(`Screenshots, transcript and minutes: ${out}\n`);
process.exit(failures.length ? 1 : 0);
