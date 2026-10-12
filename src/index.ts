import { env } from './env.js';
import { logger } from './logger.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const config = env();

  logger.info('starting catercloud-lead-tracker', {
    nodeEnv: config.NODE_ENV,
    timezone: config.TIMEZONE,
    dryRun: config.DRY_RUN,
    sheetConfigured: Boolean(config.LEAD_SHEET_ID),
  });

  const app = buildServer();
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info('listening', { port: config.PORT, host: config.HOST });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    void app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error('shutdown error', { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      },
    );
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: reason instanceof Error ? reason.message : String(reason) });
  });
}

main().catch((err: unknown) => {
  logger.error('failed to start', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
