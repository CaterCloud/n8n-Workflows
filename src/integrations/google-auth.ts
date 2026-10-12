import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../env.js';
import { ConfigError } from '../lib/errors.js';

/**
 * Google access uses an OAuth *user* refresh token — the same grant n8n held,
 * so the existing spreadsheet stays reachable without re-sharing anything.
 * googleapis refreshes the access token on demand and caches it on the client,
 * so one client is reused process-wide.
 */

/** Sheets alone: nothing here touches Drive. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

let client: OAuth2Client | undefined;

export function googleAuth(): OAuth2Client {
  if (client) return client;

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = env();
  const missing = [
    !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
    !GOOGLE_REFRESH_TOKEN && 'GOOGLE_REFRESH_TOKEN',
  ].filter(Boolean);

  if (missing.length) {
    throw new ConfigError(
      `Google credentials missing: ${missing.join(', ')}. See docs/GOOGLE-OAUTH.md to mint a refresh token.`,
    );
  }

  const oauth = new google.auth.OAuth2({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  });
  oauth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  client = oauth;
  return oauth;
}

/** Test hook. */
export function setGoogleAuthForTesting(value: OAuth2Client | undefined): void {
  client = value;
}
