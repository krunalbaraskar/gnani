import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/shared/version.ts';

describe('scaffold', () => {
  it('has a name', () => {
    expect(APP_NAME).toBe('Bolo');
  });
});
