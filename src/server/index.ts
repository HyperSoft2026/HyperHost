import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  config,
  getEnvironmentDiagnosticsSummary,
  getCleverCloudConfigValidation,
} from './config';
import { globalErrorHandler } from './errors';
import { logger } from './logger';
import { disconnectDatabase, initializeDatabase } from './database';
import { controlPlaneScheduler } from './scheduler';
import { registerHealthRoutes } from './routes/health';
import { registerAuthRoutes } from './routes/auth';
import { registerUserRoutes } from './routes/users';
import { registerHostRoutes } from './routes/hosts';
import { registerAdminRoutes } from './routes/admin';
import { registerRuntimeNodeRoutes } from './routes/runtime-nodes';
import { runtimeProvisionerService } from '../runtime/provisioner';

async function bootstrapControlPlane() {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  app.setErrorHandler(globalErrorHandler);

  logger.info('HyperHost environment configuration audit', {
    ...getEnvironmentDiagnosticsSummary(),
  });

  const cleverCloudValidation = getCleverCloudConfigValidation();
  if (!cleverCloudValidation.configured) {
    logger.warn(
      `[CLEVER_CLOUD_CONFIG_WARNING] Clever Cloud Automatic Per-Host Runtime Provisioner is NOT configured. Missing required environment variables: ${cleverCloudValidation.missingVariables.join(
        ', '
      )}. Host creation will fail with PROVISIONING_FAILED until CLEVER_CLOUD_API_TOKEN and CLEVER_CLOUD_ORGANISATION_ID are set.`,
      {
        apiBaseUrl: cleverCloudValidation.apiBaseUrl,
        missing: cleverCloudValidation.missingVariables,
      }
    );
  } else {
    logger.info(
      'Clever Cloud Automatic Per-Host Runtime Provisioner is configured',
      {
        apiBaseUrl: cleverCloudValidation.apiBaseUrl,
        organisationId: cleverCloudValidation.organisationId,
        zone: config.cleverCloud.zone,
      }
    );

    void (async () => {
      try {
        const testRes = await runtimeProvisionerService
          .getProvisioner()
          .testConnection();
        if (testRes.ok) {
          logger.info(`[CLEVER_CLOUD_STARTUP_VERIFICATION] ${testRes.message}`);
        } else {
          logger.warn(`[CLEVER_CLOUD_STARTUP_VERIFICATION] ${testRes.message}`);
        }
      } catch (err) {
        logger.warn(
          `[CLEVER_CLOUD_STARTUP_VERIFICATION] Unexpected verification failure: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    })();
  }

  if (!config.sessionSecretConfigured) {
    logger.warn(
      'SESSION_SECRET is not set in environment; generated ephemeral cryptographic secret for this process.'
    );
  }

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  });

  // CORS configuration
  await app.register(fastifyCors, {
    origin:
      config.corsOrigin === '*'
        ? true
        : config.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Secure Cookies
  await app.register(fastifyCookie, {
    secret: config.sessionSecret,
  });

  // Rate Limiting on API endpoints
  await app.register(fastifyRateLimit, {
    max: 180,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api/'),
  });

  // WebSocket support for Console & Node Agents
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1024 * 64,
    },
  });

  // Serve Official Logo from assets/Logo.png without shadowing dist/assets/* bundles
  const officialLogoPath = path.resolve(process.cwd(), 'assets', 'Logo.png');
  app.get('/assets/Logo.png', (_request, reply) => {
    if (!fs.existsSync(officialLogoPath)) {
      reply.status(404).send({
        success: false,
        error: { code: 'LOGO_NOT_FOUND', message: 'Official Logo.png not found' },
      });
      return;
    }
    reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .send(fs.createReadStream(officialLogoPath));
  });

  // Register Control Plane API Routes
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerUserRoutes(app);
  await registerHostRoutes(app);
  await registerAdminRoutes(app);
  await registerRuntimeNodeRoutes(app);

  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndexPath = path.join(distDir, 'index.html');

  if (config.nodeEnv === 'production' && !fs.existsSync(distIndexPath)) {
    const { build: viteBuild } = await import('vite');
    await viteBuild();
  }

  const isProd =
    config.nodeEnv === 'production' && fs.existsSync(distIndexPath);

  if (isProd) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });

    const indexHtml = fs.readFileSync(distIndexPath, 'utf-8');

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'ENDPOINT_NOT_FOUND',
            message: `API endpoint ${request.method} ${request.url} does not exist.`,
          },
        });
        return;
      }
      reply.type('text/html').send(indexHtml);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'ENDPOINT_NOT_FOUND',
            message: `API endpoint ${request.method} ${request.url} does not exist.`,
          },
        });
        return;
      }
      reply.hijack();
      vite.middlewares(request.raw, reply.raw, () => {
        reply.raw.statusCode = 404;
        reply.raw.end('Not Found');
      });
    });
  }

  // Verify PostgreSQL connection & migration state
  await initializeDatabase();
  const { seedHostingPlansIfAvailable } = await import('./plans');
  await seedHostingPlansIfAvailable().catch(() => null);

  // Start Control Plane Scheduler
  controlPlaneScheduler.start(60_000);

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info(
      `Received ${signal}. Shutting down HyperHost Control Plane gracefully...`
    );
    controlPlaneScheduler.stop();
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({
    port: config.port,
    host: config.host,
  });

  logger.info('HyperHost Control Plane started', {
    host: config.host,
    port: config.port,
    environment: config.nodeEnv,
    servingBuiltFrontend: isProd,
  });
}

bootstrapControlPlane().catch((err) => {
  logger.error('Fatal error during Control Plane startup', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
