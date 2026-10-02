/**
 * HyperHost Automatic Per-Host Runtime Provisioner (Clever Cloud)
 * Powered by HyperSoft
 *
 * Orchestrates 1-to-1 dedicated Clever Cloud Application & Runtime Node provisioning per Host:
 *   Host -> Dedicated Clever Cloud Application -> Dedicated Runtime Node Agent -> Real Host Process
 *
 * Strictly enforces real provisioning only:
 *   - Uses CleverCloudRuntimeProvisioner (https://api-bridge.clever-cloud.com/)
 *   - Generates NODE_ID and NODE_TOKEN server-side only (stores only HMAC-SHA256 hash in PostgreSQL)
 *   - Never exposes Clever Cloud API credentials or NODE_TOKEN to Frontend or logs
 *   - Never transitions a Host to RUNNING before Node is ONLINE and real process is spawned
 */
import type { RuntimeProvisioner } from './interfaces';
import { CleverCloudRuntimeProvisioner } from './providers/clever-cloud';
import { runtimeRegistry } from './registry';
import { config } from '../server/config';
import { decryptSecret, generateSecureToken, hashToken } from '../server/crypto';
import { getPrismaOrThrow } from '../server/database';
import { AppError } from '../server/errors';
import { logger } from '../server/logger';
import { formatEntityPublicId } from '../shared/ids';

const NODE_CONNECTION_WAIT_TIMEOUT_MS = 60_000;
const NODE_CONNECTION_POLL_INTERVAL_MS = 1_000;

export function resolveControlPlaneWsUrl(): string {
  const base = (config.publicUrl || config.appUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const wsBase = base
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');
  return `${wsBase}/api/runtime/nodes/ws`;
}

export class NodeProvisionerService {
  private provisioner: RuntimeProvisioner;
  private readonly activeProvisioningHosts = new Set<string>();

  constructor(provisioner?: RuntimeProvisioner) {
    this.provisioner = provisioner || new CleverCloudRuntimeProvisioner();
  }

  public setProvisioner(provisioner: RuntimeProvisioner): void {
    this.provisioner = provisioner;
  }

  public getProvisioner(): RuntimeProvisioner {
    return this.provisioner;
  }

  public isProviderConfigured(): boolean {
    return this.provisioner.isConfigured();
  }

  /**
   * Provisions a dedicated Clever Cloud Application and dedicated Runtime Node for a single Host:
   *   PENDING -> PROVISIONING -> BOOTSTRAPPING -> NODE_CONNECTING -> NODE_ONLINE -> STARTING -> RUNNING
   *
   * Failure states:
   *   - Clever Cloud API application creation failure -> PROVISIONING_FAILED
   *   - Clever Cloud env / deployment / readiness failure -> BOOTSTRAP_FAILED
   *   - Waiting for Node WebSocket connection -> NODE_CONNECTING
   */
  public async provisionHostRuntime(hostId: string): Promise<void> {
    if (this.activeProvisioningHosts.has(hostId)) {
      return;
    }
    this.activeProvisioningHosts.add(hostId);

    const prisma = getPrismaOrThrow();
    let createdNodeId: string | null = null;
    let phase: 'PROVISIONING' | 'BOOTSTRAPPING' | 'NODE_CONNECTING' =
      'PROVISIONING';

    try {
      const host = await prisma.host.findUnique({
        where: { id: hostId },
      });
      if (!host) {
        return;
      }

      const hostPublicId = formatEntityPublicId('srv', host.id, host.publicId);
      const providerName = this.provisioner.providerName;

      // 1. Transition PENDING -> PROVISIONING
      await prisma.host.update({
        where: { id: host.id },
        data: {
          status: 'PROVISIONING',
          provisioningStatus: 'PROVISIONING',
          serverStatus: 'CREATING',
          provider: providerName,
          provisioningError: null,
        },
      });

      // 2. Generate per-Host NODE_ID and NODE_TOKEN server-side only (store hash only in PostgreSQL)
      const rawNodeToken = `hhnode_${generateSecureToken(32)}`;
      const agentTokenHash = hashToken(rawNodeToken);
      const dedicatedNodeName = `hyperhost-runtime-${hostPublicId.toLowerCase()}`;
      const locationLabel = `Clever Cloud (${config.cleverCloud.zone || 'par'})`;

      const existingDedicatedNode = await prisma.node.findUnique({
        where: { dedicatedHostId: host.id },
      });

      const dedicatedNode = existingDedicatedNode
        ? await prisma.node.update({
            where: { id: existingDedicatedNode.id },
            data: {
              name: dedicatedNodeName,
              location: locationLabel,
              status: 'OFFLINE',
              isOnline: false,
              agentTokenHash,
              bootstrapTokenEncrypted: null,
              provider: providerName,
              serverStatus: 'CREATING',
              maxMemoryMb: host.memoryLimitMb,
              maxDiskMb: host.diskLimitMb,
              maxCpuPercent: host.cpuLimitPercent,
            },
          })
        : await prisma.node.create({
            data: {
              name: dedicatedNodeName,
              location: locationLabel,
              fqdn: `${dedicatedNodeName}.cleverapps.io`,
              ipAddress: '0.0.0.0',
              daemonPort: 8080,
              status: 'OFFLINE',
              isOnline: false,
              agentTokenHash,
              bootstrapTokenEncrypted: null,
              dedicatedHostId: host.id,
              provider: providerName,
              serverStatus: 'CREATING',
              maxMemoryMb: host.memoryLimitMb,
              maxDiskMb: host.diskLimitMb,
              maxCpuPercent: host.cpuLimitPercent,
            },
          });

      createdNodeId = dedicatedNode.id;

      await prisma.host.update({
        where: { id: host.id },
        data: {
          nodeId: dedicatedNode.id,
        },
      });

      // 3. Create or reuse dedicated Clever Cloud Application (hyperhost-runtime-{hostPublicId})
      let createdServer: import('./interfaces').ProvisionedServer;

      if (host.provisionedServerId) {
        logger.info('Reusing existing dedicated Clever Cloud Application ID for Host', {
          hostId: host.id,
          cleverCloudAppId: host.provisionedServerId,
        });
        const cleanSlug = host.provisionedServerId.replace(/^app_/, 'app-');
        createdServer = {
          serverId: host.provisionedServerId,
          provider: host.provider || this.provisioner.providerName,
          ipAddress: '0.0.0.0',
          fqdn: `${cleanSlug}.cleverapps.io`,
          location: `Clever Cloud (${config.cleverCloud.zone || 'par'})`,
          status: 'CREATING',
        };
      } else {
        createdServer = await this.provisioner.createServer({
          hostId: host.id,
          hostPublicId,
          hostName: host.name,
          nodeId: dedicatedNode.id,
          runtime: host.runtime,
          runtimeVersion: host.runtimeVersion,
          memoryLimitMb: host.memoryLimitMb,
          cpuLimitPercent: host.cpuLimitPercent,
          diskLimitMb: host.diskLimitMb,
          bootstrapScript: 'npm run start:node-agent',
        });
      }

      const provisionedAt = new Date();

      // 4. Transition PROVISIONING -> BOOTSTRAPPING
      phase = 'BOOTSTRAPPING';
      await Promise.all([
        prisma.host.update({
          where: { id: host.id },
          data: {
            status: 'BOOTSTRAPPING',
            provisioningStatus: 'BOOTSTRAPPING',
            serverStatus: 'DEPLOYING',
            provisionedServerId: createdServer.serverId,
            provider: createdServer.provider,
            provisionedAt,
          },
        }),
        prisma.node.update({
          where: { id: dedicatedNode.id },
          data: {
            provisionedServerId: createdServer.serverId,
            provider: createdServer.provider,
            serverStatus: 'DEPLOYING',
            ipAddress: createdServer.ipAddress || '0.0.0.0',
            fqdn: createdServer.fqdn || dedicatedNode.fqdn,
            location: createdServer.location || dedicatedNode.location,
          },
        }),
      ]);

      // 5. Configure Clever Cloud Application env vars (CONTROL_PLANE_WS_URL, NODE_ID, NODE_TOKEN, HOST_ID)
      //    and deploy the Runtime Node Agent to the Clever Cloud Application
      const controlPlaneWsUrl = resolveControlPlaneWsUrl();
      await this.provisioner.bootstrapNode({
        server: createdServer,
        hostId: host.id,
        nodeId: dedicatedNode.id,
        controlPlaneWsUrl,
        nodeToken: rawNodeToken,
        bootstrapScript: 'npm run start:node-agent',
      });

      // 6. Wait for real Clever Cloud deployment & application readiness
      const readyServer = await this.provisioner.waitUntilReady(
        createdServer.serverId
      );

      const bootstrappedAt = new Date();

      // 7. Transition BOOTSTRAPPING -> NODE_CONNECTING
      phase = 'NODE_CONNECTING';
      await Promise.all([
        prisma.host.update({
          where: { id: host.id },
          data: {
            status: 'NODE_CONNECTING',
            provisioningStatus: 'NODE_CONNECTING',
            serverStatus: 'READY',
            bootstrappedAt,
          },
        }),
        prisma.node.update({
          where: { id: dedicatedNode.id },
          data: {
            serverStatus: 'READY',
            ipAddress: readyServer.ipAddress || createdServer.ipAddress,
            fqdn: readyServer.fqdn || createdServer.fqdn,
            location: readyServer.location || createdServer.location,
          },
        }),
      ]);

      // 8. Wait for the dedicated Node Agent to connect via WebSocket
      const connected = await this.waitForNodeWebSocketConnection(
        dedicatedNode.id,
        NODE_CONNECTION_WAIT_TIMEOUT_MS
      );

      if (connected) {
        await this.startHostOnConnectedDedicatedNode(host.id, dedicatedNode.id);
      }
      // If the Node has not connected yet within the initial wait window,
      // the Host remains in status = 'NODE_CONNECTING' (provisioningStatus = 'NODE_CONNECTING')
      // and automatically transitions to NODE_ONLINE -> STARTING -> RUNNING as soon as
      // the Node Agent completes its WebSocket handshake in runtime-nodes.ts.
    } catch (err) {
      const failureCode =
        phase === 'BOOTSTRAPPING' ? 'BOOTSTRAP_FAILED' : 'PROVISIONING_FAILED';
      const safeReason =
        err instanceof AppError
          ? err.message
          : failureCode === 'BOOTSTRAP_FAILED'
          ? 'Failed to deploy and start Runtime Node Agent on Clever Cloud Application.'
          : 'Failed to provision dedicated Clever Cloud Application.';

      logger.warn('Clever Cloud Per-Host Runtime Provisioning failed', {
        hostId,
        nodeId: createdNodeId,
        provider: this.provisioner.providerName,
        phase,
        failureCode,
        reason: safeReason,
      });

      await prisma.host
        .update({
          where: { id: hostId },
          data: {
            status: failureCode,
            provisioningStatus: failureCode,
            serverStatus: failureCode,
            provisioningError: safeReason,
          },
        })
        .catch(() => null);

      if (createdNodeId) {
        await prisma.node
          .update({
            where: { id: createdNodeId },
            data: {
              status: 'OFFLINE',
              isOnline: false,
              serverStatus: failureCode,
              bootstrapTokenEncrypted: null,
            },
          })
          .catch(() => null);
      }
    } finally {
      this.activeProvisioningHosts.delete(hostId);
    }
  }

  /**
   * Called when a dedicated per-Host Node completes its WebSocket handshake.
   * Transitions the Host through NODE_ONLINE -> STARTING -> RUNNING by spawning the real process.
   */
  public async startHostOnConnectedDedicatedNode(
    hostId: string,
    nodeId: string
  ): Promise<void> {
    const prisma = getPrismaOrThrow();
    const agent = runtimeRegistry.getAgentOrNull(nodeId);
    if (!agent) {
      return;
    }

    const host = await prisma.host.findUnique({
      where: { id: hostId },
      include: {
        environments: true,
        allocations: true,
      },
    });

    if (!host) {
      return;
    }

    const now = new Date();
    await Promise.all([
      prisma.host.update({
        where: { id: host.id },
        data: {
          status: 'NODE_ONLINE',
          provisioningStatus: 'NODE_ONLINE',
          serverStatus: 'ONLINE',
          nodeConnectedAt: now,
          provisioningError: null,
        },
      }),
      prisma.node.update({
        where: { id: nodeId },
        data: {
          status: 'ONLINE',
          isOnline: true,
          serverStatus: 'ONLINE',
          lastHeartbeatAt: now,
          bootstrapTokenEncrypted: null,
        },
      }),
    ]);

    const decryptedEnv: Record<string, string> = {};
    for (const env of host.environments) {
      try {
        decryptedEnv[env.key] = decryptSecret(env.encryptedValue);
      } catch {
        // Ignore unreadable secret
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
      allocations: host.allocations.map((a) => ({
        ipAddress: a.ipAddress,
        port: a.port,
        protocol: a.protocol,
        isPrimary: a.isPrimary,
      })),
    };

    try {
      await prisma.host.update({
        where: { id: host.id },
        data: {
          status: 'STARTING',
          provisioningStatus: 'STARTING',
        },
      });

      await agent.containerManager.createContainer(spec);
      await agent.processManager.start(host.id, spec);

      await prisma.host.update({
        where: { id: host.id },
        data: {
          status: 'RUNNING',
          provisioningStatus: 'READY',
          serverStatus: 'ONLINE',
        },
      });
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'Host process failed to start.';
      await prisma.host
        .update({
          where: { id: host.id },
          data: {
            status: 'ERROR',
            provisioningError: reason,
          },
        })
        .catch(() => null);
    }
  }

  /**
   * Executes the full 5-step teardown when a Host is deleted:
   *   1. Stop Host process on the Runtime Node
   *   2. Disconnect Runtime Node
   *   3. Delete Node record (or retain retry metadata if Clever Cloud API deletion fails)
   *   4. Delete dedicated Clever Cloud Application
   *   5. Update database
   */
  public async destroyHostRuntime(hostId: string): Promise<void> {
    const prisma = getPrismaOrThrow();
    const host = await prisma.host.findUnique({
      where: { id: hostId },
      include: { node: true },
    });

    if (!host) {
      return;
    }

    const nodeId = host.nodeId || host.node?.id || null;
    const cleverCloudAppId =
      host.provisionedServerId || host.node?.provisionedServerId || null;

    // 1. Stop Host process & 2. Disconnect Node
    if (nodeId) {
      const connectedAgent = runtimeRegistry.getAgentOrNull(nodeId);
      if (connectedAgent) {
        await connectedAgent.processManager.stop(host.id, 5).catch(() => null);
        await connectedAgent.containerManager
          .removeContainer(host.id)
          .catch(() => null);
        connectedAgent.disconnect();
        runtimeRegistry.unregisterAgent(nodeId, connectedAgent);
      }
    }

    // 4. Delete dedicated Clever Cloud Application
    let appDeletedSuccessfully = true;
    let deleteErrorReason: string | null = null;

    if (cleverCloudAppId) {
      try {
        await this.provisioner.destroyServer(cleverCloudAppId);
        logger.info(
          'Deleted dedicated Clever Cloud Application for deleted Host',
          {
            hostId: host.id,
            cleverCloudAppId,
            provider: host.provider || this.provisioner.providerName,
          }
        );
      } catch (err) {
        appDeletedSuccessfully = false;
        deleteErrorReason =
          err instanceof Error
            ? err.message
            : 'Unknown Clever Cloud API error during application deletion';

        logger.error(
          'Failed to delete dedicated Clever Cloud Application during Host deletion; retaining retry record',
          {
            hostId: host.id,
            nodeId,
            cleverCloudAppId,
            organisationId: config.cleverCloud.organisationId || null,
            reason: deleteErrorReason,
          }
        );

        await prisma.activityLog
          .create({
            data: {
              userId: host.ownerId,
              action: 'Clever Cloud Application Deletion Failed (Retry Queued)',
              metadata: {
                deletedHostId: host.id,
                deletedHostPublicId: host.publicId,
                cleverCloudApplicationId: cleverCloudAppId,
                organisationId: config.cleverCloud.organisationId || null,
                nodeId,
                provider: 'clever-cloud',
                retryRequired: true,
                reason: deleteErrorReason,
              },
            },
          })
          .catch(() => null);
      }
    }

    // 3. Delete Node record (or mark DELETE_RETRY_REQUIRED if Clever Cloud API deletion failed so it is never orphaned)
    if (nodeId) {
      if (appDeletedSuccessfully) {
        await prisma.node
          .deleteMany({
            where: {
              OR: [
                { id: nodeId, dedicatedHostId: host.id },
                { dedicatedHostId: host.id },
              ],
            },
          })
          .catch(() => null);
      } else {
        await prisma.node
          .update({
            where: { id: nodeId },
            data: {
              dedicatedHostId: null,
              status: 'OFFLINE',
              isOnline: false,
              serverStatus: 'DELETE_RETRY_REQUIRED',
              provisionedServerId: cleverCloudAppId,
              provider: 'clever-cloud',
            },
          })
          .catch(() => null);
      }
    }
  }

  /**
   * Background retry for any Clever Cloud Applications whose deletion failed during Host teardown.
   */
  public async retryOrphanedCleverCloudDeletions(): Promise<void> {
    if (!this.provisioner.isConfigured()) {
      return;
    }

    const prisma = getPrismaOrThrow();
    const pendingNodes = await prisma.node.findMany({
      where: {
        serverStatus: 'DELETE_RETRY_REQUIRED',
        provisionedServerId: { not: null },
      },
      take: 10,
    });

    for (const node of pendingNodes) {
      if (!node.provisionedServerId) continue;
      try {
        await this.provisioner.destroyServer(node.provisionedServerId);
        await prisma.node.delete({ where: { id: node.id } });
        logger.info(
          'Successfully deleted previously failed Clever Cloud Application on retry',
          {
            nodeId: node.id,
            cleverCloudAppId: node.provisionedServerId,
          }
        );
      } catch (err) {
        logger.warn('Retry deletion of Clever Cloud Application still failing', {
          nodeId: node.id,
          cleverCloudAppId: node.provisionedServerId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  private async waitForNodeWebSocketConnection(
    nodeId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (runtimeRegistry.isNodeConnected(nodeId)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, NODE_CONNECTION_POLL_INTERVAL_MS));
    }
    return runtimeRegistry.isNodeConnected(nodeId);
  }
}

export const runtimeProvisionerService = new NodeProvisionerService();
