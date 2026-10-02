import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { getPrismaOrThrow } from '../database';
import { hashToken } from '../crypto';
import { AppError } from '../errors';
import { logger } from '../logger';
import { runtimeRegistry } from '../../runtime/registry';
import { WebSocketNodeAgent } from '../../runtime/ws-node-bridge';
import type { HostStatusCode, NodeStatusCode } from '../../shared/types';

function verifyNodeTokenConstantTime(
  rawToken: string,
  expectedHash: string
): boolean {
  const actualHash = hashToken(rawToken);
  try {
    if (
      crypto.timingSafeEqual(
        Buffer.from(actualHash, 'utf8'),
        Buffer.from(expectedHash, 'utf8')
      )
    ) {
      return true;
    }
  } catch {
    // Fall through to check server-level RUNTIME_NODE_SECRET if configured
  }

  if (config.runtimeNodeSecret) {
    const serverSecretHash = hashToken(config.runtimeNodeSecret);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(actualHash, 'utf8'),
        Buffer.from(serverSecretHash, 'utf8')
      );
    } catch {
      return false;
    }
  }

  return false;
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
    const normalizedNodeId = nodeIdHeader.startsWith('nod_')
      ? nodeIdHeader.slice(4)
      : nodeIdHeader;

    const prisma = getPrismaOrThrow();
    const node = await prisma.node.findFirst({
      where: {
        OR: [{ id: normalizedNodeId }, { id: nodeIdHeader }, { name: nodeIdHeader }],
      },
    });

    if (!node || !verifyNodeTokenConstantTime(rawToken, node.agentTokenHash)) {
      throw new AppError(
        'NODE_AUTH_INVALID',
        'Invalid Runtime Node ID or authentication token.',
        401
      );
    }

    const body = (request.body as {
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
      const query = (request.query as {
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

      const normalizedNodeId = rawNodeId.startsWith('nod_')
        ? rawNodeId.slice(4)
        : rawNodeId;

      try {
        const prisma = getPrismaOrThrow();
        const node = await prisma.node.findFirst({
          where: {
            OR: [{ id: normalizedNodeId }, { id: rawNodeId }, { name: rawNodeId }],
          },
        });

        if (!node || !verifyNodeTokenConstantTime(rawToken, node.agentTokenHash)) {
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

        socket.send(
          JSON.stringify({
            type: 'welcome',
            nodeId: node.id,
            message:
              'Authenticated with HyperHost Control Plane. Send capability handshake (type="hello") to activate node.',
            timestamp: new Date().toISOString(),
          })
        );

        socket.on('message', async (rawBuffer) => {
          const text = rawBuffer.toString();
          try {
            const parsed = JSON.parse(text) as {
              type?: string;
              version?: string;
              supportedRuntimes?: string[];
              osPlatform?: string;
              architecture?: string;
              resources?: Record<string, number>;
              status?: NodeStatusCode;
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

              await prisma.node.update({
                where: { id: node.id },
                data: {
                  isOnline: true,
                  status: 'ONLINE',
                  lastHeartbeatAt: new Date(),
                },
              });

              // Assign any unassigned PENDING hosts if this node is ONLINE
              await prisma.host.updateMany({
                where: { nodeId: null, status: 'PENDING' },
                data: { nodeId: node.id },
              });

              logger.info('Runtime Node completed handshake and is ONLINE', {
                nodeId: node.id,
                name: node.name,
                fqdn: node.fqdn,
              });

              socket.send(
                JSON.stringify({
                  type: 'handshake_ack',
                  nodeId: node.id,
                  status: 'ONLINE',
                  timestamp: new Date().toISOString(),
                })
              );
              return;
            }

            if (parsed.type === 'heartbeat') {
              const nextStatus: NodeStatusCode =
                parsed.status === 'DEGRADED' || parsed.status === 'DRAINING'
                  ? parsed.status
                  : 'ONLINE';
              agent.recordHeartbeat(parsed.resources, nextStatus);

              await prisma.node.update({
                where: { id: node.id },
                data: {
                  isOnline: true,
                  status: nextStatus,
                  lastHeartbeatAt: new Date(),
                },
              });

              socket.send(
                JSON.stringify({
                  type: 'heartbeat_ack',
                  timestamp: new Date().toISOString(),
                })
              );
              return;
            }

            agent.handleIncomingFrame(text);
          } catch {
            // Ignore malformed message
          }
        });

        socket.on('close', async () => {
          agent.disconnect();
          runtimeRegistry.unregisterAgent(node.id);
          try {
            await prisma.node.update({
              where: { id: node.id },
              data: {
                isOnline: false,
                status: 'OFFLINE',
              },
            });
          } catch {
            // Ignore DB error during shutdown
          }
          logger.info('Runtime Node disconnected from Control Plane', {
            nodeId: node.id,
            name: node.name,
          });
        });
      } catch (err) {
        logger.error('Runtime Node WebSocket error', {
          error: err instanceof Error ? err.message : String(err),
        });
        socket.close(1011, 'INTERNAL_ERROR');
      }
    }
  );
}
