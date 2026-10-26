import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings.ts';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops invalid ones individually', () => {
    const s = sanitizeSettings({
      outputLanguage: 'hinglish',
      transcriptMinutes: 5,
      mode: 'silent',
      overlayOpacity: 7, // out of range
      llmBaseUrl: 'file:///etc/passwd', // not http(s)
      sttLanguage: 'ta-IN',
      unknownField: 1,
    });
    expect(s.outputLanguage).toBe('hinglish');
    expect(s.transcriptMinutes).toBe(5);
    expect(s.mode).toBe('silent');
    expect(s.overlayOpacity).toBe(DEFAULT_SETTINGS.overlayOpacity);
    expect(s.llmBaseUrl).toBe('');
    expect(s.sttLanguage).toBe('ta-IN');
    expect(s).not.toHaveProperty('unknownField');
  });

  it('resets language codes Gnani refuses', () => {
    expect(sanitizeSettings({ sttLanguage: 'indic-auto' }).sttLanguage).toBe('indic-auto');
    expect(sanitizeSettings({ sttLanguage: 'en-hi-in-cm' }).sttLanguage).toBe('hi-IN');
    expect(sanitizeSettings({ sttLanguage: 'hi-IN,en-IN' }).sttLanguage).toBe('hi-IN');
  });

  it('merges over a base so partial updates keep other fields', () => {
    const base = { ...DEFAULT_SETTINGS, contextNote: 'keep me' };
    expect(sanitizeSettings({ mode: 'assist' }, base).contextNote).toBe('keep me');
  });
});
