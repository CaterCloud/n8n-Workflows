# n8n → code mapping

The six lead workflows, what each writes, and the quirks reproduced from the
export.

## The shared shape

All six were identical in structure:

```
Webhook (POST)
  └─ Get row(s) in sheet   filter: EMAIL = {{ $json.body.email }}
       └─ If  row_number exists / notEmpty
            ├─ true  → Update row in sheet
            └─ false → Append row in sheet
```

Same spreadsheet throughout: `1XETq_e721_67XJgyWPBC365HhAxCojrSwdVCkDVzTjw`
("PEE Optin - Utm"), tab gid `2130596273`, whose title is `PEE ` — with a
trailing space, which the A1 ranges have to quote.

Only the webhook path and the two column mappings differed between them, so
those are the only per-event data in
[`src/lead-tracker/events.ts`](../src/lead-tracker/events.ts).

| Source file | Slug | Webhook path | `onMissingRow` |
| --- | --- | --- | --- |
| `0h49jZmxl5RdpPgn` | `pee-optin` | `b7cfa33b-4a60-41ea-8b89-23cac76f335a` | append |
| `CfH7Lc5XbT0HYxgr` | `pee-created` | `57ec9f62-fdfa-48ac-b7e8-7cfda0cf5086` | append |
| `K0eEuL7CwPX7Tqdt` | `pee-created-lovable` | `1c3ea975-d68b-43f6-839a-859d39e29b8f` | append |
| `ZH0wQZ7JHzBHUmb9` | `strategy-call-booked` | `7fa7f14d-abe9-4b1d-ab92-47507dc01f31` | append |
| `fDNiAbyCeuHsUwMr` | `triage-call-booked` | `ca65bbff-4b05-4c0d-9c32-4de734336cd5` | **skip** |
| `Sq3QaIgb3jpbU6yk` | `triage-call-showed` | `42a66325-4037-4f75-a3e5-5edecde0cd83` | append |

## What each event writes

**pee-optin** — Update: `Application Completed` = Yes, `EMAIL`, and the two
survey answers. Append: name, phone, email, campaign/audience/creative from
`contact.attributionSource` (creative from `lastAttributionSource`), `PIC`,
both survey answers, `Application Completed` = Yes, and
`OPTED IN DATE / TIME` from `customData['Survey Submitted Date']`.

**pee-created** — Update: `Onboarded To PEE` = Yes, and `Booked Call Strategy`
set to an empty string. Append: name, phone, email, `Onboarded To PEE` = Yes.

**pee-created-lovable** — The Lovable funnel. Its answers arrive nested under
`answers`, keyed by the full question text with a trailing ` *`.
`OPTED IN DATE / TIME` comes from `submitted_at`, formatted. Update and append
write the same thirteen columns.

**strategy-call-booked** — Both branches set `Booked Call Strategy` = Yes and
`Strategy Call Booked\nThrough Funnel` = Yes. That second column name contains
a literal newline in the sheet header, and is reproduced exactly.

**triage-call-booked** — Update: campaign/audience/creative from
`contact.attributionSource`, `OPTED IN DATE / TIME` from
`customData['Survey Submitted']`, `Booked Call` = Booked, plus `Name`,
`PHONE NUMBER` and `EMAIL` written back from the row it just read (the
original's `{{ $json.Name }}` self-references — no-ops, kept for fidelity).
Append exists in the workflow but was unreachable; see below.

**triage-call-showed** — Update: `Showed Up / No Show` from
`customData.Appt_Status`, verbatim. Append defaults it to `Showed`.

## Quirks reproduced from the export

These are faithful to the workflows, not improvements. Each is a one-line
change in `src/lead-tracker/events.ts` if you want it different.

### triage-call-booked drops leads it has not seen before

Its `Get row(s) in sheet` node is the only one of the six with
`alwaysOutputData` **off**. With that flag on — as the other five have it — an
empty lookup still emits one item, `row_number` is absent, the `If` goes false
and the append branch runs. With it off the node emits nothing at all, so
neither branch runs and the webhook completes having done nothing. The
execution is recorded as successful.

So any lead whose email is not already in the sheet when the triage booking
fires is lost. The workflow has a fully wired append branch that can never be
reached.

This service reproduces that, with `onMissingRow: 'skip'`. The difference is
that it is no longer silent: the response is

```json
{ "ok": true, "action": "skipped", "matchValue": "…", "reason": "Reproduced from the source workflow: …" }
```

and it is logged at `warn`. Set `onMissingRow: 'append'` for that event to
capture the leads instead — the append mapping is already there.

### pee-created blanks "Booked Call Strategy"

Its update branch writes `''` to `Booked Call Strategy` while setting
`Onboarded To PEE` = Yes. Onboarding a client therefore clears whether they
had booked a strategy call. Reproduced as-is. To stop it, remove that line
from `onUpdate` for `pee-created`.

### Survey field names carry trailing spaces

The GoHighLevel form fields arrive as
`What’s your approx monthly revenue from private events? ` — trailing space,
curly apostrophe — while the sheet column has no trailing space. The mappers
try both spellings, so tidying the GoHighLevel side later will not quietly
start writing blanks.

### "OPTED IN DATE / TIME" formatting

Two different sources. Most events copy a GoHighLevel `customData` string
straight through. The Lovable event formats `submitted_at` with
`toLocaleString('en-AU', …).replace(',', '')`, which yields
`15/07/2026 2:05:06 pm` — `en-AU` applies its own short-date pattern, so day
and month are zero-padded despite `numeric`. Reproduced exactly, since that is
the shape already in the sheet. The zone is `TIMEZONE`, defaulting to
`Australia/Sydney` — the one value declared anywhere in the export.

## Deliberate differences

Two, both invisible in what lands in the sheet:

- **Targeted cell writes.** An update writes only the columns the event maps,
  as individual ranges, rather than rewriting the row. Same values, but a
  column a human edited in the same row between the read and the write is not
  clobbered.
- **Lenient email matching.** Trimmed and case-insensitive, because the sheet
  holds inconsistently cased addresses. n8n's lookup was stricter, so a few
  leads that previously appended as duplicates will now correctly update the
  existing row. An empty email matches nothing and is rejected with a 400.

## Not included

The rest of the export — social media posting, contact notes sync, invoice
sync, and the WhatsApp/form/news templates — is out of scope for this service.
Their redacted copies are not kept here; the originals are in the workflow
export, and a previous revision of this repository contains a full
implementation of the social posting side if it is ever wanted.
