import { describe, expect, it } from 'vitest';
import {
  CONTEXT_LIMITS,
  decodeText,
  formatChunks,
  loadContext,
  selectChunks,
  splitRows,
  wantsBytes,
  type Chunk,
  type RawFile,
} from '../src/core/context/context.ts';

const enc = new TextEncoder();
const file = (name: string, text: string): RawFile => {
  const bytes = enc.encode(text);
  return { name, size: bytes.length, bytes };
};

describe('decodeText', () => {
  it('strips a UTF-8 byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('item,qty')]);
    expect(decodeText(bytes)).toBe('item,qty');
  });

  it('decodes UTF-16 with a byte-order mark (Excel "Unicode text")', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    expect(decodeText(le)).toBe('hi');
  });

  it('refuses bytes that are not UTF-8 instead of returning garbled text', () => {
    // "₹" in Windows-1252 is not representable; 0xA3 alone is invalid UTF-8.
    expect(decodeText(new Uint8Array([0x52, 0x73, 0xa3, 0x35]))).toBeNull();
  });
});

describe('loadContext', () => {
  it('loads supported files in name order and reports why others were skipped', () => {
    const ctx = loadContext([
      file('price-list.md', '# Prices\n\nBlue 5L: 1180'),
      file('inventory.csv', 'item,qty\nBlue 5L,142\nRed 1L,9'),
      { name: 'brochure.pdf', size: 5000 },
      { name: 'huge.csv', size: CONTEXT_LIMITS.fileBytes + 1 },
      { name: 'legacy.csv', size: 4, bytes: new Uint8Array([0x52, 0x73, 0xa3, 0x35]) },
    ]);
    expect(ctx.files.map((f) => f.name)).toEqual(['inventory.csv', 'price-list.md']);
    expect(ctx.files[0]!.info).toBe('2 rows');
    expect(Object.fromEntries(ctx.skipped.map((s) => [s.name, s.reason]))).toEqual({
      'brochure.pdf': 'PDF not supported',
      'huge.csv': 'too large (over 1 MB)',
      'legacy.csv': 'not UTF-8: save as CSV UTF-8',
    });
  });

  it('stops at the file-count limit with the right reason', () => {
    const many = Array.from({ length: CONTEXT_LIMITS.files + 1 }, (_, i) =>
      file(`n${String(i).padStart(3, '0')}.txt`, 'x'),
    );
    const ctx = loadContext(many);
    expect(ctx.files).toHaveLength(CONTEXT_LIMITS.files);
    expect(ctx.skipped).toEqual([{ name: 'n050.txt', reason: 'over the 50-file limit' }]);
  });

  it('only wants bytes for small files of a supported type', () => {
    expect(wantsBytes('a.CSV', 10)).toBe(true);
    expect(wantsBytes('a.pdf', 10)).toBe(false);
    expect(wantsBytes('a.csv', CONTEXT_LIMITS.fileBytes + 1)).toBe(false);
  });
});

describe('chunking', () => {
  it('keeps a quoted cell with a line break in one row', () => {
    expect(splitRows('item,note\n"Blue 5L","fast\nmover"\nRed,ok')).toEqual([
      'item,note',
      '"Blue 5L","fast\nmover"',
      'Red,ok',
    ]);
  });

  it('prefixes every CSV chunk with the header and caps rows per chunk', () => {
    const rows = Array.from({ length: 45 }, (_, i) => `item${i},${i}`).join('\n');
    const { chunks } = loadContext([file('stock.csv', `item,qty\n${rows}`)]);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.text.startsWith('item,qty\n'))).toBe(true);
    expect(chunks[2]!.text.split('\n')).toHaveLength(6); // header + last 5 rows
  });

  it('splits text on blank lines and hard-splits an oversized block', () => {
    const big = 'x'.repeat(2000); // one line, no breaks (like minified JSON)
    const { chunks } = loadContext([file('notes.md', `Para one.\n\nPara two.\n\n${big}`)]);
    expect(chunks.map((c) => c.text.length)).toEqual([9, 9, 800, 800, 400]);
  });
});

describe('selectChunks', () => {
  const chunks: Chunk[] = [
    { file: 'inv.csv', text: 'item,qty,the\nBlue 5 litre,142,the' },
    { file: 'inv.csv', text: 'item,qty,the\nRed 1 litre,9,the' },
    { file: 'notes.md', text: 'Delivery in 7 working days, the usual' },
    { file: 'notes.md', text: 'the the the filler' },
  ];

  it('sends everything when it fits the budget', () => {
    expect(selectChunks(chunks, 'anything', 10_000)).toEqual(chunks);
  });

  it('picks the matching chunk when over budget', () => {
    expect(selectChunks(chunks, 'blue wala kitna stock hai', 60).map((c) => c.text)).toEqual([
      chunks[0]!.text,
    ]);
  });

  it('skips a chunk that does not fit and still takes a smaller match', () => {
    const picked = selectChunks(chunks, 'delivery blue', 50);
    expect(picked).toEqual([chunks[0]]); // notes chunk (54 with overhead) does not fit, blue (47) does
  });

  it('returns nothing for a query made only of common or unknown words', () => {
    expect(selectChunks(chunks, 'the kitna hai', 60)).toEqual([]);
  });

  it('groups chunks under their file name for the prompt', () => {
    expect(formatChunks([chunks[0]!, chunks[2]!])).toBe(
      '--- inv.csv ---\nitem,qty,the\nBlue 5 litre,142,the\n\n--- notes.md ---\nDelivery in 7 working days, the usual',
    );
  });
});
