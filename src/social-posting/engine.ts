import { env, ghlTokenFor } from '../env.js';
import { logger as rootLogger } from '../logger.js';
import { ConfigError } from '../lib/errors.js';
import { settleLimit } from '../lib/concurrency.js';
import { nextDailySlots } from '../lib/dates.js';
import { baseNameFromUrl, mimeFromNameOrUrl, parseJsonLoose, pickRandom, stripEmojis } from '../lib/text.js';
import { downloadFile, exportDocAsText, listImagesInFolders, type DriveImage } from '../integrations/drive.js';
import { enhanceUrl, uploadImage } from '../integrations/cloudinary.js';
import { complete } from '../integrations/openai.js';
import {
  createSocialPost,
  getLocationV1,
  listSocialAccounts,
  requireToken,
  type SocialPostPayload,
} from '../integrations/ghl.js';
import {
  buildCaptionPrompt,
  FALLBACK_CAPTION,
  type CaptionContext,
  type CaptionResult,
} from './prompt.js';
import type { SocialClient, SocialSchedule } from './clients.js';

/**
 * The social posting pipeline, once.
 *
 * Drive folders -> pick N images -> Cloudinary upload + enhance -> GPT caption
 * from the brand brief -> scheduled GoHighLevel posts. This replaces twelve
 * copies of the same n8n graph.
 */

const UPLOAD_CONCURRENCY = 4;
const POST_CONCURRENCY = 2;

export interface RunOptions {
  /** Which of the client's schedules to run. Defaults to the first enabled one. */
  scheduleName?: string;
  /** Build payloads and log them without calling GoHighLevel. */
  dryRun?: boolean;
  /** Overrides the schedule's imageCount, for smoke tests. */
  imageCount?: number;
  /** Injected for deterministic tests. */
  now?: Date;
  random?: () => number;
}

export interface PostOutcome {
  imageId: string;
  imageName: string;
  mediaUrl: string;
  scheduleDate: string;
  accountIds: string[];
  platform?: string;
  summary: string;
  posted: boolean;
  postId?: string;
  error?: string;
}

export interface RunResult {
  slug: string;
  brandName: string;
  schedule: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  imagesAvailable: number;
  imagesSelected: number;
  postsAttempted: number;
  postsCreated: number;
  postsFailed: number;
  outcomes: PostOutcome[];
  warnings: string[];
}

interface ResolvedAccount {
  id: string;
  platform?: string;
}

interface PreparedImage {
  image: DriveImage;
  usedUrl: string;
  caption: CaptionResult;
}

function pickSchedule(client: SocialClient, name?: string): SocialSchedule {
  if (name) {
    const found = client.schedules.find((s) => s.name === name);
    if (!found) {
      throw new ConfigError(
        `Client ${client.slug} has no schedule named "${name}". Available: ${client.schedules
          .map((s) => s.name)
          .join(', ')}`,
      );
    }
    return found;
  }

  const first = client.schedules.find((s) => s.enabled) ?? client.schedules[0];
  if (!first) throw new ConfigError(`Client ${client.slug} has no schedules`);
  return first;
}

/**
 * The GHL account IDs to post to. `auto` reads the live account list, which is
 * what rescues Madison Ave (its n8n copy shipped an empty array). Explicit IDs
 * are only cross-referenced against the live list when we need to know each
 * account's platform.
 */
async function resolveAccounts(
  client: SocialClient,
  token: string,
  warnings: string[],
): Promise<ResolvedAccount[]> {
  const needsPlatforms = client.accountIds === 'auto' || client.perPlatformCaptions;
  const live = needsPlatforms ? await listSocialAccounts(client.locationId, token) : [];

  if (client.accountIds === 'auto') {
    const wanted = new Set(client.autoAccountPlatforms.map((p) => p.toLowerCase()));
    const usable = live.filter((a) => {
      if (a.isExpired) {
        warnings.push(`GHL account ${a.id} (${a.platform}) is expired and was skipped`);
        return false;
      }
      return wanted.size === 0 || wanted.has(a.platform.toLowerCase());
    });

    if (usable.length === 0) {
      throw new ConfigError(
        `No usable social accounts on GHL location ${client.locationId} for client ${client.slug}`,
      );
    }
    return usable.map((a) => ({ id: a.id, platform: a.platform }));
  }

  const byId = new Map(live.map((a) => [a.id, a]));
  return client.accountIds.map((id) => {
    const match = byId.get(id);
    return match ? { id, platform: match.platform } : { id };
  });
}

/** Drive bytes -> Cloudinary -> enhanced delivery URL. */
async function toHostedUrl(image: DriveImage): Promise<string> {
  const bytes = await downloadFile(image.id);
  const upload = await uploadImage(bytes, image.name, image.mimeType);
  return enhanceUrl(upload.secureUrl);
}

async function writeCaption(
  client: SocialClient,
  image: DriveImage,
  mediaUrl: string,
  brandContext: string,
  random: () => number,
): Promise<CaptionResult> {
  const ctx: CaptionContext = {
    brandName: client.brandName,
    brandContext,
    mediaUrl,
    city: client.city,
    link: client.link,
    platforms: client.platforms,
    locale: client.locale,
    toneMode: client.toneMode,
    humourProbability: client.humourProbability,
    allowedHashtags: client.allowedHashtags,
    bannedHashtags: client.bannedHashtags,
    promotePrivateEvent: random() < client.promotePrivateEventProbability,
  };

  const raw = await complete({ user: buildCaptionPrompt(ctx), json: true });
  const parsed = parseJsonLoose<{
    caption?: unknown;
    platform_variations?: Record<string, unknown>;
  }>(raw);

  if (!parsed || typeof parsed.caption !== 'string') {
    rootLogger.warn('caption JSON unparseable, using fallback', {
      slug: client.slug,
      imageId: image.id,
      preview: raw.slice(0, 200),
    });
    return FALLBACK_CAPTION;
  }

  const variations = parsed.platform_variations ?? {};
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v : fallback);

  return {
    caption: parsed.caption,
    instagram: str(variations['instagram'], parsed.caption),
    facebook: str(variations['facebook'], parsed.caption),
    googleMyBusiness: str(variations['google_my_business'], parsed.caption),
    tiktok: typeof variations['tiktok'] === 'string' ? (variations['tiktok'] as string) : '',
  };
}

/** Which generated variant a platform should carry. */
function captionForPlatform(caption: CaptionResult, platform?: string): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return caption.instagram;
    case 'facebook':
      return caption.facebook;
    case 'google':
    case 'google_my_business':
    case 'gmb':
      return caption.googleMyBusiness;
    case 'tiktok':
      return caption.tiktok || caption.caption;
    default:
      return caption.caption;
  }
}

function finaliseSummary(client: SocialClient, text: string, image: DriveImage): string {
  const fallback = `Fresh from ${client.brandName}: ${image.name.replace(/\.[^/.]+$/, '')}`;
  const base = text.trim() ? text : fallback;
  return (client.stripEmojis ? stripEmojis(base) : base).trim();
}

/** One group per connected platform, so each can carry its own caption. */
function groupByPlatform(accounts: readonly ResolvedAccount[]): Array<{ accountIds: string[]; platform?: string }> {
  const groups = new Map<string, string[]>();
  for (const account of accounts) {
    const key = account.platform ?? '';
    const existing = groups.get(key);
    if (existing) existing.push(account.id);
    else groups.set(key, [account.id]);
  }
  return [...groups].map(([platform, accountIds]) => ({
    accountIds,
    ...(platform ? { platform } : {}),
  }));
}

interface PlannedPost {
  image: DriveImage;
  mediaUrl: string;
  accountIds: string[];
  platform?: string;
  payload: SocialPostPayload;
}

function planPosts(
  client: SocialClient,
  schedule: SocialSchedule,
  prepared: PreparedImage[],
  accounts: ResolvedAccount[],
  now: Date,
): PlannedPost[] {
  const slots = nextDailySlots(
    prepared.length,
    schedule.scheduleHour,
    schedule.scheduleMinute,
    env().SCHEDULE_TIMEZONE,
    now,
  );

  const groups = client.perPlatformCaptions
    ? groupByPlatform(accounts)
    : [{ accountIds: accounts.map((a) => a.id) } as { accountIds: string[]; platform?: string }];

  const planned: PlannedPost[] = [];

  prepared.forEach((item, index) => {
    const scheduleDate = (slots[index] ?? new Date()).toISOString();

    for (const group of groups) {
      const summary = finaliseSummary(
        client,
        captionForPlatform(item.caption, group.platform),
        item.image,
      );

      planned.push({
        image: item.image,
        mediaUrl: item.usedUrl,
        accountIds: group.accountIds,
        platform: group.platform,
        payload: {
          accountIds: group.accountIds,
          summary,
          media: [{ url: item.usedUrl, type: mimeFromNameOrUrl(item.image.name || item.usedUrl) }],
          type: 'post',
          status: client.postStatus,
          scheduleDate,
          ...(client.userId ? { userId: client.userId } : {}),
          mediaOptimization: true,
        },
      });
    }
  });

  return planned;
}

/** Runs one client's schedule end to end. */
export async function runClient(client: SocialClient, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const schedule = pickSchedule(client, options.scheduleName);
  const dryRun = options.dryRun ?? env().SOCIAL_DRY_RUN;
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const warnings: string[] = [];
  const log = rootLogger.child({ workflow: 'social-posting', slug: client.slug, schedule: schedule.name });

  const token = requireToken(client.slug, ghlTokenFor(client.slug));
  const imageCount = options.imageCount ?? schedule.imageCount;
  const minImages = schedule.minImages ?? imageCount;

  log.info('run started', { dryRun, imageCount, minImages });

  // The n8n graph opened with a v1 location fetch whose body went unused — a
  // credential pre-flight. Keep it advisory: a failure here must not stop a run
  // that the v2 token can still complete.
  try {
    await getLocationV1(client.locationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`v1 location pre-flight failed: ${message}`);
    log.warn('v1 location pre-flight failed', { error: message });
  }

  const [brandContext, images, accounts] = await Promise.all([
    client.brandBriefDocId
      ? exportDocAsText(client.brandBriefDocId).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`brand brief could not be read: ${message}`);
          log.warn('brand brief unavailable', { error: message });
          return '';
        })
      : Promise.resolve(''),
    listImagesInFolders(client.imageFolderIds),
    resolveAccounts(client, token, warnings),
  ]);

  if (images.length < minImages) {
    throw new ConfigError(
      `Client ${client.slug} needs at least ${minImages} images across ${client.imageFolderIds.length} Drive folder(s), found ${images.length}`,
    );
  }

  const selected = pickRandom(images, imageCount, random);
  log.info('images selected', { available: images.length, selected: selected.length, accounts: accounts.length });

  const preparedResults = await settleLimit(selected, UPLOAD_CONCURRENCY, async (image) => {
    const usedUrl = await toHostedUrl(image);
    const caption = await writeCaption(client, image, usedUrl, brandContext, random);
    return { image, usedUrl, caption } satisfies PreparedImage;
  });

  const prepared: PreparedImage[] = [];
  preparedResults.forEach((result, index) => {
    if (result.ok) {
      prepared.push(result.value);
      return;
    }
    const image = selected[index]!;
    warnings.push(`image ${image.name} (${image.id}) skipped: ${result.error.message}`);
    log.warn('image preparation failed', { imageId: image.id, error: result.error.message });
  });

  if (prepared.length === 0) {
    throw new Error(`Client ${client.slug}: every image failed to prepare; nothing was posted`);
  }

  const planned = planPosts(client, schedule, prepared, accounts, now);

  const postResults = await settleLimit(planned, POST_CONCURRENCY, async (post) => {
    if (dryRun) {
      log.info('dry run post', {
        imageId: post.image.id,
        platform: post.platform ?? 'all',
        scheduleDate: post.payload.scheduleDate,
        accountIds: post.accountIds,
        summary: post.payload.summary,
      });
      return undefined;
    }
    const created = await createSocialPost(client.locationId, token, post.payload);
    return typeof created?.id === 'string' ? created.id : undefined;
  });

  const outcomes: PostOutcome[] = planned.map((post, index) => {
    const result = postResults[index]!;
    const base = {
      imageId: post.image.id,
      imageName: post.image.name,
      mediaUrl: post.mediaUrl,
      scheduleDate: post.payload.scheduleDate,
      accountIds: post.accountIds,
      platform: post.platform,
      summary: post.payload.summary,
    };
    if (result.ok) {
      return { ...base, posted: !dryRun, ...(result.value ? { postId: result.value } : {}) };
    }
    return { ...base, posted: false, error: result.error.message };
  });

  const postsCreated = outcomes.filter((o) => o.posted).length;
  const postsFailed = outcomes.filter((o) => o.error).length;
  const finished = Date.now();

  for (const outcome of outcomes) {
    if (outcome.error) log.error('post failed', { imageId: outcome.imageId, error: outcome.error });
  }

  log.info('run finished', {
    dryRun,
    attempted: outcomes.length,
    created: postsCreated,
    failed: postsFailed,
    warnings: warnings.length,
    durationMs: finished - started,
  });

  return {
    slug: client.slug,
    brandName: client.brandName,
    schedule: schedule.name,
    dryRun,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    imagesAvailable: images.length,
    imagesSelected: selected.length,
    postsAttempted: outcomes.length,
    postsCreated,
    postsFailed,
    outcomes,
    warnings,
  };
}

export { planPosts as planPostsForTesting, captionForPlatform, finaliseSummary };
