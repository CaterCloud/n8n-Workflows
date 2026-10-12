import { beforeEach, describe, expect, it } from 'vitest';
import { useTestEnv } from './helpers.js';
import { capture, captureEnabled, clearCaptures, describeShape, recentCaptures } from '../src/lead-tracker/capture.js';

beforeEach(() => {
  clearCaptures();
  useTestEnv();
});

describe('capture', () => {
  const entry = (n: number) => ({ at: `t${n}`, event: 'pee-optin', path: '/webhook/x', body: { n } });

  it('records nothing while disabled', () => {
    expect(captureEnabled()).toBe(false);
    capture(entry(1));
    expect(recentCaptures()).toEqual([]);
  });

  it('records once enabled', () => {
    useTestEnv({ WEBHOOK_CAPTURE: 'true' });
    capture(entry(1));
    expect(recentCaptures()).toHaveLength(1);
  });

  it('keeps only the most recent five', () => {
    useTestEnv({ WEBHOOK_CAPTURE: 'true' });
    for (let i = 1; i <= 8; i++) capture(entry(i));
    const kept = recentCaptures();
    expect(kept).toHaveLength(5);
    expect(kept.map((c) => c.at)).toEqual(['t4', 't5', 't6', 't7', 't8']);
  });

  it('hands back a copy, so callers cannot mutate the buffer', () => {
    useTestEnv({ WEBHOOK_CAPTURE: 'true' });
    capture(entry(1));
    recentCaptures().push(entry(2));
    expect(recentCaptures()).toHaveLength(1);
  });
});

describe('describeShape', () => {
  it('flattens nested objects into dotted paths with values', () => {
    const shape = describeShape({
      email: 'a@b.com',
      contact: { attributionSource: { campaign: 'spring' } },
    });
    expect(shape).toContain('.email : string = "a@b.com"');
    expect(shape).toContain('.contact.attributionSource.campaign : string = "spring"');
  });

  it('quotes keys that a bare dotted path would not survive', () => {
    const shape = describeShape({ customData: { 'Survey Submitted Date': '2026-01-01' } });
    expect(shape).toContain(".customData['Survey Submitted Date'] : string = \"2026-01-01\"");
  });

  it('reports arrays with their length and first element', () => {
    const shape = describeShape({ items: [{ id: 1 }] });
    expect(shape.some((l) => l.includes('.items : array[1]'))).toBe(true);
    expect(shape).toContain('.items[0].id : number = 1');
  });

  it('truncates long strings so one field cannot swamp the output', () => {
    const shape = describeShape({ note: 'x'.repeat(200) });
    expect(shape[0]!.length).toBeLessThan(90);
    expect(shape[0]).toContain('…');
  });

  it('handles null and primitives without throwing', () => {
    expect(describeShape({ a: null, b: 0, c: false })).toEqual([
      '.a : null = null',
      '.b : number = 0',
      '.c : boolean = false',
    ]);
  });

  it('stops recursing on deeply nested input', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 30; i++) deep = { nest: deep };
    expect(() => describeShape(deep)).not.toThrow();
  });
});
