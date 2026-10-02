import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth';
import { getPrismaOrThrow } from '../database';
import { MAX_HOSTS_PER_USER } from '../../shared/types';
import { formatEntityPublicId } from '../../shared/ids';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  // Get authenticated user's profile, host quota, and recent account activity
  app.get('/api/users/me', async (request) => {
    const { user } = await requireAuth(request);
    const prisma = getPrismaOrThrow();

    const [hostCount, recentActivity] = await Promise.all([
      prisma.host.count({ where: { ownerId: user.id } }),
      prisma.activityLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          host: {
            select: { id: true, publicId: true, name: true },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          publicId: formatEntityPublicId('usr', user.id, user.publicId),
          discordId: user.discordId,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          hostCount,
          maxHosts: MAX_HOSTS_PER_USER,
        },
        recentActivity: recentActivity.map((log) => ({
          id: log.id,
          publicId: formatEntityPublicId('act', log.id),
          userId: formatEntityPublicId('usr', user.id, user.publicId),
          action: log.action,
          hostId: log.host ? formatEntityPublicId('srv', log.host.id, log.host.publicId) : null,
          hostName: log.host?.name ?? null,
          metadata: log.metadata,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    };
  });

  // List users (Admin only, paginated)
  app.get('/api/users', async (request) => {
    await requireAdmin(request);
    const prisma = getPrismaOrThrow();

    const query = request.query as { page?: string; limit?: string; search?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { discordId: { contains: search } },
            { publicId: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { ownedHosts: true, sessions: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items: users.map((u) => ({
          id: u.id,
          publicId: formatEntityPublicId('usr', u.id, u.publicId),
          discordId: u.discordId,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          role: u.role,
          hostCount: u._count.ownedHosts,
          sessionCount: u._count.sessions,
          maxHosts: MAX_HOSTS_PER_USER,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    };
  });
}
