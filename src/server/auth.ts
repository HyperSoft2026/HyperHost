import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Host, Session, User } from '@prisma/client';
import { getPrismaOrThrow } from './database';
import { hashToken, safeTimingEqual } from './crypto';
import { AppError } from './errors';
import { config } from './config';
import type { HostPermissionScope } from '../shared/types';
import { logger } from './logger';

export const SESSION_COOKIE_NAME = 'hyperhost_session';
export const CSRF_COOKIE_NAME = 'hyperhost_csrf';

export function getSessionCookieOptions(request?: FastifyRequest) {
  const isHttps =
    config.nodeEnv === 'production' ||
    Boolean(config.appUrl?.startsWith('https://')) ||
    request?.headers['x-forwarded-proto'] === 'https' ||
    request?.protocol === 'https';

  return {
    path: '/',
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 60 * 60 * 24 * 14, // 14 days
  };
}

export function getCsrfCookieOptions(request?: FastifyRequest) {
  const isHttps =
    config.nodeEnv === 'production' ||
    Boolean(config.appUrl?.startsWith('https://')) ||
    request?.headers['x-forwarded-proto'] === 'https' ||
    request?.protocol === 'https';

  return {
    path: '/',
    httpOnly: false, // Accessible by browser script to attach to X-CSRF-Token header
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 60 * 60 * 24 * 14,
  };
}

export interface AuthContext {
  user: User;
  session: Session;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function resolveAuthContext(
  request: FastifyRequest
): Promise<AuthContext | null> {
  const cookieToken = request.cookies?.[SESSION_COOKIE_NAME];
  const authHeader = request.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

  const rawToken = cookieToken || bearerToken;
  if (!rawToken) {
    return null;
  }

  const prisma = getPrismaOrThrow();
  const tokenHash = hashToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  // Strict CSRF verification on state-mutating cookie-authenticated requests
  if (cookieToken && !bearerToken && MUTATING_METHODS.has(request.method)) {
    const rawCsrf =
      (request.headers['x-csrf-token'] as string | undefined)?.trim() ||
      ((request.body as Record<string, unknown> | null)?._csrf as string | undefined)?.trim();

    const validCsrf =
      typeof rawCsrf === 'string' &&
      rawCsrf.length >= 16 &&
      safeTimingEqual(rawCsrf, session.csrfToken);

    if (!validCsrf) {
      throw new AppError(
        'CSRF_VALIDATION_FAILED',
        'Missing or invalid CSRF protection token on state-changing request.',
        403
      );
    }
  }

  return {
    user: session.user,
    session,
  };
}

export async function requireAuth(request: FastifyRequest): Promise<AuthContext> {
  const ctx = await resolveAuthContext(request);
  if (!ctx) {
    throw new AppError(
      'AUTHENTICATION_REQUIRED',
      'You must be signed in via Discord OAuth2 to access this resource.',
      401
    );
  }
  return ctx;
}

export async function requireAdmin(request: FastifyRequest): Promise<AuthContext> {
  const ctx = await requireAuth(request);
  if (ctx.user.role !== 'ADMIN') {
    throw new AppError(
      'ADMIN_PRIVILEGES_REQUIRED',
      'Administrator privileges are required to perform this Control Plane operation.',
      403
    );
  }
  return ctx;
}

export interface AuthorizedHostContext {
  auth: AuthContext;
  host: Host;
  isOwner: boolean;
  grantedPermissions: string[];
}

export async function requireHostPermission(
  request: FastifyRequest,
  hostIdentifier: string,
  requiredScope?: HostPermissionScope
): Promise<AuthorizedHostContext> {
  const auth = await requireAuth(request);
  const prisma = getPrismaOrThrow();

  const host = await prisma.host.findFirst({
    where: {
      OR: [{ id: hostIdentifier }, { publicId: hostIdentifier }],
    },
  });

  if (!host) {
    throw new AppError('HOST_NOT_FOUND', 'The requested Host does not exist.', 404);
  }

  const isOwner = host.ownerId === auth.user.id || auth.user.role === 'ADMIN';
  if (isOwner) {
    return {
      auth,
      host,
      isOwner: true,
      grantedPermissions: ['*'],
    };
  }

  const permissionRecord = await prisma.hostPermission.findUnique({
    where: {
      hostId_userId: {
        hostId: host.id,
        userId: auth.user.id,
      },
    },
  });

  if (!permissionRecord) {
    throw new AppError(
      'HOST_ACCESS_DENIED',
      'You do not have permission to access this Host.',
      403
    );
  }

  if (requiredScope && !permissionRecord.permissions.includes(requiredScope)) {
    throw new AppError(
      'INSUFFICIENT_HOST_PERMISSION',
      `Missing required permission: ${requiredScope}`,
      403
    );
  }

  return {
    auth,
    host,
    isOwner: false,
    grantedPermissions: permissionRecord.permissions,
  };
}

const FORBIDDEN_METADATA_KEYS = [
  'password',
  'secret',
  'token',
  'encryptedvalue',
  'accesstoken',
  'refreshtoken',
  'databaseurl',
  'database_url',
  'encryptionkey',
  'encryption_key',
  'sessionsecret',
  'session_secret',
  'clientsecret',
  'client_secret',
  'bottoken',
  'bot_token',
  'webhook',
  'value',
];

function sanitizeActivityValue(val: unknown): unknown {
  if (typeof val === 'string') {
    return val
      .replace(
        /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi,
        '$1://[REDACTED]'
      )
      .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi, '[REDACTED_WEBHOOK]');
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeActivityValue);
  }
  if (val && typeof val === 'object') {
    return sanitizeActivityMetadata(val as Record<string, unknown>);
  }
  return val;
}

export function sanitizeActivityMetadata(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.some((bad) => lower.includes(bad))) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = sanitizeActivityValue(val);
    }
  }
  return clean;
}

export async function recordActivityLog(params: {
  userId?: string | null;
  hostId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}): Promise<void> {
  try {
    const prisma = getPrismaOrThrow();
    const ipAddress =
      (params.request?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      params.request?.ip ||
      null;
    const userAgent = (params.request?.headers['user-agent'] as string) || null;

    await prisma.activityLog.create({
      data: {
        userId: params.userId ?? null,
        hostId: params.hostId ?? null,
        action: params.action,
        metadata: sanitizeActivityMetadata(params.metadata || {}) as object,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    logger.warn('Could not persist ActivityLog entry', {
      action: params.action,
      reason: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export function clearSessionCookie(reply: FastifyReply, request: FastifyRequest): void {
  reply.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(request));
  reply.clearCookie(CSRF_COOKIE_NAME, getCsrfCookieOptions(request));
}
