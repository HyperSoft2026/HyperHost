import type {
  NodeAgent,
  RuntimeAdapter,
  ContainerResourceSpec,
} from './interfaces';
import {
  normalizeLocale,
  RUNTIME_CATALOG,
  type HostRuntimeCode,
  type NodeStatusCode,
  type SupportedLocale,
} from '../shared/types';
import { AppError } from '../server/errors';

export const NODE_HEARTBEAT_TIMEOUT_MS = 60_000;

export function getRuntimeUnavailableLocalizedMessage(
  localeInput?: SupportedLocale | string | null
): string {
  const locale = normalizeLocale(localeInput);
  if (locale === 'en-US') {
    return 'No runtime node is currently available. The host will start when a runtime node becomes available.';
  }
  return 'لا توجد عقدة تشغيل متاحة حاليًا. ستبدأ الاستضافة بعد توفر عقدة تشغيل.';
}

class StandardRuntimeAdapter implements RuntimeAdapter {
  constructor(public readonly runtime: HostRuntimeCode) {}

  resolveDockerImage(version: string): string {
    const entry = RUNTIME_CATALOG.find((r) => r.code === this.runtime);
    if (!entry) {
      return `ghcr.io/hypersoft2026/runtime-${this.runtime.toLowerCase()}:${version}`;
    }
    const base = entry.defaultDockerImage.split(':')[0];
    return `${base}:${version || entry.defaultVersion}`;
  }

  buildEntrypointCommand(
    command: string,
    args: string[],
    resources: ContainerResourceSpec
  ): string[] {
    const interpolatedCommand = command.replace(
      /\{\{MEMORY\}\}/g,
      String(resources.memoryLimitMb)
    );
    return [interpolatedCommand, ...args];
  }
}

export class RuntimeNodeRegistry {
  private readonly connectedAgents = new Map<string, NodeAgent>();
  private readonly runtimeAdapters = new Map<HostRuntimeCode, RuntimeAdapter>();

  constructor() {
    for (const item of RUNTIME_CATALOG) {
      this.runtimeAdapters.set(
        item.code,
        new StandardRuntimeAdapter(item.code)
      );
    }
  }

  public registerAgent(agent: NodeAgent): void {
    const existing = this.connectedAgents.get(agent.nodeId);
    if (existing && existing !== agent) {
      try {
        existing.disconnect();
      } catch {
        // Ignore stale disconnect errors
      }
    }
    this.connectedAgents.set(agent.nodeId, agent);
  }

  public unregisterAgent(nodeId: string, expectedAgent?: NodeAgent): boolean {
    const existing = this.connectedAgents.get(nodeId);
    if (!existing) {
      return false;
    }
    if (expectedAgent && existing !== expectedAgent) {
      return false;
    }
    this.connectedAgents.delete(nodeId);
    return true;
  }

  /**
   * A Node is ONLY considered connected if it completed registration, authentication,
   * capability handshake, and has a fresh heartbeat within NODE_HEARTBEAT_TIMEOUT_MS.
   */
  public isNodeConnected(nodeId: string | null | undefined): boolean {
    if (!nodeId) return false;
    const agent = this.connectedAgents.get(nodeId);
    if (!agent || !agent.isConnected || !agent.handshakeCompleted) {
      return false;
    }
    if (!agent.lastHeartbeatAt) {
      return false;
    }
    const ageMs = Date.now() - agent.lastHeartbeatAt.getTime();
    if (ageMs > NODE_HEARTBEAT_TIMEOUT_MS) {
      return false;
    }
    return agent.status === 'ONLINE' || agent.status === 'DEGRADED';
  }

  public getNodeEffectiveStatus(
    nodeId: string | null | undefined,
    dbStatus: NodeStatusCode = 'OFFLINE'
  ): NodeStatusCode {
    if (dbStatus === 'MAINTENANCE' || dbStatus === 'DRAINING') {
      return dbStatus;
    }
    if (!nodeId) return 'OFFLINE';
    const agent = this.connectedAgents.get(nodeId);
    if (!agent || !this.isNodeConnected(nodeId)) {
      return 'OFFLINE';
    }
    return agent.status;
  }

  public getConnectedNodeCount(): number {
    let count = 0;
    for (const nodeId of this.connectedAgents.keys()) {
      if (this.isNodeConnected(nodeId)) {
        count++;
      }
    }
    return count;
  }

  public getConnectedAgents(): NodeAgent[] {
    const list: NodeAgent[] = [];
    for (const [nodeId, agent] of this.connectedAgents.entries()) {
      if (this.isNodeConnected(nodeId)) {
        list.push(agent);
      }
    }
    return list;
  }

  /**
   * Selects an authenticated, ONLINE (not DRAINING/MAINTENANCE) Runtime Node
   * that supports the requested runtime. Returns null if no live Node is available.
   */
  public selectOptimalConnectedNode(runtime: HostRuntimeCode): NodeAgent | null {
    for (const agent of this.getConnectedAgents()) {
      if (
        agent.status === 'ONLINE' &&
        agent.capabilities.supportedRuntimes.includes(runtime)
      ) {
        return agent;
      }
    }
    return null;
  }

  public getAgentOrNull(nodeId: string | null | undefined): NodeAgent | null {
    if (!nodeId) return null;
    if (!this.isNodeConnected(nodeId)) return null;
    return this.connectedAgents.get(nodeId) ?? null;
  }

  public requireConnectedAgent(
    nodeId: string | null | undefined,
    locale?: SupportedLocale | string | null
  ): NodeAgent {
    const agent = this.getAgentOrNull(nodeId);
    if (!agent) {
      throw new AppError(
        'RUNTIME_NODE_UNAVAILABLE',
        getRuntimeUnavailableLocalizedMessage(locale),
        503,
        {
          reason: 'RUNTIME_NODE_UNAVAILABLE',
          nodeId: nodeId ?? null,
        }
      );
    }
    return agent;
  }

  public getRuntimeAdapter(runtime: HostRuntimeCode): RuntimeAdapter {
    const adapter = this.runtimeAdapters.get(runtime);
    if (!adapter) {
      throw new AppError(
        'UNSUPPORTED_RUNTIME',
        `Runtime ${runtime} does not have a registered adapter.`,
        400
      );
    }
    return adapter;
  }
}

export const runtimeRegistry = new RuntimeNodeRegistry();
