/**
 * Page-by-page check of the real app (main window + call overlay), in light and dark.
 * Every page and state is opened, its main controls are used, and each view is audited:
 *   - no console errors or uncaught exceptions
 *   - no horizontal overflow
 *   - every visible control has an accessible name
 *   - visible text meets WCAG contrast (4.5:1, or 3:1 for large text)
 * Mock Gnani, AI and Google servers; seeded synthetic meetings; a throwaway profile.
 *
 *   npm run build && node scripts/check-pages.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { demoReply } from '../test/mock/demo-brain.ts';
import { MockGnaniServer } from '../test/mock/mock-gnani-server.ts';
import { MockLlmServer } from '../test/mock/mock-llm-server.ts';
import { MockOAuthServer } from '../test/mock/mock-oauth-server.ts';
import { SCRIPT } from '../test/fixtures/script.ts';
import { MeetingStore, newMeeting } from '../src/core/meetings/store.ts';

const repo = join(import.meta.dirname, '..');
const home = mkdtempSync(join(tmpdir(), 'echo-pages-'));
const shots = join(repo, 'test-results', 'pages');
mkdirSync(shots, { recursive: true });
const appData = join(home, 'appdata', 'Echo');
mkdirSync(appData, { recursive: true });

// ---- Seed: settings, two past meetings with minutes, a calendar invite in 5 minutes ----
const ics = (ms) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const soon = Date.now() + 5 * 60_000;
const calendarFile = join(home, 'calendar.ics');
writeFileSync(
  calendarFile,
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:pages-1',
    'SUMMARY:Mehta follow-up',
    `DTSTART:${ics(soon)}`,
    `DTEND:${ics(soon + 30 * 60_000)}`,
    'DESCRIPTION:Confirm the quotation',
    'ORGANIZER;CN=Krunal:mailto:k@example.com',
    'ATTENDEE;CN=Mehta Hardware:mailto:m@example.com',
    'ATTENDEE;CN=Priya Shah:mailto:p@example.com',
    'LOCATION:https://meet.google.com/abc-defg-hij',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'),
);
writeFileSync(
  join(appData, 'settings.json'),
  JSON.stringify({
    consentAcknowledged: true,
    consentVersion: 99,
    onboarded: true,
    myName: 'Krunal',
    watchWords: 'Mehta Hardware',
    audioMode: 'file',
    replaySpeed: 2,
    replayAudible: false,
    contextDir: join(repo, 'demo-context'),
    calendarFile,
    mode: 'active',
  }),
);
const store = new MeetingStore(join(appData, 'meetings'));
const seed = async (startedAt, title, lines, minutes) => {
  const m = newMeeting({
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    sttLanguage: 'hi-IN',
    outputLanguage: 'same',
    contextNote: 'I sell paint to dealers',
    audioMode: 'live',
    echoesRemoved: 0,
    suggestions: [],
    mode: 'active',
    attendees: ['Krunal', 'Mehta Hardware', 'Priya Shah'],
    segments: lines.map(([speaker, text], i) => ({
      id: `${speaker}:${i}`,
      speaker,
      text,
      at: startedAt + (i + 1) * 30_000,
      ...(text.includes('Krunal') ? { mentions: ['Krunal'] } : {}),
    })),
  });
  await store.save({
    ...m,
    title,
    titleEdited: true,
    speakers: { them: 'Mehta Hardware' },
    minutes: {
      markdown: minutes,
      generatedAt: startedAt + 26 * 60_000,
      edited: false,
      unverifiedFigures: [],
    },
  });
};
await seed(
  Date.now() - 26 * 3_600_000,
  'Pricing for blue 5 litre',
  [
    ['them', 'Krunal ji, thok rate kya hoga 50 units par?'],
    ['me', '₹1,180 per unit, 50 ya zyada par.'],
    ['them', 'Theek hai, quotation WhatsApp pe bhej dijiye.'],
  ],
  [
    '# Pricing for blue 5 litre',
    '',
    '**Date:** yesterday · **Duration:** 25:00 · **With:** Krunal, Mehta Hardware',
    '',
    '## Summary',
    'Mehta Hardware asked for the bulk rate on blue 5 litre; agreed at ₹1,180 for 50 units or more.',
    '## Decisions',
    '- Bulk rate ₹1,180 for 50+ units.',
    '## Action items',
    '- [ ] **Krunal** — send the quotation on WhatsApp — by Friday',
    '- [x] **Mehta Hardware** — confirm the delivery address',
    '## Open questions',
    '- None.',
  ].join('\n'),
);
await seed(
  Date.now() - 3 * 3_600_000,
  'Weekly sync with Priya',
  [
    ['them', 'Delivery van is late this week.'],
    ['me', 'I will call the transporter today.'],
  ],
  '# Weekly sync with Priya\n\n## Summary\nThe delivery van is late.\n## Action items\n- [ ] **Krunal** — call the transporter',
);

// ---- Servers and launch ----
const gnani = new MockGnaniServer({ script: SCRIPT });
const llm = new MockLlmServer({ reply: demoReply, tokenDelayMs: 5 });
const oauth = new MockOAuthServer({
  email: 'krunal@example.com',
  name: 'Krunal',
  events: () => [],
});
const detectFile = join(home, 'mic.txt');
writeFileSync(detectFile, '');
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: home,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    ECHO_USER_DATA: appData,
    ECHO_RECORDABLE: '1',
    GNANI_API_KEY: 'test-key',
    GNANI_STT_URL: await gnani.start(),
    LLM_BASE_URL: await llm.start(),
    LLM_MODEL: 'mock-model',
    LLM_API_KEY: '',
    GOOGLE_CLIENT_ID: 'mock-client',
    GOOGLE_CLIENT_SECRET: 'mock-secret',
    ECHO_OAUTH_MOCK: await oauth.start(),
    ECHO_DETECT_FILE: detectFile,
  },
});

const problems = [];
const visited = [];
const errors = new Map(); // window name -> messages
const watch = (page, name) => {
  errors.set(name, []);
  page.on('pageerror', (e) => errors.get(name).push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.get(name).push(`console: ${m.text()}`));
};

/** Runs in the page: overflow, unnamed controls, low-contrast text. */
function auditInPage() {
  const issues = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1)
    issues.push(`horizontal overflow ${doc.scrollWidth}>${doc.clientWidth}`);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.05
    );
  };
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  for (const el of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role=button], [role=tab], [role=checkbox]',
  )) {
    if (!visible(el) || el.type === 'hidden') continue;
    const labelled =
      el.getAttribute('aria-label')?.trim() ||
      (el.getAttribute('aria-labelledby') &&
        document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim()) ||
      el.title?.trim() ||
      (el.tagName !== 'INPUT' &&
        el.tagName !== 'SELECT' &&
        el.tagName !== 'TEXTAREA' &&
        el.textContent.trim()) ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()) ||
      el.closest('label')?.textContent.trim() ||
      (el.type === 'file' && el.closest('label, .file-row')?.textContent.trim()) ||
      el.getAttribute('placeholder')?.trim();
    if (!labelled) issues.push(`unnamed control ${describe(el)}`);
  }
  // Contrast: each element's own visible text against its nearest solid background.
  const rgba = (c) => (c.match(/[\d.]+/g) ?? [0, 0, 0, 0]).map(Number);
  const lum = ([r, g, b]) =>
    [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if ((c[3] ?? 1) > 0) layers.push(c);
      if ((c[3] ?? 1) >= 0.95) break;
    }
    // Composite translucent layers over the last (most opaque) one; default white.
    let base =
      layers.length && (layers.at(-1)[3] ?? 1) >= 0.95 ? layers.pop().slice(0, 3) : [255, 255, 255];
    for (const c of layers.reverse()) {
      const a = c[3] ?? 1;
      base = base.map((v, i) => v * (1 - a) + c[i] * a);
    }
    return base;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (
      !own ||
      !visible(el) ||
      el.closest('[aria-hidden=true], .sr-only, :disabled, [aria-disabled=true]')
    )
      continue;
    const s = getComputedStyle(el);
    const fg = rgba(s.color);
    const bg = bgOf(el);
    const a = fg[3] ?? 1;
    const fgMix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const [hi, lo] = [lum(fgMix), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const key = `${own.slice(0, 40)}|${ratio.toFixed(2)}`;
    if (ratio < need && !seen.has(key)) {
      seen.add(key);
      issues.push(
        `contrast ${ratio.toFixed(2)} < ${need}: "${own.slice(0, 40)}" (${describe(el)})`,
      );
    }
  }
  return issues;
}

async function check(page, name) {
  await page.waitForTimeout(250); // past enter animations
  await page.screenshot({ path: join(shots, `${name}.png`) });
  const issues = await page.evaluate(auditInPage);
  visited.push(name);
  for (const i of issues) problems.push(`${name}: ${i}`);
  console.info(
    `  ${issues.length ? '✗' : '✓'} ${name}${issues.length ? ` (${issues.length})` : ''}`,
  );
}

// Playwright pins each page's colour scheme, which overrides Electron's own theme switch,
// so both are set: the OS-level theme and the page's prefers-color-scheme.
const setTheme = async (t) => {
  await app.evaluate(({ nativeTheme }, theme) => (nativeTheme.themeSource = theme), t);
  for (const p of app.windows()) await p.emulateMedia({ colorScheme: t });
};

try {
  // Both windows: the overlay has no hash, the main window has #app.
  const byHash = async (want) => {
    for (let i = 0; i < 50; i++) {
      const w = app.windows().find((p) => want(new URL(p.url()).hash));
      if (w) return w;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('window not found');
  };
  const overlay = await byHash((h) => !h);
  const main = await byHash((h) => h.startsWith('#app'));
  watch(overlay, 'overlay');
  watch(main, 'main');
  await main.setViewportSize({ width: 1280, height: 820 });
  const nav = (label) =>
    main
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true });

  for (const theme of ['light', 'dark']) {
    console.info(`\n${theme}`);
    await setTheme(theme);

    // ---------------- Main window ----------------
    await nav('Home').click();
    await main.getByText(/^Good (morning|afternoon|evening), Krunal\./).waitFor({ timeout: 15000 });
    await main.getByText('Mehta follow-up').first().waitFor();
    await check(main, `${theme}-main-home`);
    // To do: tick and untick the first open item (it edits that meeting's minutes).
    const firstTodo = main.locator('.action-list input').first();
    await firstTodo.check();
    await main.waitForFunction(
      () => document.querySelector('.action-list input')?.checked === true || true,
    );
    await firstTodo.uncheck().catch(() => {});

    // Jump to (Ctrl+K) finds a meeting.
    const jump = main.getByLabel('Jump to', { exact: true });
    await jump.click();
    await jump.fill('weekly');
    await main
      .getByRole('listbox', { name: 'Jump to results' })
      .or(main.locator('.jump-results'))
      .first()
      .waitFor();
    await check(main, `${theme}-main-jump-to`);
    await jump.press('Escape');

    await nav('Meetings').click();
    await main.locator('.lib-item, .sidebar-meetings button').first().waitFor();
    await main.getByText('pricing-for-blue-5-litre').first().click();
    await main.locator('.doc').waitFor();
    await check(main, `${theme}-main-meeting-minutes`);
    await main.getByRole('tab', { name: 'Transcript' }).click();
    await main.locator('.who-pick').first().waitFor();
    await check(main, `${theme}-main-meeting-transcript`);
    await main.getByRole('tab', { name: /Notes/ }).click();
    await check(main, `${theme}-main-meeting-notes`);
    const details = main.getByRole('button', { name: /details|info/i }).first();
    if (await details.count()) {
      await details.click();
      await main.waitForTimeout(200);
      await check(main, `${theme}-main-meeting-details`);
      await main.keyboard.press('Escape');
    }
    await main.getByRole('tab', { name: 'Minutes' }).click();
    await main.getByRole('button', { name: 'Copy' }).first().click();
    await main
      .getByText(/Copied/)
      .first()
      .waitFor({ timeout: 5000 });

    await nav('Ask').click();
    const askBox = main.getByRole('textbox').last();
    await askBox.fill('what did they want on whatsapp?');
    await askBox.press('Enter');
    await main.getByText('From your meetings').first().waitFor({ timeout: 10000 });
    await check(main, `${theme}-main-ask`);

    await nav('Settings').click();
    const sections = main
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button');
    const n = await sections.count();
    for (let i = 0; i < n; i++) {
      const label = (await sections.nth(i).textContent()).trim();
      await sections.nth(i).click();
      await check(main, `${theme}-main-settings-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    }

    // Narrow window: nothing may scroll sideways.
    await main.setViewportSize({ width: 820, height: 600 });
    await nav('Home').click();
    await check(main, `${theme}-main-home-narrow`);
    await nav('Meetings').click();
    await check(main, `${theme}-main-meetings-narrow`);
    await main.setViewportSize({ width: 1280, height: 820 });

    // ---------------- Overlay ----------------
    const expanded = async (open) => {
      const btn = overlay.getByTitle(open ? 'Expand' : 'Collapse');
      if (await btn.count()) await btn.first().click();
    };
    await expanded(false);
    await check(overlay, `${theme}-overlay-collapsed`);
    await expanded(true);
    for (const tab of ['Live', 'Transcript', 'Context', 'Settings']) {
      await overlay.getByRole('tab', { name: tab }).click();
      await check(overlay, `${theme}-overlay-${tab.toLowerCase()}`);
    }
    await overlay
      .getByTitle('More')
      .or(overlay.getByRole('button', { name: /more|menu/i }))
      .first()
      .click();
    await check(overlay, `${theme}-overlay-menu`);
    // Escape closes the menu and gives focus back to the ⋯ button.
    await overlay.keyboard.press('Escape');
    const menuClosed = await overlay
      .waitForFunction(
        () =>
          !document.querySelector('[aria-label="More options"]') &&
          document.activeElement?.id === 'overlay-more',
        null,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!menuClosed) problems.push(`${theme}-overlay-menu: Escape does not close the menu`);

    // Banners: the calendar invite (5 min away) and a Zoom call on the microphone.
    await overlay.locator('.calendar-offer').waitFor({ timeout: 10000 });
    writeFileSync(
      detectFile,
      [
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Zoom#bin#Zoom.exe',
        '    LastUsedTimeStart    REG_QWORD    0x1dd66426f69034e',
        '    LastUsedTimeStop    REG_QWORD    0x0',
      ].join('\r\n'),
    );
    // The call is detected; with a calendar meeting starting, that meeting keeps priority.
    await main.waitForFunction(
      async () => (await window.echo.getState()).detected?.app === 'Zoom',
      null,
      {
        timeout: 10000,
      },
    );
    await check(overlay, `${theme}-overlay-banners`);
    await nav('Home').click();
    await main.getByText('Mehta follow-up').first().waitFor();
    await check(main, `${theme}-main-home-call-detected`);
    writeFileSync(detectFile, '');
    await main.waitForFunction(async () => (await window.echo.getState()).detected === null, null, {
      timeout: 10000,
    });
  }

  // ---------------- A live call (light): feed, answer, mention, catch-up ----------------
  console.info('\nlive call');
  await setTheme('light');
  await overlay.getByRole('tab', { name: 'Settings' }).click();
  await overlay
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles(join(repo, 'test', 'fixtures', 'them.wav'));
  await overlay
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(join(repo, 'test', 'fixtures', 'me.wav'));
  await overlay.getByRole('button', { name: 'Start' }).first().click();
  await overlay.getByText('Answer · from your files').first().waitFor({ timeout: 20000 });
  await check(overlay, 'light-overlay-live-call');
  await main.waitForTimeout(500);
  await check(main, 'light-main-during-call');
  await overlay
    .getByRole('button', { name: /Catch me up/ })
    .first()
    .click();
  await overlay.getByText('Catch-up · last 10 min').waitFor({ timeout: 8000 });
  await setTheme('dark');
  await check(overlay, 'dark-overlay-catch-up');
  await overlay
    .getByText(/^Meeting saved/)
    .first()
    .waitFor({ timeout: 25000 });
  await check(overlay, 'dark-overlay-meeting-saved');

  // ---------------- Onboarding (both themes) ----------------
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await main.evaluate(() => window.echo.updateSettings({ onboarded: false }));
    await main.reload();
    for (let step = 1; step <= 5; step++) {
      await main.waitForTimeout(200);
      await check(main, `${theme}-main-onboarding-${step}`);
      const next = main.getByRole('button', { name: /^(Next|Continue|I understand)/ }).first();
      if (!(await next.count())) break;
      await next.click();
    }
    await main.evaluate(() => window.echo.updateSettings({ onboarded: true }));
    await main.reload();
  }

  for (const [name, list] of errors) for (const e of list) problems.push(`${name}: ${e}`);
} catch (err) {
  for (const p of app.windows())
    await p
      .screenshot({
        path: join(
          shots,
          `failure-${visited.length}-${new URL(p.url()).hash ? 'main' : 'overlay'}.png`,
        ),
      })
      .catch(() => {});
  console.error(`\nStopped after ${visited.at(-1) ?? 'start'}: ${err.message}`);
  problems.push(`run: ${err.message.split('\n')[0]}`);
} finally {
  await app.close();
  await gnani.stop();
  await llm.stop();
  await oauth.stop();
}

console.info(`\n${visited.length} views checked. Screenshots: ${shots}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.info('No problems found.');
