# Echo — solution pitch

**The meeting buddy that knows your work.** Powered by Gnani speech-to-text.
Demo video: [youtube.com/shorts/KDxG8_bf3q0](https://youtube.com/shorts/KDxG8_bf3q0) ·
Download: [Releases](https://github.com/krunalbaraskar/gnani/releases/latest)

## Problem

A dealer calls and asks, in Hinglish, how much stock you have and what the bulk rate is.
The answer is in a spreadsheet, but you're mid-call and maybe sharing your screen. You say
"I'll call you back", and the deal cools off. Afterwards, nobody wrote down what was
promised. Meeting assistants today are built for English Zoom calls in big companies, not
for the Hindi, Tamil or Hinglish calls most Indian businesses run on.

## Solution

Echo is a Windows app that sits as a slim bar on top of any call (Zoom, Meet, Teams,
WhatsApp desktop).

- **Live transcript of both sides** in 10 Indian languages, via Gnani streaming STT.
- **Answers from your own files** about a second after the question, with the file it
  came from. Every number is checked against your files; if the fact isn't there, Echo
  says "not in your files" instead of guessing.
- **Plain-English meaning** under mixed-language lines, **alerts** when your name or a
  client is mentioned, and a **catch-up** hotkey for the last 10 minutes.
- **Hidden from screen share.**
- **After the call:** minutes with decisions and owned action items, a searchable meeting
  library, and "ask your meetings".

## Where Gnani is used

- **Gnani streaming speech-to-text is Echo's ears.** Two live WebSockets, one for your
  mic ("Me") and one for the call audio ("Them"), so every line is labelled without a
  speaker model. Audio goes in as 16 kHz PCM in 32 ms frames, in real time.
- **Everything else is built on that transcript:** answers, meanings, alerts and minutes.
  An AI model of your choice (Gemini, or any OpenAI-compatible one) does the reasoning.
- **Gnani TTS** voiced the demo call and the narration of the video.

## Who it's for

Sales reps, dealers and distributors, brokers, and small business owners who do business
on the phone in Indian languages.

## Built with

Electron, React and TypeScript; Gnani Vachana STT and TTS; any OpenAI-compatible AI model.
343 unit tests, plus end-to-end tests against the real Gnani service. Keys, files and
meetings stay on the user's computer.

## Try it in 5 minutes

Install `Echo-Setup-0.1.0.exe`, paste your Gnani key and a free Gemini key when Echo asks,
click **Use the sample files**, then **Settings → Audio → Replay WAV files → Demo → Start**.
Full steps: [README](README.md#try-it-for-judges--about-5-minutes).
