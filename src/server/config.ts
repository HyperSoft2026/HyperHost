import crypto from 'node:crypto';

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
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
  };
  appUrl: string | undefined;
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

export const config: ServerConfig = {
  nodeEnv,
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
  },
  appUrl: process.env.APP_URL?.trim() || undefined,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',
};

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(
    config.discord.clientId &&
      config.discord.clientSecret &&
      config.discord.redirectUri
  );
}

export function getDiscordRedirectUriOrNull(): string | null {
  return config.discord.redirectUri || null;
}
