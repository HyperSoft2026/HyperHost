import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth, getPrismaOrThrow } from '../database';
import {
  config,
  getEnvironmentDiagnosticsSummary,
  isDiscordLoginNotificationConfigured,
  isDiscordOAuthConfigured,
} from '../config';
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
    const envDiagnostics = getEnvironmentDiagnosticsSummary();

    const payload: HealthReportDTO = {
      status: dbHealth.connected ? 'healthy' : 'degraded',
      environment: config.nodeEnv,
      version: config.version,
      api: 'online',
      database: {
        configured: dbHealth.configured,
        connected: dbHealth.connected,
        ready: dbHealth.ready,
        latencyMs: dbHealth.latencyMs,
      },
      auth: {
        discordOAuthConfigured: isDiscordOAuthConfigured(),
        loginNotificationConfigured: isDiscordLoginNotificationConfigured(),
      },
      runtime: {
        connectedNodes,
        totalRegisteredNodes,
        status: connectedNodes > 0 ? 'available' : 'unavailable',
      },
      limits: {
        maxHostsPerUser: MAX_HOSTS_PER_USER,
      },
      diagnostics: {
        env: { ...envDiagnostics },
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
