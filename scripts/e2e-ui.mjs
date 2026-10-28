/** Renderer interaction checks with a deterministic window.bolo contract.
 * Run after npm run build: node scripts/e2e-ui.mjs
 * Uses the same optional Playwright installation as e2e-electron.mjs.
 * All fixtures and Electron data live in a temporary folder, never your Bolo profile.
 */
import { _electron as electron } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { CONSENT_VERSION, DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const repo = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'bolo-ui-'));
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
let state = JSON.parse(localStorage.getItem('bolo-ui-state') || ${JSON.stringify(JSON.stringify(appState))});
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
contextBridge.exposeInMainWorld('bolo', {
  getState: async () => state,
  updateSettings: async patch => { calls.push(['updateSettings', patch]); state.settings = {...state.settings, ...patch}; localStorage.setItem('bolo-ui-state', JSON.stringify(state)); return state.settings; },
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
  chooseContextDir: async () => { state.context = {dir: 'C:/Bolo/context', files: [{name: 'price-list.md', info: '2 KB'}], skipped: []}; return state.context; },
  reloadContext: async () => state.context,
  chooseCalendarFile: async clear => { state.settings.calendarFile = clear ? '' : 'calendar.ics'; return state.calendar; },
  refreshCalendar: async () => state.calendar,
  chooseExportDir: async () => { state.settings.exportDir = 'C:/Bolo/exports'; return state.settings.exportDir; },
  openExportDir: () => {}, window: () => {}, openApp: section => calls.push(['openApp', section]), openLibrary: () => {}, requestMeaning: () => {},
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
  await page.getByRole('button', { name: 'Start with Bolo', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (c) => c[0] === 'requestStart' && c[1] === 'now',
    ),
  );
  await shot('home-light');

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

  await emit({ type: 'navigate', section: 'settings' });
  const settingsNav = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  await page.getByLabel('My name', { exact: true }).fill('Asha');
  await page.getByLabel('My name', { exact: true }).press('Tab');
  assert.equal(
    await page.evaluate(async () => (await window.bolo.getState()).settings.myName),
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
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.account-list'));
  await settingsNav.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).first().click();
  await page.getByText('price-list.md', { exact: true }).waitFor();
  await settingsNav.getByRole('button', { name: 'AI & speech', exact: true }).click();
  await page.getByLabel('Speech-to-text language', { exact: true }).selectOption('indic-auto');
  await page.getByText(/Experimental: accuracy/).waitFor();
  await shot('settings-820-light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('settings-820-dark');
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    ),
    '#8b8cff',
  );

  await emit({ type: 'navigate', section: 'meetings', meetingId: meeting.id });
  await page.locator('.doc').waitFor();
  await shot('meetings-820-dark');
  await nav('Home').click();
  await shot('home-820-dark');
  await emit({ type: 'calendar', calendar: { configured: false, events: [] } });
  await emit({ type: 'detected', meeting: { key: 'zoom-1', app: 'Zoom', since: Date.now() } });
  await page.getByText('Zoom call in progress', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect your calendar', exact: true }).click();
  await page.getByRole('heading', { name: 'Calendar & accounts', exact: true }).waitFor();

  // A first-run route still shows the stepper; returning preserves the requested section.
  await page.evaluate(() =>
    window.bolo.updateSettings({ onboarded: false, consentAcknowledged: false, consentVersion: 0 }),
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Be here. Bolo remembers.', exact: true }).waitFor();
  await shot('onboarding-820-dark');
  await page.getByRole('button', { name: /I understand/ }).click();
  assert.equal(
    await page.evaluate(async () => (await window.bolo.getState()).settings.consentVersion),
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
    await page.evaluate(async () => (await window.bolo.getState()).settings.onboarded),
    true,
  );
  await page.evaluate(() => window.bolo.updateSettings({ onboarded: false }));
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
  await page.getByRole('button', { name: 'Open Bolo', exact: true }).click();
  assert(
    (await page.evaluate(() => window.__uiTest.calls())).some(
      (c) => c[0] === 'openApp' && c[1] === 'home',
    ),
  );
  assert.deepEqual(errors, []);
  console.info(`UI interactions passed. Screenshots: ${shots}`);
} catch (e) {
  await shot('failure');
  console.error('Renderer errors:', errors);
  throw e;
} finally {
  await app.close();
}
