import { describe, expect, it } from 'vitest';
import {
  baseNameFromUrl,
  getPath,
  mimeFromNameOrUrl,
  parseJsonLoose,
  pickRandom,
  stripEmojis,
} from '../src/lib/text.js';

describe('stripEmojis', () => {
  it('removes pictographs but keeps punctuation and accents', () => {
    expect(stripEmojis('Fresh avo 🥑 toast — café ☕')).toBe('Fresh avo  toast — café ');
  });

  it('tolerates non-string input', () => {
    expect(stripEmojis(undefined)).toBe('');
    expect(stripEmojis(42)).toBe('');
  });
});

describe('mimeFromNameOrUrl', () => {
  it('maps known extensions', () => {
    expect(mimeFromNameOrUrl('shop.png')).toBe('image/png');
    expect(mimeFromNameOrUrl('clip.mp4')).toBe('video/mp4');
    expect(mimeFromNameOrUrl('hero.WEBP')).toBe('image/webp');
  });

  it('falls back to image/jpeg, matching the n8n helper', () => {
    expect(mimeFromNameOrUrl('no-extension')).toBe('image/jpeg');
    expect(mimeFromNameOrUrl('https://res.cloudinary.com/x/upload/v1/abc')).toBe('image/jpeg');
  });

  it('ignores a query string after the extension', () => {
    expect(mimeFromNameOrUrl('https://host/a/b.png?width=10')).toBe('image/png');
  });
});

describe('baseNameFromUrl', () => {
  it('takes the last path segment', () => {
    expect(baseNameFromUrl('https://host/a/b/photo.jpg')).toBe('photo.jpg');
  });

  it('falls back to "post" for anything unparseable', () => {
    expect(baseNameFromUrl('not a url')).toBe('post');
    expect(baseNameFromUrl('https://host/')).toBe('post');
  });
});

describe('parseJsonLoose', () => {
  const payload = { caption: 'hi', platform_variations: { instagram: 'ig' } };

  it('parses plain JSON', () => {
    expect(parseJsonLoose(JSON.stringify(payload))).toEqual(payload);
  });

  it('strips ```json fences', () => {
    expect(parseJsonLoose('```json\n' + JSON.stringify(payload) + '\n```')).toEqual(payload);
  });

  it('recovers an object embedded in prose', () => {
    expect(parseJsonLoose(`Sure! Here you go: ${JSON.stringify(payload)} Hope that helps.`)).toEqual(payload);
  });

  it('returns undefined when there is no object at all', () => {
    expect(parseJsonLoose('I cannot help with that.')).toBeUndefined();
  });
});

describe('pickRandom', () => {
  it('returns n items, all drawn from the source', () => {
    const source = Array.from({ length: 50 }, (_, i) => i);
    const picked = pickRandom(source, 30);
    expect(picked).toHaveLength(30);
    expect(new Set(picked).size).toBe(30);
    expect(picked.every((v) => source.includes(v))).toBe(true);
  });

  it('does not mutate the source', () => {
    const source = [1, 2, 3, 4, 5];
    pickRandom(source, 3, () => 0.5);
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });

  it('caps at the source length when n is larger', () => {
    expect(pickRandom([1, 2], 10)).toHaveLength(2);
  });

  it('is deterministic with a seeded random', () => {
    const seeded = () => 0;
    expect(pickRandom([1, 2, 3, 4], 2, seeded)).toEqual(pickRandom([1, 2, 3, 4], 2, seeded));
  });
});

describe('getPath', () => {
  const body = {
    email: 'a@b.com',
    contact: { attributionSource: { campaign: 'spring' } },
    customData: { 'Survey Submitted Date': '2026-01-01' },
    answers: { "What's your role in the business? *": 'Owner' },
    'Trailing key ': 'yes',
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

  it('returns undefined instead of throwing on a missing branch', () => {
    expect(getPath(body, 'contact.lastAttributionSource.utmContent')).toBeUndefined();
    expect(getPath(body, 'email.nested.deeper')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
  });
});
