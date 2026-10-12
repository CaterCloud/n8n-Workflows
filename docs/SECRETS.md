# Credentials in the workflow export

The n8n JSON files carried live credentials in plain text — in HTTP header
parameters and Set nodes, not in n8n's credential store. They were in the
uploaded archive, so treat every one as exposed and rotate it, whether or not
this service uses it.

Nothing secret is committed to this repository. The copies under
[`reference/n8n/`](../reference/n8n) are redacted, and all configuration is read
from environment variables ([`src/env.ts`](../src/env.ts)).

## What this service needs

Only Google. The six lead workflows had no credentials of their own in the
JSON — they used n8n's stored Google OAuth credential — so there is nothing
here to rotate for them specifically.

| Variable | What it is |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | OAuth user grant for the Sheets API. See [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md). |
| `WEBHOOK_SECRET` | Shared secret GoHighLevel sends with each webhook. |
| `ADMIN_TOKEN` | Guards `/admin/*`. |

If the Google refresh token was copied out of n8n, treat it as exposed too —
anything that passed through the old instance should be considered so. Mint a
fresh one and revoke the old client at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Note that this service needs only the `spreadsheets` scope. n8n's credential
likely also carries `drive`. Reusing it works, but a fresh Sheets-only token
grants less.

## What else was exposed

These belong to workflows outside this service's scope. They are listed so the
rotation is complete; tokens are shown by prefix so you can find them in
GoHighLevel without the full value being written down again.

| Credential | Where it appeared | Scope |
| --- | --- | --- |
| Agency JWT, `eyJhbGciOiJIUzI1NiIs…` (company `qrLjjN2XDCFKCmfHKfuq`) | `Get GHL Subaccounts` in 12 social workflows, plus `Social Media Scheduler` | **Agency-wide — the widest-reaching one here.** Revoke first. |
| PIT `pit-56538758-…` | `Post GHL`, Junction Cafe and Madame Cue | Location `Ug16dt3qfWWQu0tliuGr` |
| PIT `pit-30954a68-…` | `Post GHL`, Spanish Paella (3 copies) | Location `RMmf289hB5J7LjtJJLYt` |
| PIT `pit-a012355f-…` | `Post GHL` / `Get Accounts ID`, Avo Shack (4 copies) | Location `NeGmNMm3xs5QfUpL5qRA` |
| PIT `pit-0417d0ef-…` | `Post GHL`, Madison Ave | Location `ULFhETUirfUFnKUhgCcI` |
| PIT `pit-4fb1b9b3-…` | Contact notes workflows (3 copies) | Location `EwZZwHF70ShtGrbOPRh2` |
| PIT `pit-3075c0a6-…` | Invoice sync | Location `RMmf289hB5J7LjtJJLYt` |
| PIT `pit-b7bfb6db-…` | `My workflow 2` | Location `RsRYPDcHIGXOSTP7o8pC` |
| Cloudinary cloud `dvouhqxi4` + unsigned preset `n8n_upload` | `Post Image To Cloudinary` in every social workflow | Image uploads into that cloud |

Seven location PITs and one agency JWT. The Cloudinary cloud name is not a
secret — it is in every delivery URL — but the **unsigned upload preset** is
worth attention: anyone with both strings can upload into that cloud. Restrict
the preset (formats, size, folder) or move to signed uploads.

Also in the export, not secret but internal: GoHighLevel location and social
account IDs, the user ID `lWZjS6ppoRL7w9v2r1VM`, Drive folder and document IDs,
and the lead spreadsheet ID.

## Finally

Delete the workflow export from anywhere it was shared — chat uploads, Drive,
Slack — and re-export from n8n only after rotating, so the new export carries
nothing live.

## Keeping it clean

- Set `WEBHOOK_SECRET` and `ADMIN_TOKEN` before going live. Without them the
  webhooks accept anything that can reach the URL, and `/admin/*` will read
  your spreadsheet for any caller.
- Secrets are compared in constant time, and a length mismatch fails before any
  comparison.
- `/ready` reports a boolean per dependency and never echoes a value.
- Google errors are surfaced as a status plus Google's own message, never the
  whole Gaxios error, which carries the outgoing request.
- `.gitignore` excludes `.env`; only `.env.example`, with empty values, is
  committed.
