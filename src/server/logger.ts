const isProduction =
  process.env.NODE_ENV === 'production' || process.argv.includes('--production');

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const REDACTED_SUBSTRINGS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'encryptedvalue',
  'database_url',
  'databaseurl',
  'client_secret',
  'clientsecret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'session_secret',
  'sessionsecret',
  'encryption_key',
  'encryptionkey',
  'webhook',
  'discord_bot_token',
  'bottoken',
  'private_key',
  'privatekey',
  'ssh_key',
  'sshkey',
  'ssh_private_key',
  'sshprivatekey',
  'clever_cloud_ssh_private_key',
  'bootstraptoken',
  'bootstrap_token',
  'bootstrapscript',
  'bootstrap_script',
];

function scrubSensitiveStrings(input: string): string {
  return input
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[REDACTED_SSH_PRIVATE_KEY]'
    )
    .replace(
      /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi,
      '$1://[REDACTED]'
    )
    .replace(
      /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi,
      'https://discord.com/api/webhooks/[REDACTED]'
    )
    .replace(/\b(Bot|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:token|node_token|secret)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(
      /\b(NODE_TOKEN|RUNTIME_NODE_SECRET|NODE_ENROLLMENT_SECRET|CLEVER_CLOUD_API_TOKEN|CLEVER_CLOUD_API_SECRET|CLEVER_CLOUD_SSH_PRIVATE_KEY)=[^\s"']+/gi,
      '$1=[REDACTED]'
    )
    .replace(/\bhhnode_[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]');
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubSensitiveStrings(value);
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
  const safeMessage = scrubSensitiveStrings(message);
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
    isProduction
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
    if (!isProduction) {
      writeLog('DEBUG', message, meta);
    }
  },
};
