/**
 * Timezone-correct date helpers.
 *
 * The n8n `Create Post` code node built schedule dates with
 * `new Date(y, m, d + 1, 10, 0)` — the *server's* local clock — then called
 * `.toISOString()` and named the helper `nextNDatesUTC`. On an n8n box running
 * UTC that scheduled Australian cafe posts for 10:00 UTC, i.e. 8pm or 9pm
 * Sydney time. Here the zone is explicit and configurable.
 */

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `instant` as read in `timeZone`. */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Missing ${type} when formatting for ${timeZone}`);
    return Number(found.value);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The UTC instant at which the given wall-clock time occurs in `timeZone`.
 * Converges in at most two corrections, which also covers DST boundaries.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = target;

  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(guess), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0) - guess;
    const corrected = target - offset;
    if (corrected === guess) break;
    guess = corrected;
  }

  return new Date(guess);
}

/**
 * `count` consecutive days starting tomorrow, each at `hour:minute` local time
 * in `timeZone`, returned as UTC instants. Mirrors the n8n node's one-post-per-
 * day cadence.
 */
export function nextDailySlots(
  count: number,
  hour: number,
  minute: number,
  timeZone: string,
  from: Date = new Date(),
): Date[] {
  const today = partsInZone(from, timeZone);
  const slots: Date[] = [];

  for (let i = 1; i <= count; i++) {
    // Normalise the calendar roll-over (month/year ends) in UTC, then re-zone.
    const rolled = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 12, 0, 0, 0));
    slots.push(
      zonedTimeToUtc(
        rolled.getUTCFullYear(),
        rolled.getUTCMonth() + 1,
        rolled.getUTCDate(),
        hour,
        minute,
        timeZone,
      ),
    );
  }

  return slots;
}

/**
 * `d/m/yyyy h:mm:ss am` — the shape the n8n Lovable mapping produced via
 * `toLocaleString('en-AU', ...).replace(',', '')`, which is what the existing
 * spreadsheet rows already contain.
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
