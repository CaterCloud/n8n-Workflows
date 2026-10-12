# Deploying to Railway

> **Already provisioned.** Project `n8n-workflows`, service
> `catercloud-lead-tracker`, environment `production`, deployed from branch
> `claude/elegant-faraday-a9i2u8` at
> `https://catercloud-lead-tracker-production.up.railway.app`. The steps below
> are the record of how, and what to repeat for a second environment.

## 1. Create the service

Point a Railway service at this repository. `railway.json` selects the
`Dockerfile` builder, sets `/health` as the healthcheck, and pins
`numReplicas: 1` (the append lock is process-local — see
[the operational notes](../README.md#operational-notes)).

No database or volume is needed. Nothing is persisted between requests.

## 2. Set the variables

Copy [`.env.example`](../.env.example) into the service's variables. Minimum
for a first boot:

```
TIMEZONE=Australia/Sydney
LEAD_SHEET_ID=1XETq_e721_67XJgyWPBC365HhAxCojrSwdVCkDVzTjw
LEAD_SHEET_NAME=PEE 
WEBHOOK_SECRET=<generate one>
ADMIN_TOKEN=<generate one>
DRY_RUN=true
```

`LEAD_SHEET_NAME` ends in a space. Keep it — that is the tab's real name.

Generate the secrets with `openssl rand -hex 32`.

**Set `PORT=3000` explicitly.** Railway injects `PORT=8080` when the variable is
unset, while a generated service domain is pinned to whichever `targetPort` it
was created with. If the two disagree the service is healthy but the domain
returns nothing — the deploy log says `listening ... "port":8080` and every
request 502s. Pinning both to 3000 keeps them aligned. (The alternative is to
leave `PORT` unset and point the domain at 8080 instead; either works, as long
as they match.)

Then add the three Google variables from [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md).

## 3. Confirm it is up

```bash
curl https://<service>.up.railway.app/health
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/ready
```

`/ready` reports a boolean per dependency, so you can see what is missing
without any value being echoed back:

```json
{
  "ok": true,
  "timezone": "Australia/Sydney",
  "dryRun": true,
  "sheetName": "PEE ",
  "configured": { "google": true, "leadSheet": true, "webhookSecret": true, "adminToken": true },
  "events": 6
}
```

Then check the service can actually read the spreadsheet, and that the header
still matches what the events expect:

```bash
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/admin/lead/sheet
```

`missingFromSheet` should be `[]`. Anything listed there is a column an event
maps that the sheet does not have — usually a renamed header.

## 4. Point GoHighLevel at it

For each of the six webhooks, change only the host. The paths are unchanged:

```
https://<old-n8n-host>/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a
https://<service>.up.railway.app/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a
```

`GET /webhooks/lead` lists all six. With `WEBHOOK_SECRET` set, add an
`x-webhook-secret` header on the GoHighLevel side; if custom headers are
awkward there, append `?secret=<value>` to the URL instead.

While `DRY_RUN=true` the service accepts each webhook, resolves the full
mapping, logs what it would write, and returns it — without touching the
sheet. Fire a real event from GoHighLevel and read the response:

```bash
curl -X POST https://<service>.up.railway.app/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"email":"you@example.com","full_name":"Test Lead","phone":"+61400000000"}'
```

```json
{ "ok": true, "action": "appended", "dryRun": true, "columnsWritten": ["Name","PHONE NUMBER", "…"] }
```

Check `columnsWritten` carries what you expect and `unknownColumns` is empty.
Then set `DRY_RUN=false` and fire one more to see the row land.

Once all six look right, disable the six n8n workflows. Leave them disabled
rather than deleted for a week or so, in case you want to compare.

### A note on Triage Call Booked

That one returns `"action":"skipped"` for an email not already in the sheet.
That is the original behaviour, reproduced deliberately — see
[N8N-MAPPING.md](N8N-MAPPING.md#triage-call-booked-drops-leads-it-has-not-seen-before).
If you would rather capture those leads, change `onMissingRow` to `'append'`
for that event in `src/lead-tracker/events.ts` and redeploy.

### Rollback

Re-enable the n8n workflows and point GoHighLevel back at the old host.
Nothing here holds state, so there is nothing to unwind. `DRY_RUN=true` is the
softer option: the service keeps accepting webhooks but stops writing.

## Operational notes

- The image installs `tzdata` so `Intl` can resolve `Australia/Sydney` on
  Alpine.
- Each webhook is one sheet read plus one write, typically well under a
  second. The work happens on the request path, so GoHighLevel sees a real
  success or failure rather than a blind 200.
- Writes are serialised per spreadsheet, so a burst of webhooks queues rather
  than racing. A long queue shows up as slower responses, not duplicate rows.
- Google 4xx/5xx responses surface as `502` with Google's own message, which
  is usually enough to tell a permission problem from a renamed tab.
