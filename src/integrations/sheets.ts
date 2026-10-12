import { google, type sheets_v4 } from 'googleapis';
import { googleAuth } from './google-auth.js';
import { logger } from '../logger.js';

/**
 * A thin Sheets client shaped around what the lead-tracker workflows need:
 * read a tab with its header row, find a row by column value, then update that
 * row's cells or append a new one.
 */

export interface SheetTable {
  /** Header row values, in column order. */
  header: string[];
  /**
   * Data rows keyed by header name, each tagged with its 1-based spreadsheet
   * row number (n8n exposed this as `row_number`).
   */
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
}

let api: sheets_v4.Sheets | undefined;

function sheets(): sheets_v4.Sheets {
  api ??= google.sheets({ version: 'v4', auth: googleAuth() });
  return api;
}

/** `A`, `Z`, `AA`, ... for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Quotes a tab title for use in an A1 range. Titles may contain spaces. */
export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Resolves a numeric sheet (tab) gid to its current title. */
export async function sheetTitleForGid(spreadsheetId: string, gid: number): Promise<string> {
  const res = await sheets().spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const match = res.data.sheets?.find((s) => s.properties?.sheetId === gid);
  if (!match?.properties?.title) {
    throw new Error(`Spreadsheet ${spreadsheetId} has no tab with gid ${gid}`);
  }
  return match.properties.title;
}

/** Reads the whole tab: header row plus every data row below it. */
export async function readTable(spreadsheetId: string, sheetTitle: string): Promise<SheetTable> {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(sheetTitle)}!A:ZZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const raw = (res.data.values ?? []) as unknown[][];
  const headerRow = raw[0] ?? [];
  const header = headerRow.map((cell) => String(cell ?? ''));

  const rows = raw.slice(1).map((row, i) => {
    const values: Record<string, string> = {};
    header.forEach((name, col) => {
      if (name === '') return;
      values[name] = String(row[col] ?? '');
    });
    // +2: one for the header row, one to make it 1-based.
    return { rowNumber: i + 2, values };
  });

  return { header, rows };
}

/**
 * The first row whose `column` equals `value`, case-insensitively and trimmed —
 * email matching in the source sheet is inconsistently cased.
 */
export function findRow(
  table: SheetTable,
  column: string,
  value: string,
): { rowNumber: number; values: Record<string, string> } | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  return table.rows.find((row) => (row.values[column] ?? '').trim().toLowerCase() === needle);
}

/**
 * Writes only the named cells of one row, leaving every other column alone.
 *
 * n8n's "Update row in sheet" rewrote the row it had read, which silently
 * reverted any edit a human made to that row in between. Targeting individual
 * cells avoids that.
 */
export async function updateRowCells(
  spreadsheetId: string,
  sheetTitle: string,
  header: readonly string[],
  rowNumber: number,
  cells: Record<string, string>,
): Promise<{ updated: string[]; unknownColumns: string[] }> {
  const data: sheets_v4.Schema$ValueRange[] = [];
  const updated: string[] = [];
  const unknownColumns: string[] = [];

  for (const [column, value] of Object.entries(cells)) {
    const index = header.indexOf(column);
    if (index === -1) {
      unknownColumns.push(column);
      continue;
    }
    const letter = columnLetter(index);
    data.push({
      range: `${quoteSheetTitle(sheetTitle)}!${letter}${rowNumber}`,
      values: [[value]],
    });
    updated.push(column);
  }

  if (data.length) {
    await sheets().spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  }

  if (unknownColumns.length) {
    logger.warn('sheet update skipped unknown columns', { spreadsheetId, sheetTitle, unknownColumns });
  }

  return { updated, unknownColumns };
}

/** Appends one row, aligning the supplied values to the existing header. */
export async function appendRow(
  spreadsheetId: string,
  sheetTitle: string,
  header: readonly string[],
  cells: Record<string, string>,
): Promise<{ unknownColumns: string[] }> {
  const unknownColumns = Object.keys(cells).filter((c) => !header.includes(c));
  const row = header.map((name) => cells[name] ?? '');

  await sheets().spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetTitle(sheetTitle)}!A:ZZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  if (unknownColumns.length) {
    logger.warn('sheet append skipped unknown columns', { spreadsheetId, sheetTitle, unknownColumns });
  }

  return { unknownColumns };
}

/** Test hook. */
export function setSheetsForTesting(value: sheets_v4.Sheets | undefined): void {
  api = value;
}
