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

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Zone used to render the "OPTED IN DATE / TIME" column. The one workflow in
   * the export that declared a timezone set Australia/Sydney.
   */
  TIMEZONE: z.string().default('Australia/Sydney'),

  /**
   * Google Sheets access, either way round. A service account key is the
   * simpler option and takes precedence; the OAuth trio is the same grant n8n
   * held. See docs/GOOGLE-OAUTH.md.
   */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),

  /** The destination spreadsheet: "PEE Optin - Utm", tab `PEE ` (gid 2130596273). */
  LEAD_SHEET_ID: z.string().optional(),
  LEAD_SHEET_NAME: z.string().default('PEE '),

  /** Shared secret required on the webhook routes when set. */
  WEBHOOK_SECRET: z.string().optional(),
  /** Bearer token required on /admin routes when set. */
  ADMIN_TOKEN: z.string().optional(),

  /** Accept and log a webhook without writing to the sheet. */
  DRY_RUN: bool(false),
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
