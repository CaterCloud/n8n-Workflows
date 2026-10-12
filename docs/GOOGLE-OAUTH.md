# Minting the Google refresh token

Google access uses an OAuth **user** refresh token, the same grant n8n held.
The upside is that every Drive folder and spreadsheet the automations already
touch stays reachable with nothing to re-share. The trade-off is that the token
dies if the Google account's password changes, consent is revoked, or the OAuth
client is deleted — so keep the client and the account stable.

Scopes needed:

```
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/spreadsheets
```

## Option A — reuse n8n's existing OAuth client

If the n8n instance is still up, its Google credential already holds a client
ID, client secret and refresh token for exactly these scopes. Copy all three
into `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` and
you are done.

Two things to know: n8n's stored refresh token works here because Google ties a
refresh token to the OAuth *client*, not the application using it — so the
client ID and secret must come from the same credential. And once n8n is
decommissioned, keep that Google Cloud OAuth client alive; deleting it
invalidates the token.

## Option B — mint a fresh one

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   pick the project that owns the Drive folders. Enable the **Google Drive API**
   and **Google Sheets API**.
2. Create an OAuth client of type **Desktop app**. Note the client ID and
   secret.
3. Build the consent URL, replacing `CLIENT_ID`:

   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=CLIENT_ID
     &redirect_uri=http://localhost
     &response_type=code
     &access_type=offline
     &prompt=consent
     &scope=https%3A//www.googleapis.com/auth/drive%20https%3A//www.googleapis.com/auth/spreadsheets
   ```

   `access_type=offline` and `prompt=consent` are both required — without them
   Google returns no refresh token.

4. Open it as the account that owns the Drive content, approve, and copy the
   `code` parameter off the `http://localhost/?code=…` redirect. It expires in
   minutes.

5. Exchange it:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost
   ```

   Take `refresh_token` from the response. If it is absent, the account has
   already consented to this client — add `prompt=consent` and retry.

6. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

> If the OAuth consent screen is in **Testing** mode, refresh tokens expire
> after 7 days. Publish the app (or keep it Internal within a Workspace org)
> before relying on it.

## Verifying

`/ready` reports `configured.google`, which only checks that the three
variables are present. To confirm the grant actually works, dry-run a client —
it reads a brand brief from Drive and lists the image folders:

```bash
npm run run:social -- avo-shack --dry-run --images=1
```

A bad or expired token surfaces as `invalid_grant` from Google.

## Access the token needs

The authorising account must be able to see:

- the image folders for each client (`imageFolderIds` in
  [`src/social-posting/clients.ts`](../src/social-posting/clients.ts));
- each client's brand brief Google Doc (`brandBriefDocId`);
- the lead tracker spreadsheet (`LEAD_SHEET_ID`), with edit rights.

A `404 File not found` from Drive on a known-good ID almost always means this
account cannot see that file, not that it is gone.
