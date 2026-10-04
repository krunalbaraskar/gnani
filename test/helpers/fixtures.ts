import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', name)));
}
