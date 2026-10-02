import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { getPrismaOrThrow } from '../database';
import { hashToken } from '../crypto';
import { AppError } from '../errors';
import { logger } from '../logger';
import { runtimeRegistry } from '../../runtime/registry';
import { runtimeProvisionerService } from '../../runtime/provisioner';
import { WebSocketNodeAgent } from '../../runtime/ws-node-bridge';
import type { HostStatusCode, NodeStatusCode } from '../../shared/types';

function safeTimingEqualHashes(hashA: string, hashB: string): boolean {
  try {
    const bufA = Buffer.from(hashA, 'utf8');
    const bufB = Buffer.from(hashB, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function verifyEnrollmentSecretConstantTime(rawToken: string): boolean {
  if (!rawToken || !config.runtimeNodeSecret) {
    return false;
  }
  const actualHash = hashToken(rawToken);
  const serverSecretHash = hashToken(config.runtimeNodeSecret);
  return safeTimingEqualHashes(actualHash, serverSecretHash);
}

function verifyNodeTokenConstantTime(
  rawToken: string,
  expectedHash: string,
  nodeName?: string
): boolean {
  if (!rawToken) return false;
  const actualHash = hashToken(rawToken);
  if (safeTimingEqualHashes(actualHash, expectedHash)) {
    return true;
  }

  if (nodeName) {
    const scopedHash = hashToken(`${nodeName}:${rawToken}`);
    if (safeTimingEqualHashes(scopedHash, expectedHash)) {
      return true;
    }
  }

  return verifyEnrollmentSecretConstantTime(rawToken);
}

async function authenticateOrEnrollRuntimeNode(params: {
  rawNodeId: string;
  rawToken: string;
  request: FastifyRequest;
}) {
  const { rawNodeId, rawToken, request } = params;
  const normalizedNodeId = rawNodeId.startsWith('nod_')
    ? rawNodeId.slice(4)
    : rawNodeId;

  const prisma = getPrismaOrThrow();
  const existingNode = await prisma.node.findFirst({
    where: {
      OR: [{ id: normalizedNodeId }, { id: rawNodeId }, { name: rawNodeId }],
    },
  });

  if (existingNode) {
    if (
      !verifyNodeTokenConstantTime(
        rawToken,
        existingNode.agentTokenHash,
        existingNode.name
      )
    ) {
      return null;
    }
    return existingNode;
  }

  // If Node record does not exist yet in PostgreSQL, allow automatic enrollment
  // ONLY when NODE_TOKEN matches RUNTIME_NODE_SECRET / NODE_ENROLLMENT_SECRET
  if (!verifyEnrollmentSecretConstantTime(rawToken)) {
    return null;
  }

  const safeNodeName = rawNodeId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
  if (safeNodeName.length < 2) {
    return null;
  }

  const headerFqdn = (
    request.headers['x-hyperhost-node-fqdn'] as string | undefined
  )?.trim();
  const headerLocation = (
    request.headers['x-hyperhost-node-location'] as string | undefined
  )?.trim();
  const headerIp = (
    request.headers['x-hyperhost-node-ip'] as string | undefined
  )?.trim();

  const directHash = hashToken(rawToken);
  const collision = await prisma.node.findUnique({
    where: { agentTokenHash: directHash },
    select: { id: true },
  });
  const agentTokenHash = collision
    ? hashToken(`${safeNodeName}:${rawToken}`)
    : directHash;

  const enrolledNode = await prisma.node.create({
    data: {
      name: safeNodeName,
      location: headerLocation || 'External Runtime Node',
      fqdn: headerFqdn || `${safeNodeName}.runtime.hyperhost`,
      ipAddress: headerIp || request.ip || '0.0.0.0',
      daemonPort: 8080,
      status: 'OFFLINE',
      isOnline: false,
      agentTokenHash,
      maxMemoryMb: 8192,
      maxDiskMb: 102400,
      maxCpuPercent: 800,
    },
  });

  logger.info('Auto-enrolled authenticated Runtime Node in Control Plane', {
    nodeId: enrolledNode.id,
    name: enrolledNode.name,
    fqdn: enrolledNode.fqdn,
    location: enrolledNode.location,
  });

  return enrolledNode;
}

export async function registerRuntimeNodeRoutes(
  app: FastifyInstance
): Promise<void> {
  // HTTP Heartbeat & Status Endpoint for Runtime Node Daemons
  app.post('/api/runtime/nodes/heartbeat', async (request) => {
    const authHeader = request.headers.authorization;
    const nodeIdHeader =
      (request.headers['x-hyperhost-node-id'] as string | undefined)?.trim() ||
      '';

    if (!authHeader?.startsWith('Bearer ') || !nodeIdHeader) {
      throw new AppError(
        'NODE_AUTH_REQUIRED',
        'Missing Runtime Node credentials (x-hyperhost-node-id and Bearer token required).',
        401
      );
    }

    const rawToken = authHeader.slice('Bearer '.length).trim();
    const prisma = getPrismaOrThrow();
    const node = await authenticateOrEnrollRuntimeNode({
      rawNodeId: nodeIdHeader,
      rawToken,
      request,
    });

    if (!node) {
      throw new AppError(
        'NODE_AUTH_INVALID',
        'Invalid Runtime Node ID or authentication token.',
        401
      );
    }

    const body =
      (request.body as {
        status?: NodeStatusCode;
        resources?: Record<string, number>;
      }) || {};

    const nextStatus: NodeStatusCode =
      body.status === 'DEGRADED' || body.status === 'DRAINING'
        ? body.status
        : 'ONLINE';

    const now = new Date();
    await prisma.node.update({
      where: { id: node.id },
      data: {
        isOnline: true,
        status: nextStatus,
        lastHeartbeatAt: now,
      },
    });

    const connectedAgent = runtimeRegistry.getAgentOrNull(node.id);
    if (connectedAgent) {
      connectedAgent.recordHeartbeat(body.resources, nextStatus);
    }

    return {
      success: true,
      data: {
        nodeId: node.id,
        status: nextStatus,
        heartbeatAt: now.toISOString(),
      },
    };
  });

  // Persistent Bidirectional WebSocket Channel for Runtime Node Daemons
  app.get(
    '/api/runtime/nodes/ws',
    { websocket: true },
    async (socket, request) => {
      // Attach listeners synchronously BEFORE any async DB calls so early "hello" frames are never lost
      const earlyMessages: string[] = [];
      let messageHandler: ((text: string) => Promise<void>) | null = null;
      let isClosed = false;
      let closeHandler: (() => Promise<void>) | null = null;

      socket.on('message', (rawBuffer) => {
        const text = rawBuffer.toString();
        if (messageHandler) {
          void messageHandler(text);
        } else if (earlyMessages.length < 32) {
          earlyMessages.push(text);
        }
      });

      socket.on('close', () => {
        isClosed = true;
        if (closeHandler) {
          void closeHandler();
        }
      });

      const query =
        (request.query as {
          nodeId?: string;
          token?: string;
        }) || {};

      const authHeader = request.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;

      const rawNodeId = (
        (request.headers['x-hyperhost-node-id'] as string | undefined) ||
        query.nodeId ||
        ''
      ).trim();
      const rawToken = (bearerToken || query.token || '').trim();

      if (!rawNodeId || !rawToken) {
        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'NODE_AUTH_REQUIRED',
            message: 'Missing nodeId or authentication token.',
          })
        );
        socket.close(4001, 'NODE_AUTH_REQUIRED');
        return;
      }

      try {
        const prisma = getPrismaOrThrow();
        const node = await authenticateOrEnrollRuntimeNode({
          rawNodeId,
          rawToken,
          request,
        });

        if (!node) {
          logger.warn('Rejected unauthorized Runtime Node WebSocket connection', {
            nodeId: rawNodeId,
          });
          socket.send(
            JSON.stringify({
              type: 'error',
              code: 'NODE_AUTH_INVALID',
              message: 'Invalid Runtime Node credentials.',
            })
          );
          socket.close(4003, 'NODE_AUTH_INVALID');
          return;
        }

        if (isClosed) {
          return;
        }

        const agent = new WebSocketNodeAgent(
          node.id,
          node.fqdn,
          socket,
          async (hostId: string, status: HostStatusCode) => {
            try {
              await prisma.host.update({
                where: { id: hostId },
                data: { status },
              });
            } catch {
              // Ignore if host was deleted
            }
          }
        );

        runtimeRegistry.registerAgent(agent);

        closeHandler = async () => {
          agent.disconnect();
          const wasActive = runtimeRegistry.unregisterAgent(node.id, agent);
          if (!wasActive) {
            return;
          }
          try {
            await prisma.node.update({
              where: { id: node.id },
              data: {
                isOnline: false,
                status: 'OFFLINE',
                serverStatus: 'OFFLINE',
              },
            });
            // Transition active hosts on this disconnected node to OFFLINE
            await prisma.host.updateMany({
              where: {
                nodeId: node.id,
                status: {
                  in: ['RUNNING', 'ONLINE', 'STARTING', 'STOPPING', 'NODE_ONLINE'],
                },
              },
              data: {
                status: 'OFFLINE',
                serverStatus: 'OFFLINE',
              },
            });
          } catch {
            // Ignore DB error during shutdown
          }
          logger.info('Runtime Node disconnected from Control Plane', {
            nodeId: node.id,
            name: node.name,
          });
        };

        messageHandler = async (text: string) => {
          try {
            const parsed = JSON.parse(text) as {
              type?: string;
              version?: string;
              supportedRuntimes?: string[];
              osPlatform?: string;
              architecture?: string;
              resources?: Record<string, number>;
              status?: NodeStatusCode;
              runningHostIds?: string[];
            };

            if (parsed.type === 'hello') {
              agent.completeHandshake(
                {
                  version: parsed.version || '1.0.0',
                  supportedRuntimes: (parsed.supportedRuntimes as any) || [
                    'NODEJS',
                    'PYTHON',
                    'JAVA',
                    'GO',
                    'RUST',
                  ],
                  osPlatform: parsed.osPlatform,
                  architecture: parsed.architecture,
                },
                parsed.resources
              );

              const updateNodeData: Record<string, unknown> = {
                isOnline: true,
                status: 'ONLINE',
                serverStatus: 'ONLINE',
                lastHeartbeatAt: new Date(),
                bootstrapTokenEncrypted: null,
              };
              if (
                typeof parsed.resources?.memoryTotalMb === 'number' &&
                parsed.resources.memoryTotalMb >= 512
              ) {
                updateNodeData.maxMemoryMb = Math.round(
                  parsed.resources.memoryTotalMb
                );
              }
              if (
                typeof parsed.resources?.diskTotalMb === 'number' &&
                parsed.resources.diskTotalMb >= 1024
              ) {
                updateNodeData.maxDiskMb = Math.round(parsed.resources.diskTotalMb);
              }

              await prisma.node.update({
                where: { id: node.id },
                data: updateNodeData,
              });

              // Locate the 1-to-1 dedicated Host bound to this Node
              const dedicatedHost = await prisma.host.findFirst({
                where: {
                  OR: [
                    ...(node.dedicatedHostId ? [{ id: node.dedicatedHostId }] : []),
                    { nodeId: node.id },
                  ],
                },
              });

              if (dedicatedHost) {
                if (dedicatedHost.nodeId !== node.id) {
                  await prisma.host.update({
                    where: { id: dedicatedHost.id },
                    data: { nodeId: node.id },
                  });
                }

                if (
                  ['PENDING', 'PROVISIONING', 'BOOTSTRAPPING', 'NODE_CONNECTING'].includes(
                    dedicatedHost.status
                  )
                ) {
                  // Trigger NODE_ONLINE -> STARTING -> RUNNING for newly provisioned Host
                  void runtimeProvisionerService.startHostOnConnectedDedicatedNode(
                    dedicatedHost.id,
                    node.id
                  );
                } else {
                  const runningIds = Array.isArray(parsed.runningHostIds)
                    ? parsed.runningHostIds.map(String)
                    : [];
                  const isHostRunning = runningIds.includes(dedicatedHost.id);
                  await prisma.host.update({
                    where: { id: dedicatedHost.id },
                    data: {
                      status: isHostRunning ? 'RUNNING' : 'STOPPED',
                      provisioningStatus: 'READY',
                      serverStatus: 'ONLINE',
                      nodeConnectedAt: dedicatedHost.nodeConnectedAt || new Date(),
                    },
                  });
                }
              }

              logger.info('Runtime Node completed handshake and is ONLINE', {
                nodeId: node.id,
                name: node.name,
                fqdn: node.fqdn,
              });

              if (socket.readyState === 1) {
                socket.send(
                  JSON.stringify({
                    type: 'handshake_ack',
                    nodeId: node.id,
                    status: 'ONLINE',
                    timestamp: new Date().toISOString(),
                  })
                );
              }
              return;
            }

            if (parsed.type === 'heartbeat') {
              const nextStatus: NodeStatusCode =
                parsed.status === 'DEGRADED' || parsed.status === 'DRAINING'
                  ? parsed.status
                  : 'ONLINE';

              if (!agent.handshakeCompleted) {
                agent.completeHandshake(
                  {
                    version: parsed.version || '1.0.0',
                    supportedRuntimes: (parsed.supportedRuntimes as any) || [
                      'NODEJS',
                      'PYTHON',
                      'JAVA',
                      'GO',
                      'RUST',
                    ],
                  },
                  parsed.resources
                );
              } else {
                agent.recordHeartbeat(parsed.resources, nextStatus);
              }

              await prisma.node.update({
                where: { id: node.id },
                data: {
                  isOnline: true,
                  status: nextStatus,
                  lastHeartbeatAt: new Date(),
                },
              });

              if (socket.readyState === 1) {
                socket.send(
                  JSON.stringify({
                    type: 'heartbeat_ack',
                    timestamp: new Date().toISOString(),
                  })
                );
              }
              return;
            }

            agent.handleIncomingFrame(text);
          } catch {
            // Ignore malformed message
          }
        };

        if (socket.readyState === 1) {
          socket.send(
            JSON.stringify({
              type: 'welcome',
              nodeId: node.id,
              message:
                'Authenticated with HyperHost Control Plane. Send capability handshake (type="hello") to activate node.',
              timestamp: new Date().toISOString(),
            })
          );
        }

        // Drain any early frames ("hello") that arrived while DB auth was in flight
        while (earlyMessages.length > 0) {
          const msgText = earlyMessages.shift();
          if (msgText) {
            await messageHandler(msgText);
          }
        }
      } catch (err) {
        logger.error('Runtime Node WebSocket error', {
          error: err instanceof Error ? err.message : String(err),
        });
        socket.close(1011, 'INTERNAL_ERROR');
      }
    }
  );
}
