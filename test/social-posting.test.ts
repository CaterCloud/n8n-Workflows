import { beforeEach, describe, expect, it } from 'vitest';
import { useTestEnv } from './helpers.js';
import {
  allClients,
  clientBySlug,
  clientSchema,
  enabledClients,
  resetClientCacheForTesting,
  type SocialClient,
} from '../src/social-posting/clients.js';
import {
  captionForPlatform,
  finaliseSummary,
  planPostsForTesting,
} from '../src/social-posting/engine.js';
import { buildCaptionPrompt, FALLBACK_CAPTION, type CaptionResult } from '../src/social-posting/prompt.js';
import { enhanceUrl, ENHANCEMENT_TRANSFORMS } from '../src/integrations/cloudinary.js';
import { partsInZone } from '../src/lib/dates.js';
import type { DriveImage } from '../src/integrations/drive.js';

const SYD = 'Australia/Sydney';

beforeEach(() => {
  resetClientCacheForTesting();
  delete process.env['SOCIAL_CLIENT_OVERRIDES'];
  useTestEnv();
});

describe('client configuration', () => {
  it('covers the five real GoHighLevel locations from the n8n files', () => {
    expect(allClients().map((c) => c.slug)).toEqual([
      'junction-cafe',
      'spanish-paella',
      'avo-shack',
      'madame-cue',
      'madison-ave',
    ]);
  });

  it('gives every client a distinct slug and location', () => {
    const clients = allClients();
    expect(new Set(clients.map((c) => c.slug)).size).toBe(clients.length);
    expect(new Set(clients.map((c) => c.locationId)).size).toBe(clients.length);
  });

  it('validates against the schema, including the auto-accounts client', () => {
    for (const client of allClients()) {
      expect(() => clientSchema.parse(client)).not.toThrow();
    }
    expect(clientBySlug('madison-ave')?.accountIds).toBe('auto');
  });

  it('carries the exact account IDs from the source workflows', () => {
    expect(clientBySlug('madame-cue')?.accountIds).toEqual([
      '696f677c9d9a50e36c630ef5_mqdAQkVtmwpoXe1eJ828_958572700671827_page',
    ]);
    expect(clientBySlug('junction-cafe')?.accountIds).toHaveLength(5);
  });

  it('defaults to posting nothing so a fresh deploy cannot double-post with n8n', () => {
    expect(enabledClients()).toEqual([]);
  });

  it('enables named clients', () => {
    useTestEnv({ SOCIAL_ENABLED_CLIENTS: 'avo-shack, madame-cue' });
    expect(enabledClients().map((c) => c.slug)).toEqual(['avo-shack', 'madame-cue']);
  });

  it('enables everything with "all", minus the disabled list', () => {
    useTestEnv({ SOCIAL_ENABLED_CLIENTS: 'all', SOCIAL_DISABLED_CLIENTS: 'madame-cue,madison-ave' });
    expect(enabledClients().map((c) => c.slug)).toEqual(['junction-cafe', 'spanish-paella', 'avo-shack']);
  });

  it('ignores unknown slugs rather than failing the boot', () => {
    useTestEnv({ SOCIAL_ENABLED_CLIENTS: 'avo-shack,not-a-client' });
    expect(enabledClients().map((c) => c.slug)).toEqual(['avo-shack']);
  });

  it('applies a SOCIAL_CLIENT_OVERRIDES patch', () => {
    process.env['SOCIAL_CLIENT_OVERRIDES'] = JSON.stringify({
      'madame-cue': { schedules: [{ name: 'monthly', cron: '0 10 4 * *', imageCount: 30, minImages: 30 }] },
    });
    resetClientCacheForTesting();
    expect(clientBySlug('madame-cue')?.schedules[0]?.cron).toBe('0 10 4 * *');
  });

  it('keeps the default when an override is malformed', () => {
    process.env['SOCIAL_CLIENT_OVERRIDES'] = '{ not json';
    resetClientCacheForTesting();
    expect(clientBySlug('avo-shack')?.schedules[0]?.cron).toBe('0 10 * * *');
  });
});

describe('enhanceUrl', () => {
  it('injects the Cloudinary enhancement chain after /upload/', () => {
    expect(enhanceUrl('https://res.cloudinary.com/c/image/upload/v1/a.jpg')).toBe(
      `https://res.cloudinary.com/c/image/upload/${ENHANCEMENT_TRANSFORMS}/v1/a.jpg`,
    );
  });

  it('is idempotent', () => {
    const once = enhanceUrl('https://res.cloudinary.com/c/image/upload/v1/a.jpg');
    expect(enhanceUrl(once)).toBe(once);
  });

  it('leaves a non-Cloudinary URL alone', () => {
    expect(enhanceUrl('https://drive.google.com/uc?id=abc')).toBe('https://drive.google.com/uc?id=abc');
  });
});

describe('captionForPlatform', () => {
  const caption: CaptionResult = {
    caption: 'base',
    instagram: 'ig',
    facebook: 'fb',
    googleMyBusiness: 'gmb',
    tiktok: 'tt',
  };

  it('selects the variant matching each GHL platform name', () => {
    expect(captionForPlatform(caption, 'instagram')).toBe('ig');
    expect(captionForPlatform(caption, 'facebook')).toBe('fb');
    expect(captionForPlatform(caption, 'google')).toBe('gmb');
    expect(captionForPlatform(caption, 'tiktok')).toBe('tt');
  });

  it('falls back to the base caption for unknown or absent platforms', () => {
    expect(captionForPlatform(caption, 'pinterest')).toBe('base');
    expect(captionForPlatform(caption, undefined)).toBe('base');
  });

  it('falls back to the base caption when TikTok came back empty', () => {
    expect(captionForPlatform({ ...caption, tiktok: '' }, 'tiktok')).toBe('base');
  });
});

describe('finaliseSummary', () => {
  const image: DriveImage = { id: 'i1', name: 'avo-toast.jpg', mimeType: 'image/jpeg', url: 'u' };
  const client = clientSchema.parse({
    slug: 'test-brand',
    brandName: 'Test Brand',
    locationId: 'loc',
    imageFolderIds: ['f1'],
    accountIds: ['a1'],
    schedules: [{ name: 's', cron: '0 10 * * *', imageCount: 1 }],
  });

  it('strips emoji when configured', () => {
    expect(finaliseSummary(client, 'Fresh avo 🥑 today', image)).toBe('Fresh avo  today');
  });

  it('keeps emoji when stripping is off', () => {
    expect(finaliseSummary({ ...client, stripEmojis: false }, 'Fresh 🥑', image)).toBe('Fresh 🥑');
  });

  it('falls back to the brand name, not a hardcoded one, when the caption is blank', () => {
    // Every n8n copy of this fallback said "Fresh from The Avo Shack" even on
    // other clients' workflows.
    expect(finaliseSummary(client, '   ', image)).toBe('Fresh from Test Brand: avo-toast');
  });
});

describe('planPosts', () => {
  const base: SocialClient = clientSchema.parse({
    slug: 'test-brand',
    brandName: 'Test Brand',
    locationId: 'loc-1',
    imageFolderIds: ['f1'],
    accountIds: ['acct-fb', 'acct-ig'],
    userId: 'user-1',
    schedules: [{ name: 'monthly', cron: '0 10 25 * *', imageCount: 2 }],
  });

  const prepared = [
    {
      image: { id: 'i1', name: 'one.png', mimeType: 'image/png', url: 'u1' } as DriveImage,
      usedUrl: 'https://res.cloudinary.com/c/image/upload/e_auto_color/v1/one.png',
      caption: { caption: 'cap one', instagram: 'ig one', facebook: 'fb one', googleMyBusiness: 'gmb one', tiktok: '' },
    },
    {
      image: { id: 'i2', name: 'two.jpg', mimeType: 'image/jpeg', url: 'u2' } as DriveImage,
      usedUrl: 'https://res.cloudinary.com/c/image/upload/e_auto_color/v1/two.jpg',
      caption: { caption: 'cap two', instagram: 'ig two', facebook: 'fb two', googleMyBusiness: 'gmb two', tiktok: '' },
    },
  ];

  const schedule = base.schedules[0]!;
  const now = new Date('2026-07-15T03:00:00.000Z'); // 13:00 Sydney

  it('builds one post per image against every account by default', () => {
    const plans = planPostsForTesting(base, schedule, prepared, [{ id: 'acct-fb' }, { id: 'acct-ig' }], now);

    expect(plans).toHaveLength(2);
    expect(plans[0]?.payload).toEqual({
      accountIds: ['acct-fb', 'acct-ig'],
      summary: 'cap one',
      media: [{ url: prepared[0]!.usedUrl, type: 'image/png' }],
      type: 'post',
      status: 'scheduled',
      scheduleDate: '2026-07-16T00:00:00.000Z',
      userId: 'user-1',
      mediaOptimization: true,
    });
  });

  it('schedules consecutive days at 10:00 local time', () => {
    const plans = planPostsForTesting(base, schedule, prepared, [{ id: 'acct-fb' }], now);
    const dates = plans.map((p) => p.payload.scheduleDate);
    expect(dates).toEqual(['2026-07-16T00:00:00.000Z', '2026-07-17T00:00:00.000Z']);
    for (const date of dates) {
      expect(partsInZone(new Date(date), SYD).hour).toBe(10);
    }
  });

  it('derives the media type from the file name, defaulting to jpeg', () => {
    const plans = planPostsForTesting(base, schedule, prepared, [{ id: 'acct-fb' }], now);
    expect(plans.map((p) => p.payload.media[0]?.type)).toEqual(['image/png', 'image/jpeg']);
  });

  it('honours a draft post status', () => {
    const plans = planPostsForTesting({ ...base, postStatus: 'draft' }, schedule, prepared, [{ id: 'a' }], now);
    expect(plans.every((p) => p.payload.status === 'draft')).toBe(true);
  });

  it('omits userId entirely when none is configured', () => {
    const plans = planPostsForTesting({ ...base, userId: undefined }, schedule, prepared, [{ id: 'a' }], now);
    expect(plans[0]?.payload).not.toHaveProperty('userId');
  });

  it('splits into one post per platform, each with its own caption, when enabled', () => {
    const plans = planPostsForTesting(
      { ...base, perPlatformCaptions: true },
      schedule,
      prepared,
      [
        { id: 'acct-fb', platform: 'facebook' },
        { id: 'acct-fb2', platform: 'facebook' },
        { id: 'acct-ig', platform: 'instagram' },
      ],
      now,
    );

    expect(plans).toHaveLength(4); // 2 images x 2 platforms
    const first = plans.filter((p) => p.image.id === 'i1');
    expect(first.map((p) => [p.platform, p.payload.summary, p.payload.accountIds])).toEqual([
      ['facebook', 'fb one', ['acct-fb', 'acct-fb2']],
      ['instagram', 'ig one', ['acct-ig']],
    ]);
    // Both platform posts for one image share that image's schedule slot.
    expect(new Set(first.map((p) => p.payload.scheduleDate)).size).toBe(1);
  });
});

describe('buildCaptionPrompt', () => {
  it('embeds the brand context, media URL and private-event flag', () => {
    const prompt = buildCaptionPrompt({
      brandName: 'Test Brand',
      brandContext: 'BRAND-BRIEF-TEXT',
      mediaUrl: 'https://img/one.png',
      promotePrivateEvent: true,
      city: 'Melbourne',
    });

    expect(prompt).toContain('You are the social copywriter for Test Brand.');
    expect(prompt).toContain('BRAND-BRIEF-TEXT');
    expect(prompt).toContain('https://img/one.png');
    expect(prompt).toContain('Promote Private Events (bool ~50% of posts): true');
    expect(prompt).toContain('Melbourne');
  });

  it('defaults the optional fields rather than printing "undefined"', () => {
    const prompt = buildCaptionPrompt({ brandContext: '', mediaUrl: 'u' });
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('instagram,facebook,google_my_business');
    expect(prompt).toContain('Locale: en-AU');
    expect(prompt).toContain('Promote Private Events (bool ~50% of posts): false');
  });

  it('still asks for JSON only', () => {
    expect(buildCaptionPrompt({ brandContext: '', mediaUrl: 'u' })).toContain('OUTPUT (return JSON only)');
  });
});

describe('FALLBACK_CAPTION', () => {
  it('matches what the n8n Code2 node produced on a parse failure', () => {
    expect(FALLBACK_CAPTION).toEqual({
      caption: 'Default caption',
      instagram: 'Default Instagram post',
      facebook: 'Default Facebook post',
      googleMyBusiness: 'Default GMB post',
      tiktok: '',
    });
  });
});
