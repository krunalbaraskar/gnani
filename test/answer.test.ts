import { describe, expect, it } from 'vitest';
import {
  decideVerdict,
  numbersGrounded,
  numbersIn,
  splitSource,
  visibleWhileStreaming,
  type VerdictInput,
} from '../src/core/suggest/answer.ts';

describe('splitSource', () => {
  it('removes the trailing source line and lists what was cited', () => {
    expect(splitSource('142 units hain.\n[source: inventory.csv, transcript]')).toEqual({
      text: '142 units hain.',
      cited: ['inventory.csv', 'transcript'],
    });
  });

  it('reports no source line as null', () => {
    expect(splitSource('Ji bilkul.')).toEqual({ text: 'Ji bilkul.', cited: null });
  });

  it('hides a source line that is still arriving', () => {
    expect(visibleWhileStreaming('142 units.\n[sour')).toBe('142 units.');
    expect(visibleWhileStreaming('142 units.\nAur kuch')).toBe('142 units.\nAur kuch');
  });
});

describe('number check', () => {
  it('normalises commas, currency, trailing zeros and Indian-script digits', () => {
    expect(numbersIn('₹1,180.50 for 05 tins, १४२ units')).toEqual(['1180.5', '5', '142']);
  });

  it('compares whole numbers, never substrings', () => {
    expect(numbersGrounded('50 tins', ['qty 1500'])).toBe(false);
    expect(numbersGrounded('1500 tins', ['qty 1,500'])).toBe(true);
  });

  it('treats 12.50 and 12.5 as the same number', () => {
    expect(numbersGrounded('₹12.50', ['rate 12.5'])).toBe(true);
  });

  it('matches Devanagari digits in the transcript', () => {
    expect(numbersGrounded('142 units', ['स्टॉक १४२ है'])).toBe(true);
  });

  it('fails a computed total and a number the source only spells out', () => {
    expect(numbersGrounded('Total 9,000', ['20 boxes at 450'])).toBe(false);
    expect(numbersGrounded('7 days', ['seven working days'])).toBe(false);
  });
});

describe('decideVerdict', () => {
  const base: VerdictInput = {
    text: '142 units in stock.',
    cited: ['inventory.csv'],
    sentFiles: ['inventory.csv', 'price-list.md'],
    contextLoaded: true,
    usedScreen: false,
    groundTexts: ['Blue 5L,142'],
  };
  const verdict = (over: Partial<VerdictInput>) => decideVerdict({ ...base, ...over });

  it('files: a sent file is cited and the numbers check out', () => {
    expect(verdict({})).toEqual({ verdict: 'files', sources: ['inventory.csv'] });
  });

  it('matches file names ignoring case and folder prefix', () => {
    expect(verdict({ cited: ['context/Inventory.CSV'] }).sources).toEqual(['inventory.csv']);
  });

  it('unverified: an invented figure, even with a real file cited', () => {
    expect(verdict({ text: '500 units in stock.' }).verdict).toBe('unverified');
  });

  it('unverified: the cited file was never in the prompt', () => {
    expect(verdict({ cited: ['secret.csv'] }).verdict).toBe('unverified');
  });

  it('missing wins over everything else', () => {
    expect(verdict({ cited: ['missing', 'inventory.csv'], usedScreen: true }).verdict).toBe(
      'missing',
    );
  });

  it('screen: number check does not run, cited files are kept', () => {
    expect(verdict({ usedScreen: true, text: 'Total 99,999', cited: ['screen'] })).toEqual({
      verdict: 'screen',
      sources: [],
    });
    expect(verdict({ usedScreen: true }).sources).toEqual(['inventory.csv']);
  });

  it('reply: no context folder, whatever the model cites', () => {
    expect(verdict({ contextLoaded: false, text: 'About 500.' }).verdict).toBe('reply');
  });

  it('reply: source none or absent claims nothing, so no number check', () => {
    expect(verdict({ cited: ['none'], text: 'I will confirm in 10 minutes.' }).verdict).toBe(
      'reply',
    );
    expect(verdict({ cited: null }).verdict).toBe('reply');
  });

  it('call: answered from the transcript or the note', () => {
    expect(verdict({ cited: ['transcript'] })).toEqual({
      verdict: 'call',
      sources: ['transcript'],
    });
  });

  it('accepts a number that appears only in the typed question', () => {
    expect(
      verdict({
        text: 'For 50 tins the rate is 420.',
        groundTexts: ['rate 420 per tin', 'What is the rate for 50 tins?'],
      }).verdict,
    ).toBe('files');
  });
});
