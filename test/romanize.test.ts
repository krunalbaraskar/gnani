import { describe, expect, it } from 'vitest';
import { hasIndicScript, romanize } from '../src/core/gloss/romanize.ts';
import type { LlmProvider } from '../src/core/llm/types.ts';

const replying = (...tokens: string[]): LlmProvider => ({
  name: 'fake',
  async *streamChat() {
    for (const t of tokens) yield t;
  },
});

describe('Hinglish in English letters', () => {
  it('rewrites Indian-script lines', async () => {
    const llm = replying('kal tak ', 'delivery ho jayegi kya?');
    expect(await romanize(llm, 'कल तक डिलीवरी हो जाएगी क्या?')).toBe(
      'kal tak delivery ho jayegi kya?',
    );
  });

  it('leaves Roman lines alone without asking the model', async () => {
    const llm: LlmProvider = {
      name: 'never',
      streamChat() {
        throw new Error('should not be called');
      },
    };
    expect(await romanize(llm, 'Kal tak delivery ho jayegi?')).toBe('Kal tak delivery ho jayegi?');
    expect(hasIndicScript('₹1,200 monthly')).toBe(false);
    expect(hasIndicScript('ठीक है')).toBe(true);
  });

  it('keeps the original when the model fails, stalls or replies in Hindi script', async () => {
    const failing: LlmProvider = {
      name: 'failing',
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error('429');
      },
    };
    expect(await romanize(failing, 'ठीक है')).toBe('ठीक है');
    expect(await romanize(replying('ठीक है'), 'ठीक है')).toBe('ठीक है');
    const stalling: LlmProvider = {
      name: 'stalling',
      async *streamChat({ signal }) {
        await new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
        yield 'never';
      },
    };
    expect(await romanize(stalling, 'ठीक है', 20)).toBe('ठीक है');
  });
});
