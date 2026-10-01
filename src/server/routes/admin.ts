import type { FastifyInstance } from 'fastify';
import { recordActivityLog, requireAdmin } from '../auth';
import { getPrismaOrThrow } from '../database';
import { generateSecureToken, hashToken } from '../crypto';
import { AppError } from '../errors';
import { runtimeRegistry } from '../../runtime/registry';
import {
  CreateNodeAllocationBatchSchema,
  CreateNodeSchema,
} from '../../shared/validation';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Control Plane Admin Overview
  app.get('/api/admin/overview', async (request) => {
    await requireAdmin(request);
    const prisma = getPrismaOrThrow();

    const [
      usersCount,
      hostsCount,
      nodes,
      allocationsCount,
      databasesCount,
      backupsCount,
      recentActivity,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.host.count(),
      prisma.node.findMany({
        include: {
          _count: {
            select: { hosts: true, allocations: true, databases: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.nodeAllocation.count(),
      prisma.database.count(),
      prisma.backup.count(),
      prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          user: { select: { username: true, displayName: true } },
          host: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        counts: {
          users: usersCount,
          hosts: hostsCount,
          nodes: nodes.length,
          connectedNodes: runtimeRegistry.getConnectedNodeCount(),
          allocations: allocationsCount,
          databases: databasesCount,
          backups: backupsCount,
        },
        nodes: nodes.map((n) => ({
          id: n.id,
          name: n.name,
          location: n.location,
          fqdn: n.fqdn,
          ipAddress: n.ipAddress,
          daemonPort: n.daemonPort,
          status: n.status,
          liveConnected: runtimeRegistry.isNodeConnected(n.id),
          maxMemoryMb: n.maxMemoryMb,
          maxDiskMb: n.maxDiskMb,
          maxCpuPercent: n.maxCpuPercent,
          lastHeartbeatAt: n.lastHeartbeatAt ? n.lastHeartbeatAt.toISOString() : null,
          counts: n._count,
          createdAt: n.createdAt.toISOString(),
        })),
        recentActivity: recentActivity.map((log) => ({
          id: log.id,
          action: log.action,
          actor: log.user?.displayName || log.user?.username || 'System',
          hostName: log.host?.name || null,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    };
  });

  // Register a new Runtime Node in Control Plane
  app.post('/api/admin/nodes', async (request, reply) => {
    const { user } = await requireAdmin(request);
    const body = CreateNodeSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    const existing = await prisma.node.findUnique({
      where: { name: body.name },
    });

    if (existing) {
      throw new AppError(
        'NODE_NAME_EXISTS',
        `A Runtime Node named "${body.name}" is already registered.`,
        409
      );
    }

    // Generate one-time Runtime Node daemon token; store only HMAC-SHA256 hash
    const rawAgentToken = `hhnode_${generateSecureToken(24)}`;
    const agentTokenHash = hashToken(rawAgentToken);

    const node = await prisma.node.create({
      data: {
        name: body.name,
        location: body.location,
        fqdn: body.fqdn,
        ipAddress: body.ipAddress,
        daemonPort: body.daemonPort,
        status: 'OFFLINE',
        isOnline: false,
        agentTokenHash,
        maxMemoryMb: body.maxMemoryMb,
        maxDiskMb: body.maxDiskMb,
        maxCpuPercent: body.maxCpuPercent,
      },
    });

    await recordActivityLog({
      userId: user.id,
      action: 'Registered Runtime Node',
      metadata: {
        nodeId: node.id,
        name: node.name,
        fqdn: node.fqdn,
        location: node.location,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        node,
        agentProvisioningToken: rawAgentToken,
      },
    };
  });

  // Batch-create IP/Port Allocations for a Runtime Node
  app.post('/api/admin/nodes/:nodeId/allocations', async (request, reply) => {
    const { user } = await requireAdmin(request);
    const { nodeId } = request.params as { nodeId: string };
    const body = CreateNodeAllocationBatchSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    if (body.endPort < body.startPort) {
      throw new AppError(
        'INVALID_PORT_RANGE',
        'endPort must be greater than or equal to startPort.',
        400
      );
    }

    if (body.endPort - body.startPort > 100) {
      throw new AppError(
        'PORT_BATCH_TOO_LARGE',
        'Cannot allocate more than 100 ports in a single batch.',
        400
      );
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      throw new AppError('NODE_NOT_FOUND', 'Runtime Node not found.', 404);
    }

    const entries = [];
    for (let port = body.startPort; port <= body.endPort; port++) {
      entries.push({
        nodeId: node.id,
        ipAddress: body.ipAddress,
        port,
        protocol: body.protocol,
        status: 'AVAILABLE' as const,
      });
    }

    const result = await prisma.nodeAllocation.createMany({
      data: entries,
      skipDuplicates: true,
    });

    await recordActivityLog({
      userId: user.id,
      action: 'Created Node Allocations',
      metadata: {
        nodeId: node.id,
        ipAddress: body.ipAddress,
        startPort: body.startPort,
        endPort: body.endPort,
        createdCount: result.count,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        createdCount: result.count,
      },
    };
  });
}
