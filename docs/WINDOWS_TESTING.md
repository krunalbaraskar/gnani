# Testing Bolo on Windows

What has been run on Windows 11 (build 26100), and what still needs a person.

| Check                                                    | How it was run                    | Result                                            |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| Lint, typecheck, 222 unit tests                          | `npm run lint; typecheck; test`   | Pass                                              |
| Whole app against mock Gnani and mock AI (28 checks)     | `npm run test:e2e`                | Pass                                              |
| Live mic + system-audio loopback into mock Gnani         | `npm run test:live`               | Pass: both streams deliver audio                  |
| Overlay absent from a screen capture, transparent window | GDI screen capture, protection on | Absent                                            |
| Overlay absent from a screen capture, opaque window      | same, `BOLO_OPAQUE_WINDOW=1`      | Absent                                            |
| Overlay present with `BOLO_RECORDABLE=1`                 | same, both window modes           | Present, as intended                              |
| Real Gnani API                                           | —                                 | **Not run yet** (needs your key)                  |
| Real AI model, and a real vision model for the screen    | —                                 | **Not run yet** (needs your key)                  |
| Overlay hidden inside a real Zoom/Meet/Teams share       | —                                 | **Not run yet** (needs a second person or device) |
| Global hotkeys from another app, click-through, drag     | —                                 | **Not run yet** (needs hands)                     |
| Installer                                                | —                                 | **Not run yet**                                   |

Commands are for **PowerShell** in the repository folder.

## 0. One-time setup

1. Install Node.js 22 LTS (or newer) and Git.
2. `npm ci`. If Electron later reports it failed to install, run
   `node node_modules/electron/install.js` once (your npm skips install scripts).
3. `copy .env.example .env` and fill in `GNANI_API_KEY`, plus the `LLM_*` values (see
   the README). For an installed build, put the same `.env` in `%APPDATA%\Bolo\.env`.
4. Sanity checks — all must pass:
   ```powershell
   npm run lint; npm run typecheck; npm test
   ```
5. The automated app checks:
   ```powershell
   npm run build; npm i --no-save playwright
   npm run test:e2e; npm run test:live
   ```

To reset first-run state (consent notice, settings), quit Bolo and delete
`%APPDATA%\Bolo\settings.json`.

## 1. Offline run with no keys

Follow [Try it with no keys](../README.md#try-it-with-no-keys) in the README. Expected:

- A slim bar at the top-centre of the screen. The window is only as tall as the bar until
  you expand it.
- After **Start**: a call timer, two green dots (Them, Me), and the Live tab.
- "They said" shows the dealer's question with its meaning in English underneath.
- **Answer · from your files** with the chips `inventory.csv` and `price-list.md`.
- Typing `what did we promise on delivery?` gives an answer from `project-notes.md`.
- Typing `what is their GST number?` gives the dashed **Answer · not in your files** card.
- The Transcript tab shows three Them lines and two Me lines; `me.wav` contains a quiet
  copy of their first line, which is removed as echo.
- When the replay ends, the session stops by itself and asks for an export folder. The
  Markdown file names the sources of each answer.

## 2. Overlay window behaviour

| Check                    | How                                                              | Expected                                                                                    |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Always on top            | Open a browser full-screen video (F11)                           | Bar stays above it                                                                          |
| Drag                     | Drag the bar by an empty part of it                              | Window moves                                                                                |
| Height follows content   | Expand and collapse; switch tabs                                 | No dead area under the panel that blocks clicks on the app below                            |
| Show/hide                | `Ctrl+Shift+H` from any app                                      | Toggles; focus stays in the other app                                                       |
| Click-through            | `Ctrl+Shift+M`                                                   | Amber border and a strip; clicks reach the app underneath; press again to undo              |
| Hidden from screen share | Share your entire screen in Zoom/Meet/Teams with a second device | Bar is absent on the viewer's screen but visible to you                                     |
| Shield                   | Hover the shield in the bar                                      | Green "Hidden from screen share" on Windows 11 build 26100 or newer; amber otherwise        |
| Demo mode                | `BOLO_RECORDABLE=1`                                              | Amber shield reads "Visible in recordings (demo mode)"; Bolo shows up in a screen recording |

If the bar **is** visible to the viewer in a real share, remove the entry from
`SHARE_PROTECTION_VERIFIED` in `src/main/index.ts` so the shield stops claiming it, and
note the app and Windows build.

## 3. Real Gnani with file replay (uses credits)

Remove the mock variables (`Remove-Item Env:GNANI_STT_URL`), and set your real key in `.env`.

1. `npm run demo-audio` synthesises the Hinglish dealer call with Gnani's own TTS into
   `demo-audio\me.wav` and `demo-audio\them.wav` (synthetic voices, no personal data).
2. In Bolo: Context → choose `demo-context`. Settings → Audio → Replay WAV files → **Demo**.
   Settings → Speech-to-text → **Hindi**. Start, with **Play aloud** on and speed 1×.
3. Expected: real transcripts for both sides; hover a dot for the measured latency; an
   answer for each of the three questions (stock, bulk rate, delivery), each from the
   right file. Two questions close together are answered one after the other.
4. Note which script English product names come back in ("blue", "exterior emulsion").
5. Work through the [Gnani verification checklist](#gnani-verification-checklist) below.

## 4. Your own files

The honest test. Take one real file you would need on a call, remove anything private,
put it in a folder, and choose that folder in Context. Ask five questions a client really
asked you. Note every answer that is wrong, labelled "check this figure" when it was
right, or "not in your files" when the fact was there.

## 5. Live microphone and system audio

1. Windows Settings → Privacy & security → Microphone: allow desktop apps.
2. Settings → Audio → **Live: mic + system audio**; pick your mic. Start.
3. Speak Hindi/Hinglish: lines appear as **Me** after each pause.
4. Play a Hindi/Hinglish video or join a test call: lines appear as **Them**. No screen
   picker should appear.
5. Unplug a USB headset mid-session → a "Microphone stopped" notice appears.
6. Without headphones, with **Remove speaker echo** on: their words appear once, as Them.

## 6. Screen reading

1. Settings → AI model → **Vision model**: a model that accepts images on your LLM
   endpoint (for example `gpt-4o-mini`).
2. During a call, put a question on screen (an email, a chat message) and press
   `Ctrl+Alt+Space`. Expected: **Answer · from your screen**, with "read by the AI model,
   not checked".
3. The overlay flickers out for a moment during the capture and comes back.
4. With the Vision model field empty, the hotkey shows "Set a vision model in Settings to
   use the screen" and sends nothing.

## 7. Network drops

1. During a live session, turn Wi-Fi off for ~10 s. The dots go amber (hover: "retry in
   1s", "2s", "4s" …, capped at 15 s).
2. Turn Wi-Fi on: dots go green, and transcription continues.
3. Bad key: put a wrong `GNANI_API_KEY` in `.env`, restart → the dots go red with an
   error on hover, and there are **no** endless retries.

## 8. Installer

```powershell
npm run dist:win
```

1. Produces `release\Bolo-Setup-0.1.0.exe`. It is unsigned, so SmartScreen warns:
   choose "More info → Run anyway".
2. Install, launch from the Start menu, and confirm `.env` is read from `%APPDATA%\Bolo\.env`.
3. Uninstall from Settings → Apps; it should remove cleanly.

## Gnani verification checklist

Checked with a real key on 2026-10-23 (results in the README,
[Checked against the real API](../README.md#checked-against-the-real-api)). Re-check if
Gnani changes the API:

- [x] **Endpoint**: `wss://api.vachana.ai/stt/v3/stream` works.
- [x] **Handshake**: headers only; the server sends `{"type":"connected"}` first.
- [x] **Bad key**: HTTP 401 on upgrade; red error, no retries.
- [x] **Partial results**: none (`partials_enabled: false`).
- [ ] **`latency` field**: a number in ms, but is it server processing time? (Shown on hover.)
- [x] **`segment_index`**: a number.
- [x] **Hinglish**: `en-hi-in-cm` is refused; `hi-IN` writes English words in Devanagari.
- [x] **Auto-detect**: comma lists are refused; `indic-auto` is accepted.
- [ ] **Auto-detect accuracy**: speak two languages with `indic-auto` and compare with the
      single-language setting.
- [x] **End of stream**: closing loses an unfinished sentence; Bolo now sends silence first.
- [x] **Silence/keep-alive**: the server closes after 60 s without speech, pings or not.
- [x] **TTS demo script**: `npm run demo-audio` works.

## Troubleshooting

- **The app exits at once when started from a script or an editor terminal**: the
  environment has `ELECTRON_RUN_AS_NODE=1` (editors built on Electron set it). Clear it:
  `Remove-Item Env:ELECTRON_RUN_AS_NODE`.
- **No system audio / "Could not capture system audio"**: some audio drivers don't
  support WASAPI loopback. Update the driver, check the default output device, or try
  another playback device. Mic-only sessions still work.
- **Transparent window looks wrong**: set `BOLO_OPAQUE_WINDOW=1` in `.env`.
- **A hotkey does nothing**: another app may own it; Bolo shows a notice at startup if
  registration failed. Change `HOTKEYS` in `src/main/index.ts`.
- **A CSV is listed as "not UTF-8"**: in Excel use Save As → **CSV UTF-8**.
- **"GNANI_API_KEY is not set"**: `.env` must be in the folder you run `npm run dev`
  from, or in `%APPDATA%\Bolo\` for the installed app. Restart Bolo after editing it.
