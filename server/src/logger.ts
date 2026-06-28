type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let configuredLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  configuredLevel = level;
}

function ts(): string {
  // Use a fixed-format timestamp without relying on locale-specific parts.
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_VALUE[level] >= LEVEL_VALUE[configuredLevel];
}

function emit(level: LogLevel, msg: string, meta?: unknown): void {
  if (!shouldLog(level)) return;
  const line = `[${ts()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (meta !== undefined) {
     
    console.log(line, meta);
  } else {
     
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
