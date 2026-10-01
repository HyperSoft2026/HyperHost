import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth, getPrismaOrThrow } from '../database';
import { isDiscordOAuthConfigured, resolveDiscordRedirectUri } from '../config';
import { runtimeRegistry } from '../../runtime/registry';
import { MAX_HOSTS_PER_USER, type HealthReportDTO } from '../../shared/types';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const handler = async () => {
    const dbHealth = await checkDatabaseHealth();
    let totalRegisteredNodes = 0;

    if (dbHealth.connected) {
      try {
        const prisma = getPrismaOrThrow();
        totalRegisteredNodes = await prisma.node.count();
      } catch {
        totalRegisteredNodes = 0;
      }
    }

    const connectedNodes = runtimeRegistry.getConnectedNodeCount();

    const payload: HealthReportDTO = {
      status: dbHealth.connected ? 'healthy' : 'degraded',
      api: 'online',
      database: dbHealth,
      auth: {
        discordOAuthConfigured: isDiscordOAuthConfigured(),
        callbackUrl: resolveDiscordRedirectUri(),
      },
      runtime: {
        connectedNodes,
        totalRegisteredNodes,
        status: connectedNodes > 0 ? 'available' : 'unavailable',
      },
      limits: {
        maxHostsPerUser: MAX_HOSTS_PER_USER,
      },
      timestamp: new Date().toISOString(),
    };

    return {
      success: true,
      data: payload,
    };
  };

  app.get('/health', handler);
  app.get('/api/health', handler);
}
