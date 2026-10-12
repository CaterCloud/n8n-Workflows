import { beforeEach, describe, expect, it } from 'vitest';
import { useTestEnv } from './helpers.js';
import {
  configuredAuthMode,
  googleAuth,
  serviceAccountEmail,
  setGoogleAuthForTesting,
} from '../src/integrations/google-auth.js';
import { ConfigError } from '../src/lib/errors.js';

/**
 * A throwaway RSA key, generated for these tests only. It never authenticates
 * anything — it just has to be a structurally valid PEM so the JWT client can
 * be constructed.
 */
const TEST_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA0Z0m8vQF4Yk3vJ1xS',
  'wVqPZ8tM2nK9jL4hB6dC1fG3aH5rT7uI9oP2sD4eF6gH8jK0lM2nO4pQ6rS8tU0vW',
  '-----END PRIVATE KEY-----',
].join('\n');

const keyFile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'lead-tracker@test-project.iam.gserviceaccount.com',
    private_key: TEST_KEY,
    ...overrides,
  });

beforeEach(() => {
  setGoogleAuthForTesting(undefined);
});

describe('configuredAuthMode', () => {
  it('reports nothing when neither credential is set', () => {
    useTestEnv();
    expect(configuredAuthMode()).toBeUndefined();
  });

  it('reports oauth when the full trio is present', () => {
    useTestEnv({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' });
    expect(configuredAuthMode()).toBe('oauth');
  });

  it('does not report oauth on a partial trio', () => {
    useTestEnv({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' });
    expect(configuredAuthMode()).toBeUndefined();
  });

  it('prefers the service account when both are set', () => {
    useTestEnv({
      GOOGLE_SERVICE_ACCOUNT_JSON: keyFile(),
      GOOGLE_CLIENT_ID: 'a',
      GOOGLE_CLIENT_SECRET: 'b',
      GOOGLE_REFRESH_TOKEN: 'c',
    });
    expect(configuredAuthMode()).toBe('service-account');
  });
});

describe('serviceAccountEmail', () => {
  it('surfaces the address the sheet must be shared with', () => {
    useTestEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile() });
    expect(serviceAccountEmail()).toBe('lead-tracker@test-project.iam.gserviceaccount.com');
  });

  it('is undefined when no key is set, and on an unparseable one', () => {
    useTestEnv();
    expect(serviceAccountEmail()).toBeUndefined();
    useTestEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '{ broken' });
    expect(serviceAccountEmail()).toBeUndefined();
  });
});

describe('googleAuth with a service account', () => {
  it('builds a JWT client from the key file', () => {
    useTestEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile() });
    const client = googleAuth();
    expect(client).toBeDefined();
    expect((client as { email?: string }).email).toBe('lead-tracker@test-project.iam.gserviceaccount.com');
  });

  it('repairs a private key whose newlines were escaped by the dashboard', () => {
    useTestEnv({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: 'x@y.iam.gserviceaccount.com',
        private_key: TEST_KEY.replace(/\n/g, '\\n'),
      }),
    });
    const key = (googleAuth() as { key?: string }).key ?? '';
    expect(key).toContain('\n');
    expect(key).not.toContain('\\n');
    expect(key.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
  });

  it('strips surrounding quotes from a pasted key', () => {
    useTestEnv({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: 'x@y.iam.gserviceaccount.com',
        private_key: `"${TEST_KEY}"`,
      }),
    });
    expect((googleAuth() as { key?: string }).key?.startsWith('-----BEGIN')).toBe(true);
  });

  it('explains malformed JSON rather than throwing a parse error', () => {
    useTestEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '{ not json' });
    expect(() => googleAuth()).toThrow(ConfigError);
    expect(() => googleAuth()).toThrow(/whole downloaded key file/);
  });

  it('names the missing field when the key file is incomplete', () => {
    useTestEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x@y.com' }) });
    expect(() => googleAuth()).toThrow(/missing client_email or private_key/);
  });
});

describe('googleAuth with no credentials', () => {
  it('names both options in the error', () => {
    useTestEnv();
    expect(() => googleAuth()).toThrow(ConfigError);
    expect(() => googleAuth()).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
    expect(() => googleAuth()).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
