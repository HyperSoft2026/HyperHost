import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { AppError } from './errors';
import { logger } from './logger';

let prismaInstance: PrismaClient | null = null;

if (config.databaseUrl) {
  try {
    prismaInstance = new PrismaClient({
      log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
    });
  } catch (err) {
    logger.error('Failed to initialize PrismaClient', {
      reason: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

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

export async function checkDatabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  error?: string;
}> {
  if (!config.databaseUrl || !prismaInstance) {
    return {
      configured: false,
      connected: false,
      latencyMs: null,
      error: 'DATABASE_URL environment variable is not set',
    };
  }

  const start = performance.now();
  try {
    await prismaInstance.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(performance.now() - start);
    return {
      configured: true,
      connected: true,
      latencyMs,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      latencyMs: null,
      error: 'Unable to reach PostgreSQL instance',
    };
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
  }
}
