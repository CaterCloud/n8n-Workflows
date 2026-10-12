import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { ConfigError, MissingMatchValueError, describeGoogleError } from '../lib/errors.js';
import { withLock } from '../lib/mutex.js';
import { LEAD_EVENTS, leadEventByN8nPath, leadEventBySlug, type LeadEvent } from '../lead-tracker/events.js';
import { handleLeadEvent } from '../lead-tracker/handler.js';
import { configuredAuthMode, serviceAccountEmail } from '../integrations/google-auth.js';
import { capture, captureEnabled, clearCaptures, describeShape, recentCaptures } from '../lead-tracker/capture.js';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

/** Constant-time string compare that tolerates differing lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedSecret(req: FastifyRequest): string | undefined {
  const header = req.headers['x-webhook-secret'];
  if (typeof header === 'string') return header;

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);

  const query = (req.query as Record<string, unknown> | undefined)?.['secret'];
  if (typeof query === 'string') return query;

  return undefined;
}

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  app.addHook('onRequest', async (req) => {
    logger.debug('request', { method: req.method, url: req.url });
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    const base = { method: req.method, url: req.url };

    if (error instanceof MissingMatchValueError) {
      logger.warn('webhook rejected', { ...base, reason: error.message });
      return reply.code(400).send({ ok: false, error: error.message });
    }
    if (error instanceof ConfigError) {
      logger.error('configuration error', { ...base, error: error.message });
      return reply.code(503).send({ ok: false, error: error.message });
    }

    const google = describeGoogleError(error);
    if (google) {
      logger.error('google sheets error', { ...base, status: google.status, error: google.message });
      return reply
        .code(502)
        .send({ ok: false, error: `Google Sheets returned ${google.status}`, detail: google.message });
    }

    // Fastify's own 4xx errors (malformed JSON, unsupported media type, and
    // so on) carry a usable status and message; pass those through.
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ ok: false, error: messageOf(error) });
    }

    logger.error('unhandled error', {
      ...base,
      error: messageOf(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return reply.code(500).send({ ok: false, error: 'internal error' });
  });

  app.get('/health', async () => ({ ok: true, uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/ready', async () => {
    const e = env();
    const authMode = configuredAuthMode();
    return {
      ok: true,
      timezone: e.TIMEZONE,
      dryRun: e.DRY_RUN,
      sheetName: e.LEAD_SHEET_NAME,
      googleAuth: authMode ?? 'not configured',
      /**
       * Shown so the sheet can be shared with the right address. A service
       * account email is not a secret — it is the whole point of sharing.
       */
      serviceAccountEmail: serviceAccountEmail() ?? null,
      configured: {
        google: Boolean(authMode),
        leadSheet: Boolean(e.LEAD_SHEET_ID),
        webhookSecret: Boolean(e.WEBHOOK_SECRET),
        adminToken: Boolean(e.ADMIN_TOKEN),
      },
      events: LEAD_EVENTS.length,
    };
  });

  /** Shared body handler for both the friendly and legacy webhook routes. */
  async function runLeadEvent(event: LeadEvent, req: FastifyRequest, reply: FastifyReply) {
    const expected = env().WEBHOOK_SECRET;
    if (expected) {
      const provided = presentedSecret(req);
      if (!provided || !secretMatches(provided, expected)) {
        logger.warn('webhook rejected: bad secret', { event: event.slug, url: req.url });
        return reply.code(401).send({ ok: false, error: 'unauthorized' });
      }
    }

    capture({ at: new Date().toISOString(), event: event.slug, path: req.url, body: req.body });

    // Serialise per spreadsheet so a read/append pair cannot interleave.
    const result = await withLock(`lead-sheet:${env().LEAD_SHEET_ID ?? 'unset'}`, () =>
      handleLeadEvent(event, req.body),
    );

    if (result.emptyColumns.length) {
      logger.warn('mapped columns resolved empty', {
        event: event.slug,
        emptyColumns: result.emptyColumns,
        hint: captureEnabled()
          ? 'inspect the payload at GET /admin/lead/recent'
          : 'set WEBHOOK_CAPTURE=true to inspect the next payload',
      });
    }

    return reply.code(200).send({ ok: true, ...result });
  }

  app.post('/webhooks/lead/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const event = leadEventBySlug(slug);
    if (!event) return reply.code(404).send({ ok: false, error: `unknown lead event "${slug}"` });
    return runLeadEvent(event, req, reply);
  });

  /**
   * Drop-in replacement for the n8n URLs. The GoHighLevel webhooks already
   * point at `https://<n8n-host>/webhook/<uuid>`; swapping the host is enough.
   */
  app.post('/webhook/:path', async (req, reply) => {
    const { path } = req.params as { path: string };
    const event = leadEventByN8nPath(path);
    if (!event) return reply.code(404).send({ ok: false, error: 'unknown webhook path' });
    return runLeadEvent(event, req, reply);
  });

  app.get('/webhooks/lead', async () => ({
    ok: true,
    events: LEAD_EVENTS.map((e) => ({
      slug: e.slug,
      name: e.name,
      url: `/webhooks/lead/${e.slug}`,
      legacyUrl: `/webhook/${e.n8nPath}`,
      matchColumn: e.matchColumn,
      onMissingRow: e.onMissingRow,
      updateColumns: Object.keys(e.onUpdate),
      appendColumns: Object.keys(e.onAppend),
      notes: e.notes,
    })),
  }));

  /** Admin routes are gated whenever ADMIN_TOKEN is set. */
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin')) return;
    const expected = env().ADMIN_TOKEN;
    if (!expected) return;
    const provided = presentedSecret(req);
    if (!provided || !secretMatches(provided, expected)) {
      await reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  });

  /** The spreadsheet header as the service currently reads it. */
  app.get('/admin/lead/sheet', async () => {
    const { readTable } = await import('../integrations/sheets.js');
    const e = env();
    if (!e.LEAD_SHEET_ID) {
      throw new ConfigError('LEAD_SHEET_ID is not set — the lead tracker has no destination spreadsheet');
    }
    const table = await readTable(e.LEAD_SHEET_ID, e.LEAD_SHEET_NAME);
    const mapped = new Set(LEAD_EVENTS.flatMap((ev) => [...Object.keys(ev.onUpdate), ...Object.keys(ev.onAppend)]));
    return {
      ok: true,
      sheetName: e.LEAD_SHEET_NAME,
      rowCount: table.rows.length,
      header: table.header,
      /** Columns the events write that the sheet does not have — a live check. */
      missingFromSheet: [...mapped].filter((c) => !table.header.includes(c)),
    };
  });

  /**
   * The last few webhook payloads, with a flattened view of their shape. Only
   * populated while WEBHOOK_CAPTURE is on.
   */
  app.get('/admin/lead/recent', async () => {
    const captures = recentCaptures();
    return {
      ok: true,
      captureEnabled: captureEnabled(),
      count: captures.length,
      hint: captureEnabled()
        ? 'Turn WEBHOOK_CAPTURE off once you are done — this holds real lead data.'
        : 'Set WEBHOOK_CAPTURE=true to start capturing, then re-send a webhook.',
      captures: captures.map((c) => ({
        at: c.at,
        event: c.event,
        path: c.path,
        /** Every leaf path in the payload — the mapping source of truth. */
        shape: describeShape(c.body),
        body: c.body,
      })),
    };
  });

  app.delete('/admin/lead/recent', async () => {
    clearCaptures();
    return { ok: true, cleared: true };
  });

  return app;
}
