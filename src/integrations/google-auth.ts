import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { ConfigError } from '../lib/errors.js';

/**
 * Two ways to reach the spreadsheet, whichever is easier to set up:
 *
 * 1. A **service account** key (GOOGLE_SERVICE_ACCOUNT_JSON). Simplest: no
 *    consent flow and no token to expire. The spreadsheet has to be shared
 *    with the service account's email as an Editor.
 * 2. An **OAuth user** refresh token, the same grant n8n held. No sharing
 *    needed, but the token dies if consent is revoked or the OAuth client is
 *    deleted.
 *
 * The service account wins when both are set. One client is reused
 * process-wide; googleapis refreshes access tokens on it as needed.
 */

/** Sheets alone: nothing here touches Drive. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

export type AuthMode = 'service-account' | 'oauth';

let client: OAuth2Client | undefined;
let mode: AuthMode | undefined;

interface ServiceAccountKey {
  client_email?: unknown;
  private_key?: unknown;
}

/**
 * Environment variables mangle newlines: a private key pasted into a dashboard
 * often arrives with literal backslash-n instead of real line breaks, and
 * sometimes wrapped in quotes. Both are repaired here rather than failing with
 * an opaque "error:0909006C:PEM routines".
 */
function normalisePrivateKey(key: string): string {
  return key
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim();
}

function serviceAccountClient(raw: string): OAuth2Client {
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    throw new ConfigError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole downloaded key file, braces included.',
    );
  }

  const email = typeof parsed.client_email === 'string' ? parsed.client_email : '';
  const key = typeof parsed.private_key === 'string' ? normalisePrivateKey(parsed.private_key) : '';

  if (!email || !key) {
    throw new ConfigError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key. Use the JSON key file, not the service account details page.',
    );
  }

  logger.info('google auth: using service account', { clientEmail: email });
  return new JWT({ email, key, scopes: [...GOOGLE_SCOPES] });
}

function oauthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = env();
  const missing = [
    !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
    !GOOGLE_REFRESH_TOKEN && 'GOOGLE_REFRESH_TOKEN',
  ].filter(Boolean);

  if (missing.length) {
    throw new ConfigError(
      `No Google credentials. Either set GOOGLE_SERVICE_ACCOUNT_JSON, or set all of ${missing.join(
        ', ',
      )}. See docs/GOOGLE-OAUTH.md.`,
    );
  }

  const oauth = new google.auth.OAuth2({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  });
  oauth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  logger.info('google auth: using an OAuth refresh token');
  return oauth;
}

export function googleAuth(): OAuth2Client {
  if (client) return client;

  const serviceAccount = env().GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccount) {
    client = serviceAccountClient(serviceAccount);
    mode = 'service-account';
  } else {
    client = oauthClient();
    mode = 'oauth';
  }
  return client;
}

/** Which credential the service would use, without building a client. */
export function configuredAuthMode(): AuthMode | undefined {
  const e = env();
  if (e.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) return 'service-account';
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REFRESH_TOKEN) return 'oauth';
  return undefined;
}

/** The service account's email, for the "share the sheet with this" step. */
export function serviceAccountEmail(): string | undefined {
  const raw = env().GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey;
    return typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
  } catch {
    return undefined;
  }
}

/** Test hooks. */
export function setGoogleAuthForTesting(value: OAuth2Client | undefined): void {
  client = value;
  if (!value) mode = undefined;
}

export function activeAuthMode(): AuthMode | undefined {
  return mode;
}
