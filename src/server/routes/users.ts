import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth';
import { getPrismaOrThrow } from '../database';
import { MAX_HOSTS_PER_USER } from '../../shared/types';

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
        take: 20,
        include: {
          host: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        user: {
          id: user.id,
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
          action: log.action,
          hostId: log.hostId,
          hostName: log.host?.name ?? null,
          metadata: log.metadata,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    };
  });

  // List users (Admin only, paginated)
  app.get('/api/users', async (request) => {
    await requireAdmin(request);
    const prisma = getPrismaOrThrow();

    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { ownedHosts: true },
          },
        },
      }),
      prisma.user.count(),
    ]);

    return {
      success: true,
      data: {
        items: users.map((u) => ({
          id: u.id,
          discordId: u.discordId,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          role: u.role,
          hostCount: u._count.ownedHosts,
          maxHosts: MAX_HOSTS_PER_USER,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  });
}
