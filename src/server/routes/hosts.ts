import type { FastifyInstance } from 'fastify';
import {
  recordActivityLog,
  requireAuth,
  requireHostPermission,
} from '../auth';
import { getPrismaOrThrow } from '../database';
import { AppError } from '../errors';
import {
  decryptSecret,
  encryptSecret,
  generateSecureToken,
  maskSecret,
} from '../crypto';
import { runtimeRegistry } from '../../runtime/registry';
import { sendDiscordHostCreatedNotification } from '../discord-notify';
import { formatEntityPublicId, generatePublicId } from '../../shared/ids';
import {
  HOST_PERMISSIONS,
  MAX_HOSTS_PER_USER,
  normalizeLocale,
  RUNTIME_CATALOG,
  type HostPermissionScope,
  type HostSummaryDTO,
} from '../../shared/types';
import {
  CreateAllocationRequestSchema,
  CreateBackupSchema,
  CreateDatabaseSchema,
  CreateHostSchema,
  CreateScheduleSchema,
  FileOperationSchema,
  PowerManagementSchema,
  UpdateHostSettingsSchema,
  UpdateStartupSchema,
  UpsertCollaboratorSchema,
} from '../../shared/validation';

export async function registerHostRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/hosts — List user's owned & accessible Hosts + dashboard aggregate stats
  app.get('/api/hosts', async (request) => {
    const { user } = await requireAuth(request);
    const prisma = getPrismaOrThrow();

    const [hosts, nodes, recentActivity, ownedCount] = await Promise.all([
      prisma.host.findMany({
        where: {
          OR: [
            { ownerId: user.id },
            { permissions: { some: { userId: user.id } } },
          ],
        },
        include: {
          node: {
            select: { id: true, name: true, location: true, isOnline: true, status: true },
          },
          allocations: {
            where: { isPrimary: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.node.findMany({
        select: {
          id: true,
          name: true,
          location: true,
          fqdn: true,
          status: true,
          isOnline: true,
          maxMemoryMb: true,
          maxDiskMb: true,
          maxCpuPercent: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.activityLog.findMany({
        where: {
          OR: [
            { userId: user.id },
            { host: { ownerId: user.id } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          user: { select: { id: true, publicId: true, username: true, displayName: true } },
          host: { select: { id: true, publicId: true, name: true } },
        },
      }),
      prisma.host.count({ where: { ownerId: user.id } }),
    ]);

    const mappedHosts: HostSummaryDTO[] = hosts.map((h) => {
      const nodeConnected = runtimeRegistry.isNodeConnected(h.nodeId);
      const effectiveStatus = nodeConnected ? h.status : h.status === 'ONLINE' ? 'OFFLINE' : h.status;
      const primary = h.allocations[0] || null;
      const serverPublicId = formatEntityPublicId('srv', h.id, h.publicId);

      return {
        id: h.id,
        publicId: serverPublicId,
        ownerId: h.ownerId,
        name: h.name,
        description: h.description,
        type: h.type,
        runtime: h.runtime,
        runtimeVersion: h.runtimeVersion,
        status: effectiveStatus,
        nodeId: h.nodeId,
        nodeName: h.node ? `${h.node.name} (${h.node.location})` : null,
        nodeOnline: nodeConnected,
        memoryLimitMb: h.memoryLimitMb,
        cpuLimitPercent: h.cpuLimitPercent,
        diskLimitMb: h.diskLimitMb,
        primaryAllocation: primary
          ? {
              ipAddress: primary.ipAddress,
              port: primary.port,
              protocol: primary.protocol,
            }
          : null,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      };
    });

    return {
      success: true,
      data: {
        hosts: mappedHosts,
        quota: {
          ownedCount,
          maxHosts: MAX_HOSTS_PER_USER,
          remainingCount: Math.max(0, MAX_HOSTS_PER_USER - ownedCount),
        },
        availableNodes: nodes.map((n) => ({
          ...n,
          publicId: formatEntityPublicId('nod', n.id),
          liveConnected: runtimeRegistry.isNodeConnected(n.id),
        })),
        runtimes: RUNTIME_CATALOG,
        recentActivity: recentActivity.map((log) => ({
          id: log.id,
          publicId: formatEntityPublicId('act', log.id),
          userId: log.user
            ? formatEntityPublicId('usr', log.user.id, log.user.publicId)
            : null,
          action: log.action,
          hostId: log.host
            ? formatEntityPublicId('srv', log.host.id, log.host.publicId)
            : log.hostId,
          hostName: log.host?.name ?? null,
          actorName: log.user?.displayName ?? log.user?.username ?? 'System',
          metadata: log.metadata,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    };
  });

  // POST /api/hosts — Create a new Host (enforces 10 Host limit per user)
  app.post('/api/hosts', async (request, reply) => {
    const { user } = await requireAuth(request);
    const body = CreateHostSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    // Enforce MAX_HOSTS_PER_USER = 10 in Backend
    const currentHostCount = await prisma.host.count({
      where: { ownerId: user.id },
    });

    if (currentHostCount >= MAX_HOSTS_PER_USER) {
      throw new AppError(
        'HOST_LIMIT_REACHED',
        `You have reached the maximum limit of ${MAX_HOSTS_PER_USER} Hosts per account.`,
        403
      );
    }

    const runtimeItem = RUNTIME_CATALOG.find((r) => r.code === body.runtime);
    if (!runtimeItem) {
      throw new AppError('INVALID_RUNTIME', 'Unsupported runtime selected.', 400);
    }

    let selectedNodeId: string | null = null;
    let nodeIsLive = false;

    if (body.nodeId) {
      const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
      if (!node) {
        throw new AppError('NODE_NOT_FOUND', 'The selected Runtime Node does not exist.', 404);
      }
      selectedNodeId = node.id;
      nodeIsLive = runtimeRegistry.isNodeConnected(node.id);
    }

    const adapter = runtimeRegistry.getRuntimeAdapter(body.runtime);
    const dockerImage = adapter.resolveDockerImage(body.runtimeVersion);

    // Never pretend a Host is ONLINE if no Runtime Node is connected; create as PENDING
    const initialStatus = nodeIsLive ? 'INSTALLING' : 'PENDING';

    const generatedServerId = generatePublicId('srv');

    const createdHost = await prisma.host.create({
      data: {
        publicId: generatedServerId,
        ownerId: user.id,
        nodeId: selectedNodeId,
        name: body.name,
        description: body.description ?? null,
        type: body.type,
        runtime: body.runtime,
        runtimeVersion: body.runtimeVersion || runtimeItem.defaultVersion,
        status: initialStatus,
        memoryLimitMb: body.memoryLimitMb,
        cpuLimitPercent: body.cpuLimitPercent,
        diskLimitMb: body.diskLimitMb,
        startupCommand: runtimeItem.defaultStartupCommand,
        startupArgs: [],
        workingDirectory: '/home/container',
        dockerImage,
      },
    });

    const serverPublicId = formatEntityPublicId(
      'srv',
      createdHost.id,
      createdHost.publicId
    );

    // If a node was selected and has an available allocation, bind primary allocation
    if (selectedNodeId) {
      const availableAlloc = await prisma.nodeAllocation.findFirst({
        where: { nodeId: selectedNodeId, status: 'AVAILABLE', hostId: null },
        orderBy: { port: 'asc' },
      });
      if (availableAlloc) {
        await prisma.nodeAllocation.update({
          where: { id: availableAlloc.id },
          data: {
            hostId: createdHost.id,
            isPrimary: true,
            status: 'ASSIGNED',
          },
        });
      }
    }

    await recordActivityLog({
      userId: user.id,
      hostId: createdHost.id,
      action: 'Created Host',
      metadata: {
        serverId: serverPublicId,
        name: createdHost.name,
        type: createdHost.type,
        runtime: createdHost.runtime,
        status: createdHost.status,
        memoryLimitMb: createdHost.memoryLimitMb,
        cpuLimitPercent: createdHost.cpuLimitPercent,
        diskLimitMb: createdHost.diskLimitMb,
      },
      request,
    });

    const requestLocale = normalizeLocale(
      (request.headers['x-hyperhost-locale'] as string | undefined) ||
        request.cookies?.['hyperhost_locale']
    );

    // Dispatch fail-safe Discord DM notification after PostgreSQL persistence succeeds
    void sendDiscordHostCreatedNotification({
      discordId: user.discordId,
      username: user.username,
      hostId: createdHost.id,
      serverId: serverPublicId,
      hostName: createdHost.name,
      runtime: createdHost.runtime,
      runtimeVersion: createdHost.runtimeVersion,
      status: createdHost.status,
      createdAt: createdHost.createdAt,
      locale: requestLocale,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        host: {
          ...createdHost,
          publicId: serverPublicId,
          createdAt: createdHost.createdAt.toISOString(),
          updatedAt: createdHost.updatedAt.toISOString(),
        },
      },
    };
  });

  // GET /api/hosts/:id — Detailed Host inspection
  app.get('/api/hosts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { host, isOwner, grantedPermissions } = await requireHostPermission(request, id);
    const prisma = getPrismaOrThrow();

    const fullHost = await prisma.host.findUnique({
      where: { id: host.id },
      include: {
        node: {
          select: {
            id: true,
            name: true,
            location: true,
            fqdn: true,
            ipAddress: true,
            daemonPort: true,
            status: true,
          },
        },
        allocations: {
          orderBy: [{ isPrimary: 'desc' }, { port: 'asc' }],
        },
        _count: {
          select: {
            environments: true,
            databases: true,
            schedules: true,
            backups: true,
            permissions: true,
          },
        },
      },
    });

    if (!fullHost) {
      throw new AppError('HOST_NOT_FOUND', 'Host not found.', 404);
    }

    const nodeConnected = runtimeRegistry.isNodeConnected(fullHost.nodeId);
    const serverPublicId = formatEntityPublicId(
      'srv',
      fullHost.id,
      fullHost.publicId
    );

    return {
      success: true,
      data: {
        host: {
          id: fullHost.id,
          publicId: serverPublicId,
          ownerId: fullHost.ownerId,
          name: fullHost.name,
          description: fullHost.description,
          type: fullHost.type,
          runtime: fullHost.runtime,
          runtimeVersion: fullHost.runtimeVersion,
          status: nodeConnected ? fullHost.status : fullHost.status === 'ONLINE' ? 'OFFLINE' : fullHost.status,
          nodeOnline: nodeConnected,
          memoryLimitMb: fullHost.memoryLimitMb,
          cpuLimitPercent: fullHost.cpuLimitPercent,
          diskLimitMb: fullHost.diskLimitMb,
          startupCommand: fullHost.startupCommand,
          startupArgs: fullHost.startupArgs,
          workingDirectory: fullHost.workingDirectory,
          dockerImage: fullHost.dockerImage,
          node: fullHost.node
            ? {
                ...fullHost.node,
                publicId: formatEntityPublicId('nod', fullHost.node.id),
                liveConnected: nodeConnected,
              }
            : null,
          allocations: fullHost.allocations,
          counts: fullHost._count,
          createdAt: fullHost.createdAt.toISOString(),
          updatedAt: fullHost.updatedAt.toISOString(),
        },
        access: {
          isOwner,
          permissions: isOwner ? HOST_PERMISSIONS : grantedPermissions,
        },
      },
    };
  });

  // DELETE /api/hosts/:id — Delete Host (Owner or Admin only)
  app.delete('/api/hosts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { auth, host, isOwner } = await requireHostPermission(request, id);

    if (!isOwner) {
      throw new AppError(
        'OWNER_REQUIRED',
        'Only the Host owner or a Control Plane administrator can delete a Host.',
        403
      );
    }

    const prisma = getPrismaOrThrow();

    await prisma.nodeAllocation.updateMany({
      where: { hostId: host.id },
      data: { hostId: null, isPrimary: false, status: 'AVAILABLE' },
    });

    await prisma.host.delete({ where: { id: host.id } });

    await recordActivityLog({
      userId: auth.user.id,
      action: 'Deleted Host',
      metadata: {
        deletedHostId: host.id,
        deletedHostName: host.name,
      },
      request,
    });

    return {
      success: true,
      data: { deleted: true, id: host.id },
    };
  });

  // ============================================================================
  // 10. CONSOLE (/api/hosts/:id/console + WebSocket /api/hosts/:id/console/ws)
  // ============================================================================
  app.get('/api/hosts/:id/console', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'console.read');
    const nodeConnected = runtimeRegistry.isNodeConnected(host.nodeId);

    return {
      success: true,
      data: {
        hostId: host.id,
        nodeId: host.nodeId,
        nodeConnected,
        status: nodeConnected ? 'CONNECTED' : 'RUNTIME_NODE_UNAVAILABLE',
        message: nodeConnected
          ? 'Runtime node connected. WebSocket stream ready.'
          : 'Runtime node unavailable',
        wsEndpoint: `/api/hosts/${host.id}/console/ws`,
      },
    };
  });

  app.get(
    '/api/hosts/:id/console/ws',
    { websocket: true },
    async (socket, request) => {
      const { id } = request.params as { id: string };

      try {
        const { auth, host, isOwner, grantedPermissions } = await requireHostPermission(
          request,
          id,
          'console.read'
        );

        const canWrite =
          isOwner || grantedPermissions.includes('console.write');
        const agent = runtimeRegistry.getAgentOrNull(host.nodeId);

        if (!agent) {
          socket.send(
            JSON.stringify({
              type: 'status',
              state: 'RUNTIME_NODE_UNAVAILABLE',
              message: 'Runtime node unavailable',
              timestamp: new Date().toISOString(),
            })
          );

          socket.on('message', () => {
            socket.send(
              JSON.stringify({
                type: 'status',
                state: 'RUNTIME_NODE_UNAVAILABLE',
                message: 'Runtime node unavailable',
                timestamp: new Date().toISOString(),
              })
            );
          });
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'status',
            state: 'CONNECTED',
            message: `Attached to Runtime Node (${agent.fqdn})`,
            timestamp: new Date().toISOString(),
          })
        );

        const unsubscribe = agent.subscribeConsole(host.id, (frame) => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(frame));
          }
        });

        socket.on('message', async (raw) => {
          try {
            const payload = JSON.parse(raw.toString()) as {
              type?: string;
              command?: string;
            };
            if (payload.type === 'command' && payload.command) {
              if (!canWrite) {
                socket.send(
                  JSON.stringify({
                    type: 'stderr',
                    data: 'Permission denied: console.write is required to send stdin commands.',
                    timestamp: new Date().toISOString(),
                  })
                );
                return;
              }
              await agent.processManager.sendStdin(host.id, payload.command);
              await recordActivityLog({
                userId: auth.user.id,
                hostId: host.id,
                action: 'Executed Console Command',
                metadata: { commandLength: payload.command.length },
                request,
              });
            }
          } catch {
            socket.send(
              JSON.stringify({
                type: 'stderr',
                data: 'Malformed WebSocket command frame.',
                timestamp: new Date().toISOString(),
              })
            );
          }
        });

        socket.on('close', () => {
          unsubscribe();
        });
      } catch (err) {
        const message =
          err instanceof AppError ? err.message : 'Console authentication failed';
        socket.send(
          JSON.stringify({
            type: 'status',
            state: 'UNAUTHORIZED',
            message,
            timestamp: new Date().toISOString(),
          })
        );
        socket.close();
      }
    }
  );

  // ============================================================================
  // 11. FILES (/api/hosts/:id/files)
  // ============================================================================
  app.get('/api/hosts/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'files.read');
    const query = request.query as { path?: string };
    const targetPath = (query.path || '/').trim();

    if (targetPath.includes('..')) {
      throw new AppError('INVALID_PATH', 'Path traversal is prohibited.', 400);
    }

    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);
    const entries = await agent.fileManager.listDirectory(host.id, targetPath);

    return {
      success: true,
      data: {
        path: targetPath,
        entries,
      },
    };
  });

  app.post('/api/hosts/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const body = FileOperationSchema.parse(request.body);
    const requiredScope: HostPermissionScope =
      body.action === 'list' || body.action === 'read' ? 'files.read' : 'files.write';

    const { auth, host } = await requireHostPermission(request, id, requiredScope);
    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);

    if (body.action === 'list') {
      const entries = await agent.fileManager.listDirectory(host.id, body.path);
      return { success: true, data: { entries } };
    }

    if (body.action === 'read') {
      const content = await agent.fileManager.readFile(host.id, body.path);
      return { success: true, data: { path: body.path, content } };
    }

    if (body.action === 'create_file' || body.action === 'write') {
      await agent.fileManager.writeFile(host.id, body.path, body.content ?? '');
      await recordActivityLog({
        userId: auth.user.id,
        hostId: host.id,
        action: body.action === 'create_file' ? 'Created File' : 'Edited File',
        metadata: { path: body.path },
        request,
      });
      return { success: true, data: { updated: true, path: body.path } };
    }

    if (body.action === 'create_folder') {
      await agent.fileManager.createDirectory(host.id, body.path);
      await recordActivityLog({
        userId: auth.user.id,
        hostId: host.id,
        action: 'Created Directory',
        metadata: { path: body.path },
        request,
      });
      return { success: true, data: { created: true, path: body.path } };
    }

    if (body.action === 'rename' && body.targetPath) {
      await agent.fileManager.renamePath(host.id, body.path, body.targetPath);
      await recordActivityLog({
        userId: auth.user.id,
        hostId: host.id,
        action: 'Renamed File/Folder',
        metadata: { from: body.path, to: body.targetPath },
        request,
      });
      return { success: true, data: { renamed: true } };
    }

    if (body.action === 'move' && body.targetPath) {
      await agent.fileManager.movePath(host.id, body.path, body.targetPath);
      await recordActivityLog({
        userId: auth.user.id,
        hostId: host.id,
        action: 'Moved File/Folder',
        metadata: { from: body.path, to: body.targetPath },
        request,
      });
      return { success: true, data: { moved: true } };
    }

    if (body.action === 'delete') {
      await agent.fileManager.deletePath(host.id, body.path);
      await recordActivityLog({
        userId: auth.user.id,
        hostId: host.id,
        action: 'Deleted File/Folder',
        metadata: { path: body.path },
        request,
      });
      return { success: true, data: { deleted: true } };
    }

    throw new AppError('INVALID_FILE_OPERATION', 'Invalid file operation parameters.', 400);
  });

  // ============================================================================
  // 12. STARTUP & ENVIRONMENT VARIABLES (/api/hosts/:id/startup)
  // ============================================================================
  app.get('/api/hosts/:id/startup', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'startup.read');
    const prisma = getPrismaOrThrow();

    const environments = await prisma.hostEnvironment.findMany({
      where: { hostId: host.id },
      orderBy: { key: 'asc' },
    });

    return {
      success: true,
      data: {
        runtime: host.runtime,
        runtimeVersion: host.runtimeVersion,
        startupCommand: host.startupCommand,
        startupArgs: host.startupArgs,
        workingDirectory: host.workingDirectory,
        dockerImage: host.dockerImage,
        availableRuntimes: RUNTIME_CATALOG,
        environmentVariables: environments.map((env) => {
          let plainOrMasked = '••••••••';
          try {
            const plain = decryptSecret(env.encryptedValue);
            plainOrMasked = env.isSecret ? maskSecret(plain) : plain;
          } catch {
            plainOrMasked = '••••••••';
          }
          return {
            id: env.id,
            key: env.key,
            value: plainOrMasked,
            isSecret: env.isSecret,
            description: env.description,
            updatedAt: env.updatedAt.toISOString(),
          };
        }),
      },
    };
  });

  app.put('/api/hosts/:id/startup', async (request) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'startup.write');
    const body = UpdateStartupSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    const nextRuntime = body.runtime ?? host.runtime;
    const nextVersion = body.runtimeVersion ?? host.runtimeVersion;
    const adapter = runtimeRegistry.getRuntimeAdapter(nextRuntime);
    const dockerImage = adapter.resolveDockerImage(nextVersion);

    const updatedHost = await prisma.host.update({
      where: { id: host.id },
      data: {
        runtime: nextRuntime,
        runtimeVersion: nextVersion,
        startupCommand: body.startupCommand,
        startupArgs: body.startupArgs,
        workingDirectory: body.workingDirectory,
        dockerImage,
      },
    });

    if (body.environmentVariables) {
      const existingEnvs = await prisma.hostEnvironment.findMany({
        where: { hostId: host.id },
      });
      const existingByKey = new Map(existingEnvs.map((e) => [e.key, e]));
      const incomingKeys = new Set(body.environmentVariables.map((e) => e.key));

      // Delete removed variables
      const keysToDelete = existingEnvs
        .filter((e) => !incomingKeys.has(e.key))
        .map((e) => e.key);

      if (keysToDelete.length > 0) {
        await prisma.hostEnvironment.deleteMany({
          where: {
            hostId: host.id,
            key: { in: keysToDelete },
          },
        });
      }

      // Upsert incoming variables (if value contains •••• mask and variable already exists, preserve existing encryptedValue)
      for (const item of body.environmentVariables) {
        const existing = existingByKey.get(item.key);
        const isUnchangedMaskedSecret =
          existing && item.value.includes('••••');

        const encryptedValue = isUnchangedMaskedSecret
          ? existing.encryptedValue
          : encryptSecret(item.value);

        await prisma.hostEnvironment.upsert({
          where: {
            hostId_key: {
              hostId: host.id,
              key: item.key,
            },
          },
          update: {
            encryptedValue,
            isSecret: item.isSecret,
            description: item.description ?? null,
          },
          create: {
            hostId: host.id,
            key: item.key,
            encryptedValue,
            isSecret: item.isSecret,
            description: item.description ?? null,
          },
        });
      }
    }

    // ActivityLog never records secret values
    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Updated Startup',
      metadata: {
        runtime: updatedHost.runtime,
        runtimeVersion: updatedHost.runtimeVersion,
        startupCommand: updatedHost.startupCommand,
        workingDirectory: updatedHost.workingDirectory,
        environmentVariableCount: body.environmentVariables?.length ?? undefined,
      },
      request,
    });

    return {
      success: true,
      data: {
        updated: true,
        runtime: updatedHost.runtime,
        runtimeVersion: updatedHost.runtimeVersion,
        startupCommand: updatedHost.startupCommand,
        startupArgs: updatedHost.startupArgs,
        workingDirectory: updatedHost.workingDirectory,
        dockerImage: updatedHost.dockerImage,
      },
    };
  });

  // ============================================================================
  // 13. NETWORK & ALLOCATIONS (/api/hosts/:id/network)
  // ============================================================================
  app.get('/api/hosts/:id/network', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'network.read');
    const prisma = getPrismaOrThrow();

    const [assignedAllocations, availableNodeAllocations] = await Promise.all([
      prisma.nodeAllocation.findMany({
        where: { hostId: host.id },
        orderBy: [{ isPrimary: 'desc' }, { port: 'asc' }],
      }),
      host.nodeId
        ? prisma.nodeAllocation.findMany({
            where: { nodeId: host.nodeId, status: 'AVAILABLE', hostId: null },
            orderBy: { port: 'asc' },
            take: 50,
          })
        : Promise.resolve([]),
    ]);

    return {
      success: true,
      data: {
        nodeId: host.nodeId,
        allocations: assignedAllocations,
        availablePool: availableNodeAllocations,
      },
    };
  });

  app.post('/api/hosts/:id/network', async (request) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'network.write');
    const body = CreateAllocationRequestSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    if (!host.nodeId) {
      throw new AppError(
        'HOST_NODE_UNASSIGNED',
        'This Host is not assigned to a Runtime Node yet. Network allocations require an assigned Node.',
        400
      );
    }

    const alloc = await prisma.nodeAllocation.findUnique({
      where: { id: body.allocationId },
    });

    if (!alloc || alloc.nodeId !== host.nodeId || alloc.status !== 'AVAILABLE' || alloc.hostId) {
      throw new AppError(
        'ALLOCATION_UNAVAILABLE',
        'The requested IP/Port allocation is not available on this Node.',
        400
      );
    }

    const existingCount = await prisma.nodeAllocation.count({
      where: { hostId: host.id },
    });

    const makePrimary = body.isPrimary || existingCount === 0;
    if (makePrimary) {
      await prisma.nodeAllocation.updateMany({
        where: { hostId: host.id },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.nodeAllocation.update({
      where: { id: alloc.id },
      data: {
        hostId: host.id,
        status: 'ASSIGNED',
        isPrimary: makePrimary,
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Assigned Network Allocation',
      metadata: {
        ipAddress: updated.ipAddress,
        port: updated.port,
        protocol: updated.protocol,
        isPrimary: updated.isPrimary,
      },
      request,
    });

    return {
      success: true,
      data: { allocation: updated },
    };
  });

  app.delete('/api/hosts/:id/network/:allocationId', async (request) => {
    const { id, allocationId } = request.params as { id: string; allocationId: string };
    const { auth, host } = await requireHostPermission(request, id, 'network.write');
    const prisma = getPrismaOrThrow();

    const alloc = await prisma.nodeAllocation.findFirst({
      where: { id: allocationId, hostId: host.id },
    });

    if (!alloc) {
      throw new AppError('ALLOCATION_NOT_FOUND', 'Allocation not found on this Host.', 404);
    }

    await prisma.nodeAllocation.update({
      where: { id: alloc.id },
      data: {
        hostId: null,
        isPrimary: false,
        status: 'AVAILABLE',
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Released Network Allocation',
      metadata: {
        ipAddress: alloc.ipAddress,
        port: alloc.port,
      },
      request,
    });

    return {
      success: true,
      data: { released: true },
    };
  });

  // ============================================================================
  // 14. METRICS (/api/hosts/:id/metrics) — Never returns fake numbers
  // ============================================================================
  app.get('/api/hosts/:id/metrics', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'metrics.read');

    const agent = runtimeRegistry.getAgentOrNull(host.nodeId);
    if (!agent) {
      return {
        success: true,
        data: {
          available: false,
          message: 'No metrics available',
          limits: {
            memoryLimitMb: host.memoryLimitMb,
            cpuLimitPercent: host.cpuLimitPercent,
            diskLimitMb: host.diskLimitMb,
          },
          metrics: null,
        },
      };
    }

    const metrics = await agent.metricsCollector.collectHostMetrics(host.id);
    return {
      success: true,
      data: {
        available: true,
        message: 'Live telemetry active',
        limits: {
          memoryLimitMb: host.memoryLimitMb,
          cpuLimitPercent: host.cpuLimitPercent,
          diskLimitMb: host.diskLimitMb,
        },
        metrics,
      },
    };
  });

  // ============================================================================
  // 15. MANAGEMENT (/api/hosts/:id/management) — Real Node Dispatch Only
  // ============================================================================
  app.post('/api/hosts/:id/management', async (request) => {
    const { id } = request.params as { id: string };
    const body = PowerManagementSchema.parse(request.body);

    const permissionMap: Record<typeof body.action, HostPermissionScope> = {
      start: 'management.start',
      stop: 'management.stop',
      kill: 'management.stop',
      restart: 'management.restart',
      reinstall: 'management.restart',
    };

    const { auth, host } = await requireHostPermission(
      request,
      id,
      permissionMap[body.action]
    );

    // Strictly require a live connected Runtime Node; throws 503 RUNTIME_NODE_UNAVAILABLE if offline
    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);
    const prisma = getPrismaOrThrow();

    const [environments, allocations] = await Promise.all([
      prisma.hostEnvironment.findMany({ where: { hostId: host.id } }),
      prisma.nodeAllocation.findMany({ where: { hostId: host.id } }),
    ]);

    const decryptedEnv: Record<string, string> = {};
    for (const env of environments) {
      try {
        decryptedEnv[env.key] = decryptSecret(env.encryptedValue);
      } catch {
        // Skip unreadable secret
      }
    }

    const spec = {
      hostId: host.id,
      runtime: host.runtime,
      runtimeVersion: host.runtimeVersion,
      dockerImage: host.dockerImage,
      startupCommand: host.startupCommand,
      startupArgs: host.startupArgs,
      workingDirectory: host.workingDirectory,
      environment: decryptedEnv,
      resources: {
        memoryLimitMb: host.memoryLimitMb,
        cpuLimitPercent: host.cpuLimitPercent,
        diskLimitMb: host.diskLimitMb,
      },
      allocations: allocations.map((a) => ({
        ipAddress: a.ipAddress,
        port: a.port,
        protocol: a.protocol,
        isPrimary: a.isPrimary,
      })),
    };

    if (body.action === 'start') {
      await agent.processManager.start(host.id, spec);
      await prisma.host.update({ where: { id: host.id }, data: { status: 'STARTING' } });
    } else if (body.action === 'stop') {
      await agent.processManager.stop(host.id);
      await prisma.host.update({ where: { id: host.id }, data: { status: 'STOPPING' } });
    } else if (body.action === 'restart') {
      await agent.processManager.restart(host.id, spec);
      await prisma.host.update({ where: { id: host.id }, data: { status: 'STARTING' } });
    } else if (body.action === 'kill') {
      await agent.processManager.kill(host.id);
      await prisma.host.update({ where: { id: host.id }, data: { status: 'OFFLINE' } });
    } else if (body.action === 'reinstall') {
      await agent.containerManager.reinstallContainer(spec);
      await prisma.host.update({ where: { id: host.id }, data: { status: 'INSTALLING' } });
    }

    const actionLabels: Record<typeof body.action, string> = {
      start: 'Started Host',
      stop: 'Stopped Host',
      restart: 'Restarted Host',
      kill: 'Killed Host Process',
      reinstall: 'Triggered Host Reinstall',
    };

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: actionLabels[body.action],
      metadata: { action: body.action, nodeId: host.nodeId },
      request,
    });

    return {
      success: true,
      data: {
        dispatched: true,
        action: body.action,
      },
    };
  });

  // ============================================================================
  // 16. DATABASES (/api/hosts/:id/databases)
  // ============================================================================
  app.get('/api/hosts/:id/databases', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'databases.read');
    const prisma = getPrismaOrThrow();

    const databases = await prisma.database.findMany({
      where: { hostId: host.id },
      include: {
        users: {
          select: {
            id: true,
            username: true,
            remoteHost: true,
            privileges: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: {
        databases: databases.map((db) => ({
          id: db.id,
          publicId: formatEntityPublicId('db', db.id),
          name: db.name,
          engine: db.engine,
          hostAddress: db.hostAddress,
          port: db.port,
          maxConnections: db.maxConnections,
          status: db.status,
          users: db.users,
          createdAt: db.createdAt.toISOString(),
        })),
      },
    };
  });

  app.post('/api/hosts/:id/databases', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'databases.write');
    const body = CreateDatabaseSchema.parse(request.body);

    // Provisioning a real database requires a connected Runtime Node DatabaseProvisioner
    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);
    const prisma = getPrismaOrThrow();

    const dbName = `hh_${host.id.slice(-6)}_${body.name}`;
    const dbUsername = `u_${host.id.slice(-6)}_${generateSecureToken(3)}`;
    const dbPasswordPlain = generateSecureToken(16);

    const provisioned = await agent.databaseProvisioner.provisionDatabase({
      hostId: host.id,
      engine: body.engine,
      databaseName: dbName,
      username: dbUsername,
      passwordPlain: dbPasswordPlain,
      remoteHost: body.remoteHost,
    });

    const createdDb = await prisma.database.create({
      data: {
        hostId: host.id,
        nodeId: host.nodeId,
        engine: body.engine,
        name: dbName,
        hostAddress: provisioned.hostAddress,
        port: provisioned.port,
        status: 'READY',
        users: {
          create: {
            username: dbUsername,
            passwordEncrypted: encryptSecret(dbPasswordPlain),
            remoteHost: body.remoteHost,
            privileges: ['ALL'],
          },
        },
      },
      include: {
        users: {
          select: {
            id: true,
            username: true,
            remoteHost: true,
            privileges: true,
            createdAt: true,
          },
        },
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Provisioned Host Database',
      metadata: {
        databaseId: formatEntityPublicId('db', createdDb.id),
        name: createdDb.name,
        engine: createdDb.engine,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        database: {
          ...createdDb,
          publicId: formatEntityPublicId('db', createdDb.id),
        },
      },
    };
  });

  app.delete('/api/hosts/:id/databases/:dbId', async (request) => {
    const { id, dbId } = request.params as { id: string; dbId: string };
    const { auth, host } = await requireHostPermission(request, id, 'databases.write');
    const prisma = getPrismaOrThrow();

    const dbRecord = await prisma.database.findFirst({
      where: { id: dbId, hostId: host.id },
      include: { users: true },
    });

    if (!dbRecord) {
      throw new AppError('DATABASE_RECORD_NOT_FOUND', 'Database record not found.', 404);
    }

    const agent = runtimeRegistry.getAgentOrNull(host.nodeId);
    if (agent && dbRecord.users[0]) {
      await agent.databaseProvisioner.deprovisionDatabase({
        engine: dbRecord.engine,
        databaseName: dbRecord.name,
        username: dbRecord.users[0].username,
      });
    }

    await prisma.database.delete({ where: { id: dbRecord.id } });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Deleted Host Database',
      metadata: { name: dbRecord.name, engine: dbRecord.engine },
      request,
    });

    return {
      success: true,
      data: { deleted: true },
    };
  });

  // ============================================================================
  // 17. SCHEDULES (/api/hosts/:id/schedules)
  // ============================================================================
  app.get('/api/hosts/:id/schedules', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'schedules.read');
    const prisma = getPrismaOrThrow();

    const schedules = await prisma.schedule.findMany({
      where: { hostId: host.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: {
        schedules: schedules.map((s) => ({
          ...s,
          publicId: formatEntityPublicId('sch', s.id),
        })),
      },
    };
  });

  app.post('/api/hosts/:id/schedules', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'schedules.write');
    const body = CreateScheduleSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    const schedule = await prisma.schedule.create({
      data: {
        hostId: host.id,
        name: body.name,
        cronExpression: body.cronExpression,
        taskType: body.taskType,
        payload: body.payload ?? null,
        isActive: body.isActive,
        onlyWhenOnline: body.onlyWhenOnline,
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Created Cron Schedule',
      metadata: {
        scheduleId: schedule.id,
        name: schedule.name,
        cronExpression: schedule.cronExpression,
        taskType: schedule.taskType,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: { schedule },
    };
  });

  app.delete('/api/hosts/:id/schedules/:scheduleId', async (request) => {
    const { id, scheduleId } = request.params as { id: string; scheduleId: string };
    const { auth, host } = await requireHostPermission(request, id, 'schedules.write');
    const prisma = getPrismaOrThrow();

    const existing = await prisma.schedule.findFirst({
      where: { id: scheduleId, hostId: host.id },
    });

    if (!existing) {
      throw new AppError('SCHEDULE_NOT_FOUND', 'Schedule not found on this Host.', 404);
    }

    await prisma.schedule.delete({ where: { id: existing.id } });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Deleted Cron Schedule',
      metadata: { name: existing.name },
      request,
    });

    return {
      success: true,
      data: { deleted: true },
    };
  });

  // ============================================================================
  // 18. BACKUPS (/api/hosts/:id/backups)
  // ============================================================================
  app.get('/api/hosts/:id/backups', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'backups.read');
    const prisma = getPrismaOrThrow();

    const backups = await prisma.backup.findMany({
      where: { hostId: host.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: {
        backups: backups.map((b) => ({
          id: b.id,
          publicId: formatEntityPublicId('bkp', b.id),
          name: b.name,
          status: b.status,
          sizeBytes: Number(b.sizeBytes),
          storageProvider: b.storageProvider,
          checksumSha256: b.checksumSha256,
          isLocked: b.isLocked,
          completedAt: b.completedAt ? b.completedAt.toISOString() : null,
          createdAt: b.createdAt.toISOString(),
        })),
      },
    };
  });

  app.post('/api/hosts/:id/backups', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'backups.write');
    const body = CreateBackupSchema.parse(request.body);

    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);
    const prisma = getPrismaOrThrow();

    const pendingBackup = await prisma.backup.create({
      data: {
        hostId: host.id,
        name: body.name,
        status: 'IN_PROGRESS',
        storageProvider: 's3',
        isLocked: body.isLocked,
      },
    });

    const snapshot = await agent.backupStorage.createArchiveSnapshot({
      hostId: host.id,
      backupId: pendingBackup.id,
    });

    const completed = await prisma.backup.update({
      where: { id: pendingBackup.id },
      data: {
        status: 'COMPLETED',
        storageKey: snapshot.storageKey,
        sizeBytes: snapshot.sizeBytes,
        checksumSha256: snapshot.checksumSha256,
        completedAt: new Date(),
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Created Backup',
      metadata: {
        backupId: completed.id,
        name: completed.name,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        backup: {
          ...completed,
          sizeBytes: Number(completed.sizeBytes),
        },
      },
    };
  });

  app.post('/api/hosts/:id/backups/:backupId/restore', async (request) => {
    const { id, backupId } = request.params as { id: string; backupId: string };
    const { auth, host } = await requireHostPermission(request, id, 'backups.write');
    const agent = runtimeRegistry.requireConnectedAgent(host.nodeId);
    const prisma = getPrismaOrThrow();

    const backup = await prisma.backup.findFirst({
      where: { id: backupId, hostId: host.id },
    });

    if (!backup || !backup.storageKey) {
      throw new AppError('BACKUP_NOT_FOUND', 'Backup snapshot not found.', 404);
    }

    await agent.backupStorage.restoreArchiveSnapshot({
      hostId: host.id,
      backupId: backup.id,
      storageKey: backup.storageKey,
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Restored Backup',
      metadata: { backupId: backup.id, name: backup.name },
      request,
    });

    return {
      success: true,
      data: { restored: true },
    };
  });

  app.delete('/api/hosts/:id/backups/:backupId', async (request) => {
    const { id, backupId } = request.params as { id: string; backupId: string };
    const { auth, host } = await requireHostPermission(request, id, 'backups.write');
    const prisma = getPrismaOrThrow();

    const backup = await prisma.backup.findFirst({
      where: { id: backupId, hostId: host.id },
    });

    if (!backup) {
      throw new AppError('BACKUP_NOT_FOUND', 'Backup not found.', 404);
    }

    if (backup.isLocked) {
      throw new AppError('BACKUP_LOCKED', 'This backup is locked and cannot be deleted.', 400);
    }

    const agent = runtimeRegistry.getAgentOrNull(host.nodeId);
    if (agent && backup.storageKey) {
      await agent.backupStorage.deleteArchiveSnapshot(backup.storageKey);
    }

    await prisma.backup.delete({ where: { id: backup.id } });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Deleted Backup',
      metadata: { name: backup.name },
      request,
    });

    return {
      success: true,
      data: { deleted: true },
    };
  });

  // ============================================================================
  // 19. USERS & PERMISSIONS (/api/hosts/:id/users)
  // ============================================================================
  app.get('/api/hosts/:id/users', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'settings.read');
    const prisma = getPrismaOrThrow();

    const [owner, collaborators] = await Promise.all([
      prisma.user.findUnique({
        where: { id: host.ownerId },
        select: {
          id: true,
          discordId: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      }),
      prisma.hostPermission.findMany({
        where: { hostId: host.id },
        include: {
          user: {
            select: {
              id: true,
              discordId: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      success: true,
      data: {
        owner,
        availablePermissions: HOST_PERMISSIONS,
        collaborators: collaborators.map((c) => ({
          id: c.id,
          userId: c.userId,
          user: c.user,
          permissions: c.permissions,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      },
    };
  });

  app.post('/api/hosts/:id/users', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { auth, host, isOwner } = await requireHostPermission(request, id, 'settings.write');

    if (!isOwner) {
      throw new AppError(
        'OWNER_REQUIRED',
        'Only the Host owner can manage collaborator permissions.',
        403
      );
    }

    const body = UpsertCollaboratorSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    const targetUser = await prisma.user.findUnique({
      where: { discordId: body.discordId },
    });

    if (!targetUser) {
      throw new AppError(
        'COLLABORATOR_USER_NOT_FOUND',
        `No registered HyperHost user found with Discord ID ${body.discordId}. The user must sign in via Discord OAuth2 at least once.`,
        404
      );
    }

    if (targetUser.id === host.ownerId) {
      throw new AppError(
        'CANNOT_ADD_OWNER_AS_COLLABORATOR',
        'The Host owner already possesses all permissions.',
        400
      );
    }

    const permissionRecord = await prisma.hostPermission.upsert({
      where: {
        hostId_userId: {
          hostId: host.id,
          userId: targetUser.id,
        },
      },
      update: {
        permissions: body.permissions,
      },
      create: {
        hostId: host.id,
        userId: targetUser.id,
        permissions: body.permissions,
      },
      include: {
        user: {
          select: {
            id: true,
            discordId: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Added User',
      metadata: {
        collaboratorDiscordId: targetUser.discordId,
        collaboratorUsername: targetUser.username,
        permissionsCount: body.permissions.length,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: { collaborator: permissionRecord },
    };
  });

  app.delete('/api/hosts/:id/users/:permissionId', async (request) => {
    const { id, permissionId } = request.params as { id: string; permissionId: string };
    const { auth, host, isOwner } = await requireHostPermission(request, id, 'settings.write');

    if (!isOwner) {
      throw new AppError(
        'OWNER_REQUIRED',
        'Only the Host owner can revoke collaborator access.',
        403
      );
    }

    const prisma = getPrismaOrThrow();
    const record = await prisma.hostPermission.findFirst({
      where: { id: permissionId, hostId: host.id },
      include: { user: true },
    });

    if (!record) {
      throw new AppError('PERMISSION_RECORD_NOT_FOUND', 'Collaborator record not found.', 404);
    }

    await prisma.hostPermission.delete({ where: { id: record.id } });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Removed Collaborator',
      metadata: {
        collaboratorDiscordId: record.user.discordId,
        collaboratorUsername: record.user.username,
      },
      request,
    });

    return {
      success: true,
      data: { removed: true },
    };
  });

  // ============================================================================
  // SETTINGS (/api/hosts/:id/settings)
  // ============================================================================
  app.get('/api/hosts/:id/settings', async (request) => {
    const { id } = request.params as { id: string };
    const { host, isOwner } = await requireHostPermission(request, id, 'settings.read');

    return {
      success: true,
      data: {
        id: host.id,
        publicId: formatEntityPublicId('srv', host.id, host.publicId),
        name: host.name,
        description: host.description,
        type: host.type,
        runtime: host.runtime,
        runtimeVersion: host.runtimeVersion,
        memoryLimitMb: host.memoryLimitMb,
        cpuLimitPercent: host.cpuLimitPercent,
        diskLimitMb: host.diskLimitMb,
        isOwner,
      },
    };
  });

  app.patch('/api/hosts/:id/settings', async (request) => {
    const { id } = request.params as { id: string };
    const { auth, host } = await requireHostPermission(request, id, 'settings.write');
    const body = UpdateHostSettingsSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    const updated = await prisma.host.update({
      where: { id: host.id },
      data: {
        name: body.name,
        description: body.description ?? null,
      },
    });

    await recordActivityLog({
      userId: auth.user.id,
      hostId: host.id,
      action: 'Changed Settings',
      metadata: {
        name: updated.name,
      },
      request,
    });

    return {
      success: true,
      data: {
        host: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
    };
  });

  // ============================================================================
  // 20. ACTIVITY LOG (/api/hosts/:id/activity)
  // ============================================================================
  app.get('/api/hosts/:id/activity', async (request) => {
    const { id } = request.params as { id: string };
    const { host } = await requireHostPermission(request, id, 'activity.read');
    const prisma = getPrismaOrThrow();

    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { hostId: host.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              publicId: true,
              discordId: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      }),
      prisma.activityLog.count({ where: { hostId: host.id } }),
    ]);

    return {
      success: true,
      data: {
        items: logs.map((l) => ({
          id: l.id,
          publicId: formatEntityPublicId('act', l.id),
          userId: l.user
            ? formatEntityPublicId('usr', l.user.id, l.user.publicId)
            : null,
          hostId: formatEntityPublicId('srv', host.id, host.publicId),
          action: l.action,
          metadata: l.metadata,
          ipAddress: l.ipAddress,
          userAgent: l.userAgent,
          actor: l.user
            ? {
                id: l.user.id,
                publicId: formatEntityPublicId('usr', l.user.id, l.user.publicId),
                username: l.user.username,
                displayName: l.user.displayName,
                avatar: l.user.avatar,
              }
            : null,
          createdAt: l.createdAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    };
  });
}
