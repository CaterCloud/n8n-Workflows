import { formatAuDateTime } from '../lib/dates.js';
import { getPath } from '../lib/text.js';

/**
 * The six "<event> | G Sheet" workflows, as data.
 *
 * Every one was the same four nodes: webhook -> look up a row by EMAIL in the
 * "PEE Optin - Utm" spreadsheet -> update that row, or append a new one. Only
 * the webhook path and the column mapping differed, so only those are listed.
 *
 * Column names are reproduced byte for byte, including the curly apostrophes
 * and the embedded newline in "Strategy Call Booked\nThrough Funnel" — they
 * have to match the spreadsheet header exactly.
 */

export interface MapContext {
  /** The webhook JSON body. n8n saw this as `$json.body`. */
  body: unknown;
  /** The matched spreadsheet row, when one exists. */
  existing?: Record<string, string>;
  timeZone: string;
}

export type FieldMapper = (ctx: MapContext) => string;
export type FieldMap = Record<string, FieldMapper>;

export interface LeadEvent {
  slug: string;
  name: string;
  /** The original n8n webhook path, kept mounted so GHL needs only a new host. */
  n8nPath: string;
  /** Spreadsheet column used to find an existing row. */
  matchColumn: string;
  matchValue: FieldMapper;
  onUpdate: FieldMap;
  onAppend: FieldMap;
  notes?: string;
}

/** First non-empty value among the given paths, as a trimmed string. */
function pick(...paths: string[]): FieldMapper {
  return ({ body }) => {
    for (const path of paths) {
      const value = getPath(body, path);
      if (value === null || value === undefined) continue;
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (text.trim() !== '') return text;
    }
    return '';
  };
}

const constant = (value: string): FieldMapper => () => value;

/** Reads a column off the matched row — the `$json.<Column>` self-references. */
const fromExistingRow =
  (column: string): FieldMapper =>
  ({ existing }) =>
    existing?.[column] ?? '';

/** `submitted_at` rendered as `d/m/yyyy h:mm:ss am`, matching existing rows. */
const auDateTime =
  (path: string): FieldMapper =>
  ({ body, timeZone }) => {
    const raw = getPath(body, path);
    if (raw === null || raw === undefined || raw === '') return '';
    return formatAuDateTime(raw as string | number, timeZone);
  };

// Column headers in the destination sheet. U+2019 apostrophes where the sheet
// has them; straight quotes where it does not.
const COL_REVENUE = 'What’s your approx monthly revenue from private events?';
const COL_ENQUIRIES = 'Do you currently have a way of generating consistent private event enquiries?';
const COL_CHALLENGE = "What's your biggest challenge right now?";
const COL_WHEN_SOLVED = 'When do you want this problem solved?';
const COL_ROLE = "What's your role in the business?";
const COL_DESCRIBES = 'What best describes your catering business?';
const COL_STRATEGY_FUNNEL = 'Strategy Call Booked\nThrough Funnel';

// Source keys in the GHL payload. Several carry a trailing space in the form
// field name, so each is tried with and without it.
const SRC_REVENUE = pick(
  "['What’s your approx monthly revenue from private events? ']",
  "['What’s your approx monthly revenue from private events?']",
);
const SRC_ENQUIRIES = pick(
  "['Do you currently have a way of generating consistent private event enquiries? ']",
  "['Do you currently have a way of generating consistent private event enquiries?']",
);

// The Lovable funnel nests its answers under `answers`, with a trailing ` *`.
const SRC_ANSWER = (label: string): FieldMapper =>
  pick(`answers['${label} *']`, `answers['${label}']`);

export const LEAD_EVENTS: LeadEvent[] = [
  {
    slug: 'pee-optin',
    name: 'PEE Optin',
    n8nPath: 'b7cfa33b-4a60-41ea-8b89-23cac76f335a',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      EMAIL: pick('email'),
      'Application Completed': constant('Yes'),
      [COL_REVENUE]: SRC_REVENUE,
      [COL_ENQUIRIES]: SRC_ENQUIRIES,
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      Campaign: pick('contact.attributionSource.campaign'),
      Audience: pick('contact.attributionSource.utmMedium'),
      Creative: pick('contact.lastAttributionSource.utmContent'),
      PIC: pick('PIC'),
      [COL_REVENUE]: SRC_REVENUE,
      [COL_ENQUIRIES]: SRC_ENQUIRIES,
      'Application Completed': constant('Yes'),
      'OPTED IN DATE / TIME': pick("customData['Survey Submitted Date']"),
    },
  },
  {
    slug: 'pee-created',
    name: 'PEE Created',
    n8nPath: '57ec9f62-fdfa-48ac-b7e8-7cfda0cf5086',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      'Booked Call Strategy': constant(''),
      'Onboarded To PEE': constant('Yes'),
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'Onboarded To PEE': constant('Yes'),
    },
    notes: 'Its update branch blanks "Booked Call Strategy". Reproduced as-is; see docs/N8N-MAPPING.md if that was not intended.',
  },
  {
    slug: 'pee-created-lovable',
    name: 'PEE Created (Lovable funnel)',
    n8nPath: '1c3ea975-d68b-43f6-839a-859d39e29b8f',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      Name: pick('name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'OPTED IN DATE / TIME': auDateTime('submitted_at'),
      Campaign: pick('campaign'),
      Creative: pick('utmContent'),
      Audience: pick('utmMedium'),
      'Application Completed': constant('Yes'),
      [COL_REVENUE]: SRC_ANSWER("What's your approximate monthly catering revenue right now?"),
      [COL_CHALLENGE]: SRC_ANSWER("What's your biggest challenge right now?"),
      [COL_WHEN_SOLVED]: SRC_ANSWER('When do you want this problem solved?'),
      [COL_ROLE]: SRC_ANSWER("What's your role in the business?"),
      [COL_DESCRIBES]: SRC_ANSWER('What best describes your catering business?'),
    },
    onAppend: {
      Name: pick('name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'OPTED IN DATE / TIME': auDateTime('submitted_at'),
      Campaign: pick('campaign'),
      Audience: pick('utmMedium'),
      Creative: pick('utmContent'),
      'Application Completed': constant('Yes'),
      [COL_REVENUE]: SRC_ANSWER("What's your approximate monthly catering revenue right now?"),
      [COL_DESCRIBES]: SRC_ANSWER('What best describes your catering business?'),
      [COL_CHALLENGE]: SRC_ANSWER("What's your biggest challenge right now?"),
      [COL_WHEN_SOLVED]: SRC_ANSWER('When do you want this problem solved?'),
      [COL_ROLE]: SRC_ANSWER("What's your role in the business?"),
    },
  },
  {
    slug: 'strategy-call-booked',
    name: 'Strategy Call Booked',
    n8nPath: '7fa7f14d-abe9-4b1d-ab92-47507dc01f31',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      'Booked Call Strategy': constant('Yes'),
      [COL_STRATEGY_FUNNEL]: constant('Yes'),
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'Booked Call Strategy': constant('Yes'),
      [COL_STRATEGY_FUNNEL]: constant('Yes'),
    },
  },
  {
    slug: 'triage-call-booked',
    name: 'Triage Call Booked',
    n8nPath: 'ca65bbff-4b05-4c0d-9c32-4de734336cd5',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      Name: fromExistingRow('Name'),
      'PHONE NUMBER': fromExistingRow('PHONE NUMBER'),
      EMAIL: fromExistingRow('EMAIL'),
      Campaign: pick('contact.attributionSource.campaign'),
      Audience: pick('contact.attributionSource.utmMedium'),
      Creative: pick('contact.attributionSource.utmContent'),
      'OPTED IN DATE / TIME': pick("customData['Survey Submitted']"),
      'Booked Call': constant('Booked'),
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'OPTED IN DATE / TIME': pick("customData['Survey Submitted']"),
      Campaign: pick('contact.attributionSource.campaign'),
      Audience: pick('contact.attributionSource.utmMedium'),
      Creative: pick('contact.lastAttributionSource.utmContent'),
      'Booked Call': constant('Booked'),
    },
    notes: 'Its lookup node had alwaysOutputData off, so an unseen email reached no branch at all and the lead was dropped. Here it appends.',
  },
  {
    slug: 'triage-call-showed',
    name: 'Triage Call Showed',
    n8nPath: '42a66325-4037-4f75-a3e5-5edecde0cd83',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onUpdate: {
      'Showed Up / No Show': pick('customData.Appt_Status'),
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'Showed Up / No Show': constant('Showed'),
    },
  },
];

export function leadEventBySlug(slug: string): LeadEvent | undefined {
  return LEAD_EVENTS.find((e) => e.slug === slug);
}

export function leadEventByN8nPath(path: string): LeadEvent | undefined {
  return LEAD_EVENTS.find((e) => e.n8nPath === path);
}
