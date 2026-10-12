import { env } from '../env.js';
import { logger as rootLogger } from '../logger.js';
import { ConfigError, MissingMatchValueError } from '../lib/errors.js';
import { appendRow, findRow, readTable, updateRowCells, type SheetTable } from '../integrations/sheets.js';
import type { FieldMap, LeadEvent, MapContext } from './events.js';

/**
 * Applies one lead event to the tracker spreadsheet: look the lead up by
 * email, then update that row, append a new one, or — where the source
 * workflow did — do nothing.
 */

export interface LeadResult {
  event: string;
  action: 'updated' | 'appended' | 'skipped';
  matchValue: string;
  rowNumber?: number;
  columnsWritten: string[];
  unknownColumns: string[];
  /**
   * Mapped columns whose source was absent from the payload, so an empty
   * string was written. A long list here usually means the sending system is
   * not sending what the mapping expects.
   */
  emptyColumns: string[];
  /**
   * Columns left alone on an update because the webhook carried no value and
   * the sheet already held one. Without this, a sparse payload would blank
   * data that is already correct.
   */
  preservedColumns: string[];
  dryRun: boolean;
  /** Set when `action` is `skipped`, explaining why. */
  reason?: string;
}

function render(map: FieldMap, ctx: MapContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [column, mapper] of Object.entries(map)) {
    out[column] = mapper(ctx);
  }
  return out;
}

const emptyOf = (cells: Record<string, string>): string[] =>
  Object.entries(cells)
    .filter(([, v]) => v === '')
    .map(([k]) => k);

/**
 * Drops the cells an update should not write: those whose mapper produced an
 * empty string because the payload lacked the field. A mapper marked `literal`
 * is writing a fixed value on purpose, so it is always kept — that is what
 * preserves pee-created's deliberate blanking of "Booked Call Strategy".
 */
function protectExisting(
  cells: Record<string, string>,
  map: FieldMap,
  existing: Record<string, string>,
): { toWrite: Record<string, string>; preserved: string[] } {
  const toWrite: Record<string, string> = {};
  const preserved: string[] = [];

  for (const [column, value] of Object.entries(cells)) {
    if (value !== '' || map[column]?.literal) {
      toWrite[column] = value;
      continue;
    }
    // Empty, and not deliberate. Note it only when there was something to keep.
    if ((existing[column] ?? '').trim() !== '') preserved.push(column);
  }

  return { toWrite, preserved };
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
  const timeZone = env().TIMEZONE;
  const dryRun = env().DRY_RUN;

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
    const rendered = render(event.onUpdate, { body, existing: existingRow.values, timeZone });
    const { toWrite: cells, preserved } = protectExisting(rendered, event.onUpdate, existingRow.values);

    if (preserved.length) {
      log.info('kept existing values the webhook did not carry', {
        matchValue,
        rowNumber: existingRow.rowNumber,
        preservedColumns: preserved,
      });
    }

    if (dryRun) {
      log.info('dry run: would update row', { matchValue, rowNumber: existingRow.rowNumber, cells });
      return {
        event: event.slug,
        action: 'updated',
        matchValue,
        rowNumber: existingRow.rowNumber,
        columnsWritten: Object.keys(cells).filter((c) => table.header.includes(c)),
        unknownColumns: Object.keys(cells).filter((c) => !table.header.includes(c)),
        emptyColumns: emptyOf(rendered),
        preservedColumns: preserved,
        dryRun,
      };
    }

    const { updated, unknownColumns } = await port.update(
      spreadsheetId,
      sheetTitle,
      table.header,
      existingRow.rowNumber,
      cells,
    );
    log.info('row updated', {
      matchValue,
      rowNumber: existingRow.rowNumber,
      columns: updated.length,
      empty: emptyOf(rendered).length,
      preserved: preserved.length,
    });
    return {
      event: event.slug,
      action: 'updated',
      matchValue,
      rowNumber: existingRow.rowNumber,
      columnsWritten: updated,
      unknownColumns,
      emptyColumns: emptyOf(rendered),
      preservedColumns: preserved,
      dryRun,
    };
  }

  // No matching row. Five of the six source workflows append here; one does
  // nothing, and that difference is reproduced per event.
  if (event.onMissingRow === 'skip') {
    log.warn('no matching row; skipping, as the source workflow did', {
      matchValue,
      note: event.missingRowNote,
    });
    return {
      event: event.slug,
      action: 'skipped',
      matchValue,
      columnsWritten: [],
      unknownColumns: [],
      emptyColumns: [],
      preservedColumns: [],
      dryRun,
      reason:
        event.missingRowNote ??
        'The source n8n workflow took no action when the email was not already in the sheet.',
    };
  }

  const cells = render(event.onAppend, { body, timeZone });
  if (dryRun) {
    log.info('dry run: would append row', { matchValue, cells });
    return {
      event: event.slug,
      action: 'appended',
      matchValue,
      columnsWritten: Object.keys(cells).filter((c) => table.header.includes(c)),
      unknownColumns: Object.keys(cells).filter((c) => !table.header.includes(c)),
      emptyColumns: emptyOf(cells),
      preservedColumns: [],
      dryRun,
    };
  }

  const { unknownColumns } = await port.append(spreadsheetId, sheetTitle, table.header, cells);
  const empty = emptyOf(cells);
  log.info('row appended', { matchValue, columns: Object.keys(cells).length, empty: empty.length });
  return {
    event: event.slug,
    action: 'appended',
    matchValue,
    columnsWritten: Object.keys(cells).filter((c) => table.header.includes(c)),
    unknownColumns,
    emptyColumns: empty,
    preservedColumns: [],
    dryRun,
  };
}

export { MissingMatchValueError };
