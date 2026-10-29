# Overlay redesign: comfortable, Slack-like, matching the app

Status: spec for implementation (2026-10-28). Implementer: Codex. Reviewer: Claude.

## Goal

The call overlay (`src/renderer/src/App.tsx` and its components, no hash in the URL) is
still a dark, dense "glass HUD". Make it feel **comfortable and familiar, like Slack**,
and **match the main window** (`src/renderer/src/app/*`, `app.css`): same palette, type
scale, radii, buttons and avatars. A user who lives in Slack should read it at a glance:
messages with avatars and names, an app's answer posted like a bot message, a composer at
the bottom, calm banners.

## Hard constraints (same as the app redesign)

- **No new npm dependencies**, no web fonts, no external assets (CSP is `default-src
'self'`). System font stack; inline SVG icons via `components/Icon.tsx`.
- **Do not change** `src/main/**`, `src/preload/**`, `src/core/**`, `src/shared/**`.
  Contract requests go in your final message.
- `npm run typecheck`, `npm run lint`, `npm test`, `npx prettier --check src test scripts`
  pass; then `npm run build` and both `node scripts/e2e-electron.mjs` and
  `node scripts/e2e-ui.mjs` pass (they need Playwright, already installed).
- Window geometry is fixed by the main process: **620 px wide**, height follows the
  content (the ResizeObserver in `App.tsx`), **collapsed = exactly the 44 px bar**,
  maximum 640 px. Keep the window transparent around rounded surfaces.
- Accessibility: real buttons, labels, tab roles, visible focus, contrast ≥ 4.5:1,
  `prefers-reduced-motion` respected.
- It sits over Zoom/Meet all day: no flashing, no large saturated areas, and nothing that
  pulls attention unless something needs the user (a mention, a question for them).

## Theme

Follow the system theme exactly like the main window: light by default, dark under
`@media (prefers-color-scheme: dark)`. Reuse the main window's tokens (copy the values
from `app.css`; scope them to the overlay root `.shell`). Surfaces: white (dark: `#1f1f24`)
cards with a hairline border and a soft shadow, 12 px radius, a light translucency is
fine (`--bg-alpha` from settings still controls opacity). The Slack nod is in structure
and a few touches, not in copying Slack's brand colours:

- Message rows: 36 px rounded-square avatar (initials, colour from the name, as in
  `components/Avatars.tsx`), **bold name**, muted time, text below; consecutive lines
  from the same speaker within 2 minutes collapse under one header (Slack grouping);
  hover shows a subtle row background and a small action ("Explain" for their lines).
- Bot posts: Echo's answers appear as a message from **Echo** with an `APP` tag next to
  the name (Slack style), the answer text, and an attachment-style block with a 4 px
  coloured left border: green = from your files / past meetings / this call, amber =
  check this figure / not in your files, blue = screen, neutral = suggested reply.
  Sources render as small chips inside that block.
- Composer: the Ask input becomes a Slack-like composer — rounded bordered box,
  placeholder "Message Echo…" (keep the accessible label "Ask Echo"), a slim toolbar row
  inside with icon buttons: attach screen (existing toggle), **Catch me up**, send.
- Banners (notices, mentions, calendar offer, detected call, click-through): Slack-style
  top banners — icon on the left, one line of text, actions on the right, close ×.
  Mentions use a warm yellow highlight like a Slack @-mention; a question for the user is
  slightly stronger, never red.

## Structure

```
╭───────────────────────────────────────────────────────────╮  44px bar
│ ◉ Echo  ▶ Start | 00:12 ⏸ ■ │ ●Them ●Me │ Active ▾ │ ⛨ ⌃ ⋯ │
╰───────────────────────────────────────────────────────────╯
╭───────────────────────────────────────────────────────────╮  banner(s)
│ 🔔 Asked you · Mehta Hardware  “Krunal, can you…”  Answer ×│
╰───────────────────────────────────────────────────────────╯
╭───────────────────────────────────────────────────────────╮  panel
│ # Live   Transcript   Context   Settings          3 files │
│ ───────────────────────────────────────────────────────── │
│ [MH] Mehta Hardware  10:42                                │
│      Achha, blue wala 5 litre ka kitna stock…            │
│      ↳ How much stock of the blue 5-litre is there…       │
│ [B]  Echo APP  10:42                                      │
│      ┃ Answer · from your files                           │
│      ┃ Blue 5 litre ke 142 units Pune godown mein hain…  │
│      ┃ [inventory.csv] [price-list.md]          12 ms     │
│ ╭───────────────────────────────────────────────────────╮ │
│ │ Message Echo…                                         │ │
│ │ 🖥  ⟲ Catch me up                                ➤    │ │
│ ╰───────────────────────────────────────────────────────╯ │
╰───────────────────────────────────────────────────────────╯
```

- **Bar** stays one 44 px row and the drag handle. Keep everything it has (brand, Start /
  timer + Stop, Pause, listening dots, mode chip, shield, expand, menu). The composer
  moves out of the bar into the panel's Live tab; when the panel is collapsed, the bar
  keeps a compact "Ask" button that expands the panel and focuses the composer, so
  asking stays one click away. (Keep the `Ask Echo` input reachable whenever a call runs
  and the panel is open; the e2e test types into it.)
- **Live tab** = the conversation feed: the last few "them" lines (with meaning lines)
  and Echo's latest answer as a bot post, newest at the bottom, auto-scrolled; the
  composer pinned at the bottom of the panel. Empty state: a friendly line with the
  hotkeys.
- **Transcript tab**: the full Slack-style message list (grouping, avatars; "Me" uses
  `settings.myName` when set; mentioned lines get the @-mention highlight).
- **Context / Settings tabs**: restyle the forms to the app's form style (labels above
  fields, white fields, section cards). In the overlay Settings, put **Audio** first.
- **Menu (⋯)**: a small popover card (not a strip) with: Open Echo (`openApp('home')`),
  Meetings, Click-through, Hide, Quit.
- Handle the new event `{ type: 'overlay-panel', panel }` (already in the reducer) — and
  in the main window's Settings → AI & speech, replace the "Audio input is set in the
  call bar" text with a button **Open audio settings** calling
  `window.echo.showOverlayPanel('settings')`.

## Must keep working (the end-to-end tests drive these)

Keep these names/classes, or update `scripts/e2e-electron.mjs` / `scripts/e2e-ui.mjs`
to match while keeping every check's intent:

- Button "Start", status "Listening", label "Ask Echo", tabs Live/Transcript/Context/
  Settings, button "Mode: Active", title "Stop the call and save", "Expand"/"Collapse"
  titles, "Before you record a call" + "I understand" (consent), "Keys (from .env",
  `input[type=file]` ×2 for WAV replay in Settings.
- Answer titles: "Answer · from your files", "Answer · not in your files", "Answer · from
  your screen", "Answer · from past meetings", "Catch-up · last 10 min", text "You asked:
  …", classes `.answer .chip`, `.answer .chip-meeting`, `.answer pre.code`.
- `.transcript .line` rows each containing a `.who` element whose text is exactly "Them"
  or "Me" (the test counts them: 3 Them, 2 Me) — if you show names, keep a `.who`
  element with that text (it may be visually hidden) or update the test's counting.
- "Catch me up" button, "Mentioned: …" text, `.calendar-offer` with "Join" and title
  "Not for this meeting", `.detected-offer` with "<App> call detected", `.events`
  list with "Start" buttons in Context, the notice text "Meeting saved. Writing the
  minutes…" (clickable to open the meeting).
- Collapsed overlay height exactly 44 px; overlay 620 px wide.

## Deliverable

Commit on your branch. Final message: what changed, files touched, screenshots you
looked at, anything not done, contract requests.
