# Giving the service access to the spreadsheet

The service needs to read and write one Google Sheet:
**"PEE Optin - Utm"**, tab `PEE `
(`1XETq_e721_67XJgyWPBC365HhAxCojrSwdVCkDVzTjw`).

Two ways to grant that. **Use a service account** unless you have a reason not
to — it is three steps, nothing expires, and there is no browser consent flow.
Only the `spreadsheets` scope is needed either way; nothing here touches Drive.

---

## Option A — service account (recommended)

### 1. Create the key

1. Open [console.cloud.google.com](https://console.cloud.google.com/). Create a
   project if you have none — any name, e.g. `catercloud-automations`.
2. Enable the Sheets API:
   **APIs & Services → Library →** search "Google Sheets API" → **Enable**.
   (Only Sheets. Not Drive.)
3. **APIs & Services → Credentials → Create credentials → Service account.**
   - Name: `lead-tracker`. Click **Create and continue**.
   - Skip the optional "grant access" steps → **Done**.
4. Click the service account you just made → **Keys** tab →
   **Add key → Create new key → JSON → Create**.

A `.json` file downloads. It looks like:

```json
{
  "type": "service_account",
  "project_id": "catercloud-automations-xxxxx",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "lead-tracker@catercloud-automations-xxxxx.iam.gserviceaccount.com",
  ...
}
```

That file is a credential — treat it like a password.

### 2. Share the sheet with it

Copy the `client_email` value. Open the spreadsheet, click **Share**, paste
that address, set it to **Editor**, and send.

> It will say the address is not a Google account and cannot be notified.
> That's expected — share it anyway.

This is the step people miss. Without it every request comes back
`403 The caller does not have permission`, and `/admin/lead/sheet` will say so.

Note the spreadsheet is **owned by another Google account** and shared with
yours. You need Editor rights on it to be able to share it onward. If the
Share dialog won't let you add people, ask the owner to add the service
account address instead.

### 3. Set it on Railway

One variable, the **entire file contents** pasted as the value:

```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...", ... }
```

Braces included. Paste it as one line or as the multi-line file — both work.
If the dashboard escapes the newlines inside `private_key` into literal `\n`,
that is handled; so are stray wrapping quotes.

The service redeploys itself. Check it took:

```bash
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/ready
```

```json
{ "googleAuth": "service-account",
  "serviceAccountEmail": "lead-tracker@....iam.gserviceaccount.com" }
```

Then confirm it can actually reach the sheet:

```bash
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/admin/lead/sheet
```

That returns the live header and row count, with `missingFromSheet: []`.

---

## Option B — OAuth user token

Use this if you would rather the service act as a Google user than as its own
identity. No sharing step, but the token can be revoked out from under it and
the setup is longer.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   on a project whose account can edit the spreadsheet, enable the
   **Google Sheets API**.
2. **Create credentials → OAuth client ID → Application type: Desktop app.**
   Desktop clients accept a `http://localhost` redirect without extra setup,
   which is what makes the next step possible. Note the client ID and secret.
3. Build the consent URL, substituting `CLIENT_ID`:

   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=CLIENT_ID
     &redirect_uri=http://localhost
     &response_type=code
     &access_type=offline
     &prompt=consent
     &scope=https%3A//www.googleapis.com/auth/spreadsheets
   ```

   `access_type=offline` and `prompt=consent` are both required — without them
   Google returns no refresh token at all.

4. Open it as the account that can edit the sheet and approve. The browser
   lands on `http://localhost/?code=...` and fails to load, which is fine —
   copy the `code` value out of the address bar. It expires within minutes.

5. Exchange it for a refresh token:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost
   ```

6. Set three variables:

   ```
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REFRESH_TOKEN=
   ```

`/ready` then reports `"googleAuth": "oauth"`.

> If the OAuth consent screen is left in **Testing** mode, refresh tokens
> expire after 7 days and the service breaks weekly. Publish the app, or use a
> service account.

If both a service account and the OAuth trio are set, the service account is
used.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `403 The caller does not have permission` | The sheet was never shared with the service account email (Option A step 2), or it was shared as Viewer rather than Editor. |
| `404 Requested entity was not found` | Wrong `LEAD_SHEET_ID`, or the credential belongs to an account that cannot see the file. |
| `invalid_grant` | OAuth refresh token revoked, expired (Testing-mode 7-day limit), or paired with a different client ID than it was minted for. |
| `error:0909006C:PEM routines` | A mangled `private_key`. Re-paste the key file unmodified. |
| `Unable to parse range: 'PEE '!A:ZZ` | `LEAD_SHEET_NAME` lost its trailing space, or the tab was renamed. |

`/ready` tells you which credential is configured; `/admin/lead/sheet` tells
you whether it actually works.
