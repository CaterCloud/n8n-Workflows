import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { ConfigError, HttpError } from '../lib/errors.js';
import { withLock } from '../lib/mutex.js';
import { LEAD_EVENTS, leadEventByN8nPath, leadEventBySlug, type LeadEvent } from '../lead-tracker/events.js';
import { handleLeadEvent, MissingMatchValueError } from '../lead-tracker/handler.js';
import { allClients, clientBySlug } from '../social-posting/clients.js';
import { runClient } from '../social-posting/engine.js';
import { listJobs } from '../scheduler.js';

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

  app.setErrorHandler((error, req, reply) => {
    const base = { method: req.method, url: req.url };

    if (error instanceof MissingMatchValueError) {
      logger.warn('webhook rejected', { ...base, reason: error.message });
      return reply.code(400).send({ ok: false, error: error.message });
    }
    if (error instanceof ConfigError) {
      logger.error('configuration error', { ...base, error: error.message });
      return reply.code(503).send({ ok: false, error: error.message });
    }
    if (error instanceof HttpError) {
      logger.error('upstream error', { ...base, status: error.status, error: error.message });
      return reply.code(502).send({ ok: false, error: `upstream ${error.status}`, detail: error.message });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ ok: false, error: error.message });
    }

    logger.error('unhandled error', { ...base, error: error.message, stack: error.stack });
    return reply.code(500).send({ ok: false, error: 'internal error' });
  });

  app.get('/health', async () => ({ ok: true, uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/ready', async () => {
    const e = env();
    return {
      ok: true,
      timezone: e.SCHEDULE_TIMEZONE,
      dryRun: e.SOCIAL_DRY_RUN,
      schedulerEnabled: e.SCHEDULER_ENABLED,
      configured: {
        google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REFRESH_TOKEN),
        openai: Boolean(e.OPENAI_API_KEY),
        cloudinary: Boolean(e.CLOUDINARY_CLOUD_NAME),
        ghlToken: Boolean(e.GHL_API_TOKEN),
        leadSheet: Boolean(e.LEAD_SHEET_ID),
        webhookSecret: Boolean(e.WEBHOOK_SECRET),
        adminToken: Boolean(e.ADMIN_TOKEN),
      },
      jobs: listJobs(),
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

    // Serialise per spreadsheet so a read/append pair cannot interleave.
    const result = await withLock(`lead-sheet:${env().LEAD_SHEET_ID ?? 'unset'}`, () =>
      handleLeadEvent(event, req.body),
    );
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

  app.get('/admin/social/clients', async () => ({
    ok: true,
    clients: allClients().map((c) => ({
      slug: c.slug,
      brandName: c.brandName,
      locationId: c.locationId,
      folders: c.imageFolderIds.length,
      accounts: c.accountIds === 'auto' ? 'auto' : c.accountIds.length,
      postStatus: c.postStatus,
      schedules: c.schedules,
      notes: c.notes,
    })),
  }));

  app.get('/admin/jobs', async () => ({ ok: true, jobs: listJobs() }));

  app.post('/admin/social/run/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const client = clientBySlug(slug);
    if (!client) return reply.code(404).send({ ok: false, error: `unknown client "${slug}"` });

    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const dryRunRaw = query['dryRun'] ?? (body['dryRun'] as string | boolean | undefined);
    const dryRun =
      dryRunRaw === undefined ? undefined : ['1', 'true', 'yes', true].includes(dryRunRaw as string | boolean);

    const imageCountRaw = query['images'] ?? (body['images'] as string | number | undefined);
    const imageCount = imageCountRaw === undefined ? undefined : Number(imageCountRaw);
    if (imageCount !== undefined && (!Number.isInteger(imageCount) || imageCount < 1)) {
      return reply.code(400).send({ ok: false, error: '`images` must be a positive integer' });
    }

    const scheduleName = query['schedule'] ?? (body['schedule'] as string | undefined);

    const result = await runClient(client, {
      ...(scheduleName ? { scheduleName } : {}),
      ...(dryRun === undefined ? {} : { dryRun }),
      ...(imageCount === undefined ? {} : { imageCount }),
    });

    return reply.code(200).send({ ok: true, result });
  });

  return app;
}
