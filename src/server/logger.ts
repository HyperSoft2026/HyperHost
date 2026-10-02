import { config } from './config';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const REDACTED_SUBSTRINGS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'encryptedvalue',
  'database_url',
  'databaseurl',
  'client_secret',
  'access_token',
  'refresh_token',
  'session_secret',
  'encryption_key',
];

function scrubConnectionStrings(input: string): string {
  return input.replace(
    /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi,
    '$1://[REDACTED]'
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubConnectionStrings(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (REDACTED_SUBSTRINGS.some((sub) => lower.includes(sub))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeValue(v);
      }
    }
    return out;
  }
  return value;
}

function writeLog(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): void {
  const safeMessage = scrubConnectionStrings(message);
  const safeContext = meta
    ? (sanitizeValue(meta) as Record<string, unknown>)
    : undefined;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'hyperhost-control-plane',
    message: safeMessage,
    ...(safeContext ? { context: safeContext } : {}),
  };

  const line =
    config.nodeEnv === 'production'
      ? JSON.stringify(entry)
      : `[${entry.timestamp}] [${level}] ${safeMessage}${
          safeContext ? ` ${JSON.stringify(safeContext)}` : ''
        }`;

  if (level === 'ERROR') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) =>
    writeLog('INFO', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    writeLog('WARN', message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    writeLog('ERROR', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (config.nodeEnv !== 'production') {
      writeLog('DEBUG', message, meta);
    }
  },
};
