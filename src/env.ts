import { z } from 'zod';

/**
 * All runtime configuration arrives through environment variables. Nothing
 * secret is committed to this repository — see docs/SECRETS.md.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return def;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Timezone every cron expression and scheduled post time is interpreted in. */
  SCHEDULE_TIMEZONE: z.string().default('Australia/Sydney'),

  /** Google OAuth (Drive + Sheets) — a user refresh token, as n8n used. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),

  /** Cloudinary unsigned upload (preset was `n8n_upload` in the n8n workflows). */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_UPLOAD_PRESET: z.string().default('n8n_upload'),

  /** GoHighLevel. Per-client override: GHL_TOKEN_<SLUG_UPPER_SNAKE>. */
  GHL_API_TOKEN: z.string().optional(),
  GHL_AGENCY_JWT: z.string().optional(),
  GHL_USER_ID: z.string().optional(),
  GHL_API_VERSION: z.string().default('2021-07-28'),

  /** Lead tracker destination spreadsheet. */
  LEAD_SHEET_ID: z.string().optional(),
  LEAD_SHEET_NAME: z.string().default('PEE '),

  /** Shared secret required on lead-tracker webhooks when set. */
  WEBHOOK_SECRET: z.string().optional(),
  /** Bearer token required on /admin routes when set. */
  ADMIN_TOKEN: z.string().optional(),

  /** `all`, `none`, or a comma-separated list of client slugs. */
  SOCIAL_ENABLED_CLIENTS: z.string().default('none'),
  /** Build and log the GHL payloads but never POST them. */
  SOCIAL_DRY_RUN: bool(false),
  /** Register cron jobs on boot. */
  SCHEDULER_ENABLED: bool(true),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

  /** Extra client slugs to skip even if SOCIAL_ENABLED_CLIENTS=all. */
  SOCIAL_DISABLED_CLIENTS: csv,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test hook — lets suites inject configuration without touching process.env. */
export function setEnvForTesting(value: Env | undefined): void {
  cached = value;
}

/**
 * Resolves the GoHighLevel token for a client: a per-client variable wins over
 * the shared fallback. `avo-shack` -> `GHL_TOKEN_AVO_SHACK`.
 */
export function ghlTokenFor(slug: string, source: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = `GHL_TOKEN_${slug.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
  return source[key]?.trim() || env().GHL_API_TOKEN;
}
