import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordActivityLog, requireAdmin } from '../auth';
import { config, getEnvironmentDiagnosticsSummary } from '../config';
import { checkDatabaseHealth, getPrismaOrThrow } from '../database';
import { probeDiscordBotApiHealth } from '../discord-notify';
import { generateSecureToken, hashToken } from '../crypto';
import { AppError } from '../errors';
import { runtimeRegistry } from '../../runtime/registry';
import { formatEntityPublicId } from '../../shared/ids';
import { MAX_HOSTS_PER_USER } from '../../shared/types';
import {
  CreateNodeAllocationBatchSchema,
  CreateNodeSchema,
} from '../../shared/validation';

const AdminQuerySchema = z.object({
  entity: z
    .enum([
      'users',
      'hosts',
      'activity',
      'sessions',
      'nodes',
      'databases',
      'schedules',
      'backups',
    ])
    .default('users'),
  search: z.string().optional().default(''),
  status: z.string().optional().default('ALL'),
  sort: z.enum(['newest', 'oldest', 'name']).optional().default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(15),
});

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
      schedulesCount,
      backupsCount,
      activeSessionsCount,
      activityCount,
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
      prisma.schedule.count(),
      prisma.backup.count(),
      prisma.session.count({
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
      prisma.activityLog.count(),
      prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          user: { select: { id: true, publicId: true, username: true, displayName: true } },
          host: { select: { id: true, publicId: true, name: true } },
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
          schedules: schedulesCount,
          backups: backupsCount,
          sessions: activeSessionsCount,
          activity: activityCount,
        },
        nodes: nodes.map((n) => {
          const agent = runtimeRegistry.getAgentOrNull(n.id);
          return {
            id: n.id,
            publicId: formatEntityPublicId('nod', n.id),
            name: n.name,
            location: n.location,
            fqdn: n.fqdn,
            ipAddress: n.ipAddress,
            daemonPort: n.daemonPort,
            status: runtimeRegistry.getNodeEffectiveStatus(n.id, n.status),
            liveConnected: runtimeRegistry.isNodeConnected(n.id),
            capabilities: agent?.capabilities ?? null,
            resources: agent?.resources ?? null,
            maxMemoryMb: n.maxMemoryMb,
            maxDiskMb: n.maxDiskMb,
            maxCpuPercent: n.maxCpuPercent,
            lastHeartbeatAt: n.lastHeartbeatAt ? n.lastHeartbeatAt.toISOString() : null,
            counts: n._count,
            createdAt: n.createdAt.toISOString(),
          };
        }),
        diagnostics: {
          env: getEnvironmentDiagnosticsSummary(),
        },
        recentActivity: recentActivity.map((log) => ({
          id: log.id,
          publicId: formatEntityPublicId('act', log.id),
          userId: log.user
            ? formatEntityPublicId('usr', log.user.id, log.user.publicId)
            : null,
          hostId: log.host
            ? formatEntityPublicId('srv', log.host.id, log.host.publicId)
            : null,
          action: log.action,
          actor: log.user?.displayName || log.user?.username || 'System',
          hostName: log.host?.name || null,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          metadata: log.metadata,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    };
  });

  // Safe Production Environment & Discord Bot API Diagnostics (never exposes secret values)
  app.get('/api/admin/diagnostics', async (request) => {
    await requireAdmin(request);
    const [dbHealth, discordBotHealth] = await Promise.all([
      checkDatabaseHealth(),
      probeDiscordBotApiHealth(),
    ]);

    return {
      success: true,
      data: {
        environmentVariables: getEnvironmentDiagnosticsSummary(),
        database: dbHealth,
        discordBot: discordBotHealth,
        runtimeNodes: {
          connectedCount: runtimeRegistry.getConnectedNodeCount(),
          connectedNodes: runtimeRegistry.getConnectedAgents().map((a) => ({
            nodeId: a.nodeId,
            fqdn: a.fqdn,
            status: a.status,
            capabilities: a.capabilities,
            resources: a.resources,
            lastHeartbeatAt: a.lastHeartbeatAt?.toISOString() ?? null,
          })),
        },
        timestamp: new Date().toISOString(),
      },
    };
  });

  // Paginated, searchable, filterable, sortable Admin Control Plane Explorer for all 8 entities
  app.get('/api/admin/records', async (request) => {
    await requireAdmin(request);
    const prisma = getPrismaOrThrow();
    const q = AdminQuerySchema.parse(request.query);
    const skip = (q.page - 1) * q.limit;
    const search = q.search.trim();
    const createdAtOrder = q.sort === 'oldest' ? ('asc' as const) : ('desc' as const);

    if (q.entity === 'users') {
      const where: any = {};
      if (q.status !== 'ALL') {
        where.role = q.status;
      }
      if (search) {
        where.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
          { discordId: { contains: search } },
          { publicId: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: q.sort === 'name' ? { username: 'asc' } : { createdAt: createdAtOrder },
          include: {
            _count: { select: { ownedHosts: true, sessions: true, activityLogs: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          items: rows.map((u) => ({
            id: u.id,
            publicId: formatEntityPublicId('usr', u.id, u.publicId),
            discordId: u.discordId,
            username: u.username,
            displayName: u.displayName,
            avatar: u.avatar,
            role: u.role,
            hostCount: u._count.ownedHosts,
            maxHosts: MAX_HOSTS_PER_USER,
            sessionCount: u._count.sessions,
            activityCount: u._count.activityLogs,
            createdAt: u.createdAt.toISOString(),
            updatedAt: u.updatedAt.toISOString(),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'hosts') {
      const where: any = {};
      if (q.status !== 'ALL') {
        where.status = q.status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { publicId: { contains: search, mode: 'insensitive' } },
          { owner: { username: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.host.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: q.sort === 'name' ? { name: 'asc' } : { createdAt: createdAtOrder },
          include: {
            owner: { select: { id: true, publicId: true, username: true, displayName: true, discordId: true } },
            node: { select: { id: true, name: true, location: true } },
          },
        }),
        prisma.host.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          items: rows.map((h) => {
            const nodeConnected = runtimeRegistry.isNodeConnected(h.nodeId);
            return {
              id: h.id,
              publicId: formatEntityPublicId('srv', h.id, h.publicId),
              name: h.name,
              description: h.description,
              type: h.type,
              runtime: h.runtime,
              runtimeVersion: h.runtimeVersion,
              status: nodeConnected ? h.status : h.status === 'ONLINE' ? 'OFFLINE' : h.status,
              nodeOnline: nodeConnected,
              nodeName: h.node ? `${h.node.name} (${h.node.location})` : null,
              memoryLimitMb: h.memoryLimitMb,
              cpuLimitPercent: h.cpuLimitPercent,
              diskLimitMb: h.diskLimitMb,
              owner: {
                publicId: formatEntityPublicId('usr', h.owner.id, h.owner.publicId),
                username: h.owner.username,
                displayName: h.owner.displayName,
                discordId: h.owner.discordId,
              },
              createdAt: h.createdAt.toISOString(),
              updatedAt: h.updatedAt.toISOString(),
            };
          }),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'activity') {
      const where: any = {};
      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search } },
          { user: { username: { contains: search, mode: 'insensitive' } } },
          { host: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: createdAtOrder },
          include: {
            user: { select: { id: true, publicId: true, username: true, displayName: true } },
            host: { select: { id: true, publicId: true, name: true } },
          },
        }),
        prisma.activityLog.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          items: rows.map((l) => ({
            id: l.id,
            publicId: formatEntityPublicId('act', l.id),
            userId: l.user ? formatEntityPublicId('usr', l.user.id, l.user.publicId) : null,
            actorName: l.user?.displayName || l.user?.username || 'System',
            hostId: l.host ? formatEntityPublicId('srv', l.host.id, l.host.publicId) : null,
            hostName: l.host?.name || null,
            action: l.action,
            metadata: l.metadata,
            ipAddress: l.ipAddress,
            userAgent: l.userAgent,
            createdAt: l.createdAt.toISOString(),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'sessions') {
      const where: any = {};
      if (q.status === 'ACTIVE') {
        where.revokedAt = null;
        where.expiresAt = { gt: new Date() };
      } else if (q.status === 'REVOKED') {
        where.revokedAt = { not: null };
      }
      if (search) {
        where.OR = [
          { ipAddress: { contains: search } },
          { user: { username: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.session.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: createdAtOrder },
          include: {
            user: { select: { id: true, publicId: true, username: true, displayName: true, discordId: true } },
          },
        }),
        prisma.session.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          // Never expose tokenHash or csrfToken in API responses
          items: rows.map((s) => ({
            id: s.id,
            publicId: formatEntityPublicId('ses', s.id),
            userId: formatEntityPublicId('usr', s.user.id, s.user.publicId),
            username: s.user.username,
            displayName: s.user.displayName,
            discordId: s.user.discordId,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            active: !s.revokedAt && s.expiresAt > new Date(),
            expiresAt: s.expiresAt.toISOString(),
            revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
            createdAt: s.createdAt.toISOString(),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'nodes') {
      const where: any = {};
      if (q.status !== 'ALL') {
        where.status = q.status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { fqdn: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.node.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: q.sort === 'name' ? { name: 'asc' } : { createdAt: createdAtOrder },
          include: {
            _count: { select: { hosts: true, allocations: true, databases: true } },
          },
        }),
        prisma.node.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          // Never expose agentTokenHash
          items: rows.map((n) => ({
            id: n.id,
            publicId: formatEntityPublicId('nod', n.id),
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
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'databases') {
      const where: any = {};
      if (q.status !== 'ALL') {
        where.engine = q.status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { host: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.database.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: createdAtOrder },
          include: {
            host: { select: { id: true, publicId: true, name: true } },
            node: { select: { id: true, name: true } },
          },
        }),
        prisma.database.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          items: rows.map((d) => ({
            id: d.id,
            publicId: formatEntityPublicId('db', d.id),
            name: d.name,
            engine: d.engine,
            hostAddress: d.hostAddress,
            port: d.port,
            status: d.status,
            hostId: formatEntityPublicId('srv', d.host.id, d.host.publicId),
            hostName: d.host.name,
            nodeName: d.node?.name || null,
            createdAt: d.createdAt.toISOString(),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    if (q.entity === 'schedules') {
      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { host: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.schedule.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: createdAtOrder },
          include: {
            host: { select: { id: true, publicId: true, name: true } },
          },
        }),
        prisma.schedule.count({ where }),
      ]);

      return {
        success: true,
        data: {
          entity: q.entity,
          items: rows.map((s) => ({
            id: s.id,
            publicId: formatEntityPublicId('sch', s.id),
            name: s.name,
            cronExpression: s.cronExpression,
            taskType: s.taskType,
            isActive: s.isActive,
            lastStatus: s.lastStatus,
            lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
            nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
            hostId: formatEntityPublicId('srv', s.host.id, s.host.publicId),
            hostName: s.host.name,
            createdAt: s.createdAt.toISOString(),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      };
    }

    // backups
    const where: any = {};
    if (q.status !== 'ALL') {
      where.status = q.status;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { host: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.backup.findMany({
        where,
        skip,
        take: q.limit,
        orderBy: { createdAt: createdAtOrder },
        include: {
          host: { select: { id: true, publicId: true, name: true } },
        },
      }),
      prisma.backup.count({ where }),
    ]);

    return {
      success: true,
      data: {
        entity: q.entity,
        items: rows.map((b) => ({
          id: b.id,
          publicId: formatEntityPublicId('bkp', b.id),
          name: b.name,
          status: b.status,
          sizeBytes: Number(b.sizeBytes),
          storageProvider: b.storageProvider,
          checksumSha256: b.checksumSha256,
          isLocked: b.isLocked,
          hostId: formatEntityPublicId('srv', b.host.id, b.host.publicId),
          hostName: b.host.name,
          completedAt: b.completedAt ? b.completedAt.toISOString() : null,
          createdAt: b.createdAt.toISOString(),
        })),
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / q.limit)),
        },
      },
    };
  });

  // Update user role (Admin only)
  app.patch('/api/admin/users/:userId/role', async (request) => {
    const { user: adminUser } = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const body = z
      .object({ role: z.enum(['USER', 'ADMIN']) })
      .parse(request.body);
    const prisma = getPrismaOrThrow();

    const target = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
    });

    if (!target) {
      throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
    }

    if (target.id === adminUser.id && body.role !== 'ADMIN') {
      throw new AppError(
        'CANNOT_DEMOTE_SELF',
        'You cannot remove Administrator privileges from your own active account.',
        400
      );
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: body.role },
    });

    await recordActivityLog({
      userId: adminUser.id,
      action: `Changed User Role (${updated.username} → ${body.role})`,
      metadata: {
        targetUserPublicId: formatEntityPublicId('usr', updated.id, updated.publicId),
        newRole: body.role,
      },
      request,
    });

    return {
      success: true,
      data: {
        id: updated.id,
        publicId: formatEntityPublicId('usr', updated.id, updated.publicId),
        role: updated.role,
      },
    };
  });

  // Revoke session (Admin only)
  app.post('/api/admin/sessions/:sessionId/revoke', async (request) => {
    const { user: adminUser } = await requireAdmin(request);
    const { sessionId } = request.params as { sessionId: string };
    const prisma = getPrismaOrThrow();

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Session not found.', 404);
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await recordActivityLog({
      userId: adminUser.id,
      action: 'Revoked User Session',
      metadata: {
        sessionPublicId: formatEntityPublicId('ses', session.id),
      },
      request,
    });

    return {
      success: true,
      data: { revoked: true },
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
    // Never return raw agent token to the frontend; store only HMAC-SHA256 hash in PostgreSQL
    const rawAgentToken =
      body.agentToken ||
      config.runtimeNodeSecret ||
      `hhnode_${generateSecureToken(24)}`;
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
        nodeId: formatEntityPublicId('nod', node.id),
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
        node: {
          id: node.id,
          publicId: formatEntityPublicId('nod', node.id),
          name: node.name,
          location: node.location,
          fqdn: node.fqdn,
          ipAddress: node.ipAddress,
          daemonPort: node.daemonPort,
          status: node.status,
          maxMemoryMb: node.maxMemoryMb,
          maxDiskMb: node.maxDiskMb,
          maxCpuPercent: node.maxCpuPercent,
          createdAt: node.createdAt.toISOString(),
        },
        tokenConfigured: true,
      },
    };
  });

  // Delete an offline unassigned Runtime Node (Admin only)
  app.delete('/api/admin/nodes/:nodeId', async (request) => {
    const { user } = await requireAdmin(request);
    const { nodeId } = request.params as { nodeId: string };
    const prisma = getPrismaOrThrow();

    const node = await prisma.node.findUnique({
      where: { id: nodeId },
      include: { _count: { select: { hosts: true } } },
    });

    if (!node) {
      throw new AppError('NODE_NOT_FOUND', 'Runtime Node not found.', 404);
    }

    if (node._count.hosts > 0) {
      throw new AppError(
        'NODE_HAS_ASSIGNED_HOSTS',
        'Cannot delete a Runtime Node that still has assigned Hosts.',
        400
      );
    }

    await prisma.node.delete({ where: { id: node.id } });

    await recordActivityLog({
      userId: user.id,
      action: 'Deleted Runtime Node',
      metadata: {
        nodePublicId: formatEntityPublicId('nod', node.id),
        name: node.name,
      },
      request,
    });

    return {
      success: true,
      data: { deleted: true },
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
        nodeId: formatEntityPublicId('nod', node.id),
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
