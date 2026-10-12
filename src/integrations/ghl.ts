import { env } from '../env.js';
import { requestJson } from '../lib/http.js';
import { ConfigError } from '../lib/errors.js';
import { logger } from '../logger.js';

/**
 * GoHighLevel / LeadConnector client.
 *
 * Social posting uses the v2 API (`services.leadconnectorhq.com`) with a
 * location-scoped Private Integration Token. The legacy v1 host
 * (`rest.gohighlevel.com`) is only used for the agency-JWT location lookup the
 * original workflows opened with.
 */

const V2 = 'https://services.leadconnectorhq.com';
const V1 = 'https://rest.gohighlevel.com/v1';

export type SocialPlatform = 'facebook' | 'instagram' | 'google' | 'tiktok' | 'pinterest' | 'linkedin' | 'twitter';

export interface SocialAccount {
  id: string;
  name: string;
  platform: SocialPlatform | string;
  type?: string;
  isExpired?: boolean;
}

export interface SocialMedia {
  url: string;
  type: string;
  caption?: string;
}

export interface SocialPostPayload {
  accountIds: string[];
  summary: string;
  media: SocialMedia[];
  type: 'post' | 'reel' | 'story';
  status: 'draft' | 'scheduled' | 'published';
  scheduleDate: string;
  userId?: string;
  mediaOptimization?: boolean;
}

export interface CreatedPost {
  id?: string;
  [key: string]: unknown;
}

function v2Headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Version: env().GHL_API_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Social accounts connected to a location, flattened from the v2 shape. */
export async function listSocialAccounts(locationId: string, token: string): Promise<SocialAccount[]> {
  const res = await requestJson<{
    success?: boolean;
    results?: { accounts?: Array<Record<string, unknown>> };
  }>(`${V2}/social-media-posting/${encodeURIComponent(locationId)}/accounts`, {
    headers: v2Headers(token),
  });

  const accounts = res?.results?.accounts ?? [];
  return accounts
    .map((a) => ({
      id: String(a['id'] ?? ''),
      name: String(a['name'] ?? ''),
      platform: String(a['platform'] ?? '').toLowerCase(),
      type: a['type'] === undefined ? undefined : String(a['type']),
      isExpired: a['isExpired'] === true,
    }))
    .filter((a) => a.id !== '');
}

/** Schedules (or drafts) one social post against the given accounts. */
export async function createSocialPost(
  locationId: string,
  token: string,
  payload: SocialPostPayload,
): Promise<CreatedPost> {
  return requestJson<CreatedPost>(`${V2}/social-media-posting/${encodeURIComponent(locationId)}/posts`, {
    method: 'POST',
    headers: v2Headers(token),
    body: JSON.stringify(payload),
  });
}

/** Users in a location — used to resolve a `userId` for post authorship. */
export async function listUsers(
  locationId: string,
  token: string,
): Promise<Array<{ id: string; name?: string; email?: string }>> {
  const res = await requestJson<{ users?: Array<Record<string, unknown>> }>(
    `${V2}/users/?locationId=${encodeURIComponent(locationId)}`,
    { headers: v2Headers(token) },
  );
  return (res?.users ?? []).map((u) => ({
    id: String(u['id'] ?? ''),
    name: u['name'] === undefined ? undefined : String(u['name']),
    email: u['email'] === undefined ? undefined : String(u['email']),
  }));
}

/**
 * Legacy v1 location lookup with the agency JWT. The n8n workflows called this
 * first and then ignored the body, so it served as a credential pre-flight.
 * Kept for exactly that, and skipped when no agency JWT is configured.
 */
export async function getLocationV1(locationId: string): Promise<Record<string, unknown> | undefined> {
  const jwt = env().GHL_AGENCY_JWT;
  if (!jwt) {
    logger.debug('skipping v1 location pre-flight: GHL_AGENCY_JWT not set', { locationId });
    return undefined;
  }
  return requestJson<Record<string, unknown>>(`${V1}/locations/${encodeURIComponent(locationId)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export function requireToken(slugOrLocation: string, token: string | undefined): string {
  if (!token) {
    throw new ConfigError(
      `No GoHighLevel token for ${slugOrLocation}. Set GHL_TOKEN_${slugOrLocation
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toUpperCase()} or the shared GHL_API_TOKEN.`,
    );
  }
  return token;
}
