import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { AppError } from './errors';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __hyperhostPrisma: PrismaClient | undefined;
}

function buildSafeDatasourceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '4');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '20');
    }
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '10');
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

let prismaInstance: PrismaClient | null = globalThis.__hyperhostPrisma ?? null;

if (config.databaseUrl && !prismaInstance) {
  try {
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: buildSafeDatasourceUrl(config.databaseUrl),
        },
      },
      log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
    });
    if (config.nodeEnv !== 'production') {
      globalThis.__hyperhostPrisma = prismaInstance;
    }
  } catch (err) {
    logger.error('Failed to initialize PrismaClient', {
      reason: err instanceof Error ? err.name : 'InitializationError',
    });
  }
}

let cachedHealth: {
  timestamp: number;
  result: {
    configured: boolean;
    connected: boolean;
    ready: boolean;
    latencyMs: number | null;
  };
} | null = null;

const HEALTH_CACHE_TTL_MS = 3_000;

export function getPrismaOrThrow(): PrismaClient {
  if (!config.databaseUrl || !prismaInstance) {
    throw new AppError(
      'DATABASE_NOT_CONFIGURED',
      'PostgreSQL DATABASE_URL is not configured. Set DATABASE_URL in environment variables and run Prisma migrations.',
      503
    );
  }
  return prismaInstance;
}

export async function initializeDatabase(): Promise<void> {
  if (!config.databaseUrl || !prismaInstance) {
    logger.warn(
      'DATABASE_URL is not set; Control Plane started without active PostgreSQL connection.'
    );
    return;
  }

  try {
    await prismaInstance.$connect();
    const tableCheck = await prismaInstance.$queryRaw<
      Array<{ user_table: string | null; host_table: string | null }>
    >`SELECT to_regclass('public."User"')::text AS user_table, to_regclass('public."Host"')::text AS host_table`;

    const row = tableCheck[0];
    if (!row?.user_table || !row?.host_table) {
      logger.warn(
        'PostgreSQL is connected, but HyperHost tables are missing. Ensure "npm run db:deploy" (prisma migrate deploy) has been executed.'
      );
    } else {
      logger.info('PostgreSQL connection and Prisma schema verified successfully.');
    }
  } catch (err) {
    logger.error('Failed to verify PostgreSQL connection during startup', {
      reason: err instanceof Error ? err.name : 'DatabaseConnectionError',
    });
  }
}

export async function checkDatabaseHealth(forceFresh = false): Promise<{
  configured: boolean;
  connected: boolean;
  ready: boolean;
  latencyMs: number | null;
}> {
  if (!config.databaseUrl || !prismaInstance) {
    return {
      configured: false,
      connected: false,
      ready: false,
      latencyMs: null,
    };
  }

  const now = Date.now();
  if (!forceFresh && cachedHealth && now - cachedHealth.timestamp < HEALTH_CACHE_TTL_MS) {
    return cachedHealth.result;
  }

  const start = performance.now();
  try {
    await prismaInstance.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(performance.now() - start);
    const result = {
      configured: true,
      connected: true,
      ready: true,
      latencyMs,
    };
    cachedHealth = { timestamp: now, result };
    return result;
  } catch {
    const result = {
      configured: true,
      connected: false,
      ready: false,
      latencyMs: null,
    };
    cachedHealth = { timestamp: now, result };
    return result;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
  }
}
