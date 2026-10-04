/**
 * Generates demo-audio/me.wav and demo-audio/them.wav: a short, fictional Hinglish
 * sales call synthesised with Gnani's TTS. No real people or personal data — the names,
 * company and numbers are made up. Lets you demo and test Bolo with real speech
 * without recording anyone.
 *
 *   npm run demo-audio              # needs GNANI_API_KEY (env or .env)
 *   npm run demo-audio -- --echo    # also leak "them" into the mic track (no headphones)
 *
 * TODO(verify-gnani): the TTS request shape is copied from the gnani-vachana SDK v0.7.9
 * (POST https://api.vachana.ai/api/v1/tts/inference, header X-API-Key-ID, body {text,
 * model, voice, audio_config, language, speed}). Voices: Poorvi (Hinglish), Roopesh (Hindi).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeConversation, type Turn } from '../src/core/demo/compose.ts';
import { downmixToMono, StreamingResampler } from '../src/shared/audio/resampler.ts';
import { encodeWav16, parseWav } from '../src/shared/audio/wav.ts';
import { parseDotEnv } from '../src/core/util/dotenv.ts';

const RATE = 16_000;
const TTS_URL = process.env['GNANI_TTS_URL'] ?? 'https://api.vachana.ai/api/v1/tts/inference';
const VOICES = { them: 'Poorvi', me: 'Roopesh' } as const;

/** them = customer, me = the user (a fictional insurance advisor). */
const SCRIPT: { speaker: 'me' | 'them'; text: string }[] = [
  {
    speaker: 'me',
    text: 'Hello, good afternoon! Main Rohan bol raha hoon, Suraksha Life Insurance se.',
  },
  {
    speaker: 'them',
    text: 'Haan ji, boliye. Maine website pe term insurance ke liye form bhara tha.',
  },
  { speaker: 'me', text: 'Ji bilkul, thank you. Aapko kitne ka cover chahiye tha?' },
  { speaker: 'them', text: 'Around one crore ka socha hai. Premium kitna hoga monthly?' },
  { speaker: 'me', text: 'Aapki age aur health details pe depend karega. Aap smoke karte hain?' },
  { speaker: 'them', text: 'Nahi, main smoke nahi karti. Aur kya isme tax benefit bhi milta hai?' },
  { speaker: 'me', text: 'Haan ji, section eighty C ke under benefit milta hai.' },
  { speaker: 'them', text: 'Theek hai. Claim settlement kitne din mein hota hai?' },
];

function apiKey(): string {
  if (process.env['GNANI_API_KEY']) return process.env['GNANI_API_KEY'];
  const envFile = join(process.cwd(), '.env');
  const key = existsSync(envFile)
    ? parseDotEnv(readFileSync(envFile, 'utf8'))['GNANI_API_KEY']
    : undefined;
  if (!key) throw new Error('Set GNANI_API_KEY in the environment or .env');
  return key;
}

async function synthesize(text: string, voice: string, key: string): Promise<Float32Array> {
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: { 'X-API-Key-ID': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model: 'timbre-v2.5',
      voice,
      language: 'auto',
      speed: 1.0,
      audio_config: {
        sample_rate: RATE,
        encoding: 'linear_pcm',
        num_channels: 1,
        sample_width: 2,
        container: 'wav',
      },
    }),
  });
  if (!res.ok)
    throw new Error(`TTS failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const wav = parseWav(new Uint8Array(await res.arrayBuffer()));
  const mono = downmixToMono(wav.channels);
  if (wav.sampleRate === RATE) return mono;
  const r = new StreamingResampler(wav.sampleRate, RATE);
  const head = r.process(mono);
  const tail = r.flush();
  const out = new Float32Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}

const key = apiKey();
const echo = process.argv.includes('--echo');
const turns: Turn[] = [];
for (const [i, line] of SCRIPT.entries()) {
  console.info(`[${i + 1}/${SCRIPT.length}] ${line.speaker}: ${line.text}`);
  turns.push({
    speaker: line.speaker,
    audio: await synthesize(line.text, VOICES[line.speaker], key),
  });
}
const tracks = composeConversation(turns, {
  sampleRate: RATE,
  gapMs: 900,
  leadMs: 500,
  echoGain: echo ? 0.25 : 0,
  echoDelayMs: 40,
});
const dir = join(process.cwd(), 'demo-audio');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'me.wav'), encodeWav16([tracks.me], RATE));
writeFileSync(join(dir, 'them.wav'), encodeWav16([tracks.them], RATE));
writeFileSync(join(dir, 'script.json'), JSON.stringify(SCRIPT, null, 2));
console.info(
  `Wrote ${join(dir, 'me.wav')} and them.wav (${(tracks.me.length / RATE).toFixed(1)} s). Click "Demo" in Bolo.`,
);
