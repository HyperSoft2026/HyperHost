import crypto from 'node:crypto';

const DEFAULT_PUBLIC_APP_URL =
  'https://app-1cc68a22-3748-4fa2-95be-e02404cad0a6.cleverapps.io/';
const DEFAULT_HYPERSOFT_DISCORD_URL = 'https://discord.gg/b3VwbVhwvU';

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  version: string;
  port: number;
  host: string;
  databaseUrl: string | undefined;
  sessionSecret: string;
  sessionSecretConfigured: boolean;
  encryptionKey: string;
  encryptionKeyConfigured: boolean;
  discord: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string | undefined;
    botToken: string | undefined;
    loginWebhookUrl: string | undefined;
    notificationChannelId: string | undefined;
    adminDiscordIds: string[];
    supportServerUrl: string;
  };
  appUrl: string | undefined;
  publicUrl: string;
  corsOrigin: string;
}

const isProdFlag = process.argv.includes('--production');
const rawEnv = isProdFlag ? 'production' : process.env.NODE_ENV;
const nodeEnv: ServerConfig['nodeEnv'] =
  rawEnv === 'production' || rawEnv === 'test' ? rawEnv : 'development';

const parsedPort = Number.parseInt(process.env.PORT || '', 10);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;

const envSessionSecret = process.env.SESSION_SECRET?.trim();
const envEncryptionKey = process.env.ENCRYPTION_KEY?.trim();

const rawAdminIds = (process.env.ADMIN_DISCORD_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function resolveCleanPublicUrl(): string {
  const candidates = [
    process.env.PUBLIC_URL?.trim(),
    process.env.APP_URL?.trim(),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      !candidate.includes('.run.app') &&
      !candidate.includes('localhost') &&
      !candidate.includes('127.0.0.1')
    ) {
      return candidate;
    }
  }
  return DEFAULT_PUBLIC_APP_URL;
}

const resolvedPublicUrl = resolveCleanPublicUrl();

export const config: ServerConfig = {
  nodeEnv,
  version: '1.0.0',
  port,
  host: process.env.HOST?.trim() || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  sessionSecret: envSessionSecret || crypto.randomBytes(64).toString('hex'),
  sessionSecretConfigured: Boolean(envSessionSecret),
  encryptionKey:
    envEncryptionKey || envSessionSecret || crypto.randomBytes(64).toString('hex'),
  encryptionKeyConfigured: Boolean(envEncryptionKey || envSessionSecret),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() || undefined,
    redirectUri: process.env.DISCORD_REDIRECT_URI?.trim() || undefined,
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || undefined,
    loginWebhookUrl:
      process.env.DISCORD_LOGIN_WEBHOOK_URL?.trim() ||
      process.env.DISCORD_WEBHOOK_URL?.trim() ||
      undefined,
    notificationChannelId:
      process.env.DISCORD_NOTIFICATION_CHANNEL_ID?.trim() ||
      process.env.DISCORD_LOG_CHANNEL_ID?.trim() ||
      undefined,
    adminDiscordIds: rawAdminIds,
    supportServerUrl: DEFAULT_HYPERSOFT_DISCORD_URL,
  },
  appUrl: resolvedPublicUrl,
  publicUrl: resolvedPublicUrl,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',
};

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(
    config.discord.clientId &&
      config.discord.clientSecret &&
      config.discord.redirectUri
  );
}

export function isDiscordLoginNotificationConfigured(): boolean {
  return Boolean(config.discord.botToken);
}

export function getDiscordRedirectUriOrNull(): string | null {
  return config.discord.redirectUri || null;
}
