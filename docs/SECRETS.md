# Credentials in the workflow export

The n8n JSON files carried live credentials in plain text — in HTTP header
parameters and in Set nodes, not in n8n's credential store. They were in the
uploaded archive, so treat every one below as exposed and rotate it.

Nothing secret is committed to this repository. The copies under
[`reference/n8n/`](../reference/n8n) are redacted, and all configuration is read
from environment variables ([`src/env.ts`](../src/env.ts)).

## What was exposed

Tokens are listed by prefix so you can identify them in GoHighLevel without
the full value being written down again here.

| Credential | Where it appeared | Used for |
| --- | --- | --- |
| Agency JWT, `eyJhbGciOiJIUzI1NiIs…` (company `qrLjjN2XDCFKCmfHKfuq`) | `Get GHL Subaccounts` header in 12 social workflows, plus `Social Media Scheduler` | Legacy v1 `rest.gohighlevel.com` location reads. **Agency-scoped — the widest-reaching one here.** |
| PIT `pit-56538758-…` | `Post GHL`, Junction Cafe **and** Madame Cue | Social posting on `Ug16dt3qfWWQu0tliuGr` (see the note below about Madame Cue) |
| PIT `pit-30954a68-…` | `Post GHL`, Spanish Paella (3 copies) | Social posting on `RMmf289hB5J7LjtJJLYt` |
| PIT `pit-a012355f-…` | `Post GHL` and `Get Accounts ID`, Avo Shack (4 copies) | Social posting on `NeGmNMm3xs5QfUpL5qRA` |
| PIT `pit-0417d0ef-…` | `Post GHL`, Madison Ave | Social posting on `ULFhETUirfUFnKUhgCcI` |
| PIT `pit-4fb1b9b3-…` | `Get All Contacts` / `Get Notes per Contact`, contact-notes workflows (3 copies) | Contact and note reads on `EwZZwHF70ShtGrbOPRh2` |
| PIT `pit-3075c0a6-…` | `Workflow Configuration` and both fetch nodes, invoice sync | Invoices and payment transactions on `RMmf289hB5J7LjtJJLYt` |
| PIT `pit-b7bfb6db-…` | `Get Social Accounts` / `Get User ID`, `My workflow 2` | Social accounts and users on `RsRYPDcHIGXOSTP7o8pC` |
| Cloudinary cloud `dvouhqxi4` + unsigned preset `n8n_upload` | `Post Image To Cloudinary` in every social workflow | Image hosting |

Seven location PITs and one agency JWT, across eight distinct credentials.

### Which token each client needs

GoHighLevel PITs are scoped to a single location, so the service resolves one
per client (`GHL_TOKEN_<SLUG>`, falling back to `GHL_API_TOKEN`). Mapped from
the `Post GHL` headers in the export:

| Client variable | GHL location | Token in the export |
| --- | --- | --- |
| `GHL_TOKEN_JUNCTION_CAFE` | `Ug16dt3qfWWQu0tliuGr` | `pit-56538758-…` |
| `GHL_TOKEN_SPANISH_PAELLA` | `RMmf289hB5J7LjtJJLYt` | `pit-30954a68-…` |
| `GHL_TOKEN_AVO_SHACK` | `NeGmNMm3xs5QfUpL5qRA` | `pit-a012355f-…` |
| `GHL_TOKEN_MADISON_AVE` | `ULFhETUirfUFnKUhgCcI` | `pit-0417d0ef-…` |
| `GHL_TOKEN_MADAME_CUE` | `mqdAQkVtmwpoXe1eJ828` | ⚠️ **none valid** — see below |

> **Madame Cue has no usable token in the export.** Its `Post GHL` node posts
> to `mqdAQkVtmwpoXe1eJ828` while carrying Junction Cafe's `pit-56538758-…` in
> the `Authorization` header — a copy-paste leftover. In n8n the node also had
> an OAuth2 credential named "Madame Cue" attached, which is what actually
> authorised the call; the stale header was ignored. This service sends only the
> configured token, so **issue a fresh PIT on the Madame Cue location** and set
> `GHL_TOKEN_MADAME_CUE` to it. Reusing `pit-56538758-…` there will 401.

The Cloudinary cloud name is not a secret — it appears in every delivery URL.
The **unsigned upload preset** is worth attention though: anyone who knows both
strings can upload into that cloud. Consider restricting the preset (allowed
formats, max file size, a folder) or switching to signed uploads.

Also in the export, not secret but worth noting as internal identifiers: GHL
location IDs, social account IDs, the user ID `lWZjS6ppoRL7w9v2r1VM`, Drive
folder and document IDs, and the lead spreadsheet ID.

## Rotating

Only the first two matter for this service as built. The other three belong to
workflows left out of this pass — rotate them anyway, since they were exposed.

1. **Agency JWT.** In GoHighLevel, revoke the agency API key and issue a new
   one. This service only uses it for an advisory pre-flight, so you can also
   just leave `GHL_AGENCY_JWT` unset: the call is skipped and runs proceed
   normally. That is the smaller blast radius, and the recommended option.

2. **Per-location PITs.** For each of the five client locations, create a
   fresh Private Integration Token with the social posting scopes, set the
   matching `GHL_TOKEN_<SLUG>` variable, and delete the old token. Use the
   table above to know which exposed token each one replaces. Madame Cue needs
   a token issued for the first time, not a rotation.

   A shared `GHL_API_TOKEN` only works if a single token happens to cover every
   location, which is not the case here — set the per-client variables.

3. **Cloudinary preset.** Tighten or replace `n8n_upload`, then update
   `CLOUDINARY_UPLOAD_PRESET`.

4. **Google.** If the n8n OAuth refresh token was copied across, it is as
   exposed as anything else that passed through the old instance. See
   [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md) to mint a fresh one, and revoke the old
   client's access at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

5. **The archive itself.** Delete the workflow export from anywhere it was
   shared — chat uploads, Drive, Slack — and re-export from n8n only after the
   rotation, so the new export carries nothing live.

## Keeping it clean

- Set `WEBHOOK_SECRET` and `ADMIN_TOKEN` before going live. Without them the
  lead webhooks accept anything that can reach the URL, and `/admin/*` will run
  a client's posting batch for any caller.
- `/ready` reports a boolean per integration and never echoes a value.
- `/admin/social/clients` summarises configuration without listing account IDs.
- `.gitignore` excludes `.env`; only `.env.example`, with empty values, is
  committed.
