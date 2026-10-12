import { Cron } from 'croner';
import { env } from './env.js';
import { logger } from './logger.js';
import { enabledClients } from './social-posting/clients.js';
import { runClient } from './social-posting/engine.js';

/**
 * Cron registration. One job per client schedule, interpreted in
 * SCHEDULE_TIMEZONE — the n8n triggers were bare cron strings evaluated in the
 * n8n instance's own timezone.
 */

export interface JobHandle {
  id: string;
  slug: string;
  schedule: string;
  cron: string;
  timezone: string;
  nextRun: string | null;
  cancel(): void;
}

const jobs: JobHandle[] = [];

export function startScheduler(): JobHandle[] {
  if (!env().SCHEDULER_ENABLED) {
    logger.warn('scheduler disabled (SCHEDULER_ENABLED=false); nothing will run on a timer');
    return [];
  }

  const timezone = env().SCHEDULE_TIMEZONE;
  const clients = enabledClients();

  if (clients.length === 0) {
    logger.warn('no clients enabled (SOCIAL_ENABLED_CLIENTS); scheduler registered no jobs');
    return [];
  }

  for (const client of clients) {
    for (const schedule of client.schedules) {
      if (!schedule.enabled) continue;
      const id = `${client.slug}:${schedule.name}`;

      // `protect` makes a run that is still in flight skip its next tick
      // rather than stacking a second concurrent batch.
      const cron = new Cron(schedule.cron, { name: id, timezone, protect: true }, async () => {
        try {
          const result = await runClient(client, { scheduleName: schedule.name });
          logger.info('scheduled run complete', {
            job: id,
            created: result.postsCreated,
            failed: result.postsFailed,
            warnings: result.warnings.length,
          });
        } catch (err) {
          logger.error('scheduled run failed', {
            job: id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });

      const handle: JobHandle = {
        id,
        slug: client.slug,
        schedule: schedule.name,
        cron: schedule.cron,
        timezone,
        nextRun: cron.nextRun()?.toISOString() ?? null,
        cancel: () => cron.stop(),
      };
      jobs.push(handle);

      logger.info('job registered', {
        job: id,
        cron: schedule.cron,
        timezone,
        nextRun: handle.nextRun,
        imageCount: schedule.imageCount,
      });
    }
  }

  return jobs;
}

export function listJobs(): Omit<JobHandle, 'cancel'>[] {
  return jobs.map(({ cancel: _cancel, ...rest }) => rest);
}

export function stopScheduler(): void {
  for (const job of jobs) job.cancel();
  jobs.length = 0;
}
