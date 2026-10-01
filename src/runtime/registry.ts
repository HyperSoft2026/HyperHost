import type {
  NodeAgent,
  RuntimeAdapter,
  ContainerResourceSpec,
} from './interfaces';
import { RUNTIME_CATALOG, type HostRuntimeCode } from '../shared/types';
import { AppError } from '../server/errors';

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
    this.connectedAgents.set(agent.nodeId, agent);
  }

  public unregisterAgent(nodeId: string): void {
    this.connectedAgents.delete(nodeId);
  }

  public isNodeConnected(nodeId: string | null | undefined): boolean {
    if (!nodeId) return false;
    const agent = this.connectedAgents.get(nodeId);
    return Boolean(agent && agent.isConnected);
  }

  public getConnectedNodeCount(): number {
    let count = 0;
    for (const agent of this.connectedAgents.values()) {
      if (agent.isConnected) count++;
    }
    return count;
  }

  public getAgentOrNull(nodeId: string | null | undefined): NodeAgent | null {
    if (!nodeId) return null;
    const agent = this.connectedAgents.get(nodeId);
    if (!agent || !agent.isConnected) return null;
    return agent;
  }

  public requireConnectedAgent(nodeId: string | null | undefined): NodeAgent {
    const agent = this.getAgentOrNull(nodeId);
    if (!agent) {
      throw new AppError(
        'RUNTIME_NODE_UNAVAILABLE',
        'No runtime node is currently available.',
        503
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
