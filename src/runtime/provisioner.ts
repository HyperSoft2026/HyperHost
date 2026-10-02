/**
 * HyperHost Automatic Per-Host Runtime Provisioner
 * Powered by HyperSoft
 *
 * Orchestrates 1-to-1 dedicated Runtime Server & Node provisioning per Host:
 *   Host -> Dedicated Runtime Server -> Dedicated Runtime Node -> Real Host Process
 *
 * Strictly enforces real provisioning only: never uses fake servers or fake nodes,
 * never exposes Node/Provider credentials to the frontend or logs, and never transitions
 * a Host to RUNNING without a verified live Server, connected Node Agent, and OS process.
 */
import type {
  BootstrapRuntimeNodeInput,
  CreateRuntimeServerInput,
  ProvisionedServer,
  RuntimeProvisioner,
} from './interfaces';
import { runtimeRegistry } from './registry';
import { config } from '../server/config';
import { decryptSecret, encryptSecret, generateSecureToken, hashToken } from '../server/crypto';
import { getPrismaOrThrow } from '../server/database';
import { AppError } from '../server/errors';
import { logger } from '../server/logger';
import { formatEntityPublicId } from '../shared/ids';

const NODE_CONNECTION_WAIT_TIMEOUT_MS = 90_000;
const NODE_CONNECTION_POLL_INTERVAL_MS = 1_000;

export function resolveControlPlaneWsUrl(): string {
  const base = (config.publicUrl || config.appUrl || '').trim().replace(/\/+$/, '');
  const wsBase = base
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');
  return `${wsBase}/api/runtime/nodes/ws`;
}

/**
 * Generates the server-side cloud-init / bootstrap script that automatically configures
 * and starts the standalone Runtime Node Agent on the newly provisioned Runtime Server.
 * Never sent to the browser and never logged.
 */
export function buildNodeAgentBootstrapScript(params: {
  controlPlaneWsUrl: string;
  nodeId: string;
  nodeToken: string;
  hostId: string;
}): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'install -d -m 0700 /etc/hyperhost /var/lib/hyperhost/workspaces',
    'cat <<\'EOF\' > /etc/hyperhost/node-agent.env',
    `CONTROL_PLANE_WS_URL=${params.controlPlaneWsUrl}`,
    `NODE_ID=${params.nodeId}`,
    `NODE_TOKEN=${params.nodeToken}`,
    `HOST_ID=${params.hostId}`,
    'NODE_WORKSPACE_ROOT=/var/lib/hyperhost/workspaces',
    'EOF',
    'chmod 0600 /etc/hyperhost/node-agent.env',
    'if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^hyperhost-node-agent\\.service"; then',
    '  systemctl daemon-reload',
    '  systemctl enable --now hyperhost-node-agent.service',
    'else',
    '  cd /opt/hyperhost && set -a && . /etc/hyperhost/node-agent.env && set +a && nohup npm run start:node-agent >/var/log/hyperhost-node-agent.log 2>&1 &',
    'fi',
  ].join('\n');
}

/**
 * Default truthful RuntimeProvisioner implementation when no external cloud infrastructure
 * provider is configured. Never fabricates servers or pretends provisioning succeeded.
 */
export class UnconfiguredRuntimeProvisioner implements RuntimeProvisioner {
  public get providerName(): string {
    return config.runtimeProvisioning.provider || 'unconfigured';
  }

  public isConfigured(): boolean {
    return false;
  }

  public async createServer(
    _input: CreateRuntimeServerInput
  ): Promise<ProvisionedServer> {
    throw new AppError(
      'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
      'Unable to provision runtime server: Infrastructure provider is not configured.',
      503
    );
  }

  public async waitUntilReady(_serverId: string): Promise<ProvisionedServer> {
    throw new AppError(
      'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
      'Unable to provision runtime server: Infrastructure provider is not configured.',
      503
    );
  }

  public async bootstrapNode(_input: BootstrapRuntimeNodeInput): Promise<void> {
    throw new AppError(
      'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
      'Unable to bootstrap runtime node: Infrastructure provider is not configured.',
      503
    );
  }

  public async destroyServer(_serverId: string): Promise<void> {
    throw new AppError(
      'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
      'Unable to destroy runtime server: Infrastructure provider is not configured.',
      503
    );
  }
}

/**
 * Concrete RuntimeProvisioner implementation for external Cloud Infrastructure APIs
 * (e.g., Hetzner Cloud, DigitalOcean, Clever Cloud / Custom Cloud Orchestrator API).
 * Active only when RUNTIME_PROVIDER, RUNTIME_PROVIDER_API_TOKEN, and RUNTIME_PROVIDER_API_ENDPOINT
 * are configured in the Control Plane environment.
 */
export class ExternalCloudRuntimeProvisioner implements RuntimeProvisioner {
  public get providerName(): string {
    return config.runtimeProvisioning.provider || 'external-cloud';
  }

  public isConfigured(): boolean {
    return Boolean(
      config.runtimeProvisioning.provider &&
        config.runtimeProvisioning.apiToken &&
        config.runtimeProvisioning.apiEndpoint
    );
  }

  private getEndpointBase(): string {
    const endpoint = (config.runtimeProvisioning.apiEndpoint || '')
      .trim()
      .replace(/\/+$/, '');
    if (!endpoint) {
      throw new AppError(
        'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
        'Unable to provision runtime server: Infrastructure provider API endpoint is not configured.',
        503
      );
    }
    return endpoint;
  }

  private getAuthHeaders(): Record<string, string> {
    const token = config.runtimeProvisioning.apiToken?.trim();
    if (!token) {
      throw new AppError(
        'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
        'Unable to provision runtime server: Infrastructure provider API token is not configured.',
        503
      );
    }
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  public async createServer(
    input: CreateRuntimeServerInput
  ): Promise<ProvisionedServer> {
    if (!this.isConfigured()) {
      throw new AppError(
        'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
        'Unable to provision runtime server: Infrastructure provider is not configured.',
        503
      );
    }

    const baseUrl = this.getEndpointBase();
    const res = await fetch(`${baseUrl}/servers`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        name: `hyperhost-${input.hostPublicId.toLowerCase()}`,
        region: config.runtimeProvisioning.region || 'eu-central',
        image:
          config.runtimeProvisioning.image || 'ubuntu-24.04-hyperhost-runtime',
        user_data: input.bootstrapScript,
        labels: {
          managed_by: 'hyperhost',
          host_id: input.hostId,
          host_public_id: input.hostPublicId,
          node_id: input.nodeId,
          runtime: input.runtime,
        },
        resources: {
          memoryLimitMb: input.memoryLimitMb,
          cpuLimitPercent: input.cpuLimitPercent,
          diskLimitMb: input.diskLimitMb,
        },
      }),
    });

    if (!res.ok) {
      throw new AppError(
        'INFRASTRUCTURE_PROVISIONING_FAILED',
        `Unable to provision runtime server: Provider returned HTTP ${res.status}.`,
        502
      );
    }

    const data = (await res.json()) as Record<string, any>;
    const serverObj = data.server || data.droplet || data.data || data;
    const serverId = String(serverObj?.id || serverObj?.serverId || '').trim();
    if (!serverId) {
      throw new AppError(
        'INFRASTRUCTURE_PROVISIONING_FAILED',
        'Unable to provision runtime server: Provider did not return a valid serverId.',
        502
      );
    }

    const ipAddress = String(
      serverObj?.ipAddress ||
        serverObj?.public_net?.ipv4?.ip ||
        serverObj?. ipv4 ||
        '0.0.0.0'
    );
    const location = String(
      serverObj?.location ||
        serverObj?.datacenter?.name ||
        config.runtimeProvisioning.region ||
        'eu-central'
    );
    const fqdn = String(
      serverObj?.fqdn || `srv-${serverId}.${this.providerName}.runtime.hyperhost`
    );

    return {
      serverId,
      provider: this.providerName,
      ipAddress,
      fqdn,
      location,
      status: 'BOOTING',
    };
  }

  public async waitUntilReady(serverId: string): Promise<ProvisionedServer> {
    const baseUrl = this.getEndpointBase();
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
      const res = await fetch(
        `${baseUrl}/servers/${encodeURIComponent(serverId)}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (!res.ok) {
        throw new AppError(
          'INFRASTRUCTURE_PROVISIONING_FAILED',
          `Unable to inspect runtime server status: Provider returned HTTP ${res.status}.`,
          502
        );
      }

      const data = (await res.json()) as Record<string, any>;
      const serverObj = data.server || data.droplet || data.data || data;
      const rawStatus = String(serverObj?.status || '').toUpperCase();
      const ipAddress = String(
        serverObj?.ipAddress ||
          serverObj?.public_net?.ipv4?.ip ||
          serverObj?.ipv4 ||
          '0.0.0.0'
      );
      const fqdn = String(
        serverObj?.fqdn ||
          `srv-${serverId}.${this.providerName}.runtime.hyperhost`
      );
      const location = String(
        serverObj?.location ||
          serverObj?.datacenter?.name ||
          config.runtimeProvisioning.region ||
          'eu-central'
      );

      if (
        rawStatus === 'READY' ||
        rawStatus === 'RUNNING' ||
        rawStatus === 'ACTIVE' ||
        rawStatus === 'ONLINE'
      ) {
        return {
          serverId,
          provider: this.providerName,
          ipAddress,
          fqdn,
          location,
          status: 'READY',
        };
      }

      if (rawStatus === 'ERROR' || rawStatus === 'FAILED') {
        throw new AppError(
          'INFRASTRUCTURE_PROVISIONING_FAILED',
          'Unable to provision runtime server: Provider reported server boot failure.',
          502
        );
      }

      await new Promise((r) => setTimeout(r, 2_000));
    }

    throw new AppError(
      'INFRASTRUCTURE_PROVISIONING_TIMEOUT',
      'Unable to provision runtime server: Timed out waiting for server to become ready.',
      504
    );
  }

  public async bootstrapNode(input: BootstrapRuntimeNodeInput): Promise<void> {
    const baseUrl = this.getEndpointBase();
    const res = await fetch(
      `${baseUrl}/servers/${encodeURIComponent(input.server.serverId)}/bootstrap`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          hostId: input.hostId,
          nodeId: input.nodeId,
          controlPlaneWsUrl: input.controlPlaneWsUrl,
          nodeToken: input.nodeToken,
          bootstrapScript: input.bootstrapScript,
        }),
      }
    );

    // 404 is allowed if the provider already executed user_data cloud-init during createServer
    if (!res.ok && res.status !== 404) {
      throw new AppError(
        'NODE_BOOTSTRAP_FAILED',
        `Unable to bootstrap Runtime Node Agent on server (HTTP ${res.status}).`,
        502
      );
    }
  }

  public async destroyServer(serverId: string): Promise<void> {
    const baseUrl = this.getEndpointBase();
    const res = await fetch(
      `${baseUrl}/servers/${encodeURIComponent(serverId)}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );

    if (!res.ok && res.status !== 404) {
      throw new AppError(
        'INFRASTRUCTURE_DESTROY_FAILED',
        `Failed to destroy Runtime Server ${serverId} (HTTP ${res.status}).`,
        502
      );
    }
  }
}

export function createDefaultRuntimeProvisioner(): RuntimeProvisioner {
  const cloudProvisioner = new ExternalCloudRuntimeProvisioner();
  if (cloudProvisioner.isConfigured()) {
    return cloudProvisioner;
  }
  return new UnconfiguredRuntimeProvisioner();
}

export class NodeProvisionerService {
  private provisioner: RuntimeProvisioner;
  private readonly activeProvisioningHosts = new Set<string>();

  constructor(provisioner?: RuntimeProvisioner) {
    this.provisioner = provisioner || createDefaultRuntimeProvisioner();
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
   * Provisions a dedicated Runtime Server and dedicated Runtime Node for a single Host:
   * PENDING -> PROVISIONING -> BOOTSTRAPPING -> NODE_CONNECTING -> NODE_ONLINE -> STARTING -> RUNNING
   */
  public async provisionHostRuntime(hostId: string): Promise<void> {
    if (this.activeProvisioningHosts.has(hostId)) {
      return;
    }
    this.activeProvisioningHosts.add(hostId);

    const prisma = getPrismaOrThrow();
    let createdNodeId: string | null = null;

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

      // 2. Generate secure per-Host Node credentials and create dedicated Node record in PostgreSQL
      const rawNodeToken = `hhnode_${generateSecureToken(32)}`;
      const agentTokenHash = hashToken(rawNodeToken);
      const bootstrapTokenEncrypted = encryptSecret(rawNodeToken);
      const dedicatedNodeName = `node-${hostPublicId.toLowerCase()}`;

      const existingDedicatedNode = await prisma.node.findUnique({
        where: { dedicatedHostId: host.id },
      });

      const dedicatedNode = existingDedicatedNode
        ? await prisma.node.update({
            where: { id: existingDedicatedNode.id },
            data: {
              status: 'OFFLINE',
              isOnline: false,
              agentTokenHash,
              bootstrapTokenEncrypted,
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
              location: config.runtimeProvisioning.region || 'Unassigned',
              fqdn: `${dedicatedNodeName}.runtime.hyperhost`,
              ipAddress: '0.0.0.0',
              daemonPort: 8080,
              status: 'OFFLINE',
              isOnline: false,
              agentTokenHash,
              bootstrapTokenEncrypted,
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

      // 3. Build automatic Node Agent bootstrap configuration
      const controlPlaneWsUrl = resolveControlPlaneWsUrl();
      const bootstrapScript = buildNodeAgentBootstrapScript({
        controlPlaneWsUrl,
        nodeId: dedicatedNode.id,
        nodeToken: rawNodeToken,
        hostId: host.id,
      });

      // 4. Request dedicated Server from Infrastructure Provider
      if (!this.provisioner.isConfigured()) {
        throw new AppError(
          'INFRASTRUCTURE_PROVIDER_NOT_CONFIGURED',
          'Unable to provision runtime server. Infrastructure provider is not configured.',
          503
        );
      }

      const createdServer = await this.provisioner.createServer({
        hostId: host.id,
        hostPublicId,
        hostName: host.name,
        nodeId: dedicatedNode.id,
        runtime: host.runtime,
        runtimeVersion: host.runtimeVersion,
        memoryLimitMb: host.memoryLimitMb,
        cpuLimitPercent: host.cpuLimitPercent,
        diskLimitMb: host.diskLimitMb,
        bootstrapScript,
      });

      await Promise.all([
        prisma.host.update({
          where: { id: host.id },
          data: {
            provisionedServerId: createdServer.serverId,
            provider: createdServer.provider,
            serverStatus: 'BOOTING',
          },
        }),
        prisma.node.update({
          where: { id: dedicatedNode.id },
          data: {
            provisionedServerId: createdServer.serverId,
            provider: createdServer.provider,
            serverStatus: 'BOOTING',
            ipAddress: createdServer.ipAddress || '0.0.0.0',
            fqdn: createdServer.fqdn || dedicatedNode.fqdn,
            location: createdServer.location || dedicatedNode.location,
          },
        }),
      ]);

      // 5. Wait until the provisioned Server is ready
      const readyServer = await this.provisioner.waitUntilReady(
        createdServer.serverId
      );
      const provisionedAt = new Date();

      await Promise.all([
        prisma.host.update({
          where: { id: host.id },
          data: {
            status: 'BOOTSTRAPPING',
            provisioningStatus: 'BOOTSTRAPPING',
            serverStatus: 'BOOTSTRAPPING',
            provisionedAt,
          },
        }),
        prisma.node.update({
          where: { id: dedicatedNode.id },
          data: {
            serverStatus: 'BOOTSTRAPPING',
            ipAddress: readyServer.ipAddress || createdServer.ipAddress,
            fqdn: readyServer.fqdn || createdServer.fqdn,
            location: readyServer.location || createdServer.location,
          },
        }),
      ]);

      // 6. Bootstrap Runtime Node Agent on the ready Server
      await this.provisioner.bootstrapNode({
        server: readyServer,
        hostId: host.id,
        nodeId: dedicatedNode.id,
        controlPlaneWsUrl,
        nodeToken: rawNodeToken,
        bootstrapScript,
      });

      const bootstrappedAt = new Date();
      await prisma.host.update({
        where: { id: host.id },
        data: {
          status: 'NODE_CONNECTING',
          provisioningStatus: 'NODE_CONNECTING',
          serverStatus: 'READY',
          bootstrappedAt,
        },
      });

      // 7. Wait for the dedicated Node Agent to connect via WebSocket
      const connected = await this.waitForNodeWebSocketConnection(
        dedicatedNode.id,
        NODE_CONNECTION_WAIT_TIMEOUT_MS
      );

      if (!connected) {
        throw new AppError(
          'RUNTIME_NODE_CONNECTION_TIMEOUT',
          'Unable to provision runtime server: Timed out waiting for Runtime Node Agent to connect.',
          504
        );
      }

      // 8. Complete transition: NODE_ONLINE -> STARTING -> RUNNING
      await this.startHostOnConnectedDedicatedNode(host.id, dedicatedNode.id);
    } catch (err) {
      const safeReason =
        err instanceof AppError
          ? err.message
          : 'Unable to provision runtime server: Infrastructure provisioning failed.';

      logger.warn('Per-Host Runtime Provisioning failed', {
        hostId,
        nodeId: createdNodeId,
        provider: this.provisioner.providerName,
        code: err instanceof AppError ? err.code : 'PROVISIONING_FAILED',
        reason: safeReason,
      });

      await prisma.host
        .update({
          where: { id: hostId },
          data: {
            status: 'ERROR',
            provisioningStatus: 'FAILED',
            serverStatus: 'ERROR',
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
              serverStatus: 'ERROR',
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
          provisioningStatus: 'READY',
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
   * Destroys the Host's dedicated Runtime Server and cleans up its dedicated Runtime Node
   * when the Host is deleted.
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

    const nodeId = host.nodeId;
    if (nodeId) {
      const connectedAgent = runtimeRegistry.getAgentOrNull(nodeId);
      if (connectedAgent) {
        await connectedAgent.containerManager.removeContainer(host.id).catch(() => null);
        connectedAgent.disconnect();
        runtimeRegistry.unregisterAgent(nodeId, connectedAgent);
      }
    }

    const serverId =
      host.provisionedServerId || host.node?.provisionedServerId || null;
    if (serverId && this.provisioner.isConfigured()) {
      try {
        await this.provisioner.destroyServer(serverId);
        logger.info('Destroyed dedicated Runtime Server for deleted Host', {
          hostId: host.id,
          serverId,
          provider: host.provider || this.provisioner.providerName,
        });
      } catch (err) {
        logger.warn('Failed to destroy remote Runtime Server during Host deletion', {
          hostId: host.id,
          serverId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    if (nodeId) {
      await prisma.node
        .deleteMany({
          where: {
            OR: [{ id: nodeId, dedicatedHostId: host.id }, { dedicatedHostId: host.id }],
          },
        })
        .catch(() => null);
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
