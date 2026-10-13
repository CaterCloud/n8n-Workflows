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

export interface FieldMapper {
  (ctx: MapContext): string;
  /**
   * True when this mapper writes a fixed value, so an empty result is
   * intentional rather than a field missing from the payload. The update path
   * uses this to tell "the workflow means to blank this" apart from "the
   * webhook didn't send it", and only protects existing data in the latter case.
   */
  literal?: boolean;
}

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
  /**
   * What to do when no row matches. Taken from each source workflow's lookup
   * node: with `alwaysOutputData` on, an empty lookup still emitted an item,
   * the IF went false and the append branch ran (`append`). With it off the
   * node emitted nothing, neither branch ran, and the lead was dropped
   * (`skip`).
   */
  onMissingRow: 'append' | 'skip';
  /** Shown in the response when a lead is skipped. */
  missingRowNote?: string;
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

const constant = (value: string): FieldMapper =>
  Object.assign(() => value, { literal: true });

/**
 * The moment the webhook arrived, in the configured zone. GoHighLevel does not
 * send a survey timestamp on the PEE Optin action, so the opt-in time is taken
 * as receipt time rather than left blank.
 */
const receivedNow: FieldMapper = ({ timeZone }) => formatAuDateTime(new Date(), timeZone);

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
/**
 * Attribution. GoHighLevel flattens its fields to the top level of the
 * payload — `customData` arrives as an empty object — and the live values come
 * through as `utm_medium` / `utm_campaign` / `utm_content`:
 *
 *   utm_medium   = "paid_social"
 *   utm_campaign = "120248317508630046"
 *   utm_content  = "120248514540750046"
 *
 * The nested `contact.attributionSource.*` paths the n8n workflows read are
 * still tried afterwards, so anything that did work keeps working.
 */
const SRC_CAMPAIGN = pick(
  'utm_campaign',
  'Campaign',
  'contact.attributionSource.campaign',
  'contact.lastAttributionSource.campaign',
);
const SRC_AUDIENCE = pick(
  'utm_medium',
  'Audience',
  'contact.attributionSource.utmMedium',
  'contact.lastAttributionSource.utmMedium',
);
const SRC_CREATIVE = pick(
  'utm_content',
  'Creative',
  'contact.lastAttributionSource.utmContent',
  'contact.attributionSource.utmContent',
);

const SRC_REVENUE = pick(
  "['Monthly Catering Revenue']",
  "['What’s your approx monthly revenue from private events? ']",
  "['What’s your approx monthly revenue from private events?']",
);
const SRC_ENQUIRIES = pick(
  "['Do you currently have a way of generating consistent private event enquiries? ']",
  "['Do you currently have a way of generating consistent private event enquiries?']",
);

/**
 * The remaining survey answers, under the field names GoHighLevel sends today.
 * Older spellings follow as fallbacks, so a form still using them keeps working.
 */
const SRC_CHALLENGE = pick(
  "['Current Business Challenge']",
  "['Biggest Challenge']",
  "['What's your biggest challenge right now?']",
  "['What's Your Biggest Challenge Right Now? ']",
);
const SRC_ROLE = pick("['Business Role']", "['What's your role in the business?']");
const SRC_WHEN_SOLVED = pick(
  "['Desired Solution Timeline']",
  "['When do you want this problem solved?']",
  "['How soon are you looking to improve or scale your private event bookings?']",
);
const SRC_DESCRIBES = pick(
  "['Catering Business Type']",
  "['What best describes your catering business?']",
  "['What Type Of Catering Do You Do?']",
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
    onMissingRow: 'append',
    onUpdate: {
      EMAIL: pick('email'),
      'Application Completed': constant('Yes'),
      [COL_REVENUE]: SRC_REVENUE,
      [COL_ENQUIRIES]: SRC_ENQUIRIES,
      [COL_CHALLENGE]: SRC_CHALLENGE,
      [COL_ROLE]: SRC_ROLE,
      [COL_WHEN_SOLVED]: SRC_WHEN_SOLVED,
      [COL_DESCRIBES]: SRC_DESCRIBES,
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      Campaign: SRC_CAMPAIGN,
      Audience: SRC_AUDIENCE,
      Creative: SRC_CREATIVE,
      PIC: pick('PIC'),
      [COL_REVENUE]: SRC_REVENUE,
      [COL_ENQUIRIES]: SRC_ENQUIRIES,
      [COL_CHALLENGE]: SRC_CHALLENGE,
      [COL_ROLE]: SRC_ROLE,
      [COL_WHEN_SOLVED]: SRC_WHEN_SOLVED,
      [COL_DESCRIBES]: SRC_DESCRIBES,
      'Application Completed': constant('Yes'),
      // Was customData['Survey Submitted Date'], which GoHighLevel does not
      // send on this action — it always resolved empty. Stamped on arrival
      // instead; see docs/N8N-MAPPING.md.
      'OPTED IN DATE / TIME': receivedNow,
    },
  },
  {
    slug: 'pee-created',
    name: 'PEE Created',
    n8nPath: '57ec9f62-fdfa-48ac-b7e8-7cfda0cf5086',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onMissingRow: 'append',
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
    onMissingRow: 'append',
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
    onMissingRow: 'append',
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
    // Its lookup node is the only one with alwaysOutputData off.
    onMissingRow: 'skip',
    missingRowNote:
      'Reproduced from the source workflow: its lookup node had alwaysOutputData off, so an email not already in the sheet reached neither the update nor the append branch. Change onMissingRow to "append" in src/lead-tracker/events.ts to capture these leads instead.',
    onUpdate: {
      Name: fromExistingRow('Name'),
      'PHONE NUMBER': fromExistingRow('PHONE NUMBER'),
      EMAIL: fromExistingRow('EMAIL'),
      Campaign: SRC_CAMPAIGN,
      Audience: SRC_AUDIENCE,
      Creative: SRC_CREATIVE,
      'OPTED IN DATE / TIME': pick("customData['Survey Submitted']"),
      'Booked Call': constant('Booked'),
    },
    onAppend: {
      Name: pick('full_name'),
      'PHONE NUMBER': pick('phone'),
      EMAIL: pick('email'),
      'OPTED IN DATE / TIME': pick("customData['Survey Submitted']"),
      Campaign: SRC_CAMPAIGN,
      Audience: SRC_AUDIENCE,
      Creative: SRC_CREATIVE,
      'Booked Call': constant('Booked'),
    },
    notes: 'Its lookup node had alwaysOutputData off, so an unseen email was dropped. Reproduced — see onMissingRow above.',
  },
  {
    slug: 'triage-call-showed',
    name: 'Triage Call Showed',
    n8nPath: '42a66325-4037-4f75-a3e5-5edecde0cd83',
    matchColumn: 'EMAIL',
    matchValue: pick('email'),
    onMissingRow: 'append',
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
