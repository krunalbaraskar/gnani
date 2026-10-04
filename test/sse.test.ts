import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/core/llm/sse.ts';
import { ThinkFilter } from '../src/core/llm/think-filter.ts';

describe('SseParser', () => {
  it('parses events split at arbitrary points', () => {
    const p = new SseParser();
    const input = 'data: one\n\ndata: two\n\n: comment\n\ndata: thr';
    const out: string[] = [];
    for (const ch of input) out.push(...p.push(ch));
    out.push(...p.push('ee\n\n'));
    expect(out).toEqual(['one', 'two', 'three']);
  });

  it('handles CRLF, CR split across chunks, and multi-line data', () => {
    const p = new SseParser();
    expect(p.push('data: a\r')).toEqual([]);
    expect(p.push('\ndata: b\r\n\r\n')).toEqual(['a\nb']);
    expect(p.push('event: x\nid: 1\ndata:no-space\n\n')).toEqual(['no-space']);
  });

  it('flushes a final event without a trailing blank line', () => {
    const p = new SseParser();
    p.push('data: last');
    expect(p.end()).toEqual(['last']);
  });
});

describe('ThinkFilter', () => {
  it('removes think blocks even when tags are split across chunks', () => {
    const f = new ThinkFilter();
    const chunks = ['<thi', 'nk>reasoning ', 'here</th', 'ink>Ji ', 'haan <', 'b>ok'];
    const out = chunks.map((c) => f.push(c)).join('') + f.end();
    expect(out).toBe('Ji haan <b>ok');
  });

  it('passes ordinary text straight through', () => {
    const f = new ThinkFilter();
    expect(f.push('a < b and c')).toBe('a < b and c');
    expect(f.end()).toBe('');
  });
});
