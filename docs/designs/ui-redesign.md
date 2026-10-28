# Bolo UI redesign: a full app with a home dashboard

Status: spec for implementation (2026-10-28). Implementer: Codex. Reviewer: Claude.

## Goal

Bolo is a meeting buddy for people who take meetings in Indian languages. Today it is a
slim overlay plus a plain "Meetings" library window. Make it feel like a polished,
friendly product (think Granola / Muse / Notion calm): a **main window** with a home
dashboard, and a refreshed in-call **overlay**.

## Hard constraints

- **No new npm dependencies.** React 19 + plain CSS only. No CSS frameworks, icon packs or
  web fonts (the CSP is `default-src 'self'`; nothing loads from the network). Use the
  system font stack and inline SVG icons (extend `src/renderer/src/components/Icon.tsx`).
- **Do not change** `src/main/**`, `src/preload/**`, `src/core/**`, `src/shared/**`. They
  are the contract (`window.bolo`, typed in `src/preload/api.ts`; events in
  `src/shared/ipc.ts`). If you need something the contract lacks, write it under
  "Contract requests" in your final message instead of changing it.
- Everything typed: `npm run typecheck`, `npm run lint` (`--max-warnings 0`), `npm test`
  and `npx prettier --check src test scripts` must pass.
- Keep accessibility: real buttons, labels on inputs, roles on tabs, visible focus, text
  contrast at least 4.5:1, works with keyboard only.
- Must render well from 820×540 up to full screen.

## Windows and routes (one renderer bundle)

`src/renderer/src/main.tsx` picks the root from `location.hash`:

| Hash | Root |
|---|---|
| (none) | Overlay (`App.tsx`) — in-call bar, always on top, hidden from screen share |
| `#app/home` · `#app/meetings[/<meetingId>]` · `#app/ask` · `#app/settings` | Main window (new) |
| `#library[/<id>]` | Alias of `#app/meetings[/<id>]` (old links) |

The main window listens for `{ type: 'navigate', section, meetingId? }` events and must
switch section (and select the meeting) when one arrives. Use `history.replaceState` to
keep the hash in sync when the user navigates.

## Main window layout

Light theme by default, with a full dark theme under `@media (prefers-color-scheme: dark)`.
Define colors as CSS variables on `html.app-window`; the overlay keeps its own dark glass.
Calm neutrals (paper `#f7f7f5`, cards white, hairline borders, 12px radius, soft shadow),
one accent (indigo `#4f46e5` light / `#8b8cff` dark), green for "verified/from your files",
amber for "check this". Comfortable 14px body text, generous spacing.

```
┌──────────────┬───────────────────────────────────────────────────┐
│ ● Bolo       │  (section content)                                 │
│              │                                                    │
│ [▶ Start a   │                                                    │
│   meeting]   │                                                    │
│              │                                                    │
│ ⌂ Home       │                                                    │
│ ▤ Meetings   │                                                    │
│ ✦ Ask        │                                                    │
│ ⚙ Settings   │                                                    │
│              │                                                    │
│ ── status ── │                                                    │
│ ● Listening  │                                                    │
│   12:04 ⏸ ■  │                                                    │
└──────────────┴───────────────────────────────────────────────────┘
```

- Sidebar (~220px; collapses to icons under 980px): brand, primary **Start a meeting**
  button (`window.bolo.requestStart()`; disabled with a hint while a call is running),
  nav, and a live status block at the bottom while a call runs (timer from
  `session`/`paused` events: "Listening" / "Paused"; buttons Pause/Resume →
  `setPaused`, Stop → `stopSession()` then show the result as a toast with "Open").
- A toast area (bottom-centre) for `notice` events and action results.

### Home (dashboard)

Greeting with the user's name (`settings.myName`, else "there") and today's date.

Cards (CSS grid, 2 columns ≥ 1100px, 1 column below):

1. **Happening now / Up next** — from `state.calendar.events` (see `meetingNow` in
   `src/shared/calendar.ts`) and `state.detected` (a call another app is in). Shows title,
   time ("starts in 3 min"), people (avatars with initials, max 4 + "+n"), source badge
   (Google / Outlook / iCal from `event.source` prefix), and buttons **Start with Bolo**
   (`requestStart(event.key)`) and **Join** (`openJoinLink(event.key)`, only if
   `joinUrl`). If only `detected` is set: "Zoom call in progress — Start with Bolo"
   (`requestStart()`). If nothing: friendly empty state with "Start a meeting".
2. **Today** — the rest of today's and tomorrow's events as a timeline (time, title,
   people count, Start button within the next hour). If no calendar is connected:
   "Connect your calendar" with buttons that go to Settings → Calendar.
3. **To do** — `listActionItems()`: open items first, checkbox per item
   (`toggleActionItem(meetingId, index, done)`, optimistic update, revert on `false`),
   owner chip, meeting title link (navigates to that meeting). Show 8, "Show all".
   Refresh on `meeting-updated` / `meeting-deleted`.
4. **Recent meetings** — `listMeetings('')`, newest 6 as cards: title, date, duration,
   minutes state badge (writing… / ready / failed), action-item count, snippet. Click →
   Meetings section with that meeting.
5. **Ask your meetings** — a single input; Enter navigates to Ask with the question
   pre-filled and sent.

### Meetings

Rework `src/renderer/src/library/Library.tsx` into this section (keep its behaviour and
its sub-components; restyle them): left list with search (grouped by day), right detail
with editable title, meta line, tabs **Minutes / Transcript / Notes & answers**, minutes
toolbar (Edit, Copy, Email, PDF, Markdown, Rewrite), figure warning, speaker naming
("They are", per-line picker, "Guess who said what"). Add attendee avatars in the header
when `attendees` is non-empty. Keep the meeting list in sync with events as today.

### Ask

A chat-style page for "ask your meetings" (`askMeetings(question, askId)` with
`ask-progress` streaming): question bubbles, answer cards with the verdict label (reuse
the `ASK_LABEL` wording), source chips that open the meeting, suggested starter
questions when empty ("What did we agree with …?", "Open action items for me",
"What did they ask about pricing?"). Keep the conversation in component state only.

### Settings

Sections with a left sub-nav (or a single scrolling page with anchored headings):

- **Profile** — My name, Alert me on (watch words, with the Devanagari hint), I read
  (language select, `state.languages`).
- **Calendar & accounts** — "Connect Google Calendar" / "Connect Outlook" buttons
  (`connectAccount('google' | 'microsoft')`; show a spinner "Finish signing in in your
  browser…" until it resolves; show the error if `ok: false`). Disable a button with the
  hint "Not set up in this build (needs GOOGLE_CLIENT_ID in .env)" when
  `state.integrations.available[provider]` is false. Connected accounts list with
  provider icon, email, error (if any) and **Disconnect** (`disconnectAccount(id)`).
  Below: the existing iCal link / .ics file controls (`calendarUrl`,
  `chooseCalendarFile`, `refreshCalendar`) as "Other calendars". Toggle **Notice calls
  in Zoom, Teams, Meet and others** (`settings.autoDetect`).
- **During meetings** — mode (Silent / Assist / Active, with the descriptions from
  `MODE_INFO` in `components/Bar.tsx`), reply language, explain mixed-language lines,
  transcript minutes sent.
- **Knowledge** — context folder (`chooseContextDir`, `reloadContext`, file list from
  `state.context`), "Also answer from my past meetings" (`useMeetings`, with count
  `memoryMeetings`), "About me" note (`contextNote`).
- **After meetings** — auto minutes, export folder.
- **AI & speech** — keys status, LLM base URL/model/vision model, speech-to-text language
  and number formatting (reuse logic from `components/SettingsPanel.tsx`; audio device and
  WAV replay stay in the overlay's settings, link to it: "Audio input is set in the call
  bar").
- **Privacy** — what is stored and sent (copy the substance of `ConsentNotice.tsx`).

Text fields commit on blur (see `useDraft` in `SettingsPanel.tsx`) through
`updateSettings` and update from the returned settings.

### Onboarding (first run)

If `settings.onboarded` is false, the main window shows a centred stepper instead of the
sidebar layout: 1 Welcome (what Bolo does, privacy promise, the consent text with an
"I understand — I will ask for consent" button that sets `consentAcknowledged: true,
consentVersion: CONSENT_VERSION`) → 2 Your name (+ watch words) → 3 Connect your calendar
(Google / Outlook / iCal link / Skip) → 4 Your knowledge (context folder, optional) →
5 Ready (keys status from `state.keys`/`state.llm`; tips: hotkeys Ctrl+Shift+Space,
Ctrl+Shift+U, Ctrl+Alt+Space). Finish and Skip both set `onboarded: true`. Back/Next,
progress dots.

## Overlay refresh (`App.tsx` and components)

Keep the structure and behaviour (bar, strips, Live/Transcript/Context/Settings tabs) but
polish it: softer glass, better spacing, pill buttons, clearer answer card hierarchy,
subtle enter animations (respect `prefers-reduced-motion`). Add:

- A **detected call** strip like the calendar offer when `state.app.detected` is set, no
  call is running and it was not dismissed (dismiss per `detected.key`): "Zoom call
  detected · Start with Bolo · ×". If a calendar meeting is offered at the same time, show
  only the calendar strip (it carries the title).
- Menu: "Open Bolo" (`openApp('home')`) next to "Meetings".

## Must keep working (the end-to-end test drives these)

`scripts/e2e-electron.mjs` uses these names; keep them, or update the script to match
and keep each check's intent:

- Overlay: button "Start", status "Listening", label "Ask Bolo", tabs Live/Transcript/
  Context/Settings, texts "Before you record a call", "I understand", "Keys (from .env",
  "Answer · from your files", "Answer · not in your files", "Answer · from your screen",
  "Catch-up · last 10 min", "Answer · from past meetings", "Mentioned: …", classes
  `.answer .chip`, `.answer .chip-meeting`, `.answer pre.code`, `.transcript .line`,
  `.who`, `.calendar-offer` with "Join" and title "Not for this meeting", `.events`,
  "Catch me up", button "Mode: Active", title "Stop the call and save", notice text
  starting "Meeting saved. Writing the minutes". The overlay collapsed height stays 44px.
- Main window (Meetings): label "Search meetings", `.lib-item`, the "No meeting mentions
  all of that" message, `.doc`, the "Written … Check before sharing." footer, tabs
  Minutes/Transcript, `.ask-sources .chip` and "From your meetings" (Ask results),
  `.who-pick`, `.who-pick.guessed`, placeholder "Them — e.g. Mehta Hardware", button
  "Guess who said what", toast "Named 3 lines…".

The test currently opens the library from the overlay notice; the main window may now
also open at startup — the reviewer will adapt the window handling in the test.

## Deliverable

Commit on your branch with a clear message. In your final message: what you built, files
touched, anything not done, and "Contract requests" if any.
