import { describe, expect, it } from 'vitest';
import { mergeEnv, parseDotEnv } from '../src/core/util/dotenv.ts';

describe('parseDotEnv', () => {
  it('parses keys, quotes, comments and export prefixes', () => {
    expect(
      parseDotEnv(
        [
          '# comment',
          'GNANI_API_KEY=abc123',
          'export LLM_MODEL="gpt-4o-mini"',
          "LLM_BASE_URL='http://localhost:11434/v1'",
          'EMPTY=',
          'WITH_COMMENT=value # trailing',
          'HASH_IN_QUOTES="a#b"',
          'not a line',
          '  SPACED = x ',
        ].join('\r\n'),
      ),
    ).toEqual({
      GNANI_API_KEY: 'abc123',
      LLM_MODEL: 'gpt-4o-mini',
      LLM_BASE_URL: 'http://localhost:11434/v1',
      EMPTY: '',
      WITH_COMMENT: 'value',
      HASH_IN_QUOTES: 'a#b',
      SPACED: 'x',
    });
  });
});

describe('mergeEnv', () => {
  it('prefers process env, then earlier files', () => {
    expect(
      mergeEnv({ A: 'env', B: '' }, { A: 'f1', B: 'f1', C: 'f1' }, { C: 'f2', D: 'f2' }),
    ).toEqual({
      A: 'env',
      B: 'f1',
      C: 'f1',
      D: 'f2',
    });
  });
});
