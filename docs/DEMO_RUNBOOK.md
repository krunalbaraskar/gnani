# Demo runbook

Everything below was checked on this machine against the real Gnani endpoint and the real
suggestion model on 2026-11-09 (`npm run demo-rehearsal`, 24 checks). Numbers are measured,
not estimated.

The demo call is **~40 seconds** of audio. That is the whole window for anything you want
to trigger by hand, so decide beforehand which two things you will do live and let the rest
play. Everything after the call — library, minutes, search, export — has no clock on it.

## Before you start (5 minutes)

```powershell
npm run build            # the rehearsal and the demo both run the built app
npm run demo-rehearsal   # proves the real services are up and your key still has credit
```

The rehearsal asks a screen question, which captures **your real desktop** and sends it to
the model, and writes what the model saw into `test-results/demo-rehearsal/REHEARSAL.md`.
Close anything private before you run it. (That folder is gitignored, so it is never
committed, but it is still on your disk.)

If the rehearsal prints `Every check passed`, the demo path works. If it fails, read
`test-results/demo-rehearsal/REHEARSAL.md` — it has the transcript, every answer and the
minutes from that run, so you can see which stage broke before you are on stage.

Check these:

- [ ] `.env` has `LLM_REASONING_EFFORT=low`. Without it the Roman rewrite of a Devanagari
      line takes ~1.4 s instead of ~0.84 s and can miss its 4 s deadline, which leaves one
      line in Devanagari next to Roman ones. It looks broken; it is only slow.
      Do **not** set `none` — Gemini 3.5 Flash Lite refuses it with HTTP 400.
- [ ] Nothing else is holding the microphone (close Zoom, Teams, Meet).
- [ ] Wi-Fi is working. Both Gnani and the model are network calls; there is no offline mode
      with real keys.
- [ ] Have `demo-context/` chosen as the context folder and both demo WAVs selected
      (Settings → Audio → Replay WAV files) **before** the audience is watching.

## The run

1. **Open with the problem, not the app.** "A dealer calls and asks for a stock figure and a
   bulk rate. The answer is in my files. I cannot read a spreadsheet while talking to him."
2. **Press Start.** Point out the bar is at the top of the screen and is excluded from the
   screen share.
3. **Let their first line land.** `Mehta Hardware` is a watch word, so an alert fires with
   no AI involved. Under their line you get the plain meaning in English.
4. **Their stock question answers itself** (Active mode). Measured first token: 772 ms–1.5 s.
   When the card cites `inventory.csv` and `price-list.md`, click the chips — that is the
   whole point: the figure came from your own files, not the model's imagination.

   The figure itself was right in every run, but the **citation is not guaranteed**: the
   chips only appear when the model emits its `[source: ...]` markers, and across five real
   runs the same answer came back twice with both files cited and once with none (labelled
   "check this figure" instead). So say "it tells me where the number came from", not "it
   always shows two files" — and if the chips are missing, the typed question in step 5 is
   the reliable place to show grounding, because `delivery kitne din mein hoti hai?` cited
   `project-notes.md` on every run.

5. **Type one question** while the call runs. Use one the files can answer (see below).
6. **Catch me up.** Measured first token: 952 ms. It starts with what they asked you.
7. **Let the call end.** The meeting saves itself and the minutes start writing.
8. **Open the library.** The minutes are already there: summary, key points, decisions,
   action items with owners, open questions, next steps. Edit one line to show they are
   yours, then show copy / PDF / Markdown.
9. **Ask your meetings** — "what did they want on whatsapp?" — answered from the saved
   meeting with a link back to it.

## Questions that work, and why

These are answerable from `demo-context/`, so the answer arrives grounded and cited:

| Ask this                                | Answer comes from  | The fact                              |
| --------------------------------------- | ------------------ | ------------------------------------- |
| `delivery kitne din mein hoti hai?`     | `project-notes.md` | Within 7 working days of confirmation |
| `Waterproof Coat ka thok rate kya hai?` | `price-list.md`    | 5,640 per 20 litre unit (50+)         |
| `Cream interior emulsion stock hai?`    | `inventory.csv`    | 0 units — and it is an open item      |

The Cream one is the best single question you can ask: the honest answer is "none in
stock", and it proves the app reports a zero instead of inventing a number.

One question to show the refusal: **`what is their GST number?`** → "not in your files".
Say out loud that this is the behaviour that matters in a sales call.

**Do not** ask something the files do not cover, such as "what rate did we give them last
time?". There is no such record in `demo-context/`, so the model politely dodges
("main check karke batata hoon") and it reads as a failure when it is actually correct
caution.

## Screen reading

It works, but it answers about **what is on the screen**. In the rehearsal the only thing
visible was Echo's own overlay, so the honest answer was "No question or task found on the
screen." If you want to demo it, have a document, spreadsheet or error message open first,
then press the hotkey. Otherwise skip it — it is the weakest 20 seconds you could spend.

## If something breaks

- **One side of the call produces no lines at all.** Seen once in five real runs: the
  "them" stream delivered nothing while "me" transcribed normally, so there was no alert,
  no meaning and no unprompted answer — the whole demo, gone, with no error on screen. Echo
  opens one socket per speaker and a stream that is refused or reconnects loses its audio
  quietly. **This is why you rehearse immediately before presenting**: the rehearsal prints
  each speaker's connection history and fails if either stream errored or reconnected. If
  it happens, stop and run it again before going on — it passed on the retry. If it keeps
  happening, your key is probably being throttled for two concurrent streams; fall back to
  the mock servers below.
- **A stage is slow or silent.** Keep talking and move on; the transcript keeps running.
  Every answer in the rehearsal started inside 2 s, but a network is a network.
- **A line stays in Devanagari.** That is the rewrite missing its deadline, nothing worse.
  The alert and the answers do not depend on it.
- **The keys fail, or the venue Wi-Fi dies.** There is a full offline path: `npm run
mock-gnani` and `npm run mock-llm` in two terminals, then point `GNANI_STT_URL` and
  `LLM_BASE_URL` at them (see "Try it with no keys" in the README). The script is written to
  match the demo call, so the demo still runs end to end with no network at all. Have these
  two terminals open before you present.
- **Last resort.** `test-results/demo-rehearsal/` holds screenshots and the real minutes
  from a passing run. Show those and say it is a recording.

## What not to claim

- The overlay is verified hidden from a screen capture, but **not yet inside a real
  Zoom/Meet/Teams share**. Say "excluded from screen capture", not "I have tested it in
  Zoom".
- `indic-auto` auto-detect is accepted by Gnani but its accuracy is untested. Demo in
  `hi-IN`.
- The calendar has been tested with an `.ics` file, not with a live Google or Outlook link.
