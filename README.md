# catercloud-lead-tracker

The six GoHighLevel → Google Sheets lead workflows, rebuilt from their n8n
exports as one deployable Node service.

Each one was the same four nodes — webhook, look a lead up by `EMAIL` in the
"PEE Optin - Utm" spreadsheet, then update that row or append a new one. Only
the webhook path and the column mapping differed, so those are the only things
that differ here: they live as data in
[`src/lead-tracker/events.ts`](src/lead-tracker/events.ts).

Behaviour is kept as per the exported workflows, including the quirks. Where a
workflow did something surprising, it is reproduced and documented rather than
silently corrected — see [docs/N8N-MAPPING.md](docs/N8N-MAPPING.md).

## The six webhooks

Every original n8n path stays mounted, so on the GoHighLevel side you only
change the host.

| Event | Path (unchanged from n8n) | On a new email |
| --- | --- | --- |
| PEE Optin | `/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a` | appends |
| PEE Created | `/webhook/57ec9f62-fdfa-48ac-b7e8-7cfda0cf5086` | appends |
| PEE Created (Lovable) | `/webhook/1c3ea975-d68b-43f6-839a-859d39e29b8f` | appends |
| Strategy Call Booked | `/webhook/7fa7f14d-abe9-4b1d-ab92-47507dc01f31` | appends |
| Triage Call Booked | `/webhook/ca65bbff-4b05-4c0d-9c32-4de734336cd5` | **skips** ⚠️ |
| Triage Call Showed | `/webhook/42a66325-4037-4f75-a3e5-5edecde0cd83` | appends |

Readable aliases exist too — `/webhooks/lead/pee-optin`,
`/webhooks/lead/triage-call-booked`, and so on. Both forms do the same thing.

> ⚠️ Triage Call Booked takes **no action** when the email is not already in the
> sheet. That is what its workflow did: its lookup node was the only one with
> `alwaysOutputData` off, so an unseen email reached neither the update nor the
> append branch. It is reproduced on purpose. The response says
> `"action":"skipped"` with the reason, so it is visible rather than silent. To
> capture those leads instead, change `onMissingRow` to `'append'` for that
> event in `src/lead-tracker/events.ts`.

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in — see docs/GOOGLE-OAUTH.md
npm test
npm run dev
```

Set `DRY_RUN=true` to accept webhooks and log exactly what would be written
without touching the spreadsheet. Good for pointing GoHighLevel at the service
and watching real payloads arrive before anything is committed to the sheet.

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Railway's healthcheck target. |
| `GET` | `/ready` | Whether Google and the sheet are configured. Booleans only, never values. |
| `GET` | `/webhooks/lead` | Lists all six events with both URL forms and their column mappings. |
| `POST` | `/webhooks/lead/:slug` | Receives a lead event by readable name. |
| `POST` | `/webhook/:uuid` | The original n8n paths. |
| `GET` | `/admin/lead/sheet` | Reads the live sheet header and flags any mapped column the sheet is missing. |
| `GET` | `/admin/lead/recent` | The last few webhook payloads and their flattened shape, while `WEBHOOK_CAPTURE` is on. |

Responses are JSON: `{"ok":true,"action":"updated","rowNumber":42,...}`.

Each response also carries `emptyColumns` (mapped columns the payload had no
value for) and `preservedColumns` (columns left alone on an update because the
webhook carried nothing and the sheet already held a value). A long list there means the sender is not sending what the mapping
expects, which is far easier to spot than a quietly blank cell. To see the
payload itself, set `WEBHOOK_CAPTURE=true`, re-send, and read
`/admin/lead/recent`; turn it back off afterwards, since it holds real lead
data in memory.

Status codes: `400` the payload has no email to match on, `401` bad or missing
secret, `404` unknown event, `502` Google Sheets refused, `503` the service is
missing configuration.

### Auth

`WEBHOOK_SECRET` gates the webhook routes; `ADMIN_TOKEN` gates `/admin/*`. Each
is accepted as an `x-webhook-secret` header, an `Authorization: Bearer` header,
or a `?secret=` query parameter, and compared in constant time. Both are unset
by default, which leaves the routes open — set them before going live.

## Layout

```
src/
  env.ts                    zod-validated environment
  http/server.ts            routes, auth, error mapping
  integrations/
    google-auth.ts          service-account or OAuth client (spreadsheets scope only)
    sheets.ts               read table, find row, update cells, append row
  lead-tracker/
    events.ts               the six events as data: paths and column mappings
    handler.ts              look up, then update, append or skip
  lib/
    dates.ts                the en-AU date format the sheet already uses
    text.ts                 payload path reader
    mutex.ts                per-spreadsheet append lock
    errors.ts               config, payload and Google error shapes
reference/n8n/              the six source exports, credentials redacted
```

## Operational notes

- **Single replica.** The read/update/append cycle is serialised with an
  in-process lock, so two webhooks arriving together for the same new email
  cannot both append. That holds for one instance; `numReplicas` is pinned to 1
  in `railway.json`. More replicas would need a shared lock.
- **Only mapped cells are written.** An update touches just the columns the
  event maps, by targeted range, so a column someone edited by hand in the same
  row is left alone.
- **Email matching** is trimmed and case-insensitive, since the existing sheet
  has inconsistently cased addresses. An empty email never matches a blank
  cell — it is rejected with a 400 instead.
- **Unknown columns are reported, not fatal.** If a mapped column is missing
  from the sheet it is logged, returned in `unknownColumns`, and the rest of the
  row is still written. `/admin/lead/sheet` lists these against the live header.

## Docs

- [docs/N8N-MAPPING.md](docs/N8N-MAPPING.md) — the six workflows, their mappings, and their quirks
- [docs/RAILWAY-DEPLOY.md](docs/RAILWAY-DEPLOY.md) — deploying and cutting over
- [docs/GOOGLE-OAUTH.md](docs/GOOGLE-OAUTH.md) — giving the service access to the spreadsheet
- [docs/SECRETS.md](docs/SECRETS.md) — credentials found in the export, and rotation
