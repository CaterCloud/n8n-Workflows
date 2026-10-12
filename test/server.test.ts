import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { useTestEnv } from './helpers.js';
import { buildServer } from '../src/http/server.js';
import { resetClientCacheForTesting } from '../src/social-posting/clients.js';

let app: FastifyInstance;

function start(overrides: Record<string, string> = {}): FastifyInstance {
  useTestEnv(overrides);
  resetClientCacheForTesting();
  app = buildServer();
  return app;
}

beforeEach(() => {
  delete process.env['SOCIAL_CLIENT_OVERRIDES'];
});

describe('health and readiness', () => {
  it('reports healthy', async () => {
    const res = await start().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('reports which integrations are configured without leaking values', async () => {
    const res = await start({ OPENAI_API_KEY: 'sk-secret-value', LEAD_SHEET_ID: 'sheet-123' }).inject({
      method: 'GET',
      url: '/ready',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      timezone: 'Australia/Sydney',
      configured: { openai: true, leadSheet: true, google: false },
    });
    expect(res.body).not.toContain('sk-secret-value');
    expect(res.body).not.toContain('sheet-123');
  });
});

describe('lead webhook routing', () => {
  it('lists every event with both its new and legacy URL', async () => {
    const res = await start().inject({ method: 'GET', url: '/webhooks/lead' });
    const body = res.json() as { events: Array<{ slug: string; url: string; legacyUrl: string }> };

    expect(body.events).toHaveLength(6);
    expect(body.events[0]).toMatchObject({
      slug: 'pee-optin',
      url: '/webhooks/lead/pee-optin',
      legacyUrl: '/webhook/b7cfa33b-4a60-41ea-8b89-23cac76f335a',
    });
  });

  it('404s an unknown event slug', async () => {
    const res = await start().inject({ method: 'POST', url: '/webhooks/lead/nope', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('404s an unknown legacy webhook path', async () => {
    const res = await start().inject({ method: 'POST', url: '/webhook/00000000', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe('webhook secret', () => {
  const url = '/webhooks/lead/pee-optin';

  it('rejects a request with no secret when one is required', async () => {
    const res = await start({ WEBHOOK_SECRET: 'topsecret' }).inject({ method: 'POST', url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    const res = await start({ WEBHOOK_SECRET: 'topsecret' }).inject({
      method: 'POST',
      url,
      headers: { 'x-webhook-secret': 'guess' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a secret that is a prefix of the real one', async () => {
    const res = await start({ WEBHOOK_SECRET: 'topsecret' }).inject({
      method: 'POST',
      url,
      headers: { 'x-webhook-secret': 'top' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the right secret and then fails on the payload, not on auth', async () => {
    // No email in the body, so the handler rejects it with 400 — which proves
    // the request got past the secret check.
    const res = await start({ WEBHOOK_SECRET: 'topsecret' }).inject({
      method: 'POST',
      url,
      headers: { 'x-webhook-secret': 'topsecret' },
      payload: { full_name: 'No Email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
  });

  it('also accepts the secret as a bearer token', async () => {
    const res = await start({ WEBHOOK_SECRET: 'topsecret' }).inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer topsecret' },
      payload: { full_name: 'No Email' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('admin routes', () => {
  it('are open when no ADMIN_TOKEN is set', async () => {
    const res = await start().inject({ method: 'GET', url: '/admin/social/clients' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { clients: unknown[] }).clients).toHaveLength(5);
  });

  it('require the token once it is set', async () => {
    const res = await start({ ADMIN_TOKEN: 'admin-tok' }).inject({ method: 'GET', url: '/admin/jobs' });
    expect(res.statusCode).toBe(401);
  });

  it('accept the token', async () => {
    const res = await start({ ADMIN_TOKEN: 'admin-tok' }).inject({
      method: 'GET',
      url: '/admin/jobs',
      headers: { 'x-webhook-secret': 'admin-tok' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('summarise each client without exposing account IDs', async () => {
    const res = await start().inject({ method: 'GET', url: '/admin/social/clients' });
    const body = res.json() as { clients: Array<Record<string, unknown>> };
    const madison = body.clients.find((c) => c['slug'] === 'madison-ave');

    expect(madison).toMatchObject({ accounts: 'auto', locationId: 'ULFhETUirfUFnKUhgCcI' });
    expect(res.body).not.toContain('696f677c9d9a50e36c630ef5');
  });

  it('404s a run request for an unknown client', async () => {
    const res = await start().inject({ method: 'POST', url: '/admin/social/run/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-numeric image count before doing any work', async () => {
    const res = await start().inject({ method: 'POST', url: '/admin/social/run/avo-shack?images=abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: '`images` must be a positive integer' });
  });

  it('rejects a zero image count', async () => {
    const res = await start().inject({ method: 'POST', url: '/admin/social/run/avo-shack?images=0' });
    expect(res.statusCode).toBe(400);
  });
});
