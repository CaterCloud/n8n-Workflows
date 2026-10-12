import { env } from './env.js';

type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<string, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

function enabled(level: Level): boolean {
  return ORDER[level]! <= ORDER[env().LOG_LEVEL]!;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export interface Logger {
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  return {
    error: (msg, fields) => emit('error', msg, { ...bindings, ...fields }),
    warn: (msg, fields) => emit('warn', msg, { ...bindings, ...fields }),
    info: (msg, fields) => emit('info', msg, { ...bindings, ...fields }),
    debug: (msg, fields) => emit('debug', msg, { ...bindings, ...fields }),
    child: (extra) => make({ ...bindings, ...extra }),
  };
}

export const logger: Logger = make({});
