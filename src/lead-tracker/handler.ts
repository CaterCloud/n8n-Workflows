import { env } from '../env.js';
import { logger as rootLogger } from '../logger.js';
import { ConfigError } from '../lib/errors.js';
import { appendRow, findRow, readTable, updateRowCells, type SheetTable } from '../integrations/sheets.js';
import type { FieldMap, LeadEvent, MapContext } from './events.js';

/**
 * Applies one lead event to the tracker spreadsheet: look the lead up by
 * email, then update that row or append a new one.
 */

export interface LeadResult {
  event: string;
  action: 'updated' | 'appended';
  matchValue: string;
  rowNumber?: number;
  columnsWritten: string[];
  unknownColumns: string[];
}

export class MissingMatchValueError extends Error {
  constructor(readonly column: string) {
    super(`Webhook payload has no ${column} value to match on`);
    this.name = 'MissingMatchValueError';
  }
}

function render(map: FieldMap, ctx: MapContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [column, mapper] of Object.entries(map)) {
    out[column] = mapper(ctx);
  }
  return out;
}

function sheetId(): string {
  const id = env().LEAD_SHEET_ID;
  if (!id) {
    throw new ConfigError('LEAD_SHEET_ID is not set — the lead tracker has no destination spreadsheet');
  }
  return id;
}

/** Overridable for tests; defaults to the live Sheets client. */
export interface SheetPort {
  read(spreadsheetId: string, sheetTitle: string): Promise<SheetTable>;
  update(
    spreadsheetId: string,
    sheetTitle: string,
    header: readonly string[],
    rowNumber: number,
    cells: Record<string, string>,
  ): Promise<{ updated: string[]; unknownColumns: string[] }>;
  append(
    spreadsheetId: string,
    sheetTitle: string,
    header: readonly string[],
    cells: Record<string, string>,
  ): Promise<{ unknownColumns: string[] }>;
}

const livePort: SheetPort = {
  read: readTable,
  update: updateRowCells,
  append: appendRow,
};

export async function handleLeadEvent(
  event: LeadEvent,
  body: unknown,
  port: SheetPort = livePort,
): Promise<LeadResult> {
  const log = rootLogger.child({ workflow: 'lead-tracker', event: event.slug });
  const timeZone = env().SCHEDULE_TIMEZONE;

  // Validate the payload before the configuration, so a malformed webhook gets
  // a 400 that names the real problem rather than a 503 about the spreadsheet.
  const matchValue = event.matchValue({ body, timeZone });
  if (!matchValue.trim()) throw new MissingMatchValueError(event.matchColumn);

  const spreadsheetId = sheetId();
  const sheetTitle = env().LEAD_SHEET_NAME;

  const table = await port.read(spreadsheetId, sheetTitle);
  if (!table.header.includes(event.matchColumn)) {
    throw new ConfigError(
      `Sheet "${sheetTitle}" has no "${event.matchColumn}" column; found: ${table.header.filter(Boolean).join(', ')}`,
    );
  }

  const existingRow = findRow(table, event.matchColumn, matchValue);

  if (existingRow) {
    const cells = render(event.onUpdate, { body, existing: existingRow.values, timeZone });
    const { updated, unknownColumns } = await port.update(
      spreadsheetId,
      sheetTitle,
      table.header,
      existingRow.rowNumber,
      cells,
    );
    log.info('row updated', { matchValue, rowNumber: existingRow.rowNumber, columns: updated.length });
    return {
      event: event.slug,
      action: 'updated',
      matchValue,
      rowNumber: existingRow.rowNumber,
      columnsWritten: updated,
      unknownColumns,
    };
  }

  const cells = render(event.onAppend, { body, timeZone });
  const { unknownColumns } = await port.append(spreadsheetId, sheetTitle, table.header, cells);
  log.info('row appended', { matchValue, columns: Object.keys(cells).length });
  return {
    event: event.slug,
    action: 'appended',
    matchValue,
    columnsWritten: Object.keys(cells).filter((c) => table.header.includes(c)),
    unknownColumns,
  };
}
