# Minting the Google refresh token

Google access uses an OAuth **user** refresh token, the same grant n8n held.
The upside is that the spreadsheet the workflows already write to stays
reachable with nothing to re-share. The trade-off is that the token dies if the
Google account's password changes, consent is revoked, or the OAuth client is
deleted — so keep the client and the account stable.

One scope is needed:

```
https://www.googleapis.com/auth/spreadsheets
```

Nothing here touches Drive, so the `drive` scope n8n held is not required. If
you are reusing n8n's existing credential it will carry the broader scope
already, which works but grants more than this service needs.

## Option A — reuse n8n's existing OAuth client

If the n8n instance is still up, its Google credential already holds a client
ID, client secret and refresh token covering Sheets. Copy all three into
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` and you
are done.

Two things to know: n8n's stored refresh token works here because Google ties a
refresh token to the OAuth *client*, not the application using it — so the
client ID and secret must come from the same credential. And once n8n is
decommissioned, keep that Google Cloud OAuth client alive; deleting it
invalidates the token.

## Option B — mint a fresh one

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   pick a project on the Google account that can edit the spreadsheet. Enable
   the **Google Sheets API**.
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
     &scope=https%3A//www.googleapis.com/auth/spreadsheets
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
variables are present. To confirm the grant actually works, read the sheet:

```bash
curl -H "x-webhook-secret: $ADMIN_TOKEN" https://<service>.up.railway.app/admin/lead/sheet
```

That returns the live header and row count. A bad or expired token surfaces as
`invalid_grant` from Google; a token that works but cannot see the file comes
back as a `502` carrying Google's own 404.

## Access the token needs

The authorising account needs **edit** access to the one spreadsheet in
`LEAD_SHEET_ID` ("PEE Optin - Utm"). Nothing else.

A `404` from Google on a known-good spreadsheet ID almost always means this
account cannot see that file, not that it is gone.
