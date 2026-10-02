export const MAX_HOSTS_PER_USER = 10;

export const supportedLocales = [
  "ar-IQ",
  "en-US",
] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export function normalizeLocale(input?: string | null): SupportedLocale {
  if (!input) return "ar-IQ";
  const trimmed = input.trim();
  if (trimmed === "ar-IQ" || trimmed === "en-US") {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("ar")) return "ar-IQ";
  if (lower.startsWith("en")) return "en-US";
  return "ar-IQ";
}

export const HOST_PERMISSIONS = [
  'console.read',
  'console.write',
  'files.read',
  'files.write',
  'startup.read',
  'startup.write',
  'network.read',
  'network.write',
  'metrics.read',
  'management.start',
  'management.stop',
  'management.restart',
  'databases.read',
  'databases.write',
  'schedules.read',
  'schedules.write',
  'backups.read',
  'backups.write',
  'settings.read',
  'settings.write',
  'activity.read',
] as const;

export type HostPermissionScope = (typeof HOST_PERMISSIONS)[number];

export type HostTypeCode =
  | 'DISCORD_BOT'
  | 'TELEGRAM_BOT'
  | 'NODEJS_APP'
  | 'PYTHON_APP'
  | 'JAVA_APP'
  | 'GO_APP'
  | 'RUST_APP'
  | 'CUSTOM';

export type HostRuntimeCode =
  | 'NODEJS'
  | 'PYTHON'
  | 'JAVA'
  | 'GO'
  | 'RUST'
  | 'PHP'
  | 'RUBY'
  | 'DOTNET'
  | 'CPP';

export type HostStatusCode =
  | 'CREATING'
  | 'PENDING'
  | 'INSTALLING'
  | 'OFFLINE'
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'ONLINE'
  | 'STOPPING'
  | 'SUSPENDED'
  | 'ERROR';

export type NodeStatusCode =
  | 'ONLINE'
  | 'OFFLINE'
  | 'DEGRADED'
  | 'DRAINING'
  | 'MAINTENANCE';

export interface RuntimeCatalogItem {
  code: HostRuntimeCode;
  label: string;
  supportedNow: boolean;
  defaultVersion: string;
  availableVersions: string[];
  defaultStartupCommand: string;
  defaultDockerImage: string;
}

export const RUNTIME_CATALOG: RuntimeCatalogItem[] = [
  {
    code: 'NODEJS',
    label: 'Node.js',
    supportedNow: true,
    defaultVersion: '22',
    availableVersions: ['24', '22', '20'],
    defaultStartupCommand: 'node index.js',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-nodejs:22',
  },
  {
    code: 'PYTHON',
    label: 'Python',
    supportedNow: true,
    defaultVersion: '3.12',
    availableVersions: ['3.13', '3.12', '3.11'],
    defaultStartupCommand: 'python main.py',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-python:3.12',
  },
  {
    code: 'JAVA',
    label: 'Java',
    supportedNow: true,
    defaultVersion: '21',
    availableVersions: ['21', '17'],
    defaultStartupCommand: 'java -Xms128M -Xmx{{MEMORY}}M -jar app.jar',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-java:21',
  },
  {
    code: 'GO',
    label: 'Go',
    supportedNow: true,
    defaultVersion: '1.23',
    availableVersions: ['1.23', '1.22'],
    defaultStartupCommand: './app',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-go:1.23',
  },
  {
    code: 'RUST',
    label: 'Rust',
    supportedNow: true,
    defaultVersion: '1.82',
    availableVersions: ['1.82', '1.81'],
    defaultStartupCommand: './target/release/bot',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-rust:1.82',
  },
  {
    code: 'PHP',
    label: 'PHP (Extensible)',
    supportedNow: false,
    defaultVersion: '8.3',
    availableVersions: ['8.3'],
    defaultStartupCommand: 'php bot.php',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-php:8.3',
  },
  {
    code: 'RUBY',
    label: 'Ruby (Extensible)',
    supportedNow: false,
    defaultVersion: '3.3',
    availableVersions: ['3.3'],
    defaultStartupCommand: 'ruby main.rb',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-ruby:3.3',
  },
  {
    code: 'DOTNET',
    label: '.NET (Extensible)',
    supportedNow: false,
    defaultVersion: '9.0',
    availableVersions: ['9.0', '8.0'],
    defaultStartupCommand: 'dotnet Bot.dll',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-dotnet:9.0',
  },
  {
    code: 'CPP',
    label: 'C++ (Extensible)',
    supportedNow: false,
    defaultVersion: '20',
    availableVersions: ['20'],
    defaultStartupCommand: './build/bot',
    defaultDockerImage: 'ghcr.io/hypersoft2026/runtime-cpp:20',
  },
];

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessPayload<T> {
  success: true;
  data: T;
}

export interface AuthenticatedUserDTO {
  id: string;
  publicId: string;
  discordId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  updatedAt: string;
  hostCount: number;
  maxHosts: number;
}

export interface HostSummaryDTO {
  id: string;
  publicId: string;
  serverId?: string;
  ownerId: string;
  ownerPublicId?: string;
  name: string;
  description: string | null;
  type: HostTypeCode;
  runtime: HostRuntimeCode;
  runtimeVersion: string;
  status: HostStatusCode;
  nodeId: string | null;
  nodeName: string | null;
  nodeOnline: boolean;
  memoryLimitMb: number;
  cpuLimitPercent: number;
  diskLimitMb: number;
  primaryAllocation: {
    ipAddress: string;
    port: number;
    protocol: 'TCP' | 'UDP' | 'BOTH';
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface HealthReportDTO {
  status: 'healthy' | 'degraded';
  environment: 'development' | 'production' | 'test';
  version: string;
  api: 'online';
  database: {
    configured: boolean;
    connected: boolean;
    ready: boolean;
    latencyMs: number | null;
  };
  auth: {
    discordOAuthConfigured: boolean;
    loginNotificationConfigured?: boolean;
  };
  runtime: {
    connectedNodes: number;
    totalRegisteredNodes: number;
    status: 'available' | 'unavailable';
  };
  limits: {
    maxHostsPerUser: number;
  };
  diagnostics?: {
    env: Record<string, 'configured' | 'missing' | 'valid' | 'invalid'>;
  };
  timestamp: string;
}
