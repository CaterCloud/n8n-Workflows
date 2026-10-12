# catercloud-automations

The CaterCloud marketing automations, rebuilt from n8n workflow exports as a
single deployable Node service.

Two workflow families are implemented:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| **Social posting** | cron, per client | Picks images from Google Drive, uploads and enhances them via Cloudinary, writes captions with GPT from the client's brand brief, and schedules the posts in GoHighLevel. |
| **Lead tracker** | HTTP webhook, 6 events | Looks a lead up by email in the "PEE Optin - Utm" spreadsheet, then updates that row or appends a new one. |

The 29 files in the original export collapse to this: twelve of them were
copies of one social-posting graph covering five GoHighLevel locations, and six
were copies of one webhook-to-sheet graph. See
[docs/N8N-MAPPING.md](docs/N8N-MAPPING.md) for the file-by-file mapping, the
behaviour that changed, and the bugs found on the way.

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in — see docs/GOOGLE-OAUTH.md
npm test
npm run dev
```

Nothing posts anywhere until you say so: `SOCIAL_ENABLED_CLIENTS` defaults to
`none`, so the scheduler boots with zero jobs.

Verify a client without touching GoHighLevel:

```bash
npm run run:social -- avo-shack --dry-run --images=2
```

That exercises the whole pipeline — Drive, Cloudinary, OpenAI — and logs the
exact payloads it would have POSTed.

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Railway's healthcheck target. |
| `GET` | `/ready` | Which integrations are configured, plus registered cron jobs. Reports booleans, never values. |
| `GET` | `/webhooks/lead` | Lists the six lead events with their new and legacy URLs. |
| `POST` | `/webhooks/lead/:slug` | Receives a lead event, e.g. `/webhooks/lead/pee-optin`. |
| `POST` | `/webhook/:uuid` | The original n8n paths, kept live so GoHighLevel only needs a new host. |
| `GET` | `/admin/social/clients` | Client configuration summary. |
| `GET` | `/admin/jobs` | Registered cron jobs and their next run times. |
| `POST` | `/admin/social/run/:slug` | Runs a client now. Accepts `?schedule=`, `?dryRun=true`, `?images=N`. |

`WEBHOOK_SECRET` gates the webhook routes and `ADMIN_TOKEN` gates `/admin/*`,
each accepted as an `x-webhook-secret` header, an `Authorization: Bearer`
header, or a `?secret=` query parameter. Both are unset by default, which
leaves the routes open — set them before going live.

## Clients

| Slug | GHL location | Schedule (from the n8n export) | Images |
| --- | --- | --- | --- |
| `junction-cafe` | `Ug16dt3qfWWQu0tliuGr` | `0 10 26 * *` | 30 |
| `spanish-paella` | `RMmf289hB5J7LjtJJLYt` | `0 10 25 * *` | 30 |
| `avo-shack` | `NeGmNMm3xs5QfUpL5qRA` | `0 10 * * *` | 3 |
| `madame-cue` | `mqdAQkVtmwpoXe1eJ828` | `0 10 4 3 *` ⚠️ once a year | 30 |
| `madison-ave` | `ULFhETUirfUFnKUhgCcI` | `0 10 8 * *` | 30 |

Crons run in `SCHEDULE_TIMEZONE` (default `Australia/Sydney`). Madame Cue's
expression is reproduced from its workflow and fires only on 4 March — see
[docs/N8N-MAPPING.md](docs/N8N-MAPPING.md#madame-cue-fires-once-a-year).

Per-client config lives in [`src/social-posting/clients.ts`](src/social-posting/clients.ts).
Edit it there, or patch it without a deploy via the `SOCIAL_CLIENT_OVERRIDES`
environment variable.

## Layout

```
src/
  env.ts                  zod-validated environment, per-client token resolution
  scheduler.ts            cron registration (croner), timezone-aware
  http/server.ts          Fastify routes, auth, error mapping
  integrations/           ghl, drive, sheets, cloudinary, openai, google-auth
  lib/                    http retries, dates, text, concurrency, mutex
  social-posting/
    clients.ts            the five client configs
    prompt.ts             the copywriter prompt
    engine.ts             the pipeline
  lead-tracker/
    events.ts             the six events as data: paths and column mappings
    handler.ts            look up, then update or append
  cli/run-social.ts       manual runner
reference/n8n/            the original exports, with credentials redacted
```

## Operational notes

- **Single replica.** The lead tracker serialises its read/update/append cycle
  with an in-process lock so two simultaneous webhooks for a new email cannot
  both append. That holds for one instance; `numReplicas` is pinned to 1 in
  `railway.json`. More replicas would need a shared lock.
- **Retries.** Every outbound HTTP call retries on 408/429/5xx and network
  faults with exponential backoff, honouring `Retry-After`.
- **Partial failure.** One bad image does not sink a 30-post batch: it is
  skipped, recorded in `warnings`, and the rest proceed. A run only throws if
  *every* image fails.
- **Overlap.** Cron jobs are registered with croner's `protect`, so a run still
  in flight skips its next tick rather than stacking.

## Docs

- [docs/N8N-MAPPING.md](docs/N8N-MAPPING.md) — what maps to what, and what changed
- [docs/RAILWAY-DEPLOY.md](docs/RAILWAY-DEPLOY.md) — deploying and cutting over
- [docs/GOOGLE-OAUTH.md](docs/GOOGLE-OAUTH.md) — minting the Google refresh token
- [docs/SECRETS.md](docs/SECRETS.md) — credentials found in the export, and rotation
