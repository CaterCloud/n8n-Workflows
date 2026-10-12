import { loadEnv, setEnvForTesting, type Env } from '../src/env.js';

export function useTestEnv(overrides: Record<string, string> = {}): Env {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    SCHEDULE_TIMEZONE: 'Australia/Sydney',
    LEAD_SHEET_ID: 'sheet-123',
    LEAD_SHEET_NAME: 'PEE ',
    GHL_API_TOKEN: 'test-token',
    ...overrides,
  } as NodeJS.ProcessEnv);
  setEnvForTesting(env);
  return env;
}
