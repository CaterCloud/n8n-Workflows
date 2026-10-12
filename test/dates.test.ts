import { describe, expect, it } from 'vitest';
import { formatAuDateTime } from '../src/lib/dates.js';

const SYD = 'Australia/Sydney';

describe('formatAuDateTime', () => {
  it('renders the dd/mm/yyyy h:mm:ss am shape the sheet already holds', () => {
    // en-AU applies its short-date pattern, so day and month come out
    // zero-padded despite `numeric` — same as the n8n expression produced.
    expect(formatAuDateTime('2026-07-15T04:05:06.000Z', SYD)).toBe('15/07/2026 2:05:06 pm');
  });

  it('converts into the configured zone, not UTC', () => {
    // 23:30 UTC is the next day in Sydney.
    expect(formatAuDateTime('2026-07-15T23:30:00.000Z', SYD)).toBe('16/07/2026 9:30:00 am');
    expect(formatAuDateTime('2026-07-15T23:30:00.000Z', 'UTC')).toBe('15/07/2026 11:30:00 pm');
  });

  it('handles daylight saving on both sides of the changeover', () => {
    // AEDT (+11) in January, AEST (+10) in July.
    expect(formatAuDateTime('2026-01-15T00:00:00.000Z', SYD)).toBe('15/01/2026 11:00:00 am');
    expect(formatAuDateTime('2026-07-15T00:00:00.000Z', SYD)).toBe('15/07/2026 10:00:00 am');
  });

  it('accepts a Date or an epoch as well as a string', () => {
    const iso = '2026-07-15T04:05:06.000Z';
    expect(formatAuDateTime(new Date(iso), SYD)).toBe('15/07/2026 2:05:06 pm');
    expect(formatAuDateTime(Date.parse(iso), SYD)).toBe('15/07/2026 2:05:06 pm');
  });

  it('returns an empty string for unparseable input rather than "Invalid Date"', () => {
    expect(formatAuDateTime('not a date', SYD)).toBe('');
    expect(formatAuDateTime('', SYD)).toBe('');
  });
});
