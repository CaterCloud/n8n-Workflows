import { beforeEach, describe, expect, it } from 'vitest';
import { useTestEnv } from './helpers.js';
import { LEAD_EVENTS, leadEventByN8nPath, leadEventBySlug } from '../src/lead-tracker/events.js';
import { handleLeadEvent, type SheetPort } from '../src/lead-tracker/handler.js';
import { MissingMatchValueError } from '../src/lib/errors.js';
import type { SheetTable } from '../src/integrations/sheets.js';

// The live header of the "PEE " tab, columns A..AN, captured 2026-10-12 and
// cross-checked against the schema n8n itself recorded from the same sheet.
// Mapped column names are matched against this, so a rename in the sheet
// breaks a test here rather than silently writing nothing in production.
const HEADER = [
  'Name',
  'Lead Grade',
  'PHONE NUMBER',
  'EMAIL',
  'OPTED IN DATE / TIME',
  'Campaign',
  'Audience',
  'Creative',
  'PIC',
  'Triage Call Booked\nTHrough Funnel',
  'Strategy Call Booked\nThrough Funnel',
  'Application Completed',
  'What\u2019s your approx monthly revenue from private events?',
  'Do you currently have a way of generating consistent private event enquiries?',
  'What best describes your catering business?',
  "What's your biggest challenge right now?",
  'When do you want this problem solved?',
  "What's your role in the business?",
  'FOLLOW UP 2 (2 DAYS)',
  'FOLLOW UP 3 (3 DAYS)',
  'FOLLOW UP 4 (4 DAYS)',
  'FOLLOW UP 5 (7 DAYS)',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  'STATUS',
  'COMMENTS',
  'REASON LOST? (IF)',
  'OPTED IN SERVICE',
  'REPORTED REVENUE (RM)',
  'Booked Call',
  'Showed Up / No Show',
  'Onboarded To PEE',
  'Booked Call Strategy',
];

interface Recorded {
  updates: Array<{ rowNumber: number; cells: Record<string, string> }>;
  appends: Array<Record<string, string>>;
}

function makePort(rows: SheetTable['rows'], header: string[] = HEADER): { port: SheetPort; log: Recorded } {
  const log: Recorded = { updates: [], appends: [] };
  const port: SheetPort = {
    read: async () => ({ header, rows }),
    update: async (_id, _title, hdr, rowNumber, cells) => {
      log.updates.push({ rowNumber, cells });
      const known = Object.keys(cells).filter((c) => hdr.includes(c));
      return { updated: known, unknownColumns: Object.keys(cells).filter((c) => !hdr.includes(c)) };
    },
    append: async (_id, _title, hdr, cells) => {
      log.appends.push(cells);
      return { unknownColumns: Object.keys(cells).filter((c) => !hdr.includes(c)) };
    },
  };
  return { port, log };
}

beforeEach(() => {
  useTestEnv();
});

describe('event registry', () => {
  it('exposes all six workflows', () => {
    expect(LEAD_EVENTS).toHaveLength(6);
    expect(LEAD_EVENTS.map((e) => e.slug)).toEqual([
      'pee-optin',
      'pee-created',
      'pee-created-lovable',
      'strategy-call-booked',
      'triage-call-booked',
      'triage-call-showed',
    ]);
  });

  it('keeps the original n8n webhook paths resolvable, so GHL only needs a new host', () => {
    expect(leadEventByN8nPath('b7cfa33b-4a60-41ea-8b89-23cac76f335a')?.slug).toBe('pee-optin');
    expect(leadEventByN8nPath('42a66325-4037-4f75-a3e5-5edecde0cd83')?.slug).toBe('triage-call-showed');
    expect(leadEventByN8nPath('nope')).toBeUndefined();
  });

  it('uses unique slugs and unique paths', () => {
    expect(new Set(LEAD_EVENTS.map((e) => e.slug)).size).toBe(6);
    expect(new Set(LEAD_EVENTS.map((e) => e.n8nPath)).size).toBe(6);
  });

  it('only maps columns that exist in the sheet header', () => {
    for (const event of LEAD_EVENTS) {
      for (const column of [...Object.keys(event.onUpdate), ...Object.keys(event.onAppend)]) {
        expect(HEADER, `${event.slug}: unknown column "${column}"`).toContain(column);
      }
    }
  });
});

describe('handleLeadEvent routing', () => {
  it('appends when the email is not in the sheet', async () => {
    const { port, log } = makePort([]);
    const result = await handleLeadEvent(leadEventBySlug('strategy-call-booked')!, {
      full_name: 'Ann Smith',
      phone: '+61400000000',
      email: 'ann@example.com',
    }, port);

    expect(result.action).toBe('appended');
    expect(log.updates).toHaveLength(0);
    expect(log.appends[0]).toMatchObject({
      Name: 'Ann Smith',
      'PHONE NUMBER': '+61400000000',
      EMAIL: 'ann@example.com',
      'Booked Call Strategy': 'Yes',
      'Strategy Call Booked\nThrough Funnel': 'Yes',
    });
  });

  it('updates the matching row when the email is already present', async () => {
    const { port, log } = makePort([
      { rowNumber: 7, values: { EMAIL: 'ann@example.com', Name: 'Ann Smith', 'PHONE NUMBER': '+61400000000' } },
    ]);
    const result = await handleLeadEvent(leadEventBySlug('strategy-call-booked')!, { email: 'ANN@example.com' }, port);

    expect(result).toMatchObject({ action: 'updated', rowNumber: 7 });
    expect(log.appends).toHaveLength(0);
    expect(log.updates[0]).toEqual({
      rowNumber: 7,
      cells: { 'Booked Call Strategy': 'Yes', 'Strategy Call Booked\nThrough Funnel': 'Yes' },
    });
  });

  it('rejects a payload with no email rather than appending a blank row', async () => {
    const { port, log } = makePort([]);
    await expect(handleLeadEvent(leadEventBySlug('pee-optin')!, { full_name: 'No Email' }, port)).rejects.toThrow(
      MissingMatchValueError,
    );
    expect(log.appends).toHaveLength(0);
    expect(log.updates).toHaveLength(0);
  });

  it('fails loudly when the sheet has no EMAIL column', async () => {
    const { port } = makePort([], ['Name', 'Phone']);
    await expect(
      handleLeadEvent(leadEventBySlug('pee-optin')!, { email: 'a@b.com' }, port),
    ).rejects.toThrow(/no "EMAIL" column/);
  });
});

describe('pee-optin mapping', () => {
  const body = {
    full_name: 'Ann Smith',
    phone: '+61400000000',
    email: 'ann@example.com',
    PIC: 'Sam',
    contact: {
      attributionSource: { campaign: 'spring-2026', utmMedium: 'lookalike-1' },
      lastAttributionSource: { utmContent: 'carousel-a' },
    },
    customData: { 'Survey Submitted Date': '12/10/2026 9:15:00 am' },
    // Note the trailing space in the GHL form field names.
    'What’s your approx monthly revenue from private events? ': '$10k-$20k',
    'Do you currently have a way of generating consistent private event enquiries? ': 'No',
  };

  it('maps attribution, PIC and the trailing-space survey fields on append', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-optin')!, body, port);

    // The opt-in time is stamped on arrival, so it is asserted separately.
    const { 'OPTED IN DATE / TIME': optedIn, ...rest } = log.appends[0] ?? {};
    expect(optedIn).toMatch(/^\d{2}\/\d{2}\/\d{4} /);
    expect(rest).toEqual({
      Name: 'Ann Smith',
      'PHONE NUMBER': '+61400000000',
      EMAIL: 'ann@example.com',
      Campaign: 'spring-2026',
      Audience: 'lookalike-1',
      Creative: 'carousel-a',
      PIC: 'Sam',
      'Application Completed': 'Yes',
      'What’s your approx monthly revenue from private events?': '$10k-$20k',
      'Do you currently have a way of generating consistent private event enquiries?': 'No',
    });
  });

  it('also accepts the survey field names without the trailing space', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      {
        email: 'ann@example.com',
        'What’s your approx monthly revenue from private events?': '$20k+',
        'Do you currently have a way of generating consistent private event enquiries?': 'Yes',
      },
      port,
    );

    expect(log.appends[0]?.['What’s your approx monthly revenue from private events?']).toBe('$20k+');
    expect(
      log.appends[0]?.['Do you currently have a way of generating consistent private event enquiries?'],
    ).toBe('Yes');
  });

  it('writes empty strings for absent optional fields instead of "undefined"', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-optin')!, { email: 'ann@example.com' }, port);

    expect(log.appends[0]?.['Campaign']).toBe('');
    expect(log.appends[0]?.['PIC']).toBe('');
    expect(Object.values(log.appends[0] ?? {}).join('')).not.toContain('undefined');
  });
});

describe('pee-created-lovable mapping', () => {
  const body = {
    name: 'Bo Nguyen',
    phone: '+61411111111',
    email: 'bo@example.com',
    submitted_at: '2026-07-15T04:05:06.000Z',
    campaign: 'lovable-launch',
    utmMedium: 'interest-2',
    utmContent: 'video-b',
    answers: {
      "What's your approximate monthly catering revenue right now? *": '$5k-$10k',
      "What's your biggest challenge right now? *": 'Lead flow',
      'When do you want this problem solved? *': 'This quarter',
      "What's your role in the business? *": 'Owner',
      'What best describes your catering business? *': 'Food truck',
    },
  };

  it('reads the nested answers object and formats submitted_at for the sheet', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-created-lovable')!, body, port);

    expect(log.appends[0]).toMatchObject({
      Name: 'Bo Nguyen',
      EMAIL: 'bo@example.com',
      'OPTED IN DATE / TIME': '15/07/2026 2:05:06 pm',
      Campaign: 'lovable-launch',
      Audience: 'interest-2',
      Creative: 'video-b',
      'Application Completed': 'Yes',
      'What’s your approx monthly revenue from private events?': '$5k-$10k',
      "What's your biggest challenge right now?": 'Lead flow',
      'When do you want this problem solved?': 'This quarter',
      "What's your role in the business?": 'Owner',
      'What best describes your catering business?': 'Food truck',
    });
  });

  it('writes the same answer set on update as on append', async () => {
    const event = leadEventBySlug('pee-created-lovable')!;
    expect(new Set(Object.keys(event.onUpdate))).toEqual(new Set(Object.keys(event.onAppend)));
  });
});

describe('triage-call-booked mapping', () => {
  it('carries the existing row values through unchanged on update', async () => {
    const { port, log } = makePort([
      {
        rowNumber: 4,
        values: { EMAIL: 'cam@example.com', Name: 'Cam Lee', 'PHONE NUMBER': '+61422222222' },
      },
    ]);

    await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      {
        email: 'cam@example.com',
        contact: { attributionSource: { campaign: 'c', utmMedium: 'm', utmContent: 'x' } },
        customData: { 'Survey Submitted': '1/2/2026 10:00:00 am' },
      },
      port,
    );

    expect(log.updates[0]?.cells).toEqual({
      Name: 'Cam Lee',
      'PHONE NUMBER': '+61422222222',
      EMAIL: 'cam@example.com',
      Campaign: 'c',
      Audience: 'm',
      Creative: 'x',
      'OPTED IN DATE / TIME': '1/2/2026 10:00:00 am',
      'Booked Call': 'Booked',
    });
  });

  it('takes no action on an unseen lead, reproducing the source workflow', async () => {
    const { port, log } = makePort([]);
    const result = await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      {
        full_name: 'Dee Park',
        phone: '+61433333333',
        email: 'dee@example.com',
        contact: { attributionSource: { campaign: 'c2', utmMedium: 'm2' } },
        customData: { 'Survey Submitted': '3/4/2026 11:00:00 am' },
      },
      port,
    );

    // Its lookup node had alwaysOutputData off, so neither the update nor the
    // append branch ran and the lead was dropped.
    expect(result.action).toBe('skipped');
    expect(result.reason).toMatch(/alwaysOutputData off/);
    expect(log.appends).toHaveLength(0);
    expect(log.updates).toHaveLength(0);
  });
});

describe('triage-call-showed mapping', () => {
  it('writes the GHL appointment status verbatim on update', async () => {
    const { port, log } = makePort([{ rowNumber: 9, values: { EMAIL: 'ed@example.com' } }]);
    await handleLeadEvent(
      leadEventBySlug('triage-call-showed')!,
      { email: 'ed@example.com', customData: { Appt_Status: 'No Show' } },
      port,
    );
    expect(log.updates[0]?.cells).toEqual({ 'Showed Up / No Show': 'No Show' });
  });

  it('defaults a brand-new row to "Showed"', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('triage-call-showed')!, { email: 'ed@example.com' }, port);
    expect(log.appends[0]?.['Showed Up / No Show']).toBe('Showed');
  });
});

describe('pee-created mapping', () => {
  it('reproduces the original behaviour of blanking "Booked Call Strategy"', async () => {
    const { port, log } = makePort([{ rowNumber: 5, values: { EMAIL: 'fi@example.com', 'Booked Call Strategy': 'Yes' } }]);
    await handleLeadEvent(leadEventBySlug('pee-created')!, { email: 'fi@example.com' }, port);
    expect(log.updates[0]?.cells).toEqual({ 'Booked Call Strategy': '', 'Onboarded To PEE': 'Yes' });
  });
});

describe('onMissingRow, taken from each workflow lookup node', () => {
  it('matches the alwaysOutputData flag in the export', () => {
    const bySlug = Object.fromEntries(LEAD_EVENTS.map((e) => [e.slug, e.onMissingRow]));
    expect(bySlug).toEqual({
      'pee-optin': 'append',
      'pee-created': 'append',
      'pee-created-lovable': 'append',
      'strategy-call-booked': 'append',
      // The only one whose lookup node had alwaysOutputData off.
      'triage-call-booked': 'skip',
      'triage-call-showed': 'append',
    });
  });

  it('explains itself in the response for the one event that skips', () => {
    const event = LEAD_EVENTS.find((e) => e.onMissingRow === 'skip');
    expect(event?.slug).toBe('triage-call-booked');
    expect(event?.missingRowNote).toMatch(/src\/lead-tracker\/events\.ts/);
  });

  it('still updates a lead that does exist, for the skipping event', async () => {
    const { port, log } = makePort([{ rowNumber: 3, values: { EMAIL: 'in@sheet.com', Name: 'In Sheet' } }]);
    const result = await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      { email: 'in@sheet.com', contact: { attributionSource: {} }, customData: {} },
      port,
    );

    expect(result.action).toBe('updated');
    expect(log.updates[0]?.cells['Booked Call']).toBe('Booked');
  });
});

describe('DRY_RUN', () => {
  it('reports what it would do without writing to the sheet', async () => {
    useTestEnv({ DRY_RUN: 'true' });
    const { port, log } = makePort([]);

    const result = await handleLeadEvent(
      leadEventBySlug('strategy-call-booked')!,
      { email: 'dry@example.com', full_name: 'Dry Run' },
      port,
    );

    expect(result).toMatchObject({ action: 'appended', dryRun: true });
    expect(result.columnsWritten).toContain('Booked Call Strategy');
    expect(log.appends).toHaveLength(0);
    expect(log.updates).toHaveLength(0);
  });

  it('reports a would-be update without writing', async () => {
    useTestEnv({ DRY_RUN: 'true' });
    const { port, log } = makePort([{ rowNumber: 2, values: { EMAIL: 'dry@example.com' } }]);

    const result = await handleLeadEvent(
      leadEventBySlug('strategy-call-booked')!,
      { email: 'dry@example.com' },
      port,
    );

    expect(result).toMatchObject({ action: 'updated', rowNumber: 2, dryRun: true });
    expect(log.updates).toHaveLength(0);
  });
});

describe('against the live sheet header', () => {
  it('has the 40 columns the sheet has, in order', () => {
    expect(HEADER).toHaveLength(40);
    expect(HEADER[0]).toBe('Name');
    expect(HEADER[39]).toBe('Booked Call Strategy');
  });

  it('maps only columns that exist, across every event and both branches', () => {
    const unknown: string[] = [];
    for (const event of LEAD_EVENTS) {
      for (const column of [...Object.keys(event.onUpdate), ...Object.keys(event.onAppend)]) {
        if (!HEADER.includes(column)) unknown.push(`${event.slug}: ${JSON.stringify(column)}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('keeps the exact characters the sheet uses, not lookalikes', () => {
    // A curly apostrophe in the revenue column, straight ones in three others,
    // and a literal newline in the strategy column.
    expect(HEADER).toContain('What’s your approx monthly revenue from private events?');
    expect(HEADER).not.toContain("What's your approx monthly revenue from private events?");
    expect(HEADER).toContain("What's your biggest challenge right now?");
    expect(HEADER).toContain('Strategy Call Booked\nThrough Funnel');
  });

  it('leaves the parallel triage funnel column alone, as the workflows did', () => {
    // The sheet has "Triage Call Booked\nTHrough Funnel" (sic) alongside the
    // strategy equivalent, but no workflow ever wrote it — triage-call-booked
    // sets "Booked Call" instead. Reproduced, not corrected.
    expect(HEADER).toContain('Triage Call Booked\nTHrough Funnel');
    const allMapped = LEAD_EVENTS.flatMap((e) => [...Object.keys(e.onUpdate), ...Object.keys(e.onAppend)]);
    expect(allMapped).not.toContain('Triage Call Booked\nTHrough Funnel');
  });
});

describe('emptyColumns', () => {
  it('names every mapped column the payload had no value for', async () => {
    const { port } = makePort([]);
    // Only the top-level fields are present — exactly what GoHighLevel sent
    // when the webhook action had no custom data configured.
    const result = await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      { full_name: 'Partial Payload', phone: '614125550987', email: 'partial@example.com' },
      port,
    );

    expect(result.action).toBe('appended');
    // "OPTED IN DATE / TIME" is absent: stamped on arrival, never read from
    // the payload, so it cannot come back empty.
    expect(result.emptyColumns).toEqual([
      'Campaign',
      'Audience',
      'Creative',
      'PIC',
      'What’s your approx monthly revenue from private events?',
      'Do you currently have a way of generating consistent private event enquiries?',
    ]);
  });

  it('is empty when the payload carries everything', async () => {
    const { port } = makePort([]);
    const result = await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      {
        full_name: 'Full Payload',
        phone: '614125550987',
        email: 'full@example.com',
        PIC: 'Sam',
        contact: {
          attributionSource: { campaign: 'c', utmMedium: 'm' },
          lastAttributionSource: { utmContent: 'x' },
        },
        customData: { 'Survey Submitted Date': '12/10/2026 9:15:00 am' },
        'What’s your approx monthly revenue from private events? ': '$10k',
        'Do you currently have a way of generating consistent private event enquiries? ': 'No',
      },
      port,
    );

    expect(result.emptyColumns).toEqual([]);
  });
});

describe('opt-in timestamp on PEE Optin', () => {
  it('stamps the arrival time rather than leaving it blank', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-optin')!, { email: 'stamp@example.com' }, port);

    const stamped = log.appends[0]?.['OPTED IN DATE / TIME'] ?? '';
    // dd/mm/yyyy h:mm:ss am — the shape the sheet already uses.
    expect(stamped).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2}:\d{1,2} (am|pm)$/);
  });

  it('renders it in the configured zone, not UTC', async () => {
    const { port, log } = makePort([]);
    const before = new Date();
    await handleLeadEvent(leadEventBySlug('pee-optin')!, { email: 'tz@example.com' }, port);

    const [datePart] = (log.appends[0]?.['OPTED IN DATE / TIME'] ?? '').split(' ');
    const expected = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(before);
    expect(datePart).toBe(expected);
  });

  it('is no longer sourced from customData, which GoHighLevel never sent', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      { email: 'ignored@example.com', customData: { 'Survey Submitted Date': '1/1/2020 1:00:00 am' } },
      port,
    );
    expect(log.appends[0]?.['OPTED IN DATE / TIME']).not.toBe('1/1/2020 1:00:00 am');
  });

  it('no longer reports the opt-in column as empty', async () => {
    const { port } = makePort([]);
    const result = await handleLeadEvent(leadEventBySlug('pee-optin')!, { email: 'a@b.com' }, port);
    expect(result.emptyColumns).not.toContain('OPTED IN DATE / TIME');
  });
});

describe('protecting existing values on update', () => {
  const populated = {
    EMAIL: 'has@data.com',
    Name: 'Has Data',
    'PHONE NUMBER': '61400000000',
    Campaign: 'Original campaign',
    Audience: 'Original audience',
    Creative: 'Original creative',
    'OPTED IN DATE / TIME': '01/01/2026 9:00:00 am',
  };

  it('does not blank a populated cell when the webhook omits that field', async () => {
    const { port, log } = makePort([{ rowNumber: 5, values: populated }]);

    // Triage Call Booked maps Campaign/Audience/Creative/opt-in date, but this
    // payload carries none of them.
    const result = await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      { email: 'has@data.com' },
      port,
    );

    expect(result.action).toBe('updated');
    expect(result.preservedColumns).toEqual(
      expect.arrayContaining(['Campaign', 'Audience', 'Creative', 'OPTED IN DATE / TIME']),
    );

    const written = log.updates[0]?.cells ?? {};
    expect(written).not.toHaveProperty('Campaign');
    expect(written).not.toHaveProperty('Audience');
    expect(written).not.toHaveProperty('Creative');
    expect(written).not.toHaveProperty('OPTED IN DATE / TIME');
    // The value it does carry still lands.
    expect(written['Booked Call']).toBe('Booked');
  });

  it('still writes a value when the webhook does carry one', async () => {
    const { port, log } = makePort([{ rowNumber: 5, values: populated }]);
    await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      {
        email: 'has@data.com',
        contact: { attributionSource: { campaign: 'NEW campaign', utmMedium: 'NEW audience' } },
      },
      port,
    );

    const written = log.updates[0]?.cells ?? {};
    expect(written['Campaign']).toBe('NEW campaign');
    expect(written['Audience']).toBe('NEW audience');
    expect(written).not.toHaveProperty('Creative');
  });

  it('keeps a deliberate blank, so pee-created still clears Booked Call Strategy', async () => {
    const { port, log } = makePort([
      { rowNumber: 6, values: { EMAIL: 'x@y.com', 'Booked Call Strategy': 'Yes' } },
    ]);
    const result = await handleLeadEvent(leadEventBySlug('pee-created')!, { email: 'x@y.com' }, port);

    // constant('') is marked literal, so protection does not apply to it.
    expect(log.updates[0]?.cells).toEqual({ 'Booked Call Strategy': '', 'Onboarded To PEE': 'Yes' });
    expect(result.preservedColumns).toEqual([]);
  });

  it('reports nothing preserved when the existing cell was empty anyway', async () => {
    const { port, log } = makePort([{ rowNumber: 7, values: { EMAIL: 'blank@y.com', Campaign: '' } }]);
    const result = await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      { email: 'blank@y.com' },
      port,
    );

    expect(result.preservedColumns).not.toContain('Campaign');
    expect(log.updates[0]?.cells).not.toHaveProperty('Campaign');
  });

  it('leaves appends untouched — a new row has nothing to protect', async () => {
    const { port, log } = makePort([]);
    const result = await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      { email: 'new@y.com' },
      port,
    );
    expect(result.preservedColumns).toEqual([]);
    // triage-call-booked skips unseen emails, so nothing is written at all.
    expect(result.action).toBe('skipped');
    expect(log.appends).toHaveLength(0);
  });
});

describe('GoHighLevel attribution, as actually sent', () => {
  // Captured from a live PEE Optin webhook: GHL flattens its fields to the top
  // level and sends an empty customData object.
  const ghlPayload = {
    contact_id: 'vKia7mGw2zTQzF8jc15f',
    first_name: 'test',
    last_name: 'rehan',
    full_name: 'test rehan',
    email: 'rehanzafar22211@gmail.com',
    phone: '+613000000001',
    utm_medium: 'paid_social',
    utm_campaign: '120248317508630046',
    utm_content: '120248514540750046',
    utm_source: '',
    'Monthly Catering Revenue': '$40,000+/month',
    PIC: '',
    Audience: '',
    Creative: '',
    customData: {},
    contact: {
      attributionSource: { sessionSource: 'CRM Workflows', medium: 'Manual', mediumId: null },
      lastAttributionSource: {},
    },
  };

  it('maps utm_campaign, utm_medium and utm_content to Campaign, Audience and Creative', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-optin')!, ghlPayload, port);

    expect(log.appends[0]).toMatchObject({
      Campaign: '120248317508630046',
      Audience: 'paid_social',
      Creative: '120248514540750046',
    });
  });

  it('picks up the revenue answer under its current field name', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(leadEventBySlug('pee-optin')!, ghlPayload, port);
    expect(log.appends[0]?.['What’s your approx monthly revenue from private events?']).toBe(
      '$40,000+/month',
    );
  });

  it('no longer reports those four as empty', async () => {
    const { port } = makePort([]);
    const result = await handleLeadEvent(leadEventBySlug('pee-optin')!, ghlPayload, port);

    for (const column of [
      'Campaign',
      'Audience',
      'Creative',
      'What’s your approx monthly revenue from private events?',
    ]) {
      expect(result.emptyColumns).not.toContain(column);
    }
  });

  it('still reads the legacy nested paths when a sender uses them', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      {
        email: 'legacy@example.com',
        contact: {
          attributionSource: { campaign: 'old-campaign', utmMedium: 'old-medium' },
          lastAttributionSource: { utmContent: 'old-content' },
        },
      },
      port,
    );

    expect(log.appends[0]).toMatchObject({
      Campaign: 'old-campaign',
      Audience: 'old-medium',
      Creative: 'old-content',
    });
  });

  it('prefers the utm fields over the legacy nested ones when both are present', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(
      leadEventBySlug('pee-optin')!,
      {
        email: 'both@example.com',
        utm_campaign: 'new-campaign',
        contact: { attributionSource: { campaign: 'old-campaign' } },
      },
      port,
    );
    expect(log.appends[0]?.['Campaign']).toBe('new-campaign');
  });

  it('applies the same resolution to Triage Call Booked', async () => {
    const { port, log } = makePort([{ rowNumber: 9, values: { EMAIL: 'known@example.com' } }]);
    await handleLeadEvent(
      leadEventBySlug('triage-call-booked')!,
      { ...ghlPayload, email: 'known@example.com' },
      port,
    );

    expect(log.updates[0]?.cells).toMatchObject({
      Campaign: '120248317508630046',
      Audience: 'paid_social',
      Creative: '120248514540750046',
    });
  });

  it('leaves the Lovable funnel on its own field names', async () => {
    const { port, log } = makePort([]);
    await handleLeadEvent(
      leadEventBySlug('pee-created-lovable')!,
      { email: 'lovable@example.com', campaign: 'lov-camp', utmMedium: 'lov-med', utmContent: 'lov-con' },
      port,
    );

    expect(log.appends[0]).toMatchObject({
      Campaign: 'lov-camp',
      Audience: 'lov-med',
      Creative: 'lov-con',
    });
  });
});
