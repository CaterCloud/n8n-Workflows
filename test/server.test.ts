import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { useTestEnv } from './helpers.js';
import { buildServer } from '../src/http/server.js';

let app: FastifyInstance;

function start(overrides: Record<string, string> = {}): FastifyInstance {
  useTestEnv(overrides);
  app = buildServer();
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe('health and readiness', () => {
  it('reports healthy', async () => {
    const res = await start().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('reports which integrations are configured without leaking values', async () => {
    const res = await start({
      LEAD_SHEET_ID: 'sheet-123',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'super-secret-value',
      GOOGLE_REFRESH_TOKEN: 'refresh-token-value',
    }).inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      timezone: 'Australia/Sydney',
      events: 6,
      configured: { google: true, leadSheet: true, webhookSecret: false },
    });
    expect(res.body).not.toContain('super-secret-value');
    expect(res.body).not.toContain('refresh-token-value');
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
  it('require the token once it is set', async () => {
    const res = await start({ ADMIN_TOKEN: 'admin-tok' }).inject({ method: 'GET', url: '/admin/lead/sheet' });
    expect(res.statusCode).toBe(401);
  });

  it('report a missing spreadsheet as a configuration problem, not a crash', async () => {
    const res = await start({ ADMIN_TOKEN: 'admin-tok', LEAD_SHEET_ID: '' }).inject({
      method: 'GET',
      url: '/admin/lead/sheet',
      headers: { 'x-webhook-secret': 'admin-tok' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false });
  });
});

describe('malformed requests', () => {
  it('rejects a body that is not JSON with a 400, not a 500', async () => {
    const res = await start().inject({
      method: 'POST',
      url: '/webhooks/lead/pee-optin',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
  });

  it('404s an unknown route', async () => {
    const res = await start().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });
});
