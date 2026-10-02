import type {
  HostRuntimeCode,
  HostStatusCode,
  NodeStatusCode,
} from '../shared/types';

export interface ContainerResourceSpec {
  memoryLimitMb: number;
  cpuLimitPercent: number;
  diskLimitMb: number;
  networkBandwidthMbps?: number;
}

export interface NodeResourceTelemetry {
  cpuUsagePercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsedMb: number;
  diskTotalMb: number;
  activeContainers: number;
}

export interface NodeCapabilities {
  version: string;
  supportedRuntimes: HostRuntimeCode[];
  osPlatform?: string;
  architecture?: string;
}

export interface RuntimeExecutionSpec {
  hostId: string;
  runtime: HostRuntimeCode;
  runtimeVersion: string;
  dockerImage: string;
  startupCommand: string;
  startupArgs: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  resources: ContainerResourceSpec;
  allocations: Array<{
    ipAddress: string;
    port: number;
    protocol: 'TCP' | 'UDP' | 'BOTH';
    isPrimary: boolean;
  }>;
}

export interface HostLiveMetrics {
  hostId: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  diskLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeSeconds: number;
  state: HostStatusCode;
  collectedAt: string;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  permissions: string;
}

export interface ConsoleStreamFrame {
  type: 'stdout' | 'stderr' | 'status' | 'system';
  data: string;
  timestamp: string;
}

export interface RuntimeAdapter {
  readonly runtime: HostRuntimeCode;
  resolveDockerImage(version: string): string;
  buildEntrypointCommand(
    command: string,
    args: string[],
    resources: ContainerResourceSpec
  ): string[];
}

export interface ProcessManager {
  start(hostId: string, spec: RuntimeExecutionSpec): Promise<void>;
  stop(hostId: string, timeoutSeconds?: number): Promise<void>;
  restart(hostId: string, spec: RuntimeExecutionSpec): Promise<void>;
  kill(hostId: string): Promise<void>;
  sendStdin(hostId: string, commandLine: string): Promise<void>;
}

export interface ContainerManager {
  createContainer(spec: RuntimeExecutionSpec): Promise<{ containerId: string }>;
  removeContainer(hostId: string): Promise<void>;
  reinstallContainer(spec: RuntimeExecutionSpec): Promise<void>;
  inspectState(hostId: string): Promise<HostStatusCode>;
}

export interface FileManager {
  listDirectory(hostId: string, dirPath: string): Promise<RemoteFileEntry[]>;
  readFile(hostId: string, filePath: string): Promise<string>;
  writeFile(hostId: string, filePath: string, content: string): Promise<void>;
  createDirectory(hostId: string, dirPath: string): Promise<void>;
  renamePath(hostId: string, sourcePath: string, targetPath: string): Promise<void>;
  movePath(hostId: string, sourcePath: string, targetPath: string): Promise<void>;
  deletePath(hostId: string, targetPath: string): Promise<void>;
  getDownloadStreamUrl(
    hostId: string,
    filePath: string
  ): Promise<{ signedUrl: string; expiresAt: string }>;
}

export interface MetricsCollector {
  collectHostMetrics(hostId: string): Promise<HostLiveMetrics>;
  collectNodeTelemetry(): Promise<NodeResourceTelemetry>;
}

export interface DatabaseProvisioner {
  provisionDatabase(params: {
    hostId: string;
    engine: 'POSTGRESQL' | 'MYSQL' | 'MONGODB' | 'REDIS';
    databaseName: string;
    username: string;
    passwordPlain: string;
    remoteHost: string;
  }): Promise<{
    hostAddress: string;
    port: number;
  }>;
  deprovisionDatabase(params: {
    engine: 'POSTGRESQL' | 'MYSQL' | 'MONGODB' | 'REDIS';
    databaseName: string;
    username: string;
  }): Promise<void>;
}

export interface BackupStorageAdapter {
  createArchiveSnapshot(params: {
    hostId: string;
    backupId: string;
  }): Promise<{
    storageKey: string;
    sizeBytes: bigint;
    checksumSha256: string;
  }>;
  restoreArchiveSnapshot(params: {
    hostId: string;
    backupId: string;
    storageKey: string;
  }): Promise<void>;
  deleteArchiveSnapshot(storageKey: string): Promise<void>;
  generatePresignedDownloadUrl(
    storageKey: string
  ): Promise<{ url: string; expiresAt: string }>;
}

export interface CreateRuntimeServerInput {
  hostId: string;
  hostPublicId: string;
  hostName: string;
  nodeId: string;
  runtime: HostRuntimeCode;
  runtimeVersion: string;
  memoryLimitMb: number;
  cpuLimitPercent: number;
  diskLimitMb: number;
  bootstrapScript: string;
}

export interface ProvisionedServer {
  serverId: string;
  provider: string;
  ipAddress: string;
  fqdn: string;
  location: string;
  status: 'CREATING' | 'BOOTING' | 'READY' | 'ERROR';
  deployUrl?: string;
}

export interface BootstrapRuntimeNodeInput {
  server: ProvisionedServer;
  hostId: string;
  nodeId: string;
  controlPlaneWsUrl: string;
  nodeToken: string;
  bootstrapScript: string;
}

export interface RuntimeProvisioner {
  readonly providerName: string;
  isConfigured(): boolean;
  createServer(input: CreateRuntimeServerInput): Promise<ProvisionedServer>;
  waitUntilReady(serverId: string): Promise<ProvisionedServer>;
  bootstrapNode(input: BootstrapRuntimeNodeInput): Promise<void>;
  destroyServer(serverId: string): Promise<void>;
}

export interface NodeAgent {
  readonly nodeId: string;
  readonly fqdn: string;
  readonly isConnected: boolean;
  readonly handshakeCompleted: boolean;
  readonly status: NodeStatusCode;
  readonly capabilities: NodeCapabilities;
  readonly resources: NodeResourceTelemetry | null;
  readonly lastHeartbeatAt: Date | null;
  readonly processManager: ProcessManager;
  readonly containerManager: ContainerManager;
  readonly fileManager: FileManager;
  readonly metricsCollector: MetricsCollector;
  readonly databaseProvisioner: DatabaseProvisioner;
  readonly backupStorage: BackupStorageAdapter;
  subscribeConsole(
    hostId: string,
    onFrame: (frame: ConsoleStreamFrame) => void
  ): () => void;
  recordHeartbeat(telemetry?: Partial<NodeResourceTelemetry>, status?: NodeStatusCode): void;
  disconnect(): void;
}
