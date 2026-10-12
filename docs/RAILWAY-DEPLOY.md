# Deploying to Railway

## 1. Create the service

Point a Railway service at this repository. `railway.json` selects the
`Dockerfile` builder, sets `/health` as the healthcheck, and pins
`numReplicas: 1` (the lead tracker's append lock is process-local — see
[the operational notes](../README.md#operational-notes)).

No database or volume is needed. Nothing is persisted between runs.

## 2. Set the variables

Copy [`.env.example`](../.env.example) into the service's variables and fill it
in. Minimum for a first boot:

```
SCHEDULE_TIMEZONE=Australia/Sydney
SOCIAL_ENABLED_CLIENTS=none
WEBHOOK_SECRET=<generate one>
ADMIN_TOKEN=<generate one>
```

`PORT` is injected by Railway; the service reads it.

Generate the two secrets with:

```bash
openssl rand -hex 32
```

Then add Google, OpenAI, Cloudinary and GoHighLevel credentials. Per-client GHL
tokens (`GHL_TOKEN_AVO_SHACK` and friends) win over the shared `GHL_API_TOKEN`
— GoHighLevel PITs are location-scoped, so each client normally needs its own.
See [SECRETS.md](SECRETS.md) for which tokens the export exposed.

## 3. Confirm it is up

```bash
curl https://<service>.up.railway.app/health
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/ready
```

`/ready` reports a boolean per integration, so you can see what is still
missing without any value being echoed back:

```json
{
  "ok": true,
  "timezone": "Australia/Sydney",
  "configured": { "google": true, "openai": true, "cloudinary": true,
                  "ghlToken": true, "leadSheet": true },
  "jobs": []
}
```

`jobs` stays empty while `SOCIAL_ENABLED_CLIENTS=none`.

## 4. Move the lead webhooks over

These can cut over first — they are independent of the social posting side and
each one is a single sheet write.

For each of the six GoHighLevel webhooks, change only the host. The paths are
unchanged:

```
https://<old-n8n-host>/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a
https://<service>.up.railway.app/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a
```

`GET /webhooks/lead` lists all six with their paths. If `WEBHOOK_SECRET` is
set, add an `x-webhook-secret` header on the GoHighLevel side (or append
`?secret=…` if headers are awkward there).

Fire a test and watch the log line:

```bash
curl -X POST https://<service>.up.railway.app/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"email":"you@example.com","full_name":"Test Lead","phone":"+61400000000"}'
```

You should get `{"ok":true,"action":"appended",...}` or `"updated"`, and see the
row change in the spreadsheet. Then disable the six n8n workflows.

## 5. Move the social posting over

Do this one client at a time, and **disable the matching n8n workflow before
enabling the client here** — otherwise both will post.

Dry run first. This calls Drive, Cloudinary and OpenAI for real but never
GoHighLevel:

```bash
curl -X POST -H "x-webhook-secret: $ADMIN_TOKEN" \
  "https://<service>.up.railway.app/admin/social/run/avo-shack?dryRun=true&images=2"
```

Check the returned `outcomes`: each carries the Cloudinary `mediaUrl`, the
`scheduleDate` in UTC, the `accountIds` and the exact `summary`. Confirm the
schedule dates land where you expect in local time.

Then a live run of one or two posts:

```bash
curl -X POST -H "x-webhook-secret: $ADMIN_TOKEN" \
  "https://<service>.up.railway.app/admin/social/run/avo-shack?images=1"
```

Verify the post appears in the GoHighLevel social planner, scheduled for the
right local time. Once happy, turn the cron on:

```
SOCIAL_ENABLED_CLIENTS=avo-shack
```

`/admin/jobs` then shows the registered job and its `nextRun`. Add slugs as you
work through the clients; `all` enables every one.

### Rollback

`SOCIAL_ENABLED_CLIENTS=none` stops every cron on the next deploy without
touching anything else. `SOCIAL_DRY_RUN=true` keeps the jobs running but stops
them reaching GoHighLevel — useful for watching a schedule fire without
consequences.

## Scheduling notes

- Crons are evaluated in `SCHEDULE_TIMEZONE`, independent of the container
  clock. The image installs `tzdata` so `Intl` can resolve the zone.
- A run still in progress skips its next tick rather than starting a second
  concurrent batch.
- A 30-image batch makes roughly 90 outbound calls (Drive download, Cloudinary
  upload, OpenAI completion per image, then one POST each) at a concurrency of
  4, so expect a couple of minutes. Railway's healthcheck is unaffected; the
  work happens off the request path.
- Railway restarts on deploy and on failure. Since nothing is persisted, a
  restart mid-batch loses the remaining posts for that run — the posts already
  created in GoHighLevel stay. Re-run that client manually via
  `/admin/social/run/:slug` if it happens.
