/**
 * End to end, minus Electron: WAV fixture → FileAudioSource (decode, downmix, resample,
 * PCM16, 1024-byte frames, real-time pacing at 8×) → GnaniSttProvider → mock Gnani server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GnaniSttProvider } from '../src/core/stt/gnani-provider.ts';
import type { SttTranscript } from '../src/core/stt/types.ts';
import { FileAudioSource } from '../src/shared/audio/file-audio-source.ts';
import { ME_LINES, SCRIPT, THEM_LINES } from './fixtures/script.ts';
import { MockGnaniServer } from './mock/mock-gnani-server.ts';
import { readFixture } from './helpers/fixtures.ts';
import { waitFor } from './helpers/wait.ts';

let server: MockGnaniServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function replay(file: string, speaker: 'me' | 'them', url: string): Promise<SttTranscript[]> {
  const out: SttTranscript[] = [];
  let connected = false;
  const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
    speaker,
    { language: 'hi-IN' },
    { onTranscript: (t) => out.push(t), onStatus: (s) => (connected ||= s.state === 'connected') },
  );
  await waitFor(() => connected, 3000, 'connected');
  await new Promise<void>((resolve) => {
    FileAudioSource.fromWav(readFixture(file), {
      onFrame: (f) => stream.send(f),
      onEnd: resolve,
      speed: 8,
    }).start();
  });
  await stream.close();
  return out;
}

describe('WAV replay through the full STT pipeline', () => {
  it('transcribes both sides of the fixture conversation', async () => {
    server = new MockGnaniServer({ script: SCRIPT });
    const url = await server.start();
    const [them, me] = await Promise.all([
      replay('them.wav', 'them', url),
      replay('me.wav', 'me', url),
    ]);

    expect(them.map((t) => t.text)).toEqual([
      THEM_LINES.greeting.text,
      THEM_LINES.question.text,
      THEM_LINES.closing.text,
    ]);
    // The first "me" utterance is the speaker echo of their greeting; dedupe happens later.
    expect(me.map((t) => t.text)).toEqual([
      THEM_LINES.greeting.text,
      ME_LINES.intro.text,
      ME_LINES.answer.text,
    ]);

    for (const c of server.connections) expect(c.badFrames).toBe(0);
    expect(them.every((t) => t.speaker === 'them' && t.final)).toBe(true);
  });
});
