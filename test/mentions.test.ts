import { describe, expect, it } from 'vitest';
import { findMentions, watchTerms } from '../src/core/session/mentions.ts';

describe('watchTerms', () => {
  it('uses my name, its first word and the watch words, without duplicates', () => {
    expect(watchTerms('Krunal Baraskar', 'Atlas, krunal , क्रुणाल,, GST')).toEqual([
      'Krunal Baraskar',
      'Krunal',
      'Atlas',
      'क्रुणाल',
      'GST',
    ]);
  });

  it('drops terms too short to be safe', () => {
    expect(watchTerms('Al', 'ok, a, abc')).toEqual(['abc']);
    expect(watchTerms('', '')).toEqual([]);
  });
});

describe('findMentions', () => {
  const terms = watchTerms('Krunal Baraskar', 'Atlas, क्रुणाल, Mehta Hardware');

  it('matches whole words in any case, with a following postposition or possessive', () => {
    expect(findMentions('krunal ji, can you share it?', terms)).toEqual(['Krunal']);
    expect(findMentions("That's Krunal's call", terms)).toEqual(['Krunal']);
    expect(findMentions('Project ATLAS is late', terms)).toEqual(['Atlas']);
  });

  it('does not match inside another word', () => {
    expect(findMentions('the atlases are here', terms)).toEqual([]);
    expect(findMentions('Krunalesh said so', terms)).toEqual([]);
  });

  it('matches names in Indian scripts, combining marks included', () => {
    expect(findMentions('क्रुणाल जी, आप बताइए?', terms)).toEqual(['क्रुणाल']);
    // A vowel sign continuing the word is not a word end.
    expect(findMentions('क्रुणाली', terms)).toEqual([]);
  });

  it('prefers the full name and matches across extra spaces', () => {
    expect(findMentions('Krunal  Baraskar from Mehta   Hardware', terms)).toEqual([
      'Krunal Baraskar',
      'Mehta Hardware',
    ]);
  });
});
