import { config } from './config';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const REDACTED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'encryptedValue',
]);

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACTED_KEYS.has(k.toLowerCase()) || k.toLowerCase().includes('secret') || k.toLowerCase().includes('token')) {
      output[k] = '[REDACTED]';
    } else {
      output[k] = v;
    }
  }
  return output;
}

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'hyperhost-control-plane',
    message,
    ...(sanitizeMeta(meta) ? { context: sanitizeMeta(meta) } : {}),
  };

  const line =
    config.nodeEnv === 'production'
      ? JSON.stringify(entry)
      : `[${entry.timestamp}] [${level}] ${message}${
          entry.context ? ` ${JSON.stringify(entry.context)}` : ''
        }`;

  if (level === 'ERROR') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => writeLog('INFO', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => writeLog('WARN', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => writeLog('ERROR', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (config.nodeEnv !== 'production') {
      writeLog('DEBUG', message, meta);
    }
  },
};
