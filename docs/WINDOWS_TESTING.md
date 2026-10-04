# Testing Bolo on Windows

Everything below was written without access to Windows or real audio hardware. The
pure modules, the STT client, the LLM client and the session logic are covered by
`npm test`. The overlay UI, WAV replay in the renderer and the mic → AudioWorklet path
were also exercised in headless Chromium (`scripts/ui-smoke.mjs`). What has **not**
been run anywhere yet: Electron itself, Windows system-audio loopback, the real Gnani
API, hotkeys, click-through and screen-share protection. These steps cover them.

Commands are for **PowerShell** in the repository folder.

## 0. One-time setup

1. Install Node.js 22 LTS (or newer) and Git.
2. `npm ci`
3. `copy .env.example .env` and fill in `GNANI_API_KEY`, plus the `LLM_*` values (see
   the README). For an installed build, put the same `.env` in `%APPDATA%\Bolo\.env`.
4. Sanity checks — all must pass:
   ```powershell
   npm run lint; npm run typecheck; npm test
   ```

To reset first-run state (consent notice, settings), quit Bolo and delete
`%APPDATA%\Bolo\settings.json` (in dev, Electron may use `%APPDATA%\bolo` instead).

## 1. Offline run against the mock Gnani server (no credits used)

Checks Electron, IPC, the MessagePort audio path and the overlay without touching the
real API.

```powershell
# Terminal 1
npm run mock-gnani
# Terminal 2
$env:GNANI_API_KEY = "test-key"
$env:GNANI_STT_URL = "ws://127.0.0.1:8787/stt/v3/stream"
npm run dev
```

1. The consent notice appears. Click **I understand**. The settings panel opens.
2. Settings → Audio → **Replay WAV files**. Go back (←).
3. **Them: choose WAV** → `test\fixtures\them.wav`; **Me: choose WAV** → `test\fixtures\me.wav`.
4. **▶ Start replay**. Expected:
   - Red **● Listening** badge in the title bar, both level meters moving.
   - Both status pills turn green ("connected"), then show a latency in ms.
   - Within ~6 s, three **Them** lines and two **Me** lines (synthetic Hinglish). The
     mock "transcribes" tones, so the text is scripted.
   - "1 echoed line(s) removed from Me" — `me.wav` contains a quiet copy of their first line.
   - A **Suggested reply (question detected)** card after "premium kitna hoga monthly…".
     It needs a working LLM in `.env`; otherwise it shows the LLM error, which is fine here.
5. After the replay ends, the session stops by itself and asks for an export folder.
   Pick one. Check that `bolo-session-*.md` and `.json` exist and read sensibly.

## 2. Overlay window behaviour

| Check                    | How                                                                                            | Expected                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Always on top            | Open a browser full-screen video (F11)                                                         | Overlay stays above it                                                        |
| Drag                     | Drag the title bar                                                                             | Window moves                                                                  |
| Resize                   | Drag a window edge, and the grip in the bottom-right corner                                    | Window resizes (the grip works even if edges don't — see Troubleshooting)     |
| Show/hide                | `Ctrl+Shift+H` from any app                                                                    | Toggles; focus stays in the other app                                         |
| Click-through            | `Ctrl+Shift+M`                                                                                 | Orange border + banner; clicks reach the app underneath; press again to undo  |
| Hidden from screen share | Share your entire screen in Zoom/Meet/Teams, or record with OBS or Snipping Tool (Win+Shift+R) | Overlay is invisible/black in the shared or recorded image but visible to you |
| Taskbar                  | —                                                                                              | Bolo has a taskbar entry; quitting with × ends the session                    |

## 3. Real Gnani with file replay (uses credits)

Remove the mock variables (`Remove-Item Env:GNANI_STT_URL`), and set your real key in `.env`.

1. Make demo audio with real speech. Either:
   - `npm run demo-audio` — synthesises a short Hinglish insurance call with Gnani's
     own TTS into `demo-audio\me.wav` and `demo-audio\them.wav` (synthetic voices, no
     personal data). Then click **Demo** in the overlay. Or:
   - Record two WAV files yourself (any rate/channels; 16-bit, 24-bit or float).
2. Settings → Speech-to-text → **Hindi**. Start replay with **Play aloud** on.
3. Expected: real transcripts for both sides; latency pills show measured end-of-speech →
   text time (hover a pill for Gnani's reported processing time too).
4. Work through the [Gnani verification checklist](#gnani-verification-checklist) below.

## 4. Live microphone ("Me")

1. Windows Settings → Privacy & security → Microphone: allow desktop apps.
2. Settings → Audio → **Live: mic + system audio**; pick your mic (labels appear after the
   first capture). Start listening.
3. Speak Hindi/Hinglish. The **Me** meter moves and lines appear after each pause.
4. Unplug a USB headset mid-session → a "Microphone stopped" notice appears.

## 5. System audio loopback ("Them")

1. Play a Hindi/Hinglish YouTube video, or join a Zoom/Meet/Teams test call.
2. Start listening. **No screen picker should appear**: the main process answers the
   capture request with the primary screen plus `audio: 'loopback'`, and the renderer
   discards the video track straight away.
3. The **Them** meter moves and lines appear as **Them**.
4. If you get "Could not capture system audio …", note the exact message (see Troubleshooting).
5. Check CPU in Task Manager: Bolo's processes together should stay low (a few %)
   while a call runs.

## 6. Echo without headphones

1. Use laptop speakers, not headphones. Play the other side through the speakers.
2. With **Remove speaker echo** on: their words appear once, as **Them**, and the
   "echoed line(s) removed" counter goes up.
3. Turn it off and repeat: the same words now also show up as **Me**.
4. Speak over them yourself: your own words must still show as **Me**. If real speech
   gets dropped, note the example. The threshold (0.6) and window (5 s) are in
   `src/shared/suggest/echo-dedupe.ts`.

## 7. Suggestions

1. Put a note in Settings → Suggestions → Context, e.g. "I sell term insurance; be concise".
2. While Zoom or another app has focus, press `Ctrl+Shift+Space`. The suggestion streams
   into the card within ~1–2 s with a hosted model.
3. Try each reply language (Same / Hinglish / English).
4. Auto-suggest: have "them" ask "EMI kitni banegi?". A card appears without the hotkey.
   Auto suggestions are rate-limited to one every 8 s.
5. Local model: `ollama pull llama3.2`, set Base URL `http://localhost:11434/v1`, Model
   `llama3.2`, no key. Expect slower first words on CPU; the RTX 4050 helps if Ollama uses it.

## 8. Network drops

1. During a live session, turn Wi-Fi off for ~10 s.
2. Pills go amber: "retry 1s", "retry 2s", "retry 4s" … (exponential backoff, capped at 15 s).
3. Turn Wi-Fi on: pills go green, and transcription continues. About 0.5 s of audio
   is buffered across the gap; the rest of the gap is dropped (hover a pill to see the count).
4. Bad key: put a wrong `GNANI_API_KEY` in `.env`, restart → the pills go red with an
   error, and there are **no** endless retries.

## 9. Silence gate

1. Enable **Silence gate** and start a live session.
2. Stay silent for 30 s, then speak. Lines must still appear and finish normally. The
   gate keeps ~1 s of trailing silence so Gnani's VAD can detect the end of an utterance.
3. If lines never finish, raise the hangover (`DEFAULT_SILENCE_GATE.hangoverFrames` in
   `src/shared/audio/silence-gate.ts`) or lower the threshold slider.

## 10. Installer (M6)

```powershell
npm run dist:win
```

1. Produces `release\Bolo-Setup-0.1.0.exe`. It is unsigned, so SmartScreen warns:
   choose "More info → Run anyway".
2. Install, launch from the Start menu, and confirm `.env` is read from `%APPDATA%\Bolo\.env`.
3. Uninstall from Settings → Apps; it should remove cleanly.

## Gnani verification checklist

Every item is a `TODO(verify-gnani)` in `src/core/stt/gnani-protocol.ts`. Check each one
against https://docs.gnani.ai/api/STT/stt-websocket and a real session:

- [ ] **Endpoint**: `wss://api.vachana.ai/stt/v3/stream` works with your key. If your
      account uses `wss://api.gnani.ai/prisma/v3/stream`, set `GNANI_STT_URL`.
- [ ] **Handshake**: headers only (`x-api-key-id`, `lang_code`, `x-sample-rate`,
      `x-api-request-id`). No JSON config/start message is needed after connecting, and
      the server sends `{"type":"connected"}` first.
- [ ] **Bad key**: is it rejected with HTTP 401/403 on upgrade, or an `error` message?
      Either way Bolo should show a red error and stop retrying.
- [ ] **Partial results**: does the server ever send interim text? Bolo handles
      `type: "partial"/"interim"` or `is_final: false` if it does. The SDK shows finals only.
- [ ] **`latency` field**: is it server processing time in ms? (Shown on hover.)
- [ ] **`segment_index`**: string or number? (Both work.)
- [ ] **Hinglish**: compare `hi-IN` against the experimental `en-hi-in-cm` (in the SDK up
      to v0.7.5, removed in v0.7.8) on the same Hinglish clip. Which script does each
      return for English words (Latin or Devanagari)?
- [ ] **Auto-detect**: does a comma-separated `lang_code` list (the "Auto-detect" option)
      still work?
- [ ] **End of stream**: closing the socket is enough; no flush message is needed to get
      the last transcript. Bolo waits up to 2 s for an in-flight transcript before closing.
- [ ] **Silence/keep-alive**: does the server close idle connections? Bolo pings every 15 s.
- [ ] **TTS demo script**: `npm run demo-audio` uses `/api/v1/tts/inference`, model
      `timbre-v2.5`, voices `Poorvi` and `Roopesh`.

## Troubleshooting

- **No system audio / "Could not capture system audio"**: some audio drivers don't
  support WASAPI loopback. Update the audio driver, check the right output device is the
  default, or try with a different playback device. Mic-only sessions still work.
- **Transparent window looks wrong or won't resize**: some GPU drivers struggle with
  transparent windows. Set `BOLO_OPAQUE_WINDOW=1` in `.env`: the window becomes opaque,
  and the Overlay opacity slider uses window opacity instead.
- **A hotkey does nothing**: another app may own it; Bolo shows a notice at startup if
  registration failed. Change `HOTKEYS` in `src/main/index.ts`.
- **"GNANI_API_KEY is not set"**: `.env` must be in the folder you run `npm run dev`
  from, or in `%APPDATA%\Bolo\` for the installed app. Restart Bolo after editing it.
