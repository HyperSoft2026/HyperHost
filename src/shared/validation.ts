import { z } from 'zod';
import { HOST_PERMISSIONS } from './types';

export const CreateHostSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Host name must be at least 2 characters')
    .max(64, 'Host name cannot exceed 64 characters'),
  description: z
    .string()
    .trim()
    .max(280, 'Description cannot exceed 280 characters')
    .optional()
    .nullable(),
  type: z.enum([
    'DISCORD_BOT',
    'TELEGRAM_BOT',
    'NODEJS_APP',
    'PYTHON_APP',
    'JAVA_APP',
    'GO_APP',
    'RUST_APP',
    'CUSTOM',
  ]),
  runtime: z.enum([
    'NODEJS',
    'PYTHON',
    'JAVA',
    'GO',
    'RUST',
    'PHP',
    'RUBY',
    'DOTNET',
    'CPP',
  ]),
  runtimeVersion: z.string().trim().min(1).max(16).default('22'),
  nodeId: z.string().trim().optional().nullable(),
  memoryLimitMb: z.number().int().min(128).max(32768).default(512),
  cpuLimitPercent: z.number().int().min(25).max(800).default(100),
  diskLimitMb: z.number().int().min(512).max(102400).default(2048),
});

export const UpdateStartupSchema = z.object({
  runtime: z
    .enum(['NODEJS', 'PYTHON', 'JAVA', 'GO', 'RUST', 'PHP', 'RUBY', 'DOTNET', 'CPP'])
    .optional(),
  runtimeVersion: z.string().trim().min(1).max(16).optional(),
  startupCommand: z.string().trim().min(1).max(512),
  startupArgs: z.array(z.string().trim().max(128)).max(32).default([]),
  workingDirectory: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine((val) => val.startsWith('/') && !val.includes('..'), {
      message: 'Working directory must be an absolute path without directory traversal',
    }),
  environmentVariables: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[A-Z_][A-Z0-9_]*$/, 'Environment variable key must be uppercase alphanumeric with underscores')
          .max(64),
        value: z.string().max(4096),
        isSecret: z.boolean().default(true),
        description: z.string().max(160).optional().nullable(),
      })
    )
    .max(100)
    .optional(),
});

export const PowerManagementSchema = z.object({
  action: z.enum(['start', 'stop', 'restart', 'kill', 'reinstall']),
});

export const FileOperationSchema = z.object({
  action: z.enum([
    'list',
    'create_file',
    'create_folder',
    'rename',
    'delete',
    'move',
    'write',
    'read',
  ]),
  path: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((p) => !p.includes('..'), 'Path traversal is prohibited'),
  targetPath: z
    .string()
    .trim()
    .max(512)
    .refine((p) => !p.includes('..'), 'Path traversal is prohibited')
    .optional(),
  content: z.string().max(1048576).optional(),
});

export const CreateAllocationRequestSchema = z.object({
  allocationId: z.string().trim().min(1),
  isPrimary: z.boolean().default(false),
});

export const CreateDatabaseSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{3,32}$/, 'Database name must be 3-32 lowercase alphanumeric or underscore characters'),
  engine: z.enum(['POSTGRESQL', 'MYSQL', 'MONGODB', 'REDIS']),
  remoteHost: z.string().trim().min(1).max(64).default('%'),
});

export const CreateScheduleSchema = z.object({
  name: z.string().trim().min(2).max(64),
  cronExpression: z
    .string()
    .trim()
    .regex(
      /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/,
      'Invalid 5-field cron expression (e.g. "0 */24 * * *")'
    ),
  taskType: z.enum([
    'POWER_START',
    'POWER_STOP',
    'POWER_RESTART',
    'EXECUTE_COMMAND',
    'CREATE_BACKUP',
  ]),
  payload: z.string().trim().max(512).optional().nullable(),
  isActive: z.boolean().default(true),
  onlyWhenOnline: z.boolean().default(false),
});

export const CreateBackupSchema = z.object({
  name: z.string().trim().min(2).max(64),
  isLocked: z.boolean().default(false),
});

export const UpsertCollaboratorSchema = z.object({
  discordId: z.string().trim().min(5).max(32),
  permissions: z
    .array(z.enum(HOST_PERMISSIONS))
    .min(1, 'At least one permission must be granted'),
});

export const UpdateHostSettingsSchema = z.object({
  name: z.string().trim().min(2).max(64),
  description: z.string().trim().max(280).optional().nullable(),
});

export const CreateNodeSchema = z.object({
  name: z.string().trim().min(2).max(64),
  location: z.string().trim().min(2).max(64),
  fqdn: z.string().trim().min(3).max(128),
  ipAddress: z.string().trim().min(7).max(45),
  daemonPort: z.number().int().min(1024).max(65535).default(8080),
  maxMemoryMb: z.number().int().min(1024).max(1048576),
  maxDiskMb: z.number().int().min(5120).max(10485760),
  maxCpuPercent: z.number().int().min(100).max(12800).default(1000),
});

export const CreateNodeAllocationBatchSchema = z.object({
  ipAddress: z.string().trim().min(7).max(45),
  startPort: z.number().int().min(1024).max(65535),
  endPort: z.number().int().min(1024).max(65535),
  protocol: z.enum(['TCP', 'UDP', 'BOTH']).default('TCP'),
});
