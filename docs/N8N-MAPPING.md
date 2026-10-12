# n8n → code mapping

What each of the 29 exported workflow files became, what behaviour changed, and
the defects found while porting.

## File inventory

### Social posting — 12 files, 5 real locations

Every one of these was the same 16-node graph (cron → GHL location fetch →
Drive image list → random pick → Drive download → Cloudinary upload → enhance
→ brand brief → GPT caption → build payload → POST to GHL), duplicated and
hand-edited per client. They are now one engine plus a config entry.

| File | Workflow name | Became |
| --- | --- | --- |
| `0Qi0jdNZ2ZaRtSzD` | Junction Cafe GHL + N8N Socai Media Posting | client `junction-cafe` |
| `3FUN0IaRvnJRa6ye` | Spanish Paella … Monthly | client `spanish-paella` |
| `UziQikocYoifIS0N` | Avo Shack … Monthly | client `avo-shack` |
| `oocoqoafCHhObq1N` | Madame Cue … | client `madame-cue` |
| `ywrfXE1qReeYxvL2` | Madison Ave … | client `madison-ave` |
| `eVtX1Ec9mO1vQg52` | Junction Cafe … | **dropped** — targets Spanish Paella's location while loading Avo Shack's brand brief |
| `SkjeLFXpWNDKCMSF` | Junction Cafe … copy | **dropped** — byte-identical to the above |
| `2Xf31aVnLL2FtJAf` | Spanish Paella … | **dropped** — same location as `3FUN0IaR`, weekday cron `0 10 * * 1-5`; running both double-posts |
| `6aLYMdgYY0wWU9dq` | Spanish Paella … Monthly (Single Day) | **dropped** — same location, cron `0 10 26 * *` |
| `s5KTjcIYG10RWoE4` | GHL + N8N Socai Media Posting | **dropped** — earlier Avo Shack revision, no brand brief |
| `xoPDsy9DmGN4gtyj` | GHL + N8N Socai Media Posting Update | **dropped** — Avo Shack revision |
| `NLmHTl2oXzJjLFDb`, `JVlmagg17Oj8qjJf` | GHL + N8N (Update) | **dropped** — 12-node Avo Shack predecessors, no Cloudinary step |

Five clients, three Spanish Paella schedules and three Avo Shack copies: the
export had **three live crons pointed at the same GoHighLevel location** for
both. Only one schedule per client is configured here. If a client genuinely
needs two cadences, add a second entry to its `schedules` array.

### Lead tracker — 6 files

All six were webhook → look up row by `EMAIL` → update or append, against the
same spreadsheet (`1XETq_e721_67XJgyWPBC365HhAxCojrSwdVCkDVzTjw`, tab `PEE `).
Only the webhook path and the column mapping differed, so only those are data
now — see [`src/lead-tracker/events.ts`](../src/lead-tracker/events.ts).

| File | Slug | Original webhook path |
| --- | --- | --- |
| `0h49jZmxl5RdpPgn` | `pee-optin` | `b7cfa33b-4a60-41ea-8b89-23cac76f335a` |
| `CfH7Lc5XbT0HYxgr` | `pee-created` | `57ec9f62-fdfa-48ac-b7e8-7cfda0cf5086` |
| `K0eEuL7CwPX7Tqdt` | `pee-created-lovable` | `1c3ea975-d68b-43f6-839a-859d39e29b8f` |
| `ZH0wQZ7JHzBHUmb9` | `strategy-call-booked` | `7fa7f14d-abe9-4b1d-ab92-47507dc01f31` |
| `fDNiAbyCeuHsUwMr` | `triage-call-booked` | `ca65bbff-4b05-4c0d-9c32-4de734336cd5` |
| `Sq3QaIgb3jpbU6yk` | `triage-call-showed` | `42a66325-4037-4f75-a3e5-5edecde0cd83` |

Those paths stay mounted at `/webhook/<uuid>`, so the GoHighLevel side only
needs its host swapped.

### Not in scope for this pass

Per your call, these were left out. Each was a template or demo rather than a
running automation:

| File | Why it was skipped |
| --- | --- |
| `xLCdC3OYKpIOmx3o` + 2 copies | GHL contact notes → Sheets. Hardcoded `page=77` on a single API call, so it only ever read one page of contacts. |
| `3kyRzdcKBReipDI5` | Bi-daily invoice/transaction sync. Unfinished: `googleSheetId` is `<__PLACEHOLDER_VALUE__…>` and most field mappings are empty strings. |
| `PwclcL17U8AcCY3y` | HL + N8N manual upload form. Template with `<YOUR LOCATION ID>` placeholders; its `Set all`, `Set Image` and `Merge` nodes are not wired to anything. |
| `XaYE8UYmG7IGpVlV` | CSM Operations Assistant (WhatsApp). Every config value is a placeholder, including the ClickUp team and list IDs. |
| `s3gizEqgOkXoeV9H` | WhatsApp image studio. Contains literal `"Bearer API KEY"`, `LOCATIONID`, `ACCOUNTID`, `USERID` strings. |
| `TJRa1Loc5Oso1VvH` | The stock n8n "Daily AI Summary" demo — RSS → agent → Gmail, with its tutorial sticky notes intact. |
| `ozF6gksFTr4E3xaY` | Social Media Scheduler. Superseded and broken: its Drive node has no folder filter, and `Select & Rotate Content` initialises `rotationHistory = {}` on every run, so its 30-day reuse check can never fire. |
| `Wi99nMd3NxtgGPQE` | Empty — zero nodes. |

The architecture here takes them without restructuring: another `src/<family>/`
module, a route or a cron entry.

## Defects found in the originals

### Scheduled post times were in the wrong timezone

`Create Post` built its dates with `new Date(y, m, d + 1, 10, 0)` — the n8n
host's *local* clock — then called `.toISOString()`, in a helper named
`nextNDatesUTC`. On a UTC host that scheduled Australian cafe posts for 10:00
UTC, i.e. 8pm or 9pm Sydney depending on daylight saving.

Now explicit: `SCHEDULE_TIMEZONE` (default `Australia/Sydney`) is applied via
`Intl`, so 10:00 means 10:00 locally on both sides of a DST change.
[`src/lib/dates.ts`](../src/lib/dates.ts), covered by `test/dates.test.ts`.

### Madison Ave could never post

Its `ACCOUNT_IDS` array was empty, so every payload it built carried
`accountIds: []` and GoHighLevel would reject all 30 posts. It is configured
`accountIds: 'auto'` here, which reads the live account list from
`/social-media-posting/{locationId}/accounts` and skips expired connections.

### Madame Cue carries the wrong API token

Its `Post GHL` node posts to `mqdAQkVtmwpoXe1eJ828` with Junction Cafe's
location-scoped PIT in the `Authorization` header. In n8n the node also had an
OAuth2 credential named "Madame Cue" attached, which is what actually authorised
the request — the hand-written header was dead weight. This service sends only
the configured token, so Madame Cue needs its own PIT before it can post. See
[SECRETS.md](SECRETS.md#which-token-each-client-needs).

### Madame Cue fires once a year

Its cron is `0 10 4 3 *` — 10:00 on 4 March, annually. Every sibling workflow
uses a day-of-month pattern, so this looks like a leftover test value. It is
reproduced as-is rather than silently changed. For a monthly batch:

```
SOCIAL_CLIENT_OVERRIDES={"madame-cue":{"schedules":[{"name":"monthly","cron":"0 10 4 * *","imageCount":30,"minImages":30}]}}
```

or edit `src/social-posting/clients.ts`.

### Per-platform captions were generated and thrown away

The prompt asks for Instagram, Facebook, GMB and TikTok variants, and `Code2`
parsed all four. `Create Post` then sent only the base `caption` to every
account, so the tailored copy — hashtags for Instagram, no emoji for GMB — was
never used, and the TikTok variant was dropped entirely.

The variants are preserved. Setting `perPlatformCaptions: true` on a client
sends one post per platform carrying that platform's caption; the default stays
faithful to the old single-post behaviour.

### "Fresh from The Avo Shack" on every brand

The caption fallback in `Create Post` was hardcoded to `The Avo Shack` in all
twelve files, including Junction Cafe's and Madame Cue's. It now uses the
client's own `brandName`.

### Private-event promotion never happened

The prompt documents "Promote Private Events (bool ~50% of posts)" and branches
on it, but no upstream node ever set `promote_private_event`, so it evaluated
to `false` on every run and the private-catering CTA never appeared.

Now driven by `promotePrivateEventProbability`, defaulting to `0.5` to match the
prompt's stated intent. Set it to `0` per client to restore the old behaviour.

### `triage-call-booked` silently dropped new leads

Its "Get row(s) in sheet" node had `alwaysOutputData` **off**, unlike the other
five. With no matching row the node emitted nothing, the `If` never ran, and
neither the update nor the append branch fired — the lead vanished with the
execution recorded as successful. It appends here, like its siblings.

### Row updates reverted concurrent manual edits

n8n's "Update row in sheet" rewrote the whole row it had read. Anyone editing
another column in that row between the read and the write lost their change.
Only the mapped cells are written now, via a batched range update.

### `pee-created` blanks a column

Its update branch writes `''` to `Booked Call Strategy` while setting
`Onboarded To PEE` to `Yes` — so onboarding a client clears whether they booked
a strategy call. This is **reproduced as-is**; it may well be a mistake. To stop
it, remove that line from `onUpdate` in
[`src/lead-tracker/events.ts`](../src/lead-tracker/events.ts).

### Form field names carry trailing spaces

The GHL survey fields arrive as
`What’s your approx monthly revenue from private events? ` — with a trailing
space and a curly apostrophe — while the sheet column has no trailing space.
The mappers try both spellings, so a tidy-up on the GHL side will not silently
start writing blanks.

## Behaviour deliberately kept

- Emoji are stripped from post summaries (`stripEmojis: true`), because GHL's
  Google Business Profile channel rejects them. Per-client switch.
- Posts are created with `status: scheduled` and `mediaOptimization: true`.
- Images are picked uniformly at random, with no reuse history.
- A caption that fails to parse falls back to `"Default caption"`, matching the
  `Code2` node. It is logged at `warn` with the model's raw output.
- The legacy v1 `locations/{id}` call is still made when `GHL_AGENCY_JWT` is
  set. Its body went unused in n8n, so it is treated as an advisory
  pre-flight: a failure is recorded as a warning and the run continues.
