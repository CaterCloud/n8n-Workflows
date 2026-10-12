import { describe, expect, it } from 'vitest';
import { formatAuDateTime, nextDailySlots, partsInZone, zonedTimeToUtc } from '../src/lib/dates.js';

const SYD = 'Australia/Sydney';

describe('zonedTimeToUtc', () => {
  it('resolves 10:00 Sydney during AEDT (UTC+11) to 23:00 UTC the day before', () => {
    expect(zonedTimeToUtc(2026, 1, 15, 10, 0, SYD).toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('resolves 10:00 Sydney during AEST (UTC+10) to 00:00 UTC the same day', () => {
    expect(zonedTimeToUtc(2026, 7, 15, 10, 0, SYD).toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('handles the DST changeover week on both sides', () => {
    // AEDT ends 05 Apr 2026; 10:00 on the 4th is +11, on the 5th is +10.
    expect(zonedTimeToUtc(2026, 4, 4, 10, 0, SYD).toISOString()).toBe('2026-04-03T23:00:00.000Z');
    expect(zonedTimeToUtc(2026, 4, 6, 10, 0, SYD).toISOString()).toBe('2026-04-06T00:00:00.000Z');
  });

  it('round-trips through partsInZone', () => {
    const instant = zonedTimeToUtc(2026, 10, 12, 14, 30, SYD);
    const parts = partsInZone(instant, SYD);
    expect(parts).toMatchObject({ year: 2026, month: 10, day: 12, hour: 14, minute: 30 });
  });
});

describe('nextDailySlots', () => {
  it('starts tomorrow and yields one slot per day at the configured local time', () => {
    const from = new Date('2026-07-15T03:00:00.000Z'); // 13:00 Sydney
    const slots = nextDailySlots(3, 10, 0, SYD, from);
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-07-16T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z',
      '2026-07-18T00:00:00.000Z',
    ]);
  });

  it('rolls across a month boundary', () => {
    const slots = nextDailySlots(2, 10, 0, SYD, new Date('2026-07-30T03:00:00.000Z'));
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-07-31T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ]);
  });

  it('keeps 10:00 local across a DST transition rather than drifting an hour', () => {
    // Slots land on 3, 4, 5, 6 Apr 2026. AEDT ends at 03:00 on the 5th, so
    // 10:00 is +11 on the 3rd and 4th and +10 from the 5th on. A naive
    // "add 24 hours" would put the last two slots at 09:00 and 09:00 local.
    const slots = nextDailySlots(4, 10, 0, SYD, new Date('2026-04-02T06:00:00.000Z'));
    expect(slots.map((d) => partsInZone(d, SYD).hour)).toEqual([10, 10, 10, 10]);
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-04-02T23:00:00.000Z',
      '2026-04-03T23:00:00.000Z',
      '2026-04-05T00:00:00.000Z',
      '2026-04-06T00:00:00.000Z',
    ]);
  });

  it('produces exactly the requested number of slots', () => {
    expect(nextDailySlots(30, 10, 0, SYD, new Date('2026-07-15T03:00:00.000Z'))).toHaveLength(30);
  });
});

describe('formatAuDateTime', () => {
  it('renders the dd/mm/yyyy h:mm:ss am shape the sheet already holds', () => {
    // en-AU uses its short-date pattern (zero-padded day and month) even with
    // month: 'numeric', which is what the n8n expression produced too.
    expect(formatAuDateTime('2026-07-15T04:05:06.000Z', SYD)).toBe('15/07/2026 2:05:06 pm');
  });

  it('returns an empty string for unparseable input', () => {
    expect(formatAuDateTime('not a date', SYD)).toBe('');
  });
});
