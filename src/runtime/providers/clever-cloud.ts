/**
 * HyperHost Clever Cloud Runtime Provisioner
 * Powered by HyperSoft
 *
 * Implements Automatic Per-Host Runtime Provisioning using the official
 * Clever Cloud Public API Bridge (https://api-bridge.clever-cloud.com/).
 *
 * Authentication:
 *   Authorization: Bearer ${CLEVER_CLOUD_API_TOKEN}
 *
 * Architecture:
 *   POST /api/hosts
 *     -> CleverCloudRuntimeProvisioner.createServer()
 *        (POST /v2/organisations/{orgId}/applications -> hyperhost-runtime-{hostPublicId})
 *     -> CleverCloudRuntimeProvisioner.bootstrapNode()
 *        (PUT /v2/organisations/{orgId}/applications/{appId}/env + Git push of Node Agent +
 *         POST /v2/organisations/{orgId}/applications/{appId}/instances)
 *     -> CleverCloudRuntimeProvisioner.waitUntilReady()
 *        (GET /v2/organisations/{orgId}/applications/{appId}/deployments & /instances)
 *     -> Dedicated Node Agent connects via WebSocket -> Host starts real process
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  BootstrapRuntimeNodeInput,
  CreateRuntimeServerInput,
  ProvisionedServer,
  RuntimeConnectionTestResult,
  RuntimeProvisioner,
} from '../interfaces';
import { config, getCleverCloudMissingConfig } from '../../server/config';
import { AppError } from '../../server/errors';
import { logger } from '../../server/logger';

const execFileAsync = promisify(execFile);

const DEPLOYMENT_READY_TIMEOUT_MS = 180_000;
const DEPLOYMENT_POLL_INTERVAL_MS = 3_000;

/**
 * Official Clever Cloud Git deployment SSH host keys.
 * Verified against push.par.clever-cloud.com and push.clever-cloud.com.
 * Used for strict host key verification without MITM vulnerability.
 */
const CLEVER_CLOUD_KNOWN_HOSTS = [
  'push.par.clever-cloud.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC1ng9sIlH9CGMmSHvTRenr/N0L4Mq85LOjilW1JtOhW',
  'push.par.clever-cloud.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOE3e4fL9CtKcHluvFYzLgPBPmFpqRPED03O4ixc0FhUChuC2DQ0k2XR3hUR5QBL7r72vUakqAaOXORNpS+SoG0=',
  'push.par.clever-cloud.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDOpVJ1i2osayi36rbSa/bRk76QoEfSy4UPHhmRuz0s0W+ny6fc4dopSZ+km/aFR1kCoSQGvpaA1GHw6pZrhmNTCRxmvRCizbA/FN4X8NYXlJ+r9UbeHPkXd85c+rzC3WAxFMmevu4Y/GJ272aMoob3t3eIxfBxd7xaMLlobKAq+ERolyIrWGbjit/+AjPiRz3Dl6x5mQBOwTnV2U1wDsxpNlG/x6d34QsJYjw/WX20KTRNYCw6Q3QHK1Uhm5kEkZJD7NKtXJwzd8rt1KToiPEm2udgJkvIr4Zfhqv5dsRRY7QHDYIoF46ycheMQWKipDMTy4uDyOgJugQxRlKHPk6t',
  'push.clever-cloud.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC1ng9sIlH9CGMmSHvTRenr/N0L4Mq85LOjilW1JtOhW',
  'push.clever-cloud.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOE3e4fL9CtKcHluvFYzLgPBPmFpqRPED03O4ixc0FhUChuC2DQ0k2XR3hUR5QBL7r72vUakqAaOXORNpS+SoG0=',
  'push.clever-cloud.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDOpVJ1i2osayi36rbSa/bRk76QoEfSy4UPHhmRuz0s0W+ny6fc4dopSZ+km/aFR1kCoSQGvpaA1GHw6pZrhmNTCRxmvRCizbA/FN4X8NYXlJ+r9UbeHPkXd85c+rzC3WAxFMmevu4Y/GJ272aMoob3t3eIxfBxd7xaMLlobKAq+ERolyIrWGbjit/+AjPiRz3Dl6x5mQBOwTnV2U1wDsxpNlG/x6d34QsJYjw/WX20KTRNYCw6Q3QHK1Uhm5kEkZJD7NKtXJwzd8rt1KToiPEm2udgJkvIr4Zfhqv5dsRRY7QHDYIoF46ycheMQWKipDMTy4uDyOgJugQxRlKHPk6t',
  '*.clever-cloud.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC1ng9sIlH9CGMmSHvTRenr/N0L4Mq85LOjilW1JtOhW',
  '*.clever-cloud.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOE3e4fL9CtKcHluvFYzLgPBPmFpqRPED03O4ixc0FhUChuC2DQ0k2XR3hUR5QBL7r72vUakqAaOXORNpS+SoG0=',
  '*.clever-cloud.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDOpVJ1i2osayi36rbSa/bRk76QoEfSy4UPHhmRuz0s0W+ny6fc4dopSZ+km/aFR1kCoSQGvpaA1GHw6pZrhmNTCRxmvRCizbA/FN4X8NYXlJ+r9UbeHPkXd85c+rzC3WAxFMmevu4Y/GJ272aMoob3t3eIxfBxd7xaMLlobKAq+ERolyIrWGbjit/+AjPiRz3Dl6x5mQBOwTnV2U1wDsxpNlG/x6d34QsJYjw/WX20KTRNYCw6Q3QHK1Uhm5kEkZJD7NKtXJwzd8rt1KToiPEm2udgJkvIr4Zfhqv5dsRRY7QHDYIoF46ycheMQWKipDMTy4uDyOgJugQxRlKHPk6t',
].join('\n') + '\n';

function normalizeSshPrivateKey(raw: string): string {
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  if (!cleaned.includes('\n') && cleaned.includes('\\n')) {
    cleaned = cleaned.replace(/\\n/g, '\n');
  }
  return cleaned.trim() + '\n';
}

interface CleverCloudInstanceVariant {
  id: string;
  slug: string;
  name: string;
}

interface CleverCloudInstanceProduct {
  type: string;
  version: string;
  name: string;
  variant: CleverCloudInstanceVariant;
  enabled?: boolean;
  flavors?: Array<{
    name: string;
    mem: number;
    cpus: number;
    available?: boolean;
  }>;
  defaultFlavor?: {
    name: string;
  };
}

interface CleverCloudApplicationResponse {
  id: string;
  name: string;
  description?: string;
  zone?: string;
  deployUrl?: string;
  pushUrl?: string;
  vhosts?: Array<{ fqdn?: string }>;
  state?: string;
}

function selectCleverCloudFlavor(memoryLimitMb: number): string {
  if (memoryLimitMb <= 512) return 'nano';
  if (memoryLimitMb <= 1024) return 'XS';
  if (memoryLimitMb <= 2048) return 'S';
  if (memoryLimitMb <= 4096) return 'M';
  if (memoryLimitMb <= 8192) return 'L';
  return 'XL';
}

export class CleverCloudRuntimeProvisioner implements RuntimeProvisioner {
  public readonly providerName = 'clever-cloud';

  public getBaseUrl(): string {
    return (
      config.cleverCloud.apiBaseUrl?.trim() ||
      'https://api-bridge.clever-cloud.com'
    );
  }

  public isConfigured(): boolean {
    return Boolean(
      config.cleverCloud.apiToken && config.cleverCloud.organisationId
    );
  }

  public validateConfig(
    phase: 'PROVISIONING' | 'BOOTSTRAPPING' = 'PROVISIONING'
  ): void {
    const missing = getCleverCloudMissingConfig(phase);
    if (missing.length > 0) {
      const code =
        phase === 'BOOTSTRAPPING' ? 'BOOTSTRAP_FAILED' : 'PROVISIONING_FAILED';
      throw new AppError(
        code,
        `Clever Cloud configuration is incomplete. Missing required environment variables: ${missing.join(
          ', '
        )}. Configure them in the Control Plane environment.`,
        503
      );
    }
  }

  /**
   * Diagnostic method to test authentication and reachability with the Clever Cloud API Bridge.
   * Performs a real request to GET /v2/self using Authorization: Bearer <API_TOKEN>
   * and verifies SSH deployment key registration if configured.
   */
  public async testConnection(): Promise<RuntimeConnectionTestResult> {
    const baseUrl = this.getBaseUrl();
    if (!this.isConfigured()) {
      return {
        configured: false,
        ok: false,
        status: 0,
        apiBaseUrl: baseUrl,
        message:
          'CLEVER_CLOUD_API_TOKEN or CLEVER_CLOUD_ORGANISATION_ID is not configured.',
      };
    }

    const orgId = config.cleverCloud.organisationId?.trim() || '';
    const isPersonal =
      orgId.toLowerCase() === 'self' ||
      orgId.toLowerCase().startsWith('user_');
    const ownerSegment = this.getOwnerPathSegment();

    const sshKeyConfigured = Boolean(config.cleverCloud.sshPrivateKey);
    let sshKeyRegistered = false;
    let sshKeyFingerprint: string | undefined;

    try {
      const res = await fetch(`${baseUrl}/v2/self`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!res.ok) {
        let safeDetail = '';
        if (res.status === 401) {
          safeDetail = 'Invalid CLEVER_CLOUD_API_TOKEN or token has expired.';
        } else if (res.status === 403) {
          safeDetail = 'CLEVER_CLOUD_API_TOKEN lacks permission to query /v2/self.';
        } else {
          safeDetail = `HTTP ${res.status} ${res.statusText}`;
        }
        return {
          configured: true,
          ok: false,
          status: res.status,
          apiBaseUrl: baseUrl,
          message: `FAIL: Clever Cloud API authentication failed (${safeDetail})`,
          details: {
            spaceType: isPersonal ? 'personal' : 'organisation',
            targetOwnerSegment: ownerSegment,
            sshKeyConfigured,
          },
        };
      }

      const userData = (await res.json()) as {
        id?: string;
        email?: string;
        name?: string;
      };

      // If targeting an organisation (orga_xxx), verify access to the organisation
      if (!isPersonal && orgId) {
        const orgRes = await fetch(
          `${baseUrl}/v2/organisations/${encodeURIComponent(orgId)}`,
          {
            method: 'GET',
            headers: this.getAuthHeaders(),
          }
        );
        if (!orgRes.ok) {
          return {
            configured: true,
            ok: false,
            status: orgRes.status,
            apiBaseUrl: baseUrl,
            message: `FAIL: Authenticated with Clever Cloud as ${userData.email || userData.id}, but cannot access organisation "${orgId}" (HTTP ${orgRes.status}).`,
            details: {
              userId: userData.id,
              userEmail: userData.email,
              userName: userData.name,
              spaceType: 'organisation',
              targetOwnerSegment: ownerSegment,
              sshKeyConfigured,
            },
          };
        }
      }

      // Check SSH keys on user account if private key is configured
      if (sshKeyConfigured) {
        try {
          const keysRes = await fetch(`${baseUrl}/v2/self/keys`, {
            method: 'GET',
            headers: this.getAuthHeaders(),
          });
          if (keysRes.ok) {
            const keys = (await keysRes.json()) as Array<{
              name: string;
              key: string;
              fingerprint?: string;
            }>;
            const centralKey = keys.find(
              (k) =>
                k.name === 'hyperhost-central-deployer' ||
                k.name === 'hyperhost-control-plane'
            );
            if (centralKey) {
              sshKeyRegistered = true;
              sshKeyFingerprint = centralKey.fingerprint;
            }
          }
        } catch {
          // Non-fatal for diagnostic call
        }
      }

      const spaceDesc = isPersonal
        ? `Personal Space: ${userData.id || orgId}`
        : `Organisation: ${orgId}`;

      const sshDesc = sshKeyConfigured
        ? sshKeyRegistered
          ? ' | Deployment SSH Key: Registered'
          : ' | Deployment SSH Key: Configured (ready to register)'
        : ' | Deployment SSH Key: Not Configured';

      return {
        configured: true,
        ok: true,
        status: 200,
        apiBaseUrl: baseUrl,
        message: `SUCCESS: Clever Cloud API authentication successful (${spaceDesc}${sshDesc})`,
        details: {
          userId: userData.id,
          userEmail: userData.email,
          userName: userData.name,
          spaceType: isPersonal ? 'personal' : 'organisation',
          targetOwnerSegment: ownerSegment,
          sshKeyConfigured,
          sshKeyRegistered,
          sshKeyName: 'hyperhost-central-deployer',
          sshKeyFingerprint,
        },
      };
    } catch (err) {
      const safeErrorMsg =
        err instanceof Error
          ? err.message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
          : 'Network connection failed';
      return {
        configured: true,
        ok: false,
        status: 0,
        apiBaseUrl: baseUrl,
        message: `FAIL: Could not reach Clever Cloud API Bridge at ${baseUrl}: ${safeErrorMsg}`,
        details: {
          spaceType: isPersonal ? 'personal' : 'organisation',
          targetOwnerSegment: ownerSegment,
          sshKeyConfigured,
        },
      };
    }
  }

  public getOwnerPathSegment(): string {
    const orgId = config.cleverCloud.organisationId?.trim();
    if (!orgId) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud provisioning is not configured: CLEVER_CLOUD_ORGANISATION_ID is missing.',
        503
      );
    }
    const lower = orgId.toLowerCase();
    // Clever Cloud Personal Space is identified by 'self' or 'user_...' ID prefixes
    if (lower === 'self' || lower.startsWith('user_')) {
      return '/v2/self';
    }
    // Organisations in Clever Cloud use /v2/organisations/{orgaId}
    return `/v2/organisations/${encodeURIComponent(orgId)}`;
  }

  private getAuthHeaders(): Record<string, string> {
    const token = config.cleverCloud.apiToken?.trim();
    if (!token) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud provisioning is not configured: CLEVER_CLOUD_API_TOKEN is missing.',
        503
      );
    }
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Queries GET https://api-bridge.clever-cloud.com/v2/products/instances to dynamically resolve
   * the active Node.js instance type, version, and variant ID on Clever Cloud.
   */
  private async resolveNodeJsInstanceProduct(): Promise<{
    instanceType: string;
    instanceVersion: string;
    instanceVariant: string;
  }> {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/v2/products/instances`, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) {
      throw new AppError(
        'PROVISIONING_FAILED',
        `Clever Cloud API Bridge error while resolving Node.js runtime product (HTTP ${res.status}).`,
        502
      );
    }

    const products = (await res.json()) as CleverCloudInstanceProduct[];
    const nodeProducts = (Array.isArray(products) ? products : []).filter(
      (p) =>
        p &&
        p.enabled !== false &&
        (p.type === 'node' ||
          p.variant?.slug === 'node' ||
          p.name?.toLowerCase().includes('node'))
    );

    if (nodeProducts.length === 0) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud API Bridge did not return an enabled Node.js instance variant.',
        502
      );
    }

    nodeProducts.sort((a, b) =>
      String(b.version || '').localeCompare(String(a.version || ''), undefined, {
        numeric: true,
      })
    );

    const selected = nodeProducts[0];
    return {
      instanceType: selected.type,
      instanceVersion: selected.version,
      instanceVariant: selected.variant.id,
    };
  }

  /**
   * Creates a dedicated Node.js Clever Cloud Application for a single Host:
   *   Name: hyperhost-runtime-{hostPublicIdentifier}
   *   Endpoint: POST https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications
   */
  public async createServer(
    input: CreateRuntimeServerInput
  ): Promise<ProvisionedServer> {
    this.validateConfig('PROVISIONING');

    const ownerSegment = this.getOwnerPathSegment();
    const { instanceType, instanceVersion, instanceVariant } =
      await this.resolveNodeJsInstanceProduct();

    const sanitizedId = input.hostPublicId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    const appName = `hyperhost-runtime-${sanitizedId}`;
    const flavor = selectCleverCloudFlavor(input.memoryLimitMb);
    const zone = config.cleverCloud.zone || 'par';
    const baseUrl = this.getBaseUrl();

    // Idempotency check: Before creating a new application, check if one with this exact name already exists
    try {
      const existingRes = await fetch(
        `${baseUrl}${ownerSegment}/applications`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );
      if (existingRes.ok) {
        const existingList = (await existingRes.json()) as CleverCloudApplicationResponse[];
        const matched = Array.isArray(existingList)
          ? existingList.find((a) => a && a.name === appName)
          : undefined;
        if (matched && matched.id) {
          const matchedCleanSlug = matched.id.replace(/^app_/, 'app-');
          const matchedFqdn =
            matched.vhosts?.[0]?.fqdn || `${matchedCleanSlug}.cleverapps.io`;
          const matchedZone = matched.zone || zone;
          const matchedDeployUrl = matched.deployUrl || matched.pushUrl || undefined;

          logger.info('Found existing dedicated Clever Cloud Application for Host, reusing it', {
            hostId: input.hostId,
            hostPublicId: input.hostPublicId,
            nodeId: input.nodeId,
            cleverCloudAppId: matched.id,
            appName,
            zone: matchedZone,
            fqdn: matchedFqdn,
          });

          return {
            serverId: matched.id,
            provider: this.providerName,
            ipAddress: '0.0.0.0',
            fqdn: matchedFqdn,
            location: `Clever Cloud (${matchedZone})`,
            status: 'CREATING',
            deployUrl: matchedDeployUrl,
          };
        }
      }
    } catch (err) {
      // Non-fatal: if checking existing applications fails, proceed to attempt creation
      logger.debug('Could not list existing Clever Cloud applications before creation', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    const createPayload = {
      name: appName,
      description: `HyperHost Dedicated Runtime Node (${input.hostPublicId})`,
      zone,
      deploy: 'git',
      instanceType,
      instanceVersion,
      instanceVariant,
      minInstances: 1,
      maxInstances: 1,
      minFlavor: flavor,
      maxFlavor: flavor,
      separateBuild: false,
    };

    const res = await fetch(
      `${baseUrl}${ownerSegment}/applications`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(createPayload),
      }
    );

    if (!res.ok) {
      throw new AppError(
        'PROVISIONING_FAILED',
        `Clever Cloud API Bridge failed to create application "${appName}" (HTTP ${res.status}).`,
        502
      );
    }

    const appData = (await res.json()) as CleverCloudApplicationResponse;
    const appId = String(appData?.id || '').trim();
    if (!appId) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud API Bridge did not return an application ID.',
        502
      );
    }

    const cleanSlug = appId.replace(/^app_/, 'app-');
    const fqdn =
      appData.vhosts?.[0]?.fqdn || `${cleanSlug}.cleverapps.io`;
    const resolvedZone = appData.zone || zone;
    const deployUrl = appData.deployUrl || appData.pushUrl || undefined;

    logger.info('Created dedicated Clever Cloud Runtime Application for Host', {
      hostId: input.hostId,
      hostPublicId: input.hostPublicId,
      nodeId: input.nodeId,
      cleverCloudAppId: appId,
      appName,
      zone: resolvedZone,
      fqdn,
    });

    return {
      serverId: appId,
      provider: this.providerName,
      ipAddress: '0.0.0.0',
      fqdn,
      location: `Clever Cloud (${resolvedZone})`,
      status: 'CREATING',
      deployUrl,
    };
  }

  /**
   * Configures the Clever Cloud Application's environment variables and deploys the
   * standalone Runtime Node Agent into the dedicated Clever Cloud Application.
   *
   * 1. PUT https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/env
   * 2. Git push of the standalone Runtime Node Agent package to Clever Cloud's deployUrl
   * 3. POST https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/instances
   */
  public async bootstrapNode(input: BootstrapRuntimeNodeInput): Promise<void> {
    this.validateConfig('BOOTSTRAPPING');

    const appId = input.server.serverId;
    const ownerSegment = this.getOwnerPathSegment();

    // 1. Configure per-Host Runtime Node environment variables on the Clever Cloud Application
    const envEntries = [
      { name: 'NODE_ENV', value: 'production' },
      { name: 'CONTROL_PLANE_WS_URL', value: input.controlPlaneWsUrl },
      { name: 'NODE_ID', value: input.nodeId },
      { name: 'NODE_TOKEN', value: input.nodeToken },
      { name: 'HOST_ID', value: input.hostId },
      { name: 'NODE_FQDN', value: input.server.fqdn },
      { name: 'NODE_LOCATION', value: input.server.location },
      { name: 'NODE_WORKSPACE_ROOT', value: '/tmp/hyperhost-workspaces' },
      { name: 'CC_RUN_COMMAND', value: 'npm run start:node-agent' },
    ];
    const envDict: Record<string, string> = {
      NODE_ENV: 'production',
      CONTROL_PLANE_WS_URL: input.controlPlaneWsUrl,
      NODE_ID: input.nodeId,
      NODE_TOKEN: input.nodeToken,
      HOST_ID: input.hostId,
      NODE_FQDN: input.server.fqdn,
      NODE_LOCATION: input.server.location,
      NODE_WORKSPACE_ROOT: '/tmp/hyperhost-workspaces',
      CC_RUN_COMMAND: 'npm run start:node-agent',
    };

    const baseUrl = this.getBaseUrl();
    // Try array format first (official Clever Cloud JSON schema), then key-value dict as fallback
    let envRes = await fetch(
      `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(appId)}/env`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(envEntries),
      }
    );

    if (
      !envRes.ok &&
      (envRes.status === 400 || envRes.status === 415 || envRes.status === 422)
    ) {
      envRes = await fetch(
        `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(appId)}/env`,
        {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(envDict),
        }
      );
    }

    if (!envRes.ok) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud API Bridge failed to configure Runtime Node environment variables on ${appId} (HTTP ${envRes.status}).`,
        502
      );
    }

    // 2. Resolve deployUrl from server metadata or Clever Cloud Application details
    let deployUrl = input.server.deployUrl;
    if (!deployUrl) {
      const appRes = await fetch(
        `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(appId)}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );
      if (appRes.ok) {
        const appInfo = (await appRes.json()) as CleverCloudApplicationResponse;
        deployUrl = appInfo.deployUrl || appInfo.pushUrl;
      }
    }

    if (!deployUrl) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud Application ${appId} did not expose a Git deployment URL (deployUrl/pushUrl).`,
        502
      );
    }

    // 3. Package and push the standalone Runtime Node Agent to Clever Cloud's Git remote
    await this.pushNodeAgentToCleverCloudGit(appId, deployUrl);

    // 4. Trigger Clever Cloud Application deployment / instance startup
    const redeployRes = await fetch(
      `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(appId)}/instances`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
      }
    );

    // Note: Clever Cloud returns 200/201/202 or 400 if the Git push already started the deployment
    if (!redeployRes.ok && redeployRes.status >= 500) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud API Bridge failed to start instances for application ${appId} (HTTP ${redeployRes.status}).`,
        502
      );
    }
  }

  /**
   * Resolves the SSH public key corresponding to the central CLEVER_CLOUD_SSH_PRIVATE_KEY.
   * If CLEVER_CLOUD_SSH_PUBLIC_KEY is provided in environment variables, it is used directly.
   * Otherwise, the public key is automatically derived using ssh-keygen -y -f on a secure temporary key file.
   */
  public async resolveDeploymentPublicKey(): Promise<string> {
    if (config.cleverCloud.sshPublicKey?.trim()) {
      return config.cleverCloud.sshPublicKey.trim();
    }

    const privateKeyRaw = config.cleverCloud.sshPrivateKey?.trim();
    if (!privateKeyRaw) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        'CLEVER_CLOUD_SSH_PRIVATE_KEY is not configured in the Control Plane environment.',
        503
      );
    }

    const normalizedKey = normalizeSshPrivateKey(privateKeyRaw);
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'hyperhost-extract-key-')
    );
    const tempKeyFile = path.join(tempDir, 'id_rsa_temp');
    try {
      await fs.writeFile(tempKeyFile, normalizedKey, { mode: 0o600 });
      const { stdout } = await execFileAsync('ssh-keygen', [
        '-y',
        '-f',
        tempKeyFile,
      ]);
      const extracted = stdout.trim();
      if (!extracted) {
        throw new Error('ssh-keygen returned an empty public key');
      }
      return extracted;
    } catch (err) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Unable to derive public key from CLEVER_CLOUD_SSH_PRIVATE_KEY: ${
          err instanceof Error ? err.message : String(err)
        }. Ensure the private key is valid OpenSSH format (or provide CLEVER_CLOUD_SSH_PUBLIC_KEY directly).`,
        500
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }

  /**
   * Ensures the central deployment SSH public key is registered with the Clever Cloud account.
   * Uses the official Clever Cloud API endpoints:
   *   GET /v2/self/keys (list registered SSH keys)
   *   PUT /v2/self/keys/{keyName} (register SSH public key)
   *
   * Idempotent: checks existing keys first and avoids duplicate registrations.
   * Never logs, prints, or exposes the private key.
   */
  public async ensureDeploymentSSHKey(): Promise<{
    keyName: string;
    fingerprint?: string;
    registered: boolean;
  }> {
    const keyName = 'hyperhost-central-deployer';
    const baseUrl = this.getBaseUrl();
    const publicKey = await this.resolveDeploymentPublicKey();
    const pubKeyTrimmed = publicKey.trim();
    const pubKeyParts = pubKeyTrimmed.split(/\s+/);
    const keyBody = pubKeyParts[1] || '';

    // 1. Query existing registered SSH keys: GET /v2/self/keys
    let existingKeys: Array<{ name: string; key: string; fingerprint?: string }> =
      [];
    try {
      const keysRes = await fetch(`${baseUrl}/v2/self/keys`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });
      if (keysRes.ok) {
        existingKeys = (await keysRes.json()) as Array<{
          name: string;
          key: string;
          fingerprint?: string;
        }>;
      }
    } catch (err) {
      logger.warn(
        '[CleverCloud] Could not query existing SSH keys via GET /v2/self/keys',
        {
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }

    // Check if key is already registered by key name or matching public key body
    const found = existingKeys.find((k) => {
      if (k.name === keyName) return true;
      if (keyBody && k.key && k.key.includes(keyBody)) return true;
      if (k.key && k.key.trim() === pubKeyTrimmed) return true;
      return false;
    });

    if (found) {
      logger.info(
        `[CleverCloud] Central deployment SSH key "${found.name}" is already registered on Clever Cloud (fingerprint: ${
          found.fingerprint || 'verified'
        }).`
      );
      return {
        keyName: found.name,
        fingerprint: found.fingerprint,
        registered: true,
      };
    }

    // 2. Register public key with Clever Cloud: PUT /v2/self/keys/{keyName}
    logger.info(
      `[CleverCloud] Registering central deployment SSH public key "${keyName}" with Clever Cloud account via PUT /v2/self/keys/${encodeURIComponent(
        keyName
      )}...`
    );

    const putRes = await fetch(
      `${baseUrl}/v2/self/keys/${encodeURIComponent(keyName)}`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(pubKeyTrimmed),
      }
    );

    if (!putRes.ok && putRes.status !== 409) {
      const errText = await putRes.text().catch(() => '');
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud API Bridge failed to register central deployment SSH public key (HTTP ${putRes.status}): ${errText.slice(
          0,
          200
        )}`,
        502
      );
    }

    logger.info(
      `[CleverCloud] Central deployment SSH public key "${keyName}" registered successfully with Clever Cloud account.`
    );
    return {
      keyName,
      registered: true,
    };
  }

  /**
   * Builds an isolated temporary Git repository containing the standalone Runtime Node Agent
   * and pushes it directly to the Clever Cloud Application's official Git SSH remote (`deployUrl`)
   * using the central CLEVER_CLOUD_SSH_PRIVATE_KEY and verified known_hosts.
   *
   * Security & Concurrency Guarantees:
   *   - Each host provisioning process uses dedicated, isolated temporary workspaces.
   *   - The SSH private key is stored outside the Git repository in a separate chmod 0600 temp directory.
   *   - Verified Clever Cloud SSH host keys prevent MITM attacks without blind StrictHostKeyChecking=no.
   *   - The private key is never committed, never persisted in database, and completely erased in finally.
   *   - No HTTP Bearer tokens or plaintext credentials in Git push.
   */
  private async pushNodeAgentToCleverCloudGit(
    appId: string,
    rawDeployUrl: string
  ): Promise<void> {
    const privateKeyRaw = config.cleverCloud.sshPrivateKey?.trim();
    if (!privateKeyRaw) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        'CLEVER_CLOUD_SSH_PRIVATE_KEY is not configured. Clever Cloud Git deployment requires a central deployment SSH private key.',
        503
      );
    }

    // Ensure central public key is registered with Clever Cloud before pushing
    await this.ensureDeploymentSSHKey();

    const normalizedPrivateKey = normalizeSshPrivateKey(privateKeyRaw);

    // Isolated workspaces per deployment to ensure concurrent provisioning safety
    const correlationId = crypto.randomUUID();
    const gitWorkspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `hyperhost-git-${appId}-${correlationId}-`)
    );
    const sshKeyDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `hyperhost-ssh-${appId}-${correlationId}-`)
    );
    const privateKeyPath = path.join(sshKeyDir, 'id_hyperhost_clever');
    const knownHostsPath = path.join(sshKeyDir, 'known_hosts');

    try {
      // 1. Write SSH private key and strict verified known_hosts file
      await fs.writeFile(privateKeyPath, normalizedPrivateKey, { mode: 0o600 });
      await fs.writeFile(knownHostsPath, CLEVER_CLOUD_KNOWN_HOSTS, {
        mode: 0o644,
      });

      // 2. Prepare standalone Node Agent workspace files
      const srcAgentPath = path.resolve(
        process.cwd(),
        'src/runtime/node-agent.ts'
      );
      const agentCode = await fs.readFile(srcAgentPath, 'utf-8');

      const runtimeSrcDir = path.join(gitWorkspaceDir, 'src', 'runtime');
      const serverSrcDir = path.join(gitWorkspaceDir, 'src', 'server');
      await fs.mkdir(runtimeSrcDir, { recursive: true });
      await fs.mkdir(serverSrcDir, { recursive: true });

      // Copy node-agent.ts
      await fs.writeFile(
        path.join(runtimeSrcDir, 'node-agent.ts'),
        agentCode,
        'utf-8'
      );

      // Copy interfaces.ts (required by node-agent.ts)
      const srcInterfacesPath = path.resolve(
        process.cwd(),
        'src/runtime/interfaces.ts'
      );
      const interfacesCode = await fs.readFile(srcInterfacesPath, 'utf-8');
      await fs.writeFile(
        path.join(runtimeSrcDir, 'interfaces.ts'),
        interfacesCode,
        'utf-8'
      );

      // Write standalone lightweight logger (required by node-agent.ts)
      const standaloneLoggerCode = `
export const logger = {
  info: (msg: string, meta?: any) => console.log(\`[INFO] \${msg}\`, meta ? JSON.stringify(meta) : ''),
  warn: (msg: string, meta?: any) => console.warn(\`[WARN] \${msg}\`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: any) => console.error(\`[ERROR] \${msg}\`, meta ? JSON.stringify(meta) : ''),
  debug: (msg: string, meta?: any) => console.debug(\`[DEBUG] \${msg}\`, meta ? JSON.stringify(meta) : ''),
};
`.trim();
      await fs.writeFile(
        path.join(serverSrcDir, 'logger.ts'),
        standaloneLoggerCode,
        'utf-8'
      );

      // Write minimal standalone package.json
      const agentPackageJson = {
        name: `hyperhost-runtime-node-${appId.toLowerCase()}`,
        version: '1.0.0',
        private: true,
        type: 'module',
        engines: {
          node: '>=22.0.0',
        },
        scripts: {
          start: 'tsx src/runtime/node-agent.ts',
          'start:node-agent': 'tsx src/runtime/node-agent.ts',
        },
        dependencies: {
          tsx: '^4.21.0',
          ws: '^8.18.1',
        },
      };

      await fs.writeFile(
        path.join(gitWorkspaceDir, 'package.json'),
        JSON.stringify(agentPackageJson, null, 2),
        'utf-8'
      );

      // 3. Initialize Git repository and commit files
      await execFileAsync('git', ['init'], { cwd: gitWorkspaceDir });
      await execFileAsync(
        'git',
        ['config', 'user.name', 'HyperHost Provisioner'],
        { cwd: gitWorkspaceDir }
      );
      await execFileAsync(
        'git',
        ['config', 'user.email', 'provisioner@hyperhost.hypersoft'],
        { cwd: gitWorkspaceDir }
      );
      await execFileAsync('git', ['add', '.'], { cwd: gitWorkspaceDir });
      await execFileAsync(
        'git',
        ['commit', '-m', 'Deploy HyperHost Standalone Runtime Node Agent'],
        { cwd: gitWorkspaceDir }
      );

      // 4. Push via SSH using official Clever Cloud deployUrl (git+ssh://...)
      const sshCommand = `ssh -i "${privateKeyPath}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${knownHostsPath}"`;

      logger.info(
        `[CleverCloud] Pushing Runtime Node Agent to Clever Cloud Git remote for ${appId} via SSH...`
      );

      await execFileAsync(
        'git',
        ['push', '--force', rawDeployUrl, 'HEAD:refs/heads/master'],
        {
          cwd: gitWorkspaceDir,
          timeout: 120_000,
          env: {
            ...process.env,
            GIT_SSH_COMMAND: sshCommand,
            GIT_TERMINAL_PROMPT: '0',
          },
        }
      );

      logger.info(
        `[CleverCloud] Successfully deployed Runtime Node Agent to Clever Cloud application ${appId} via SSH.`
      );
    } catch (err) {
      const rawError =
        err instanceof Error ? err.message : 'Git push to Clever Cloud failed';
      const sanitized = rawError
        .replace(
          /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
          '[REDACTED]'
        )
        .replace(
          new RegExp(privateKeyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          '[KEY_PATH]'
        );
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Failed to deploy Runtime Node Agent to Clever Cloud application ${appId} via SSH: ${sanitized}`,
        502
      );
    } finally {
      // Unconditionally delete SSH key directory and Git workspace directory
      await Promise.allSettled([
        fs.rm(sshKeyDir, { recursive: true, force: true }),
        fs.rm(gitWorkspaceDir, { recursive: true, force: true }),
      ]);
    }
  }

  /**
   * Waits for the Clever Cloud Application deployment and runtime instance to reach
   * a real running/ready state using Clever Cloud Public API Bridge:
   *   GET https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/deployments
   *   GET https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/instances
   */
  public async waitUntilReady(serverId: string): Promise<ProvisionedServer> {
    this.validateConfig('BOOTSTRAPPING');

    const baseUrl = this.getBaseUrl();
    const ownerSegment = this.getOwnerPathSegment();
    const deadline = Date.now() + DEPLOYMENT_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const [deploymentsRes, instancesRes] = await Promise.all([
        fetch(
          `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(serverId)}/deployments`,
          {
            method: 'GET',
            headers: this.getAuthHeaders(),
          }
        ),
        fetch(
          `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(serverId)}/instances`,
          {
            method: 'GET',
            headers: this.getAuthHeaders(),
          }
        ),
      ]);

      if (!deploymentsRes.ok && !instancesRes.ok) {
        throw new AppError(
          'BOOTSTRAP_FAILED',
          `Unable to verify Clever Cloud deployment readiness for ${serverId} (HTTP ${deploymentsRes.status}).`,
          502
        );
      }

      if (deploymentsRes.ok) {
        const deployments = (await deploymentsRes.json()) as Array<{
          id?: string;
          state?: string;
          action?: string;
        }>;
        const latestDeployment = Array.isArray(deployments)
          ? deployments[0]
          : undefined;
        const depState = String(latestDeployment?.state || '').toUpperCase();

        if (
          depState === 'FAIL' ||
          depState === 'FAILED' ||
          depState === 'CANCELLED'
        ) {
          throw new AppError(
            'BOOTSTRAP_FAILED',
            `Clever Cloud deployment for application ${serverId} failed with state ${depState}.`,
            502
          );
        }
      }

      if (instancesRes.ok) {
        const instances = (await instancesRes.json()) as Array<{
          id?: string;
          state?: string;
          ip?: string;
          appPort?: number;
        }>;
        const runningInstance = (Array.isArray(instances) ? instances : []).find(
          (inst) => {
            const st = String(inst?.state || '').toUpperCase();
            return (
              st === 'UP' ||
              st === 'RUNNING' ||
              st === 'READY' ||
              st === 'OK'
            );
          }
        );

        if (runningInstance) {
          const cleanSlug = serverId.replace(/^app_/, 'app-');
          return {
            serverId,
            provider: this.providerName,
            ipAddress: String(runningInstance.ip || '0.0.0.0'),
            fqdn: `${cleanSlug}.cleverapps.io`,
            location: `Clever Cloud (${config.cleverCloud.zone || 'par'})`,
            status: 'READY',
          };
        }

        const failedInstance = (Array.isArray(instances) ? instances : []).find(
          (inst) => {
            const st = String(inst?.state || '').toUpperCase();
            return st === 'FAIL' || st === 'FAILED' || st === 'ERROR';
          }
        );
        if (failedInstance) {
          throw new AppError(
            'BOOTSTRAP_FAILED',
            `Clever Cloud application instance for ${serverId} entered state ${failedInstance.state}.`,
            502
          );
        }
      }

      await new Promise((r) => setTimeout(r, DEPLOYMENT_POLL_INTERVAL_MS));
    }

    throw new AppError(
      'BOOTSTRAP_FAILED',
      `Timed out waiting for Clever Cloud application ${serverId} deployment to become ready.`,
      504
    );
  }

  /**
   * Deletes the dedicated Clever Cloud Application when the Host is deleted:
   *   DELETE https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}
   */
  public async destroyServer(serverId: string): Promise<void> {
    this.validateConfig('PROVISIONING');

    const baseUrl = this.getBaseUrl();
    const ownerSegment = this.getOwnerPathSegment();
    const res = await fetch(
      `${baseUrl}${ownerSegment}/applications/${encodeURIComponent(serverId)}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );

    // 404 means the Clever Cloud Application was already deleted
    if (!res.ok && res.status !== 404) {
      throw new AppError(
        'INFRASTRUCTURE_DESTROY_FAILED',
        `Clever Cloud API Bridge failed to delete application ${serverId} (HTTP ${res.status}).`,
        502
      );
    }
  }
}

