export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  databaseUrl: string | undefined;
  sessionSecret: string;
  encryptionKey: string;
  discord: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string | undefined;
  };
  appUrl: string | undefined;
  corsOrigin: string;
}

const rawEnv = process.env.NODE_ENV;
const nodeEnv: ServerConfig['nodeEnv'] =
  rawEnv === 'production' || rawEnv === 'test' ? rawEnv : 'development';

export const config: ServerConfig = {
  nodeEnv,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  sessionSecret:
    process.env.SESSION_SECRET?.trim() ||
    'hyperhost-ephemeral-session-secret-configure-in-production-env',
  encryptionKey:
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'hyperhost-ephemeral-aes-key-configure-in-production-env',
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() || undefined,
    redirectUri: process.env.DISCORD_REDIRECT_URI?.trim() || undefined,
  },
  appUrl: process.env.APP_URL?.trim() || undefined,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',
};

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(config.discord.clientId && config.discord.clientSecret);
}

export function resolveDiscordRedirectUri(requestOrigin?: string): string {
  if (config.discord.redirectUri) {
    return config.discord.redirectUri;
  }
  const base = (config.appUrl || requestOrigin || `http://localhost:${config.port}`).replace(
    /\/+$/,
    ''
  );
  return `${base}/api/auth/discord/callback`;
}
