/**
 * Regenerates the synthetic WAV fixtures in test/fixtures. No real voices: each
 * "utterance" is a tone burst whose pitch identifies its line in test/fixtures/script.ts.
 *   them.wav — 22.05 kHz stereo (exercises downmix + an awkward resample ratio)
 *   me.wav   — 48 kHz mono (the usual Windows mic rate)
 * Run: npm run fixtures
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav16 } from '../src/shared/audio/wav.ts';
import { FIXTURE_SECONDS, ME_TIMELINE, THEM_TIMELINE } from '../test/fixtures/script.ts';

type Burst = { at: number; dur: number; freqHz: number; amp: number };

export function renderTimeline(bursts: Burst[], rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  const fade = Math.round(rate * 0.02);
  for (const b of bursts) {
    const start = Math.round(b.at * rate);
    const len = Math.round(b.dur * rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.min(1, i / fade, (len - i) / fade);
      out[start + i]! += b.amp * env * Math.sin((2 * Math.PI * b.freqHz * i) / rate);
    }
  }
  return out;
}

const dir = join(import.meta.dirname, '..', 'test', 'fixtures');
const them = renderTimeline(THEM_TIMELINE, 22_050, FIXTURE_SECONDS);
// Slightly different channels so the downmix actually does something.
writeFileSync(join(dir, 'them.wav'), encodeWav16([them, them.map((s) => s * 0.9)], 22_050));
writeFileSync(
  join(dir, 'me.wav'),
  encodeWav16([renderTimeline(ME_TIMELINE, 48_000, FIXTURE_SECONDS)], 48_000),
);
console.info('wrote test/fixtures/them.wav and me.wav');
