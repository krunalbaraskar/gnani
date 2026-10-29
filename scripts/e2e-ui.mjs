/** Renderer interaction checks with a deterministic window.echo contract.
 * Run after npm run build: node scripts/e2e-ui.mjs
 * Uses the same optional Playwright installation as e2e-electron.mjs.
 * All fixtures and Electron data live in a temporary folder, never your Echo profile.
 */
import { _electron as electron } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { CONSENT_VERSION, DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const repo = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'echo-ui-'));
const shots = join(repo, 'test-results', 'ui');
mkdirSync(shots, { recursive: true });
const startedAt = Date.now() - 3600000;
const meeting = {
  id: `m${startedAt}`,
  title: 'Mehta follow-up',
  startedAt,
  durationMs: 1800000,
  lines: 2,
  actionItems: 10,
  minutes: 'ready',
  mode: 'assist',
  snippet: 'Send the revised quotation on Thursday.',
  segments: [{ id: 'them:1', speaker: 'them', at: startedAt, text: 'Please send the quotation.' }],
  suggestions: [],
  notes: '',
  agenda: 'Confirm the quotation',
  pauses: [],
  speakers: {},
  attendees: ['Krunal', 'Mehta Hardware', 'Asha', 'Ravi', 'Priya', 'Sam'],
  minutesView: {
    markdown: '# Mehta follow-up\n\n## Action items\n- [ ] Send the quotation\n',
    generatedAt: startedAt + 1800000,
    edited: false,
    unverifiedFigures: ['₹5,000'],
  },
};
const appState = {
  settings: {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    consentAcknowledged: true,
    consentVersion: CONSENT_VERSION,
    myName: 'Krunal',
  },
  keys: { stt: true, llm: true },
  stt: { name: 'Gnani', keyVar: 'GNANI_API_KEY', url: 'wss://speech.example.test' },
  llm: { baseUrl: 'http://localhost:11434/v1', model: 'local-model' },
  languages: [
    { code: 'hi-IN', label: 'Hindi', supportsItn: true },
    { code: 'en-IN', label: 'English', supportsItn: true },
    { code: 'indic-auto', label: 'Auto detect', experimental: true },
  ],
  platform: 'win32',
  clickThrough: false,
  sessionRunning: false,
  sessionPaused: false,
  demoAudioDir: '',
  context: { dir: '', files: [], skipped: [] },
  memoryMeetings: 7,
  calendar: {
    configured: true,
    events: [
      {
        key: 'now',
        title: 'Mehta planning',
        start: Date.now() + 180000,
        end: Date.now() + 1980000,
        allDay: false,
        attendees: meeting.attendees,
        source: 'google:krunal@example.test',
        joinUrl: 'https://meet.example.test',
        hasAgenda: true,
      },
      {
        key: 'next',
        title: 'Team check-in',
        start: Date.now() + 2400000,
        end: Date.now() + 4200000,
        allDay: false,
        attendees: ['Asha'],
        source: 'microsoft:krunal@example.test',
        hasAgenda: false,
      },
    ],
  },
  integrations: { accounts: [], available: { google: false, microsoft: true } },
  detected: null,
  shareProtection: 'hidden',
};

writeFileSync(
  join(temp, 'preload.cjs'),
  `
const { contextBridge } = require('electron');
let state = JSON.parse(localStorage.getItem('echo-ui-state') || ${JSON.stringify(JSON.stringify(appState))});
let detail = ${JSON.stringify(meeting)};
let actions = Array.from({length: 10}, (_, index) => ({meetingId: detail.id, meetingTitle: detail.title, meetingStartedAt: detail.startedAt, index, text: 'Follow up item ' + index, owner: 'Krunal', done: index === 9}));
let recent = Array.from({length: 7}, (_, i) => ({...detail, id: 'm' + (detail.startedAt - i * 86400000), title: i ? 'Planning ' + i : detail.title, startedAt: detail.startedAt - i * 86400000}));
const listeners = new Set();
let failToggle = true, connectError = true;
const calls = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = event => {
  if (event.type === 'session') state.sessionRunning = event.running;
  if (event.type === 'paused') state.sessionPaused = event.paused;
  if (event.type === 'integrations') state.integrations = event.integrations;
  if (event.type === 'calendar') state.calendar = event.calendar;
  if (event.type === 'detected') state.detected = event.meeting;
  for (const listener of listeners) listener(event);
};
contextBridge.exposeInMainWorld('echo', {
  getState: async () => state,
  updateSettings: async patch => { calls.push(['updateSettings', patch]); state.settings = {...state.settings, ...patch}; localStorage.setItem('echo-ui-state', JSON.stringify(state)); return state.settings; },
  onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  listMeetings: async query => recent.filter(m => (m.title + m.snippet).toLowerCase().includes(query.toLowerCase())),
  listActionItems: async () => actions,
  toggleActionItem: async (id, index, done) => { await wait(180); if (failToggle) return false; actions = actions.map(a => a.index === index ? {...a, done} : a); emit({type: 'meeting-updated', summary: detail}); return true; },
  requestStart: key => calls.push(['requestStart', key]),
  openJoinLink: key => calls.push(['openJoinLink', key]),
  setPaused: paused => emit({type: 'paused', paused}),
  stopSession: async () => { emit({type: 'session', running: false}); return {meetingId: detail.id, writingMinutes: true}; },
  getMeeting: async id => ({...detail, id}),
  updateMeeting: async (id, patch) => { detail = {...detail, ...patch}; emit({type: 'meeting-updated', summary: detail}); return detail; },
  deleteMeeting: async () => false,
  copyMinutes: async () => true,
  emailMinutes: () => {},
  exportMeeting: async () => ({path: 'minutes.pdf'}),
  writeMinutes: () => {}, cancelMinutes: () => {}, guessSpeakers: async () => ({named: 1}),
  askMeetings: async (question, askId) => { calls.push(['askMeetings', question]); await wait(70); emit({type: 'ask-progress', askId, text: 'We agreed to send'}); await wait(150); return {text: 'We agreed to send the revised quotation on Thursday.', verdict: 'files', sources: [{name: detail.title, meetingId: detail.id}]}; },
  connectAccount: async provider => { await wait(250); if (connectError) return {ok: false, error: 'Sign-in was cancelled. Try again.'}; const account = {id: provider + ':krunal@example.test', provider, email: 'krunal@example.test'}; state.integrations.accounts.push(account); emit({type: 'integrations', integrations: state.integrations}); return {ok: true, account}; },
  disconnectAccount: async id => { state.integrations.accounts = state.integrations.accounts.filter(a => a.id !== id); emit({type: 'integrations', integrations: state.integrations}); },
  chooseContextDir: async () => { state.context = {dir: 'C:/Echo/context', files: [{name: 'price-list.md', info: '2 KB'}], skipped: []}; return state.context; },
  reloadContext: async () => state.context,
  chooseCalendarFile: async clear => { state.settings.calendarFile = clear ? '' : 'calendar.ics'; return state.calendar; },
  refreshCalendar: async () => state.calendar,
  chooseExportDir: async () => { state.settings.exportDir = 'C:/Echo/exports'; return state.settings.exportDir; },
  openExportDir: () => {}, window: command => calls.push(['window', command]), openApp: section => calls.push(['openApp', section]), openLibrary: () => {}, requestMeaning: id => calls.push(['requestMeaning', id]),
  showOverlayPanel: panel => calls.push(['showOverlayPanel', panel]),
  ask: (text, screen) => calls.push(['ask', text, screen]),
  catchUp: () => calls.push(['catchUp']), requestSuggestion: () => calls.push(['requestSuggestion']),
});
contextBridge.exposeInMainWorld('__uiTest', {
  emit, calls: () => calls,
  allowToggle: () => { failToggle = false; }, allowConnect: () => { connectError = false; },
});
`,
);
writeFileSync(
  join(temp, 'main.cjs'),
  `
const {app, BrowserWindow} = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, 'profile'))});
app.whenReady().then(() => {
  const win = new BrowserWindow({width: 1200, height: 900, webPreferences: {preload: ${JSON.stringify(join(temp, 'preload.cjs'))}, contextIsolation: true, sandbox: false}});
  win.loadFile(${JSON.stringify(join(repo, 'out/renderer/index.html'))}, {hash: 'app/home'});
});
app.on('window-all-closed', () => app.quit());
`,
);

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [join(temp, 'main.cjs')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const nav = (label) =>
  page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: label, exact: true });
const emit = (event) => page.evaluate((e) => window.__uiTest.emit(e), event);
const resize = (width, height) =>
  app.evaluate(
    ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds),
    [width, height],
  );
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const checkPalette = async () => {
  const failures = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const colour = (name) => (name.startsWith('--') ? style.getPropertyValue(name).trim() : name);
    const luminance = (name) => {
      const rgb = colour(name)
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16) / 255);
      const linear = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    return [
      ['--text', '--card'],
      ['--bold', '--card'],
      ['--muted', '--card'],
      ['--muted', '--raise-2'],
      ['--muted', '--mention'],
      ['--text', '--asked'],
      ['--accent', '--card'],
      ['--accent', '--accent-soft'],
      ['--ok', '--ok-soft'],
      ['--ok', '--raise'],
      ['--warn', '--warn-soft'],
      ['--danger', '--card'],
      ['#ffffff', '--primary'],
    ].flatMap(([fg, bg]) => {
      const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      const ratio = (values[1] + 0.05) / (values[0] + 0.05);
      return ratio >= 4.5 ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)}`];
    });
  });
  assert.deepEqual(failures, [], 'Text colours must meet 4.5:1 contrast');
};
try {
  await page
    .getByText('Good morning, Krunal.')
    .or(page.getByText('Good afternoon, Krunal.'))
    .or(page.getByText('Good evening, Krunal.'))
    .waitFor();
  assert.equal(await page.locator('.recent-meeting').count(), 6);
  assert.equal(await page.locator('.action-list input').count(), 8);
  const first = page.getByRole('checkbox', { name: 'Follow up item 0', exact: true });
  await first.check();
  await page.waitForFunction(
    () =>
      !document.querySelector('.action-list input').checked &&
      !document.querySelector('.action-list input').disabled,
  );
  await page.getByText('That action item could not be saved. Please try again.').waitFor();
  await page.evaluate(() => window.__uiTest.allowToggle());
  await first.check();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.action-list label')).some(
        (l) => l.textContent === 'Follow up item 0',
      ),
  );
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  assert.equal(await page.locator('.action-list input').count(), 10);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (c) => c[0] === 'openJoinLink' && c[1] === 'now',
    ),
  );
  await page.getByRole('button', { name: 'Start with Echo', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (c) => c[0] === 'requestStart' && c[1] === 'now',
    ),
  );
  await shot('home-light');
  await checkPalette();
  await page.locator('.recent-meetings').scrollIntoViewIfNeeded();
  await shot('home-recent-light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('home-recent-dark');
  await page.locator('.home-page').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('home-desktop-dark');
  await checkPalette();
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.keyboard.press('Control+k');
  assert(
    await page
      .getByRole('combobox', { name: 'Jump to', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.getByRole('combobox', { name: 'Jump to', exact: true }).fill('Mehta');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('.doc').waitFor();
  assert.equal(new URL(page.url()).hash, `#app/meetings/${meeting.id}`);
  await shot('meetings-desktop-light');
  await page.getByRole('button', { name: 'Meeting information', exact: true }).click();
  await page.getByRole('dialog', { name: 'Meeting details', exact: true }).waitFor();
  await shot('meeting-information-light');
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Meeting information', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await nav('Home').click();

  await emit({ type: 'session', running: true });
  await page.getByText('Listening', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Start a meeting', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByText('Paused', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Stop the call and save', exact: true }).click();
  await page.locator('.app-toast').getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.doc').waitFor();
  assert.equal(new URL(page.url()).hash, `#app/meetings/${meeting.id}`);
  assert.equal(await page.locator('.meeting-attendees .avatar').count(), 5);
  await page.getByRole('tab', { name: 'Minutes', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Transcript', exact: true, selected: true }).waitFor();
  await page.getByPlaceholder('Them — e.g. Mehta Hardware').waitFor();
  await page.getByRole('tab', { name: 'Minutes', exact: true }).click();
  await resize(820, 540);
  await shot('meetings-820-light');
  await page.getByRole('button', { name: 'Browse meetings', exact: true }).click();
  await page.getByLabel('Search meetings', { exact: true }).fill('Planning 2');
  await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 1);
  await shot('meeting-browser-820-light');
  await page.locator('.lib-item').click();
  await page.locator('.doc').waitFor();
  assert(await page.getByRole('button', { name: 'Browse meetings', exact: true }).isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await nav('Home').click();
  await page
    .getByRole('textbox', { name: 'Ask your meetings', exact: true })
    .fill('What did we agree?');
  await page.getByRole('textbox', { name: 'Ask your meetings', exact: true }).press('Enter');
  await page.getByText('From your meetings', { exact: true }).waitFor();
  await page.locator('.ask-sources .chip').click();
  await page.locator('.doc').waitFor();
  await nav('Ask').click();
  assert.equal(await page.locator('.question-bubble').count(), 1);
  await shot('ask-820-light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('ask-820-dark');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await emit({ type: 'navigate', section: 'settings' });
  const settingsNav = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  await page.getByLabel('My name', { exact: true }).fill('Asha');
  await page.getByLabel('My name', { exact: true }).press('Tab');
  await shot('profile-820-light');
  assert.equal(
    await page.evaluate(async () => (await window.echo.getState()).settings.myName),
    'Asha',
  );
  await settingsNav.getByRole('button', { name: 'Calendar & accounts', exact: true }).click();
  assert(
    await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Connect Outlook', exact: true }).click();
  await page.getByRole('button', { name: /Finish signing in in your browser/ }).waitFor();
  await page.getByText('Sign-in was cancelled. Try again.').waitFor();
  await page.evaluate(() => window.__uiTest.allowConnect());
  await page.getByRole('button', { name: 'Connect Outlook', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  await shot('calendar-820-light');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.account-list'));
  await settingsNav.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).first().click();
  await page.getByText('price-list.md', { exact: true }).waitFor();
  await settingsNav.getByRole('button', { name: 'AI & speech', exact: true }).click();
  await page.getByLabel('Speech-to-text language', { exact: true }).selectOption('indic-auto');
  await page.getByText(/Experimental: accuracy/).waitFor();
  await page.getByRole('button', { name: 'Open audio settings', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (call) => call[0] === 'showOverlayPanel' && call[1] === 'settings',
    ),
  );
  await shot('settings-820-light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('settings-820-dark');
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    ),
    '#71b6ed',
  );

  await emit({ type: 'navigate', section: 'meetings', meetingId: meeting.id });
  await page.locator('.doc').waitFor();
  await shot('meetings-820-dark');
  await nav('Home').click();
  await shot('home-820-dark');
  await emit({ type: 'calendar', calendar: { configured: false, events: [] } });
  await emit({ type: 'detected', meeting: { key: 'zoom-1', app: 'Zoom', since: Date.now() } });
  await page.getByText('Zoom call in progress', { exact: true }).waitFor();
  await shot('home-detected-dark');
  await page.getByRole('button', { name: 'Connect your calendar', exact: true }).click();
  await page.getByRole('heading', { name: 'Calendar & accounts', exact: true }).waitFor();

  // A first-run route still shows the stepper; returning preserves the requested section.
  await page.evaluate(() =>
    window.echo.updateSettings({ onboarded: false, consentAcknowledged: false, consentVersion: 0 }),
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Be here. Echo remembers.', exact: true }).waitFor();
  await shot('onboarding-820-dark');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await shot('onboarding-820-light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /I understand/ }).click();
  assert.equal(
    await page.evaluate(async () => (await window.echo.getState()).settings.consentVersion),
    CONSENT_VERSION,
  );
  await page.getByLabel('My name', { exact: true }).fill('Priya');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('heading', { name: 'Your calendar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await page.getByLabel('My name', { exact: true }).inputValue(), 'Priya');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('heading', { name: 'Ready', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Let’s begin', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => (await window.echo.getState()).settings.onboarded),
    true,
  );
  await page.evaluate(() => window.echo.updateSettings({ onboarded: false }));
  await page.reload();
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).waitFor();
  await page.evaluate((id) => {
    location.hash = `#library/${id}`;
  }, meeting.id);
  await page.locator('.doc').waitFor();
  assert.equal(new URL(page.url()).hash, `#app/meetings/${meeting.id}`);

  // The same bundle still renders the call bar at an empty hash.
  const overlayUrl = new URL(page.url());
  overlayUrl.hash = '';
  await page.goto(overlayUrl.href);
  await page.getByText('Zoom call detected', { exact: true }).waitFor();
  await page.getByTitle('Dismiss detected call', { exact: true }).click();
  await emit({ type: 'detected', meeting: { key: 'zoom-1', app: 'Zoom', since: Date.now() } });
  assert.equal(await page.locator('.detected-offer').count(), 0);
  await emit({ type: 'detected', meeting: { key: 'zoom-2', app: 'Zoom', since: Date.now() } });
  await page.getByText('Zoom call detected', { exact: true }).waitFor();
  await emit({ type: 'calendar', calendar: appState.calendar });
  await page.locator('.calendar-offer').waitFor();
  assert.equal(await page.locator('.detected-offer').count(), 0);
  await page.getByTitle('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Open Echo', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (c) => c[0] === 'openApp' && c[1] === 'home',
    ),
  );
  // Exercise the overlay at its actual content width, in both system themes.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(620, 640),
  );
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.getByTitle('Not for this meeting').click();
  await emit({ type: 'detected', meeting: null });
  await emit({ type: 'session', running: true, startedAt: Date.now() });
  await page.getByRole('tab', { name: 'Live', selected: true }).waitFor();
  await shot('overlay-empty-light');
  const at = Date.now() - 300000;
  const segments = [
    {
      id: 'them:1',
      speaker: 'them',
      at,
      text: 'Achha, blue wala 5 litre ka kitna stock hai?',
      meaning: 'How much stock of the blue 5-litre is there?',
    },
    { id: 'them:2', speaker: 'them', at: at + 60000, text: 'Aur wholesale rate bhi bata dijiye.' },
    {
      id: 'them:3',
      speaker: 'them',
      at: at + 180000,
      text: 'Priya, can you send the quotation?',
      mentions: ['Priya'],
    },
    { id: 'me:1', speaker: 'me', at: at + 190000, text: 'Yes, I’ll send it on WhatsApp.' },
    { id: 'them:4', speaker: 'them', at: at + 200000, text: 'Thank you. Thursday works for us.' },
  ];
  for (const segment of segments) await emit({ type: 'segment', segment });
  const answer = {
    id: 'answer-1',
    trigger: 'typed',
    asked: 'How much stock is available?',
    startedAt: at + 185000,
    finishedAt: at + 186000,
    firstTokenMs: 12,
    text: 'Blue 5 litre ke 142 units Pune godown mein hain. Wholesale rate ₹1,850 hai.',
    verdict: 'files',
    sources: ['inventory.csv', 'price-list.md'],
  };
  await emit({ type: 'suggestion-start', suggestion: answer });
  const live = page.locator('.live-feed');
  assert.equal(await live.locator('.line').count(), 4);
  assert.equal(await live.locator('.line.grouped').count(), 1);
  assert.deepEqual(await live.locator('.message-header strong').allTextContents(), [
    'Them',
    'Them',
    'Echo',
    'Them',
  ]);
  await live.getByRole('button', { name: /Explain: Achha/ }).focus();
  await page.keyboard.press('Enter');
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (call) => call[0] === 'requestMeaning' && call[1] === 'them:1',
    ),
  );
  await emit({
    type: 'mention',
    mention: { terms: ['Priya'], text: segments[2].text, asked: true },
  });
  await page.locator('.mention.asked').waitFor();
  await shot('overlay-live-light');

  const ask = page.getByLabel('Ask Echo', { exact: true });
  await ask.fill('Keep this draft');
  await page.getByRole('tab', { name: 'Live', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Transcript', selected: true }).waitFor();
  assert.equal(await ask.inputValue(), 'Keep this draft');
  assert.equal(await page.locator('.transcript .line').count(), 5);
  assert.equal(await page.locator('.transcript .line.grouped').count(), 1);
  assert.equal(await page.locator('.transcript .line-me strong').textContent(), 'Priya');
  assert.equal(await page.locator('.transcript .line.mentioned').count(), 1);
  await shot('overlay-transcript-light');
  await page.getByTitle('Dismiss', { exact: true }).click();

  for (const tab of ['Context', 'Settings']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    assert(await ask.isEnabled());
    assert.equal(await ask.inputValue(), 'Keep this draft');
    await shot('overlay-' + tab.toLowerCase() + '-light');
  }
  assert.equal(await page.locator('.settings legend').first().textContent(), 'Audio');
  await emit({ type: 'overlay-panel', panel: 'context' });
  await page.getByRole('tab', { name: 'Context', selected: true }).waitFor();
  await emit({ type: 'overlay-panel', panel: 'settings' });
  await page.getByRole('tab', { name: 'Settings', selected: true }).waitFor();

  await page.getByTitle('Collapse', { exact: true }).click();
  assert.equal(
    await page.locator('.shell').evaluate((el) => el.getBoundingClientRect().height),
    44,
  );
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('overlay-collapsed-light');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Ask Echo',
  );
  assert.equal(await ask.inputValue(), 'Keep this draft');
  await page.evaluate(() => window.echo.updateSettings({ llmVisionModel: 'vision-test' }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Attach my screen', exact: true }).click();
  await ask.fill('Read this screen');
  await ask.press('Enter');
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (call) => call[0] === 'ask' && call[1] === 'Read this screen' && call[2] === true,
    ),
  );
  assert.equal(await ask.inputValue(), '');
  assert.equal(
    await page.getByRole('button', { name: 'Attach my screen' }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: 'Catch me up', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some((call) => call[0] === 'catchUp'),
  );

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.shell')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()),
    '#71b6ed',
  );
  await shot('overlay-live-dark');
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await shot('overlay-transcript-dark');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await shot('overlay-settings-dark');
  await page.getByRole('tab', { name: 'Context', exact: true }).click();
  await shot('overlay-context-dark');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByTitle('More', { exact: true }).click();
  await shot('overlay-menu-dark');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.overlay-menu').count(), 0);
  await page.waitForFunction(() => document.activeElement?.id === 'overlay-more');

  // Long streaming answers and several banners must leave the composer in view.
  await emit({
    type: 'suggestion-start',
    suggestion: {
      ...answer,
      id: 'long',
      finishedAt: undefined,
      text: 'A long answer. '.repeat(300),
    },
  });
  await emit({
    type: 'mention',
    mention: { terms: ['Priya'], text: 'Can you confirm?', asked: true },
  });
  await emit({ type: 'notice', level: 'info', message: 'Your meeting is being saved.' });
  assert(await page.locator('.shell').evaluate((el) => el.getBoundingClientRect().height <= 640));
  assert(
    await page
      .locator('.composer')
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  );
  assert(await live.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40));
  await live.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await emit({ type: 'suggestion-token', id: 'long', text: 'Updated answer. '.repeat(350) });
  assert.equal(await live.evaluate((el) => el.scrollTop), 0);
  await emit({
    type: 'suggestion-done',
    suggestion: {
      ...answer,
      id: 'long',
      verdict: 'screen',
      usedScreen: true,
      text: 'Screen content reviewed.\n\n' + 'A long line of code: '.repeat(40),
    },
  });
  await shot('overlay-long-answer-dark');
  await emit({ type: 'click-through', enabled: true });
  assert(await ask.isDisabled());
  await shot('overlay-click-through-dark');
  assert.deepEqual(errors, []);
  console.info(`UI interactions passed. Screenshots: ${shots}`);
} catch (e) {
  await shot('failure');
  console.error('Renderer errors:', errors);
  throw e;
} finally {
  await app.close();
}
