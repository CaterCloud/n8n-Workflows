/**
 * `d/m/yyyy h:mm:ss am` — the shape the n8n Lovable mapping produced with
 * `toLocaleString('en-AU', { … }).replace(',', '')`, and therefore the shape
 * the existing spreadsheet rows already hold.
 *
 * Note that `en-AU` applies its own short-date pattern, so the day and month
 * come out zero-padded despite `numeric`. That matches the original output.
 */
export function formatAuDateTime(value: string | number | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: 'numeric',
    hour12: true,
  })
    .format(date)
    .replace(',', '');
}
