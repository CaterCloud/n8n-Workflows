import { logger } from '../logger.js';
import { allClients, clientBySlug } from '../social-posting/clients.js';
import { runClient } from '../social-posting/engine.js';

/**
 * Manual runner, for verifying a client before letting cron near it:
 *
 *   npm run run:social -- avo-shack --dry-run --images=2
 */

function usage(): never {
  const slugs = allClients()
    .map((c) => c.slug)
    .join(', ');
  process.stderr.write(
    `Usage: npm run run:social -- <slug> [--schedule=<name>] [--dry-run] [--images=<n>]\n\nClients: ${slugs}\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) usage();

  const client = clientBySlug(slug);
  if (!client) {
    process.stderr.write(`Unknown client "${slug}"\n`);
    usage();
  }

  const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const imagesRaw = flag('images');
  const images = imagesRaw === undefined ? undefined : Number(imagesRaw);
  if (images !== undefined && (!Number.isInteger(images) || images < 1)) {
    process.stderr.write('--images must be a positive integer\n');
    process.exit(1);
  }

  const scheduleName = flag('schedule');

  const result = await runClient(client, {
    ...(scheduleName ? { scheduleName } : {}),
    ...(args.includes('--dry-run') ? { dryRun: true } : {}),
    ...(images === undefined ? {} : { imageCount: images }),
  });

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.postsFailed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  logger.error('run failed', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
