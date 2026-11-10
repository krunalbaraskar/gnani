import { describe, expect, it } from 'vitest';
import { parseDotEnv } from '../src/core/util/dotenv.ts';
import { applyEnvPatch, sanitizeEnvPatch } from '../src/core/util/env-file.ts';

describe('sanitizeEnvPatch', () => {
  it('keeps only editable names and trims values', () => {
    expect(
      sanitizeEnvPatch({ GNANI_API_KEY: '  abc ', PATH: 'x', LLM_MODEL: 7, ECHO_RECORDABLE: '1' }),
    ).toEqual({ patch: { GNANI_API_KEY: 'abc' } });
  });

  it('refuses values that would need quoting or could inject a line', () => {
    for (const bad of ['a b', 'a\nLLM_BASE_URL=http://evil', 'a#b', '"a"', "a'b", 'a\\b'])
      expect(sanitizeEnvPatch({ LLM_API_KEY: bad }).error).toMatch(/not allowed/);
  });

  it('rejects non-objects', () => {
    expect(sanitizeEnvPatch(null).error).toBeTruthy();
    expect(sanitizeEnvPatch('GNANI_API_KEY=x').error).toBeTruthy();
  });
});

describe('applyEnvPatch', () => {
  const file = ['# my keys', 'GNANI_API_KEY=old', 'OTHER=keep', '', 'LLM_MODEL=a', ''].join('\n');

  it('replaces in place, keeps other lines and comments, appends new names', () => {
    const out = applyEnvPatch(file, { GNANI_API_KEY: 'new', LLM_API_KEY: 'k' });
    expect(out).toBe('# my keys\nGNANI_API_KEY=new\nOTHER=keep\n\nLLM_MODEL=a\nLLM_API_KEY=k\n');
    expect(parseDotEnv(out)).toEqual({
      GNANI_API_KEY: 'new',
      OTHER: 'keep',
      LLM_MODEL: 'a',
      LLM_API_KEY: 'k',
    });
  });

  it('removes a name given an empty value', () => {
    expect(parseDotEnv(applyEnvPatch(file, { LLM_MODEL: '' }))).toEqual({
      GNANI_API_KEY: 'old',
      OTHER: 'keep',
    });
  });

  it('drops later duplicates so the new value wins', () => {
    const out = applyEnvPatch('LLM_MODEL=a\nLLM_MODEL=b\n', { LLM_MODEL: 'c' });
    expect(out).toBe('LLM_MODEL=c\n');
  });

  it('starts an empty file', () => {
    expect(applyEnvPatch('', { GNANI_API_KEY: 'x' })).toBe('GNANI_API_KEY=x\n');
    expect(applyEnvPatch('', {})).toBe('');
  });
});
