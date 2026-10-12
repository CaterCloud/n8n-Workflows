import { describe, expect, it } from 'vitest';
import { getPath } from '../src/lib/text.js';

describe('getPath', () => {
  const body = {
    email: 'a@b.com',
    contact: { attributionSource: { campaign: 'spring' } },
    customData: { 'Survey Submitted Date': '2026-01-01' },
    answers: { "What's your role in the business? *": 'Owner' },
    'Trailing key ': 'yes',
    falsy: { zero: 0, empty: '', no: false },
  };

  it('reads dotted paths', () => {
    expect(getPath(body, 'contact.attributionSource.campaign')).toBe('spring');
  });

  it('reads bracketed keys containing spaces', () => {
    expect(getPath(body, "customData['Survey Submitted Date']")).toBe('2026-01-01');
  });

  it('reads keys containing apostrophes and asterisks', () => {
    expect(getPath(body, "answers[\"What's your role in the business? *\"]")).toBe('Owner');
  });

  it('reads a top-level bracketed key with a trailing space', () => {
    expect(getPath(body, "['Trailing key ']")).toBe('yes');
  });

  it('distinguishes falsy values from missing ones', () => {
    expect(getPath(body, 'falsy.zero')).toBe(0);
    expect(getPath(body, 'falsy.empty')).toBe('');
    expect(getPath(body, 'falsy.no')).toBe(false);
    expect(getPath(body, 'falsy.absent')).toBeUndefined();
  });

  it('returns undefined instead of throwing on a missing branch', () => {
    expect(getPath(body, 'contact.lastAttributionSource.utmContent')).toBeUndefined();
    expect(getPath(body, 'email.nested.deeper')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
});
