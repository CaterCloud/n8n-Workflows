import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestEnv } from './helpers.js';

/**
 * End-to-end wiring for runClient with every outbound integration stubbed:
 * Drive -> Cloudinary -> OpenAI -> GoHighLevel.
 */

const listImagesInFolders = vi.fn();
const downloadFile = vi.fn();
const exportDocAsText = vi.fn();
const uploadImage = vi.fn();
const complete = vi.fn();
const createSocialPost = vi.fn();
const listSocialAccounts = vi.fn();
const getLocationV1 = vi.fn();

vi.mock('../src/integrations/drive.js', () => ({
  listImagesInFolders: (...a: unknown[]) => listImagesInFolders(...a),
  downloadFile: (...a: unknown[]) => downloadFile(...a),
  exportDocAsText: (...a: unknown[]) => exportDocAsText(...a),
}));

vi.mock('../src/integrations/cloudinary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/integrations/cloudinary.js')>();
  return { ...actual, uploadImage: (...a: unknown[]) => uploadImage(...a) };
});

vi.mock('../src/integrations/openai.js', () => ({
  complete: (...a: unknown[]) => complete(...a),
}));

vi.mock('../src/integrations/ghl.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/integrations/ghl.js')>();
  return {
    ...actual,
    createSocialPost: (...a: unknown[]) => createSocialPost(...a),
    listSocialAccounts: (...a: unknown[]) => listSocialAccounts(...a),
    getLocationV1: (...a: unknown[]) => getLocationV1(...a),
  };
});

const { runClient } = await import('../src/social-posting/engine.js');
const { clientSchema, resetClientCacheForTesting } = await import('../src/social-posting/clients.js');

const client = clientSchema.parse({
  slug: 'test-brand',
  brandName: 'Test Brand',
  locationId: 'loc-1',
  imageFolderIds: ['folder-a'],
  brandBriefDocId: 'brief-doc',
  accountIds: ['acct-1', 'acct-2'],
  userId: 'user-1',
  promotePrivateEventProbability: 0,
  schedules: [{ name: 'daily', cron: '0 10 * * *', imageCount: 2, minImages: 2 }],
});

const images = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `img-${i}`,
    name: `photo-${i}.png`,
    mimeType: 'image/png',
    url: `https://drive.google.com/uc?id=img-${i}`,
  }));

const captionJson = JSON.stringify({
  caption: 'A tidy base caption',
  platform_variations: {
    instagram: 'IG caption #avo',
    facebook: 'FB caption',
    google_my_business: 'GMB caption',
    tiktok: '',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetClientCacheForTesting();
  useTestEnv();

  listImagesInFolders.mockResolvedValue(images(10));
  downloadFile.mockResolvedValue(Buffer.from('fake-bytes'));
  exportDocAsText.mockResolvedValue('BRAND BRIEF BODY');
  uploadImage.mockImplementation(async (_b: Buffer, name: string) => ({
    secureUrl: `https://res.cloudinary.com/c/image/upload/v1/${name}`,
    publicId: name,
  }));
  complete.mockResolvedValue(captionJson);
  createSocialPost.mockResolvedValue({ id: 'post-xyz' });
  getLocationV1.mockResolvedValue({ id: 'loc-1' });
  listSocialAccounts.mockResolvedValue([]);
});

describe('runClient', () => {
  const now = new Date('2026-07-15T03:00:00.000Z');

  it('runs the full pipeline and posts one scheduled post per image', async () => {
    const result = await runClient(client, { now, random: () => 0.5 });

    expect(result).toMatchObject({
      slug: 'test-brand',
      schedule: 'daily',
      dryRun: false,
      imagesAvailable: 10,
      imagesSelected: 2,
      postsAttempted: 2,
      postsCreated: 2,
      postsFailed: 0,
      warnings: [],
    });

    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(createSocialPost).toHaveBeenCalledTimes(2);
    expect(result.outcomes.every((o) => o.posted && o.postId === 'post-xyz')).toBe(true);
  });

  it('sends GoHighLevel the enhanced Cloudinary URL, not the Drive link', async () => {
    await runClient(client, { now, random: () => 0.5 });

    const [, , payload] = createSocialPost.mock.calls[0] as [string, string, { media: Array<{ url: string }> }];
    expect(payload.media[0]?.url).toContain('/upload/e_auto_color,e_auto_contrast,e_sharpen:50,e_improve/');
    expect(payload.media[0]?.url).not.toContain('drive.google.com');
  });

  it('feeds the brand brief text into the caption prompt', async () => {
    await runClient(client, { now, random: () => 0.5 });
    const [{ user }] = complete.mock.calls[0] as [{ user: string }];
    expect(user).toContain('BRAND BRIEF BODY');
    expect(user).toContain('Test Brand');
  });

  it('refuses to post when the folders hold fewer images than required', async () => {
    listImagesInFolders.mockResolvedValue(images(1));
    await expect(runClient(client, { now })).rejects.toThrow(/needs at least 2 images.*found 1/);
    expect(createSocialPost).not.toHaveBeenCalled();
  });

  it('builds payloads but calls nothing on GoHighLevel in dry-run mode', async () => {
    const result = await runClient(client, { now, dryRun: true, random: () => 0.5 });

    expect(createSocialPost).not.toHaveBeenCalled();
    expect(result.postsAttempted).toBe(2);
    expect(result.postsCreated).toBe(0);
    expect(result.outcomes[0]?.summary).toBe('A tidy base caption');
  });

  it('skips an image that fails to upload and still posts the rest', async () => {
    uploadImage
      .mockRejectedValueOnce(new Error('cloudinary 500'))
      .mockImplementation(async (_b: Buffer, name: string) => ({
        secureUrl: `https://res.cloudinary.com/c/image/upload/v1/${name}`,
        publicId: name,
      }));

    const result = await runClient(client, { now, random: () => 0.5 });

    expect(result.postsAttempted).toBe(1);
    expect(result.postsCreated).toBe(1);
    expect(result.warnings.join(' ')).toContain('cloudinary 500');
  });

  it('throws when every image fails, rather than reporting a clean run', async () => {
    uploadImage.mockRejectedValue(new Error('cloudinary down'));
    await expect(runClient(client, { now })).rejects.toThrow(/every image failed to prepare/);
    expect(createSocialPost).not.toHaveBeenCalled();
  });

  it('records a per-post failure without failing the whole batch', async () => {
    createSocialPost.mockRejectedValueOnce(new Error('GHL 422 invalid account')).mockResolvedValue({ id: 'ok' });

    const result = await runClient(client, { now, random: () => 0.5 });

    expect(result.postsCreated).toBe(1);
    expect(result.postsFailed).toBe(1);
    expect(result.outcomes.find((o) => o.error)?.error).toContain('GHL 422');
  });

  it('falls back to the default caption when the model returns unusable text', async () => {
    complete.mockResolvedValue('I am unable to help with that.');
    const result = await runClient(client, { now, dryRun: true, random: () => 0.5 });
    expect(result.outcomes[0]?.summary).toBe('Default caption');
  });

  it('carries on when the brand brief cannot be read, recording a warning', async () => {
    exportDocAsText.mockRejectedValue(new Error('404 file not found'));
    const result = await runClient(client, { now, random: () => 0.5 });

    expect(result.postsCreated).toBe(2);
    expect(result.warnings.join(' ')).toContain('brand brief could not be read');
  });

  it('treats a failed v1 pre-flight as advisory, not fatal', async () => {
    getLocationV1.mockRejectedValue(new Error('401 unauthorized'));
    const result = await runClient(client, { now, random: () => 0.5 });

    expect(result.postsCreated).toBe(2);
    expect(result.warnings.join(' ')).toContain('v1 location pre-flight failed');
  });

  it('resolves accounts from GoHighLevel when configured as auto', async () => {
    listSocialAccounts.mockResolvedValue([
      { id: 'live-fb', name: 'FB Page', platform: 'facebook', isExpired: false },
      { id: 'live-ig', name: 'IG', platform: 'instagram', isExpired: false },
      { id: 'live-dead', name: 'Old', platform: 'facebook', isExpired: true },
    ]);

    const result = await runClient({ ...client, accountIds: 'auto' }, { now, random: () => 0.5 });

    expect(listSocialAccounts).toHaveBeenCalledWith('loc-1', 'test-token');
    const [, , payload] = createSocialPost.mock.calls[0] as [string, string, { accountIds: string[] }];
    expect(payload.accountIds).toEqual(['live-fb', 'live-ig']);
    expect(result.warnings.join(' ')).toContain('live-dead');
  });

  it('fails clearly when auto resolution finds no usable accounts', async () => {
    listSocialAccounts.mockResolvedValue([]);
    await expect(runClient({ ...client, accountIds: 'auto' }, { now })).rejects.toThrow(
      /No usable social accounts/,
    );
  });

  it('splits per platform when asked, using each platform caption', async () => {
    listSocialAccounts.mockResolvedValue([
      { id: 'acct-1', name: 'FB', platform: 'facebook', isExpired: false },
      { id: 'acct-2', name: 'IG', platform: 'instagram', isExpired: false },
    ]);

    const result = await runClient({ ...client, perPlatformCaptions: true }, { now, dryRun: true, random: () => 0.5 });

    expect(result.postsAttempted).toBe(4);
    const summaries = result.outcomes.map((o) => `${o.platform}:${o.summary}`);
    expect(summaries).toContain('facebook:FB caption');
    expect(summaries).toContain('instagram:IG caption #avo');
  });

  it('rejects a schedule name that does not exist', async () => {
    await expect(runClient(client, { now, scheduleName: 'weekly' })).rejects.toThrow(
      /no schedule named "weekly".*Available: daily/s,
    );
  });

  it('honours an image-count override', async () => {
    const result = await runClient(client, { now, imageCount: 1, dryRun: true, random: () => 0.5 });
    expect(result.imagesSelected).toBe(1);
    expect(result.postsAttempted).toBe(1);
  });
});
