import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnvFileIfPresent(): void {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined && val !== '') {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore .env read errors in restricted environments
  }
}

loadDotEnvFileIfPresent();

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
  runtimeNodeSecret: string | undefined;
  cleverCloud: {
    apiBaseUrl: string;
    apiToken: string | undefined;
    organisationId: string | undefined;
    apiSecret: string | undefined;
    zone: string;
  };
}

const isProdFlag = process.argv.includes('--production');
const rawEnv = isProdFlag ? 'production' : process.env.NODE_ENV;
const nodeEnv: ServerConfig['nodeEnv'] =
  rawEnv === 'production' || rawEnv === 'test' ? rawEnv : 'development';

const parsedPort = Number.parseInt(process.env.PORT || '', 10);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;

const envSessionSecret = process.env.SESSION_SECRET?.trim();
const envEncryptionKey = process.env.ENCRYPTION_KEY?.trim();
const envRuntimeNodeSecret =
  process.env.RUNTIME_NODE_SECRET?.trim() ||
  process.env.NODE_ENROLLMENT_SECRET?.trim() ||
  undefined;
const envCleverCloudApiToken =
  process.env.CLEVER_CLOUD_API_TOKEN?.trim() || undefined;
const envCleverCloudOrganisationId =
  process.env.CLEVER_CLOUD_ORGANISATION_ID?.trim() || undefined;
const envCleverCloudApiSecret =
  process.env.CLEVER_CLOUD_API_SECRET?.trim() || undefined;
const envCleverCloudZone =
  process.env.CLEVER_CLOUD_ZONE?.trim() || 'par';

const rawAdminIds = (process.env.ADMIN_DISCORD_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isValidProductionHttpUrl(candidate: string | undefined): boolean {
  if (!candidate) return false;
  if (
    candidate.includes('.run.app') ||
    candidate.includes('localhost') ||
    candidate.includes('127.0.0.1')
  ) {
    return false;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveCleanPublicUrl(): string {
  const candidates = [
    process.env.PUBLIC_URL?.trim(),
    process.env.APP_URL?.trim(),
    process.env.BASE_URL?.trim(),
  ];
  for (const candidate of candidates) {
    if (candidate && isValidProductionHttpUrl(candidate)) {
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
  runtimeNodeSecret: envRuntimeNodeSecret,
  cleverCloud: {
    apiBaseUrl: 'https://api.clever-cloud.com',
    apiToken: envCleverCloudApiToken,
    organisationId: envCleverCloudOrganisationId,
    apiSecret: envCleverCloudApiSecret,
    zone: envCleverCloudZone,
  },
};

export function isCleverCloudProvisioningConfigured(): boolean {
  return Boolean(
    config.cleverCloud.apiToken && config.cleverCloud.organisationId
  );
}

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

export type EnvDiagnosticState = 'configured' | 'missing' | 'valid' | 'invalid';

export interface EnvironmentDiagnosticsSummary {
  DATABASE_URL: EnvDiagnosticState;
  SESSION_SECRET: EnvDiagnosticState;
  ENCRYPTION_KEY: EnvDiagnosticState;
  DISCORD_CLIENT_ID: EnvDiagnosticState;
  DISCORD_CLIENT_SECRET: EnvDiagnosticState;
  DISCORD_REDIRECT_URI: EnvDiagnosticState;
  DISCORD_BOT_TOKEN: EnvDiagnosticState;
  CLEVER_CLOUD_API_TOKEN: EnvDiagnosticState;
  CLEVER_CLOUD_ORGANISATION_ID: EnvDiagnosticState;
  PUBLIC_URL: EnvDiagnosticState;
  NODE_ENV: EnvDiagnosticState;
  PORT: EnvDiagnosticState;
}

export function getEnvironmentDiagnosticsSummary(): EnvironmentDiagnosticsSummary {
  const explicitPublicUrl = process.env.PUBLIC_URL?.trim();
  const fallbackAppUrl = [
    process.env.APP_URL?.trim(),
    process.env.BASE_URL?.trim(),
  ].find((u) => u && isValidProductionHttpUrl(u));
  const rawPublicUrl = explicitPublicUrl || fallbackAppUrl;
  const rawRedirectUri = getDiscordRedirectUriOrNull();
  const rawPort = process.env.PORT?.trim();
  const rawNodeEnv = process.env.NODE_ENV?.trim();

  const isDbValid =
    config.databaseUrl &&
    (config.databaseUrl.startsWith('postgresql://') ||
      config.databaseUrl.startsWith('postgres://'));

  const isRedirectValid = (() => {
    if (!rawRedirectUri) return false;
    try {
      const u = new URL(rawRedirectUri);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  })();

  return {
    DATABASE_URL: !config.databaseUrl
      ? 'missing'
      : isDbValid
      ? 'configured'
      : 'invalid',
    SESSION_SECRET: !envSessionSecret
      ? 'missing'
      : envSessionSecret.length >= 16
      ? 'configured'
      : 'invalid',
    ENCRYPTION_KEY: !envEncryptionKey
      ? config.sessionSecretConfigured
        ? 'configured'
        : 'missing'
      : envEncryptionKey.length >= 16
      ? 'configured'
      : 'invalid',
    DISCORD_CLIENT_ID: !config.discord.clientId
      ? 'missing'
      : /^\d{15,22}$/.test(config.discord.clientId)
      ? 'configured'
      : 'invalid',
    DISCORD_CLIENT_SECRET: config.discord.clientSecret ? 'configured' : 'missing',
    DISCORD_REDIRECT_URI: !rawRedirectUri
      ? 'missing'
      : isRedirectValid
      ? 'configured'
      : 'invalid',
    DISCORD_BOT_TOKEN: config.discord.botToken ? 'configured' : 'missing',
    CLEVER_CLOUD_API_TOKEN: config.cleverCloud.apiToken
      ? 'configured'
      : 'missing',
    CLEVER_CLOUD_ORGANISATION_ID: config.cleverCloud.organisationId
      ? 'configured'
      : 'missing',
    PUBLIC_URL: !rawPublicUrl
      ? 'missing'
      : isValidProductionHttpUrl(rawPublicUrl)
      ? 'configured'
      : 'invalid',
    NODE_ENV: !rawNodeEnv
      ? 'missing'
      : ['development', 'production', 'test'].includes(rawNodeEnv)
      ? 'configured'
      : 'invalid',
    PORT: !rawPort
      ? 'missing'
      : Number.isFinite(Number(rawPort)) && Number(rawPort) > 0
      ? 'configured'
      : 'invalid',
  };
}


export function getDiscordRedirectUriOrNull(): string | null {
  return config.discord.redirectUri || null;
}
