/**
 * HyperHost Clever Cloud Runtime Provisioner
 * Powered by HyperSoft
 *
 * Implements Automatic Per-Host Runtime Provisioning using the official
 * Clever Cloud Public API (https://api.clever-cloud.com/).
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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  BootstrapRuntimeNodeInput,
  CreateRuntimeServerInput,
  ProvisionedServer,
  RuntimeProvisioner,
} from '../interfaces';
import { config } from '../../server/config';
import { AppError } from '../../server/errors';
import { logger } from '../../server/logger';

const execFileAsync = promisify(execFile);

const CLEVER_CLOUD_BASE_URL = 'https://api.clever-cloud.com';
const DEPLOYMENT_READY_TIMEOUT_MS = 180_000;
const DEPLOYMENT_POLL_INTERVAL_MS = 3_000;

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

  public isConfigured(): boolean {
    return Boolean(
      config.cleverCloud.apiToken && config.cleverCloud.organisationId
    );
  }

  private getOwnerPathSegment(): string {
    const orgId = config.cleverCloud.organisationId?.trim();
    if (!orgId) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud provisioning is not configured: CLEVER_CLOUD_ORGANISATION_ID is missing.',
        503
      );
    }
    if (orgId.toLowerCase() === 'self') {
      return '/v2/self';
    }
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
   * Queries GET https://api.clever-cloud.com/v2/products/instances to dynamically resolve
   * the active Node.js instance type, version, and variant ID on Clever Cloud.
   */
  private async resolveNodeJsInstanceProduct(): Promise<{
    instanceType: string;
    instanceVersion: string;
    instanceVariant: string;
  }> {
    const res = await fetch(`${CLEVER_CLOUD_BASE_URL}/v2/products/instances`, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) {
      throw new AppError(
        'PROVISIONING_FAILED',
        `Clever Cloud API error while resolving Node.js runtime product (HTTP ${res.status}).`,
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
        'Clever Cloud API did not return an enabled Node.js instance variant.',
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
   *   Endpoint: POST https://api.clever-cloud.com/v2/organisations/{orgId}/applications
   */
  public async createServer(
    input: CreateRuntimeServerInput
  ): Promise<ProvisionedServer> {
    if (!this.isConfigured()) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Unable to provision runtime application on Clever Cloud: CLEVER_CLOUD_API_TOKEN and CLEVER_CLOUD_ORGANISATION_ID must be configured in the Control Plane.',
        503
      );
    }

    const ownerSegment = this.getOwnerPathSegment();
    const { instanceType, instanceVersion, instanceVariant } =
      await this.resolveNodeJsInstanceProduct();

    const appName = `hyperhost-runtime-${input.hostPublicId}`;
    const flavor = selectCleverCloudFlavor(input.memoryLimitMb);
    const zone = config.cleverCloud.zone || 'par';

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
      `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(createPayload),
      }
    );

    if (!res.ok) {
      throw new AppError(
        'PROVISIONING_FAILED',
        `Clever Cloud API failed to create application "${appName}" (HTTP ${res.status}).`,
        502
      );
    }

    const appData = (await res.json()) as CleverCloudApplicationResponse;
    const appId = String(appData?.id || '').trim();
    if (!appId) {
      throw new AppError(
        'PROVISIONING_FAILED',
        'Clever Cloud API did not return an application ID.',
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
   * 1. PUT /v2/organisations/{orgId}/applications/{appId}/env
   * 2. Git push of the standalone Runtime Node Agent package to Clever Cloud's deployUrl
   * 3. POST /v2/organisations/{orgId}/applications/{appId}/instances (ensures instance startup)
   */
  public async bootstrapNode(input: BootstrapRuntimeNodeInput): Promise<void> {
    if (!this.isConfigured()) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        'Clever Cloud credentials are not configured.',
        503
      );
    }

    const appId = input.server.serverId;
    const ownerSegment = this.getOwnerPathSegment();

    // 1. Configure per-Host Runtime Node environment variables on the Clever Cloud Application
    const envPayload: Record<string, string> = {
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

    const envRes = await fetch(
      `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(appId)}/env`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(envPayload),
      }
    );

    if (!envRes.ok) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud API failed to configure Runtime Node environment variables on ${appId} (HTTP ${envRes.status}).`,
        502
      );
    }

    // 2. Resolve deployUrl from server metadata or Clever Cloud Application details
    let deployUrl = input.server.deployUrl;
    if (!deployUrl) {
      const appRes = await fetch(
        `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(appId)}`,
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
      `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(appId)}/instances`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
      }
    );

    // Note: Clever Cloud returns 200/201/202 or 400 if the Git push already started the deployment
    if (!redeployRes.ok && redeployRes.status >= 500) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Clever Cloud API failed to start instances for application ${appId} (HTTP ${redeployRes.status}).`,
        502
      );
    }
  }

  /**
   * Builds a clean temporary Git repository containing the standalone Runtime Node Agent
   * (`src/runtime/node-agent.ts` + minimal `package.json` + `tsconfig.json`) and pushes
   * it directly to the Clever Cloud Application's Git remote (`deployUrl`).
   */
  private async pushNodeAgentToCleverCloudGit(
    appId: string,
    rawDeployUrl: string
  ): Promise<void> {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `hyperhost-cc-deploy-${appId}-`)
    );

    try {
      const srcAgentPath = path.resolve(
        process.cwd(),
        'src/runtime/node-agent.ts'
      );
      const agentCode = await fs.readFile(srcAgentPath, 'utf-8');

      const runtimeSrcDir = path.join(tmpDir, 'src', 'runtime');
      await fs.mkdir(runtimeSrcDir, { recursive: true });
      await fs.writeFile(
        path.join(runtimeSrcDir, 'node-agent.ts'),
        agentCode,
        'utf-8'
      );

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
        path.join(tmpDir, 'package.json'),
        JSON.stringify(agentPackageJson, null, 2),
        'utf-8'
      );

      const authenticatedRemoteUrl = this.buildAuthenticatedGitUrl(rawDeployUrl);

      await execFileAsync('git', ['init'], { cwd: tmpDir });
      await execFileAsync('git', ['config', 'user.name', 'HyperHost Provisioner'], {
        cwd: tmpDir,
      });
      await execFileAsync(
        'git',
        ['config', 'user.email', 'provisioner@hyperhost.hypersoft'],
        { cwd: tmpDir }
      );
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync(
        'git',
        ['commit', '-m', 'Deploy HyperHost Standalone Runtime Node Agent'],
        { cwd: tmpDir }
      );
      await execFileAsync(
        'git',
        ['push', '--force', authenticatedRemoteUrl, 'HEAD:refs/heads/master'],
        {
          cwd: tmpDir,
          timeout: 90_000,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
          },
        }
      );
    } catch (err) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        `Failed to deploy Runtime Node Agent to Clever Cloud application ${appId}: ${
          err instanceof Error
            ? err.message.replace(/https:\/\/[^@\s]+@/g, 'https://[REDACTED]@')
            : 'Git push failed'
        }`,
        502
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => null);
    }
  }

  private buildAuthenticatedGitUrl(rawDeployUrl: string): string {
    const token = config.cleverCloud.apiToken?.trim() || '';
    const secret =
      config.cleverCloud.apiSecret?.trim() ||
      config.cleverCloud.apiToken?.trim() ||
      '';

    let httpsUrl = rawDeployUrl.trim();
    if (httpsUrl.startsWith('git+ssh://git@')) {
      httpsUrl = httpsUrl.replace(/^git\+ssh:\/\/git@/, 'https://');
    } else if (httpsUrl.startsWith('ssh://git@')) {
      httpsUrl = httpsUrl.replace(/^ssh:\/\/git@/, 'https://');
    }

    try {
      const parsed = new URL(httpsUrl);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        token
      ) {
        parsed.username = encodeURIComponent(token);
        parsed.password = encodeURIComponent(secret);
        return parsed.toString();
      }
    } catch {
      // Fallback to rawDeployUrl if not a standard URL
    }
    return rawDeployUrl;
  }

  /**
   * Waits for the Clever Cloud Application deployment and runtime instance to reach
   * a real running/ready state using Clever Cloud Public API:
   *   GET /v2/organisations/{orgId}/applications/{appId}/deployments
   *   GET /v2/organisations/{orgId}/applications/{appId}/instances
   */
  public async waitUntilReady(serverId: string): Promise<ProvisionedServer> {
    if (!this.isConfigured()) {
      throw new AppError(
        'BOOTSTRAP_FAILED',
        'Clever Cloud credentials are not configured.',
        503
      );
    }

    const ownerSegment = this.getOwnerPathSegment();
    const deadline = Date.now() + DEPLOYMENT_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const [deploymentsRes, instancesRes] = await Promise.all([
        fetch(
          `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(serverId)}/deployments`,
          {
            method: 'GET',
            headers: this.getAuthHeaders(),
          }
        ),
        fetch(
          `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(serverId)}/instances`,
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

        if (depState === 'FAIL' || depState === 'FAILED' || depState === 'CANCELLED') {
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
            return st === 'UP' || st === 'RUNNING' || st === 'READY' || st === 'OK';
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
   *   DELETE https://api.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}
   */
  public async destroyServer(serverId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new AppError(
        'INFRASTRUCTURE_DESTROY_FAILED',
        'Cannot delete Clever Cloud Application: Clever Cloud API credentials are not configured.',
        503
      );
    }

    const ownerSegment = this.getOwnerPathSegment();
    const res = await fetch(
      `${CLEVER_CLOUD_BASE_URL}${ownerSegment}/applications/${encodeURIComponent(serverId)}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );

    // 404 means the Clever Cloud Application was already deleted
    if (!res.ok && res.status !== 404) {
      throw new AppError(
        'INFRASTRUCTURE_DESTROY_FAILED',
        `Clever Cloud API failed to delete application ${serverId} (HTTP ${res.status}).`,
        502
      );
    }
  }
}
