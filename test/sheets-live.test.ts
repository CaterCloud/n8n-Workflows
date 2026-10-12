import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestEnv } from './helpers.js';

/**
 * Exercises the real Sheets integration — A1 range construction, the
 * read/update/append calls and their payload shapes — against a stubbed
 * googleapis client. test/lead-tracker.test.ts stubs one layer higher, so this
 * is what catches a malformed range or a wrong valueInputOption.
 */

const valuesGet = vi.fn();
const valuesBatchUpdate = vi.fn();
const valuesAppend = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({
      spreadsheets: {
        values: {
          get: (...a: unknown[]) => valuesGet(...a),
          batchUpdate: (...a: unknown[]) => valuesBatchUpdate(...a),
          append: (...a: unknown[]) => valuesAppend(...a),
        },
      },
    }),
    auth: { OAuth2: class { setCredentials(): void {} } },
  },
}));

const { readTable, updateRowCells, appendRow, setSheetsForTesting } = await import(
  '../src/integrations/sheets.js'
);
const { handleLeadEvent } = await import('../src/lead-tracker/handler.js');
const { leadEventBySlug } = await import('../src/lead-tracker/events.js');

const HEADER = ['Name', 'PHONE NUMBER', 'EMAIL', 'Booked Call Strategy', 'Strategy Call Booked\nThrough Funnel'];

beforeEach(() => {
  vi.clearAllMocks();
  setSheetsForTesting(undefined);
  // googleapis is stubbed above, so these only need to be present.
  useTestEnv({
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REFRESH_TOKEN: 'test-refresh',
  });
  valuesGet.mockResolvedValue({
    data: { values: [HEADER, ['Ann', '+61400000000', 'ann@example.com', '', '']] },
  });
  valuesBatchUpdate.mockResolvedValue({ data: {} });
  valuesAppend.mockResolvedValue({ data: {} });
});

afterEach(() => {
  setSheetsForTesting(undefined);
});

describe('readTable', () => {
  it('quotes the trailing-space tab name in the A1 range', async () => {
    await readTable('sheet-1', 'PEE ');
    expect(valuesGet).toHaveBeenCalledWith(expect.objectContaining({ range: "'PEE '!A:ZZ" }));
  });

  it('numbers rows from 2, allowing for the header', async () => {
    const table = await readTable('sheet-1', 'PEE ');
    expect(table.header).toEqual(HEADER);
    expect(table.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          Name: 'Ann',
          'PHONE NUMBER': '+61400000000',
          EMAIL: 'ann@example.com',
          'Booked Call Strategy': '',
          'Strategy Call Booked\nThrough Funnel': '',
        },
      },
    ]);
  });

  it('copes with an empty sheet', async () => {
    valuesGet.mockResolvedValue({ data: {} });
    const table = await readTable('sheet-1', 'PEE ');
    expect(table).toEqual({ header: [], rows: [] });
  });

  it('pads short rows rather than dropping the columns', async () => {
    valuesGet.mockResolvedValue({ data: { values: [HEADER, ['Solo']] } });
    const table = await readTable('sheet-1', 'PEE ');
    expect(table.rows[0]?.values).toMatchObject({ Name: 'Solo', EMAIL: '' });
  });
});

describe('updateRowCells', () => {
  it('writes one targeted range per mapped column', async () => {
    const result = await updateRowCells('sheet-1', 'PEE ', HEADER, 7, {
      'Booked Call Strategy': 'Yes',
      'Strategy Call Booked\nThrough Funnel': 'Yes',
    });

    expect(result.updated).toEqual(['Booked Call Strategy', 'Strategy Call Booked\nThrough Funnel']);
    expect(valuesBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'PEE '!D7", values: [['Yes']] },
          { range: "'PEE '!E7", values: [['Yes']] },
        ],
      },
    });
  });

  it('reports an unmapped column and does not send it', async () => {
    const result = await updateRowCells('sheet-1', 'PEE ', HEADER, 7, {
      EMAIL: 'a@b.com',
      'No Such Column': 'x',
    });

    expect(result).toEqual({ updated: ['EMAIL'], unknownColumns: ['No Such Column'] });
    const [[call]] = valuesBatchUpdate.mock.calls as [[{ requestBody: { data: unknown[] } }]];
    expect(call.requestBody.data).toHaveLength(1);
  });

  it('makes no request at all when nothing maps', async () => {
    const result = await updateRowCells('sheet-1', 'PEE ', HEADER, 7, { Nope: 'x' });
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
    expect(result.updated).toEqual([]);
  });
});

describe('appendRow', () => {
  it('aligns values to the header and inserts a row', async () => {
    await appendRow('sheet-1', 'PEE ', HEADER, { Name: 'Bo', EMAIL: 'bo@example.com' });

    expect(valuesAppend).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: "'PEE '!A:ZZ",
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [['Bo', '', 'bo@example.com', '', '']] },
    });
  });
});

describe('end to end through the real Sheets layer', () => {
  it('updates the matching row via a targeted batch write', async () => {
    const result = await handleLeadEvent(leadEventBySlug('strategy-call-booked')!, {
      email: 'ANN@EXAMPLE.COM',
    });

    expect(result).toMatchObject({ action: 'updated', rowNumber: 2 });
    expect(valuesAppend).not.toHaveBeenCalled();
    const [[call]] = valuesBatchUpdate.mock.calls as [[{ requestBody: { data: Array<{ range: string }> } }]];
    expect(call.requestBody.data.map((d) => d.range)).toEqual(["'PEE '!D2", "'PEE '!E2"]);
  });

  it('appends an unseen lead', async () => {
    const result = await handleLeadEvent(leadEventBySlug('strategy-call-booked')!, {
      email: 'new@example.com',
      full_name: 'New Lead',
      phone: '+61411111111',
    });

    expect(result.action).toBe('appended');
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
    const [[call]] = valuesAppend.mock.calls as [[{ requestBody: { values: string[][] } }]];
    expect(call.requestBody.values[0]).toEqual(['New Lead', '+61411111111', 'new@example.com', 'Yes', 'Yes']);
  });

  it('surfaces a Google failure rather than swallowing it', async () => {
    valuesGet.mockRejectedValue(
      Object.assign(new Error('Requested entity was not found.'), {
        status: 404,
        response: { status: 404, data: { error: { message: 'Requested entity was not found.' } } },
      }),
    );

    await expect(
      handleLeadEvent(leadEventBySlug('strategy-call-booked')!, { email: 'a@b.com' }),
    ).rejects.toThrow(/Requested entity was not found/);
  });
});
