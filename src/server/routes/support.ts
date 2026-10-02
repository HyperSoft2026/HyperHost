import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recordActivityLog, requireAuth } from '../auth';
import { getPrismaOrThrow } from '../database';
import { AppError } from '../errors';
import { logger } from '../logger';
import { sendDiscordSupportNotification } from '../discord-notify';
import { generatePublicId, formatEntityPublicId } from '../../shared/ids';
import { normalizeLocale, type SupportedLocale } from '../../shared/types';
import { CreateSupportMessageSchema } from '../../shared/validation';

function resolveRequestLocale(request: FastifyRequest): SupportedLocale {
  const query = request.query as { locale?: string } | undefined;
  const headerLocale = request.headers['x-hyperhost-locale'];
  const cookieLocale = request.cookies?.['hyperhost_locale'];
  return normalizeLocale(
    query?.locale ||
      (typeof headerLocale === 'string' ? headerLocale : undefined) ||
      cookieLocale
  );
}

// In-memory rate limiting map for support tickets (1 ticket per 30 seconds per user)
const supportCooldowns = new Map<string, number>();
const SUPPORT_COOLDOWN_MS = 30_000;

export async function registerSupportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/support — Submit a new support inquiry
  app.post('/api/support', async (request, reply) => {
    const { user } = await requireAuth(request);
    const body = CreateSupportMessageSchema.parse(request.body);
    const prisma = getPrismaOrThrow();

    // Check rate limit per user
    const lastSubmitTime = supportCooldowns.get(user.id);
    if (lastSubmitTime && Date.now() - lastSubmitTime < SUPPORT_COOLDOWN_MS) {
      const waitSec = Math.ceil((SUPPORT_COOLDOWN_MS - (Date.now() - lastSubmitTime)) / 1000);
      throw new AppError(
        'SUPPORT_RATE_LIMITED',
        `Please wait ${waitSec} seconds before submitting another support ticket.`,
        429
      );
    }

    const referenceId = generatePublicId('sup');
    const userPublicId = formatEntityPublicId('usr', user.id, user.publicId);
    const requestLocale = resolveRequestLocale(request);

    // 1. Persist the support message to PostgreSQL FIRST
    const supportRecord = await prisma.supportMessage.create({
      data: {
        referenceId,
        userId: user.id,
        name: user.displayName || user.username,
        email: user.email ?? null,
        discordId: user.discordId,
        subject: body.subject,
        message: body.message,
        status: 'OPEN',
      },
    });

    supportCooldowns.set(user.id, Date.now());

    // 2. Dispatch Discord support notification to target ID 827205816758829137
    // If Discord delivery fails, DO NOT rollback or delete the ticket; return the referenceId
    const discordResult = await sendDiscordSupportNotification({
      referenceId,
      userPublicId,
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      subject: body.subject,
      message: body.message,
      createdAt: supportRecord.createdAt,
      locale: requestLocale,
    }).catch((err) => {
      logger.error('Unexpected error while dispatching Discord support notification', {
        referenceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false as const,
        reason: 'DISCORD_API_ERROR' as const,
      };
    });

    await recordActivityLog({
      userId: user.id,
      action: 'Submitted Support Inquiry',
      metadata: {
        referenceId,
        subject: body.subject,
        discordNotified: discordResult.ok,
        discordReason: discordResult.ok ? null : discordResult.reason,
      },
      request,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        referenceId: supportRecord.referenceId,
        status: supportRecord.status,
        createdAt: supportRecord.createdAt.toISOString(),
        discordNotified: discordResult.ok,
        discordReason: discordResult.ok ? null : discordResult.reason,
      },
    };
  });

  // GET /api/support — List user's support inquiries
  app.get('/api/support', async (request) => {
    const { user } = await requireAuth(request);
    const prisma = getPrismaOrThrow();

    const tickets = await prisma.supportMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      success: true,
      data: tickets.map((t) => ({
        id: t.id,
        referenceId: t.referenceId,
        subject: t.subject,
        message: t.message,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  });
}
