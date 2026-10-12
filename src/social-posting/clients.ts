import { z } from 'zod';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Per-client configuration for the social posting pipeline.
 *
 * In n8n each client was a hand-copied duplicate of the same 16-node graph,
 * with the IDs edited inside Code nodes and HTTP URLs. Twelve workflow files
 * covered five real GoHighLevel locations; the rest were stale copies (two
 * "Junction Cafe" files pointed at Spanish Paella's location while loading Avo
 * Shack's brand brief). Those IDs all live here instead, and the pipeline
 * itself exists once.
 */

export const scheduleSchema = z.object({
  /** Stable name, used in logs and in the manual-run endpoint. */
  name: z.string().min(1),
  /** 5-field cron, interpreted in SCHEDULE_TIMEZONE. */
  cron: z.string().min(1),
  /** How many images to select — one scheduled post per image. */
  imageCount: z.number().int().positive(),
  /**
   * Refuse to run unless the Drive folders hold at least this many images.
   * The n8n code threw when `images < imageCount`; keeping it separate lets a
   * client post a 3-image daily batch from a 200-image library.
   */
  minImages: z.number().int().positive().optional(),
  /** Local time of day each generated post is scheduled for. */
  scheduleHour: z.number().int().min(0).max(23).default(10),
  scheduleMinute: z.number().int().min(0).max(59).default(0),
  enabled: z.boolean().default(true),
});

export const clientSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
  brandName: z.string().min(1),
  locationId: z.string().min(1),
  imageFolderIds: z.array(z.string().min(1)).min(1),
  brandBriefDocId: z.string().optional(),
  /**
   * Explicit GHL social account IDs, or `auto` to resolve them from
   * `/social-media-posting/{locationId}/accounts` at run time.
   */
  accountIds: z.union([z.array(z.string().min(1)).min(1), z.literal('auto')]),
  /** Platforms to keep when accountIds is `auto`. Empty means all connected. */
  autoAccountPlatforms: z.array(z.string().min(1)).default([]),
  userId: z.string().optional(),
  city: z.string().optional(),
  link: z.string().optional(),
  platforms: z.string().optional(),
  locale: z.string().default('en-AU'),
  toneMode: z.enum(['auto', 'straight', 'blunt']).default('auto'),
  humourProbability: z.number().min(0).max(1).default(0.35),
  /**
   * Chance a given post nods to private catering. The n8n prompt documented
   * "~50% of posts" but nothing ever set the flag, so it was always false.
   */
  promotePrivateEventProbability: z.number().min(0).max(1).default(0.5),
  allowedHashtags: z.array(z.string()).default([]),
  bannedHashtags: z.array(z.string()).default([]),
  /** `scheduled` matches the n8n behaviour; `draft` stages for human review. */
  postStatus: z.enum(['draft', 'scheduled']).default('scheduled'),
  /** Strip emoji from the summary, as the n8n Create Post node did. */
  stripEmojis: z.boolean().default(true),
  /**
   * One post per platform using that platform's tailored caption, instead of
   * one post to every account carrying the shared base caption. The n8n graph
   * generated the per-platform variants and then discarded them.
   */
  perPlatformCaptions: z.boolean().default(false),
  schedules: z.array(scheduleSchema).min(1),
  notes: z.string().optional(),
});

export type SocialSchedule = z.infer<typeof scheduleSchema>;
export type SocialClient = z.infer<typeof clientSchema>;

/** Default GHL post author, from the n8n `USER_ID` constant. */
const DEFAULT_USER_ID = 'lWZjS6ppoRL7w9v2r1VM';

const RAW_CLIENTS: Array<z.input<typeof clientSchema>> = [
  {
    slug: 'junction-cafe',
    brandName: 'Junction Cafe',
    locationId: 'Ug16dt3qfWWQu0tliuGr',
    imageFolderIds: [
      '1XQlgm1WdRtpLE6C_RwSMLElhwFLiVKxY',
      '1Muqi80TIl_wA-TzQyCJ048UyHr6aOu26',
      '1f9JHOf2G_MCvCnc7MwA6s8u9Su1u6TDS',
    ],
    brandBriefDocId: '1bnACi_E2l17XMpqBFeOs_n46_LjeQuxxcmH7xm8E5H4',
    accountIds: [
      '6842412f0b2cd7868835bac8_Ug16dt3qfWWQu0tliuGr_4918053003130169250',
      '68424061ee13aa135f4f1c0e_Ug16dt3qfWWQu0tliuGr_108324241854723_page',
      '68424061ee13aa135f4f1c0e_Ug16dt3qfWWQu0tliuGr_209024725634554_page',
      '68424061ee13aa135f4f1c0e_Ug16dt3qfWWQu0tliuGr_100989293061236_page',
      '684240aaeaab949f5f3a9b3b_Ug16dt3qfWWQu0tliuGr_17841460723003098',
    ],
    userId: DEFAULT_USER_ID,
    schedules: [{ name: 'monthly-batch', cron: '0 10 26 * *', imageCount: 30, minImages: 30 }],
    notes: 'From 0Qi0jdNZ2ZaRtSzD. Two further "Junction Cafe" files targeted Spanish Paella\'s location and are not reproduced.',
  },
  {
    slug: 'spanish-paella',
    brandName: 'Spanish Paella',
    locationId: 'RMmf289hB5J7LjtJJLYt',
    imageFolderIds: [
      '1vBEr5-M0gENytP7hoDy9IfisDmVLkj2c',
      '1cDxcukpHcnEmGMh5E2WJQwNM7z8C7hIi',
      '1xSPgB-uzmw9SfqNrG6QEmr9GyZz5NvFp',
      '1PHutRoSunX1jJ2mDOsbmuz8KJL-XhiYX',
    ],
    brandBriefDocId: '1dG8lf3XQeKEmgx28Ca7COaduE7JoDw6yI_N4CTx5iRI',
    accountIds: [
      '6893f5a15e610eadc31ce823_RMmf289hB5J7LjtJJLYt_5785078155395707813',
      '6893f54d5c4cf8633d4e3dd8_RMmf289hB5J7LjtJJLYt_360456737156031_page',
      '6893f586c9b9253d0eeba628_RMmf289hB5J7LjtJJLYt_17841466410443185',
    ],
    userId: DEFAULT_USER_ID,
    schedules: [{ name: 'monthly-batch', cron: '0 10 25 * *', imageCount: 30, minImages: 30 }],
    notes: 'From 3FUN0IaRvnJRa6ye. A sibling file also ran weekdays (0 10 * * 1-5) against the same location, which would double-post; only the monthly batch is enabled.',
  },
  {
    slug: 'avo-shack',
    brandName: 'The Avo Shack',
    locationId: 'NeGmNMm3xs5QfUpL5qRA',
    imageFolderIds: [
      '1hicgOLjOIqW_wW3EgjsYTp7BGkt-DrWT',
      '1S8vbJGT8-xYxvRUNxPMlbZDmSbcwIcNi',
      '1aHKxe6df0CWlrOt2-huykn7GoQl4VbKI',
    ],
    brandBriefDocId: '14bJQgqvMOVYToXUD7gWC0rjViacAg0V6pkRKwHWxaJU',
    accountIds: [
      '66a092ff9da3812b8506def4_NeGmNMm3xs5QfUpL5qRA_10164004163556484867',
      '66a094069da38160a706df6b_NeGmNMm3xs5QfUpL5qRA_359381653933375_page',
      '66a0942d72c2be83def034e4_NeGmNMm3xs5QfUpL5qRA_17841453456772009',
    ],
    userId: DEFAULT_USER_ID,
    schedules: [{ name: 'daily', cron: '0 10 * * *', imageCount: 3, minImages: 3 }],
    notes: 'From UziQikocYoifIS0N / s5KTjcIYG10RWoE4 / xoPDsy9DmGN4gtyj — three near-identical files on the same location and daily 10:00 trigger.',
  },
  {
    slug: 'madame-cue',
    brandName: 'Madame Cue',
    locationId: 'mqdAQkVtmwpoXe1eJ828',
    imageFolderIds: ['1QaZQxUTkrjhDy3Eq87Y1Y4KWvrPoS_LN', '1HPCaNKlTUNVoMQHO8I_o5XXi1G2HLFnv'],
    brandBriefDocId: '16Nw7xsszRIASZ7nHW1cZYBGQUZegwg9G9qNI65tu-9o',
    accountIds: ['696f677c9d9a50e36c630ef5_mqdAQkVtmwpoXe1eJ828_958572700671827_page'],
    userId: DEFAULT_USER_ID,
    schedules: [{ name: 'yearly-4-march', cron: '0 10 4 3 *', imageCount: 30, minImages: 30 }],
    notes: 'From oocoqoafCHhObq1N. Its cron (0 10 4 3 *) fires once a year on 4 March — almost certainly a leftover test value. Change to "0 10 4 * *" for a monthly batch.',
  },
  {
    slug: 'madison-ave',
    brandName: 'Madison Ave',
    locationId: 'ULFhETUirfUFnKUhgCcI',
    imageFolderIds: [
      '13P-rirBGRUbqK0V_22Pb5kqp9Y84Izob',
      '1_DVl-9zchKxcZ9_Tv26m_QF4y9kgnBAc',
      '1efLB2W9ug5AhCRbKNzoYgD4TWIGj6sz_',
    ],
    brandBriefDocId: '1yokDp3C3ke_k9kzoqIjsLhYG_mlHAYAyKY2HaCZVg4w',
    accountIds: 'auto',
    userId: DEFAULT_USER_ID,
    schedules: [{ name: 'monthly-batch', cron: '0 10 8 * *', imageCount: 30, minImages: 30 }],
    notes: 'From ywrfXE1qReeYxvL2, whose ACCOUNT_IDS array was empty — every post it built would have been rejected. Resolved from the live GHL account list instead.',
  },
];

const overridesSchema = z.record(z.string(), clientSchema.deepPartial());

function applyOverrides(clients: SocialClient[]): SocialClient[] {
  const raw = process.env['SOCIAL_CLIENT_OVERRIDES']?.trim();
  if (!raw) return clients;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('SOCIAL_CLIENT_OVERRIDES is not valid JSON; ignoring it');
    return clients;
  }

  const result = overridesSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('SOCIAL_CLIENT_OVERRIDES failed validation; ignoring it', {
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return clients;
  }

  return clients.map((client) => {
    const patch = result.data[client.slug];
    if (!patch) return client;
    const merged = clientSchema.safeParse({ ...client, ...patch });
    if (!merged.success) {
      logger.error('SOCIAL_CLIENT_OVERRIDES produced an invalid client; keeping the default', {
        slug: client.slug,
        issues: merged.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return client;
    }
    logger.info('applied client override', { slug: client.slug, keys: Object.keys(patch) });
    return merged.data;
  });
}

let cache: SocialClient[] | undefined;

/** Every configured client, overrides applied. */
export function allClients(): SocialClient[] {
  if (!cache) {
    cache = applyOverrides(RAW_CLIENTS.map((c) => clientSchema.parse(c)));
  }
  return cache;
}

export function clientBySlug(slug: string): SocialClient | undefined {
  return allClients().find((c) => c.slug === slug);
}

/**
 * Clients the scheduler should register, per SOCIAL_ENABLED_CLIENTS
 * (`all`, `none`, or a comma-separated slug list) minus
 * SOCIAL_DISABLED_CLIENTS. Defaults to `none` so a fresh deploy never
 * double-posts alongside a still-running n8n instance.
 */
export function enabledClients(): SocialClient[] {
  const setting = env().SOCIAL_ENABLED_CLIENTS.trim().toLowerCase();
  const disabled = new Set(env().SOCIAL_DISABLED_CLIENTS);

  if (setting === 'none' || setting === '') return [];

  const selected =
    setting === 'all'
      ? allClients()
      : (() => {
          const wanted = setting
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const known = new Set(allClients().map((c) => c.slug));
          for (const slug of wanted) {
            if (!known.has(slug)) logger.warn('SOCIAL_ENABLED_CLIENTS names an unknown client', { slug });
          }
          return allClients().filter((c) => wanted.includes(c.slug));
        })();

  return selected.filter((c) => !disabled.has(c.slug));
}

/** Test hook. */
export function resetClientCacheForTesting(): void {
  cache = undefined;
}
