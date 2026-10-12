import { describe, expect, it } from 'vitest';
import { columnLetter, findRow, quoteSheetTitle, type SheetTable } from '../src/integrations/sheets.js';

describe('columnLetter', () => {
  it('maps 0-based indexes to A1 column names', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
    expect(columnLetter(701)).toBe('ZZ');
  });
});

describe('quoteSheetTitle', () => {
  it('quotes a title with a trailing space (the real tab is named "PEE ")', () => {
    expect(quoteSheetTitle('PEE ')).toBe("'PEE '");
  });

  it('escapes embedded single quotes by doubling them', () => {
    expect(quoteSheetTitle("Sam's tab")).toBe("'Sam''s tab'");
  });
});

describe('findRow', () => {
  const table: SheetTable = {
    header: ['Name', 'EMAIL', 'Booked Call'],
    rows: [
      { rowNumber: 2, values: { Name: 'Ann', EMAIL: 'ann@example.com', 'Booked Call': '' } },
      { rowNumber: 3, values: { Name: 'Bo', EMAIL: '  BO@Example.COM ', 'Booked Call': 'Booked' } },
    ],
  };

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(findRow(table, 'EMAIL', 'bo@example.com')?.rowNumber).toBe(3);
    expect(findRow(table, 'EMAIL', ' Ann@Example.com ')?.rowNumber).toBe(2);
  });

  it('returns undefined for an unknown value', () => {
    expect(findRow(table, 'EMAIL', 'nobody@example.com')).toBeUndefined();
  });

  it('never matches on an empty needle, so a blank email cannot hit a blank cell', () => {
    const withBlank: SheetTable = {
      header: ['EMAIL'],
      rows: [{ rowNumber: 2, values: { EMAIL: '' } }],
    };
    expect(findRow(withBlank, 'EMAIL', '')).toBeUndefined();
    expect(findRow(withBlank, 'EMAIL', '   ')).toBeUndefined();
  });
});
