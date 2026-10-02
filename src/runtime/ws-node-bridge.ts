import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  BackupStorageAdapter,
  ConsoleStreamFrame,
  ContainerManager,
  DatabaseProvisioner,
  FileManager,
  HostLiveMetrics,
  MetricsCollector,
  NodeAgent,
  NodeCapabilities,
  NodeResourceTelemetry,
  ProcessManager,
  RemoteFileEntry,
  RuntimeExecutionSpec,
} from './interfaces';
import type {
  HostRuntimeCode,
  HostStatusCode,
  NodeStatusCode,
} from '../shared/types';
import { AppError } from '../server/errors';

interface PendingRpc {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class WebSocketNodeAgent implements NodeAgent {
  public isConnected = true;
  public handshakeCompleted = false;
  public status: NodeStatusCode = 'OFFLINE';
  public capabilities: NodeCapabilities = {
    version: '1.0.0',
    supportedRuntimes: ['NODEJS', 'PYTHON', 'JAVA', 'GO', 'RUST'],
  };
  public resources: NodeResourceTelemetry | null = null;
  public lastHeartbeatAt: Date | null = null;

  private readonly pendingRpcs = new Map<string, PendingRpc>();
  private readonly consoleSubscribers = new Map<
    string,
    Set<(frame: ConsoleStreamFrame) => void>
  >();
  private readonly consoleBuffers = new Map<string, ConsoleStreamFrame[]>();

  public readonly processManager: ProcessManager;
  public readonly containerManager: ContainerManager;
  public readonly fileManager: FileManager;
  public readonly metricsCollector: MetricsCollector;
  public readonly databaseProvisioner: DatabaseProvisioner;
  public readonly backupStorage: BackupStorageAdapter;

  constructor(
    public readonly nodeId: string,
    public readonly fqdn: string,
    private readonly socket: WebSocket,
    private readonly onHostStateUpdate?: (
      hostId: string,
      status: HostStatusCode
    ) => void
  ) {
    this.processManager = {
      start: async (hostId: string, spec: RuntimeExecutionSpec) => {
        await this.sendRpc('process.start', { hostId, spec });
      },
      stop: async (hostId: string, timeoutSeconds = 10) => {
        await this.sendRpc('process.stop', { hostId, timeoutSeconds });
      },
      restart: async (hostId: string, spec: RuntimeExecutionSpec) => {
        await this.sendRpc('process.restart', { hostId, spec });
      },
      kill: async (hostId: string) => {
        await this.sendRpc('process.kill', { hostId });
      },
      sendStdin: async (hostId: string, commandLine: string) => {
        await this.sendRpc('process.stdin', { hostId, commandLine });
      },
    };

    this.containerManager = {
      createContainer: async (spec: RuntimeExecutionSpec) => {
        return this.sendRpc('container.create', { spec });
      },
      removeContainer: async (hostId: string) => {
        await this.sendRpc('container.remove', { hostId });
      },
      reinstallContainer: async (spec: RuntimeExecutionSpec) => {
        await this.sendRpc('container.reinstall', { spec });
      },
      inspectState: async (hostId: string) => {
        const res = await this.sendRpc('container.inspect', { hostId });
        if (typeof res === 'string') {
          return res as HostStatusCode;
        }
        if (res && typeof res === 'object' && typeof res.status === 'string') {
          return res.status as HostStatusCode;
        }
        return res?.running ? 'RUNNING' : 'STOPPED';
      },
    };

    this.fileManager = {
      listDirectory: async (hostId: string, dirPath: string): Promise<RemoteFileEntry[]> => {
        return this.sendRpc('files.list', { hostId, path: dirPath });
      },
      readFile: async (hostId: string, filePath: string): Promise<string> => {
        const res = await this.sendRpc('files.read', { hostId, path: filePath });
        return typeof res?.content === 'string' ? res.content : String(res ?? '');
      },
      writeFile: async (hostId: string, filePath: string, content: string) => {
        await this.sendRpc('files.write', { hostId, path: filePath, content });
      },
      createDirectory: async (hostId: string, dirPath: string) => {
        await this.sendRpc('files.mkdir', { hostId, path: dirPath });
      },
      renamePath: async (hostId: string, sourcePath: string, targetPath: string) => {
        await this.sendRpc('files.rename', { hostId, sourcePath, targetPath });
      },
      movePath: async (hostId: string, sourcePath: string, targetPath: string) => {
        await this.sendRpc('files.move', { hostId, sourcePath, targetPath });
      },
      deletePath: async (hostId: string, targetPath: string) => {
        await this.sendRpc('files.delete', { hostId, path: targetPath });
      },
      getDownloadStreamUrl: async (hostId: string, filePath: string) => {
        return this.sendRpc('files.downloadUrl', { hostId, path: filePath });
      },
    };

    this.metricsCollector = {
      collectHostMetrics: async (hostId: string): Promise<HostLiveMetrics> => {
        return this.sendRpc('metrics.host', { hostId });
      },
      collectNodeTelemetry: async (): Promise<NodeResourceTelemetry> => {
        if (this.resources) return this.resources;
        return this.sendRpc('metrics.node', {});
      },
    };

    this.databaseProvisioner = {
      provisionDatabase: async (params) => {
        return this.sendRpc('database.provision', params);
      },
      deprovisionDatabase: async (params) => {
        await this.sendRpc('database.deprovision', params);
      },
    };

    this.backupStorage = {
      createArchiveSnapshot: async (params) => {
        const res = await this.sendRpc('backup.create', params);
        return {
          storageKey: res.storageKey,
          sizeBytes: BigInt(res.sizeBytes || 0),
          checksumSha256: res.checksumSha256,
        };
      },
      restoreArchiveSnapshot: async (params) => {
        await this.sendRpc('backup.restore', params);
      },
      deleteArchiveSnapshot: async (storageKey: string) => {
        await this.sendRpc('backup.delete', { storageKey });
      },
      generatePresignedDownloadUrl: async (storageKey: string) => {
        return this.sendRpc('backup.downloadUrl', { storageKey });
      },
    };
  }

  public completeHandshake(
    capabilities: Partial<NodeCapabilities>,
    resources?: Partial<NodeResourceTelemetry>
  ): void {
    this.handshakeCompleted = true;
    this.status = 'ONLINE';
    this.lastHeartbeatAt = new Date();
    this.capabilities = {
      version: capabilities.version || '1.0.0',
      supportedRuntimes:
        Array.isArray(capabilities.supportedRuntimes) &&
        capabilities.supportedRuntimes.length > 0
          ? (capabilities.supportedRuntimes as HostRuntimeCode[])
          : ['NODEJS', 'PYTHON', 'JAVA', 'GO', 'RUST'],
      osPlatform: capabilities.osPlatform,
      architecture: capabilities.architecture,
    };
    if (resources) {
      this.recordHeartbeat(resources, 'ONLINE');
    }
  }

  public recordHeartbeat(
    telemetry?: Partial<NodeResourceTelemetry>,
    status: NodeStatusCode = 'ONLINE'
  ): void {
    this.lastHeartbeatAt = new Date();
    this.status = status;
    if (telemetry) {
      this.resources = {
        cpuUsagePercent: Number(telemetry.cpuUsagePercent ?? 0),
        memoryUsedMb: Number(telemetry.memoryUsedMb ?? 0),
        memoryTotalMb: Number(telemetry.memoryTotalMb ?? 0),
        diskUsedMb: Number(telemetry.diskUsedMb ?? 0),
        diskTotalMb: Number(telemetry.diskTotalMb ?? 0),
        activeContainers: Number(telemetry.activeContainers ?? 0),
      };
    }
  }

  public handleIncomingFrame(raw: string): void {
    try {
      const msg = JSON.parse(raw) as {
        type?: string;
        requestId?: string;
        ok?: boolean;
        result?: any;
        error?: string;
        hostId?: string;
        stream?: 'stdout' | 'stderr' | 'status' | 'system';
        data?: string;
        status?: HostStatusCode;
        timestamp?: string;
      };

      if (msg.type === 'rpc_response' && msg.requestId) {
        const pending = this.pendingRpcs.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRpcs.delete(msg.requestId);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(
            new AppError(
              'RUNTIME_EXECUTION_ERROR',
              msg.error || 'Runtime Node operation failed.',
              502
            )
          );
        }
        return;
      }

      if (msg.type === 'console' && msg.hostId) {
        const frame: ConsoleStreamFrame = {
          type: msg.stream || 'stdout',
          data: String(msg.data ?? ''),
          timestamp: msg.timestamp || new Date().toISOString(),
        };
        let buf = this.consoleBuffers.get(msg.hostId);
        if (!buf) {
          buf = [];
          this.consoleBuffers.set(msg.hostId, buf);
        }
        buf.push(frame);
        if (buf.length > 100) {
          buf.shift();
        }
        const subs = this.consoleSubscribers.get(msg.hostId);
        if (subs && subs.size > 0) {
          for (const cb of subs) {
            cb(frame);
          }
        }
        return;
      }

      if (msg.type === 'host_status' && msg.hostId && msg.status) {
        this.onHostStateUpdate?.(msg.hostId, msg.status);
      }
    } catch {
      // Ignore malformed frame
    }
  }

  public subscribeConsole(
    hostId: string,
    onFrame: (frame: ConsoleStreamFrame) => void
  ): () => void {
    let set = this.consoleSubscribers.get(hostId);
    if (!set) {
      set = new Set();
      this.consoleSubscribers.set(hostId, set);
    }
    set.add(onFrame);

    const buffered = this.consoleBuffers.get(hostId);
    if (buffered && buffered.length > 0) {
      for (const frame of buffered) {
        try {
          onFrame(frame);
        } catch {
          // Ignore subscriber callback error
        }
      }
    }

    return () => {
      const current = this.consoleSubscribers.get(hostId);
      if (current) {
        current.delete(onFrame);
        if (current.size === 0) {
          this.consoleSubscribers.delete(hostId);
        }
      }
    };
  }

  public disconnect(): void {
    this.isConnected = false;
    this.status = 'OFFLINE';
    for (const [id, pending] of this.pendingRpcs.entries()) {
      clearTimeout(pending.timer);
      pending.reject(
        new AppError(
          'RUNTIME_NODE_DISCONNECTED',
          'Runtime Node disconnected while processing operation.',
          503
        )
      );
      this.pendingRpcs.delete(id);
    }
    try {
      this.socket.close();
    } catch {
      // Ignore socket close error
    }
  }

  private sendRpc(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.isConnected || !this.handshakeCompleted || this.socket.readyState !== 1) {
      return Promise.reject(
        new AppError(
          'RUNTIME_NODE_UNAVAILABLE',
          'Runtime Node is not connected.',
          503
        )
      );
    }

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcs.delete(requestId);
        reject(
          new AppError(
            'RUNTIME_RPC_TIMEOUT',
            `Runtime Node timed out executing ${method}.`,
            504
          )
        );
      }, 15_000);

      this.pendingRpcs.set(requestId, { resolve, reject, timer });

      this.socket.send(
        JSON.stringify({
          type: 'rpc_request',
          requestId,
          method,
          params,
        })
      );
    });
  }
}
