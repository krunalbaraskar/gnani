# Rebuild the UI in the style of GetStream's Slack clone

Status: spec for implementation (2026-10-28). Implementer: Codex. Reviewer: Claude.

Reference: https://github.com/GetStream/slack-clone-react-native (a React Native Slack
clone; its screenshots and `src/appTheme.js` are summarised below; the code itself is
not copied, only the visual language). It is a phone app; Bolo is a desktop app with two
windows, so this spec maps each element onto Bolo.

## The design language to reproduce

Tokens (from the reference's `appTheme.js` and component styles):

| Token                                       | Light                                              | Dark                             |
| ------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| primary (header bars, FAB, sheet titles)    | `#3E3139` aubergine                                | `#121115`                        |
| background                                  | `#FFFFFF`                                          | `#19181C`                        |
| backgroundSecondary (inputs, hovers, menus) | `#E9E9E9` (use `#F4F4F4` for large areas)          | `#212527`                        |
| text                                        | `#000000` (use `#1D1C1D`)                          | `#D8D8D9`                        |
| boldText (names, titles)                    | `#000000`                                          | `#D0D0D0`                        |
| dimmedText (times, previews)                | `#979A9A` (use `#616061` where it must pass 4.5:1) | `#9A9A9D`                        |
| linkText / send / mentions-of-files         | `#1E75BE`                                          | `#1E75BE` (lighten for contrast) |
| border / separators                         | `#D3D3D3`                                          | `#252529`                        |
| online / positive                           | `#117A58`                                          | `#2BAC76`                        |
| notification / destructive                  | `rgb(255,69,58)` (`#E01E5A` for text)              | same                             |

Type: Lato in the reference — use `Lato, "Segoe UI", system-ui, sans-serif` (Lato only if
installed; no web fonts). Names 15 px weight 800–900, body 15 px, times 11 px grey (the
reference uses 10 px; go 11 for legibility), header titles 17 px bold, section labels
14 px regular, date separators 12 px bold over a hairline.

Shapes and patterns:

- **Header bar**: solid aubergine, 52–56 px tall, bold white centred or left title, white
  icon buttons (search, info). Dark mode: near-black.
- **"Jump to" box**: full-width input, 8 px radius, white, very soft shadow
  (`0 1px 3px rgba(0,0,0,.12)`), 15 px text.
- **List rows**: 44–56 px, `#` glyph (or an icon) in dimmed text then the name; unread /
  important rows bold; a 10 px round green dot for "live / on now"; section headers
  ("Channels" with a `+`) in 14 px; thin separators between rich rows (DM-style rows:
  square avatar 36–40 px with 6 px radius, small status dot at its corner, name, one-line
  preview "You: …" / "Them: …").
- **Messages**: square avatar 36 px (6 px radius) on the left; bold name + grey time on
  one line; text below; consecutive messages from the same speaker collapse (no repeated
  avatar/name); reaction-like pills (rounded 16 px, light blue border `#1E75BE33`, blue
  count) — used for sources/chips here; "N replies" link in blue bold.
- **Date separator**: "Today" / "Yesterday" / date in bold 12 px with a hairline.
- **Composer**: borderless top-separated area; placeholder "Message #channel"; below it a
  toolbar row: `@`/icons on the left, blue paper-plane send on the right.
- **FAB**: 56 px aubergine circle with a white compose/plus icon, bottom-right, shadow.
- **Sheets / dialogs**: aubergine title bar ("Switch User" style), list body.
- **Action sheet**: bottom/side sheet with icon + label rows (Copy text, Reply in thread
  …), destructive row in red.

## Hard constraints

- **No new npm dependencies**, no web fonts, no external assets, no copying code from the
  reference repo (CSP is `default-src 'self'`). Inline SVG icons in
  `components/Icon.tsx` (add: hash, at, threads, drafts, compose, info, paper-plane,
  search…).
- **Do not change** `src/main/**`, `src/preload/**`, `src/core/**`, `src/shared/**`.
  Contract requests go in your final message.
- Must pass: `npm run typecheck`, `npm run lint`, `npm test`,
  `npx prettier --check src test scripts`, `npm run build`, `node scripts/e2e-electron.mjs`,
  `node scripts/e2e-ui.mjs` (Playwright is installed). Look at every screenshot both
  produce and fix what looks wrong.
- Light by default, full dark theme under `prefers-color-scheme: dark`.
- Accessibility: real buttons/links, labels on inputs, tab roles, visible focus,
  contrast ≥ 4.5:1 for text, keyboard-only use, `prefers-reduced-motion`.
- Main window works from 820×540 to full screen; overlay geometry is fixed by main:
  **620 px wide, collapsed = exactly the 44 px bar**, max 640 px tall, transparent
  around rounded surfaces.

## Main window (`#app/...`)

Layout (desktop Slack built from the mobile pieces):

```
┌────────────────────────────────────────────────────────────────────┐
│ [B] Bolo            (  Jump to…                         ) 🔍       │ aubergine bar
├────┬────────────────────┬──────────────────────────────────────────┤
│ ⌂  │ ✦ Ask              │ # mehta-follow-up          ⓘ  ⋯         │ white header
│Home│ ☑ To do        3   │ 6 members · Wed 28 Oct · 32 min         │
│ ▤  │ ────────────────── │ ───────────── Today ─────────────────── │
│Mtgs│ Today          +   │ [MH] Mehta Hardware  10:42 am           │
│ ✦  │ ● 3:00 Mehta …     │      Achha, blue wala 5 litre…          │
│Ask │   5:30 Weekly sync │ [B]  Bolo  APP  10:42 am                │
│ ☺  │ Meetings       +   │      ┃ Answer · from your files          │
│You │ # blue-5-litre…    │      ┃ Blue 5 litre ke 142 units…        │
│    │ # pricing-review   │      ┃ (inventory.csv) (price-list.md)   │
│    │ # weekly-sync      │                                          │
│    │                    │ Message #mehta-follow-up                 │
│    │               (✎)  │ @  ⟲        ➤                            │
└────┴────────────────────┴──────────────────────────────────────────┘
```

- **Top bar** (aubergine, full width, 48 px, the window's drag region is the OS title
  bar, so this is just a header): app tile "B" (rounded 6 px square), "Bolo", a "Jump to"
  search (focus with Ctrl+K) that filters meetings by title and jumps to sections; while
  a call runs, a pill on the right: green dot · "Live 12:04" · Pause · Stop.
- **Rail** (left, 64–72 px, aubergine-tinted in light like Slack desktop's workspace
  rail, or the primary colour): icon + label buttons Home, Meetings, Ask, You (=
  Settings). Accessible names stay "Home", "Meetings", "Ask", "Settings" (the visible
  label for Settings may read "You"; keep `aria-label="Settings"`), in a
  `navigation` named "Main navigation".
- **Sidebar** (white, 240–280 px, collapses below 980 px): rows "Ask" (threads icon) and
  "To do" (drafts icon, count), a separator, section **Today** (calendar events as rows:
  time + title, green dot when on now / starting soon, hover shows "Start"), section
  **Meetings** (`# slug-of-title` rows, newest first, bold while minutes are being
  written; `+` = Start a meeting). FAB (✎, aubergine circle) = **Start a meeting**
  (`requestStart()`; keep the accessible name "Start a meeting").
- **Home**: a "channel"-like page: header "Home" with today's date; "Up next / happening
  now" as a highlighted message-like card (avatar stack, title, "starts in 3 min",
  buttons **Start with Bolo**, **Join**); a detected call as the same card ("Zoom call in
  progress"); then **Today** (DM-style rows with attendee avatar stacks), **To do**
  (checkbox rows, owner pill, meeting link), **Recent meetings** (DM-style rows: avatar
  stack, title, "Them: last line…" preview, minutes state badge). Keep the behaviour and
  data of the current `app/Home.tsx`.
- **Meetings** → a meeting is a **channel**: header `# slug` with "N members · date ·
  duration" and an ⓘ that opens a details side sheet (attendees, agenda, mode, pauses);
  header tabs **Minutes · Transcript · Notes & answers** (keep the tab roles/names).
  Transcript = message list with date separator, avatars, grouping, Bolo answers as
  `APP` posts with source "reaction pills", mentioned lines highlighted, speaker picker
  on "them" names (keep `.who-pick`, "They are", "Guess who said what"). Minutes =
  the rendered minutes as a pinned post at the top with an actions row (Edit, Copy,
  Email, PDF, Markdown, Rewrite) — or an action sheet behind ⋯. The meetings list itself
  lives in the sidebar; on narrow widths, a list page with "Jump to" + rows. Keep search
  (label "Search meetings") and its "No meeting mentions all of that…" message.
- **Ask** = a thread view titled "Ask your meetings" with the conversation as messages
  (You / Bolo APP), source pills that open the meeting, and a composer
  "Message Bolo about your meetings". Keep `.ask-sources .chip` and "From your meetings".
- **You (Settings)**: a profile header (big square avatar with initials, name, "Edit")
  then grouped list rows like the reference's profile screen (Profile, Calendar &
  accounts, During meetings, Knowledge, After meetings, AI & speech, Privacy) — each a
  section of the same page or a sub-page; forms in the reference's input style. Keep
  every control and label of the current `app/SettingsPage.tsx` (e2e uses "My name",
  "Connect Google Calendar", "Connect Outlook", "Disconnect", "Settings sections" nav
  with "AI & speech", "Open audio settings").
- **Onboarding**: keep the 5 steps; present them as a centred card with an aubergine
  header ("Welcome to Bolo") like the reference's sheet.
- Toasts: dark rounded snackbar bottom-centre.

## Overlay (call bar, no hash)

```
╭──────────────────────────────────────────────────────────╮ 44 px aubergine bar
│ [B] Bolo  ● Live 00:12  ⏸ ■ │ Them●  Me● │ Active ▾ ⛨ ⌃ ⋯ │
╰──────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────╮ banner (white card)
│ @ Mentioned: Mehta Hardware  “Hello, Mehta Hardware…”  × │
╰──────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────╮ white channel panel
│ # live   Transcript   Context   Settings         3 files │
│ ─────────────── Today ───────────────                    │
│ [T] Them  07:06 pm                                       │
│     Hello, Mehta Hardware se bol raha hoon…              │
│ [B] Bolo  APP  07:06 pm                                  │
│     ┃ Answer · from your files                           │
│     ┃ Blue 5 litre ke 142 units…                         │
│     ┃ (inventory.csv) (price-list.md)                    │
│ ──────────────────────────────────────────────────────── │
│ Message Bolo…                                            │
│ ⟲ Catch me up  🖥                                    ➤   │
╰──────────────────────────────────────────────────────────╯
```

- The **bar is aubergine** (dark: near-black) with white text/icons, 44 px, rounded 10 px,
  the drag handle; Start is a white pill button; the timer shows a green dot when live.
  Keep: brand, Start/timer/Stop, Pause, listening dots, mode chip, shield, expand, menu.
- Panel: white (dark `#19181C`) card, header tabs styled like the channel header,
  message list (current `LiveFeed`/`Transcript` restyled to the message pattern above),
  composer with blue paper-plane send, banners as white cards with an icon and actions.
- Menu ⋯ = an action sheet card (icon rows: Open Bolo, Meetings, Click-through, Hide,
  Quit in red).
- Keep the calm rules: nothing flashes; mentions use a soft yellow background
  (Slack's mention highlight), questions for the user slightly stronger, never red.

## Must keep working (the end-to-end tests drive these)

Keep these, or update `scripts/e2e-electron.mjs` / `scripts/e2e-ui.mjs` to match while
keeping every check's intent (never delete a check):

- Overlay: button "Start", status "Listening", label "Ask Bolo", tabs Live/Transcript/
  Context/Settings, "Mode: Active", title "Stop the call and save", "Expand"/"Collapse",
  consent "Before you record a call" + "I understand…" (contrast ≥ 4.5:1 is checked),
  "Keys (from .env", two `input[type=file]` for WAV replay, answer titles ("Answer · from
  your files", "Answer · not in your files", "Answer · from your screen", "Answer · from
  past meetings", "Catch-up · last 10 min"), "You asked: …", `.answer .chip`,
  `.answer .chip-meeting`, `.answer pre.code`, `.transcript .line` rows with a `.who`
  of exactly "Them"/"Me", "Catch me up", "Mentioned: …", `.calendar-offer` ("Join",
  title "Not for this meeting"), `.detected-offer` ("<App> call detected"), `.events`
  rows with "Start", the "Meeting saved. Writing the minutes…" notice (click opens the
  meeting), `.settings legend` first = "Audio" after "Open audio settings".
- Main window: "Main navigation" with Home/Meetings/Ask/Settings, "Start a meeting",
  "Search meetings", `.lib-item`, `.recent-meeting`, `.action-list input`, `.doc`, the
  "Written … Check before sharing." footer, tabs Minutes/Transcript, `.ask-sources .chip`,
  "From your meetings", `.question-bubble`, `.who-pick`, `.who-pick.guessed`, placeholder
  "Them — e.g. Mehta Hardware", "Guess who said what", toast "Named 3 lines…",
  `.meeting-attendees .avatar`, `.detected-offer` on Home, "Settings sections" nav,
  "My name", "Connect Google Calendar", "Disconnect", "Open audio settings", the
  greeting "Good morning/afternoon/evening, <name>." and no horizontal scroll at 820 px.

## Deliverable

Commit on your branch. Final message: what changed per page, files touched, the
screenshots you reviewed, anything not done, contract requests.
